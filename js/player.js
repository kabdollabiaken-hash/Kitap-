// 全局听书播放器：播放后所有页面边上都有一个可拖动、可收起的小播放器；点开是完整播放页
// 声音由唯一的一个 <audio> 播放，切换页面（单页应用，不会重新加载）时不会中断
import { storage } from './storage.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { getLang } from './i18n.js';
import { h, enc } from './ui.js';

const TX = {
  kk: { listen: 'Тыңдау', title: 'Тыңдау', speed: 'Жылдамдық', timer: 'Таймер', off: 'Өшірулі', min: ' мин', end: 'Тарау соңы', chapters: 'Тараулар', read: 'Оқу', close: 'Жабу', err: 'Аудио ойнатылмады', prev: 'Алдыңғы', next: 'Келесі', collapse: 'Жасыру' },
  ru: { listen: 'Слушать', title: 'Слушать', speed: 'Скорость', timer: 'Таймер', off: 'Выкл.', min: ' мин', end: 'Конец главы', chapters: 'Главы', read: 'Читать', close: 'Закрыть', err: 'Не удалось воспроизвести', prev: 'Назад', next: 'Далее', collapse: 'Свернуть' },
  zh: { listen: '听书', title: '听书', speed: '倍速', timer: '定时', off: '关闭', min: ' 分钟', end: '本章结束', chapters: '目录', read: '阅读本章', close: '关闭', err: '音频无法播放', prev: '上一章', next: '下一章', collapse: '收起' },
  en: { listen: 'Listen', title: 'Listen', speed: 'Speed', timer: 'Timer', off: 'Off', min: ' min', end: 'End of chapter', chapters: 'Chapters', read: 'Read', close: 'Close', err: 'Could not play audio', prev: 'Previous', next: 'Next', collapse: 'Hide' }
};
const T = () => TX[getLang()] || TX.kk;

const KEY = 'kitap:player:v1';
const RATES = [0.75, 1, 1.25, 1.5, 2];
const TIMERS = [0, 15, 30, 60, -1]; // 分钟；-1 = 听完本章就停

const jread = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && typeof v === 'object' ? v : null; } catch (e) { return null; } };
const jwrite = (o) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* ignore */ } };

const audio = new Audio();
audio.preload = 'none';

const S = {
  bookId: '', book: null, list: [], idx: -1,
  closed: true, collapsed: false, side: 'right', y: null,
  rate: 1, sleepAt: 0, sleepEnd: false, sleepTimer: 0, sleepPreset: 0
};
const listeners = new Set();
const emit = () => listeners.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });

// ---------- 数据 ----------
async function rest(table, params) {
  const url = new URL(SUPABASE_URL + '/rest/v1/' + table);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { apikey: SUPABASE_KEY } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
const queues = new Map();
function loadQueue(bookId) {
  if (queues.has(bookId)) return queues.get(bookId);
  const p = Promise.all([
    rest('books', { id: 'eq.' + bookId, select: 'id,title,author,cover_url,language,script' }),
    rest('chapters', { book_id: 'eq.' + bookId, audio_path: 'not.is.null', select: 'id,chapter_number,title,audio_path,audio_seconds', order: 'chapter_number.asc', limit: '1000' })
  ]).then(([bk, chs]) => ({ book: bk[0] || null, list: chs }));
  queues.set(bookId, p);
  p.catch(() => queues.delete(bookId));
  return p;
}
export const audioChapters = (bookId) => loadQueue(bookId).then((q) => q.list).catch(() => []);
const urlOf = (path) => SUPABASE_URL + '/storage/v1/object/public/audio/' + path;
const cur = () => S.list[S.idx] || null;
const fmt = (s) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const m = Math.floor(s / 60); const r = s % 60;
  return (m >= 60 ? Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') : m) + ':' + String(r).padStart(2, '0');
};
const dur = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : ((cur() && cur().audio_seconds) || 0));

