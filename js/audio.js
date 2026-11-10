// 阅读器底部的听书条：只是全局播放器的遥控器（播放声音的是 player.js 里唯一的那个播放器）
import { player } from './player.js';
import { h } from './ui.js';
import { getLang } from './i18n.js';

const TX = {
  kk: { listen: 'Осы тарауды тыңдау', open: 'Ашу' },
  ru: { listen: 'Слушать эту главу', open: 'Открыть' },
  zh: { listen: '听本章', open: '展开' },
  en: { listen: 'Listen to this chapter', open: 'Open' }
};

export function createAudio({ bookId, chapterId, chapterTitle }) {
  const tx = TX[getLang()] || TX.kk;
  const btn = h('button', { class: 'rd-btn', type: 'button', style: 'min-width:44px' });
  const openBtn = h('button', { class: 'rd-btn', type: 'button', onclick: () => player.open() }, tx.open);
  const label = h('span', { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', dir: 'auto' }, tx.listen);
  const el = h('div', { class: 'rd-audio', style: 'display:flex;align-items:center;gap:8px;padding:6px 12px' }, btn, label, openBtn);
  const mine = () => { const s = player.state(); return s.active && s.chapterId === chapterId ? s : null; };
  const paint = () => {
    const s = mine();
    btn.textContent = s && s.playing ? '❚❚' : '▶';
    btn.setAttribute('aria-label', tx.listen);
    openBtn.hidden = !player.state().active;
    label.textContent = chapterTitle || tx.listen;
  };
  btn.addEventListener('click', () => { if (mine()) player.toggle(); else player.playBook(bookId, chapterId); });
  const off = player.onChange(paint);
  paint();
  return { el, destroy: off };
}
