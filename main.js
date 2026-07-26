/* ============================================================
   main.js — запуск + навигация по экранам.
   Фаза 0: init SDK → язык → меню → Game Ready.
   Фаза 1: кнопка «Играть» открывает игровой экран и рисует поле уровня.
   ============================================================ */

(function () {
  var elLoading = document.getElementById('loading');
  var elMenu = document.getElementById('menu');
  var elGame = document.getElementById('game');
  var btnPlay = document.getElementById('btn-play');
  var btnContinue = document.getElementById('btn-continue');
  var btnSound = document.getElementById('btn-sound');
  var btnSoundGame = document.getElementById('btn-sound-game');
  var btnBack = document.getElementById('btn-back');
  var btnRestartLevel = document.getElementById('btn-restart-level');
  var devBadge = document.getElementById('dev-badge');
  var gameTheme = document.getElementById('game-theme');
  var gameLevel = document.getElementById('game-level');
  var gameCounter = document.getElementById('game-counter');
  var elWin = document.getElementById('win');
  var elWinTitle = elWin ? elWin.querySelector('.overlay-title') : null;
  var elWinScore = document.getElementById('win-score');
  var elWinBest  = document.getElementById('win-best');
  var elWinNew   = document.getElementById('win-new');
  var btnNext = document.getElementById('btn-next');
  var btnHint = document.getElementById('btn-hint');
  var elTutorial = document.getElementById('tutorial');
  var btnTutorialOk = document.getElementById('btn-tutorial-ok');
  var elWordList = document.getElementById('word-list');
  var elHowto = document.getElementById('howto');
  var elLevels = document.getElementById('levels');
  var levelsGrid = document.getElementById('levels-grid');
  var btnLevels = document.getElementById('btn-levels');
  var btnLevelsBack = document.getElementById('btn-levels-back');
  var lvTotal = document.getElementById('lv-total');
  var buildBadge = document.getElementById('build-badge');
  var elStore = document.getElementById('store');
  var btnStore = document.getElementById('btn-store');
  var btnStoreBack = document.getElementById('btn-store-back');
  var storePreviewMint = document.getElementById('store-preview-mint');
  var storeBuyMint = document.getElementById('store-buy-mint');
  var storeStatusMint = document.getElementById('store-status-mint');

  // Плашка номера билда (стандарт с 2026-07-25): текст ставим сразу, не
  // дожидаясь Platform.init() — это статическая метка сборки, не данные
  // платформы. window.BUILD подставляет build.py (маркер BUILD_INFO в
  // index.html); вне билда (локальная разработка) остаётся 'dev'.
  if (buildBadge) buildBadge.textContent = window.BUILD || 'dev';

  var soundOn = true;
  var currentIndex = 0;  // индекс текущего уровня
  var savedIndex = null; // сохранённый прогресс для кнопки «Продолжить»
  var maxUnlocked = 0;   // максимальный открытый индекс уровня
  var records = { levels: {}, total: 0 }; // личные рекорды по уровням
  var levelScore = 0;    // очки текущего уровня
  var hintsUsed = 0;     // подсказки взяты в текущем уровне
  var tutorialShown = false; // туториал: показываем один раз за сессию
  var hintWord = null;   // текущее целевое слово для revealHint (= chain[chainPos])

  // Косметика (задача 1, ИНАП «Мятная бумага»). Витрина открывается после
  // N пройденных уровней — ПРЕДЛОЖЕНО 3 (диапазон 2-5 из ТЗ), число не
  // подтверждено основателем, см. отчёт задачи.
  var STORE_UNLOCK_AFTER_LEVELS = 3;
  var MINT_ITEM_ID = 'slovohod_theme_mint';
  var owned = [];             // купленные темы, напр. ['mint']
  var activeTheme = 'default'; // применённая тема
  var previewingMint = false; // временное превью на экране магазина (не сохраняется)

  // Гейт частоты interstitial (задача Б, п.4.7; ослаблено 2026-07-26 —
  // тестер ВК увидел ролик 4 раза за 6 уровней на гейте «2-й/60с», это
  // раздражает): каждый 3-й уровень И не чаще раза в 120 сек — оба условия
  // обязательны. Гейт живёт в памяти сессии (не в сейве) — на новый запуск
  // игры счётчик сбрасывается.
  var AD_LEVEL_GATE = 3;
  var AD_MIN_INTERVAL_MS = 120000;
  var levelsSinceAd = 0;
  var lastAdShownAt = 0;

  // Сейв пишется ОБЪЕКТОМ ЦЕЛИКОМ (стандарт студии) — единая точка сборки,
  // чтобы owned/theme не потерялись, если забыть их в одном из мест записи.
  function buildSaveState(levelOverride) {
    var lvl = levelOverride != null ? levelOverride : currentIndex;
    return { level: lvl, max: maxUnlocked, records: records, owned: owned, theme: activeTheme };
  }

  // Применяет тему целиком (persisted) или временно (preview, persist=false).
  function applyTheme(name, persist) {
    if (name && name !== 'default') {
      document.documentElement.setAttribute('data-theme', name);
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    if (persist) activeTheme = name;
  }

  function updateStoreButtonVisibility() {
    if (!btnStore) return;
    btnStore.hidden = !(Platform.canPurchase() && maxUnlocked >= STORE_UNLOCK_AFTER_LEVELS);
  }

  function renderStore() {
    var isOwned = owned.indexOf('mint') !== -1;
    var isActive = activeTheme === 'mint';
    if (storeBuyMint) {
      storeBuyMint.disabled = isOwned && isActive;
      storeBuyMint.textContent = !isOwned ? I18N.t('buy') : I18N.t(isActive ? 'active' : 'activate');
    }
    if (storeStatusMint) { storeStatusMint.hidden = true; storeStatusMint.classList.remove('is-error'); }
  }

  function showScreen(el) {
    var screens = document.querySelectorAll('.screen');
    for (var s = 0; s < screens.length; s++) screens[s].classList.remove('is-active');
    el.classList.add('is-active');
  }

  // Вид меню в зависимости от наличия прогресса.
  // Есть прогресс → «Продолжить» главная, «Играть» скрыта («Начать сначала»
  // убрана из меню — свежий старт с 1-го уровня доступен через «Выбор уровня»).
  function setMenuProgress(has) {
    btnContinue.hidden = !has;
    btnPlay.hidden = has;
  }

  // Подпись кнопки подсказки: обещает ролик только если реклама реально
  // доступна (задача А, п.180) — кнопка сама всегда видна, см. start().
  function updateHintLabel() {
    if (!btnHint) return;
    btnHint.textContent = I18N.t(Platform.isRewardedAvailable() ? 'hint' : 'hintFree');
  }

  function renderWordList(level) {
    if (!elWordList) return;
    elWordList.innerHTML = '';
    var chain = (level.chain && level.chain.length) ? level.chain : level.words.map(function (w) { return w.word; });
    for (var i = 0; i < chain.length; i++) {
      if (i > 0) {
        var sep = document.createElement('span');
        sep.className = 'chain-sep';
        sep.textContent = '→';
        elWordList.appendChild(sep);
      }
      var span = document.createElement('span');
      span.className = 'word-chip' + (i === 0 ? ' current' : '');
      span.dataset.word = chain[i];
      span.textContent = chain[i];
      elWordList.appendChild(span);
    }
  }

  // Открыть уровень по индексу и нарисовать поле.
  function openLevel(index) {
    var level = Levels.get(index);
    if (!level) return;
    var isLast = !Levels.get(index + 1);
    currentIndex = index;
    // Знаменатель (общее число уровней) игроку НЕ показываем нигде во
    // внутриигровом UI (железный стандарт студии) — только «Уровень N».
    // Сетка выбора уровня — исключение, там числа это навигация, не обещание конца.
    gameLevel.textContent = I18N.t('level') + ' ' + (index + 1);
    gameTheme.textContent = level.theme;
    gameCounter.textContent = '0 / ' + level.words.length;
    elWin.hidden = true;
    if (elHowto) elHowto.hidden = (index !== 0);
    showScreen(elGame);
    renderWordList(level);

    // Сохраняем прогресс (текущий уровень). Переживает обновление страницы (п.1.9).
    maxUnlocked = Math.max(maxUnlocked, index);
    Platform.save(buildSaveState(index));
    // Держим «Продолжить» в актуальном состоянии в течение сессии.
    savedIndex = index;
    if (index > 0) setMenuProgress(true);
    updateStoreButtonVisibility();

    // Счёт и подсказки: сбрасываются при каждом открытии уровня.
    levelScore = 0;
    hintsUsed = 0;
    // Указатель цепочки: сбрасывается при каждом открытии уровня.
    var chainPos = 0;
    hintWord = (level.chain && level.chain.length) ? level.chain[0] : null;

    Board.render(level, {
      // Принять слово только если оно следующее в цепочке.
      // Если у уровня нет поля chain — принимаем любое (обратная совместимость).
      isAccepted: function (word) {
        if (!level.chain || !level.chain.length) return true;
        return word === level.chain[chainPos];
      },
      onProgress: function (n, total) {
        gameCounter.textContent = n + ' / ' + total;
        if (n < total) Sound.found();   // на последнем слове сыграет win
      },
      onFound: function (word) {
        levelScore += 100;
        if (level.chain && level.chain.length) chainPos++;
        hintWord = (level.chain && chainPos < level.chain.length) ? level.chain[chainPos] : null;
        if (elHowto) elHowto.hidden = true;
        // Пометить найденный чип: пых + зачёркнуть.
        var chip = document.querySelector('#word-list .word-chip[data-word="' + word + '"]');
        if (chip) { chip.classList.add('pop'); chip.classList.add('found'); chip.classList.remove('current'); }
        // Подсветить следующее слово в цепочке (CSS-transition плавно проявит рамку).
        if (level.chain && chainPos < level.chain.length) {
          var nextChip = document.querySelector('#word-list .word-chip[data-word="' + level.chain[chainPos] + '"]');
          if (nextChip) nextChip.classList.add('current');
        }
      },
      onComplete: function () {
        // Подсчёт очков за уровень.
        var finalScore = Math.max(0, levelScore + (hintsUsed === 0 ? 50 : 0) - hintsUsed * 25);
        var best = records.levels[index] || 0;
        var isNew = finalScore > best;
        if (isNew) records.levels[index] = finalScore;
        var tot = 0;
        for (var rk in records.levels) { if (records.levels.hasOwnProperty(rk)) tot += records.levels[rk]; }
        records.total = tot;
        // Разблокировать следующий уровень и сохранить.
        maxUnlocked = Math.min(Levels.count() - 1, Math.max(maxUnlocked, currentIndex + 1));
        Platform.save(buildSaveState());
        Sound.win();
        // Небольшая пауза, чтобы игрок увидел последнее слово, потом оверлей.
        setTimeout(function () {
          if (elWinTitle) elWinTitle.textContent = isLast ? I18N.t('allDone') : I18N.t('levelDone');
          btnNext.textContent = isLast ? I18N.t('toMenu') : I18N.t('next');
          if (elWinScore) elWinScore.textContent = I18N.t('score') + ': ' + finalScore;
          if (elWinBest)  elWinBest.textContent  = I18N.t('best')  + ': ' + Math.max(best, finalScore);
          if (elWinNew)   elWinNew.hidden = !isNew;
          elWin.hidden = false;
          popCard();
          confettiBurst();
        }, 450);
      },
      onWrong: function () { Sound.wrong(); },
      onOutOfOrder: function () {
        // Подсветить первую клетку нужного слова.
        if (level.chain && chainPos < level.chain.length) {
          Board.nudgeCurrent(level.chain[chainPos]);
        }
        // Пульс «сердцебиение» на текущем чипе.
        var hbChip = document.querySelector('#word-list .word-chip.current');
        if (hbChip) {
          hbChip.classList.remove('heartbeat');
          void hbChip.offsetWidth; // перезапуск анимации при повторных попытках
          hbChip.classList.add('heartbeat');
          var hbTimer = setTimeout(function () { hbChip.classList.remove('heartbeat'); }, 650);
          hbChip.addEventListener('animationend', function onEnd() {
            clearTimeout(hbTimer);
            hbChip.classList.remove('heartbeat');
            hbChip.removeEventListener('animationend', onEnd);
          });
        }
      },
    });

    // Туториал — только при первом старте сессии (нет сохранённого прогресса).
    if (index === 0 && !tutorialShown) {
      elTutorial.hidden = false;
    }
  }

  // Перезапуск анимации «поп» карточки победы.
  function popCard() {
    var card = elWin.querySelector('.overlay-card');
    if (!card) return;
    card.classList.remove('pop');
    void card.offsetWidth; // форсируем перезапуск анимации
    card.classList.add('pop');
  }

  // Небольшой салют на победе (отключается при prefers-reduced-motion).
  function confettiBurst() {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var colors = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#a855f7'];
    // убрать прошлые
    var old = elWin.querySelectorAll('.confetti');
    for (var k = 0; k < old.length; k++) old[k].remove();
    for (var i = 0; i < 40; i++) {
      var p = document.createElement('div');
      p.className = 'confetti';
      p.style.left = (4 + Math.random() * 92) + '%';
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * 0.5) + 's';
      p.style.setProperty('--fall-dur', (1.8 + Math.random() * 1.4).toFixed(2) + 's');
      elWin.appendChild(p);
    }
    setTimeout(function () {
      var c = elWin.querySelectorAll('.confetti');
      for (var j = 0; j < c.length; j++) c[j].remove();
    }, 3800);
  }

  var LOCK_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';

  function renderLevels() {
    if (!levelsGrid) return;
    levelsGrid.innerHTML = '';
    if (lvTotal) lvTotal.textContent = records.total > 0 ? 'Итого: ' + records.total : '';
    var count = Levels.count();
    for (var i = 0; i < count; i++) {
      var tile = document.createElement('button');
      tile.className = 'lv-tile';
      if (i > maxUnlocked) {
        tile.classList.add('locked');
        tile.innerHTML = LOCK_SVG;
      } else {
        tile.textContent = i + 1;
        if (i === savedIndex) tile.classList.add('current');
        (function (idx) {
          tile.addEventListener('click', function () { openLevel(idx); });
        })(i);
      }
      levelsGrid.appendChild(tile);
    }
  }

  function start() {
    Board.init();
    Sound.init();
    Platform.init().then(function () {
      // Язык: берём из платформы (или браузера в dev) и проставляем строки.
      I18N.pick(Platform.getLang());
      I18N.apply(document);

      if (!Platform.isAvailable() && devBadge) devBadge.hidden = false;
      // Кнопка подсказки НИКОГДА не прячется (задача А, смена стандарта
      // п.180): при adblock/отсутствии филла VKWebAppCheckNativeAds
      // исторически ложно сообщает "недоступно" даже когда реклама
      // реально показывается — прятать кнопку по этому сигналу нельзя.
      // Подпись лишь не обещает ролик, если реклама недоступна; сама
      // подсказка в этом случае бесплатна (см. обработчик клика ниже).
      updateHintLabel();

      showScreen(elMenu);

      // Game Ready — ровно сейчас: меню отрисовано и интерактивно.
      Platform.gameReady();

      // Стики-баннер (задача Б): гарантированная рекламная поверхность,
      // не зависящая от гейта interstitial/rewarded. No-op на площадках
      // без поддержки — метод обязан существовать в контракте у всех.
      Platform.showBanner();

      // Прогресс грузим параллельно, чтобы не задерживать Game Ready.
      Platform.load().then(function (data) {
        if (data && typeof data.level === 'number' && data.level > 0 && Levels.get(data.level)) {
          savedIndex = data.level;
          maxUnlocked = Math.max(data.max || 0, data.level || 0);
          setMenuProgress(true);
        }
        // Загружаем рекорды; старые сохранения без поля records не ломают игру.
        if (data && data.records && typeof data.records.levels === 'object') {
          records = { levels: data.records.levels, total: data.records.total || 0 };
        }
        // Миграция (задача 1, ИНАП): первое изменение структуры сейва за
        // спринт. Старый сейв (без owned/theme) должен подставить дефолты,
        // а не упасть — owned: [], theme: 'default'.
        owned = (data && Array.isArray(data.owned)) ? data.owned : [];
        activeTheme = (data && typeof data.theme === 'string') ? data.theme : 'default';
        applyTheme(activeTheme, true);
        updateStoreButtonVisibility();
      });
    });
  }

  // --- Обработчики меню ---

  // «Играть» видна только когда прогресса ещё нет (см. setMenuProgress) —
  // сброс-с-подтверждением убран из меню, свежий старт доступен через
  // «Выбор уровня» (клик по 1-му уровню).
  btnPlay.addEventListener('click', function () {
    Sound.resumeContext();   // разрешаем звук по действию пользователя
    openLevel(0);
  });

  btnBack.addEventListener('click', function () {
    Board.clear();
    showScreen(elMenu);
  });

  if (btnRestartLevel) btnRestartLevel.addEventListener('click', function () {
    openLevel(currentIndex);
  });

  if (btnLevels) btnLevels.addEventListener('click', function () {
    Sound.resumeContext();
    renderLevels();
    showScreen(elLevels);
  });

  if (btnLevelsBack) btnLevelsBack.addEventListener('click', function () {
    showScreen(elMenu);
  });

  // --- Магазин косметики (задача 1, ИНАП «Мятная бумага») ---

  if (btnStore) btnStore.addEventListener('click', function () {
    Sound.resumeContext();
    previewingMint = false;
    applyTheme(activeTheme, false); // на входе — актуальная тема, без превью
    renderStore();
    showScreen(elStore);
  });

  if (btnStoreBack) btnStoreBack.addEventListener('click', function () {
    previewingMint = false;
    applyTheme(activeTheme, false); // сброс превью, если не докупили
    showScreen(elMenu);
  });

  // Превью ДО покупки (п. ТЗ «Превью цветов ДО покупки»): временно
  // подсвечивает палитру, ничего не сохраняет и не покупает.
  if (storePreviewMint) storePreviewMint.addEventListener('click', function () {
    previewingMint = !previewingMint;
    applyTheme(previewingMint ? 'mint' : activeTheme, false);
  });

  if (storeBuyMint) storeBuyMint.addEventListener('click', function () {
    var isOwned = owned.indexOf('mint') !== -1;
    if (isOwned) {
      // Уже куплено — кнопка здесь просто переключает активную тему,
      // без обращения к серверу.
      previewingMint = false;
      activeTheme = 'mint';
      applyTheme('mint', true);
      Platform.save(buildSaveState());
      renderStore();
      return;
    }

    storeBuyMint.disabled = true;
    storeBuyMint.textContent = I18N.t('buying');
    if (storeStatusMint) storeStatusMint.hidden = true;

    Platform.purchase(MINT_ITEM_ID).then(function (res) {
      if (res && res.success) {
        if (owned.indexOf('mint') === -1) owned.push('mint');
        previewingMint = false;
        activeTheme = 'mint';
        applyTheme('mint', true);
        Platform.save(buildSaveState());
        renderStore();
      } else {
        renderStore();
        if (storeStatusMint) {
          storeStatusMint.hidden = false;
          storeStatusMint.classList.add('is-error');
          storeStatusMint.textContent = I18N.t(
            (res && res.error === 'server_unreachable') ? 'storeErrorServer' : 'storeErrorGeneric'
          );
        }
      }
    });
  });

  btnNext.addEventListener('click', function () {
    elWin.hidden = true;
    var next = currentIndex + 1;

    function proceed() {
      if (Levels.get(next)) {
        openLevel(next);
      } else {
        // Все уровни пройдены: сбрасываем прогресс и возвращаем в меню.
        savedIndex = null;
        Platform.save(buildSaveState(0));
        setMenuProgress(false);
        Board.clear();
        showScreen(elMenu);
      }
    }

    // Гейт частоты (задача Б, п.4.7): каждый 3-й уровень И не чаще раза
    // в 120 сек — оба условия обязательны. Раньше показ был безусловным
    // на каждый переход (SDK сам якобы соблюдает интервал) — за 41 запуск
    // на ВК это дало 0 показов рекламы; гейт даёт предсказуемые точки показа.
    levelsSinceAd++;
    var now = Date.now();
    var gateOk = levelsSinceAd >= AD_LEVEL_GATE && (now - lastAdShownAt) >= AD_MIN_INTERVAL_MS;

    if (!gateOk) {
      proceed();
      return;
    }

    levelsSinceAd = 0;
    lastAdShownAt = now;
    // Межуровневая реклама в логичной паузе (п.4.4); пауза/возобновление
    // звука на время показа (п.4.7).
    Platform.showInterstitial(
      function () { Sound.suspend(); },  // onPause
      function () {                       // onResume
        Sound.resume();
        proceed();
      }
    );
  });

  // Подсказка за rewarded-видео (п.4.5): по желанию смотрим ролик → подсвечивается буква.
  // Если реклама недоступна (adblock/нет филла) — подсказка бесплатна (п.190,
  // задача А), ролик не пытаемся показывать вовсе: кнопка это не обещает.
  btnHint.addEventListener('click', function () {
    Sound.resumeContext();
    if (!Platform.isRewardedAvailable()) {
      hintsUsed++;
      Board.revealHint(hintWord);
      return;
    }
    Platform.showRewarded(
      function () { hintsUsed++; Board.revealHint(hintWord); }, // onRewarded — chain[chainPos]
      function () { Sound.suspend(); },                  // onPause
      function () { Sound.resume(); }                    // onResume
    );
  });

  btnTutorialOk.addEventListener('click', function () {
    elTutorial.hidden = true;
    tutorialShown = true;
  });

  btnContinue.addEventListener('click', function () {
    Sound.resumeContext();
    if (savedIndex != null) openLevel(savedIndex);
  });

  function renderSound() {
    var muted = !soundOn;
    btnSound.classList.toggle('is-muted', muted);
    if (btnSoundGame) btnSoundGame.classList.toggle('is-muted', muted);
  }
  function toggleSound() {
    soundOn = !soundOn;
    renderSound();
    Sound.resumeContext();
    Sound.setMuted(!soundOn);
  }
  btnSound.addEventListener('click', toggleSound);
  if (btnSoundGame) btnSoundGame.addEventListener('click', toggleSound);

  // Подстраховка против контекстного меню по лонгтапу (п.1.6.1.8).
  document.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // Старт после полной загрузки DOM.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  // Мягкое свечение под курсором (тонкая «живость» фона). На телефоне почти
  // не проявляется; отключаем при настройке «меньше движения».
  if (!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    var gx = 0, gy = 0, raf = null;
    window.addEventListener('pointermove', function (e) {
      gx = e.clientX; gy = e.clientY;
      if (!raf) {
        raf = requestAnimationFrame(function () {
          raf = null;
          document.body.style.setProperty('--mx', gx + 'px');
          document.body.style.setProperty('--my', gy + 'px');
        });
      }
    });
  }
})();
