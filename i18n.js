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
      allDone: 'Все уровни пройдены!',
      toMenu: 'В меню',
      howToPlay: 'Как играть',
      tutorialText: 'Веди пальцем по соседним буквам, чтобы составить слово',
      tutorialOk: 'Понятно!',
      howto: 'Находи слова по порядку: каждое следующее начинается с последней буквы предыдущего',
      hint: 'Подсказка за рекламу',
      hintFree: 'Подсказка',
      levels: 'Уровни',
      chooseLevel: 'Выбор уровня',
      level: 'Уровень',
      score: 'Счёт',
      best: 'Лучший',
      newRecord: 'Новый рекорд!',

      /* ЭТАП 3 (модуль удержания). Строки НЕ переносят язык постановки:
         в ТЗ ресурс называется «энергия», игроку это слово не сообщает
         НИЧЕГО про его выгоду. Проверка каждой строки — вопрос игрока
         «И ЧТО? СКОЛЬКО?»: ответ обязан быть числом или конкретной
         вехой. Строки разведены ПО СОСТОЯНИЯМ (полный запас / есть /
         пусто) — у каждого своё главное сообщение, а время идёт вторым
         планом, после обещания изобилия.
         Здесь лежит ВАРИАНТ Б («уровни, а не единицы») — выбранный по
         умолчанию. Варианты А и В отрисованы скриншотами для выбора
         основателя (studio_tools/gen_screenshots_energy.js): смена
         варианта = замена этих девяти строк, кода она не касается. */
      energyLabel: 'Запас',
      energyLineFull:  'Хватит на {n} {lv} подряд',
      energyLineHave:  'Хватит на {n} {lv} · +{gain} в {time}',
      energyLineEmpty: 'Новые уровни — в {time}, сразу {gain}',
      energyWallTitle: 'Новые уровни откроются в {time}',
      energyWallText:  'Придут сразу {gain} — хватит на {gain} {lvGain} подряд',
      energyWallSub:   'А пройденные открыты всегда: возвращайся за рекордом',
      energyWallBack:  'В меню',
      energyToastGain: '+{n} — можно играть дальше',
      // Серия входов — отдельная шкала (награды идут в подсказки, не в
      // запас). Смешивать шкалы запрещено: обменов и конвертаций нет.
      streakLine:      'Серия: {n} {d} подряд',
      streakToastHints: '+{n} {hint} за {day}-й день подряд',
      hintBonusHint:   'Подсказка бесплатно',
    },
    en: {
      loading: 'Loading…',
gameTitle: 'Словоход',
      gameSub: 'trace the hidden words',
      play: 'Play',
      continue: 'Continue',
      levelDone: 'Level complete',
      next: 'Next',
      allDone: 'All levels complete!',
      toMenu: 'Menu',
      howToPlay: 'How to play',
      tutorialText: 'Drag your finger across adjacent letters to form a word',
      tutorialOk: 'Got it!',
      howto: 'Find words in order: each next word starts with the last letter of the previous',
      hint: 'Hint (watch ad)',
      hintFree: 'Hint',
      levels: 'Levels',
      chooseLevel: 'Choose a level',
      level: 'Level',
      score: 'Score',
      best: 'Best',
      newRecord: 'New best!',

      energyLabel: 'Levels',
      energyLineFull:  'Enough for {n} new levels in a row',
      energyLineHave:  'Enough for {n} new levels · +{gain} at {time}',
      energyLineEmpty: 'New levels at {time} — {gain} at once',
      energyWallTitle: 'New levels open at {time}',
      energyWallText:  '{gain} arrive at once — enough for {gain} levels in a row',
      energyWallSub:   'Finished levels are always open: come back for a better score',
      energyWallBack:  'Menu',
      energyToastGain: '+{n} — keep playing',
      streakLine:      'Streak: {n} of {d} days',
      streakToastHints: '+{n} hints for day {day} in a row',
      hintBonusHint:   'Free hint',
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


  /* Русская плюрализация (1 уровень / 2 уровня / 5 уровней). Нужна
     строкам модуля удержания: «хватит на N уровней» без согласования
     читается как машинный перевод, а это первое, что видит игрок в
     шапке. forms = [один, два, пять]; для EN хватает [one, many]. */
  function plural(n, forms) {
    var abs = Math.abs(n) % 100;
    var last = abs % 10;
    if (current !== 'ru') return forms[n === 1 ? 0 : forms.length - 1];
    if (abs > 10 && abs < 20) return forms[2];
    if (last > 1 && last < 5) return forms[1];
    if (last === 1) return forms[0];
    return forms[2];
  }

  // Подстановка {ключ} в строку: t('energyLineHave', {n: 7, gain: 10}).
  function fill(key, vars) {
    var out = t(key);
    for (var k in vars) {
      if (vars.hasOwnProperty(k)) out = out.split('{' + k + '}').join(String(vars[k]));
    }
    return out;
  }

  // Проставляет переводы во все элементы с атрибутом data-i18n.
  function apply(root) {
    var nodes = (root || document).querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = t(nodes[i].getAttribute('data-i18n'));
    }
    document.documentElement.lang = current;
  }

  return { pick: pick, t: t, fill: fill, plural: plural, apply: apply, get current() { return current; } };
})();