// ---------- 播放控制 ----------
function persist() {
  const c = cur();
  jwrite({ bookId: S.bookId, chapterId: c ? c.id : '', side: S.side, y: S.y, closed: S.closed, collapsed: S.collapsed });
}
let lastSave = 0;
function savePos(force) {
  const c = cur();
  if (!c || !Number.isFinite(audio.currentTime)) return;
  const now = Date.now();
  if (!force && now - lastSave < 5000) return;
  lastSave = now;
  storage.setAudioPos(c.id, audio.currentTime, dur());
}
function setTrack(q, i) {
  savePos(true);
  S.bookId = q.book ? q.book.id : S.bookId; S.book = q.book; S.list = q.list; S.idx = i;
  const c = cur();
  const pos = storage.getAudioPos(c.id);
  const startAt = pos && pos.t > 3 && (!pos.d || pos.t < pos.d - 3) ? pos.t : 0;
  audio.src = urlOf(c.audio_path);
  audio.playbackRate = S.rate;
  audio.addEventListener('loadedmetadata', () => { if (startAt) { try { audio.currentTime = startAt; } catch (e) { /* ignore */ } } }, { once: true });
  updateMedia();
  persist();
  emit();
}
const play = () => audio.play().catch((e) => { if (e && e.name !== 'AbortError') toast(T().err); });
export async function playBook(bookId, chapterId) {
  const q = await loadQueue(bookId);
  if (!q.list.length) return false;
  let i = chapterId ? q.list.findIndex((c) => c.id === chapterId) : -1;
  if (i < 0) {
    const sv = jread();
    i = sv && sv.bookId === bookId ? q.list.findIndex((c) => c.id === sv.chapterId) : -1;
    if (i < 0) i = 0;
  }
  if (!(S.bookId === bookId && S.idx === i && audio.src)) setTrack({ book: q.book || { id: bookId }, list: q.list }, i);
  S.closed = false;
  S.collapsed = false;
  ensureUI();
  persist();
  emit();
  await play();
  return true;
}
export function toggle() { if (!audio.src) return; if (audio.paused) play(); else audio.pause(); }
function go(i) {
  if (i < 0 || i >= S.list.length) return;
  setTrack({ book: S.book, list: S.list }, i);
  play();
}
const next = () => go(S.idx + 1);
const prev = () => { if (audio.currentTime > 5) audio.currentTime = 0; else go(S.idx - 1); };
const seekBy = (d) => { if (audio.src) audio.currentTime = Math.max(0, Math.min(dur() || 1e9, audio.currentTime + d)); };
function closePlayer() {
  audio.pause();
  savePos(true);
  S.closed = true;
  setSleep(0);
  persist();
  emit();
}
function setRate(r) { S.rate = r; audio.playbackRate = r; storage.setPrefs({ audioRate: r }); emit(); }
function setSleep(min) {
  clearTimeout(S.sleepTimer);
  S.sleepAt = 0; S.sleepEnd = false; S.sleepPreset = min;
  if (min > 0) {
    S.sleepAt = Date.now() + min * 60000;
    S.sleepTimer = setTimeout(() => { audio.pause(); S.sleepAt = 0; emit(); }, min * 60000);
  } else if (min === -1) S.sleepEnd = true;
  emit();
}
const sleepValue = () => (S.sleepEnd ? -1 : (S.sleepAt ? Math.round((S.sleepAt - Date.now()) / 60000) : 0));

audio.addEventListener('timeupdate', () => { savePos(false); renderTime(); });
audio.addEventListener('durationchange', renderTime);
audio.addEventListener('play', () => { if (!S.collapsed) scheduleCollapse(); emit(); setState('playing'); });
audio.addEventListener('pause', () => { savePos(true); emit(); setState('paused'); });
audio.addEventListener('ended', () => {
  const c = cur();
  if (c) storage.setAudioPos(c.id, 0, dur());
  if (S.sleepEnd) { S.sleepEnd = false; emit(); return; }
  if (S.idx + 1 < S.list.length) next(); else emit();
});
audio.addEventListener('error', () => { if (audio.src) toast(T().err); });
window.addEventListener('pagehide', () => savePos(true));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') savePos(true); });

// ---------- 锁屏 / 通知栏控制 ----------
const ms = navigator.mediaSession;
function setState(s) { if (ms) { try { ms.playbackState = s; } catch (e) { /* ignore */ } } }
function updateMedia() {
  if (!ms || typeof MediaMetadata === 'undefined') return;
  const c = cur();
  if (!c) return;
  try {
    ms.metadata = new MediaMetadata({
      title: c.title || '', artist: (S.book && S.book.title) || '', album: (S.book && S.book.author) || '',
      artwork: S.book && S.book.cover_url ? [{ src: S.book.cover_url, sizes: '512x512' }] : []
    });
  } catch (e) { /* ignore */ }
}
if (ms) {
  const set = (a, f) => { try { ms.setActionHandler(a, f); } catch (e) { /* ignore */ } };
  set('play', () => play());
  set('pause', () => audio.pause());
  set('previoustrack', () => go(S.idx - 1));
  set('nexttrack', () => next());
  set('seekbackward', () => seekBy(-15));
  set('seekforward', () => seekBy(15));
  set('seekto', (d) => { if (d && Number.isFinite(d.seekTime)) audio.currentTime = d.seekTime; });
}

