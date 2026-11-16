'use client';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Alert, Button } from './ui';
import { loadBrand } from '@/lib/school';

export interface IssuedCard { publicNumber: string; barcodeToken: string; initialPin: string; pinMustChange?: boolean }
type SantriInfo = { fullName: string; nis: string; kelas?: string | null };

const W = 1011, H = 638; // 85,6 x 54 mm pada 300 dpi (ukuran kartu standar)
const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif';

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** Gambar modul QR dengan koordinat bulat (tanpa garis retak). Mengembalikan ukuran total (px). */
function drawQr(ctx: CanvasRenderingContext2D, token: string, x: number, y: number, maxSize: number, color = '#0B2040') {
  const qr = QRCode.create(token, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size, m = Math.floor(maxSize / n), qs = m * n;
  const ox = Math.round(x + (maxSize - qs) / 2);
  ctx.fillStyle = color;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.modules.get(r, c)) ctx.fillRect(ox + c * m, y + r * m, m, m);
  return { size: qs, x: ox };
}

/** Kartu: pratinjau di layar dan file PNG yang diunduh berasal dari gambar yang SAMA. */
export type Brand = { name: string; logo: ImageBitmap | null } | null;

export function drawCard(santri: SantriInfo, card: { publicNumber: string; barcodeToken: string }, brand: Brand = null): string {
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;

  roundRect(ctx, 0, 0, W, H, 44); ctx.fillStyle = '#0B2040'; ctx.fill();
  ctx.save(); roundRect(ctx, 0, 0, W, H, 44); ctx.clip();
  ctx.fillStyle = '#14A89B'; ctx.fillRect(0, 0, 18, H); ctx.restore();

  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  if (brand?.name) {
    // Nama (dan logo) pesantren di bagian kiri atas
    let x = 64;
    if (brand.logo) { ctx.save(); roundRect(ctx, 64, 40, 92, 92, 16); ctx.clip(); ctx.fillStyle = '#FFFFFF'; ctx.fillRect(64, 40, 92, 92); const r = Math.min(80 / brand.logo.width, 80 / brand.logo.height); const w = brand.logo.width * r, h = brand.logo.height * r; ctx.drawImage(brand.logo, 64 + (92 - w) / 2, 40 + (92 - h) / 2, w, h); ctx.restore(); x = 176; }
    const maxName = 503 - 24 - x; let fs = 44; ctx.fillStyle = '#FFFFFF'; ctx.font = `700 ${fs}px ${FONT}`;
    while (ctx.measureText(brand.name).width > maxName && fs > 26) { fs -= 2; ctx.font = `700 ${fs}px ${FONT}`; }
    let nm = brand.name; while (ctx.measureText(nm).width > maxName && nm.length > 3) nm = nm.slice(0, -2); if (nm !== brand.name) nm = nm.trimEnd() + '…';
    ctx.fillText(nm, x, 92); ctx.fillStyle = '#C2EBE6'; ctx.font = `400 28px ${FONT}`; ctx.fillText('Kartu Santri', x + 2, 132);
  } else {
    ctx.fillStyle = '#FFFFFF'; ctx.font = `700 64px ${FONT}`; ctx.fillText('E-QA', 64, 104);
    ctx.fillStyle = '#C2EBE6'; ctx.font = `400 28px ${FONT}`; ctx.fillText('Kartu Santri', 66, 144);
  }

  // Nama: satu baris jika muat; kalau tidak, dipecah dua baris.
  const maxW = 410;
  ctx.fillStyle = '#FFFFFF';
  let size = 54; ctx.font = `700 ${size}px ${FONT}`;
  while (ctx.measureText(santri.fullName).width > maxW && size > 40) { size -= 2; ctx.font = `700 ${size}px ${FONT}`; }
  let lines = [santri.fullName];
  if (ctx.measureText(santri.fullName).width > maxW) {
    const words = santri.fullName.split(' '); let l1 = '';
    while (words.length && ctx.measureText((l1 + ' ' + words[0]).trim()).width <= maxW) l1 = (l1 + ' ' + words.shift()).trim();
    let l2 = words.join(' ');
    while (ctx.measureText(l2).width > maxW && l2.length > 3) l2 = l2.slice(0, -2);
    lines = [l1 || santri.fullName.slice(0, 12), words.join(' ') !== l2 ? l2.trimEnd() + '…' : l2];
  }
  const ny = lines.length === 1 ? 330 : 310;
  lines.forEach((t, i) => ctx.fillText(t, 64, ny + i * (size + 6)));
  const iy = ny + (lines.length - 1) * (size + 6);
  ctx.fillStyle = '#B3C4DE'; ctx.font = `400 32px ${FONT}`;
  ctx.fillText(`NIS ${santri.nis}`, 66, iy + 52);
  if (santri.kelas) ctx.fillText(`Kelas ${santri.kelas}`, 66, iy + 96);
  ctx.fillStyle = '#C2EBE6'; ctx.font = `500 30px ${FONT}`; ctx.fillText(card.publicNumber, 66, 590);

  // Kanan: kotak putih besar berisi QR (+ kode teks di bawahnya)
  const bw = 460, bh = 520, bx = W - 48 - bw, by = 59;
  roundRect(ctx, bx, by, bw, bh, 28); ctx.fillStyle = '#FFFFFF'; ctx.fill();
  const q = drawQr(ctx, card.barcodeToken, bx + 65, by + 52, 330);
  ctx.fillStyle = '#0B2040'; ctx.textAlign = 'center'; ctx.font = `600 34px "Consolas", "Courier New", monospace`;
  ctx.fillText(card.barcodeToken, bx + bw / 2, by + 52 + q.size + 62); ctx.textAlign = 'left';
  return c.toDataURL('image/png');
}

