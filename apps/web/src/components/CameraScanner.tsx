'use client';
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal } from './ui';

async function makeReader() {
  const { BrowserMultiFormatReader } = await import('@zxing/browser');
  const { DecodeHintType, BarcodeFormat } = await import('@zxing/library');
  const hints = new Map<any, any>();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 60 });
}

/** Perkecil foto besar dari kamera HP (maks ±1600 px) agar cepat dibaca, dan buang data EXIF. */
async function shrink(file: File, max: number): Promise<string> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext('2d')!; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('x'))), 'image/jpeg', 0.92));
  return URL.createObjectURL(blob);
}

/**
 * Scan kode QR kartu. Tiga cara, dari yang paling mudah:
 *  1. "Foto QR": membuka kamera HP bawaan (fokus otomatis, tidak butuh https). Paling andal di HP.
 *  2. Kamera langsung (butuh https:// atau http://localhost). Memakai pembaca bawaan browser bila ada, dan pembaca cadangan.
 *  3. Pilih gambar dari galeri / ketik kode manual di kolom kasir.
 */
export function CameraScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState('');
  const [ready, setReady] = useState('');
  const [fileMsg, setFileMsg] = useState('');

  useEffect(() => {
    let controls: { stop: () => void } | undefined;
    let done = false; let timer: ReturnType<typeof setInterval> | undefined;
    const finish = (text: string) => {
      if (done) return; done = true;
      try { navigator.vibrate?.(60); } catch { /* abaikan */ }
      controls?.stop(); if (timer) clearInterval(timer);
      onResult(text.trim().toUpperCase());
    };
    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setErr('Kamera langsung hanya bisa dipakai lewat alamat https:// atau http://localhost. Gunakan tombol "Foto QR" di bawah (tetap bisa), atau ketik kode kartu di kolom kasir.');
        return;
      }
      try {
        const reader = await makeReader();
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, advanced: [{ focusMode: 'continuous' } as any] }, audio: false },
          videoRef.current!,
          (result) => { if (result) finish(result.getText()); },
        );
        if (done) { controls.stop(); return; }
        const v = videoRef.current; setReady(v && v.videoWidth ? `Kamera aktif (${v.videoWidth}×${v.videoHeight})` : 'Kamera aktif');
        // Tambahan: pembaca QR bawaan browser (lebih kuat bila tersedia). Dijaga try/catch agar tidak mengganggu pembaca utama.
        try {
          const BD = (window as any).BarcodeDetector;
          if (BD) {
            const fmts: string[] | undefined = await BD.getSupportedFormats?.();
            if (!fmts || fmts.includes('qr_code')) {
              const det = new BD({ formats: ['qr_code'] });
              timer = setInterval(async () => {
                const el = videoRef.current; if (done || !el || el.readyState < 2) return;
                try { const r = await det.detect(el); if (r?.[0]?.rawValue) finish(r[0].rawValue); } catch { /* abaikan */ }
              }, 150);
            }
          }
        } catch { /* abaikan */ }
      } catch (e: any) {
        const n = e?.name ?? '';
        setErr(n === 'NotAllowedError' ? 'Izin kamera ditolak. Klik ikon gembok di address bar → izinkan Kamera, lalu coba lagi. Atau pakai tombol "Foto QR".'
          : n === 'NotFoundError' ? 'Kamera tidak ditemukan di perangkat ini. Pakai tombol "Foto QR" atau scanner.'
          : n === 'NotReadableError' ? 'Kamera sedang dipakai aplikasi lain.' : 'Kamera langsung tidak bisa dibuka. Pakai tombol "Foto QR".');
      }
    })();
    return () => { done = true; controls?.stop(); if (timer) clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Baca QR dari foto/gambar (foto dari kamera HP bawaan, screenshot, atau PNG kartu). */
  async function fromFile(f: File | undefined) {
    if (!f) return;
    setFileMsg('Membaca gambar…');
    const reader = await makeReader();
    for (const max of [1600, 900, 0]) {
      let url = '';
      try {
        url = max ? await shrink(f, max) : URL.createObjectURL(f);
        const r = await reader.decodeFromImageUrl(url);
        onResult(r.getText().trim().toUpperCase()); return;
      } catch { /* coba ukuran berikutnya */ } finally { if (url) URL.revokeObjectURL(url); }
    }
    setFileMsg('QR tidak terbaca di foto ini. Ulangi: pastikan seluruh kotak QR terlihat, tidak buram, dan cukup terang.');
  }

  return (
    <Modal title="Scan kartu santri" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-card border-2 border-teal-500 p-3">
          <div className="mb-2 text-base font-semibold text-navy-900">Cara termudah: foto kode QR</div>
          <p className="mb-2 text-sm text-navy-700">Tekan tombol di bawah. Kamera HP terbuka, foto kode QR di kartu, lalu terbaca otomatis.</p>
          <label className="inline-flex min-h-[52px] cursor-pointer items-center justify-center rounded-lg bg-navy-800 px-6 py-3 text-base font-medium text-white hover:bg-navy-700">
            Foto QR
            <input type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Foto QR dengan kamera" onChange={(e) => fromFile(e.target.files?.[0])} />
          </label>
        </div>

        {err ? <Alert>{err}</Alert> : (
          <div>
            <div className="mb-2 text-sm font-medium text-navy-800">Atau arahkan kartu ke kamera langsung</div>
            <div className="relative overflow-hidden rounded-xl bg-black">
              <video ref={videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline />
              <div className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-3/5 -translate-x-1/2 -translate-y-1/2 rounded-xl border-2 border-teal-500" aria-hidden />
            </div>
            <p className="mt-1 text-sm text-navy-700" role="status">{ready ? `${ready}. Arahkan kode QR ke dalam kotak, jarak ±20 cm, jangan bergoyang.` : 'Membuka kamera…'}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-navy-50 pt-3">
          <label className="cursor-pointer rounded-lg border border-navy-200 px-3 py-2 text-sm font-medium text-navy-800 hover:bg-navy-50">
            Pilih gambar dari galeri
            <input type="file" accept="image/*" className="sr-only" aria-label="Pilih gambar QR" onChange={(e) => fromFile(e.target.files?.[0])} />
          </label>
          <Button variant="ghost" onClick={onClose}>Tutup</Button>
        </div>
        <p className="text-xs text-navy-700">Tidak terbaca? Ketik kode 16 karakter di bawah gambar QR pada kolom kasir.</p>
        {fileMsg && <p className="text-sm text-navy-800" role="status">{fileMsg}</p>}
      </div>
    </Modal>
  );
}
