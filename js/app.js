import { t, initLang, setLang, getLang, LANGS, checkI18n, localized } from './i18n.js';
import './messages-shelf.js';
import { storage } from './storage.js';
import { parseHash, onRouteChange, navigate } from './router.js';
import { listBooks, getCategories, getBook, getChapterList, langTag } from './api.js';

for (const href of ['./css/pages.css', './css/book.css', './css/shelf.css']) {
  document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'stylesheet', href }));
}

const app = document.getElementById('app');
let route = parseHash();

// ---------- 小工具 ----------
function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return e;
}

// 图标是固定的静态 SVG，不含任何用户数据
function icon(name) {
  const paths = {
    home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>',
    library: '<path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5C4.7 20 4 19.3 4 18.5z"/><path d="M20 5.5C20 4.7 19.3 4 18.5 4H13v16h5.5c.8 0 1.5-.7 1.5-1.5z"/>',
    shelf: '<path d="M6 3h12v18l-6-4-6 4z"/>'
  };
  const s = document.createElement('span');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + paths[name] + '</svg>';
  return s;
}

// 异步加载一个区块：加载中 -> 内容 / 错误+重试。fn 返回 null 表示整个区块隐藏
async function loadInto(box, fn) {
  box.replaceChildren(h('p', { class: 'muted' }, t('common.loading')));
  try {
    const node = await fn();
    if (node === null) {
      const sec = box.closest('section');
      if (sec) sec.remove(); else box.replaceChildren();
      return;
    }
    box.replaceChildren(node);
  } catch (e) {
    console.error(e);
    box.replaceChildren(h('div', { class: 'card' },
      h('p', { class: 'bad' }, t('common.error')),
      h('button', { class: 'btn', type: 'button', onclick: () => loadInto(box, fn) }, t('common.retry'))));
  }
}

function section(title, content, moreHref) {
  return h('section', { class: 'sec' },
    h('div', { class: 'sec-h' },
      h('h2', {}, title),
      moreHref ? h('a', { href: moreHref }, t('home.more')) : null),
    content);
}

function libHref({ q, cat, page } = {}) {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (cat) p.set('cat', cat);
  if (page > 1) p.set('page', String(page));
  const s = p.toString();
  return '#/library' + (s ? '?' + s : '');
}

const enc = encodeURIComponent;

// ---------- 书籍卡片 ----------
function cover(b) {
  if (b.cover_url) {
    return h('div', { class: 'cover' }, h('img', { src: b.cover_url, alt: '', loading: 'lazy' }));
  }
  let hue = 0;
  for (const ch of String(b.id)) hue = (hue * 31 + ch.charCodeAt(0)) % 360;
  // 没有封面时，用书名原文生成一个纯色封面
  return h('div', { class: 'cover gen', style: 'background:hsl(' + hue + ' 35% 28%)' },
    h('span', { lang: langTag(b), dir: 'auto' }, b.title));
}

function bookLabel(b) {
  let label = t('langname.' + b.language);
  if (b.language === 'kk') label += ' · ' + t('script.' + b.script);
  return label;
}

function bookCard(b) {
  const tag = langTag(b);
  return h('a', { class: 'bcard', href: '#/book/' + enc(b.id) },
    cover(b),
    h('div', { class: 'bt', lang: tag, dir: 'auto' }, b.title),
    h('div', { class: 'ba', lang: tag, dir: 'auto' }, b.author),
    h('div', {}, h('span', { class: 'tag' }, bookLabel(b))));
}

const bookGrid = (items) => h('div', { class: 'grid' }, items.map(bookCard));

// ---------- 外壳 ----------
const NAV = [
  { id: 'home', href: '#/', key: 'nav.home' },
  { id: 'library', href: '#/library', key: 'nav.library' },
  { id: 'shelf', href: '#/shelf', key: 'nav.shelf' }
];

function activeNav() {
  if (route.name === 'home') return 'home';
  if (['library', 'book', 'read'].includes(route.name)) return 'library';
  if (route.name === 'shelf') return 'shelf';
  return '';
}

function renderHeader() {
  const active = activeNav();
  const input = h('input', {
    type: 'search', name: 'q', placeholder: t('search.placeholder'),
    'aria-label': t('search.placeholder'), value: route.query.q || '', autocomplete: 'off'
  });
  const search = h('form', {
    class: 'search', role: 'search',
    onsubmit: (e) => {
      e.preventDefault();
      const q = input.value.trim();
      navigate(q ? '/library?q=' + enc(q) : '/library');
    }
  }, input);

  const select = h('select', {
    'aria-label': t('lang.label'),
    onchange: (e) => { setLang(e.target.value); render(false); }
  }, LANGS.map((l) => h('option', { value: l.code, selected: l.code === getLang() }, l.label)));

  return h('header', { class: 'topbar' },
    h('div', { class: 'topbar-in' },
      h('a', { class: 'brand', href: '#/' }, t('brand')),
      h('nav', { class: 'nav', 'aria-label': t('nav.aria') },
        NAV.map((n) => h('a', { href: n.href, 'aria-current': n.id === active ? 'page' : null }, t(n.key)))),
      search,
      h('label', { class: 'lang' }, select)
    )
  );
}

