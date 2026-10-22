// 谷歌登录 + 云端同步（书架、最近阅读、进度、阅读时长、偏好）
// 不改动原有代码：直接读写本机存储，登录与否都不影响阅读。
import * as CFG from './config.js';
const pick = (re) => { const k = Object.keys(CFG).find((x) => re.test(x)); return k ? CFG[k] : ''; };
const SUPABASE_URL = pick(/_URL$/);
const ANON_KEY = pick(/_KEY$/);

const P = 'kitap:v1:';
const KEYS = ['shelf', 'recent', 'progress', 'readtime', 'prefs'];
const SESS = 'kitap:auth';
const META = 'kitap:syncmeta';

const T = {
  kk: { login: 'Google арқылы кіру', out: 'Шығу', sync: 'Қазір синхрондау', ok: 'Синхрондалды', fail: 'Қате: ', title: 'Аккаунт' },
  ru: { login: 'Войти через Google', out: 'Выйти', sync: 'Синхронизировать', ok: 'Синхронизировано', fail: 'Ошибка: ', title: 'Аккаунт' },
  zh: { login: '用谷歌账号登录', out: '退出登录', sync: '立即同步', ok: '已同步', fail: '出错：', title: '账号' },
  en: { login: 'Sign in with Google', out: 'Sign out', sync: 'Sync now', ok: 'Synced', fail: 'Error: ', title: 'Account' }
};
const lang = () => { try { const p = JSON.parse(localStorage.getItem(P + 'prefs')); return T[p && p.lang] ? p.lang : 'kk'; } catch (e) { return 'kk'; } };
const tr = () => T[lang()];

const jget = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; } };
const jset = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };

// ---------- 合并（两边都改过时） ----------
export function merge(a, b) { // a = 本机，b = 云端
  const out = {};
  const sh = new Map();
  for (const x of [...(b.shelf || []), ...(a.shelf || [])]) {
    if (x && x.bookId && !sh.has(x.bookId)) sh.set(x.bookId, x);
  }
  out.shelf = [...sh.values()].sort((x, y) => (y.addedAt || 0) - (x.addedAt || 0));
  const rc = new Map();
  for (const x of [...(b.recent || []), ...(a.recent || [])]) {
    if (!x || !x.bookId) continue;
    const o = rc.get(x.bookId);
    if (!o || (x.ts || 0) > (o.ts || 0)) rc.set(x.bookId, x);
  }
  out.recent = [...rc.values()].sort((x, y) => (y.ts || 0) - (x.ts || 0)).slice(0, 20);
  out.progress = { ...(b.progress || {}) };
  for (const [k, v] of Object.entries(a.progress || {})) {
    const o = out.progress[k];
    if (!o || (v.ts || 0) > (o.ts || 0)) out.progress[k] = v;
  }
  out.readtime = { ...(b.readtime || {}) };
  for (const [k, v] of Object.entries(a.readtime || {})) out.readtime[k] = Math.max(v, out.readtime[k] || 0);
  out.prefs = a.prefs || b.prefs || null;
  return out;
}

const snapshot = () => { const o = {}; for (const k of KEYS) o[k] = jget(P + k, null); return o; };
const stable = (o) => JSON.stringify(o, Object.keys(o).sort());
const emptyLocal = (o) => !(o.shelf && o.shelf.length) && !(o.recent && o.recent.length) && !(o.progress && Object.keys(o.progress).length);
function applyLocal(o) {
  for (const k of KEYS) {
    if (o[k] === null || o[k] === undefined) localStorage.removeItem(P + k); else jset(P + k, o[k]);
  }
}
// 阅读时长每秒都在变，会让“有没有改动”一直是真，所以比较时不算它
const core = (o) => stable({ shelf: o.shelf, recent: o.recent, progress: o.progress, prefs: o.prefs, rt: Object.keys(o.readtime || {}).length });

// ---------- 会话 ----------
const getSess = () => jget(SESS, null);
async function token() {
  let s = getSess();
  if (!s) return null;
  if (s.expires_at - 60 > Date.now() / 1000) return s.access_token;
  const r = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST', headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: s.refresh_token })
  });
  if (!r.ok) { localStorage.removeItem(SESS); return null; }
  const j = await r.json();
  s = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || (Math.floor(Date.now() / 1000) + j.expires_in), email: (j.user && j.user.email) || s.email, uid: (j.user && j.user.id) || s.uid };
  jset(SESS, s);
  return s.access_token;
}

async function rest(method, qs, body, tk) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/user_data' + qs, {
    method,
    headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return method === 'GET' ? r.json() : null;
}

