import { Body, Controller, Delete, Get, Module, Put, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Db } from '../db/db.service';
import { appErr } from '../common/errors';
import { audit } from '../common/audit';
import { AuthUser, CurrentUser, Public, Roles } from '../common/auth';

function sniff(b: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}
class NameDto { @IsString() @MinLength(2) @MaxLength(80) name: string }

/** Identitas pesantren (nama + logo). Bagian baca bersifat publik (dipakai halaman login dan kartu); mengubah hanya Admin. */
@Controller()
class SchoolController {
  constructor(private db: Db) {}

  private async get(key: string) { return (await this.db.query('SELECT value FROM app_settings WHERE key = $1', [key])).rows[0]?.value as string | undefined; }

  @Public() @Get('public/school')
  async info() { return { name: (await this.get('school_name')) ?? '', hasLogo: !!(await this.get('school_logo')) }; }

  @Public() @Get('public/school/logo')
  async logo(@Res({ passthrough: true }) res: Response) {
    const v = await this.get('school_logo');
    if (!v) throw appErr(404, 'NO_LOGO', 'Logo belum diunggah');
    const i = v.indexOf(';');
    res.set({ 'Content-Type': v.slice(0, i), 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin' });
    return new StreamableFile(Buffer.from(v.slice(i + 1), 'base64'));
  }

  @Roles('ADMIN') @Put('settings/school')
  async setName(@CurrentUser() u: AuthUser, @Body() b: NameDto) {
    await this.db.query(`INSERT INTO app_settings(key, value) VALUES ('school_name', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [b.name.trim()]);
    await audit(this.db.pool, u.id, 'SETTINGS_SCHOOL_NAME', 'settings', undefined, { name: b.name.trim() });
    return { ok: true, name: b.name.trim() };
  }

  @Roles('ADMIN') @Put('settings/school/logo')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1024 * 1024, files: 1 } }))
  async setLogo(@CurrentUser() u: AuthUser, @UploadedFile() file: { buffer?: Buffer } | undefined) {
    if (!file?.buffer?.length) throw appErr(400, 'NO_FILE', 'Pilih gambar logo terlebih dahulu');
    const mime = sniff(file.buffer);
    if (!mime) throw appErr(400, 'BAD_FILE', 'Logo harus berupa gambar JPG, PNG, atau WebP');
    await this.db.query(`INSERT INTO app_settings(key, value) VALUES ('school_logo', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [`${mime};${file.buffer.toString('base64')}`]);
    await audit(this.db.pool, u.id, 'SETTINGS_SCHOOL_LOGO', 'settings');
    return { ok: true };
  }

  @Roles('ADMIN') @Delete('settings/school/logo')
  async removeLogo(@CurrentUser() u: AuthUser) {
    await this.db.query(`UPDATE app_settings SET value = '', updated_at = now() WHERE key = 'school_logo'`);
    await audit(this.db.pool, u.id, 'SETTINGS_SCHOOL_LOGO_REMOVE', 'settings');
    return { ok: true };
  }
}

@Module({ controllers: [SchoolController] })
export class SchoolModule {}
