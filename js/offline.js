// 离线阅读：把整本书（书信息 + 目录 + 所有章节正文）存进浏览器的 IndexedDB
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const DB_NAME = 'kitap-offline';
let dbp = null;

function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('no idb')); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('chapters')) {
        db.createObjectStore('chapters', { keyPath: 'id' }).createIndex('book_id', 'book_id');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbp = null; reject(req.error); };
  });
  return dbp;
}

function run(store, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    let out;
    Promise.resolve(fn(tx.objectStore(store))).then((v) => { out = v; });
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}
const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const offlineGetBook = (id) => run('books', 'readonly', (s) => reqP(s.get(id))).then((v) => v || null).catch(() => null);
export const offlineGetChapter = (id) => run('chapters', 'readonly', (s) => reqP(s.get(id))).then((v) => v || null).catch(() => null);
export const offlineHas = (id) => offlineGetBook(id).then((v) => !!v);

export async function offlineRemove(bookId) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(['books', 'chapters'], 'readwrite');
    tx.objectStore('books').delete(bookId);
    const idx = tx.objectStore('chapters').index('book_id');
    idx.openKeyCursor(IDBKeyRange.only(bookId)).onsuccess = (e) => {
      const c = e.target.result;
      if (c) { tx.objectStore('chapters').delete(c.primaryKey); c.continue(); }
    };
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function fetchChapters(ids) {
  const full = 'id,book_id,chapter_number,title,content,content_sha256,language,script,text_direction,audio_path,audio_seconds';
  const lite = 'id,book_id,chapter_number,title,content,content_sha256,language,script,text_direction';
  const go = async (select) => {
    const url = new URL(SUPABASE_URL + '/rest/v1/chapters');
    url.searchParams.set('select', select);
    url.searchParams.set('id', 'in.(' + ids.join(',') + ')');
    return fetch(url, { headers: { apikey: SUPABASE_KEY } });
  };
  let r = await go(full);
  if (!r.ok) r = await go(lite); // 数据库没有音频字段时
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// 下载整本书。onProgress(done, total)；中途失败会清掉已存的部分并抛出错误
export async function offlineSave(book, chapters, onProgress) {
  const total = chapters.length;
  let done = 0;
  if (onProgress) onProgress(0, total);
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    for (let i = 0; i < total; i += 8) {
      const ids = chapters.slice(i, i + 8).map((c) => c.id);
      const rows = await fetchChapters(ids);
      await run('chapters', 'readwrite', (s) => { rows.forEach((row) => s.put(row)); });
      done += ids.length;
      if (onProgress) onProgress(done, total);
    }
    await run('books', 'readwrite', (s) => { s.put({ id: book.id, book, chapters, savedAt: Date.now() }); });
  } catch (e) {
    await offlineRemove(book.id).catch(() => {});
    throw e;
  }
}
