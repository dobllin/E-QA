'use client';
import { FormEvent, useMemo, useState } from 'react';
import { api, errMsg, getSession } from '@/lib/api';
import { rupiah, STATUS_TAGIHAN, tanggal, tanggalWaktu, uuid } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { Alert, Badge, Button, Card, Empty, Field, Input, Loading, Modal, PageHeader, Select, MoneyInput } from '@/components/ui';
import { ReminderQueue, remindOne, RemindDot, TemplateEditor } from '@/components/Reminders';

interface Inv { id: string; santriId: string; lastRemindedAt: string | null; remindState: 'NEVER' | 'WAIT' | 'AGAIN' | null; number: string; title: string; period: string; dueDate: string; total: number; paid: number; remaining: number; status: string; santriName: string; nis: string; kelas: string | null }

export default function TagihanPage() {
  const isBend = ['SUPER_ADMIN', 'BENDAHARA'].includes(getSession()?.user.role ?? '');
  const [status, setStatus] = useState(''); const [period, setPeriod] = useState(''); const [q, setQ] = useState('');
  const { data, error, loading, reload } = useApi<Inv[]>('/billing/invoices', { status: status || undefined, period: period || undefined, q: q || undefined });
  const canRemind = ['SUPER_ADMIN', 'ADMIN', 'BENDAHARA'].includes(getSession()?.user.role ?? '');
  const [queue, setQueue] = useState(false); const [tpl, setTpl] = useState(false); const [waBusy, setWaBusy] = useState('');
  const [modal, setModal] = useState<'gen' | 'one' | { edit: Inv } | Inv | null>(null);
  const [receipt, setReceipt] = useState<any>(null);
  const rs = useApi<{ repeatDays: number }>(canRemind ? '/reminders/settings' : null);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const groups = useMemo(() => groupInvoices(data ?? []), [data]);
  const toggle = (id: string) => setOpenIds((o) => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [msg, setMsg] = useState(''); const [msgTone, setMsgTone] = useState<'ok' | 'warn'>('ok');
  const info = (m: string) => { setMsg(m); setMsgTone('ok'); };

  async function wa(santriId: string) {
    setWaBusy(santriId); setMsg('');
    const r = await remindOne(santriId);
    setWaBusy(''); setMsg(r.message); setMsgTone(r.ok ? 'ok' : 'warn'); if (r.ok) reload();
  }

  return (
    <>
      <PageHeader title="Tagihan" sub="Tagihan bulanan, pembayaran di loket, dan tunggakan." action={(isBend || canRemind) && <div className="flex flex-wrap gap-2">{canRemind && <Button variant="ghost" onClick={() => setTpl(true)}>Atur pesan &amp; pengingat</Button>}{canRemind && <Button variant="secondary" onClick={() => setQueue(true)}>Ingatkan lewat WhatsApp</Button>}{isBend && <Button variant="secondary" onClick={() => setModal('one')}>Tagihan per santri</Button>}{isBend && <Button onClick={() => setModal('gen')}>Buat tagihan bulanan</Button>}</div>} />
      {msg && <div className="mb-4"><Alert tone={msgTone}>{msg}</Alert></div>}
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status"><option value="">Semua status</option><option value="UNPAID">Belum bayar</option><option value="PARTIAL">Dicicil</option><option value="OVERDUE">Menunggak</option><option value="PAID">Lunas</option><option value="CANCELLED">Dibatalkan</option></Select>
        <Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Filter periode" />
        <Input placeholder="Cari nama / NIS" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari" />
      </div>
      {loading && <Loading />}{error && <Alert>{error}</Alert>}
      {data && (data.length === 0 ? <Empty>Tidak ada tagihan untuk filter ini.{isBend ? ' Klik "Buat tagihan bulanan" untuk membuat SPP bulan ini.' : ''}</Empty> : (
        <>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm text-navy-700">
            <span>{groups.length} santri · {data.length} tagihan</span>
            {groups.some((g) => g.list.length > 1) && <span className="flex gap-2"><button className="rounded px-2 py-1 underline" onClick={() => setOpenIds(new Set(groups.map((g) => g.santriId)))}>Buka semua</button><button className="rounded px-2 py-1 underline" onClick={() => setOpenIds(new Set())}>Tutup semua</button></span>}
          </div>
          <div className="rounded-card border border-navy-100 bg-white" data-testid="tagihan-groups">
            {groups.map((g) => <SantriGroup key={g.santriId} g={g} open={openIds.has(g.santriId)} onToggle={() => toggle(g.santriId)} repeatDays={rs.data?.repeatDays ?? 3} canRemind={canRemind} isBend={isBend} waBusy={waBusy === g.santriId} onWa={() => wa(g.santriId)} onPay={(i) => setModal(i)} onEdit={(i) => setModal({ edit: i })} />)}
          </div>
          {data.length >= 5000 && <p className="mt-2 text-sm text-amber-800">Menampilkan 5.000 tagihan pertama. Persempit dengan filter atau pencarian.</p>}
        </>
      ))}
      {modal === 'gen' && <Generate onClose={() => setModal(null)} onDone={(n, skipped) => { setModal(null); info((n > 0 ? `${n} tagihan dibuat.` : 'Tidak ada tagihan baru (periode ini sudah pernah dibuat).') + (skipped ? ` ${skipped} santri dilewati karena belum punya nominal SPP.` : '')); reload(); }} />}
      {modal === 'one' && <OneInvoice onClose={() => setModal(null)} onDone={() => { setModal(null); info('Tagihan dibuat.'); reload(); }} />}
      {modal && typeof modal === 'object' && 'edit' in modal && <EditInvoice inv={modal.edit} onClose={() => setModal(null)} onDone={() => { setModal(null); info('Tagihan diubah.'); reload(); }} />}
      {modal && modal !== 'gen' && modal !== 'one' && !('edit' in modal) && <Pay inv={modal} onClose={() => setModal(null)} onDone={async (pid) => { setModal(null); reload(); setReceipt(await api(`/billing/payments/${pid}`)); }} />}
      {receipt && <Receipt r={receipt} onClose={() => setReceipt(null)} />}
      {queue && <ReminderQueue onClose={() => setQueue(false)} onChanged={reload} onTemplate={() => setTpl(true)} />}
      {tpl && <TemplateEditor onClose={() => { setTpl(false); rs.reload(); reload(); }} />}
    </>
  );
}

function Generate({ onClose, onDone }: { onClose: () => void; onDone: (n: number, skipped: number) => void }) {
  const [per, setPer] = useState(false);
  const now = new Date(); const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [f, setF] = useState({ period: ym, title: 'SPP', amount: '', dueDate: `${ym}-10`, kelas: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api<{ created: number; skippedNoRate: number }>('/billing/generate', { method: 'POST', body: { period: f.period, title: f.title, ...(f.amount ? { amount: Number(f.amount) } : {}), dueDate: f.dueDate, kelas: f.kelas || undefined, usePerStudent: per } }); onDone(r.created, r.skippedNoRate); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Buat tagihan bulanan" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Alert tone="warn">Tagihan dibuat untuk semua santri aktif. Aman dijalankan ulang: santri yang sudah punya tagihan periode ini dilewati.</Alert>
        {err && <Alert>{err}</Alert>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Periode"><Input type="month" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} required /></Field>
          <Field label="Jenis biaya"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required /></Field>
          <Field label={per ? 'Nominal cadangan (Rp)' : 'Nominal (Rp)'} hint={per ? 'Dipakai untuk santri yang belum punya nominal SPP sendiri. Kosongkan untuk melewati mereka.' : undefined}><MoneyInput min={1000} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required={!per} /></Field>
          <Field label="Jatuh tempo"><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} required /></Field>
        </div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={per} onChange={(e) => setPer(e.target.checked)} /><span>Pakai nominal SPP masing-masing santri <span className="block text-xs text-navy-700">Nominal per santri diatur di halaman detail santri (kolom &quot;SPP per bulan&quot;).</span></span></label>
        <Field label="Khusus kelas" hint="Kosongkan untuk semua kelas"><Input value={f.kelas} onChange={(e) => setF({ ...f, kelas: e.target.value })} placeholder="Contoh: 7A" /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Batal</Button><Button disabled={busy}>{busy ? 'Membuat…' : 'Buat tagihan'}</Button></div>
      </form>
    </Modal>
  );
}

function Pay({ inv, onClose, onDone }: { inv: Inv; onClose: () => void; onDone: (paymentId: string) => void }) {
  const [amount, setAmount] = useState(String(inv.remaining)); const [method, setMethod] = useState('CASH'); const [note, setNote] = useState('');
  const [key] = useState(uuid); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api<{ paymentId: string }>('/billing/pay', { method: 'POST', body: { invoiceId: inv.id, amount: Number(amount), method, note: note || undefined, idempotencyKey: key } }); onDone(r.paymentId); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={`Terima pembayaran — ${inv.santriName}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="text-sm text-navy-700">{inv.title} {inv.period} · sisa tagihan <strong>{rupiah(inv.remaining)}</strong></div>
        {err && <Alert>{err}</Alert>}
        <Field label="Jumlah dibayar (Rp)" hint="Boleh kurang dari sisa (dicicil). Tidak boleh melebihi sisa."><MoneyInput min={1000} max={inv.remaining} value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus /></Field>
        <Field label="Metode"><Select value={method} onChange={(e) => setMethod(e.target.value)}><option value="CASH">Tunai di loket</option><option value="TRANSFER">Transfer bank (sudah dicek mutasi rekening)</option></Select></Field>
        <Field label="Catatan"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Batal</Button><Button disabled={busy}>{busy ? 'Menyimpan…' : 'Catat pembayaran'}</Button></div>
      </form>
    </Modal>
  );
}

function Receipt({ r, onClose }: { r: any; onClose: () => void }) {
  return (
    <Modal title="Kwitansi" onClose={onClose}>
      <div className="print-zone space-y-2 text-sm" data-zone="receipt">
        <div className="text-center"><div className="text-lg font-bold">E-QA — Kwitansi Pembayaran</div><div className="text-xs">(DEMO — bukan bukti pembayaran sungguhan)</div></div>
        <dl className="space-y-1">
          {[['No. kwitansi', r.receiptNumber], ['Tanggal', tanggalWaktu(r.paidAt)], ['Santri', `${r.santriName} (${r.nis})`], ['Pembayaran', `${r.title} ${r.period}`], ['No. tagihan', r.invoiceNumber], ['Metode', r.method === 'CASH' ? 'Tunai' : r.method === 'WALLET' ? 'Dari saldo' : 'Transfer'], ['Jumlah dibayar', rupiah(r.amount)], ['Total dibayar sampai kini', `${rupiah(r.paid)} dari ${rupiah(r.total)}`], ['Diterima oleh', r.receivedBy ?? '-']].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-b border-navy-50 py-1"><dt className="text-navy-700">{k}</dt><dd className="font-medium">{v}</dd></div>
          ))}
        </dl>
      </div>
      <div className="mt-4 flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Tutup</Button><Button onClick={() => { document.body.setAttribute('data-print', 'receipt'); window.print(); setTimeout(() => document.body.removeAttribute('data-print'), 500); }}>Cetak kwitansi</Button></div>
    </Modal>
  );
}

/** Tagihan untuk satu santri dengan nominal bebas (SPP yang berbeda, uang gedung, seragam, dll). */
function OneInvoice({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const now = new Date(); const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [q, setQ] = useState(''); const [pick, setPick] = useState<{ id: string; fullName: string; nis: string; kelas: string | null; sppAmount: number | null } | null>(null);
  const list = useApi<any[]>(q.trim().length >= 2 && !pick ? '/santri' : null, { q: q.trim() });
  const [f, setF] = useState({ period: ym, title: 'SPP', amount: '', dueDate: `${ym}-10` }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); if (!pick) return setErr('Pilih santri terlebih dahulu'); setBusy(true); setErr('');
    try { await api('/billing/invoices', { method: 'POST', body: { santriId: pick.id, period: f.period, title: f.title, amount: Number(f.amount), dueDate: f.dueDate } }); onDone(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Tagihan per santri" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {err && <Alert>{err}</Alert>}
        {!pick ? (
          <Field label="Cari santri" hint="Ketik minimal 2 huruf nama atau NIS">
            <div><Input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="Nama atau NIS" />
              {list.data && <ul className="mt-1 max-h-40 overflow-auto rounded-lg border border-navy-100 text-sm">{list.data.length === 0 ? <li className="p-2 text-navy-700">Tidak ditemukan</li> : list.data.slice(0, 20).map((s) => <li key={s.id}><button type="button" className="block w-full px-3 py-2 text-left hover:bg-navy-50" onClick={() => { setPick(s); setF((x) => ({ ...x, amount: s.sppAmount ? String(s.sppAmount) : x.amount })); }}>{s.fullName} <span className="text-navy-700">· {s.nis}{s.kelas ? ` · ${s.kelas}` : ''}</span></button></li>)}</ul>}</div>
          </Field>
        ) : <div className="flex items-center justify-between rounded-lg bg-navy-50 p-3 text-sm"><span><strong>{pick.fullName}</strong> · {pick.nis}</span><button type="button" className="text-teal-700 underline" onClick={() => setPick(null)}>Ganti</button></div>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Jenis biaya"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required /></Field>
          <Field label="Periode"><Input type="month" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} required /></Field>
          <Field label="Nominal (Rp)" hint={pick?.sppAmount ? `SPP santri ini: ${rupiah(pick.sppAmount)}` : undefined}><MoneyInput min={1000} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required /></Field>
          <Field label="Jatuh tempo"><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} required /></Field>
        </div>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Batal</Button><Button disabled={busy || !pick}>{busy ? 'Membuat…' : 'Buat tagihan'}</Button></div>
      </form>
    </Modal>
  );
}

/** Ubah tagihan yang sudah dibuat. Perubahan nominal wajib beralasan dan tercatat di audit log. */
function EditInvoice({ inv, onClose, onDone }: { inv: Inv; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ title: inv.title, dueDate: inv.dueDate.slice(0, 10), total: String(inv.total), reason: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const changedTotal = Number(f.total) !== inv.total;
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api(`/billing/invoices/${inv.id}`, { method: 'PATCH', body: { title: f.title, dueDate: f.dueDate, total: Number(f.total), ...(f.reason ? { reason: f.reason } : {}) } }); onDone(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={`Ubah tagihan — ${inv.santriName}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="text-sm text-navy-700">{inv.number} · sudah dibayar <strong>{rupiah(inv.paid)}</strong></div>
        {err && <Alert>{err}</Alert>}
        <Field label="Jenis biaya"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} required /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Total (Rp)" hint={`Tidak boleh kurang dari ${rupiah(inv.paid)} (yang sudah dibayar)`}><MoneyInput min={Math.max(1000, inv.paid)} value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} required /></Field>
          <Field label="Jatuh tempo"><Input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} required /></Field>
        </div>
        <Field label={changedTotal ? 'Alasan perubahan nominal (wajib)' : 'Alasan (opsional)'}><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required={changedTotal} minLength={changedTotal ? 3 : undefined} placeholder="Contoh: Penyesuaian SPP kelas 12" /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Batal</Button><Button disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan perubahan'}</Button></div>
      </form>
    </Modal>
  );
}

