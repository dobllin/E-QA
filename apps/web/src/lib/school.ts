'use client';
import { useEffect, useState } from 'react';
import { API_BASE } from './api';

export interface School { name: string; hasLogo: boolean }
let cache: School | null = null;
let inflight: Promise<School> | null = null;

/** Nama + logo pesantren (publik). Di-cache agar tidak diminta berulang. */
export function loadSchool(force = false): Promise<School> {
  if (cache && !force) return Promise.resolve(cache);
  if (force) { cache = null; inflight = null; }
  inflight ??= fetch(`${API_BASE}/public/school`).then((r) => r.json()).then((s: School) => (cache = s)).catch(() => ({ name: '', hasLogo: false }));
  return inflight;
}
export function useSchool() {
  const [s, setS] = useState<School | null>(cache);
  useEffect(() => { loadSchool().then(setS); }, []);
  return s;
}
export const schoolLogoUrl = (bust = 0) => `${API_BASE}/public/school/logo?v=${bust}`;

/** Siapkan logo sebagai ImageBitmap untuk digambar ke kartu (lewat fetch agar canvas tidak "tainted"). */
export async function loadBrand(): Promise<{ name: string; logo: ImageBitmap | null }> {
  const s = await loadSchool(true);
  let logo: ImageBitmap | null = null;
  if (s.hasLogo) { try { const r = await fetch(schoolLogoUrl(Date.now())); if (r.ok) logo = await createImageBitmap(await r.blob()); } catch { /* tanpa logo */ } }
  return { name: s.name, logo };
}
