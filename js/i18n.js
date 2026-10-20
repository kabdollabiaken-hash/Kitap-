import { storage } from './storage.js';

export const LANGS = [
  { code: 'kk', label: 'Қазақша' },
  { code: 'ru', label: 'Русский' },
  { code: 'zh', label: '中文' },
  { code: 'en', label: 'English' }
];

// 只放界面文案，不放书籍内容
const dict = {
  kk: {
    'brand': 'Kitap',
    'nav.aria': 'Негізгі навигация',
    'nav.home': 'Басты бет',
    'nav.library': 'Кітапхана',
    'nav.shelf': 'Сөре',
    'lang.label': 'Тіл',
    'search.placeholder': 'Кітап атауы немесе автор',
    'common.loading': 'Жүктелуде…',
    'common.error': 'Қате орын алды',
    'common.retry': 'Қайталау',
    'common.empty': 'Әзірге бос',
    'local.notice': 'Деректер тек осы құрылғыда сақталады және басқа құрылғыға автоматты түрде көшірілмейді.',
    'home.title': 'Оқуға арналған кітаптар',
    'home.continue': 'Оқуды жалғастыру',
    'home.soon': 'Бұл бөлім келесі қадамда жасалады.',
    'library.title': 'Кітапхана',
    'library.query': 'Іздеу',
    'shelf.title': 'Менің сөрем',
    'shelf.empty': 'Сөреде әзірге кітап жоқ',
    'notfound.title': 'Бет табылмады',
    'notfound.home': 'Басты бетке оралу'
  },
  ru: {
    'brand': 'Kitap',
    'nav.aria': 'Основная навигация',
    'nav.home': 'Главная',
    'nav.library': 'Библиотека',
    'nav.shelf': 'Полка',
    'lang.label': 'Язык',
    'search.placeholder': 'Название книги или автор',
    'common.loading': 'Загрузка…',
    'common.error': 'Произошла ошибка',
    'common.retry': 'Повторить',
    'common.empty': 'Пока пусто',
    'local.notice': 'Данные хранятся только на этом устройстве и не синхронизируются автоматически между устройствами.',
    'home.title': 'Книги для чтения',
    'home.continue': 'Продолжить чтение',
    'home.soon': 'Этот раздел будет сделан на следующем шаге.',
    'library.title': 'Библиотека',
    'library.query': 'Поиск',
    'shelf.title': 'Моя полка',
    'shelf.empty': 'На полке пока нет книг',
    'notfound.title': 'Страница не найдена',
    'notfound.home': 'На главную'
  },
  zh: {
    'brand': 'Kitap',
    'nav.aria': '主导航',
    'nav.home': '首页',
    'nav.library': '书库',
    'nav.shelf': '书架',
    'lang.label': '语言',
    'search.placeholder': '书名或作者',
    'common.loading': '加载中…',
    'common.error': '出错了',
    'common.retry': '重试',
    'common.empty': '暂无内容',
    'local.notice': '数据只保存在当前设备，不会自动同步到其他设备。',
    'home.title': '好书在线读',
    'home.continue': '继续阅读',
    'home.soon': '这个部分将在下一步完成。',
    'library.title': '书库',
    'library.query': '搜索',
    'shelf.title': '我的书架',
    'shelf.empty': '书架上还没有书',
    'notfound.title': '页面不存在',
    'notfound.home': '返回首页'
  },
  en: {
    'brand': 'Kitap',
    'nav.aria': 'Main navigation',
    'nav.home': 'Home',
    'nav.library': 'Library',
    'nav.shelf': 'Shelf',
    'lang.label': 'Language',
    'search.placeholder': 'Book title or author',
    'common.loading': 'Loading…',
    'common.error': 'Something went wrong',
    'common.retry': 'Retry',
    'common.empty': 'Nothing here yet',
    'local.notice': 'Data is stored only on this device and is not synced automatically to other devices.',
    'home.title': 'Books to read',
    'home.continue': 'Continue reading',
    'home.soon': 'This section will be built in the next step.',
    'library.title': 'Library',
    'library.query': 'Search',
    'shelf.title': 'My shelf',
    'shelf.empty': 'No books on your shelf yet',
    'notfound.title': 'Page not found',
    'notfound.home': 'Back to home'
  }
};

let current = 'kk';

export function initLang() {
  const saved = storage.getPrefs().lang;
  current = LANGS.some((l) => l.code === saved) ? saved : 'kk';
  document.documentElement.lang = current;
  return current;
}

export function getLang() { return current; }

export function setLang(code) {
  if (!LANGS.some((l) => l.code === code)) return;
  current = code;
  storage.setPrefs({ lang: code });
  document.documentElement.lang = code;
}

export function t(key, params) {
  let s = dict[current][key];
  if (s === undefined) {
    console.warn('[i18n] missing key', current, key);
    s = dict.kk[key] !== undefined ? dict.kk[key] : key;
  }
  if (params) s = s.replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? String(params[k]) : m));
  return s;
}

// 分类名称：数据库里是 {"kk":..,"ru":..,"zh":..,"en":..}
export function localized(nameObj) {
  if (!nameObj || typeof nameObj !== 'object') return '';
  return nameObj[current] || nameObj.kk || '';
}

// 自检：各语言是否缺少翻译键
export function checkI18n() {
  const base = Object.keys(dict.kk);
  const report = {};
  for (const l of LANGS) {
    const keys = Object.keys(dict[l.code]);
    report[l.code] = {
      missing: base.filter((k) => !keys.includes(k)),
      extra: keys.filter((k) => !base.includes(k))
    };
  }
  return report;
}
