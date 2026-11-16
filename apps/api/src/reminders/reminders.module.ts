import { Body, Controller, Get, Module, Post, Put } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Db } from '../db/db.service';
import { appErr } from '../common/errors';
import { audit } from '../common/audit';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { rp } from '../common/notify';
import { normalizePhone } from '../common/phone';
import { notifyStaff } from '../common/notify';
import { REMIND_DAYS_SQL, REMIND_STATE_SQL } from '../billing/billing.module';

export const DEFAULT_WA_TEMPLATE =
  'Assalamu\'alaikum {nama_wali}. Kami dari {pesantren} mengingatkan bahwa ada tagihan {nama_santri} yang belum lunas: {tagihan}. Total sisa {sisa}. Mohon dibayarkan secepatnya. Terima kasih.';

class TemplateDto { @IsString() @MinLength(10, { message: 'Pesan terlalu pendek' }) @MaxLength(1000) template: string }
class PrepareDto {
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @IsUUID('all', { each: true }) santriIds?: string[];
  @IsOptional() @IsBoolean() onlyDue?: boolean;   // hanya santri yang perlu diingatkan (belum pernah, atau sudah lewat batas hari pengingat ulang)
}
class SettingsDto { @IsInt() @Min(0, { message: 'Isi 0 sampai 60 hari' }) @Max(60, { message: 'Isi 0 sampai 60 hari' }) repeatDays: number }
class MarkDto {
  @IsUUID() santriId: string;
  @IsArray() @ArrayMaxSize(100) @IsUUID('all', { each: true }) invoiceIds: string[];
}

/** Isi template: {nama_wali} {nama_santri} {tagihan} {sisa} {jatuh_tempo} {pesantren}. Penanda yang tidak dikenal dibiarkan apa adanya. */
export function renderTemplate(tpl: string, v: Record<string, string>) {
  return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
}
const dmy = (iso: string) => iso.split('-').reverse().join('/');

@Controller('reminders')
@Roles('ADMIN', 'BENDAHARA')
class RemindersController {
  constructor(private db: Db) {}

  private async setting(key: string) { return (await this.db.query('SELECT value FROM app_settings WHERE key = $1', [key])).rows[0]?.value as string | undefined; }

  @Get('template')
  async getTemplate() { return { template: (await this.setting('wa_template')) || DEFAULT_WA_TEMPLATE, defaultTemplate: DEFAULT_WA_TEMPLATE }; }

