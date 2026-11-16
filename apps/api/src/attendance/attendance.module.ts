import { Body, Controller, Delete, Get, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Db } from '../db/db.service';
import { appErr } from '../common/errors';
import { audit } from '../common/audit';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { clock, jakarta } from '../common/clock';
import { toCsv } from '../common/csv';
import { hashBarcode } from '../cards/card-crypto';

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const EARLY_MINUTES = 10; // guru boleh mulai scan 10 menit sebelum jam mulai
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const HARI = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Ahad'];

class ScheduleDto {
  @IsString() @MinLength(2) @MaxLength(80) subject: string;
  @IsOptional() @IsString() @MaxLength(40) kelas?: string;
  @IsOptional() @IsUUID() teacherId?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @IsInt({ each: true }) @Min(1, { each: true }) @Max(7, { each: true }) days: number[];
  @Matches(TIME, { message: 'Jam mulai format HH:MM, contoh 07:30' }) startTime: string;
  @Matches(TIME, { message: 'Jam selesai format HH:MM, contoh 08:30' }) endTime: string;
}
class ScheduleEditDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(80) subject?: string;
  @IsOptional() @IsString() @MaxLength(40) kelas?: string;      // string kosong = semua kelas
  @IsOptional() @Matches(/^$|^[0-9a-fA-F-]{36}$/, { message: 'Akun guru tidak valid' }) teacherId?: string; // string kosong = semua akun Guru
  @IsOptional() @IsInt() @Min(1) @Max(7) dayOfWeek?: number;
  @IsOptional() @Matches(TIME, { message: 'Jam mulai format HH:MM' }) startTime?: string;
  @IsOptional() @Matches(TIME, { message: 'Jam selesai format HH:MM' }) endTime?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class ScanDto {
  @IsUUID() scheduleId: string;
  @IsString() @MinLength(8) barcode: string;
  @IsString() @MinLength(2, { message: 'Isi nama guru yang sedang memakai akun' }) @MaxLength(60) operatorName: string;
}
class SettingsDto { @IsInt() @Min(0) @Max(120) lateMinutes: number }

const SCHEDULE_COLS = `sc.id, sc.subject, sc.kelas, sc.teacher_id AS "teacherId", u.full_name AS "teacherName", sc.day_of_week AS "dayOfWeek",
  to_char(sc.start_time, 'HH24:MI') AS "startTime", to_char(sc.end_time, 'HH24:MI') AS "endTime", sc.is_active AS "isActive"`;

@Controller('attendance')
class AttendanceController {
  constructor(private db: Db) {}

  private async lateMinutes() {
    const v = (await this.db.query(`SELECT value FROM app_settings WHERE key = 'attendance_late_minutes'`)).rows[0]?.value;
    const n = Number(v); return Number.isFinite(n) ? n : 10;
  }

  /** Guru hanya boleh memakai jadwal miliknya atau jadwal yang belum ditentukan gurunya. */
  private async mySchedule(u: AuthUser, id: string) {
    const sc = (await this.db.query(`SELECT ${SCHEDULE_COLS} FROM class_schedules sc LEFT JOIN users u ON u.id = sc.teacher_id WHERE sc.id = $1`, [id])).rows[0];
    if (!sc) throw appErr(404, 'SCHEDULE_NOT_FOUND', 'Jadwal tidak ditemukan');
    if (u.role === 'GURU' && sc.teacherId && sc.teacherId !== u.id) throw appErr(403, 'NOT_YOUR_SCHEDULE', 'Jadwal ini bukan untuk akun Anda');
    return sc;
  }

  // ---------- Admin: jadwal ----------
  @Roles('ADMIN') @Get('schedules')
  async schedules() {
    return (await this.db.query(`SELECT ${SCHEDULE_COLS} FROM class_schedules sc LEFT JOIN users u ON u.id = sc.teacher_id
                                  ORDER BY sc.day_of_week, sc.start_time, sc.subject`)).rows;
  }

  @Roles('ADMIN') @Get('teachers')
  async teachers() {
    return (await this.db.query(`SELECT id, full_name AS "fullName", username FROM users WHERE role = 'GURU' AND is_active ORDER BY full_name`)).rows;
  }

