// Service worker minimal: hanya agar aplikasi bisa dipasang (PWA) dan menampilkan halaman "offline" yang ramah.
// Sengaja TIDAK menyimpan data/API apa pun: saldo dan transaksi selalu diambil langsung dari server.
const CACHE = 'eqa-shell-v1';
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.add('/offline.html')).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => caches.match('/offline.html')));
});

// Klik pada popup notifikasi: fokuskan jendela E-QA yang sudah terbuka (atau buka yang baru) lalu pindah ke halaman terkait.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const c = list.find((x) => 'focus' in x);
    if (c) { c.postMessage({ type: 'eqa-open-link', link }); return c.focus(); }
    return self.clients.openWindow(link);
  }));
});
