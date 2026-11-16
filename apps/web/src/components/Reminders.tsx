'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, errMsg } from '@/lib/api';
import { rupiah } from '@/lib/format';
import { Alert, Button, Loading, Modal } from './ui';

export interface Prepared {
  santriId: string; santriName: string; nis: string; kelas: string | null; waliName: string | null; phone: string | null; hasPhone: boolean;
  invoiceIds: string[]; total: number; message: string; waUrl: string | null; reminded: boolean; needsReminder: boolean; lastRemindedAt: string | null;
}

/** Titik merah berkedip = sudah lewat jatuh tempo dan belum dibayar. */
export const RemindDot = ({ label = 'Lewat jatuh tempo dan belum dibayar' }: { label?: string }) => <span className="blink-dot" role="img" aria-label={label} title={label} />;

/** Minta menu samping memeriksa ulang ringkasan pengingat (dipanggil setelah menandai diingatkan). */
const pingShell = () => { try { window.dispatchEvent(new Event('eqa-refresh')); } catch { /* abaikan */ } };

/** Tandai sudah diingatkan. Sistem tidak bisa tahu apakah pesan benar-benar terkirim; penanda ini berarti tombolnya sudah ditekan. */
export const markReminded = (it: Prepared) => api('/reminders/mark', { method: 'POST', body: { santriId: it.santriId, invoiceIds: it.invoiceIds } }).then((r) => { pingShell(); return r; });

/** Satu tombol per baris: siapkan pesan, buka WhatsApp, lalu tandai. Jendela dibuka lebih dulu agar tidak diblokir browser. */
export async function remindOne(santriId: string): Promise<{ ok: boolean; message: string }> {
  const w = window.open('about:blank', '_blank');
  try {
    const r = await api<{ items: Prepared[] }>('/reminders/prepare', { method: 'POST', body: { santriIds: [santriId] } });
    const it = r.items[0];
    if (!it) { w?.close(); return { ok: false, message: 'Tidak ada tunggakan untuk santri ini.' }; }
    if (!it.waUrl) { w?.close(); return { ok: false, message: `Nomor HP wali ${it.santriName} belum diisi. Isi di menu Pengguna (tombol Ubah pada akun wali).` }; }
    if (w) w.location.href = it.waUrl; else window.open(it.waUrl, '_blank');
    await markReminded(it);
    return { ok: true, message: `WhatsApp untuk wali ${it.santriName} dibuka. Tekan Kirim di WhatsApp.` };
  } catch (e) { w?.close(); return { ok: false, message: errMsg(e) }; }
}

