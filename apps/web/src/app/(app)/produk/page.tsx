'use client';
import { useState } from 'react';
import { rupiah } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { Alert, Badge, Button, Empty, Input, Loading, PageHeader, Table, Td } from '@/components/ui';
import { ProductForm } from '@/components/ProductForm';

interface P { id: string; name: string; price: number; stock: number; isActive: boolean; merchant: 'KANTIN' | 'LAUNDRY'; trackStock: boolean }

export default function ProdukPage() {
  const [merchant, setMerchant] = useState<'KANTIN' | 'LAUNDRY'>('KANTIN');
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useApi<P[]>('/products', { merchant });
  const [edit, setEdit] = useState<P | 'new' | null>(null);
  const isLaundry = merchant === 'LAUNDRY';
  const rows = (data ?? []).filter((p) => p.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <PageHeader title={isLaundry ? 'Layanan laundry' : 'Produk kantin'} sub={isLaundry ? 'Daftar layanan dan harga laundry. Dibayar dari kantong Laundry santri.' : 'Harga dan stok. Stok berkurang otomatis saat santri membayar. Dibayar dari kantong Jajan santri.'} action={<Button onClick={() => setEdit('new')}>{isLaundry ? 'Tambah layanan' : 'Tambah produk'}</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-lg border border-navy-200 bg-white p-0.5 text-sm" role="tablist" aria-label="Jenis">
          {(['KANTIN', 'LAUNDRY'] as const).map((m) => <button key={m} role="tab" aria-selected={merchant === m} onClick={() => setMerchant(m)} className={`rounded-md px-3 py-1.5 font-medium ${merchant === m ? 'bg-navy-800 text-white' : 'text-navy-700'}`}>{m === 'KANTIN' ? 'Kantin' : 'Laundry'}</button>)}
        </div>
        <div className="w-full max-w-xs"><Input type="search" placeholder="Cari nama…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari produk" /></div>
      </div>
      {loading && <Loading />}{error && <Alert>{error}</Alert>}
      {data && (rows.length === 0 ? <Empty>{q ? 'Tidak ada yang cocok dengan pencarian.' : `Belum ada ${isLaundry ? 'layanan' : 'produk'}. Tambahkan yang pertama untuk mulai.`}</Empty> : (
        <div className="rounded-card border border-navy-100 bg-white">
          <Table head={[isLaundry ? 'Layanan' : 'Produk', 'Harga', ...(isLaundry ? [] : ['Stok']), 'Status', '']}>
            {rows.map((p) => (
              <tr key={p.id}>
                <Td className="font-medium">{p.name}</Td><Td right>{rupiah(p.price)}</Td>
                {!isLaundry && <Td right className={p.stock <= 5 ? 'font-semibold text-red-700' : ''}>{p.stock}</Td>}
                <Td>{p.isActive ? <Badge tone="ok">Dijual</Badge> : <Badge>Disembunyikan</Badge>}</Td>
                <Td right><Button variant="ghost" onClick={() => setEdit(p)}>Ubah</Button></Td>
              </tr>
            ))}
          </Table>
        </div>
      ))}
      {edit && <ProductForm p={edit === 'new' ? null : edit} merchant={merchant} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); }} />}
    </>
  );
}