/** ====== Tagihan dikelompokkan per santri ====== */
interface Group { santriId: string; name: string; nis: string; kelas: string | null; list: Inv[]; overdue: Inv[]; remaining: number; status: string }
const RANK: Record<string, number> = { OVERDUE: 0, PARTIAL: 1, UNPAID: 2, PAID: 3, WAIVED: 4, CANCELLED: 5 };
function groupInvoices(data: Inv[]): Group[] {
  const m = new Map<string, Group>();
  for (const i of data) {
    let g = m.get(i.santriId);
    if (!g) { g = { santriId: i.santriId, name: i.santriName, nis: i.nis, kelas: i.kelas, list: [], overdue: [], remaining: 0, status: i.status }; m.set(i.santriId, g); }
    g.list.push(i);
    if (i.status === 'OVERDUE') g.overdue.push(i);
    if (['UNPAID', 'PARTIAL', 'OVERDUE'].includes(i.status)) g.remaining += i.remaining;
    if ((RANK[i.status] ?? 9) < (RANK[g.status] ?? 9)) g.status = i.status;
  }
  const out = [...m.values()];
  out.forEach((g) => g.list.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.period.localeCompare(b.period) || a.title.localeCompare(b.title)));
  return out.sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || a.name.localeCompare(b.name));
}
const jktDay = (d: Date | string) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
const hariTanggal = (d: Date) => d.toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Jakarta' }).replace(',', '');

