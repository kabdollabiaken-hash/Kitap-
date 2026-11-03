// “我”页 + 登录页。只读写本机存储，不改书籍内容。
import { t, getLang, setLang, LANGS } from './i18n.js';
import { storage } from './storage.js';
import { h, enc } from './ui.js';
import { getBooksByIds } from './api-extra.js';
import { getSession, login, signOut, sync, takeAuthError } from './auth.js';
import { isStandalone, isIOS, canPrompt, promptInstall, onInstallChange } from './pwa.js';
import { openNotes } from './notes.js';

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

// ---------- 反馈邮箱 / 版本 ----------
const FEEDBACK_EMAIL = 'kapkaz595@gmail.com'; // 在这里填你的反馈邮箱，例如 'name@gmail.com'；留空则不显示“反馈”按钮
const APP_VERSION = '1.0';

const ME_TX = {
  kk: {
    feedback: 'Кері байланыс', about: 'Қолданба туралы', close: 'Жабу', installed: 'Орнатылған',
    version: 'Нұсқа', copyright: 'Авторлық құқық', privacy: 'Құпиялылық',
    copyrightText: 'Кітаптардың авторлық құқығы авторларға және құқық иелеріне тиесілі. Әр кітаптың құқық көзі кітап бетінде көрсетілген.',
    privacyText: 'Сөре, оқу барысы, оқу уақыты және баптаулар осы құрылғыда сақталады, ал кірген соң Google аккаунтыңызбен бұлтқа синхрондалады. Біз тек кіру үшін Google поштаңыз бен атыңызды сақтаймыз.'
  },
  ru: {
    feedback: 'Обратная связь', about: 'О приложении', close: 'Закрыть', installed: 'Установлено',
    version: 'Версия', copyright: 'Авторские права', privacy: 'Конфиденциальность',
    copyrightText: 'Авторские права на книги принадлежат авторам и правообладателям. Источник прав для каждой книги указан на её странице.',
    privacyText: 'Полка, прогресс чтения, время чтения и настройки хранятся на этом устройстве, а после входа синхронизируются с вашим аккаунтом Google в облаке. Мы храним только вашу почту и имя из Google, нужные для входа.'
  },
  zh: {
    feedback: '反馈', about: '关于', close: '关闭', installed: '已安装',
    version: '版本', copyright: '版权', privacy: '隐私',
    copyrightText: '书籍的版权归原作者和版权方所有。每本书的版权来源显示在书籍详情页。',
    privacyText: '书架、阅读进度、阅读时长和偏好保存在本机，登录后会同步到你的谷歌账号对应的云端。我们只保存登录用的谷歌邮箱和昵称。'
  },
  en: {
    feedback: 'Feedback', about: 'About', close: 'Close', installed: 'Installed',
    version: 'Version', copyright: 'Copyright', privacy: 'Privacy',
    copyrightText: 'Book copyrights belong to the authors and rights holders. The source of rights for each book is shown on its page.',
    privacyText: 'Your shelf, reading progress, reading time and settings are stored on this device and, once you sign in, synced to the cloud under your Google account. We only keep the Google email and name used for sign-in.'
  }
};
const mx = () => ME_TX[getLang()] || ME_TX.kk;

