import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import * as argon2 from 'argon2';
import { Pool } from 'pg';
import { AppModule } from './app.module';
import { setupApp } from './app.setup';
import { runMigrations } from './db/migrate';
import { poolConfig } from './db/pool-config';

async function bootstrapAdmin() {
  const u = process.env.BOOTSTRAP_ADMIN_USERNAME, p = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!u || !p) return;
  const pool = new Pool(poolConfig());
  try {
    const n = (await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n;
    if (n === 0) {
      await pool.query(`INSERT INTO users(username, password_hash, full_name, role) VALUES ($1,$2,'Super Admin','SUPER_ADMIN')`, [u, await argon2.hash(p)]);
      console.log(`[bootstrap] akun Super Admin "${u}" dibuat`);
    }
  } finally { await pool.end(); }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL belum diisi');
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET wajib diisi (minimal 32 karakter)');
  if (process.env.AUTO_MIGRATE !== 'false') await runMigrations();
  await bootstrapAdmin();
  const app = await NestFactory.create(AppModule);
  setupApp(app);
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  console.log(`[api] E-QA API (MODE DEMO) berjalan di port ${port}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
