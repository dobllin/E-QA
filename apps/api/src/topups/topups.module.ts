import { Body, Controller, Delete, Get, Injectable, Module, Param, ParseUUIDPipe, Post, Put, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { createHash, randomInt } from 'crypto';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Db } from '../db/db.service';
import { appErr } from '../common/errors';
import { audit } from '../common/audit';
import { notifyStaff, notifyWalsan, rp as rpf } from '../common/notify';
import { AuthUser, CurrentUser, Roles } from '../common/auth';

const rp = (n: number) => `Rp${n.toLocaleString('id-ID')}`;
const EFFECTIVE = `CASE WHEN t.status = 'PENDING' AND t.expires_at < now() THEN 'EXPIRED' ELSE t.status END`;

/** Kenali jenis gambar dari byte awal file (bukan dari nama/ekstensi yang bisa dipalsukan). */
function sniffImage(b: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export interface TopupSettings { fee: number; min: number; max: number; expiryHours: number; bankInfo: string; bankName: string; bankAccount: string; bankHolder: string; tolerance: number; hasQris: boolean }

@Injectable()
export class TopupsService {
  constructor(private db: Db) {}

  async settings(): Promise<TopupSettings> {
    const { rows } = await this.db.query('SELECT key, value FROM app_settings');
    const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return { fee: Number(m.topup_fee ?? 0), min: Number(m.topup_min ?? 20000), max: Number(m.topup_max ?? 2000000), expiryHours: Number(m.topup_expiry_hours ?? 48), bankInfo: m.bank_info ?? '', bankName: m.bank_name ?? '', bankAccount: m.bank_account ?? '', bankHolder: m.bank_holder ?? '', tolerance: Number(m.topup_tolerance ?? 5000), hasQris: (m.qris_image ?? '').length > 0 };
  }

  async saveSettings(actor: AuthUser, s: Omit<TopupSettings, 'hasQris' | 'tolerance' | 'bankInfo' | 'bankName' | 'bankAccount' | 'bankHolder'> & { tolerance?: number; bankInfo?: string; bankName?: string; bankAccount?: string; bankHolder?: string }) {
    if (s.min > s.max) throw appErr(400, 'RANGE', 'Minimal top up tidak boleh lebih besar dari maksimal');
    // Bila rekening diisi terstruktur, teks rekening untuk wali disusun otomatis.
    const acc = (s.bankAccount ?? '').trim();
    const bankInfo = acc ? [s.bankName?.trim(), acc, s.bankHolder?.trim() ? `a.n. ${s.bankHolder.trim()}` : ''].filter(Boolean).join('\n') : (s.bankInfo ?? '').trim();
    if (!bankInfo) throw appErr(400, 'BANK_REQUIRED', 'Isi nomor rekening tujuan');
    const entries: [string, string][] = [['topup_fee', String(s.fee)], ['topup_min', String(s.min)], ['topup_max', String(s.max)], ['topup_expiry_hours', String(s.expiryHours)], ['bank_info', bankInfo], ['bank_name', (s.bankName ?? '').trim()], ['bank_account', (s.bankAccount ?? '').trim()], ['bank_holder', (s.bankHolder ?? '').trim()], ...(s.tolerance !== undefined ? [['topup_tolerance', String(s.tolerance)] as [string, string]] : [])];
    for (const [k, v] of entries) await this.db.query(`INSERT INTO app_settings(key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [k, v]);
    await audit(this.db.pool, actor.id, 'SETTINGS_TOPUP', 'settings', undefined, { fee: s.fee, min: s.min, max: s.max, expiryHours: s.expiryHours, tolerance: s.tolerance });
    return this.settings();
  }

  async setQris(actor: AuthUser, file: { buffer?: Buffer } | undefined) {
    if (!file?.buffer?.length) throw appErr(400, 'NO_FILE', 'Pilih gambar QRIS terlebih dahulu');
    const mime = sniffImage(file.buffer);
    if (!mime) throw appErr(400, 'BAD_FILE', 'File harus berupa gambar JPG, PNG, atau WebP');
    await this.db.query(`INSERT INTO app_settings(key, value) VALUES ('qris_image', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [`${mime};${file.buffer.toString('base64')}`]);
    await audit(this.db.pool, actor.id, 'SETTINGS_QRIS', 'settings', undefined, { bytes: file.buffer.length });
    return { ok: true };
  }
  async removeQris(actor: AuthUser) {
    await this.db.query(`UPDATE app_settings SET value = '', updated_at = now() WHERE key = 'qris_image'`);
    await audit(this.db.pool, actor.id, 'SETTINGS_QRIS_REMOVE', 'settings');
    return { ok: true };
  }
  async getQris(): Promise<{ mime: string; data: Buffer }> {
    const v = (await this.db.query(`SELECT value FROM app_settings WHERE key = 'qris_image'`)).rows[0]?.value as string | undefined;
    if (!v) throw appErr(404, 'NO_QRIS', 'QRIS belum diunggah');
    const i = v.indexOf(';');
    return { mime: v.slice(0, i), data: Buffer.from(v.slice(i + 1), 'base64') };
  }

  private expireStale() {
    return this.db.query(`UPDATE topup_requests SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at < now()`);
  }

  /** Wali membuat permintaan top up. Total transfer = nominal + kode unik + biaya layanan; saldo masuk = nominal + kode unik. */
  async create(user: AuthUser, santriId: string, amount: number) {
    const s = await this.settings();
    if (amount < s.min || amount > s.max) throw appErr(422, 'AMOUNT_RANGE', `Nominal top up harus antara ${rp(s.min)} dan ${rp(s.max)}`);
    if (!s.bankInfo.trim()) throw appErr(409, 'BANK_NOT_SET', 'Rekening tujuan belum diatur oleh admin pesantren');
    await this.expireStale();
    const open = (await this.db.query(`SELECT count(*)::int AS n FROM topup_requests WHERE santri_id = $1 AND status IN ('PENDING','MATCHED')`, [santriId])).rows[0].n;
    if (open >= 3) throw appErr(409, 'TOO_MANY_OPEN', 'Masih ada 3 permintaan top up yang belum selesai. Selesaikan atau batalkan dulu.');
    for (let i = 0; i < 40; i++) {
      const code = 1 + randomInt(999);
      try {
        const { rows } = await this.db.query(
          `INSERT INTO topup_requests(santri_id, requested_by, amount, unique_code, fee, total, expires_at, target_pocket)
           VALUES ($1,$2,$3,$4,$5,$6, now() + make_interval(hours => $7), 'SALDO')
           RETURNING id, amount, unique_code AS "uniqueCode", fee, total, status, expires_at AS "expiresAt"`,
          [santriId, user.id, amount, code, s.fee, amount + code + s.fee, s.expiryHours]);
        await audit(this.db.pool, user.id, 'TOPUP_REQUEST', 'topup', rows[0].id, { amount, total: rows[0].total });
        return { ...rows[0], credited: amount + code, bankInfo: s.bankInfo, bankName: s.bankName, bankAccount: s.bankAccount, bankHolder: s.bankHolder };
      } catch (e: any) { if (e.code === '23505') continue; throw e; } // nominal sudah dipakai permintaan lain → coba kode lain
    }
    throw appErr(503, 'NO_CODE', 'Sistem sedang ramai, coba lagi sebentar.');
  }

  /**
   * Cocokkan baris mutasi bank dengan permintaan terbuka. Hanya menandai MATCHED; saldo BELUM masuk sebelum disetujui.
   * Jumlah di mutasi boleh SAMA atau LEBIH sedikit-banyak (sampai batas toleransi) dari total yang diminta; kurang = tidak dicocokkan.
   * Bila lebih dari satu permintaan masuk akal dan tidak ada yang persis, baris dilewati (ambigu) dan diproses manual.
   */
  async match(lines: { ref: string; amount: number }[]) {
    const tol = (await this.settings()).tolerance;
    return this.db.tx(async (c) => {
      await c.query(`UPDATE topup_requests SET status = 'EXPIRED' WHERE status = 'PENDING' AND expires_at < now()`);
      let matched = 0, duplicates = 0, ambiguous = 0;
      for (const l of lines) {
        const dup = (await c.query('SELECT 1 FROM topup_requests WHERE matched_ref = $1', [l.ref])).rows[0];
        if (dup) { duplicates++; continue; }
        const cands = (await c.query(
          `SELECT id, total FROM topup_requests WHERE status = 'PENDING' AND expires_at > now() AND total <= $1 AND total >= $1 - $2
            ORDER BY (total = $1) DESC, total DESC FOR UPDATE`, [l.amount, tol])).rows;
        if (cands.length === 0) continue;
        const pick = cands.find((x) => x.total === l.amount) ?? (cands.length === 1 ? cands[0] : null);
        if (!pick) { ambiguous++; continue; }
        await c.query(`UPDATE topup_requests SET status = 'MATCHED', matched_ref = $2, matched_at = now(), received_amount = $3 WHERE id = $1`, [pick.id, l.ref, l.amount]);
        matched++;
      }
      return { matched, duplicates, ambiguous, unmatched: lines.length - matched - duplicates - ambiguous };
    });
  }

  async approve(actor: AuthUser, id: string, note?: string, receivedOverride?: number) {
    return this.db.tx(async (c) => {
      const r = (await c.query('SELECT * FROM topup_requests WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!r) throw appErr(404, 'NOT_FOUND', 'Permintaan top up tidak ditemukan');
      if (r.status === 'CREDITED') throw appErr(409, 'ALREADY_CREDITED', 'Top up ini sudah dimasukkan ke saldo');
      if (!['PENDING', 'MATCHED'].includes(r.status)) throw appErr(409, 'BAD_STATE', `Permintaan berstatus ${r.status}`);
      if (r.requested_by === actor.id) throw appErr(403, 'MAKER_CHECKER', 'Pembuat permintaan tidak boleh menyetujuinya sendiri');
      if (r.status === 'PENDING') {
        if (!note || note.trim().length < 3) throw appErr(422, 'MANUAL_NOTE', 'Belum ada mutasi yang cocok. Isi catatan bukti verifikasi manual (mis. nomor bukti transfer).');
        if (new Date(r.expires_at) < new Date()) throw appErr(409, 'EXPIRED', 'Permintaan sudah kedaluwarsa');
      }
      // Saldo yang masuk = jumlah yang benar-benar diterima di rekening dikurangi biaya layanan.
      const baseline = r.received_amount ?? r.total;
      const received = receivedOverride ?? baseline;
      if (received !== baseline && (!note || note.trim().length < 3)) throw appErr(422, 'RECEIVED_NOTE', 'Jumlah diterima berbeda dari yang tercatat. Isi catatan bukti verifikasi (mis. nomor bukti transfer).');
      const credit = received - r.fee;
      if (credit < 1000) throw appErr(422, 'CREDIT_TOO_SMALL', 'Jumlah diterima terlalu kecil setelah dikurangi biaya layanan');
      // Semua top up masuk ke kantong SALDO; wali yang memindahkannya.
      const w = (await c.query("SELECT id, balance FROM wallets WHERE santri_id = $1 AND pocket = 'SALDO' FOR UPDATE", [r.santri_id])).rows[0];
      if (!w) throw appErr(404, 'WALLET_NOT_FOUND', 'Saldo santri tidak ditemukan');
      const after = w.balance + credit;
      const firstLedger = (await c.query(
        `INSERT INTO ledger_entries(wallet_id, type, direction, amount, balance_after, idempotency_key, note, meta, actor_id)
         VALUES ($1,'TOPUP','CREDIT',$2,$3,$4,'Top up transfer bank',$5,$6) RETURNING id`,
        [w.id, credit, after, `topup-req:${r.id}:SALDO`, JSON.stringify({ method: 'BANK_TRANSFER', requestId: r.id, ref: r.matched_ref ?? null }), actor.id])).rows[0].id;
      await c.query('UPDATE wallets SET balance = $2, updated_at = now() WHERE id = $1', [w.id, after]);
      await c.query(`UPDATE topup_requests SET status = 'CREDITED', ledger_entry_id = $2, decided_by = $3, decided_at = now(), note = COALESCE($4, note), received_amount = $5, credited = $6 WHERE id = $1`, [r.id, firstLedger, actor.id, note ?? null, received, credit]);
      const sn = (await c.query('SELECT full_name FROM santri WHERE id = $1', [r.santri_id])).rows[0]?.full_name ?? 'anak';
      await notifyWalsan(c, r.santri_id, 'Isi saldo berhasil', `Uang ${rpf(credit)} sudah masuk untuk ${sn}.`);
      await notifyStaff(c, 'Top up masuk', `${rpf(credit)} sudah masuk ke saldo ${sn}.`, '/topup', 'PAYMENT', { payType: 'TOPUP_DONE', exceptUserId: actor.id });
      await audit(c, actor.id, 'TOPUP_APPROVE', 'topup', r.id, { credited: credit, received, fee: r.fee, manual: r.status === 'PENDING' });
      return { credited: credit, fee: r.fee };
    });
  }

  /** Wali mengunggah bukti transfer. Hanya pembantu: tidak mengubah saldo. */
  async addProof(user: AuthUser, rid: string, file: { buffer?: Buffer } | undefined, ocrRaw?: string) {
    if (!file?.buffer?.length) throw appErr(400, 'NO_FILE', 'Pilih foto bukti transfer terlebih dahulu');
    const mime = sniffImage(file.buffer);
    if (!mime) throw appErr(400, 'BAD_FILE', 'File harus berupa foto JPG, PNG, atau WebP');
    const r = (await this.db.query('SELECT id, total, status, requested_by, expires_at FROM topup_requests WHERE id = $1', [rid])).rows[0];
    if (!r || r.requested_by !== user.id) throw appErr(404, 'NOT_FOUND', 'Permintaan top up tidak ditemukan');
    if (!['PENDING', 'MATCHED'].includes(r.status) || new Date(r.expires_at) < new Date()) throw appErr(409, 'BAD_STATE', 'Permintaan ini sudah selesai atau kedaluwarsa');
    const n = (await this.db.query('SELECT count(*)::int AS n FROM topup_proofs WHERE topup_id = $1', [rid])).rows[0].n;
    if (n >= 3) throw appErr(409, 'TOO_MANY_PROOFS', 'Maksimal 3 foto bukti per permintaan');
    let amounts: number[] = [];
    try { const a = JSON.parse(ocrRaw ?? '[]'); if (Array.isArray(a)) amounts = [...new Set(a.filter((x) => Number.isInteger(x) && x >= 1000 && x <= 100_000_000))].slice(0, 20) as number[]; } catch { /* abaikan */ }
    const sha = createHash('sha256').update(file.buffer).digest('hex');
    try {
      const { rows } = await this.db.query(
        `INSERT INTO topup_proofs(topup_id, uploaded_by, mime, data, sha256, ocr_amounts, amount_match) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [rid, user.id, mime, file.buffer, sha, amounts, amounts.includes(r.total)]);
      await audit(this.db.pool, user.id, 'TOPUP_PROOF_UPLOAD', 'topup', rid, { amountMatch: amounts.includes(r.total) });
      const who = (await this.db.query(
        `SELECT u.full_name AS wali, s.full_name AS santri FROM topup_requests t JOIN users u ON u.id = t.requested_by JOIN santri s ON s.id = t.santri_id WHERE t.id = $1`, [rid])).rows[0];
      await notifyStaff(this.db.pool, 'Ada yang bayar', `${who?.wali ?? 'Wali'} mengirim bukti transfer ${rpf(r.total)} untuk ${who?.santri ?? 'santri'}. Cek rekening lalu setujui.`, '/topup', 'PAYMENT', { payType: 'TOPUP_PROOF' }).catch(() => {});
      return { id: rows[0].id, amountMatch: amounts.includes(r.total), ocrAmounts: amounts };
    } catch (e: any) {
      if (e.code === '23505') throw appErr(409, 'PROOF_DUPLICATE', 'Foto ini sudah pernah diunggah. Gunakan bukti transfer yang asli dan baru.');
      throw e;
    }
  }

  async reject(actor: AuthUser, id: string, note: string) {
    const { rows } = await this.db.query(
      `UPDATE topup_requests SET status = 'REJECTED', decided_by = $2, decided_at = now(), note = $3
        WHERE id = $1 AND status IN ('PENDING','MATCHED') RETURNING id`, [id, actor.id, note]);
    if (!rows[0]) throw appErr(409, 'BAD_STATE', 'Permintaan tidak bisa ditolak (sudah selesai atau tidak ada)');
    await audit(this.db.pool, actor.id, 'TOPUP_REJECT', 'topup', id, { note });
    return { ok: true };
  }
}

class SettingsDto {
  @IsOptional() @IsString() @MaxLength(80) bankName?: string;
  @IsOptional() @Matches(/^[0-9 .\-]{0,30}$/, { message: 'Nomor rekening hanya angka (boleh spasi/titik/strip)' }) bankAccount?: string;
  @IsOptional() @IsString() @MaxLength(120) bankHolder?: string;
  @IsOptional() @IsInt() @Min(0) @Max(20000) tolerance?: number;
  @IsInt() @Min(0) @Max(20000) fee: number;
  @IsInt() @Min(1000) min: number;
  @IsInt() @Min(1000) @Max(10_000_000) max: number;
  @IsInt() @Min(1) @Max(168) expiryHours: number;
  @IsOptional() @IsString() @MaxLength(600) bankInfo?: string;
}
class LineDto { @IsString() @MaxLength(300) ref: string; @IsInt() @Min(1) @Max(100_000_000) amount: number }
class MatchDto { @IsArray() @ArrayMaxSize(3000) @ValidateNested({ each: true }) @Type(() => LineDto) lines: LineDto[] }
class NoteDto { @IsOptional() @IsString() @MaxLength(300) note?: string; @IsOptional() @IsInt() @Min(1000) @Max(10_000_000) receivedAmount?: number }
class RejectDto { @IsString() @MinLength(3) @MaxLength(300) note: string }
class CreateDto {
  @IsInt() @Min(1000) @Max(10_000_000) amount: number;
}

@Controller()
class TopupsController {
  constructor(private svc: TopupsService, private db: Db) {}

  @Roles('ADMIN') @Get('topups/settings')
  settings() { return this.svc.settings(); }

  @Roles('ADMIN') @Put('topups/qris')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  setQris(@CurrentUser() u: AuthUser, @UploadedFile() file: { buffer?: Buffer } | undefined) { return this.svc.setQris(u, file); }

  @Roles('ADMIN') @Delete('topups/qris')
  removeQris(@CurrentUser() u: AuthUser) { return this.svc.removeQris(u); }

  @Roles('ADMIN') @Get('topups/qris')
  async qris(@Res({ passthrough: true }) res: Response) {
    const q = await this.svc.getQris();
    res.set({ 'Content-Type': q.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    return new StreamableFile(q.data);
  }

  @Roles('ADMIN') @Put('topups/settings')
  save(@CurrentUser() u: AuthUser, @Body() b: SettingsDto) { return this.svc.saveSettings(u, b); }

  @Roles('ADMIN', 'BENDAHARA') @Get('topups')
  async list(@Query('status') status?: string) {
    const { rows } = await this.db.query(
      `SELECT * FROM (
         SELECT t.id, t.amount, t.unique_code AS "uniqueCode", t.fee, t.total, COALESCE(t.credited, COALESCE(t.received_amount, t.total) - t.fee) AS credited, t.received_amount AS "receivedAmount", ${EFFECTIVE} AS status,
                t.matched_ref AS "matchedRef", t.note, t.expires_at AS "expiresAt", t.created_at AS "createdAt", t.decided_at AS "decidedAt",
                s.full_name AS "santriName", s.nis, u.full_name AS "requestedBy",
                (SELECT count(*)::int FROM topup_proofs p WHERE p.topup_id = t.id) AS proofs,
                EXISTS (SELECT 1 FROM topup_proofs p WHERE p.topup_id = t.id AND p.amount_match) AS "proofMatch"
           FROM topup_requests t JOIN santri s ON s.id = t.santri_id JOIN users u ON u.id = t.requested_by
       ) x WHERE ($1::text IS NULL OR x.status = $1) ORDER BY x."createdAt" DESC LIMIT 300`, [status || null]);
    return rows;
  }

  @Roles('ADMIN', 'BENDAHARA') @Get('topups/:id/proofs')
  async proofs(@Param('id', ParseUUIDPipe) id: string) {
    const { rows } = await this.db.query(
      `SELECT id, created_at AS "createdAt", amount_match AS "amountMatch", ocr_amounts AS "ocrAmounts" FROM topup_proofs WHERE topup_id = $1 ORDER BY created_at`, [id]);
    return rows;
  }

  /** Foto bukti hanya bisa dibuka staf berwenang, dan pembukaannya tercatat di audit log. */
  @Roles('ADMIN', 'BENDAHARA') @Get('topups/proofs/:pid/image')
  async image(@CurrentUser() u: AuthUser, @Param('pid', ParseUUIDPipe) pid: string, @Res({ passthrough: true }) res: Response) {
    const r = (await this.db.query('SELECT mime, data, topup_id FROM topup_proofs WHERE id = $1', [pid])).rows[0];
    if (!r) throw appErr(404, 'NOT_FOUND', 'Foto tidak ditemukan');
    await audit(this.db.pool, u.id, 'TOPUP_PROOF_VIEW', 'topup', r.topup_id);
    res.set({ 'Content-Type': r.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    return new StreamableFile(r.data);
  }

  @Roles('BENDAHARA') @Post('topups/match')
  match(@Body() b: MatchDto) { return this.svc.match(b.lines); }

  @Roles('BENDAHARA') @Post('topups/:id/approve')
  approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: NoteDto) { return this.svc.approve(u, id, b.note, b.receivedAmount); }

  @Roles('BENDAHARA') @Post('topups/:id/reject')
  reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: RejectDto) { return this.svc.reject(u, id, b.note); }

  /** Laporan bulanan: dasar tagihan jasa aplikasi ke pesantren. */
  @Roles('ADMIN', 'BENDAHARA') @Get('topups/report')
  async report(@Query('month') month?: string) {
    const m = /^\d{4}-(0[1-9]|1[0-2])$/.test(month ?? '') ? month! : new Date().toISOString().slice(0, 7);
    const r = (await this.db.query(
      `SELECT count(*)::int AS count, COALESCE(SUM(fee),0)::int AS "feeTotal", COALESCE(SUM(COALESCE(credited, amount + unique_code)),0)::int AS "creditedTotal"
         FROM topup_requests
        WHERE status = 'CREDITED'
          AND decided_at >= ((($1 || '-01')::date)::timestamp AT TIME ZONE 'Asia/Jakarta')
          AND decided_at <  ((($1 || '-01')::date + interval '1 month')::timestamp AT TIME ZONE 'Asia/Jakarta')`, [m])).rows[0];
    return { month: m, ...r };
  }
}

/** Sisi wali santri: hanya anak yang terhubung. */
@Controller('portal')
@Roles('WALSAN')
class PortalTopupsController {
  constructor(private svc: TopupsService, private db: Db) {}

  private async assertChild(userId: string, santriId: string) {
    const { rows } = await this.db.query('SELECT 1 FROM santri_walsan WHERE user_id = $1 AND santri_id = $2', [userId, santriId]);
    if (!rows[0]) throw appErr(404, 'CHILD_NOT_FOUND', 'Data anak tidak ditemukan');
  }

  @Get('topup-info')
  info() { return this.svc.settings(); }

  @Get('topup-qris')
  async qris(@Res({ passthrough: true }) res: Response) {
    const q = await this.svc.getQris();
    res.set({ 'Content-Type': q.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    return new StreamableFile(q.data);
  }

  @Post('children/:id/topups')
  async create(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: CreateDto) {
    await this.assertChild(u.id, id);
    return this.svc.create(u, id, b.amount);
  }

  @Get('children/:id/topups')
  async list(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.assertChild(u.id, id);
    const { rows } = await this.db.query(
      `SELECT t.id, t.amount, t.unique_code AS "uniqueCode", t.fee, t.total, COALESCE(t.credited, COALESCE(t.received_amount, t.total) - t.fee) AS credited, t.received_amount AS "receivedAmount", ${EFFECTIVE} AS status,
              t.expires_at AS "expiresAt", t.created_at AS "createdAt",
              (SELECT count(*)::int FROM topup_proofs p WHERE p.topup_id = t.id) AS proofs,
              EXISTS (SELECT 1 FROM topup_proofs p WHERE p.topup_id = t.id AND p.amount_match) AS "proofMatch"
         FROM topup_requests t WHERE t.santri_id = $1 ORDER BY t.created_at DESC LIMIT 30`, [id]);
    return rows;
  }

  @Post('topups/:rid/proof')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 3 * 1024 * 1024, files: 1 } }))
  proof(@CurrentUser() u: AuthUser, @Param('rid', ParseUUIDPipe) rid: string, @UploadedFile() file: { buffer?: Buffer } | undefined, @Body('ocrAmounts') ocr?: string) {
    return this.svc.addProof(u, rid, file, ocr);
  }

  @Post('topups/:rid/cancel')
  async cancel(@CurrentUser() u: AuthUser, @Param('rid', ParseUUIDPipe) rid: string) {
    const { rows } = await this.db.query(
      `UPDATE topup_requests SET status = 'CANCELLED', decided_at = now()
        WHERE id = $1 AND requested_by = $2 AND status = 'PENDING' RETURNING id`, [rid, u.id]);
    if (!rows[0]) throw appErr(409, 'CANNOT_CANCEL', 'Permintaan tidak bisa dibatalkan (sudah dicocokkan, selesai, atau bukan milik Anda)');
    return { ok: true };
  }
}

@Module({ controllers: [TopupsController, PortalTopupsController], providers: [TopupsService], exports: [TopupsService] })
export class TopupsModule {}