/** QR besar saja (1200 x 1200) — untuk dikirim ke HP / ditampilkan di layar supaya mudah di-scan. */
export function drawQrOnly(token: string): string {
  const S = 1200, c = document.createElement('canvas'); c.width = S; c.height = S + 120;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, c.width, c.height);
  const q = drawQr(ctx, token, 100, 100, S - 200);
  ctx.fillStyle = '#0B2040'; ctx.textAlign = 'center'; ctx.font = `700 64px "Consolas", "Courier New", monospace`;
  ctx.fillText(token, S / 2, 100 + q.size + 90);
  return c.toDataURL('image/png');
}

function printZone(zone: 'card' | 'pin') {
  document.body.setAttribute('data-print', zone);
  window.print();
  setTimeout(() => document.body.removeAttribute('data-print'), 500);
}
const safeName = (s: string) => s.replace(/[^\w.-]+/g, '_');
const linkCls = 'inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium';

/** Pratinjau kartu + tombol unduh/cetak. Dipakai saat kartu baru terbit dan saat admin membuka "Lihat kartu". */
export function CardView({ santri, card, children }: { santri: SantriInfo; card: { publicNumber: string; barcodeToken: string }; children?: React.ReactNode }) {
  const [url, setUrl] = useState(''); const [qrUrl, setQrUrl] = useState('');
  const [brand, setBrand] = useState<Brand | undefined>(undefined);
  useEffect(() => { loadBrand().then(setBrand).catch(() => setBrand(null)); }, []);
  useEffect(() => { if (brand === undefined) return; setUrl(drawCard(santri, card, brand)); setQrUrl(drawQrOnly(card.barcodeToken)); }, [santri, card, brand]);
  const base = safeName(`${santri.nis}-${card.publicNumber}`);
  return (
    <div className="space-y-4">
      <div className="print-zone" data-zone="card">
        {url ? <img src={url} alt={`Kartu ${santri.fullName}`} style={{ width: '85.6mm', maxWidth: '100%' }} className="rounded-xl shadow-md print:shadow-none" /> : <div className="h-40 text-sm">Membuat kartu…</div>}
      </div>
      {children}
      <div className="flex flex-wrap gap-2">
        <a href={url} download={`kartu-${base}.png`} className={`${linkCls} bg-navy-800 text-white hover:bg-navy-700`}>Unduh kartu (PNG)</a>
        <a href={qrUrl} download={`qr-${base}.png`} className={`${linkCls} border border-navy-200 bg-white text-navy-800 hover:bg-navy-50`}>Unduh QR besar (PNG)</a>
        <Button variant="secondary" onClick={() => printZone('card')}>Cetak kartu</Button>
      </div>
    </div>
  );
}

/** Tampil SEKALI setelah kartu dibuat / diganti: berisi juga slip PIN yang tidak bisa dilihat lagi. */
export function CardPrint({ santri, card, onDone }: { santri: SantriInfo; card: IssuedCard; onDone: () => void }) {
  return (
    <div className="space-y-4">
      <Alert tone="warn">PIN hanya tampil sekali. Catat atau cetak slip PIN sekarang sebelum menutup jendela ini. Kartu (QR) bisa dilihat lagi nanti lewat tombol "Lihat kartu".</Alert>
      <CardView santri={santri} card={card}>
        <div className="print-zone rounded-lg border border-dashed border-navy-200 p-4 text-sm" data-zone="pin">
          <div className="font-semibold">Slip PIN — {santri.fullName}</div>
          <div className="mt-1 text-navy-700">Kartu {card.publicNumber}.{card.pinMustChange !== false ? ' Santri akan diminta mengganti PIN ini saat pertama kali bayar di kasir.' : ' PIN ini langsung bisa dipakai.'} Jangan beritahu siapa pun.</div>
          <div className="mt-2 text-2xl font-bold tracking-[0.3em] tabular-nums">{card.initialPin}</div>
        </div>
        <div className="flex gap-2"><Button variant="secondary" onClick={() => printZone('pin')}>Cetak slip PIN</Button></div>
      </CardView>
      <div className="flex justify-end"><Button variant="ghost" onClick={onDone}>Selesai, tutup</Button></div>
    </div>
  );
}
