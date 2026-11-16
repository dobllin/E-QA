'use client';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, errMsg } from '@/lib/api';
import { rupiah, uuid } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { Alert, Button, Field, Input, Modal, MoneyInput } from '@/components/ui';
import { CameraScanner } from '@/components/CameraScanner';
import { esc, printHtml } from '@/lib/print';
import { loadSchool } from '@/lib/school';
import { DailyRecap } from '@/components/DailyRecap';
import { ProductManager } from '@/components/ProductManager';
import { tanggalWaktu } from '@/lib/format';

interface Product { id: string; name: string; price: number; stock: number; isActive: boolean; trackStock?: boolean }
type Outcome = { kind: 'ok'; name: string; total: number; balance: number; duplicate: boolean } | { kind: 'err'; message: string; code?: string } | { kind: 'unsure' } | null;

export function PosScreen({ merchant }: { merchant: 'KANTIN' | 'LAUNDRY' }) {
  const isLaundry = merchant === 'LAUNDRY';
  const [search, setSearch] = useState('');
  const { data: products, error: perr, reload: reloadProducts } = useApi<Product[]>('/products', { merchant });
  const [cart, setCart] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<'produk' | 'nominal'>('produk');
  const [nominal, setNominal] = useState('');
  const [barcode, setBarcode] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<Outcome>(null);
  const [changePin, setChangePin] = useState(false);
  const [camera, setCamera] = useState(false);
  const [overlay, setOverlay] = useState(false);
  const [recap, setRecap] = useState(false);
  const [manage, setManage] = useState(false);
  const [sound, setSound] = useState(true);
  const [recent, setRecent] = useState<{ time: string; name: string; total: number }[]>([]);
  const [receipt, setReceipt] = useState<{ time: Date; name: string; items: { name: string; qty: number; price: number }[]; total: number; balance: number } | null>(null);
  const beep = (ok: boolean) => {
    if (!sound) return;
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext; const ctx = new AC();
      const o = ctx.createOscillator(); const g = ctx.createGain(); o.connect(g); g.connect(ctx.destination);
      o.type = 'sine'; o.frequency.value = ok ? 880 : 220; g.gain.value = 0.15; o.start(); o.stop(ctx.currentTime + (ok ? 0.14 : 0.35)); setTimeout(() => ctx.close(), 600);
    } catch { /* bunyi tidak tersedia */ }
  };
  useEffect(() => { if (!overlay) return; const t = setTimeout(() => { setOverlay(false); barcodeRef.current?.focus(); }, 6000); return () => clearTimeout(t); }, [overlay]);
  async function printStruk() {
    if (!receipt) return; const s = await loadSchool();
    const rows = receipt.items.map((i) => `<tr><td>${esc(i.name)}<br><small>${i.qty} × ${esc(rupiah(i.price))}</small></td><td style="text-align:right">${esc(rupiah(i.qty * i.price))}</td></tr>`).join('');
    printHtml('Struk', `<div style="text-align:center"><strong>${esc(s.name || 'E-QA')}</strong><br>${isLaundry ? 'Struk laundry' : 'Struk kantin'}<br><small>${esc(tanggalWaktu(receipt.time))}</small></div><hr><table style="width:100%;border-collapse:collapse">${rows}</table><hr><div style="display:flex;justify-content:space-between"><strong>Total</strong><strong>${esc(rupiah(receipt.total))}</strong></div><div style="display:flex;justify-content:space-between"><span>Sisa uang</span><span>${esc(rupiah(receipt.balance))}</span></div><div style="margin-top:6px"><small>Santri: ${esc(receipt.name)}</small></div><hr><div style="text-align:center"><small>Terima kasih</small></div>`, 'body{width:58mm;padding:2mm;font-size:12px}@page{size:58mm auto;margin:0}table td{padding:2px 0;vertical-align:top}hr{border:0;border-top:1px dashed #000;margin:6px 0}');
  }
  const keyRef = useRef(uuid());          // kunci idempotency; dipertahankan jika hasil transaksi tidak pasti (jaringan putus)
  const barcodeRef = useRef<HTMLInputElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);
  useEffect(() => { barcodeRef.current?.focus(); }, []);

  const lines = useMemo(() => (products ?? []).filter((p) => cart[p.id]).map((p) => ({ ...p, qty: cart[p.id] })), [products, cart]);
  const total = mode === 'produk' ? lines.reduce((s, l) => s + l.price * l.qty, 0) : Number(nominal) || 0;
  const add = (p: Product, d: number) => setCart((c) => {
    const q = Math.max(0, Math.min((c[p.id] ?? 0) + d, p.trackStock === false ? 100 : p.stock));
    const n = { ...c }; if (q === 0) delete n[p.id]; else n[p.id] = q; return n;
  });

  async function pay(e?: FormEvent) {
    e?.preventDefault();
    if (busy || total <= 0 || !barcode.trim() || pin.length < 6) return;
    setBusy(true); setOut(null);
    try {
      const body = { barcode: barcode.trim(), pin, idempotencyKey: keyRef.current, ...(mode === 'produk' ? { items: lines.map((l) => ({ productId: l.id, qty: l.qty })) } : { amount: total }) };
      const r = await api<{ total: number; balanceAfter: number; santriName: string; duplicate: boolean }>('/pos/pay', { method: 'POST', body });
      setOut({ kind: 'ok', name: r.santriName, total: r.total, balance: r.balanceAfter, duplicate: r.duplicate });
      setReceipt({ time: new Date(), name: r.santriName, total: r.total, balance: r.balanceAfter, items: mode === 'produk' ? lines.map((l) => ({ name: l.name, qty: l.qty, price: l.price })) : [{ name: isLaundry ? 'Layanan laundry' : 'Belanja kantin', qty: 1, price: r.total }] });
      setRecent((x) => [{ time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }), name: r.santriName, total: r.total }, ...x].slice(0, 8));
      beep(true); setOverlay(true);
      keyRef.current = uuid(); setCart({}); setNominal(''); setBarcode(''); setPin(''); reloadProducts();
      setTimeout(() => barcodeRef.current?.focus(), 50);
    } catch (e) {
      if (e instanceof ApiError) {
        keyRef.current = uuid(); // server sudah memberi jawaban pasti → transaksi berikutnya boleh pakai kunci baru
        if (e.code === 'PIN_MUST_CHANGE') setChangePin(true);
        else { setOut({ kind: 'err', message: e.message, code: e.code }); beep(false); }
        setPin('');
        if (['CARD_UNKNOWN', 'CARD_SUSPENDED', 'CARD_LOCKED', 'CARD_REPLACED'].includes(e.code)) { setBarcode(''); barcodeRef.current?.focus(); } else pinRef.current?.focus();
      } else {
        // Jaringan putus: hasil TIDAK pasti. Kunci dipertahankan sehingga mengulang tidak akan memotong saldo dua kali.
        setOut({ kind: 'unsure' });
      }
    } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="whitespace-nowrap text-2xl font-semibold text-navy-900">{isLaundry ? 'Kasir laundry' : 'Kasir kantin'}</h1>
          <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="secondary" onClick={() => setRecap(true)}>Rekap hari ini</Button>
          <Button variant="secondary" onClick={() => setManage(true)}>{isLaundry ? 'Kelola layanan' : 'Kelola barang'}</Button>
          <div className="flex rounded-lg border border-navy-200 bg-white p-0.5 text-sm">
            {(['produk', 'nominal'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`rounded-md px-3 py-1.5 font-medium ${mode === m ? 'bg-navy-800 text-white' : 'text-navy-700'}`}>{m === 'produk' ? 'Pilih produk' : 'Nominal bebas'}</button>
            ))}
          </div>
          </div>
        </div>
        {perr && <Alert>{perr}</Alert>}
        {mode === 'produk' ? (
          <>
            <div className="mb-3 max-w-sm"><Input type="search" placeholder={isLaundry ? 'Cari layanan…' : 'Cari produk…'} value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Cari produk" /></div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {(products ?? []).filter((p) => p.isActive && p.name.toLowerCase().includes(search.trim().toLowerCase())).map((p) => (
                <button key={p.id} onClick={() => add(p, 1)} disabled={p.trackStock !== false && p.stock <= (cart[p.id] ?? 0)} className="rounded-card border border-navy-100 bg-white p-4 text-left transition-colors hover:border-teal-500 disabled:opacity-50">
                  <div className="font-medium text-navy-900">{p.name}</div>
                  <div className="mt-1 text-lg font-semibold tabular-nums text-teal-700">{rupiah(p.price)}</div>
                  {p.trackStock !== false && <div className="text-xs text-navy-700">{p.stock > 0 ? `Stok ${p.stock}` : 'Habis'}</div>}
                </button>
              ))}
            </div>
            {products && products.length === 0 && <Alert tone="warn">Belum ada {isLaundry ? 'layanan' : 'barang'}. Tekan &quot;{isLaundry ? 'Kelola layanan' : 'Kelola barang'}&quot; di kanan atas untuk menambahkan.</Alert>}
          </>
        ) : (
          <div className="max-w-xs"><Field label="Nominal (Rp)"><MoneyInput min={500} step={500} value={nominal} onChange={(e) => setNominal(e.target.value)} placeholder="Contoh: 7500" /></Field></div>
        )}
      </div>

      <form onSubmit={pay} className="h-fit space-y-4 rounded-card border border-navy-100 bg-white p-5 lg:sticky lg:top-6">
        <h2 className="text-base font-semibold">Pembayaran</h2>
        {mode === 'produk' && (
          <ul className="space-y-2 text-sm">
            {lines.length === 0 && <li className="text-navy-700">Keranjang kosong.</li>}
            {lines.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate">{l.name}</span>
                <span className="flex items-center gap-1">
                  <button type="button" onClick={() => add(l, -1)} className="h-7 w-7 rounded border border-navy-200" aria-label={`Kurangi ${l.name}`}>−</button>
                  <span className="w-6 text-center tabular-nums">{l.qty}</span>
                  <button type="button" onClick={() => add(l, 1)} className="h-7 w-7 rounded border border-navy-200" aria-label={`Tambah ${l.name}`}>+</button>
                </span>
                <span className="w-20 text-right tabular-nums">{rupiah(l.price * l.qty)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-baseline justify-between border-t border-navy-100 pt-3"><span className="text-sm text-navy-700">Total</span><span className="text-2xl font-semibold tabular-nums">{rupiah(total)}</span></div>

        <Field label="1. Scan kartu santri" hint="Scan kode QR di kartu (scanner atau kamera), atau ketik kode di bawah QR.">
          <Input ref={barcodeRef} value={barcode} onChange={(e) => setBarcode(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); pinRef.current?.focus(); } }} autoComplete="off" spellCheck={false} />
        </Field>
        <Button type="button" variant="secondary" className="w-full" onClick={() => setCamera(true)}>Scan pakai kamera</Button>
        <Field label="2. PIN santri" hint="Santri mengetik sendiri. Kasir tidak boleh melihat.">
          <Input ref={pinRef} type="password" inputMode="numeric" pattern="\d{6}" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} autoComplete="off" />
        </Field>
        <Button disabled={busy || total <= 0 || !barcode.trim() || pin.length < 6} className="w-full py-3 text-base">{busy ? 'Memproses…' : `Bayar ${rupiah(total)}`}</Button>

        {out?.kind === 'ok' && (
          <div className="rounded-lg bg-teal-50 p-4 text-teal-700" role="status">
            <div className="text-lg font-semibold">Pembayaran berhasil</div>
            <div className="text-sm">{out.name} · dibayar {rupiah(out.total)}</div>
            <div className="text-sm">Sisa saldo: <strong>{rupiah(out.balance)}</strong></div>
            {out.duplicate && <div className="mt-1 text-xs">Permintaan ini sudah pernah diproses; saldo tidak dipotong dua kali.</div>}
          </div>
        )}
        {out?.kind === 'err' && <div className="rounded-lg border-2 border-red-300 bg-red-50 p-4 text-lg font-semibold text-red-800" role="alert">{out.message}</div>}
        <label className="flex items-center gap-2 text-sm text-navy-700"><input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} /> Bunyi saat berhasil / gagal</label>
        {recent.length > 0 && (
          <div className="border-t border-navy-50 pt-3"><div className="mb-1 text-sm font-medium text-navy-800">Transaksi terakhir (sesi ini)</div>
            <ul className="space-y-0.5 text-sm text-navy-700">{recent.map((r, i) => <li key={i} className="flex justify-between gap-2"><span className="truncate">{r.time} · {r.name}</span><span className="tabular-nums">{rupiah(r.total)}</span></li>)}</ul></div>
        )}
        {out?.kind === 'unsure' && <Alert tone="warn">Koneksi terputus, hasil pembayaran belum pasti. Tekan "Bayar" sekali lagi — saldo tidak akan terpotong dua kali.</Alert>}
      </form>

      {recap && <DailyRecap onClose={() => setRecap(false)} />}
      {manage && <ProductManager merchant={merchant} onClose={() => setManage(false)} onChanged={reloadProducts} />}
      {camera && <CameraScanner onClose={() => setCamera(false)} onResult={(t) => { setBarcode(t); setCamera(false); setOut(null); setTimeout(() => pinRef.current?.focus(), 80); }} />}
      {changePin && <ChangePinModal barcode={barcode.trim()} currentPin={pin} onClose={() => setChangePin(false)} onDone={() => { setChangePin(false); setPin(''); setOut({ kind: 'err', message: 'PIN berhasil diganti. Silakan masukkan PIN baru lalu bayar.' }); pinRef.current?.focus(); }} />}
      {overlay && out?.kind === 'ok' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-teal-700 p-6 text-center text-white" role="alertdialog" aria-label="Pembayaran berhasil">
          <div className="w-full max-w-md">
            <div className="mx-auto mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-white text-6xl text-teal-700" aria-hidden>✓</div>
            <div className="text-3xl font-bold">Pembayaran berhasil</div>
            <div className="mt-2 text-xl">{out.name}</div>
            <div className="mt-3 text-5xl font-bold tabular-nums">{rupiah(out.total)}</div>
            <div className="mt-3 text-xl">Sisa uang: <strong>{rupiah(out.balance)}</strong></div>
            {out.duplicate && <div className="mt-2 text-sm">Permintaan ini sudah pernah diproses; saldo tidak dipotong dua kali.</div>}
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button autoFocus onClick={() => { setOverlay(false); setTimeout(() => barcodeRef.current?.focus(), 30); }} className="min-h-[56px] rounded-xl bg-white px-8 text-lg font-semibold text-teal-700">Transaksi berikutnya</button>
              <button onClick={printStruk} className="min-h-[56px] rounded-xl border-2 border-white px-6 text-lg font-semibold text-white">Cetak struk</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ChangePinModal({ barcode, onClose, onDone }: { barcode: string; currentPin: string; onClose: () => void; onDone: () => void }) {
  // PIN lama sengaja diminta ulang di layar ini (santri mengetik sendiri).
  const [cur, setCur] = useState(''); const [a, setA] = useState(''); const [b, setB] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (a !== b) return setErr('PIN baru dan konfirmasi tidak sama');
    setBusy(true); setErr('');
    try { await api('/cards/change-pin', { method: 'POST', body: { barcode, currentPin: cur, newPin: a } }); onDone(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);
  return (
    <Modal title="Buat PIN baru" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Alert tone="warn">Ini PIN awal dari admin. Santri harus menggantinya dengan 6 angka yang hanya santri tahu. Kasir mohon menjauh dari layar.</Alert>
        {err && <Alert>{err}</Alert>}
        <Field label="PIN awal (dari slip)"><Input type="password" inputMode="numeric" value={cur} onChange={(e) => setCur(digits(e.target.value))} autoFocus /></Field>
        <Field label="PIN baru (6 angka)"><Input type="password" inputMode="numeric" value={a} onChange={(e) => setA(digits(e.target.value))} /></Field>
        <Field label="Ulangi PIN baru"><Input type="password" inputMode="numeric" value={b} onChange={(e) => setB(digits(e.target.value))} /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Batal</Button><Button disabled={busy || cur.length < 6 || a.length < 6}>{busy ? 'Menyimpan…' : 'Simpan PIN'}</Button></div>
      </form>
    </Modal>
  );
}
