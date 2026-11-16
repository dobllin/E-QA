import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { poolConfig } from './pool-config';

@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool = new Pool({ ...poolConfig(), max: 20 });

  constructor() {
    // Koneksi menganggur bisa diputus server (mis. database cloud tidur). Tanpa ini proses bisa mati.
    this.pool.on('error', (e) => console.error('[db] koneksi menganggur terputus:', e.message));
  }

  query<T extends QueryResultRow = any>(text: string, params?: any[]) {
    return this.pool.query<T>(text, params);
  }

  /** Jalankan fungsi dalam satu database transaction. */
  async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const r = await fn(c);
      await c.query('COMMIT');
      return r;
    } catch (e) {
      try { await c.query('ROLLBACK'); } catch { /* abaikan */ }
      throw e;
    } finally {
      c.release();
    }
  }

  onModuleDestroy() { return this.pool.end(); }
}

@Global()
@Module({ providers: [Db], exports: [Db] })
export class DbModule {}
