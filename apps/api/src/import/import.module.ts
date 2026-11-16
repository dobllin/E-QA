import { Body, Controller, Module, Post } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { PoolClient } from 'pg';
import { Db } from '../db/db.service';
import { audit } from '../common/audit';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { appErr } from '../common/errors';
import { NUMBER_SQL } from '../billing/billing.module';
import { ParsedRow, parseSheet } from './sheet-parser';

class ImportDto {
  @IsString() @MaxLength(1_500_000) text: string;
  @IsInt() @Min(2000) @Max(2100) startYear: number;                                   // tahun mulai tahun ajaran (Juli) — mis. 2026 untuk 2026/2027
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Jatuh tempo biaya awal format YYYY-MM-DD' }) entryDue: string;
}
class CommitDto extends ImportDto { @IsOptional() @IsBoolean() confirm?: boolean }

type Q = Pick<PoolClient, 'query'>;
const key = (n: string) => n.toLowerCase().replace(/\s+/g, ' ').trim();
const nisOf = (n: number) => String(n).padStart(2, '0');
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

interface PlannedRow extends ParsedRow { isNew: boolean; nis: string; santriId: string | null; invoices: (ParsedRow['invoices'][number] & { exists: boolean })[] }

/** Cocokkan baris dengan data yang sudah ada (nama sama = santri yang sama) dan tentukan nomor urut untuk santri baru. */
async function plan(q: Q, rows: ParsedRow[]): Promise<PlannedRow[]> {
  const names = rows.map((r) => key(r.name));
  const existing = (await q.query(`SELECT id, nis, lower(regexp_replace(btrim(full_name), '\\s+', ' ', 'g')) AS k FROM santri WHERE lower(regexp_replace(btrim(full_name), '\\s+', ' ', 'g')) = ANY($1)`, [names])).rows as { id: string; nis: string; k: string }[];
  const byName = new Map<string, { id: string; nis: string }[]>();
  for (const e of existing) byName.set(e.k, [...(byName.get(e.k) ?? []), e]);
  const seen = new Map<string, number>();
  const dupInSheet = new Set<string>(); for (const r of rows) { const k = key(r.name); if (seen.has(k)) { dupInSheet.add(k); } seen.set(k, r.line); }
  let next = ((await q.query(`SELECT COALESCE(MAX(CASE WHEN nis ~ '^[0-9]{1,4}$' THEN nis::int END), 0)::int AS m FROM santri`)).rows[0].m as number) + 1;
  const ids = existing.map((e) => e.id);
  const have = new Set<string>(ids.length ? (await q.query(`SELECT santri_id || '|' || period || '|' || title AS k FROM invoices WHERE santri_id = ANY($1)`, [ids])).rows.map((x: any) => x.k) : []);
  return rows.map((r) => {
    const k = key(r.name); const ex = byName.get(k) ?? [];
    const errors = [...r.errors];
    if (dupInSheet.has(k)) errors.push('Nama kembar di data yang ditempel. Bedakan namanya (mis. tambah inisial) supaya tidak tertukar');
    if (ex.length > 1) errors.push('Sudah ada lebih dari satu santri dengan nama ini di data. Rapikan dulu di halaman Santri');
    const isNew = ex.length === 0;
    const nis = isNew ? (errors.length ? '' : nisOf(next++)) : ex[0].nis;
    const santriId = ex.length === 1 ? ex[0].id : null;
    return { ...r, errors, isNew, nis, santriId, invoices: r.invoices.map((i) => ({ ...i, exists: !!santriId && have.has(`${santriId}|${i.period}|${i.title}`) })) };
  });
}

@Controller('import')
@Roles('ADMIN')
class ImportController {
  constructor(private db: Db) {}

  private parse(b: ImportDto) {
    const p = parseSheet(b.text, { startYear: b.startYear, entryDue: b.entryDue });
    if (!p.ok) throw appErr(422, 'IMPORT_PARSE', p.error ?? 'Data tidak bisa dibaca');
    return p;
  }

