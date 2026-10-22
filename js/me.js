// “我”页 + 登录页。只读写本机存储，不改书籍内容。
import { t, getLang, setLang, LANGS } from './i18n.js';
import { storage } from './storage.js';
import { h, enc } from './ui.js';
import { getBooksByIds } from './api-extra.js';
import { getSession, login, signOut, sync, takeAuthError } from './auth.js';

const pad2 = (n) => String(n).padStart(2, '0');
const dateKey = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const WEEKDAYS = { // 周日到周六（和 Date.getDay() 对应）
  kk: ['Жс', 'Дс', 'Сс', 'Ср', 'Бс', 'Жм', 'Сб'],
  ru: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'],
  zh: ['日', '一', '二', '三', '四', '五', '六'],
  en: ['S', 'M', 'T', 'W', 'T', 'F', 'S']
};

// 固定的静态图标，不含用户数据
function svg(html) { const s = document.createElement('span'); s.setAttribute('aria-hidden', 'true'); s.innerHTML = html; return s; }
const GOOGLE_G = '<svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
const LOGO = '<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5C4.7 20 4 19.3 4 18.5z"/><path d="M20 5.5C20 4.7 19.3 4 18.5 4H13v16h5.5c.8 0 1.5-.7 1.5-1.5z"/></svg>';

function langChips(rerender) {
  return h('div', { class: 'me-langs', role: 'group', 'aria-label': t('lang.label') },
    LANGS.map((l) => h('button', {
      type: 'button', class: 'me-chip', 'aria-pressed': l.code === getLang() ? 'true' : 'false',
      onclick: () => { setLang(l.code); rerender(); }
    }, l.label)));
}

// ---------- 登录页 ----------
export function viewLogin(rerender) {
  const err = takeAuthError();
  const btn = h('button', { class: 'lg-btn', type: 'button', onclick: () => { btn.disabled = true; login(); } },
    svg(GOOGLE_G), h('span', {}, t('login.google')));
  return h('div', { class: 'lg' },
    h('div', { class: 'lg-top' }, langChips(rerender)),
    h('div', { class: 'lg-mid' },
      h('div', { class: 'lg-logo' }, svg(LOGO)),
      h('h1', { class: 'lg-brand' }, t('brand')),
      h('p', { class: 'lg-tag' }, t('login.tagline')),
      btn,
      err ? h('p', { class: 'lg-err', role: 'alert' }, t('login.error')) : null),
    h('p', { class: 'lg-note' }, t('login.note')));
}

// ---------- “我”页 ----------
function stats() {
  const map = storage.getReadTime();
  let total = 0; let days = 0;
  for (const v of Object.values(map)) { total += v; if (v > 0) days++; }
  const d = new Date();
  if (!(map[dateKey(d)] > 0)) d.setDate(d.getDate() - 1);
  let streak = 0;
  while ((map[dateKey(d)] || 0) > 0) { streak++; d.setDate(d.getDate() - 1); }
  const week = [];
  let weekTotal = 0;
  for (let i = 6; i >= 0; i--) {
    const x = new Date(); x.setDate(x.getDate() - i);
    const v = map[dateKey(x)] || 0;
    week.push({ v, dow: x.getDay(), today: i === 0 });
    weekTotal += v;
  }
  let reading = 0;
  try { reading = Object.keys(JSON.parse(localStorage.getItem('kitap:v1:progress') || '{}')).length; } catch (e) { /* ignore */ }
  return { total, days, streak, week, weekTotal, reading, shelf: storage.getShelf().length };
}

function duration(sec, cls) {
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const mm = min % 60;
  const num = (n) => h('b', { class: 'me-num' }, String(n));
  const unit = (k) => h('span', { class: 'me-unit' }, t(k));
  return h('div', { class: cls || 'me-dur' },
    hr ? [num(hr), unit('me.h')] : null,
    (mm || !hr) ? [num(mm), unit('me.m')] : null);
}

