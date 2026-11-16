'use client';
import { useParams } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { api, errMsg, getSession } from '@/lib/api';
import { JENIS_MUTASI, POCKET_LABEL, rupiah, STATUS_KARTU, STATUS_TAGIHAN, tanggal, tanggalWaktu, uuid } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { CardPrint, CardView, IssuedCard } from '@/components/CardPrint';
import { Alert, Badge, Button, Card, Empty, Field, Input, Loading, Modal, PageHeader, Select, Table, Td, MoneyInput } from '@/components/ui';

interface Detail { id: string; nis: string; fullName: string; kelas: string | null; statusLabel?: string | null; bagian?: string | null; catatan?: string | null; status: string; balance: number; sppAmount: number | null; pockets: Record<string, number> | null; dailyLimit: number | null; perTxLimit: number | null; walsan: { userId: string; fullName: string; username: string; relation: string }[] }
interface CardRow { id: string; publicNumber: string; status: string; reason: string | null; pinMustChange: boolean; createdAt: string; events: { event: string; reason: string | null; at: string }[] }
const STATUS_SANTRI: Record<string, string> = { ACTIVE: 'Aktif', INACTIVE: 'Tidak aktif', GRADUATED: 'Lulus', ARCHIVED: 'Diarsipkan' };
const EVENT_LABEL: Record<string, string> = { ISSUED: 'Kartu diterbitkan', SUSPENDED: 'Dinonaktifkan sementara', UNSUSPENDED: 'Diaktifkan kembali', LOCKED: 'Terkunci otomatis', UNLOCKED: 'Kunci dibuka admin', PIN_RESET: 'PIN direset', PIN_CHANGED: 'PIN diganti santri', REPLACED: 'Diganti kartu baru' };

