/* ============================================================
   Sound — звуки на сэмплах (b25): короткие CC0-файлы Kenney через
   Web Audio. Синтеза (осцилляторов) в игре больше нет.

   ГДЕ ЧТО
   • assets/audio/manifest.json — какой файл у какого события, группа,
     громкость, случайный разброс, лимит одновременных копий, ступени
     высоты. Меняешь звук — правишь манифест, код ниже не трогаешь.
   • assets/audio/sfx/*.mp3 — обработанные файлы (tools/process_audio.py);
     в билд идут только они и манифест без альтернатив (build.py).
   • API для main.js прежний: init, resumeContext, found, wrong, win,
     gold, step(i), combo(n), star(i), chapter, tap, suspend, resume,
     setMuted, isMuted. b25 добавил order, hint, reward и громкости
     (setVolume/getVolume, getPrefs/setPrefs/defaults, onChange);
     status/ready/preview — для проверки и страницы audio-test.html.

   ЖИЗНЕННЫЙ ЦИКЛ
   1. init(): манифест и файлы грузятся сразу и декодируются в
      OfflineAudioContext — он не звучит и жеста не требует.
   2. Первый жест игрока (pointerup/touchend/mousedown/keydown/click)
      создаёт AudioContext и «будит» его тишиной в 1 сэмпл (iOS). До
      жеста звука нет вовсе — политика автоплея и правило игры.
   3. Любой сбой (файла нет, не декодировался, нет Web Audio) — игра
      идёт без этого звука; в консоль ровно ОДНО предупреждение на всё.

   МУЗЫКАЛЬНОСТЬ: step(i), star(i) и combo(n) не отдельные файлы, а сэмплы
   на разной высоте (playbackRate = 2^(полутоны/12)) — ступени и аккорды в
   манифесте (steps, arp.chords), строй — соль мажор. Мультисэмпл (roots):
   нота берётся с ближайшего по высоте файла, так что сдвиг невелик
   (сильный сдвиг вверх — «бурундук», audio_check требует ≤ +12).

   ВЫХОД: master → тон (фильтр из manifest.output) → подрезка громкости
   (output.gainDb) → лимитер. Числа — в манифесте, обоснование — в
   docs/audio/concept.md и CHANGELOG (b24 «не громче прежнего»).

   ПАУЗА: suspend/resume — реклама (п.4.7); visibilitychange —
   сворачивание (п.1.3); setMuted — кнопка ♪. Звук идёт, только если
   ничто из этого не мешает.
   ============================================================ */

