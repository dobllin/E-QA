import 'dotenv/config';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { poolConfig } from './pool-config';

export async function runMigrations(connectionString = process.env.DATABASE_URL) {
  const pool = new Pool(poolConfig(connectionString));
  try {
    await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const dir = join(__dirname, 'migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query(readFileSync(join(dir, f), 'utf8'));
        await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f]);
        await c.query('COMMIT');
        console.log(`[migrate] applied ${f}`);
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      } finally {
        c.release();
      }
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  runMigrations().then(() => console.log('[migrate] selesai')).catch((e) => { console.error(e); process.exit(1); });
}
