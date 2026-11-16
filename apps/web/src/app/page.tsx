'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getSession } from '@/lib/api';
import { homeFor } from '@/components/Shell';

export default function Home() {
  const r = useRouter();
  useEffect(() => { const s = getSession(); r.replace(s ? homeFor(s.user.role) : '/login'); }, [r]);
  return null;
}
