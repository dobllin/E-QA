import { Body, Controller, Get, Injectable, Module, Post } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { IsString, MinLength } from 'class-validator';
import { Db } from '../db/db.service';
import { appErr } from '../common/errors';
import { audit } from '../common/audit';
import { AuthUser, CurrentUser, Public } from '../common/auth';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const REFRESH_DAYS = 7;

class LoginDto { @IsString() username: string; @IsString() password: string }
class ChangePasswordDto { @IsString() currentPassword: string; @IsString() @MinLength(8, { message: 'Password baru minimal 8 karakter' }) newPassword: string }
class RefreshDto { @IsString() @MinLength(20) refreshToken: string }

@Injectable()
export class AuthService {
  constructor(private db: Db, private jwt: JwtService) {}

  private async issue(userId: string) {
    const accessToken = await this.jwt.signAsync({ sub: userId });
    const refreshToken = randomBytes(48).toString('base64url');
    await this.db.query(
      `INSERT INTO sessions(user_id, refresh_hash, expires_at) VALUES ($1,$2, now() + ($3 || ' days')::interval)`,
      [userId, sha(refreshToken), String(REFRESH_DAYS)]);
    return { accessToken, refreshToken };
  }

  async login(username: string, password: string) {
    const { rows } = await this.db.query('SELECT * FROM users WHERE lower(username) = lower($1)', [username.trim()]);
    const u = rows[0];
    const ok = u ? await argon2.verify(u.password_hash, password) : false;
    if (!u || !ok || !u.is_active) {
      await audit(this.db.pool, u?.id ?? null, 'LOGIN_FAILED', 'user', u?.id, { username });
      throw appErr(401, 'LOGIN_FAILED', 'Username atau password salah');
    }
    await audit(this.db.pool, u.id, 'LOGIN', 'user', u.id);
    return { ...(await this.issue(u.id)), user: { id: u.id, username: u.username, fullName: u.full_name, role: u.role } };
  }

  async refresh(refreshToken: string) {
    const h = sha(refreshToken);
    const { rows } = await this.db.query(
      'UPDATE sessions SET revoked_at = now() WHERE refresh_hash = $1 AND revoked_at IS NULL AND expires_at > now() RETURNING user_id', [h]);
    if (!rows[0]) throw appErr(401, 'REFRESH_INVALID', 'Sesi habis, silakan login ulang');
    return this.issue(rows[0].user_id);
  }

  async me(u: AuthUser) {
    const c = (await this.db.query('SELECT consent_at, consent_version FROM users WHERE id = $1', [u.id])).rows[0];
    return { ...u, consentAt: c?.consent_at ?? null, consentVersion: c?.consent_version ?? null };
  }

  async changePassword(u: AuthUser, current: string, next: string) {
    const row = (await this.db.query('SELECT password_hash FROM users WHERE id = $1', [u.id])).rows[0];
    if (!row || !(await argon2.verify(row.password_hash, current))) throw appErr(401, 'PASSWORD_WRONG', 'Password lama salah');
    if (current === next) throw appErr(400, 'PASSWORD_SAME', 'Password baru harus berbeda dari password lama');
    await this.db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [u.id, await argon2.hash(next)]);
    await this.db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [u.id]);
    await audit(this.db.pool, u.id, 'PASSWORD_CHANGE', 'user', u.id);
    return { ok: true };
  }

  async logout(refreshToken: string) {
    await this.db.query('UPDATE sessions SET revoked_at = now() WHERE refresh_hash = $1', [sha(refreshToken)]);
    return { ok: true };
  }
}

@Controller('auth')
class AuthController {
  constructor(private svc: AuthService) {}

  @Public() @Throttle({ default: { limit: Number(process.env.LOGIN_RATE_LIMIT ?? 20), ttl: 60_000 } })
  @Post('login') login(@Body() b: LoginDto) { return this.svc.login(b.username, b.password); }

  @Public() @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh') refresh(@Body() b: RefreshDto) { return this.svc.refresh(b.refreshToken); }

  @Public() @Post('logout') logout(@Body() b: RefreshDto) { return this.svc.logout(b.refreshToken); }

  @Get('me') async me(@CurrentUser() u: AuthUser) { return this.svc.me(u); }

  /** Ganti password sendiri. Semua sesi login dikeluarkan; pengguna login ulang dengan password baru. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('change-password') changePassword(@CurrentUser() u: AuthUser, @Body() b: ChangePasswordDto) { return this.svc.changePassword(u, b.currentPassword, b.newPassword); }
}

@Module({
  imports: [JwtModule.registerAsync({
    useFactory: () => ({ secret: process.env.JWT_SECRET, signOptions: { expiresIn: '30m' } }),
  })],
  providers: [AuthService],
  controllers: [AuthController],
  exports: [JwtModule],
})
export class AuthModule {}
