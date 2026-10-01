/* ============================================================
   adapters/vk_bridge.js — нативный @vkontakte/vk-bridge.
   Реализует контракт Platform v2 поверх официального VK Bridge SDK.
   Подставляется build.py как platform.js в vk-сборку.

   SDK (vk-bridge.min.js) подключается тегом <script> в index.html —
   файл вшит в zip локально, без CDN.
   В браузере VK Bridge доступен как window.vkBridge (browser UMD bundle).

   Защита от зависания (баг «вечная загрузка»):
   VK Bridge реализует send() как Promise, который резолвится только
   если VK-клиент ответил. В двух сценариях ответа НЕТ:
     1. Страница открыта напрямую (не в iframe/native app VK):
        l = parent = window (self), postMessage уходит в никуда.
     2. Страница в iframe, но VK не обрабатывает запросы
        (URL не зарегистрирован, ранний lifecycle и т.д.).
   Фикс: vkBridge.isEmbedded() проверяем ДО send();
         таймаут 2.5 сек покрывает сценарий 2.
   При провале — dev-режим (isAvailable=false, dev-бейдж, игра без сейва/рекламы).
   Стандарт студии: вечная загрузка запрещена в любом окружении.

   Маппинг контракта v3 (задача Б добавила showBanner; canPurchase/purchase
   держим в контракте как задел — в этой сборке (A+B) их никто не вызывает,
   витрины косметики нет, см. отдельную задачу В):
     init()                    → VKWebAppInit + isEmbedded guard + 2.5s timeout
                                 (b26: init НЕ ждёт VKWebAppCheckNativeAds — он держал
                                 меню до 1,5 с; b53: после init предзагрузка рекламы
                                 VKWebAppCheckNativeAds reward/interstitial запускается
                                 в фоне, ничего не ждёт и ни на что не влияет — см. preloadAds)
     gameReady()               → no-op (у VK нет аналога Yandex LoadingAPI)
     getLang()                 → URL-параметр vk_language или navigator.language
     isAvailable()             → флаг ready после успешного init
     isRewardedAvailable()     → всегда true (b26). Раньше — кеш VKWebAppCheckNativeAds,
                                 и при false подсказка выдавалась БЕЗ рекламы (дыра: на
                                 телефоне подсказка была бесконечной). Проверка исторически
                                 ненадёжна (github.com/VKCOM/vk-bridge/issues/243); теперь
                                 реклама просто пробуется при каждом нажатии.
     save(fullState)           → VKWebAppStorageSet {key, value};
                                 dev-режим (!ready) → localStorage[slovohod_dev_save_vk]
     load()                    → VKWebAppStorageGet {keys:[KEY]} → keys[0].value;
                                 dev-режим (!ready) → localStorage[slovohod_dev_save_vk]
     showInterstitial          → VKWebAppShowNativeAds {ad_format:'interstitial'}
                                 + watchdog 40000мс, onResume(wasShown, outcome)
                                 (b25: outcome 'not_shown' при result === false —
                                 кулдаун как при показе, цели аналитики нет)
     showRewarded              → VKWebAppShowNativeAds {ad_format:'reward'}
                                 result.result === true → досмотрено, награда;
                                 b53: в том числе если ответ пришёл ПОСЛЕ сторожа
                                 40 с (на телефоне загрузка + 30 с ролика + финальный
                                 экран дольше 40 с — раньше награда терялась);
                                 иначе (result:false/пусто, reject, таймаут, adblock) →
                                 награды НЕТ (b26, ТЗ 01.10: «бонус только если реклама
                                 реально показана», бесплатного режима нет).
                                 SDK нет (!ready) → награды нет, кроме localhost/file://
                                 (devAdsAllowed). onResume(outcome) — исход:
                                 'reward' | 'closed' | 'error' | 'timeout' | 'noads'
     showInterstitialBonus     → то же, но формат 'interstitial' (b26, запасной путь
                                 «бонус за межстраничную»; в игре выключен, см. main.js
                                 BONUS_AD_FORMAT). Награда ТОЛЬКО при result === true.
                                 onResume(outcome): 'shown' | 'not_shown' | 'error' |
                                 'timeout' | 'noads'
     showBanner(onInset)        → VKWebAppShowBannerAd {banner_location:'bottom', layout_type:'resize'};
                                  onInset(px) — сколько баннер перекрывает снизу (0 при resize).
                                  ПК (vk_platform=desktop_*) — баннер не запрашивается.
                                 Гарантированная поверхность (задача Б) — не завязана на гейт
                                 interstitial/rewarded, вызывается один раз при старте.
     haptic(kind)              → 'select' → VKWebAppTapticSelectionChanged {};
                                 'light'/'medium' → VKWebAppTapticImpactOccurred {style};
                                 'success'/'error' → VKWebAppTapticNotificationOccurred {type}.
                                 Fire-and-forget; после первого отказа taptic выключен до
                                 конца сессии (десктопный веб-ВК); dev (!ready) → navigator.vibrate.
     canPurchase()/purchase()   → присутствуют в контракте (см. примечание выше), в этой
                                 сборке main.js их не вызывает.
     gameplayStart/Stop        → no-op
   Доки/типы VK Bridge проверены по исходникам пакета:
   https://github.com/VKCOM/vk-bridge/blob/master/packages/core/src/types/data.ts
   ============================================================ */
