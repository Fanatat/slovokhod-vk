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
     save(fullState)           → VKWebAppStorageSet {key, value}
     load()                    → VKWebAppStorageGet {keys:[KEY]} → keys[0].value
     showInterstitial          → VKWebAppShowNativeAds {ad_format:'interstitial'}
     showRewarded              → VKWebAppShowNativeAds {ad_format:'reward'}
                                 result.result === true → досмотрено
     showBanner()               → VKWebAppShowBannerAd {banner_location:'top', layout_type:'resize'}.
                                 Гарантированная поверхность (задача Б) — не завязана на гейт
                                 interstitial/rewarded, вызывается один раз при старте.
     canPurchase()/purchase()   → присутствуют в контракте (см. примечание выше), в этой
                                 сборке main.js их не вызывает.
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
     VKWebAppStorageSet — VK-серверное хранилище, изолировано от OK. */
  async function save(fullState) {
    if (!ready) {
      console.warn('[platform] dev-режим: сейв пропущен');
      return;
    }
    try {
      await vkBridge.send('VKWebAppStorageSet', {
        key:   STORAGE_KEY,
        value: JSON.stringify(fullState),
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
    canPurchase, purchase,
    gameplayStart, gameplayStop,
  };
})();
