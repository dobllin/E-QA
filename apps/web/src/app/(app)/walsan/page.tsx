'use client';
import { FormEvent, useEffect, useState } from 'react';
import { api, apiBlobUrl, errMsg } from '@/lib/api';
import { accountNumber, JENIS_WALI, METODE_BAYAR, POCKET_NAME, POCKETS, rupiah, STATUS_KARTU, TAGIHAN_WALI, tanggal, tanggalWaktu, uuid } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { ProofUploader } from '@/components/ProofUploader';
import { Alert, Badge, Button, Card, CopyButton, Empty, Field, Loading, Modal, MoneyInput, PageHeader, Select } from '@/components/ui';

interface Child { id: string; nis: string; fullName: string; kelas: string | null; balance: number; dailyLimit: number | null; relation: string; cardStatus: string | null; totalDue: number; totalOverdue: number; pockets: Record<string, number> | null }
interface Bill { title: string; remaining: number; count: number; nextDue: string; overdue: number }
type ModalState = null | { k: 'topup' } | { k: 'move'; to?: string } | { k: 'bill'; title: string; remaining: number }
interface Info { fee: number; min: number; max: number; expiryHours: number; bankInfo: string; bankName: string; bankAccount: string; bankHolder: string; tolerance: number; hasQris: boolean }
const TABS = [['belanja', 'Belanja anak'], ['saldo', 'Riwayat uang'], ['topup', 'Isi saldo'], ['spp', 'Tagihan sekolah']] as const;
const KARTU: Record<string, string> = { ACTIVE: 'Kartu aktif', SUSPENDED: 'Kartu dinonaktifkan sementara', LOCKED: 'Kartu terkunci karena salah PIN', REPLACED: 'Kartu sudah diganti', REVOKED: 'Kartu dicabut' };

