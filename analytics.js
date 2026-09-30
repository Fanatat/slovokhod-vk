/* ============================================================
   analytics.js — событийная аналитика в Яндекс Метрике (b25).
   Тонкая обёртка: игра зовёт Analytics.event(имя, параметры) и о
   результате не знает — вызов ничего не ждёт, никогда не бросает
   исключение и не меняет поведение игры. Порт эталона Color Sort
   (ТЗ №25), адаптирован к Словоходу.

   НОМЕР СЧЁТЧИКА — только здесь, в COUNTER_ID (одна строка). 0 — счётчик
   не задан: отправки нет нигде, build.py печатает громкое
   предупреждение, но сборку не роняет. Задать номер = поменять 0 на
   номер и пересобрать; build.py сверит, что номер доехал в сборку.

   Отправка включена ТОЛЬКО в сборке площадки: build.py подменяет
   плейсхолдер BUILD_PLATFORM (ниже) на 'vk' или 'yandex'. Из исходников
   плейсхолдер остаётся как есть — в сеть не уходит ничего, при ?debug=1
   события пишутся в консоль. Собранная игра на локальном адресе тоже
   молчит: localhost, 127.x, file:, частные сети 10.x / 192.168.x /
   172.16–31.x / 169.254.x, хосты *.local (сборка, открытая с телефона
   по LAN) — иначе каждый автотест и ручной прогон засорял бы счётчик.
   Тестовый хост games-dev (путь /games-dev/) шлёт с platform=dev, бой
   (любой другой адрес сборки) — vk или yandex.

   Скрипт Метрики грузится асинхронно и только по Analytics.start()
   (main.js зовёт его ПОСЛЕ Platform.gameReady()). События до загрузки
   копятся в очереди в памяти (не больше QUEUE_LIMIT, лишние
   отбрасываются) и уходят после загрузки скрипта. Не загрузился
   (адблок, нет сети) — очередь молча пропадает, дальше события
   отбрасываются до перезапуска.

   Персональные данные не отправляются. Ни ID пользователя площадки, ни
   имени, ни аватара игра сюда не передаёт. Но ВК кладёт параметры
   запуска (vk_user_id, sign и др.) прямо в адрес фрейма, а tag.js
   читает location.href и document.referrer не только в хите: запрос
   настроек, журнал ошибок, пререндер и ISP-синхронизация
   (settings.rt / tl2 — адрес уходит через фрейм match.html) берут их
   напрямую, мимо опций init. Поэтому, если отправка включена, start()
   ДО вставки tag.js:
     1) убирает из адреса фрейма sign, все vk_* (кроме vk_platform и
        vk_language — они не про игрока) и odr_enabled
        (history.replaceState; прочий query вроде debug=1 и hash
        остаются). Все читатели адреса в игре успевают раньше:
        vk-bridge.min.js и adapters/vk_bridge.js (vk_platform,
        vk_language — запомнены при загрузке адаптера), ?debug=1 здесь;
     2) подменяет document.referrer на его origin (адрес страницы
        площадки тоже может нести ID).
   Визит открывается вручную (defer + hit) с адресом без query и hash.
   Что доказано (acceptance_analytics.js С11/С12: настоящий tag.js в
   Chromium, ответы Метрики — локально, match.html — имитация его
   протокола): ни vk_user_id, ни sign нет ни в одном сетевом запросе
   прогона — хит, цели, служебные запросы и ISP-синхронизация rt и tl2
   (без правки rt и tl2 уносили полный адрес фрейма). Настоящий
   match.html, живой фрейм ВК и WebKit не проверялись. Параметры целей —
   только числа, строки и true/false; в reachGoal они вложены под имя
   цели.
   ============================================================ */