window.Sound = (function () {
  'use strict';

  var DEFAULT_MANIFEST = 'assets/audio/manifest.json';
  // Громкости по умолчанию, 0..1. main.js пишет в сейв только отличия от
  // них (ключ au) — у игрока, который звук не трогал, сейв не растёт.
  var DEFAULTS = { master: 0.9, sfx: 1, ui: 1 };
  var BUSES = ['master', 'sfx', 'ui'];
  // Страховка к паддингу MP3: если декодер браузера (старый Safari) не
  // срезал задержку кодера, начало до первого сэмпла громче −50 dBFS
  // пропускается при старте. Больше 50 мс не режем — значит, так задумано.
  var LEAD_GATE = 0.00316;
  var LEAD_MAX = 0.05;
  var CUT_S = 0.04;           // плавное гашение прерванного звука, с
  // Только события, дающие браузеру «жест» (HTML: activation-triggering):
  // pointerdown у касаний жестом не считается — AudioContext из него
  // остался бы на паузе с предупреждением в консоли.
  var GESTURES = ['pointerup', 'touchend', 'mousedown', 'keydown', 'click'];

  var man = null;             // манифест
  var events = {};            // имя события → описание из манифеста
  var buffers = {};           // путь файла → AudioBuffer
  var leads = {};             // путь файла → сколько секунд тишины пропустить
  var pending = {};           // путь → ArrayBuffer, ждущий AudioContext (нет OfflineAudioContext
                              // или он не смог декодировать — повтор в настоящем контексте)
  var loading = {};           // путь → Promise загрузки
  var failed = [];            // «путь: причина» — для одного общего предупреждения
  var warned = false;
  var total = 0;              // сколько файлов заказано при init
  var state = 'idle';         // idle → loading → ready | partial | error
  var base = '';              // папка манифеста — от неё пути файлов
  var version = '';           // «?v=N» из адреса манифеста — тот же кеш-бастинг для файлов
  var readyPromise = null;

  var ctx = null;             // AudioContext — только после жеста
  var decoder = null;         // OfflineAudioContext — декодирование до жеста
  var noAudio = false;        // Web Audio нет или контекст не создался
  var bus = {};               // master / sfx / ui → GainNode
  var prefs = { muted: false, master: DEFAULTS.master, sfx: DEFAULTS.sfx, ui: DEFAULTS.ui };
  var held = false;           // реклама на экране (suspend … resume)
  var voices = [];            // звучащие копии: { src, gain, name, channel, cut }
  var rr = {};                // событие → номер следующего файла (файлы по кругу)
  var override = null;        // путь файла для preview() вместо основного
  var listeners = [];
  var hooked = false;

  function AC()  { return window.AudioContext || window.webkitAudioContext; }
  function OAC() { return window.OfflineAudioContext || window.webkitOfflineAudioContext; }
  function pageHidden() { return typeof document !== 'undefined' && !!document.hidden; }
  function canRun() { return !prefs.muted && !held && !pageHidden(); }
  function clamp01(v, d) {
    v = Number(v);
    return isFinite(v) ? Math.max(0, Math.min(1, v)) : d;
  }
  // Промисы resume/suspend/decode местами отклоняются (контекст закрыт,
  // жеста не было) — гасим, иначе «Uncaught (in promise)» в консоли.
  function quiet(p) { if (p && typeof p.then === 'function') p.then(null, function () {}); }

  function fail(msg) { failed.push(msg); }
  function warnOnce() {
    if (warned || !failed.length) return;
    warned = true;
    console.warn('[sound] часть звуков недоступна (' + failed.length +
      (total ? ' из ' + total : '') + ') — игра идёт без них: ' + failed.join('; '));
  }

  /* ---------- Загрузка ---------- */

  function manifestUrl(opt) {
    if (opt && opt.manifest) return opt.manifest;
    var m = document.querySelector && document.querySelector('meta[name="sfx-manifest"]');
    return (m && m.getAttribute('content')) || DEFAULT_MANIFEST;
  }

  function fetchOk(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r;
    });
  }

  // decodeAudioData: промис в новых браузерах, колбэки в старом Safari.
  function decodeWith(c, ab) {
    return new Promise(function (resolve, reject) {
      var done = false;
      function ok(b)  { if (!done) { done = true; resolve(b); } }
      function bad(e) { if (!done) { done = true; reject(e || new Error('не декодируется')); } }
      try {
        var p = c.decodeAudioData(ab, ok, bad);
        if (p && typeof p.then === 'function') p.then(ok, bad);
      } catch (e) { bad(e); }
    });
  }

  function getDecoder() {
    if (ctx) return ctx;
    if (decoder) return decoder;
    var O = OAC();
    if (!O) return null;
    try { decoder = new O(1, 1, 44100); } catch (e) { decoder = null; }
    return decoder;
  }

  function leadOf(b) {
    try {
      var d = b.getChannelData(0);
      var n = Math.min(d.length, Math.floor(b.sampleRate * LEAD_MAX));
      for (var i = 0; i < n; i++) if (d[i] > LEAD_GATE || d[i] < -LEAD_GATE) break;
      return i >= n ? 0 : Math.max(0, i / b.sampleRate - 0.001);
    } catch (e) { return 0; }
  }

  function keep(p, b) {
    buffers[p] = b;
    leads[p] = leadOf(b);
    return b;
  }

  function errText(e) { return (e && (e.message || e.name)) || String(e || 'ошибка'); }

  function loadFile(p) {
    if (buffers[p]) return Promise.resolve(buffers[p]);
    if (loading[p]) return loading[p];
    loading[p] = fetchOk(base + p + version).then(function (r) {
      return r.arrayBuffer();
    }).then(function (ab) {
      var d = getDecoder();
      if (!d) { pending[p] = ab; return null; }   // декодируем, когда появится AudioContext
      // decodeAudioData забирает (detach) переданный буфер — отдаём копию,
      // оригинал нужен для повтора.
      return decodeWith(d, ab.slice(0)).then(function (b) { return keep(p, b); }, function (e) {
        if (d === ctx) throw e;
        // OfflineAudioContext не справился (бывает в WebKit с частотой
        // файла ≠ частоте контекста) — повтор в настоящем AudioContext,
        // как у браузеров без OfflineAudioContext: сейчас, если он уже
        // есть, иначе после первого жеста (flushPending).
        pending[p] = ab;
        if (ctx) flushPending();
        return null;
      });
    }).then(null, function (e) {
      fail(p + ': ' + errText(e));
      return null;
    });
    return loading[p];
  }

  // Файлы, которые ждут настоящий AudioContext (жест): нет
  // OfflineAudioContext или он не декодировал файл.
  function flushPending() {
    Object.keys(pending).forEach(function (p) {
      var ab = pending[p];
      delete pending[p];
      decodeWith(ctx, ab).then(function (b) { keep(p, b); }, function (e) {
        fail(p + ': ' + errText(e));
        if (state !== 'loading') { state = 'partial'; warnOnce(); }
      });
    });
  }

  function eventFiles(ev, withAlternatives) {
    var out = (ev.files || []).slice();
    if (withAlternatives) {
      (ev.alternatives || []).forEach(function (a) { out = out.concat(a.files || []); });
    }
    return out;
  }

  /* init({ manifest?, alternatives? }) → Promise<boolean> (всё ли загрузилось).
     Игра зовёт без аргументов: адрес манифеста — из <meta name="sfx-manifest">,
     альтернативы не грузятся (их и нет в манифесте билда). */
  function init(opt) {
    if (readyPromise) return readyPromise;
    hook();
    var url = manifestUrl(opt);
    var q = url.indexOf('?');
    var path = q < 0 ? url : url.slice(0, q);
    version = q < 0 ? '' : url.slice(q);
    base = path.slice(0, path.lastIndexOf('/') + 1);
    state = 'loading';
    if (typeof fetch !== 'function') {
      fail('браузер без fetch');
      state = 'error';
      warnOnce();
      readyPromise = Promise.resolve(false);
      return readyPromise;
    }
    readyPromise = fetchOk(url).then(function (r) { return r.json(); }).then(function (m) {
      man = m || {};
      events = man.events || {};
      var files = [];
      Object.keys(events).forEach(function (name) {
        eventFiles(events[name], opt && opt.alternatives).forEach(function (f) {
          if (files.indexOf(f) < 0) files.push(f);
        });
      });
      total = files.length;
      return Promise.all(files.map(loadFile));
    }).then(function () {
      state = failed.length ? 'partial' : 'ready';
    }, function (e) {
      fail('manifest.json: ' + errText(e));
      state = 'error';
    }).then(function () {
      warnOnce();
      return state === 'ready';
    });
    return readyPromise;
  }

  function ready() { return readyPromise || init(); }

  /* ---------- Контекст и шины ---------- */

  function dbToGain(v) { return Math.pow(10, v / 20); }

  function buildGraph(c) {
    // Мягкий лимитер на выходе: одиночные звуки до него не доходят (пики
    // файлов ≤ −2 dBFS × громкость события × подрезка), он ловит только
    // наложения (победа + звёзды + глава).
    var lim = c.createDynamicsCompressor();
    lim.threshold.value = -4;
    lim.knee.value = 4;
    lim.ratio.value = 16;
    lim.attack.value = 0.002;
    lim.release.value = 0.12;
    lim.connect(c.destination);
    var out = (man && man.output) || {};
    // Подрезка: общий уровень игры (b24 «каждый звук не громче прежнего»).
    var trim = c.createGain();
    trim.gain.value = typeof out.gainDb === 'number' ? dbToGain(out.gainDb) : 1;
    trim.connect(lim);
    var head = trim;
    // Тон: мягкий срез верха (жалоба b24 «режут уши»); частота — выше
    // атаки пиццикато, см. concept.md.
    var tone = out.tone;
    if (tone && tone.type && tone.freq) {
      var f = c.createBiquadFilter();
      f.type = tone.type;
      f.frequency.value = tone.freq;
      if (typeof tone.q === 'number') f.Q.value = tone.q;
      if (typeof tone.gainDb === 'number') f.gain.value = tone.gainDb;
      f.connect(trim);
      head = f;
    }
    bus.master = c.createGain();
    bus.master.connect(head);
    bus.sfx = c.createGain();
    bus.sfx.connect(bus.master);
    bus.ui = c.createGain();
    bus.ui.connect(bus.master);
    BUSES.forEach(function (k) { bus[k].gain.value = prefs[k]; });
  }

  function ensure() {
    if (ctx || noAudio) return ctx;
    var A = AC();
    if (!A) {
      noAudio = true;
      fail('браузер без Web Audio');
      if (state !== 'loading') warnOnce();
      return null;
    }
    try { ctx = new A({ latencyHint: 'interactive' }); }
    catch (e) { try { ctx = new A(); } catch (e2) { ctx = null; } }
    if (!ctx) {
      noAudio = true;
      fail('AudioContext не создался');
      if (state !== 'loading') warnOnce();
      return null;
    }
    try { buildGraph(ctx); } catch (e) { bus = {}; }
    flushPending();
    // iOS: контекст оживает, только если в самом жесте что-то прозвучало.
    try {
      var s = ctx.createBufferSource();
      s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      s.connect(ctx.destination);
      s.start(0);
    } catch (e) { /* не критично */ }
    // Звук выключен (♪ из сейва) или идёт реклама: новый контекст сразу на
    // паузу — работающий вхолостую он держит аудиовыход телефона (батарея,
    // на iOS может глушить музыку игрока). Включение ♪ — тоже жест, resume
    // пройдёт.
    if (!canRun()) sleep();
    return ctx;
  }

  function wake() {
    if (ctx && canRun() && ctx.state !== 'running') quiet(ctx.resume());
  }
  function sleep() {
    if (ctx && ctx.state === 'running') quiet(ctx.suspend());
  }

  function onGesture() {
    if (!ctx && !ensure()) return;
    wake();   // iOS: «interrupted» после звонка/другого приложения — снова в работу
  }

  function hook() {
    if (hooked || typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
    hooked = true;
    GESTURES.forEach(function (t) {
      document.addEventListener(t, onGesture, { capture: true, passive: true });
    });
    // Сворачивание страницы (п.1.3): звук стоит, пока её не видно.
    document.addEventListener('visibilitychange', function () {
      if (pageHidden()) sleep(); else wake();
    });
  }

  // Вызывать из обработчика нажатия — разрешает звук сразу.
  function resumeContext() {
    if (ensure()) wake();
  }

  /* ---------- Голоса ---------- */

  function drop(v) {
    var i = voices.indexOf(v);
    if (i >= 0) voices.splice(i, 1);
    try { v.gain.disconnect(); } catch (e) { /* уже отключён */ }
  }

  function cut(v) {
    if (v.cut) return;
    v.cut = true;
    try {
      var now = ctx.currentTime;
      var g = v.gain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + CUT_S);
      v.src.stop(now + CUT_S + 0.01);
    } catch (e) { drop(v); }
  }

  function stopAll() { voices.slice().forEach(cut); }

  // Лимит копий события: новая гасит самую старую.
  function limitVoices(name, max) {
    var live = voices.filter(function (v) { return v.name === name && !v.cut; });
    for (var i = 0; i <= live.length - max; i++) cut(live[i]);
  }

  // Канал: новое событие плавно гасит ДРУГИЕ события канала
  // (комбо — найденное слово, глава — победу).
  function cutChannel(ch, name) {
    voices.forEach(function (v) {
      if (v.channel === ch && v.name !== name && !v.cut) cut(v);
    });
  }

  // Высота файла в полутонах от ref события (roots — параллельно files,
  // у альтернативы — свои roots); нет — 0 (файл записан на ref).
  function rootOf(ev, path) {
    var i = (ev.files || []).indexOf(path);
    if (i >= 0) return (ev.roots && typeof ev.roots[i] === 'number') ? ev.roots[i] : 0;
    var alts = ev.alternatives || [];
    for (var k = 0; k < alts.length; k++) {
      var j = (alts[k].files || []).indexOf(path);
      if (j >= 0) return (alts[k].roots && typeof alts[k].roots[j] === 'number') ? alts[k].roots[j] : 0;
    }
    return 0;
  }

  // Мультисэмпл: из загруженных файлов — ближайший по высоте к ноте semis
  // (при равенстве — верхний: вниз сдвиг звучит естественнее).
  function nearestFile(ev, semis) {
    var files = ev.files || [];
    var best = null, dist = Infinity;
    for (var i = 0; i < files.length; i++) {
      if (!buffers[files[i]]) continue;
      var d = Math.abs(semis - rootOf(ev, files[i]));
      if (d < dist || (d === dist && rootOf(ev, files[i]) > rootOf(ev, best))) { best = files[i]; dist = d; }
    }
    return best;
  }

  function pickFile(name, ev, semis) {
    if (override) return buffers[override] ? override : null;
    if (ev.roots) return nearestFile(ev, semis || 0);
    var files = ev.files || [];
    for (var k = 0; k < files.length; k++) {
      var i = ((rr[name] || 0) + k) % files.length;
      if (buffers[files[i]]) { rr[name] = i + 1; return files[i]; }
    }
    return null;
  }

  function jitter(x) { return x ? 1 + (Math.random() * 2 - 1) * x : 1; }

  // Одна нота события: semis — полутоны от ref события, at — сдвиг старта, с;
  // rate — общий для аккорда множитель разброса высоты (иначе свой у ноты).
  function voice(name, semis, at, rate) {
    var ev = events[name];
    if (!ev || !ctx || !bus.master || !canRun()) return false;
    var path = pickFile(name, ev, semis);
    if (!path) return false;
    var grp = man && man.groups && man.groups[ev.group];
    var out = (grp && bus[grp.bus]) || bus.sfx;
    var t = ctx.currentTime + (at || 0) + (ev.delay || 0);
    limitVoices(name, ev.maxInstances || 4);
    if (ev.channel) cutChannel(ev.channel, name);
    try {
      var src = ctx.createBufferSource();
      src.buffer = buffers[path];
      src.playbackRate.value = Math.pow(2, ((semis || 0) - rootOf(ev, path)) / 12) *
        (rate || jitter(ev.pitchVar));
      var gain = ctx.createGain();
      gain.gain.value = clamp01((ev.volume == null ? 1 : ev.volume) * jitter(ev.volVar), 1);
      src.connect(gain);
      gain.connect(out);
      var v = { src: src, gain: gain, name: name, channel: ev.channel || '', cut: false };
      src.onended = function () { drop(v); };
      src.start(t, leads[path] || 0);
      voices.push(v);   // после start: не стартовавший голос не повиснет в списке
      if (ctx.state !== 'running') wake();
      return true;
    } catch (e) { return false; }
  }

  function stepOf(name, i) {
    var st = events[name] && events[name].steps;
    if (!st || !st.length) return 0;
    i = i | 0;
    return st[Math.max(0, Math.min(i, st.length - 1))];
  }

  /* ---------- События игры ---------- */

  function found()   { voice('found'); }
  function wrong()   { voice('wrong'); }
  function win()     { voice('win'); }
  function gold()    { voice('gold'); }
  function chapter() { voice('chapter'); }
  function tap()     { voice('tap'); }
  function order()   { voice('order'); }
  function hint()    { voice('hint'); }
  function reward()  { voice('reward'); }
  // Буква в пути: ступени пентатоники вверх по номеру буквы.
  function step(i)   { voice('step', stepOf('step', i)); }
  // Звезда i (0..2): тоника, терция, квинта.
  function star(i)   { voice('star', stepOf('star', i)); }
  // Серия находок n ≥ 2: арпеджио трезвучий соль мажора (I, ii, iii, IV, I),
  // с каждой ступенью выше; дальше последнего — последнее. Разброс высоты
  // общий на аккорд: ноты не расходятся между собой.
  function combo(n) {
    var ev = events.combo;
    if (!ev) return;
    var a = ev.arp;
    if (!a || !a.chords || !a.chords.length) { voice('combo'); return; }
    var minN = a.minN || 2;
    n = n | 0;
    if (n < minN) return;
    var chord = a.chords[Math.min(n - minN, a.chords.length - 1)];
    var rate = jitter(ev.pitchVar);
    for (var k = 0; k < chord.length; k++) voice('combo', chord[k], (a.at && a.at[k]) || 0, rate);
  }

  var PATTERNS = { step: step, star: star, combo: combo };
  function trigger(name, arg) {
    if (PATTERNS[name]) PATTERNS[name](arg);
    else voice(name);
  }

  /* Прослушивание (audio-test.html): файл path — с параметрами события
     name (шина, громкость, ступени, арпеджио); файл догружается при
     необходимости. Основной файл мультисэмпла (есть в files при roots)
     звучит как в игре — ноту берёт ближайший файл. → Promise<boolean>
     (прозвучало ли). */
  function preview(path, name, arg) {
    resumeContext();
    return ready().then(function () { return loadFile(path); }).then(function (b) {
      var ev = events[name];
      if (!b || !ev) return false;
      override = (ev.roots && (ev.files || []).indexOf(path) >= 0) ? null : path;
      try { trigger(name, arg); } finally { override = null; }
      return true;
    });
  }

  /* ---------- Пауза и громкость ---------- */

  // Реклама: звук стоит до resume() (п.4.7).
  function suspend() { held = true; sleep(); }
  function resume()  { held = false; wake(); }

  function changed() {
    var p = getPrefs();
    listeners.forEach(function (fn) { fn(p); });
  }

  function applyMuted(m) {
    if (m === prefs.muted) return false;
    prefs.muted = m;
    if (m) { stopAll(); sleep(); } else wake();
    return true;
  }
  function setMuted(m) { if (applyMuted(!!m)) changed(); }
  function isMuted() { return prefs.muted; }

  function applyBus(k) {
    var g = bus[k];
    if (!g || !ctx) return;
    try { g.gain.setTargetAtTime(prefs[k], ctx.currentTime, 0.015); } catch (e) { g.gain.value = prefs[k]; }
  }
  // k: 'master' | 'sfx' | 'ui', v: 0..1.
  function setVolume(k, v) {
    if (BUSES.indexOf(k) < 0) return;
    v = clamp01(v, prefs[k]);
    if (v === prefs[k]) return;
    prefs[k] = v;
    applyBus(k);
    changed();
  }
  function getVolume(k) { return prefs[k]; }
  function getPrefs() { return { muted: prefs.muted, master: prefs.master, sfx: prefs.sfx, ui: prefs.ui }; }
  function defaults() { return { master: DEFAULTS.master, sfx: DEFAULTS.sfx, ui: DEFAULTS.ui }; }
  // Значения из сейва: onChange НЕ зовётся — записывать нечего, это и есть сейв.
  // Ключ есть, но значение не число 0..1 (null, мусор, 9) — громкость по
  // умолчанию, а не «прижатая» к краю: испорченный сейв не делает звук
  // максимальным или беззвучным.
  function setPrefs(p) {
    if (!p) return;
    BUSES.forEach(function (k) {
      if (!(k in p)) return;
      var v = p[k];
      prefs[k] = (typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1) ? v : DEFAULTS[k];
      applyBus(k);
    });
    if (typeof p.muted === 'boolean') applyMuted(p.muted);
  }
  function onChange(fn) { if (typeof fn === 'function') listeners.push(fn); }

  function status() {
    return {
      state: state,
      total: total,
      decoded: Object.keys(buffers).length,
      pending: Object.keys(pending).length,
      failed: failed.slice(),
      context: ctx ? ctx.state : 'none',
      sampleRate: ctx ? ctx.sampleRate : 0,
      voices: voices.length,
      muted: prefs.muted,
      held: held,
    };
  }
  // Сведения о загруженном файле (для audio-test.html) или null.
  function bufferInfo(path) {
    var b = buffers[path];
    return b ? { duration: b.duration, sampleRate: b.sampleRate, channels: b.numberOfChannels, lead: leads[path] || 0 } : null;
  }
  function manifest() { return man; }

  return {
    init: init, resumeContext: resumeContext,
    found: found, wrong: wrong, win: win, gold: gold,
    step: step, combo: combo, star: star, chapter: chapter, tap: tap,
    order: order, hint: hint, reward: reward,
    suspend: suspend, resume: resume,
    setMuted: setMuted, isMuted: isMuted,
    setVolume: setVolume, getVolume: getVolume,
    getPrefs: getPrefs, setPrefs: setPrefs, defaults: defaults, onChange: onChange,
    play: trigger, preview: preview, ready: ready, status: status,
    bufferInfo: bufferInfo, manifest: manifest,
  };
})();