export default function WalsanPage() {
  const kids = useApi<Child[]>('/portal/children');
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('belanja');
  const [modal, setModal] = useState<ModalState>(null);
  const [nonce, setNonce] = useState(0); const [notice, setNotice] = useState('');

  if (kids.loading) return <Loading />;
  if (kids.error) return <Alert>{kids.error}</Alert>;
  if (!kids.data?.length) return <><PageHeader title="Anak saya" /><Empty>Akun Anda belum dihubungkan dengan data santri. Silakan hubungi pengurus pesantren.</Empty></>;

  const child = kids.data.find((k) => k.id === sel) ?? kids.data[0];
  const refresh = () => { kids.reload(); setNonce((n) => n + 1); };
  const kartu = child.cardStatus ? KARTU[child.cardStatus] : 'Belum ada kartu';
  const kartuOk = child.cardStatus === 'ACTIVE';

  return (
    <div className="text-[17px] leading-relaxed">
      <PageHeader title={child.fullName} sub={`NIS ${child.nis}${child.kelas ? ` · Kelas ${child.kelas}` : ''} · ${kartu}`} />
      {!kartuOk && child.cardStatus && <div className="mb-4"><Alert tone="warn">{kartu}. Silakan hubungi pengurus pesantren agar anak bisa jajan lagi.</Alert></div>}

      {kids.data.length > 1 && (
        <div className="mb-5 flex flex-wrap gap-2" role="tablist" aria-label="Pilih anak">
          {kids.data.map((k) => (
            <button key={k.id} role="tab" aria-selected={k.id === child.id} onClick={() => setSel(k.id)} className={`min-h-[48px] rounded-full border px-5 text-base font-medium ${k.id === child.id ? 'border-navy-800 bg-navy-800 text-white' : 'border-navy-200 bg-white text-navy-800'}`}>{k.fullName}</button>
          ))}
        </div>
      )}

      {child.totalDue > 0 ? (
        <section className="mb-5 rounded-card border-2 border-amber-300 bg-amber-50 p-5" aria-label="Tagihan yang harus dibayar">
          <div className="text-base text-amber-900">Yang harus dibayar sekarang</div>
          <div className="text-4xl font-bold tabular-nums text-navy-900">{rupiah(child.totalDue)}</div>
          {child.totalOverdue > 0 && <div className="mt-1 font-medium text-red-700">{rupiah(child.totalOverdue)} di antaranya sudah lewat jatuh tempo</div>}
          <Button size="lg" className="mt-3" onClick={() => setTab('spp')}>Lihat dan bayar tagihan</Button>
        </section>
      ) : (
        <section className="mb-5 rounded-card border border-teal-100 bg-teal-50 p-4 text-teal-700">Tidak ada tagihan yang harus dibayar saat ini.</section>
      )}

      {notice && <div className="mb-4"><Alert tone="ok">{notice}</Alert></div>}
      <Cards child={child} key={`${child.id}-${nonce}`} onMove={(to) => setModal({ k: 'move', to })} onPay={(b) => { setNotice(''); setModal({ k: 'bill', title: b.title, remaining: b.remaining }); }} onTopup={() => setModal({ k: 'topup' })} />

      <details className="mt-5 rounded-card border border-navy-100 bg-white p-4">
        <summary className="cursor-pointer text-base font-semibold text-navy-900">Cara pakai (baca singkat)</summary>
        <ol className="mt-3 list-decimal space-y-2 pl-6">
          <li><strong>Isi saldo:</strong> tekan "Isi saldo", tulis jumlahnya, lalu transfer ke rekening pesantren sesuai angka yang tampil. Uang masuk ke <strong>Saldo</strong> dulu.</li>
          <li><strong>Bagi sendiri:</strong> dari Saldo, tekan "Pindahkan ke sini" pada Uang jajan atau Uang laundry.</li>
          <li><strong>Bayar tagihan:</strong> pada kartu tagihan (SPP, Uang Gedung, dan lainnya), tekan "Bayar dari saldo". Uang otomatis membayar tagihan itu. Boleh dicicil.</li>
          <li><strong>Butuh bantuan?</strong> Hubungi pengurus pesantren.</li>
        </ol>
      </details>

      <div className="mt-6 flex flex-wrap gap-1 border-b border-navy-100" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`-mb-px min-h-[48px] border-b-4 px-4 text-base font-medium ${tab === k ? 'border-teal-500 text-navy-900' : 'border-transparent text-navy-700'}`}>{label}</button>
        ))}
      </div>
      <div className="mt-4">
        {tab === 'belanja' && <Orders id={child.id} />}
        {tab === 'saldo' && <Ledger id={child.id} key={nonce} />}
        {tab === 'topup' && <Topups child={child} key={nonce} />}
        {tab === 'spp' && <Invoices child={child} key={nonce} onPay={(title, remaining) => { setNotice(''); setModal({ k: 'bill', title, remaining }); }} />}
      </div>

      {modal?.k === 'topup' && <TopupFlow child={child} onClose={() => setModal(null)} onCreated={() => { refresh(); setTab('topup'); }} />}
      {modal?.k === 'move' && <MoveModal child={child} to={modal.to} onClose={() => setModal(null)} onDone={(msg) => { setModal(null); setNotice(msg); refresh(); }} />}
      {modal?.k === 'bill' && <PayBillModal child={child} title={modal.title} remaining={modal.remaining} onClose={() => setModal(null)} onTopup={() => setModal({ k: 'topup' })} onDone={(r) => { setModal(null); setNotice(`Pembayaran ${modal.title} berhasil. Kwitansi ${r.receipts.join(', ')}. Sisa tagihan ${rupiah(r.remaining)}.`); refresh(); }} />}
    </div>
  );
}