export function viewMe({ cover }) {
  const s = getSession() || {};
  const st = stats();
  const name = s.name || (s.email || '').split('@')[0] || '';
  const avatar = h('div', { class: 'me-avatar' }, (name[0] || '?').toUpperCase());
  if (s.picture) {
    const img = h('img', { src: s.picture, alt: '', referrerpolicy: 'no-referrer' });
    img.addEventListener('load', () => avatar.replaceChildren(img));
  }

  const head = h('div', { class: 'me-head' }, avatar,
    h('div', { class: 'me-who' },
      h('div', { class: 'me-name', dir: 'auto' }, name),
      h('div', { class: 'me-mail', dir: 'auto' }, s.email || '')));

  const max = Math.max(60, ...st.week.map((x) => x.v));
  const lang = getLang();
  const timeCard = h('section', { class: 'me-card' },
    h('div', { class: 'me-label' }, t('me.total')),
    duration(st.total, 'me-dur big'),
    h('div', { class: 'me-sub' }, t('me.last7') + ' · ', duration(st.weekTotal, 'me-dur sm')),
    h('div', { class: 'me-bars', 'aria-hidden': 'true' },
      st.week.map((x) => h('div', { class: 'me-bar' + (x.today ? ' today' : '') },
        h('i', { style: 'height:' + (x.v > 0 ? Math.max(6, Math.round((x.v / max) * 100)) : 3) + '%', class: x.v > 0 ? 'on' : null }),
        h('b', {}, WEEKDAYS[lang][x.dow])))));

  const cell = (n, key) => h('div', { class: 'me-cell' }, h('b', { class: 'me-num' }, String(n)), h('span', {}, t(key)));
  const grid = h('section', { class: 'me-grid' },
    cell(st.reading, 'me.reading'), cell(st.shelf, 'me.onshelf'), cell(st.days, 'me.days'), cell(st.streak, 'me.streak'));

  const recent = storage.getRecent().slice(0, 5);
  const recentBox = h('section', { class: 'me-card' }, h('h2', { class: 'me-h2' }, t('me.recent')));
  if (!recent.length) recentBox.append(h('p', { class: 'muted' }, t('me.norecent')));
  const refs = [];
  recent.forEach((b) => {
    const holder = h('div', { class: 'me-rc' }, cover({ id: b.bookId, title: b.title }));
    refs.push({ b, holder });
    recentBox.append(h('a', { class: 'me-row', href: '#/read/' + enc(b.bookId) }, holder,
      h('div', { class: 'me-rt' },
        h('div', { class: 'me-rtitle', dir: 'auto' }, b.title),
        h('div', { class: 'me-rauthor', dir: 'auto' }, b.author || ''))));
  });
  if (recent.length) {
    getBooksByIds(recent.map((b) => b.bookId)).then((list) => {
      const m = new Map(list.map((x) => [x.id, x]));
      refs.forEach(({ b, holder }) => { const x = m.get(b.bookId); if (x) holder.replaceChildren(cover({ ...x, title: b.title })); });
    }).catch(() => {});
  }

  const msg = h('div', { class: 'me-msg', role: 'status' });
  const syncBtn = h('button', { class: 'me-btn', type: 'button' }, t('me.sync'));
  syncBtn.addEventListener('click', async () => {
    syncBtn.disabled = true; msg.textContent = '…';
    try { const r = await sync(false); msg.textContent = r === 'ok' ? t('me.synced') : t('me.syncfail'); } catch (e) { msg.textContent = t('me.syncfail'); }
    syncBtn.disabled = false;
  });
  const outBtn = h('button', { class: 'me-btn out', type: 'button', onclick: () => { if (confirm(t('me.signout.confirm'))) signOut(); } }, t('me.signout'));
  const settings = h('section', { class: 'me-card' },
    h('h2', { class: 'me-h2' }, t('me.settings')),
    h('div', { class: 'me-label' }, t('lang.label')),
    langChips(() => { window.dispatchEvent(new HashChangeEvent('hashchange')); }),
    h('div', { class: 'me-acts' }, syncBtn, outBtn), msg);

  return h('div', { class: 'me' }, head, timeCard, grid, recentBox, settings);
}
