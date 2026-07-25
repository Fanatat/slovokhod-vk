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

   Маппинг контракта v3:
     init()                    → VKWebAppInit + isEmbedded guard + 2.5s timeout
                                 + VKWebAppCheckNativeAds (доступность rewarded)
     gameReady()               → no-op (у VK нет аналога Yandex LoadingAPI)
     getLang()                 → URL-параметр vk_language или navigator.language
     isAvailable()             → флаг ready после успешного init
     isRewardedAvailable()     → VKWebAppCheckNativeAds {ad_format:'reward'} (кешируется при init).
                                 ТОЛЬКО для подписи кнопки (задача А, п.180) — кнопка подсказки
                                 в main.js больше НЕ прячется по этому флагу: сама проверка
                                 исторически ненадёжна (ложные false при adblock — известный баг
                                 VKWebAppCheckNativeAds, github.com/VKCOM/vk-bridge/issues/243),
                                 а при false подсказка выдаётся бесплатно без попытки показать ролик.
                                 dev-режим (!ready) → true (label "за рекламу" для тестирования)
     save(fullState)           → VKWebAppStorageSet {key, value}
     load()                    → VKWebAppStorageGet {keys:[KEY]} → keys[0].value
     showInterstitial          → VKWebAppShowNativeAds {ad_format:'interstitial'}
     showRewarded              → VKWebAppShowNativeAds {ad_format:'reward'}
                                 result.result === true → досмотрено
     showBanner()               → VKWebAppShowBannerAd {banner_location:'top', layout_type:'resize'}.
                                 Гарантированная поверхность (задача Б) — не завязана на гейт
                                 interstitial/rewarded, вызывается один раз при старте.
     canPurchase()              → true (платформенная поддержка ИНАП, задача В)
     purchase(itemId)           → VKWebAppShowOrderBox {type:'item', item:itemId}
                                 → {success: status==='success'}; товар настраивается в кабинете ВК
     gameplayStart/Stop        → no-op
   Доки/типы VK Bridge проверены по исходникам пакета:
   https://github.com/VKCOM/vk-bridge/blob/master/packages/core/src/types/data.ts
   ============================================================ */
window.Platform = (() => {
  const STORAGE_KEY   = 'filword_save';
  const INIT_TIMEOUT  = 2500;   // мс — после этого уходим в dev-режим
  // Сторож байтов перед записью (см. ЖЁСТКИЕ ОГРАНИЧЕНИЯ задачи Б/В):
  // известный баг VKWebAppStorageSet — JSON-значения обрезаются молча
  // на ~2236 байт вместо заявленных для строк 4096 (github.com/VKCOM/
  // vk-bridge/issues/226). Порог взят с запасом ниже задокументированного
  // сбоя: превышение — сейв целиком пропускается (не пишем усечённый
  // объект, который потом не распарсится при load()).
  const SAVE_BYTE_LIMIT = 2000;

  // Dev-фолбэк на localStorage (см. save/load ниже): активен ТОЛЬКО
  // когда ready === false. ready становится true ровно в одном месте —
  // внутри init(), и только после успешного vkBridge.send('VKWebAppInit').
  // При живом Bridge этот путь физически недостижим: та же переменная,
  // что гейтит showInterstitial/showRewarded/isAvailable() ниже.
  const DEV_SAVE_KEY = 'slovohod_dev_save_vk';

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
      // Dev-режим: нет живого Bridge — фолбэк на localStorage, чтобы
      // «сохранил → перезагрузил» было проверяемо на СОБРАННОМ архиве
      // (index.html открыт напрямую/standalone, без реального VK).
      try {
        localStorage.setItem(DEV_SAVE_KEY, JSON.stringify(fullState));
      } catch (e) {
        console.warn('[platform] dev-режим: localStorage недоступен', e);
      }
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
    if (!ready) {
      try {
        const raw = localStorage.getItem(DEV_SAVE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        console.warn('[platform] dev-режим: localStorage недоступен', e);
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
     https://dev.vk.com/bridge/VKWebAppShowBannerAd — params сверены по
     исходникам @vkontakte/vk-bridge (packages/core/src/types/data.ts). */
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

  /* ---------- Косметические покупки (задача В) ----------
     canPurchase() — платформенная возможность (эта площадка вообще умеет
     показывать VKWebAppShowOrderBox), а не проверка наличия конкретного
     товара в кабинете — её нет в API. Как и с isRewardedAvailable() выше,
     не пытаемся угадать доступность заранее: клик сам обнаружит отсутствие
     товара через status !== 'success' и даст безопасный фолбэк без краша.
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
      // Товара нет в кабинете / платежи не настроены / ошибка сети —
      // штатный фолбэк, НЕ бросаем исключение выше (main.js ждёт Promise).
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
