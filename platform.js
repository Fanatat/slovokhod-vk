/* ============================================================
   platform.js — единственная точка контакта игры с платформой.

   В локальной разработке используется напрямую (= yandex-адаптер;
   без SDK деградирует в dev-режим). В сборке build.py заменяет этот
   файл адаптером нужной площадки (adapters/yandex.js или bridge.js).

   Контракт: init / gameReady / getLang / isAvailable /
             save / load / showInterstitial / showRewarded /
             gameplayStart / gameplayStop(outcome).

   Методы сверены с живой документацией Яндекса 2026-06-21 и
   подтверждены на платформе. Прошла 1-й этап модерации.
   ============================================================ */
window.Platform = (() => {
  let ysdk = null;
  let player = null;

  // Dev-фолбэк на localStorage (см. save/load ниже): активен ТОЛЬКО
  // когда ysdk === null. ysdk присваивается ровно в одном месте —
  // внутри init(), и только после успешного YaGames.init(). Значит
  // при живом SDK этот путь физически недостижим, не только "обычно
  // не срабатывает" (не завязано на getPlayer()/setData(), которые
  // могут временно упасть и у живого SDK).
  const DEV_SAVE_KEY = 'slovohod_dev_save_yandex';

  /* ---------- Инициализация ---------- */
  async function init() {
    if (typeof YaGames === 'undefined') {
      console.warn('[platform] SDK не найден — dev-режим');
      return false;
    }
    try {
      ysdk = await YaGames.init();
      console.log('[platform] SDK инициализирован');
      return true;
    } catch (e) {
      console.error('[platform] Ошибка init SDK:', e);
      return false;
    }
  }

  /* ---------- Game Ready (обязательно, п.1.19.2) ---------- */
  function gameReady() {
    if (ysdk && ysdk.features && ysdk.features.LoadingAPI) {
      ysdk.features.LoadingAPI.ready();
      console.log('[platform] Game Ready отправлен');
    }
  }

  /* ---------- Язык (п.2.14) ---------- */
  function getLang() {
    if (ysdk && ysdk.environment && ysdk.environment.i18n) {
      return ysdk.environment.i18n.lang || 'ru';
    }
    return (navigator.language || 'ru').slice(0, 2);
  }

  /* ---------- Доступность (dev-бейдж в main.js) ---------- */
  function isAvailable() { return ysdk !== null; }

  /* ---------- Rewarded-реклама доступна ----------
     У Яндекса нет API для проверки доступности rewarded ДО показа.
     Возвращаем true всегда: кнопка «Подсказка» видна; если реклама не подгрузится,
     SDK молча вернёт onError, и onResume восстановит игру без подсказки. */
  function isRewardedAvailable() { return true; }

  /* ---------- Сохранение (п.1.9 / 1.13.3) ----------
     Гостевой прогресс хранится платформой — логин не нужен.
     Лимит setData = 100 / 5 мин → сохраняем по событию.
     Объект сейва пишется ВСЕГДА ЦЕЛИКОМ. */
  async function getPlayerObj() {
    if (!ysdk) return null;
    if (!player) {
      try {
        player = await ysdk.getPlayer({ scopes: false });
      } catch (e) {
        console.error('[platform] getPlayer ошибка:', e);
      }
    }
    return player;
  }

  async function save(fullState) {
    if (!ysdk) {
      // Dev-режим: нет SDK вообще — фолбэк на localStorage, чтобы
      // «сохранил → перезагрузил» было проверяемо руками/автотестом локально.
      try {
        localStorage.setItem(DEV_SAVE_KEY, JSON.stringify(fullState));
      } catch (e) {
        console.warn('[platform] dev-режим: localStorage недоступен', e);
      }
      return;
    }
    const p = await getPlayerObj();
    if (!p) {
      console.warn('[platform] сейв пропущен: getPlayer недоступен', fullState);
      return;
    }
    try {
      await p.setData(fullState, true);
    } catch (e) {
      console.error('[platform] setData ошибка:', e);
    }
  }

  async function load() {
    if (!ysdk) {
      try {
        var raw = localStorage.getItem(DEV_SAVE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        console.warn('[platform] dev-режим: localStorage недоступен', e);
        return null;
      }
    }
    const p = await getPlayerObj();
    if (!p) return null;
    try {
      return await p.getData();
    } catch (e) {
      console.error('[platform] getData ошибка:', e);
      return null;
    }
  }

  /* ---------- Реклама (п.4.4 / 4.5 / 4.7) ----------
     onPause — вызывается при открытии рекламы (пауза звука/игры).
     onResume — вызывается при закрытии/ошибке (возобновление).
     onRewarded — вызывается только если видео досмотрено. */
  function showInterstitial(onPause, onResume) {
    if (!ysdk) {
      console.warn('[platform] dev: interstitial пропущен');
      if (onResume) onResume();
      return;
    }
    ysdk.adv.showFullscreenAdv({
      callbacks: {
        onOpen: () => { if (onPause) onPause(); },
        onClose: (wasShown) => { if (onResume) onResume(wasShown); },
        onError: (e) => { console.error('[platform] interstitial:', e); if (onResume) onResume(false); },
      },
    });
  }

  function showRewarded(onRewarded, onPause, onResume) {
    if (!ysdk) {
      console.warn('[platform] dev: rewarded → награда выдана');
      if (onRewarded) onRewarded();
      if (onResume) onResume();
      return;
    }
    let rewarded = false;
    ysdk.adv.showRewardedVideo({
      callbacks: {
        onOpen: () => { if (onPause) onPause(); },
        onRewarded: () => { rewarded = true; },
        onClose: () => {
          if (onResume) onResume();
          if (rewarded && onRewarded) onRewarded(); // видимый эффект — после закрытия
        },
        onError: (e) => { console.error('[platform] rewarded:', e); if (onResume) onResume(); },
      },
    });
  }

  /* ---------- Разметка геймплея (п.1.19.3) ----------
     У Яндекса опциональна; в действующих сборках не использовалась.
     gameplayStop(outcome): 'completed' | 'failed' | не задан. */
  function gameplayStart() {}
  function gameplayStop(outcome) {}

  return { init, gameReady, getLang, isAvailable, isRewardedAvailable, save, load, showInterstitial, showRewarded, gameplayStart, gameplayStop };
})();
