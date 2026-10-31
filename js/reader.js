// 阅读器：正文原样显示，不转换任何文字
// 三种翻页方式：仿真翻页（curl）、左右滑动（slide）、上下滚动（scroll）
import { t } from './i18n.js';
import './messages-reader.js';
import './messages-paging.js';
import { storage } from './storage.js';
import { getBook, getChapterList, langTag, isUuid } from './api.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { h, enc } from './ui.js';
import { createAudio } from './audio.js';
import { createMarkUI } from './notes.js';

if (!document.querySelector('link[data-paging]')) {
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = './css/paging.css';
  l.setAttribute('data-paging', '1');
  document.head.appendChild(l);
}

const BG = { white: '#ffffff', sepia: '#f5edd8', green: '#e0efe3', night: '#17191c' };
const THEMES = ['white', 'sepia', 'green', 'night'];
const MARGINS = ['narrow', 'normal', 'wide'];
const MARGIN_PX = { narrow: 12, normal: 24, wide: 48 };
const MODES = ['curl', 'slide', 'scroll'];
const PAGE_GAP = 48;
const PAD_TOP = 14;
const PAD_BOTTOM = 26;

let active = null; // 当前阅读器的清理函数（保存进度、移除监听）
let gotoLast = null; // 从下一章“往回翻”到上一章时，直接打开上一章的最后一页
export function leaveReader() {
  if (active) { const fn = active; active = null; fn(); }
}

async function getChapter(bookId, chapterId) {
  const url = new URL(SUPABASE_URL + '/rest/v1/chapters');
  url.searchParams.set('select', 'id,book_id,chapter_number,title,content,content_sha256,language,script,text_direction,audio_path,audio_seconds');
  url.searchParams.set('id', 'eq.' + chapterId);
  url.searchParams.set('book_id', 'eq.' + bookId);
  url.searchParams.set('limit', '1');
  let r = await fetch(url, { headers: { apikey: SUPABASE_KEY } });
  if (!r.ok) { // 数据库还没加音频字段时，退回不带音频的查询
    url.searchParams.set('select', 'id,book_id,chapter_number,title,content,content_sha256,language,script,text_direction');
    r = await fetch(url, { headers: { apikey: SUPABASE_KEY } });
  }
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const rows = await r.json();
  return rows[0] || null;
}

// ---------- 缓存：翻到下一章时不用再等网络 ----------
const TTL = 5 * 60 * 1000;
const bookCache = new Map(); // bookId -> { ts, book, chapters }
const chCache = new Map(); // chapterId -> { ts, row }
const chPending = new Map();
const fresh = (e) => e && Date.now() - e.ts < TTL;

async function getBookData(bookId) {
  const e = bookCache.get(bookId);
  if (fresh(e)) return e;
  const book = await getBook(bookId);
  if (!book) return { book: null, chapters: [] };
  const chapters = await getChapterList(book.id);
  const v = { ts: Date.now(), book, chapters };
  bookCache.set(bookId, v);
  return v;
}

function getChapterCached(bookId, chapterId) {
  const e = chCache.get(chapterId);
  if (fresh(e)) return Promise.resolve(e.row);
  if (chPending.has(chapterId)) return chPending.get(chapterId);
  const p = getChapter(bookId, chapterId).then((row) => {
    if (row) {
      chCache.set(chapterId, { ts: Date.now(), row });
      while (chCache.size > 8) chCache.delete(chCache.keys().next().value);
    }
    return row;
  }).finally(() => { chPending.delete(chapterId); });
  chPending.set(chapterId, p);
  return p;
}

// 每一章的字数（数据库里的 char_count 字段）：用来算“整本书”的进度和总页数
async function getChapterLengths(bookId) {
  try {
    const url = new URL(SUPABASE_URL + '/rest/v1/chapters');
    url.searchParams.set('select', 'id,char_count');
    url.searchParams.set('book_id', 'eq.' + bookId);
    url.searchParams.set('limit', '5000');
    const r = await fetch(url, { headers: { apikey: SUPABASE_KEY } });
    if (!r.ok) return null;
    const rows = await r.json();
    const m = new Map();
    for (const x of rows) { if (!Number.isFinite(x.char_count)) return null; m.set(x.id, x.char_count); }
    return m;
  } catch (e) { return null; }
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 图标是固定的静态 SVG
function ico(inner) {
  const s = document.createElement('span');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
  return s;
}

const nextFrame = () => new Promise((res) => requestAnimationFrame(() => res()));

// ---------- 分页：数出一章一共有几页 ----------
function countPages(flow, W, rtl) {
  const stride = W + PAGE_GAP;
  const fr = flow.getBoundingClientRect();
  const last = flow.lastElementChild;
  let max = 0;
  if (last) {
    for (const r of last.getClientRects()) {
      if (r.width === 0 && r.height === 0) continue;
      const d = rtl ? fr.right - r.right : r.left - fr.left;
      max = Math.max(max, Math.floor((d + 2) / stride));
    }
  }
  return max + 1;
}

// ---------- 仿真翻页的几何：沿折痕把页面分成两块 ----------
// 保留 (X-M)·n 同号（sign=1 取 >=0，sign=-1 取 <=0）的那一半
function clipPoly(poly, M, n, sign) {
  const out = [];
  const f = (p) => ((p.x - M.x) * n.x + (p.y - M.y) * n.y) * sign;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const fa = f(a);
    const fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const k = fa / (fa - fb);
      out.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
    }
  }
  return out;
}
const polyCss = (poly) => (poly.length < 3 ? 'polygon(0 0,0 0,0 0)'
  : 'polygon(' + poly.map((p) => p.x.toFixed(1) + 'px ' + p.y.toFixed(1) + 'px').join(',') + ')');