/** "Uang anak Anda saat ini": Saldo, Uang jajan, Uang laundry, dan satu kartu untuk tiap tagihan yang belum lunas. */
function Cards({ child, onMove, onPay, onTopup }: { child: Child; onMove: (to: string) => void; onPay: (b: Bill) => void; onTopup: () => void }) {
  const bills = useApi<Bill[]>(`/portal/children/${child.id}/bills`);
  const saldo = child.pockets?.SALDO ?? 0;
  return (
    <section aria-label="Uang anak Anda saat ini">
      <h2 className="mb-2 text-lg font-semibold text-navy-900">Uang anak Anda saat ini</h2>
      <div className="rounded-card border-2 border-teal-500 bg-white p-5" data-testid="pocket-SALDO">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0"><div className="text-base font-semibold text-navy-900">Saldo</div><div className="text-sm text-navy-700">Uang yang sudah masuk. Belum dipakai untuk apa pun. Anda yang membaginya di bawah.</div></div>
          <div className="text-3xl font-bold tabular-nums text-navy-900">{rupiah(saldo)}</div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2"><Button size="lg" onClick={onTopup}>Isi saldo (Top up)</Button><Button size="lg" variant="secondary" onClick={() => onMove('JAJAN')}>Pindahkan uang</Button></div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(['JAJAN', 'LAUNDRY'] as const).map((k) => (
          <div key={k} className="min-w-0 rounded-card border border-navy-100 bg-white p-4" data-testid={`pocket-${k}`}>
            <div className="text-base font-semibold text-navy-900">{POCKET_NAME[k]}</div>
            <div className="text-sm text-navy-700">{k === 'JAJAN' ? 'Untuk jajan di kantin' : 'Untuk biaya laundry'}</div>
            <div className="mt-1 text-2xl font-bold tabular-nums text-navy-900">{rupiah(child.pockets?.[k] ?? 0)}</div>
            <Button size="lg" variant="secondary" className="mt-3 w-full" onClick={() => onMove(k)}>Pindahkan ke sini</Button>
          </div>
        ))}
        {bills.loading && !bills.data ? <Loading /> : (bills.data ?? []).map((b) => (
          <div key={b.title} className={`min-w-0 rounded-card border p-4 ${b.overdue > 0 ? 'border-red-300 bg-red-50' : 'border-amber-300 bg-amber-50'}`} data-testid={`bill-${b.title}`}>
            <div className="text-base font-semibold text-navy-900">{b.title}</div>
            <div className="text-sm text-navy-700">{b.count > 1 ? `${b.count} tagihan belum lunas` : `Jatuh tempo ${tanggal(b.nextDue)}`}</div>
            <div className="mt-1 text-sm text-navy-700">Yang harus dibayar</div>
            <div className="text-2xl font-bold tabular-nums text-navy-900">{rupiah(b.remaining)}</div>
            {b.overdue > 0 && <div className="mt-0.5 text-sm font-medium text-red-700">{rupiah(b.overdue)} sudah lewat jatuh tempo</div>}
            <Button size="lg" className="mt-3 w-full" onClick={() => onPay(b)}>Bayar dari saldo</Button>
          </div>
        ))}
      </div>
      {bills.data && bills.data.length === 0 && <p className="mt-2 text-sm text-navy-700">Tidak ada tagihan yang belum lunas.</p>}
      {child.dailyLimit ? <p className="mt-2 text-sm text-navy-700">Batas jajan per hari: {rupiah(child.dailyLimit)}.</p> : null}
    </section>
  );
}

