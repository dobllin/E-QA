'use client';
import { FormEvent, useState } from 'react';
import { api, apiBlobUrl, apiUpload, errMsg, getSession } from '@/lib/api';
import { accountNumber, rupiah, tanggalWaktu } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { useEffect } from 'react';
import { FeeReminder } from '@/components/FeeReminder';
import { Alert, Badge, Button, Card, Empty, Field, Input, Loading, Modal, PageHeader, Select, Stat, Table, Td, MoneyInput } from '@/components/ui';

interface Req { id: string; amount: number; uniqueCode: number; fee: number; total: number; credited: number; status: string; matchedRef: string | null; note: string | null; expiresAt: string; createdAt: string; santriName: string; nis: string; requestedBy: string; proofs: number; proofMatch: boolean; receivedAmount: number | null }
interface Settings { fee: number; min: number; max: number; expiryHours: number; bankInfo: string; bankName: string; bankAccount: string; bankHolder: string; tolerance: number; hasQris: boolean }
const STATUS: Record<string, { label: string; tone: 'ok' | 'warn' | 'bad' | 'muted' | 'info' }> = {
  PENDING: { label: 'Menunggu transfer', tone: 'warn' }, MATCHED: { label: 'Mutasi cocok', tone: 'info' }, CREDITED: { label: 'Saldo masuk', tone: 'ok' },
  REJECTED: { label: 'Ditolak', tone: 'bad' }, EXPIRED: { label: 'Kedaluwarsa', tone: 'muted' }, CANCELLED: { label: 'Dibatalkan', tone: 'muted' },
};

/** Baca CSV sederhana (pemisah , ; atau tab, mendukung tanda kutip). */
function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/)[0] ?? '';
  const delim = [';', '\t', ','].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = []; let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === delim) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}
