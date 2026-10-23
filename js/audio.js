// 有声书播放条：音频文件放在 Supabase Storage 的公开存储桶 audio 里
import { t } from './i18n.js';
import './messages-audio.js';
import { storage } from './storage.js';
import { h } from './ui.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

if (!document.querySelector('link[data-audio]')) {
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = './css/audio.css';
  l.setAttribute('data-audio', '1');
  document.head.appendChild(l);
}

const RATES = [0.75, 1, 1.25, 1.5, 2];
const FLAG = 'kitap:autoplay';

export const audioUrl = (path) => SUPABASE_URL.replace(/\/+$/, '') + '/storage/v1/object/public/audio/' + String(path).split('/').map(encodeURIComponent).join('/');

const ico = (inner) => {
  const s = document.createElement('span');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">' + inner + '</svg>';
  return s;
};
const PLAY = '<path d="M8 5v14l11-7z"/>';
const PAUSE = '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';
const fmt = (s) => {
  if (!Number.isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const hh = Math.floor(s / 3600); const mm = Math.floor((s % 3600) / 60); const ss = s % 60;
  const p = (n) => String(n).padStart(2, '0');
  return hh ? hh + ':' + p(mm) + ':' + p(ss) : mm + ':' + p(ss);
};

// 有音频的章节 ID 列表（用来决定“播完后要不要自动接下一章”）
async function chaptersWithAudio(bookId) {
  try {
    const url = new URL(SUPABASE_URL + '/rest/v1/chapters');
    url.searchParams.set('select', 'id');
    url.searchParams.set('book_id', 'eq.' + bookId);
    url.searchParams.set('audio_path', 'not.is.null');
    const r = await fetch(url, { headers: { apikey: SUPABASE_KEY } });
    if (!r.ok) return new Set();
    return new Set((await r.json()).map((x) => x.id));
  } catch (e) { return new Set(); }
}

export function createAudio({ path, chapterId, bookId, nextId, bookTitle, chapterTitle, onNext }) {
  const au = new Audio();
  au.preload = 'metadata';
  au.src = audioUrl(path);
  let rate = storage.getPrefs().audioRate || 1;
  au.playbackRate = rate;
  let dragging = false;
  let lastSave = 0;
  let dead = false;

  const playBtn = h('button', { class: 'au-play', type: 'button', 'aria-label': t('audio.play') }, ico(PLAY));
  const back = h('button', { class: 'au-skip', type: 'button', 'aria-label': t('audio.back') }, ico('<path d="M12 5V2L7 6l5 4V7a6 6 0 11-6 6H4a8 8 0 108-8z"/>'), '15');
  const fwd = h('button', { class: 'au-skip', type: 'button', 'aria-label': t('audio.fwd') }, ico('<path d="M12 5V2l5 4-5 4V7a6 6 0 106 6h2a8 8 0 11-8-8z"/>'), '15');
  const range = h('input', { type: 'range', min: '0', max: '1000', value: '0', step: '1', 'aria-label': t('audio.seek') });
  const cur = h('span', {}, '0:00');
  const tot = h('span', {}, '0:00');
  const rateBtn = h('button', { class: 'au-rate', type: 'button', 'aria-label': t('audio.speed') }, rate + '×');
  const err = h('div', { class: 'au-err', role: 'alert', hidden: true }, t('audio.error'));
  const row = h('div', { class: 'au', role: 'group', 'aria-label': t('audio.label') },
    back, playBtn, fwd,
    h('div', { class: 'au-mid' }, range, h('div', { class: 'au-time' }, cur, tot)),
    rateBtn);
  const el = h('div', {}, row, err);

  const dur = () => (Number.isFinite(au.duration) ? au.duration : 0);
  const draw = () => {
    cur.textContent = fmt(au.currentTime);
    tot.textContent = fmt(dur());
    if (!dragging) range.value = dur() ? String(Math.round((au.currentTime / dur()) * 1000)) : '0';
  };
  const save = (force) => {
    const now = Date.now();
    if (!force && now - lastSave < 5000) return;
    lastSave = now;
    if (au.currentTime > 1) storage.setAudioPos(chapterId, au.currentTime, dur());
  };
  const setPlayIcon = () => {
    playBtn.replaceChildren(ico(au.paused ? PLAY : PAUSE));
    playBtn.setAttribute('aria-label', t(au.paused ? 'audio.play' : 'audio.pause'));
  };

  playBtn.addEventListener('click', () => {
    if (au.paused) au.play().catch(() => { err.hidden = false; }); else au.pause();
  });
  const skip = (d) => { au.currentTime = Math.max(0, Math.min(dur() || 1e9, au.currentTime + d)); draw(); };
  back.addEventListener('click', () => skip(-15));
  fwd.addEventListener('click', () => skip(15));
  rateBtn.addEventListener('click', () => {
    rate = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    au.playbackRate = rate;
    rateBtn.textContent = rate + '×';
    storage.setPrefs({ audioRate: rate });
  });
  range.addEventListener('input', () => { dragging = true; cur.textContent = fmt((range.value / 1000) * dur()); });
  range.addEventListener('change', () => { if (dur()) au.currentTime = (range.value / 1000) * dur(); dragging = false; draw(); });

  au.addEventListener('loadedmetadata', () => {
    const p = storage.getAudioPos(chapterId);
    if (p && p.t > 5 && p.t < dur() - 5) au.currentTime = p.t;
    draw();
  });
  au.addEventListener('timeupdate', () => { draw(); save(false); });
  au.addEventListener('play', setPlayIcon);
  au.addEventListener('pause', () => { setPlayIcon(); save(true); });
  au.addEventListener('error', () => { err.hidden = false; });
  au.addEventListener('playing', () => { err.hidden = true; });
  au.addEventListener('ended', async () => {
    storage.setAudioPos(chapterId, 0, dur());
    setPlayIcon();
    if (!nextId || dead) return;
    const set = await chaptersWithAudio(bookId);
    if (dead || !set.has(nextId)) return;
    try { sessionStorage.setItem(FLAG, nextId); } catch (e) { /* ignore */ }
    onNext();
  });

  // 锁屏 / 通知栏的播放控制
  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: chapterTitle, artist: bookTitle, album: bookTitle });
      navigator.mediaSession.setActionHandler('play', () => { au.play().catch(() => {}); });
      navigator.mediaSession.setActionHandler('pause', () => au.pause());
      navigator.mediaSession.setActionHandler('seekbackward', () => skip(-15));
      navigator.mediaSession.setActionHandler('seekforward', () => skip(15));
      navigator.mediaSession.setActionHandler('seekto', (d) => { if (d && Number.isFinite(d.seekTime)) au.currentTime = d.seekTime; });
    } catch (e) { /* 浏览器不支持就算了 */ }
  }

  // 上一章播完自动接着播
  try {
    if (sessionStorage.getItem(FLAG) === chapterId) {
      sessionStorage.removeItem(FLAG);
      au.play().catch(() => {});
    }
  } catch (e) { /* ignore */ }

  return {
    el,
    destroy() {
      dead = true;
      save(true);
      au.pause();
      au.removeAttribute('src');
      au.load();
      if ('mediaSession' in navigator) {
        try { for (const a of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto']) navigator.mediaSession.setActionHandler(a, null); navigator.mediaSession.metadata = null; } catch (e) { /* ignore */ }
      }
    }
  };
}