export default function SantriDetail() {
  const { id } = useParams<{ id: string }>();
  const role = getSession()?.user.role ?? '';
  const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(role);
  const isBend = ['SUPER_ADMIN', 'BENDAHARA'].includes(role);
  const d = useApi<Detail>(`/santri/${id}`);
  const cards = useApi<CardRow[]>(isAdmin || isBend ? '/cards' : null, { santriId: id });
  const ledger = useApi<any[]>(isAdmin || isBend ? `/wallet/${id}/ledger` : null);
  const invoices = useApi<any[]>(isAdmin || isBend ? '/billing/invoices' : null, { santriId: id });
  const [modal, setModal] = useState<string | null>(null);
  const [issued, setIssued] = useState<IssuedCard | null>(null);
  const [viewCard, setViewCard] = useState<{ publicNumber: string; barcodeToken: string; santri: { fullName: string; nis: string; kelas: string | null } } | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const reloadAll = () => { d.reload(); cards.reload(); ledger.reload(); invoices.reload(); };
  if (d.loading) return <Loading />;
  if (d.error || !d.data) return <Alert>{d.error ?? 'Santri tidak ditemukan'}</Alert>;
  const s = d.data;
  const live = cards.data?.find((c) => ['ACTIVE', 'SUSPENDED', 'LOCKED'].includes(c.status)) ?? null;

  async function act(path: string, body?: unknown, after?: (r: any) => void) {
    setMsg(null);
    try { const r = await api(path, { method: 'POST', body }); after?.(r); setModal(null); reloadAll(); }
    catch (e) { setMsg({ tone: 'bad', text: errMsg(e) }); }
  }

  return (
    <>
      <PageHeader title={s.fullName} sub={`No. ${s.nis}${s.kelas ? ` · Kelas ${s.kelas}` : ''}${s.statusLabel ? ` · ${s.statusLabel}` : ''}${s.bagian ? ` · ${s.bagian}` : ''}${s.catatan ? ` · ${s.catatan}` : ''}${s.status !== 'ACTIVE' ? ` · ${STATUS_SANTRI[s.status] ?? s.status}` : ''}`} action={isAdmin && <Button variant="secondary" onClick={() => setModal('edit')}>Ubah data santri</Button>} />
      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Saldo jajan" action={isBend && <Button variant="secondary" onClick={() => setModal('topup')}>Top up</Button>}>
          <div className="text-3xl font-semibold tabular-nums">{rupiah(s.balance)}</div>
          {s.pockets && <div className="mt-2 flex flex-wrap gap-2 text-xs text-navy-700">{(['SALDO', 'LAUNDRY'] as const).map((k) => <span key={k} className="rounded-full bg-navy-50 px-2.5 py-0.5">{POCKET_LABEL[k]}: {rupiah(s.pockets![k] ?? 0)}</span>)}</div>}
          <dl className="mt-3 space-y-1 text-sm text-navy-700">
            <div className="flex justify-between"><dt>Batas belanja per hari</dt><dd>{s.dailyLimit ? rupiah(s.dailyLimit) : 'Tanpa batas'}</dd></div>
            <div className="flex justify-between"><dt>Batas per transaksi</dt><dd>{s.perTxLimit ? rupiah(s.perTxLimit) : 'Tanpa batas'}</dd></div>
          </dl>
          {(isBend || isAdmin) && <Button variant="ghost" className="mt-3 -ml-3" onClick={() => setModal('limits')}>Atur batas belanja</Button>}
        </Card>

        <Card title="Kartu & PIN">
          {!live ? <p className="mb-3 text-sm text-navy-700">Santri belum punya kartu aktif.</p> : (
            <div className="mb-3 space-y-1 text-sm">
              <div className="flex items-center gap-2"><span className="font-medium">{live.publicNumber}</span><Badge tone={STATUS_KARTU[live.status].tone}>{STATUS_KARTU[live.status].label}</Badge></div>
              {live.reason && <div className="text-navy-700">Alasan: {live.reason}</div>}
              {live.pinMustChange && <div className="text-amber-800">PIN awal belum diganti santri.</div>}
            </div>
          )}
          {isAdmin && (
            <div className="flex flex-wrap gap-2">
              {!live && <Button onClick={() => setModal('issue')}>Terbitkan kartu</Button>}
              {live?.status === 'ACTIVE' && <Button variant="secondary" onClick={() => setModal('suspend')}>Nonaktifkan sementara</Button>}
              {live?.status === 'SUSPENDED' && <Button variant="secondary" onClick={() => act(`/cards/${live.id}/unsuspend`)}>Aktifkan kembali</Button>}
              {live?.status === 'LOCKED' && <Button variant="secondary" onClick={() => act(`/cards/${live.id}/unlock`)}>Buka kunci</Button>}
              {live && <Button variant="secondary" onClick={async () => { setMsg(null); try { setViewCard(await api(`/cards/${live.id}/preview`)); } catch (e) { setMsg({ tone: 'bad', text: errMsg(e) }); } }}>Lihat kartu</Button>}
              {live && <Button variant="secondary" onClick={() => setModal('resetpin')}>Reset PIN</Button>}
              {live && <Button variant="danger" onClick={() => setModal('replace')}>Kartu hilang / ganti</Button>}
            </div>
          )}
        </Card>
      </div>

      {(isBend || isAdmin) && <Card title="SPP per bulan" className="mt-4" action={<Button variant="secondary" onClick={() => setModal('spp')}>Atur nominal</Button>}>
        <div className="text-sm">{s.sppAmount ? <><span className="text-2xl font-semibold tabular-nums">{rupiah(s.sppAmount)}</span><span className="ml-2 text-navy-700">per bulan, dipakai saat membuat tagihan massal "per santri".</span></> : <span className="text-navy-700">Belum diatur khusus (mengikuti nominal umum saat membuat tagihan).</span>}</div>
      </Card>}

      <Card title="Wali santri" className="mt-4" action={isAdmin && <Button variant="secondary" onClick={() => setModal('walsan')}>Hubungkan wali</Button>}>
        {s.walsan.length === 0 ? <Empty>Belum ada wali yang terhubung. Wali tidak bisa melihat data anak sebelum dihubungkan.</Empty> : (
          <ul className="divide-y divide-navy-50 text-sm">
            {s.walsan.map((w) => (
              <li key={w.userId} className="flex items-center justify-between py-2">
                <span><span className="font-medium">{w.fullName}</span> <span className="text-navy-700">({w.relation}, @{w.username})</span></span>
                {isAdmin && <Button variant="ghost" onClick={async () => { await api(`/santri/${id}/walsan/${w.userId}`, { method: 'DELETE' }); reloadAll(); }}>Lepas</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {(isAdmin || isBend) && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card title="Riwayat saldo">
            {ledger.data?.length ? <Table head={['Waktu', 'Jenis', 'Jumlah', 'Saldo']}>{ledger.data.slice(0, 15).map((l) => (
              <tr key={l.id}><Td>{tanggalWaktu(l.createdAt)}</Td><Td>{JENIS_MUTASI[l.type]}</Td><Td right className={l.direction === 'DEBIT' ? 'text-red-700' : 'text-teal-700'}>{l.direction === 'DEBIT' ? '−' : '+'}{rupiah(l.amount)}</Td><Td right>{rupiah(l.balanceAfter)}</Td></tr>
            ))}</Table> : <Empty>Belum ada mutasi.</Empty>}
          </Card>
          <Card title="Tagihan">
            {invoices.data?.length ? <Table head={['Tagihan', 'Jatuh tempo', 'Sisa', 'Status']}>{invoices.data.map((i) => (
              <tr key={i.id}><Td>{i.title} {i.period}</Td><Td>{tanggal(i.dueDate)}</Td><Td right>{rupiah(i.remaining)}</Td><Td><Badge tone={STATUS_TAGIHAN[i.status].tone}>{STATUS_TAGIHAN[i.status].label}</Badge></Td></tr>
            ))}</Table> : <Empty>Belum ada tagihan.</Empty>}
          </Card>
        </div>
      )}

      {cards.data && cards.data.length > 0 && (
        <Card title="Riwayat kartu" className="mt-4">
          <ul className="space-y-3 text-sm">
            {cards.data.map((c) => (
              <li key={c.id}><div className="font-medium">{c.publicNumber} <Badge tone={STATUS_KARTU[c.status].tone}>{STATUS_KARTU[c.status].label}</Badge></div>
                <ul className="mt-1 space-y-0.5 text-navy-700">{c.events.map((e, i) => <li key={i}>{tanggalWaktu(e.at)} — {EVENT_LABEL[e.event] ?? e.event}{e.reason ? ` (${e.reason})` : ''}</li>)}</ul></li>
            ))}
          </ul>
        </Card>
      )}

      {modal === 'topup' && <TopupModal santriId={id} onClose={() => setModal(null)} onDone={() => { setModal(null); setMsg({ tone: 'ok', text: 'Top up berhasil dicatat.' }); reloadAll(); }} />}
      {modal === 'edit' && <EditSantriModal s={s} onClose={() => setModal(null)} onDone={() => { setModal(null); setMsg({ tone: 'ok', text: 'Data santri disimpan.' }); reloadAll(); }} />}
      {modal === 'spp' && <SppModal santriId={id} current={s.sppAmount} onClose={() => setModal(null)} onDone={() => { setModal(null); reloadAll(); }} />}
      {modal === 'limits' && <LimitsModal santriId={id} d={s} onClose={() => setModal(null)} onDone={() => { setModal(null); reloadAll(); }} />}
      {modal === 'suspend' && live && <ReasonModal title="Nonaktifkan kartu sementara" button="Nonaktifkan kartu" placeholder="Contoh: Kartu hilang, menunggu kartu pengganti" onClose={() => setModal(null)} onSubmit={(reason) => act(`/cards/${live.id}/suspend`, { reason })} />}
      {modal === 'issue' && <PinChoiceModal title="Terbitkan kartu" button="Terbitkan kartu" onClose={() => setModal(null)} onSubmit={(v) => act('/cards/issue', { santriId: id, ...v }, (r) => setIssued({ ...r, pinMustChange: v.mustChange }))} />}
      {modal === 'resetpin' && live && <PinChoiceModal title="Reset PIN" button="Buat PIN baru" onClose={() => setModal(null)} onSubmit={(v) => act(`/cards/${live.id}/reset-pin`, v, (r) => setIssued({ publicNumber: live.publicNumber, barcodeToken: '', initialPin: r.initialPin, pinMustChange: v.mustChange }))} />}
      {modal === 'replace' && live && <PinChoiceModal title="Ganti kartu" button="Ganti kartu" danger reasonPlaceholder="Contoh: Hilang di asrama" note="Kode QR lama langsung mati permanen. Saldo otomatis ikut ke kartu baru." onClose={() => setModal(null)} onSubmit={(v) => act(`/cards/${live.id}/replace`, v, (r) => setIssued({ ...r, pinMustChange: v.mustChange }))} />}
      {modal === 'walsan' && <WalsanModal santriId={id} onClose={() => setModal(null)} onDone={() => { setModal(null); reloadAll(); }} />}
      {viewCard && (
        <Modal title={`Kartu ${viewCard.santri.fullName}`} onClose={() => setViewCard(null)} wide>
          <Alert tone="warn">Setiap kali kartu dibuka, tercatat di audit log. Jangan tampilkan QR di layar yang dilihat orang lain.</Alert>
          <div className="mt-4"><CardView santri={viewCard.santri} card={viewCard} /></div>
        </Modal>
      )}
      {issued && (
        <Modal title={issued.barcodeToken ? 'Kartu baru siap dicetak' : 'PIN baru'} onClose={() => { setIssued(null); reloadAll(); }} wide>
          {issued.barcodeToken
            ? <CardPrint santri={s} card={issued} onDone={() => { setIssued(null); reloadAll(); }} />
            : <div className="space-y-3"><Alert tone="warn">PIN baru hanya tampil sekali. Berikan langsung ke santri.{issued.pinMustChange !== false ? ' Santri akan diminta menggantinya saat pertama dipakai.' : ''}</Alert><div className="text-3xl font-bold tracking-[0.3em] tabular-nums">{issued.initialPin}</div><div className="flex justify-end"><Button onClick={() => { setIssued(null); reloadAll(); }}>Selesai</Button></div></div>}
        </Modal>
      )}
    </>
  );
}

function ReasonModal({ title, button, placeholder, note, onClose, onSubmit }: { title: string; button: string; placeholder: string; note?: string; onClose: () => void; onSubmit: (r: string) => void }) {
  const [r, setR] = useState('');
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(r); }} className="space-y-3">
        {note && <Alert tone="warn">{note}</Alert>}
        <Field label="Alasan"><Input value={r} onChange={(e) => setR(e.target.value)} placeholder={placeholder} required minLength={3} autoFocus /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Batal</Button><Button variant="danger">{button}</Button></div>
      </form>
    </Modal>
  );
}

function TopupModal({ santriId, onClose, onDone }: { santriId: string; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(''); const [method, setMethod] = useState('CASH_COUNTER'); const [note, setNote] = useState(''); const [pocket, setPocket] = useState('SALDO');
  const feeQ = useApi<{ fee: number }>('/wallet/topup-fee'); const fee = feeQ.data?.fee ?? 0;
  const [key] = useState(uuid); // kunci tetap selama modal terbuka: klik ganda tidak menambah saldo dua kali
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState<{ fee: number; collect: number } | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api<any>('/wallet/topup', { method: 'POST', body: { santriId, amount: Number(amount), method, pocket, note: note || undefined, idempotencyKey: key } }); setDone({ fee: r.fee, collect: r.collect }); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  const nominal = Number(amount) || 0;
  if (done) return (
    <Modal title="Top up berhasil" onClose={onDone}>
      <div className="space-y-3 text-base">
        <Alert tone="ok">Saldo sudah ditambah {rupiah(nominal)}.</Alert>
        <div className="rounded-lg bg-navy-50 p-4 text-center"><div className="text-sm text-navy-700">Uang tunai yang diterima dari wali</div><div className="text-3xl font-bold tabular-nums">{rupiah(done.collect)}</div>{done.fee > 0 && <div className="text-sm text-navy-700">{rupiah(nominal)} + biaya layanan {rupiah(done.fee)}</div>}</div>
        <div className="flex justify-end"><Button onClick={onDone}>Selesai</Button></div>
      </div>
    </Modal>
  );
  return (
    <Modal title="Top up saldo (simulasi)" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {err && <Alert>{err}</Alert>}
        <Field label="Jumlah yang masuk ke santri (Rp)"><MoneyInput min={1000} step={1000} value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus /></Field>
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          {fee > 0 ? <>Biaya layanan <strong>{rupiah(fee)}</strong> ditambahkan di atas jumlah. {nominal > 0 ? <>Terima dari wali: <strong>{rupiah(nominal + fee)}</strong>.</> : null}</> : 'Tidak ada biaya layanan.'}
        </div>
        <Field label="Metode"><Select value={method} onChange={(e) => setMethod(e.target.value)}><option value="CASH_COUNTER">Tunai di loket</option><option value="BANK_TRANSFER">Transfer bank (sudah diverifikasi)</option></Select></Field>
        <Field label="Masuk ke" hint="Biasanya Saldo; wali yang membagi. Pilih Jajan jika wali tidak memakai aplikasi."><Select value={pocket} onChange={(e) => setPocket(e.target.value)}><option value="SALDO">Saldo (dibagi wali)</option><option value="JAJAN">Uang jajan langsung</option><option value="LAUNDRY">Uang laundry langsung</option></Select></Field>
        <Field label="Catatan" hint="Opsional, misalnya nomor bukti transfer"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Batal</Button><Button disabled={busy}>{busy ? 'Menyimpan…' : 'Tambah saldo'}</Button></div>
      </form>
    </Modal>
  );
}

function LimitsModal({ santriId, d, onClose, onDone }: { santriId: string; d: Detail; onClose: () => void; onDone: () => void }) {
  const [daily, setDaily] = useState(d.dailyLimit?.toString() ?? ''); const [perTx, setPerTx] = useState(d.perTxLimit?.toString() ?? '');
  const [err, setErr] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    try { await api(`/wallet/${santriId}/limits`, { method: 'PATCH', body: { dailyLimit: daily ? Number(daily) : null, perTxLimit: perTx ? Number(perTx) : null } }); onDone(); }
    catch (e) { setErr(errMsg(e)); }
  }
  return (
    <Modal title="Batas belanja" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {err && <Alert>{err}</Alert>}
        <Field label="Batas per hari (Rp)" hint="Kosongkan = tanpa batas. Membatasi kerugian jika kartu hilang."><MoneyInput min={1000} value={daily} onChange={(e) => setDaily(e.target.value)} /></Field>
        <Field label="Batas per transaksi (Rp)"><MoneyInput min={1000} value={perTx} onChange={(e) => setPerTx(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Batal</Button><Button>Simpan batas</Button></div>
      </form>
    </Modal>
  );
}

function WalsanModal({ santriId, onClose, onDone }: { santriId: string; onClose: () => void; onDone: () => void }) {
  const users = useApi<any[]>('/users');
  const [userId, setUserId] = useState(''); const [relation, setRelation] = useState('ayah'); const [err, setErr] = useState('');
  const walsan = users.data?.filter((u) => u.role === 'WALSAN' && u.isActive) ?? [];
  async function submit(e: FormEvent) {
    e.preventDefault();
    try { await api(`/santri/${santriId}/walsan`, { method: 'POST', body: { userId, relation } }); onDone(); } catch (e) { setErr(errMsg(e)); }
  }
  return (
    <Modal title="Hubungkan wali santri" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {err && <Alert>{err}</Alert>}
        {users.loading ? <Loading /> : walsan.length === 0 ? <Alert tone="warn">Belum ada akun wali. Buat dulu di menu Pengguna (peran: Wali santri).</Alert> : (
          <>
            <Field label="Akun wali"><Select value={userId} onChange={(e) => setUserId(e.target.value)} required><option value="">Pilih wali…</option>{walsan.map((u) => <option key={u.id} value={u.id}>{u.fullName} (@{u.username})</option>)}</Select></Field>
            <Field label="Hubungan"><Select value={relation} onChange={(e) => setRelation(e.target.value)}><option value="ayah">Ayah</option><option value="ibu">Ibu</option><option value="wali">Wali lain</option></Select></Field>
          </>
        )}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Batal</Button><Button disabled={!userId}>Hubungkan</Button></div>
      </form>
    </Modal>
  );
}

type PinChoice = { pin?: string; mustChange: boolean; reason?: string };

/** Pilih PIN: acak otomatis atau ditentukan sendiri oleh admin. Dipakai saat terbit kartu, reset PIN, dan ganti kartu. */
function PinChoiceModal({ title, button, note, reasonPlaceholder, danger, onClose, onSubmit }: {
  title: string; button: string; note?: string; reasonPlaceholder?: string; danger?: boolean;
  onClose: () => void; onSubmit: (v: PinChoice) => void;
}) {
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [pin, setPin] = useState(''); const [mustChange, setMustChange] = useState(true); const [reason, setReason] = useState(''); const [err, setErr] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    if (mode === 'manual' && !/^\d{6}$/.test(pin)) return setErr('PIN harus 6 angka.');
    onSubmit({ ...(mode === 'manual' ? { pin } : {}), mustChange, ...(reasonPlaceholder ? { reason } : {}) });
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {note && <Alert tone="warn">{note}</Alert>}
        {err && <Alert>{err}</Alert>}
        {reasonPlaceholder && <Field label="Alasan"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={reasonPlaceholder} required minLength={3} autoFocus /></Field>}
        <fieldset className="space-y-2 text-sm">
          <legend className="mb-1 font-medium text-navy-800">PIN</legend>
          <label className="flex items-center gap-2"><input type="radio" checked={mode === 'auto'} onChange={() => setMode('auto')} /> Acak otomatis (disarankan)</label>
          <label className="flex items-center gap-2"><input type="radio" checked={mode === 'manual'} onChange={() => setMode('manual')} /> Saya tentukan sendiri</label>
          {mode === 'manual' && (
            <div className="pl-6"><Input inputMode="numeric" maxLength={6} value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setErr(''); }} placeholder="6 angka" autoComplete="off" autoFocus={!reasonPlaceholder} />
              <p className="mt-1 text-xs text-navy-700">Tidak boleh angka sama semua (111111) atau berurutan (123456).</p></div>
          )}
        </fieldset>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={mustChange} onChange={(e) => setMustChange(e.target.checked)} />
          <span>Santri wajib mengganti PIN ini saat pertama kali bayar di kasir <span className="block text-xs text-navy-700">Disarankan. Kalau tidak dicentang, PIN ini langsung dipakai dan hanya kita berdua (admin dan santri) yang tahu.</span></span></label>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Batal</Button><Button variant={danger ? 'danger' : 'primary'}>{button}</Button></div>
      </form>
    </Modal>
  );
}

function SppModal({ santriId, current, onClose, onDone }: { santriId: string; current: number | null; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState(current ? String(current) : ''); const [err, setErr] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    try { await api(`/santri/${santriId}/spp`, { method: 'PATCH', body: { sppAmount: v ? Number(v) : null } }); onDone(); } catch (e) { setErr(errMsg(e)); }
  }
  return (
    <Modal title="SPP per bulan" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {err && <Alert>{err}</Alert>}
        <Field label="Nominal SPP santri ini (Rp)" hint="Kosongkan bila mengikuti nominal umum. Tagihan yang sudah dibuat tidak berubah; untuk itu pakai tombol Ubah di Tagihan."><MoneyInput min={1000} value={v} onChange={(e) => setV(e.target.value)} autoFocus /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Batal</Button><Button>Simpan</Button></div>
      </form>
    </Modal>
  );
}

function EditSantriModal({ s, onClose, onDone }: { s: Detail; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ fullName: s.fullName, nis: s.nis, kelas: s.kelas ?? '', status: s.status }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api(`/santri/${s.id}`, { method: 'PATCH', body: { fullName: f.fullName, nis: f.nis, kelas: f.kelas || undefined, status: f.status } }); onDone(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Ubah data santri" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {err && <Alert>{err}</Alert>}
        <Field label="Nama lengkap"><Input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required minLength={2} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="NIS"><Input value={f.nis} onChange={(e) => setF({ ...f, nis: e.target.value })} required /></Field>
          <Field label="Kelas"><Input value={f.kelas} onChange={(e) => setF({ ...f, kelas: e.target.value })} /></Field>
        </div>
        <Field label="Status" hint="Selain Aktif, kartu santri tidak bisa dipakai bertransaksi. Saldo dan riwayat tetap tersimpan."><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="ACTIVE">Aktif</option><option value="INACTIVE">Tidak aktif (sementara)</option><option value="GRADUATED">Lulus</option><option value="ARCHIVED">Diarsipkan (pindah/keluar)</option></Select></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Batal</Button><Button disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</Button></div>
      </form>
    </Modal>
  );
}
