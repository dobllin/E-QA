import { Body, Controller, Delete, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min, MinLength, ValidateNested } from 'class-validator';
import { Db } from '../db/db.service';
import { appErr } from '../common/errors';
import { audit } from '../common/audit';
import { AuthUser, CurrentUser, Roles } from '../common/auth';

class SantriDto {
  @IsString() @MinLength(1) nis: string;
  @IsString() @MinLength(2) fullName: string;
  @IsOptional() @IsString() kelas?: string;
}
class UpdateSantriDto {
  @IsOptional() @IsString() @MinLength(1) nis?: string;
  @IsOptional() @IsString() @MinLength(2) fullName?: string;
  @IsOptional() @IsString() kelas?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'GRADUATED', 'ARCHIVED']) status?: string;
}
class BulkDto {
  @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => SantriDto) rows: SantriDto[];
}
class SppDto { @IsOptional() @IsInt() @Min(1000) @Max(100_000_000) sppAmount?: number | null }
class PromoteDto { @IsString() @MinLength(1) fromKelas: string; @IsString() @MinLength(1) toKelas: string }
class GraduateDto { @IsString() @MinLength(1) kelas: string }
class LinkDto { @IsUUID() userId: string; @IsOptional() @IsString() relation?: string }

@Controller('santri')
@Roles('ADMIN', 'BENDAHARA', 'GURU')
class SantriController {
  constructor(private db: Db) {}

  @Get() async list(@Query('q') q?: string, @Query('kelas') kelas?: string) {
    const { rows } = await this.db.query(
      `SELECT s.id, s.nis, s.full_name AS "fullName", s.kelas, s.status, w.balance, s.spp_amount AS "sppAmount", s.status_label AS "statusLabel", s.bagian,
              (SELECT COALESCE(SUM(x.balance),0)::int FROM wallets x WHERE x.santri_id = s.id) AS "balanceAll",
              (SELECT status FROM cards c WHERE c.santri_id = s.id AND c.status IN ('ACTIVE','SUSPENDED','LOCKED') LIMIT 1) AS "cardStatus"
         FROM santri s LEFT JOIN wallets w ON w.santri_id = s.id AND w.pocket = 'JAJAN'
        WHERE ($1::text IS NULL OR s.full_name ILIKE '%' || $1 || '%' OR s.nis ILIKE '%' || $1 || '%')
          AND ($2::text IS NULL OR s.kelas = $2)
        ORDER BY s.full_name LIMIT 500`, [q || null, kelas || null]);
    return rows;
  }

  @Get(':id') async one(@Param('id', ParseUUIDPipe) id: string) {
    const { rows } = await this.db.query(
      `SELECT s.id, s.nis, s.full_name AS "fullName", s.kelas, s.status, w.balance, w.daily_limit AS "dailyLimit", w.per_tx_limit AS "perTxLimit", s.spp_amount AS "sppAmount", s.status_label AS "statusLabel", s.bagian, s.catatan,
              (SELECT json_object_agg(x.pocket, x.balance) FROM wallets x WHERE x.santri_id = s.id) AS pockets,
              COALESCE((SELECT json_agg(json_build_object('userId', u.id, 'fullName', u.full_name, 'username', u.username, 'relation', sw.relation))
                          FROM santri_walsan sw JOIN users u ON u.id = sw.user_id WHERE sw.santri_id = s.id), '[]') AS walsan
         FROM santri s LEFT JOIN wallets w ON w.santri_id = s.id AND w.pocket = 'JAJAN' WHERE s.id = $1`, [id]);
    if (!rows[0]) throw appErr(404, 'SANTRI_NOT_FOUND', 'Santri tidak ditemukan');
    return rows[0];
  }

  @Roles('ADMIN') @Post() async create(@CurrentUser() u: AuthUser, @Body() b: SantriDto) {
    return this.db.tx(async (c) => {
      try {
        const s = (await c.query('INSERT INTO santri(nis, full_name, kelas) VALUES ($1,$2,$3) RETURNING id, nis, full_name AS "fullName", kelas, status',
          [b.nis.trim(), b.fullName.trim(), b.kelas?.trim() || null])).rows[0];
        await c.query(`INSERT INTO wallets(santri_id, pocket) SELECT $1, unnest(ARRAY['SALDO','JAJAN','LAUNDRY'])`, [s.id]);
        await audit(c, u.id, 'SANTRI_CREATE', 'santri', s.id);
        return s;
      } catch (e: any) {
        if (e.code === '23505') throw appErr(409, 'NIS_TAKEN', `NIS ${b.nis} sudah terdaftar`);
        throw e;
      }
    });
  }

