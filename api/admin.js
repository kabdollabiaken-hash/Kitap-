// 管理后台接口：只在服务器上运行，密钥来自 Vercel 环境变量，不会出现在网页里
const crypto = require('crypto');

const SCRIPTS = { kk: ['cyrillic', 'latin', 'arabic'], ru: ['cyrillic'], zh: ['han'], en: ['latin'] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BYTES = 3800000;

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);

let REST = '';
let HEADERS = {};

async function db(method, path, { params, body, prefer } = {}) {
  const url = new URL(REST + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { ...HEADERS, ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(500, '数据库错误 ' + res.status + '：' + text.slice(0, 300));
  return text ? JSON.parse(text) : null;
}

const needId = (id) => { if (typeof id !== 'string' || !UUID.test(id)) throw bad('书籍 ID 不正确'); return id; };

async function bookStatus(id) {
  const r = await db('GET', 'books', { params: { select: 'id,status', id: 'eq.' + id } });
  if (!r.length) throw new HttpError(404, '找不到这本书');
  return r[0];
}

const actions = {
  async categories() {
    const rows = await db('GET', 'categories', { params: { select: 'id,slug,name', order: 'slug.asc' } });
    return { categories: rows };
  },

  async list() {
    const rows = await db('GET', 'books', {
      params: {
        select: 'id,title,author,description,cover_url,category_id,text_direction,language,script,status,is_featured,copyright_note,created_at,published_at,chapters(count)',
        order: 'created_at.desc',
        limit: '500'
      }
    });
    return { books: rows.map((b) => ({ ...b, chapter_count: b.chapters && b.chapters[0] ? b.chapters[0].count : 0, chapters: undefined })) };
  },

  async set_status({ id, status }) {
    needId(id);
    if (!['published', 'hidden', 'draft'].includes(status)) throw bad('状态不正确');
    if (status === 'published') {
      const c = await db('GET', 'chapters', { params: { select: 'id', book_id: 'eq.' + id, limit: '1' } });
      if (!c.length) throw bad('这本书没有章节，不能上架');
    }
    const patch = { status };
    if (status === 'published') patch.published_at = new Date().toISOString();
    await db('PATCH', 'books', { params: { id: 'eq.' + id }, body: patch });
    return { ok: true };
  },

  async update_book({ id, fields }) {
    needId(id);
    if (!fields || typeof fields !== 'object') throw bad('缺少内容');
    const need = (k) => {
      if (typeof fields[k] !== 'string' || fields[k].trim() === '') throw bad('缺少必填项：' + k);
      return fields[k];
    };
    const title = need('title');
    const author = need('author');
    const copyright_note = need('copyright_note');
    if (copyright_note.startsWith('__')) throw bad('版权来源不能以 __ 开头');
    if (!['ltr', 'rtl', 'auto'].includes(fields.text_direction)) throw bad('文字方向不正确');
    const description = typeof fields.description === 'string' && fields.description !== '' ? fields.description : null;
    const cover_url = typeof fields.cover_url === 'string' && fields.cover_url !== '' ? fields.cover_url : null;
    if (cover_url && !/^https:\/\//i.test(cover_url)) throw bad('封面地址必须以 https:// 开头');
    let category_id = null;
    if (typeof fields.category_slug === 'string' && fields.category_slug !== '') {
      const cats = await db('GET', 'categories', { params: { select: 'id', slug: 'eq.' + fields.category_slug } });
      if (!cats.length) throw bad('分类不存在');
      category_id = cats[0].id;
    }
    await bookStatus(id);
    await db('PATCH', 'books', { params: { id: 'eq.' + id }, body: { title, author, description, cover_url, category_id, copyright_note, text_direction: fields.text_direction } });
    return { ok: true };
  },

  async upload_cover({ id, data }) {
    needId(id);
    await bookStatus(id);
    if (typeof data !== 'string' || data.length > 1500000) throw bad('图片太大');
    const buf = Buffer.from(data, 'base64');
    if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8 || buf[2] !== 0xFF) throw bad('不是 JPEG 图片');
    const key = process.env.SUPABASE_SERVICE_KEY;
    const base = process.env.SUPABASE_URL.replace(/\/+$/, '');
    const sh = { apikey: key, Authorization: 'Bearer ' + key };
    // 第一次使用时自动创建公开的 covers 存储桶（已存在会返回错误，忽略即可）
    await fetch(base + '/storage/v1/bucket', {
      method: 'POST', headers: { ...sh, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'covers', name: 'covers', public: true })
    }).catch(() => {});
    const up = await fetch(base + '/storage/v1/object/covers/' + id + '.jpg', {
      method: 'POST', headers: { ...sh, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: buf
    });
    if (!up.ok) throw new HttpError(500, '封面上传失败 ' + up.status + '：' + (await up.text()).slice(0, 200));
    const url = base + '/storage/v1/object/public/covers/' + id + '.jpg?v=' + Date.now();
    await db('PATCH', 'books', { params: { id: 'eq.' + id }, body: { cover_url: url } });
    return { cover_url: url };
  },

  async set_featured({ id, value }) {
    needId(id);
    await db('PATCH', 'books', { params: { id: 'eq.' + id }, body: { is_featured: value === true } });
    return { ok: true };
  },

  async delete({ id }) {
    needId(id);
    await db('DELETE', 'books', { params: { id: 'eq.' + id } });
    return { ok: true };
  },

  async abort({ id }) {
    needId(id);
    const b = await bookStatus(id);
    if (b.status !== 'draft') throw bad('只能撤销草稿');
    await db('DELETE', 'books', { params: { id: 'eq.' + id } });
    return { ok: true };
  },

  async create_book({ meta, replace }) {
    if (!meta || typeof meta !== 'object') throw bad('缺少书籍信息');
    const need = (k) => {
      if (typeof meta[k] !== 'string' || meta[k].trim() === '') throw bad('缺少必填项：' + k);
      return meta[k];
    };
    const title = need('title');
    const author = need('author');
    const language = need('language');
    const script = need('script');
    const copyright_note = need('copyright_note');
    if (!SCRIPTS[language]) throw bad('语言不正确');
    if (!SCRIPTS[language].includes(script)) throw bad('这个语言不支持该文字');
    const text_direction = meta.text_direction;
    if (!['ltr', 'rtl', 'auto'].includes(text_direction)) throw bad('文字方向不正确');
    if (copyright_note.startsWith('__')) throw bad('版权来源不能以 __ 开头');
    const description = typeof meta.description === 'string' && meta.description !== '' ? meta.description : null;
    const cover_url = typeof meta.cover_url === 'string' && meta.cover_url !== '' ? meta.cover_url : null;
    if (cover_url && !/^https:\/\//i.test(cover_url)) throw bad('封面地址必须以 https:// 开头');

    let category_id = null;
    if (typeof meta.category_slug === 'string' && meta.category_slug !== '') {
      const cats = await db('GET', 'categories', { params: { select: 'id', slug: 'eq.' + meta.category_slug } });
      if (!cats.length) throw bad('分类不存在');
      category_id = cats[0].id;
    }

    const existing = await db('GET', 'books', { params: { select: 'id', title: 'eq.' + title, author: 'eq.' + author, language: 'eq.' + language, script: 'eq.' + script } });
    if (existing.length) {
      if (replace !== true) throw new HttpError(409, '这本书已经存在（同名同作者同文字）。请先在书籍管理里删除，或勾选“覆盖已有的同一本书”');
      await db('DELETE', 'books', { params: { id: 'in.(' + existing.map((e) => e.id).join(',') + ')' } });
    }

    const created = await db('POST', 'books', {
      prefer: 'return=representation',
      body: { title, author, description, cover_url, category_id, language, script, text_direction, copyright_note, is_featured: meta.is_featured === true, status: 'draft' }
    });
    return { id: created[0].id };
  },

  async add_chapters({ book_id, chapters }) {
    needId(book_id);
    const b = await bookStatus(book_id);
    if (b.status !== 'draft') throw bad('只能向草稿添加章节');
    if (!Array.isArray(chapters) || !chapters.length) throw bad('没有章节');
    let total = 0;
    const rows = chapters.map((c) => {
      if (!Number.isInteger(c.n) || c.n < 1) throw bad('章节编号不正确');
      if (typeof c.title !== 'string' || c.title.trim() === '') throw bad('第 ' + c.n + ' 章标题为空');
      if (typeof c.content !== 'string' || c.content.trim() === '') throw bad('第 ' + c.n + ' 章正文为空');
      if (c.content.includes('\u0000') || c.content.includes('\uFFFD') || c.title.includes('\uFFFD')) throw bad('第 ' + c.n + ' 章含有乱码或空字符');
      const h = sha(c.content);
      if (h !== c.sha) throw bad('第 ' + c.n + ' 章在传输中发生变化（哈希不一致），已停止');
      total += Buffer.byteLength(c.content, 'utf8');
      return { book_id, chapter_number: c.n, title: c.title, content: c.content, source_sha256: h };
    });
    if (total > MAX_BYTES) throw bad('这一批太大，请把过长的章节拆分');
    await db('POST', 'chapters', { body: rows });
    return { ok: true, count: rows.length };
  },

  async finalize({ book_id, expected, book, publish }) {
    needId(book_id);
    const b = await bookStatus(book_id);
    if (b.status !== 'draft') throw bad('这本书已不是草稿');
    if (!Array.isArray(expected) || !expected.length) throw bad('缺少校验信息');
    const back = await db('GET', 'chapters', { params: { select: 'chapter_number,title,content_sha256,source_sha256', book_id: 'eq.' + book_id, order: 'chapter_number.asc' } });
    const bk = (await db('GET', 'books', { params: { select: 'title,author,description', id: 'eq.' + book_id } }))[0];
    const problems = [];
    if (book) {
      if (bk.title !== book.title) problems.push('书名读回后不一致');
      if (bk.author !== book.author) problems.push('作者读回后不一致');
      if ((bk.description || null) !== (book.description || null)) problems.push('简介读回后不一致');
    }
    if (back.length !== expected.length) problems.push('章节数量不一致：上传 ' + expected.length + '，数据库 ' + back.length);
    for (const e of expected) {
      const r = back.find((x) => x.chapter_number === e.n);
      if (!r) { problems.push('第 ' + e.n + ' 章没有写入'); continue; }
      if (r.title !== e.title) problems.push('第 ' + e.n + ' 章标题读回后不一致');
      if (r.content_sha256 !== e.sha) problems.push('第 ' + e.n + ' 章正文哈希不一致');
      if (r.source_sha256 !== e.sha) problems.push('第 ' + e.n + ' 章原始哈希记录不一致');
    }
    if (problems.length) return { ok: false, problems };
    if (publish === true) {
      await db('PATCH', 'books', { params: { id: 'eq.' + book_id }, body: { status: 'published', published_at: new Date().toISOString() } });
    }
    return { ok: true, published: publish === true };
  }
};

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') return send(res, 405, { error: '只支持 POST' });
    const { ADMIN_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
    if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12 || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return send(res, 500, { error: '服务器环境变量没设置好：需要 ADMIN_PASSWORD（至少 12 位）、SUPABASE_URL、SUPABASE_SERVICE_KEY' });
    }
    const given = req.headers['x-admin-password'] || '';
    if (!crypto.timingSafeEqual(digest(given), digest(ADMIN_PASSWORD))) {
      await sleep(1500);
      return send(res, 401, { error: '密码不对' });
    }
    REST = SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/';
    HEADERS = { apikey: SUPABASE_SERVICE_KEY, 'Content-Type': 'application/json; charset=utf-8' };
    if (SUPABASE_SERVICE_KEY.startsWith('eyJ')) HEADERS.Authorization = 'Bearer ' + SUPABASE_SERVICE_KEY;

    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
    if (!body || typeof body.action !== 'string' || !Object.prototype.hasOwnProperty.call(actions, body.action)) {
      return send(res, 400, { error: '未知操作' });
    }
    return send(res, 200, await actions[body.action](body));
  } catch (e) {
    return send(res, e.status || 500, { error: e.message || '服务器错误' });
  }
};
