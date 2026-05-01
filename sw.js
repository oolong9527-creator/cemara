const CACHE = 'headshot-v2';
const ASSETS = [
  '/cemara/',
  '/cemara/index.html',
  '/cemara/style.css',
  '/cemara/app.js',
  '/cemara/manifest.json',
  '/cemara/icon-192.png',
  '/cemara/icon-512.png',
];

// @imgly/background-removal 需要 SharedArrayBuffer
// SharedArrayBuffer 需要頁面帶有 COOP + COEP 標頭才能啟用
// GitHub Pages 不支援自訂標頭，因此由 Service Worker 注入
function addIsolationHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const req = e.request;

  // 導覽請求（載入 HTML 頁面）：加入安全性標頭
  if (req.mode === 'navigate') {
    e.respondWith(
      caches.match(req)
        .then(cached => cached
          ? addIsolationHeaders(cached)
          : fetch(req).then(addIsolationHeaders)
        )
        .catch(() => fetch(req).then(addIsolationHeaders))
    );
    return;
  }

  // 其他資源：快取優先
  e.respondWith(
    caches.match(req).then(r => r || fetch(req))
  );
});