/** "51.717,00" / "51,717.00" / "Rp 51.717" / "51717" → 51717 */
function parseAmount(raw: string): number | null {
  const s = raw.replace(/[^\d.,]/g, ''); if (!s) return null;
  const dec = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
  const n = dec >= 0 && s.length - dec - 1 === 2 ? Number(s.slice(0, dec).replace(/[.,]/g, '')) : Number(s.replace(/[.,]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default function TopupPage() {
  const role = getSession()?.user.role ?? '';
  const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(role); const isBend = ['SUPER_ADMIN', 'BENDAHARA'].includes(role);
  const [status, setStatus] = useState('');
  const list = useApi<Req[]>('/topups', { status: status || undefined });
  const settings = useApi<Settings>(isAdmin ? '/topups/settings' : null);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const report = useApi<{ count: number; feeTotal: number; creditedTotal: number }>('/topups/report', { month });
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [modal, setModal] = useState<'settings' | 'import' | { manual: Req } | { reject: Req } | { proof: Req } | null>(null);
  const reloadAll = () => { list.reload(); report.reload(); };

  async function approve(r: Req, note?: string, received?: number) {
    setMsg(null);
    try { const x = await api<{ credited: number }>(`/topups/${r.id}/approve`, { method: 'POST', body: { ...(note ? { note } : {}), ...(received ? { receivedAmount: received } : {}) } }); setMsg({ tone: 'ok', text: `Saldo ${r.santriName} bertambah ${rupiah(x.credited)}.` }); setModal(null); reloadAll(); }
    catch (e) { setMsg({ tone: 'bad', text: errMsg(e) }); }
  }
  const matched = (list.data ?? []).filter((r) => r.status === 'MATCHED');
  async function approveAll() {
    setMsg(null); let ok = 0, fail = 0;
    for (const r of matched) { try { await api(`/topups/${r.id}/approve`, { method: 'POST', body: {} }); ok++; } catch { fail++; } }
    setMsg({ tone: fail ? 'bad' : 'ok', text: `${ok} top up disetujui${fail ? `, ${fail} gagal` : ''}.` }); reloadAll();
  }

  return (
    <>
      <PageHeader title="Top up masuk" sub="Wali transfer ke rekening pesantren dengan nominal unik. Unggah mutasi bank untuk mencocokkan, lalu setujui."
        action={<div className="flex gap-2">{isBend && <Button onClick={() => setModal('import')}>Unggah mutasi bank</Button>}{isAdmin && <Button variant="secondary" onClick={() => setModal('settings')}>Pengaturan</Button>}</div>} />
      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <FeeReminder />

      <div className="mb-2 flex items-center gap-2 text-sm"><span className="text-navy-700">Ringkasan bulan</span><Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="!w-auto" aria-label="Bulan laporan" /></div>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Top up selesai" value={report.data?.count ?? '-'} />
        <Stat label="Saldo masuk ke santri" value={rupiah(report.data?.creditedTotal)} />
        <Stat label="Biaya layanan terkumpul" value={rupiah(report.data?.feeTotal)} sub="Dasar tagihan jasa aplikasi ke pesantren" />
      </div>

      {isBend && matched.length > 0 && <div className="mb-4 flex items-center justify-between rounded-card border border-sky-200 bg-sky-50 p-4 text-sm"><span>{matched.length} top up sudah cocok dengan mutasi bank dan siap disetujui.</span><Button onClick={approveAll}>Setujui semua yang cocok</Button></div>}

      <div className="mb-3 max-w-xs"><Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter status"><option value="">Semua status</option>{Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></div>
      {list.loading && <Loading />}{list.error && <Alert>{list.error}</Alert>}
      {list.data && (list.data.length === 0 ? <Empty>Belum ada permintaan top up.</Empty> : (
        <div className="rounded-card border border-navy-100 bg-white">
          <Table head={['Santri', 'Transfer', 'Saldo masuk', 'Fee', 'Status', 'Dibuat', '']}>
            {list.data.map((r) => (
              <tr key={r.id}>
                <Td><div className="font-medium">{r.santriName}</div><div className="text-xs text-navy-700">{r.nis} · oleh {r.requestedBy}</div></Td>
                <Td right className="font-semibold">{rupiah(r.total)}{r.receivedAmount && r.receivedAmount !== r.total && <div className="text-xs font-normal text-navy-700">Diterima {rupiah(r.receivedAmount)} ({r.receivedAmount > r.total ? 'lebih' : 'kurang'} {rupiah(Math.abs(r.receivedAmount - r.total))})</div>}</Td><Td right>{rupiah(r.credited)}</Td><Td right>{rupiah(r.fee)}</Td>
                <Td><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>{r.matchedRef && <div className="mt-1 max-w-[220px] truncate text-xs text-navy-700" title={r.matchedRef}>{r.matchedRef}</div>}
                  {r.proofs > 0 && <div className="mt-1"><button type="button" className="text-xs text-teal-700 underline" onClick={() => setModal({ proof: r })}>Lihat bukti ({r.proofs}){r.proofMatch ? ' · nominal sesuai' : ' · nominal belum cocok'}</button></div>}</Td>
                <Td>{tanggalWaktu(r.createdAt)}</Td>
                <Td right>{isBend && <div className="flex justify-end gap-1">
                  {r.status === 'MATCHED' && <Button variant="secondary" onClick={() => approve(r)}>Setujui</Button>}
                  {r.status === 'PENDING' && <Button variant="ghost" onClick={() => setModal({ manual: r })}>Setujui manual</Button>}
                  {['PENDING', 'MATCHED'].includes(r.status) && <Button variant="ghost" onClick={() => setModal({ reject: r })}>Tolak</Button>}
                </div>}</Td>
              </tr>
            ))}
          </Table>
        </div>
      ))}

      {modal === 'settings' && isAdmin && settings.data && <SettingsModal s={settings.data} canEdit={isAdmin} onChanged={settings.reload} onClose={() => setModal(null)} onDone={() => { setModal(null); settings.reload(); setMsg({ tone: 'ok', text: 'Pengaturan disimpan.' }); }} />}
      {modal === 'import' && <ImportModal onClose={() => setModal(null)} onDone={(t) => { setModal(null); setMsg({ tone: 'ok', text: t }); reloadAll(); }} />}
      {modal && typeof modal === 'object' && 'proof' in modal && <ProofModal r={modal.proof} onClose={() => setModal(null)} />}
      {modal && typeof modal === 'object' && 'manual' in modal && <ManualModal r={modal.manual} fee={modal.manual.fee} onClose={() => setModal(null)} onSubmit={(n, rec) => approve((modal as any).manual, n, rec)} />}
      {modal && typeof modal === 'object' && 'reject' in modal && <NoteModal title={`Tolak — ${modal.reject.santriName}`} hint="Alasan penolakan." button="Tolak permintaan" danger onClose={() => setModal(null)} onSubmit={async (n) => { try { await api(`/topups/${(modal as any).reject.id}/reject`, { method: 'POST', body: { note: n } }); setModal(null); reloadAll(); } catch (e) { setMsg({ tone: 'bad', text: errMsg(e) }); setModal(null); } }} />}
    </>
  );
}

function NoteModal({ title, hint, button, danger, onClose, onSubmit }: { title: string; hint: string; button: string; danger?: boolean; onClose: () => void; onSubmit: (n: string) => void }) {
  const [n, setN] = useState('');
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(n); }} className="space-y-3">
        <Field label="Catatan" hint={hint}><Input value={n} onChange={(e) => setN(e.target.value)} required minLength={3} autoFocus /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Batal</Button><Button variant={danger ? 'danger' : 'primary'}>{button}</Button></div>
      </form>
    </Modal>
  );
}

