import { HttpException } from '@nestjs/common';

/** Error dengan kode mesin + pesan bahasa Indonesia untuk ditampilkan ke pengguna. */
export const appErr = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  new HttpException({ statusCode: status, code, message, ...extra }, status);
