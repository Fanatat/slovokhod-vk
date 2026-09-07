/* ============================================================
   СЛОВОХОД, ЭТАП 3 (23.08.2026), п.0.1 «копируем систему, не изобретаем»:
   файл взят КОПИЕЙ из Color Sort (game3/color_sort/retention.js) —
   побайтово, md5 e166b28a. Ни одной строки логики не тронуто; всё
   различие между играми живёт в КОНФИГЕ, который передаёт main.js
   (gateMode:'energy', tickMs 6ч, dripPerTick 10, accumulatorCap 15,
   streakDayReward {2:'hints',3:'hints'}). Если модуль когда-нибудь
   придётся править — правка идёт в ОБЕ игры, иначе они разъедутся и
   «общий модуль» перестанет быть общим.

   Комментарий ниже — авторский, из Color Sort; в нём Color Sort
   называется «здесь». Оставлен как есть намеренно: это часть копии.
   ------------------------------------------------------------
   retention.js — модуль удержания: замок кампании + раздатчик уровней +
   серия входов. Перенесён БЕЗ ИЗМЕНЕНИЙ КОДА (перенос готового кода, ТЗ
   №14 этап 2) из репозитория нонограмм (ТЗ №01, ветка release/vk,
   commit d0bf438), где написан и принят первым. Здесь — обе сборки
   площадки (Яндекс + ВК): build.py подключает файл и тег <script> в
   ОБЕИХ целях (в отличие от нонограмм, где модуль только на ВК) —
   Color Sort использует один index.html/main.js на обе площадки, порт
   не должен разводить их (ТЗ №14, п.2.4).

   Чистые функции без побочных эффектов (тот же принцип, что в save.js):
   не трогают DOM, не читают Platform, не лезут в LEVELS/main.js напрямую.
   Игра передаёт всё нужное через config.callbacks и получает текущее
   время (Platform.now()) снаружи — модуль сам часы не читает, поэтому
   тестируется в Node без браузера и переносится в другие игры студии
   без правок: конфиг у каждой игры свой, retention.js — общий.

   ТРИ НЕЗАВИСИМЫХ МЕХАНИКИ:
   1. Замок (isLevelOpen) — какие уровни кампании доступны игроку.
   2. Раздатчик (drip*) — как замок отодвигается со временем.
   3. Серия (streak*) — вход-по-вход, отдельно от замка и раздатчика.

   ДИЗАЙН-РЕШЕНИЕ (модуль недоспецифицирован в ТЗ на этот счёт, записано
   явно, чтобы решение было видно, а не спрятано в коде):
   «Накопитель» — это НЕ отдельно хранимое число, а РАЗНИЦА между
   «сколько уровней раздатчик уже открыл» (dripOpened — то самое «граница
   открытого» из ТЗ, п.2.5) и «докуда игрок реально добрался»
   (maxReachedIndex, из callbacks). Если бы накопитель хранился отдельным
   полем, его пришлось бы держать в синхроне с границей открытого вручную
   при каждой мутации — лишний источник рассинхрона ради того же самого
   числа. «Копится» и «тратится» — синонимы «растёт»/«убывает» этой
   разницы, а не два разных действия игрока: единственное действие,
   которое «тратит» накопитель — сыграть дальше (сдвинуть maxReachedIndex).
   ============================================================ */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Retention = factory();
  }
})(typeof window !== 'undefined' ? window : this, function () {

  var DEFAULT_CONFIG = {
    // Режим гейта (ТЗ №15, Color Sort): 'unlock' — накопитель ОТКРЫВАЕТ
    // уровни кампании (нонограммы, поведение этим не меняется НИ НА
    // БАЙТ — дефолт сохранён). 'energy' — накопитель НЕ открывает
    // ничего, это самостоятельная тратимая валюта: dripOpened
    // интерпретируется ПРЯМО как текущий баланс (не через backlog от
    // maxReachedIndex), тратится явно (см. spendEnergy), новый ИЛИ
    // мигрирующий игрок стартует с ПОЛНЫМ накопителем (см. initState).
    // Такт/порция/потолок/пополнение рекламой/серия входов — ОДИН и
    // тот же код на оба режима, меняется только точка применения
    // ресурса (см. заголовок файла).
    gateMode:        'unlock',
    tickMs:          6 * 60 * 60 * 1000, // такт раздатчика (п.2.1)
    dripPerTick:     1,                  // порция — сколько уровней открывает один такт (ТЗ №08)
    accumulatorCap:  4,                  // потолок накопителя (п.2.1)
    starterCount:    11,                 // стартовый запас, всегда открыт (п.2.1) — gateMode:'energy' его не использует
    streakThreshold: 3,                  // длина серии для полной награды (п.2.3)
    streakDayReward: { 2: 'hints', 3: 'style' }, // день -> тип награды (п.2.3)
    contentUnitName: 'puzzle', // название единицы контента для UI игры (i18n-ключ, не литерал)
    domSlots: {
      dripLine:    'retention-drip-line',
      streakLine:  'retention-streak-line',
      rewardToast: 'retention-reward-toast',
      rewardedBtn: 'retention-rewarded-btn',
    },
    // Задел на будущее (Словоход/Color Sort используют «звёзды/мастерство» —
    // в нонограммах этой механики нет). Колбэк только объявлен, модуль
    // никогда сам его не вызывает — реализация не входит в это ТЗ.
    onMasteryEvent: null,
    callbacks: {
      totalLevels:      function ()  { return 0; },
      isCompleted:      function ()  { return false; },
      maxReachedIndex:  function ()  { return -1; },
      grantHints:       function ()  {},
      grantStyle:       function ()  {},
    },
  };

  function mergeConfig(overrides) {
    var cfg = {};
    var key;
    for (key in DEFAULT_CONFIG) if (DEFAULT_CONFIG.hasOwnProperty(key)) cfg[key] = DEFAULT_CONFIG[key];
    if (overrides) {
      for (key in overrides) {
        if (!overrides.hasOwnProperty(key)) continue;
        if (key === 'callbacks') {
          cfg.callbacks = {};
          var ck;
          for (ck in DEFAULT_CONFIG.callbacks) if (DEFAULT_CONFIG.callbacks.hasOwnProperty(ck)) cfg.callbacks[ck] = DEFAULT_CONFIG.callbacks[ck];
          for (ck in overrides.callbacks) if (overrides.callbacks.hasOwnProperty(ck)) cfg.callbacks[ck] = overrides.callbacks[ck];
        } else if (key === 'domSlots') {
          cfg.domSlots = {};
          var dk;
          for (dk in DEFAULT_CONFIG.domSlots) if (DEFAULT_CONFIG.domSlots.hasOwnProperty(dk)) cfg.domSlots[dk] = DEFAULT_CONFIG.domSlots[dk];
          for (dk in overrides.domSlots) if (overrides.domSlots.hasOwnProperty(dk)) cfg.domSlots[dk] = overrides.domSlots[dk];
        } else if (key === 'streakDayReward') {
          cfg.streakDayReward = {};
          var sk;
          for (sk in DEFAULT_CONFIG.streakDayReward) if (DEFAULT_CONFIG.streakDayReward.hasOwnProperty(sk)) cfg.streakDayReward[sk] = DEFAULT_CONFIG.streakDayReward[sk];
          for (sk in overrides.streakDayReward) if (overrides.streakDayReward.hasOwnProperty(sk)) cfg.streakDayReward[sk] = overrides.streakDayReward[sk];
        } else {
          cfg[key] = overrides[key];
        }
      }
    }
    return cfg;
  }

  /* ---------------------------------------------------------------
     ЗАМОК — приоритет правил строго по ТЗ п.2.1 (1..4, первое
     сработавшее правило решает).
     --------------------------------------------------------------- */
  function isLevelOpen(levelIndex, moduleState, config) {
    if (config.callbacks.isCompleted(levelIndex)) return true;              // 1. пройден
    if (levelIndex <= config.callbacks.maxReachedIndex()) return true;      // 2. уже достигнут
    if (levelIndex < config.starterCount) return true;                     // 3. стартовый запас
    return levelIndex < dripBoundary(moduleState, config);                 // 4. раздатчик, по порядку
  }

  // «Граница открытого» (см. заголовок файла, п.2.5 ТЗ №01) — первый индекс,
  // который раздатчиком ЕЩЁ не открыт. Экспортирована отдельно (не только
  // внутренняя переменная isLevelOpen) — ТЗ №09, фаза 4: дистанция до
  // запертой категории = firstIndex категории минус эта граница.
  function dripBoundary(moduleState, config) {
    return config.starterCount + moduleState.dripOpened;
  }

  /* ---------------------------------------------------------------
     РАЗДАТЧИК.
     --------------------------------------------------------------- */

  // Сколько сейчас «в накопителе» — открыто раздатчиком, но игрок ещё не
  // добрался (см. дизайн-решение в шапке файла). gateMode:'energy' —
  // накопитель НЕ привязан к прогрессу (maxReachedIndex), dripOpened
  // ЭТО и есть текущий баланс напрямую (тратится явно, см. spendEnergy).
  function dripBacklogCount(moduleState, config) {
    if (config.gateMode === 'energy') return moduleState.dripOpened;
    var reached  = config.callbacks.maxReachedIndex();
    var consumed = Math.max(0, Math.min(moduleState.dripOpened, (reached + 1) - config.starterCount));
    return moduleState.dripOpened - consumed;
  }

  // Тратит 1 единицу накопителя (ТЗ №15, gateMode:'energy' ТОЛЬКО —
  // вызывающая сторона решает, когда: Color Sort тратит за успешно
  // ЗАВЕРШЁННЫЙ новый уровень, не за рестарт/повтор пройденного, это
  // не забота модуля). Floor в 0 — защита от двойного списания гонкой,
  // не рабочий путь (UI обязан не пускать игрока начать уровень при 0).
  function spendEnergy(moduleState, config) {
    if (moduleState.dripOpened <= 0) return moduleState;
    return {
      dripOpened: moduleState.dripOpened - 1,
      lastTickAt: moduleState.lastTickAt,
      lastEntryDay: moduleState.lastEntryDay,
      streakLen: moduleState.streakLen,
      streakRewards: moduleState.streakRewards,
    };
  }

  // Продвигает раздатчик на nowMs тактов вперёд. Чистая функция — не
  // мутирует moduleState, возвращает НОВЫЙ объект (или тот же, если тактов
  // не набежало).
  //
  // Полный накопитель — ПО РЕЖИМУ (ТЗ №18, сценарии A5/A6, найдено при
  // проверке, не новая механика):
  //   gateMode:'unlock' (раздатчик уровней, ТЗ №08) — время «стоит»:
  //     lastTickAt не продвигается вообще, простой не теряется — как
  //     только у игрока появится место (сыграет дальше), заслуженные
  //     такты применятся сразу. Это ЖЕЛАТЕЛЬНОЕ поведение для очереди
  //     уровней — оставлено нетронутым.
  //   gateMode:'energy' (Color Sort, ТЗ №15) — ТАК ЖЕ было устроено, и
  //     это дефект сценария: пока накопитель полон, реальное время
  //     утекает «в тень» (lastTickAt не двигается), и как только игрок
  //     потратит энергию, applyDripTick меряет elapsed от давно
  //     устаревшего lastTickAt и выдаёт пачку набежавших тактов разом —
  //     энергия перестаёт быть тратимой валютой с честным кулдауном.
  //     Поэтому в РЕЖИМЕ ENERGY штамп подтягивается к «сейчас» каждый
  //     раз, когда накопитель ОСТАЁТСЯ или СТАНОВИТСЯ полным — простой
  //     не банкуется, накопление просто останавливается на потолке.
  //
  // Часы устройства ушли НАЗАД (ТЗ №18, B1/B2) — nowMs МЕНЬШЕ сохранённого
  // lastTickAt: начисление не производится ни в одном режиме (нечего
  // множить на отрицательный elapsed), а штамп подтягивается к «сейчас».
  // Альтернатива — оставить штамп из «будущего» — заперла бы игрока на
  // весь сдвиг часов (в B2 — на год); эта дешевле и безопаснее.
  function applyDripTick(moduleState, nowMs, config) {
    if (nowMs < moduleState.lastTickAt) {
      return {
        dripOpened: moduleState.dripOpened,
        lastTickAt: nowMs,
        lastEntryDay: moduleState.lastEntryDay,
        streakLen: moduleState.streakLen,
        streakRewards: moduleState.streakRewards,
      };
    }

    var backlog = dripBacklogCount(moduleState, config);
    var room = config.accumulatorCap - backlog;
    if (room <= 0) {
      if (config.gateMode !== 'energy' || moduleState.lastTickAt === nowMs) return moduleState;
      return {
        dripOpened: moduleState.dripOpened,
        lastTickAt: nowMs,
        lastEntryDay: moduleState.lastEntryDay,
        streakLen: moduleState.streakLen,
        streakRewards: moduleState.streakRewards,
      };
    }

    var elapsed = nowMs - moduleState.lastTickAt;
    if (elapsed < config.tickMs) return moduleState;

    var ticks = Math.floor(elapsed / config.tickMs);
    // Порция > 1 (ТЗ №08): такт даёт dripPerTick уровней разом, не 1. Число
    // ПРИМЕНЁННЫХ тактов ограничено местом в накопителе (в тактах, округление
    // вверх — последний такт у потолка может отдать неполную порцию), а не
    // самим grant — иначе lastTickAt продвинется на время, которое реально
    // не «выкуплено» гарантом простоя (см. комментарий у gateMode:'unlock'
    // выше: время должно стоять, пока накопитель полон, простой не теряется).
    var ticksForRoom = Math.ceil(room / config.dripPerTick);
    var ticksApplied = Math.min(ticks, ticksForRoom);
    if (ticksApplied <= 0) return moduleState;
    var grant = Math.min(ticksApplied * config.dripPerTick, room);
    // ТЗ №18 (A5), режим energy: если ИМЕННО ЭТОТ такт довёл до потолка,
    // штамп подтягивается к «сейчас» — не к точному числу применённых
    // тактов, иначе неиспользованный остаток «банкуется в тени» (см.
    // заголовок функции). Пока место ЕСТЬ (потолок не достигнут) —
    // остаток такта СОХРАНЯЕТСЯ (A4): штамп двигается ровно на
    // применённые целые такты, не обнуляется до «сейчас».
    var reachedCap = config.gateMode === 'energy' && (backlog + grant) >= config.accumulatorCap;

    return {
      dripOpened: moduleState.dripOpened + grant,
      lastTickAt: reachedCap ? nowMs : moduleState.lastTickAt + ticksApplied * config.tickMs,
      lastEntryDay: moduleState.lastEntryDay,
      streakLen: moduleState.streakLen,
      streakRewards: moduleState.streakRewards,
    };
  }

  // Точное время следующего открытия (мс) либо null, если накопитель полон
  // (п.2.2 — тогда UI обязан показать фразу про максимум, а не время).
  function nextUnlockAtMs(moduleState, config) {
    if (dripBacklogCount(moduleState, config) >= config.accumulatorCap) return null;
    return moduleState.lastTickAt + config.tickMs;
  }

  /* ---------------------------------------------------------------
     ТЗ №09, фаза 3 — rewarded «Открыть ещё +N». ОТДЕЛЬНЫЙ кран от
     такта: НЕ ограничен accumulatorCap (осознанный риск студии — «кампанию
     можно открыть роликами за вечер», записан в постановке), только
     естественной границей конца кампании (дальше totalLevels открывать
     нечего). Кулдаунов/лимитов нет — вызывающая сторона (main.js) решает,
     когда звать, сам модуль такого состояния не хранит.
     --------------------------------------------------------------- */
  function grantDrip(moduleState, config, amount) {
    // gateMode:'energy': предел — потолок накопителя (ТЗ №15, «реклама
    // пополняет вне очереди, не выше потолка»), НЕ размер кампании —
    // totalLevels()/starterCount к энергии отношения не имеют.
    var maxDripOpened = config.gateMode === 'energy'
      ? config.accumulatorCap
      : Math.max(0, config.callbacks.totalLevels() - config.starterCount);
    var newDripOpened = Math.min(moduleState.dripOpened + amount, maxDripOpened);
    if (newDripOpened === moduleState.dripOpened) return moduleState;
    return {
      dripOpened: newDripOpened,
      lastTickAt: moduleState.lastTickAt,
      lastEntryDay: moduleState.lastEntryDay,
      streakLen: moduleState.streakLen,
      streakRewards: moduleState.streakRewards,
    };
  }

  // true, если вся кампания уже открыта (дальше раздатчику/rewarded нечего
  // открывать) — естественная граница, по которой прячется кнопка rewarded
  // (ТЗ №09, фаза 3) и «Ещё пазлов» в замке (фаза 4).
  function isCampaignFullyUnlocked(moduleState, config) {
    var total = config.callbacks.totalLevels();
    return total <= 0 || isLevelOpen(total - 1, moduleState, config);
  }

  // Сколько сейчас ОТКРЫТЫХ И НЕПРОЙДЕННЫХ уровней ждёт игрока — для
  // постоянной строки на экране (п.2.2). Считает по всей кампании
  // (стартовый запас + раздатчик), не только «бэклог» раздатчика — игроку
  // всё равно, откуда взялся открытый непройденный уровень.
  function openUnfinishedCount(moduleState, config) {
    var total = config.callbacks.totalLevels();
    var count = 0;
    for (var i = 0; i < total; i++) {
      if (isLevelOpen(i, moduleState, config) && !config.callbacks.isCompleted(i)) count++;
    }
    return count;
  }

  /* ---------------------------------------------------------------
     СЕРИЯ ВХОДОВ (п.2.3). todayKey — 'YYYY-M-D' по ЛОКАЛЬНОМУ времени
     игрока, строится вызывающим тем же приёмом, что _todayKey() в
     main.js (см. dayKeyFromDate ниже — идентичная формула).
     --------------------------------------------------------------- */

  function dayKeyFromDate(d) {
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  // 'YYYY-M-D' → мс фиксированного (но произвольного) момента этой
  // календарной даты — только для разницы в днях между двумя ключами.
  // Идентична _dayAnchor() в main.js.
  function _dayAnchor(key) {
    var p = key.split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2]);
  }

  function dayDiff(fromKey, toKey) {
    return Math.round((_dayAnchor(toKey) - _dayAnchor(fromKey)) / 86400000);
  }

  // Событие «игрок вошёл в игру сегодня». Идемпотентно (повторный вызов в
  // тот же локальный день — no-op, «переход через полночь не даёт +2»).
  // Возвращает { state, reward }, reward — 'hints'|'style'|null.
  // Пропуск дня (diff > 1) сбрасывает серию буквально в 0 (ТЗ п.2.3,
  // «серия бинарная, пропуск = сброс в 0») — это НЕ «продолжает считать
  // сегодняшний день первым», сегодняшний вход лишь помечает точку отсчёта
  // (lastEntryDay), от которой следующий подряд идущий день снова
  // начнёт счёт 1→2→3. Уже выданное за прошлую серию (флаги streakRewards)
  // сбрасывается вместе с серией — новая серия может заслужить награды
  // заново; уже выданные предметы (косметика/подсказки) при этом НЕ
  // отбираются — их отбор не входит в зону ответственности модуля.
  function onEnter(moduleState, todayKey, config) {
    if (moduleState.lastEntryDay === todayKey) {
      return { state: moduleState, reward: null };
    }

    var diff = moduleState.lastEntryDay ? dayDiff(moduleState.lastEntryDay, todayKey) : null;
    var newLen;
    var freshSeries;
    if (diff === null) {
      newLen = 1; freshSeries = true;                 // самый первый вход в жизни
    } else if (diff === 1) {
      newLen = moduleState.streakLen + 1; freshSeries = false; // подряд
    } else {
      newLen = 0; freshSeries = true;                 // пропуск (diff>1) — сброс в 0
    }

    var rewards = freshSeries ? {} : shallowCopy(moduleState.streakRewards);
    var reward = null;
    var rewardKind = config.streakDayReward[String(newLen)];
    if (rewardKind && !rewards[newLen]) {
      rewards[newLen] = true;
      reward = rewardKind;
    }

    return {
      state: {
        dripOpened:    moduleState.dripOpened,
        lastTickAt:    moduleState.lastTickAt,
        lastEntryDay:  todayKey,
        streakLen:     newLen,
        streakRewards: rewards,
      },
      reward: reward,
    };
  }

  function shallowCopy(obj) {
    var out = {};
    for (var k in obj) if (obj.hasOwnProperty(k)) out[k] = obj[k];
    return out;
  }

  /* ---------------------------------------------------------------
     ИНИЦИАЛИЗАЦИЯ / МИГРАЦИЯ (п.2.5). Один и тот же путь для новичка и
     для старого сейва без полей модуля — различие только в исходном
     maxReachedIndex, которое передаёт вызывающий (main.js/save.js):
     у настоящего новичка это -1 (или что игра считает «ничего не
     достигнуто»), у мигрирующего старого сейва — реальный прогресс.
     --------------------------------------------------------------- */
  function initState(maxReachedIndex, nowMs, config) {
    var isBrandNew = maxReachedIndex < 0;
    var dripOpened;
    if (config.gateMode === 'energy') {
      // ТЗ №15, п.1.1: «у нового игрока энергия полная» — энергия не
      // привязана к прогрессу (maxReachedIndex не участвует вообще),
      // поэтому и мигрирующий игрок (первый заход после апдейта)
      // стартует с полным накопителем тем же путём — щедрость, не
      // штраф за то, что модуль подключили не с первого дня.
      dripOpened = config.accumulatorCap;
    } else {
      // ТЗ №08: новый игрок стартует с ОДНОЙ порцией в накопителе
      // (уважение, не полный потолок с первой секунды) — starterCount +
      // dripPerTick открытых уровней на старте, не starterCount +
      // accumulatorCap.
      dripOpened = isBrandNew
        ? config.dripPerTick
        : Math.max(0, (maxReachedIndex + 1) - config.starterCount);
    }
    return {
      dripOpened:    dripOpened,
      lastTickAt:    nowMs,
      lastEntryDay:  '',
      streakLen:     0,
      streakRewards: {},
    };
  }

  // true, если moduleState структурно валиден (защита от битых/чужих
  // данных при загрузке сейва — тот же принцип, что в save.js migrate()).
  function isValidState(x) {
    return !!x && typeof x === 'object'
      && typeof x.dripOpened === 'number'
      && typeof x.lastTickAt === 'number'
      && typeof x.lastEntryDay === 'string'
      && typeof x.streakLen === 'number'
      && !!x.streakRewards && typeof x.streakRewards === 'object';
  }

  /* ---------------------------------------------------------------
     КОМПАКТНОЕ ПРЕДСТАВЛЕНИЕ ДЛЯ СЕЙВА (п.2.5: ≤120 байт, короткие
     ключи). streakRewards — битовая маска (день N -> бит N), не объект:
     единственные дни с наградами в конфиге — 2 и 3, влезают в 2 бита.
     --------------------------------------------------------------- */
  function encodeState(moduleState) {
    var r = 0;
    for (var day in moduleState.streakRewards) {
      if (moduleState.streakRewards.hasOwnProperty(day) && moduleState.streakRewards[day]) {
        r |= (1 << (+day));
      }
    }
    return {
      t: moduleState.lastTickAt,
      b: moduleState.dripOpened,
      d: moduleState.lastEntryDay,
      s: moduleState.streakLen,
      r: r,
    };
  }

  function decodeState(encoded) {
    var rewards = {};
    for (var day = 0; day <= 31; day++) {
      if (encoded.r & (1 << day)) rewards[day] = true;
    }
    return {
      dripOpened:    encoded.b,
      lastTickAt:    encoded.t,
      lastEntryDay:  encoded.d,
      streakLen:     encoded.s,
      streakRewards: rewards,
    };
  }

  function isValidEncoded(x) {
    return !!x && typeof x === 'object'
      && typeof x.t === 'number' && typeof x.b === 'number'
      && typeof x.d === 'string' && typeof x.s === 'number' && typeof x.r === 'number';
  }

  return {
    DEFAULT_CONFIG:      DEFAULT_CONFIG,
    mergeConfig:         mergeConfig,
    isLevelOpen:         isLevelOpen,
    dripBacklogCount:    dripBacklogCount,
    spendEnergy:         spendEnergy,
    applyDripTick:       applyDripTick,
    nextUnlockAtMs:      nextUnlockAtMs,
    openUnfinishedCount: openUnfinishedCount,
    grantDrip:           grantDrip,
    isCampaignFullyUnlocked: isCampaignFullyUnlocked,
    dripBoundary:        dripBoundary,
    dayKeyFromDate:      dayKeyFromDate,
    dayDiff:             dayDiff,
    onEnter:             onEnter,
    initState:           initState,
    isValidState:        isValidState,
    encodeState:         encodeState,
    decodeState:         decodeState,
    isValidEncoded:      isValidEncoded,
  };
});
