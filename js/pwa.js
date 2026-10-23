// 安装到手机：注册离线外壳，并接住浏览器的“可安装”事件
let deferred = null;
const listeners = [];

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  listeners.forEach((f) => f());
});
window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach((f) => f()); });

export const onInstallChange = (f) => { listeners.push(f); };
export const isStandalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const canPrompt = () => !!deferred;
export async function promptInstall() {
  if (!deferred) return false;
  const d = deferred;
  deferred = null;
  d.prompt();
  try { const r = await d.userChoice; return r.outcome === 'accepted'; } catch (e) { return false; }
}
