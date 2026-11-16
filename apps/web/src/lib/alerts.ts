'use client';
/** Popup notifikasi dari browser (muncul walau tab sedang tidak dilihat). Hanya jalan selama aplikasi masih terbuka di browser. */
const LS_POPUP = 'eqa.popup';
export const popupSupported = () => typeof window !== 'undefined' && 'Notification' in window;
export const popupPermission = (): NotificationPermission | 'unsupported' => (popupSupported() ? Notification.permission : 'unsupported');
export const popupOn = () => { try { return localStorage.getItem(LS_POPUP) !== '0'; } catch { return true; } };
export const setPopupOn = (v: boolean) => { try { localStorage.setItem(LS_POPUP, v ? '1' : '0'); } catch { /* abaikan */ } };
/** Harus dipanggil dari klik pengguna. */
export async function askPopupPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!popupSupported()) return 'unsupported';
  try { return await Notification.requestPermission(); } catch { return Notification.permission; }
}
export const openLinkEvent = 'eqa-open-link';

/** Tampilkan popup. Android Chrome melarang `new Notification`, jadi memakai service worker bila ada. */
export async function showPopup(title: string, body: string, tag: string, link: string | null): Promise<boolean> {
  if (!popupSupported() || Notification.permission !== 'granted' || !popupOn()) return false;
  const opts: NotificationOptions = { body, tag, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { link } };
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) { await reg.showNotification(title, opts); return true; }
  } catch { /* coba cara biasa */ }
  try {
    const n = new Notification(title, opts);
    n.onclick = () => { window.focus(); if (link) window.dispatchEvent(new CustomEvent(openLinkEvent, { detail: link })); n.close(); };
    return true;
  } catch { return false; }
}