  /** Impor massal (dari CSV). Baris yang NIS-nya sudah ada dilewati. */
  @Roles('ADMIN') @Post('bulk') async bulk(@CurrentUser() u: AuthUser, @Body() b: BulkDto) {
    return this.db.tx(async (c) => {
      let created = 0; const skipped: string[] = [];
      for (const r of b.rows) {
        const s = (await c.query(
          `INSERT INTO santri(nis, full_name, kelas) VALUES ($1,$2,$3) ON CONFLICT (nis) DO NOTHING RETURNING id`,
          [r.nis.trim(), r.fullName.trim(), r.kelas?.trim() || null])).rows[0];
        if (!s) { skipped.push(r.nis); continue; }
        await c.query(`INSERT INTO wallets(santri_id, pocket) SELECT $1, unnest(ARRAY['SALDO','JAJAN','LAUNDRY'])`, [s.id]);
        created++;
      }
      await audit(c, u.id, 'SANTRI_BULK_IMPORT', 'santri', undefined, { created, skipped: skipped.length });
      return { created, skipped };
    });
  }

  @Roles('ADMIN') @Patch(':id') async update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: UpdateSantriDto) {
    const { rows } = await this.db.query(
      `UPDATE santri SET full_name = COALESCE($2, full_name), kelas = COALESCE($3, kelas), status = COALESCE($4, status), nis = COALESCE($5, nis)
        WHERE id = $1 RETURNING id`, [id, b.fullName ?? null, b.kelas ?? null, b.status ?? null, b.nis?.trim() ?? null]).catch((e: any) => { if (e.code === '23505') throw appErr(409, 'NIS_TAKEN', 'NIS sudah dipakai santri lain'); throw e; });
    if (!rows[0]) throw appErr(404, 'SANTRI_NOT_FOUND', 'Santri tidak ditemukan');
    await audit(this.db.pool, u.id, 'SANTRI_UPDATE', 'santri', id, b);
    return { ok: true };
  }

  /** Nominal SPP per bulan khusus santri ini (dipakai saat membuat tagihan massal "per santri"). Kosong = ikut nominal umum. */
  @Roles('ADMIN', 'BENDAHARA') @Patch(':id/spp') async setSpp(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: SppDto) {
    const { rows } = await this.db.query('UPDATE santri SET spp_amount = $2 WHERE id = $1 RETURNING id', [id, b.sppAmount ?? null]);
    if (!rows[0]) throw appErr(404, 'SANTRI_NOT_FOUND', 'Santri tidak ditemukan');
    await audit(this.db.pool, u.id, 'SANTRI_SPP_RATE', 'santri', id, { sppAmount: b.sppAmount ?? null });
    return { ok: true, sppAmount: b.sppAmount ?? null };
  }

  /** Naik kelas massal: semua santri AKTIF di kelas asal dipindah ke kelas tujuan. */
  @Roles('ADMIN') @Post('promote') async promote(@CurrentUser() u: AuthUser, @Body() b: PromoteDto) {
    const { rowCount } = await this.db.query(`UPDATE santri SET kelas = $2 WHERE kelas = $1 AND status = 'ACTIVE'`, [b.fromKelas.trim(), b.toKelas.trim()]);
    await audit(this.db.pool, u.id, 'SANTRI_PROMOTE', 'santri', undefined, { from: b.fromKelas, to: b.toKelas, count: rowCount });
    return { moved: rowCount ?? 0 };
  }

  /** Luluskan satu kelas: status santri aktif di kelas itu menjadi GRADUATED (saldo dan riwayat tetap tersimpan; kartu tidak bisa dipakai lagi). */
  @Roles('ADMIN') @Post('graduate') async graduate(@CurrentUser() u: AuthUser, @Body() b: GraduateDto) {
    const { rowCount } = await this.db.query(`UPDATE santri SET status = 'GRADUATED' WHERE kelas = $1 AND status = 'ACTIVE'`, [b.kelas.trim()]);
    await audit(this.db.pool, u.id, 'SANTRI_GRADUATE', 'santri', undefined, { kelas: b.kelas, count: rowCount });
    return { graduated: rowCount ?? 0 };
  }

  @Roles('ADMIN') @Post(':id/walsan') async link(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: LinkDto) {
    const usr = (await this.db.query('SELECT role FROM users WHERE id = $1', [b.userId])).rows[0];
    if (!usr) throw appErr(404, 'USER_NOT_FOUND', 'Akun tidak ditemukan');
    if (usr.role !== 'WALSAN') throw appErr(400, 'NOT_WALSAN', 'Akun ini bukan akun wali santri');
    await this.db.query(
      `INSERT INTO santri_walsan(user_id, santri_id, relation) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, santri_id) DO UPDATE SET relation = EXCLUDED.relation`, [b.userId, id, b.relation ?? 'wali']);
    await audit(this.db.pool, u.id, 'WALSAN_LINK', 'santri', id, { userId: b.userId });
    return { ok: true };
  }

  @Roles('ADMIN') @Delete(':id/walsan/:userId') async unlink(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    await this.db.query('DELETE FROM santri_walsan WHERE santri_id = $1 AND user_id = $2', [id, userId]);
    await audit(this.db.pool, u.id, 'WALSAN_UNLINK', 'santri', id, { userId });
    return { ok: true };
  }
}

@Module({ controllers: [SantriController] })
export class SantriModule {}
