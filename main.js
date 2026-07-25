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
  var elConfirm = document.getElementById('confirm');
  var btnRestartYes = document.getElementById('btn-restart-yes');
  var btnRestartNo = document.getElementById('btn-restart-no');
  var elTutorial = document.getElementById('tutorial');
  var btnTutorialOk = document.getElementById('btn-tutorial-ok');
  var elWordList = document.getElementById('word-list');
  var elHowto = document.getElementById('howto');
  var elLevels = document.getElementById('levels');
  var levelsGrid = document.getElementById('levels-grid');
  var btnLevels = document.getElementById('btn-levels');
  var btnLevelsBack = document.getElementById('btn-levels-back');
  var lvTotal = document.getElementById('lv-total');
  var btnTheme = document.getElementById('btn-theme');
  var elThemeShop = document.getElementById('theme-shop');
  var themeShopStatus = document.getElementById('theme-shop-status');
  var btnThemeBuy = document.getElementById('btn-theme-buy');
  var btnThemeApply = document.getElementById('btn-theme-apply');
  var btnThemeRevert = document.getElementById('btn-theme-revert');
  var btnThemeClose = document.getElementById('btn-theme-close');

  var soundOn = true;
  var currentIndex = 0;  // индекс текущего уровня
  var savedIndex = null; // сохранённый прогресс для кнопки «Продолжить»
  var maxUnlocked = 0;   // максимальный открытый индекс уровня
  var records = { levels: {}, total: 0 }; // личные рекорды по уровням
  var levelScore = 0;    // очки текущего уровня
  var hintsUsed = 0;     // подсказки взяты в текущем уровне
  var tutorialShown = false; // туториал: показываем один раз за сессию
  var hintWord = null;   // текущее целевое слово для revealHint (= chain[chainPos])

  // Косметическая покупка (задача В, смена стандарта п.81): альт-палитра
  // «мятная бумага». Идентификатор товара — соответствует Item в кабинете ВК
  // (создаётся основателем, см. отчёт). Разблокировка витрины — после
  // прохождения THEME_UNLOCK_LEVEL уровней (нижняя граница диапазона 2-5).
  var THEME_ITEM_ID = 'slovohod_theme_mint';
  var THEME_UNLOCK_LEVEL = 3;
  var ownedThemeAlt = false;
  var activeTheme = 'default'; // 'default' | 'alt'

  // Гейт частоты interstitial (п.4.7): каждый 2-й уровень И не чаще раза
  // в 60 сек — оба условия обязательны. Это ЕДИНСТВЕННАЯ подтверждённая
  // защита от частых показов: наличие платформенного троттлинга
  // (Яндекс/VK) первоисточником НЕ подтверждено на 19.07.2026 — не
  // полагаться на него, пока не появится документальное подтверждение.
  // Было 3/90с — за 41 запуск на ВК 0 показов: короткие тестовые сессии,
  // видимо, не успевали набрать 3 уровня с 90с зазором. Сужено до 2/60с
  // (нижняя граница диапазона задачи Б) ради большего числа возможностей
  // показа; сама реклама остаётся необязательной (fill не гарантирован).
  var AD_LEVEL_GATE = 2;
  var AD_MIN_INTERVAL_MS = 60000;
  var levelsSinceAd = 0;
  var lastAdShownAt = 0;

  function showScreen(el) {
    var screens = document.querySelectorAll('.screen');
    for (var s = 0; s < screens.length; s++) screens[s].classList.remove('is-active');
    el.classList.add('is-active');
  }

  // Вид меню в зависимости от наличия прогресса.
  // Есть прогресс → «Продолжить» главная, «Играть» становится «Начать сначала» (вторичная).
  function setMenuProgress(has) {
    btnContinue.hidden = !has;
    btnContinue.className = 'btn ' + (has ? 'btn-primary' : 'btn-secondary');
    btnPlay.className = 'btn ' + (has ? 'btn-secondary' : 'btn-primary');
    btnPlay.textContent = has ? I18N.t('restart') : I18N.t('play');
  }

  // Подпись кнопки подсказки: обещает ролик только если реклама реально
  // доступна (п.180) — кнопка сама всегда видна, см. start().
  function updateHintLabel() {
    if (!btnHint) return;
    btnHint.textContent = I18N.t(Platform.isRewardedAvailable() ? 'hint' : 'hintFree');
  }

  // Применяет косметическую тему (или возвращает обычную «бумагу»).
  // CSS-переменные переопределены в style.css классом html.theme-alt.
  function applyTheme(theme) {
    activeTheme = theme;
    document.documentElement.classList.toggle('theme-alt', theme === 'alt');
  }

  // Текущее полное состояние прогресса — для целостного сейва (сейв ОБЪЕКТОМ
  // ЦЕЛИКОМ, ни одно поле не пишем частично).
  function saveState() {
    Platform.save({
      level: currentIndex,
      max: maxUnlocked,
      records: records,
      owned: { theme_alt: ownedThemeAlt },
      activeTheme: activeTheme,
    });
  }

  // Кнопка витрины видна только когда покупки поддерживает площадка (ВК)
  // И игрок прошёл достаточно уровней (задача В: разблокировка 2-5 уровней).
  function updateThemeButtonVisibility() {
    if (!btnTheme) return;
    btnTheme.hidden = !(Platform.canPurchase() && maxUnlocked >= THEME_UNLOCK_LEVEL);
  }

  // Состояние витрины: локальная подпись + какие кнопки показывать.
  function updateThemeShopUI() {
    if (!elThemeShop) return;
    if (ownedThemeAlt) {
      if (themeShopStatus) themeShopStatus.textContent = I18N.t('themeOwned');
      if (btnThemeBuy) btnThemeBuy.hidden = true;
      if (btnThemeApply)  btnThemeApply.hidden  = activeTheme === 'alt';
      if (btnThemeRevert) btnThemeRevert.hidden = activeTheme !== 'alt';
    } else {
      if (themeShopStatus) themeShopStatus.textContent = I18N.t('themeBuyHint');
      if (btnThemeBuy) btnThemeBuy.hidden = false;
      if (btnThemeApply)  btnThemeApply.hidden  = true;
      if (btnThemeRevert) btnThemeRevert.hidden = true;
    }
  }

  if (btnTheme) btnTheme.addEventListener('click', function () {
    Sound.resumeContext();
    updateThemeShopUI();
    elThemeShop.hidden = false;
  });

  if (btnThemeClose) btnThemeClose.addEventListener('click', function () {
    elThemeShop.hidden = true;
  });

  if (btnThemeBuy) btnThemeBuy.addEventListener('click', function () {
    btnThemeBuy.disabled = true;
    if (themeShopStatus) themeShopStatus.textContent = I18N.t('themePending');
    Platform.purchase(THEME_ITEM_ID).then(function (res) {
      btnThemeBuy.disabled = false;
      if (res && res.success) {
        ownedThemeAlt = true;
        applyTheme('alt');
        saveState();
        updateThemeShopUI(); // владение изменилось — переключить купить → применить/вернуть
      } else {
        // Отмена / нет товара в кабинете / ошибка сети — тихий фолбэк,
        // игра не падает (см. НЕ ДЕЛАТЬ / предусловие основателя в задаче В).
        // updateThemeShopUI() здесь НЕ зовём: она сбросила бы это сообщение
        // обратно на themeBuyHint, т.к. ownedThemeAlt всё ещё false.
        if (themeShopStatus) themeShopStatus.textContent = I18N.t('themeUnavailable');
      }
    });
  });

  if (btnThemeApply) btnThemeApply.addEventListener('click', function () {
    applyTheme('alt');
    saveState();
    updateThemeShopUI();
  });

  if (btnThemeRevert) btnThemeRevert.addEventListener('click', function () {
    applyTheme('default');
    saveState();
    updateThemeShopUI();
  });

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
    currentIndex = index;
    gameLevel.textContent = I18N.t('level') + ' ' + (index + 1);
    gameTheme.textContent = level.theme;
    gameCounter.textContent = '0 / ' + level.words.length;
    elWin.hidden = true;
    if (elHowto) elHowto.hidden = (index !== 0);
    showScreen(elGame);
    renderWordList(level);

    // Сохраняем прогресс (текущий уровень). Переживает обновление страницы (п.1.9).
    maxUnlocked = Math.max(maxUnlocked, index);
    saveState();
    // Держим «Продолжить» в актуальном состоянии в течение сессии.
    savedIndex = index;
    if (index > 0) setMenuProgress(true);

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
        saveState();
        updateThemeButtonVisibility();
        Sound.win();
        // Небольшая пауза, чтобы игрок увидел последнее слово, потом оверлей.
        setTimeout(function () {
          if (elWinTitle) elWinTitle.textContent = I18N.t('levelDone');
          btnNext.textContent = I18N.t('next');
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
    var currentTile = null;
    for (var i = 0; i < count; i++) {
      var tile = document.createElement('button');
      tile.className = 'lv-tile';
      if (i > maxUnlocked) {
        tile.classList.add('locked');
        tile.innerHTML = LOCK_SVG;
      } else {
        tile.textContent = i + 1;
        if (i === savedIndex) { tile.classList.add('current'); currentTile = tile; }
        // onclick, не addEventListener: плитки перерисовываются заново при
        // каждом renderLevels() (levelsGrid.innerHTML = '' выше) — onclick
        // просто перезатирается на новых элементах, дубли накопиться не могут.
        (function (idx) {
          tile.onclick = function () { openLevel(idx); };
        })(i);
      }
      levelsGrid.appendChild(tile);
    }
    // Текущий уровень должен быть виден сразу, без ручной прокрутки —
    // при 100 плитках он может быть далеко от начала сетки. Скроллим
    // ТОЛЬКО внутренний контейнер (levelsGrid), страница не двигается.
    if (currentTile) {
      currentTile.scrollIntoView({ block: 'center', inline: 'nearest' });
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
      // Кнопка подсказки НИКОГДА не прячется (смена стандарта п.180): при
      // adblock/отсутствии филла VKWebAppCheckNativeAds исторически ложно
      // сообщает "недоступно" даже когда реклама реально показывается —
      // прятать кнопку по этому сигналу нельзя. Подпись лишь не обещает
      // ролик, если реклама недоступна; сама подсказка в этом случае бесплатна.
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
        // Владение косметикой (задача В); старые сохранения без поля owned
        // не ломают игру — просто считаем тему некупленной.
        if (data && data.owned && data.owned.theme_alt === true) {
          ownedThemeAlt = true;
          applyTheme(data.activeTheme === 'alt' ? 'alt' : 'default');
        }
        updateThemeButtonVisibility();
      });
    });
  }

  // --- Обработчики меню ---

  btnPlay.addEventListener('click', function () {
    Sound.resumeContext();   // разрешаем звук по действию пользователя
    if (savedIndex != null && savedIndex > 0) {
      elConfirm.hidden = false;   // есть прогресс → спросить перед сбросом
    } else {
      openLevel(0);
    }
  });

  btnRestartYes.addEventListener('click', function () {
    elConfirm.hidden = true;
    savedIndex = null;
    setMenuProgress(false);
    openLevel(0);   // старт с 1-го уровня, сохранение перезапишется
  });

  btnRestartNo.addEventListener('click', function () {
    elConfirm.hidden = true;
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
    // Экран сначала показываем, ПОТОМ рендерим сетку: renderLevels() внутри
    // вызывает scrollIntoView() на текущей плитке, а на display:none
    // контейнере scrollIntoView не может посчитать позицию.
    showScreen(elLevels);
    renderLevels();
  });

  if (btnLevelsBack) btnLevelsBack.addEventListener('click', function () {
    showScreen(elMenu);
  });

  btnNext.addEventListener('click', function () {
    elWin.hidden = true;
    var next = currentIndex + 1;

    function proceed() {
      if (Levels.get(next)) {
        openLevel(next);
      } else {
        // Следующего уровня нет (пройден последний). Прогресс НЕ трогаем —
        // он уже сохранён в onComplete; «Продолжить» должен и дальше
        // открывать пройденный последний уровень.
        Board.clear();
        showScreen(elMenu);
      }
    }

    // Гейт частоты (п.4.7): каждый 3-й уровень И не чаще раза в 90 сек.
    levelsSinceAd++;
    var now = Date.now();
    var gateOk = levelsSinceAd >= AD_LEVEL_GATE && (now - lastAdShownAt) >= AD_MIN_INTERVAL_MS;

    if (!gateOk) {
      proceed();
      return;
    }

    levelsSinceAd = 0;
    lastAdShownAt = now;
    // Межуровневая реклама в логичной паузе (п.4.4). Частоту уже отфильтровал
    // гейт выше (AD_LEVEL_GATE/AD_MIN_INTERVAL_MS) — это единственная
    // подтверждённая защита, платформенный троттлинг не подтверждён.
    Platform.showInterstitial(
      function () { Sound.suspend(); },  // onPause (п.4.7)
      function () {                       // onResume
        Sound.resume();
        proceed();
      }
    );
  });

  // Подсказка за rewarded-видео (п.4.5): по желанию смотрим ролик → подсвечивается буква.
  // Если реклама недоступна (adblock/нет филла) — подсказка бесплатна (п.190),
  // ролик не пытаемся показывать вовсе: кнопка это уже честно не обещает.
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
