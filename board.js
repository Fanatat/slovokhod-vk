/* ============================================================
   Board — отрисовка поля + ввод + уведомления о прогрессе (Фаза 3).
   Ввод: старт из цели нажатия, движение на window, без захвата указателя.
   Сверка пути со словами (прямой/обратный порядок).
   При находке зовём handlers.onProgress(found, total); при сборе всех —
   handlers.onComplete(). Диагностическую строку убрали.
   ============================================================ */

window.Board = (function () {
  var boardEl = null;
  var wrapEl = null;
  var current = null;
  var handlers = {};

  var dragging = false;
  var path = [];
  var found = null;

  function init() {
    boardEl = document.getElementById('board');
    wrapEl = document.getElementById('board-wrap');
    window.addEventListener('resize', fit);
    boardEl.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function render(level, h) {
    current = level;
    handlers = h || {};
    found = {};
    path = [];
    dragging = false;

    boardEl.style.gridTemplateColumns = 'repeat(' + level.cols + ', 1fr)';
    boardEl.style.gridTemplateRows = 'repeat(' + level.rows + ', 1fr)';
    boardEl.innerHTML = '';

    var cellCount = level.rows * level.cols;
    var cascadeStep = Math.min(20, Math.floor(400 / cellCount));

    for (var r = 0; r < level.rows; r++) {
      for (var c = 0; c < level.cols; c++) {
        var i = r * level.cols + c;
        var cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.r = r;
        cell.dataset.c = c;
        cell.textContent = level.grid[i] || '';
        cell.style.animationDelay = (i * cascadeStep) + 'ms';
        boardEl.appendChild(cell);
      }
    }
    fit();
  }

  function fit() {
    if (!current || !wrapEl) return;
    var size = Math.min(wrapEl.clientWidth, wrapEl.clientHeight);
    var ratio = current.cols / current.rows;
    var w = size, h = size;
    if (ratio > 1) h = size / ratio;
    else if (ratio < 1) w = size * ratio;
    boardEl.style.width = Math.floor(w) + 'px';
    boardEl.style.height = Math.floor(h) + 'px';
  }

  function clear() {
    if (boardEl) boardEl.innerHTML = '';
    current = null;
    path = [];
    dragging = false;
  }

  /* ---------------- ВВОД ---------------- */

  function cellFromTarget(t) {
    if (t && t.closest) {
      var el = t.closest('.cell');
      if (el && boardEl.contains(el)) return el;
    }
    return null;
  }
  function cellFromPoint(x, y) {
    var el = document.elementFromPoint(x, y);
    if (el && el.classList && el.classList.contains('cell') && boardEl.contains(el)) return el;
    return null;
  }

  function onDown(e) {
    if (!current) return;
    var cell = cellFromTarget(e.target) || cellFromPoint(e.clientX, e.clientY);
    if (!cell) return;
    e.preventDefault();
    dragging = true;
    clearActive();
    path = [];
    // На уже найденной (зелёной) клетке путь не начинаем — она «израсходована».
    if (!cell.classList.contains('found')) addCell(cell);
  }
  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();
    var cell = cellFromPoint(e.clientX, e.clientY);
    if (cell) tryExtend(cell);
  }
  function onUp() {
    if (!dragging) return;
    dragging = false;
    var cells = path.map(function (p) { return p.el; });
    var matched = evaluate();
    if (!matched) {
      if (matched === false) removeActive(cells);     // верное слово, не по порядку — без красной
      else if (cells.length >= 2) flashWrong(cells); // бессмыслица → красная вспышка
      else removeActive(cells);                       // просто тап → тихо гасим
    }
    path = [];
  }

  // Красная вспышка + тряска на неверном пути, затем гасим.
  function flashWrong(cells) {
    for (var i = 0; i < cells.length; i++) {
      cells[i].classList.remove('active');
      cells[i].classList.add('wrong');
    }
    boardEl.classList.add('shake');
    setTimeout(function () {
      for (var j = 0; j < cells.length; j++) cells[j].classList.remove('wrong');
      boardEl.classList.remove('shake');
    }, 360);
    if (handlers.onWrong) handlers.onWrong();
  }

  function removeActive(cells) {
    for (var i = 0; i < cells.length; i++) cells[i].classList.remove('active');
  }

  function inPath(r, c) {
    for (var i = 0; i < path.length; i++) if (path[i].r === r && path[i].c === c) return i;
    return -1;
  }
  function addCell(cell) {
    path.push({ r: +cell.dataset.r, c: +cell.dataset.c, el: cell });
    cell.classList.add('active');
  }
  function tryExtend(cell) {
    // Найденные (зелёные) клетки непроходимы — нельзя пройти/заехать на них.
    if (cell.classList.contains('found')) return;
    var r = +cell.dataset.r, c = +cell.dataset.c;
    if (path.length === 0) { addCell(cell); return; }
    if (path.length >= 2) {
      var prev = path[path.length - 2];
      if (prev.r === r && prev.c === c) { path.pop().el.classList.remove('active'); return; }
    }
    if (inPath(r, c) !== -1) return;
    var tail = path[path.length - 1];
    if (Math.abs(tail.r - r) + Math.abs(tail.c - c) === 1) addCell(cell);
  }
  function clearActive() {
    var nodes = boardEl.querySelectorAll('.cell.active');
    for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove('active');
  }
  function samePath(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
    return true;
  }

  function evaluate() {
    if (!current || path.length < 2) return;
    var coords = path.map(function (p) { return [p.r, p.c]; });
    var rev = coords.slice().reverse();

    for (var i = 0; i < current.words.length; i++) {
      var w = current.words[i];
      if (found[w.word]) continue;
      if (samePath(coords, w.path) || samePath(rev, w.path)) {
        // Слово найдено на поле — спрашиваем main, принять ли его сейчас.
        if (handlers.isAccepted && !handlers.isAccepted(w.word)) {
          // Не по порядку: сообщаем main и возвращаем false (не null!),
          // чтобы onUp знал, что это «не та очередь», а не бессмыслица.
          if (handlers.onOutOfOrder) handlers.onOutOfOrder(w.word);
          return false;
        }
        found[w.word] = true;
        for (var k = 0; k < path.length; k++) {
          path[k].el.classList.remove('active');
          path[k].el.classList.remove('hint');   // снять янтарную подсказку
          path[k].el.classList.add('found');
        }
        var n = 0; for (var key in found) if (found.hasOwnProperty(key)) n++;
        var total = current.words.length;
        if (handlers.onProgress) handlers.onProgress(n, total);
        if (handlers.onFound) handlers.onFound(w.word);
        if (n >= total && handlers.onComplete) handlers.onComplete();
        return w.word;
      }
    }
    return null;
  }

  // Подсказка: подсветить первую ЕЩЁ НЕ подсвеченную букву.
  // targetWord (опц.) — целиться строго в это слово (текущее звено цепочки).
  // Без аргумента — старое поведение (любое ненайденное слово).
  // Повторные вызовы открывают следующие буквы. false — если открывать нечего.
  function revealHint(targetWord) {
    if (!current) return false;
    var startIdx = 0, endIdx = current.words.length;
    if (targetWord) {
      // Ищем индекс целевого слова — только его буквы будем открывать.
      for (var ti = 0; ti < current.words.length; ti++) {
        if (current.words[ti].word === targetWord) { startIdx = ti; endIdx = ti + 1; break; }
      }
    }
    for (var i = startIdx; i < endIdx; i++) {
      var w = current.words[i];
      if (found[w.word]) continue;
      for (var j = 0; j < w.path.length; j++) {
        var rc = w.path[j];
        var el = boardEl.querySelector('.cell[data-r="' + rc[0] + '"][data-c="' + rc[1] + '"]');
        if (el && !el.classList.contains('hint')) {
          el.classList.add('hint');
          return true;
        }
      }
    }
    return false;
  }

  // Мягкая подсказка: подсветить первую клетку нужного слова (~1.2с).
  function nudgeCurrent(word) {
    if (!current) return;
    var entry = null;
    for (var i = 0; i < current.words.length; i++) {
      if (current.words[i].word === word) { entry = current.words[i]; break; }
    }
    if (!entry || !entry.path || !entry.path.length) return;
    var rc = entry.path[0];
    var el = boardEl.querySelector('.cell[data-r="' + rc[0] + '"][data-c="' + rc[1] + '"]');
    if (!el) return;
    el.classList.add('nudge');
    setTimeout(function () { el.classList.remove('nudge'); }, 1200);
  }

  return { init: init, render: render, clear: clear, revealHint: revealHint, nudgeCurrent: nudgeCurrent };
})();
