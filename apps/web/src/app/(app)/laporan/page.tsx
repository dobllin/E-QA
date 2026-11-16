'use client';
import { useState } from 'react';
import { apiDownload, errMsg, getSession } from '@/lib/api';
import { rupiah, tanggalWaktu } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { Alert, Badge, Button, Card, Empty, Field, Input, Loading, PageHeader, Select, Table, Td } from '@/components/ui';

const ACTION: Record<string, string> = {
  LOGIN: 'Login', LOGIN_FAILED: 'Login gagal', USER_CREATE: 'Pengguna dibuat', USER_ENABLE: 'Akun diaktifkan', USER_DISABLE: 'Akun dinonaktifkan', USER_PASSWORD_RESET: 'Password direset',
  SANTRI_CREATE: 'Santri ditambah', SANTRI_UPDATE: 'Santri diubah', SANTRI_BULK_IMPORT: 'Impor santri', WALSAN_LINK: 'Wali dihubungkan', WALSAN_UNLINK: 'Wali dilepas',
  CARD_ISSUE: 'Kartu diterbitkan', CARD_REPLACE: 'Kartu diganti', CARD_SUSPENDED: 'Kartu dinonaktifkan', CARD_UNSUSPENDED: 'Kartu diaktifkan', CARD_UNLOCKED: 'Kartu dibuka', CARD_PIN_RESET: 'PIN direset', CARD_ISSUE_BULK: 'Kartu massal diterbitkan', SANTRI_PROMOTE: 'Naik kelas massal', SANTRI_GRADUATE: 'Kelas diluluskan', PASSWORD_CHANGE: 'Password diganti', CONSENT: 'Wali menyetujui privasi', SETTINGS_SCHOOL_NAME: 'Nama pesantren diubah', SETTINGS_SCHOOL_LOGO: 'Logo diubah', CARD_VIEW: 'Kartu dilihat/dicetak ulang',
  WALLET_TOPUP: 'Top up', WALLET_REFUND: 'Refund', WALLET_LIMITS: 'Batas belanja diubah', INVOICE_GENERATE: 'Tagihan dibuat', INVOICE_PAY: 'Pembayaran tagihan', INVOICE_CANCEL: 'Tagihan dibatalkan',
  PRODUCT_CREATE: 'Produk ditambah', PRODUCT_UPDATE: 'Produk diubah',
};

function Downloads() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const start = new Date(Date.now() - 29 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const [from, setFrom] = useState(start); const [to, setTo] = useState(today); const [m, setM] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState('');
  async function dl(key: string, path: string, file: string) { setErr(''); setBusy(key); try { await apiDownload(path, file); } catch (e) { setErr(errMsg(e)); } finally { setBusy(''); } }
  const rng = `from=${from}&to=${to}`;
  const rows: [string, string, string, string, string][] = [
    ['sales', 'Penjualan per hari', 'Jumlah transaksi dan total kantin/laundry per hari (yang dibatalkan tidak dihitung).', `/reports/sales.csv?${rng}${m ? `&merchant=${m}` : ''}`, `penjualan-${from}-sd-${to}.csv`],
    ['topups', 'Rekap top up', 'Daftar top up yang sudah masuk ke saldo santri, beserta biaya layanan.', `/reports/topups.csv?${rng}`, `rekap-topup-${from}-sd-${to}.csv`],
    ['arrears', 'Tunggakan per kelas', 'Semua tagihan yang lewat jatuh tempo, diurutkan per kelas dan santri.', '/reports/arrears.csv', `tunggakan-${today}.csv`],
    ['balances', 'Saldo semua santri', 'Saldo tiap santri per kantong (jajan, laundry, SPP) pada saat ini.', '/reports/balances.csv', `saldo-santri-${today}.csv`],
  ];
  return (
    <Card title="Unduh laporan (bisa dibuka di Excel)" className="mb-6">
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Field label="Dari tanggal"><Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Sampai tanggal"><Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Jenis penjualan"><Select value={m} onChange={(e) => setM(e.target.value)}><option value="">Kantin dan laundry</option><option value="KANTIN">Kantin saja</option><option value="LAUNDRY">Laundry saja</option></Select></Field>
      </div>
      <ul className="divide-y divide-navy-50">
        {rows.map(([k, title, desc, path, file]) => (
          <li key={k} className="flex flex-wrap items-center justify-between gap-3 py-3"><div className="min-w-0 flex-1"><div className="font-medium">{title}</div><div className="text-sm text-navy-700">{desc}</div></div><Button variant="secondary" disabled={!!busy} onClick={() => dl(k, path, file)}>{busy === k ? 'Mengunduh…' : 'Unduh CSV'}</Button></li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-navy-700">Dibuka dengan Excel: klik dua kali berkasnya. Pemisah kolom sudah disesuaikan untuk Excel berbahasa Indonesia.</p>
    </Card>
  );
}

export default function Laporan() {
  const isBend = ['SUPER_ADMIN', 'BENDAHARA'].includes(getSession()?.user.role ?? '');
  const rec = useApi<{ walletsChecked: number; ok: boolean; mismatches: any[] }>(isBend ? '/reports/reconcile' : null);
  const audit = useApi<any[]>('/reports/audit');
  return (
    <>
      <PageHeader title="Laporan & audit" sub="Unduh laporan, pemeriksaan saldo, dan jejak aktivitas." />
      <Downloads />
      {isBend && (
        <Card title="Rekonsiliasi saldo" className="mb-6">
          {rec.loading ? <Loading /> : rec.error ? <Alert>{rec.error}</Alert> : rec.data?.ok
            ? <Alert tone="ok">Semua {rec.data.walletsChecked} saldo santri sesuai dengan catatan mutasi (ledger). Tidak ada selisih.</Alert>
            : <div className="space-y-3"><Alert>Ditemukan selisih antara saldo dan ledger. Segera periksa:</Alert>
              <Table head={['NIS', 'Nama', 'Saldo wallet', 'Hasil ledger']}>{rec.data?.mismatches.map((m) => <tr key={`${m.nis}-${m.pocket}`}><Td>{m.nis}</Td><Td>{m.fullName} ({m.pocket})</Td><Td right>{rupiah(m.walletBalance)}</Td><Td right>{rupiah(m.ledgerBalance)}</Td></tr>)}</Table></div>}
        </Card>
      )}
      <Card title="Aktivitas terbaru (100 terakhir)">
        {audit.loading ? <Loading /> : audit.error ? <Alert>{audit.error}</Alert> : !audit.data?.length ? <Empty>Belum ada aktivitas.</Empty> : (
          <Table head={['Waktu', 'Pelaku', 'Aksi']}>{audit.data.map((a) => <tr key={a.id}><Td>{tanggalWaktu(a.createdAt)}</Td><Td>{a.actor ? `@${a.actor}` : '-'}</Td><Td>{a.action.includes('FAILED') ? <Badge tone="bad">{ACTION[a.action]}</Badge> : (ACTION[a.action] ?? a.action)}</Td></tr>)}</Table>
        )}
      </Card>
    </>
  );
}
