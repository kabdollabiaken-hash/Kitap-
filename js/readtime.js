// 阅读时长计时：只在阅读页、页面在前台、最近 2 分钟内有操作时累计
import { storage } from './storage.js';

const IDLE_MS = 120000;
let lastActive = Date.now();
let pending = 0;
let ticks = 0;

const bump = () => { lastActive = Date.now(); };
['scroll', 'touchstart', 'pointerdown', 'keydown', 'wheel', 'mousemove'].forEach((ev) =>
  window.addEventListener(ev, bump, { passive: true, capture: true }));

function flush() {
  if (pending > 0) { storage.addReadTime(pending); pending = 0; }
}

setInterval(() => {
  const reading = document.body.classList.contains('reading');
  if (reading && document.visibilityState === 'visible' && Date.now() - lastActive < IDLE_MS) pending += 1;
  ticks += 1;
  if (ticks % 15 === 0) flush();
}, 1000);

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
window.addEventListener('pagehide', flush);
window.addEventListener('hashchange', flush);
