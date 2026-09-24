/* ============================================================
   main.js — запуск + навигация по экранам.
   Фаза 0: init SDK → язык → меню → Game Ready.
   Фаза 1: кнопка «Играть» открывает игровой экран и рисует поле уровня.
   ============================================================ */

(function () {
  var elLoading = document.getElementById('loading');
  var elMenu = document.getElementById('menu');
  var elGame = document.getElementById('game');
  var btnPlay = document.getElementById('btn-play');
  var btnContinue = document.getElementById('btn-continue');
  var btnSound = document.getElementById('btn-sound');
  var btnSoundGame = document.getElementById('btn-sound-game');
  var btnBack = document.getElementById('btn-back');
  var btnRestartLevel = document.getElementById('btn-restart-level');
  var devBadge = document.getElementById('dev-badge');
  var gameTheme = document.getElementById('game-theme');
  var gameLevel = document.getElementById('game-level');
  var gameCounter = document.getElementById('game-counter');
  var elWin = document.getElementById('win');
  var elWinTitle = elWin ? elWin.querySelector('.overlay-title') : null;
  var elWinScore = document.getElementById('win-score');
  var elWinBest  = document.getElementById('win-best');
  var elWinNew   = document.getElementById('win-new');
  var elWinEnergy = document.getElementById('win-energy'); // b19: «осталось N новых уровней»
  var elWinMore = document.getElementById('win-more');     // b20: после последнего уровня
  var elMenuMore = document.getElementById('menu-more');   // b20: та же строка в меню
  var elEnergyFly = document.getElementById('energy-fly'); // b20: перелёт ⚡ к счётчику
  var elEnergyPlus = document.getElementById('energy-plus');
  var btnNext = document.getElementById('btn-next');
  var btnHint = document.getElementById('btn-hint');
  var elWinStars = document.getElementById('win-stars');       // b24: 1–3 звезды за уровень
  var elWinChapter = document.getElementById('win-chapter');   // b24: прогресс главы на победе
  var elWinChapterLabel = document.getElementById('win-chapter-label');
  var elWinChapterFill = document.getElementById('win-chapter-fill');
  var elWordList = document.getElementById('word-list');
  var elHowto = document.getElementById('howto');
  var btnEnergyHelp = document.getElementById('btn-energy-help');   // b23: «?» у запаса
  var elEnergyPop = document.getElementById('energy-pop');          // b23: попап с пояснением
  var elLevels = document.getElementById('levels');
  var levelsGrid = document.getElementById('levels-grid');
  var btnLevels = document.getElementById('btn-levels');
  var btnLevelsBack = document.getElementById('btn-levels-back');
  var lvTotal = document.getElementById('lv-total');
  var buildBadge = document.getElementById('build-badge');
  // ЭТАП 3 — модуль удержания
  var elWall = document.getElementById('energy-wall');
  var wallTitle = document.getElementById('wall-title');
  var wallText = document.getElementById('wall-text');
  var wallSub = document.getElementById('wall-sub');
  var btnWallBack = document.getElementById('btn-wall-back');
  var btnWallMenu = document.getElementById('btn-wall-menu');
  var streakLine = document.getElementById('streak-line');
  var retentionToast = document.getElementById('retention-toast');
  var hintBadge = document.getElementById('hint-bonus-badge');

  // Плашка номера билда (стандарт с 2026-07-25): текст ставим сразу, не
  // дожидаясь Platform.init() — это статическая метка сборки, не данные
  // платформы. window.BUILD подставляет build.py (маркер BUILD_INFO в
  // index.html); вне билда (локальная разработка) остаётся 'dev'.
  if (buildBadge) buildBadge.textContent = window.BUILD || 'dev';

  var soundOn = true;
  var currentIndex = 0;  // индекс текущего уровня
  var savedIndex = null; // сохранённый прогресс для кнопки «Продолжить»
  var maxUnlocked = 0;   // максимальный открытый индекс уровня
  var records = { levels: {}, total: 0 }; // личные рекорды по уровням
  var levelScore = 0;    // очки текущего уровня
  var hintsUsed = 0;     // подсказки взяты в текущем уровне
  var tutorialShown = false; // b24: «призрачный палец» на 1-м уровне — до первой находки в сессии
  var isNewPlayer = false;   // b24: сейва нет вовсе — «Забрать» в карточке дня ведёт сразу в игру
  var hintWord = null;   // текущее целевое слово для revealHint (= chain[chainPos])

  /* ============================================================
     МОДУЛЬ УДЕРЖАНИЯ (ЭТАП 3). Система КОПИРУЕТСЯ из Color Sort, не
     изобретается: retention.js взят побайтовой копией, здесь — только
     конфиг и точки применения. Числа — решение основателя (Р-СЛ10),
     менять их без нового решения нельзя.

     ДВЕ ШКАЛЫ НЕ СМЕШИВАЮТСЯ (шрам ТЗ №15 Color Sort):
       ЗАПАС (энергия) — тратится на ВПЕРВЫЕ пройденный уровень;
       ПОДСКАЗКИ — отдельный баланс, в него идут награды серии входов.
     Между ними нет ни обмена, ни конвертации, ни общего счётчика: ни
     одна функция ниже не читает обе величины сразу.
     ============================================================ */
  var RETENTION_CONFIG = (typeof Retention !== 'undefined') ? Retention.mergeConfig({
    // gateMode:'energy' — накопитель НИЧЕГО не открывает, это отдельная
    // тратимая валюта (уровни в сетке по-прежнему открывает только
    // прогресс, maxUnlocked). Числа ТЗ: потолок 15, +10 за такт 6 часов.
    gateMode:       'energy',
    tickMs:         4 * 60 * 60 * 1000,
    dripPerTick:    10,
    accumulatorCap: 15,
    /* РЕИНКАРНАЦИЯ b19 (2026-09-12, гипотеза 1 «Календарь возвращений»,
       см. 03_РЕИНКАРНАЦИЯ_Словоход_стратегия.md §4). Награды по дням
       считает КАЛЕНДАРЬ в main.js (DAILY_REWARDS ниже), модулю оставлен
       только счёт дней серии. Награды модуля по дням 2/3 выключены ЯВНО
       (null): mergeConfig иначе подмешал бы дефолты Color Sort
       {2:'hints', 3:'style'}. Порог серии 7 — длина календаря. */
    streakThreshold: 7,
    streakDayReward:  { 2: null, 3: null },
    callbacks: {
      totalLevels:     function ()  { return Levels.count(); },
      // «Пройден» в Словоходе = индекс меньше maxUnlocked: завершение
      // уровня двигает maxUnlocked на currentIndex+1. По рекордам
      // определять нельзя — запись рекорда условная (records.levels[i]
      // не появляется, если счёт не побил прошлый), и уровень, пройденный
      // с нулевым счётом, выглядел бы непройденным.
      isCompleted:     function (i) { return i < maxUnlocked; },
      maxReachedIndex: function ()  { return maxUnlocked; },
      grantHints:      function (n, day) { grantBonusHints(n, day); },
      // Косметики в Словоходе нет — награда 'style' не используется.
      grantStyle:      function ()  {},
    },
  }) : null;

  var retentionState = null;   // состояние модуля (энергия + серия)
  var bonusHints = 0;          // ВТОРАЯ шкала: бесплатные подсказки
  var pendingOpenIndex = null; // куда шёл игрок, когда упёрся в стену
  var retentionTimer = null;

  /* ============================================================
     КАЛЕНДАРЬ ВОЗВРАЩЕНИЙ (b19, гипотеза 1). Семь дней по кругу; день
     календаря = длина серии модуля + calOffset (см. bootRetention: после
     пропуска модуль считает серию с 0, а календарь обязан показать
     «День 1» с наградой — иначе вернувшийся после перерыва игрок
     получает «ничего»). Награда выдаётся ПО КНОПКЕ «Забрать» — ритуал
     входа и есть механика; незабранная награда переживает закрытие
     вкладки (dailyPending в сейве) и показывается снова в тот же день.
     Числа шкалы — решение LGD 2026-09-12, ждёт подтверждения основателя
     (test_retention.js [0] сверяет их с этим решением).
     ============================================================ */
  var DAILY_DAYS = 7;
  var DAILY_REWARDS = {
    1: { hints: 1 },
    2: { hints: 2 },
    3: { energy: 5 },
    4: { hints: 3 },
    5: { energy: 5 },
    6: { hints: 5 },
    7: { energy: 10, gold: 1 },
  };
  var calOffset = 0;      // 0/1 — сдвиг дня календаря относительно серии модуля
  var dailyPending = 0;   // день, награда за который показана, но не забрана (0 — нет)
  var goldHints = 0;      // ТРЕТЬЯ шкала: золотые подсказки (открывают слово целиком)

  /* Ролик у стены (b19, гипотеза 2): +WALL_AD_ENERGY запаса за rewarded,
     не выше потолка (Retention.grantDrip), не более WALL_ADS_PER_DAY раз
     в календарный день — счётчик в сейве (wa). Паттерн перенесён из
     Color Sort (main.js:1266-1290, onEnergyWallAdClick). */
  var WALL_AD_ENERGY = 5;
  var WALL_ADS_PER_DAY = 3;
  var wallAds = { d: '', n: 0 };
  // Экран победы предупреждает о близкой стене, когда запаса осталось мало.
  var WIN_ENERGY_WARN = 3;

  /* ---------- Золотое слово (b20, решение основателя 12.09) ----------
     На десяти уровнях из первых пятнадцати одно слово цепочки — золотое:
     найденное ВПЕРВЫЕ, оно даёт +1 к запасу мимо потолка (как награда
     календаря) с перелётом значка ⚡ к счётчику и всплывающим «+1».
     Разово на уровень: номера забранных уровней — в сейве (gw); рестарт
     и повтор чип не золотят, абузить нечего. Цель — азарт и первая сессия
     без стены и без принудительной рекламы (см. adLevelGate ниже). */
  var GOLD_LEVELS = [1, 2, 4, 5, 7, 9, 10, 11, 13, 15];
  var GOLD_BURST_MS = 420; // b22: фаза 1 — чип разрастается (CSS gold-burst), потом перелёт ⚡
  var goldClaimed = [];   // номера уровней (1-based), где золотое слово уже забрано

  function goldWordFor(index, level) {
    if (GOLD_LEVELS.indexOf(index + 1) === -1) return null;
    if (goldClaimed.indexOf(index + 1) !== -1) return null;
    if (!level.chain || !level.chain.length) return null;
    // Среднее слово цепочки: награда приходит в середине уровня, а не под
    // оверлеем победы, который через 450 мс закрыл бы анимацию.
    return level.chain[Math.floor(level.chain.length / 2)];
  }

  // Гейт частоты interstitial (задача Б, п.4.7): каждый N-й уровень И не
  // чаще раза в T мс — оба условия обязательны. Гейт живёт в памяти
  // сессии (не в сейве) — на новый запуск игры счётчик сбрасывается.
  //
  // ЭТАП 2, п.1.4 — решение основателя 23.08, вариант В «выровнять с
  // Color Sort»: 2 → 5 уровней, 60000 → 90000 мс. Числа сверены ЧТЕНИЕМ
  // эталона: color_sort/main.js:1406-1407 (AD_LEVELS_INTERVAL = 5,
  // AD_MIN_GAP_MS = 90000) — совпали, подгонять ничего не пришлось.
  // Уровень Словохода 20-40 с; при старом гейте «2 уровня / 60 с» игрок
  // видел полноэкранную почти каждую минуту. Осознанный размен части
  // дохода на удержание.
  //
  // ДОБОР ЭТАПА 2, п.1 (решение основателя 23.08, Р-СЛ7): кулдаун
  // 90000 → 240000 мс. Гейт 5 уровней НЕ меняется. Это меняет ЧТО именно
  // ограничивает показ: пять уровней Словохода — это 100-200 с, то есть
  // кулдаун 240 с теперь БОЛЬШЕ гейта и стал связывающим ограничением.
  // Отсюда критично поведение счётчика ниже: гейт добирается раньше,
  // чем истекает кулдаун, и счётчик обязан ДОЖДАТЬСЯ кулдауна, а не
  // обнулиться на заблокированной попытке (иначе игроку понадобятся ещё
  // пять уровней ПЛЮС новый кулдаун — полноэкранная почти исчезнет).
  // Проверено тестом test_smoke_game.js [13] на ОБЕ ветки условия.
  //
  // КУЛДАУН НЕ РАСПРОСТРАНЯЕТСЯ НА REWARDED (стандарт 26.07): он
  // ограничивает только НЕПРОШЕНУЮ рекламу. Запрошенный игроком ролик
  // (кнопка подсказки) показывается каждый раз — обработчик btnHint
  // ниже гейт не читает и счётчики не двигает.
  //
  // b20 (решение основателя 12.09): первые AD_FREE_LEVELS уровней — без
  // принудительной рекламы вовсе (игрок проходит их в своём темпе, это
  // ~10 минут); дальше порог «уровней с последнего показа» зависит от
  // номера пройденного уровня: до 30-го — каждый 3-й, до 80-го — каждый
  // 4-й, дальше — каждый 5-й. Кулдаун 240000 → 60000 мс: при уровне в
  // 30–40 с «каждый 3-й» — это раз в 90–120 с, и старый кулдаун молча
  // вернул бы «раз в 6–8 уровней» (расписание заменяет Р-СЛ7); 60 с
  // остаются страховкой от двойного показа на быстрых повторах.
  var AD_FREE_LEVELS = 15;
  function adLevelGate(levelNo) {
    if (levelNo <= AD_FREE_LEVELS) return 0;   // 0 — рекламы нет
    if (levelNo <= 30) return 3;
    if (levelNo <= 80) return 4;
    return 5;
  }
  var AD_MIN_INTERVAL_MS = 60000;
  var levelsSinceAd = 0;
  var lastAdShownAt = 0;

  /* ---------- Сторож объёма сейва (ЭТАП 2, п.2.1) ----------
     Замер РЕАЛЬНЫХ байт перед КАЖДОЙ записью, а не расчёт «должно
     влезать» (стандарт студии, эталон Color Sort/main.js:persist).
     Бюджет — Platform.SAVE_SIZE_GUARD_BYTES (3500 байт на ВК);
     это ИНЖЕНЕРНЫЙ БЮДЖЕТ СТУДИИ (решение основателя 22.08),
     первоисточником (документацией площадки) НЕ подтверждён.

     ПОВЕДЕНИЕ ПРИ ПРЕВЫШЕНИИ — как в Color Sort: громкий console.error,
     запись ВСЁ РАВНО уходит. Схема сейва Словохода ограничена
     (100 уровней + рекорды, не растёт бесконечно) — безопасного поля
     для вытеснения нет, а отказ от записи гарантированно потерял бы
     прогресс игрока; попытка записи — нет.

     ВСЕ точки сохранения зовут persist(), не Platform.save() напрямую —
     единая точка контроля. Объект пишется ЦЕЛИКОМ ({level, max,
     records}): частичная запись затирает поля (п.2.3, не регрессировать). */
  function saveByteSize(payload) {
    var json = JSON.stringify(payload);
    // Blob — как в эталоне; TextEncoder/фолбэк нужны там, где Blob нет
    // (Node-песочница тестов). Все три считают UTF-8 байты, не символы:
    // кириллица в JSON экранируется не всегда, а сейв ВК меряется в байтах.
    if (typeof Blob === 'function') return new Blob([json]).size;
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(json).length;
    return unescape(encodeURIComponent(json)).length;
  }

  /* Сериализация последней ПОДТВЕРЖДЁННОЙ записи. null — ещё ничего не
     писали в этой сессии, поэтому первая запись уходит всегда. */
  var lastSavedJson = null;

  function persist(fullState) {
    /* ЭТАП 3, п.3 (миграция): поля модуля удержания дописываются ЗДЕСЬ,
       в единственной точке записи. Любой существующий вызов persist()
       (их шесть) иначе записал бы объект БЕЗ них — и молча стёр бы
       игроку запас и серию, потому что объект пишется целиком (п.2.3).
       Ключи короткие (r/bh): сейв меряется байтами, см. сторож ниже. */
    // b24: звёзды по уровням — строка из символов 0–3 (≤ 100 байт), пишется
    // в той же единственной точке, иначе любой persist() стёр бы их.
    var st = encodeStars();
    if (st) fullState.st = st;
    if (retentionState && typeof Retention !== 'undefined') {
      fullState.r = Retention.encodeState(retentionState);
      fullState.bh = bonusHints;
      // b19: календарь и ролик у стены — те же короткие ключи, тот же
      // сторож объёма ниже (+~40 байт). Билд b18 эти ключи игнорирует:
      // откат безопасен для прогресса, теряется только календарь.
      fullState.co = calOffset;
      fullState.dp = dailyPending;
      fullState.gh = goldHints;
      fullState.wa = wallAds;
      fullState.gw = goldClaimed;   // b20: забранные золотые слова (номера уровней)
    }

    /* ---------- Пропуск повторной записи (ЭТАП 5, добор п.1) ----------
       Решение основателя: писать только при изменении состояния.

       ЗАЧЕМ. У хранилища ВК лимит 100 записей / 5 минут. Запас энергии
       сторожит только НОВЫЕ уровни; «Заново» и повторное открытие уже
       пройденного бесплатны (ЭТАП 3, п.1) и ничем не ограничены, а
       писали по записи на нажатие. Модуль удержания сам гонит игрока в
       этот путь: упёршись в стену, он идёт перепроходить старое. Оба
       действия сериализуются в ТОТ ЖЕ объект — значит причина в том,
       что мы пишем одно и то же, а не в том, что игрок частит.

       ПОЧЕМУ КЭШ ОБНОВЛЯЕТСЯ ТОЛЬКО ПО ПОДТВЕРЖДЕНИЮ, А НЕ В МОМЕНТ
       ПОПЫТКИ. Если пометить состояние сохранённым сразу, то после
       НЕУДАЧНОЙ записи (та самая ошибка при превышении лимита, ради
       которой всё и делается) следующая попытка записать то же самое
       будет опознана как дубль и не уйдёт никогда: мягкий сбой
       площадки мы своими руками превратили бы в потерю прогресса.
       Родня уже принятому правилу «запись не производится на основании
       неудачного ответа» — неудачный ответ не должен становиться
       основанием и для пропуска.

       ГОНКА. Пока запись в полёте, кэш ещё старый, поэтому одинаковая
       запись, поданная следом, уйдёт второй раз. Это сознательно
       оставлено так: лишняя запись дешевле пропущенной. */
    var json = JSON.stringify(fullState);
    if (json === lastSavedJson) {
      console.log('[save] состояние не изменилось — запись пропущена ' +
        '(лимит хранилища 100 записей / 5 мин)');
      return;
    }

    if (Platform && typeof Platform.SAVE_SIZE_GUARD_BYTES === 'number') {
      var bytes = saveByteSize(fullState);
      if (bytes > Platform.SAVE_SIZE_GUARD_BYTES) {
        console.error('[save] СЕЙВ ПРЕВЫСИЛ БЮДЖЕТ СТОРОЖА: ' + bytes + ' байт > ' +
          Platform.SAVE_SIZE_GUARD_BYTES + ' — площадка может отклонить/обрезать запись. ' +
          'Схема сейва фиксированная (100 уровней максимум), поэтому это баг, ' +
          'а не органический рост данных — чинить причину, не добавлять вытеснение задним числом. ' +
          'Запись всё равно отправлена: отказ от неё гарантированно потерял бы прогресс.');
      }
    }
    /* Кэш двигаем в .then, а не здесь: «записали» — это подтверждение
       площадки, а не факт вызова. Promise.resolve обёртывает ответ на
       случай адаптера-заглушки, который вернёт не промис. */
    Promise.resolve(Platform.save(fullState)).then(function (okSaved) {
      if (okSaved) lastSavedJson = json;
      else console.warn('[save] площадка не подтвердила запись — состояние ' +
        'НЕ помечено сохранённым, следующая попытка уйдёт снова');
    });
  }

  /* ============================================================
     ЗАПАС, СЕРИЯ, СТЕНА — точки применения модуля.
     ВСЁ время читается через Platform.now() (единая точка, ЭТАП 3 п.1):
     ни одна функция ниже не зовёт Date.now() сама, иначе сценарии
     времени нельзя проверить, не переводя часы рабочей машины.
     Любое правило, которое МОЛЧА меняет видимое поведение (не начислили,
     не списали, не выдали), пишет причину в консоль (п.5): через сутки
     собственное правило неотличимо от бага.
     ============================================================ */

  function energyLeft() {
    if (!retentionState || typeof Retention === 'undefined') return 0;
    return Retention.dripBacklogCount(retentionState, RETENTION_CONFIG);
  }

  // Сейв прогресса «как есть» — для записей, которые инициирует модуль
  // (такт, серия, трата подсказки), когда уровень не открывался.
  function persistProgress() {
    persist({ level: (savedIndex != null ? savedIndex : 0), max: maxUnlocked, records: records });
  }

  function formatClock(ms) {
    var d = new Date(ms);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  /* Остаток до следующего такта словами («через 5 ч 12 мин»). Нужен
     вариантам копирайта, которые обещают срок, а не время на часах:
     на часах понятнее «когда», в обратном отсчёте — «сколько ждать».
     Строка обновляется каждым тактом таймера (см. retentionTick), то
     есть отстаёт максимум на полминуты. */
  function formatLeft(nextAtMs) {
    var ms = Math.max(0, nextAtMs - Platform.now());
    var totalMin = Math.ceil(ms / 60000);
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    if (h > 0 && m > 0) return h + ' ч ' + m + ' мин';
    if (h > 0) return h + ' ч';
    return Math.max(1, m) + ' мин';
  }

  var LV_FORMS = ['новый уровень', 'новых уровня', 'новых уровней'];
  var HINT_FORMS = ['подсказка', 'подсказки', 'подсказок'];
  var DAY_FORMS = ['день', 'дня', 'дней'];

  /* Индикатор запаса: ОДНА функция обновляет ВСЕ инстансы разом (меню,
     игровой экран, стена) по классам, а не по id — новое место в UI
     добавляется разметкой, без правки этой функции.
     Строка разведена ПО СОСТОЯНИЯМ: полный запас / есть / пусто. */
  function renderEnergy() {
    if (!retentionState || typeof Retention === 'undefined') return;
    var cur = energyLeft();
    var cap = RETENTION_CONFIG.accumulatorCap;
    var gain = RETENTION_CONFIG.dripPerTick;
    var nextAt = Retention.nextUnlockAtMs(retentionState, RETENTION_CONFIG);
    setAllText('.energy-now', String(cur));
    setAllText('.energy-cap', String(cap));

    var vars = {
      n: cur, cap: cap, gain: gain, lv: I18N.plural(cur, LV_FORMS),
      time: nextAt == null ? '' : formatClock(nextAt),
      left: nextAt == null ? '' : formatLeft(nextAt),
    };
    var line;
    if (cur >= cap) line = I18N.fill('energyLineFull', vars);
    else if (cur > 0) line = I18N.fill('energyLineHave', vars);
    else line = I18N.fill('energyLineEmpty', vars);
    setAllText('.energy-line', line);
    setAllText('.energy-rule', I18N.fill('energyRule', vars));   // b23: попап «?»
  }

  /* b23: «?» у счётчика — всплывающая карточка с пояснением (index.html
     #energy-pop). Закрывается тапом вне карточки, повторным тапом по «?»,
     Escape и при смене экрана (showScreen). В тестовом шиме элементов
     может не быть — все обращения под проверкой. */
  function setEnergyPop(open) {
    if (!elEnergyPop) return;
    if (open) elEnergyPop.classList.add('open'); else elEnergyPop.classList.remove('open');
    if (btnEnergyHelp && typeof btnEnergyHelp.setAttribute === 'function') {
      btnEnergyHelp.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
  }
  function energyPopOpen() { return !!(elEnergyPop && elEnergyPop.classList.contains('open')); }
  if (btnEnergyHelp) {
    btnEnergyHelp.addEventListener('click', function (e) {
      if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
      setEnergyPop(!energyPopOpen());
    });
  }
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('pointerdown', function (e) {
      if (!energyPopOpen()) return;
      var t = e && e.target;
      if (t === btnEnergyHelp) return;
      if (elEnergyPop && typeof elEnergyPop.contains === 'function' && elEnergyPop.contains(t)) return;
      setEnergyPop(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e && e.key === 'Escape') setEnergyPop(false);
    });
  }

  /* b23: полоса под баннер площадки (решение основателя 13.09: баннер
     снизу на постоянной основе). Адаптер сообщает, сколько пикселей
     баннер перекрывает снизу: ВК с layout_type:'resize' — 0 (клиент сам
     ужимает окно мини-аппа), Яндекс sticky — высота баннера. Экраны
     заканчиваются выше на эту величину (CSS --banner-h), поле
     пересчитывается. */
  function setBannerInset(px) {
    var v = (typeof px === 'number' && px > 0) ? Math.round(px) : 0;
    var rootEl = document.documentElement;
    if (rootEl && rootEl.style && typeof rootEl.style.setProperty === 'function') {
      rootEl.style.setProperty('--banner-h', v + 'px');
    }
    console.log('[platform] полоса под баннер снизу: ' + v + 'px');
    if (typeof Board !== 'undefined' && typeof Board.fit === 'function') Board.fit();
  }

  function setAllText(selector, text) {
    var nodes = document.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = text;
  }

  /* ---------- Календарь возвращений (b19) ---------- */
  var elDaily      = document.getElementById('daily');
  var dailyTitle   = document.getElementById('daily-title');
  var dailyCells   = document.getElementById('daily-cells');
  var dailyReward  = document.getElementById('daily-reward');
  var dailyTomorrow = document.getElementById('daily-tomorrow');
  var btnDailyClaim = document.getElementById('btn-daily-claim');

  function calendarDay(n) { return ((n - 1) % DAILY_DAYS) + 1; }

  // День календаря по текущему состоянию модуля (для строки меню).
  function currentCalendarDay() {
    if (!retentionState) return 1;
    return calendarDay(Math.max(1, retentionState.streakLen + calOffset));
  }

  // Текст награды дня: «+2 подсказки», «+5 новых уровней»,
  // «+10 новых уровней и золотая подсказка».
  function dailyRewardText(day) {
    var rw = DAILY_REWARDS[day] || {};
    var parts = [];
    if (rw.energy) parts.push(I18N.fill('dailyEnergy', { n: rw.energy, lv: I18N.plural(rw.energy, LV_FORMS) }));
    if (rw.hints)  parts.push(I18N.fill('dailyHints',  { n: rw.hints,  hint: I18N.plural(rw.hints, HINT_FORMS) }));
    if (rw.gold)   parts.push(I18N.t('dailyGold'));
    return parts.join(I18N.t('dailyAnd'));
  }

  // Короткая подпись ячейки календаря: «+1», «⚡5», «★».
  function dailyCellText(day) {
    var rw = DAILY_REWARDS[day] || {};
    if (rw.gold) return '★';
    if (rw.energy) return '⚡' + rw.energy;
    return '+' + (rw.hints || 0);
  }

  // Строка в меню: обещание на завтра — видно при каждом выходе в меню.
  function renderDailyLine() {
    if (!streakLine || !retentionState) return;
    var day = currentCalendarDay();
    if (dailyPending > 0) {
      streakLine.textContent = I18N.fill('dailyLinePending', { n: day, total: DAILY_DAYS });
    } else {
      streakLine.textContent = I18N.fill('dailyLine', {
        n: day, total: DAILY_DAYS, reward: dailyRewardText(calendarDay(day + 1)),
      });
    }
  }

  function showDaily(day) {
    if (!elDaily) return;
    if (dailyTitle) dailyTitle.textContent = I18N.fill('dailyTitle', { n: day, total: DAILY_DAYS });
    if (dailyCells) {
      dailyCells.innerHTML = '';
      for (var d = 1; d <= DAILY_DAYS; d++) {
        var cell = document.createElement('div');
        cell.className = 'cal-cell' + (d < day ? ' is-done' : (d === day ? ' is-today' : ''));
        var num = document.createElement('span');
        num.className = 'cal-day';
        num.textContent = String(d);
        var val = document.createElement('span');
        val.className = 'cal-val';
        val.textContent = dailyCellText(d);
        cell.appendChild(num);
        cell.appendChild(val);
        dailyCells.appendChild(cell);
      }
    }
    if (dailyReward) dailyReward.textContent = dailyRewardText(day);
    if (btnDailyClaim) btnDailyClaim.textContent = I18N.t(isNewPlayer && savedIndex == null ? 'dailyClaimPlay' : 'dailyClaim');
    if (dailyTomorrow) dailyTomorrow.textContent = I18N.fill('dailyTomorrow', { reward: dailyRewardText(calendarDay(day + 1)) });
    elDaily.hidden = false;
  }

  function claimDaily() {
    if (elDaily) elDaily.hidden = true;
    if (!dailyPending) return;
    var day = dailyPending;
    var rw = DAILY_REWARDS[day] || {};
    dailyPending = 0;
    if (rw.energy) grantEnergyBonus(rw.energy, day);
    if (rw.hints)  grantBonusHints(rw.hints, day);
    if (rw.gold) {
      goldHints += rw.gold;
      console.log('[calendar] день ' + day + ': +' + rw.gold + ' золотая подсказка, стало ' + goldHints);
      updateHintLabel();
    }
    persistProgress();
    renderDailyLine();
    console.log('[calendar] день ' + day + ' из ' + DAILY_DAYS + ' забран: ' + dailyRewardText(day));
  }

  /* Запас в подарок (календарь). Потолок НЕ применяется намеренно:
     обещанное «+5 новых уровней» обязано прийти и при полном запасе,
     иначе награда дня превращается в ноль ровно у тех, кто играет
     реже всех. Модуль это переживает: applyDripTick при backlog ≥ cap
     только подтягивает штамп, spendEnergy списывает штатно, UI покажет
     «20 / 15». Объект состояния собирается той же формой, что в
     retention.js (пять полей) — energyPlusRaw ниже единственная функция
     в игре, которая делает это мимо модуля; её зовут награда календаря
     и золотое слово (b20). */
  function energyPlusRaw(n) {
    retentionState = {
      dripOpened: retentionState.dripOpened + n,
      lastTickAt: retentionState.lastTickAt,
      lastEntryDay: retentionState.lastEntryDay,
      streakLen: retentionState.streakLen,
      streakRewards: retentionState.streakRewards,
    };
  }
  function grantEnergyBonus(n, day) {
    if (!retentionState) return;
    energyPlusRaw(n);
    console.log('[calendar] день ' + day + ': +' + n + ' к запасу, стало ' + retentionState.dripOpened);
    persistProgress();
    renderEnergy();
    showRetentionToast(I18N.fill('energyToastGain', { n: n }));
  }

  /* Золотое слово найдено (b20): +1 мимо потолка, запись в сейв, перелёт ⚡. */
  function claimGoldWord(index, chip) {
    if (!retentionState) return;
    goldClaimed.push(index + 1);
    energyPlusRaw(1);
    console.log('[gold] уровень ' + (index + 1) + ': золотое слово найдено, +1 к запасу, стало ' +
      retentionState.dripOpened);
    persist({ level: index, max: maxUnlocked, records: records });
    if (typeof Sound.gold === 'function') Sound.gold();
    // b22 (решение основателя 13.09): две фазы — сначала чип внизу
    // разрастается на месте, и только потом ⚡ отделяется и летит к счётчику.
    burstChip(chip, function () {
      if (chip) chip.classList.remove('gold');
      flyEnergy(chip, function () { renderEnergy(); popPlusOne(); });
    });
  }

  /* Фаза 1 золотого слова: класс gold-burst на чипе (CSS-анимация
     GOLD_BURST_MS), по animationend — done(). Без DOM-геометрии (тесты) и
     при reduced-motion — сразу done(), как и flyEnergy. */
  function burstChip(chip, done) {
    var reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (!chip || reduced || typeof chip.getBoundingClientRect !== 'function' ||
        typeof requestAnimationFrame !== 'function') { done(); return; }
    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      chip.classList.remove('gold-burst');
      done();
    }
    chip.classList.remove('pop');   // обычный «пых» уступает место разрастанию
    chip.classList.add('gold-burst');
    chip.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, GOLD_BURST_MS + 120);   // страховка: анимация могла не запуститься (вкладка в фоне)
  }

  /* Фаза 2 — перелёт ⚡ от чипа к значку запаса в ленте: 700 мс по прямой,
     стартует полуторным и сжимается к счётчику (CSS .energy-fly). Без
     DOM-геометрии (тесты) и при reduced-motion — сразу done(): счётчик
     обновится, «+1» всплывёт без перелёта. */
  function flyEnergy(chip, done) {
    var target = elGame ? elGame.querySelector('.energy-icon') : null;
    var reduced = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (!chip || !target || !elEnergyFly || reduced ||
        typeof chip.getBoundingClientRect !== 'function' ||
        typeof requestAnimationFrame !== 'function') { done(); return; }
    var a = chip.getBoundingClientRect(), b = target.getBoundingClientRect();
    var x0 = a.left + a.width / 2, y0 = a.top + a.height / 2;
    var dx = (b.left + b.width / 2) - x0, dy = (b.top + b.height / 2) - y0;
    elEnergyFly.hidden = false;
    // b22: значок крупнее (CSS 26px) — центр считаем по факту, не константой.
    var fw = elEnergyFly.offsetWidth || 26, fh = elEnergyFly.offsetHeight || 26;
    elEnergyFly.style.left = (x0 - fw / 2) + 'px';
    elEnergyFly.style.top = (y0 - fh / 2) + 'px';
    elEnergyFly.style.transform = 'translate(0,0) scale(1.5)';
    elEnergyFly.classList.add('run');
    var finished = false;
    function finish() {
      if (finished) return;
      finished = true;
      elEnergyFly.hidden = true;
      elEnergyFly.style.transform = '';
      elEnergyFly.classList.remove('run');
      // Посадка: значок вспыхивает, число на полсекунды золотое (CSS energy-hit / .hit).
      target.classList.add('pulse');
      setTimeout(function () { target.classList.remove('pulse'); }, 500);
      var val = elGame.querySelector('.energy-value');
      if (val) { val.classList.add('hit'); setTimeout(function () { val.classList.remove('hit'); }, 500); }
      done();
    }
    // Два кадра: первый фиксирует стартовую позицию, второй запускает transition.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        elEnergyFly.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(1)';
      });
    });
    elEnergyFly.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 1000);   // страховка: transitionend может не прийти (вкладка в фоне)
  }

  /* «+1» всплывает над счётчиком запаса и тает (CSS plus-up, 900 мс). */
  function popPlusOne() {
    var target = elGame ? elGame.querySelector('.energy-value') : null;
    if (!target || !elEnergyPlus || typeof target.getBoundingClientRect !== 'function') return;
    var b = target.getBoundingClientRect();
    elEnergyPlus.style.left = (b.right + 6) + 'px';          // правее счётчика, не над кнопкой «назад»
    elEnergyPlus.style.top = (b.top - 6) + 'px';
    elEnergyPlus.classList.remove('run');
    elEnergyPlus.hidden = false;
    void elEnergyPlus.offsetWidth;   // перезапуск анимации
    elEnergyPlus.classList.add('run');
    setTimeout(function () { elEnergyPlus.hidden = true; elEnergyPlus.classList.remove('run'); }, 950);
  }

  /* ---------- Ролик у стены (b19, гипотеза 2) ---------- */
  var btnWallAd = document.getElementById('btn-wall-ad');

  function wallAdsToday() {
    var today = Retention.dayKeyFromDate(new Date(Platform.now()));
    if (wallAds.d !== today) wallAds = { d: today, n: 0 };
    return wallAds.n;
  }

  function renderWallAd() {
    if (!btnWallAd) return;
    var left = WALL_ADS_PER_DAY - wallAdsToday();
    btnWallAd.hidden = left <= 0;
    btnWallAd.textContent = I18N.fill('wallAd', {
      n: WALL_AD_ENERGY, lv: I18N.plural(WALL_AD_ENERGY, LV_FORMS),
    });
    if (wallSub) wallSub.textContent = I18N.t(left <= 0 ? 'wallAdDone' : 'energyWallSub');
  }

  function onWallAdClick() {
    if (wallAdsToday() >= WALL_ADS_PER_DAY) { renderWallAd(); return; }
    Sound.resumeContext();
    Platform.showRewarded(
      // Награда — ТОЛЬКО в onRewarded (стандарт контракта). Адаптеры
      // зовут onResume раньше onRewarded, поэтому рендер здесь, не там.
      function () {
        var before = retentionState.dripOpened;
        retentionState = Retention.grantDrip(retentionState, RETENTION_CONFIG, WALL_AD_ENERGY);
        var granted = retentionState.dripOpened - before;
        wallAds.n++;
        console.log('[retention] ролик у стены: +' + granted + ' к запасу (' +
          wallAds.n + ' из ' + WALL_ADS_PER_DAY + ' за день)');
        persistProgress();
        renderEnergy();
        renderWallAd();
        if (granted > 0) showRetentionToast(I18N.fill('energyToastGain', { n: granted }));
        continuePendingIfPossible();
      },
      function () { Sound.suspend(); },
      function () { Sound.resume(); }
    );
  }

  // Бейдж бесплатных подсказок — ВТОРАЯ шкала, к запасу отношения не
  // имеет. Скрыт при нуле, число без знаменателя при значении > 0.
  function renderHintBadge() {
    if (!hintBadge) return;
    hintBadge.hidden = !(bonusHints > 0);
    hintBadge.textContent = bonusHints > 0 ? String(bonusHints) : '';
  }

  var toastTimer = null;
  function showRetentionToast(text) {
    if (!retentionToast) return;
    retentionToast.textContent = text;
    retentionToast.hidden = false;
    // Перезапуск анимации: класс снимается и ставится в следующем кадре.
    retentionToast.classList.remove('is-visible');
    void retentionToast.offsetWidth;
    retentionToast.classList.add('is-visible');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      retentionToast.classList.remove('is-visible');
      toastTimer = setTimeout(function () { retentionToast.hidden = true; }, 400);
    }, 2800);
  }

  function grantBonusHints(n, day) {
    bonusHints += n;
    console.log('[retention] серия ' + day + '-й день подряд: +' + n + ' к подсказкам, стало ' + bonusHints);
    persistProgress();   // награда обязана пережить закрытие вкладки сразу после входа
    renderHintBadge();
    updateHintLabel();
    showRetentionToast(I18N.fill('streakToastHints', {
      n: n, hint: I18N.plural(n, HINT_FORMS), day: day,
    }));
  }

  /* b23 (решение основателя 13.09): такт не «через 4 ч после захода», а
     ПО ЧАСАМ — в 00:00, 04:00, 08:00, 12:00, 16:00 и 20:00 местного
     времени игрока, у всех одинаково и кругло. Модуль retention.js (общий с
     Color Sort, его не трогаем) считает такты от штампа lastTickAt;
     выравниваем штамп ВНИЗ на ближайшую границу слота до и после каждого
     applyDripTick — тогда «через tickMs от штампа» и есть следующая круглая
     граница. Модуль сам сдвигает штамп в «сейчас» при полном запасе и при
     откате часов — выравнивание возвращает его на границу. Сейв b22
     (штамп «когда зашёл») мигрирует тем же путём: выровненный штамп ≤
     старого, начисление придёт не позже прежнего. */
  var DRIP_SLOT_HOURS = 4;
  function slotFloorMs(ms) {
    var d = new Date(ms);
    var h = d.getHours();
    d.setHours(h - (h % DRIP_SLOT_HOURS), 0, 0, 0);
    return d.getTime();
  }
  function alignTickAnchor(state) {
    if (!state || typeof state.lastTickAt !== 'number') return state;
    var aligned = slotFloorMs(state.lastTickAt);
    if (aligned === state.lastTickAt) return state;
    return {
      dripOpened: state.dripOpened,
      lastTickAt: aligned,
      lastEntryDay: state.lastEntryDay,
      streakLen: state.streakLen,
      streakRewards: state.streakRewards,
    };
  }
  function dripTick(prev, nowMs) {
    var next = alignTickAnchor(Retention.applyDripTick(alignTickAnchor(prev), nowMs, RETENTION_CONFIG));
    // Тот же штамп и запас — состояние не менялось: возвращаем prev, чтобы
    // retentionTick не писал сейв каждые 30 с (раньше при полном запасе
    // штамп «сейчас» менялся на каждом такте таймера).
    if (next !== prev && next.dripOpened === prev.dripOpened && next.lastTickAt === prev.lastTickAt &&
        next.lastEntryDay === prev.lastEntryDay && next.streakLen === prev.streakLen &&
        next.streakRewards === prev.streakRewards) return prev;
    return next;
  }

  /* Такт раздатчика. Вызывается по таймеру и в точках возврата в меню.
     ВАЖНО: сохраняем при ЛЮБОМ изменении состояния, а не только при
     начислении — applyDripTick подтягивает штамп ещё в двух случаях
     (часы игрока ушли назад; запас упёрся в потолок), и без записи эта
     подтяжка терялась бы при перезагрузке, то есть фикс времени
     существовал бы только в памяти сессии. */
  function retentionTick() {
    if (!retentionState || typeof Retention === 'undefined') return;
    var prev = retentionState;
    var before = prev.dripOpened;
    var nowMs = Platform.now();
    var rolledBack = nowMs < prev.lastTickAt;
    retentionState = dripTick(prev, nowMs);   // b23: такт по часам
    // Перерисовываем ВСЕГДА: строка может нести обратный отсчёт, и он
    // обязан идти, даже когда состояние модуля не менялось. Запись в
    // сейв — только при реальном изменении, рендер записи не требует.
    renderEnergy();
    if (retentionState === prev) return;

    var granted = retentionState.dripOpened - before;
    persistProgress();
    if (granted > 0) {
      console.log('[retention] такт: +' + granted + ', запас ' + retentionState.dripOpened +
        ' из ' + RETENTION_CONFIG.accumulatorCap);
      showRetentionToast(I18N.fill('energyToastGain', { n: granted }));
      continuePendingIfPossible();
    } else if (rolledBack) {
      console.log('[retention] часы устройства ушли НАЗАД: начисления нет, штамп подтянут к границе слота ≤ «сейчас» — ' +
        'иначе следующий такт наступил бы только когда реальное время догонит старый штамп');
    } else {
      console.log('[retention] запас на потолке: начисления нет, штамп подтянут к границе слота ≤ «сейчас» — ' +
        'простой не банкуется в тени');
    }
  }

  /* ---------- Стена (п.4) ----------
     Показывается ВМЕСТО старта нового, ещё не пройденного уровня, когда
     запас на нуле. requestOpenLevel — ЕДИНСТВЕННАЯ дверь во все пути
     входа: «Играть», «Продолжить», тайл сетки, «Дальше» после победы.
     Рестарт текущего уровня зовёт openLevel НАПРЯМУЮ и стену не
     показывает: игрок уже внутри этого уровня, а списание происходит на
     завершении, не на старте — второй раз платить не за что (п.1). */
  function canOpenLevel(index) {
    if (!retentionState || typeof Retention === 'undefined') return true; // модуль не загрузился — игру не запираем
    if (index < maxUnlocked) return true;                                 // уже пройден — повтор бесплатен
    return energyLeft() > 0;
  }

  function requestOpenLevel(index) {
    if (canOpenLevel(index)) { openLevel(index); return; }
    pendingOpenIndex = index;
    console.log('[retention] стена: запас 0, уровень ' + (index + 1) +
      ' ещё не пройден — старт отложен до пополнения');
    showWall();
  }

  function showWall() {
    renderEnergy();
    var nextAt = Retention.nextUnlockAtMs(retentionState, RETENTION_CONFIG);
    var gain = RETENTION_CONFIG.dripPerTick;
    var timeStr = nextAt == null ? '' : formatClock(nextAt);
    var wallVars = {
      time: timeStr, gain: gain, cap: RETENTION_CONFIG.accumulatorCap,
      lvGain: I18N.plural(gain, LV_FORMS),
      left: nextAt == null ? '' : formatLeft(nextAt),
    };
    if (wallTitle) wallTitle.textContent = I18N.fill('energyWallTitle', wallVars);
    if (wallText) wallText.textContent = I18N.fill('energyWallText', wallVars);
    if (wallSub) wallSub.textContent = I18N.t('energyWallSub');
    if (btnWallMenu) btnWallMenu.textContent = I18N.t('energyWallBack');
    renderWallAd();   // b19: кнопка ролика и подпись про дневной лимит
    showScreen(elWall);
  }

  // Запас появился, пока игрок стоял у стены — продолжаем ровно туда,
  // куда он шёл, без лишнего клика.
  function continuePendingIfPossible() {
    if (pendingOpenIndex == null) return;
    if (!elWall || !elWall.classList.contains('is-active')) return;
    if (energyLeft() <= 0) return;
    var idx = pendingOpenIndex;
    pendingOpenIndex = null;
    console.log('[retention] запас пополнен у стены — продолжаем на уровень ' + (idx + 1));
    openLevel(idx);
  }

  /* ---------- Инициализация и МИГРАЦИЯ (п.3) ----------
     Один путь для новичка и для старого сейва: у обоих поля модуля
     отсутствуют, значит initState() при gateMode:'energy' выдаёт ПОЛНЫЙ
     запас. Это осознанная щедрость, а не подарок по недосмотру: у игры
     1126 установок, и старый игрок, открывший знакомую игру и упёршийся
     в стену на первом же уровне, удалит её — это худший первый контакт
     с модулем, какой можно устроить. Прогресс и рекорды при этом не
     трогаются вообще. */
  function bootRetention(data) {
    if (typeof Retention === 'undefined' || !RETENTION_CONFIG) {
      console.warn('[retention] модуль не загружен — игра работает без запаса и серии');
      return;
    }
    var nowMs = Platform.now();
    var hasModuleFields = !!(data && Retention.isValidEncoded(data.r));
    if (hasModuleFields) {
      retentionState = Retention.decodeState(data.r);
    } else {
      retentionState = Retention.initState(maxUnlocked > 0 ? maxUnlocked : -1, nowMs, RETENTION_CONFIG);
      console.log('[retention] МИГРАЦИЯ: полей модуля в сейве нет' +
        (data ? ' (старый сейв, прогресс уровень ' + ((data.level || 0) + 1) + ')' : ' (новый игрок)') +
        ' → запас полный ' + RETENTION_CONFIG.accumulatorCap + ', прогресс и рекорды не тронуты');
    }
    bonusHints = (data && typeof data.bh === 'number' && data.bh > 0) ? Math.floor(data.bh) : 0;
    // b19: поля календаря и ролика у стены. У сейва b18 их нет — дефолты,
    // день календаря тогда считается по серии модуля (r.s), ничего не
    // сбрасывается.
    calOffset    = (data && data.co === 1) ? 1 : 0;
    dailyPending = (data && typeof data.dp === 'number' && data.dp > 0) ? Math.floor(data.dp) : 0;
    goldHints    = (data && typeof data.gh === 'number' && data.gh > 0) ? Math.floor(data.gh) : 0;
    wallAds = (data && data.wa && typeof data.wa.d === 'string' && typeof data.wa.n === 'number')
      ? { d: data.wa.d, n: Math.max(0, Math.floor(data.wa.n)) }
      : { d: '', n: 0 };
    // b20: забранные золотые слова. У сейва b19 поля нет — пусто.
    goldClaimed = (data && Array.isArray(data.gw))
      ? data.gw.filter(function (n) { return typeof n === 'number'; })
      : [];

    // Такт за время, пока игра была закрыта (b23: по часам, см. dripTick).
    var prev = retentionState;
    retentionState = dripTick(prev, nowMs);
    var granted = retentionState.dripOpened - prev.dripOpened;
    if (granted > 0) {
      console.log('[retention] за время без игры набежало +' + granted +
        ', запас ' + retentionState.dripOpened + ' из ' + RETENTION_CONFIG.accumulatorCap);
    }

    // День серии засчитывается ФАКТОМ входа, не прохождением уровня.
    // День берём из Platform.now() — той же единой точки времени, что и
    // такт (в эталоне серия читала часы отдельно; здесь ТЗ требует одну
    // точку, иначе живая приёмка серии подменой даты невозможна).
    var prevEntryDay = retentionState.lastEntryDay;
    var entry = Retention.onEnter(retentionState, Retention.dayKeyFromDate(new Date(nowMs)), RETENTION_CONFIG);
    var streakChanged = entry.state !== retentionState;
    retentionState = entry.state;
    /* b19: награду дня считает календарь, не модуль (entry.reward всегда
       null — см. конфиг). Новый календарный день → день календаря по
       серии модуля с поправкой calOffset, награда ждёт кнопки «Забрать». */
    if (streakChanged) {
      var len = retentionState.streakLen;
      if (len === 0) {
        // Пропуск: модуль считает серию с нуля, календарь показывает
        // «День 1» с наградой — вернувшийся после перерыва не уходит ни с чем.
        calOffset = 1;
        console.log('[calendar] серия прервана пропуском — календарь начинается с дня 1 заново');
      } else if (len === 1 && prevEntryDay === '') {
        calOffset = 0;   // самый первый вход в жизни
      }
      dailyPending = calendarDay(len + calOffset);
      console.log('[calendar] новый день: день ' + dailyPending + ' из ' + DAILY_DAYS +
        ' (серия модуля ' + len + ') — награда ждёт кнопки «Забрать»');
    } else if (dailyPending > 0) {
      console.log('[calendar] сегодня уже входили, награда дня ' + dailyPending +
        ' ещё не забрана — карточка показывается снова');
    } else {
      console.log('[retention] сегодня уже входили: серия ' + retentionState.streakLen +
        ' дн., награда дня уже забрана — карточки нет');
    }
    if (granted > 0 || streakChanged || !hasModuleFields) persistProgress();

    renderEnergy();
    renderDailyLine();
    renderHintBadge();
    updateHintLabel();
    // Карточка календаря — поверх меню, ПОСЛЕ Game Ready (см. start()).
    if (dailyPending > 0) showDaily(dailyPending);
    else if (elDaily) elDaily.hidden = true;
    /* Фоновый такт. typeof-гейт — не перестраховка: в песочнице тестов
       (vm-контекст без setInterval) вызов уронил бы весь старт игры, а
       сам такт там не нужен — тесты гоняют retentionTick реальными
       путями (возврат в меню). Период 30 с: такт раздатчика шестичасовой,
       чаще незачем, а стена должна отпустить игрока без перезахода. */
    if (typeof setInterval === 'function') {
      if (retentionTimer && typeof clearInterval === 'function') clearInterval(retentionTimer);
      retentionTimer = setInterval(retentionTick, 30000);
    }
  }

  function showScreen(el) {
    setEnergyPop(false);   // b23: попап «?» живёт только на игровом экране
    // b24: частицы (конфетти победы) не переезжают на другой экран.
    if (typeof FX !== 'undefined' && typeof FX.clear === 'function') FX.clear();
    var screens = document.querySelectorAll('.screen');
    for (var s = 0; s < screens.length; s++) screens[s].classList.remove('is-active');
    el.classList.add('is-active');
  }

  // Вид меню в зависимости от наличия прогресса.
  // Есть прогресс → «Продолжить» главная, «Играть» скрыта («Начать сначала»
  // убрана из меню — свежий старт с 1-го уровня доступен через «Выбор уровня»).
  function setMenuProgress(has) {
    btnContinue.hidden = !has;
    btnPlay.hidden = has;
    // b20: всё пройдено — обещание продолжения видно и в меню.
    if (elMenuMore) elMenuMore.hidden = !(Levels.count() > 0 && maxUnlocked >= Levels.count());
  }

  // Подпись кнопки подсказки: обещает ролик только если реклама реально
  // доступна (задача А, п.180) — кнопка сама всегда видна, см. start().
  function updateHintLabel() {
    if (!btnHint) return;
    // b19: золотая подсказка (день 7 календаря) — самая сильная, тратится
    // первой; кнопка честно говорит, что откроет слово целиком.
    if (goldHints > 0) { btnHint.textContent = I18N.t('hintGold'); return; }
    // ЭТАП 3: пока есть бесплатные подсказки из серии входов, кнопка НЕ
    // обещает ролик — она его и не покажет (баланс тратится первым).
    if (bonusHints > 0) { btnHint.textContent = I18N.t('hintBonusHint'); return; }
    btnHint.textContent = I18N.t(Platform.isRewardedAvailable() ? 'hint' : 'hintFree');
  }

  /* ============================================================
     b24 — СОЧНОСТЬ И МИКРО-ЦЕЛИ (PROMT.md: FTUE, juice, retention hooks).
     Диагноз по studio_stats (ВК, 30 дней на 22.09): D1 15,8 %, D7 0 %,
     13 удалений на 41 нового. Экономику (запас, рекламу) не трогаем —
     это решения основателя; добавляем то, что держит внутри сессии и
     даёт повод перепройти уже открытое, когда запас на нуле:
       • звёзды 1–3 за уровень (0 подсказок — 3★, одна — 2★, больше — 1★),
         лучший результат в сейве (st), видны в сетке уровней;
       • комбо: слово в пределах COMBO_WINDOW_MS от предыдущего — бонус;
       • награда за ПЕРВОЕ прохождение главы — бесплатные подсказки
         (вторая шкала, к запасу отношения не имеет);
       • подсказка простоя без текста: палец/пульс по текущему слову.
     ============================================================ */
  var COMBO_WINDOW_MS = 8000;
  var COMBO_STEP_BONUS = 50;     // комбо ×2 → +50, ×3 → +100 …
  var CHAPTER_REWARD_HINTS = 3;
  var IDLE_DEMO_LEVELS = 3;      // уровни 1–3: при простое — палец по слову
  var IDLE_DEMO_MS = 7000;
  var IDLE_NUDGE_MS = 15000;     // дальше: пульс первой буквы
  var WRONG_STREAK_NUDGE = 3;    // три промаха подряд — пульс первой буквы
  var IDLE_NUDGE_REPEATS = 3;    // пульс повторяется не больше трёх раз за простой — игрок мог уйти

  var levelStars = [];           // лучшие звёзды по индексу уровня (0 — нет)
  var combo = 0, lastFindAt = 0, wrongStreak = 0;
  var idleTimer = null, idleRepeats = 0;

  function starsFor(hints) { return hints <= 0 ? 3 : (hints === 1 ? 2 : 1); }
  function encodeStars() {
    var out = '';
    for (var i = 0; i < levelStars.length; i++) out += String(levelStars[i] || 0);
    return out.replace(/0+$/, '');
  }
  function decodeStars(str) {
    var a = [];
    if (typeof str !== 'string') return a;
    for (var i = 0; i < str.length && i < 200; i++) {
      var d = str.charCodeAt(i) - 48;
      a.push(d >= 0 && d <= 3 ? d : 0);
    }
    return a;
  }
  function chapterStars(start, end) {
    var n = 0;
    for (var i = start; i < end; i++) n += levelStars[i] || 0;
    return n;
  }

  function reducedMotion() {
    return !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function fxOn() { return typeof FX !== 'undefined' && typeof FX.enabled === 'function' && FX.enabled(); }
  // Вибро идёт за переключателем звука: одна кнопка «отклик» — без звука
  // и телефон не жужжит (отдельного переключателя в UI нет).
  function feel(kind) {
    if (soundOn && typeof Platform.haptic === 'function') Platform.haptic(kind);
  }
  function snd(name, arg) {
    if (typeof Sound[name] === 'function') Sound[name](arg);
  }
  function centerOf(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return null;
    var b = el.getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
  }

  // Всплывающий текст («+150», «Комбо ×2») над точкой экрана; тает сам.
  function floatText(pt, text, cls) {
    if (!pt || !document.body || typeof document.body.appendChild !== 'function') return;
    var el = document.createElement('div');
    el.className = 'float-text' + (cls ? ' ' + cls : '');
    el.textContent = text;
    el.style.left = Math.round(pt.x) + 'px';
    el.style.top = Math.round(pt.y) + 'px';
    document.body.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1100);
  }

  // Находка слова: искры из клеток, волна (CSS), очки и комбо над последней буквой.
  function juiceFound(cells, pts, comboN, isGold) {
    var last = cells && cells.length ? centerOf(cells[cells.length - 1]) : null;
    if (fxOn() && cells) {
      var colors = isGold ? ['#d9a441', '#f8e9c3', '#f59e0b'] : ['#2e9e5b', '#7fd39b', '#d9a441'];
      for (var i = 0; i < cells.length; i++) {
        var c = centerOf(cells[i]);
        if (c) FX.burst(c.x, c.y, { count: 5 + Math.min(comboN, 4), colors: colors, speed: 0.8 + comboN * 0.1 });
      }
      if (last && typeof FX.ring === 'function') FX.ring(last.x, last.y, { color: isGold ? '#d9a441' : '#2e9e5b' });
    }
    if (last) {
      // Над клеткой, а не на ней: на зелёной найденной клетке число не читалось.
      var up = { x: last.x, y: last.y - 34 };
      floatText(up, '+' + pts, 'pts');
      if (comboN >= 2) floatText({ x: up.x, y: up.y - 30 }, I18N.fill('comboX', { n: comboN }), 'combo');
    }
    feel(comboN >= 2 ? 'success' : 'medium');
  }

  /* Подсказка простоя (FTUE без текста, адаптивная помощь). На уровнях
     1–3 после IDLE_DEMO_MS без касания палец сам проводит нужное слово;
     дальше — через IDLE_NUDGE_MS пульсирует его первая буква. Любое
     касание поля сбрасывает таймер (Board onTouch/onStep). Бесплатно и
     не считается подсказкой: это помощь застрявшему, а не ресурс. */
  function clearIdle() { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } }
  function gameIdleOk() {
    return !!(hintWord && elGame && elGame.classList.contains('is-active') && elWin && elWin.hidden);
  }
  // Касание/находка: простой начинается заново (счётчик повторов обнуляется).
  function resetIdle() { idleRepeats = 0; armIdle(); }
  function armIdle() {
    clearIdle();
    if (typeof setTimeout !== 'function' || !gameIdleOk()) return;
    var early = currentIndex < IDLE_DEMO_LEVELS;
    idleTimer = setTimeout(function () {
      idleTimer = null;
      if (!gameIdleOk()) return;
      if (early && typeof Board.demoPath === 'function') {
        console.log('[ftue] простой ' + IDLE_DEMO_MS / 1000 + ' с на уровне ' + (currentIndex + 1) +
          ' — палец показывает «' + hintWord + '» (до касания поля)');
        Board.demoPath(hintWord);   // палец крутится сам до касания — таймер не перезапускаем
      } else {
        console.log('[ftue] простой ' + IDLE_NUDGE_MS / 1000 + ' с — пульс первой буквы «' + hintWord + '»');
        Board.nudgeCurrent(hintWord);
        if (++idleRepeats < IDLE_NUDGE_REPEATS) armIdle();
      }
    }, early ? IDLE_DEMO_MS : IDLE_NUDGE_MS);
  }

  // Звёзды на победе: загораются по очереди со звоном; число — отсчётом.
  function renderWinStars(n) {
    if (!elWinStars) return;
    elWinStars.innerHTML = '';
    var reduced = reducedMotion();
    for (var i = 0; i < 3; i++) {
      var s = document.createElement('span');
      s.className = 'win-star';
      s.textContent = '★';
      elWinStars.appendChild(s);
      if (i < n) {
        (function (el, k) {
          setTimeout(function () {
            el.classList.add('on');
            snd('star', k);
            if (k === n - 1) feel('light');
            if (fxOn() && !reduced) {
              var c = centerOf(el);
              if (c) FX.burst(c.x, c.y, { count: 8, colors: ['#d9a441', '#f59e0b', '#f8e9c3'], speed: 0.9 });
            }
          }, reduced ? 0 : 280 + k * 240);
        })(s, i);
      }
    }
  }

  function countUp(el, prefix, to) {
    if (!el) return;
    if (reducedMotion() || typeof requestAnimationFrame !== 'function' || to <= 0) {
      el.textContent = prefix + to;
      return;
    }
    var t0 = null, DUR = 650;
    el.textContent = prefix + '0';
    function frame(ts) {
      if (t0 === null) t0 = ts;
      var k = Math.min(1, ((ts || 0) - t0) / DUR);
      if (!(k >= 0)) k = 1;   // шим без метки времени — сразу итог
      var eased = 1 - Math.pow(1 - k, 3);
      el.textContent = prefix + Math.round(to * eased);
      if (k < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // Полоса главы на победе: «Глава 2 · Сад и огород · 4/10» + заливка от прежнего значения.
  function renderWinChapter(index, chapterDone, fresh) {
    if (!elWinChapter) return;
    var start = Math.floor(index / CHAPTER_SIZE) * CHAPTER_SIZE;
    var end = Math.min(start + CHAPTER_SIZE, Levels.count());
    var done = Math.max(0, Math.min(end, maxUnlocked) - start);
    var total = end - start;
    var first = Levels.get(start);
    var chNo = Math.floor(start / CHAPTER_SIZE) + 1;
    if (elWinChapterLabel) {
      elWinChapterLabel.textContent = chapterDone
        ? I18N.fill('chapterDone', { n: chNo, hints: CHAPTER_REWARD_HINTS, hint: I18N.plural(CHAPTER_REWARD_HINTS, HINT_FORMS) })
        : I18N.t('chapter') + ' ' + chNo + ' · ' + ((first && first.theme) || '') + ' · ' + done + '/' + total;
    }
    elWinChapter.classList.toggle('done', !!chapterDone);
    if (elWinChapterFill && elWinChapterFill.style) {
      // Заливка «доезжает» только за новый уровень; повтор пройденного — сразу итог.
      var prevPct = (fresh ? Math.max(0, done - 1) : done) / total * 100;
      var pct = done / total * 100;
      elWinChapterFill.style.transition = 'none';
      elWinChapterFill.style.width = prevPct + '%';
      void elWinChapterFill.offsetWidth;
      elWinChapterFill.style.transition = '';
      setTimeout(function () { elWinChapterFill.style.width = pct + '%'; }, 120);
    }
  }

  // Первое прохождение главы: +CHAPTER_REWARD_HINTS бесплатных подсказок (вторая шкала).
  function grantChapterHints(chNo) {
    bonusHints += CHAPTER_REWARD_HINTS;
    console.log('[b24] глава ' + chNo + ' пройдена впервые: +' + CHAPTER_REWARD_HINTS +
      ' к подсказкам, стало ' + bonusHints);
    renderHintBadge();
    updateHintLabel();
  }

  function renderWordList(level, goldWord) {
    if (!elWordList) return;
    elWordList.innerHTML = '';
    var chain = (level.chain && level.chain.length) ? level.chain : level.words.map(function (w) { return w.word; });
    for (var i = 0; i < chain.length; i++) {
      if (i > 0) {
        var sep = document.createElement('span');
        sep.className = 'chain-sep';
        sep.textContent = '→';
        elWordList.appendChild(sep);
      }
      var span = document.createElement('span');
      span.className = 'word-chip' + (i === 0 ? ' current' : '');
      if (goldWord && chain[i] === goldWord) span.classList.add('gold');   // b20
      span.dataset.word = chain[i];
      span.textContent = chain[i];
      elWordList.appendChild(span);
    }
  }

  // Открыть уровень по индексу и нарисовать поле.
  function openLevel(index) {
    var level = Levels.get(index);
    if (!level) return;
    var isLast = !Levels.get(index + 1);
    currentIndex = index;
    // Знаменатель (общее число уровней) игроку НЕ показываем нигде во
    // внутриигровом UI (железный стандарт студии) — только «Уровень N».
    // Сетка выбора уровня — исключение, там числа это навигация, не обещание конца.
    gameLevel.textContent = I18N.t('level') + ' ' + (index + 1);
    gameTheme.textContent = level.theme;
    gameCounter.textContent = '0 / ' + level.words.length;
    elWin.hidden = true;
    if (elHowto) elHowto.hidden = (index !== 0);
    showScreen(elGame);
    // b20: золотое слово уровня (null — уровень не золотой или уже забрано).
    var goldWord = goldWordFor(index, level);
    renderWordList(level, goldWord);

    // Сохраняем прогресс (текущий уровень). Переживает обновление страницы (п.1.9).
    maxUnlocked = Math.max(maxUnlocked, index);
    persist({ level: index, max: maxUnlocked, records: records });
    // Держим «Продолжить» в актуальном состоянии в течение сессии.
    savedIndex = index;
    if (index > 0) setMenuProgress(true);

    // Счёт и подсказки: сбрасываются при каждом открытии уровня.
    levelScore = 0;
    hintsUsed = 0;
    combo = 0; lastFindAt = 0; wrongStreak = 0;   // b24
    // Видимый слой модуля: запас и бейдж подсказок обязаны быть верны на
    // игровом экране сразу, а не после первого события.
    renderEnergy();
    renderHintBadge();
    updateHintLabel();
    // Указатель цепочки: сбрасывается при каждом открытии уровня.
    var chainPos = 0;
    hintWord = (level.chain && level.chain.length) ? level.chain[0] : null;

    Board.render(level, {
      // b24: отклик на каждую букву — тон растёт с длиной пути, лёгкое вибро.
      onStep: function (n) {
        snd('step', n - 1);
        feel('select');
        resetIdle();
      },
      onTouch: function () { resetIdle(); },
      // Принять слово только если оно следующее в цепочке.
      // Если у уровня нет поля chain — принимаем любое (обратная совместимость).
      isAccepted: function (word) {
        if (!level.chain || !level.chain.length) return true;
        return word === level.chain[chainPos];
      },
      onProgress: function (n, total) {
        gameCounter.textContent = n + ' / ' + total;
        if (n < total) Sound.found();   // на последнем слове сыграет win
      },
      onFound: function (word, cells) {
        // b24: комбо — слово в пределах COMBO_WINDOW_MS от предыдущего.
        var nowMs = Date.now();
        combo = (lastFindAt > 0 && nowMs - lastFindAt <= COMBO_WINDOW_MS) ? combo + 1 : 1;
        lastFindAt = nowMs;
        wrongStreak = 0;
        tutorialShown = true;
        var pts = 100 + (combo > 1 ? COMBO_STEP_BONUS * (combo - 1) : 0);
        levelScore += pts;
        var wasGold = !!(goldWord && word === goldWord);
        if (level.chain && level.chain.length) chainPos++;
        hintWord = (level.chain && chainPos < level.chain.length) ? level.chain[chainPos] : null;
        // b19: строка про порядок цепочки на 1-м уровне остаётся до конца
        // уровня — раньше исчезала после первого слова, а правило
        // цепочки объясняла только она (диагноз §1.2, п.2).
        // Пометить найденный чип: пых + зачёркнуть.
        var chip = document.querySelector('#word-list .word-chip[data-word="' + word + '"]');
        if (chip) { chip.classList.add('pop'); chip.classList.add('found'); chip.classList.remove('current'); }
        // b20: золотое слово — разово, +1 к запасу с перелётом к счётчику.
        if (goldWord && word === goldWord) { goldWord = null; claimGoldWord(index, chip); }
        // Подсветить следующее слово в цепочке (CSS-transition плавно проявит рамку).
        if (level.chain && chainPos < level.chain.length) {
          var nextChip = document.querySelector('#word-list .word-chip[data-word="' + level.chain[chainPos] + '"]');
          if (nextChip) nextChip.classList.add('current');
        }
        juiceFound(cells, pts, combo, wasGold);
        var moreLeft = level.chain && level.chain.length ? chainPos < level.chain.length : true;
        if (combo >= 2 && moreLeft) snd('combo', combo);   // на последнем слове сыграет win
        if (moreLeft) resetIdle(); else clearIdle();
      },
      onComplete: function () {
        /* ЭТАП 3, п.1: списание строго одно — новый, ЕЩЁ НЕ пройденный
           уровень завершён. Флаг снимается ДО обновления maxUnlocked
           ниже, иначе к моменту проверки уровень уже выглядел бы
           пройденным всегда. Рестарт и повтор пройденного сюда попадают
           с wasCompleted=true и запас не трогают. */
        var wasCompleted = currentIndex < maxUnlocked;
        clearIdle();
        // b24: первое прохождение последнего уровня главы — награда главы.
        var chapterDone = !wasCompleted && ((currentIndex + 1) % CHAPTER_SIZE === 0);
        if (retentionState && typeof Retention !== 'undefined') {
          if (!wasCompleted) {
            var beforeSpend = retentionState.dripOpened;
            retentionState = Retention.spendEnergy(retentionState, RETENTION_CONFIG);
            console.log('[retention] уровень ' + (currentIndex + 1) + ' пройден ВПЕРВЫЕ: запас ' +
              beforeSpend + ' → ' + retentionState.dripOpened);
            renderEnergy();   // расход виден сразу, а не молча
          } else {
            console.log('[retention] уровень ' + (currentIndex + 1) +
              ' пройден повторно — запас не тронут (' + energyLeft() + ')');
          }
        }
        // Подсчёт очков за уровень.
        var finalScore = Math.max(0, levelScore + (hintsUsed === 0 ? 50 : 0) - hintsUsed * 25);
        var best = records.levels[index] || 0;
        var isNew = finalScore > best;
        if (isNew) records.levels[index] = finalScore;
        var tot = 0;
        for (var rk in records.levels) { if (records.levels.hasOwnProperty(rk)) tot += records.levels[rk]; }
        records.total = tot;
        // b24: звёзды — лучший результат уровня; награда главы — до записи в сейв.
        var starsNow = starsFor(hintsUsed);
        while (levelStars.length <= index) levelStars.push(0);
        levelStars[index] = Math.max(levelStars[index] || 0, starsNow);
        if (chapterDone) grantChapterHints(Math.floor(currentIndex / CHAPTER_SIZE) + 1);
        // Разблокировать следующий уровень и сохранить.
        /* ЭТАП 3: потолок Math.min(count-1, …) снят. Он делал ПОСЛЕДНИЙ
           уровень вечно «непройденным» (maxUnlocked упирался в его же
           индекс), а на этом предикате теперь держится правило «повтор
           пройденного бесплатен» — игрок платил бы запасом за каждое
           перепрохождение финального уровня и мог упереться в стену на
           уже пройденном. Для сетки уровней разницы нет: она сравнивает
           i > maxUnlocked, и значение count лишь означает «открыто всё». */
        maxUnlocked = Math.max(maxUnlocked, currentIndex + 1);
        persist({ level: currentIndex, max: maxUnlocked, records: records });
        Sound.win();
        // Небольшая пауза, чтобы игрок увидел последнее слово, потом оверлей.
        setTimeout(function () {
          if (elWinTitle) elWinTitle.textContent = isLast ? I18N.t('allDone') : I18N.t(starsNow === 3 ? 'levelPerfect' : 'levelDone');
          btnNext.textContent = isLast ? I18N.t('toMenu') : I18N.t('next');
          countUp(elWinScore, I18N.t('score') + ': ', finalScore);
          renderWinStars(starsNow);
          renderWinChapter(index, chapterDone, !wasCompleted);
          if (chapterDone) snd('chapter');
          if (elWinBest)  elWinBest.textContent  = I18N.t('best')  + ': ' + Math.max(best, finalScore);
          if (elWinNew)   elWinNew.hidden = !isNew;
          // b19: о близкой стене игрок узнаёт ДО того, как в неё упрётся.
          // Текст строки ставит renderEnergy() по классу .energy-line.
          if (elWinEnergy) elWinEnergy.hidden = !(retentionState && energyLeft() <= WIN_ENERGY_WARN);
          // b20: после последнего уровня — обещание продолжения (решение основателя 12.09).
          if (elWinMore) elWinMore.hidden = !isLast;
          elWin.hidden = false;
          popCard();
          confettiBurst();
        }, 450);
      },
      onWrong: function () {
        Sound.wrong();
        feel('error');
        // b24: адаптивная помощь — три промаха подряд, и первая буква нужного слова пульсирует.
        wrongStreak++;
        if (wrongStreak >= WRONG_STREAK_NUDGE && hintWord) {
          wrongStreak = 0;
          console.log('[ftue] ' + WRONG_STREAK_NUDGE + ' промаха подряд — пульс первой буквы «' + hintWord + '»');
          Board.nudgeCurrent(hintWord);
        }
      },
      onOutOfOrder: function () {
        feel('light');
        // Подсветить первую клетку нужного слова.
        if (level.chain && chainPos < level.chain.length) {
          Board.nudgeCurrent(level.chain[chainPos]);
          // b19: словами, не только пульсом — «верное слово не принято»
          // без объяснения было первым разочарованием на 1-м уровне.
          showRetentionToast(I18N.fill('outOfOrder', { word: level.chain[chainPos] }));
        }
        // Пульс «сердцебиение» на текущем чипе.
        var hbChip = document.querySelector('#word-list .word-chip.current');
        if (hbChip) {
          hbChip.classList.remove('heartbeat');
          void hbChip.offsetWidth; // перезапуск анимации при повторных попытках
          hbChip.classList.add('heartbeat');
          var hbTimer = setTimeout(function () { hbChip.classList.remove('heartbeat'); }, 650);
          hbChip.addEventListener('animationend', function onEnd() {
            clearTimeout(hbTimer);
            hbChip.classList.remove('heartbeat');
            hbChip.removeEventListener('animationend', onEnd);
          });
        }
      },
    });

    /* b24: модальное «Как играть» заменено «призрачным пальцем» на самом
       поле (Board.demoPath): на 1-м уровне палец сразу проводит первое
       слово цепочки и крутится до первого касания — ни одного лишнего
       клика до игры. Строка #howto про порядок слов остаётся. */
    if (index === 0 && !tutorialShown && typeof Board.demoPath === 'function' && hintWord) {
      Board.demoPath(hintWord);
    } else {
      resetIdle();
    }
  }

  // Перезапуск анимации «поп» карточки победы.
  function popCard() {
    var card = elWin.querySelector('.overlay-card');
    if (!card) return;
    card.classList.remove('pop');
    void card.offsetWidth; // форсируем перезапуск анимации
    card.classList.add('pop');
  }

  // Небольшой салют на победе (отключается при prefers-reduced-motion).
  function confettiBurst() {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // b24: конфетти рисует canvas-слой (fx.js) — один кадр на всё, без 40
    // DOM-узлов с отдельными анимациями; DOM-вариант остался запасным.
    if (fxOn() && typeof FX.confetti === 'function') { FX.confetti(); return; }
    var colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7'];
    // убрать прошлые
    var old = elWin.querySelectorAll('.confetti');
    for (var k = 0; k < old.length; k++) old[k].remove();
    for (var i = 0; i < 40; i++) {
      var p = document.createElement('div');
      p.className = 'confetti';
      p.style.left = (4 + Math.random() * 92) + '%';
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * 0.5) + 's';
      p.style.setProperty('--fall-dur', (1.8 + Math.random() * 1.4).toFixed(2) + 's');
      elWin.appendChild(p);
    }
    setTimeout(function () {
      var c = elWin.querySelectorAll('.confetti');
      for (var j = 0; j < c.length; j++) c[j].remove();
    }, 3800);
  }

  var LOCK_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

  // b21: уровни идут главами по 10 (levels.js v2, поле theme = название
  // главы). В сетке выбора перед каждой десяткой — заголовок
  // «Глава 2 · Сад и огород · 4/10»; пройдено = индексы ниже maxUnlocked
  // (он растёт только прохождением). Знаменатель здесь допустим — сетка
  // выбора уровня и так исключение из правила «только Уровень N».
  var CHAPTER_SIZE = 10;
  function chapterHead(start, count) {
    var end = Math.min(start + CHAPTER_SIZE, count);
    var done = Math.max(0, Math.min(end, maxUnlocked) - start);
    var first = Levels.get(start);
    var head = document.createElement('div');
    head.className = 'lv-chapter' +
      (done === end - start ? ' done' : '') +
      (start > maxUnlocked ? ' locked' : '');
    head.textContent = I18N.t('chapter') + ' ' + (Math.floor(start / CHAPTER_SIZE) + 1) +
      ' · ' + ((first && first.theme) || '') + ' · ' + done + '/' + (end - start);
    // b24: звёзды главы — микро-цель «собери все ★», повтор пройденного бесплатен.
    if (done > 0) {
      var st = document.createElement('span');
      st.className = 'lv-chapter-stars';
      st.textContent = '★ ' + chapterStars(start, end) + '/' + ((end - start) * 3);
      head.appendChild(st);
    }
    return head;
  }

  function renderLevels() {
    if (!levelsGrid) return;
    levelsGrid.innerHTML = '';
    if (lvTotal) lvTotal.textContent = records.total > 0 ? 'Итого: ' + records.total : '';
    var count = Levels.count();
    for (var i = 0; i < count; i++) {
      if (i % CHAPTER_SIZE === 0) levelsGrid.appendChild(chapterHead(i, count));
      var tile = document.createElement('button');
      tile.className = 'lv-tile';
      if (i > maxUnlocked) {
        tile.classList.add('locked');
        tile.innerHTML = LOCK_SVG;
      } else {
        tile.textContent = i + 1;
        // b24: звёзды уровня под номером (пройденные уровни).
        if (levelStars[i] > 0) {
          var stEl = document.createElement('span');
          stEl.className = 'lv-stars s' + levelStars[i];
          stEl.textContent = '★★★';
          tile.appendChild(stEl);
        }
        if (i === savedIndex) tile.classList.add('current');
        (function (idx) {
          tile.addEventListener('click', function () { requestOpenLevel(idx); });
        })(i);
      }
      levelsGrid.appendChild(tile);
    }
  }

  function start() {
    Board.init();
    Sound.init();
    if (typeof FX !== 'undefined' && typeof FX.init === 'function') FX.init();   // b24: слой частиц
    Platform.init().then(function () {
      // Язык: берём из платформы (или браузера в dev) и проставляем строки.
      I18N.pick(Platform.getLang());
      I18N.apply(document);

      if (!Platform.isAvailable() && devBadge) devBadge.hidden = false;
      // Кнопка подсказки НИКОГДА не прячется (задача А, смена стандарта
      // п.180): при adblock/отсутствии филла VKWebAppCheckNativeAds
      // исторически ложно сообщает "недоступно" даже когда реклама
      // реально показывается — прятать кнопку по этому сигналу нельзя.
      // Подпись лишь не обещает ролик, если реклама недоступна; сама
      // подсказка в этом случае бесплатна (см. обработчик клика ниже).
      updateHintLabel();

      showScreen(elMenu);

      // Game Ready — ровно сейчас: меню отрисовано и интерактивно.
      Platform.gameReady();

      // Стики-баннер (задача Б): гарантированная рекламная поверхность,
      // не зависящая от гейта interstitial/rewarded. No-op на площадках
      // без поддержки — метод обязан существовать в контракте у всех.
      Platform.showBanner(function (insetPx) { setBannerInset(insetPx); });   // b23: полоса под баннер

      // Прогресс грузим параллельно, чтобы не задерживать Game Ready.
      Platform.load().then(function (data) {
        if (data && typeof data.level === 'number' && data.level > 0 && Levels.get(data.level)) {
          savedIndex = data.level;
          maxUnlocked = Math.max(data.max || 0, data.level || 0);
          setMenuProgress(true);
        }
        // Загружаем рекорды; старые сохранения без поля records не ломают игру.
        if (data && data.records && typeof data.records.levels === 'object') {
          records = { levels: data.records.levels, total: data.records.total || 0 };
        }
        levelStars = decodeStars(data && data.st);   // b24: у сейва b23 поля нет — пусто
        isNewPlayer = !data;
        // Модуль удержания поднимаем ПОСЛЕ прогресса: миграция читает
        // maxUnlocked, а строки видимого слоя — уже готовые рекорды.
        bootRetention(data);
      });
    });
  }

  // --- Обработчики меню ---

  // «Играть» видна только когда прогресса ещё нет (см. setMenuProgress) —
  // сброс-с-подтверждением убран из меню, свежий старт доступен через
  // «Выбор уровня» (клик по 1-му уровню).
  btnPlay.addEventListener('click', function () {
    Sound.resumeContext();   // разрешаем звук по действию пользователя
    requestOpenLevel(0);
  });

  // Единая точка возврата в меню: подбирает такты, набежавшие пока
  // игрок был на другом экране, и обновляет обе строки модуля.
  function goToMenu() {
    retentionTick();
    renderEnergy();
    renderDailyLine();
    showScreen(elMenu);
  }

  btnBack.addEventListener('click', function () {
    clearIdle();
    Board.clear();
    goToMenu();
  });

  function leaveWall() {
    // Ушли со стены сами — отложенное намерение не должно сработать позже.
    pendingOpenIndex = null;
    goToMenu();
  }
  if (btnWallBack) btnWallBack.addEventListener('click', leaveWall);
  if (btnWallMenu) btnWallMenu.addEventListener('click', leaveWall);

  if (btnRestartLevel) btnRestartLevel.addEventListener('click', function () {
    // Намеренно МИМО requestOpenLevel: рестарт текущего уровня бесплатен
    // (ЭТАП 3, п.1), игрок уже внутри него, а списание идёт за завершение.
    openLevel(currentIndex);
  });

  if (btnLevels) btnLevels.addEventListener('click', function () {
    Sound.resumeContext();
    renderLevels();
    showScreen(elLevels);
  });

  if (btnLevelsBack) btnLevelsBack.addEventListener('click', function () {
    showScreen(elMenu);
  });

  btnNext.addEventListener('click', function () {
    elWin.hidden = true;
    var next = currentIndex + 1;

    function proceed() {
      if (Levels.get(next)) {
        requestOpenLevel(next);
      } else {
        // Все уровни пройдены: сбрасываем прогресс и возвращаем в меню.
        savedIndex = null;
        persist({ level: 0, max: maxUnlocked, records: records });
        setMenuProgress(false);
        Board.clear();
        showScreen(elMenu);
      }
    }

    // Гейт частоты (задача Б, п.4.7; расписание — b20, см. adLevelGate): каждый
    // adLevelGate(N)-й уровень И не чаще раза в AD_MIN_INTERVAL_MS —
    // оба условия обязательны. Раньше показ был безусловным на каждый
    // переход (SDK сам якобы соблюдает интервал) — за 41 запуск на ВК
    // это дало 0 показов рекламы; гейт даёт предсказуемые точки показа.
    // b20: порог по номеру только что пройденного уровня (currentIndex — ещё
    // он). В зоне без рекламы счётчик держим на нуле: первый показ после неё
    // приходит через полный порог, а не сразу на 16-м уровне.
    var gate = adLevelGate(currentIndex + 1);
    if (gate === 0) { levelsSinceAd = 0; proceed(); return; }
    levelsSinceAd++;
    var now = Date.now();
    var gateOk = levelsSinceAd >= gate && (now - lastAdShownAt) >= AD_MIN_INTERVAL_MS;

    if (!gateOk) {
      // ДОБОР ЭТАПА 2, п.1: счётчик levelsSinceAd здесь НЕ обнуляется —
      // ни когда не добрал до гейта, ни когда добрал, но кулдаун ещё не
      // истёк. Набранный гейт «ждёт» истечения кулдауна и срабатывает на
      // БЛИЖАЙШЕМ переходе после него. Обнуление — только вместе с
      // фактическим показом (wasShown === true), см. onResume ниже.
      proceed();
      return;
    }

    // Счётчик и кулдаун НЕ сбрасываем здесь: показ ещё не состоялся.
    // Их двигает только onResume(wasShown === true) — см. ниже, п.1.3.
    // Межуровневая реклама в логичной паузе (п.4.4); пауза/возобновление
    // звука на время показа (п.4.7).
    Platform.showInterstitial(
      function () { Sound.suspend(); },  // onPause
      function (wasShown) {              // onResume
        Sound.resume();
        // ЭТАП 2, п.1.3: platform.js прокидывает сюда флаг «реклама
        // реально показана». Раньше параметр не принимался вовсе —
        // НЕПОКАЗАННАЯ реклама (onError, таймаут, нет филла) считалась
        // показанной, сдвигала кулдаун на 90 с и обнуляла счётчик
        // уровней. Игрок при этом рекламы не видел, а студия теряла
        // показ. Теперь показ считается состоявшимся ТОЛЬКО при
        // wasShown === true; иначе счётчик остаётся набранным и
        // следующий переход попробует снова.
        // Софт-лока это не создаёт: proceed() вызывается в ЛЮБОМ
        // исходе, звук снимается с паузы в любом исходе.
        if (wasShown === true) {
          levelsSinceAd = 0;
          lastAdShownAt = Date.now();
        } else {
          console.warn('[ad] interstitial не показан (wasShown=' + wasShown +
            ') — кулдаун и счётчик гейта не сдвинуты, попробуем на следующем переходе');
        }
        proceed();
      }
    );
  });

  // Подсказка за rewarded-видео (п.4.5): по желанию смотрим ролик → подсвечивается буква.
  // Если реклама недоступна (adblock/нет филла) — подсказка бесплатна (п.190,
  // задача А), ролик не пытаемся показывать вовсе: кнопка это не обещает.
  btnHint.addEventListener('click', function () {
    Sound.resumeContext();
    /* b19: золотая подсказка (день 7 календаря) — открывает целевое
       слово целиком. Тратится раньше обычных бесплатных: кнопка это
       обещала подписью (updateHintLabel). Для счёта уровня — одна
       подсказка, как любая другая. */
    if (goldHints > 0) {
      goldHints--;
      hintsUsed++;
      console.log('[calendar] золотая подсказка: слово «' + hintWord + '» открыто целиком, осталось ' + goldHints);
      persistProgress();
      updateHintLabel();
      Board.revealWord(hintWord);
      return;
    }
    /* ЭТАП 3: бесплатные подсказки из серии входов тратятся ПЕРВЫМИ —
       реклама не запрашивается, пока баланс не пуст. Это ВТОРАЯ шкала:
       к запасу энергии она не имеет отношения и его не читает.
       hintsUsed++ остаётся — это правило СЧЁТА за уровень, а не траты
       ресурса: бесплатная подсказка так же влияет на очки, как платная. */
    if (bonusHints > 0) {
      bonusHints--;
      hintsUsed++;
      console.log('[retention] подсказка из баланса серии, осталось ' + bonusHints + ' — ролик не запрашивался');
      persistProgress();
      renderHintBadge();
      updateHintLabel();
      Board.revealHint(hintWord);
      return;
    }
    if (!Platform.isRewardedAvailable()) {
      hintsUsed++;
      Board.revealHint(hintWord);
      return;
    }
    Platform.showRewarded(
      function () { hintsUsed++; Board.revealHint(hintWord); }, // onRewarded — chain[chainPos]
      function () { Sound.suspend(); },                  // onPause
      function () { Sound.resume(); }                    // onResume
    );
  });

  // b19: «Забрать» награду дня — первый жест сессии, заодно разрешает звук.
  // b24: у новичка (сейва нет) та же кнопка «Забрать и играть» сразу
  // открывает 1-й уровень — до core loop один клик вместо трёх.
  if (btnDailyClaim) btnDailyClaim.addEventListener('click', function () {
    Sound.resumeContext();
    var goPlay = isNewPlayer && savedIndex == null;
    isNewPlayer = false;
    claimDaily();
    if (goPlay) {
      console.log('[ftue] новичок: «Забрать и играть» → сразу уровень 1');
      requestOpenLevel(0);
    }
  });

  // b19: ролик у стены.
  if (btnWallAd) btnWallAd.addEventListener('click', onWallAdClick);

  btnContinue.addEventListener('click', function () {
    Sound.resumeContext();
    if (savedIndex != null) requestOpenLevel(savedIndex);
  });

  function renderSound() {
    var muted = !soundOn;
    btnSound.classList.toggle('is-muted', muted);
    if (btnSoundGame) btnSoundGame.classList.toggle('is-muted', muted);
  }
  function toggleSound() {
    soundOn = !soundOn;
    renderSound();
    Sound.resumeContext();
    Sound.setMuted(!soundOn);
  }
  btnSound.addEventListener('click', toggleSound);
  if (btnSoundGame) btnSoundGame.addEventListener('click', toggleSound);

  // Подстраховка против контекстного меню по лонгтапу (п.1.6.1.8).
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // Старт после полной загрузки DOM.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  /* ---------- Мягкое свечение под курсором (ЭТАП 5, п.2) ----------
     Тонкая «живость» фона: первый слой background-image у body —
     radial-gradient, центр которого двигают --mx/--my (см. style.css).

     ЧЕМ ЭТО БЫЛО ПЛОХО. Каждое движение указателя перекрашивает весь
     трёхслойный фон во весь экран. Замерено на билде b16 без
     видеозаписи, во время ВЕДЕНИЯ СЛОВА: 630 → 30 кадров в секунду,
     815 → 24, 1000 → 19 против 60 с выключенным слоем; на телефонных
     ширинах 360 → 49, 414 → 42. То есть игра проседала ровно в своём
     главном действии, и тем сильнее, чем шире окно.

     ЧТО СДЕЛАНО. Две отсечки, обе — не про внешний вид:

     1) Пока идёт ведение слова, свечение НЕ двигаем. Между
        pointerdown на поле и pointerup палец/курсор рисует слово, и
        кадры нужны подсветке клеток, а не фону. Слой остаётся на
        месте, никуда не исчезает, после отпускания снова следует за
        курсором. Флаг ведётся по тем же событиям, что слушает
        board.js (boardEl.pointerdown / window.pointerup), а не по
        e.buttons: синтетические события тестов buttons не выставляют,
        и проверка молча мерила бы не тот путь.

     2) На тач-указателе на pointermove не подписываемся вовсе.
        Свечения там не видно (об этом же говорит комментарий в
        style.css), а перерисовка фона на каждое движение пальца шла.
        Игрок платил за эффект, которого не получает. Первичный тип
        указателя определяется через (pointer: fine); на гибридных
        устройствах, где мышь есть, добавочно отсекаются события с
        pointerType !== 'mouse'.

     ВИДИМЫЙ СЛОЙ НЕ МЕНЯЕТСЯ: ни CSS, ни начальное положение
     (--mx/--my по умолчанию 50%), ни поведение вне ведения слова.
     Промо-скриншоты и ролик от этой правки не протухают — снимаются
     они без зажатого указателя.

     Проверка живёт в tools/live_fps_vk_dist.js и умеет падать: там же
     есть режим, возвращающий подписку во время ведения. */
  var glowOn = !(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)
    && !(window.matchMedia && matchMedia('(pointer: coarse)').matches
         && !matchMedia('(pointer: fine)').matches);
  if (glowOn) {
    var gx = 0, gy = 0, raf = null, glowHeld = false;
    var glowBoard = document.getElementById('board');
    if (glowBoard) {
      glowBoard.addEventListener('pointerdown', function () { glowHeld = true; });
    }
    window.addEventListener('pointerup', function () { glowHeld = false; });
    window.addEventListener('pointercancel', function () { glowHeld = false; });
    window.addEventListener('pointermove', function (e) {
      if (glowHeld) return;                       // ведём слово — кадры нужны полю
      if (e.pointerType && e.pointerType !== 'mouse') return;
      gx = e.clientX; gy = e.clientY;
      if (!raf) {
        raf = requestAnimationFrame(function () {
          raf = null;
          document.body.style.setProperty('--mx', gx + 'px');
          document.body.style.setProperty('--my', gy + 'px');
        });
      }
    });
  }
})();
