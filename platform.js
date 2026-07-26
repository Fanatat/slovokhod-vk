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

   Маппинг контракта v3 (задача Б добавила showBanner; задача 1/2 подключила
   витрину косметики «Мятная бумага» — canPurchase/purchase теперь реально
   вызываются из main.js):
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
     save(fullState)           → VKWebAppStorageSet {key, value}
     load()                    → VKWebAppStorageGet {keys:[KEY]} → keys[0].value
     showInterstitial          → VKWebAppShowNativeAds {ad_format:'interstitial'}
     showRewarded              → VKWebAppShowNativeAds {ad_format:'reward'}
                                 result.result === true → досмотрено
     showBanner()               → VKWebAppShowBannerAd {banner_location:'top', layout_type:'resize'}.
                                 Гарантированная поверхность (задача Б) — не завязана на гейт
                                 interstitial/rewarded, вызывается один раз при старте.
     canPurchase()/purchase()   → VKWebAppShowOrderBox {type:'item', item}; клиентский
                                 статус ('success') сверяется с GAME_CONFIG.vkOrderVerifyUrl
                                 (сервер получает уведомление ВК и подтверждает списание) —
                                 без сервера или при его недоступности покупка НЕ считается
                                 успешной (без ложного success), см. комментарий у purchase().
     gameplayStart/Stop        → no-op
   Доки/типы VK Bridge проверены по исходникам пакета:
   https://github.com/VKCOM/vk-bridge/blob/master/packages/core/src/types/data.ts
   ============================================================ */