// ---------- 勋章 ----------
// 文案放在这里，不依赖 i18n.js，直接粘贴即可用
const BD = {
  zh: {
    title: '勋章',
    cat: { time: '阅读时长', books: '阅读书籍', fin: '读完书籍', days: '阅读天数', streak: '连续阅读' },
    unit: { time: '小时', books: '本', fin: '本', days: '天', streak: '天' },
    reach: (n, u) => '累积达到' + n + u,
    left: (n, u, c) => (c === 'fin' ? '再读完' : c === 'streak' ? '再连续阅读' : '再阅读') + n + u + '可得'
  },
  en: {
    title: 'Badges',
    cat: { time: 'Reading time', books: 'Books read', fin: 'Books finished', days: 'Reading days', streak: 'Streak' },
    unit: { time: 'hours', books: 'books', fin: 'books', days: 'days', streak: 'days' },
    reach: (n, u) => n + ' ' + u,
    left: (n, u) => n + ' more ' + u + ' to unlock'
  },
  ru: {
    title: 'Награды',
    cat: { time: 'Время чтения', books: 'Прочитано книг', fin: 'Дочитано книг', days: 'Дни чтения', streak: 'Серия' },
    unit: { time: 'ч', books: 'книг', fin: 'книг', days: 'дн.', streak: 'дн.' },
    reach: (n, u) => n + ' ' + u,
    left: (n, u) => 'Ещё ' + n + ' ' + u
  },
  kk: {
    title: 'Медальдар',
    cat: { time: 'Оқу уақыты', books: 'Оқылған кітаптар', fin: 'Аяқталған кітаптар', days: 'Оқу күндері', streak: 'Үздіксіз оқу' },
    unit: { time: 'сағат', books: 'кітап', fin: 'кітап', days: 'күн', streak: 'күн' },
    reach: (n, u) => n + ' ' + u,
    left: (n, u) => 'Тағы ' + n + ' ' + u
  }
};
const bx = () => BD[getLang()] || BD.kk;

// 每类 6 档，档位越高形状越复杂：圆 → 五边形 → 六边形 → 七边形 → 八边形 → 花边
const BADGE_CATS = [
  { key: 'time', color: ['#7fd0f0', '#2f8fd0'], tiers: [1, 10, 50, 100, 500, 1000] },   // 单位：小时
  { key: 'books', color: ['#8fe3a8', '#3fae6e'], tiers: [1, 5, 10, 50, 100, 500] },
  { key: 'fin', color: ['#f6a66f', '#df6d2f'], tiers: [1, 5, 10, 50, 100, 200] },
  { key: 'days', color: ['#f7cf6a', '#e29a1e'], tiers: [3, 7, 30, 100, 200, 365] },
  { key: 'streak', color: ['#f48fb1', '#d8396b'], tiers: [3, 7, 30, 90, 180, 365] }
];
const PREVIEW_COUNT = 3; // 主页卡片上显示几个

let badgeUid = 0;
function badgePoints(tier) {
  const cx = 50; const cy = 50;
  if (tier <= 0) return null; // 圆
  if (tier >= 5) { // 花边：24 个点交替半径
    const pts = [];
    for (let i = 0; i < 24; i++) {
      const a = (Math.PI * 2 * i) / 24 - Math.PI / 2;
      const r = i % 2 ? 41 : 47;
      pts.push((cx + r * Math.cos(a)).toFixed(1) + ',' + (cy + r * Math.sin(a)).toFixed(1));
    }
    return pts.join(' ');
  }
  const sides = tier + 4; // 5,6,7,8
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = (Math.PI * 2 * i) / sides - Math.PI / 2;
    pts.push((cx + 46 * Math.cos(a)).toFixed(1) + ',' + (cy + 46 * Math.sin(a)).toFixed(1));
  }
  return pts.join(' ');
}

function badgeSvg(tier, colors, num, earned, size) {
  const id = 'bg' + (++badgeUid);
  const pts = badgePoints(tier);
  const shape = pts
    ? '<polygon points="' + pts + '" stroke-linejoin="round"'
    : '<circle cx="50" cy="50" r="46"';
  const fill = earned ? 'url(#' + id + ')' : 'rgba(128,128,128,.14)';
  const stroke = earned ? '#d9b45a' : 'rgba(128,128,128,.45)';
  const shapeEl = shape + ' fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + (earned ? 3 : 2) + '"/>';
  const grad = earned
    ? '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + colors[0] + '"/><stop offset="1" stop-color="' + colors[1] + '"/></linearGradient></defs>'
    : '';
  const shine = earned ? '<ellipse cx="38" cy="30" rx="22" ry="10" fill="#fff" opacity=".22"/>' : '';
  const s = String(num);
  const fs = s.length >= 4 ? 24 : s.length === 3 ? 28 : 34;
  const txt = '<text x="50" y="60" text-anchor="middle" font-size="' + fs + '" font-weight="800" font-family="system-ui,sans-serif" fill="' + (earned ? '#fff' : 'rgba(128,128,128,.7)') + '"' + (earned ? ' stroke="rgba(0,0,0,.18)" stroke-width="1" paint-order="stroke"' : '') + '>' + s + '</text>';
  const px = size || 68;
  return '<svg width="' + px + '" height="' + px + '" viewBox="0 0 100 100">' + grad + shapeEl + shine + txt + '</svg>';
}

