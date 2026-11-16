'use client';
import { FormEvent, useState } from 'react';
import { api, errMsg, getSession } from '@/lib/api';
import { tanggal } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { Alert, Badge, Button, Field, Input, Loading, Modal, PageHeader, Select, Table, Td } from '@/components/ui';

interface U { id: string; username: string; fullName: string; phone: string | null; role: string; isActive: boolean; createdAt: string }
const ROLE: Record<string, string> = { SUPER_ADMIN: 'Super Admin', ADMIN: 'Admin', BENDAHARA: 'Bendahara', KASIR: 'Kasir', LAUNDRY: 'Laundry', GURU: 'Guru', WALSAN: 'Wali santri' };

export default function PenggunaPage() {
  const me = getSession()?.user;
  const { data, error, loading, reload } = useApi<U[]>('/users');
  const [modal, setModal] = useState<'new' | { reset: U } | { edit: U } | null>(null);
  const [err, setErr] = useState('');
  async function toggle(u: U) { setErr(''); try { await api(`/users/${u.id}/active`, { method: 'PATCH', body: { isActive: !u.isActive } }); reload(); } catch (e) { setErr(errMsg(e)); } }
  return (
    <>
      <PageHeader title="Pengguna" sub="Akun staf dan wali santri. Santri tidak punya akun; mereka memakai kartu + PIN." action={<Button onClick={() => setModal('new')}>Tambah pengguna</Button>} />
      {err && <div className="mb-3"><Alert>{err}</Alert></div>}
      {loading && <Loading />}{error && <Alert>{error}</Alert>}
      {data && (
        <div className="rounded-card border border-navy-100 bg-white">
          <Table head={['Nama', 'Username', 'Peran', 'Nomor HP', 'Dibuat', 'Status', '']}>
            {data.map((u) => (
              <tr key={u.id}>
                <Td className="font-medium">{u.fullName}</Td><Td>@{u.username}</Td><Td>{ROLE[u.role]}</Td><Td>{u.phone ? u.phone : u.role === 'WALSAN' ? <span className="text-xs text-red-700">Belum diisi</span> : <span className="text-navy-200">-</span>}</Td><Td>{tanggal(u.createdAt)}</Td>
                <Td>{u.isActive ? <Badge tone="ok">Aktif</Badge> : <Badge tone="bad">Nonaktif</Badge>}</Td>
                <Td right><div className="flex justify-end gap-1"><Button variant="ghost" onClick={() => setModal({ edit: u })}>Ubah</Button><Button variant="ghost" onClick={() => setModal({ reset: u })}>Reset password</Button>{u.id !== me?.id && <Button variant="ghost" onClick={() => toggle(u)}>{u.isActive ? 'Nonaktifkan' : 'Aktifkan'}</Button>}</div></Td>
              </tr>
            ))}
          </Table>
        </div>
      )}
      {modal === 'new' && <NewUser onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} isSuper={me?.role === 'SUPER_ADMIN'} />}
      {modal && typeof modal === 'object' && 'reset' in modal && <Reset u={modal.reset} onClose={() => setModal(null)} />}
      {modal && typeof modal === 'object' && 'edit' in modal && <Edit u={modal.edit} onClose={() => setModal(null)} onDone={() => { setModal(null); reload(); }} />}
    </>
  );
}

function NewUser({ onClose, onDone, isSuper }: { onClose: () => void; onDone: () => void; isSuper: boolean }) {
  const [f, setF] = useState({ fullName: '', username: '', password: '', phone: '', role: 'WALSAN' }); const [err, setErr] = useState('');
  async function submit(e: FormEvent) { e.preventDefault(); try { await api('/users', { method: 'POST', body: { ...f, phone: f.phone.trim() || undefined } }); onDone(); } catch (e) { setErr(errMsg(e)); } }
  return (
    <Modal title="Tambah pengguna" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {err && <Alert>{err}</Alert>}
        <Field label="Nama lengkap"><Input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} required autoFocus /></Field>
        <Field label="Username" hint="Huruf, angka, titik, strip. Contoh: bapak.ahmad"><Input value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required /></Field>
        <Field label="Password awal" hint="Minimal 8 karakter. Minta pengguna menggantinya."><Input type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} minLength={8} required /></Field>
        <Field label="Nomor HP / WhatsApp" hint={f.role === 'WALSAN' ? 'Penting untuk wali: dipakai mengingatkan tunggakan lewat WhatsApp. Contoh: 081234567890' : 'Boleh dikosongkan'}><Input type="tel" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="081234567890" /></Field>
        <Field label="Peran"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
          <option value="WALSAN">Wali santri</option><option value="KASIR">Kasir (kantin)</option><option value="LAUNDRY">Laundry</option><option value="BENDAHARA">Bendahara</option><option value="GURU">Guru</option>{isSuper && <option value="ADMIN">Admin</option>}
        </Select></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Batal</Button><Button>Buat akun</Button></div>
      </form>
    </Modal>
  );
}

function Edit({ u, onClose, onDone }: { u: U; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(u.fullName); const [phone, setPhone] = useState(u.phone ?? ''); const [err, setErr] = useState('');
  async function submit(e: FormEvent) { e.preventDefault(); try { await api(`/users/${u.id}`, { method: 'PATCH', body: { fullName: name, phone } }); onDone(); } catch (e) { setErr(errMsg(e)); } }
  return (
    <Modal title={`Ubah — @${u.username}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {err && <Alert>{err}</Alert>}
        <Field label="Nama lengkap"><Input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoFocus /></Field>
        <Field label="Nomor HP / WhatsApp" hint="Kosongkan untuk menghapus nomor. Contoh: 081234567890"><Input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="081234567890" /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Batal</Button><Button>Simpan</Button></div>
      </form>
    </Modal>
  );
}

function Reset({ u, onClose }: { u: U; onClose: () => void }) {
  const [p, setP] = useState(''); const [err, setErr] = useState(''); const [ok, setOk] = useState(false);
  async function submit(e: FormEvent) { e.preventDefault(); try { await api(`/users/${u.id}/reset-password`, { method: 'POST', body: { password: p } }); setOk(true); } catch (e) { setErr(errMsg(e)); } }
  return (
    <Modal title={`Reset password — ${u.fullName}`} onClose={onClose}>
      {ok ? <div className="space-y-3"><Alert tone="ok">Password diganti. Semua sesi login pengguna ini dikeluarkan.</Alert><div className="flex justify-end"><Button onClick={onClose}>Tutup</Button></div></div> : (
        <form onSubmit={submit} className="space-y-3">
          {err && <Alert>{err}</Alert>}
          <Field label="Password baru" hint="Minimal 8 karakter"><Input value={p} onChange={(e) => setP(e.target.value)} minLength={8} required autoFocus /></Field>
          <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Batal</Button><Button>Simpan password</Button></div>
        </form>
      )}
    </Modal>
  );
}
