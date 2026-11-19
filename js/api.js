// 读取在线书籍库（只读，使用公开 key）
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const REST = SUPABASE_URL + '/rest/v1/';
export const PAGE_SIZE = 24;
const BOOK_FIELDS = 'id,title,author,description,cover_url,category_id,language,script,text_direction,published_at,is_ongoing';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (s) => UUID.test(String(s));

async function get(path, params) {
  const url = new URL(REST + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { apikey: SUPABASE_KEY } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// ---------- 缓存：先给上次的结果（秒开），过期了就在后台刷新 ----------
// 只缓存书详情和章节目录；1 分钟内不重复请求；更老的先等最新结果 0.8 秒，来不及才先给旧的；同一个请求同时只发一次
const SWR_PREFIX = 'kitap:api:v1:';
const inflight = new Map();
const mem = new Map();
function swrRead(key) {
  if (mem.has(key)) return mem.get(key);
  try {
    const v = JSON.parse(localStorage.getItem(SWR_PREFIX + key));
    if (v && typeof v.t === 'number') { mem.set(key, v); return v; }
  } catch (e) { /* ignore */ }
  return null;
}
function swrWrite(key, data) {
  const v = { t: Date.now(), d: data };
  mem.set(key, v);
  try { localStorage.setItem(SWR_PREFIX + key, JSON.stringify(v)); } catch (e) { /* 存不下就只放内存 */ }
}
function swr(key, fetcher) {
  const hit = swrRead(key);
  const refresh = () => {
    if (inflight.has(key)) return inflight.get(key);
    const p = fetcher().then((data) => { if (data != null) swrWrite(key, data); return data; })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };
  // 没缓存，或缓存是空的（0 章、空目录）：一定等最新结果，不能拿旧的空数据糊弄
  const empty = hit && (hit.d == null || (Array.isArray(hit.d) && hit.d.length === 0));
  if (!hit || empty) return refresh();
  // 1 分钟内的缓存直接用；更老的：先等最新结果 0.8 秒，来不及才先给旧的（新的在后台继续更新缓存）
  if (Date.now() - hit.t < 60 * 1000) return Promise.resolve(hit.d);
  const fresh = refresh();
  return Promise.race([
    fresh.catch(() => hit.d),
    new Promise((res) => setTimeout(() => res(hit.d), 800))
  ]);
}

// 同时取回“总数”：用 Prefer: count=exact，从 Content-Range 里读出 “0-23/24”
async function getWithCount(path, params) {
  const url = new URL(REST + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { apikey: SUPABASE_KEY, Prefer: 'count=exact' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const rows = await r.json();
  const m = /\/(\d+)$/.exec(r.headers.get('content-range') || '');
  return { rows, total: m ? parseInt(m[1], 10) : rows.length };
}

// 书库排序：mix 推荐的在前再按新旧；new 最新上架；title 按书名
const SORTS = {
  mix: 'is_featured.desc,published_at.desc.nullslast,created_at.desc',
  new: 'published_at.desc.nullslast,created_at.desc',
  title: 'title.asc'
};

let catCache = null;
export async function getCategories() {
  if (!catCache) {
    catCache = await get('categories', { select: 'id,slug,name,sort_order', order: 'sort_order.asc' });
  }
  return catCache;
}

// 搜索词转成安全的 ilike 模式：转义 LIKE 通配符，并用引号包住
// 只读取、比较原文，不转换任何文字
function likeTerm(term) {
  const esc = term.replace(/[\\%_]/g, (m) => '\\' + m);
  return '"*' + esc.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '*"';
}

export async function listBooks({ q, categorySlug, page = 1, pageSize = PAGE_SIZE, featured = false, done = false, sort = 'new', language = '', script = '' } = {}) {
  const params = {
    select: BOOK_FIELDS,
    status: 'eq.published',
    order: SORTS[sort] || SORTS.new,
    limit: String(pageSize + 1), // 多取一条，用来判断有没有下一页
    offset: String((page - 1) * pageSize)
  };
  if (featured) params.is_featured = 'eq.true';
  if (language) params.language = 'eq.' + language;
  if (script) params.script = 'eq.' + script;
  if (done) params.is_ongoing = 'eq.false'; // 已完结：没有标“更新中”的书
  if (q) {
    const p = likeTerm(q);
    params.or = '(title.ilike.' + p + ',author.ilike.' + p + ')';
  }
  if (categorySlug) {
    const cats = await getCategories();
    const c = cats.find((x) => x.slug === categorySlug);
    if (!c) return { items: [], hasNext: false };
    params.category_id = 'eq.' + c.id;
  }
  const { rows, total } = await getWithCount('books', params);
  return { items: rows.slice(0, pageSize), hasNext: rows.length > pageSize, total };
}

// 单本书详情；不存在或未发布返回 null（null 不缓存）
export async function getBook(id) {
  if (!isUuid(id)) return null;
  return swr('book:' + id, async () => {
    const rows = await get('books', {
      select: BOOK_FIELDS + ',copyright_note',
      id: 'eq.' + id,
      status: 'eq.published',
      limit: '1'
    });
    return rows[0] || null;
  });
}

// 章节目录：只取编号和标题，不取正文
export function getChapterList(bookId) {
  return swr('chapters:' + bookId, () => get('chapters', {
    select: 'id,chapter_number,title,language,script',
    book_id: 'eq.' + bookId,
    order: 'chapter_number.asc'
  }));
}

// 点书之前先悄悄取好详情和目录（手指一按下就开始）
export function prefetchBook(id) {
  if (!isUuid(id)) return;
  getBook(id).catch(() => {});
  getChapterList(id).catch(() => {});
}

// 书籍实际语言+文字体系 -> HTML lang 标签（用于选择字体和方向，不转换文字）
const TAGS = {
  'kk|cyrillic': 'kk-Cyrl',
  'kk|latin': 'kk-Latn',
  'kk|arabic': 'kk-Arab',
  'ru|cyrillic': 'ru',
  'zh|han': 'zh',
  'en|latin': 'en'
};
export function langTag(b) { return TAGS[b.language + '|' + b.script] || b.language; }
