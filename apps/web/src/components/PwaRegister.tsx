'use client';
import { useEffect } from 'react';
/** Mendaftarkan service worker (hanya jalan di HTTPS atau localhost). */
export function PwaRegister() {
  useEffect(() => { if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {}); }, []);
  return null;
}
