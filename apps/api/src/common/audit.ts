import { PoolClient } from 'pg';
import { Pool } from 'pg';

type Q = Pick<PoolClient, 'query'> | Pick<Pool, 'query'>;

/** Catat aksi penting. Kalau dipanggil dengan client transaksi, ikut commit/rollback bersama aksinya. */
export async function audit(q: Q, actorId: string | null, action: string, entity: string, entityId?: string, meta?: unknown) {
  await q.query(
    'INSERT INTO audit_logs(actor_id, action, entity, entity_id, meta) VALUES ($1,$2,$3,$4,$5)',
    [actorId, action, entity, entityId ?? null, meta ? JSON.stringify(meta) : null],
  );
}