function Orders({ id }: { id: string }) {
  const { data, loading, error } = useApi<any[]>(`/portal/children/${id}/orders`);
  if (loading) return <Loading />; if (error) return <Alert>{error}</Alert>;
  if (!data?.length) return <Empty>Belum ada belanja.</Empty>;
  return (
    <div className="space-y-3">
      {data.map((o) => (
        <Card key={o.id}>
          <div className="flex items-start justify-between gap-3">
            <div><div className="text-base text-navy-700">{tanggalWaktu(o.createdAt)}{o.merchant === 'LAUNDRY' && <span className="ml-2"><Badge tone="info">Laundry</Badge></span>}</div>
              <ul className="mt-1">{(o.items ?? []).map((i: any, n: number) => <li key={n}>{i.qty}× {i.name} <span className="text-navy-700">@ {rupiah(i.unitPrice)}</span></li>)}</ul></div>
            <div className="text-right"><div className="text-xl font-semibold tabular-nums">{rupiah(o.total)}</div>{o.refunded && <Badge tone="info">Dikembalikan</Badge>}</div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function Ledger({ id }: { id: string }) {
  const { data, loading, error } = useApi<any[]>(`/portal/children/${id}/ledger`);
  if (loading) return <Loading />; if (error) return <Alert>{error}</Alert>;
  if (!data?.length) return <Empty>Belum ada riwayat uang.</Empty>;
  return (
    <div className="space-y-2">
      {data.map((l) => (
        <div key={l.id} className="flex items-start justify-between gap-3 rounded-card border border-navy-100 bg-white p-4">
          <div><div className="font-medium">{JENIS_WALI[l.type] ?? l.type}{l.pocket ? <span className="font-normal text-navy-700"> · {POCKET_NAME[l.pocket]}</span> : null}</div>
            <div className="text-sm text-navy-700">{tanggalWaktu(l.createdAt)}{l.note ? ` · ${l.note}` : ''}</div></div>
          <div className="text-right"><div className={`text-lg font-semibold tabular-nums ${l.direction === 'DEBIT' ? 'text-red-700' : 'text-teal-700'}`}>{l.direction === 'DEBIT' ? '−' : '+'}{rupiah(l.amount)}</div>
            <div className="text-sm text-navy-700">sisa {rupiah(l.balanceAfter)}</div></div>
        </div>
      ))}
    </div>
  );
}

const TOPUP_STATUS: Record<string, [string, 'ok' | 'warn' | 'bad' | 'muted' | 'info']> = {
  PENDING: ['Menunggu transfer dari Anda', 'warn'], MATCHED: ['Transfer diterima, sedang dicek pengurus', 'info'], CREDITED: ['Saldo sudah masuk', 'ok'],
  REJECTED: ['Ditolak pengurus', 'bad'], EXPIRED: ['Kedaluwarsa', 'muted'], CANCELLED: ['Dibatalkan', 'muted'],
};

function Topups({ child }: { child: Child }) {
  const { data, loading, error, reload } = useApi<any[]>(`/portal/children/${child.id}/topups`);
  const [err, setErr] = useState(''); const [guide, setGuide] = useState<any | null>(null);
  if (loading) return <Loading />; if (error) return <Alert>{error}</Alert>;
  if (!data?.length) return <Empty>Belum pernah isi saldo. Tekan tombol "Isi saldo (Top up)" di atas.</Empty>;
  return (
    <div className="space-y-3">
      {err && <Alert>{err}</Alert>}
      {data.map((t) => (
        <Card key={t.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><div className="text-base text-navy-700">{tanggalWaktu(t.createdAt)}</div>
              <div className="text-xl font-semibold tabular-nums">Transfer {rupiah(t.total)}</div>
              <div className="text-base text-navy-700">Uang masuk ke anak: {rupiah(t.credited)}{t.fee > 0 ? ` · biaya layanan ${rupiah(t.fee)}` : ''}</div></div>
            <Badge tone={TOPUP_STATUS[t.status][1]}>{TOPUP_STATUS[t.status][0]}</Badge>
          </div>
          {t.proofs > 0 && <div className="mt-2 text-sm text-teal-700">Bukti transfer sudah dikirim ({t.proofs} foto){t.proofMatch ? ', nominal sesuai' : ''}.</div>}
          {t.status === 'PENDING' && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setGuide(t)}>Lihat cara transfer</Button>
              <Button variant="ghost" onClick={async () => { try { await api(`/portal/topups/${t.id}/cancel`, { method: 'POST' }); reload(); } catch (e) { setErr(errMsg(e)); } }}>Batalkan</Button>
            </div>
          )}
        </Card>
      ))}
      {guide && <Modal title="Cara transfer" onClose={() => { setGuide(null); reload(); }} wide><TransferGuide childName={child.fullName} req={guide} onDone={() => { setGuide(null); reload(); }} /></Modal>}
    </div>
  );
}

function Invoices({ child, onPay }: { child: Child; onPay: (title: string, remaining: number) => void }) {
  const { data, loading, error, reload } = useApi<any[]>(`/portal/children/${child.id}/invoices`);
  if (loading) return <Loading />; if (error) return <Alert>{error}</Alert>;
  if (!data?.length) return <Empty>Belum ada tagihan.</Empty>;
  return (
    <div className="space-y-3">
      {data.map((i) => {
        const st = TAGIHAN_WALI[i.status] ?? TAGIHAN_WALI.UNPAID;
        return (
          <Card key={i.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><div className="text-lg font-semibold">{i.title} · {i.period}</div><div className="text-base text-navy-700">Jatuh tempo {tanggal(i.dueDate)} · No. {i.number}</div></div>
              <Badge tone={st.tone}>{st.label}</Badge>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2"><div><div className="text-sm text-navy-700">Total</div><div className="text-lg font-semibold tabular-nums">{rupiah(i.total)}</div></div><div><div className="text-sm text-navy-700">Sudah dibayar</div><div className="text-lg font-semibold tabular-nums">{rupiah(i.paid)}</div></div><div><div className="text-sm text-navy-700">Sisa</div><div className={`text-lg font-bold tabular-nums ${i.remaining > 0 && i.status === 'OVERDUE' ? 'text-red-700' : ''}`}>{rupiah(i.remaining)}</div></div></div>
            {['UNPAID', 'PARTIAL', 'OVERDUE'].includes(i.status) && <Button size="lg" className="mt-3 w-full sm:w-auto" onClick={() => onPay(i.title, i.remaining)}>Bayar dari saldo</Button>}
            {i.payments?.length > 0 && <ul className="mt-3 space-y-0.5 border-t border-navy-50 pt-2 text-sm text-navy-700">{i.payments.map((p: any) => <li key={p.receiptNumber}>{tanggal(p.paidAt)} — {rupiah(p.amount)} ({METODE_BAYAR[p.method] ?? p.method}) — kwitansi {p.receiptNumber}</li>)}</ul>}
          </Card>
        );
      })}
    </div>
  );
}

/** Cara transfer: nominal dan nomor rekening bisa disalin dengan satu tombol. */
function TransferGuide({ childName, req, onDone }: { childName: string; req: any; onDone: () => void }) {
  const info = useApi<Info>('/portal/topup-info');
  const i = info.data;
  const acc = accountNumber(i);
  return (
    <div className="space-y-4 text-[17px]">
      <div className="rounded-card bg-navy-50 p-4 text-center">
        <div className="text-base text-navy-700">Transfer tepat sebesar</div>
        <div className="text-4xl font-bold tabular-nums text-navy-900">{rupiah(req.total)}</div>
        <div className="mt-2"><CopyButton text={String(req.total)} label="Salin jumlah" size="lg" /></div>
        <p className="mt-2 text-sm text-navy-700">3 angka terakhir ({String(req.uniqueCode).padStart(3, '0')}) sengaja ditambahkan agar transfer Anda dikenali. Angka itu tidak hilang: ikut menjadi uang anak.</p>
      </div>

      <div className="rounded-card border border-navy-100 p-4">
        <div className="mb-2 text-base font-semibold">Transfer ke rekening ini</div>
        {!i ? <Loading /> : (
          <div className="space-y-2">
            {i.bankName && <div><span className="text-navy-700">Bank: </span><strong>{i.bankName}</strong></div>}
            {acc ? (
              <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="text-sm text-navy-700">Nomor rekening</div><div className="text-2xl font-bold tabular-nums tracking-wide">{acc}</div></div><CopyButton text={acc.replace(/\D/g, '')} label="Salin no. rekening" size="lg" /></div>
            ) : <div className="whitespace-pre-line">{i.bankInfo}</div>}
            {i.bankHolder && <div><span className="text-navy-700">Atas nama: </span><strong>{i.bankHolder}</strong></div>}
            {!acc && i.bankInfo && <CopyButton text={i.bankInfo} label="Salin data rekening" />}
          </div>
        )}
      </div>

      <ol className="list-decimal space-y-1 pl-6">
        <li>Buka aplikasi bank atau e-wallet Anda.</li>
        <li>Transfer ke rekening di atas dengan jumlah <strong>tepat {rupiah(req.total)}</strong>.</li>
        <li>Selesai. Setelah pengurus memeriksa, uang masuk ke anak. Anda juga bisa mengirim foto bukti transfer di bawah.</li>
      </ol>
      {!!i?.tolerance && <p className="text-sm text-navy-700">Jika transfer Anda lebih banyak (sampai {rupiah(i.tolerance)}), tetap dikenali dan seluruh kelebihannya ikut menjadi uang anak.</p>}

      <div className="rounded-card bg-navy-50 p-4">
        <div className="mb-1 text-base font-semibold">Rincian untuk {childName}</div>
        <dl className="space-y-1 text-base">
          <div className="flex justify-between"><dt>Jumlah yang Anda minta</dt><dd className="tabular-nums">{rupiah(req.amount)}</dd></div>
          <div className="flex justify-between"><dt>3 angka pengenal</dt><dd className="tabular-nums">{rupiah(req.uniqueCode)}</dd></div>
          <div className="flex justify-between"><dt>Biaya layanan</dt><dd className="tabular-nums">{rupiah(req.fee)}</dd></div>
          <div className="flex justify-between border-t border-navy-100 pt-1 font-semibold"><dt>Uang yang masuk ke Saldo anak</dt><dd className="tabular-nums">{rupiah(req.credited)}</dd></div>
        </dl>
      </div>

      {i?.hasQris && <PortalQris total={req.total} />}
      <ProofUploader requestId={req.id} total={req.total} onDone={() => {}} />
      <div className="flex justify-end"><Button size="lg" onClick={onDone}>Selesai</Button></div>
    </div>
  );
}

function TopupFlow({ child, onClose, onCreated }: { child: Child; onClose: () => void; onCreated: () => void }) {
  const info = useApi<Info>('/portal/topup-info');
  const [amount, setAmount] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any | null>(null);
  const nominal = Number(amount) || 0;
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await api(`/portal/children/${child.id}/topups`, { method: 'POST', body: { amount: nominal } }); setRes(r); onCreated(); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={res ? 'Permintaan isi saldo dibuat' : `Isi saldo untuk ${child.fullName}`} onClose={onClose} wide>
      {res ? (
        <TransferGuide childName={child.fullName} req={{ ...res, credited: res.credited }} onDone={onClose} />
      ) : (
        <form onSubmit={submit} className="space-y-4 text-[17px]">
          {err && <Alert>{err}</Alert>}
          {info.loading ? <Loading /> : info.data && (
            <>
              <Field label="Berapa yang ingin diisi?" hint={`Minimal ${rupiah(info.data.min)}, maksimal ${rupiah(info.data.max)}`}>
                <MoneyInput min={info.data.min} max={info.data.max} value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus className="!min-h-[52px] !text-xl" />
              </Field>
              <div className="flex flex-wrap gap-2">{[100000, 200000, 500000, 1000000].filter((v) => v >= info.data!.min && v <= info.data!.max).map((v) => <button key={v} type="button" onClick={() => setAmount(String(v))} className="min-h-[44px] rounded-full border border-navy-200 px-4 text-base hover:bg-navy-50">{rupiah(v)}</button>)}</div>
              <p className="rounded-lg bg-navy-50 p-3 text-base">Uang akan masuk ke <strong>Saldo</strong> anak. Setelah itu Anda yang memindahkannya ke uang jajan, uang laundry, atau membayar tagihan.</p>
              <div className="rounded-lg bg-amber-50 p-3 text-base text-amber-900">
                {info.data.fee > 0 ? <>Ada <strong>biaya layanan {rupiah(info.data.fee)}</strong> yang ditambahkan di atas jumlah yang Anda isi. Uang anak tetap utuh.</> : <>Tidak ada biaya layanan.</>} Sistem juga menambah <strong>3 angka pengenal</strong> agar transfer Anda dikenali. Angka itu ikut menjadi uang anak.
              </div>
              <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="ghost" size="lg" onClick={onClose}>Batal</Button><Button size="lg" disabled={busy || !nominal}>{busy ? 'Membuat…' : 'Lanjut: lihat cara transfer'}</Button></div>
            </>
          )}
        </form>
      )}
    </Modal>
  );
}

/** Pindahkan uang antar kantong milik anak (Saldo, Uang jajan, Uang laundry), atau langsung bayar tagihan (hanya dari Saldo). */
function MoveModal({ child, to: preset, onClose, onDone }: { child: Child; to?: string; onClose: () => void; onDone: (msg: string) => void }) {
  const bal = (k: string) => child.pockets?.[k] ?? 0;
  const bills = useApi<Bill[]>(`/portal/children/${child.id}/bills`);
  const [from, setFrom] = useState('SALDO'); const [to, setTo] = useState(preset ?? 'JAJAN'); const [amount, setAmount] = useState('');
  const [key] = useState(uuid); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const bill = to.startsWith('BILL:') ? (bills.data ?? []).find((b) => b.title === to.slice(5)) : undefined;
  const payingBill = to.startsWith('BILL:');
  const source = payingBill ? 'SALDO' : from;                 // tagihan hanya boleh dibayar dari Saldo
  const maxAmt = payingBill ? Math.min(bal('SALDO'), bill?.remaining ?? 0) : bal(from);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      if (payingBill) {
        if (!bill) throw new Error('Tagihan tidak ditemukan');
        const r = await api<{ receipts: string[]; remaining: number }>(`/portal/children/${child.id}/bills/pay`, { method: 'POST', body: { title: bill.title, amount: Number(amount), idempotencyKey: key } });
        onDone(`Pembayaran ${bill.title} berhasil. Kwitansi ${r.receipts.join(', ')}. Sisa tagihan ${rupiah(r.remaining)}.`);
      } else {
        await api(`/portal/children/${child.id}/transfer`, { method: 'POST', body: { from, to, amount: Number(amount), idempotencyKey: key } });
        onDone('Uang berhasil dipindahkan.');
      }
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  const chips = payingBill && bill ? [bill.remaining, ...[10000, 50000, 100000].filter((v) => v < (bill?.remaining ?? 0))].filter((v) => v <= bal('SALDO') || v === bill.remaining) : [10000, 50000, 100000].filter((v) => v <= bal(from));
  const lack = payingBill ? Math.max(0, (Number(amount) || 0) - bal('SALDO')) : 0;
  return (
    <Modal title={`Pindahkan uang — ${child.fullName}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4 text-[17px]">
        {err && <Alert>{err}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Ambil dari" hint={payingBill ? 'Tagihan dibayar dari Saldo.' : undefined}>
            <Select value={source} disabled={payingBill} onChange={(e) => setFrom(e.target.value)} className="!min-h-[48px]">{POCKETS.map((k) => <option key={k} value={k}>{POCKET_NAME[k]} ({rupiah(bal(k))})</option>)}</Select>
          </Field>
          <Field label="Pindahkan ke">
            <Select value={to} onChange={(e) => { setTo(e.target.value); setAmount(''); }} className="!min-h-[48px]">
              <optgroup label="Kantong uang">{POCKETS.map((k) => <option key={k} value={k}>{POCKET_NAME[k]} ({rupiah(bal(k))})</option>)}</optgroup>
              {!!bills.data?.length && <optgroup label="Bayar tagihan">{bills.data.map((b) => <option key={b.title} value={`BILL:${b.title}`}>{b.title} — harus dibayar {rupiah(b.remaining)}{b.overdue > 0 ? ' (lewat tempo)' : ''}</option>)}</optgroup>}
            </Select>
          </Field>
        </div>
        <Field label="Berapa?" hint={payingBill ? `Saldo ${rupiah(bal('SALDO'))}. Boleh dicicil, maksimal sisa tagihan ${rupiah(bill?.remaining ?? 0)}.` : `Tersedia di ${POCKET_NAME[from]}: ${rupiah(bal(from))}. Minimal ${rupiah(1000)}.`}><MoneyInput min={payingBill ? 1 : 1000} max={payingBill ? bill?.remaining : bal(from) || undefined} value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field>
        <div className="flex flex-wrap gap-2">{chips.map((v) => <button key={v} type="button" onClick={() => setAmount(String(v))} className="min-h-[44px] rounded-full border border-navy-200 px-4 text-base hover:bg-navy-50">{payingBill && v === bill?.remaining ? `Lunasi (${rupiah(v)})` : rupiah(v)}</button>)}{maxAmt > 0 && !payingBill && <button type="button" onClick={() => setAmount(String(maxAmt))} className="min-h-[44px] rounded-full border border-navy-200 px-4 text-base hover:bg-navy-50">Semua</button>}{payingBill && bal('SALDO') > 0 && <button type="button" onClick={() => setAmount(String(maxAmt))} className="min-h-[44px] rounded-full border border-navy-200 px-4 text-base hover:bg-navy-50">Pakai semua saldo</button>}</div>
        {lack > 0 && <Alert tone="warn">Saldo kurang {rupiah(lack)}. Isi saldo dulu, atau kurangi jumlahnya.</Alert>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="lg" onClick={onClose}>Batal</Button><Button size="lg" disabled={busy || (!payingBill && from === to) || !amount || lack > 0}>{busy ? 'Memproses…' : payingBill ? `Bayar ${rupiah(Number(amount) || 0)}` : 'Pindahkan'}</Button></div>
      </form>
    </Modal>
  );
}

/** Pindahkan Saldo ke kartu tagihan = membayar tagihan itu (yang paling lama dulu). Boleh dicicil. */
function PayBillModal({ child, title, remaining, onClose, onTopup, onDone }: { child: Child; title: string; remaining: number; onClose: () => void; onTopup: () => void; onDone: (r: { receipts: string[]; remaining: number }) => void }) {
  const saldo = child.pockets?.SALDO ?? 0;
  const [amount, setAmount] = useState(saldo > 0 ? String(Math.min(saldo, remaining)) : '');
  const [key] = useState(uuid); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const want = Number(amount) || 0;
  const lack = Math.max(0, want - saldo);
  async function submit(e: FormEvent) {
    e.preventDefault(); if (lack > 0 || want <= 0) return; setBusy(true); setErr('');
    try { onDone(await api(`/portal/children/${child.id}/bills/pay`, { method: 'POST', body: { title, amount: want, idempotencyKey: key } })); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={`Bayar ${title}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4 text-[17px]">
        <div className="rounded-lg bg-navy-50 p-3">Yang harus dibayar <strong>{rupiah(remaining)}</strong> · Saldo anak <strong>{rupiah(saldo)}</strong></div>
        {err && <Alert>{err}</Alert>}
        <Field label="Berapa yang mau dibayar sekarang?" hint="Boleh dicicil (kurang dari sisa). Tidak boleh lebih dari yang harus dibayar."><MoneyInput min={1} max={remaining} value={amount} onChange={(e) => setAmount(e.target.value)} required autoFocus className="!min-h-[52px] !text-xl" /></Field>
        <div className="flex flex-wrap gap-2">
          {saldo > 0 && <button type="button" onClick={() => setAmount(String(Math.min(saldo, remaining)))} className="min-h-[44px] rounded-full border border-navy-200 px-4 text-base hover:bg-navy-50">Pakai semua saldo</button>}
          <button type="button" onClick={() => setAmount(String(remaining))} className="min-h-[44px] rounded-full border border-navy-200 px-4 text-base hover:bg-navy-50">Lunasi ({rupiah(remaining)})</button>
        </div>
        {lack > 0 && <Alert tone="warn">Saldo kurang {rupiah(lack)}. <button type="button" onClick={onTopup} className="font-semibold underline">Isi saldo dulu</button>, atau kurangi jumlah yang dibayar.</Alert>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" size="lg" onClick={onClose}>Batal</Button><Button size="lg" disabled={busy || lack > 0 || want <= 0}>{busy ? 'Memproses…' : `Bayar ${rupiah(want)}`}</Button></div>
      </form>
    </Modal>
  );
}

function PortalQris({ total }: { total: number }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let u = ''; let alive = true;
    apiBlobUrl('/portal/topup-qris').then((x) => { u = x; if (alive) setUrl(x); }).catch(() => {});
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, []);
  if (!url) return null;
  return (
    <div className="rounded-card border border-navy-100 p-4">
      <div className="mb-2 text-base font-semibold">Atau bayar dengan QRIS</div>
      <img src={url} alt="QRIS pesantren" className="mx-auto max-h-72 rounded" />
      <p className="mt-2 text-sm text-navy-700">Scan dengan aplikasi bank atau e-wallet, lalu masukkan jumlah <strong>tepat {rupiah(total)}</strong>.</p>
    </div>
  );
}
