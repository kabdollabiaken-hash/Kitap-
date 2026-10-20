#!/usr/bin/env node
// 书籍导入工具 —— 原文原样导入，不转换、不修正、不猜测编码
// 用法：node tools/import.mjs books/<文件夹> [--dry-run] [--draft] [--replace]
//   --dry-run  只检查文件，不写入数据库
//   --draft    导入并校验，但保持草稿，不发布
//   --replace  同名同作者的书已存在时，删除旧的再导入（会产生新的书 ID）
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const dirs = args.filter((a) => !a.startsWith('--'));
const DRY = flags.has('--dry-run');
const DRAFT = flags.has('--draft');
const REPLACE = flags.has('--replace');

function fail(msg) { console.error('\n✗ ' + msg); process.exit(1); }
if (dirs.length !== 1) fail('用法：node tools/import.mjs books/<文件夹> [--dry-run] [--draft] [--replace]');

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ---------- 严格读取 UTF-8 文本：有问题就报错，不修复 ----------
function readUtf8Strict(file) {
  const buf = readFileSync(file);
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    fail(file + '：文件开头有 BOM 标记。请用“不带 BOM 的 UTF-8”重新保存（工具不会自动处理）');
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch (e) {
    fail(file + '：不是有效的 UTF-8 编码。已停止，不会猜测或修复');
  }
  if (text.includes('\u0000')) fail(file + '：含有空字符（NUL），文件可能已损坏');
  if (text.includes('\uFFFD')) fail(file + '：含有替换字符 �，说明原文件本身已有乱码，请先修复源文件');
  return text;
}

// ---------- 书籍信息 ----------
const SCRIPTS_BY_LANG = { kk: ['cyrillic', 'latin', 'arabic'], ru: ['cyrillic'], zh: ['han'], en: ['latin'] };

function loadMeta(dir) {
  const file = join(dir, 'book.json');
  if (!existsSync(file)) fail('找不到 ' + file);
  let m;
  try { m = JSON.parse(readUtf8Strict(file)); } catch (e) { fail(file + ' 不是有效的 JSON：' + e.message); }
  const need = (k) => {
    if (typeof m[k] !== 'string' || m[k].trim() === '') fail('book.json 缺少必填项：' + k);
    return m[k];
  };
  const meta = {
    title: need('title'),
    author: need('author'),
    language: need('language'),
    script: need('script'),
    copyright_note: need('copyright_note'),
    description: typeof m.description === 'string' && m.description !== '' ? m.description : null,
    cover_url: typeof m.cover_url === 'string' && m.cover_url !== '' ? m.cover_url : null,
    category_slug: typeof m.category_slug === 'string' && m.category_slug !== '' ? m.category_slug : null,
    is_featured: m.is_featured === true
  };
  if (!SCRIPTS_BY_LANG[meta.language]) fail('language 只能是 kk / ru / zh / en');
  if (!SCRIPTS_BY_LANG[meta.language].includes(meta.script)) {
    fail('语言 ' + meta.language + ' 对应的 script 只能是：' + SCRIPTS_BY_LANG[meta.language].join(' / '));
  }
  const dirDefault = meta.script === 'arabic' ? 'rtl' : 'ltr';
  meta.text_direction = typeof m.text_direction === 'string' ? m.text_direction : dirDefault;
  if (!['ltr', 'rtl', 'auto'].includes(meta.text_direction)) fail('text_direction 只能是 ltr / rtl / auto');
  if (meta.copyright_note.startsWith('__')) fail('copyright_note 不能以 __ 开头（这是内部测试标记）');
  return meta;
}

// ---------- 章节：第 1 行标题，第 2 行空行，第 3 行起是正文 ----------
function loadChapters(dir) {
  const cdir = join(dir, 'chapters');
  if (!existsSync(cdir) || !statSync(cdir).isDirectory()) fail('找不到章节文件夹 ' + cdir);
  const files = readdirSync(cdir).filter((f) => f.toLowerCase().endsWith('.txt'));
  if (!files.length) fail(cdir + ' 里没有 .txt 章节文件');

  const chapters = files.map((f) => {
    const m = f.match(/^(\d+)/);
    if (!m) fail('章节文件名必须以数字开头，例如 001.txt：' + f);
    const number = parseInt(m[1], 10);
    if (number < 1) fail('章节编号必须从 1 开始：' + f);
    const text = readUtf8Strict(join(cdir, f));
    const head = text.match(/^([^\r\n]*)\r?\n\r?\n/);
    if (!head) fail(f + '：格式不对。第 1 行是章节标题，第 2 行必须是空行，第 3 行起是正文');
    const title = head[1];
    if (title.trim() === '') fail(f + '：章节标题为空');
    const content = text.slice(head[0].length);
    if (content.trim() === '') fail(f + '：正文为空');
    return { file: f, chapter_number: number, title, content, source_sha256: sha256(Buffer.from(content, 'utf8')) };
  }).sort((a, b) => a.chapter_number - b.chapter_number);

  for (let i = 1; i < chapters.length; i++) {
    if (chapters[i].chapter_number === chapters[i - 1].chapter_number) {
      fail('章节编号重复：' + chapters[i].file + ' 和 ' + chapters[i - 1].file);
    }
  }
  return chapters;
}

// ---------- 数据库访问 ----------
let REST = '';
let HEADERS = {};
function needEnv() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) fail('请先设置环境变量 SUPABASE_URL 和 SUPABASE_SERVICE_KEY（见操作说明）');
  REST = url.replace(/\/+$/, '') + '/rest/v1/';
  HEADERS = { apikey: key, 'Content-Type': 'application/json; charset=utf-8' };
}

