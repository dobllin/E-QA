import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';

@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });

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
