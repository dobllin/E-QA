import { poolConfig } from '../src/db/pool-config';

describe('poolConfig (koneksi database)', () => {
  const keep = { ...process.env };
  afterEach(() => { process.env = { ...keep }; });

  test('alamat lokal/Docker tanpa sslmode: tanpa SSL, alamat tidak berubah', () => {
    const c = poolConfig('postgresql://eqa:pw@db:5432/eqa');
    expect(c.ssl).toBeUndefined();
    expect(c.connectionString).toBe('postgresql://eqa:pw@db:5432/eqa');
  });

  test('alamat cloud (sslmode=require): SSL nyala dengan pemeriksaan sertifikat; channel_binding dibuang', () => {
    const c = poolConfig('postgresql://u:pw@ep-x.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require');
    expect(c.ssl).toEqual({ rejectUnauthorized: true });
    expect(c.connectionString).toBe('postgresql://u:pw@ep-x.ap-southeast-1.aws.neon.tech/neondb');
  });

  test('DATABASE_SSL=true memaksa SSL, false mematikan; sslmode=disable tidak memakai SSL', () => {
    process.env.DATABASE_SSL = 'true';
    expect(poolConfig('postgresql://u:pw@h/db').ssl).toBeDefined();
    process.env.DATABASE_SSL = 'false';
    expect(poolConfig('postgresql://u:pw@h/db?sslmode=require').ssl).toBeUndefined();
    delete process.env.DATABASE_SSL;
    expect(poolConfig('postgresql://u:pw@h/db?sslmode=disable').ssl).toBeUndefined();
  });

  test('tanpa DATABASE_URL tidak error di sini (main.ts yang menolak)', () => {
    expect(poolConfig(undefined).connectionString).toBeUndefined();
  });
});
