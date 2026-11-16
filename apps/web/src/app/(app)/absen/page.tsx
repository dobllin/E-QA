'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errMsg } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { Alert, Badge, Button, Empty, Field, Input, Loading, PageHeader } from '@/components/ui';
import { CameraScanner } from '@/components/CameraScanner';

interface Sched { id: string; subject: string; kelas: string | null; startTime: string; endTime: string; present: number; state: 'NOW' | 'LATER' | 'DONE' }
interface Today { date: string; dayName: string; items: Sched[] }
interface Detail {
  schedule: { id: string; subject: string; kelas: string | null; startTime: string; endTime: string };
  present: { id: string; time: string; status: 'HADIR' | 'TERLAMBAT'; operatorName: string; santriName: string; nis: string; kelas: string | null }[];
  absent: { id: string; santriName: string; nis: string }[] | null;
}
type Out = { kind: 'ok'; name: string; status: string; time: string; duplicate: boolean } | { kind: 'err'; message: string } | null;
const NAME_KEY = 'eqa.absen.operator';
const readName = () => { try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; } };

function beep(ok: boolean) {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext; const ctx = new AC();
    const o = ctx.createOscillator(); const g = ctx.createGain(); o.connect(g); g.connect(ctx.destination);
    o.type = 'sine'; o.frequency.value = ok ? 880 : 220; g.gain.value = 0.15; o.start(); o.stop(ctx.currentTime + (ok ? 0.12 : 0.3)); setTimeout(() => ctx.close(), 500);
  } catch { /* bunyi tidak tersedia */ }
}

export default function AbsenPage() {
  const [name, setName] = useState(''); const [nameSet, setNameSet] = useState(false);
  const { data, error, loading, reload } = useApi<Today>('/attendance/my-today');
  const ops = useApi<string[]>('/attendance/operators');
  const [pick, setPick] = useState<string | null>(null);
  useEffect(() => { const n = readName(); if (n) { setName(n); setNameSet(true); } }, []);
  useEffect(() => { const t = setInterval(reload, 60_000); return () => clearInterval(t); }, [reload]);

  function saveName() {
    const n = name.trim(); if (n.length < 2) return;
    try { localStorage.setItem(NAME_KEY, n); } catch { /* abaikan */ }
    setName(n); setNameSet(true);
  }

  if (pick && data) return <ScanView scheduleId={pick} operator={name} onBack={() => { setPick(null); reload(); }} />;
  return (
    <>
      <PageHeader title="Absen kelas" sub={data ? `${data.dayName}, ${data.date.split('-').reverse().join('/')} — pilih pelajaran lalu scan kartu santri. Tidak perlu PIN.` : 'Pilih pelajaran lalu scan kartu santri.'} />
      <div className="mb-5 rounded-card border border-navy-100 bg-white p-4">
        {nameSet ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><div className="text-sm text-navy-700">Yang sedang memakai akun ini</div><div className="text-lg font-semibold text-navy-900">{name}</div></div>
            <Button variant="secondary" onClick={() => setNameSet(false)}>Ganti nama</Button>
          </div>
        ) : (
          <div className="space-y-2">
            <Field label="Siapa yang sedang memakai akun ini?" hint="Ketik nama Anda (atau pilih). Setiap absen yang Anda catat akan memakai nama ini.">
              <Input list="op-names" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveName()} placeholder="Contoh: Ust. Ahmad" maxLength={60} autoFocus />
            </Field>
            <datalist id="op-names">{(ops.data ?? []).map((n) => <option key={n} value={n} />)}</datalist>
            <Button size="lg" onClick={saveName} disabled={name.trim().length < 2}>Simpan nama</Button>
          </div>
        )}
      </div>
      {loading && <Loading />}{error && <Alert>{error}</Alert>}
      {data && (data.items.length === 0 ? <Empty>Tidak ada jadwal pelajaran untuk akun ini hari ini. Jadwal diatur oleh admin.</Empty> : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {data.items.map((s) => (
            <li key={s.id} className={`rounded-card border bg-white p-4 ${s.state === 'NOW' ? 'border-teal-500' : 'border-navy-100'}`}>
              <div className="flex items-start justify-between gap-2">
                <div><div className="text-lg font-semibold text-navy-900">{s.subject}</div><div className="text-sm text-navy-700">{s.startTime} – {s.endTime}{s.kelas ? ` · Kelas ${s.kelas}` : ' · Semua kelas'}</div></div>
                {s.state === 'NOW' ? <Badge tone="ok">Sedang berlangsung</Badge> : s.state === 'DONE' ? <Badge>Selesai</Badge> : <Badge tone="info">Belum mulai</Badge>}
              </div>
              <div className="mt-2 text-sm text-navy-700">{s.present} santri sudah tercatat hadir</div>
              <Button size="lg" className="mt-3 w-full" variant={s.state === 'NOW' ? 'primary' : 'secondary'} disabled={!nameSet} onClick={() => setPick(s.id)}>{s.state === 'NOW' ? 'Mulai absen' : 'Lihat daftar'}</Button>
              {!nameSet && <div className="mt-1 text-xs text-amber-900">Simpan nama Anda dulu di atas.</div>}
            </li>
          ))}
        </ul>
      ))}
    </>
  );
}

