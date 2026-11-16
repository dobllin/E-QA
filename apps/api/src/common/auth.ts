import {
  CanActivate, createParamDecorator, ExecutionContext, Injectable, SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Db } from '../db/db.service';
import { appErr } from './errors';

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'BENDAHARA' | 'KASIR' | 'LAUNDRY' | 'GURU' | 'WALSAN';
export interface AuthUser { id: string; role: Role; username: string; fullName: string }

export const Public = () => SetMetadata('isPublic', true);
export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);

/** Guard global: semua endpoint wajib login kecuali @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector, private db: Db) {}

  async canActivate(ctx: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers['authorization'] ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw appErr(401, 'UNAUTHENTICATED', 'Silakan login terlebih dahulu');
    let payload: { sub: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw appErr(401, 'TOKEN_INVALID', 'Sesi tidak valid atau sudah habis');
    }
    // Cek ke database supaya akun yang dinonaktifkan langsung tidak bisa dipakai.
    const { rows } = await this.db.query(
      'SELECT id, role, username, full_name, is_active FROM users WHERE id = $1', [payload.sub]);
    const u = rows[0];
    if (!u || !u.is_active) throw appErr(401, 'ACCOUNT_DISABLED', 'Akun tidak aktif');
    req.user = { id: u.id, role: u.role, username: u.username, fullName: u.full_name } as AuthUser;
    return true;
  }
}

/** Guard global: cek role di backend (bukan cuma menyembunyikan tombol di frontend). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(ctx: ExecutionContext) {
    const roles = this.reflector.getAllAndOverride<Role[]>('roles', [ctx.getHandler(), ctx.getClass()]);
    if (!roles || roles.length === 0) return true;
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user) return true; // endpoint @Public
    if (user.role === 'SUPER_ADMIN' || roles.includes(user.role)) return true;
    throw appErr(403, 'FORBIDDEN', 'Anda tidak punya izin untuk aksi ini');
  }
}
