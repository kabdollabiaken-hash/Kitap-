// 章节分组：有“所属部分”（卷）的书，目录显示成两级——部分名（可折叠） → 章节
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const cache = new Map();
// 返回 Map：章节ID → 部分名。没有分部、没网络、数据库还没加这一列时，都返回空的 Map
export function fetchParts(bookId) {
  if (cache.has(bookId)) return cache.get(bookId);
  const url = new URL(SUPABASE_URL + '/rest/v1/chapters');
  url.searchParams.set('select', 'id,part');
  url.searchParams.set('book_id', 'eq.' + bookId);
  url.searchParams.set('part', 'not.is.null');
  url.searchParams.set('limit', '2000');
  const p = fetch(url, { headers: { apikey: SUPABASE_KEY } })
    .then((r) => (r.ok ? r.json() : []))
    .then((rows) => new Map(rows.filter((x) => x.part && String(x.part).trim()).map((x) => [x.id, String(x.part).trim()])))
    .catch(() => new Map());
  cache.set(bookId, p);
  return p;
}
export const clearParts = (bookId) => cache.delete(bookId);

export const idFromLi = (li) => {
  const a = li.querySelector('a');
  return a ? decodeURIComponent((a.getAttribute('href') || '').split('/').pop()) : '';
};

// 把一个平铺的 <ol> 按部分分组。openId：这一章所在的部分默认展开，其余折叠
export function groupList(ol, parts, openId) {
  if (!parts || !parts.size || !ol.parentNode) return;
  const groups = [];
  for (const li of [...ol.children]) {
    const name = parts.get(idFromLi(li)) || '';
    const last = groups[groups.length - 1];
    if (last && last.name === name) last.lis.push(li); else groups.push({ name, lis: [li] });
  }
  const firstNamed = groups.find((g) => g.name);
  const frag = document.createDocumentFragment();
  for (const g of groups) {
    const list = document.createElement('ol');
    list.className = ol.className;
    g.lis.forEach((li) => list.append(li));
    if (!g.name) { frag.append(list); continue; }
    const open = openId ? g.lis.some((li) => idFromLi(li) === openId) : g === firstNamed;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.style.cssText = 'display:flex;width:100%;justify-content:space-between;align-items:center;gap:8px;padding:12px 14px;margin:10px 0 6px;border:0;border-radius:12px;background:rgba(128,128,128,.14);color:inherit;font:inherit;font-weight:700;cursor:pointer;text-align:start';
    const name = document.createElement('span');
    name.setAttribute('dir', 'auto');
    name.textContent = g.name;
    const meta = document.createElement('span');
    meta.style.cssText = 'font-weight:400;opacity:.7;white-space:nowrap';
    const paint = () => { meta.textContent = g.lis.length + ' ' + (list.hidden ? '▸' : '▾'); };
    list.hidden = !open;
    paint();
    btn.addEventListener('click', () => {
      list.hidden = !list.hidden;
      btn.setAttribute('aria-expanded', list.hidden ? 'false' : 'true');
      paint();
    });
    btn.append(name, meta);
    frag.append(btn, list);
  }
  ol.replaceWith(frag);
}
