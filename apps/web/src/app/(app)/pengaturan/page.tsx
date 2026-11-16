'use client';
import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { api, apiUpload, errMsg } from '@/lib/api';
import { loadSchool, schoolLogoUrl, useSchool } from '@/lib/school';
import { Alert, Button, Card, Field, Input, PageHeader } from '@/components/ui';

export default function PengaturanPage() {
  const school = useSchool();
  const [name, setName] = useState<string | null>(null); const [bust, setBust] = useState(1);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null); const [busy, setBusy] = useState(false);
  const shown = name ?? school?.name ?? '';
  async function saveName(e: FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try { await api('/settings/school', { method: 'PUT', body: { name: shown } }); await loadSchool(true); setMsg({ tone: 'ok', text: 'Nama pesantren disimpan.' }); } catch (e) { setMsg({ tone: 'bad', text: errMsg(e) }); } finally { setBusy(false); }
  }
  async function logo(f?: File) {
    if (!f) return; setMsg(null);
    if (f.size > 1024 * 1024) return setMsg({ tone: 'bad', text: 'Ukuran logo maksimal 1 MB.' });
    setBusy(true);
    try { const fd = new FormData(); fd.append('file', f); await apiUpload('/settings/school/logo', fd, 'PUT'); await loadSchool(true); setBust((b) => b + 1); setMsg({ tone: 'ok', text: 'Logo disimpan.' }); } catch (e) { setMsg({ tone: 'bad', text: errMsg(e) }); } finally { setBusy(false); }
  }
  async function removeLogo() { setBusy(true); try { await api('/settings/school/logo', { method: 'DELETE' }); await loadSchool(true); setBust((b) => b + 1); setMsg({ tone: 'ok', text: 'Logo dihapus.' }); } catch (e) { setMsg({ tone: 'bad', text: errMsg(e) }); } finally { setBusy(false); } }
  return (
    <>
      <PageHeader title="Pengaturan sekolah" sub="Identitas yang tampil di halaman login, menu, dan kartu santri." />
      {msg && <div className="mb-4"><Alert tone={msg.tone}>{msg.text}</Alert></div>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Nama dan logo pesantren">
          <form onSubmit={saveName} className="space-y-3">
            <Field label="Nama pesantren" hint="Tampil di menu, halaman login, dan kartu santri."><Input value={shown} onChange={(e) => setName(e.target.value)} maxLength={80} required minLength={2} placeholder="Contoh: Pesantren Al-Hikmah" /></Field>
            <Button disabled={busy}>Simpan nama</Button>
          </form>
          <div className="mt-5 border-t border-navy-50 pt-4">
            <div className="mb-2 text-sm font-medium text-navy-800">Logo (PNG/JPG, maksimal 1 MB, sebaiknya persegi)</div>
            {school?.hasLogo && <img src={schoolLogoUrl(bust)} alt="Logo pesantren" className="mb-3 h-20 w-20 rounded-lg border border-navy-100 bg-white object-contain p-1" />}
            <div className="flex flex-wrap items-center gap-2">
              <input type="file" accept="image/png,image/jpeg,image/webp" aria-label="Logo pesantren" disabled={busy} onChange={(e) => logo(e.target.files?.[0])} />
              {school?.hasLogo && <Button type="button" variant="ghost" onClick={removeLogo} disabled={busy}>Hapus logo</Button>}
            </div>
            <p className="mt-2 text-xs text-navy-700">Kartu yang dibuat sesudah ini otomatis memakai nama dan logo ini. Kartu yang sudah dicetak tidak berubah.</p>
          </div>
        </Card>
        <Card title="Pengaturan lain">
          <ul className="space-y-3 text-sm">
            <li><div className="font-medium">Rekening, QRIS, biaya layanan, dan toleransi transfer</div><div className="text-navy-700">Ada di halaman <Link href="/topup" className="underline">Top up masuk</Link>, tombol Pengaturan.</div></li>
            <li><div className="font-medium">Akun staf dan wali</div><div className="text-navy-700">Ada di halaman <Link href="/pengguna" className="underline">Pengguna</Link>.</div></li>
            <li><div className="font-medium">Produk kantin dan layanan laundry</div><div className="text-navy-700">Ada di halaman <Link href="/produk" className="underline">Produk kantin</Link> (tab Kantin dan Laundry).</div></li>
          </ul>
        </Card>
      </div>
    </>
  );
}