/** Antrean "ingatkan semua": WhatsApp hanya membuka satu chat per ketukan, jadi wali dibuka satu per satu. */
export function ReminderQueue({ onClose, onChanged, onTemplate }: { onClose: () => void; onChanged: () => void; onTemplate: () => void }) {
  const [onlyDue, setOnlyDue] = useState(true);
  const [items, setItems] = useState<Prepared[] | null>(null);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    setItems(null); setErr('');
    try { setItems((await api<{ items: Prepared[] }>('/reminders/prepare', { method: 'POST', body: { onlyDue } })).items); } catch (e) { setErr(errMsg(e)); }
  }, [onlyDue]);
  useEffect(() => { load(); }, [load]);

  async function open(it: Prepared) {
    if (!it.waUrl) return;
    window.open(it.waUrl, '_blank', 'noopener');     // dibuka langsung dari ketukan, supaya tidak diblokir
    try { await markReminded(it); setDone((d) => new Set(d).add(it.santriId)); onChanged(); } catch (e) { setErr(errMsg(e)); }
  }
  const todo = (items ?? []).filter((i) => i.hasPhone && !done.has(i.santriId));
  const next = todo[0];
  return (
    <Modal title="Ingatkan wali lewat WhatsApp" onClose={onClose} wide>
      <div className="space-y-3">
        <Alert tone="warn">WhatsApp hanya membuka satu percakapan setiap kali tombol ditekan. Tekan <strong>Kirim</strong> di WhatsApp, kembali ke sini, lalu lanjut ke wali berikutnya.</Alert>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={onlyDue} onChange={(e) => setOnlyDue(e.target.checked)} /> Hanya yang perlu diingatkan (belum pernah, atau sudah lewat batas hari)</label>
          <Button variant="secondary" onClick={onTemplate}>Atur pesan &amp; pengingat</Button>
        </div>
        {err && <Alert>{err}</Alert>}
        {!items ? <Loading /> : items.length === 0 ? <p className="rounded-lg border border-dashed border-navy-200 py-8 text-center text-sm text-navy-700">Tidak ada tunggakan yang perlu diingatkan. 🎉</p> : (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-navy-700">{done.size} dari {items.filter((i) => i.hasPhone).length} sudah dibuka{items.some((i) => !i.hasPhone) ? ` · ${items.filter((i) => !i.hasPhone).length} tanpa nomor HP` : ''}</span>
              {next && <Button size="lg" onClick={() => open(next)}>Buka WhatsApp berikutnya ({next.santriName})</Button>}
            </div>
            <ul className="divide-y divide-navy-50 rounded-card border border-navy-100">
              {items.map((it) => {
                const isDone = done.has(it.santriId);
                return (
                  <li key={it.santriId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="font-medium">{it.santriName}<span className="text-xs text-navy-700">{it.kelas ? ` · ${it.kelas}` : ''}</span></div>
                      <div className="text-xs text-navy-700">{it.waliName ? `Wali: ${it.waliName}` : 'Belum ada wali terhubung'} · sisa {rupiah(it.total)}</div>
                    </div>
                    {isDone ? <span className="text-sm font-medium text-teal-700">✓ Sudah dibuka</span>
                      : !it.hasPhone ? <span className="text-sm text-red-700">Nomor HP wali belum diisi</span>
                      : <Button variant="secondary" onClick={() => open(it)}>{it.reminded ? 'Ingatkan lagi' : 'Buka WhatsApp'}</Button>}
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <div className="flex justify-end"><Button variant="ghost" onClick={onClose}>Tutup</Button></div>
      </div>
    </Modal>
  );
}

const TAGS: [string, string][] = [['{nama_wali}', 'nama wali'], ['{nama_santri}', 'nama santri'], ['{tagihan}', 'daftar tagihan'], ['{sisa}', 'total sisa'], ['{jatuh_tempo}', 'jatuh tempo tertua'], ['{pesantren}', 'nama pesantren']];
const SAMPLE: Record<string, string> = { nama_wali: 'Bapak Ahmad', nama_santri: 'Budi', tagihan: 'SPP 2026-11 (Rp1.500.000), Uang Gedung 2026-11 (Rp1.500.000)', sisa: 'Rp3.000.000', jatuh_tempo: '10/11/2026', pesantren: 'Pesantren Anda' };

/** Atur isi pesan WhatsApp. Penanda dalam kurung kurawal diganti otomatis per santri. */
export function TemplateEditor({ onClose }: { onClose: () => void }) {
  const [days, setDays] = useState('3');
  const [text, setText] = useState<string | null>(null); const [def, setDef] = useState(''); const [err, setErr] = useState(''); const [ok, setOk] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => {
    Promise.all([api<{ template: string; defaultTemplate: string }>('/reminders/template'), api<{ repeatDays: number }>('/reminders/settings')])
      .then(([r, st]) => { setText(r.template); setDef(r.defaultTemplate); setDays(String(st.repeatDays)); }).catch((e) => setErr(errMsg(e)));
  }, []);
  const preview = (text ?? '').replace(/\{(\w+)\}/g, (m, k) => SAMPLE[k] ?? m);
  async function save() {
    setBusy(true); setErr(''); setOk(false);
    try {
      await api('/reminders/template', { method: 'PUT', body: { template: text } });
      await api('/reminders/settings', { method: 'PUT', body: { repeatDays: Number(days) || 0 } });
      pingShell(); setOk(true);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Pesan dan pengingat WhatsApp" onClose={onClose} wide>
      {text === null ? (err ? <Alert>{err}</Alert> : <Loading />) : (
        <div className="space-y-3">
          {err && <Alert>{err}</Alert>}{ok && <Alert tone="ok">Tersimpan. Pesan dan pengingat berikutnya memakai pengaturan ini.</Alert>}
          <div className="rounded-lg border border-navy-100 p-3">
            <div className="text-sm font-medium text-navy-800">Ingatkan lagi bila masih belum bayar setelah</div>
            <div className="mt-1 flex items-center gap-2"><input type="number" min={0} max={60} value={days} onChange={(e) => { setDays(e.target.value); setOk(false); }} className="w-24 rounded-lg border border-navy-200 px-3 py-2 text-base" aria-label="Jumlah hari" /><span className="text-sm">hari sejak diingatkan terakhir</span></div>
            <p className="mt-1 text-xs text-navy-700">Setelah batas ini, tunggakan ditandai &quot;Perlu diingatkan lagi&quot; dan pengurus mendapat pemberitahuan. Isi <strong>0</strong> bila tidak ingin pengingat ulang.</p>
          </div>
          <div className="text-sm font-medium text-navy-800">Isi pesan</div>
          <textarea value={text} onChange={(e) => { setText(e.target.value); setOk(false); }} rows={6} maxLength={1000} className="w-full rounded-lg border border-navy-200 p-3 text-base" aria-label="Isi pesan" />
          <div>
            <div className="mb-1 text-sm font-medium text-navy-800">Sisipkan (diganti otomatis untuk tiap santri):</div>
            <div className="flex flex-wrap gap-2">{TAGS.map(([t, d]) => <button key={t} type="button" onClick={() => { setText((x) => `${x ?? ''}${(x ?? '').endsWith(' ') || !x ? '' : ' '}${t}`); setOk(false); }} className="rounded-full border border-navy-200 px-3 py-1.5 text-sm hover:bg-navy-50" title={d}>{t}</button>)}</div>
          </div>
          <div className="rounded-lg bg-navy-50 p-3 text-sm"><div className="mb-1 font-medium text-navy-800">Contoh hasilnya:</div><p className="whitespace-pre-wrap text-navy-900">{preview}</p></div>
          <div className="flex flex-wrap justify-between gap-2">
            <Button variant="ghost" onClick={() => { setText(def); setOk(false); }}>Kembalikan pesan standar</Button>
            <div className="flex gap-2"><Button variant="ghost" onClick={onClose}>Tutup</Button><Button size="lg" onClick={save} disabled={busy || text.trim().length < 10 || Number(days) < 0 || Number(days) > 60}>{busy ? 'Menyimpan…' : 'Simpan'}</Button></div>
          </div>
        </div>
      )}
    </Modal>
  );
}
