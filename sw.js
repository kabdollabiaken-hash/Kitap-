// Kitap 离线外壳：网页文件优先取网络（保证更新及时），断网时用上次的缓存。
// 不缓存：接口、后台、登录回调、Supabase 数据和音频（它们是别的域名，这里根本不拦截）。
const CACHE = 'kitap-shell-v1';

self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

const SKIP = [/^\/api\//, /^\/admin(\.html)?$/, /^\/auth(\.html)?$/, /^\/sw\.js$/];

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (SKIP.some((re) => re.test(url.pathname))) return;
  if (req.headers.has('range')) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const key = req.mode === 'navigate' ? '/' : req;
    const fromNet = fetch(req).then((res) => {
      if (res && res.ok) cache.put(key, res.clone());
      return res;
    });
    const cached = await cache.match(key);
    if (!cached) return fromNet;
    // 有缓存时：网络 3.5 秒内没回应，就先用缓存（弱网也能打开）
    return Promise.race([
      fromNet.catch(() => cached),
      new Promise((resolve) => setTimeout(() => resolve(cached), 3500))
    ]);
  })());
});