// ---------- 翻页引擎 ----------
function createPager(o) {
  const { stage, A, B, num, W, rtl, mode } = o;
  const stride = W + PAGE_GAP;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const anim = o.anim && !reduce;
  let cur = 0;
  let busy = false;
  let raf = 0;
  let drag = null;

  // 仿真翻页用到的三个元素：翻起来的纸背面、折痕处的阴影
  const flap = h('div', { class: 'pg-flap' });
  const flapWrap = h('div', { class: 'pg-flapwrap' }, flap);
  const sdw = h('div', { class: 'pg-sdw' });
  const usd = h('div', { class: 'pg-usd' });
  if (mode === 'curl') stage.append(usd, sdw, flapWrap);
  const hideCurl = () => { flapWrap.style.display = 'none'; sdw.style.display = 'none'; usd.style.display = 'none'; };

  A.flow.style.transform = 'none';
  const pages = countPages(A.flow, W, rtl);
  cur = o.atLast ? pages - 1 : Math.min(pages - 1, Math.max(0, Math.round(o.ratio * (pages - 1))));

  const relabel = () => { num.textContent = o.label ? o.label(cur, pages) : (cur + 1) + ' / ' + pages; };
  const place = (L, p) => { L.flow.style.transform = 'translateX(' + ((rtl ? 1 : -1) * p * stride) + 'px)'; };
  const rest = () => {
    place(A, cur);
    A.layer.style.transform = '';
    A.layer.style.clipPath = '';
    B.layer.style.clipPath = '';
    hideCurl();
    A.layer.style.zIndex = '2';
    A.shade.style.opacity = '0';
    B.layer.style.visibility = 'hidden';
    B.layer.style.transform = '';
    B.shade.style.opacity = '0';
    relabel();
  };

  // top：正在翻的那一层；t：翻开的程度 0（盖住）~1（翻走）
  const curl = (top, under, tt, s) => {
    const SW = stage.clientWidth;
    const SH = stage.clientHeight;
    if (tt <= 0.003) { top.layer.style.clipPath = ''; hideCurl(); return; }
    const right = s.side === 'right';
    const bottom = s.vert !== 'top';
    const C = { x: right ? SW : 0, y: bottom ? SH : 0 };
    const k = Math.min(1, tt);
    // 手指（卷角的尖）的位置：横向走过整个页面，纵向先抬起再落下，折痕因此是斜的
    const P = { x: C.x + (right ? -1 : 1) * 2.06 * SW * k, y: C.y + (bottom ? -1 : 1) * 0.30 * SH * Math.sin(Math.PI * k) };
    const dx = P.x - C.x;
    const dy = P.y - C.y;
    const len = Math.hypot(dx, dy) || 1;
    const n = { x: dx / len, y: dy / len };
    const M = { x: (C.x + P.x) / 2, y: (C.y + P.y) / 2 };
    const rect = [{ x: 0, y: 0 }, { x: SW, y: 0 }, { x: SW, y: SH }, { x: 0, y: SH }];
    const flat = clipPoly(rect, M, n, 1); // 还平躺着的那部分
    const cs = clipPoly(rect, M, n, -1); // 被卷起来的那部分（含翻角）
    top.layer.style.clipPath = polyCss(flat);

    const L = Math.abs(SW * n.x) + Math.abs(SH * n.y); // 渐变线长度
    const grad = (dirx, diry, stops) => { // 方向 (dirx,diry)，从折痕出发
      const theta = Math.atan2(dirx, -diry);
      const tc = (SW / 2 - M.x) * dirx + (SH / 2 - M.y) * diry;
      const s0 = L / 2 - tc;
      return 'linear-gradient(' + (theta * 180 / Math.PI).toFixed(2) + 'deg,' + stops.map(([c, d]) => c + ' ' + (s0 + d).toFixed(1) + 'px').join(',') + ')';
    };

    if (cs.length >= 3) {
      flapWrap.style.display = 'block';
      const dot = M.x * n.x + M.y * n.y;
      flap.style.clipPath = polyCss(cs);
      flap.style.transform = 'matrix(' + [1 - 2 * n.x * n.x, -2 * n.x * n.y, -2 * n.x * n.y, 1 - 2 * n.y * n.y, 2 * dot * n.x, 2 * dot * n.y].map((v) => v.toFixed(5)).join(',') + ')';
      // 纸背面：折痕处最深，往外渐渐变亮
      flap.style.backgroundImage = grad(-n.x, -n.y, [['rgba(0,0,0,.34)', 0], ['rgba(0,0,0,.10)', 34], ['rgba(255,255,255,.10)', 150], ['rgba(0,0,0,.04)', 400]]);
      usd.style.display = 'block';
      usd.style.clipPath = polyCss(cs);
      usd.style.backgroundImage = grad(-n.x, -n.y, [['rgba(0,0,0,.30)', 0], ['rgba(0,0,0,0)', 70]]);
    } else { flapWrap.style.display = 'none'; usd.style.display = 'none'; }
    if (flat.length >= 3) {
      sdw.style.display = 'block';
      sdw.style.clipPath = polyCss(flat);
      sdw.style.backgroundImage = grad(n.x, n.y, [['rgba(0,0,0,.26)', 0], ['rgba(0,0,0,0)', 90]]);
    } else sdw.style.display = 'none';
    top.shade.style.opacity = '0';
    under.shade.style.opacity = '0';
  };
  const apply = (top, under, tt, s) => {
    if (mode === 'curl') {
      curl(top, under, tt, s);
    } else {
      top.layer.style.transform = 'translateX(' + ((rtl ? 1 : -1) * tt * 100) + '%)';
      top.shade.style.opacity = '0';
      under.shade.style.opacity = String((1 - tt) * 0.2);
    }
  };

  const begin = (fwd, vert) => {
    const target = cur + (fwd ? 1 : -1);
    if (target < 0 || target >= pages) return null;
    if (B.fill) B.fill();
    const top = fwd ? A : B;
    const under = fwd ? B : A;
    place(B, target);
    B.layer.style.visibility = 'visible';
    top.layer.style.zIndex = '3';
    under.layer.style.zIndex = '1';
    return { fwd, target, top, under, vert: vert || 'bottom', side: rtl ? 'left' : 'right' }; // 往回翻 = 往前翻的倒放：卷角始终在“翻页那一侧”，上一页从左边卷着铺回来
  };
  const setP = (s, p) => apply(s.top, s.under, s.fwd ? p : 1 - p, s);
  const finish = (s, done) => {
    if (done) cur = s.target;
    rest();
    busy = false;
    if (done) o.onPage();
  };
  const run = (s, from, to) => {
    if (!anim) { setP(s, to); finish(s, to === 1); return; }
    const t0 = performance.now();
    const dur = Math.max(140, 340 * Math.abs(to - from));
    const step = (now) => {
      const k = Math.min(1, Math.max(0, (now - t0) / dur));
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      setP(s, from + (to - from) * e);
      if (k < 1) raf = requestAnimationFrame(step); else finish(s, to === 1);
    };
    raf = requestAnimationFrame(step);
  };
  const flip = (fwd, vert) => {
    if (busy || drag) return;
    const s = begin(fwd, vert);
    if (!s) { o.onEdge(fwd); return; }
    busy = true;
    setP(s, 0);
    run(s, 0, 1);
  };

  // ---- 手势：轻点（左侧上一页，其余下一页；从右往左的书相反）和拖动翻页 ----
  const vertOf = (y) => {
    const r = stage.getBoundingClientRect();
    return y - r.top < r.height / 2 ? 'top' : 'bottom';
  };
  const tap = (x, y) => {
    const r = stage.getBoundingClientRect();
    const f = (x - r.left) / r.width;
    const back = rtl ? f > 0.7 : f < 0.3;
    flip(!back, vertOf(y));
  };
  const forwardDx = (dx) => (rtl ? dx : -dx);
  stage.addEventListener('pointerdown', (e) => {
    if (busy || drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag = { x: e.clientX, y: e.clientY, t: performance.now(), mode: 0, s: null, p: 0, fwd: true };
    if (e.pointerType !== 'mouse') { try { stage.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    // 鼠标拖动 = 选字；手指按住不动超过半秒 = 长按选字：都不翻页
    if (e.pointerType === 'mouse') {
      if (drag.mode === 0 && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) drag.mode = -1;
      return;
    }
    if (!drag.mode && performance.now() - drag.t > 450) { drag.mode = -1; return; }
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.mode) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        drag.mode = 1;
        drag.fwd = forwardDx(dx) > 0;
        drag.s = begin(drag.fwd, vertOf(drag.y));
      } else if (Math.abs(dy) > 10) { drag.mode = -1; return; } else return;
    }
    if (drag.mode !== 1) return;
    const mag = forwardDx(dx) * (drag.fwd ? 1 : -1);
    drag.p = Math.max(0, Math.min(1, mag / (W * 0.85)));
    if (drag.s) setP(drag.s, drag.p);
  });
  const end = (e, cancelled) => {
    const d = drag;
    drag = null;
    if (!d) return;
    if (d.mode === 0) {
      // 长按（选字）不算轻点；点在划线上或有选中文字时，先交给划线工具条处理
      if (!cancelled && performance.now() - d.t < 450 && !(o.onTap && o.onTap(e.clientX, e.clientY))) tap(e.clientX, e.clientY);
      return;
    }
    if (d.mode !== 1) return;
    if (!d.s) { if (!cancelled && d.p > 0.25) o.onEdge(d.fwd); return; }
    const v = (d.p * W * 0.85) / Math.max(1, performance.now() - d.t);
    busy = true;
    run(d.s, d.p, !cancelled && (d.p > 0.3 || v > 0.5) ? 1 : 0);
  };
  stage.addEventListener('pointerup', (e) => end(e, false));
  stage.addEventListener('pointercancel', (e) => end(e, true));

  rest();
  return {
    pages,
    ratio: () => (pages > 1 ? cur / (pages - 1) : 0),
    prog: () => (pages > 1 ? cur / (pages - 1) : 1),
    flip,
    relabel,
    go(p) { // 直接跳到某一页（从“我的笔记”点进来时用）
      if (busy || drag) return;
      cur = Math.max(0, Math.min(pages - 1, p));
      rest();
      o.onPage();
    },
    pageOf(el) { // 某个元素在第几页
      const fr = A.flow.getBoundingClientRect();
      const r = el.getClientRects()[0];
      if (!r) return -1;
      const d = rtl ? fr.right - r.right : r.left - fr.left;
      return Math.max(0, Math.floor((d + 2) / stride));
    },
    key(e) {
      const k = e.key;
      if (k === 'ArrowRight') flip(!rtl);
      else if (k === 'ArrowLeft') flip(rtl);
      else if (k === 'PageDown' || k === ' ') flip(true);
      else if (k === 'PageUp') flip(false);
      else return false;
      e.preventDefault();
      return true;
    },
    destroy() { cancelAnimationFrame(raf); }
  };
}

