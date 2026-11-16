'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, errMsg } from '@/lib/api';
import { rupiah, tanggal } from '@/lib/format';
import { Alert, Badge, Button, Card, Field, Input, PageHeader } from '@/components/ui';

interface Col { index: number; header: string; kind: string; label: string }
interface Inv { column: string; title: string; period: string; dueDate: string; amount: number; exists: boolean }
interface Row { line: number; name: string; bagian: string | null; kelas: string | null; statusLabel: string | null; catatan: string | null; nis: string; isNew: boolean; invoices: Inv[]; sum: number; total: number | null; totalCheck: 'OK' | 'NONE' | 'MISMATCH'; warnings: string[]; errors: string[] }
interface Summary { rows: number; rowsOk: number; rowsError: number; santriNew: number; santriExisting: number; invoicesNew: number; invoicesExisting: number; amountNew: number; overdueNew: number; overdueAmountNew: number }
interface Preview { columns: Col[]; sections: string[]; ignoredLines: { line: number; reason: string }[]; rows: Row[]; summary: Summary }
interface Result { santriCreated: number; santriExisting: number; invoicesCreated: number; invoicesExisting: number; overdueCreated: number; skipped: { line: number; name: string; errors: string[] }[] }

const bulan = (p: string) => ['', 'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'][Number(p.slice(5, 7))] + ' ' + p.slice(0, 4);

