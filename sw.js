// Oflayn ishlash uchun: ilova fayllari keshda saqlanadi.
const CACHE = 'jadval-baza-v25';
const FILES = [
  './', 'index.html', 'css/style.css', 'js/app.js', 'js/match.js', 'js/xlsxfill.js', 'js/xlsxwrite.js', 'js/filters.js', 'js/sync.js', 'js/translit.js', 'js/spell.js', 'js/edit.js', 'js/dashboard.js', 'js/attendance.js',
  'vendor/xlsx.full.min.js', 'vendor/jszip.min.js', 'manifest.webmanifest', 'icon.svg',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' }))))
    .catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Avval tarmoqdan (yangi versiya bo'lsa olinadi), internet bo'lmasa — keshdan.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    // cache: 'no-cache' — brauzerning HTTP keshidan eski faylni olmaslik uchun har safar tekshiriladi
    fetch(e.request, { cache: 'no-cache' }).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