window.Analytics = (function () {
  var COUNTER_ID = 113113419;   // ← номер счётчика Метрики «Словоход» (завёл основатель 28.09). 0 = не задан, отправка выключена.
  var TAG_URL = 'https://mc.yandex.ru/metrika/tag.js';
  var QUEUE_LIMIT = 50;
  var BUILD_PLATFORM = 'vk';   // build.py → 'vk' | 'yandex'

  // Локальный запуск: свой компьютер, file:, частные сети (LAN, в т.ч.
  // сборка с телефона по адресу 192.168.x.x) и mDNS-хосты *.local.
  function isLocalRun() {
    try {
      var host = String(location.hostname || '').toLowerCase();
      if (!host || location.protocol === 'file:') return true;
      if (host === 'localhost' || /\.localhost$/.test(host) || /\.local$/.test(host)) return true;
      if (host.charAt(0) === '[' || host.indexOf(':') !== -1) {   // IPv6: ::1, fe80::/10, fc00::/7
        var h6 = host.replace(/^\[|\]$/g, '');
        return h6 === '::1' || /^fe[89ab][0-9a-f]:/.test(h6) || /^f[cd][0-9a-f]{2}:/.test(h6);
      }
      var m = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
      if (!m) return false;
      var a = Number(m[1]), b = Number(m[2]);
      return a === 127 || a === 10 || a === 0 ||
        (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
    } catch (e) { return true; }
  }

  // Тестовый хост games-dev — всегда 'dev', чтобы бой никогда не
  // смешался с проверками; бой dev не получает никогда.
  function detectPlatform() {
    try {
      if (location.pathname.indexOf('/games-dev/') !== -1) return 'dev';
    } catch (e) { return 'dev'; }
    return (BUILD_PLATFORM === 'vk' || BUILD_PLATFORM === 'yandex') ? BUILD_PLATFORM : 'dev';
  }

  // Почему отправка выключена ('' — включена). Текст — только для ?debug=1.
  var offReason = (function () {
    if (BUILD_PLATFORM !== 'vk' && BUILD_PLATFORM !== 'yandex') return 'запуск из исходников, не сборка';
    if (!(COUNTER_ID > 0)) return 'номер счётчика не задан (COUNTER_ID = 0)';
    if (isLocalRun()) return 'локальный запуск сборки';
    return '';
  })();
  var enabled = !offReason;

  var debug = (function () {
    try { return /(^|[?&])debug=1(&|$)/.test(location.search); } catch (e) { return false; }
  })();

  var state = 'idle';   // idle → loading → ready | failed; off — отправка выключена
  var queue = [];

  function log(kind, name, params) {
    try { if (debug) console.log('[analytics]', kind, name, params || {}); } catch (e) { /* молчим */ }
  }

  // Параметры запуска ВК в адресе фрейма: sign, все vk_*, odr_enabled.
  // Кроме vk_platform и vk_language: это не данные игрока, а без них
  // перезагруженный или восстановленный фрейм сломался бы — vk-bridge по
  // vk_platform=mobile_web выбирает канал сообщений, адаптер по ним берёт
  // язык и узнаёт ПК-версию (без баннера).
  var KEEP_PARAMS = { vk_platform: 1, vk_language: 1 };
  function isLaunchParam(key) {
    key = String(key).toLowerCase();
    if (KEEP_PARAMS[key] === 1) return false;
    return key === 'sign' || key === 'odr_enabled' || key.indexOf('vk_') === 0;
  }
  // Убрать параметры запуска из адреса фрейма — ДО вставки tag.js, он
  // читает location.href сам (см. шапку). Прочий query и hash остаются.
  // Адрес меняется, только если в нём было что убирать.
  function stripLaunchParams() {
    try {
      var search = location.search || '';
      if (search.length < 2) return;
      var parts = search.slice(1).split('&');
      var keep = [];
      var removed = 0;
      for (var i = 0; i < parts.length; i++) {
        if (!parts[i]) continue;
        var key = parts[i].split('=')[0];
        try { key = decodeURIComponent(key.replace(/\+/g, ' ')); } catch (e) { /* ключ как есть */ }
        if (isLaunchParam(key)) removed++;
        else keep.push(parts[i]);
      }
      if (!removed) return;
      history.replaceState(history.state, '',
        location.pathname + (keep.length ? '?' + keep.join('&') : '') + location.hash);
    } catch (e) { /* адрес не поменялся — хит и цели всё равно идут с очищенным url */ }
  }
  // document.referrer → только origin: ISP-синхронизация tag.js шлёт его
  // как есть (page-ref). Игра сама реферер не читает.
  function maskReferrer(ref) {
    try {
      if ((document.referrer || '') === ref) return;
      Object.defineProperty(document, 'referrer', { configurable: true, get: function () { return ref; } });
    } catch (e) { /* не вышло — init/hit всё равно несут урезанный реферер */ }
  }

  // Адрес страницы без query и hash: у ВК там vk_user_id и sign.
  function cleanUrl() {
    return location.protocol + '//' + location.host + location.pathname;
  }
  // Реферер — только origin: адрес страницы площадки тоже может нести ID.
  function cleanReferrer() {
    try {
      var m = /^(https?:\/\/[^\/?#]+)/.exec(document.referrer || '');
      return m ? m[1] + '/' : '';
    } catch (e) { return ''; }
  }

  // Только плоские примитивы — объект с чем-то лишним не уйдёт целиком.
  function cleanParams(params) {
    var out = null;
    if (!params || typeof params !== 'object') return out;
    for (var k in params) {
      if (!Object.prototype.hasOwnProperty.call(params, k)) continue;
      var v = params[k];
      var t = typeof v;
      if (t === 'number' ? isFinite(v) : (t === 'string' || t === 'boolean')) {
        out = out || {};
        out[k] = v;
      }
    }
    return out;
  }

  function ym() {
    try { window.ym.apply(null, arguments); } catch (e) { /* аналитика не роняет игру */ }
  }

  // Параметры цели вложены под её имя: {level_win: {level: 3, …}} — как
  // в эталоне Color Sort (доработка 27.09). Метрика складывает параметры
  // reachGoal в «Параметры визитов», и плоские ключи level/sec разных
  // целей (старт, победа, выход) слились бы там в одну ветку. Цель без
  // параметров уходит как есть; лог ?debug=1 остаётся плоским.
  function send(name, params) {
    if (params) {
      var o = {};
      o[name] = params;
      ym(COUNTER_ID, 'reachGoal', name, o);
    } else ym(COUNTER_ID, 'reachGoal', name);
  }

  function flush() {
    var pending = queue;
    queue = [];
    for (var i = 0; i < pending.length; i++) send(pending[i].name, pending[i].params);
  }

  function event(name, params) {
    try {
      var p = cleanParams(params);
      log(enabled ? 'event' : 'event (выкл: ' + offReason + ')', name, p);
      if (!enabled || state === 'failed') return;
      if (state === 'ready') { send(name, p); return; }
      if (queue.length < QUEUE_LIMIT) queue.push({ name: String(name), params: p });
    } catch (e) { /* аналитика не роняет игру */ }
  }

  // build — метка билда (window.BUILD), без неё визит несёт 'unknown'.
  function start(build) {
    try {
      if (state !== 'idle') return;
      var visitParams = { platform: detectPlatform(), build: String(build || 'unknown') };
      if (!enabled) {
        state = 'off';
        queue = [];
        log('start (выкл: ' + offReason + ')', 'визит', visitParams);
        return;
      }
      state = 'loading';
      var url = cleanUrl();
      var ref = cleanReferrer();
      // ДО вставки tag.js: параметры запуска — из адреса фрейма, реферер —
      // до origin (см. шапку). Только здесь, при включённой отправке:
      // из исходников и на localhost адрес не меняется.
      stripLaunchParams();
      maskReferrer(ref);
      // Стандартная заглушка Метрики: вызовы до загрузки копятся в ym.a.
      window.ym = window.ym || function () { (window.ym.a = window.ym.a || []).push(arguments); };
      window.ym.l = 1 * new Date();
      // defer: init не шлёт хит сам (иначе ушёл бы полный адрес фрейма) —
      // визит открывает ручной hit с очищенным адресом; параметры визита
      // (platform, build) при defer передаются именно в hit.
      ym(COUNTER_ID, 'init', {
        defer: true,
        url: url,
        referrer: ref,
        clickmap: false,
        trackLinks: false,
        accurateTrackBounce: true,
        webvisor: false,
      });
      ym(COUNTER_ID, 'hit', url, { referer: ref, title: document.title, params: visitParams });
      var s = document.createElement('script');
      s.async = true;
      s.src = TAG_URL;
      s.onload = function () {
        if (state !== 'loading') return;
        state = 'ready';
        flush();
      };
      s.onerror = function () {
        state = 'failed';
        queue = [];
        log('fail', 'скрипт Метрики не загрузился — аналитика выключена до перезапуска');
      };
      (document.head || document.documentElement).appendChild(s);
      log('start', 'визит', visitParams);
    } catch (e) {
      state = 'failed';
      queue = [];
    }
  }

  return {
    event: event,
    start: start,
    COUNTER_ID: COUNTER_ID,
    // Для приёмки и ?debug=1: включена ли отправка и с какой площадкой.
    info: function () { return { enabled: enabled, platform: detectPlatform(), state: state, queued: queue.length }; },
  };
})();
