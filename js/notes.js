// 划线和想法：选中文字 → 划线 / 写想法；点已有划线 → 改颜色 / 改想法 / 删除；“我的笔记”列表
// 只保存字符位置和原文摘录，不修改书籍正文。
import { t, getLang } from './i18n.js';
import './messages-notes.js';
import { h, enc } from './ui.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { getToken, getSession } from './auth.js';

if (typeof document !== 'undefined' && !document.querySelector('link[data-notes]')) {
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = './css/notes.css';
  l.setAttribute('data-notes', '1');
  document.head.appendChild(l);
}

export const COLORS = ['y', 'g', 'p', 'u'];
const FIELDS = 'id,book_id,chapter_id,start_off,end_off,quote,color,note,book_title,chapter_title,created_at';
const QUOTE_MAX = 800;
const SEL_MAX = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const uuid = () => {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const x = [...b].map((v) => v.toString(16).padStart(2, '0')).join('');
  return x.slice(0, 8) + '-' + x.slice(8, 12) + '-' + x.slice(12, 16) + '-' + x.slice(16, 20) + '-' + x.slice(20);
};

// ---------- 云端读写（只能读写自己的行，由数据库的行级权限保证）----------
async function rest(method, qs, body) {
  const tk = await getToken();
  if (!tk) throw new Error('nologin');
  const headers = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + tk };
  if (method !== 'GET') { headers['Content-Type'] = 'application/json'; headers.Prefer = 'return=minimal'; }
  const r = await fetch(SUPABASE_URL + '/rest/v1/highlights' + qs, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return method === 'GET' ? r.json() : null;
}
const needId = (id) => { if (!UUID.test(String(id))) throw new Error('bad id'); return encodeURIComponent(id); };