function ensureBadgeStyle() {
  if (document.getElementById('me-badge-style')) return;
  const st = document.createElement('style');
  st.id = 'me-badge-style';
  st.textContent = [
    // 主页卡片
    '.bd-card{cursor:pointer;-webkit-tap-highlight-color:transparent}',
    '.bd-head{display:flex;align-items:center;justify-content:space-between}',
    '.bd-head .me-h2{margin:0}',
    '.bd-count{font-size:13px;opacity:.65;font-weight:400;margin-left:6px}',
    '.bd-arrow{opacity:.5;font-size:20px;line-height:1}',
    '.bd-prev{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:12px}',
    '.bd-pv{display:flex;flex-direction:column;align-items:center;text-align:center}',
    '.bd-pv .bd-ic{line-height:0}',
    '.bd-pv .bd-lb{font-size:12px;margin-top:4px;line-height:1.3}',
    '.bd-pv.off .bd-lb{opacity:.5}',
    // 弹窗里的完整列表
    '.bd-cat{margin-top:18px}',
    '.bd-cat:first-of-type{margin-top:8px}',
    '.bd-cat-t{font-weight:600;margin-bottom:6px}',
    '.bd-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:4px 6px}',
    '.bd-cell{position:relative;display:flex;flex-direction:column;align-items:center;text-align:center;padding-top:26px}',
    '.bd-cell .bd-ic{line-height:0}',
    '.bd-cell .bd-lb{font-size:12px;margin-top:4px;line-height:1.3}',
    '.bd-cell.off .bd-lb{opacity:.5}',
    '.bd-pill{position:absolute;top:0;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:11px;padding:3px 8px;border-radius:10px;background:rgba(128,128,128,.16)}'
  ].join('\n');
  document.head.append(st);
}

function openFeedback() {
  if (!FEEDBACK_EMAIL) return;
  const subject = 'Shuhyla ' + APP_VERSION;
  const body = '\n\n---\nShuhyla ' + APP_VERSION + ' · ' + getLang();
  location.href = 'mailto:' + FEEDBACK_EMAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
}

function openAbout() {
  const tx = mx();
  const close = () => ov.remove();
  const sec = (title, text) => h('div', { style: 'margin-top:16px' },
    h('div', { style: 'font-weight:600;margin-bottom:4px' }, title),
    h('div', { style: 'color:#555', dir: 'auto' }, text));
  const ov = h('div', {
    role: 'dialog', 'aria-modal': 'true',
    style: 'position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center',
    onclick: (e) => { if (e.target === ov) close(); }
  },
  h('div', { style: 'background:#fff;color:#222;width:100%;max-width:560px;max-height:85vh;overflow:auto;border-radius:20px 20px 0 0;padding:20px 20px calc(28px + env(safe-area-inset-bottom));line-height:1.6' },
    h('div', { style: 'display:flex;justify-content:space-between;align-items:center' },
      h('strong', { style: 'font-size:18px' }, tx.about),
      h('button', { type: 'button', 'aria-label': tx.close, onclick: close, style: 'background:none;border:0;font-size:20px;padding:6px 10px;cursor:pointer;color:inherit' }, '✕')),
    sec(t('brand'), tx.version + ' ' + APP_VERSION),
    sec(tx.copyright, tx.copyrightText),
    sec(tx.privacy, tx.privacyText)));
  document.body.append(ov);
}

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
// 读完的书：按进度记录里的常见字段尽力判断。
// 如果你的进度数据结构不同，只需要改 isFinished 这一个函数。
function isFinished(v) {
  if (!v || typeof v !== 'object') return false;
  if (v.done || v.finished || v.completed) return true;
  const p = v.percent ?? v.pct ?? v.progress ?? v.ratio;
  if (typeof p === 'number') return p >= 0.98 || p >= 98;
  return false;
}

