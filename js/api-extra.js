// 按 ID 批量读取书籍信息（用于首页“继续阅读”的封面）
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { isUuid } from './api.js';

export async function getBooksByIds(ids) {
  const clean = [...new Set(ids)].filter(isUuid);
  if (!clean.length) return [];
  const url = new URL(SUPABASE_URL + '/rest/v1/books');
  url.searchParams.set('select', 'id,title,author,cover_url,language,script');
  url.searchParams.set('id', 'in.(' + clean.join(',') + ')');
  url.searchParams.set('status', 'eq.published');
  const r = await fetch(url, { headers: { apikey: SUPABASE_KEY } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
