'use client';
import Link from 'next/link';
import { rupiah } from '@/lib/format';
import { useApi } from '@/lib/use-api';

/** Pengingat: ada bulan yang biaya layanannya belum disetor ke pengembang. */
export function FeeReminder() {
  const { data } = useApi<{ unpaidMonths: number; unpaidTotal: number; awaitingConfirmation: number }>('/fees/summary');
  if (!data || (data.unpaidMonths === 0 && data.awaitingConfirmation === 0)) return null;
  return (
    <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-card border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <span>
        {data.unpaidMonths > 0 && <>Ada <strong>{data.unpaidMonths} bulan</strong> biaya layanan aplikasi yang belum dibayar (total <strong>{rupiah(data.unpaidTotal)}</strong>). </>}
        {data.awaitingConfirmation > 0 && <>{data.awaitingConfirmation} bulan menunggu konfirmasi penerimaan.</>}
      </span>
      <Link href="/tagihan-jasa" className="font-medium underline">Buka tagihan jasa</Link>
    </div>
  );
}