/** Keterangan pengingat untuk satu santri (gabungan semua tagihannya yang menunggak). */
function RemindInfo({ g, repeatDays }: { g: Group; repeatDays: number }) {
  const od = g.overdue; if (!od.length) return null;
  const lasts = od.filter((i) => i.lastRemindedAt).map((i) => new Date(i.lastRemindedAt!).getTime());
  if (od.some((i) => i.remindState === 'NEVER')) return <div className="text-xs font-medium text-red-700">Belum diingatkan{lasts.length ? ' (ada tagihan baru)' : ''}</div>;
  const lastMax = new Date(Math.max(...lasts));
  if (od.some((i) => i.remindState === 'AGAIN')) return <div className="text-xs font-semibold text-amber-800">Perlu diingatkan lagi<span className="font-normal"> (terakhir {tanggal(lastMax.toISOString())})</span></div>;
  const today = jktDay(new Date()) === jktDay(lastMax);
  const next = new Date(Math.min(...lasts) + repeatDays * 86_400_000);
  return <div className="text-xs text-teal-700">Diingatkan {today ? 'hari ini' : tanggal(lastMax.toISOString())}{repeatDays > 0 ? <> · diingatkan lagi <strong>{hariTanggal(next)}</strong></> : ' · pengingat ulang dimatikan'}</div>;
}

