'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { FormEvent, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { api, errMsg, getSession, logout, Role, SessionUser } from '@/lib/api';
import { tanggalWaktu } from '@/lib/format';
import { schoolLogoUrl, useSchool } from '@/lib/school';
import { announce, audioReady, unlockAudio } from '@/lib/sound';
import { openLinkEvent, popupOn, popupPermission, showPopup } from '@/lib/alerts';
import { Alert, Button, Field, Input, Modal } from './ui';
import { RemindDot } from './Reminders';
import { NotifSettings } from './NotifSettings';

interface Item { href: string; label: string; roles: Role[]; group: string }
const STAFF: Role[] = ['SUPER_ADMIN', 'ADMIN', 'BENDAHARA'];
const ITEMS: Item[] = [
  { href: '/dashboard', label: 'Ringkasan', roles: STAFF, group: 'Harian' },
  { href: '/kasir', label: 'Kasir', roles: ['SUPER_ADMIN', 'KASIR'], group: 'Harian' },
  { href: '/laundry', label: 'Laundry', roles: ['SUPER_ADMIN', 'LAUNDRY'], group: 'Harian' },
  { href: '/walsan', label: 'Anak saya', roles: ['WALSAN'], group: 'Harian' },
  { href: '/absen', label: 'Absen kelas', roles: ['SUPER_ADMIN', 'GURU'], group: 'Harian' },
  { href: '/santri', label: 'Santri', roles: [...STAFF, 'GURU'], group: 'Santri dan uang' },
  { href: '/topup', label: 'Top up masuk', roles: STAFF, group: 'Santri dan uang' },
  { href: '/tagihan', label: 'Tagihan', roles: STAFF, group: 'Santri dan uang' },
  { href: '/transaksi', label: 'Transaksi', roles: STAFF, group: 'Santri dan uang' },
  { href: '/produk', label: 'Produk kantin', roles: STAFF, group: 'Kantin dan laundry' },
  { href: '/laporan', label: 'Laporan & audit', roles: STAFF, group: 'Laporan' },
  { href: '/jadwal', label: 'Jadwal & laporan absen', roles: ['SUPER_ADMIN', 'ADMIN'], group: 'Absensi' },
  { href: '/impor', label: 'Impor santri & tagihan', roles: ['SUPER_ADMIN', 'ADMIN'], group: 'Pengaturan' },
  { href: '/pengguna', label: 'Pengguna', roles: ['SUPER_ADMIN', 'ADMIN'], group: 'Pengaturan' },
  { href: '/pengaturan', label: 'Pengaturan sekolah', roles: ['SUPER_ADMIN', 'ADMIN'], group: 'Pengaturan' },
  { href: '/tagihan-jasa', label: 'Tagihan jasa', roles: STAFF, group: 'Pengaturan' },
];
export const homeFor = (role: Role) => (role === 'KASIR' ? '/kasir' : role === 'LAUNDRY' ? '/laundry' : role === 'WALSAN' ? '/walsan' : role === 'GURU' ? '/absen' : '/dashboard');
const ROLE_LABEL: Record<Role, string> = { SUPER_ADMIN: 'Super Admin', ADMIN: 'Admin', BENDAHARA: 'Bendahara', KASIR: 'Kasir', LAUNDRY: 'Laundry', GURU: 'Guru', WALSAN: 'Wali santri' };

const CONSENT_VERSION = 'v1-draft';

function Brand({ light }: { light?: boolean }) {
  const s = useSchool();
  return (
    <div className="flex items-center gap-3">
      {s?.hasLogo && <img src={schoolLogoUrl(1)} alt="" className="h-9 w-9 rounded-md bg-white object-contain" />}
      <div className="min-w-0 leading-tight">
        <div className={`truncate text-lg font-bold tracking-wide ${light ? 'text-white' : 'text-navy-900'}`}>{s?.name ? s.name : 'E-QA'}</div>
        {s?.name && <div className={`text-xs ${light ? 'text-navy-100' : 'text-navy-700'}`}>Kartu dan keuangan santri</div>}
      </div>
    </div>
  );
}

