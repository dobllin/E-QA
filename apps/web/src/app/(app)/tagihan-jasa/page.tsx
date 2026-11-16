'use client';
import { FormEvent, useState } from 'react';
import { api, apiBlobUrl, errMsg, getSession } from '@/lib/api';
import { rupiah, tanggal } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { Alert, Badge, Button, Card, Empty, Field, Input, Loading, Modal, PageHeader, Table, Td } from '@/components/ui';

interface Month { month: string; count: number; feeTotal: number; creditedTotal: number; status: string; paidAt: string | null; note: string | null; receivedAt: string | null; paidTotal: number | null }
const ST: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' | 'info' }> = {
  BERJALAN: { label: 'Bulan berjalan', tone: 'info' }, TIDAK_ADA: { label: 'Tidak ada biaya', tone: 'muted' }, BELUM_DIBAYAR: { label: 'Belum dibayar', tone: 'bad' },
  DIBAYAR: { label: 'Dibayar, menunggu konfirmasi', tone: 'warn' }, LUNAS: { label: 'Lunas', tone: 'ok' },
};
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const namaBulan = (m: string) => `${BULAN[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`;

export default function TagihanJasaPage() {
  const role = getSession()?.user.role ?? '';
  const isSuper = role === 'SUPER_ADMIN';
  const list = useApi<Month[]>('/fees/months');
  const [modal, setModal] = useState<{ kind: 'detail' | 'paid'; m: Month } | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  async function act(path: string, method: string, okText: string) {
    setMsg(null);
    try { await api(path, { method }); setMsg({ tone: 'ok', text: okText }); list.reload(); } catch (e) { setMsg({ tone: 'bad', text: errMsg(e) }); }
  }
  return (
    <>
      <PageHeader title="Tagihan jasa bulanan" sub="Biaya layanan aplikasi dari top up yang selesai. Dihitung otomatis; pesantren menyetor total bulanan sesuai perjanjian." />
      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      {list.loading && <Loading />}{list.error && <Alert>{list.error}</Alert>}
      {list.data && (list.data.length === 0 ? <Empty>Belum ada data.</Empty> : (
        <div className="rounded-card border border-navy-100 bg-white">
          <Table head={['Bulan', 'Top up selesai', 'Saldo masuk ke santri', 'Biaya layanan', 'Status', '']}>
            {list.data.map((m) => (
              <tr key={m.month}>
                <Td className="font-medium">{namaBulan(m.month)}</Td><Td right>{m.count}</Td><Td right>{rupiah(m.creditedTotal)}</Td>
                <Td right className="font-semibold">{rupiah(m.feeTotal)}</Td>
                <Td><Badge tone={ST[m.status].tone}>{ST[m.status].label}</Badge>
                  {m.paidAt && <div className="mt-1 text-xs text-navy-700">Dibayar {tanggal(m.paidAt)}{m.receivedAt ? ` · diterima ${tanggal(m.receivedAt)}` : ''}</div>}</Td>
                <Td right><div className="flex flex-wrap justify-end gap-1">
                  {m.count > 0 && <Button variant="ghost" onClick={() => setModal({ kind: 'detail', m })}>Rincian</Button>}
                  {m.status === 'BELUM_DIBAYAR' && <Button variant="secondary" onClick={() => setModal({ kind: 'paid', m })}>Tandai dibayar</Button>}
                  {isSuper && m.status === 'DIBAYAR' && <Button variant="secondary" onClick={() => act(`/fees/months/${m.month}/received`, 'POST', `Penerimaan ${namaBulan(m.month)} dikonfirmasi.`)}>Konfirmasi diterima</Button>}
                  {isSuper && ['DIBAYAR', 'LUNAS'].includes(m.status) && <Button variant="ghost" onClick={() => { if (confirm(`Batalkan penandaan dibayar untuk ${namaBulan(m.month)}?`)) act(`/fees/months/${m.month}/paid`, 'DELETE', 'Penandaan dibatalkan.'); }}>Batalkan</Button>}
                </div></Td>
              </tr>
            ))}
          </Table>
        </div>
      ))}
      <p className="mt-4 text-xs text-navy-700">Alur: sistem menghitung → pesantren mentransfer total fee bulan itu → bendahara menandai dibayar (dengan nomor bukti) → pengembang (Super Admin) mengonfirmasi uang diterima. Dokumen ini bukan faktur pajak; bentuk penagihan resmi mengikuti perjanjian dan ketentuan pajak.</p>
      {modal?.kind === 'detail' && <Detail m={modal.m} onClose={() => setModal(null)} />}
      {modal?.kind === 'paid' && <PaidModal m={modal.m} onClose={() => setModal(null)} onDone={() => { setModal(null); setMsg({ tone: 'ok', text: `${namaBulan(modal.m.month)} ditandai dibayar.` }); list.reload(); }} />}
    </>
  );
}