// 历史最长连续阅读天数（勋章一旦获得不会因为断签而消失）
function longestStreak(map) {
  const keys = Object.keys(map).filter((k) => map[k] > 0).sort();
  let best = 0; let run = 0; let prev = null;
  for (const k of keys) {
    const [y, m, d] = k.split('-').map(Number);
    const cur = new Date(y, m - 1, d);
    if (prev && Math.round((cur - prev) / 86400000) === 1) run++; else run = 1;
    if (run > best) best = run;
    prev = cur;
  }
  return best;
}

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
  let reading = 0; let finished = 0;
  try {
    const prog = JSON.parse(localStorage.getItem('kitap:v1:progress') || '{}');
    const vals = Object.values(prog);
    reading = vals.length;
    finished = vals.filter(isFinished).length;
  } catch (e) { /* ignore */ }
  return {
    total, days, streak, week, weekTotal, reading, finished,
    bestStreak: Math.max(streak, longestStreak(map)),
    shelf: storage.getShelf().length
  };
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

function badgeValues(st) {
  return {
    time: st.total / 3600,
    books: st.reading,
    fin: st.finished,
    days: st.days,
    streak: st.bestStreak
  };
}

function badgeCounts(st) {
  const cur = badgeValues(st);
  let earned = 0; let total = 0;
  BADGE_CATS.forEach((cat) => cat.tiers.forEach((n) => { total++; if (cur[cat.key] >= n) earned++; }));
  return { earned, total };
}

// 主页上只显示 PREVIEW_COUNT 个：优先显示各类里已获得的最高档，不够再用“下一个目标”补
function previewItems(st) {
  const cur = badgeValues(st);
  const got = []; const goals = [];
  BADGE_CATS.forEach((cat) => {
    const val = cur[cat.key];
    let hi = -1;
    cat.tiers.forEach((n, i) => { if (val >= n) hi = i; });
    if (hi >= 0) got.push({ cat, i: hi, earned: true });
    const nx = hi + 1;
    if (nx < cat.tiers.length) goals.push({ cat, i: nx, earned: false });
  });
  got.sort((a, b) => b.i - a.i);
  return got.concat(goals).slice(0, PREVIEW_COUNT);
}

// 弹窗：显示全部勋章
function openBadges(st) {
  ensureBadgeStyle();
  const tx = bx();
  const cur = badgeValues(st);
  const { earned: earnedAll, total: totalAll } = badgeCounts(st);
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { document.removeEventListener('keydown', onKey); ov.remove(); };

  const blocks = BADGE_CATS.map((cat) => {
    const val = cur[cat.key];
    const unit = tx.unit[cat.key];
    let nextMarked = false;
    const cells = cat.tiers.map((n, i) => {
      const earned = val >= n;
      let pill = null;
      if (!earned && !nextMarked) {
        nextMarked = true;
        const remain = Math.max(1, Math.ceil(n - val));
        pill = h('div', { class: 'bd-pill', style: 'color:' + cat.color[1] }, tx.left(remain, unit, cat.key));
      }
      return h('div', { class: 'bd-cell' + (earned ? '' : ' off') },
        pill,
        svg(badgeSvg(i, cat.color, n, earned)),
        h('div', { class: 'bd-lb' }, tx.reach(n, unit)));
    });
    return h('div', { class: 'bd-cat' },
      h('div', { class: 'bd-cat-t' }, tx.cat[cat.key]),
      h('div', { class: 'bd-grid' }, cells));
  });

  const ov = h('div', {
    role: 'dialog', 'aria-modal': 'true',
    style: 'position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center',
    onclick: (e) => { if (e.target === ov) close(); }
  },
  h('div', { style: 'background:#fff;color:#222;width:100%;max-width:560px;max-height:88vh;overflow:auto;border-radius:20px 20px 0 0;padding:20px 20px calc(28px + env(safe-area-inset-bottom));line-height:1.5' },
    h('div', { style: 'display:flex;justify-content:space-between;align-items:center' },
      h('strong', { style: 'font-size:18px' }, tx.title, h('span', { class: 'bd-count' }, earnedAll + '/' + totalAll)),
      h('button', { type: 'button', 'aria-label': mx().close, onclick: close, style: 'background:none;border:0;font-size:20px;padding:6px 10px;cursor:pointer;color:inherit' }, '✕')),
    blocks));
  document.addEventListener('keydown', onKey);
  document.body.append(ov);
}