// ---------- 界面 ----------
const ICON = {
  play: '<path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" stroke="none"/>',
  prev: '<path d="M6 5v14M19 5L9 12l10 7z" fill="currentColor"/>',
  next: '<path d="M18 5v14M5 5l10 7-10 7z" fill="currentColor"/>',
  b15: '<path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4h4"/><text x="12" y="15.5" font-size="7.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif" font-weight="700">15</text>',
  f15: '<path d="M20 12a8 8 0 1 1-2.5-5.8M20 4v4h-4"/><text x="12" y="15.5" font-size="7.5" text-anchor="middle" fill="currentColor" stroke="none" font-family="sans-serif" font-weight="700">15</text>',
  down: '<path d="M6 9l6 6 6-6"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  list: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 3h6"/>',
  book: '<path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5C4.7 20 4 19.3 4 18.5zM20 5.5C20 4.7 19.3 4 18.5 4H13v16h5.5c.8 0 1.5-.7 1.5-1.5z"/>'
};
const svg = (name, size = 24) => {
  const s = document.createElement('span');
  s.className = 'pl-ic';
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ICON[name] + '</svg>';
  return s;
};
const setIcon = (btn, name, size) => btn.replaceChildren(svg(name, size));
const hue = (id) => { let x = 0; for (const ch of String(id || '')) x = (x * 31 + ch.charCodeAt(0)) % 360; return x; };
function coverEl(cls) {
  const b = S.book || {};
  if (b.cover_url) return h('div', { class: cls }, h('img', { src: b.cover_url, alt: '' }));
  return h('div', { class: cls + ' pl-gen', style: 'background:hsl(' + hue(b.id) + ' 35% 28%)' }, h('span', {}, (b.title || '').slice(0, 2)));
}

let el = null; // 界面元素
let collapseT = 0;
function scheduleCollapse() {
  clearTimeout(collapseT);
  if (!el) return;
  collapseT = setTimeout(() => { if (!S.closed && !S.collapsed && !el.full.classList.contains('on') && !audio.paused) { S.collapsed = true; persist(); render(); } }, 5000);
}
function toast(msg) {
  if (!el) return;
  el.toast.textContent = msg;
  el.toast.classList.add('on');
  setTimeout(() => el.toast.classList.remove('on'), 2600);
}

