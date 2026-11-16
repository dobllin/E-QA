'use client';
import { useApi } from '@/lib/use-api';
import { rupiah } from '@/lib/format';
import { Alert, Card, Empty, Loading, PageHeader, Stat } from '@/components/ui';
import Link from 'next/link';
import { FeeReminder } from '@/components/FeeReminder';

interface Summary {
  santriActive: number; cardsActive: number; cardsBlocked: number; walletTotal: number;
  salesTodayCount: number; salesTodayTotal: number; topupToday: number;
  invoiceDue: number; invoiceOverdue: number; sppPaidToday: number; topProducts: { name: string; qty: number }[];
}

interface Todo { topupMatched: number; topupPending: number; topupPendingWithProof: number; overdueCount: number; overdueTotal: number; cardsLocked: number; cardsSuspended: number; lowStock: number }
interface Day { date: string; sales: number; topups: number }

function TodoPanel() {
  const { data: t } = useApi<Todo>('/reports/todo');
  if (!t) return null;
  const items = [
    { n: t.topupMatched + t.topupPendingWithProof, label: 'Top up menunggu Anda periksa', hint: t.topupMatched ? `${t.topupMatched} sudah cocok dengan mutasi bank` : 'wali sudah mengirim bukti transfer', href: '/topup', tone: 'text-amber-900 bg-amber-50 border-amber-200' },
    { n: t.overdueCount, label: 'Tagihan lewat jatuh tempo', hint: t.overdueCount ? `total ${rupiah(t.overdueTotal)}` : '', href: '/tagihan', tone: 'text-red-800 bg-red-50 border-red-200' },
    { n: t.cardsLocked + t.cardsSuspended, label: 'Kartu terkunci atau dinonaktifkan', hint: t.cardsLocked ? `${t.cardsLocked} terkunci karena salah PIN` : '', href: '/santri', tone: 'text-amber-900 bg-amber-50 border-amber-200' },
    { n: t.lowStock, label: 'Produk stok menipis (≤ 5)', hint: '', href: '/produk', tone: 'text-amber-900 bg-amber-50 border-amber-200' },
  ].filter((i) => i.n > 0);
  return (
    <section aria-label="Perlu tindakan" className="mb-6">
      <h2 className="mb-2 text-lg font-semibold text-navy-900">Perlu tindakan</h2>
      {items.length === 0 ? <div className="rounded-card border border-teal-100 bg-teal-50 p-4 text-teal-700">Tidak ada yang perlu ditindaklanjuti sekarang.</div> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {items.map((i) => (
            <Link key={i.label} href={i.href} className={`block rounded-card border p-4 transition-shadow hover:shadow-md ${i.tone}`}>
              <div className="text-3xl font-bold tabular-nums">{i.n}</div>
              <div className="font-medium">{i.label}</div>
              {i.hint && <div className="text-sm opacity-80">{i.hint}</div>}
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function Trend() {
  const { data } = useApi<Day[]>('/reports/trend');
  if (!data) return null;
  const max = Math.max(1, ...data.flatMap((d) => [d.sales, d.topups]));
  return (
    <Card title="7 hari terakhir" className="mt-6">
      <div className="flex items-end gap-2 sm:gap-4" style={{ height: 160 }} role="img" aria-label="Grafik batang penjualan dan top up 7 hari terakhir">
        {data.map((d) => (
          <div key={d.date} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" style={{ height: '100%' }} title={`${d.date}: penjualan ${rupiah(d.sales)}, top up ${rupiah(d.topups)}`}>
            <div className="flex w-full flex-1 items-end justify-center gap-1">
              <div className="w-1/2 max-w-[22px] rounded-t bg-teal-500" style={{ height: `${(d.sales / max) * 100}%`, minHeight: d.sales ? 3 : 0 }} />
              <div className="w-1/2 max-w-[22px] rounded-t bg-navy-700" style={{ height: `${(d.topups / max) * 100}%`, minHeight: d.topups ? 3 : 0 }} />
            </div>
            <div className="text-[11px] text-navy-700">{d.date.slice(8)}/{d.date.slice(5, 7)}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-sm text-navy-700"><span><span className="mr-1 inline-block h-3 w-3 rounded bg-teal-500 align-middle" />Penjualan kantin dan laundry</span><span><span className="mr-1 inline-block h-3 w-3 rounded bg-navy-700 align-middle" />Top up masuk</span></div>
    </Card>
  );
}

export default function Dashboard() {
  const { data: s, error, loading } = useApi<Summary>('/reports/summary');
  if (loading) return <Loading />;
  if (error || !s) return <Alert>{error ?? 'Gagal memuat'}</Alert>;
  return (
    <>
      <PageHeader title="Ringkasan hari ini" sub="Data diperbarui setiap halaman dibuka." />
      <FeeReminder />
      <TodoPanel />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Santri aktif" value={s.santriActive} />
        <Stat label="Kartu aktif" value={s.cardsActive} sub={`${s.cardsBlocked} diblokir/terkunci`} />
        <Stat label="Total saldo santri" value={rupiah(s.walletTotal)} />
        <Stat label="Belanja kantin hari ini" value={rupiah(s.salesTodayTotal)} sub={`${s.salesTodayCount} transaksi`} />
        <Stat label="Top up hari ini" value={rupiah(s.topupToday)} />
        <Stat label="SPP diterima hari ini" value={rupiah(s.sppPaidToday)} />
        <Stat label="Tagihan belum lunas" value={rupiah(s.invoiceDue)} />
        <Stat label="Menunggak" value={rupiah(s.invoiceOverdue)} tone={s.invoiceOverdue > 0 ? 'bad' : undefined} />
      </div>
      <Card title="Produk terlaris hari ini" className="mt-6">
        {s.topProducts.length === 0 ? <Empty>Belum ada penjualan hari ini.</Empty> : (
          <ol className="divide-y divide-navy-50">
            {s.topProducts.map((p) => <li key={p.name} className="flex justify-between py-2 text-sm"><span>{p.name}</span><span className="tabular-nums text-navy-700">{p.qty} terjual</span></li>)}
          </ol>
        )}
      </Card>
      <Trend />
    </>
  );
}