function ScanView({ scheduleId, operator, onBack }: { scheduleId: string; operator: string; onBack: () => void }) {
  const { data, error, reload } = useApi<Detail>(`/attendance/schedules/${scheduleId}/today`);
  const [code, setCode] = useState(''); const [busy, setBusy] = useState(false); const [out, setOut] = useState<Out>(null);
  const [camera, setCamera] = useState(false); const [loop, setLoop] = useState(true); const [tab, setTab] = useState<'hadir' | 'belum'>('hadir');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const submit = useCallback(async (raw: string) => {
    const c = raw.trim().toUpperCase();
    if (c.length < 8 || busy) return;
    setBusy(true);
    try {
      const r = await api<{ duplicate: boolean; santriName: string; status: string; time: string }>('/attendance/scan', { method: 'POST', body: { scheduleId, barcode: c, operatorName: operator } });
      setOut({ kind: 'ok', name: r.santriName, status: r.status, time: r.time, duplicate: r.duplicate }); beep(true); reload();
    } catch (e) { setOut({ kind: 'err', message: errMsg(e) }); beep(false); }
    finally { setBusy(false); setCode(''); setTimeout(() => inputRef.current?.focus(), 50); }
  }, [busy, scheduleId, operator, reload]);

  async function undo(id: string) { try { await api(`/attendance/${id}`, { method: 'DELETE' }); reload(); setOut(null); } catch (e) { setOut({ kind: 'err', message: errMsg(e) }); } }
  const s = data?.schedule;
  return (
    <>
      <PageHeader title={s ? s.subject : 'Absen'} sub={s ? `${s.startTime} – ${s.endTime}${s.kelas ? ` · Kelas ${s.kelas}` : ' · Semua kelas'} · dicatat oleh ${operator}` : ''} action={<Button variant="secondary" onClick={onBack}>← Kembali ke daftar pelajaran</Button>} />
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <div className="h-fit space-y-4 rounded-card border border-navy-100 bg-white p-5">
          <Field label="Scan kartu santri" hint="Arahkan scanner ke QR kartu (otomatis tercatat), atau ketik kode 16 karakter lalu tekan Enter.">
            <Input ref={inputRef} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(code); } }} autoComplete="off" spellCheck={false} placeholder="Kode kartu…" />
          </Field>
          <Button size="lg" className="w-full" onClick={() => submit(code)} disabled={busy || code.trim().length < 8}>{busy ? 'Mencatat…' : 'Catat hadir'}</Button>
          <Button size="lg" variant="secondary" className="w-full" onClick={() => setCamera(true)}>Scan pakai kamera</Button>
          <label className="flex items-center gap-2 text-sm text-navy-700"><input type="checkbox" className="h-5 w-5" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Buka kamera lagi otomatis untuk santri berikutnya</label>
          {out?.kind === 'ok' && (
            <div role="status" className={`rounded-lg p-4 ${out.duplicate ? 'bg-sky-50 text-sky-800' : out.status === 'TERLAMBAT' ? 'bg-amber-50 text-amber-900' : 'bg-teal-50 text-teal-700'}`}>
              <div className="text-xl font-semibold">{out.name}</div>
              <div className="text-base">{out.duplicate ? `Sudah tercatat tadi pukul ${out.time}` : out.status === 'TERLAMBAT' ? `Terlambat — pukul ${out.time}` : `Hadir — pukul ${out.time}`}</div>
            </div>
          )}
          {out?.kind === 'err' && <div role="alert" className="rounded-lg border-2 border-red-300 bg-red-50 p-4 text-lg font-semibold text-red-800">{out.message}</div>}
        </div>

        <div className="min-w-0 rounded-card border border-navy-100 bg-white p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button onClick={() => setTab('hadir')} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === 'hadir' ? 'bg-navy-800 text-white' : 'border border-navy-200 text-navy-800'}`}>Sudah hadir ({data?.present.length ?? 0})</button>
            {data?.absent && <button onClick={() => setTab('belum')} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === 'belum' ? 'bg-navy-800 text-white' : 'border border-navy-200 text-navy-800'}`}>Belum hadir ({data.absent.length})</button>}
          </div>
          {!data ? <Loading /> : tab === 'hadir' ? (
            data.present.length === 0 ? <Empty>Belum ada santri yang discan.</Empty> : (
              <ul className="divide-y divide-navy-50">{data.present.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0"><div className="font-medium">{p.santriName}</div><div className="text-xs text-navy-700">{p.nis}{p.kelas ? ` · ${p.kelas}` : ''} · {p.time} · oleh {p.operatorName}</div></div>
                  <div className="flex shrink-0 items-center gap-2">{p.status === 'TERLAMBAT' ? <Badge tone="warn">Terlambat</Badge> : <Badge tone="ok">Hadir</Badge>}<Button variant="ghost" onClick={() => undo(p.id)} aria-label={`Batalkan ${p.santriName}`}>Batalkan</Button></div>
                </li>))}</ul>
            )
          ) : (data?.absent?.length ? <ul className="divide-y divide-navy-50">{data.absent.map((a) => <li key={a.id} className="py-2.5"><div className="font-medium">{a.santriName}</div><div className="text-xs text-navy-700">{a.nis}</div></li>)}</ul> : <Empty>Semua santri kelas ini sudah hadir. 🎉</Empty>)}
        </div>
      </div>
      {camera && <CameraScanner onClose={() => setCamera(false)} onResult={async (t) => { setCamera(false); await submit(t); if (loop) setTimeout(() => setCamera(true), 1300); }} />}
    </>
  );
}