function renderTabbar() {
  const active = activeNav();
  return h('nav', { class: 'tabbar', 'aria-label': t('nav.aria') },
    NAV.map((n) => h('a', { href: n.href, 'aria-current': n.id === active ? 'page' : null }, icon(n.id), t(n.key))));
}

// ---------- 页面 ----------
function titleLine(text) { return h('div', { dir: 'auto' }, text); }

function viewHome() {
  const root = h('div', {}, h('h1', {}, t('home.title')));

  // 没有阅读历史时，不显示继续阅读区
  const recent = storage.getRecent();
  if (recent.length) {
    root.append(section(t('home.continue'),
      h('ul', { class: 'list' }, recent.slice(0, 5).map((b) =>
        h('li', {}, h('a', { href: '#/book/' + enc(b.bookId) }, titleLine(b.title)))))));
  }

  const catBox = h('div');
  root.append(section(t('home.categories'), catBox));
  loadInto(catBox, async () => {
    const cats = await getCategories();
    if (!cats.length) return null;
    return h('div', { class: 'chips' },
      cats.map((c) => h('a', { class: 'chip', href: libHref({ cat: c.slug }) }, localized(c.name))));
  });

  const featBox = h('div');
  root.append(section(t('home.featured'), featBox, '#/library'));
  loadInto(featBox, async () => {
    const { items } = await listBooks({ featured: true, pageSize: 6 });
    return items.length ? bookGrid(items) : null;
  });

  const newBox = h('div');
  root.append(section(t('home.new'), newBox, '#/library'));
  loadInto(newBox, async () => {
    const { items } = await listBooks({ pageSize: 8 });
    return items.length ? bookGrid(items) : h('p', { class: 'muted' }, t('library.nobooks'));
  });

  return root;
}

function viewLibrary() {
  const q = (route.query.q || '').trim();
  const cat = route.query.cat || '';
  const page = Math.max(1, parseInt(route.query.page, 10) || 1);

  const root = h('div', {}, h('h1', {}, t('library.title')));

  const chipBox = h('div');
  root.append(chipBox);
  loadInto(chipBox, async () => {
    const cats = await getCategories();
    return h('div', { class: 'chips' },
      h('a', { class: 'chip', href: libHref({ q }), 'aria-current': cat === '' ? 'true' : null }, t('common.all')),
      cats.map((c) => h('a', { class: 'chip', href: libHref({ q, cat: c.slug }), 'aria-current': cat === c.slug ? 'true' : null }, localized(c.name))));
  });

  if (q) {
    root.append(h('p', { class: 'muted' },
      t('library.query') + ': ', h('span', { dir: 'auto' }, q), ' ',
      h('a', { class: 'link', href: libHref({ cat }) }, t('library.clear'))));
  }

  const gridBox = h('div');
  root.append(gridBox);
  loadInto(gridBox, async () => {
    const { items, hasNext } = await listBooks({ q, categorySlug: cat, page });
    const wrap = h('div');
    if (!items.length) {
      wrap.append(h('p', { class: 'muted' }, t(q || cat || page > 1 ? 'library.noresults' : 'library.nobooks')));
    } else {
      wrap.append(bookGrid(items));
    }
    if (page > 1 || hasNext) {
      wrap.append(h('nav', { class: 'pager' },
        page > 1
          ? h('a', { class: 'btn ghost', href: libHref({ q, cat, page: page - 1 }) }, t('pager.prev'))
          : h('span', { class: 'btn ghost disabled', 'aria-disabled': 'true' }, t('pager.prev')),
        h('span', { class: 'muted' }, t('pager.page', { n: page })),
        hasNext
          ? h('a', { class: 'btn ghost', href: libHref({ q, cat, page: page + 1 }) }, t('pager.next'))
          : h('span', { class: 'btn ghost disabled', 'aria-disabled': 'true' }, t('pager.next'))));
    }
    return wrap;
  });

  return root;
}

// ---------- 书籍详情 ----------
function bookMissing() {
  return h('div', {},
    h('h1', {}, t('book.notfound')),
    h('a', { class: 'btn', href: '#/library' }, t('book.toLibrary')));
}

