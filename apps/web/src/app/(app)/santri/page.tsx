'use client';
import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { api, errMsg, getSession } from '@/lib/api';
import { rupiah, STATUS_KARTU } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { ClassManager } from '@/components/ClassManager';
import { Alert, Badge, Button, Empty, Field, Input, Loading, Modal, PageHeader, Select, Table, Td } from '@/components/ui';

interface Row { id: string; nis: string; fullName: string; kelas: string | null; statusLabel?: string | null; bagian?: string | null; status: string; balance: number | null; cardStatus: string | null }

export default function SantriPage() {
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  useEffect(() => { const t = setTimeout(() => setDq(q), 300); return () => clearTimeout(t); }, [q]);
  const [kelas, setKelas] = useState('');
  const { data, error, loading, reload } = useApi<Row[]>('/santri', { q: dq || undefined, kelas: kelas || undefined });
  const all = useApi<Row[]>('/santri');
  const kelasOptions = Array.from(new Set((all.data ?? []).filter((r) => r.status === 'ACTIVE' && r.kelas).map((r) => r.kelas as string))).sort();
  const [modal, setModal] = useState<'add' | 'import' | 'class' | null>(null);
  const canEdit = ['SUPER_ADMIN', 'ADMIN'].includes(getSession()?.user.role ?? '');

  return (
    <>
      <PageHeader title="Santri" sub="Cari santri, lihat saldo dan status kartu."
        action={canEdit && <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setModal('class')}>Kelola kelas</Button><Button variant="secondary" onClick={() => setModal('import')}>Impor CSV</Button><Button onClick={() => setModal('add')}>Tambah santri</Button></div>} />
      <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,24rem)_12rem]"><Input type="search" placeholder="Cari nama atau NIS" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari santri" /><Select value={kelas} onChange={(e) => setKelas(e.target.value)} aria-label="Filter kelas"><option value="">Semua kelas</option>{kelasOptions.map((k) => <option key={k} value={k}>Kelas {k}</option>)}</Select></div>
      {loading && <Loading />}
      {error && <Alert>{error}</Alert>}
      {data && (data.length === 0
        ? <Empty>{dq ? 'Tidak ada santri yang cocok.' : 'Belum ada santri. Klik "Tambah santri" atau impor dari CSV.'}</Empty>
        : (
          <div className="rounded-card border border-navy-100 bg-white">
            <Table head={['Nama', 'No.', 'Kelas', 'Saldo', 'Kartu']}>
              {data.map((s) => {
                const k = s.cardStatus ? STATUS_KARTU[s.cardStatus] : null;
                return (
                  <tr key={s.id} className="hover:bg-navy-50/50">
                    <Td><Link href={`/santri/${s.id}`} className="font-medium text-navy-800 underline-offset-2 hover:underline">{s.fullName}</Link>{s.status !== 'ACTIVE' && <span className="ml-2"><Badge>{s.status}</Badge></span>}{s.statusLabel && <span className="ml-2"><Badge tone="info">{s.statusLabel}</Badge></span>}{s.bagian && <div className="text-xs text-navy-700">{s.bagian}</div>}</Td>
                    <Td>{s.nis}</Td><Td>{s.kelas ?? '-'}</Td><Td right>{rupiah(s.balance)}</Td>
                    <Td>{k ? <Badge tone={k.tone}>{k.label}</Badge> : <Badge>Belum ada kartu</Badge>}</Td>
                  </tr>
                );
              })}
            </Table>
          </div>
        ))}
      {modal === 'class' && <ClassManager kelasOptions={kelasOptions} onClose={() => setModal(null)} onChanged={() => { reload(); all.reload(); }} />}
      {modal === 'add' && <AddModal onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
      {modal === 'import' && <ImportModal onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
    </>
  );
}

function AddModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ nis: '', fullName: '', kelas: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await api('/santri', { method: 'POST', body: { nis: f.nis, fullName: f.fullName, kelas: f.kelas || undefined } }); onDone(); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Tambah santri" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {err && <Alert>{err}</Alert>}
        <Field label="NIS"><Input value={f.nis} onChange={(e) => setF({ ...f, nis: e.target.value })} required autoFocus /></Field>
        <Field label="Nama lengkap"><Input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required /></Field>
        <Field label="Kelas" hint="Contoh: 7A (boleh dikosongkan)"><Input value={f.kelas} onChange={(e) => setF({ ...f, kelas: e.target.value })} /></Field>
        <div className="flex justify-end gap-2 pt-2"><Button type="button" variant="ghost" onClick={onClose}>Batal</Button><Button disabled={busy}>{busy ? 'Menyimpan…' : 'Simpan santri'}</Button></div>
      </form>
    </Modal>
  );
}

function ImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState(''); const [res, setRes] = useState<{ created: number; skipped: string[] } | null>(null); const [busy, setBusy] = useState(false);
  function parse() {
    return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      .filter((l) => !/^nis\s*[,;\t]/i.test(l))
      .map((l) => { const [nis, fullName, kelas] = l.split(/[,;\t]/).map((x) => x.trim()); return { nis, fullName, kelas: kelas || undefined }; });
  }
  async function submit() {
    const rows = parse();
    const bad = rows.findIndex((r) => !r.nis || !r.fullName || r.fullName.length < 2);
    if (rows.length === 0) return setErr('Tempel data CSV terlebih dahulu.');
    if (bad >= 0) return setErr(`Baris ${bad + 1} tidak lengkap. Format: NIS, Nama, Kelas`);
    setBusy(true); setErr('');
    try { setRes(await api('/santri/bulk', { method: 'POST', body: { rows } })); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Impor santri dari CSV" onClose={onClose} wide>
      {res ? (
        <div className="space-y-3">
          <Alert tone="ok">{res.created} santri berhasil ditambahkan.</Alert>
          {res.skipped.length > 0 && <Alert tone="warn">{res.skipped.length} dilewati karena NIS sudah ada: {res.skipped.slice(0, 10).join(', ')}{res.skipped.length > 10 ? '…' : ''}</Alert>}
          <div className="flex justify-end"><Button onClick={onDone}>Selesai</Button></div>
        </div>
      ) : (
        <div className="space-y-3">
          {err && <Alert>{err}</Alert>}
          <Field label="Data santri" hint="Satu santri per baris, format: NIS, Nama, Kelas. Bisa tempel langsung dari Excel."><textarea value={text} onChange={(e) => setText(e.target.value)} rows={9} className="w-full rounded-lg border border-navy-200 p-3 font-mono text-sm" placeholder={'2026010, Ahmad Fadil, 7A\n2026011, Siti Nurhaliza, 7B'} /></Field>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Batal</Button><Button onClick={submit} disabled={busy}>{busy ? 'Mengimpor…' : 'Impor santri'}</Button></div>
        </div>
      )}
    </Modal>
  );
}
