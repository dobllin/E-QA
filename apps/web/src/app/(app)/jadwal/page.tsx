'use client';
import { FormEvent, useState } from 'react';
import { api, apiDownload, errMsg } from '@/lib/api';
import { useApi } from '@/lib/use-api';
import { Alert, Badge, Button, Empty, Field, Input, Loading, Modal, PageHeader, Select, Table, Td } from '@/components/ui';

const HARI = ['', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Ahad'];
interface Sched { id: string; subject: string; kelas: string | null; teacherId: string | null; teacherName: string | null; dayOfWeek: number; startTime: string; endTime: string; isActive: boolean }
interface Teacher { id: string; fullName: string; username: string }
interface Row { day: string; time: string; subject: string; hours: string; nis: string; santriName: string; kelas: string | null; status: string; operatorName: string; accountName: string | null }
const todayJakarta = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());

export default function JadwalPage() {
  const [tab, setTab] = useState<'jadwal' | 'laporan'>('jadwal');
  return (
    <>
      <PageHeader title="Jadwal & laporan absen" sub="Atur jadwal pelajaran untuk absen guru, lalu lihat hasil absen santri." />
      <div className="mb-5 flex gap-2">
        {(['jadwal', 'laporan'] as const).map((t) => <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-4 py-2 text-sm font-medium ${tab === t ? 'bg-navy-800 text-white' : 'border border-navy-200 bg-white text-navy-800'}`}>{t === 'jadwal' ? 'Jadwal pelajaran' : 'Laporan absen'}</button>)}
      </div>
      {tab === 'jadwal' ? <Jadwal /> : <Laporan />}
    </>
  );
}

function Jadwal() {
  const { data, error, loading, reload } = useApi<Sched[]>('/attendance/schedules');
  const teachers = useApi<Teacher[]>('/attendance/teachers');
  const [edit, setEdit] = useState<Sched | 'new' | null>(null);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <Terlambat />
        <Button size="lg" onClick={() => setEdit('new')}>Tambah jadwal</Button>
      </div>
      {loading && <Loading />}{error && <Alert>{error}</Alert>}
      {data && (data.length === 0 ? <Empty>Belum ada jadwal. Tekan &quot;Tambah jadwal&quot;. Pastikan akun Guru sudah dibuat di menu Pengguna.</Empty> : (
        <div className="rounded-card border border-navy-100 bg-white">
          <Table head={['Hari', 'Jam', 'Pelajaran', 'Kelas', 'Akun guru', 'Status', '']}>
            {data.map((s) => (
              <tr key={s.id} className={s.isActive ? '' : 'text-navy-700'}>
                <Td className="font-medium">{HARI[s.dayOfWeek]}</Td><Td>{s.startTime} – {s.endTime}</Td><Td>{s.subject}</Td><Td>{s.kelas ?? 'Semua'}</Td>
                <Td>{s.teacherName ?? <span className="text-navy-700">Semua akun guru</span>}</Td>
                <Td>{s.isActive ? <Badge tone="ok">Aktif</Badge> : <Badge>Nonaktif</Badge>}</Td>
                <Td right><Button variant="ghost" onClick={() => setEdit(s)}>Ubah</Button></Td>
              </tr>
            ))}
          </Table>
        </div>
      ))}
      {edit && <Form s={edit === 'new' ? null : edit} teachers={teachers.data ?? []} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </>
  );
}

function Terlambat() {
  const { data } = useApi<{ lateMinutes: number; earlyMinutes: number }>('/attendance/settings');
  const [v, setV] = useState<string | null>(null); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const val = v ?? String(data?.lateMinutes ?? 10);
  async function save() { setErr(''); setMsg(''); try { await api('/attendance/settings', { method: 'PUT', body: { lateMinutes: Number(val) } }); setMsg('Tersimpan.'); } catch (e) { setErr(errMsg(e)); } }
  return (
    <div className="max-w-md rounded-card border border-navy-100 bg-white p-4">
      <div className="text-sm font-medium text-navy-800">Dianggap terlambat bila scan lewat</div>
      <div className="mt-1 flex items-center gap-2"><Input type="number" min={0} max={120} value={val} onChange={(e) => { setV(e.target.value); setMsg(''); }} className="!w-24" aria-label="Menit" /><span className="text-sm">menit dari jam mulai</span><Button variant="secondary" onClick={save} disabled={!data}>Simpan</Button></div>
      <div className="mt-1 text-xs text-navy-700">Guru boleh mulai scan {data?.earlyMinutes ?? 10} menit sebelum jam mulai. Di luar jam pelajaran scan ditolak.</div>
      {msg && <div className="mt-2"><Alert tone="ok">{msg}</Alert></div>}{err && <div className="mt-2"><Alert>{err}</Alert></div>}
    </div>
  );
}

function Form({ s, teachers, onClose, onDone }: { s: Sched | null; teachers: Teacher[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ subject: s?.subject ?? '', kelas: s?.kelas ?? '', teacherId: s?.teacherId ?? '', start: s?.startTime ?? '07:30', end: s?.endTime ?? '08:30', active: s?.isActive ?? true, day: s?.dayOfWeek ?? 1 });
  const [days, setDays] = useState<number[]>([1]); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      if (s) await api(`/attendance/schedules/${s.id}`, { method: 'PATCH', body: { subject: f.subject, kelas: f.kelas, teacherId: f.teacherId, dayOfWeek: f.day, startTime: f.start, endTime: f.end, isActive: f.active } });
      else {
        if (!days.length) throw new Error('x');
        await api('/attendance/schedules', { method: 'POST', body: { subject: f.subject, ...(f.kelas.trim() ? { kelas: f.kelas.trim() } : {}), ...(f.teacherId ? { teacherId: f.teacherId } : {}), days, startTime: f.start, endTime: f.end } });
      }
      onDone();
    } catch (e) { setErr(e instanceof Error && e.message === 'x' ? 'Pilih minimal satu hari' : errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title={s ? 'Ubah jadwal' : 'Tambah jadwal'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {err && <Alert>{err}</Alert>}
        <Field label="Mata pelajaran"><Input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} required minLength={2} autoFocus placeholder="Contoh: Fiqih" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Jam mulai"><Input type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} required /></Field>
          <Field label="Jam selesai"><Input type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} required /></Field>
        </div>
        {s ? (
          <Field label="Hari"><Select value={f.day} onChange={(e) => setF({ ...f, day: Number(e.target.value) })}>{HARI.slice(1).map((h, i) => <option key={h} value={i + 1}>{h}</option>)}</Select></Field>
        ) : (
          <div><div className="mb-1 text-sm font-medium text-navy-800">Hari (boleh lebih dari satu)</div>
            <div className="flex flex-wrap gap-2">{HARI.slice(1).map((h, i) => { const on = days.includes(i + 1); return <button key={h} type="button" aria-pressed={on} onClick={() => setDays(on ? days.filter((d) => d !== i + 1) : [...days, i + 1])} className={`min-h-[44px] rounded-lg px-3 text-sm font-medium ${on ? 'bg-navy-800 text-white' : 'border border-navy-200 bg-white text-navy-800'}`}>{h}</button>; })}</div></div>
        )}
        <Field label="Kelas" hint="Kosongkan bila semua kelas. Jika diisi, hanya santri kelas itu yang bisa discan dan daftar &quot;belum hadir&quot; ikut tampil."><Input value={f.kelas} onChange={(e) => setF({ ...f, kelas: e.target.value })} placeholder="Contoh: 7A" /></Field>
        <Field label="Akun guru yang memakai" hint="Satu akun boleh dipakai bergantian beberapa guru. Pilih &quot;Semua akun guru&quot; bila jadwal ini bebas dipakai."><Select value={f.teacherId} onChange={(e) => setF({ ...f, teacherId: e.target.value })}><option value="">Semua akun guru</option>{teachers.map((t) => <option key={t.id} value={t.id}>{t.fullName} (@{t.username})</option>)}</Select></Field>
        {s && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Jadwal aktif</label>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Batal</Button><Button disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan'}</Button></div>
      </form>
    </Modal>
  );
}

function Laporan() {
  const [from, setFrom] = useState(todayJakarta()); const [to, setTo] = useState(todayJakarta()); const [kelas, setKelas] = useState(''); const [sid, setSid] = useState('');
  const scheds = useApi<Sched[]>('/attendance/schedules');
  const { data, error, loading } = useApi<Row[]>('/attendance/report', { from, to, kelas: kelas.trim() || undefined, scheduleId: sid || undefined });
  const [err, setErr] = useState('');
  async function csv() {
    setErr('');
    const q = new URLSearchParams({ from, to, ...(kelas.trim() ? { kelas: kelas.trim() } : {}), ...(sid ? { scheduleId: sid } : {}) }).toString();
    try { await apiDownload(`/attendance/report.csv?${q}`, `absen-${from}${to !== from ? `_${to}` : ''}.csv`); } catch (e) { setErr(errMsg(e)); }
  }
  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Dari tanggal"><Input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /></Field>
        <Field label="Sampai tanggal"><Input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} /></Field>
        <Field label="Kelas santri"><Input value={kelas} onChange={(e) => setKelas(e.target.value)} placeholder="Semua" /></Field>
        <Field label="Jadwal"><Select value={sid} onChange={(e) => setSid(e.target.value)}><option value="">Semua pelajaran</option>{(scheds.data ?? []).map((s) => <option key={s.id} value={s.id}>{HARI[s.dayOfWeek]} {s.startTime} {s.subject}{s.kelas ? ` (${s.kelas})` : ''}</option>)}</Select></Field>
        <div className="flex items-end"><Button size="lg" className="w-full" onClick={csv} disabled={!data || data.length === 0}>Unduh Excel (CSV)</Button></div>
      </div>
      {err && <Alert>{err}</Alert>}{error && <Alert>{error}</Alert>}{loading && <Loading />}
      {data && (data.length === 0 ? <Empty>Tidak ada catatan absen pada rentang ini.</Empty> : (
        <div className="rounded-card border border-navy-100 bg-white">
          <Table head={['Tanggal', 'Jam', 'Pelajaran', 'Santri', 'Kelas', 'Status', 'Dicatat oleh']}>
            {data.map((r, i) => (
              <tr key={i}>
                <Td>{r.day.split('-').reverse().join('/')}</Td><Td>{r.time}</Td><Td>{r.subject}<div className="text-xs text-navy-700">{r.hours}</div></Td>
                <Td><div className="font-medium">{r.santriName}</div><div className="text-xs text-navy-700">{r.nis}</div></Td><Td>{r.kelas ?? '-'}</Td>
                <Td>{r.status === 'TERLAMBAT' ? <Badge tone="warn">Terlambat</Badge> : <Badge tone="ok">Hadir</Badge>}</Td><Td>{r.operatorName}</Td>
              </tr>
            ))}
          </Table>
          {data.length >= 2000 && <div className="p-3 text-xs text-navy-700">Hanya 2.000 baris pertama yang ditampilkan. Persempit rentang tanggal.</div>}
        </div>
      ))}
    </>
  );
}
