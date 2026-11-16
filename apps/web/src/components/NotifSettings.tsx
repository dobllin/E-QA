'use client';
import { useEffect, useState } from 'react';
import { api, errMsg } from '@/lib/api';
import { askPopupPermission, popupOn, popupPermission, popupSupported, setPopupOn, showPopup } from '@/lib/alerts';
import { announce, setSoundOn, setVoiceOn, soundOn, unlockAudio, voiceOn } from '@/lib/sound';
import { Alert, Button, Modal } from './ui';

type PayType = { key: string; label: string; hint: string; enabled: boolean };

/** Pengaturan notifikasi untuk Admin/Bendahara: jenis pembayaran apa yang diberi tahu + popup/bunyi di browser ini. */
export function NotifSettings({ onClose }: { onClose: () => void }) {
  const [types, setTypes] = useState<PayType[] | null>(null);
  const [err, setErr] = useState(''); const [saved, setSaved] = useState(false); const [busy, setBusy] = useState(false);
  const [perm, setPerm] = useState(popupPermission()); const [pop, setPop] = useState(popupOn());
  const [snd, setSnd] = useState(soundOn()); const [voice, setVoice] = useState(voiceOn());
  useEffect(() => { api<{ types: PayType[] }>('/notifications/prefs').then((r) => setTypes(r.types)).catch((e) => setErr(errMsg(e))); }, []);

  async function save() {
    if (!types) return; setBusy(true); setErr(''); setSaved(false);
    try { const r = await api<{ types: PayType[] }>('/notifications/prefs', { method: 'PUT', body: { muted: types.filter((t) => !t.enabled).map((t) => t.key) } }); setTypes(r.types); setSaved(true); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Atur notifikasi" onClose={onClose}>
      <div className="space-y-5 text-sm">
        {err && <Alert>{err}</Alert>}
        <section>
          <h3 className="mb-1 font-semibold text-navy-900">Beri tahu saya bila ada…</h3>
          <p className="mb-2 text-xs text-navy-700">Pilihan ini berlaku untuk akun Anda saja.</p>
          {!types ? <p>Memuat…</p> : (
            <ul className="space-y-1">{types.map((t) => (
              <li key={t.key}>
                <label className="flex min-h-[44px] items-start gap-3 rounded-lg px-1 py-1.5 hover:bg-navy-50">
                  <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={t.enabled} onChange={(e) => { setSaved(false); setTypes(types.map((x) => (x.key === t.key ? { ...x, enabled: e.target.checked } : x))); }} />
                  <span><span className="font-medium text-navy-900">{t.label}</span><span className="block text-xs text-navy-700">{t.hint}</span></span>
                </label>
              </li>
            ))}</ul>
          )}
          <div className="mt-2 flex items-center gap-3"><Button onClick={save} disabled={busy || !types}>{busy ? 'Menyimpan…' : 'Simpan pilihan'}</Button>{saved && <span className="text-teal-700">Tersimpan.</span>}</div>
        </section>

        <section className="space-y-1 border-t border-navy-50 pt-4">
          <h3 className="mb-1 font-semibold text-navy-900">Di browser ini</h3>
          <label className="flex min-h-[44px] items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={snd} onChange={async (e) => { setSnd(e.target.checked); setSoundOn(e.target.checked); await unlockAudio(); }} /> Bunyi saat ada pemberitahuan</label>
          <label className="flex min-h-[44px] items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={voice} onChange={(e) => { setVoice(e.target.checked); setVoiceOn(e.target.checked); }} /> Ucapkan &ldquo;Ada yang bayar&rdquo;</label>
          <label className="flex min-h-[44px] items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={pop} onChange={(e) => { setPop(e.target.checked); setPopupOn(e.target.checked); }} /> Munculkan popup bila tab sedang ditinggal</label>
          {perm === 'unsupported' && <Alert tone="warn">Browser ini tidak mendukung popup notifikasi. Bunyi dan judul tab tetap bekerja.</Alert>}
          {perm === 'default' && <div className="rounded-lg bg-amber-50 p-3 text-amber-900"><p className="mb-2">Browser perlu izin Anda dulu supaya popup bisa muncul.</p><Button onClick={async () => setPerm(await askPopupPermission())}>Aktifkan notifikasi browser</Button></div>}
          {perm === 'denied' && <Alert tone="warn">Izin notifikasi diblokir di browser ini. Buka pengaturan situs di browser (ikon gembok di kolom alamat), ubah Notifikasi menjadi Izinkan, lalu muat ulang halaman.</Alert>}
          {perm === 'granted' && <p className="text-teal-700">Izin popup sudah aktif.</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button variant="ghost" onClick={async () => { await unlockAudio(); announce('PAYMENT', true); }}>Coba bunyi bayar</Button>
            {popupSupported() && perm === 'granted' && <Button variant="ghost" onClick={() => { showPopup('Pembayaran baru (contoh)', 'Muhammad Fauzan membayar SPP Rp600.000.', `coba-${Date.now()}`, null); }}>Coba popup</Button>}
          </div>
          <p className="text-xs text-navy-700">Popup dan bunyi hanya bekerja selama aplikasi masih terbuka di browser (boleh di tab lain). Bila browser ditutup atau HP terkunci lama, notifikasi tidak akan muncul. Pindah tab membuat pengecekan sedikit melambat, jadi bisa telat sekitar satu menit.</p>
        </section>
        <div className="flex justify-end"><Button variant="ghost" onClick={onClose}>Tutup</Button></div>
      </div>
    </Modal>
  );
}
