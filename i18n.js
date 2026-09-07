/* ============================================================
   Локализация. По решению студии базовый язык — RU.
   EN держим для интерфейса (на будущее). Слова уровней — отдельный контент.
   ============================================================ */

window.I18N = (function () {
  var STRINGS = {
    ru: {
      loading: 'Загрузка…',
gameTitle: 'Словоход',
      gameSub: 'находи слова на ощупь',
      play: 'Играть',
      continue: 'Продолжить',
      levelDone: 'Уровень пройден',
      next: 'Дальше',
      howToPlay: 'Как играть',
      tutorialText: 'Веди пальцем по соседним буквам, чтобы составить слово',
      tutorialOk: 'Понятно!',
      howto: 'Находи слова по порядку: каждое следующее начинается с последней буквы предыдущего',
      hint: 'Подсказка за рекламу',
      levels: 'Уровни',
      chooseLevel: 'Выбор уровня',
      level: 'Уровень',
      restart: 'Начать сначала',
      confirmTitle: 'Прогресс сбросится. Начать заново?',
      confirmYes: 'Начать заново',
      confirmNo: 'Отмена',
      score: 'Счёт',
      best: 'Лучший',
      newRecord: 'Новый рекорд!',
    },
    en: {
      loading: 'Loading…',
gameTitle: 'Словоход',
      gameSub: 'trace the hidden words',
      play: 'Play',
      continue: 'Continue',
      levelDone: 'Level complete',
      next: 'Next',
      howToPlay: 'How to play',
      tutorialText: 'Drag your finger across adjacent letters to form a word',
      tutorialOk: 'Got it!',
      howto: 'Find words in order: each next word starts with the last letter of the previous',
      hint: 'Hint (watch ad)',
      levels: 'Levels',
      chooseLevel: 'Choose a level',
      level: 'Level',
      restart: 'Restart',
      confirmTitle: 'Progress will reset. Start over?',
      confirmYes: 'Start over',
      confirmNo: 'Cancel',
      score: 'Score',
      best: 'Best',
      newRecord: 'New best!',
    },
  };

  // Языки с русским интерфейсом (по рекомендации Яндекса, п.2.10).
  var RU_LOCALES = ['ru', 'be', 'kk', 'uk', 'uz'];

  // Включённые языки интерфейса. EN есть в STRINGS, но контент уровней не готов —
  // добавить 'en' сюда когда появится английский набор уровней.
  var ENABLED_LANGS = ['ru'];

  var current = 'ru';

  function pick(lang) {
    var code = (lang || 'ru').slice(0, 2).toLowerCase();
    if (RU_LOCALES.indexOf(code) !== -1) code = 'ru';
    current = ENABLED_LANGS.indexOf(code) !== -1 ? code : 'ru';
    return current;
  }

  function t(key) {
    var dict = STRINGS[current] || STRINGS.ru;
    return dict[key] != null ? dict[key] : key;
  }

  // Проставляет переводы во все элементы с атрибутом data-i18n.
  function apply(root) {
    var nodes = (root || document).querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
    }
    document.documentElement.lang = current;
  }

  return { pick: pick, t: t, apply: apply, get current() { return current; } };
})();