function Detail({ m, onClose }: { m: Month; onClose: () => void }) {
  const d = useApi<{ items: { id: string; at: string; nis: string; santriName: string; credited: number; fee: number; total: number; kind: string }[]; totals: { count: number; fee: number; credited: number } }>(`/fees/months/${m.month}`);
  const [err, setErr] = useState('');
  async function csv() {
    try { const url = await apiBlobUrl(`/fees/months/${m.month}/csv`); const a = document.createElement('a'); a.href = url; a.download = `biaya-layanan-${m.month}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    catch (e) { setErr(errMsg(e)); }
  }
  function print() { document.body.setAttribute('data-print', 'fee'); window.print(); setTimeout(() => document.body.removeAttribute('data-print'), 500); }
  return (
    <Modal title={`Rincian ${namaBulan(m.month)}`} onClose={onClose} wide>
      {err && <Alert>{err}</Alert>}
      {d.loading ? <Loading /> : d.error ? <Alert>{d.error}</Alert> : d.data && (
        <div className="space-y-4">
          <div className="print-zone space-y-3 text-sm" data-zone="fee">
            <div><div className="text-lg font-bold">Rincian Biaya Layanan Aplikasi E-QA</div><div>Periode: {namaBulan(m.month)}</div><div className="text-xs">Disusun otomatis oleh sistem dari top up yang berstatus selesai. Bukan faktur pajak.</div></div>
            <Table head={['No', 'Waktu', 'NIS', 'Santri', 'Saldo masuk', 'Fee']}>
              {d.data.items.map((r, i) => <tr key={r.id}><Td>{i + 1}</Td><Td>{r.at}</Td><Td>{r.nis}</Td><Td>{r.santriName}{r.kind === 'TUNAI' ? <span className="ml-2 text-xs text-navy-700">(tunai)</span> : null}</Td><Td right>{rupiah(r.credited)}</Td><Td right>{rupiah(r.fee)}</Td></tr>)}
              <tr className="font-semibold"><Td /><Td /><Td /><Td>Total ({d.data.totals.count} top up)</Td><Td right>{rupiah(d.data.totals.credited)}</Td><Td right>{rupiah(d.data.totals.fee)}</Td></tr>
            </Table>
          </div>
          <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" onClick={onClose}>Tutup</Button><Button variant="secondary" onClick={csv}>Unduh CSV</Button><Button onClick={print}>Cetak</Button></div>
        </div>
      )}
    </Modal>
  );
}

function PaidModal({ m, onClose, onDone }: { m: Month; onClose: () => void; onDone: () => void }) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  const [paidAt, setPaidAt] = useState(today); const [note, setNote] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api(`/fees/months/${m.month}/paid`, { method: 'POST', body: { paidAt, note } }); onDone(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={`Tandai dibayar — ${namaBulan(m.month)}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Alert tone="warn">Tandai hanya setelah pesantren benar-benar mentransfer <strong>{rupiah(m.feeTotal)}</strong> ke rekening pengembang.</Alert>
        {err && <Alert>{err}</Alert>}
        <Field label="Tanggal transfer"><Input type="date" value={paidAt} max={today} onChange={(e) => setPaidAt(e.target.value)} required /></Field>
        <Field label="Catatan / nomor bukti transfer"><Input value={note} onChange={(e) => setNote(e.target.value)} required minLength={3} placeholder="Contoh: TRF 12/12 ref 884123" /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Batal</Button><Button disabled={busy}>{busy ? 'Menyimpan…' : 'Tandai dibayar'}</Button></div>
      </form>
    </Modal>
  );
}
