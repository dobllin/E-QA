'use client';
import { useState } from 'react';
import { apiUpload, errMsg } from '@/lib/api';
import { rupiah } from '@/lib/format';
import { prepareImage, readAmounts } from '@/lib/ocr';
import { Alert, Button } from './ui';

/** Wali mengunggah screenshot bukti transfer. Nominal dibaca otomatis di browser sebagai petunjuk untuk bendahara. */
export function ProofUploader({ requestId, total, onDone }: { requestId: string; total: number; onDone: () => void }) {
  const [state, setState] = useState<'idle' | 'reading' | 'ready' | 'sending' | 'sent'>('idle');
  const [amounts, setAmounts] = useState<number[]>([]); const [blob, setBlob] = useState<Blob | null>(null); const [err, setErr] = useState('');

  async function pick(f: File | undefined) {
    if (!f) return; setErr(''); setState('reading');
    try {
      const { blob, canvas } = await prepareImage(f); setBlob(blob);
      let a: number[] = []; try { a = await readAmounts(canvas); } catch { /* OCR gagal: tetap bisa kirim */ }
      setAmounts(a); setState('ready');
    } catch { setErr('Foto tidak bisa dibaca. Coba foto atau screenshot lain.'); setState('idle'); }
  }
  async function send() {
    if (!blob) return; setState('sending'); setErr('');
    const fd = new FormData(); fd.append('file', blob, 'bukti.jpg'); fd.append('ocrAmounts', JSON.stringify(amounts));
    try { await apiUpload(`/portal/topups/${requestId}/proof`, fd); setState('sent'); onDone(); } catch (e) { setErr(errMsg(e)); setState('ready'); }
  }
  const match = amounts.includes(total);

  if (state === 'sent') return <Alert tone="ok">Bukti transfer terkirim. Pengurus akan memeriksanya.</Alert>;
  return (
    <div className="space-y-2 rounded-lg border border-navy-100 p-3 text-sm">
      <div className="font-medium">Sudah transfer? Unggah bukti (opsional)</div>
      {err && <Alert>{err}</Alert>}
      {state === 'reading' && <p role="status" className="text-navy-700">Membaca nominal dari foto… (pertama kali agak lama)</p>}
      {(state === 'idle' || state === 'ready') && <input type="file" accept="image/*" aria-label="Foto bukti transfer" onChange={(e) => pick(e.target.files?.[0])} />}
      {state === 'ready' && (
        <>
          {match ? <Alert tone="ok">Nominal {rupiah(total)} terbaca di foto dan sesuai.</Alert>
            : <Alert tone="warn">{amounts.length ? `Nominal yang terbaca: ${amounts.map(rupiah).join(', ')}. Tidak ada yang sama dengan ${rupiah(total)}.` : 'Nominal tidak terbaca dari foto.'} Pastikan nominal terlihat jelas. Foto tetap bisa dikirim dan akan diperiksa pengurus.</Alert>}
          <div className="flex justify-end"><Button onClick={send}>Kirim bukti</Button></div>
        </>
      )}
      {state === 'sending' && <p role="status">Mengirim…</p>}
    </div>
  );
}