function bookDetail(book, chapters, cats) {
  const tag = langTag(book);
  const cat = cats.find((c) => c.id === book.category_id);
  const progress = storage.getProgress(book.id);
  const resume = progress ? chapters.find((c) => c.id === progress.chapterId) : null;
  const target = resume || chapters[0] || null;

  // 加入/移出书架
  const status = h('span', { class: 'muted', role: 'status' });
  const shelfBtn = h('button', { class: 'btn ghost', type: 'button' });
  const refreshShelf = () => {
    const on = storage.isInShelf(book.id);
    shelfBtn.textContent = t(on ? 'book.removeShelf' : 'book.addShelf');
    shelfBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  };
  shelfBtn.addEventListener('click', () => {
    if (storage.isInShelf(book.id)) {
      storage.removeFromShelf(book.id);
      status.textContent = t('book.removed');
    } else {
      storage.addToShelf({
        id: book.id, title: book.title, author: book.author,
        cover_url: book.cover_url, language: book.language, script: book.script
      });
      status.textContent = t('book.added');
    }
    refreshShelf();
  });
  refreshShelf();

  // 开始/继续阅读：没有章节时不打开阅读器
  const startEl = target
    ? h('a', { class: 'btn', href: '#/read/' + enc(book.id) + '/' + enc(target.id) }, t(resume ? 'home.continue' : 'book.start'))
    : h('span', { class: 'btn disabled', 'aria-disabled': 'true' }, t('book.start'));

  // 内部测试标记（以 __ 开头）不显示
  const showCopyright = book.copyright_note && !String(book.copyright_note).startsWith('__');

  const info = h('div', { class: 'bk-info' },
    h('h1', { lang: tag, dir: 'auto' }, book.title),
    h('div', { class: 'bk-author', lang: tag, dir: 'auto' }, book.author),
    h('div', {},
      h('span', { class: 'tag' }, bookLabel(book)),
      cat ? h('span', { class: 'tag' }, localized(cat.name)) : null),
    h('div', { class: 'bk-actions' }, startEl, shelfBtn, status),
    resume ? h('div', { class: 'bk-meta' }, t('book.progress', { n: resume.chapter_number, p: Math.round(progress.ratio * 100) })) : null,
    target ? null : h('p', { class: 'bad' }, t('book.nochapters')),
    book.description ? h('p', { class: 'bk-desc', lang: tag, dir: 'auto' }, book.description) : null,
    showCopyright ? h('div', { class: 'bk-meta' }, t('book.copyright') + ': ', h('span', { dir: 'auto' }, book.copyright_note)) : null);

  const toc = chapters.length
    ? section(t('book.contents'),
      h('ol', { class: 'toc' }, chapters.map((ch) => {
        const chTag = langTag({ language: ch.language || book.language, script: ch.script || book.script });
        return h('li', {},
          h('a', { href: '#/read/' + enc(book.id) + '/' + enc(ch.id), 'aria-current': resume && resume.id === ch.id ? 'true' : null },
            h('span', { class: 'num' }, ch.chapter_number + '.'),
            h('span', { lang: chTag, dir: 'auto' }, ch.title)));
      })))
    : null;

  return h('div', {},
    h('div', { class: 'bk' }, h('div', { class: 'bk-cover' }, cover(book)), info),
    toc);
}

function viewBook() {
  const id = route.params.id;
  const root = h('div');
  loadInto(root, async () => {
    const book = await getBook(id);
    if (!book) return bookMissing();
    const [chapters, cats] = await Promise.all([
      getChapterList(book.id),
      getCategories().catch(() => [])
    ]);
    return bookDetail(book, chapters, cats);
  });
  return root;
}

