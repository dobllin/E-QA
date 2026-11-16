import type { PoolConfig } from 'pg';

/**
 * Pengaturan koneksi database yang dipakai SEMUA tempat (API, migrasi, akun awal, seed).
 * - Lokal/Docker (alamat "db:5432" tanpa sslmode): tanpa SSL, perilaku lama tidak berubah.
 * - Cloud (mis. Neon, alamat berisi ?sslmode=require): SSL dinyalakan dan sertifikat diperiksa.
 * - "channel_binding" dibuang dari alamat karena driver pg tidak memakainya dan bisa membuat koneksi gagal.
 * - DATABASE_SSL=true/false memaksa nyala/mati. DATABASE_SSL_VERIFY=false hanya untuk darurat.
 */
export function poolConfig(url: string | undefined = process.env.DATABASE_URL): PoolConfig {
  if (!url) return { connectionString: url };
  let wantSsl = false;
  let clean = url;
  try {
    const u = new URL(url);
    const mode = (u.searchParams.get('sslmode') ?? '').toLowerCase();
    wantSsl = !!mode && mode !== 'disable';
    u.searchParams.delete('sslmode');
    u.searchParams.delete('channel_binding');
    clean = u.toString();
  } catch { /* alamat tidak bisa dibaca sebagai URL: biarkan driver yang menilai */ }
  if (process.env.DATABASE_SSL === 'true') wantSsl = true;
  if (process.env.DATABASE_SSL === 'false') wantSsl = false;
  const cfg: PoolConfig = { connectionString: clean, connectionTimeoutMillis: Number(process.env.DB_CONNECT_TIMEOUT_MS ?? 30000) };
  if (wantSsl) cfg.ssl = { rejectUnauthorized: process.env.DATABASE_SSL_VERIFY !== 'false' };
  return cfg;
}
