import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';

/** Dipakai bersama oleh main.ts dan test supaya perilakunya sama. */
export function setupApp(app: INestApplication) {
  // Di belakang proxy (Render, Caddy, dll.) alamat asli pengguna ada di header X-Forwarded-For. Hanya dipercaya bila TRUST_PROXY diisi.
  const tp = process.env.TRUST_PROXY;
  if (tp) (app as any).getHttpAdapter().getInstance().set('trust proxy', /^\d+$/.test(tp) ? Number(tp) : tp === 'true' ? true : tp);
  app.use(helmet());
  (app as any).useBodyParser?.('json', { limit: '2mb' });   // impor Excel (tempel data) bisa lebih dari 100 KB
  app.enableCors({ origin: (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(','), credentials: false });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => {
      const { HttpException } = require('@nestjs/common');
      const msg = errors.flatMap((e) => Object.values(e.constraints ?? {}))[0] ?? 'Data tidak valid';
      return new HttpException({ statusCode: 400, code: 'VALIDATION', message: msg }, 400);
    },
  }));
}