// ---------- 书架（微信读书式：三列封面网格）----------
function viewShelf() {
  const root = h('div');
  let selectMode = false;
  const selected = new Set();

  // 最近读过或最近加入的排在前面
  const sortedShelf = () => {
    const recent = new Map(storage.getRecent().map((r) => [r.bookId, r.ts || 0]));
    return storage.getShelf()
      .map((b) => ({ ...b, last: Math.max(b.addedAt || 0, recent.get(b.bookId) || 0) }))
      .sort((a, b) => b.last - a.last);
  };

  const draw = () => {
    const items = sortedShelf();
    for (const id of [...selected]) if (!items.some((i) => i.bookId === id)) selected.delete(id);
    if (!items.length) selectMode = false;

    const head = h('div', { class: 'sh-head' },
      h('h1', {}, t('shelf.title')),
      items.length
        ? h('button', {
          class: 'sh-sel', type: 'button',
          onclick: () => { selectMode = !selectMode; selected.clear(); draw(); }
        }, t(selectMode ? 'shelf.done' : 'shelf.select'))
        : null);

    const card = (b) => {
      const tag = langTag(b);
      const on = selected.has(b.bookId);
      const kids = [
        h('div', { class: 'sh-cover' },
          cover({ id: b.bookId, title: b.title, cover_url: b.cover_url, language: b.language, script: b.script }),
          selectMode ? h('span', { class: 'sh-check' + (on ? ' on' : ''), 'aria-hidden': 'true' }, on ? '✓' : '') : null),
        h('div', { class: 'sh-title', lang: tag, dir: 'auto' }, b.title)
      ];
      return selectMode
        ? h('button', {
          class: 'sh-item', type: 'button', 'aria-pressed': on ? 'true' : 'false',
          onclick: () => { if (selected.has(b.bookId)) selected.delete(b.bookId); else selected.add(b.bookId); draw(); }
        }, kids)
        : h('a', { class: 'sh-item', href: '#/book/' + enc(b.bookId) }, kids);
    };

    const body = items.length
      ? h('div', { class: 'sh-grid' }, items.map(card))
      : h('p', { class: 'muted' }, t('shelf.empty'));

    const bar = selectMode && items.length
      ? h('div', { class: 'sh-bar' },
        h('button', {
          class: 'btn', type: 'button', disabled: selected.size === 0,
          onclick: () => { storage.removeManyFromShelf([...selected]); selected.clear(); draw(); }
        }, t('shelf.remove', { n: selected.size })))
      : null;

    root.replaceChildren(head, body, bar);
  };

  draw();
  return root;
}

function viewPlaceholder(titleKey) {
  return h('div', {}, h('h1', {}, t(titleKey)), h('p', { class: 'muted' }, t('home.soon')));
}

function viewNotFound() {
  return h('div', {},
    h('h1', {}, t('notfound.title')),
    h('a', { class: 'btn', href: '#/' }, t('notfound.home')));
}

// 开发自检页：#/dev（上线前会删除）
function viewDev() {
  const cp = (...c) => String.fromCodePoint(...c);
  const samples = [
    'Ә ә, Ғ ғ, Қ қ, Ң ң, Ө ө, Ұ ұ, Ү ү, Һ һ, І і',
    'Qara sózder — Óleń, sózdiń, Qıynnan',
    cp(0x0642, 0x0627, 0x0631, 0x0627, 0x20, 0x0676, 0x0677, 0x0678, 0x06AD),
    '论语·学而 “子曰”',
    'Анна Каренина',
    'Pride and Prejudice https://example.com/a?b=1 (2026)'
  ];
  const rows = [];
  samples.forEach((s, i) => {
    const id = '__dev' + i;
    storage.addToShelf({ id, title: s, author: s });
    const back = storage.getShelf().find((b) => b.bookId === id);
    const ok = !!back && back.title === s && back.author === s;
    storage.removeFromShelf(id);
    rows.push(h('li', { class: ok ? 'ok' : 'bad' }, (ok ? '✓ ' : '✗ '), h('span', { dir: 'auto' }, s)));
  });

  const rep = checkI18n();
  const i18nRows = Object.entries(rep).map(([code, r]) => {
    const ok = r.missing.length === 0 && r.extra.length === 0;
    return h('li', { class: ok ? 'ok' : 'bad' },
      (ok ? '✓ ' : '✗ ') + code + (ok ? '' : ' missing: ' + r.missing.join(', ') + ' extra: ' + r.extra.join(', ')));
  });

  return h('div', {},
    h('h1', {}, 'Dev self-check'),
    h('h2', {}, 'storage persistent: ' + (storage.isPersistent() ? 'yes' : 'no (memory only)')),
    h('h2', {}, 'storage round-trip (exact string equality)'),
    h('ul', { class: 'list' }, rows),
    h('h2', {}, 'i18n keys'),
    h('ul', { class: 'list' }, i18nRows));
}

function renderView() {
  switch (route.name) {
    case 'home': return viewHome();
    case 'library': return viewLibrary();
    case 'shelf': return viewShelf();
    case 'book': return viewBook();
    case 'read': return viewPlaceholder('library.title');
    case 'dev': return viewDev();
    default: return viewNotFound();
  }
}

// ---------- 总渲染 ----------
function render(scrollTop = true) {
  document.title = t('brand');
  app.replaceChildren(
    renderHeader(),
    h('main', { id: 'view', class: 'view' }, renderView()),
    h('footer', { class: 'foot' }, h('p', {}, t('local.notice'))),
    renderTabbar()
  );
  if (scrollTop) window.scrollTo(0, 0);
}

initLang();
onRouteChange((r) => { route = r; render(true); });