function SettingsModal({ s, canEdit, onClose, onDone, onChanged }: { s: Settings; canEdit: boolean; onClose: () => void; onDone: () => void; onChanged: () => void }) {
  const [f, setF] = useState({ fee: String(s.fee), min: String(s.min), max: String(s.max), expiryHours: String(s.expiryHours), bankInfo: s.bankInfo, bankName: s.bankName ?? '', bankAccount: s.bankAccount || accountNumber(s), bankHolder: s.bankHolder ?? '', tolerance: String(s.tolerance) }); const [err, setErr] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    try { await api('/topups/settings', { method: 'PUT', body: { fee: Number(f.fee), min: Number(f.min), max: Number(f.max), expiryHours: Number(f.expiryHours), bankName: f.bankName, bankAccount: f.bankAccount, bankHolder: f.bankHolder, tolerance: Number(f.tolerance) } }); onDone(); } catch (e) { setErr(errMsg(e)); }
  }
  return (
    <Modal title="Pengaturan top up" onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-3">
        {!canEdit && <Alert tone="warn">Hanya Admin yang bisa mengubah pengaturan ini.</Alert>}
        {err && <Alert>{err}</Alert>}
        <div className="rounded-lg border border-navy-100 p-3">
          <div className="mb-2 text-sm font-medium text-navy-800">Rekening tujuan top up (tampil ke wali, bisa disalin)</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nama bank"><Input disabled={!canEdit} value={f.bankName} onChange={(e) => setF({ ...f, bankName: e.target.value })} placeholder="Contoh: Bank Mandiri" required /></Field>
            <Field label="Nomor rekening" hint="Hanya angka"><Input disabled={!canEdit} inputMode="numeric" value={f.bankAccount} onChange={(e) => setF({ ...f, bankAccount: e.target.value.replace(/[^0-9 .-]/g, '') })} required /></Field>
          </div>
          <div className="mt-3"><Field label="Atas nama" hint="Harus rekening ATAS NAMA PESANTREN."><Input disabled={!canEdit} value={f.bankHolder} onChange={(e) => setF({ ...f, bankHolder: e.target.value })} required /></Field></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Biaya layanan per top up (Rp)" hint="Ditambahkan DI ATAS nominal. Saldo santri tetap utuh. Isi 0 bila tidak ada."><MoneyInput min={0} max={20000} disabled={!canEdit} value={f.fee} onChange={(e) => setF({ ...f, fee: e.target.value })} required /></Field>
          <Field label="Kedaluwarsa (jam)"><Input type="number" min={1} max={168} disabled={!canEdit} value={f.expiryHours} onChange={(e) => setF({ ...f, expiryHours: e.target.value })} required /></Field>
          <Field label="Minimal top up (Rp)"><MoneyInput min={1000} disabled={!canEdit} value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} required /></Field>
          <Field label="Maksimal top up (Rp)"><MoneyInput min={1000} disabled={!canEdit} value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} required /></Field>
        </div>
        <Field label="Toleransi kelebihan transfer (Rp)" hint="Transfer yang LEBIH dari total sampai batas ini tetap dikenali otomatis, dan seluruh jumlah yang diterima (dikurangi biaya layanan) masuk saldo. Kurang dari total tidak dicocokkan otomatis. Isi 0 untuk wajib persis sama."><MoneyInput min={0} max={20000} disabled={!canEdit} value={f.tolerance} onChange={(e) => setF({ ...f, tolerance: e.target.value })} required /></Field>
        <QrisBox has={s.hasQris} canEdit={canEdit} onChanged={onChanged} />
        <p className="text-xs text-navy-700">Biaya layanan harus disepakati tertulis dengan pesantren dan ditampilkan jelas ke wali sebelum membayar. Uang biaya ini masuk ke rekening pesantren bersama transfer wali, bukan ke saldo santri.</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Tutup</Button>{canEdit && <Button>Simpan pengaturan</Button>}</div>
      </form>
    </Modal>
  );
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: (t: string) => void }) {
  const [rows, setRows] = useState<string[][]>([]); const [col, setCol] = useState(0); const [skipDebit, setSkipDebit] = useState(true); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const header = rows[0] ?? []; const hasHeader = header.length > 0 && header.every((h) => parseAmount(h) === null || /[a-z]/i.test(h));
  const body = hasHeader ? rows.slice(1) : rows;
  async function pick(f: File | undefined) {
    if (!f) return; setErr('');
    const parsed = parseCsv(await f.text());
    if (parsed.length === 0) return setErr('File kosong atau tidak terbaca.');
    setRows(parsed);
    const h = parsed[0]; const guess = h.findIndex((x) => /jumlah|amount|kredit|credit|nominal|mutasi|cr$/i.test(x));
    setCol(guess >= 0 ? guess : Math.max(0, h.length - 1));
  }
  const lines = body.map((r) => {
    if (skipDebit && r.some((c) => /^(db|debit|d)$/i.test(c.trim()))) return null;
    const amount = parseAmount(r[col] ?? ''); if (!amount || amount < 1000) return null;
    return { ref: r.join(' | ').slice(0, 290), amount };
  }).filter(Boolean) as { ref: string; amount: number }[];
  async function run() {
    setBusy(true); setErr('');
    try { const r = await api<{ matched: number; duplicates: number; unmatched: number; ambiguous: number }>('/topups/match', { method: 'POST', body: { lines } }); onDone(`${r.matched} mutasi cocok dengan permintaan top up. ${r.ambiguous} tidak bisa ditentukan karena ada beberapa permintaan yang mirip (proses manual). ${r.duplicates} baris sudah pernah diimpor, ${r.unmatched} tidak cocok dengan permintaan mana pun.`); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Unggah mutasi bank" onClose={onClose} wide>
      <div className="space-y-3">
        <Alert tone="warn">Unduh mutasi rekening pesantren dari internet banking (CSV). Sistem hanya mencocokkan nominal transfer yang persis sama dengan permintaan top up. Saldo belum masuk sebelum Anda menyetujui.</Alert>
        {err && <Alert>{err}</Alert>}
        <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(e) => pick(e.target.files?.[0])} aria-label="File mutasi" />
        {rows.length > 0 && (
          <>
            <Field label="Kolom yang berisi jumlah uang"><Select value={col} onChange={(e) => setCol(Number(e.target.value))}>{(rows[0] ?? []).map((h, i) => <option key={i} value={i}>{hasHeader ? h || `Kolom ${i + 1}` : `Kolom ${i + 1} (contoh: ${rows[0][i]})`}</option>)}</Select></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={skipDebit} onChange={(e) => setSkipDebit(e.target.checked)} /> Abaikan baris bertanda DB / debit (uang keluar)</label>
            <div className="max-h-40 overflow-auto rounded-lg border border-navy-100 text-xs"><Table head={['Contoh baris', 'Terbaca sebagai']}>{body.slice(0, 5).map((r, i) => <tr key={i}><Td className="max-w-[380px] truncate">{r.join(' | ')}</Td><Td right>{parseAmount(r[col] ?? '') ? rupiah(parseAmount(r[col] ?? '')!) : '-'}</Td></tr>)}</Table></div>
            <p className="text-sm text-navy-700">{lines.length} baris uang masuk akan dicocokkan.</p>
          </>
        )}
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Batal</Button><Button onClick={run} disabled={busy || lines.length === 0}>{busy ? 'Mencocokkan…' : 'Cocokkan sekarang'}</Button></div>
      </div>
    </Modal>
  );
}

