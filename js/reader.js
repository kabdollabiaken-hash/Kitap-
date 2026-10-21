// 阅读器：正文原样显示，不转换任何文字
// 三种翻页方式：仿真翻页（curl）、左右滑动（slide）、上下滚动（scroll）
import { t } from './i18n.js';
import './messages-reader.js';
import './messages-paging.js';
import { storage } from './storage.js';
import { getBook, getChapterList, langTag, isUuid } from './api.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { h, enc } from './ui.js';

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
  url.searchParams.set('select', 'id,book_id,chapter_number,title,content,content_sha256,language,script,text_direction');
  url.searchParams.set('id', 'eq.' + chapterId);
  url.searchParams.set('book_id', 'eq.' + bookId);
  url.searchParams.set('limit', '1');
  const r = await fetch(url, { headers: { apikey: SUPABASE_KEY } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const rows = await r.json();
  return rows[0] || null;
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

  A.flow.style.transform = 'none';
  const pages = countPages(A.flow, W, rtl);
  cur = o.atLast ? pages - 1 : Math.min(pages - 1, Math.max(0, Math.round(o.ratio * (pages - 1))));

  const place = (L, p) => { L.flow.style.transform = 'translateX(' + ((rtl ? 1 : -1) * p * stride) + 'px)'; };
  const rest = () => {
    place(A, cur);
    A.layer.style.transform = '';
    A.layer.style.zIndex = '2';
    A.shade.style.opacity = '0';
    B.layer.style.visibility = 'hidden';
    B.layer.style.transform = '';
    B.shade.style.opacity = '0';
    num.textContent = (cur + 1) + ' / ' + pages;
  };

  // top：正在翻的那一层；t：翻开的程度 0（盖住）~1（翻走）
  const apply = (top, under, tt) => {
    if (mode === 'curl') {
      top.layer.style.transformOrigin = rtl ? '100% 50%' : '0% 50%';
      top.layer.style.transform = 'rotateY(' + ((rtl ? 1 : -1) * tt * 96) + 'deg)';
      top.shade.style.opacity = String(Math.min(0.55, tt * 0.6));
      under.shade.style.opacity = String((1 - tt) * 0.35);
    } else {
      top.layer.style.transform = 'translateX(' + ((rtl ? 1 : -1) * tt * 100) + '%)';
      top.shade.style.opacity = '0';
      under.shade.style.opacity = String((1 - tt) * 0.2);
    }
  };

  const begin = (fwd) => {
    const target = cur + (fwd ? 1 : -1);
    if (target < 0 || target >= pages) return null;
    const top = fwd ? A : B;
    const under = fwd ? B : A;
    place(B, target);
    B.layer.style.visibility = 'visible';
    top.layer.style.zIndex = '3';
    under.layer.style.zIndex = '1';
    return { fwd, target, top, under };
  };
  const setP = (s, p) => apply(s.top, s.under, s.fwd ? p : 1 - p);
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
  const flip = (fwd) => {
    if (busy || drag) return;
    const s = begin(fwd);
    if (!s) { o.onEdge(fwd); return; }
    busy = true;
    setP(s, 0);
    run(s, 0, 1);
  };

  // ---- 手势：轻点（左侧上一页，其余下一页；从右往左的书相反）和拖动翻页 ----
  const tap = (x) => {
    const r = stage.getBoundingClientRect();
    const f = (x - r.left) / r.width;
    const back = rtl ? f > 0.7 : f < 0.3;
    flip(!back);
  };
  const forwardDx = (dx) => (rtl ? dx : -dx);
  stage.addEventListener('pointerdown', (e) => {
    if (busy || drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    drag = { x: e.clientX, y: e.clientY, t: performance.now(), mode: 0, s: null, p: 0, fwd: true };
    try { stage.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.mode) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        drag.mode = 1;
        drag.fwd = forwardDx(dx) > 0;
        drag.s = begin(drag.fwd);
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
    if (d.mode === 0) { if (!cancelled) tap(e.clientX); return; }
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
  const listeners = [];
  const listen = (tg, ev, fn, opt) => { tg.addEventListener(ev, fn, opt); listeners.push([tg, ev, fn, opt]); };

  active = () => {
    disposed = true;
    clearTimeout(timer);
    if (saveNow) saveNow();
    if (pager) pager.destroy();
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
    const blocks = chapter.content.split(/\r?\n(?:[ \t]*\r?\n)+/).filter((b) => b.trim() !== '');
    const showCopyright = book.copyright_note && !String(book.copyright_note).startsWith('__');
    const flowNodes = () => [
      integrityBad ? h('div', { class: 'rd-warn', role: 'alert' }, t('reader.integrity')) : null,
      h('h1', { class: 'rd-h', dir: 'auto' }, chapter.title),
      blocks.map((b) => h('p', { class: 'rd-p', dir: dirMode }, b)),
      showCopyright ? h('div', { class: 'rd-note' }, t('book.copyright') + ': ', h('span', { dir: 'auto' }, book.copyright_note)) : null
    ].flat(Infinity);

    // ---- 进度条 ----
    const fill = h('div', { class: 'rd-fill' });
    const pct = h('span', { class: 'rd-pct' }, '0%');
    const updateBar = () => {
      const total = Math.round(((idx + getProg()) / chapters.length) * 100);
      fill.style.width = total + '%';
      pct.textContent = total + '%';
    };

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

    const foot = h('footer', { class: 'rd-foot' },
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
        const mk = () => {
          const flow = h('div', { class: 'pg-flow', lang: tag, dir: rtl ? 'rtl' : 'ltr' }, flowNodes());
          const shade = h('div', { class: 'pg-shade' });
          const layer = h('div', { class: 'pg-layer' }, h('div', { class: 'pg-clip' }, flow), shade);
          return { layer, flow, shade };
        };
        const A = mk();
        const B = mk();
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
          stage, A, B, num, W, rtl, mode, anim: prefs.anim, ratio, atLast,
          onPage: () => { updateBar(); queueSave(); },
          onEdge: (fwd) => goChapter(fwd)
        });
        pager.size = sw + 'x' + sh;
        getRaw = pager.ratio;
        getProg = pager.prog;
      }
      ready = true;
      saveNow();
      updateBar();
    };

    const prog = storage.getProgress(book.id);
    const want = prog && prog.chapterId === chapter.id && prog.ratio < 0.98 ? prog.ratio : 0;
    const atLast = gotoLast === chapter.id;
    if (atLast) gotoLast = null;
    await renderContent(want, atLast);
    if (disposed) return;

    // ---- 保存进度 ----
    listen(window, 'scroll', () => {
      if (!ready || prefs.pageMode !== 'scroll') return;
      updateBar();
      queueSave();
    }, { passive: true });
    listen(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden' && saveNow) saveNow(); });
    listen(window, 'pagehide', () => { if (saveNow) saveNow(); });
    listen(document, 'keydown', (e) => {
      if (e.key === 'Escape') { tocSheet.hidden = true; setSheet.hidden = true; return; }
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
    mount(h('div', { class: 'rd-msg' }, h('p', {}, t('common.loading'))));
    try {
      if (!isUuid(bookId)) { mount(message('book.notfound')); return; }
      const book = await getBook(bookId);
      if (disposed) return;
      if (!book) { mount(message('book.notfound')); return; }
      const chapters = await getChapterList(book.id);
      if (disposed) return;
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
      const chapter = await getChapter(book.id, chapterId);
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