window.Platform = (() => {
  const STORAGE_KEY   = 'filword_save';
  const INIT_TIMEOUT  = 2500;   // мс — после этого уходим в dev-режим

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

    const timeoutP = new Promise((_, rej) =>
      setTimeout(() => rej(new Error('timeout')), INIT_TIMEOUT),
    );

    try {
      await Promise.race([vkBridge.send('VKWebAppInit'), timeoutP]);
      ready = true;
      console.log('[platform] VK Bridge init OK');

      // Проверяем доступность rewarded-рекламы сразу при init, кешируем результат.
      // https://dev.vk.com/bridge/VKWebAppCheckNativeAds
      const checkTimeout = new Promise((_, rej) =>
        setTimeout(() => rej(new Error('timeout')), 1500),
      );
      try {
        const check = await Promise.race([
          vkBridge.send('VKWebAppCheckNativeAds', { ad_format: 'reward' }),
          checkTimeout,
        ]);
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
     VKWebAppStorageSet — VK-серверное хранилище, изолировано от OK.

     Сторож байтов (реинтродукция задачи 1: раньше был вырезан вместе с
     запаркованным ИНАП в a73863c — тогда порог был угадан по внешнему
     issue, без реального замера, и решили не тащить угаданное число на
     модерацию). Теперь замерено по факту (node, 2026-07-26): худший
     реалистичный сейв (100/100 уровней пройдены с рекордами + owned +
     theme) = 980 байт. Документированный лимит VKWebAppStorageSet — 4096
     байт, но по факту JSON-сериализованные объекты обрезаются на ~2236
     байт (github.com/VKCOM/vk-bridge/issues/226, подтверждено). Порог
     ниже взят с запасом ~60% ниже реального сбоя и вдвое выше нашего
     максимума — расти в этом проекте почти некуда (уровни статичны,
     records растёт линейно и уже посчитан на все 100). Превышение —
     сейв целиком пропускается (не пишем усечённый объект, который потом
     не распарсится при load()). */
  const SAVE_BYTE_LIMIT = 1600;

  async function save(fullState) {
    if (!ready) {
      console.warn('[platform] dev-режим: сейв пропущен');
      return;
    }
    const value = JSON.stringify(fullState);
    const bytes = new TextEncoder().encode(value).length;
    if (bytes > SAVE_BYTE_LIMIT) {
      console.error(
        '[platform] сейв превышает безопасный лимит VKWebAppStorageSet (' +
        bytes + ' > ' + SAVE_BYTE_LIMIT + ' байт) — запись ПРОПУЩЕНА целиком', fullState,
      );
      return;
    }
    try {
      await vkBridge.send('VKWebAppStorageSet', {
        key:   STORAGE_KEY,
        value: value,
      });
    } catch (e) {
      console.error('[platform] StorageSet ошибка:', e);
    }
  }

  async function load() {
    if (!ready) return null;
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
  async function showInterstitial(onPause, onResume) {
    if (!ready) {
      console.warn('[platform] dev: interstitial пропущен');
      if (onResume) onResume();
      return;
    }
    if (onPause) onPause();
    try {
      await vkBridge.send('VKWebAppShowNativeAds', { ad_format: 'interstitial' });
    } catch (e) {
      console.warn('[platform] interstitial недоступен:', e);
    }
    if (onResume) onResume();
  }

  async function showRewarded(onRewarded, onPause, onResume) {
    if (!ready) {
      console.warn('[platform] dev: rewarded → награда выдана');
      if (onRewarded) onRewarded();
      if (onResume) onResume();
      return;
    }
    if (onPause) onPause();
    try {
      const res = await vkBridge.send('VKWebAppShowNativeAds', { ad_format: 'reward' });
      if (onResume) onResume();
      if (res.result === true && onRewarded) onRewarded();
    } catch (e) {
      console.warn('[platform] rewarded недоступен:', e);
      if (onResume) onResume();
    }
  }

  /* ---------- Стики-баннер (задача Б) ----------
     Гарантированная рекламная поверхность: не зависит от гейта
     interstitial/rewarded в main.js и не требует показа по клику.
     layout_type:'resize' — клиент VK сам уменьшает область мини-аппа под
     баннер, вручную резервировать место в CSS не нужно.
     Params сверены по исходникам @vkontakte/vk-bridge
     (packages/core/src/types/data.ts): ShowBannerAdRequest. */
  function showBanner() {
    if (!ready) {
      console.warn('[platform] dev: banner пропущен');
      return;
    }
    vkBridge.send('VKWebAppShowBannerAd', {
      banner_location: 'top',
      layout_type: 'resize',
      height_type: 'compact',
      orientation: 'vertical',
    }).catch((e) => {
      console.warn('[platform] banner недоступен:', e);
    });
  }

  /* ---------- Косметические покупки (задача 1/2, ИНАП «Мятная бумага») ----------
     canPurchase() — платформенная возможность, а не проверка наличия
     конкретного товара (её нет в API).
     https://github.com/VKCOM/vk-bridge (packages/core/src/types/data.ts:
     OrderRequestOptions {type:'item', item}, статус 'cancel'|'success'|'fail').

     purchase(): VKWebAppShowOrderBox — статус в ответе СИНХРОННЫЙ и приходит
     с клиента, он НЕ подтверждает реальное списание (клиент подделываем).
     Реальное подтверждение — уведомление ВК на сервер разработчика
     (dev.vk.com/ru/api/payments/notifications), поэтому после успешного
     клиентского статуса дополнительно сверяемся с сервером через
     GAME_CONFIG.vkOrderVerifyUrl. Пусто/недоступен → покупка НЕ считается
     успешной (без ложного success), игрок видит понятную ошибку, игра не
     виснет — см. main.js (storeErrorServer). */
  function canPurchase() { return true; }

  async function purchase(itemId) {
    if (!ready) {
      console.warn('[platform] dev: purchase → успех симулирован (сервер не нужен в dev-режиме)');
      return { success: true };
    }

    let orderRes;
    try {
      orderRes = await vkBridge.send('VKWebAppShowOrderBox', { type: 'item', item: itemId });
    } catch (e) {
      console.warn('[platform] purchase: OrderBox отменён/ошибка:', e);
      return { success: false, error: 'order_failed' };
    }
    if (!orderRes || orderRes.status !== 'success') {
      return { success: false, error: 'order_' + ((orderRes && orderRes.status) || 'unknown') };
    }

    const verifyUrl = window.GAME_CONFIG && window.GAME_CONFIG.vkOrderVerifyUrl;
    if (!verifyUrl) {
      console.warn('[platform] purchase: сервер верификации не настроен (config.js пуст) — покупка НЕ подтверждена');
      return { success: false, error: 'server_unreachable' };
    }

    try {
      const timeoutP = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000));
      const resp = await Promise.race([
        fetch(verifyUrl + '?item=' + encodeURIComponent(itemId)),
        timeoutP,
      ]);
      if (!resp.ok) throw new Error('http ' + resp.status);
      const body = await resp.json();
      return { success: body && body.owned === true };
    } catch (e) {
      console.warn('[platform] purchase: сервер верификации недоступен:', e);
      return { success: false, error: 'server_unreachable' };
    }
  }

  function gameplayStart() {}
  function gameplayStop(_outcome) {}

  return {
    init, gameReady, getLang, isAvailable, isRewardedAvailable,
    save, load,
    showInterstitial, showRewarded, showBanner,
    canPurchase, purchase,
    gameplayStart, gameplayStop,
  };
})();
