'use client';
import { FormEvent, useState } from 'react';
import { api, errMsg, getSession } from '@/lib/api';
import { rupiah, tanggalWaktu } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { Alert, Badge, Button, Empty, Field, Input, Loading, Modal, PageHeader, Select, Table, Td } from '@/components/ui';

interface Order { id: string; total: number; merchant: 'KANTIN' | 'LAUNDRY'; createdAt: string; santriName: string; nis: string; kelas: string | null; cashier: string | null; refunded: boolean; items: { name: string; qty: number; unitPrice: number }[] | null }

export default function TransaksiPage() {
  const canRefund = ['SUPER_ADMIN', 'BENDAHARA'].includes(getSession()?.user.role ?? '');
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const week = new Date(Date.now() - 6 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const [q, setQ] = useState(''); const [merchant, setMerchant] = useState(''); const [from, setFrom] = useState(week); const [to, setTo] = useState(today);
  const { data, error, loading, reload } = useApi<Order[]>('/reports/orders', { q: q || undefined, merchant: merchant || undefined, from, to });
  const [refund, setRefund] = useState<Order | null>(null); const [msg, setMsg] = useState('');
  return (
    <>
      <PageHeader title="Transaksi" sub="Semua belanja kantin dan laundry. Bendahara bisa membatalkan transaksi yang salah (uang dikembalikan ke santri, riwayat asli tetap tersimpan)." />
      {msg && <div className="mb-4"><Alert tone="ok">{msg}</Alert></div>}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input type="search" placeholder="Cari nama atau NIS santri" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari santri" />
        <Select value={merchant} onChange={(e) => setMerchant(e.target.value)} aria-label="Jenis"><option value="">Kantin dan laundry</option><option value="KANTIN">Kantin saja</option><option value="LAUNDRY">Laundry saja</option></Select>
        <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="Dari tanggal" />
        <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="Sampai tanggal" />
      </div>
      {loading && <Loading />}{error && <Alert>{error}</Alert>}
      {data && (data.length === 0 ? <Empty>Tidak ada transaksi pada filter ini.</Empty> : (
        <div className="rounded-card border border-navy-100 bg-white">
          <Table head={['Waktu', 'Santri', 'Isi belanja', 'Total', 'Kasir', 'Status', '']}>
            {data.map((o) => (
              <tr key={o.id}>
                <Td>{tanggalWaktu(o.createdAt)}<div className="text-xs text-navy-700">{o.merchant === 'LAUNDRY' ? 'Laundry' : 'Kantin'}</div></Td>
                <Td><div className="font-medium">{o.santriName}</div><div className="text-xs text-navy-700">{o.nis}{o.kelas ? ` · ${o.kelas}` : ''}</div></Td>
                <Td className="max-w-[260px] text-sm">{(o.items ?? []).map((i) => `${i.qty}× ${i.name}`).join(', ') || '-'}</Td>
                <Td right className="font-semibold">{rupiah(o.total)}</Td><Td>{o.cashier ?? '-'}</Td>
                <Td>{o.refunded ? <Badge tone="info">Dikembalikan</Badge> : <Badge tone="ok">Selesai</Badge>}</Td>
                <Td right>{canRefund && !o.refunded && <Button variant="ghost" onClick={() => setRefund(o)}>Batalkan</Button>}</Td>
              </tr>
            ))}
          </Table>
        </div>
      ))}
      {refund && <RefundModal o={refund} onClose={() => setRefund(null)} onDone={() => { setRefund(null); setMsg('Transaksi dibatalkan dan uang dikembalikan ke santri.'); reload(); }} />}
    </>
  );
}

function RefundModal({ o, onClose, onDone }: { o: Order; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api('/wallet/refund', { method: 'POST', body: { orderId: o.id, reason } }); onDone(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={`Batalkan transaksi — ${o.santriName}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Alert tone="warn">Uang <strong>{rupiah(o.total)}</strong> dikembalikan ke kantong {o.merchant === 'LAUNDRY' ? 'laundry' : 'jajan'} santri{o.merchant === 'KANTIN' ? ' dan stok barang bertambah kembali' : ''}. Transaksi asli tidak dihapus dan tercatat di audit log. Hanya bisa dilakukan satu kali.</Alert>
        {err && <Alert>{err}</Alert>}
        <Field label="Alasan pembatalan"><Input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} autoFocus placeholder="Contoh: Salah input / barang tidak jadi diambil" /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Kembali</Button><Button variant="danger" disabled={busy}>{busy ? 'Memproses…' : 'Batalkan transaksi'}</Button></div>
      </form>
    </Modal>
  );
}