// ---------- 同步 ----------
let busy = false;
export async function sync(allowReload) {
  if (busy) return 'busy';
  const s = getSess();
  if (!s) return 'nologin';
  busy = true;
  try {
    const tk = await token();
    if (!tk) return 'nologin';
    const rows = await rest('GET', '?select=data,updated_at&user_id=eq.' + s.uid, null, tk);
    const cloud = rows[0] ? rows[0].data : null;
    const local = snapshot();
    const meta = jget(META, {});
    const cloudKey = cloud ? core(cloud) : null;
    const localKey = core(local);
    let result;
    if (!cloud) result = local; // 云端还没有：直接上传
    else if (meta.last && cloudKey === meta.last && localKey !== meta.last) result = local; // 只有本机改过
    else if (meta.last && localKey === meta.last && cloudKey !== meta.last) result = cloud; // 只有云端改过
    else if (cloudKey === localKey) result = local;
    else result = emptyLocal(local) ? cloud : merge(local, cloud); // 第一次登录或两边都改过：合并
    // 阅读时长两边取大
    result.readtime = merge({ readtime: local.readtime }, { readtime: (cloud && cloud.readtime) || {} }).readtime;
    const changedLocal = stable(result) !== stable(local);
    if (changedLocal) applyLocal(result);
    await rest('POST', '?on_conflict=user_id', { user_id: s.uid, data: result, updated_at: new Date().toISOString() }, tk);
    jset(META, { last: core(result) });
    if (changedLocal && allowReload && !sessionStorage.getItem('kitap:reloaded')) {
      sessionStorage.setItem('kitap:reloaded', '1');
      location.reload();
    }
    return 'ok';
  } finally { busy = false; }
}

// ---------- 界面 ----------
function ui() {
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;top:8px;right:8px;z-index:50;font:14px system-ui,sans-serif';
  const chip = document.createElement('button');
  chip.style.cssText = 'min-height:36px;min-width:36px;padding:0 12px;border:1px solid rgba(128,128,128,.4);border-radius:18px;background:rgba(255,255,255,.92);color:#1c2024;cursor:pointer;font:inherit';
  const menu = document.createElement('div');
  menu.style.cssText = 'display:none;margin-top:6px;padding:10px;border-radius:12px;background:#fff;color:#1c2024;border:1px solid #ddd;box-shadow:0 4px 16px rgba(0,0,0,.15);min-width:200px';
  box.append(chip, menu);
  const btn = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.style.cssText = 'display:block;width:100%;min-height:44px;margin:4px 0;border:0;border-radius:8px;background:#0e7c6b;color:#fff;font:inherit;cursor:pointer'; b.addEventListener('click', fn); return b; };
  const draw = () => {
    const s = getSess(); const t = tr();
    chip.textContent = s ? '● ' + (s.email || t.title).split('@')[0].slice(0, 12) : '👤';
    chip.setAttribute('aria-label', t.title);
    menu.replaceChildren();
    const msg = document.createElement('div'); msg.style.cssText = 'font-size:13px;margin-top:4px;color:#5d6670;word-break:break-all';
    if (!s) menu.append(btn(t.login, login));
    else {
      const em = document.createElement('div'); em.textContent = s.email || ''; em.style.cssText = 'font-size:13px;color:#5d6670;word-break:break-all'; menu.append(em);
      menu.append(btn(t.sync, async () => { msg.textContent = '…'; try { const r = await sync(false); msg.textContent = r === 'ok' ? t.ok : r; } catch (e) { msg.textContent = t.fail + e.message; } }));
      menu.append(btn(t.out, () => { localStorage.removeItem(SESS); localStorage.removeItem(META); draw(); }));
    }
    menu.append(msg);
  };
  chip.addEventListener('click', () => { menu.style.display = menu.style.display === 'none' ? 'block' : 'none'; if (menu.style.display === 'block') draw(); });
  const vis = () => { box.style.display = /read/i.test(location.hash) ? 'none' : ''; };
  addEventListener('hashchange', vis); vis();
  draw();
  document.body.append(box);
}

function login() {
  const redirect = location.origin + '/auth.html';
  location.href = SUPABASE_URL + '/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(redirect);
}

function start() {
  if (!SUPABASE_URL || !ANON_KEY) return;
  ui();
  if (getSess()) {
    sync(true).catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && getSess()) sync(false).catch(() => {}); });
    setInterval(() => { if (getSess()) sync(false).catch(() => {}); }, 120000);
  }
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
}