const CSS = `
.pl-ic{display:inline-flex;align-items:center;justify-content:center}
.pl-mini{position:fixed;z-index:9000;top:0;display:none;align-items:center;gap:4px;padding:5px;background:rgba(36,40,52,.94);color:#fff;box-shadow:0 4px 18px rgba(0,0,0,.35);touch-action:none;user-select:none;-webkit-user-select:none;transition:transform .25s}
.pl-mini.on{display:flex}
body.reading .pl-mini{display:none}
.pl-mini.pl-r{right:0;border-radius:32px 0 0 32px;padding-left:6px}
.pl-mini.pl-l{left:0;border-radius:0 32px 32px 0;padding-right:6px}
.pl-mini.pl-c.pl-r{transform:translateX(66%)}
.pl-mini.pl-c.pl-l{transform:translateX(-66%)}
.pl-mini.pl-c .pl-ring,.pl-mini.pl-c .pl-x{display:none}
.pl-cv{width:46px;height:46px;border-radius:50%;overflow:hidden;flex:none;background:#333;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700}
.pl-cv img{width:100%;height:100%;object-fit:cover;display:block}
.pl-spin{animation:pl-rot 12s linear infinite;animation-play-state:paused}
.pl-mini.playing .pl-spin{animation-play-state:running}
@keyframes pl-rot{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.pl-spin{animation:none}}
.pl-ring{position:relative;width:46px;height:46px;flex:none;border:0;background:transparent;color:#fff;cursor:pointer;padding:0}
.pl-ring svg.pr{position:absolute;inset:0;transform:rotate(-90deg)}
.pl-ring .pl-ic{position:absolute;inset:0}
.pl-x{width:30px;height:46px;border:0;background:transparent;color:rgba(255,255,255,.7);cursor:pointer;padding:0}
.pl-full{position:fixed;inset:0;z-index:9500;background:linear-gradient(180deg,#2c3350,#171b2b);color:#fff;display:none;flex-direction:column;overflow:hidden}
.pl-full.on{display:flex}
.pl-top{display:flex;align-items:center;gap:8px;padding:12px 10px}
.pl-top .ttl{flex:1;text-align:center;font-weight:600}
.pl-btn{border:0;background:transparent;color:inherit;cursor:pointer;padding:8px;border-radius:50%;font:inherit}
.pl-body{flex:1;overflow:auto;display:flex;flex-direction:column;align-items:center;padding:8px 24px 24px}
.pl-big{width:min(62vw,320px);aspect-ratio:1;border-radius:18px;overflow:hidden;background:#333;box-shadow:0 12px 36px rgba(0,0,0,.5);margin:8px 0 18px;display:flex;align-items:center;justify-content:center;font-size:48px;font-weight:700}
.pl-big img{width:100%;height:100%;object-fit:cover;display:block}
.pl-t1{font-size:20px;font-weight:700;text-align:center}
.pl-t2{opacity:.7;margin-top:6px;text-align:center}
.pl-bar{width:100%;max-width:520px;margin-top:22px}
.pl-bar input{width:100%;accent-color:#6fd3b3}
.pl-times{display:flex;justify-content:space-between;font-size:13px;opacity:.75}
.pl-ctl{display:flex;align-items:center;justify-content:center;gap:10px;margin-top:10px}
.pl-play{width:68px;height:68px;border-radius:50%;background:#fff;color:#171b2b}
.pl-row{display:flex;justify-content:space-around;width:100%;max-width:520px;margin-top:24px}
.pl-row .pl-btn{display:flex;flex-direction:column;align-items:center;gap:4px;font-size:12px;opacity:.9;border-radius:12px;min-width:64px}
.pl-sheet{position:absolute;inset:auto 0 0 0;max-height:70%;background:#222840;border-radius:18px 18px 0 0;display:none;flex-direction:column}
.pl-sheet.on{display:flex}
.pl-sheet h3{margin:0;padding:14px 18px;font-size:16px}
.pl-sheet .lst{overflow:auto;padding-bottom:16px}
.pl-opt{display:block;width:100%;text-align:start;border:0;background:transparent;color:#fff;padding:12px 18px;font:inherit;cursor:pointer}
.pl-opt[aria-current=true]{color:#6fd3b3;font-weight:700}
.pl-toast{position:fixed;left:50%;bottom:90px;transform:translateX(-50%);background:rgba(0,0,0,.8);color:#fff;padding:8px 14px;border-radius:18px;z-index:9800;display:none;font-size:14px}
.pl-toast.on{display:block}
`;

function ensureUI() {
  if (el) return;
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);

  const mini = h('div', { class: 'pl-mini' });
  const full = h('div', { class: 'pl-full', role: 'dialog', 'aria-modal': 'true' });
  const toastEl = h('div', { class: 'pl-toast', role: 'status' });
  document.body.append(mini, full, toastEl);
  el = { mini, full, toast: toastEl };

  // ---- 小播放器：拖动、贴边、自动收起 ----
  let drag = null;
  mini.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    drag = { x: e.clientX, y: e.clientY, sy: mini.offsetTop, moved: false, c: S.collapsed };
    try { mini.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
  });
  mini.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x; const dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 8) return;
    drag.moved = true;
    mini.style.transition = 'none';
    S.y = Math.max(60, Math.min(window.innerHeight - 120, drag.sy + dy));
    mini.style.top = S.y + 'px';
    const w = window.innerWidth;
    mini.style.transform = 'translateX(' + (S.side === 'right' ? Math.max(0, dx) : Math.min(0, dx)) + 'px)';
    drag.dx = dx; drag.w = w;
  });
  const endDrag = (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    mini.style.transition = '';
    mini.style.transform = '';
    if (!d.moved) { // 点一下：收起时展开；展开时打开完整播放页
      if (S.collapsed) { S.collapsed = false; persist(); render(); if (!audio.paused) scheduleCollapse(); } else openFull();
      return;
    }
    const cx = e.clientX;
    S.side = cx < window.innerWidth / 2 ? 'left' : 'right';
    const toEdge = S.side === 'right' ? window.innerWidth - cx : cx;
    S.collapsed = toEdge < 40 || (Math.abs(d.dx || 0) > 70 && ((S.side === 'right' && d.dx > 0) || (S.side === 'left' && d.dx < 0)));
    persist();
    render();
    if (!S.collapsed && !audio.paused) scheduleCollapse();
  };
  mini.addEventListener('pointerup', endDrag);
  mini.addEventListener('pointercancel', endDrag);

  buildFull();
  render();
}