export function viewReader(params) {
  const bookId = params.bookId;
  const chapterId = params.chapterId || '';
  const root = h('div', { class: 'rd rd-white' });
  let prefs = storage.getPrefs();
  let disposed = false;
  let ready = false;
  let timer = null;
  let saveNow = null;
  let pager = null;
  let audioCtl = null;
  let marksUI = null;
  const listeners = [];
  const listen = (tg, ev, fn, opt) => { tg.addEventListener(ev, fn, opt); listeners.push([tg, ev, fn, opt]); };

  active = () => {
    disposed = true;
    clearTimeout(timer);
    if (saveNow) saveNow();
    if (pager) pager.destroy();
    if (audioCtl) audioCtl.destroy();
    if (marksUI) marksUI.destroy();
    listeners.forEach(([tg, ev, fn, opt]) => tg.removeEventListener(ev, fn, opt));
    document.body.classList.remove('reading');
    document.body.classList.remove('rd-lock');
    document.body.style.background = '';
  };
  document.body.classList.add('reading');

  const applyPrefs = () => {
    root.classList.remove('rd-white', 'rd-sepia', 'rd-green', 'rd-night');
    root.classList.add('rd-' + prefs.theme);
    root.style.setProperty('--rd-size', prefs.fontSize + 'px');
    root.style.setProperty('--rd-lh', String(prefs.lineHeight));
    root.style.setProperty('--rd-pad', MARGIN_PX[prefs.margin] + 'px');
    document.body.style.background = BG[prefs.theme];
  };
  applyPrefs();

  // ---- 滚动模式的位置：用“章节内滚动比例”，不依赖字符索引 ----
  const maxScroll = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const rawRatio = () => { const m = maxScroll(); return m <= 4 ? 0 : Math.min(1, Math.max(0, window.scrollY / m)); };
  const progressRatio = () => (maxScroll() <= 4 ? 1 : rawRatio()); // 一屏就能读完的章节，视为已读完
  const scrollToRatio = (r) => window.scrollTo(0, r * maxScroll());

  // 当前位置（0~1）：两种模式通用
  let getRaw = rawRatio;
  let getProg = progressRatio;

  const mount = (...nodes) => root.replaceChildren(...nodes);
  const message = (key, withRetry) => h('div', { class: 'rd-msg' },
    h('p', {}, t(key)),
    withRetry ? h('button', { class: 'rd-btn', type: 'button', onclick: () => load() }, t('common.retry')) : null,
    h('a', { class: 'rd-btn', href: '#/library' }, t('book.toLibrary')));

  const makeSheet = (title, content) => {
    const el = h('div', { class: 'rd-sheet', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'rd-scrim', onclick: () => { el.hidden = true; } }),
      h('div', { class: 'rd-card' },
        h('div', { class: 'rd-card-h' },
          h('strong', {}, title),
          h('button', { class: 'rd-ico', type: 'button', 'aria-label': t('reader.close'), onclick: () => { el.hidden = true; } }, '✕')),
        content));
    return el;
  };
  const openSheet = (el) => { el.hidden = false; const b = el.querySelector('button'); if (b) b.focus(); };

  const build = async (book, chapters, idx, chapter) => {
    if (disposed) return;
    const bookTag = langTag(book);
    const tag = langTag({ language: chapter.language || book.language, script: chapter.script || book.script });
    const dirMode = chapter.text_direction || book.text_direction || 'auto';
    const rtl = dirMode === 'rtl'; // 从右往左的书：翻页方向也反过来

    storage.addRecent({ bookId: book.id, chapterId: chapter.id, title: book.title, author: book.author });
    document.title = book.title;

    // 原文完整性：浏览器重新计算正文哈希，与数据库记录对比
    let integrityBad = false;
    if (chapter.content_sha256) {
      const digest = await sha256(chapter.content);
      integrityBad = digest !== chapter.content_sha256;
    }
    if (disposed) return;

    // 按空行分段；段内换行原样保留（pre-wrap）；每段按实际文字确定方向
    // 每段记下它在整章正文里的起始位置（划线要靠它定位）
    const blocks = [];
    {
      const src = chapter.content;
      const re = /\r?\n(?:[ \t]*\r?\n)+/g;
      let pos = 0;
      let mm;
      const push = (s, e) => { const tx = src.slice(s, e); if (tx.trim() !== '') blocks.push({ text: tx, start: s }); };
      while ((mm = re.exec(src))) { push(pos, mm.index); pos = mm.index + mm[0].length; }
      push(pos, src.length);
    }
    const showCopyright = book.copyright_note && !String(book.copyright_note).startsWith('__');

    // 划线和想法
    let layers = null; // 分页模式：[A, B] 两层
    let dirty = false;
    const ui = createMarkUI({ root, book, chapter, onChange: () => repaint() });
    marksUI = ui;
    const repaint = () => { // 划线变了：原地重画正文（排版不变，所以页数和位置都不变）
      if (disposed) return;
      if (!ready) { dirty = true; return; }
      if (prefs.pageMode === 'scroll') {
        const art = host.querySelector('.rd-body');
        if (art) art.replaceChildren(...flowNodes());
      } else if (layers) {
        layers.forEach((L) => { if (L.filled) L.flow.replaceChildren(...flowNodes()); });
      }
    };

  const flowNodes = () => [
  integrityBad ? h('div', { class: 'rd-warn', role: 'alert' }, t('reader.integrity')) : null,
  h('h1', { class: 'rd-h', dir: 'auto', style: 'text-align:center' }, chapter.title),
  blocks.map((b) => h('p', { class: 'rd-p', dir: dirMode, 'data-s': String(b.start) }, ui.paragraph(b.text, b.start))),
  showCopyright ? h('div', { class: 'rd-note' }, t('book.copyright') + ': ', h('span', { dir: 'auto' }, book.copyright_note)) : null
  ].flat(Infinity).filter(Boolean);

    // ---- 进度条 ----
    const fill = h('div', { class: 'rd-fill' });
    const pct = h('span', { class: 'rd-pct' }, '0%');
    // 整本书的进度：按字数算（拿不到字数时，退回按章节数算）
    const chapChars = chapter.content.length;
    let bookInfo = null; // { before: 前面章节的字数, total: 全书字数 }
    const updateBar = () => {
      const frac = bookInfo
        ? (bookInfo.before + getProg() * chapChars) / Math.max(1, bookInfo.total)
        : (idx + getProg()) / chapters.length;
      const total = Math.min(100, Math.max(0, Math.round(frac * 100)));
      fill.style.width = total + '%';
      pct.textContent = total + '%';
    };
    // 整本书的页码：每页大约多少字，按当前章节实际分出的页数估算
    const labelFor = (cur, pages) => {
      if (!bookInfo) return (cur + 1) + ' / ' + pages;
      const cpp = Math.max(1, chapChars) / pages;
      const totalPages = Math.max(1, Math.round(bookInfo.total / cpp));
      const page = Math.min(totalPages, Math.round(bookInfo.before / cpp) + cur + 1);
      return page + ' / ' + totalPages;
    };
    getChapterLengths(book.id).then((lens) => {
      if (disposed || !lens) return;
      let before = 0; let total = 0;
      chapters.forEach((c, i) => {
        const n = c.id === chapter.id ? chapChars : (lens.get(c.id) || 0);
        if (i < idx) before += n;
        total += n;
      });
      if (total <= 0) return;
      bookInfo = { before, total };
      updateBar();
      if (pager && pager.relabel) pager.relabel();
    });

    // ---- 上一章 / 下一章 ----
    const chapterLink = (c, key) => (c
      ? h('a', { class: 'rd-btn', href: '#/read/' + enc(book.id) + '/' + enc(c.id) }, t(key))
      : h('span', { class: 'rd-btn off', 'aria-disabled': 'true' }, t(key)));
    const prevEl = chapterLink(chapters[idx - 1], 'reader.prev');
    const nextEl = chapterLink(chapters[idx + 1], 'reader.next');
    const goChapter = (fwd) => {
      const c = chapters[idx + (fwd ? 1 : -1)];
      if (!c) return;
      if (!fwd) gotoLast = c.id; // 往回翻：打开上一章的最后一页
      location.hash = '#/read/' + enc(book.id) + '/' + enc(c.id);
    };

    // ---- 目录 ----
    const toc = h('ol', { class: 'rd-toc' }, chapters.map((c, i) => {
      const cTag = langTag({ language: c.language || book.language, script: c.script || book.script });
      return h('li', {},
        h('a', { href: '#/read/' + enc(book.id) + '/' + enc(c.id), 'aria-current': i === idx ? 'true' : null },
          h('span', { class: 'num' }, c.chapter_number + '.'),
          h('span', { lang: cTag, dir: 'auto' }, c.title)));
    }));
    const tocSheet = makeSheet(t('book.contents'), toc);

    // ---- 设置 ----
    const settingsBody = h('div');
    const setSheet = makeSheet(t('reader.settings'), settingsBody);

    const host = h('div', { class: 'rd-host' });

    const setPref = (patch) => {
      const r = getRaw();
      const oldMode = prefs.pageMode;
      prefs = storage.setPrefs(patch);
      applyPrefs();
      drawSettings();
      if (prefs.pageMode !== 'scroll' || oldMode !== 'scroll') renderContent(r, false); // 分页模式：重新排版分页
      else { scrollToRatio(r); updateBar(); } // 滚动模式：字号/行距变化后保持原位置
    };
    const stepRow = (label, val, onDec, onInc) => h('div', { class: 'rd-row' },
      h('span', {}, label),
      h('div', { class: 'rd-step' },
        h('button', { class: 'rd-btn', type: 'button', 'aria-label': t('reader.dec'), onclick: onDec }, '−'),
        h('span', { class: 'rd-val' }, val),
        h('button', { class: 'rd-btn', type: 'button', 'aria-label': t('reader.inc'), onclick: onInc }, '+')));
    const round1 = (n) => Math.round(n * 10) / 10;
    function drawSettings() {
      settingsBody.replaceChildren(
        h('div', { class: 'rd-row' },
          h('span', {}, t('reader.pageMode')),
          h('div', { class: 'rd-seg' }, MODES.map((m) =>
            h('button', { class: 'rd-btn', type: 'button', 'aria-pressed': prefs.pageMode === m ? 'true' : 'false', onclick: () => setPref({ pageMode: m }) },
              t('reader.mode.' + m))))),
        prefs.pageMode !== 'scroll' ? h('div', { class: 'rd-row' },
          h('span', {}, t('reader.anim')),
          h('div', { class: 'rd-seg' },
            h('button', { class: 'rd-btn', type: 'button', 'aria-pressed': prefs.anim ? 'true' : 'false', onclick: () => setPref({ anim: true }) }, t('reader.on')),
            h('button', { class: 'rd-btn', type: 'button', 'aria-pressed': prefs.anim ? 'false' : 'true', onclick: () => setPref({ anim: false }) }, t('reader.off')))) : null,
        stepRow(t('reader.fontSize'), String(prefs.fontSize),
          () => setPref({ fontSize: Math.max(14, prefs.fontSize - 1) }),
          () => setPref({ fontSize: Math.min(32, prefs.fontSize + 1) })),
        stepRow(t('reader.lineHeight'), prefs.lineHeight.toFixed(1),
          () => setPref({ lineHeight: round1(prefs.lineHeight - 0.1) }),
          () => setPref({ lineHeight: round1(prefs.lineHeight + 0.1) })),
        h('div', { class: 'rd-row' },
          h('span', {}, t('reader.margin')),
          h('div', { class: 'rd-seg' }, MARGINS.map((m) =>
            h('button', { class: 'rd-btn', type: 'button', 'aria-pressed': prefs.margin === m ? 'true' : 'false', onclick: () => setPref({ margin: m }) },
              t('reader.margin.' + m))))),
        h('div', { class: 'rd-row' },
          h('span', {}, t('reader.theme')),
          h('div', { class: 'rd-seg' }, THEMES.map((k) =>
            h('button', {
              class: 'rd-sw', type: 'button', 'aria-label': t('reader.theme.' + k),
              'aria-pressed': prefs.theme === k ? 'true' : 'false',
              style: 'background:' + BG[k], onclick: () => setPref({ theme: k })
            })))));
    }
    drawSettings();

    // ---- 顶栏 / 底栏 ----
    const bar = h('header', { class: 'rd-bar' },
      h('a', { class: 'rd-ico', href: '#/book/' + enc(book.id), 'aria-label': t('reader.back') }, ico('<path d="M15 5l-7 7 7 7"/>')),
      h('div', { class: 'rd-ttl' },
        h('span', { class: 'rd-t1', lang: bookTag, dir: 'auto' }, book.title),
        h('span', { class: 'rd-t2', lang: tag, dir: 'auto' }, chapter.title)),
      h('button', { class: 'rd-ico', type: 'button', 'aria-label': t('book.contents'), onclick: () => openSheet(tocSheet) }, ico('<path d="M4 6h16M4 12h16M4 18h10"/>')),
      h('button', { class: 'rd-ico', type: 'button', 'aria-label': t('reader.settings'), onclick: () => openSheet(setSheet) }, 'Aa'));

    audioCtl = chapter.audio_path ? createAudio({
      path: chapter.audio_path, chapterId: chapter.id, bookId: book.id,
      nextId: chapters[idx + 1] ? chapters[idx + 1].id : null,
      bookTitle: book.title, chapterTitle: chapter.title,
      onNext: () => goChapter(true)
    }) : null;
    const foot = h('footer', { class: 'rd-foot' },
      audioCtl ? audioCtl.el : null,
      h('div', { class: 'rd-foot-in' }, prevEl, h('div', { class: 'rd-track' }, fill), pct, nextEl));

    mount(bar, host, foot, tocSheet, setSheet);

    saveNow = () => { if (ready) storage.setProgress(book.id, chapter.id, getProg()); };
    const queueSave = () => { clearTimeout(timer); timer = setTimeout(saveNow, 250); };

    // 排版稳定：等一帧，再等字体加载完
    const settle = async () => {
      await nextFrame();
      if (document.fonts && document.fonts.ready) {
        try { await document.fonts.ready; } catch (e) { /* ignore */ }
      }
    };

    // ---- 把正文显示出来（按当前翻页方式）----
    let renderToken = 0;
    const renderContent = async (ratio, atLast) => {
      const token = ++renderToken;
      ready = false;
      ui.hide();
      layers = null;
      if (pager) { pager.destroy(); pager = null; }
      const mode = prefs.pageMode;

      if (mode === 'scroll') {
        root.classList.remove('rd-paged');
        document.body.classList.remove('rd-lock');
        host.replaceChildren(h('article', { class: 'rd-body', lang: tag }, flowNodes()));
        await settle();
        if (disposed || token !== renderToken) return;
        getRaw = rawRatio;
        getProg = progressRatio;
        scrollToRatio(atLast ? 1 : ratio);
      } else {
        root.classList.add('rd-paged');
        document.body.classList.add('rd-lock');
        window.scrollTo(0, 0);
        const mk = (lazy) => {
          const flow = h('div', { class: 'pg-flow', lang: tag, dir: rtl ? 'rtl' : 'ltr' }, lazy ? [] : flowNodes());
          const shade = h('div', { class: 'pg-shade' });
          const layer = h('div', { class: 'pg-layer' }, h('div', { class: 'pg-clip' }, flow), shade);
          const L = { layer, flow, shade, filled: !lazy };
          // B 层（翻页时露出的那一页）先留空，等第一屏显示出来后再在空闲时填充，减少进入章节时的卡顿
          L.fill = () => { if (!L.filled) { L.filled = true; flow.replaceChildren(...flowNodes()); } };
          return L;
        };
        const A = mk(false);
        const B = mk(true);
        layers = [A, B];
        B.layer.style.visibility = 'hidden';
        const num = h('div', { class: 'pg-num' });
        const stage = h('div', { class: 'pg-stage' }, B.layer, A.layer, num);
        host.replaceChildren(stage);
        await settle();
        if (disposed || token !== renderToken) return;
        stage.style.insetBlockStart = bar.offsetHeight + 'px';
        stage.style.insetBlockEnd = foot.offsetHeight + 'px';
        const sw = stage.clientWidth;
        const sh = stage.clientHeight;
        const pad = MARGIN_PX[prefs.margin];
        const W = Math.max(120, sw - 2 * pad);
        const H = Math.max(120, sh - PAD_TOP - PAD_BOTTOM);
        stage.style.setProperty('--pg-w', W + 'px');
        stage.style.setProperty('--pg-h', H + 'px');
        stage.style.setProperty('--pg-gap', PAGE_GAP + 'px');
        stage.style.setProperty('--pg-x', ((sw - W) / 2) + 'px');
        stage.style.setProperty('--pg-y', PAD_TOP + 'px');
        pager = createPager({
          stage, A, B, num, W, rtl, mode, anim: prefs.anim, ratio, atLast, label: labelFor,
          onPage: () => { ui.hide(); updateBar(); queueSave(); },
          onEdge: (fwd) => goChapter(fwd),
          onTap: (x, y) => ui.tap(x, y)
        });
        pager.size = sw + 'x' + sh;
        const idle = window.requestIdleCallback ? (f) => window.requestIdleCallback(f, { timeout: 800 }) : (f) => setTimeout(f, 250);
        idle(() => { if (!disposed && B.fill) B.fill(); });
        getRaw = pager.ratio;
        getProg = pager.prog;
      }
      ready = true;
      saveNow();
      updateBar();
      if (dirty) { dirty = false; repaint(); }
    };

    // 从“我的笔记”点进来：翻到那条划线所在的页，并闪一下
    const jumpTo = async (id, marksReady) => {
      await Promise.race([marksReady, new Promise((r) => setTimeout(r, 1500))]);
      if (disposed || !ready) return;
      const scope = prefs.pageMode === 'scroll' ? host : (layers && layers[0].flow);
      const hl = scope && scope.querySelector('.hl[data-m="' + id + '"]');
      if (!hl) return;
      if (prefs.pageMode === 'scroll') hl.scrollIntoView({ block: 'center' });
      else if (pager) { const pg = pager.pageOf(hl); if (pg >= 0) pager.go(pg); }
      const again = scope.querySelector('.hl[data-m="' + id + '"]');
      if (again) { again.classList.add('hl-flash'); setTimeout(() => again.classList.remove('hl-flash'), 1800); }
    };

    // 预取前后章节：翻过去的时候直接从内存里取
    setTimeout(() => {
      [idx + 1, idx - 1].forEach((i) => {
        if (disposed || i < 0 || i >= chapters.length) return;
        getChapterCached(book.id, chapters[i].id).catch(() => {});
      });
    }, 400);

    const jm = (location.hash.match(/[?&]m=([0-9a-f-]{36})/i) || [])[1] || '';
    const marksReady = ui.load(); // 先用本机缓存的划线，云端的随后到
    const prog = storage.getProgress(book.id);
    const want = prog && prog.chapterId === chapter.id && prog.ratio < 0.98 ? prog.ratio : 0;
    const atLast = gotoLast === chapter.id;
    if (atLast) gotoLast = null;
    await renderContent(want, atLast);
    if (disposed) return;
    if (jm) {
      try { history.replaceState(null, '', location.pathname + location.search + '#/read/' + enc(book.id) + '/' + enc(chapter.id)); } catch (e) { /* ignore */ }
      jumpTo(jm, marksReady);
    }

    // ---- 保存进度 ----
    listen(window, 'scroll', () => {
      if (!ready || prefs.pageMode !== 'scroll') return;
      updateBar();
      queueSave();
    }, { passive: true });
    listen(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden' && saveNow) saveNow(); });
    listen(window, 'pagehide', () => { if (saveNow) saveNow(); });
    // 滚动模式：点划线打开工具条；点别处收起工具条
    listen(host, 'click', (e) => { if (prefs.pageMode === 'scroll') ui.tap(e.clientX, e.clientY); });
    listen(document, 'keydown', (e) => {
      if (e.target && /^(TEXTAREA|INPUT)$/.test(e.target.tagName)) return; // 写想法时不翻页
      if (e.key === 'Escape') { tocSheet.hidden = true; setSheet.hidden = true; ui.hide(); return; }
      if (pager && tocSheet.hidden && setSheet.hidden) pager.key(e);
    });

    // ---- 屏幕尺寸变化（旋转手机等）或字体晚到：重新分页并回到原位置 ----
    let rt = null;
    const relayout = () => {
      clearTimeout(rt);
      rt = setTimeout(() => {
        if (disposed || !pager) return;
        const st = host.querySelector('.pg-stage');
        if (!st || (st.clientWidth + 'x' + st.clientHeight === pager.size && !relayout.force)) return;
        relayout.force = false;
        renderContent(getRaw(), false);
      }, 200);
    };
    listen(window, 'resize', relayout);
    listen(window, 'orientationchange', relayout);
    if (document.fonts && document.fonts.addEventListener) {
      listen(document.fonts, 'loadingdone', () => { relayout.force = true; relayout(); });
    }
  };

  const load = async () => {
    const hit = fresh(bookCache.get(bookId)) && (!chapterId || fresh(chCache.get(chapterId)));
    if (!hit) mount(h('div', { class: 'rd-msg' }, h('p', {}, t('common.loading'))));
    try {
      if (!isUuid(bookId)) { mount(message('book.notfound')); return; }
      const { book, chapters } = await getBookData(bookId);
      if (disposed) return;
      if (!book) { mount(message('book.notfound')); return; }
      if (!chapters.length) { mount(message('book.nochapters')); return; }

      if (!chapterId) {
        // 没指定章节：优先上次读到的章节，否则第一章
        const p = storage.getProgress(book.id);
        const c = (p && chapters.find((x) => x.id === p.chapterId)) || chapters[0];
        location.replace('#/read/' + enc(book.id) + '/' + enc(c.id));
        return;
      }
      const idx = chapters.findIndex((c) => c.id === chapterId);
      if (idx < 0) { mount(message('reader.chapterMissing')); return; }
      const chapter = await getChapterCached(book.id, chapterId);
      if (disposed) return;
      if (!chapter) { mount(message('reader.chapterMissing')); return; }
      await build(book, chapters, idx, chapter);
    } catch (e) {
      console.error(e);
      if (!disposed) mount(message('common.error', true));
    }
  };

  load();
  return root;
}