// ---------- 本机缓存：打开章节时先显示，再用云端结果覆盖 ----------
const ckey = (chapterId) => { const s = getSession(); return 'kitap:v1:marks:' + ((s && s.uid) || '-') + ':' + chapterId; };
export function cachedMarks(chapterId) {
  try { const v = JSON.parse(localStorage.getItem(ckey(chapterId))); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
function writeCache(chapterId, list) {
  try {
    const rows = list.map(({ id, book_id, chapter_id, start_off, end_off, quote, color, note, book_title, chapter_title, created_at }) =>
      ({ id, book_id, chapter_id, start_off, end_off, quote, color, note, book_title, chapter_title, created_at }));
    localStorage.setItem(ckey(chapterId), JSON.stringify(rows));
  } catch (e) { /* ignore */ }
}
export async function fetchMarks(chapterId) {
  const rows = await rest('GET', '?select=' + FIELDS + '&chapter_id=eq.' + needId(chapterId) + '&order=created_at.asc&limit=2000');
  writeCache(chapterId, rows);
  return rows;
}
async function listAll() {
  return rest('GET', '?select=' + FIELDS + '&order=created_at.desc&limit=1000');
}

// 正文改过之后，位置可能对不上：先看原位置的文字是否一致，不一致就按原文摘录重新找；找不到就不显示
export function fit(rows, content) {
  return rows.map((r) => {
    const m = { ...r };
    const q = m.quote || '';
    const len = m.end_off - m.start_off;
    m.ok = q.length > 0 && content.slice(m.start_off, m.start_off + q.length) === q;
    if (!m.ok && q) {
      const i = content.indexOf(q);
      if (i >= 0) { m.start_off = i; m.end_off = i + len; m.ok = true; }
    }
    if (m.end_off > content.length) m.end_off = content.length;
    return m;
  });
}

// 一个段落（正文里 start 开始的 text）按划线切成若干段：有划线的段落包一层 <span>
export function paragraph(text, start, marks) {
  const end = start + text.length;
  const hits = marks.filter((m) => m.ok && m.start_off < end && m.end_off > start);
  if (!hits.length) return [text];
  const cuts = new Set([start, end]);
  hits.forEach((m) => { cuts.add(Math.max(start, m.start_off)); cuts.add(Math.min(end, m.end_off)); });
  const pts = [...cuts].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const seg = text.slice(a - start, b - start);
    if (!seg) continue;
    let top = null; // 重叠时，后画的盖在上面
    for (const m of hits) {
      if (m.start_off <= a && m.end_off >= b && (!top || (m.created_at || '') >= (top.created_at || ''))) top = m;
    }
    out.push(top
      ? h('span', { class: 'hl hl-' + top.color + (top.note ? ' hl-note' : ''), 'data-m': top.id }, seg)
      : seg);
  }
  return out;
}

const textOffset = (p, node, off) => {
  const r = document.createRange();
  r.selectNodeContents(p);
  r.setEnd(node, off);
  return r.toString().length;
};

// ---------- 阅读器里的划线界面 ----------
export function createMarkUI(o) {
  const { root, book, chapter } = o;
  const content = chapter.content;
  let marks = [];
  const pending = new Set(); // 还没存到云端的
  let bar = null; // { el, kind: 'new' | 'edit' }
  let editor = null;
  let destroyed = false;
  let barTouch = 0;
  let selTimer = 0;
  const lis = [];
  const on = (tg, ev, fn, opt) => { tg.addEventListener(ev, fn, opt); lis.push([tg, ev, fn, opt]); };
  const changed = () => { writeCache(chapter.id, marks); o.onChange(); };

  const toast = (msg) => {
    const el = h('div', { class: 'mk-toast', role: 'status' }, msg);
    root.append(el);
    setTimeout(() => el.remove(), 1900);
  };

  // ---- 读写 ----
  const rowOf = (m) => ({
    id: m.id, book_id: m.book_id, chapter_id: m.chapter_id, start_off: m.start_off, end_off: m.end_off,
    quote: m.quote, color: m.color, note: m.note, book_title: m.book_title, chapter_title: m.chapter_title, created_at: m.created_at
  });
  async function create(sel, color, note) {
    const m = {
      id: uuid(), book_id: book.id, chapter_id: chapter.id, start_off: sel.start, end_off: sel.end,
      quote: content.slice(sel.start, sel.end).slice(0, QUOTE_MAX), color, note: note || '',
      book_title: book.title || '', chapter_title: chapter.title || '', created_at: new Date().toISOString(), ok: true
    };
    marks.push(m);
    pending.add(m.id);
    changed();
    try { await rest('POST', '', rowOf(m)); } catch (e) {
      marks = marks.filter((x) => x.id !== m.id);
      changed();
      toast(t('mark.failed'));
    }
    pending.delete(m.id);
  }
  async function update(m, patch) {
    const old = { color: m.color, note: m.note };
    Object.assign(m, patch);
    changed();
    try { await rest('PATCH', '?id=eq.' + needId(m.id), { ...patch, updated_at: new Date().toISOString() }); } catch (e) {
      Object.assign(m, old);
      changed();
      toast(t('mark.failed'));
    }
  }
  async function remove(m) {
    if (m.note && !confirm(t('mark.confirmDel'))) return;
    marks = marks.filter((x) => x.id !== m.id);
    changed();
    try { await rest('DELETE', '?id=eq.' + needId(m.id)); } catch (e) {
      marks.push(m);
      changed();
      toast(t('mark.failed'));
    }
  }

  // ---- 想法输入框 ----
  function closeEditor() { if (editor) { editor.remove(); editor = null; } }
  function openEditor(quote, note, onSave) {
    closeEditor();
    const ta = h('textarea', { class: 'mk-ta', rows: '5', maxlength: '2000', dir: 'auto', placeholder: t('mark.notePh'), 'aria-label': t('mark.noteTitle') }, note || '');
    const save = () => { const v = ta.value.trim(); closeEditor(); onSave(v); };
    editor = h('div', { class: 'mk-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('mark.noteTitle') },
      h('div', { class: 'mk-scrim', onclick: closeEditor }),
      h('div', { class: 'mk-card' },
        h('div', { class: 'mk-q', dir: 'auto' }, quote.length > 240 ? quote.slice(0, 240) + '…' : quote),
        ta,
        h('div', { class: 'mk-acts' },
          h('button', { class: 'rd-btn', type: 'button', onclick: closeEditor }, t('mark.cancel')),
          h('button', { class: 'rd-btn mk-save', type: 'button', onclick: save }, t('mark.save')))));
    root.append(editor);
    ta.focus();
  }

  // ---- 工具条 ----
  function hideBar(keepSel) {
    if (!bar) return;
    const was = bar;
    bar.el.remove();
    bar = null;
    if (!keepSel && was.kind === 'new') { try { window.getSelection().removeAllRanges(); } catch (e) { /* ignore */ } }
  }
  function copy(text) {
    const done = () => toast(t('mark.copied'));
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, () => {}); return; }
    const ta = h('textarea', { style: 'position:fixed;opacity:0' }, text);
    document.body.append(ta); ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
    ta.remove();
  }
  function showBar(kind, data, rects) {
    hideBar(true);
    const m = kind === 'edit' ? data : null;
    const quote = m ? m.quote : content.slice(data.start, data.end);
    const pick = (c) => {
      const d = data;
      hideBar();
      if (m) { if (m.color !== c) update(m, { color: c }); } else create(d, c, '');
    };
    const dot = (c) => h('button', {
      class: 'mk-dot mk-c-' + c, type: 'button', 'aria-label': t('mark.c.' + c), 'aria-pressed': m && m.color === c ? 'true' : 'false',
      onclick: () => pick(c)
    }, c === 'u' ? h('span', {}, 'A') : null);
    const act = (label, fn, cls) => h('button', { class: 'mk-act' + (cls ? ' ' + cls : ''), type: 'button', onclick: fn }, label);
    const noteFn = () => {
      hideBar();
      if (m) openEditor(m.quote, m.note, (v) => update(m, { note: v }));
      else openEditor(quote, '', (v) => { if (v) create(data, 'u', v); });
    };
    const el = h('div', { class: 'mk-bar', role: 'toolbar' },
      m && m.note ? h('button', { class: 'mk-prev', type: 'button', dir: 'auto', onclick: noteFn }, m.note) : null,
      h('div', { class: 'mk-row' },
        COLORS.map(dot),
        act(t('mark.note'), noteFn),
        act(t('mark.copy'), () => { copy(quote); hideBar(); }),
        m ? act(t('mark.delete'), () => { hideBar(); remove(m); }, 'mk-del') : null));
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('pointerdown', () => { barTouch = performance.now(); });
    bar = { el, kind };
    root.append(el);
    // 放在选中文字的下面（手机自带的复制菜单在上面）；下面放不下就放上面
    const xs = rects.map((r) => r.left);
    const xe = rects.map((r) => r.right);
    const first = rects[0];
    const last = rects[rects.length - 1];
    const bw = el.offsetWidth;
    const bh = el.offsetHeight;
    let top = last.bottom + 30;
    if (top + bh > window.innerHeight - 70) top = first.top - bh - 12;
    top = Math.max(64, Math.min(top, window.innerHeight - bh - 8));
    let left = (Math.min(...xs) + Math.max(...xe)) / 2 - bw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - bw - 8));
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }

  // ---- 读取当前选中的文字，换算成正文里的位置 ----
  function readSel() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    let n = range.commonAncestorContainer;
    if (n.nodeType === 3) n = n.parentNode;
    const flow = n && n.closest ? n.closest('.pg-flow, .rd-body') : null;
    if (!flow || !root.contains(flow)) return null;
    let s = -1;
    let e = -1;
    for (const p of flow.querySelectorAll('p.rd-p[data-s]')) {
      if (!range.intersectsNode(p)) continue;
      const base = Number(p.dataset.s);
      let a = 0;
      let b = p.textContent.length;
      if (p.contains(range.startContainer)) a = textOffset(p, range.startContainer, range.startOffset);
      if (p.contains(range.endContainer)) b = textOffset(p, range.endContainer, range.endOffset);
      if (b <= a) continue;
      if (s < 0) s = base + a;
      e = base + b;
    }
    if (s < 0 || e <= s) return null;
    const txt = content.slice(s, e);
    s += txt.length - txt.trimStart().length;
    e -= txt.length - txt.trimEnd().length;
    if (e <= s || e - s > SEL_MAX) return null;
    const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    if (!rects.length) return null;
    return { start: s, end: e, rects };
  }
  function onSel() {
    if (destroyed || editor) return;
    const s = readSel();
    if (s) { showBar('new', { start: s.start, end: s.end }, s.rects); return; }
    if (bar && bar.kind === 'new' && performance.now() - barTouch > 700) hideBar(true);
  }
  on(document, 'selectionchange', () => { clearTimeout(selTimer); selTimer = setTimeout(onSel, 260); });

  return {
    paragraph: (text, start) => paragraph(text, start, marks),
    hasMark: (id) => marks.some((m) => m.id === id && m.ok),
    // 打开章节：先用本机缓存，再取云端；返回的 Promise 在云端结果到达（或失败）后结束
    load() {
      const local = cachedMarks(chapter.id);
      if (local.length) marks = fit(local, content);
      return fetchMarks(chapter.id).then((rows) => {
        if (destroyed) return;
        marks = fit(rows.concat(marks.filter((m) => pending.has(m.id)).map(rowOf)), content);
        o.onChange();
      }).catch(() => {});
    },
    // 轻点：先收起工具条；点在划线上就打开工具条；返回 true 表示这次点击已经处理（不要翻页）
    tap(x, y) {
      if (bar || editor) { hideBar(); return true; }
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return true;
      const el = document.elementFromPoint(x, y);
      const hl = el && el.closest ? el.closest('.hl') : null;
      if (!hl) return false;
      const m = marks.find((k) => k.id === hl.dataset.m);
      if (!m) return false;
      const rects = [...hl.getClientRects()].filter((r) => r.width > 1);
      if (!rects.length) return false;
      showBar('edit', m, rects);
      return true;
    },
    hide() { hideBar(); },
    destroy() {
      destroyed = true;
      clearTimeout(selTimer);
      hideBar(true);
      closeEditor();
      lis.forEach(([tg, ev, fn, opt]) => tg.removeEventListener(ev, fn, opt));
    }
  };
}

