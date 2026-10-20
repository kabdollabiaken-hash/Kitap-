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
    'common.all': 'Барлығы',
    'local.notice': 'Деректер тек осы құрылғыда сақталады және басқа құрылғыға автоматты түрде көшірілмейді.',
    'home.title': 'Оқуға арналған кітаптар',
    'home.continue': 'Оқуды жалғастыру',
    'home.featured': 'Ұсынылатындар',
    'home.new': 'Жаңа түскендер',
    'home.categories': 'Санаттар',
    'home.more': 'Барлығын көру',
    'home.soon': 'Бұл бөлім келесі қадамда жасалады.',
    'library.title': 'Кітапхана',
    'library.query': 'Іздеу',
    'library.clear': 'Іздеуді тазалау',
    'library.noresults': 'Ештеңе табылмады',
    'library.nobooks': 'Кітапхана әзірге бос',
    'pager.prev': 'Алдыңғы',
    'pager.next': 'Келесі',
    'pager.page': '{n}-бет',
    'langname.kk': 'Қазақша',
    'langname.ru': 'Орысша',
    'langname.zh': 'Қытайша',
    'langname.en': 'Ағылшынша',
    'script.cyrillic': 'Кирилл жазуы',
    'script.latin': 'Латын жазуы',
    'script.arabic': 'Араб жазуы',
    'script.han': 'Иероглиф',
    'book.start': 'Оқуды бастау',
    'book.addShelf': 'Сөреге қосу',
    'book.removeShelf': 'Сөреден алып тастау',
    'book.added': 'Сөреге қосылды',
    'book.removed': 'Сөреден алынды',
    'book.contents': 'Мазмұны',
    'book.nochapters': 'Бұл кітапта әзірге оқуға болатын тараулар жоқ',
    'book.progress': '{n}-тарау, {p}%',
    'book.copyright': 'Авторлық құқық дерегі',
    'book.notfound': 'Кітап табылмады',
    'book.toLibrary': 'Кітапханаға оралу',
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
    'common.all': 'Все',
    'local.notice': 'Данные хранятся только на этом устройстве и не синхронизируются автоматически между устройствами.',
    'home.title': 'Книги для чтения',
    'home.continue': 'Продолжить чтение',
    'home.featured': 'Рекомендуем',
    'home.new': 'Новинки',
    'home.categories': 'Категории',
    'home.more': 'Показать все',
    'home.soon': 'Этот раздел будет сделан на следующем шаге.',
    'library.title': 'Библиотека',
    'library.query': 'Поиск',
    'library.clear': 'Сбросить поиск',
    'library.noresults': 'Ничего не найдено',
    'library.nobooks': 'Библиотека пока пуста',
    'pager.prev': 'Назад',
    'pager.next': 'Далее',
    'pager.page': 'Стр. {n}',
    'langname.kk': 'Казахский',
    'langname.ru': 'Русский',
    'langname.zh': 'Китайский',
    'langname.en': 'Английский',
    'script.cyrillic': 'Кириллица',
    'script.latin': 'Латиница',
    'script.arabic': 'Арабская графика',
    'script.han': 'Иероглифы',
    'book.start': 'Начать чтение',
    'book.addShelf': 'Добавить на полку',
    'book.removeShelf': 'Убрать с полки',
    'book.added': 'Добавлено на полку',
    'book.removed': 'Убрано с полки',
    'book.contents': 'Оглавление',
    'book.nochapters': 'В этой книге пока нет глав для чтения',
    'book.progress': 'Глава {n}, {p}%',
    'book.copyright': 'Источник и права',
    'book.notfound': 'Книга не найдена',
    'book.toLibrary': 'Вернуться в библиотеку',
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
    'common.all': '全部',
    'local.notice': '数据只保存在当前设备，不会自动同步到其他设备。',
    'home.title': '好书在线读',
    'home.continue': '继续阅读',
    'home.featured': '推荐',
    'home.new': '新上架',
    'home.categories': '分类',
    'home.more': '查看全部',
    'home.soon': '这个部分将在下一步完成。',
    'library.title': '书库',
    'library.query': '搜索',
    'library.clear': '清除搜索',
    'library.noresults': '没有找到结果',
    'library.nobooks': '书库暂时没有书',
    'pager.prev': '上一页',
    'pager.next': '下一页',
    'pager.page': '第 {n} 页',
    'langname.kk': '哈萨克语',
    'langname.ru': '俄语',
    'langname.zh': '中文',
    'langname.en': '英语',
    'script.cyrillic': '西里尔字母',
    'script.latin': '拉丁字母',
    'script.arabic': '阿拉伯字母',
    'script.han': '汉字',
    'book.start': '开始阅读',
    'book.addShelf': '加入书架',
    'book.removeShelf': '移出书架',
    'book.added': '已加入书架',
    'book.removed': '已移出书架',
    'book.contents': '目录',
    'book.nochapters': '这本书暂时没有可阅读的章节',
    'book.progress': '第 {n} 章，{p}%',
    'book.copyright': '版权来源',
    'book.notfound': '没有找到这本书',
    'book.toLibrary': '返回书库',
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
    'common.all': 'All',
    'local.notice': 'Data is stored only on this device and is not synced automatically to other devices.',
    'home.title': 'Books to read',
    'home.continue': 'Continue reading',
    'home.featured': 'Featured',
    'home.new': 'New arrivals',
    'home.categories': 'Categories',
    'home.more': 'See all',
    'home.soon': 'This section will be built in the next step.',
    'library.title': 'Library',
    'library.query': 'Search',
    'library.clear': 'Clear search',
    'library.noresults': 'No results found',
    'library.nobooks': 'The library is empty for now',
    'pager.prev': 'Previous',
    'pager.next': 'Next',
    'pager.page': 'Page {n}',
    'langname.kk': 'Kazakh',
    'langname.ru': 'Russian',
    'langname.zh': 'Chinese',
    'langname.en': 'English',
    'script.cyrillic': 'Cyrillic',
    'script.latin': 'Latin',
    'script.arabic': 'Arabic script',
    'script.han': 'Han',
    'book.start': 'Start reading',
    'book.addShelf': 'Add to shelf',
    'book.removeShelf': 'Remove from shelf',
    'book.added': 'Added to shelf',
    'book.removed': 'Removed from shelf',
    'book.contents': 'Contents',
    'book.nochapters': 'This book has no readable chapters yet',
    'book.progress': 'Chapter {n}, {p}%',
    'book.copyright': 'Copyright source',
    'book.notfound': 'Book not found',
    'book.toLibrary': 'Back to library',
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

// 其他模块追加自己的界面文案：addMessages({ kk: {...}, ru: {...}, zh: {...}, en: {...} })
export function addMessages(bundle) {
  for (const code of Object.keys(bundle)) {
    if (dict[code]) Object.assign(dict[code], bundle[code]);
  }
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
