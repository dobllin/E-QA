'use client';
import { useState } from 'react';
import { apiDownload, errMsg } from '@/lib/api';
import { rupiah } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { esc, printHtml } from '@/lib/print';
import { loadSchool } from '@/lib/school';
import { Alert, Badge, Button, Empty, Input, Loading, Modal, Table, Td } from './ui';

interface Item { name: string; qty: number; unitPrice: number; subtotal: number }
interface Order { id: string; time: string; total: number; santriName: string; nis: string; kelas: string | null; cashier: string | null; refunded: boolean; items: Item[] }
interface Daily { date: string; merchant: 'KANTIN' | 'LAUNDRY'; count: number; total: number; refundedCount: number; refundedTotal: number; byItem: { name: string; qty: number; total: number }[]; orders: Order[] }

const todayJakarta = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
const dmy = (iso: string) => iso.split('-').reverse().join('/');

/** Rekap penjualan satu hari untuk Kasir/Laundry: bisa dilihat, diunduh CSV (Excel), atau dicetak / disimpan sebagai PDF. */
export function DailyRecap({ onClose }: { onClose: () => void }) {
  const [date, setDate] = useState(todayJakarta());
  const { data, error, loading } = useApi<Daily>('/pos/daily', { date });
  const [err, setErr] = useState('');
  const isLaundry = data?.merchant === 'LAUNDRY';

  async function csv() {
    setErr('');
    try { await apiDownload(`/pos/daily.csv?date=${date}`, `rekap-${isLaundry ? 'laundry' : 'kantin'}-${date}.csv`); } catch (e) { setErr(errMsg(e)); }
  }
  async function print() {
    if (!data) return;
    const s = await loadSchool();
    const items = data.byItem.map((i) => `<tr><td>${esc(i.name)}</td><td class="r">${i.qty}</td><td class="r">${esc(rupiah(i.total))}</td></tr>`).join('');
    const orders = data.orders.map((o) => `<tr><td>${esc(o.time)}</td><td>${esc(o.santriName)}${o.kelas ? ` <small>(${esc(o.kelas)})</small>` : ''}</td><td>${esc(o.items.map((i) => `${i.name} x${i.qty}`).join(', '))}</td><td class="r">${esc(rupiah(o.total))}</td><td>${o.refunded ? 'Dikembalikan' : ''}</td></tr>`).join('');
    printHtml(`Rekap ${data.date}`,
      `<h2 style="margin:0">${esc(s.name || 'E-QA')}</h2><div>Rekap ${isLaundry ? 'laundry' : 'kantin'} — ${esc(dmy(data.date))}</div>
       <p><strong>Total ${esc(rupiah(data.total))}</strong> dari ${data.count} transaksi${data.refundedCount ? ` (tidak termasuk ${data.refundedCount} yang dikembalikan, ${esc(rupiah(data.refundedTotal))})` : ''}</p>
       <h3>Per barang</h3><table><tr><th>Barang</th><th class="r">Jumlah</th><th class="r">Total</th></tr>${items || '<tr><td colspan="3">Belum ada penjualan</td></tr>'}</table>
       <h3>Semua transaksi</h3><table><tr><th>Jam</th><th>Santri</th><th>Barang</th><th class="r">Total</th><th></th></tr>${orders || '<tr><td colspan="5">Belum ada transaksi</td></tr>'}</table>`,
      'table{width:100%;border-collapse:collapse;font-size:12px}th,td{border-bottom:1px solid #ccc;padding:4px 6px;text-align:left}.r{text-align:right}');
  }

  return (
    <Modal title={isLaundry ? 'Rekap laundry per hari' : 'Rekap kantin per hari'} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm"><span className="mb-1 block font-medium text-navy-800">Tanggal</span><Input type="date" value={date} max={todayJakarta()} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
          <Button variant="secondary" onClick={() => setDate(todayJakarta())}>Hari ini</Button>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button onClick={csv} disabled={!data || data.orders.length === 0}>Unduh Excel (CSV)</Button>
            <Button variant="secondary" onClick={print} disabled={!data || data.orders.length === 0}>Cetak / simpan PDF</Button>
          </div>
        </div>
        {err && <Alert>{err}</Alert>}{error && <Alert>{error}</Alert>}{loading && <Loading />}
        {data && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-card border border-navy-100 p-4"><div className="text-sm text-navy-700">Total penjualan</div><div className="text-2xl font-semibold tabular-nums">{rupiah(data.total)}</div></div>
              <div className="rounded-card border border-navy-100 p-4"><div className="text-sm text-navy-700">Jumlah transaksi</div><div className="text-2xl font-semibold tabular-nums">{data.count}</div></div>
            </div>
            {data.refundedCount > 0 && <Alert tone="warn">{data.refundedCount} transaksi dikembalikan ({rupiah(data.refundedTotal)}) dan tidak dihitung di total.</Alert>}
            {data.orders.length === 0 ? <Empty>Belum ada transaksi pada tanggal ini.</Empty> : (
              <>
                <div><h3 className="mb-1 text-sm font-semibold text-navy-900">Per barang</h3>
                  <Table head={['Barang', 'Jumlah', 'Total']}>{data.byItem.map((i) => <tr key={i.name}><Td>{i.name}</Td><Td right>{i.qty}</Td><Td right>{rupiah(i.total)}</Td></tr>)}</Table></div>
                <div><h3 className="mb-1 text-sm font-semibold text-navy-900">Semua transaksi</h3>
                  <Table head={['Jam', 'Santri', 'Barang', 'Total', '']}>{data.orders.map((o) => (
                    <tr key={o.id} className={o.refunded ? 'text-navy-700 line-through decoration-navy-200' : ''}>
                      <Td>{o.time}</Td><Td>{o.santriName}{o.kelas && <span className="text-xs text-navy-700"> · {o.kelas}</span>}</Td>
                      <Td className="text-xs">{o.items.map((i) => `${i.name} x${i.qty}`).join(', ')}</Td><Td right>{rupiah(o.total)}</Td>
                      <Td>{o.refunded && <Badge tone="warn">Dikembalikan</Badge>}</Td>
                    </tr>))}</Table></div>
              </>
            )}
          </>
        )}
        <div className="flex justify-end"><Button variant="ghost" onClick={onClose}>Tutup</Button></div>
      </div>
    </Modal>
  );
}