let refs = {};
function buildFull() {
  const t = T();
  const body = h('div', { class: 'pl-body' });
  const slider = h('input', { type: 'range', min: '0', max: '1000', value: '0', 'aria-label': t.title });
  const cur1 = h('span', {}, '0:00');
  const dur1 = h('span', {}, '0:00');
  slider.addEventListener('input', () => { if (dur()) audio.currentTime = (slider.value / 1000) * dur(); });
  const playBtn = h('button', { class: 'pl-btn pl-play', type: 'button', onclick: toggle });
  const mk = (name, fn, label, size) => { const b = h('button', { class: 'pl-btn', type: 'button', 'aria-label': label, onclick: fn }); setIcon(b, name, size); return b; };
  const speedBtn = h('button', { class: 'pl-btn', type: 'button' });
  const timerBtn = h('button', { class: 'pl-btn', type: 'button' });
  const listBtn = h('button', { class: 'pl-btn', type: 'button' });
  const readBtn = h('a', { class: 'pl-btn', href: '#/', style: 'text-decoration:none;color:inherit' });
  const sheet = h('div', { class: 'pl-sheet' });
  const head = h('div', { class: 'pl-top' },
    mk('down', closeFull, t.close, 26),
    h('div', { class: 'ttl' }, t.title),
    mk('x', () => { closeFull(); closePlayer(); }, t.close, 22));
  refs = { body, slider, cur1, dur1, playBtn, speedBtn, timerBtn, listBtn, readBtn, sheet, cover: h('div'), t1: h('div', { class: 'pl-t1', dir: 'auto' }), t2: h('div', { class: 'pl-t2', dir: 'auto' }) };
  body.append(refs.cover, refs.t1, refs.t2,
    h('div', { class: 'pl-bar' }, slider, h('div', { class: 'pl-times' }, cur1, dur1)),
    h('div', { class: 'pl-ctl' }, mk('prev', prev, t.prev, 26), mk('b15', () => seekBy(-15), '-15', 30), playBtn, mk('f15', () => seekBy(15), '+15', 30), mk('next', next, t.next, 26)),
    h('div', { class: 'pl-row' }, speedBtn, timerBtn, listBtn, readBtn));
  speedBtn.addEventListener('click', () => openSheet('speed'));
  timerBtn.addEventListener('click', () => openSheet('timer'));
  listBtn.addEventListener('click', () => openSheet('list'));
  readBtn.addEventListener('click', () => { closeFull(); });
  el.full.append(head, body, sheet);
  el.full.addEventListener('click', (e) => { if (!sheet.contains(e.target) && !e.target.closest('.pl-row') && sheet.classList.contains('on')) sheet.classList.remove('on'); });
}
function openSheet(kind) {
  const t = T();
  const sh = refs.sheet;
  const close = () => sh.classList.remove('on');
  const opt = (label, on, fn) => h('button', { class: 'pl-opt', type: 'button', 'aria-current': on ? 'true' : null, onclick: () => { fn(); close(); } }, label);
  let title; let items;
  if (kind === 'speed') {
    title = t.speed;
    items = RATES.map((r) => opt(r + '×', r === S.rate, () => setRate(r)));
  } else if (kind === 'timer') {
    title = t.timer;
    items = TIMERS.map((m) => opt(m === 0 ? t.off : (m === -1 ? t.end : m + t.min), m === S.sleepPreset, () => setSleep(m)));
  } else {
    title = t.chapters;
    items = S.list.map((c, i) => opt(c.chapter_number + '. ' + c.title, i === S.idx, () => go(i)));
  }
  const lst = h('div', { class: 'lst' }, items);
  sh.replaceChildren(h('h3', {}, title), lst);
  sh.classList.add('on');
  const on = lst.querySelector('[aria-current]');
  if (on) on.scrollIntoView({ block: 'center' });
}
function openFull() {
  ensureUI();
  el.full.classList.add('on');
  refs.sheet.classList.remove('on');
  renderFull();
  renderTime();
}
export const open = openFull;
function closeFull() {
  if (!el) return;
  el.full.classList.remove('on');
  if (!audio.paused) scheduleCollapse();
}

