/* ============================================================
   Sound — звук на Web Audio (без аудиофайлов, бандл остаётся крошечным).
   SFX: found (слово найдено), wrong (ошибка), win (победа).
   b24: step (буква в пути), combo (серия находок), star (звезда),
   chapter (глава пройдена), tap (кнопка). Все тоны идут через
   общую цепочку master-гейн → компрессор, чтобы наложения не клипали.
   Пауза: suspend/resume для рекламы (п.4.7) и сворачивания (п.1.3).
   Звук создаётся лениво и только после действия пользователя
   (политика автоплея браузеров).
   ============================================================ */

window.Sound = (function () {
  var ctx = null;
  var muted = false;
  var out = null;   // вход мастер-цепочки (или destination, если узлов нет)

  function ensure() {
    if (!ctx) {
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        ctx = AC ? new AC() : null;
      } catch (e) { ctx = null; }
      if (ctx) out = buildMaster(ctx);
    }
    return ctx;
  }

  // b24: мастер-гейн → компрессор → выход. Компрессор мягко прижимает
  // пики, когда тоны накладываются (серия + звёзды + фанфара).
  function buildMaster(c) {
    try {
      var m = c.createGain();
      m.gain.value = 0.9;
      var comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 12;
      comp.ratio.value = 4;
      comp.attack.value = 0.003;
      comp.release.value = 0.15;
      m.connect(comp); comp.connect(c.destination);
      return m;
    } catch (e) { return c.destination; }
  }

  // Вызывать по действию пользователя (нажатие), чтобы разрешить звук.
  function resumeContext() {
    var c = ensure();
    if (c && c.state === 'suspended') c.resume();
  }

  // Один тон. delay — сдвиг старта в секундах (планирование по часам
  // аудио точнее setTimeout), atk — атака (по умолчанию 10 мс).
  function beep(freq, dur, type, vol, delay, atk) {
    if (muted) return;
    var c = ensure();
    if (!c) return;
    if (c.state === 'suspended') c.resume();
    var t = c.currentTime + (delay || 0);
    var o = c.createOscillator();
    var g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol || 0.2, t + (atk || 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out || c.destination);
    o.start(t); o.stop(t + dur + 0.03);
  }

  // Частота ноты: n полутонов от C5.
  var C5 = 523.25;
  function note(n) { return C5 * Math.pow(2, n / 12); }

  function found() { beep(660, 0.12, 'triangle', 0.18); }
  // b20: золотое слово — два коротких восходящих тона поверх found().
  function gold() {
    beep(880, 0.08, 'triangle', 0.16);
    setTimeout(function () { beep(1320, 0.12, 'triangle', 0.16); }, 70);
  }
  function wrong() { beep(150, 0.18, 'sawtooth', 0.14); }
  function win() {
    beep(523, 0.12, 'triangle', 0.2);
    setTimeout(function () { beep(659, 0.12, 'triangle', 0.2); }, 120);
    setTimeout(function () { beep(784, 0.20, 'triangle', 0.2); }, 240);
  }

  // b24: буква добавлена в путь. Мажорная пентатоника от C5 вверх,
  // через октаву по кругу; потолок — две октавы (C7), дальше не растёт.
  var PENTA = [0, 2, 4, 7, 9];
  function step(i) {
    i = Math.max(0, Math.min(i | 0, 10));
    var n = Math.floor(i / 5) * 12 + PENTA[i % 5];
    beep(note(n), 0.07, 'triangle', 0.07, 0, 0.004);
  }

  // b24: серия быстрых находок (n ≥ 2) — яркое арпеджио из трёх нот
  // (мажорное трезвучие), корень поднимается на тон с каждой ступенью.
  function combo(n) {
    n = n | 0;
    if (n < 2) return;
    if (n > 6) n = 6;
    var root = (n - 2) * 2 + 7;          // от G5 вверх
    beep(note(root), 0.09, 'triangle', 0.12, 0, 0.005);
    beep(note(root + 4), 0.09, 'triangle', 0.12, 0.055, 0.005);
    beep(note(root + 7), 0.14, 'triangle', 0.12, 0.11, 0.005);
  }

  // b24: звёзды за уровень — колокольчики E6, G6, C7 (синус + тихий обертон
  // октавой выше, обертон гаснет быстрее — отсюда «звон»).
  var STARS = [16, 19, 24];
  function star(i) {
    var f = note(STARS[Math.max(0, Math.min(i | 0, 2))]);
    beep(f, 0.25, 'sine', 0.14, 0, 0.004);
    beep(f * 2, 0.15, 'sine', 0.035, 0, 0.004);
  }

  // b24: глава пройдена — фанфара C5 E5 G5 C6 и финальный аккорд (~0,9 с).
  function chapter() {
    beep(note(0), 0.12, 'triangle', 0.15, 0);
    beep(note(4), 0.12, 'triangle', 0.15, 0.1);
    beep(note(7), 0.12, 'triangle', 0.15, 0.2);
    beep(note(12), 0.18, 'triangle', 0.15, 0.3);
    beep(note(7), 0.4, 'triangle', 0.09, 0.5);
    beep(note(12), 0.4, 'triangle', 0.09, 0.5);
    beep(note(16), 0.4, 'triangle', 0.1, 0.5);
  }

  // b24: щелчок кнопки — едва слышный, ~30 мс.
  function tap() { beep(1200, 0.03, 'sine', 0.04, 0, 0.003); }

  // Пауза/возврат звука (реклама, сворачивание).
  function suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); }
  function resume() { if (!muted && ctx && ctx.state === 'suspended') ctx.resume(); }

  function setMuted(m) { muted = !!m; if (muted) suspend(); else resume(); }
  function isMuted() { return muted; }

  function init() {
    // Звук останавливается при сворачивании страницы (п.1.3).
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) suspend(); else resume();
    });
  }

  return {
    init: init, resumeContext: resumeContext,
    found: found, wrong: wrong, win: win, gold: gold,
    step: step, combo: combo, star: star, chapter: chapter, tap: tap,
    suspend: suspend, resume: resume,
    setMuted: setMuted, isMuted: isMuted,
  };
})();
