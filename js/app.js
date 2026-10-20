import { t, initLang, setLang, getLang, LANGS, checkI18n, localized } from './i18n.js';
import { storage } from './storage.js';
import { parseHash, onRouteChange, navigate } from './router.js';
import { listBooks, getCategories, langTag } from './api.js';

document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: './css/pages.css' }));

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

function bookCard(b) {
  const tag = langTag(b);
  let label = t('langname.' + b.language);
  if (b.language === 'kk') label += ' · ' + t('script.' + b.script);
  return h('a', { class: 'bcard', href: '#/book/' + encodeURIComponent(b.id) },
    cover(b),
    h('div', { class: 'bt', lang: tag, dir: 'auto' }, b.title),
    h('div', { class: 'ba', lang: tag, dir: 'auto' }, b.author),
    h('div', {}, h('span', { class: 'tag' }, label)));
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
      navigate(q ? '/library?q=' + encodeURIComponent(q) : '/library');
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
        h('li', {}, h('a', { href: '#/book/' + encodeURIComponent(b.bookId) }, titleLine(b.title)))))));
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

function viewShelf() {
  const shelf = storage.getShelf();
  return h('div', {},
    h('h1', {}, t('shelf.title')),
    shelf.length
      ? h('ul', { class: 'list' }, shelf.map((b) => h('li', {}, titleLine(b.title))))
      : h('p', { class: 'muted' }, t('shelf.empty')));
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
    case 'book': return viewPlaceholder('library.title');
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