// ---------- 刷新界面 ----------
let ring = null;
function render() {
  if (!el) return;
  const c = cur();
  const show = !S.closed && !!c;
  el.mini.classList.toggle('on', show);
  if (!show) { el.full.classList.remove('on'); return; }
  el.mini.classList.toggle('playing', !audio.paused);
  el.mini.classList.toggle('pl-r', S.side === 'right');
  el.mini.classList.toggle('pl-l', S.side === 'left');
  el.mini.classList.toggle('pl-c', S.collapsed);
  const y = S.y == null ? Math.max(120, window.innerHeight - 220) : Math.min(S.y, window.innerHeight - 120);
  el.mini.style.top = y + 'px';

  const cv = coverEl('pl-cv pl-spin');
  const btn = h('button', { class: 'pl-ring', type: 'button', 'aria-label': audio.paused ? 'play' : 'pause', onclick: (e) => { e.stopPropagation(); toggle(); } });
  const R = 21; const C = 2 * Math.PI * R;
  btn.innerHTML = '<svg class="pr" width="46" height="46" viewBox="0 0 46 46"><circle cx="23" cy="23" r="' + R + '" fill="none" stroke="rgba(255,255,255,.25)" stroke-width="3"/><circle class="pg" cx="23" cy="23" r="' + R + '" fill="none" stroke="#6fd3b3" stroke-width="3" stroke-linecap="round" stroke-dasharray="' + C + '" stroke-dashoffset="' + C + '"/></svg>';
  btn.appendChild(svg(audio.paused ? 'play' : 'pause', 22));
  ring = { pg: btn.querySelector('.pg'), C };
  const x = h('button', { class: 'pl-x', type: 'button', 'aria-label': T().close, onclick: (e) => { e.stopPropagation(); closePlayer(); } });
  setIcon(x, 'x', 18);
  const kids = S.side === 'right' ? [cv, btn, x] : [x, btn, cv];
  el.mini.replaceChildren(...kids);
  renderTime();
  renderFull();
}
function renderTime() {
  const d = dur();
  const t = audio.currentTime || 0;
  if (ring) ring.pg.style.strokeDashoffset = String(ring.C * (1 - (d ? Math.min(1, t / d) : 0)));
  if (el && el.full.classList.contains('on')) {
    refs.cur1.textContent = fmt(t);
    refs.dur1.textContent = fmt(d);
    if (document.activeElement !== refs.slider) refs.slider.value = String(d ? Math.round((t / d) * 1000) : 0);
  }
}
function renderFull() {
  if (!el || !refs.body) return;
  const c = cur();
  if (!c) return;
  const t = T();
  const cv = coverEl('pl-big');
  refs.cover.replaceWith(cv);
  refs.cover = cv;
  refs.t1.textContent = (S.book && S.book.title) || '';
  refs.t2.textContent = c.chapter_number + '. ' + c.title;
  setIcon(refs.playBtn, audio.paused ? 'play' : 'pause', 34);
  refs.speedBtn.replaceChildren(h('b', {}, S.rate + '×'), t.speed);
  const v = sleepValue();
  refs.timerBtn.replaceChildren(svg('timer', 22), v === -1 ? t.end : (v > 0 ? v + t.min : t.timer));
  refs.listBtn.replaceChildren(svg('list', 22), t.chapters);
  refs.readBtn.replaceChildren(svg('book', 22), t.read);
  refs.readBtn.setAttribute('href', '#/read/' + enc(S.bookId) + '/' + enc(c.id));
}
listeners.add(() => { render(); });

// ---------- 对外接口 ----------
export const player = {
  playBook, playChapter: playBook, toggle, open: openFull, audioChapters,
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  state() { const c = cur(); return { bookId: S.bookId, chapterId: c ? c.id : '', playing: !audio.paused && !S.closed, active: !S.closed && !!c }; },
  // 页面启动时调用：恢复上次听的书（暂停状态），小播放器出现在边上
  async init() {
    const sv = jread();
    S.rate = (storage.getPrefs().audioRate) || 1;
    if (sv) { S.side = sv.side === 'left' ? 'left' : 'right'; S.y = Number.isFinite(sv.y) ? sv.y : null; S.collapsed = !!sv.collapsed; }
    if (!sv || sv.closed || !sv.bookId) return;
    try {
      const q = await loadQueue(sv.bookId);
      const i = q.list.findIndex((c) => c.id === sv.chapterId);
      if (i < 0) return;
      setTrack({ book: q.book || { id: sv.bookId }, list: q.list }, i);
      S.closed = false;
      ensureUI();
      render();
    } catch (e) { /* 没网络：不显示 */ }
  }
};
