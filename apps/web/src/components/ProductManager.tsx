'use client';
import { useState } from 'react';
import { rupiah } from '@/lib/format';
import { useApi } from '@/lib/use-api';
import { Alert, Badge, Button, Empty, Loading, Modal, Table, Td } from './ui';
import { P, ProductForm } from './ProductForm';

/** Kasir/Laundry menambah dan mengubah barang jualannya sendiri (tidak ada hapus; barang bisa disembunyikan). */
export function ProductManager({ merchant, onClose, onChanged }: { merchant: 'KANTIN' | 'LAUNDRY'; onClose: () => void; onChanged: () => void }) {
  const isLaundry = merchant === 'LAUNDRY';
  const { data, error, loading, reload } = useApi<P[]>('/products', { merchant });
  const [edit, setEdit] = useState<P | 'new' | null>(null);
  const label = isLaundry ? 'layanan' : 'barang';
  return (
    <Modal title={isLaundry ? 'Kelola layanan laundry' : 'Kelola barang kantin'} onClose={onClose} wide>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-navy-700">Tambah {label} baru atau ubah nama dan harga. Perubahan harga tercatat.</p>
        <Button onClick={() => setEdit('new')}>{isLaundry ? 'Tambah layanan' : 'Tambah barang'}</Button>
      </div>
      {loading && <Loading />}{error && <Alert>{error}</Alert>}
      {data && (data.length === 0 ? <Empty>Belum ada {label}. Tekan &quot;Tambah {label}&quot;.</Empty> : (
        <Table head={[isLaundry ? 'Layanan' : 'Barang', 'Harga', ...(isLaundry ? [] : ['Stok']), 'Status', '']}>
          {data.map((p) => (
            <tr key={p.id}>
              <Td className="font-medium">{p.name}</Td><Td right>{rupiah(p.price)}</Td>
              {!isLaundry && <Td right className={p.stock <= 5 ? 'font-semibold text-red-700' : ''}>{p.stock}</Td>}
              <Td>{p.isActive ? <Badge tone="ok">Dijual</Badge> : <Badge>Disembunyikan</Badge>}</Td>
              <Td right><Button variant="ghost" onClick={() => setEdit(p)}>Ubah</Button></Td>
            </tr>
          ))}
        </Table>
      ))}
      <div className="mt-4 flex justify-end"><Button variant="ghost" onClick={onClose}>Tutup</Button></div>
      {edit && <ProductForm p={edit === 'new' ? null : edit} merchant={merchant} onClose={() => setEdit(null)} onDone={() => { setEdit(null); reload(); onChanged(); }} />}
    </Modal>
  );
}