function ChangePassword({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({ cur: '', a: '', b: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr('');
    if (f.a !== f.b) return setErr('Password baru dan konfirmasinya tidak sama');
    setBusy(true);
    try { await api('/auth/change-password', { method: 'POST', body: { currentPassword: f.cur, newPassword: f.a } }); await logout(); router.replace('/login'); }
    catch (e) { setErr(errMsg(e)); setBusy(false); }
  }
  return (
    <Modal title="Ganti password" onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <Alert tone="warn">Setelah password diganti, Anda perlu login ulang.</Alert>
        {err && <Alert>{err}</Alert>}
        <Field label="Password lama"><Input type="password" value={f.cur} onChange={(e) => setF({ ...f, cur: e.target.value })} autoComplete="current-password" required autoFocus /></Field>
        <Field label="Password baru" hint="Minimal 8 karakter"><Input type="password" value={f.a} onChange={(e) => setF({ ...f, a: e.target.value })} autoComplete="new-password" minLength={8} required /></Field>
        <Field label="Ulangi password baru"><Input type="password" value={f.b} onChange={(e) => setF({ ...f, b: e.target.value })} autoComplete="new-password" minLength={8} required /></Field>
        <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>Batal</Button><Button disabled={busy}>{busy ? 'Menyimpan…' : 'Ganti password'}</Button></div>
      </form>
    </Modal>
  );
}

type Notif = { id: string; title: string; body: string; kind: 'INFO' | 'PAYMENT'; link: string | null; readAt: string | null; createdAt: string };
type Feed = { unread: number; items: Notif[] };

/** Panel pemberitahuan (dropdown dari tombol lonceng). Pengurus juga mendapat pengaturan suara. */
function NotificationPanel({ feed, staff, onClose, onChanged, onSettings }: { feed: Feed | null; staff: boolean; onClose: () => void; onChanged: () => void; onSettings: () => void }) {
  const router = useRouter();
  const needPerm = staff && popupOn() && popupPermission() === 'default';
  async function readAll() { await api('/notifications/read-all', { method: 'POST' }).catch(() => {}); onChanged(); }
  async function openItem(n: Notif) {
    if (!n.readAt) await api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
    onChanged();
    if (n.link) { onClose(); router.push(n.link); }
  }
  return (
    <div role="dialog" aria-label="Pemberitahuan" className="anim-pop fixed inset-x-2 top-32 z-40 rounded-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[380px] rounded-xl border border-navy-100 bg-white text-base shadow-xl">
      <div className="flex items-center justify-between border-b border-navy-50 px-4 py-3">
        <strong className="text-navy-900">Pemberitahuan</strong>
        {!!feed?.unread && <button onClick={readAll} className="text-sm font-medium text-teal-700 underline underline-offset-2">Tandai semua dibaca</button>}
      </div>
      <div className="max-h-[60vh] overflow-y-auto">
        {!feed ? <p className="p-4">Memuat…</p> : feed.items.length === 0 ? <p className="p-6 text-center text-navy-700">Belum ada pemberitahuan.</p> : (
          <ul className="divide-y divide-navy-50">{feed.items.map((n) => (
            <li key={n.id}>
              <button onClick={() => openItem(n)} className={`block w-full px-4 py-3 text-left hover:bg-navy-50 ${n.kind === 'PAYMENT' && !n.readAt ? 'bg-teal-50' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <strong className={n.readAt ? 'font-medium text-navy-800' : 'text-navy-900'}>{!n.readAt && <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full bg-teal-500" aria-label="baru" />}{n.kind === 'PAYMENT' ? '💰 ' : ''}{n.title}</strong>
                  <span className="shrink-0 text-xs text-navy-700">{tanggalWaktu(n.createdAt)}</span>
                </div>
                <p className="mt-0.5 text-sm text-navy-700">{n.body}</p>
              </button>
            </li>
          ))}</ul>
        )}
      </div>
      {staff && (
        <div className="space-y-2 border-t border-navy-50 px-4 py-3 text-sm">
          {needPerm && <p className="rounded-lg bg-amber-50 p-2 text-amber-900">Popup di layar belum aktif. Buka <strong>Atur notifikasi</strong> lalu izinkan.</p>}
          <Button variant="secondary" onClick={onSettings}>Atur notifikasi</Button>
        </div>
      )}
    </div>
  );
}

function Consent({ onDone }: { onDone: () => void }) {
  const router = useRouter(); const s = useSchool();
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function agree() { setBusy(true); try { await api('/portal/consent', { method: 'POST', body: { version: CONSENT_VERSION } }); onDone(); } catch (e) { setErr(errMsg(e)); setBusy(false); } }
  return (
    <Modal title="Pemberitahuan privasi dan persetujuan" onClose={() => {}}>
      <div className="space-y-3 text-[17px] leading-relaxed">
        <p>{s?.name || 'Pesantren'} menggunakan aplikasi ini untuk kartu santri, jajan di kantin, laundry, dan pencatatan tagihan sekolah.</p>
        <ul className="list-disc space-y-1 pl-6">
          <li>Data yang diproses: nama, NIS, kelas, saldo, riwayat belanja, tagihan dan pembayaran.</li>
          <li>Data anak hanya bisa dilihat oleh Anda (wali anak itu) dan pengurus pesantren yang berwenang.</li>
          <li>Aplikasi tidak mengambil data biometrik atau lokasi.</li>
          <li>Anda bisa meminta koreksi atau penghapusan data lewat pengurus pesantren.</li>
        </ul>
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Teks ini masih DRAFT dan perlu diperiksa penasihat hukum sebelum dipakai sungguhan.</p>
        {err && <Alert>{err}</Alert>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="lg" onClick={async () => { await logout(); router.replace('/login'); }}>Keluar</Button>
          <Button size="lg" onClick={agree} disabled={busy}>{busy ? 'Menyimpan…' : 'Saya mengerti dan setuju'}</Button>
        </div>
      </div>
    </Modal>
  );
}

const STAFF_ROLES: Role[] = ['SUPER_ADMIN', 'ADMIN', 'BENDAHARA'];
const OPEN_KEY = 'eqa.menu.open';
const readOpen = (): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}'); } catch { return {}; } };

export function Shell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState(false);
  const [bell, setBell] = useState(false);
  const [feed, setFeed] = useState<Feed | null>(null);
  const [toast, setToast] = useState<Notif | null>(null);
  const [locked, setLocked] = useState(false);
  const [settings, setSettings] = useState(false);
  const [tabCount, setTabCount] = useState(0);   // pembayaran baru yang masuk saat tab tidak sedang dilihat
  const [need, setNeed] = useState(0);   // jumlah santri yang tunggakannya perlu diingatkan (titik merah di menu)
  const [needConsent, setNeedConsent] = useState(false);
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({});
  const seen = useRef<Set<string> | null>(null);
  const bellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) { router.replace('/login'); return; }
    setUser(s.user);
    setGroupOpen(readOpen());
    if (s.user.role === 'WALSAN') api<any>('/auth/me').then((m) => setNeedConsent(!m.consentAt)).catch(() => {});
  }, [router]);

  const isStaff = !!user && STAFF_ROLES.includes(user.role);
  const hasBell = !!user && (user.role === 'WALSAN' || isStaff);

  const refresh = useCallback(async () => {
    if (!getSession()) return;
    const role = getSession()!.user.role;
    if (role !== 'WALSAN' && !STAFF_ROLES.includes(role)) return;
    // Ringkasan pengingat dulu: bila ada yang "perlu diingatkan lagi", server membuat pemberitahuan yang langsung ikut terbaca di bawah.
    if (STAFF_ROLES.includes(role)) { try { setNeed((await api<{ needSantri: number }>('/reminders/summary')).needSantri); } catch { /* abaikan */ } }
    try {
      const d = await api<Feed>('/notifications');
      setFeed(d);
      if (seen.current === null) { seen.current = new Set(d.items.map((n) => n.id)); return; } // pertama kali: tanpa bunyi
      const fresh = d.items.filter((n) => !n.readAt && !seen.current!.has(n.id));
      fresh.forEach((n) => seen.current!.add(n.id));
      if (fresh.length && STAFF_ROLES.includes(role)) {
        const pay = fresh.find((n) => n.kind === 'PAYMENT');
        announce(pay ? 'PAYMENT' : 'INFO');
        setToast(pay ?? fresh[0]);
        setLocked(!audioReady());
        const pays = fresh.filter((n) => n.kind === 'PAYMENT');
        if (pays.length && document.visibilityState === 'hidden') {   // tab ditinggal: popup browser + judul tab berkedip
          setTabCount((c) => c + pays.length);
          pays.slice(0, 3).forEach((n) => { showPopup(n.title, n.body, n.id, n.link); });
        }
      }
    } catch { /* abaikan */ }
  }, []);
  useEffect(() => { const f = () => { refresh(); }; window.addEventListener('eqa-refresh', f); return () => window.removeEventListener('eqa-refresh', f); }, [refresh]);
  useEffect(() => { refresh(); const t = setInterval(refresh, STAFF_ROLES.includes(getSession()?.user.role as Role) ? 10_000 : 20_000); const v = () => document.visibilityState === 'visible' && refresh(); document.addEventListener('visibilitychange', v); return () => { clearInterval(t); document.removeEventListener('visibilitychange', v); }; }, [refresh, path]);
  // Judul tab berkedip "Pembayaran baru" selama tab belum dibuka kembali.
  useEffect(() => {
    const seenAgain = () => { if (document.visibilityState === 'visible') setTabCount(0); };
    document.addEventListener('visibilitychange', seenAgain); window.addEventListener('focus', seenAgain);
    return () => { document.removeEventListener('visibilitychange', seenAgain); window.removeEventListener('focus', seenAgain); };
  }, []);
  useEffect(() => {
    if (!tabCount) return;
    const base = document.title; let on = true;
    const tick = () => { document.title = on ? `(${tabCount}) 💰 Pembayaran baru` : base; on = !on; };
    tick(); const t = setInterval(tick, 1200);
    return () => { clearInterval(t); document.title = base; };
  }, [tabCount]);
  // Klik pada popup browser: pindah ke halaman terkait.
  useEffect(() => {
    const go = (l: unknown) => { if (typeof l === 'string' && l.startsWith('/')) router.push(l); };
    const ev = (e: Event) => go((e as CustomEvent).detail);
    const msg = (e: MessageEvent) => { if (e.data && e.data.type === 'eqa-open-link') go(e.data.link); };
    window.addEventListener(openLinkEvent, ev); navigator.serviceWorker?.addEventListener('message', msg);
    return () => { window.removeEventListener(openLinkEvent, ev); navigator.serviceWorker?.removeEventListener('message', msg); };
  }, [router]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 12_000); return () => clearTimeout(t); }, [toast]);
  // Browser hanya mengizinkan suara setelah pengguna menyentuh halaman sekali.
  useEffect(() => { const f = () => { unlockAudio().then((ok) => ok && setLocked(false)); }; window.addEventListener('pointerdown', f, { once: true }); return () => window.removeEventListener('pointerdown', f); }, []);
  useEffect(() => { setOpen(false); setBell(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', k); const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [open]);
  useEffect(() => {
    if (!bell) return;
    const f = (e: MouseEvent) => { if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBell(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setBell(false); };
    document.addEventListener('mousedown', f); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', f); document.removeEventListener('keydown', k); };
  }, [bell]);

  // Penjaga halaman (kenyamanan saja; keamanan sebenarnya tetap dicek di backend).
  const current = user ? ITEMS.find((i) => path === i.href || path.startsWith(i.href + '/')) : undefined;
  const allowed = !current || (user ? current.roles.includes(user.role) : true);
  useEffect(() => { if (user && !allowed) router.replace(homeFor(user.role)); }, [user, allowed, router]);
  if (!user || !allowed) return null;

  const items = ITEMS.filter((i) => i.roles.includes(user.role));
  const groups = Array.from(new Set(items.map((i) => i.group)));
  const isWali = user.role === 'WALSAN';
  const unread = feed?.unread ?? 0;
  const toggle = (g: string, cur: boolean) => { const n = { ...groupOpen, [g]: !cur }; setGroupOpen(n); try { localStorage.setItem(OPEN_KEY, JSON.stringify(n)); } catch { /* abaikan */ } };
  const nav = (
    <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Menu utama">
      {groups.map((g) => {
        const list = items.filter((i) => i.group === g);
        const hasActive = list.some((i) => path === i.href || path.startsWith(i.href + '/'));
        const single = groups.length === 1;
        const isOpen = single || g === 'Harian' || hasActive || !!groupOpen[g];
        const pinned = single || g === 'Harian' || hasActive; // tidak bisa ditutup bila berisi halaman aktif
        return (
          <div key={g} className="mb-2">
            {!single && g !== 'Harian' && (
              <button type="button" onClick={() => !pinned && toggle(g, isOpen)} aria-expanded={isOpen} disabled={pinned}
                className="flex min-h-[40px] w-full items-center justify-between rounded-lg px-3 text-left text-sm font-semibold text-navy-100 hover:bg-navy-800 disabled:cursor-default disabled:hover:bg-transparent">
                <span className="flex items-center gap-2">{g}{need > 0 && list.some((i) => i.href === '/tagihan') && <RemindDot label={`${need} wali perlu diingatkan`} />}</span>
                <span aria-hidden className={`text-xs transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
              </button>
            )}
            {isOpen && (
              <div className={`space-y-1 ${!single && g !== 'Harian' ? 'ml-2 mt-1 border-l border-navy-800 pl-2' : ''}`}>
                {list.map((i) => {
                  const active = path === i.href || path.startsWith(i.href + '/');
                  return <Link key={i.href} href={i.href} className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${active ? 'bg-teal-500 text-white' : 'text-navy-100 hover:bg-navy-800'}`}><span>{i.label}</span>{i.href === '/tagihan' && need > 0 && <span className="flex items-center gap-1.5"><RemindDot label={`${need} wali perlu diingatkan`} /><span className="rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">{need}</span></span>}</Link>;
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
  const foot = (
    <div className="border-t border-navy-800 p-4 text-sm text-navy-100">
      <div className="font-medium text-white">{user.fullName}</div>
      <div className="text-xs">{ROLE_LABEL[user.role]}</div>
      <div className="mt-3 flex gap-4 text-xs">
        <button onClick={() => setPw(true)} className="underline underline-offset-2 hover:text-white">Ganti password</button>
        <button onClick={async () => { await logout(); router.replace('/login'); }} className="underline underline-offset-2 hover:text-white">Keluar</button>
      </div>
    </div>
  );
  const bellBtn = hasBell && (
    <div className="relative" ref={bellRef}>
      <button onClick={() => { setBell(!bell); setToast(null); unlockAudio(); refresh(); }} aria-expanded={bell} className="relative flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-navy-200 bg-white px-3 text-sm font-medium text-navy-800" aria-label={`Pemberitahuan${unread ? `, ${unread} baru` : ''}`}>
        Pemberitahuan <span aria-hidden className="ml-1 text-xs">▾</span>{unread > 0 && <span className="ml-2 rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">{unread}</span>}
      </button>
      {bell && <NotificationPanel feed={feed} staff={isStaff} onClose={() => setBell(false)} onChanged={refresh} onSettings={() => { setBell(false); setSettings(true); }} />}
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="hidden max-h-screen flex-col bg-navy-900 lg:sticky lg:top-0 lg:flex">
        <div className="px-5 pt-6"><Brand light /></div>
        {nav}{foot}
      </aside>

      {/* Menu geser untuk HP/tablet */}
      <div className={`drawer-backdrop lg:hidden ${open ? 'is-open' : ''}`} onClick={() => setOpen(false)} aria-hidden />
      <aside id="menu-mobile" aria-label="Menu" aria-hidden={!open} className={`drawer flex flex-col bg-navy-900 lg:hidden ${open ? 'is-open' : ''}`}>
        <div className="flex items-center justify-between px-5 pt-5"><Brand light /><button onClick={() => setOpen(false)} className="min-h-[44px] min-w-[44px] rounded-lg text-xl text-navy-100 hover:bg-navy-800" aria-label="Tutup menu">✕</button></div>
        {nav}{foot}
      </aside>

      <div className="min-w-0">
        <div className="bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-900">MODE DEMO — saldo dan pembayaran adalah simulasi, bukan uang sungguhan.</div>
        <header className={`flex items-center justify-between gap-3 border-b border-navy-100 bg-white px-4 py-3 ${hasBell ? '' : 'lg:hidden'}`}>
          <div className="min-w-0 lg:hidden"><Brand /></div>
          <div className="ml-auto flex items-center gap-2">
            {bellBtn}
            <button onClick={() => setOpen(!open)} className="min-h-[44px] rounded-lg border border-navy-200 px-3 text-sm lg:hidden" aria-expanded={open} aria-controls="menu-mobile">Menu</button>
          </div>
        </header>
        {toast && (
          <div role="status" className={`anim-toast fixed bottom-4 left-1/2 z-50 w-[min(92vw,420px)] rounded-xl border p-4 shadow-xl ${toast.kind === 'PAYMENT' ? 'border-teal-500 bg-teal-50' : 'border-navy-200 bg-white'}`}>
            <div className="flex items-start justify-between gap-3">
              <div><strong className="text-navy-900">{toast.kind === 'PAYMENT' ? '💰 ' : ''}{toast.title}</strong><p className="mt-1 text-sm text-navy-800">{toast.body}</p>
                {locked && <p className="mt-2 text-sm text-amber-900">Suara belum aktif. Ketuk di mana saja pada layar sekali agar bunyi berfungsi.</p>}</div>
              <button onClick={() => setToast(null)} aria-label="Tutup" className="min-h-[36px] min-w-[36px] text-lg text-navy-700">×</button>
            </div>
            {toast.link && <button onClick={() => { const l = toast.link!; setToast(null); router.push(l); }} className="mt-2 text-sm font-semibold text-teal-700 underline underline-offset-2">Buka</button>}
          </div>
        )}
        <main key={path} className="anim-page mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">{children}</main>
        {settings && <NotifSettings onClose={() => setSettings(false)} />}
      </div>

      {pw && <ChangePassword onClose={() => setPw(false)} />}
      {needConsent && <Consent onDone={() => setNeedConsent(false)} />}
    </div>
  );
}