  @Put('template')
  async putTemplate(@CurrentUser() u: AuthUser, @Body() b: TemplateDto) {
    await this.db.query(`INSERT INTO app_settings(key, value) VALUES ('wa_template', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [b.template.trim()]);
    await audit(this.db.pool, u.id, 'SETTINGS_WA_TEMPLATE', 'settings');
    return { ok: true };
  }

  @Get('settings')
  async getSettings() { return { repeatDays: Number((await this.setting('reminder_repeat_days')) ?? 3) }; }

  /** Ingatkan lagi setelah N hari bila masih belum lunas. 0 = tidak mengingatkan ulang. */
  @Put('settings')
  async putSettings(@CurrentUser() u: AuthUser, @Body() b: SettingsDto) {
    await this.db.query(`INSERT INTO app_settings(key, value) VALUES ('reminder_repeat_days', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [String(b.repeatDays)]);
    await audit(this.db.pool, u.id, 'SETTINGS_REMINDER_REPEAT', 'settings', undefined, b);
    return { ok: true, repeatDays: b.repeatDays };
  }

  /**
   * Ringkasan untuk titik merah di menu samping. Sekaligus "pemeriksa" yang malas (tanpa jadwal harian): bila ada tagihan yang sudah diingatkan tetapi
   * lewat batas hari dan masih belum lunas, pengurus diberi pemberitahuan SEKALI per putaran. Hanya berjalan saat ada pengurus yang membuka aplikasi.
   */
  @Get('summary')
  async summary() {
    const days = Number((await this.setting('reminder_repeat_days')) ?? 3);
    const claimed = await this.db.tx(async (c) => {
      const r = await c.query(
        `UPDATE invoices i SET alert_sent_at = now()
          WHERE ${REMIND_STATE_SQL} = 'AGAIN' AND (i.alert_sent_at IS NULL OR i.alert_sent_at < i.last_reminded_at)
          RETURNING i.santri_id`);
      const n = new Set(r.rows.map((x) => x.santri_id)).size;
      if (n > 0) await notifyStaff(c, 'Perlu diingatkan lagi', `${n} wali belum membayar tunggakan setelah ${days} hari diingatkan. Buka Tagihan untuk mengingatkan lagi.`, '/tagihan', 'INFO');
      return n;
    });
    const row = (await this.db.query(
      `SELECT count(DISTINCT i.santri_id) FILTER (WHERE st IN ('NEVER','AGAIN'))::int AS "needSantri",
              count(*) FILTER (WHERE st IN ('NEVER','AGAIN'))::int AS "needInvoices",
              count(DISTINCT i.santri_id) FILTER (WHERE st IS NOT NULL)::int AS "overdueSantri"
         FROM (SELECT i.santri_id, ${REMIND_STATE_SQL} AS st FROM invoices i) i`)).rows[0];
    return { ...row, repeatDays: days, alertedNow: claimed };
  }

  /**
   * Siapkan pesan WhatsApp untuk santri yang menunggak (satu pesan per santri, merangkum semua tunggakannya).
   * Tanpa `santriIds` = semua santri yang menunggak. Tidak mengubah apa pun; penandaan "sudah diingatkan" lewat /reminders/mark.
   */
  @Post('prepare')
  async prepare(@Body() b: PrepareDto) {
    const rows = (await this.db.query(
      `SELECT i.id, i.title, i.period, to_char(i.due_date, 'YYYY-MM-DD') AS due, (i.total - i.paid)::int AS remaining, i.last_reminded_at AS "lastRemindedAt", ${REMIND_STATE_SQL} AS "remindState",
              s.id AS "santriId", s.full_name AS "santriName", s.nis, s.kelas
         FROM invoices i JOIN santri s ON s.id = i.santri_id
        WHERE i.status IN ('UNPAID','PARTIAL') AND i.due_date < (now() AT TIME ZONE 'Asia/Jakarta')::date
          AND ($1::uuid[] IS NULL OR s.id = ANY($1::uuid[]))
        ORDER BY s.kelas NULLS LAST, s.full_name, i.due_date`, [b.santriIds?.length ? b.santriIds : null])).rows;
    const bySantri = new Map<string, typeof rows>();
    for (const r of rows) bySantri.set(r.santriId, [...(bySantri.get(r.santriId) ?? []), r]);
    const ids = [...bySantri.keys()];
    const walis = ids.length ? (await this.db.query(
      // Utamakan wali yang punya nomor HP.
      `SELECT DISTINCT ON (sw.santri_id) sw.santri_id AS "santriId", u.full_name AS "fullName", u.phone
         FROM santri_walsan sw JOIN users u ON u.id = sw.user_id AND u.is_active
        WHERE sw.santri_id = ANY($1::uuid[]) ORDER BY sw.santri_id, (u.phone IS NULL OR u.phone = ''), u.created_at`, [ids])).rows : [];
    const wali = new Map(walis.map((w) => [w.santriId, w]));
    const tpl = (await this.setting('wa_template')) || DEFAULT_WA_TEMPLATE;
    const school = (await this.setting('school_name')) || 'pesantren';

    const items = [];
    for (const [santriId, list] of bySantri) {
      const needs = list.some((x) => x.remindState === 'NEVER' || x.remindState === 'AGAIN');
      if (b.onlyDue && !needs) continue;
      const w = wali.get(santriId);
      const phone = normalizePhone(w?.phone);
      const total = list.reduce((s, x) => s + x.remaining, 0);
      const message = renderTemplate(tpl, {
        nama_wali: w?.fullName ?? 'Bapak/Ibu', nama_santri: list[0].santriName, pesantren: school,
        tagihan: list.map((x) => `${x.title} ${x.period} (${rp(x.remaining)})`).join(', '), sisa: rp(total), jatuh_tempo: dmy(list[0].due),
      });
      const last = list.map((x) => x.lastRemindedAt as Date | null).filter(Boolean).sort((a, b2) => +b2! - +a!)[0] ?? null;
      items.push({
        santriId, santriName: list[0].santriName, nis: list[0].nis, kelas: list[0].kelas, waliName: w?.fullName ?? null,
        phone, hasPhone: !!phone, invoiceIds: list.map((x) => x.id), total, message,
        waUrl: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : null,
        reminded: list.every((x) => !!x.lastRemindedAt), needsReminder: needs, lastRemindedAt: last,
      });
    }
    return { items, withoutPhone: items.filter((x) => !x.hasPhone).length };
  }

  /** Dipanggil saat tombol WhatsApp ditekan: menandai tagihan sudah diingatkan (titik merah hilang). Sistem tidak bisa tahu apakah pesan benar-benar terkirim. */
  @Post('mark')
  async mark(@CurrentUser() u: AuthUser, @Body() b: MarkDto) {
    return this.db.tx(async (c) => {
      const upd = await c.query(
        `UPDATE invoices SET last_reminded_at = now() WHERE santri_id = $1 AND id = ANY($2::uuid[]) AND status IN ('UNPAID','PARTIAL') RETURNING id, (total - paid)::int AS remaining`,
        [b.santriId, b.invoiceIds]);
      if (!upd.rows.length) throw appErr(404, 'NOTHING_TO_MARK', 'Tidak ada tagihan yang bisa ditandai');
      const total = upd.rows.reduce((s, r) => s + r.remaining, 0);
      await c.query('INSERT INTO reminder_log(santri_id, invoice_ids, total, sent_by) VALUES ($1,$2,$3,$4)', [b.santriId, upd.rows.map((r) => r.id), total, u.id]);
      await audit(c, u.id, 'ARREARS_REMINDER', 'santri', b.santriId, { invoices: upd.rows.length, total });
      return { ok: true, marked: upd.rows.length };
    });
  }
}

@Module({ controllers: [RemindersController] })
export class RemindersModule {}
