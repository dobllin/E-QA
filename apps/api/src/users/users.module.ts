import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import * as argon2 from 'argon2';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { Db } from '../db/db.service';
import { appErr } from '../common/errors';
import { audit } from '../common/audit';
import { AuthUser, CurrentUser, Role, Roles } from '../common/auth';
import { normalizePhone } from '../common/phone';

const ROLES = ['SUPER_ADMIN', 'ADMIN', 'BENDAHARA', 'KASIR', 'LAUNDRY', 'GURU', 'WALSAN'];

class CreateUserDto {
  @IsString() @Matches(/^[a-zA-Z0-9._-]{3,40}$/, { message: 'Username 3-40 karakter: huruf, angka, titik, strip' }) username: string;
  @IsString() @MinLength(8, { message: 'Password minimal 8 karakter' }) password: string;
  @IsString() @MinLength(2) fullName: string;
  @IsOptional() @IsString() phone?: string;
  @IsIn(ROLES) role: Role;
}
class EditUserDto {
  @IsOptional() @IsString() @MinLength(2) fullName?: string;
  @IsOptional() @IsString() phone?: string;   // string kosong = hapus nomor
}
class ActiveDto { @IsBoolean() isActive: boolean }
class PasswordDto { @IsString() @MinLength(8) password: string }

@Controller('users')
@Roles('ADMIN')
class UsersController {
  constructor(private db: Db) {}

  @Get() async list() {
    const { rows } = await this.db.query(
      'SELECT id, username, full_name AS "fullName", phone, role, is_active AS "isActive", created_at AS "createdAt" FROM users ORDER BY created_at DESC');
    return rows;
  }

  @Post() async create(@CurrentUser() me: AuthUser, @Body() b: CreateUserDto) {
    // ADMIN tidak boleh membuat akun yang levelnya sama atau lebih tinggi.
    if (me.role !== 'SUPER_ADMIN' && !['KASIR', 'LAUNDRY', 'GURU', 'WALSAN', 'BENDAHARA'].includes(b.role)) {
      throw appErr(403, 'FORBIDDEN', 'Hanya Super Admin yang boleh membuat akun Admin');
    }
    const phone = b.phone?.trim() || null;
    if (phone && !normalizePhone(phone)) throw appErr(400, 'PHONE_INVALID', 'Nomor HP tidak valid. Contoh: 081234567890');
    try {
      const { rows } = await this.db.query(
        `INSERT INTO users(username, password_hash, full_name, phone, role) VALUES ($1,$2,$3,$4,$5)
         RETURNING id, username, full_name AS "fullName", role`,
        [b.username.trim(), await argon2.hash(b.password), b.fullName.trim(), phone, b.role]);
      await audit(this.db.pool, me.id, 'USER_CREATE', 'user', rows[0].id, { role: b.role });
      return rows[0];
    } catch (e: any) {
      if (e.code === '23505') throw appErr(409, 'USERNAME_TAKEN', 'Username sudah dipakai');
      throw e;
    }
  }

  /** Ubah nama dan nomor HP (nomor wali dipakai untuk pengingat WhatsApp). */
  @Patch(':id') async edit(@CurrentUser() me: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: EditUserDto) {
    const u = (await this.db.query('SELECT role FROM users WHERE id = $1', [id])).rows[0];
    if (!u) throw appErr(404, 'NOT_FOUND', 'Pengguna tidak ditemukan');
    if (me.role !== 'SUPER_ADMIN' && ['SUPER_ADMIN', 'ADMIN'].includes(u.role) && id !== me.id) throw appErr(403, 'FORBIDDEN', 'Hanya Super Admin yang boleh mengubah akun Admin');
    const phone = b.phone === undefined ? undefined : b.phone.trim() || null;
    if (phone && !normalizePhone(phone)) throw appErr(400, 'PHONE_INVALID', 'Nomor HP tidak valid. Contoh: 081234567890');
    await this.db.query('UPDATE users SET full_name = COALESCE($2, full_name), phone = CASE WHEN $3::boolean THEN $4 ELSE phone END WHERE id = $1',
      [id, b.fullName?.trim() ?? null, phone !== undefined, phone ?? null]);
    await audit(this.db.pool, me.id, 'USER_EDIT', 'user', id, { fullName: b.fullName, phoneChanged: phone !== undefined });
    return { ok: true };
  }

  @Patch(':id/active') async setActive(@CurrentUser() me: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: ActiveDto) {
    if (id === me.id) throw appErr(400, 'SELF', 'Tidak bisa menonaktifkan akun sendiri');
    await this.db.query('UPDATE users SET is_active = $2 WHERE id = $1', [id, b.isActive]);
    if (!b.isActive) await this.db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
    await audit(this.db.pool, me.id, b.isActive ? 'USER_ENABLE' : 'USER_DISABLE', 'user', id);
    return { ok: true };
  }

  @Post(':id/reset-password') async resetPassword(@CurrentUser() me: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() b: PasswordDto) {
    await this.db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [id, await argon2.hash(b.password)]);
    await this.db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
    await audit(this.db.pool, me.id, 'USER_PASSWORD_RESET', 'user', id);
    return { ok: true };
  }
}

@Module({ controllers: [UsersController] })
export class UsersModule {}