  @Roles('ADMIN') @Post('schedules')
  async create(@CurrentUser() u: AuthUser, @Body() b: ScheduleDto) {
    if (toMin(b.endTime) <= toMin(b.startTime)) throw appErr(400, 'BAD_TIME', 'Jam selesai harus lebih besar dari jam mulai');
    const days = [...new Set(b.days)];
    if (b.teacherId) {
      const t = (await this.db.query(`SELECT 1 FROM users WHERE id = $1 AND role = 'GURU' AND is_active`, [b.teacherId])).rows[0];
      if (!t) throw appErr(404, 'TEACHER_NOT_FOUND', 'Akun guru tidak ditemukan');
    }
    const ids = await this.db.tx(async (c) => {
      const out: string[] = [];
      for (const d of days) {
        const r = await c.query(
          `INSERT INTO class_schedules(subject, kelas, teacher_id, day_of_week, start_time, end_time) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [b.subject.trim(), b.kelas?.trim() || null, b.teacherId ?? null, d, b.startTime, b.endTime]);
        out.push(r.rows[0].id);
      }
      await audit(c, u.id, 'SCHEDULE_CREATE', 'schedule', out[0], { subject: b.subject, days, start: b.startTime, end: b.endTime });
      return out;
    });
    return { created: ids.length, ids };
  }

  @Roles('ADMIN') @Patch('schedules/:id')
  async edit(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: ScheduleEditDto) {
    const cur = (await this.db.query(`SELECT to_char(start_time,'HH24:MI') AS s, to_char(end_time,'HH24:MI') AS e FROM class_schedules WHERE id = $1`, [id])).rows[0];
    if (!cur) throw appErr(404, 'SCHEDULE_NOT_FOUND', 'Jadwal tidak ditemukan');
    const s = b.startTime ?? cur.s; const e = b.endTime ?? cur.e;
    if (toMin(e) <= toMin(s)) throw appErr(400, 'BAD_TIME', 'Jam selesai harus lebih besar dari jam mulai');
    if (b.teacherId) {
      const t = (await this.db.query(`SELECT 1 FROM users WHERE id = $1 AND role = 'GURU' AND is_active`, [b.teacherId])).rows[0];
      if (!t) throw appErr(404, 'TEACHER_NOT_FOUND', 'Akun guru tidak ditemukan');
    }
    await this.db.query(
      `UPDATE class_schedules SET subject = COALESCE($2, subject),
              kelas = CASE WHEN $3::text IS NULL THEN kelas ELSE NULLIF($3, '') END,
              teacher_id = CASE WHEN $4::text IS NULL THEN teacher_id ELSE NULLIF($4, '')::uuid END,
              day_of_week = COALESCE($5, day_of_week), start_time = $6::time, end_time = $7::time, is_active = COALESCE($8, is_active)
        WHERE id = $1`,
      [id, b.subject?.trim() ?? null, b.kelas?.trim() ?? null, b.teacherId ?? null, b.dayOfWeek ?? null, s, e, b.isActive ?? null]);
    await audit(this.db.pool, u.id, 'SCHEDULE_UPDATE', 'schedule', id, b);
    return { ok: true };
  }

  @Roles('ADMIN') @Get('settings')
  async getSettings() { return { lateMinutes: await this.lateMinutes(), earlyMinutes: EARLY_MINUTES }; }

  @Roles('ADMIN') @Put('settings')
  async putSettings(@CurrentUser() u: AuthUser, @Body() b: SettingsDto) {
    await this.db.query(`INSERT INTO app_settings(key, value) VALUES ('attendance_late_minutes', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [String(b.lateMinutes)]);
    await audit(this.db.pool, u.id, 'ATTENDANCE_SETTINGS', 'settings', undefined, b);
    return { ok: true, lateMinutes: b.lateMinutes };
  }

  // ---------- Admin: laporan ----------
  private async reportRows(from?: string, to?: string, scheduleId?: string, kelas?: string) {
    const d = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const today = jakarta().date;
    return (await this.db.query(
      `SELECT to_char(a.day, 'YYYY-MM-DD') AS day, to_char(a.scanned_at AT TIME ZONE 'Asia/Jakarta', 'HH24:MI') AS time, sc.subject, sc.kelas AS "scheduleKelas",
              to_char(sc.start_time,'HH24:MI') || '-' || to_char(sc.end_time,'HH24:MI') AS hours,
              s.nis, s.full_name AS "santriName", s.kelas, a.status, a.operator_name AS "operatorName", u.full_name AS "accountName"
         FROM attendance a JOIN class_schedules sc ON sc.id = a.schedule_id JOIN santri s ON s.id = a.santri_id LEFT JOIN users u ON u.id = a.recorded_by
        WHERE a.day BETWEEN COALESCE($1::date, $4::date) AND COALESCE($2::date, $4::date)
          AND ($3::uuid IS NULL OR a.schedule_id = $3) AND ($5::text IS NULL OR s.kelas = $5)
        ORDER BY a.day DESC, sc.start_time, sc.subject, s.full_name LIMIT 2000`,
      [d(from), d(to), scheduleId || null, today, kelas || null])).rows;
  }
  @Roles('ADMIN') @Get('report')
  report(@Query('from') from?: string, @Query('to') to?: string, @Query('scheduleId') scheduleId?: string, @Query('kelas') kelas?: string) { return this.reportRows(from, to, scheduleId, kelas); }

  @Roles('ADMIN') @Get('report.csv')
  async reportCsv(@Res({ passthrough: true }) res: Response, @Query('from') from?: string, @Query('to') to?: string, @Query('scheduleId') scheduleId?: string, @Query('kelas') kelas?: string) {
    const r = await this.reportRows(from, to, scheduleId, kelas);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="absen.csv"', 'Cache-Control': 'no-store' });
    return new StreamableFile(Buffer.from(toCsv(['Tanggal', 'Jam scan', 'Pelajaran', 'Jam pelajaran', 'NIS', 'Nama santri', 'Kelas', 'Status', 'Dicatat oleh', 'Akun'],
      r.map((x) => [x.day, x.time, x.subject, x.hours, x.nis, x.santriName, x.kelas ?? '', x.status === 'TERLAMBAT' ? 'Terlambat' : 'Hadir', x.operatorName, x.accountName ?? ''])), 'utf8'));
  }

  // ---------- Guru ----------
  /** Jadwal hari ini milik akun ini, lengkap dengan keadaannya sekarang. */
  @Roles('GURU') @Get('my-today')
  async myToday(@CurrentUser() u: AuthUser) {
    const j = jakarta();
    const rows = (await this.db.query(
      `SELECT ${SCHEDULE_COLS}, (SELECT count(*)::int FROM attendance a WHERE a.schedule_id = sc.id AND a.day = $2::date) AS present
         FROM class_schedules sc LEFT JOIN users u ON u.id = sc.teacher_id
        WHERE sc.is_active AND sc.day_of_week = $1 AND (sc.teacher_id IS NULL OR sc.teacher_id = $3) ORDER BY sc.start_time, sc.subject`, [j.isoDow, j.date, u.id])).rows;
    return {
      date: j.date, dayName: HARI[j.isoDow],
      items: rows.map((r) => {
        const s = toMin(r.startTime); const e = toMin(r.endTime);
        const state = j.minutes > e ? 'DONE' : j.minutes >= s - EARLY_MINUTES ? 'NOW' : 'LATER';
        return { ...r, state };
      }),
    };
  }

  /** Nama-nama yang pernah dipakai di akun ini (untuk dipilih cepat saat mulai sesi). */
  @Roles('GURU') @Get('operators')
  async operators(@CurrentUser() u: AuthUser) {
    return (await this.db.query(`SELECT operator_name AS name FROM attendance WHERE recorded_by = $1 GROUP BY operator_name ORDER BY max(scanned_at) DESC LIMIT 12`, [u.id])).rows.map((r) => r.name as string);
  }

  /** Sudah hadir dan (bila jadwal punya kelas) yang belum hadir, untuk hari ini. */
  @Roles('GURU') @Get('schedules/:id/today')
  async today(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const sc = await this.mySchedule(u, id);
    const day = jakarta().date;
    const present = (await this.db.query(
      `SELECT a.id, to_char(a.scanned_at AT TIME ZONE 'Asia/Jakarta', 'HH24:MI') AS time, a.status, a.operator_name AS "operatorName", s.full_name AS "santriName", s.nis, s.kelas
         FROM attendance a JOIN santri s ON s.id = a.santri_id WHERE a.schedule_id = $1 AND a.day = $2::date ORDER BY a.scanned_at DESC`, [id, day])).rows;
    const absent = sc.kelas
      ? (await this.db.query(
        `SELECT s.id, s.full_name AS "santriName", s.nis FROM santri s WHERE s.status = 'ACTIVE' AND s.kelas = $1
            AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.schedule_id = $2 AND a.santri_id = s.id AND a.day = $3::date) ORDER BY s.full_name`, [sc.kelas, id, day])).rows
      : null;
    return { schedule: sc, present, absent };
  }

  @Roles('GURU') @Throttle({ default: { limit: Number(process.env.POS_RATE_LIMIT ?? 600), ttl: 60_000 } }) @Post('scan')
  async scan(@CurrentUser() u: AuthUser, @Body() b: ScanDto) {
    const sc = await this.mySchedule(u, b.scheduleId);
    const now = clock.now(); const j = jakarta(now);
    if (!sc.isActive) throw appErr(409, 'SCHEDULE_INACTIVE', 'Jadwal ini sedang tidak dipakai');
    if (sc.dayOfWeek !== j.isoDow) throw appErr(409, 'WRONG_DAY', `Jadwal ini hari ${HARI[sc.dayOfWeek]}, bukan hari ini`);
    const start = toMin(sc.startTime); const end = toMin(sc.endTime);
    if (j.minutes < start - EARLY_MINUTES) throw appErr(409, 'NOT_STARTED', `Pelajaran belum dimulai (mulai ${sc.startTime})`);
    if (j.minutes > end) throw appErr(409, 'ALREADY_ENDED', `Pelajaran sudah selesai (selesai ${sc.endTime})`);

    const card = (await this.db.query(
      `SELECT c.status AS card_status, s.id AS santri_id, s.full_name, s.nis, s.kelas, s.status AS santri_status
         FROM cards c JOIN santri s ON s.id = c.santri_id WHERE c.barcode_hash = $1`, [hashBarcode(b.barcode)])).rows[0];
    if (!card) throw appErr(404, 'CARD_UNKNOWN', 'Kartu tidak dikenali');
    if (['REPLACED', 'REVOKED'].includes(card.card_status)) throw appErr(403, `CARD_${card.card_status}`, 'Kartu ini sudah tidak berlaku');
    if (card.santri_status !== 'ACTIVE') throw appErr(403, 'SANTRI_INACTIVE', 'Santri tidak aktif');
    if (sc.kelas && card.kelas !== sc.kelas) throw appErr(409, 'WRONG_CLASS', `${card.full_name} bukan santri kelas ${sc.kelas}`);

    const late = j.minutes > start + (await this.lateMinutes());
    const ins = await this.db.query(
      `INSERT INTO attendance(schedule_id, santri_id, day, scanned_at, status, recorded_by, operator_name) VALUES ($1,$2,$3::date,$4,$5,$6,$7)
       ON CONFLICT (schedule_id, santri_id, day) DO NOTHING RETURNING id, status, to_char(scanned_at AT TIME ZONE 'Asia/Jakarta', 'HH24:MI') AS time`,
      [sc.id, card.santri_id, j.date, now, late ? 'TERLAMBAT' : 'HADIR', u.id, b.operatorName.trim()]);
    if (!ins.rows[0]) {
      const old = (await this.db.query(`SELECT status, to_char(scanned_at AT TIME ZONE 'Asia/Jakarta', 'HH24:MI') AS time FROM attendance WHERE schedule_id = $1 AND santri_id = $2 AND day = $3::date`, [sc.id, card.santri_id, j.date])).rows[0];
      return { duplicate: true, santriName: card.full_name, nis: card.nis, kelas: card.kelas, status: old.status, time: old.time };
    }
    return { duplicate: false, id: ins.rows[0].id, santriName: card.full_name, nis: card.nis, kelas: card.kelas, status: ins.rows[0].status, time: ins.rows[0].time };
  }

  /** Salah scan: hapus catatan absen hari ini (tercatat di audit log). */
  @Roles('GURU') @Delete(':id')
  async remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const a = (await this.db.query(`SELECT a.id, a.schedule_id, a.santri_id, to_char(a.day,'YYYY-MM-DD') AS day, a.operator_name FROM attendance a WHERE a.id = $1`, [id])).rows[0];
    if (!a) throw appErr(404, 'NOT_FOUND', 'Catatan absen tidak ditemukan');
    await this.mySchedule(u, a.schedule_id);
    if (a.day !== jakarta().date) throw appErr(409, 'NOT_TODAY', 'Hanya absen hari ini yang bisa dibatalkan');
    await this.db.query('DELETE FROM attendance WHERE id = $1', [id]);
    await audit(this.db.pool, u.id, 'ATTENDANCE_REMOVE', 'attendance', id, { scheduleId: a.schedule_id, santriId: a.santri_id, operator: a.operator_name });
    return { ok: true };
  }
}

@Module({ controllers: [AttendanceController] })
export class AttendanceModule {}
