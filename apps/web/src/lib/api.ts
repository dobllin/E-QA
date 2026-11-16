const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const API_BASE = BASE;
const KEY = 'eqa.session';

export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'BENDAHARA' | 'KASIR' | 'LAUNDRY' | 'GURU' | 'WALSAN';
export interface SessionUser { id: string; username: string; fullName: string; role: Role }
interface Session { accessToken: string; refreshToken: string; user: SessionUser }

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data: any = {}) { super(message); }
}

export const getSession = (): Session | null => {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(localStorage.getItem(KEY) ?? 'null'); } catch { return null; }
};
const setSession = (s: Session | null) => {
  if (s) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY);
};

export async function login(username: string, password: string) {
  const res = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.code ?? 'ERR', data.message ?? 'Gagal login', data);
  setSession(data);
  return data.user as SessionUser;
}

export async function logout() {
  const s = getSession();
  if (s) await fetch(`${BASE}/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: s.refreshToken }) }).catch(() => {});
  setSession(null);
}

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  const s = getSession();
  if (!s) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: s.refreshToken }) });
      if (!res.ok) return false;
      const t = await res.json();
      setSession({ ...s, accessToken: t.accessToken, refreshToken: t.refreshToken });
      return true;
    } catch { return false; } finally { setTimeout(() => (refreshing = null), 0); }
  })();
  return refreshing;
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; query?: Record<string, string | undefined> } = {}): Promise<T> {
  const qs = opts.query ? '?' + new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v) as [string, string][]).toString() : '';
  const call = () => fetch(`${BASE}${path}${qs}`, {
    method: opts.method ?? 'GET',
    headers: { 'content-type': 'application/json', ...(getSession() ? { authorization: `Bearer ${getSession()!.accessToken}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let res = await call(); // kalau jaringan putus, fetch melempar TypeError (dibiarkan agar pemanggil tahu hasilnya TIDAK pasti)
  let data = await res.json().catch(() => ({}));
  // Refresh token HANYA jika masalahnya sesi (bukan, misalnya, PIN salah).
  if (res.status === 401 && ['UNAUTHENTICATED', 'TOKEN_INVALID'].includes(data.code) && getSession() && (await refresh())) {
    res = await call();
    data = await res.json().catch(() => ({}));
  }
  if (!res.ok) {
    if (res.status === 401 && ['UNAUTHENTICATED', 'TOKEN_INVALID', 'ACCOUNT_DISABLED'].includes(data.code)) { setSession(null); if (typeof window !== 'undefined') window.location.href = '/login'; }
    throw new ApiError(res.status, data.code ?? 'ERR', Array.isArray(data.message) ? data.message[0] : data.message ?? 'Terjadi kesalahan', data);
  }
  return data as T;
}
async function authed(path: string, init: RequestInit) {
  const call = () => fetch(`${BASE}${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(getSession() ? { authorization: `Bearer ${getSession()!.accessToken}` } : {}) } });
  let res = await call();
  if (res.status === 401 && getSession() && (await refresh())) res = await call();
  return res;
}
/** Kirim berkas (multipart). Jangan set Content-Type manual: browser mengisi boundary-nya. */
export async function apiUpload<T = any>(path: string, form: FormData, method: 'POST' | 'PUT' = 'POST'): Promise<T> {
  const res = await authed(path, { method, body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.code ?? 'ERR', Array.isArray(data.message) ? data.message[0] : data.message ?? 'Gagal mengunggah', data);
  return data as T;
}
/** Ambil berkas yang dilindungi login (mis. foto bukti) sebagai URL sementara untuk <img>. */
export async function apiBlobUrl(path: string): Promise<string> {
  const res = await authed(path, { method: 'GET' });
  if (!res.ok) throw new ApiError(res.status, 'ERR', 'Gagal memuat berkas');
  return URL.createObjectURL(await res.blob());
}
export const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof TypeError ? 'Tidak bisa terhubung ke server. Periksa jaringan.' : 'Terjadi kesalahan');

/** Unduh berkas yang dilindungi login (mis. CSV laporan) sebagai file. */
export async function apiDownload(path: string, fileName: string) {
  const res = await authed(path, { method: 'GET' });
  if (!res.ok) { const d = await res.json().catch(() => ({})); throw new ApiError(res.status, d.code ?? 'ERR', d.message ?? 'Gagal mengunduh'); }
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