// ---------- “我的笔记”列表 ----------
export function openNotes() {
  const old = document.querySelector('.nt');
  if (old) old.remove();
  let rows = [];
  let filter = 'all';
  const prevOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  const close = () => {
    el.remove();
    document.body.style.overflow = prevOverflow;
    window.removeEventListener('hashchange', close);
  };
  const list = h('div', { class: 'nt-list' });
  const chip = (key, label) => h('button', { class: 'nt-chip', type: 'button', 'data-f': key, 'aria-pressed': filter === key ? 'true' : 'false', onclick: () => { filter = key; draw(); } }, label);
  const chips = h('div', { class: 'nt-chips' });
  const fmt = (iso) => { try { return new Date(iso).toLocaleDateString(getLang()); } catch (e) { return ''; } };

  function draw() {
    chips.replaceChildren(chip('all', t('notes.all')), chip('note', t('notes.withNote')));
    const shown = rows.filter((r) => filter === 'all' || r.note);
    if (!shown.length) { list.replaceChildren(h('p', { class: 'nt-empty' }, t('notes.empty'))); return; }
    const groups = new Map();
    shown.forEach((r) => { if (!groups.has(r.book_id)) groups.set(r.book_id, []); groups.get(r.book_id).push(r); });
    list.replaceChildren(...[...groups.entries()].map(([bid, items]) => h('section', { class: 'nt-grp' },
      h('h2', { class: 'nt-book', dir: 'auto' }, items[0].book_title || '—'),
      items.map((r) => h('article', { class: 'nt-it' },
        h('a', { class: 'nt-main', href: '#/read/' + enc(bid) + '/' + enc(r.chapter_id) + '?m=' + enc(r.id) },
          h('blockquote', { class: 'nt-q nt-c-' + r.color, dir: 'auto' }, r.quote),
          r.note ? h('p', { class: 'nt-note', dir: 'auto' }, r.note) : null,
          h('div', { class: 'nt-meta', dir: 'auto' }, [r.chapter_title, fmt(r.created_at)].filter(Boolean).join(' · '))),
        h('button', {
          class: 'nt-del', type: 'button', 'aria-label': t('mark.delete'),
          onclick: async () => {
            if (r.note && !confirm(t('mark.confirmDel'))) return;
            try {
              await rest('DELETE', '?id=eq.' + needId(r.id));
              rows = rows.filter((x) => x.id !== r.id);
              writeCache(r.chapter_id, cachedMarks(r.chapter_id).filter((x) => x.id !== r.id));
              draw();
            } catch (e) { alert(t('mark.failed')); }
          }
        }, '✕'))))));
  }
  const load = async () => {
    list.replaceChildren(h('p', { class: 'nt-empty' }, t('common.loading')));
    try { rows = await listAll(); draw(); } catch (e) {
      list.replaceChildren(h('p', { class: 'nt-empty' }, t('common.error')),
        h('button', { class: 'me-btn', type: 'button', onclick: load }, t('common.retry')));
    }
  };
  const el = h('div', { class: 'nt', role: 'dialog', 'aria-modal': 'true', 'aria-label': t('notes.title') },
    h('header', { class: 'nt-bar' },
      h('button', { class: 'nt-x', type: 'button', 'aria-label': t('notes.close'), onclick: close }, '‹'),
      h('strong', {}, t('notes.title')),
      h('span', { class: 'nt-sp' })),
    chips, list);
  document.body.append(el);
  window.addEventListener('hashchange', close);
  draw();
  load();
}
