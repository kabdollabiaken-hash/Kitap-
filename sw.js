// Shuhyla service worker：让应用外壳（页面、脚本、样式、字体、封面）没网时也能打开
// 页面和脚本：网络优先（有网永远拿最新版），没网才用缓存；字体和图片：缓存优先
const CACHE = 'kitap-shell-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/') || url.hostname.endsWith('.supabase.co') && url.pathname.startsWith('/rest/')) return; // 数据请求不拦截
  const same = url.origin === self.location.origin;
  const asset = req.destination === 'image' || req.destination === 'font' || req.destination === 'style' && !same;

  if (asset) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((r) => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (same) {
    e.respondWith(fetch(req).then((r) => {
      if (r && r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return r;
    }).catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('/').then((x) => x || caches.match('/index.html')) : undefined))));
  }
});