async function api(method, path, { params, body, prefer } = {}) {
  const url = new URL(REST + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    headers: { ...HEADERS, ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(method + ' ' + path + ' -> HTTP ' + res.status + ': ' + text);
  return text ? JSON.parse(text) : null;
}

// ---------- 主流程 ----------
async function main() {
  const dir = dirs[0];
  if (!existsSync(dir) || !statSync(dir).isDirectory()) fail('找不到文件夹 ' + dir);

  const meta = loadMeta(dir);
  const chapters = loadChapters(dir);

  console.log('书名  ：' + meta.title);
  console.log('作者  ：' + meta.author);
  console.log('语言  ：' + meta.language + ' / ' + meta.script + ' / ' + meta.text_direction);
  console.log('版权  ：' + meta.copyright_note);
  console.log('章节  ：' + chapters.length + ' 章');
  for (let i = 1; i < chapters.length; i++) {
    if (chapters[i].chapter_number !== chapters[i - 1].chapter_number + 1) {
      console.log('⚠ 章节编号不连续：' + chapters[i - 1].chapter_number + ' → ' + chapters[i].chapter_number);
    }
  }
  chapters.forEach((c) => console.log('  ' + String(c.chapter_number).padStart(3, ' ') + '. ' + c.title + '  [' + c.source_sha256.slice(0, 12) + ']'));

  if (DRY) { console.log('\n✓ 文件检查通过（dry-run，没有写入数据库）'); return; }

  needEnv();

  // 分类
  let categoryId = null;
  if (meta.category_slug) {
    const cats = await api('GET', 'categories', { params: { select: 'id', slug: 'eq.' + meta.category_slug } });
    if (!cats.length) fail('数据库里没有分类 ' + meta.category_slug);
    categoryId = cats[0].id;
  }

  // 是否已存在
  const existing = await api('GET', 'books', { params: { select: 'id', title: 'eq.' + meta.title, author: 'eq.' + meta.author, language: 'eq.' + meta.language, script: 'eq.' + meta.script } });
  if (existing.length) {
    if (!REPLACE) fail('这本书已经导入过了。如需重新导入，加 --replace（会产生新的书 ID）');
    await api('DELETE', 'books', { params: { id: 'in.(' + existing.map((e) => e.id).join(',') + ')' } });
    console.log('\n已删除旧版本');
  }

  // 1) 先以草稿创建
  const created = await api('POST', 'books', {
    prefer: 'return=representation',
    body: {
      title: meta.title, author: meta.author, description: meta.description, cover_url: meta.cover_url,
      category_id: categoryId, language: meta.language, script: meta.script, text_direction: meta.text_direction,
      copyright_note: meta.copyright_note, is_featured: meta.is_featured, status: 'draft'
    }
  });
  const bookId = created[0].id;
  console.log('\n已创建草稿，书 ID：' + bookId);

  // 2) 分批写入章节
  const rows = chapters.map((c) => ({ book_id: bookId, chapter_number: c.chapter_number, title: c.title, content: c.content, source_sha256: c.source_sha256 }));
  const batches = [];
  let cur = [];
  let size = 0;
  for (const r of rows) {
    const s = Buffer.byteLength(r.content, 'utf8');
    if (cur.length && size + s > 3000000) { batches.push(cur); cur = []; size = 0; }
    cur.push(r);
    size += s;
  }
  if (cur.length) batches.push(cur);
  for (const b of batches) await api('POST', 'chapters', { body: b });
  console.log('已写入 ' + rows.length + ' 章');

  // 3) 逐项校验：读回来，和本地原文对比
  const back = await api('GET', 'chapters', { params: { select: 'chapter_number,title,content_sha256,source_sha256', book_id: 'eq.' + bookId, order: 'chapter_number.asc' } });
  const bookBack = (await api('GET', 'books', { params: { select: 'title,author,description', id: 'eq.' + bookId } }))[0];
  const problems = [];
  if (bookBack.title !== meta.title) problems.push('书名读回后不一致');
  if (bookBack.author !== meta.author) problems.push('作者读回后不一致');
  if ((bookBack.description || null) !== meta.description) problems.push('简介读回后不一致');
  if (back.length !== chapters.length) problems.push('章节数量不一致：本地 ' + chapters.length + '，数据库 ' + back.length);
  for (const c of chapters) {
    const r = back.find((x) => x.chapter_number === c.chapter_number);
    if (!r) { problems.push('第 ' + c.chapter_number + ' 章没有写入'); continue; }
    if (r.title !== c.title) problems.push('第 ' + c.chapter_number + ' 章标题读回后不一致');
    if (r.content_sha256 !== c.source_sha256) problems.push('第 ' + c.chapter_number + ' 章正文哈希不一致（本地 ' + c.source_sha256.slice(0, 12) + '，数据库 ' + String(r.content_sha256).slice(0, 12) + '）');
    if (r.source_sha256 !== c.source_sha256) problems.push('第 ' + c.chapter_number + ' 章原始哈希记录不一致');
  }
  if (problems.length) {
    console.error('\n✗ 校验失败，这本书保持“草稿”，不会对读者显示：');
    problems.forEach((p) => console.error('  - ' + p));
    process.exit(1);
  }
  console.log('✓ 校验通过：书名、作者、简介、' + chapters.length + ' 章标题和正文全部与原文一致');

  // 4) 发布
  if (DRAFT) { console.log('已按 --draft 保持草稿。'); return; }
  await api('PATCH', 'books', { params: { id: 'eq.' + bookId }, body: { status: 'published', published_at: new Date().toISOString() } });
  console.log('✓ 已发布。');
}

main().catch((e) => fail(e.message));
