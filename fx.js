/* ============================================================
   FX — лёгкий слой частиц на одном canvas поверх игры (b24).
   burst (искры в точке), confetti (дождь конфетти на победу),
   ring (расходящееся кольцо-волна), clear.
   Canvas создаётся лениво, клики сквозь него проходят
   (pointer-events: none). Цикл rAF крутится ТОЛЬКО пока есть
   живые частицы — в простое кадры не тратятся.
   prefers-reduced-motion: reduce → эффекты не показываются.
   Без 2D-контекста (старый браузер, тестовые шимы) — тихий no-op.
   ============================================================ */

window.FX = (function () {
  var MAX = 260;          // потолок живых частиц; лишние отбрасываются
  var DPR_CAP = 2;        // выше 2 разница не видна, а заливка дороже
  var DT_CAP = 0.05;      // шаг интеграции не больше 50 мс (после паузы вкладки)

  // Виды частиц.
  var K_SQUARE = 0, K_CIRCLE = 1, K_RING = 2, K_CONFETTI = 3;

  var BURST_COLORS = ['#f59e0b', '#fbbf24', '#3b82f6', '#22c55e', '#ffffff'];
  var CONFETTI_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#d9a441'];

  var canvas = null;
  var g = null;           // 2D-контекст
  var inited = false;
  var dpr = 1, W = 0, H = 0;
  var mq = null;          // MediaQueryList для reduced-motion

  // Пул частиц: объекты создаются один раз, живые — первые `live` штук.
  var pool = [];
  var live = 0;
  var running = false;
  var lastT = 0;
  var raf = null;

  function hasRaf() { return typeof window.requestAnimationFrame === 'function'; }

  function resize() {
    if (!canvas) return;
    dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    W = window.innerWidth || 0;
    H = window.innerHeight || 0;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
  }

  function init() {
    if (inited) return;
    inited = true;
    try {
      if (window.matchMedia) mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    } catch (e) { mq = null; }
    try {
      if (!document || !document.createElement || !document.body) { inited = false; return; }
      var c = document.createElement('canvas');
      if (!c || typeof c.getContext !== 'function') return;
      var ctx2d = c.getContext('2d');
      if (!ctx2d) return;
      c.id = 'fx-layer';
      c.setAttribute && c.setAttribute('aria-hidden', 'true');
      var s = c.style;
      if (s) {
        s.position = 'fixed';
        s.left = '0'; s.top = '0'; s.right = '0'; s.bottom = '0';
        s.width = '100%'; s.height = '100%';
        s.pointerEvents = 'none';
        s.zIndex = '55';
      }
      document.body.appendChild(c);
      canvas = c; g = ctx2d;
      for (var i = 0; i < MAX; i++) pool.push(newParticle());
      resize();
      if (window.addEventListener) window.addEventListener('resize', resize);
    } catch (e) { canvas = null; g = null; }
  }

  function newParticle() {
    return {
      k: 0, x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 1, size: 1,
      color: '#fff', rot: 0, vr: 0, grav: 0, drag: 0,
      ph: 0, amp: 0, freq: 0, r0: 0, r1: 0
    };
  }

  function reduced() {
    try { return !!(mq && mq.matches); } catch (e) { return false; }
  }

  function enabled() {
    if (!inited) init();
    return !!g && hasRaf() && !reduced();
  }

  // Взять свободную частицу из пула; null — потолок достигнут.
  function take() {
    if (live >= MAX) return null;
    var p = pool[live++];
    p.t = 0; p.rot = 0; p.vr = 0; p.ph = 0; p.amp = 0; p.freq = 0;
    return p;
  }

  function pick(arr, i) { return arr[i % arr.length]; }

  function burst(x, y, opts) {
    if (!enabled()) return;
    opts = opts || {};
    var n = opts.count != null ? opts.count : 12;
    var colors = opts.colors && opts.colors.length ? opts.colors : BURST_COLORS;
    var sp = opts.speed != null ? opts.speed : 1;
    var sz = opts.size != null ? opts.size : 1;
    var gr = opts.gravity != null ? opts.gravity : 1;
    for (var i = 0; i < n; i++) {
      var p = take();
      if (!p) break;
      var a = Math.random() * Math.PI * 2;
      var v = (140 + Math.random() * 220) * sp;
      p.k = Math.random() < 0.5 ? K_SQUARE : K_CIRCLE;
      p.x = x; p.y = y;
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v - 110 * sp;       // лёгкий уклон вверх
      p.life = 0.5 + Math.random() * 0.2;      // 500–700 мс
      p.size = (3 + Math.random() * 3) * sz;
      p.color = pick(colors, (Math.random() * colors.length) | 0);
      p.grav = 900 * gr;
      p.drag = 3.2;
      if (p.k === K_SQUARE) { p.rot = Math.random() * 6.28; p.vr = (Math.random() - 0.5) * 12; }
    }
    start();
  }

  function confetti(opts) {
    if (!enabled()) return;
    opts = opts || {};
    var n = opts.count != null ? opts.count : 90;
    var colors = opts.colors && opts.colors.length ? opts.colors : CONFETTI_COLORS;
    for (var i = 0; i < n; i++) {
      var p = take();
      if (!p) break;
      p.k = K_CONFETTI;
      p.x = Math.random() * W;
      p.y = -12 - Math.random() * H * 0.35;    // стартуют выше верхнего края
      p.vx = (Math.random() - 0.5) * 60;
      p.vy = 170 + Math.random() * 190;
      p.life = 2.5 + Math.random() * 0.5;      // 2,5–3 с
      p.size = 6 + Math.random() * 5;
      p.color = colors[i % colors.length];
      p.grav = 70;
      p.drag = 0.6;
      p.rot = Math.random() * 6.28;
      p.vr = (Math.random() - 0.5) * 8;
      p.ph = Math.random() * 6.28;             // покачивание (синус)
      p.amp = 10 + Math.random() * 18;
      p.freq = 2 + Math.random() * 3;
    }
    start();
  }

  function ring(x, y, opts) {
    if (!enabled()) return;
    opts = opts || {};
    var p = take();
    if (!p) return;
    p.k = K_RING;
    p.x = x; p.y = y; p.vx = 0; p.vy = 0;
    p.life = 0.35;
    p.color = opts.color || '#f59e0b';
    p.r1 = opts.radius != null ? opts.radius : 48;
    p.r0 = p.r1 * 0.2;
    p.size = 4;
    p.grav = 0; p.drag = 0;
    start();
  }

  function clear() {
    live = 0;
    stop();
    if (g && canvas) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  function start() {
    if (running || !live) return;
    running = true;
    lastT = 0;
    raf = window.requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    if (raf != null && window.cancelAnimationFrame) window.cancelAnimationFrame(raf);
    raf = null;
  }

  function frame(now) {
    if (!running) return;
    var dt = lastT ? (now - lastT) / 1000 : 1 / 60;
    lastT = now;
    if (dt > DT_CAP) dt = DT_CAP;
    if (dt < 0) dt = 0;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);

    var i = 0;
    while (i < live) {
      var p = pool[i];
      p.t += dt;
      if (p.t >= p.life) {
        // Умершую меняем местами с последней живой — без сдвигов массива.
        live--;
        pool[i] = pool[live];
        pool[live] = p;
        continue;
      }
      var damp = p.drag ? Math.exp(-p.drag * dt) : 1;
      p.vx *= damp; p.vy = p.vy * damp + p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
      draw(p);
      i++;
    }
    g.globalAlpha = 1;

    if (live > 0) raf = window.requestAnimationFrame(frame);
    else { running = false; raf = null; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); }
  }

  function draw(p) {
    var u = p.t / p.life;           // 0..1 прожитой жизни
    var s, c, sn;
    if (p.k === K_RING) {
      var e = 1 - (1 - u) * (1 - u) * (1 - u);   // ease-out
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.globalAlpha = 1 - u;
      g.strokeStyle = p.color;
      g.lineWidth = p.size * (1 - u) + 0.5;
      g.beginPath();
      g.arc(p.x, p.y, p.r0 + (p.r1 - p.r0) * e, 0, 6.2832);
      g.stroke();
      return;
    }
    if (p.k === K_CONFETTI) {
      // Гаснут только в последние 20% жизни.
      g.globalAlpha = u > 0.8 ? (1 - u) * 5 : 1;
      var x = p.x + Math.sin(p.t * p.freq + p.ph) * p.amp;
      c = Math.cos(p.rot); sn = Math.sin(p.rot);
      // «Переворот» листочка: высота пульсирует через косинус.
      var flip = Math.cos(p.t * p.freq * 1.7 + p.ph);
      g.setTransform(dpr * c, dpr * sn, -dpr * sn * flip, dpr * c * flip, dpr * x, dpr * p.y);
      g.fillStyle = p.color;
      g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      return;
    }
    // Искры: гаснут и чуть уменьшаются к концу.
    g.globalAlpha = 1 - u * u;
    g.fillStyle = p.color;
    s = p.size * (1 - u * 0.4);
    if (p.k === K_SQUARE) {
      c = Math.cos(p.rot); sn = Math.sin(p.rot);
      g.setTransform(dpr * c, dpr * sn, -dpr * sn, dpr * c, dpr * p.x, dpr * p.y);
      g.fillRect(-s / 2, -s / 2, s, s);
    } else {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.beginPath();
      g.arc(p.x, p.y, s / 2, 0, 6.2832);
      g.fill();
    }
  }

  return { init: init, enabled: enabled, burst: burst, confetti: confetti, ring: ring, clear: clear };
})();
