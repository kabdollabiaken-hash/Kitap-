// 阅读器：正文原样显示，不转换任何文字
import { t } from './i18n.js';
import './messages-reader.js';
import { storage } from './storage.js';
import { getBook, getChapterList, langTag, isUuid } from './api.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { h, enc } from './ui.js';

const BG = { white: '#ffffff', sepia: '#f5edd8', green: '#e0efe3', night: '#17191c' };
const THEMES = ['white', 'sepia', 'green', 'night'];
const MARGINS = ['narrow', 'normal', 'wide'];
const MARGIN_PX = { narrow: 12, normal: 24, wide: 48 };

let active = null; // 当前阅读器的清理函数（保存进度、移除监听）
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

export function viewReader(params) {
  const bookId = params.bookId;
  const chapterId = params.chapterId || '';
  const root = h('div', { class: 'rd rd-white' });
  let prefs = storage.getPrefs();
  let disposed = false;
  let ready = false;
  let timer = null;
  let saveNow = null;
  const listeners = [];
  const listen = (tg, ev, fn, opt) => { tg.addEventListener(ev, fn, opt); listeners.push([tg, ev, fn, opt]); };

  active = () => {
    disposed = true;
    clearTimeout(timer);
    if (saveNow) saveNow();
    listeners.forEach(([tg, ev, fn, opt]) => tg.removeEventListener(ev, fn, opt));
    document.body.classList.remove('reading');
    document.body.style.background = '';
  };
  document.body.classList.add('reading');

  const applyPrefs = () => {
    root.className = 'rd rd-' + prefs.theme;
    root.style.setProperty('--rd-size', prefs.fontSize + 'px');
    root.style.setProperty('--rd-lh', String(prefs.lineHeight));
    root.style.setProperty('--rd-pad', MARGIN_PX[prefs.margin] + 'px');
    document.body.style.background = BG[prefs.theme];
  };
  applyPrefs();

  // ---- 滚动位置：用“章节内滚动比例”，不依赖字符索引 ----
  const maxScroll = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  const rawRatio = () => { const m = maxScroll(); return m <= 4 ? 0 : Math.min(1, Math.max(0, window.scrollY / m)); };
  const progressRatio = () => (maxScroll() <= 4 ? 1 : rawRatio()); // 一屏就能读完的章节，视为已读完
  const scrollToRatio = (r) => window.scrollTo(0, r * maxScroll());

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

    const article = h('article', { class: 'rd-body', lang: tag },
      integrityBad ? h('div', { class: 'rd-warn', role: 'alert' }, t('reader.integrity')) : null,
      h('h1', { class: 'rd-h', dir: 'auto' }, chapter.title),
      blocks.map((b) => h('p', { class: 'rd-p', dir: dirMode }, b)),
      showCopyright ? h('div', { class: 'rd-note' }, t('book.copyright') + ': ', h('span', { dir: 'auto' }, book.copyright_note)) : null);

    // ---- 进度条 ----
    const fill = h('div', { class: 'rd-fill' });
    const pct = h('span', { class: 'rd-pct' }, '0%');
    const updateBar = () => {
      const total = Math.round(((idx + progressRatio()) / chapters.length) * 100);
      fill.style.width = total + '%';
      pct.textContent = total + '%';
    };

    // ---- 上一章 / 下一章 ----
    const chapterLink = (c, key) => (c
      ? h('a', { class: 'rd-btn', href: '#/read/' + enc(book.id) + '/' + enc(c.id) }, t(key))
      : h('span', { class: 'rd-btn off', 'aria-disabled': 'true' }, t(key)));
    const prevEl = chapterLink(chapters[idx - 1], 'reader.prev');
    const nextEl = chapterLink(chapters[idx + 1], 'reader.next');

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

    const setPref = (patch) => {
      const r = rawRatio();
      prefs = storage.setPrefs(patch);
      applyPrefs();
      drawSettings();
      scrollToRatio(r); // 字号/行距变化后，保持在原来的阅读位置
      updateBar();
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

    // ---- 顶栏 ----
    const bar = h('header', { class: 'rd-bar' },
      h('a', { class: 'rd-ico', href: '#/book/' + enc(book.id), 'aria-label': t('reader.back') }, ico('<path d="M15 5l-7 7 7 7"/>')),
      h('div', { class: 'rd-ttl' },
        h('span', { class: 'rd-t1', lang: bookTag, dir: 'auto' }, book.title),
        h('span', { class: 'rd-t2', lang: tag, dir: 'auto' }, chapter.title)),
      h('button', { class: 'rd-ico', type: 'button', 'aria-label': t('book.contents'), onclick: () => openSheet(tocSheet) }, ico('<path d="M4 6h16M4 12h16M4 18h10"/>')),
      h('button', { class: 'rd-ico', type: 'button', 'aria-label': t('reader.settings'), onclick: () => openSheet(setSheet) }, 'Aa'));

    const foot = h('footer', { class: 'rd-foot' },
      h('div', { class: 'rd-foot-in' }, prevEl, h('div', { class: 'rd-track' }, fill), pct, nextEl));

    mount(bar, article, foot, tocSheet, setSheet);

    // ---- 恢复阅读位置：等排版和字体稳定后再滚动 ----
    await new Promise((res) => requestAnimationFrame(() => res()));
    if (document.fonts && document.fonts.ready) {
      try { await document.fonts.ready; } catch (e) { /* ignore */ }
    }
    if (disposed) return;
    const prog = storage.getProgress(book.id);
    const want = prog && prog.chapterId === chapter.id && prog.ratio < 0.98 ? prog.ratio : 0;
    scrollToRatio(want);

    ready = true;
    saveNow = () => { if (ready) storage.setProgress(book.id, chapter.id, progressRatio()); };
    saveNow();
    updateBar();

    // ---- 保存进度：滚动停止后、切到后台、离开页面时 ----
    listen(window, 'scroll', () => {
      if (!ready) return;
      updateBar();
      clearTimeout(timer);
      timer = setTimeout(saveNow, 250);
    }, { passive: true });
    listen(document, 'visibilitychange', () => { if (document.visibilityState === 'hidden' && saveNow) saveNow(); });
    listen(window, 'pagehide', () => { if (saveNow) saveNow(); });
    listen(document, 'keydown', (e) => {
      if (e.key === 'Escape') { tocSheet.hidden = true; setSheet.hidden = true; }
    });
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