export default function ImporPage() {
  const [text, setText] = useState('');
  const [startYear, setStartYear] = useState(String(new Date().getFullYear()));
  const [entryDue, setEntryDue] = useState(`${new Date().getFullYear()}-06-30`);
  const [pv, setPv] = useState<Preview | null>(null); const [res, setRes] = useState<Result | null>(null);
  const [ok, setOk] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const body = () => ({ text, startYear: Number(startYear), entryDue });

  async function check() {
    setBusy(true); setErr(''); setRes(null); setOk(false);
    try { setPv(await api<Preview>('/import/preview', { method: 'POST', body: body() })); } catch (e) { setPv(null); setErr(errMsg(e)); } finally { setBusy(false); }
  }
  async function commit() {
    setBusy(true); setErr('');
    try { setRes(await api<Result>('/import/commit', { method: 'POST', body: { ...body(), confirm: true } })); setPv(null); setText(''); setOk(false); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <PageHeader title="Impor santri & tagihan" sub="Tempel hasil copy dari Excel atau Google Sheets. Diperiksa dulu, baru dimasukkan." />
      {res && (
        <div className="mb-4 space-y-3">
          <Alert tone="ok">Selesai. <strong>{res.santriCreated}</strong> santri baru, <strong>{res.invoicesCreated}</strong> tagihan dibuat ({res.overdueCreated} di antaranya sudah lewat jatuh tempo).{res.santriExisting + res.invoicesExisting > 0 && <> Dilewati karena sudah ada: {res.santriExisting} santri, {res.invoicesExisting} tagihan.</>} <Link href="/tagihan" className="font-semibold underline">Buka Tagihan</Link> · <Link href="/santri" className="font-semibold underline">Buka Santri</Link></Alert>
          {res.skipped.length > 0 && <Alert tone="warn">{res.skipped.length} baris tidak diimpor: {res.skipped.map((s) => `${s.name} (baris ${s.line})`).join(', ')}. Perbaiki di Excel lalu tempel lagi; yang sudah masuk tidak akan ganda.</Alert>}
        </div>
      )}
      {err && <div className="mb-4"><Alert>{err}</Alert></div>}

      <Card title="1. Tempel data">
        <div className="space-y-3">
          <Field label="Data dari Excel / Google Sheets" hint="Blok semua sel termasuk baris judul (NAMA, Seragam, peci, KELOMPOK, STATUS, U Gedung, SPP JUL, ...), salin, lalu tempel di sini. Baris bagian seperti &quot;ULA/ SD IKHWAN&quot; boleh ikut.">
            <textarea value={text} onChange={(e) => { setText(e.target.value); setPv(null); }} rows={8} spellCheck={false} placeholder="NAMA	Seragam	peci	KELOMPOK	STATUS	..." className="w-full rounded-lg border border-navy-200 bg-white p-3 font-mono text-xs focus:border-teal-500 focus:outline-none" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Tahun ajaran mulai (Juli)" hint="2026 untuk tahun ajaran 2026/2027: SPP Jul-Des 2026, Jan-Jun 2027, jatuh tempo tanggal 10."><Input type="number" min={2000} max={2100} value={startYear} onChange={(e) => { setStartYear(e.target.value); setPv(null); }} /></Field>
            <Field label="Jatuh tempo biaya awal" hint="Form pendaftaran, uang gedung, uang kegiatan, KBM, daftar ulang, dan sejenisnya (dibayar sebelum masuk)."><Input type="date" value={entryDue} onChange={(e) => { setEntryDue(e.target.value); setPv(null); }} /></Field>
          </div>
          <Button onClick={check} disabled={busy || !text.trim() || !startYear || !entryDue}>{busy && !pv ? 'Memeriksa…' : 'Periksa data (belum mengubah apa pun)'}</Button>
        </div>
      </Card>

      {pv && (
        <div className="mt-5 space-y-4">
          <Card title="2. Hasil pemeriksaan">
            <dl className="grid gap-3 text-sm sm:grid-cols-4">
              <div><dt className="text-navy-700">Santri baru</dt><dd className="text-2xl font-bold tabular-nums">{pv.summary.santriNew}</dd>{pv.summary.santriExisting > 0 && <dd className="text-xs text-navy-700">{pv.summary.santriExisting} sudah ada (namanya sama)</dd>}</div>
              <div><dt className="text-navy-700">Tagihan baru</dt><dd className="text-2xl font-bold tabular-nums">{pv.summary.invoicesNew}</dd>{pv.summary.invoicesExisting > 0 && <dd className="text-xs text-navy-700">{pv.summary.invoicesExisting} sudah ada</dd>}</div>
              <div><dt className="text-navy-700">Jumlah tagihan baru</dt><dd className="text-2xl font-bold tabular-nums">{rupiah(pv.summary.amountNew)}</dd></div>
              <div><dt className="text-navy-700">Sudah lewat jatuh tempo</dt><dd className="text-2xl font-bold tabular-nums text-red-700">{pv.summary.overdueNew}</dd><dd className="text-xs text-navy-700">{rupiah(pv.summary.overdueAmountNew)}</dd></div>
            </dl>
            {pv.summary.rowsError > 0 && <div className="mt-3"><Alert tone="warn"><strong>{pv.summary.rowsError} baris bermasalah</strong> dan tidak akan diimpor (lihat tanda merah di bawah). Perbaiki di Excel lalu periksa lagi, atau lanjutkan untuk yang benar saja.</Alert></div>}
            {pv.ignoredLines.length > 0 && <p className="mt-2 text-xs text-navy-700">Dilewati: {pv.ignoredLines.map((l) => `baris ${l.line} (${l.reason})`).join('; ')}</p>}
            <details className="mt-3 rounded-lg border border-navy-100 p-3 text-sm">
              <summary className="cursor-pointer font-medium">Cara kolom dibaca ({pv.columns.length} kolom)</summary>
              <ul className="mt-2 space-y-1">{pv.columns.map((c) => <li key={c.index} className="flex flex-wrap gap-x-2"><span className="font-mono text-xs text-navy-700">{c.header || '(kosong)'}</span><span>→ {c.label}</span></li>)}</ul>
              <p className="mt-2 text-xs text-navy-700">&quot;Rp -&quot; dianggap lunas dan sel kosong dianggap tidak ada tagihan, jadi keduanya tidak dibuatkan tagihan. Angka total di ujung baris dipakai untuk memeriksa jumlahnya.</p>
            </details>
          </Card>

          <Card title={`Santri (${pv.rows.length})`}>
            <ul className="divide-y divide-navy-50" data-testid="impor-rows">
              {pv.rows.map((r) => (
                <li key={r.line}>
                  <details className="group">
                    <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                      <span className="w-10 shrink-0 font-mono text-sm text-navy-700">{r.nis || '—'}</span>
                      <span className="min-w-0 flex-1 basis-48"><span className="font-medium">{r.name}</span><span className="block text-xs text-navy-700">{[r.kelas, r.statusLabel, r.bagian, r.catatan].filter(Boolean).join(' · ') || '—'}</span></span>
                      <span className="text-right text-sm"><span className="block font-medium">{rupiah(r.sum)}</span><span className="block text-xs text-navy-700">{r.invoices.length} tagihan</span></span>
                      <span className="flex gap-1">{r.errors.length ? <Badge tone="bad">Bermasalah</Badge> : <><Badge tone={r.isNew ? 'ok' : 'muted'}>{r.isNew ? 'Baru' : 'Sudah ada'}</Badge>{r.totalCheck === 'OK' && <Badge tone="ok">Total cocok</Badge>}{r.totalCheck === 'NONE' && <Badge tone="warn">Tanpa total</Badge>}</>}</span>
                    </summary>
                    <div className="mb-3 rounded-lg bg-navy-50/60 p-3 text-sm">
                      {r.errors.map((e) => <p key={e} className="font-medium text-red-700">✗ {e}</p>)}
                      {r.warnings.map((e) => <p key={e} className="text-amber-800">! {e}</p>)}
                      {r.invoices.length === 0 ? <p className="text-navy-700">Tidak ada tagihan (semua lunas atau kosong).</p> : (
                        <ul className="mt-1 grid gap-x-6 gap-y-1 sm:grid-cols-2">{r.invoices.map((i) => (
                          <li key={i.column + i.period} className="flex items-baseline justify-between gap-3"><span>{i.title}{i.title === 'SPP' ? ` ${bulan(i.period)}` : ''}<span className="text-xs text-navy-700"> · tempo {tanggal(i.dueDate)}</span>{i.exists && <span className="ml-1 text-xs text-navy-700">(sudah ada)</span>}</span><span className="tabular-nums">{rupiah(i.amount)}</span></li>
                        ))}</ul>
                      )}
                      <p className="mt-2 text-xs text-navy-700">Baris {r.line} di data yang ditempel{r.total !== null ? ` · total di Excel ${rupiah(r.total)}` : ''}</p>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </Card>

          <Card title="3. Impor">
            <label className="flex min-h-[44px] items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5" checked={ok} onChange={(e) => setOk(e.target.checked)} /><span>Saya sudah memeriksa pratinjau. Santri dan tagihan di atas akan dimasukkan ke data <strong>sebenarnya</strong>. Kartu QR/PIN tidak dibuat.</span></label>
            <div className="mt-3"><Button onClick={commit} disabled={busy || !ok || pv.summary.rowsOk === 0 || (pv.summary.santriNew === 0 && pv.summary.invoicesNew === 0)}>{busy ? 'Mengimpor…' : `Impor ${pv.summary.santriNew} santri dan ${pv.summary.invoicesNew} tagihan`}</Button></div>
            {pv.summary.santriNew === 0 && pv.summary.invoicesNew === 0 && <p className="mt-2 text-sm text-navy-700">Tidak ada yang baru: semua santri dan tagihan ini sudah ada.</p>}
          </Card>
        </div>
      )}
    </>
  );
}