// 主页卡片：只显示 3 个，点击打开弹窗
function badgesCard(st) {
  ensureBadgeStyle();
  const tx = bx();
  const { earned, total } = badgeCounts(st);
  const items = previewItems(st);
  const prev = h('div', { class: 'bd-prev' }, items.map((it) => {
    const n = it.cat.tiers[it.i];
    return h('div', { class: 'bd-pv' + (it.earned ? '' : ' off') },
      svg(badgeSvg(it.i, it.cat.color, n, it.earned, 60)),
      h('div', { class: 'bd-lb' }, tx.cat[it.cat.key]));
  }));
  const open = () => openBadges(st);
  return h('section', {
    class: 'me-card bd-card', role: 'button', tabindex: '0',
    onclick: open,
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } }
  },
  h('div', { class: 'bd-head' },
    h('h2', { class: 'me-h2' }, tx.title, h('span', { class: 'bd-count' }, earned + '/' + total)),
    h('span', { class: 'bd-arrow', 'aria-hidden': 'true' }, '›')),
  prev);
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

  const badges = badgesCard(st);

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
  // 安装到手机主屏幕
  const installBox = h('div', { class: 'me-install' });
  const drawInstall = () => {
    installBox.replaceChildren();
    if (isStandalone()) {
      installBox.append(h('button', { class: 'me-btn', type: 'button', disabled: true }, mx().installed));
      return;
    }
    const hint = h('p', { class: 'me-hint', hidden: true });
    installBox.append(
      h('button', {
        class: 'me-btn', type: 'button',
        onclick: async () => {
          if (canPrompt()) { await promptInstall(); drawInstall(); return; }
          hint.textContent = t(isIOS() ? 'me.install.ios' : 'me.install.menu');
          hint.hidden = false;
        }
      }, t('me.install')),
      hint);
  };
  drawInstall();
  onInstallChange(drawInstall);

  const settings = h('section', { class: 'me-card' },
    h('h2', { class: 'me-h2' }, t('me.settings')),
    h('div', { class: 'me-acts' }, syncBtn, outBtn), msg,
    h('div', { class: 'me-label', style: 'margin-top:16px' }, t('me.install.title')), installBox);

  const linkRow = (icon, label, onclick) => h('button', { class: 'me-link', type: 'button', onclick },
    h('span', { class: 'me-link-i', 'aria-hidden': 'true' }, icon),
    h('span', { class: 'me-link-t' }, label),
    h('span', { class: 'me-link-a', 'aria-hidden': 'true' }, '›'));
  const notesRow = linkRow('✎', t('notes.title'), () => openNotes());
  const feedbackRow = FEEDBACK_EMAIL ? linkRow('✉', mx().feedback, openFeedback) : null;
  const aboutRow = linkRow('ⓘ', mx().about, openAbout);

  return h('div', { class: 'me' }, head, timeCard, grid, badges, notesRow, recentBox, settings, feedbackRow, aboutRow);
}
