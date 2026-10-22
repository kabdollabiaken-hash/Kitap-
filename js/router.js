// 基于 # 的路由，例如 #/library?q=abc、#/book/<id>
const routes = [
  { name: 'home', pattern: /^\/$/, keys: [] },
  { name: 'library', pattern: /^\/library$/, keys: [] },
  { name: 'shelf', pattern: /^\/shelf$/, keys: [] },
  { name: 'me', pattern: /^\/me$/, keys: [] },
  { name: 'book', pattern: /^\/book\/([^/]+)$/, keys: ['id'] },
  { name: 'read', pattern: /^\/read\/([^/]+)(?:\/([^/]+))?$/, keys: ['bookId', 'chapterId'] },
  { name: 'dev', pattern: /^\/dev$/, keys: [] }
];

export function parseHash(hash = location.hash) {
  const h = hash.replace(/^#/, '') || '/';
  const qi = h.indexOf('?');
  const path = (qi >= 0 ? h.slice(0, qi) : h) || '/';
  const query = {};
  if (qi >= 0) new URLSearchParams(h.slice(qi + 1)).forEach((v, k) => { query[k] = v; });

  for (const r of routes) {
    const m = path.match(r.pattern);
    if (!m) continue;
    try {
      const params = {};
      r.keys.forEach((k, i) => { if (m[i + 1] !== undefined) params[k] = decodeURIComponent(m[i + 1]); });
      return { name: r.name, params, query };
    } catch (e) {
      break; // 编码损坏 -> 当作找不到页面
    }
  }
  return { name: 'notfound', params: {}, query };
}

export function navigate(path) { location.hash = '#' + path; }

export function onRouteChange(cb) {
  window.addEventListener('hashchange', () => cb(parseHash()));
  cb(parseHash());
}
