'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errMsg } from './api';

/** Ambil data dari API dengan state loading/error, plus fungsi reload. */
export function useApi<T>(path: string | null, query?: Record<string, string | undefined>) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const qk = JSON.stringify(query ?? {});
  const loaded = useRef(false); // setelah data pertama masuk, pemuatan ulang berjalan diam-diam (layar tidak dikosongkan)
  const load = useCallback(async () => {
    if (!path) return;
    if (!loaded.current) setLoading(true);
    setError(null);
    try { setData(await api<T>(path, { query })); loaded.current = true; } catch (e) { setError(errMsg(e)); } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, qk]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load };
}