function InvActions({ i, isBend, onPay, onEdit }: { i: Inv; isBend: boolean; onPay: (i: Inv) => void; onEdit: (i: Inv) => void }) {
  if (!isBend) return null;
  return <div className="flex gap-1">{['UNPAID', 'PARTIAL', 'OVERDUE'].includes(i.status) && <Button variant="secondary" onClick={() => onPay(i)}>Terima bayar</Button>}{i.status !== 'CANCELLED' && <Button variant="ghost" onClick={() => onEdit(i)}>Ubah</Button>}</div>;
}

function SantriGroup({ g, open, onToggle, repeatDays, canRemind, isBend, waBusy, onWa, onPay, onEdit }: { g: Group; open: boolean; onToggle: () => void; repeatDays: number; canRemind: boolean; isBend: boolean; waBusy: boolean; onWa: () => void; onPay: (i: Inv) => void; onEdit: (i: Inv) => void }) {
  const single = g.list.length === 1; const one = g.list[0];
  const sub = single
    ? <>{one.title} {one.period} · jatuh tempo {tanggal(one.dueDate)}<span className="hidden sm:inline"> · {one.number}</span></>
    : <>{g.list.length} tagihan{g.overdue.length ? ` · ${g.overdue.length} menunggak` : ''} · jatuh tempo terdekat {tanggal((g.list.find((i) => ['UNPAID', 'PARTIAL', 'OVERDUE'].includes(i.status)) ?? one).dueDate)}</>;
  const who = <><span className="font-medium">{g.name}</span><span className="block text-xs text-navy-700">{g.nis}{g.kelas ? ` · ${g.kelas}` : ''}</span><span className="block text-xs text-navy-700">{sub}</span></>;
  return (
    <div className="border-b border-navy-50 last:border-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        {single
          ? <div className="min-w-0 flex-1 basis-56 pl-6">{who}</div>
          : <button type="button" onClick={onToggle} aria-expanded={open} aria-label={`${open ? 'Tutup' : 'Buka'} tagihan ${g.name}`} className="flex min-w-0 flex-1 basis-56 items-start gap-2 rounded-lg text-left hover:bg-navy-50"><span className={`mt-0.5 inline-block w-4 shrink-0 text-xs text-navy-700 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} aria-hidden>▶</span><span className="min-w-0">{who}</span></button>}
        <div className="text-right text-sm"><div className="text-xs text-navy-700">Sisa</div><div className={g.overdue.length ? 'font-semibold text-red-700' : 'font-medium'}>{rupiah(g.remaining)}</div></div>
        <div className="min-w-[150px]"><div className="flex items-center gap-2"><Badge tone={STATUS_TAGIHAN[g.status].tone}>{STATUS_TAGIHAN[g.status].label}</Badge>{g.overdue.length > 0 && <RemindDot />}</div><RemindInfo g={g} repeatDays={repeatDays} /></div>
        <div className="flex flex-wrap justify-end gap-1">{canRemind && g.overdue.length > 0 && <Button variant="secondary" disabled={waBusy} onClick={onWa}>WhatsApp</Button>}{single && <InvActions i={one} isBend={isBend} onPay={onPay} onEdit={onEdit} />}</div>
      </div>
      {!single && open && (
        <div className="anim-pop divide-y divide-navy-50 border-t border-navy-50 bg-navy-50/40">
          {g.list.map((i) => (
            <div key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 pl-10 pr-4">
              <div className="min-w-0 flex-1 basis-44"><div className="text-sm font-medium">{i.title} {i.period}</div><div className="text-xs text-navy-700">{i.number} · jatuh tempo {tanggal(i.dueDate)}</div></div>
              <div className="text-right text-sm"><div className="text-xs text-navy-700">Total {rupiah(i.total)}</div><div className={i.status === 'OVERDUE' ? 'font-semibold text-red-700' : ''}>Sisa {rupiah(i.remaining)}</div></div>
              <div className="min-w-[110px]"><Badge tone={STATUS_TAGIHAN[i.status].tone}>{STATUS_TAGIHAN[i.status].label}</Badge></div>
              <InvActions i={i} isBend={isBend} onPay={onPay} onEdit={onEdit} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