window.Platform = (() => {
  const STORAGE_KEY   = 'filword_save';
  const INIT_TIMEOUT  = 2500;   // мс — после этого уходим в dev-режим

  /* ---------- Dev-фолбэк сейва (ЭТАП 2, п.0.2) ----------
     Стандарт студии 19.07: одинаковый dev-фолбэк во всех играх
     (нонограммы: adapters/vk_bridge.js DEV_SAVE_KEY
     'nonogram_dev_save_vk'). Активен ТОЛЬКО когда !ready — при живом
     VK Bridge localStorage не трогается вообще, сейв идёт через
     VKWebAppStorageSet. Этого ключа ждёт tools/smoke_vk_dist.js:101,149. */
  const DEV_SAVE_KEY = 'slovohod_dev_save_vk';

  /* ---------- Бюджет сторожа объёма сейва (ЭТАП 2, п.2.1) ----------
     3500 байт — ИНЖЕНЕРНЫЙ БЮДЖЕТ СТУДИИ (решение основателя 22.08),
     первоисточником (документацией ВК) НЕ подтверждён: консервативный
     запас под реальный лимит VKWebAppStorageSet. То же число в бою в
     Color Sort (vk_platform.js:119) и нонограммах. Замер живого JSON
     делает main.js (persist()) перед КАЖДОЙ записью. */
  const SAVE_SIZE_GUARD_BYTES = 3500;

  /* ---------- Watchdog зависшей рекламы (ЭТАП 2, п.1.2) ----------
     40000 мс — значение прочитано из эталона Color Sort
     (vk_platform.js:95 REWARD_AD_TIMEOUT_MS, platform.js:100
     AD_HANG_TIMEOUT_MS — оба 40000). Ролики ВК обычно 15-30 с, 40 с —
     запас поверх этого, чтобы не обрубить ЗАКОННО идущий длинный ролик.
     Здесь vkBridge.send() — Promise, поэтому идемпотентность даёт
     settle-once (флаг settled в finish()), а не два флага, как в
     колбэк-API Яндекса. */
  const AD_HANG_TIMEOUT_MS = 40000;

  /* Промис + таймаут. Не Promise.race с «голым» setTimeout: таймер
     обязан сниматься при штатном ответе, иначе он держит event loop
     и в Node-тестах процесс висит лишние 40 секунд. */
  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), ms);
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });
  }

  function hasBridge() {
    return typeof vkBridge !== 'undefined';
  }

  /* Фоновый таймер: в браузере обычный setTimeout; в Node-тестах unref(),
     чтобы повтор предзагрузки не держал процесс теста живым. */
  function bgTimer(fn, ms) {
    const t = setTimeout(fn, ms);
    if (t && typeof t.unref === 'function') t.unref();
    return t;
  }

  /* Query фрейма — снимок при загрузке адаптера (b25). analytics.js
     после Game Ready убирает из адреса параметры запуска ВК (sign, vk_*),
     чтобы их не прочитал tag.js Метрики. getLang() и isDesktop() читают
     этот снимок, а не живой location.search, — от порядка вызовов
     относительно Analytics.start() они не зависят. */
  const LAUNCH_SEARCH = (() => {
    try { return String(location.search || ''); } catch (_) { return ''; }
  })();

  /* Ранний старт (b26): window.__vkEarly = { init, load, key } кладёт тег из
     index.html. load — промис VKWebAppStorageGet по ключу key; берётся ОДИН
     раз и только если key совпадает с STORAGE_KEY (иначе — читаем сами). */
  function earlyStart() {
    try { return (typeof window !== 'undefined' && window.__vkEarly) || null; } catch (_) { return null; }
  }

  let ready = false;

  /* ---------- Инициализация ----------
     Порядок защит:
     1. SDK не загружен → dev-режим (ошибка подключения файла).
     2. isEmbedded() = false → standalone браузер → dev-режим немедленно,
        send() НЕ вызываем (промис завис бы навсегда).
     3. Таймаут 2.5 сек → если VK не ответил (URL не зарег., ранний lifecycle)
        → dev-режим. */
  async function init() {
    if (!hasBridge()) {
      console.warn('[platform] VK Bridge не найден — dev-режим');
      return false;
    }

    if (!vkBridge.isEmbedded()) {
      console.warn('[platform] Не VK-окружение (standalone) — dev-режим');
      return false;
    }

    // withTimeout вместо Promise.race с «голым» setTimeout: race
    // оставлял таймер висеть даже при штатном ответе — в Node-тестах
    // это держало event loop, а в браузере зря удерживало замыкание.
    try {
      // b26: рукопожатие уже может лететь — его запускает тег в index.html
      // сразу после vk-bridge.min.js (build.py:VK_EARLY_INIT). Забираем тот же
      // промис; нет раннего старта (тесты, локальный запуск) — шлём сами.
      const early = earlyStart();
      await withTimeout((early && early.init) || vkBridge.send('VKWebAppInit'), INIT_TIMEOUT);
      ready = true;
      console.log('[platform] VK Bridge init OK');
      // b53: предзагрузка рекламы — в фоне, init её НЕ ждёт (урок b26).
      preloadAds('reward');
      preloadAds('interstitial');

      return true;
    } catch (e) {
      if (e.message === 'timeout') {
        console.warn('[platform] VKWebAppInit timeout (' + INIT_TIMEOUT + 'ms) — dev-режим');
      } else {
        console.error('[platform] VKWebAppInit ошибка:', e);
      }
      return false;
    }
  }

  /* ---------- Game Ready ----------
     У VK нет аналога Yandex LoadingAPI.ready() — no-op. */
  function gameReady() {}

  /* ---------- Язык ----------
     VK передаёт vk_language в URL синхронно — не нужен async (снимок
     адреса — LAUNCH_SEARCH). */
  function getLang() {
    try {
      const p = new URLSearchParams(LAUNCH_SEARCH);
      const l = p.get('vk_language');
      if (l) return l.slice(0, 2);
    } catch (_) {}
    return (navigator.language || 'ru').slice(0, 2);
  }

  /* ---------- Доступность ---------- */
  function isAvailable() { return ready; }

  /* ---------- Предзагрузка рекламы (b53) ----------
     Документация ВК («Реклама в играх → Необходимые события»): без
     предзагрузки VKWebAppShowNativeAds сначала ЗАГРУЖАЕТ материалы и только
     потом показывает — «это может приводить к некоторой задержке при старте
     показа»; «проверка необходима для показа рекламы за вознаграждение»;
     загрузка может не удаться при плохой сети — «вызывать
     VKWebAppCheckNativeAds по таймеру». В b26 вызов убрали целиком (он
     держал меню и решал, выдавать ли подсказку бесплатно), и на телефоне
     каждое нажатие ждало загрузку ролика по 4–6 с без отклика — игрок жал
     ещё и ещё (жалоба основателя 01.10, b52).
     Теперь: fire-and-forget после init и после каждого показа своего
     формата. Ничего не ждёт, ни на что не влияет (isRewardedAvailable
     по-прежнему true, награда — только по result === true при показе).
     Ответ «материалов нет»/ошибка/молчание — повтор через
     PRELOAD_RETRY_MS, не больше PRELOAD_RETRIES раз подряд. */
  const PRELOAD_TIMEOUT_MS = 8000;
  const PRELOAD_RETRY_MS = 30000;
  const PRELOAD_RETRIES = 5;
  const preloadState = {};   // формат → { busy, tries, timer }
  function preloadAds(fmt) {
    if (!ready || !hasBridge()) return;
    const s = preloadState[fmt] || (preloadState[fmt] = { busy: false, tries: 0, timer: null });
    if (s.busy) return;
    if (s.timer) { clearTimeout(s.timer); s.timer = null; }
    s.busy = true;
    let done = false;
    const end = (okNow, why) => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      s.busy = false;
      if (okNow) { s.tries = 0; return; }
      if (s.tries >= PRELOAD_RETRIES) {
        console.warn('[platform] предзагрузка ' + fmt + ': ' + why + ' — повторы исчерпаны, ролик загрузится при показе');
        return;
      }
      s.tries++;
      s.timer = bgTimer(() => { s.timer = null; preloadAds(fmt); }, PRELOAD_RETRY_MS);
    };
    const guard = bgTimer(() => end(false, 'мост молчит'), PRELOAD_TIMEOUT_MS);
    let p;
    try { p = vkBridge.send('VKWebAppCheckNativeAds', { ad_format: fmt }); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then(
      (res) => end(!!(res && res.result === true), 'материалов пока нет'),
      () => end(false, 'ошибка'),
    );
  }

  /* ---------- Rewarded-реклама доступна ----------
     b26: всегда true. Раньше кеш VKWebAppCheckNativeAds, и при false
     main.js выдавал подсказку БЕЗ рекламы — на телефоне она становилась
     бесконечной (ТЗ 01.10). Теперь реклама пробуется при каждом нажатии,
     а исход решает, выдавать ли бонус. Метод оставлен в контракте. */
  function isRewardedAvailable() { return true; }

  /* ---------- Dev-режим рекламы (b26) ----------
     Бесплатная выдача без SDK — ТОЛЬКО для локальной разработки: страница
     открыта с localhost/127.0.0.1/file://. Стенд (github.io) и любая
     площадка сюда не попадают: там «рекламы нет» = «бонуса нет». */
  function devAdsAllowed() {
    try {
      if (location.protocol === 'file:') return true;
      const h = location.hostname;
      return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
    } catch (_) { return false; }
  }

  /* ---------- Сохранение ----------
     VKWebAppStorageSet — VK-серверное хранилище, изолировано от OK. */
  /* Возвращает true, если запись ПОДТВЕРЖДЕНА, и false, если площадка
     отказала. Раньше save() возвращал undefined в обоих случаях, и
     вызывающий не мог отличить удачу от неудачи. Понадобилось это
     ЭТАПУ 5, добор п.1: main.js/persist() пропускает повторную запись
     того же состояния и обязан обновлять кэш «последнего записанного»
     ТОЛЬКО по подтверждению. Иначе неудачная запись пометила бы
     состояние как сохранённое, следующая попытка была бы опознана как
     дубль и не ушла бы никогда — мягкий сбой площадки превратился бы в
     настоящую потерю прогресса.
     Ошибка по-прежнему НЕ пробрасывается: падать на сейве нельзя. */
  async function save(fullState) {
    if (!ready) {
      // dev-фолбэк: платформы нет — пишем в localStorage, чтобы прогресс
      // переживал перезагрузку страницы на localhost/dev-URL.
      try {
        localStorage.setItem(DEV_SAVE_KEY, JSON.stringify(fullState));
        return true;
      } catch (e) {
        // dev-режим — падать нельзя.
        console.warn('[platform] dev-сейв не записался:', e);
        return false;
      }
    }
    try {
      await vkBridge.send('VKWebAppStorageSet', {
        key:   STORAGE_KEY,
        value: JSON.stringify(fullState),
      });
      return true;
    } catch (e) {
      console.error('[platform] StorageSet ошибка:', e);
      return false;
    }
  }

  async function load() {
    if (!ready) {
      try {
        const raw = localStorage.getItem(DEV_SAVE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        console.warn('[platform] dev-сейв не прочитался:', e);
        return null;
      }
    }
    try {
      let res = null;
      const early = earlyStart();
      if (early && early.load && early.key === STORAGE_KEY) {
        const pending = early.load;
        early.load = null;   // один раз: повторный load() читает заново
        try { res = await pending; } catch (_) { res = null; }   // не вышло — ниже обычный запрос
      }
      if (!res) res = await vkBridge.send('VKWebAppStorageGet', { keys: [STORAGE_KEY] });
      const raw = res.keys && res.keys[0] && res.keys[0].value;
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error('[platform] StorageGet ошибка:', e);
      return null;
    }
  }

  /* ---------- Реклама ----------
     VK Bridge: Promise резолвится ПОСЛЕ закрытия рекламы.
     onPause → send → onResume → если result.result=true → onRewarded. */
  /* b25: onResume(wasShown, outcome). wasShown — как в b24: любой resolve
     моста = показ (двигает кулдаун и гейт в main.js, это монетизация —
     не менять). outcome — только для аналитики: 'shown' (resolve без
     явного отказа), 'not_shown' (resolve с result === false — по доке ВК
     «Ошибка при показе»), 'error' (reject), 'timeout', 'dev' (SDK нет).
     Цель interstitial_shown main.js не шлёт при 'not_shown'. */
  function showInterstitial(onPause, onResume) {
    if (!ready) {
      console.warn('[platform] dev: interstitial пропущен');
      if (onResume) onResume(false, 'dev');
      return;
    }
    if (onPause) onPause();
    let settled = false;
    // Единая точка выхода: settle-once. Опоздавший ответ моста ПОСЛЕ
    // сработавшего таймаута не снимет паузу второй раз и не сдвинет
    // кулдаун гейта в main.js повторно.
    const finish = (wasShown, reason, outcome) => {
      if (settled) return;
      settled = true;
      console.log('[platform] interstitial завершён:', reason, '| показан:', wasShown);
      if (onResume) onResume(wasShown, outcome);
    };
    const shown = vkBridge.send('VKWebAppShowNativeAds', { ad_format: 'interstitial' });
    // b53: следующий ролик — заранее, когда мост ответил про этот.
    Promise.resolve(shown).then(() => preloadAds('interstitial'), () => preloadAds('interstitial'));
    withTimeout(shown, AD_HANG_TIMEOUT_MS)
      .then((res) => {
        if (res && res.result === false) {
          finish(true, 'мост ответил result=false (кулдаун как при показе, цели нет)', 'not_shown');
        } else {
          finish(true, 'реклама закрыта (resolve)', 'shown');
        }
      })
      .catch((e) => {
        console.warn('[platform] interstitial недоступен/завис:', e);
        // wasShown=false — показ НЕ состоялся: main.js не двигает
        // кулдаун и счётчик гейта (см. ЭТАП 2, п.1.3).
        finish(false, 'ошибка/таймаут', (e && e.message === 'timeout') ? 'timeout' : 'error');
      });
  }

  /* Бонус за рекламу (b26, ТЗ 01.10): награда выдаётся ТОЛЬКО если
     площадка реально показала рекламу. Раньше (ЭТАП 2, п.1.1) любой
     сбой показа — reject, adblock, таймаут, нет SDK — выдавал награду
     бесплатно «чтобы не было тупика»; это и была дыра с бесконечной
     подсказкой. Теперь тупика нет иначе: main.js показывает игроку
     уведомление «отключите блокировщик / повторите», бонус не выдан,
     кнопка остаётся рабочей — можно нажать снова.
     Единый ход для обоих форматов: onPause → send → onResume(outcome)
     → onGranted (видимый эффект строго после onResume, как в Яндексе).

     b53 (жалоба основателя 01.10, b52 на телефоне: «после рекламы
     подсказка не появляется»). Сторож AD_HANG_TIMEOUT_MS считал от
     НАЖАТИЯ и был settle-once для всего: на телефоне ролик грузится
     несколько секунд, идёт 30 с и заканчивается финальным экраном —
     больше 40 с. Сторож объявлял «таймаут, награды нет», а пришедший
     через пару секунд {result:true} выбрасывался: игрок досмотрел
     рекламу и ничего не получил, и так при каждом повторе. На ПК ролик
     стартует быстрее и укладывается в 40 с — там всё работало.
     Теперь сторож отвечает только за то, ради чего заведён (ЭТАП 2,
     п.1.2): мост молчит — снять паузу и разблокировать игру
     (onResume('timeout'), ровно один раз). Награда — по подтверждению
     моста result === true, когда бы оно ни пришло, ровно один раз
     (QUALITY: «двойной/поздний callback — награда ровно один раз только
     по подтверждению SDK»). Опоздавший ответ onResume второй раз не зовёт. */
  function runBonusAd(adFormat, okOutcome, failOutcome, onGranted, onPause, onResume) {
    if (!ready) {
      if (devAdsAllowed()) {
        console.warn('[platform] dev (localhost): ' + adFormat + ' → награда выдана');
        if (onGranted) onGranted();
        if (onResume) onResume('dev');
      } else {
        console.warn('[platform] SDK нет — ' + adFormat + ' не показать, награды нет');
        if (onResume) onResume('noads');
      }
      return;
    }
    if (onPause) onPause();
    let settled = false;   // onResume — ровно один раз (ответ моста или сторож)
    let granted = false;   // награда — ровно один раз и только по result === true
    let timer = null;
    const finish = (reason, outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (onResume) onResume(outcome);
      console.log('[platform] ' + adFormat + ' завершён: ' + reason);
    };
    const grant = (late) => {
      if (granted) return;
      granted = true;
      console.log('[platform] ' + adFormat + ': награда выдана' +
        (late ? ' — подтверждение пришло ПОСЛЕ сторожа (долгий ролик)' : ''));
      if (onGranted) onGranted();
    };
    timer = setTimeout(() => {
      console.warn('[platform] ' + adFormat + ': мост молчит ' + AD_HANG_TIMEOUT_MS +
        ' мс — пауза снята; если ролик ещё идёт, награда придёт по его подтверждению');
      finish('сторож ' + AD_HANG_TIMEOUT_MS + ' мс', 'timeout');
    }, AD_HANG_TIMEOUT_MS);
    let shown;
    try { shown = vkBridge.send('VKWebAppShowNativeAds', { ad_format: adFormat }); } catch (e) { shown = Promise.reject(e); }
    Promise.resolve(shown)
      .then((res) => {
        const late = settled;
        if (res && res.result === true) {
          finish('показана (result=true)', okOutcome);
          grant(late);
        } else {
          finish('мост ответил без result=true — награды нет', failOutcome);
        }
      }, (e) => {
        console.warn('[platform] ' + adFormat + ' недоступна (adblock, нет объявлений) — награды нет:', e);
        finish('ошибка — награды нет', 'error');
      })
      .then(() => preloadAds(adFormat));   // b53: следующий ролик — заранее
  }

  /* b26: onResume(outcome) — 'reward' | 'closed' | 'error' | 'timeout' |
     'noads' | 'dev'. 'closed' = мост ответил без result:true (в Метрике с b25
     так и ведётся — ряд цели не ломаем); награды нет в любом случае. */
  function showRewarded(onRewarded, onPause, onResume) {
    runBonusAd('reward', 'reward', 'closed', onRewarded, onPause, onResume);
  }

  /* b26: запасной путь «бонус за межстраничную» (в игре выключен — main.js
     BONUS_AD_FORMAT). onResume(outcome) — 'shown' | 'not_shown' | 'error'
     | 'timeout' | 'noads' | 'dev'. Отдельно от showInterstitial: тот
     двигает кулдаун гейта и считает любой resolve показом (монетизация),
     этот выдаёт бонус только при result === true. */
  function showInterstitialBonus(onGranted, onPause, onResume) {
    runBonusAd('interstitial', 'shown', 'not_shown', onGranted, onPause, onResume);
  }

  /* ---------- Единая точка времени (ЭТАП 3, п.1) ----------
     ВЕСЬ тракт удержания (энергия, серия входов) читает время ТОЛЬКО
     отсюда — ни main.js, ни retention.js не зовут Date.now() сами.
     Иначе сценарии времени («энергия капает, пока игра закрыта»,
     «игрок отвёл часы назад») невозможно проверить, не переводя часы
     рабочей машины — а это рвёт git/TLS и всё остальное на ней.

     ПОДМЕНА ДОСТУПНА ТОЛЬКО В DEV/ФОЛБЭК-РЕЖИМЕ (мост ВК не инициализировался):
     на живой площадке window.__devNowMs игнорируется, даже если кто-то
     его выставит — время игрока подменить нельзя ни случайно, ни
     намеренно. Предупреждение печатается один раз, чтобы подменённое
     время нельзя было принять за настоящее при чтении лога. */
  let _devTimeWarned = false;
  function now() {
    if (!ready && typeof window !== 'undefined' && typeof window.__devNowMs === 'number') {
      if (!_devTimeWarned) {
        console.warn('[platform] dev: Platform.now() подменено window.__devNowMs =',
          new Date(window.__devNowMs).toISOString());
        _devTimeWarned = true;
      }
      return window.__devNowMs;
    }
    return Date.now();
  }

  /* ---------- Стики-баннер (задача Б) ----------
     Гарантированная рекламная поверхность: не зависит от гейта
     interstitial/rewarded в main.js и не требует показа по клику.
     layout_type:'resize' — клиент VK сам уменьшает область мини-аппа под
     баннер, вручную резервировать место в CSS не нужно.
     Params сверены по исходникам @vkontakte/vk-bridge
     (packages/core/src/types/data.ts): ShowBannerAdRequest.
     ПК-версия ВК (vk_platform=desktop_*) — БЕЗ баннера (решение основателя
     25.09). Вертикальный справа ({layout_type:'overlay', banner_align:
     'right', orientation:'vertical'}, по доке) живой ВК на ПК отклонял
     (b26/b28, адблок выключен) — ветку убрали целиком. */
  function isDesktop() {
    try {
      const p = new URLSearchParams(LAUNCH_SEARCH).get('vk_platform') || '';
      return p.indexOf('desktop_') === 0;   // desktop_web, desktop_web_messenger, desktop_app_messenger
    } catch (_) { return false; }
  }

  function asText(v) {
    try {
      const t = JSON.stringify(v);
      if (t && t !== '{}') return t;
    } catch (_) {}
    return (v && v.message) ? String(v.message) : String(v);
  }

  function showBanner(onInset) {
    if (!ready) {
      console.warn('[platform] dev: banner пропущен');
      return;
    }
    if (isDesktop()) {
      console.log('[platform] banner: ПК-версия — без баннера');
      return;
    }
    // b23 (решение основателя 13.09): баннер СНИЗУ на постоянной основе.
    // layout_type:'resize' — клиент сам ужимает окно; если клиент ответил
    // 'overlay', сообщаем main.js высоту баннера, чтобы экран отступил.
    vkBridge.send('VKWebAppShowBannerAd', {
      banner_location: 'bottom',
      layout_type: 'resize',
      height_type: 'compact',
      orientation: 'vertical',
    }).then((r) => {
      const overlay = !!(r && r.layout_type === 'overlay');
      const h = (overlay && typeof r.banner_height === 'number') ? r.banner_height : 0;
      console.log('[platform] banner: ' + asText(r) + ' → полоса снизу ' + h + 'px');
      if (typeof onInset === 'function') onInset(h);
    }).catch((e) => {
      console.warn('[platform] banner недоступен: ' + asText(e));
    });
  }

  /* ---------- Тактильный отклик (b24) ----------
     haptic(kind): 'select' | 'light' | 'medium' | 'success' | 'error';
     неизвестный kind — no-op. Fire-and-forget: возвращает undefined,
     никогда не бросает и не ждёт — промис моста гасится .catch.
     Taptic Engine ВК (типы сверены по packages/core/src/types/data.ts):
       'select'          → VKWebAppTapticSelectionChanged {}
       'light'/'medium'  → VKWebAppTapticImpactOccurred {style}
       'success'/'error' → VKWebAppTapticNotificationOccurred {type}
     Десктопный веб-ВК taptic не поддерживает и отвечает отказом — после
     ПЕРВОГО отказа выключаем taptic до конца сессии: слать заведомо
     отклоняемый запрос на каждую букву свайпа — шум в мосте и в логе.
     Dev-режим (!ready) — navigator.vibrate, как у Яндекса.
     'select' (шаг выделения по буквам) — не чаще раза в
     HAPTIC_SELECT_GAP_MS. Date.now() здесь не время удержания — now() не нужен. */
  const HAPTIC_SELECT_GAP_MS = 35;
  const HAPTIC_VIBRATE = {
    select: 6, light: 10, medium: 18,
    success: [14, 40, 22], error: [28, 30, 28],
  };
  let _hapticLastSelect = 0;
  let _tapticOff = false;
  function tapticFailed(e) {
    if (_tapticOff) return;   // лог — один раз, даже если отказов в полёте несколько
    _tapticOff = true;
    console.warn('[platform] taptic недоступен — тактильный отклик выключен до конца сессии:', e);
  }
  function haptic(kind) {
    try {
      if (!Object.prototype.hasOwnProperty.call(HAPTIC_VIBRATE, kind)) return;
      if (kind === 'select') {
        const t = Date.now();
        if (t - _hapticLastSelect < HAPTIC_SELECT_GAP_MS) return;
        _hapticLastSelect = t;
      }
      if (!ready) {
        if (typeof navigator !== 'undefined' && navigator && typeof navigator.vibrate === 'function') {
          navigator.vibrate(HAPTIC_VIBRATE[kind]);
        }
        return;
      }
      if (_tapticOff) return;
      let p;
      if (kind === 'select') {
        p = vkBridge.send('VKWebAppTapticSelectionChanged', {});
      } else if (kind === 'light' || kind === 'medium') {
        p = vkBridge.send('VKWebAppTapticImpactOccurred', { style: kind });
      } else {
        p = vkBridge.send('VKWebAppTapticNotificationOccurred', { type: kind });
      }
      if (p && typeof p.catch === 'function') p.catch(tapticFailed);
    } catch (e) {
      // синхронный сбой моста — тот же исход, что и отказ промиса
      if (ready) tapticFailed(e);
    }
  }

  /* ---------- Косметические покупки ----------
     Присутствуют в контракте про запас (см. заголовок файла) — эта сборка
     (задачи А+Б) их не вызывает, витрины нет. canPurchase() — платформенная
     возможность, а не проверка наличия конкретного товара (её нет в API).
     https://github.com/VKCOM/vk-bridge (packages/core/src/types/data.ts:
     OrderRequestOptions {type:'item', item}, статус 'cancel'|'success'|'fail'). */
  function canPurchase() { return true; }

  async function purchase(itemId) {
    if (!ready) {
      console.warn('[platform] dev: purchase → успех симулирован');
      return { success: true };
    }
    try {
      const res = await vkBridge.send('VKWebAppShowOrderBox', { type: 'item', item: itemId });
      return { success: res && res.status === 'success' };
    } catch (e) {
      console.warn('[platform] purchase недоступна:', e);
      return { success: false };
    }
  }

  function gameplayStart() {}
  function gameplayStop(_outcome) {}

  return {
    init, gameReady, getLang, isAvailable, isRewardedAvailable,
    save, load,
    showInterstitial, showRewarded, showInterstitialBonus, showBanner,
    now, haptic,
    canPurchase, purchase,
    gameplayStart, gameplayStop,
    SAVE_SIZE_GUARD_BYTES, AD_HANG_TIMEOUT_MS,
  };
})();
