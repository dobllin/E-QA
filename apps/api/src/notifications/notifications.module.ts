import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn } from 'class-validator';
import { Db } from '../db/db.service';
import { AuthUser, CurrentUser, Roles } from '../common/auth';
import { PAY_TYPES, PAY_TYPE_KEYS } from '../common/notify';

class PrefsDto {
  @IsArray() @ArrayMaxSize(20) @ArrayUnique() @IsIn(PAY_TYPE_KEYS, { each: true }) muted!: string[];
}

/** Pemberitahuan dalam aplikasi: tiap pengguna hanya melihat miliknya sendiri. */
@Controller('notifications')
class NotificationsController {
  constructor(private db: Db) {}

  @Get() async list(@CurrentUser() u: AuthUser) {
    const items = (await this.db.query(
      `SELECT id, title, body, link, kind, read_at AS "readAt", created_at AS "createdAt" FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`, [u.id])).rows;
    const unread = (await this.db.query('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [u.id])).rows[0].n;
    return { unread, items };
  }
  /** Pengurus memilih jenis pembayaran yang ingin diberi notifikasi (standar: semua menyala). */
  @Get('prefs') @Roles('ADMIN', 'BENDAHARA')
  async prefs(@CurrentUser() u: AuthUser) {
    const muted: string[] = (await this.db.query('SELECT muted FROM notification_prefs WHERE user_id = $1', [u.id])).rows[0]?.muted ?? [];
    return { types: PAY_TYPES.map((t) => ({ key: t.key, label: t.label, hint: t.hint, enabled: !muted.includes(t.key) })) };
  }
  @Put('prefs') @Roles('ADMIN', 'BENDAHARA')
  async setPrefs(@CurrentUser() u: AuthUser, @Body() b: PrefsDto) {
    await this.db.query(
      `INSERT INTO notification_prefs(user_id, muted) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET muted = EXCLUDED.muted, updated_at = now()`, [u.id, b.muted]);
    return this.prefs(u);
  }
  @Post('read-all') async readAll(@CurrentUser() u: AuthUser) {
    await this.db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [u.id]);
    return { ok: true };
  }
  @Post(':id/read') async read(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.db.query('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2', [id, u.id]);
    return { ok: true };
  }
}

@Module({ controllers: [NotificationsController] })
export class NotificationsModule {}