function ProofModal({ r, onClose }: { r: Req; onClose: () => void }) {
  const [items, setItems] = useState<{ id: string; createdAt: string; amountMatch: boolean; ocrAmounts: number[]; url?: string }[] | null>(null); const [err, setErr] = useState('');
  useEffect(() => {
    let urls: string[] = [];
    (async () => {
      try {
        const list = await api<any[]>(`/topups/${r.id}/proofs`);
        const withUrl = await Promise.all(list.map(async (p) => { const url = await apiBlobUrl(`/topups/proofs/${p.id}/image`); urls.push(url); return { ...p, url }; }));
        setItems(withUrl);
      } catch (e) { setErr(errMsg(e)); }
    })();
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [r.id]);
  return (
    <Modal title={`Bukti transfer — ${r.santriName}`} onClose={onClose} wide>
      <div className="space-y-3">
        <Alert tone="warn">Foto bisa diedit. <strong>Setujui hanya jika uang {rupiah(r.total)} terlihat di mutasi rekening pesantren.</strong> Pembukaan foto tercatat di audit log.</Alert>
        {err && <Alert>{err}</Alert>}
        {!items && !err && <Loading />}
        {items?.map((p) => (
          <div key={p.id} className="rounded-lg border border-navy-100 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm"><span>{tanggalWaktu(p.createdAt)}</span>{p.amountMatch ? <Badge tone="ok">Nominal di foto sesuai</Badge> : <Badge tone="warn">Nominal di foto belum cocok</Badge>}</div>
            {p.url && <img src={p.url} alt="Bukti transfer" className="max-h-[60vh] w-full rounded object-contain" />}
            <div className="mt-2 text-xs text-navy-700">Angka terbaca: {p.ocrAmounts.length ? p.ocrAmounts.map(rupiah).join(', ') : 'tidak ada'} · Diminta: {rupiah(r.total)}</div>
          </div>
        ))}
        <div className="flex justify-end"><Button onClick={onClose}>Tutup</Button></div>
      </div>
    </Modal>
  );
}

function QrisBox({ has, canEdit, onChanged }: { has: boolean; canEdit: boolean; onChanged: () => void }) {
  const [url, setUrl] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    let u = ''; let alive = true;
    if (has) apiBlobUrl('/topups/qris').then((x) => { u = x; if (alive) setUrl(x); }).catch(() => {}); else setUrl('');
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [has]);
  async function upload(f: File | undefined) {
    if (!f) return; setErr('');
    if (f.size > 2 * 1024 * 1024) return setErr('Ukuran gambar maksimal 2 MB.');
    setBusy(true);
    try { const fd = new FormData(); fd.append('file', f); await apiUpload('/topups/qris', fd, 'PUT'); onChanged(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  async function remove() { setBusy(true); try { await api('/topups/qris', { method: 'DELETE' }); onChanged(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } }
  return (
    <div className="rounded-lg border border-navy-100 p-3 text-sm">
      <div className="font-medium">Gambar QRIS pesantren (opsional)</div>
      <p className="mb-2 text-xs text-navy-700">Unggah QRIS statis dari bank atau aplikasi merchant. Tampil di layar top up wali. Wali memasukkan nominal tepat sesuai total. Catatan: mutasi QRIS di rekening biasanya sudah dipotong biaya dan bisa digabung; untuk mencocokkan pakai laporan transaksi dari aplikasi merchant.</p>
      {err && <Alert>{err}</Alert>}
      {url && <img src={url} alt="QRIS pesantren" className="mb-2 max-h-48 rounded border border-navy-100" />}
      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Gambar QRIS" disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
          {has && <Button type="button" variant="ghost" onClick={remove} disabled={busy}>Hapus QRIS</Button>}
        </div>
      ) : <p className="text-xs text-navy-700">Hanya Admin yang bisa mengubah QRIS.</p>}
    </div>
  );
}

function ManualModal({ r, fee, onClose, onSubmit }: { r: Req; fee: number; onClose: () => void; onSubmit: (note: string, received?: number) => void }) {
  const [note, setNote] = useState(''); const [rec, setRec] = useState(String(r.total));
  const received = Number(rec) || 0; const diff = received !== r.total;
  return (
    <Modal title={`Setujui manual — ${r.santriName}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(note, diff ? received : undefined); }} className="space-y-3">
        <Alert tone="warn">Belum ada mutasi yang cocok. Isi bukti verifikasi, misalnya nomor bukti transfer yang sudah Anda cek di rekening.</Alert>
        <Field label="Jumlah yang masuk di rekening (Rp)" hint={`Diminta ${rupiah(r.total)}. Saldo santri yang masuk = jumlah diterima dikurangi biaya layanan ${rupiah(fee)}.`}><MoneyInput min={1000} value={rec} onChange={(e) => setRec(e.target.value)} required /></Field>
        <div className="rounded-lg bg-navy-50 p-3 text-sm">Saldo yang akan masuk: <strong>{rupiah(Math.max(0, received - fee))}</strong>{diff && <span className="text-amber-800"> · berbeda dari yang diminta, catatan wajib</span>}</div>
        <Field label="Catatan / nomor bukti"><Input value={note} onChange={(e) => setNote(e.target.value)} required minLength={3} autoFocus /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Batal</Button><Button>Setujui & masukkan saldo</Button></div>
      </form>
    </Modal>
  );
}
