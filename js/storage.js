// 本机存储模块：书架、最近阅读、阅读进度、偏好
// 所有书名、作者原样保存，不做任何修改。
const PREFIX = 'kitap:v1:';
const SCHEMA_VERSION = 1;
const memory = new Map();
let ls = null;

try {
  ls = window.localStorage;
  const probe = PREFIX + '__probe';
  ls.setItem(probe, '1');
  ls.removeItem(probe);
} catch (e) {
  ls = null; // 隐私模式等情况：退回内存存储，刷新后丢失
}

function readRaw(key) {
  try {
    if (ls) return ls.getItem(PREFIX + key);
    return memory.has(key) ? memory.get(key) : null;
  } catch (e) { return null; }
}
function writeRaw(key, val) {
  try {
    if (ls) { ls.setItem(PREFIX + key, val); return true; }
  } catch (e) { /* 空间不足等 */ }
  memory.set(key, val);
  return false;
}
function removeRaw(key) {
  try { if (ls) ls.removeItem(PREFIX + key); } catch (e) { /* ignore */ }
  memory.delete(key);
}

function read(key, fallback, validate) {
  const raw = readRaw(key);
  if (raw === null) return fallback;
  try {
    const v = JSON.parse(raw);
    if (validate && !validate(v)) throw new Error('invalid');
    return v;
  } catch (e) {
    removeRaw(key); // 损坏的数据直接丢弃，回到默认值
    return fallback;
  }
}
function write(key, val) { return writeRaw(key, JSON.stringify(val)); }

// ---- 版本检查（以后升级数据结构时在这里迁移）----
(function checkMeta() {
  const meta = read('meta', null, (v) => v && typeof v.v === 'number');
  if (!meta) write('meta', { v: SCHEMA_VERSION });
})();

// ---- 偏好 ----
const DEFAULT_PREFS = { lang: 'kk', theme: 'white', fontSize: 20, lineHeight: 1.9, margin: 'normal' };
const THEMES = ['white', 'sepia', 'green', 'night'];
const MARGINS = ['narrow', 'normal', 'wide'];

function sanitizePrefs(p) {
  const o = { ...DEFAULT_PREFS };
  if (p && typeof p === 'object') {
    if (['kk', 'ru', 'zh', 'en'].includes(p.lang)) o.lang = p.lang;
    if (THEMES.includes(p.theme)) o.theme = p.theme;
    if (Number.isFinite(p.fontSize)) o.fontSize = Math.min(32, Math.max(14, p.fontSize));
    if (Number.isFinite(p.lineHeight)) o.lineHeight = Math.min(2.6, Math.max(1.4, p.lineHeight));
    if (MARGINS.includes(p.margin)) o.margin = p.margin;
  }
  return o;
}

// ---- 数组/对象校验 ----
const isArr = (v) => Array.isArray(v);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const cleanBook = (b) => b && typeof b.bookId === 'string' && typeof b.title === 'string';

export const storage = {
  isPersistent() { return ls !== null; },

  getPrefs() { return sanitizePrefs(read('prefs', null)); },
  setPrefs(patch) {
    const next = sanitizePrefs({ ...this.getPrefs(), ...patch });
    write('prefs', next);
    return next;
  },

  // 书架：保存书籍 ID，以及书名/作者/封面/语言/文字体系的快照
  getShelf() { return read('shelf', [], isArr).filter(cleanBook); },
  isInShelf(bookId) { return this.getShelf().some((b) => b.bookId === bookId); },
  addToShelf({ id, title, author, cover_url, language, script }) {
    const shelf = this.getShelf();
    if (shelf.some((b) => b.bookId === id)) return;
    shelf.unshift({
      bookId: id,
      title,
      author: author || '',
      cover_url: cover_url || null,
      language: language || null,
      script: script || null,
      addedAt: Date.now()
    });
    write('shelf', shelf);
  },
  removeFromShelf(bookId) {
    write('shelf', this.getShelf().filter((b) => b.bookId !== bookId));
  },
  removeManyFromShelf(bookIds) {
    const set = new Set(bookIds);
    write('shelf', this.getShelf().filter((b) => !set.has(b.bookId)));
  },

  // 最近阅读：最新的在前，最多 20 本
  getRecent() { return read('recent', [], isArr).filter(cleanBook); },
  addRecent({ bookId, chapterId, title, author }) {
    const list = this.getRecent().filter((b) => b.bookId !== bookId);
    list.unshift({ bookId, chapterId: chapterId || null, title, author: author || '', ts: Date.now() });
    write('recent', list.slice(0, 20));
  },

  // 阅读进度：章节 ID + 章节内滚动比例（0~1）
  getProgress(bookId) {
    const all = read('progress', {}, isObj);
    const p = all[bookId];
    if (!p || typeof p.chapterId !== 'string' || !Number.isFinite(p.ratio)) return null;
    return p;
  },
  setProgress(bookId, chapterId, ratio) {
    const all = read('progress', {}, isObj);
    all[bookId] = { chapterId, ratio: Math.min(1, Math.max(0, ratio)), ts: Date.now() };
    write('progress', all);
  }
};
