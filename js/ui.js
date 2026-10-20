// 公共小工具
import { t } from './i18n.js';

export const enc = encodeURIComponent;

// 创建 DOM 元素；文字一律用文本节点，不会被当作 HTML 解析
export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return e;
}

// 异步加载一个区块：加载中 -> 内容 / 错误+重试。fn 返回 null 表示整个区块隐藏
export async function loadInto(box, fn) {
  box.replaceChildren(h('p', { class: 'muted' }, t('common.loading')));
  try {
    const node = await fn();
    if (node === null) {
      const sec = box.closest('section');
      if (sec) sec.remove(); else box.replaceChildren();
      return;
    }
    box.replaceChildren(node);
  } catch (e) {
    console.error(e);
    box.replaceChildren(h('div', { class: 'card' },
      h('p', { class: 'bad' }, t('common.error')),
      h('button', { class: 'btn', type: 'button', onclick: () => loadInto(box, fn) }, t('common.retry'))));
  }
}
