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
                                 + VKWebAppCheckNativeAds (доступность rewarded)
     gameReady()               → no-op (у VK нет аналога Yandex LoadingAPI)
     getLang()                 → URL-параметр vk_language или navigator.language
     isAvailable()             → флаг ready после успешного init
     isRewardedAvailable()     → VKWebAppCheckNativeAds {ad_format:'reward'} (кешируется при init).
                                 ТОЛЬКО для подписи кнопки (задача А, п.180) — main.js
                                 больше НЕ прячет кнопку подсказки по этому флагу: сама
                                 проверка исторически ненадёжна (ложные false при adblock —
                                 известный баг VKWebAppCheckNativeAds, github.com/VKCOM/
                                 vk-bridge/issues/243), а при false подсказка выдаётся
                                 бесплатно без попытки показать ролик.
                                 dev-режим (!ready) → true (label "за рекламу" для тестирования)
     save(fullState)           → VKWebAppStorageSet {key, value};
                                 dev-режим (!ready) → localStorage[slovohod_dev_save_vk]
     load()                    → VKWebAppStorageGet {keys:[KEY]} → keys[0].value;
                                 dev-режим (!ready) → localStorage[slovohod_dev_save_vk]
     showInterstitial          → VKWebAppShowNativeAds {ad_format:'interstitial'}
                                 + watchdog 40000мс, onResume(wasShown)
     showRewarded              → VKWebAppShowNativeAds {ad_format:'reward'}
                                 result.result === true → досмотрено, награда;
                                 result !== true → показан, но не досмотрен → БЕЗ награды;
                                 reject/таймаут → награда БЕСПЛАТНО (ЭТАП 2, п.1.1)
     showBanner(onInset)        → VKWebAppShowBannerAd {banner_location:'bottom', layout_type:'resize'};
                                  onInset(px) — сколько баннер перекрывает снизу (0 при resize).
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

  let ready = false;
  let rewardedAvailable = false;

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
      await withTimeout(vkBridge.send('VKWebAppInit'), INIT_TIMEOUT);
      ready = true;
      console.log('[platform] VK Bridge init OK');

      // Проверяем доступность rewarded-рекламы сразу при init, кешируем результат.
      // https://dev.vk.com/bridge/VKWebAppCheckNativeAds
      try {
        const check = await withTimeout(
          vkBridge.send('VKWebAppCheckNativeAds', { ad_format: 'reward' }),
          1500,
        );
        rewardedAvailable = check.result === true;
        console.log('[platform] rewarded доступен:', rewardedAvailable);
      } catch (e) {
        rewardedAvailable = false;
        console.warn('[platform] VKWebAppCheckNativeAds:', e.message || e);
      }
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
     VK передаёт vk_language в URL синхронно — не нужен async. */
  function getLang() {
    try {
      const p = new URLSearchParams(location.search);
      const l = p.get('vk_language');
      if (l) return l.slice(0, 2);
    } catch (_) {}
    return (navigator.language || 'ru').slice(0, 2);
  }

  /* ---------- Доступность ---------- */
  function isAvailable() { return ready; }

  /* ---------- Rewarded-реклама доступна ----------
     Кеш заполняется в init() через VKWebAppCheckNativeAds.
     В dev-режиме (!ready) возвращаем true: кнопка видна, подсказка выдаётся бесплатно. */
  function isRewardedAvailable() {
    if (!ready) return true;
    return rewardedAvailable;
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
      const res = await vkBridge.send('VKWebAppStorageGet', { keys: [STORAGE_KEY] });
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
  function showInterstitial(onPause, onResume) {
    if (!ready) {
      console.warn('[platform] dev: interstitial пропущен');
      if (onResume) onResume(false);
      return;
    }
    if (onPause) onPause();
    let settled = false;
    // Единая точка выхода: settle-once. Опоздавший ответ моста ПОСЛЕ
    // сработавшего таймаута не снимет паузу второй раз и не сдвинет
    // кулдаун гейта в main.js повторно.
    const finish = (wasShown, reason) => {
      if (settled) return;
      settled = true;
      console.log('[platform] interstitial завершён:', reason, '| показан:', wasShown);
      if (onResume) onResume(wasShown);
    };
    withTimeout(
      vkBridge.send('VKWebAppShowNativeAds', { ad_format: 'interstitial' }),
      AD_HANG_TIMEOUT_MS,
    )
      .then(() => finish(true, 'реклама закрыта (resolve)'))
      .catch((e) => {
        console.warn('[platform] interstitial недоступен/завис:', e);
        // wasShown=false — показ НЕ состоялся: main.js не двигает
        // кулдаун и счётчик гейта (см. ЭТАП 2, п.1.3).
        finish(false, 'ошибка/таймаут');
      });
  }

  /* Целевое правило рекламы (ЭТАП 2, п.1.1, стандарт студии, эталон
     Color Sort/vk_platform.js): удержание награды законно ТОЛЬКО при
     явном ответе площадки «ролик показан, но не досмотрен» — у ВК это
     УСПЕШНО разрешившийся промис с res.result !== true (осознанный
     отказ игрока). Все прочие пути — reject (нет филла, adblock,
     ошибка моста), таймаут, отсутствие SDK — выдают подсказку
     БЕСПЛАТНО: недоступная реклама не должна быть тупиком для игрока.
     Кнопка при этом не прячется, подпись ролик не обещает (main.js).
     Предпроверка isRewardedAvailable() остаётся первым эшелоном —
     здесь runtime-фолбэк на ФАКТИЧЕСКИЙ сбой показа. */
  function showRewarded(onRewarded, onPause, onResume) {
    if (!ready) {
      console.warn('[platform] dev: rewarded → награда выдана');
      if (onRewarded) onRewarded();
      if (onResume) onResume();
      return;
    }
    if (onPause) onPause();
    let settled = false;
    const finish = (grantReward, reason) => {
      if (settled) return;
      settled = true;
      // Видимый эффект — строго после onResume(), как в platform.js.
      if (onResume) onResume();
      console.log('[platform] rewarded завершён:', reason, '| награда:', grantReward);
      if (grantReward && onRewarded) onRewarded();
    };
    withTimeout(
      vkBridge.send('VKWebAppShowNativeAds', { ad_format: 'reward' }),
      AD_HANG_TIMEOUT_MS,
    )
      .then((res) => {
        if (res && res.result === true) {
          finish(true, 'ролик досмотрен (result=true)');
        } else {
          finish(false, 'ролик показан, но не досмотрен (result!=true) — награды нет');
        }
      })
      .catch((e) => {
        console.warn('[platform] rewarded недоступна/зависла — выдаём подсказку бесплатно:', e);
        finish(true, 'ошибка/таймаут — выдано бесплатно');
      });
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
     (packages/core/src/types/data.ts): ShowBannerAdRequest. */
  function showBanner(onInset) {
    if (!ready) {
      console.warn('[platform] dev: banner пропущен');
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
      console.log('[platform] banner: ' + JSON.stringify(r) + ' → полоса снизу ' + h + 'px');
      if (typeof onInset === 'function') onInset(h);
    }).catch((e) => {
      console.warn('[platform] banner недоступен:', e);
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
    showInterstitial, showRewarded, showBanner,
    now, haptic,
    canPurchase, purchase,
    gameplayStart, gameplayStop,
    SAVE_SIZE_GUARD_BYTES, AD_HANG_TIMEOUT_MS,
  };
})();