  private summary(rows: PlannedRow[]) {
    const good = rows.filter((r) => !r.errors.length);
    const inv = good.flatMap((r) => r.invoices);
    const newInv = inv.filter((i) => !i.exists);
    return {
      rows: rows.length, rowsOk: good.length, rowsError: rows.length - good.length,
      santriNew: good.filter((r) => r.isNew).length, santriExisting: good.filter((r) => !r.isNew).length,
      invoicesNew: newInv.length, invoicesExisting: inv.length - newInv.length, amountNew: newInv.reduce((a, i) => a + i.amount, 0),
      overdueNew: newInv.filter((i) => i.dueDate < today()).length, overdueAmountNew: newInv.filter((i) => i.dueDate < today()).reduce((a, i) => a + i.amount, 0),
    };
  }

  /** Pratinjau: membaca dan memeriksa data tanpa mengubah apa pun. */
  @Post('preview')
  async preview(@Body() b: ImportDto) {
    const p = this.parse(b);
    const rows = await plan(this.db.pool, p.rows);
    return { columns: p.columns, sections: p.sections, ignoredLines: p.ignoredLines, rows, summary: this.summary(rows) };
  }

  /** Impor sungguhan. Hanya baris tanpa masalah yang masuk; aman diulang (santri dan tagihan yang sudah ada dilewati). */
  @Post('commit')
  async commit(@CurrentUser() u: AuthUser, @Body() b: CommitDto) {
    if (!b.confirm) throw appErr(400, 'CONFIRM_REQUIRED', 'Centang konfirmasi bahwa Anda sudah memeriksa pratinjau');
    const p = this.parse(b);
    return this.db.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(70011)');            // dua impor tidak boleh berjalan bersamaan (nomor urut)
      const rows = await plan(c, p.rows);
      const good = rows.filter((r) => !r.errors.length);
      let santriCreated = 0, invoicesCreated = 0, invoicesExisting = 0, overdue = 0;
      for (const r of good) {
        let id = r.santriId;
        if (!id) {
          id = (await c.query('INSERT INTO santri(nis, full_name, kelas, status_label, bagian, catatan) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
            [r.nis, r.name, r.kelas, r.statusLabel, r.bagian, r.catatan])).rows[0].id;
          await c.query(`INSERT INTO wallets(santri_id, pocket) SELECT $1, unnest(ARRAY['SALDO','JAJAN','LAUNDRY'])`, [id]);
          santriCreated++;
        } else {
          await c.query('UPDATE santri SET status_label = COALESCE(status_label, $2), bagian = COALESCE(bagian, $3), catatan = COALESCE(catatan, $4) WHERE id = $1', [id, r.statusLabel, r.bagian, r.catatan]);
        }
        for (const i of r.invoices) {
          const ins = await c.query(
            `INSERT INTO invoices(number, santri_id, period, title, due_date, total) VALUES (${NUMBER_SQL}, $1, $2, $3, $4::date, $5)
             ON CONFLICT (santri_id, period, title) DO NOTHING RETURNING id`, [id, i.period, i.title, i.dueDate, i.amount]);
          if (ins.rowCount) { invoicesCreated++; if (i.dueDate < today()) overdue++; } else invoicesExisting++;
        }
      }
      const skipped = rows.filter((r) => r.errors.length).map((r) => ({ line: r.line, name: r.name, errors: r.errors }));
      const result = { santriCreated, santriExisting: good.length - santriCreated, invoicesCreated, invoicesExisting, overdueCreated: overdue, skipped };
      await audit(c, u.id, 'IMPORT_SANTRI_TAGIHAN', 'santri', undefined, { ...result, skipped: skipped.length, startYear: b.startYear, entryDue: b.entryDue });
      return result;
    });
  }
}

@Module({ controllers: [ImportController] })
export class ImportModule {}
