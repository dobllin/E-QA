'use client';
import { useState } from 'react';
import { api, errMsg } from '@/lib/api';
import { loadBrand } from '@/lib/school';
import { esc, printHtml } from '@/lib/print';
import { drawCard } from './CardPrint';
import { Alert, Button, Field, Input, Modal, Select } from './ui';

interface Issued { santriId: string; fullName: string; nis: string; kelas: string | null; publicNumber: string; barcodeToken: string; initialPin: string }

/** Kelola kelas: naik kelas massal, luluskan kelas, dan terbitkan kartu massal (lembar cetak + daftar PIN). */
export function ClassManager({ kelasOptions, onClose, onChanged }: { kelasOptions: string[]; onClose: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<'cards' | 'promote' | 'graduate'>('cards');
  const [kelas, setKelas] = useState(kelasOptions[0] ?? ''); const [toKelas, setToKelas] = useState('');
  const [err, setErr] = useState(''); const [ok, setOk] = useState(''); const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<{ items: Issued[]; candidates: number } | null>(null);

  async function run(fn: () => Promise<void>) { setErr(''); setOk(''); setBusy(true); try { await fn(); onChanged(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } }
  const issue = () => run(async () => { const r = await api<{ issued: Issued[]; candidates: number }>('/cards/issue-bulk', { method: 'POST', body: { kelas } }); setIssued({ items: r.issued, candidates: r.candidates }); });
  const promote = () => run(async () => { const r = await api<{ moved: number }>('/santri/promote', { method: 'POST', body: { fromKelas: kelas, toKelas } }); setOk(`${r.moved} santri aktif dipindah dari kelas ${kelas} ke ${toKelas}.`); });
  const graduate = () => run(async () => { if (!confirm(`Luluskan semua santri aktif di kelas ${kelas}? Kartu mereka tidak bisa dipakai lagi (saldo tetap tersimpan).`)) return; const r = await api<{ graduated: number }>('/santri/graduate', { method: 'POST', body: { kelas } }); setOk(`${r.graduated} santri kelas ${kelas} diluluskan.`); });

  async function printCards() {
    if (!issued) return; setBusy(true);
    try {
      const brand = await loadBrand();
      const imgs = issued.items.map((i) => drawCard({ fullName: i.fullName, nis: i.nis, kelas: i.kelas }, i, brand));
      printHtml(`Kartu kelas ${kelas}`, `<div class="grid">${imgs.map((u) => `<div class="c"><img src="${u}"></div>`).join('')}</div>`,
        '.grid{display:grid;grid-template-columns:repeat(2,85.6mm);gap:6mm 8mm;justify-content:center}.c{break-inside:avoid}img{width:85.6mm;display:block}');
    } finally { setBusy(false); }
  }
  function printPins() {
    if (!issued) return;
    printHtml(`Daftar PIN kelas ${kelas}`, `<h2 style="margin:0 0 4px">Daftar PIN awal — kelas ${esc(kelas)}</h2><p style="margin:0 0 10px;color:#b00"><strong>RAHASIA.</strong> Berikan PIN hanya kepada santri/wali masing-masing, lalu hancurkan lembar ini. Santri wajib mengganti PIN saat pertama bayar di kasir.</p>
      <table><thead><tr><th>No</th><th>Nama</th><th>NIS</th><th>No. kartu</th><th>PIN awal</th></tr></thead><tbody>${issued.items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.fullName)}</td><td>${esc(i.nis)}</td><td>${esc(i.publicNumber)}</td><td class="pin">${esc(i.initialPin)}</td></tr>`).join('')}</tbody></table>`,
      'table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #999;padding:6px 8px;text-align:left}.pin{font-family:Consolas,monospace;font-size:16px;letter-spacing:3px;font-weight:700}tr{break-inside:avoid}');
  }

  return (
    <Modal title="Kelola kelas" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1 border-b border-navy-100" role="tablist">
          {([['cards', 'Kartu massal'], ['promote', 'Naik kelas'], ['graduate', 'Luluskan kelas']] as const).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setErr(''); setOk(''); setIssued(null); }} className={`-mb-px min-h-[44px] border-b-2 px-4 text-sm font-medium ${tab === k ? 'border-teal-500 text-navy-900' : 'border-transparent text-navy-700'}`}>{l}</button>
          ))}
        </div>
        {err && <Alert>{err}</Alert>}{ok && <Alert tone="ok">{ok}</Alert>}

        <Field label="Kelas">{kelasOptions.length > 0 ? <Select value={kelas} onChange={(e) => setKelas(e.target.value)}>{kelasOptions.map((k) => <option key={k} value={k}>{k}</option>)}</Select> : <Input value={kelas} onChange={(e) => setKelas(e.target.value)} placeholder="Contoh: 7A" />}</Field>

        {tab === 'cards' && (!issued ? (
          <div className="space-y-3">
            <Alert tone="warn">Menerbitkan kartu untuk <strong>semua santri aktif di kelas ini yang belum punya kartu</strong>. Kode QR dan PIN awal hanya tampil sekali di layar berikutnya: cetak lembar kartu dan daftar PIN sebelum menutupnya.</Alert>
            <div className="flex justify-end"><Button onClick={issue} disabled={busy || !kelas}>{busy ? 'Menerbitkan…' : 'Terbitkan kartu kelas ini'}</Button></div>
          </div>
        ) : (
          <div className="space-y-3">
            {issued.items.length === 0 ? <Alert>Tidak ada kartu baru: semua santri aktif di kelas ini sudah punya kartu.</Alert> : <Alert tone="ok">{issued.items.length} kartu diterbitkan. Cetak sekarang; QR dan PIN tidak bisa dilihat lagi setelah jendela ini ditutup.</Alert>}
            {issued.items.length > 0 && <div className="flex flex-wrap gap-2"><Button onClick={printCards} disabled={busy}>{busy ? 'Menyiapkan…' : 'Cetak lembar kartu'}</Button><Button variant="secondary" onClick={printPins}>Cetak daftar PIN</Button></div>}
            <p className="text-xs text-navy-700">Satu kartu per santri; PIN awal wajib diganti santri saat pertama kali bayar di kasir. Kartu yang tercetak bisa dilihat ulang per santri lewat tombol "Lihat kartu".</p>
          </div>
        ))}

        {tab === 'promote' && (
          <div className="space-y-3">
            <Field label="Pindahkan ke kelas" hint="Hanya santri berstatus aktif yang dipindah."><Input value={toKelas} onChange={(e) => setToKelas(e.target.value)} placeholder="Contoh: 8A" /></Field>
            <div className="flex justify-end"><Button onClick={promote} disabled={busy || !kelas || !toKelas.trim()}>{busy ? 'Memproses…' : 'Naikkan kelas'}</Button></div>
          </div>
        )}
        {tab === 'graduate' && (
          <div className="space-y-3">
            <Alert tone="warn">Santri aktif di kelas ini diberi status <strong>Lulus</strong>. Saldo dan riwayat tetap tersimpan, tetapi kartu tidak bisa dipakai bertransaksi lagi.</Alert>
            <div className="flex justify-end"><Button variant="danger" onClick={graduate} disabled={busy || !kelas}>{busy ? 'Memproses…' : 'Luluskan kelas ini'}</Button></div>
          </div>
        )}
        <div className="flex justify-end"><Button variant="ghost" onClick={onClose}>Tutup</Button></div>
      </div>
    </Modal>
  );
}
