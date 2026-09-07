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
  var btnNext = document.getElementById('btn-next');
  var btnHint = document.getElementById('btn-hint');
  var elTutorial = document.getElementById('tutorial');
  var btnTutorialOk = document.getElementById('btn-tutorial-ok');
  var elWordList = document.getElementById('word-list');
  var elHowto = document.getElementById('howto');
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
  var tutorialShown = false; // туториал: показываем один раз за сессию
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
    tickMs:         6 * 60 * 60 * 1000,
    dripPerTick:    10,
    accumulatorCap: 15,
    streakThreshold: 3,
    // Обе награды серии идут в ПОДСКАЗКИ (в Color Sort 3-й день дарил
    // косметику — в Словоходе витрины нет вовсе, дарить нечего).
    streakDayReward:  { 2: 'hints', 3: 'hints' },
    // Своё поле конфига: модуль возвращает ТИП награды, количество —
    // забота игры (mergeConfig прокидывает незнакомые ключи как есть,
    // правки модуля для этого не потребовалось).
    streakHintsByDay: { 2: 2, 3: 5 },
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
  var AD_LEVEL_GATE = 5;
  var AD_MIN_INTERVAL_MS = 240000;
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
    if (retentionState && typeof Retention !== 'undefined') {
      fullState.r = Retention.encodeState(retentionState);
      fullState.bh = bonusHints;
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
  }

  function setAllText(selector, text) {
    var nodes = document.querySelectorAll(selector);
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = text;
  }

  function renderStreakLine() {
    if (!streakLine || !retentionState) return;
    var shown = Math.min(retentionState.streakLen, RETENTION_CONFIG.streakThreshold);
    streakLine.textContent = I18N.fill('streakLine', {
      n: shown, d: I18N.plural(shown, DAY_FORMS),
    });
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
    retentionState = Retention.applyDripTick(prev, nowMs, RETENTION_CONFIG);
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
      console.log('[retention] часы устройства ушли НАЗАД: начисления нет, штамп подтянут к «сейчас» — ' +
        'иначе следующий такт наступил бы только когда реальное время догонит старый штамп');
    } else {
      console.log('[retention] запас на потолке: начисления нет, штамп подтянут к «сейчас» — ' +
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

    // Такт за время, пока игра была закрыта.
    var prev = retentionState;
    retentionState = Retention.applyDripTick(prev, nowMs, RETENTION_CONFIG);
    var granted = retentionState.dripOpened - prev.dripOpened;
    if (granted > 0) {
      console.log('[retention] за время без игры набежало +' + granted +
        ', запас ' + retentionState.dripOpened + ' из ' + RETENTION_CONFIG.accumulatorCap);
    }

    // День серии засчитывается ФАКТОМ входа, не прохождением уровня.
    // День берём из Platform.now() — той же единой точки времени, что и
    // такт (в эталоне серия читала часы отдельно; здесь ТЗ требует одну
    // точку, иначе живая приёмка серии подменой даты невозможна).
    var entry = Retention.onEnter(retentionState, Retention.dayKeyFromDate(new Date(nowMs)), RETENTION_CONFIG);
    var streakChanged = entry.state !== retentionState;
    retentionState = entry.state;
    if (entry.reward === 'hints') {
      var day = retentionState.streakLen;
      var amount = RETENTION_CONFIG.streakHintsByDay[day] || 0;
      if (amount > 0) RETENTION_CONFIG.callbacks.grantHints(amount, day);
      else console.log('[retention] день серии ' + day + ' помечен наградой, но количество не задано — не выдано');
    } else if (!streakChanged) {
      console.log('[retention] сегодня уже входили: серия ' + retentionState.streakLen +
        ' дн., награда повторно НЕ выдаётся');
    } else {
      console.log('[retention] вход засчитан: серия ' + retentionState.streakLen +
        ' дн., награды на этот день нет');
    }
    if (granted > 0 || streakChanged || !hasModuleFields) persistProgress();

    renderEnergy();
    renderStreakLine();
    renderHintBadge();
    updateHintLabel();
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
  }

  // Подпись кнопки подсказки: обещает ролик только если реклама реально
  // доступна (задача А, п.180) — кнопка сама всегда видна, см. start().
  function updateHintLabel() {
    if (!btnHint) return;
    // ЭТАП 3: пока есть бесплатные подсказки из серии входов, кнопка НЕ
    // обещает ролик — она его и не покажет (баланс тратится первым).
    if (bonusHints > 0) { btnHint.textContent = I18N.t('hintBonusHint'); return; }
    btnHint.textContent = I18N.t(Platform.isRewardedAvailable() ? 'hint' : 'hintFree');
  }

  function renderWordList(level) {
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
    renderWordList(level);

    // Сохраняем прогресс (текущий уровень). Переживает обновление страницы (п.1.9).
    maxUnlocked = Math.max(maxUnlocked, index);
    persist({ level: index, max: maxUnlocked, records: records });
    // Держим «Продолжить» в актуальном состоянии в течение сессии.
    savedIndex = index;
    if (index > 0) setMenuProgress(true);

    // Счёт и подсказки: сбрасываются при каждом открытии уровня.
    levelScore = 0;
    hintsUsed = 0;
    // Видимый слой модуля: запас и бейдж подсказок обязаны быть верны на
    // игровом экране сразу, а не после первого события.
    renderEnergy();
    renderHintBadge();
    updateHintLabel();
    // Указатель цепочки: сбрасывается при каждом открытии уровня.
    var chainPos = 0;
    hintWord = (level.chain && level.chain.length) ? level.chain[0] : null;

    Board.render(level, {
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
      onFound: function (word) {
        levelScore += 100;
        if (level.chain && level.chain.length) chainPos++;
        hintWord = (level.chain && chainPos < level.chain.length) ? level.chain[chainPos] : null;
        if (elHowto) elHowto.hidden = true;
        // Пометить найденный чип: пых + зачёркнуть.
        var chip = document.querySelector('#word-list .word-chip[data-word="' + word + '"]');
        if (chip) { chip.classList.add('pop'); chip.classList.add('found'); chip.classList.remove('current'); }
        // Подсветить следующее слово в цепочке (CSS-transition плавно проявит рамку).
        if (level.chain && chainPos < level.chain.length) {
          var nextChip = document.querySelector('#word-list .word-chip[data-word="' + level.chain[chainPos] + '"]');
          if (nextChip) nextChip.classList.add('current');
        }
      },
      onComplete: function () {
        /* ЭТАП 3, п.1: списание строго одно — новый, ЕЩЁ НЕ пройденный
           уровень завершён. Флаг снимается ДО обновления maxUnlocked
           ниже, иначе к моменту проверки уровень уже выглядел бы
           пройденным всегда. Рестарт и повтор пройденного сюда попадают
           с wasCompleted=true и запас не трогают. */
        var wasCompleted = currentIndex < maxUnlocked;
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
          if (elWinTitle) elWinTitle.textContent = isLast ? I18N.t('allDone') : I18N.t('levelDone');
          btnNext.textContent = isLast ? I18N.t('toMenu') : I18N.t('next');
          if (elWinScore) elWinScore.textContent = I18N.t('score') + ': ' + finalScore;
          if (elWinBest)  elWinBest.textContent  = I18N.t('best')  + ': ' + Math.max(best, finalScore);
          if (elWinNew)   elWinNew.hidden = !isNew;
          elWin.hidden = false;
          popCard();
          confettiBurst();
        }, 450);
      },
      onWrong: function () { Sound.wrong(); },
      onOutOfOrder: function () {
        // Подсветить первую клетку нужного слова.
        if (level.chain && chainPos < level.chain.length) {
          Board.nudgeCurrent(level.chain[chainPos]);
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

    // Туториал — только при первом старте сессии (нет сохранённого прогресса).
    if (index === 0 && !tutorialShown) {
      elTutorial.hidden = false;
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

  function renderLevels() {
    if (!levelsGrid) return;
    levelsGrid.innerHTML = '';
    if (lvTotal) lvTotal.textContent = records.total > 0 ? 'Итого: ' + records.total : '';
    var count = Levels.count();
    for (var i = 0; i < count; i++) {
      var tile = document.createElement('button');
      tile.className = 'lv-tile';
      if (i > maxUnlocked) {
        tile.classList.add('locked');
        tile.innerHTML = LOCK_SVG;
      } else {
        tile.textContent = i + 1;
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
      Platform.showBanner();

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
    renderStreakLine();
    showScreen(elMenu);
  }

  btnBack.addEventListener('click', function () {
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

    // Гейт частоты (задача Б, п.4.7; числа — ЭТАП 2, п.1.4): каждый
    // AD_LEVEL_GATE-й уровень И не чаще раза в AD_MIN_INTERVAL_MS —
    // оба условия обязательны. Раньше показ был безусловным на каждый
    // переход (SDK сам якобы соблюдает интервал) — за 41 запуск на ВК
    // это дало 0 показов рекламы; гейт даёт предсказуемые точки показа.
    levelsSinceAd++;
    var now = Date.now();
    var gateOk = levelsSinceAd >= AD_LEVEL_GATE && (now - lastAdShownAt) >= AD_MIN_INTERVAL_MS;

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

  btnTutorialOk.addEventListener('click', function () {
    elTutorial.hidden = true;
    tutorialShown = true;
  });

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
