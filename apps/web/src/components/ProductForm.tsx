'use client';
import { FormEvent, useState } from 'react';
import { api, errMsg } from '@/lib/api';
import { Alert, Button, Field, Input, Modal, MoneyInput } from '@/components/ui';

export interface P { id: string; name: string; price: number; stock: number; isActive: boolean; merchant: 'KANTIN' | 'LAUNDRY'; trackStock: boolean }

/** Form tambah/ubah barang (kantin) atau layanan (laundry). Dipakai di halaman Produk dan di layar Kasir/Laundry. */
export function ProductForm({ p, merchant, onClose, onDone }: { p: P | null; merchant: 'KANTIN' | 'LAUNDRY'; onClose: () => void; onDone: () => void }) {
  const isLaundry = (p?.merchant ?? merchant) === 'LAUNDRY';
  const [name, setName] = useState(p?.name ?? ''); const [price, setPrice] = useState(String(p?.price ?? '')); const [stock, setStock] = useState(String(p?.stock ?? 0)); const [active, setActive] = useState(p?.isActive ?? true);
  const [err, setErr] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      if (p) await api(`/products/${p.id}`, { method: 'PATCH', body: { name, price: Number(price), ...(isLaundry ? {} : { stock: Number(stock) }), isActive: active } });
      else await api('/products', { method: 'POST', body: { name, price: Number(price), stock: isLaundry ? 0 : Number(stock), merchant } });
      onDone();
    } catch (e) { setErr(errMsg(e)); }
  }
  return (
    <Modal title={p ? 'Ubah' : isLaundry ? 'Tambah layanan' : 'Tambah produk'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        {err && <Alert>{err}</Alert>}
        <Field label={isLaundry ? 'Nama layanan' : 'Nama produk'}><Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Harga (Rp)"><MoneyInput min={100} value={price} onChange={(e) => setPrice(e.target.value)} required /></Field>
          {!isLaundry && <Field label="Stok"><Input type="number" min={0} value={stock} onChange={(e) => setStock(e.target.value)} required /></Field>}
        </div>
        {p && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Tampilkan di kasir</label>}
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Batal</Button><Button>Simpan</Button></div>
      </form>
    </Modal>
  );
}
