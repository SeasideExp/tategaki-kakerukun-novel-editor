/**
 * 縦書き同人小説書けるくん - Main Application Controller
 */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'tategaki_doujin_novel_editor_v1';

  const App = {
    settings: null,
    pages: [],
    activePageIndex: 0,
    selectedPageIds: [],
    customFontBytes: null,
    customFontName: '',
    customFontSeq: 0,
    dragSourceIndex: null,
    renderTimer: null,
    currentRenderedSectionStart: -1,
    isComposingIme: false,
    undoStack: [],
    typingUndoTimer: null,
    hasPendingTypingUndo: false,
    searchQuery: '',
    searchMatches: [],
    searchCurrentIndex: -1,
    isSearchSelectionActive: false,
    timeBarInterval: null
  };

  function init() {
    loadFromLocalStorage();
    bindSidebarTabs();
    bindUiCollapseAndThemeControls();
    bindSettingsInputs();
    bindEditorControls();
    bindPreviewControls();
    bindFileAndExportActions();
    syncSettingsToInputs();
    updateHeaderTimeAndDeadlineBar();
    if (App.timeBarInterval) clearInterval(App.timeBarInterval);
    App.timeBarInterval = setInterval(updateHeaderTimeAndDeadlineBar, 10000);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        scheduleRender();
      });
    }
    renderAll();
  }

  function isLegacyUnmodifiedSample(pages, savedVersion) {
    if (!Array.isArray(pages) || pages.length === 0) return false;
    const p1 = pages[0];
    if (
      p1 &&
      p1.type === 'tobira' &&
      p1.tobiraData &&
      p1.tobiraData.title === '星降る夜の組版工房'
    ) {
      return true;
    }
    return false;
  }

  function loadFromLocalStorage() {
    const defaults = global.TategakiState.createDefaultSettings();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.settings && Array.isArray(parsed.pages) && parsed.pages.length > 0) {
          App.settings = Object.assign({}, defaults, parsed.settings);
          App.settings.typography = Object.assign(
            {},
            defaults.typography,
            parsed.settings.typography || {}
          );
          App.settings.typography.body = Object.assign(
            {},
            defaults.typography.body,
            (parsed.settings.typography && parsed.settings.typography.body) || {}
          );
          App.settings.typography.tobira = Object.assign(
            {},
            defaults.typography.tobira,
            (parsed.settings.typography && parsed.settings.typography.tobira) || {}
          );
          App.settings.typography.toc = Object.assign(
            {},
            defaults.typography.toc,
            (parsed.settings.typography && parsed.settings.typography.toc) || {}
          );
          App.settings.typography.nombre = Object.assign(
            {},
            defaults.typography.nombre,
            (parsed.settings.typography && parsed.settings.typography.nombre) || {}
          );
          App.settings.typography.nombreComment = Object.assign(
            {},
            defaults.typography.nombreComment,
            (parsed.settings.typography && parsed.settings.typography.nombreComment) || {}
          );
          App.settings.rules = Object.assign({}, defaults.rules, parsed.settings.rules || {});
          App.settings.headerFooter = Object.assign(
            {},
            defaults.headerFooter,
            parsed.settings.headerFooter || {}
          );
          App.settings.view = Object.assign({}, defaults.view, parsed.settings.view || {});
          App.settings.ui = Object.assign({}, defaults.ui, parsed.settings.ui || {});
          App.settings.ui.gaugeColors = Object.assign(
            {},
            defaults.ui.gaugeColors,
            (parsed.settings.ui && parsed.settings.ui.gaugeColors) || {}
          );
          App.settings.ui.deadline = Object.assign(
            {},
            defaults.ui.deadline,
            (parsed.settings.ui && parsed.settings.ui.deadline) || {}
          );
          App.settings.ui.shortcuts = Object.assign(
            {},
            defaults.ui.shortcuts,
            (parsed.settings.ui && parsed.settings.ui.shortcuts) || {}
          );
          App.settings.ui.headerDisplay = Object.assign(
            {},
            defaults.ui.headerDisplay,
            (parsed.settings.ui && parsed.settings.ui.headerDisplay) || {}
          );
          // 旧設定値 'odd-left-even-right' の場合は新デフォルト 'pair-rtl'（右綴じ見開き）に更新
          if (App.settings.view.spreadPairing === 'odd-left-even-right' || !App.settings.view.spreadPairing) {
            App.settings.view.spreadPairing = 'pair-rtl';
          }
          if (isLegacyUnmodifiedSample(parsed.pages, parsed.appVersion)) {
            App.pages = global.TategakiState.createSamplePages();
            repaginateAllLinkedSections({ fromPageContents: true });
          } else {
            App.pages = parsed.pages;
            repaginateAllLinkedSections();
          }
          App.selectedPageIds = [];
          return;
        }
      }
    } catch (e) {
      console.warn('LocalStorage読込スキップ:', e);
    }
    App.settings = defaults;
    App.pages = global.TategakiState.createSamplePages();
    repaginateAllLinkedSections({ fromPageContents: true });
    App.selectedPageIds = [];
  }

  function saveToLocalStorage() {
    try {
      const cleanPages = App.pages.map(function (p) {
        const copy = Object.assign({}, p);
        delete copy._precomputedLines;
        return copy;
      });
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          appVersion: (global.TategakiState && global.TategakiState.APP_VERSION) || '1.00',
          settings: App.settings,
          pages: cleanPages
        })
      );
    } catch (e) {
      console.warn('LocalStorage保存スキップ:', e);
    }
  }

  function showToast(message, isError) {
    const el = document.getElementById('status-toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'status-toast visible ' + (isError ? 'error' : 'info');
    clearTimeout(App.toastTimer);
    App.toastTimer = setTimeout(function () {
      el.className = 'status-toast';
    }, 3200);
  }

  // =========================================================================
  // サイドバータブ切り替え ＆ 左右・下部折り畳み ＆ UI色調設定
  // =========================================================================
  function activateSidebarTab(targetTabId) {
    const tabBtns = document.querySelectorAll('.sidebar-tab-btn');
    const tabPanels = document.querySelectorAll('.sidebar-tab-panel');
    tabBtns.forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === targetTabId);
    });
    tabPanels.forEach(function (panel) {
      panel.classList.toggle('active', panel.id === targetTabId);
    });
  }

  function bindSidebarTabs() {
    const tabBtns = document.querySelectorAll('.sidebar-tab-btn');
    tabBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const target = btn.getAttribute('data-tab');
        activateSidebarTab(target);
      });
    });

    // 左端スリムレールのショートカットタブをクリックすると左サイドバーを展開して該当タブを開く
    const railBtns = document.querySelectorAll('.rail-tab-btn');
    railBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const target = btn.getAttribute('data-open-tab');
        setLeftSidebarCollapsed(false);
        if (target) activateSidebarTab(target);
      });
    });
  }

  function setLeftSidebarCollapsed(collapsed) {
    if (!App.settings.ui) App.settings.ui = {};
    App.settings.ui.leftSidebarCollapsed = Boolean(collapsed);
    const ws = document.getElementById('workspace-container');
    if (ws) {
      ws.classList.toggle('left-collapsed', Boolean(collapsed));
    }
    saveToLocalStorage();
  }

  function setBottomDockCollapsed(collapsed) {
    if (!App.settings.ui) App.settings.ui = {};
    App.settings.ui.bottomDockCollapsed = Boolean(collapsed);
    const dock = document.getElementById('page-manager-dock');
    const btn = document.getElementById('btn-toggle-bottom-dock');
    if (dock) {
      dock.classList.toggle('dock-collapsed', Boolean(collapsed));
    }
    if (btn) {
      btn.innerHTML = collapsed
        ? '<span id="dock-toggle-arrow">▲</span> ページ管理を開く (全 ' + App.pages.length + ' 頁)'
        : '<span id="dock-toggle-arrow">▼</span> ページ管理を折り畳む';
    }
    saveToLocalStorage();
  }

  function setThemeDrawerCollapsed(collapsed) {
    if (!App.settings.ui) App.settings.ui = {};
    App.settings.ui.themePanelCollapsed = Boolean(collapsed);
    const drawer = document.getElementById('ui-theme-drawer');
    const arrow = document.getElementById('theme-toggle-arrow');
    if (drawer) {
      drawer.classList.toggle('collapsed', Boolean(collapsed));
    }
    if (arrow) {
      arrow.textContent = collapsed ? '▼' : '▲';
    }
    saveToLocalStorage();
  }

  function setLinkedSectionBarCollapsed(collapsed) {
    if (!App.settings.ui) App.settings.ui = {};
    App.settings.ui.linkedSectionBarCollapsed = Boolean(collapsed);
    const bar = document.getElementById('linked-section-bar');
    const arrow = document.getElementById('linked-section-toggle-arrow');
    if (bar) {
      bar.classList.toggle('collapsed', Boolean(collapsed));
    }
    if (arrow) {
      arrow.textContent = collapsed ? '▶' : '▼';
    }
    saveToLocalStorage();
  }

  function applyEditorPaneRatio(ratio) {
    const r =
      typeof ratio === 'number' && !isNaN(ratio)
        ? Math.max(0.18, Math.min(0.82, ratio))
        : 0.445;
    if (!App.settings.ui) App.settings.ui = {};
    App.settings.ui.editorPaneRatio = r;
    const ws = document.getElementById('workspace-container');
    if (ws) {
      ws.style.setProperty('--editor-fr', r.toFixed(4) + 'fr');
      ws.style.setProperty('--preview-fr', (1 - r).toFixed(4) + 'fr');
    }
    syncEditorBackdropScroll();
  }

  function applyUiTheme() {
    if (!App.settings.ui) return;
    const ui = App.settings.ui;
    const themes = (global.TategakiState && global.TategakiState.UI_THEMES) || {};
    const preset = themes[ui.themePreset];

    if (preset && ui.themePreset !== 'custom') {
      ui.customColors = {
        bgApp: preset.bgApp,
        bgPanel: preset.bgPanel,
        bgEditor: preset.bgEditor,
        textMain: preset.textMain,
        accentGold: preset.accentGold
      };
    }

    const c = ui.customColors || {
      bgApp: '#191b20',
      bgPanel: '#22252c',
      bgEditor: '#16181d',
      textMain: '#ece9e2',
      accentGold: '#d4a857'
    };

    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--bg-app', c.bgApp);
    rootStyle.setProperty('--bg-panel', c.bgPanel);
    rootStyle.setProperty('--bg-editor', c.bgEditor);
    rootStyle.setProperty('--text-main', c.textMain);
    rootStyle.setProperty('--accent-gold', c.accentGold);

    if (preset && ui.themePreset !== 'custom') {
      rootStyle.setProperty('--bg-card', preset.bgCard);
      rootStyle.setProperty('--bg-input', preset.bgInput);
      rootStyle.setProperty('--text-muted', preset.textMuted);
      rootStyle.setProperty('--border-subtle', preset.borderSubtle);
    } else {
      rootStyle.setProperty('--bg-card', c.bgPanel);
      rootStyle.setProperty('--bg-input', c.bgApp);
    }

    setVal('cfg-ui-theme-preset', ui.themePreset || 'dark-sumi');
    setVal('cfg-ui-bg-app', c.bgApp);
    setVal('cfg-ui-bg-panel', c.bgPanel);
    setVal('cfg-ui-bg-editor', c.bgEditor);
    setVal('cfg-ui-text-main', c.textMain);
    setVal('cfg-ui-accent', c.accentGold);
  }

  function applyGaugeColors() {
    if (!App.settings.ui) App.settings.ui = {};
    const gc = Object.assign(
      {
        elapsed: '#5b9bd5',
        deadlineSafe: '#4caf50',
        deadlineWarn: '#f5a623',
        deadlineDanger: '#e5484d'
      },
      App.settings.ui.gaugeColors || {}
    );
    App.settings.ui.gaugeColors = gc;

    const rootStyle = document.documentElement.style;
    rootStyle.setProperty('--gauge-elapsed', gc.elapsed);
    rootStyle.setProperty('--gauge-deadline-safe', gc.deadlineSafe);
    rootStyle.setProperty('--gauge-deadline-warn', gc.deadlineWarn);
    rootStyle.setProperty('--gauge-deadline-danger', gc.deadlineDanger);

    setVal('cfg-gauge-elapsed', gc.elapsed);
    setVal('cfg-gauge-safe', gc.deadlineSafe);
    setVal('cfg-gauge-warn', gc.deadlineWarn);
    setVal('cfg-gauge-danger', gc.deadlineDanger);
  }

  /**
   * ヘッダーの日付(XX年X月X日(X))・今日n%・今月n%・締切までn%ゲージを更新
   */
  function updateHeaderTimeAndDeadlineBar() {
    const now = new Date();
    const nowMs = now.getTime();
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];

    // 1. 年月日(曜日): 2026年X月X日(X)
    const dateEl = document.getElementById('header-date-display');
    if (dateEl) {
      const yyyy = now.getFullYear();
      const mm = now.getMonth() + 1;
      const dd = now.getDate();
      const wd = weekdays[now.getDay()];
      dateEl.textContent = yyyy + '年' + mm + '月' + dd + '日(' + wd + ')';
      dateEl.title = yyyy + '年' + mm + '月' + dd + '日(' + wd + ')';
    }

    // 2. 今日n%[ゲージ] (0時＝0% 〜 24時＝100%)
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0).getTime();
    const todayPctRaw = Math.max(
      0,
      Math.min(100, ((nowMs - startOfDay) / (endOfDay - startOfDay)) * 100)
    );
    const todayPctInt = Math.floor(todayPctRaw);
    const todayPctEl = document.getElementById('time-today-pct');
    const todayFillEl = document.getElementById('time-today-fill');
    if (todayPctEl) todayPctEl.textContent = String(todayPctInt);
    if (todayFillEl) todayFillEl.style.width = todayPctRaw.toFixed(1) + '%';

    // 3. 今月n%[ゲージ] (1日0時＝0% 〜 月末24時＝100%)
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1, 0, 0, 0, 0).getTime();
    const monthPctRaw = Math.max(
      0,
      Math.min(100, ((nowMs - startOfMonth) / (endOfMonth - startOfMonth)) * 100)
    );
    const monthPctInt = Math.floor(monthPctRaw);
    const monthPctEl = document.getElementById('time-month-pct');
    const monthFillEl = document.getElementById('time-month-fill');
    if (monthPctEl) monthPctEl.textContent = String(monthPctInt);
    if (monthFillEl) monthFillEl.style.width = monthPctRaw.toFixed(1) + '%';

    // 4. 締切までn%[ゲージ]（未設定時または期限経過時は「締切未設定」）
    if (!App.settings || !App.settings.ui) return;
    if (!App.settings.ui.deadline) {
      App.settings.ui.deadline = { startAt: 0, targetAt: 0 };
    }
    const dl = App.settings.ui.deadline;
    const targetAt = Number(dl.targetAt) || 0;
    const startAt = Number(dl.startAt) || 0;

    const deadlineBtn = document.getElementById('btn-open-deadline-modal');
    const deadlineLabel = document.getElementById('time-deadline-label');
    const deadlineTrack = document.getElementById('time-deadline-track');
    const deadlineFill = document.getElementById('time-deadline-fill');

    // 設定した締切日時が現在日時を過ぎた場合は自動的に「締切未設定」に戻す
    if (targetAt > 0 && nowMs >= targetAt) {
      dl.targetAt = 0;
      dl.startAt = 0;
      saveToLocalStorage();
    }

    if (!dl.targetAt || dl.targetAt <= nowMs) {
      if (deadlineLabel) deadlineLabel.textContent = '締切未設定';
      if (deadlineTrack) deadlineTrack.style.display = 'none';
      if (deadlineBtn) {
        deadlineBtn.classList.remove('is-active');
        deadlineBtn.title = 'クリックして別窓で締切日時を設定';
      }
    } else {
      const effectiveStart = startAt > 0 && startAt < dl.targetAt ? startAt : nowMs - 1000;
      const totalSpan = Math.max(1000, dl.targetAt - effectiveStart);
      const remainMs = Math.max(0, dl.targetAt - nowMs);
      const remainPctRaw = Math.max(0, Math.min(100, (remainMs / totalSpan) * 100));
      const remainPctInt = Math.max(0, Math.min(100, Math.round(remainPctRaw)));

      if (deadlineLabel) {
        deadlineLabel.innerHTML = '締切まで<strong>' + remainPctInt + '</strong>%';
      }
      if (deadlineTrack) {
        deadlineTrack.style.display = 'inline-flex';
      }
      if (deadlineFill) {
        deadlineFill.style.width = remainPctRaw.toFixed(1) + '%';
        deadlineFill.classList.toggle('is-warn', remainPctRaw < 50 && remainPctRaw >= 20);
        deadlineFill.classList.toggle('is-danger', remainPctRaw < 20);
      }
      if (deadlineBtn) {
        deadlineBtn.classList.add('is-active');
        const targetDate = new Date(dl.targetAt);
        const totalMin = Math.floor(remainMs / 60000);
        const remDays = Math.floor(totalMin / (60 * 24));
        const remHours = Math.floor((totalMin % (60 * 24)) / 60);
        const remMins = totalMin % 60;
        const targetStr =
          targetDate.getFullYear() +
          '年' +
          (targetDate.getMonth() + 1) +
          '月' +
          targetDate.getDate() +
          '日 ' +
          String(targetDate.getHours()).padStart(2, '0') +
          ':' +
          String(targetDate.getMinutes()).padStart(2, '0');
        deadlineBtn.title =
          '締切：' +
          targetStr +
          '（残り ' +
          (remDays > 0 ? remDays + '日 ' : '') +
          remHours +
          '時間 ' +
          remMins +
          '分） クリックで設定変更・リセット';
      }
    }
  }

  /**
   * 上部情報バー（「日時・締切」「全ページ合計」および内訳項目）の表示／非表示を反映
   */
  function applyHeaderBarVisibility() {
    if (!App.settings || !App.settings.ui) return;
    const defaults = global.TategakiState.createDefaultSettings().ui.headerDisplay;
    if (!App.settings.ui.headerDisplay) {
      App.settings.ui.headerDisplay = Object.assign({}, defaults);
    }
    const hd = App.settings.ui.headerDisplay;
    const showTimeBar = hd.showTimeDeadlineBar !== false;
    const showTotalBar = hd.showTotalCounterBar !== false;
    const showRawAndNoSpace = hd.showRawAndNoSpace !== false;
    const show400Sheets = Boolean(hd.show400Sheets);

    const timeBarEl = document.getElementById('header-time-deadline-bar');
    if (timeBarEl) {
      timeBarEl.style.display = showTimeBar ? 'flex' : 'none';
    }

    const totalBarEl = document.getElementById('header-counter-bar');
    if (totalBarEl) {
      totalBarEl.style.display = showTotalBar ? 'flex' : 'none';
    }

    const rawMetricEl = document.getElementById('metric-total-raw');
    const noSpaceMetricEl = document.getElementById('metric-total-nospace');
    if (rawMetricEl) {
      rawMetricEl.style.display = showRawAndNoSpace ? 'inline-flex' : 'none';
    }
    if (noSpaceMetricEl) {
      noSpaceMetricEl.style.display = showRawAndNoSpace ? 'inline-flex' : 'none';
    }

    const sheetsMetricEl = document.getElementById('metric-total-sheets');
    if (sheetsMetricEl) {
      sheetsMetricEl.style.display = show400Sheets ? 'inline-flex' : 'none';
    }

    const chkTime = document.getElementById('cfg-show-header-time-bar');
    const chkTotal = document.getElementById('cfg-show-header-total-bar');
    const chkRawNoSpace = document.getElementById('cfg-show-total-raw-nospace');
    const chkSheets = document.getElementById('cfg-show-total-sheets');
    if (chkTime) chkTime.checked = showTimeBar;
    if (chkTotal) chkTotal.checked = showTotalBar;
    if (chkRawNoSpace) chkRawNoSpace.checked = showRawAndNoSpace;
    if (chkSheets) chkSheets.checked = show400Sheets;
  }

  /**
   * ショートカットキー表示・ツールチップの同期
   */
  function syncShortcutInputsAndTooltips() {
    if (!App.settings || !App.settings.ui) return;
    const defaults = global.TategakiState.createDefaultSettings().ui.shortcuts;
    if (!App.settings.ui.shortcuts) {
      App.settings.ui.shortcuts = Object.assign({}, defaults);
    }
    const sc = App.settings.ui.shortcuts;

    const inputs = document.querySelectorAll('.shortcut-key-input');
    inputs.forEach(function (inp) {
      const action = inp.getAttribute('data-shortcut-action');
      if (action) {
        inp.value = sc[action] || '';
      }
    });

    // 「セーブ（本文CSV保存）」「ロード（本文CSV読込）」ボタンのツールチップを同期
    const csvShortcut = sc.saveManuscriptCsv || '';
    const topCsvBtn = document.getElementById('btn-top-save-manuscript-csv');
    const topLoadLbl = document.getElementById('lbl-top-load-manuscript-csv');
    const sideCsvBtn = document.getElementById('btn-save-manuscript-csv');
    if (topCsvBtn) {
      topCsvBtn.title =
        '本文CSV保存：全ページの本文・扉・目次データをCSVとして保存します' +
        (csvShortcut ? ' (' + csvShortcut + ')' : '');
    }
    if (topLoadLbl) {
      topLoadLbl.title = '本文CSV読込：保存した本文CSVファイルを読み込みます';
    }
    if (sideCsvBtn) {
      sideCsvBtn.title = csvShortcut || '全ページの本文・扉・目次データをCSVとして保存';
    }
  }

  function formatShortcutFromKeyEvent(e) {
    if (!e || !e.key) return '';
    if (
      e.key === 'Control' ||
      e.key === 'Shift' ||
      e.key === 'Alt' ||
      e.key === 'Meta' ||
      e.key === 'Process'
    ) {
      return '';
    }
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');

    let keyName = e.key;
    if (keyName === ' ') {
      keyName = 'Space';
    } else if (keyName.length === 1) {
      keyName = keyName.toUpperCase();
    }

    // 単一文字キーやEnter/Backspace等は修飾キー(Ctrl/Alt)必須（F1〜F12は単体可）
    const isFunctionKey = /^F([1-9]|1[0-2])$/i.test(keyName);
    if (!isFunctionKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
      return '';
    }

    parts.push(keyName);
    return parts.join('+');
  }

  function executeShortcutAction(actionKey) {
    switch (actionKey) {
      case 'saveManuscriptCsv':
        global.TategakiExporters.saveManuscriptToCsv(App.pages);
        showToast('本文ファイル (.csv) を保存しました');
        break;
      case 'saveSettingsCsv':
        global.TategakiExporters.saveSettingsToCsv(App.settings);
        showToast('設定ファイル (.csv) を保存しました');
        break;
      case 'saveProjectJson':
        global.TategakiExporters.saveProjectBundleJson(App.settings, App.pages);
        showToast('プロジェクト一括ファイル (.json) を保存しました');
        break;
      case 'exportPlainTxt':
        global.TategakiExporters.exportPlainText(App.pages);
        showToast('プレーンテキスト (.txt) を書き出しました');
        break;
      case 'exportPsdZip':
        runWithProgressModal(async function (updateProgress) {
          await global.TategakiExporters.exportSequentialPsdZip(
            App.pages,
            App.settings,
            updateProgress
          );
        }, '全ページ連番PSD (ZIP) を書き出しました');
        break;
      case 'exportPngZip':
        runWithProgressModal(async function (updateProgress) {
          await global.TategakiExporters.exportSequentialPngZip(
            App.pages,
            App.settings,
            updateProgress
          );
        }, '全ページ連番PNG (ZIP) を書き出しました');
        break;
      case 'insertRuby': {
        const btn = document.getElementById('btn-insert-ruby');
        if (btn) btn.click();
        break;
      }
      case 'insertTcy': {
        const btn = document.getElementById('btn-insert-tcy');
        if (btn) btn.click();
        break;
      }
      case 'insertDash': {
        const btn = document.getElementById('btn-insert-dash');
        if (btn) btn.click();
        break;
      }
      case 'insertEllipsis': {
        const btn = document.getElementById('btn-insert-ellipsis');
        if (btn) btn.click();
        break;
      }
      case 'insertPageBreak': {
        const btn = document.getElementById('btn-insert-pagebreak');
        if (btn) btn.click();
        break;
      }
      case 'insertKaicho': {
        const btn = document.getElementById('btn-insert-kaicho');
        if (btn) btn.click();
        break;
      }
      case 'addNewFlowSection':
        addNewLinkedSectionAfterCurrent();
        break;
      case 'previewForward':
        stepPreviewPageForward();
        break;
      case 'previewBackward':
        stepPreviewPageBackward();
        break;
      default:
        break;
    }
  }

  function bindUiCollapseAndThemeControls() {
    bindClick('btn-expand-left-sidebar', function () {
      setLeftSidebarCollapsed(false);
    });
    bindClick('btn-collapse-left-sidebar', function () {
      setLeftSidebarCollapsed(true);
    });

    bindClick('btn-toggle-bottom-dock', function () {
      const cur = Boolean(App.settings.ui && App.settings.ui.bottomDockCollapsed);
      setBottomDockCollapsed(!cur);
    });

    bindClick('btn-toggle-theme-panel', function () {
      const cur = Boolean(App.settings.ui && App.settings.ui.themePanelCollapsed);
      setThemeDrawerCollapsed(!cur);
    });
    bindClick('btn-close-theme-panel', function () {
      setThemeDrawerCollapsed(true);
    });

    bindClick('btn-toggle-linked-section', function () {
      const cur = Boolean(
        App.settings.ui && App.settings.ui.linkedSectionBarCollapsed !== false
      );
      setLinkedSectionBarCollapsed(!cur);
    });

    onInput('cfg-ui-theme-preset', function (val) {
      if (!App.settings.ui) App.settings.ui = {};
      App.settings.ui.themePreset = val;
      applyUiTheme();
      saveToLocalStorage();
    });

    const colorMap = [
      { id: 'cfg-ui-bg-app', key: 'bgApp' },
      { id: 'cfg-ui-bg-panel', key: 'bgPanel' },
      { id: 'cfg-ui-bg-editor', key: 'bgEditor' },
      { id: 'cfg-ui-text-main', key: 'textMain' },
      { id: 'cfg-ui-accent', key: 'accentGold' }
    ];

    colorMap.forEach(function (item) {
      onInput(item.id, function (val) {
        if (!App.settings.ui) App.settings.ui = {};
        if (!App.settings.ui.customColors) App.settings.ui.customColors = {};
        App.settings.ui.themePreset = 'custom';
        App.settings.ui.customColors[item.key] = val;
        applyUiTheme();
        saveToLocalStorage();
      });
    });

    bindClick('btn-reset-ui-theme', function () {
      if (!App.settings.ui) App.settings.ui = {};
      App.settings.ui.themePreset = 'dark-sumi';
      applyUiTheme();
      saveToLocalStorage();
      showToast('UI色調を標準（墨色ダーク）に戻しました');
    });

    // 上部情報バー（「日時・締切」「全ページ合計」）表示設定
    function ensureHeaderDisplayObj() {
      if (!App.settings.ui) App.settings.ui = {};
      if (!App.settings.ui.headerDisplay) {
        App.settings.ui.headerDisplay = Object.assign(
          {},
          global.TategakiState.createDefaultSettings().ui.headerDisplay
        );
      }
      return App.settings.ui.headerDisplay;
    }

    onCheck('cfg-show-header-time-bar', function (checked) {
      ensureHeaderDisplayObj().showTimeDeadlineBar = checked;
      applyHeaderBarVisibility();
      saveToLocalStorage();
    });

    onCheck('cfg-show-header-total-bar', function (checked) {
      ensureHeaderDisplayObj().showTotalCounterBar = checked;
      applyHeaderBarVisibility();
      saveToLocalStorage();
    });

    onCheck('cfg-show-total-raw-nospace', function (checked) {
      ensureHeaderDisplayObj().showRawAndNoSpace = checked;
      applyHeaderBarVisibility();
      saveToLocalStorage();
    });

    onCheck('cfg-show-total-sheets', function (checked) {
      ensureHeaderDisplayObj().show400Sheets = checked;
      applyHeaderBarVisibility();
      saveToLocalStorage();
    });

    // 進捗・締切ゲージの色調設定
    const gaugeColorMap = [
      { id: 'cfg-gauge-elapsed', key: 'elapsed' },
      { id: 'cfg-gauge-safe', key: 'deadlineSafe' },
      { id: 'cfg-gauge-warn', key: 'deadlineWarn' },
      { id: 'cfg-gauge-danger', key: 'deadlineDanger' }
    ];
    gaugeColorMap.forEach(function (item) {
      onInput(item.id, function (val) {
        if (!App.settings.ui) App.settings.ui = {};
        if (!App.settings.ui.gaugeColors) App.settings.ui.gaugeColors = {};
        App.settings.ui.gaugeColors[item.key] = val;
        applyGaugeColors();
        saveToLocalStorage();
      });
    });

    bindClick('btn-reset-gauge-colors', function () {
      if (!App.settings.ui) App.settings.ui = {};
      App.settings.ui.gaugeColors = {
        elapsed: '#5b9bd5',
        deadlineSafe: '#4caf50',
        deadlineWarn: '#f5a623',
        deadlineDanger: '#e5484d'
      };
      applyGaugeColors();
      saveToLocalStorage();
      showToast('進捗・締切ゲージの色調を標準に戻しました');
    });

    // 締切設定モーダル（別窓）開閉・設定・リセット
    const deadlineModal = document.getElementById('deadline-modal');
    const deadlineDateInput = document.getElementById('deadline-date-input');
    const deadlineTimeInput = document.getElementById('deadline-time-input');
    const deadlineStatusEl = document.getElementById('deadline-modal-current-status');

    function refreshDeadlineModalInputs() {
      updateHeaderTimeAndDeadlineBar();
      const dl = (App.settings.ui && App.settings.ui.deadline) || { startAt: 0, targetAt: 0 };
      const now = new Date();
      if (dl.targetAt && dl.targetAt > now.getTime()) {
        const dt = new Date(dl.targetAt);
        const yyyy = dt.getFullYear();
        const mm = String(dt.getMonth() + 1).padStart(2, '0');
        const dd = String(dt.getDate()).padStart(2, '0');
        const hh = String(dt.getHours()).padStart(2, '0');
        const min = String(dt.getMinutes()).padStart(2, '0');
        if (deadlineDateInput) deadlineDateInput.value = yyyy + '-' + mm + '-' + dd;
        if (deadlineTimeInput) deadlineTimeInput.value = hh + ':' + min;
        if (deadlineStatusEl) {
          deadlineStatusEl.textContent =
            '現在設定中：' + yyyy + '年' + Number(mm) + '月' + Number(dd) + '日 ' + hh + ':' + min;
        }
      } else {
        const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 23, 59, 0, 0);
        const yyyy = nextDay.getFullYear();
        const mm = String(nextDay.getMonth() + 1).padStart(2, '0');
        const dd = String(nextDay.getDate()).padStart(2, '0');
        if (deadlineDateInput && !deadlineDateInput.value) {
          deadlineDateInput.value = yyyy + '-' + mm + '-' + dd;
        }
        if (deadlineTimeInput && !deadlineTimeInput.value) {
          deadlineTimeInput.value = '23:59';
        }
        if (deadlineStatusEl) {
          deadlineStatusEl.textContent = '現在：締切未設定';
        }
      }
    }

    bindClick('btn-open-deadline-modal', function () {
      refreshDeadlineModalInputs();
      if (deadlineModal) deadlineModal.style.display = 'flex';
    });

    bindClick('btn-save-deadline', function () {
      const dateVal = deadlineDateInput ? deadlineDateInput.value : '';
      const timeVal = deadlineTimeInput && deadlineTimeInput.value ? deadlineTimeInput.value : '23:59';
      if (!dateVal) {
        showToast('締切年月日を指定してください', true);
        return;
      }
      const dateParts = dateVal.split('-').map(Number);
      const timeParts = timeVal.split(':').map(Number);
      const targetDate = new Date(
        dateParts[0],
        (dateParts[1] || 1) - 1,
        dateParts[2] || 1,
        timeParts[0] || 0,
        timeParts[1] || 0,
        0,
        0
      );
      const nowMs = Date.now();
      if (isNaN(targetDate.getTime()) || targetDate.getTime() <= nowMs) {
        showToast('現在より未来の日時を指定してください', true);
        return;
      }
      if (!App.settings.ui) App.settings.ui = {};
      App.settings.ui.deadline = {
        startAt: nowMs,
        targetAt: targetDate.getTime()
      };
      updateHeaderTimeAndDeadlineBar();
      saveToLocalStorage();
      if (deadlineModal) deadlineModal.style.display = 'none';
      showToast('締切日時を設定しました');
    });

    bindClick('btn-reset-deadline', function () {
      if (!App.settings.ui) App.settings.ui = {};
      App.settings.ui.deadline = { startAt: 0, targetAt: 0 };
      updateHeaderTimeAndDeadlineBar();
      refreshDeadlineModalInputs();
      saveToLocalStorage();
      if (deadlineModal) deadlineModal.style.display = 'none';
      showToast('締切をリセット（締切未設定）にしました');
    });

    bindClick('btn-close-deadline-modal', function () {
      if (deadlineModal) deadlineModal.style.display = 'none';
    });

    if (deadlineModal) {
      deadlineModal.addEventListener('click', function (e) {
        if (e.target === deadlineModal) {
          deadlineModal.style.display = 'none';
        }
      });
    }

    // ショートカットキー設定入力＆クリアボタン＆グローバルキーイベント
    const shortcutInputs = document.querySelectorAll('.shortcut-key-input');
    shortcutInputs.forEach(function (inp) {
      inp.addEventListener('keydown', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const action = inp.getAttribute('data-shortcut-action');
        if (!action) return;

        if (e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Escape') {
          if (e.key !== 'Escape') {
            if (!App.settings.ui.shortcuts) App.settings.ui.shortcuts = {};
            App.settings.ui.shortcuts[action] = '';
            syncShortcutInputsAndTooltips();
            saveToLocalStorage();
          }
          inp.blur();
          return;
        }

        const formatted = formatShortcutFromKeyEvent(e);
        if (!formatted) return;

        if (!App.settings.ui.shortcuts) App.settings.ui.shortcuts = {};
        // 他の操作に同じキーが割り当てられていた場合は重複を解除
        Object.keys(App.settings.ui.shortcuts).forEach(function (k) {
          if (k !== action && App.settings.ui.shortcuts[k] === formatted) {
            App.settings.ui.shortcuts[k] = '';
          }
        });
        App.settings.ui.shortcuts[action] = formatted;
        syncShortcutInputsAndTooltips();
        saveToLocalStorage();
        inp.blur();
        showToast('ショートカットキー「' + formatted + '」を設定しました');
      });
    });

    const clearShortcutBtns = document.querySelectorAll('.btn-clear-shortcut');
    clearShortcutBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const action = btn.getAttribute('data-clear-shortcut');
        if (!action || !App.settings.ui) return;
        if (!App.settings.ui.shortcuts) App.settings.ui.shortcuts = {};
        App.settings.ui.shortcuts[action] = '';
        syncShortcutInputsAndTooltips();
        saveToLocalStorage();
      });
    });

    bindClick('btn-reset-shortcuts', function () {
      if (!App.settings.ui) App.settings.ui = {};
      App.settings.ui.shortcuts = Object.assign(
        {},
        global.TategakiState.createDefaultSettings().ui.shortcuts
      );
      syncShortcutInputsAndTooltips();
      saveToLocalStorage();
      showToast('ショートカットキー設定を初期状態（本文CSV保存: Ctrl+S のみ）に戻しました');
    });

    window.addEventListener('keydown', function (e) {
      if (App.isComposingIme) return;
      const activeEl = document.activeElement;
      if (activeEl && activeEl.classList && activeEl.classList.contains('shortcut-key-input')) {
        return;
      }

      // 1. 登録済みショートカットキー（Ctrl+S など）の判定・実行
      const combo = formatShortcutFromKeyEvent(e);
      if (combo && App.settings && App.settings.ui && App.settings.ui.shortcuts) {
        const sc = App.settings.ui.shortcuts;
        const matchedAction = Object.keys(sc).find(function (k) {
          return sc[k] && sc[k].toLowerCase() === combo.toLowerCase();
        });
        if (matchedAction) {
          e.preventDefault();
          executeShortcutAction(matchedAction);
          return;
        }
      }

      // 2. キーボードの左右矢印キー（← / →）による見開きプレビューのページ送り
      if (
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey &&
        !e.shiftKey &&
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      ) {
        const tag = activeEl && activeEl.tagName ? activeEl.tagName.toUpperCase() : '';
        const isEditable =
          tag === 'TEXTAREA' ||
          tag === 'INPUT' ||
          tag === 'SELECT' ||
          Boolean(activeEl && activeEl.isContentEditable);
        if (!isEditable) {
          const confirmModal = document.getElementById('confirm-action-modal');
          const anyModalOpen =
            (aboutModal && aboutModal.style.display === 'flex') ||
            (helpModal && helpModal.style.display === 'flex') ||
            (deadlineModal && deadlineModal.style.display === 'flex') ||
            (confirmModal && confirmModal.style.display === 'flex');
          if (!anyModalOpen) {
            e.preventDefault();
            if (e.key === 'ArrowLeft') {
              stepPreviewPageForward();
            } else {
              stepPreviewPageBackward();
            }
          }
        }
      }
    });

    // 「このツールについて」モーダル開閉
    const aboutModal = document.getElementById('about-tool-modal');
    bindClick('btn-about-tool', function () {
      const verEl = document.getElementById('about-modal-version');
      if (verEl) {
        const ver = (global.TategakiState && global.TategakiState.APP_VERSION) || '1.00';
        verEl.textContent = 'Ver.' + ver;
      }
      const updatedEl = document.getElementById('about-modal-updated');
      if (updatedEl) {
        const lastUpdated =
          (global.TategakiState && global.TategakiState.APP_LAST_UPDATED) || '2026年11月4日';
        updatedEl.textContent = '最終更新：' + lastUpdated;
      }
      if (aboutModal) aboutModal.style.display = 'flex';
    });
    bindClick('btn-close-about-modal', function () {
      if (aboutModal) aboutModal.style.display = 'none';
    });
    if (aboutModal) {
      aboutModal.addEventListener('click', function (e) {
        if (e.target === aboutModal) {
          aboutModal.style.display = 'none';
        }
      });
    }

    // 「ヘルプ」モーダル（別窓）開閉 ＆ テキストコピーボタン
    const helpModal = document.getElementById('help-tool-modal');
    bindClick('btn-help-tool', function () {
      if (helpModal) helpModal.style.display = 'flex';
    });
    bindClick('btn-close-help-modal', function () {
      if (helpModal) helpModal.style.display = 'none';
    });
    if (helpModal) {
      helpModal.addEventListener('click', function (e) {
        if (e.target === helpModal) {
          helpModal.style.display = 'none';
        }
      });
    }
    bindClick('btn-copy-help-text', function () {
      const helpPre = document.getElementById('help-readme-text');
      if (!helpPre) return;
      const text = helpPre.textContent || '';
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(text)
          .then(function () {
            showToast('ヘルプ（README）テキストをクリップボードにコピーしました');
          })
          .catch(function () {
            showToast('コピーに失敗しました（テキストを選択してCtrl+Cでコピーしてください）', true);
          });
      } else {
        showToast('テキストを選択してCtrl+Cでコピーしてください');
      }
    });

    // エディタ・プレビュー境界リサイズスプリッター
    const splitter = document.getElementById('pane-splitter');
    const wsContainer = document.getElementById('workspace-container');
    if (splitter && wsContainer) {
      let isDraggingSplitter = false;

      function updateSplitterAtClientX(clientX) {
        const wsRect = wsContainer.getBoundingClientRect();
        const isRightCollapsed = wsContainer.classList.contains('left-collapsed');
        const rightEl = document.getElementById(
          isRightCollapsed ? 'left-sidebar-rail' : 'settings-sidebar'
        );
        const rightW = rightEl ? rightEl.getBoundingClientRect().width : 38;
        const splitterW = splitter.getBoundingClientRect().width || 6;
        const availableW = Math.max(320, wsRect.width - rightW - splitterW);
        const relX = clientX - wsRect.left;
        const newRatio = Math.max(0.18, Math.min(0.82, relX / availableW));
        applyEditorPaneRatio(newRatio);
      }

      splitter.addEventListener('mousedown', function (e) {
        e.preventDefault();
        isDraggingSplitter = true;
        splitter.classList.add('is-dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
      });

      window.addEventListener('mousemove', function (e) {
        if (!isDraggingSplitter) return;
        updateSplitterAtClientX(e.clientX);
      });

      window.addEventListener('mouseup', function () {
        if (!isDraggingSplitter) return;
        isDraggingSplitter = false;
        splitter.classList.remove('is-dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        saveToLocalStorage();
      });

      splitter.addEventListener('dblclick', function () {
        applyEditorPaneRatio(0.445);
        saveToLocalStorage();
        showToast('エディタとプレビューの境界位置を標準に戻しました');
      });
    }
  }

  // =========================================================================
  // 設定フォームとStateの双方向バインディング
  // =========================================================================
  function syncSettingsToInputs() {
    const s = App.settings;

    setVal('cfg-paper-preset', s.paper.preset);
    setVal('cfg-paper-width', s.paper.widthMm);
    setVal('cfg-paper-height', s.paper.heightMm);
    setVal('cfg-paper-dpi', s.paper.dpi);
    setVal('cfg-paper-bleed', s.paper.bleedMm);
    setChecked('cfg-show-guides', s.paper.showMarginGuides);
    setChecked('cfg-show-trim-preview', s.paper.showTrimMarksInPreview);

    // 段組み・レイアウト
    setVal('cfg-columns', s.layout.columns);
    setVal('cfg-column-gap', s.layout.columnGapMm);
    setVal('cfg-chars-per-line', s.layout.charsPerLine);
    setVal('cfg-lines-per-page', s.layout.linesPerPage);
    setChecked('cfg-auto-line-spacing', s.layout.autoLineSpacing);
    setVal('cfg-manual-line-gap', s.layout.manualLineGapMm);
    setChecked('cfg-auto-fit-char', s.layout.autoFitCharPitch);

    // 余白 (cm表示とmm内部値の変換: ノド1.5cm, 小口1.0cm, 天1.6cm, 地1.2cm)
    setVal('cfg-margin-gutter-cm', (s.layout.margins.gutterMm / 10).toFixed(2));
    setVal('cfg-margin-outer-cm', (s.layout.margins.outerMm / 10).toFixed(2));
    setVal('cfg-margin-top-cm', (s.layout.margins.topMm / 10).toFixed(2));
    setVal('cfg-margin-bottom-cm', (s.layout.margins.bottomMm / 10).toFixed(2));

    // フォント・文字サイズ（本文・扉・目次・ノンブル・ノンブル右横コメント）
    populateFontSelects();
    setVal('cfg-body-font', resolveValidFontId(s.typography.body.fontId));
    setVal('cfg-body-size', s.typography.body.fontSizePt);
    setChecked('cfg-enable-page-font-override', Boolean(s.typography.enablePageFontOverride));
    updatePageFontOverrideVisibility();

    setVal(
      'cfg-nombre-font',
      resolveValidFontId(s.typography.nombre && s.typography.nombre.fontId)
    );
    setVal(
      'cfg-nombre-comment-font',
      resolveValidFontId(s.typography.nombreComment && s.typography.nombreComment.fontId)
    );

    setVal('cfg-tobira-font', resolveValidFontId(s.typography.tobira.fontId));
    setVal('cfg-tobira-title-size', s.typography.tobira.titleFontSizePt);
    setVal('cfg-tobira-sub-size', s.typography.tobira.subtitleFontSizePt);
    setVal('cfg-tobira-author-size', s.typography.tobira.authorFontSizePt);
    setVal('cfg-tobira-style', s.typography.tobira.layoutStyle);
    setChecked('cfg-tobira-border', s.typography.tobira.showBorder);
    setVal('cfg-tobira-top-offset', s.typography.tobira.titleYOffsetMm);
    setVal('cfg-tobira-x-offset', s.typography.tobira.titleXOffsetMm || 0);

    setVal('cfg-toc-font', resolveValidFontId(s.typography.toc.fontId));
    setVal('cfg-toc-heading-size', s.typography.toc.headingFontSizePt);
    setVal('cfg-toc-item-size', s.typography.toc.itemFontSizePt);
    setVal('cfg-toc-pitch', s.typography.toc.linePitchMm);
    setVal('cfg-toc-indent', s.typography.toc.topIndentChars);
    setChecked('cfg-toc-leader', s.typography.toc.showLeaderDots);
    setVal('cfg-toc-num-style', s.typography.toc.numberStyle || 'kanji');
    setVal('toc-panel-num-style', s.typography.toc.numberStyle || 'kanji');
    setVal('cfg-toc-align', s.typography.toc.layoutAlign || 'right');
    setVal('toc-panel-layout-align', s.typography.toc.layoutAlign || 'right');

    // ヘッダー・フッター設定
    setChecked('cfg-use-header', s.headerFooter.useHeader);
    setChecked('cfg-use-footer', s.headerFooter.useFooter);
    setVal('cfg-hf-placement', s.headerFooter.nombrePlacement || 'header');
    setVal('cfg-hf-font-size', s.headerFooter.fontSizePt);
    setVal('cfg-hf-start-num', s.headerFooter.startPageNumber);
    setChecked('cfg-hf-hide-tobira', s.headerFooter.hideOnTobira);
    setChecked('cfg-hf-hide-toc', s.headerFooter.hideOnToc);
    setVal(
      'cfg-hf-odd-gap-cm',
      (
        (s.headerFooter.oddPageCommentGapMm !== undefined &&
        s.headerFooter.oddPageCommentGapMm !== null
          ? s.headerFooter.oddPageCommentGapMm
          : 5.0) / 10
      ).toFixed(2)
    );
    setVal('cfg-hf-odd-source', s.headerFooter.oddPageCommentSource || 'tobira-title');
    setVal('cfg-hf-odd-custom', s.headerFooter.customOddPageComment || '');

    // 組版処理ルール
    setChecked('cfg-enable-kinsoku', s.rules.enableKinsoku);
    setVal('cfg-line-end-mode', s.rules.lineEndAdjustMode);
    setVal('cfg-auto-tcy-digits', s.rules.autoTcyDigits);
    setChecked('cfg-auto-tcy-excl', s.rules.autoTcyExclamation);
    setVal('cfg-latin-mode', s.rules.latinMode || 'rotate');
    setChecked('cfg-latin-word-wrap', s.rules.latinWordWrap !== false);
    setVal('cfg-latin-waou-spacing', s.rules.latinWaouSpacing || 'sixth');
    setVal(
      'cfg-latin-font-scale',
      Math.round((s.rules.latinFontScale !== undefined ? s.rules.latinFontScale : 0.95) * 100)
    );
    setVal(
      'cfg-latin-baseline-offset',
      (s.rules.latinBaselineOffset !== undefined ? s.rules.latinBaselineOffset : 0).toFixed(2)
    );
    setChecked('cfg-connect-dash', s.rules.connectDashEllipsis);
    setVal('cfg-bracket-spacing', s.rules.bracketSpacing);
    setVal('cfg-punct-spacing', s.rules.punctuationAfterSpacing);
    setChecked('cfg-auto-excl-space', s.rules.autoFullSpaceAfterExclQuest);
    setVal('cfg-kaicho-target', s.rules.kaichoTarget);
    setChecked('cfg-check-indent-warning', s.rules.checkIndentWarning !== false);
    setChecked('chk-inline-indent-warning', s.rules.checkIndentWarning !== false);
    setChecked('chk-page-bg-highlight', Boolean(s.rules.showPageBgHighlight));

    // 出力設定
    setVal('cfg-pdf-color', s.exportOptions.pdfColorMode);
    // 動作が保証できないためコメントアウト。使う場合は自己責任で
    // setVal('cfg-pdf-standard', s.exportOptions.pdfStandard);
    setChecked('cfg-pdf-trim', s.exportOptions.includeTrimMarks);
    setVal('cfg-pdf-bleed', s.exportOptions.exportBleedMm);
    // 動作が保証できないためコメントアウト。使う場合は自己責任で
    // setVal('cfg-epub-layout', s.exportOptions.epubLayout);

    // プレビュー表示モード＆右綴じ見開き常時固定の同期
    if (s.view) {
      s.view.spreadPairing = 'pair-rtl';
      setVal('grid-direction-select', s.view.gridDirection || 'ltr');
      // プレビュー解像度・表示倍率は常時100%固定のため廃止（将来的に使用する可能性があるためコメントアウトで温存）
      s.view.zoom = 1.0;
      // setVal('preview-zoom-select', s.view.zoom || 1.0);
      setPreviewMode(s.view.mode || 'spread');
    }

    // 折り畳み状態＆UI設定の同期
    if (s.ui) {
      setLeftSidebarCollapsed(s.ui.leftSidebarCollapsed !== false);
      setBottomDockCollapsed(s.ui.bottomDockCollapsed !== false);
      setThemeDrawerCollapsed(s.ui.themePanelCollapsed !== false);
      setLinkedSectionBarCollapsed(s.ui.linkedSectionBarCollapsed !== false);
      applyEditorPaneRatio(s.ui.editorPaneRatio);
      applyUiTheme();
      applyHeaderBarVisibility();
      applyGaugeColors();
      syncShortcutInputsAndTooltips();
      updateHeaderTimeAndDeadlineBar();
    }
  }

  function resolveValidFontId(fontId) {
    const presets = (global.TategakiState && global.TategakiState.FONT_PRESETS) || [];
    if (
      fontId &&
      presets.some(function (f) {
        return f.id === fontId;
      })
    ) {
      return fontId;
    }
    return 'yumincho';
  }

  function updatePageFontOverrideVisibility() {
    const box = document.getElementById('page-override-controls');
    if (!box) return;
    const enabled = Boolean(
      App.settings &&
        App.settings.typography &&
        App.settings.typography.enablePageFontOverride
    );
    box.style.display = enabled ? 'flex' : 'none';
  }

  function renderCustomFontsLoadedList() {
    const listEl = document.getElementById('custom-fonts-loaded-list');
    const btnTextEl = document.getElementById('custom-font-upload-btn-text');
    const customList = (global.TategakiState && global.TategakiState.CUSTOM_FONT_LIST) || [];

    if (btnTextEl) {
      if (customList.length === 0) {
        btnTextEl.textContent = '任意のフォント (.ttf / .otf) を追加読み込む（複数可）';
      } else {
        const names = customList.map(function (c) {
          return c.displayName || c.label;
        });
        btnTextEl.textContent =
          '読込済: ' + names.join(' / ') + ' （＋さらに追加）';
      }
    }

    if (!listEl) return;
    if (customList.length === 0) {
      listEl.style.display = 'none';
      listEl.innerHTML = '';
      return;
    }

    listEl.style.display = 'flex';
    listEl.innerHTML = '';
    const cap = document.createElement('div');
    cap.className = 'custom-fonts-loaded-caption';
    cap.textContent = '追加読み込み済みフォント (' + customList.length + '件):';
    listEl.appendChild(cap);

    customList.forEach(function (cf) {
      const chip = document.createElement('span');
      chip.className = 'custom-font-chip';
      chip.textContent = cf.displayName || cf.label;
      chip.title = cf.fileName ? 'ファイル: ' + cf.fileName : cf.label;
      listEl.appendChild(chip);
    });
  }

  function populateFontSelects() {
    if (
      global.TategakiState &&
      typeof global.TategakiState.refreshAvailableFonts === 'function'
    ) {
      global.TategakiState.refreshAvailableFonts();
    }
    const selectIds = [
      'cfg-body-font',
      'cfg-tobira-font',
      'cfg-toc-font',
      'cfg-nombre-font',
      'cfg-nombre-comment-font',
      'page-font-override'
    ];
    const presets = global.TategakiState.FONT_PRESETS;
    selectIds.forEach(function (id) {
      const sel = document.getElementById(id);
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = '';
      if (id === 'page-font-override') {
        const optDefault = document.createElement('option');
        optDefault.value = '';
        optDefault.textContent = 'カテゴリ標準設定に従う';
        sel.appendChild(optDefault);
      }
      presets.forEach(function (f) {
        const opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = f.label;
        sel.appendChild(opt);
      });
      if (
        cur &&
        presets.some(function (f) {
          return f.id === cur;
        })
      ) {
        sel.value = cur;
      } else if (id !== 'page-font-override') {
        sel.value = 'yumincho';
      }
    });
    renderCustomFontsLoadedList();
  }

  function setVal(id, val) {
    const el = document.getElementById(id);
    if (el && val !== undefined && val !== null) {
      el.value = String(val);
    }
  }

  function setChecked(id, boolVal) {
    const el = document.getElementById(id);
    if (el) {
      el.checked = Boolean(boolVal);
    }
  }

  function bindSettingsInputs() {
    // 設定CSV/JSON読込や初期化で App.settings は別オブジェクトに差し替わるため、
    // 起動時の参照を保持せず各ハンドラ内で毎回 App.settings を参照する
    onInput('cfg-paper-preset', function (val) {
      App.settings.paper.preset = val;
      const preset = global.TategakiState.PAPER_PRESETS[val];
      if (preset && val !== 'CUSTOM') {
        App.settings.paper.widthMm = preset.widthMm;
        App.settings.paper.heightMm = preset.heightMm;
        setVal('cfg-paper-width', preset.widthMm);
        setVal('cfg-paper-height', preset.heightMm);
      }
      scheduleRender();
    });

    onInput('cfg-paper-width', function (val) {
      App.settings.paper.widthMm = Math.max(40, parseFloat(val) || 105);
      App.settings.paper.preset = 'CUSTOM';
      setVal('cfg-paper-preset', 'CUSTOM');
      scheduleRender();
    });

    onInput('cfg-paper-height', function (val) {
      App.settings.paper.heightMm = Math.max(50, parseFloat(val) || 148);
      App.settings.paper.preset = 'CUSTOM';
      setVal('cfg-paper-preset', 'CUSTOM');
      scheduleRender();
    });

    onInput('cfg-paper-dpi', function (val) {
      App.settings.paper.dpi = Math.max(72, parseInt(val, 10) || 600);
      scheduleRender();
    });

    onInput('cfg-paper-bleed', function (val) {
      const b = Math.max(0, parseFloat(val) || 0);
      App.settings.paper.bleedMm = b;
      App.settings.exportOptions.exportBleedMm = b;
      setVal('cfg-pdf-bleed', b);
      scheduleRender();
    });

    onCheck('cfg-show-guides', function (checked) {
      App.settings.paper.showMarginGuides = checked;
      scheduleRender();
    });

    onCheck('cfg-show-trim-preview', function (checked) {
      App.settings.paper.showTrimMarksInPreview = checked;
      scheduleRender();
    });

    // 段組み・レイアウト（変更時は本文連動区間も自動で再ページ割り）
    onInput('cfg-columns', function (val) {
      App.settings.layout.columns = parseInt(val, 10) || 1;
      scheduleRepaginateAndRender();
    });
    onInput('cfg-column-gap', function (val) {
      App.settings.layout.columnGapMm = Math.max(0, parseFloat(val) || 5);
      scheduleRender();
    });
    onInput('cfg-chars-per-line', function (val) {
      App.settings.layout.charsPerLine = Math.max(5, Math.min(120, parseInt(val, 10) || 41));
      scheduleRepaginateAndRender();
    });
    onInput('cfg-lines-per-page', function (val) {
      App.settings.layout.linesPerPage = Math.max(2, Math.min(60, parseInt(val, 10) || 18));
      scheduleRepaginateAndRender();
    });
    onCheck('cfg-auto-line-spacing', function (checked) {
      App.settings.layout.autoLineSpacing = checked;
      scheduleRender();
    });
    onInput('cfg-manual-line-gap', function (val) {
      App.settings.layout.manualLineGapMm = Math.max(0, parseFloat(val) || 1.5);
      scheduleRender();
    });
    onCheck('cfg-auto-fit-char', function (checked) {
      App.settings.layout.autoFitCharPitch = checked;
      scheduleRender();
    });

    // 余白 (cm -> mm)
    onInput('cfg-margin-gutter-cm', function (val) {
      App.settings.layout.margins.gutterMm = Math.max(0, (parseFloat(val) || 1.5) * 10);
      scheduleRender();
    });
    onInput('cfg-margin-outer-cm', function (val) {
      App.settings.layout.margins.outerMm = Math.max(0, (parseFloat(val) || 1.0) * 10);
      scheduleRender();
    });
    onInput('cfg-margin-top-cm', function (val) {
      App.settings.layout.margins.topMm = Math.max(0, (parseFloat(val) || 1.6) * 10);
      scheduleRender();
    });
    onInput('cfg-margin-bottom-cm', function (val) {
      App.settings.layout.margins.bottomMm = Math.max(0, (parseFloat(val) || 1.2) * 10);
      scheduleRender();
    });

    // フォント・文字サイズ（本文・扉・目次・ノンブル・ノンブル右横コメント）
    onInput('cfg-body-font', function (val) {
      App.settings.typography.body.fontId = val;
      scheduleRender();
    });
    onInput('cfg-body-size', function (val) {
      App.settings.typography.body.fontSizePt = Math.max(4, parseFloat(val) || 8.5);
      scheduleRender();
    });
    onCheck('cfg-enable-page-font-override', function (checked) {
      App.settings.typography.enablePageFontOverride = Boolean(checked);
      updatePageFontOverrideVisibility();
      scheduleRender();
    });
    onInput('cfg-nombre-font', function (val) {
      if (!App.settings.typography.nombre) App.settings.typography.nombre = {};
      App.settings.typography.nombre.fontId = val;
      schedulePreviewAndCounterRender();
    });
    onInput('cfg-nombre-comment-font', function (val) {
      if (!App.settings.typography.nombreComment) App.settings.typography.nombreComment = {};
      App.settings.typography.nombreComment.fontId = val;
      schedulePreviewAndCounterRender();
    });

    onInput('cfg-tobira-font', function (val) {
      App.settings.typography.tobira.fontId = val;
      scheduleRender();
    });
    onInput('cfg-tobira-title-size', function (val) {
      App.settings.typography.tobira.titleFontSizePt = Math.max(6, parseFloat(val) || 18);
      scheduleRender();
    });
    onInput('cfg-tobira-sub-size', function (val) {
      App.settings.typography.tobira.subtitleFontSizePt = Math.max(6, parseFloat(val) || 10.5);
      scheduleRender();
    });
    onInput('cfg-tobira-author-size', function (val) {
      App.settings.typography.tobira.authorFontSizePt = Math.max(6, parseFloat(val) || 10);
      scheduleRender();
    });
    onInput('cfg-tobira-style', function (val) {
      App.settings.typography.tobira.layoutStyle = val;
      scheduleRender();
    });
    onCheck('cfg-tobira-border', function (checked) {
      App.settings.typography.tobira.showBorder = checked;
      scheduleRender();
    });
    onInput('cfg-tobira-top-offset', function (val) {
      const num = parseFloat(val);
      const yMm = isNaN(num) ? 18 : num;
      App.settings.typography.tobira.titleYOffsetMm = yMm;
      const curPage = getCurrentPage();
      if (curPage && curPage.type === 'tobira') {
        if (!curPage.tobiraData) curPage.tobiraData = {};
        curPage.tobiraData.titleOffsetYMm = yMm;
        setVal('tobira-title-offset-y', yMm);
      }
      scheduleRender();
    });
    onInput('cfg-tobira-x-offset', function (val) {
      const num = parseFloat(val);
      const xMm = isNaN(num) ? 0 : num;
      App.settings.typography.tobira.titleXOffsetMm = xMm;
      const curPage = getCurrentPage();
      if (curPage && curPage.type === 'tobira') {
        if (!curPage.tobiraData) curPage.tobiraData = {};
        curPage.tobiraData.titleOffsetXMm = xMm;
        setVal('tobira-title-offset-x', xMm);
      }
      scheduleRender();
    });

    onInput('cfg-toc-font', function (val) {
      App.settings.typography.toc.fontId = val;
      scheduleRender();
    });
    onInput('cfg-toc-heading-size', function (val) {
      App.settings.typography.toc.headingFontSizePt = Math.max(6, parseFloat(val) || 13);
      scheduleRender();
    });
    onInput('cfg-toc-item-size', function (val) {
      App.settings.typography.toc.itemFontSizePt = Math.max(6, parseFloat(val) || 9);
      scheduleRender();
    });
    onInput('cfg-toc-pitch', function (val) {
      App.settings.typography.toc.linePitchMm = Math.max(3, parseFloat(val) || 7.5);
      scheduleRender();
    });
    onInput('cfg-toc-indent', function (val) {
      App.settings.typography.toc.topIndentChars = Math.max(0, parseInt(val, 10) || 0);
      scheduleRender();
    });
    onCheck('cfg-toc-leader', function (checked) {
      App.settings.typography.toc.showLeaderDots = checked;
      scheduleRender();
    });
    onInput('cfg-toc-num-style', function (val) {
      App.settings.typography.toc.numberStyle = val;
      setVal('toc-panel-num-style', val);
      scheduleRender();
    });
    onInput('toc-panel-num-style', function (val) {
      App.settings.typography.toc.numberStyle = val;
      setVal('cfg-toc-num-style', val);
      scheduleRender();
    });
    onInput('cfg-toc-align', function (val) {
      App.settings.typography.toc.layoutAlign = val;
      setVal('toc-panel-layout-align', val);
      scheduleRender();
    });
    onInput('toc-panel-layout-align', function (val) {
      App.settings.typography.toc.layoutAlign = val;
      setVal('cfg-toc-align', val);
      scheduleRender();
    });

    // ヘッダー・フッター
    onCheck('cfg-use-header', function (checked) {
      App.settings.headerFooter.useHeader = checked;
      schedulePreviewAndCounterRender();
    });
    onCheck('cfg-use-footer', function (checked) {
      App.settings.headerFooter.useFooter = checked;
      schedulePreviewAndCounterRender();
    });
    onInput('cfg-hf-placement', function (val) {
      App.settings.headerFooter.nombrePlacement = val;
      if (val === 'footer' && !App.settings.headerFooter.useFooter) {
        App.settings.headerFooter.useFooter = true;
        setChecked('cfg-use-footer', true);
      } else if (val === 'header' && !App.settings.headerFooter.useHeader) {
        App.settings.headerFooter.useHeader = true;
        setChecked('cfg-use-header', true);
      }
      schedulePreviewAndCounterRender();
    });
    onInput('cfg-hf-font-size', function (val) {
      App.settings.headerFooter.fontSizePt = Math.max(4, parseFloat(val) || 7);
      schedulePreviewAndCounterRender();
    });
    onInput('cfg-hf-start-num', function (val) {
      App.settings.headerFooter.startPageNumber = parseInt(val, 10) || 1;
      scheduleRepaginateAndRender();
    });
    onCheck('cfg-hf-hide-tobira', function (checked) {
      App.settings.headerFooter.hideOnTobira = checked;
      schedulePreviewAndCounterRender();
    });
    onCheck('cfg-hf-hide-toc', function (checked) {
      App.settings.headerFooter.hideOnToc = checked;
      schedulePreviewAndCounterRender();
    });
    onInput('cfg-hf-odd-gap-cm', function (val) {
      const num = parseFloat(val);
      App.settings.headerFooter.oddPageCommentGapMm = isNaN(num) ? 5.0 : Math.max(0, num * 10);
      schedulePreviewAndCounterRender();
    });
    onInput('cfg-hf-odd-source', function (val) {
      App.settings.headerFooter.oddPageCommentSource = val;
      schedulePreviewAndCounterRender();
    });
    onInput('cfg-hf-odd-custom', function (val) {
      App.settings.headerFooter.customOddPageComment = val;
      if (val && val.trim() !== '' && App.settings.headerFooter.oddPageCommentSource !== 'custom') {
        App.settings.headerFooter.oddPageCommentSource = 'custom';
        setVal('cfg-hf-odd-source', 'custom');
      }
      schedulePreviewAndCounterRender();
    });

    // 組版処理ルール（変更時は本文連動区間も自動で再ページ割り）
    onCheck('cfg-enable-kinsoku', function (checked) {
      App.settings.rules.enableKinsoku = checked;
      scheduleRepaginateAndRender();
    });
    onInput('cfg-line-end-mode', function (val) {
      App.settings.rules.lineEndAdjustMode = val;
      scheduleRepaginateAndRender();
    });
    onInput('cfg-auto-tcy-digits', function (val) {
      App.settings.rules.autoTcyDigits = parseInt(val, 10) || 0;
      scheduleRepaginateAndRender();
    });
    onCheck('cfg-auto-tcy-excl', function (checked) {
      App.settings.rules.autoTcyExclamation = checked;
      scheduleRepaginateAndRender();
    });
    onInput('cfg-latin-mode', function (val) {
      App.settings.rules.latinMode = val;
      scheduleRepaginateAndRender();
    });
    onCheck('cfg-latin-word-wrap', function (checked) {
      App.settings.rules.latinWordWrap = checked;
      scheduleRepaginateAndRender();
    });
    onInput('cfg-latin-waou-spacing', function (val) {
      App.settings.rules.latinWaouSpacing = val;
      scheduleRepaginateAndRender();
    });
    onInput('cfg-latin-font-scale', function (val) {
      const pct = Math.max(70, Math.min(125, parseFloat(val) || 95));
      App.settings.rules.latinFontScale = pct / 100;
      scheduleRepaginateAndRender();
    });
    onInput('cfg-latin-baseline-offset', function (val) {
      const off = parseFloat(val);
      App.settings.rules.latinBaselineOffset = isNaN(off) ? 0 : Math.max(-0.4, Math.min(0.4, off));
      scheduleRender();
    });
    onCheck('cfg-connect-dash', function (checked) {
      App.settings.rules.connectDashEllipsis = checked;
      scheduleRender();
    });
    onInput('cfg-bracket-spacing', function (val) {
      App.settings.rules.bracketSpacing = val;
      scheduleRepaginateAndRender();
    });
    onInput('cfg-punct-spacing', function (val) {
      App.settings.rules.punctuationAfterSpacing = val;
      scheduleRepaginateAndRender();
    });
    onCheck('cfg-auto-excl-space', function (checked) {
      App.settings.rules.autoFullSpaceAfterExclQuest = checked;
      scheduleRepaginateAndRender();
    });
    onInput('cfg-kaicho-target', function (val) {
      App.settings.rules.kaichoTarget = val;
      scheduleRepaginateAndRender();
    });
    onCheck('cfg-check-indent-warning', function (checked) {
      App.settings.rules.checkIndentWarning = checked;
      setChecked('chk-inline-indent-warning', checked);
      updateIndentWarningBar();
      scheduleRender();
    });
    onCheck('chk-inline-indent-warning', function (checked) {
      App.settings.rules.checkIndentWarning = checked;
      setChecked('cfg-check-indent-warning', checked);
      updateIndentWarningBar();
      scheduleRender();
    });
    onCheck('chk-page-bg-highlight', function (checked) {
      App.settings.rules.showPageBgHighlight = Boolean(checked);
      renderEditorPageBgBackdrop();
      saveToLocalStorage();
    });

    // 出力設定
    onInput('cfg-pdf-color', function (val) {
      App.settings.exportOptions.pdfColorMode = val;
    });
    // 動作が保証できないためコメントアウト。使う場合は自己責任で
    // onInput('cfg-pdf-standard', function (val) {
    //   App.settings.exportOptions.pdfStandard = val;
    // });
    onCheck('cfg-pdf-trim', function (checked) {
      App.settings.exportOptions.includeTrimMarks = checked;
    });
    onInput('cfg-pdf-bleed', function (val) {
      App.settings.exportOptions.exportBleedMm = parseFloat(val) || 0;
    });
    // 動作が保証できないためコメントアウト。使う場合は自己責任で
    // onInput('cfg-epub-layout', function (val) {
    //   App.settings.exportOptions.epubLayout = val;
    // });

    // カスタムフォントファイル読み込み (.ttf / .otf / .woff / .woff2) 複数追加対応
    const fontInput = document.getElementById('input-custom-font');
    if (fontInput) {
      fontInput.addEventListener('change', function (e) {
        const fileList = e.target.files ? Array.from(e.target.files) : [];
        if (fileList.length === 0) return;

        const loadPromises = fileList.map(function (file) {
          return file.arrayBuffer().then(function (ab) {
            App.customFontBytes = new Uint8Array(ab);
            App.customFontName = file.name;

            const extractedName =
              (global.TategakiState &&
                typeof global.TategakiState.extractOpenTypeFontName === 'function' &&
                global.TategakiState.extractOpenTypeFontName(ab, file.name)) ||
              file.name.replace(/\.[a-z0-9]+$/i, '');

            // 既に同名フォントが登録されていればそのIDを再利用、なければ新規IDを発行
            const existingList =
              (global.TategakiState && global.TategakiState.CUSTOM_FONT_LIST) || [];
            const existingEntry = existingList.find(function (item) {
              return item.displayName === extractedName || item.fileName === file.name;
            });

            let fontId;
            let cssFamilyName;
            if (existingEntry) {
              fontId = existingEntry.id;
              cssFamilyName = existingEntry.cssFamilyName;
            } else {
              App.customFontSeq = (App.customFontSeq || 0) + 1;
              fontId = 'custom-font-' + App.customFontSeq;
              cssFamilyName = 'CustomUploadedFont_' + App.customFontSeq;
            }

            const fontFace = new FontFace(cssFamilyName, ab);
            return fontFace.load().then(function (loaded) {
              document.fonts.add(loaded);
              const entry = {
                id: fontId,
                cssFamilyName: cssFamilyName,
                displayName: extractedName,
                fileName: file.name,
                label: '【読込】' + extractedName,
                css: '"' + cssFamilyName + '", "Yu Mincho", serif'
              };
              if (
                global.TategakiState &&
                typeof global.TategakiState.registerCustomFont === 'function'
              ) {
                global.TategakiState.registerCustomFont(entry);
              }
              return entry;
            });
          });
        });

        Promise.all(loadPromises)
          .then(function (loadedEntries) {
            if (!loadedEntries || loadedEntries.length === 0) return;
            const lastEntry = loadedEntries[loadedEntries.length - 1];
            App.settings.typography.body.fontId = lastEntry.id;
            populateFontSelects();
            setVal('cfg-body-font', lastEntry.id);
            setVal(
              'cfg-tobira-font',
              resolveValidFontId(App.settings.typography.tobira && App.settings.typography.tobira.fontId)
            );
            setVal(
              'cfg-toc-font',
              resolveValidFontId(App.settings.typography.toc && App.settings.typography.toc.fontId)
            );
            setVal(
              'cfg-nombre-font',
              resolveValidFontId(App.settings.typography.nombre && App.settings.typography.nombre.fontId)
            );
            setVal(
              'cfg-nombre-comment-font',
              resolveValidFontId(
                App.settings.typography.nombreComment && App.settings.typography.nombreComment.fontId
              )
            );
            const names = loadedEntries.map(function (en) {
              return en.displayName;
            });
            showToast('フォント「' + names.join('」「') + '」を追加読み込み・適用しました');
            scheduleRender();
          })
          .catch(function (err) {
            showToast('フォント読み込みエラー: ' + err.message, true);
          })
          .finally(function () {
            fontInput.value = '';
          });
      });
    }
  }

  function onInput(id, handler) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('input', function () {
      handler(el.value);
    });
    el.addEventListener('change', function () {
      handler(el.value);
    });
  }

  function onCheck(id, handler) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', function () {
      handler(el.checked);
    });
  }

  // =========================================================================
  // 本文連動区間（Linked Body Sections）＆ リアルタイム自動ページ割りエンジン
  // =========================================================================

  /**
   * ページが「本文連動区間」に属する属性（本文 または 空白）かどうかを判定する
   */
  function isFlowSectionPage(page) {
    return Boolean(page && (page.type === 'body' || page.type === 'blank'));
  }

  /**
   * 指定された本文・空白ページインデックスが属する「本文連動区間 [startIdx .. endIdx]」を返す
   */
  function getLinkedBodySectionRange(pageIndex) {
    if (
      pageIndex < 0 ||
      pageIndex >= App.pages.length ||
      !isFlowSectionPage(App.pages[pageIndex])
    ) {
      return null;
    }

    let startIdx = pageIndex;
    while (
      startIdx > 0 &&
      !App.pages[startIdx].flowBreakBefore &&
      isFlowSectionPage(App.pages[startIdx - 1])
    ) {
      startIdx--;
    }

    let endIdx = pageIndex;
    while (
      endIdx + 1 < App.pages.length &&
      isFlowSectionPage(App.pages[endIdx + 1]) &&
      !App.pages[endIdx + 1].flowBreakBefore
    ) {
      endIdx++;
    }

    return { startIdx: startIdx, endIdx: endIdx };
  }

  /**
   * 文書内のすべての「本文連動区間」のリストを返す
   */
  function getAllLinkedBodySections() {
    const sections = [];
    let i = 0;
    while (i < App.pages.length) {
      if (isFlowSectionPage(App.pages[i])) {
        const range = getLinkedBodySectionRange(i);
        sections.push({
          sectionNumber: sections.length + 1,
          startIdx: range.startIdx,
          endIdx: range.endIdx,
          pageCount: range.endIdx - range.startIdx + 1
        });
        i = range.endIdx + 1;
      } else {
        i++;
      }
    }
    return sections;
  }

  /**
   * 指定された連動区間 [startIdx .. endIdx] の連なった全文テキストを取得する
   * ページを跨いで自動折り返しされている箇所には余分な改行(\n)を挿入せず、元の段落構造を完全に維持する
   */
  function getSectionCombinedText(startIdx, endIdx, forceFromContent) {
    const sectionPages = App.pages.slice(startIdx, endIdx + 1);
    if (sectionPages.length === 0) return '';

    const allHaveRawSlice = sectionPages.every(function (p) {
      return typeof p.rawSlice === 'string';
    });

    const maxLines =
      (App.settings && App.settings.layout
        ? (App.settings.layout.linesPerPage || 18) * (App.settings.layout.columns || 1)
        : 18);

    if (allHaveRawSlice && !forceFromContent) {
      let joined = '';
      for (let i = 0; i < sectionPages.length; i++) {
        let sliceStr = sectionPages[i].rawSlice;
        // 過去バージョンのページ結合等でページ境界(満杯行末)の文中に誤って単一改行(\n)が入っていた場合は自動修復
        if (
          i < sectionPages.length - 1 &&
          !sectionPages[i].isBlankAdjustment &&
          (sectionPages[i].usedLines || 0) >= maxLines &&
          /[^\n]\n$/.test(sliceStr)
        ) {
          const lastLine = sliceStr.slice(0, -1).split('\n').pop() || '';
          let nextSlice = '';
          for (let n = i + 1; n < sectionPages.length; n++) {
            const cand = sectionPages[n].rawSlice || sectionPages[n].content || '';
            if (cand.length > 0) {
              nextSlice = cand;
              break;
            }
          }
          if (
            global.TategakiTypesetter.isMidSentenceContinuation(lastLine) &&
            nextSlice.length > 0 &&
            !/^[　 \t\n「『（【〈《〔｛［“‘]/.test(nextSlice)
          ) {
            sliceStr = sliceStr.slice(0, -1);
          }
        }
        if (
          i === sectionPages.length - 1 &&
          !sectionPages[i].isBlankAdjustment &&
          (sectionPages[i].usedLines || 0) >= maxLines &&
          /\n$/.test(sliceStr)
        ) {
          sliceStr = sliceStr.replace(/\n+$/, '');
        }
        joined += sliceStr;
      }
      return joined;
    }

    // rawSlice が一部ページにのみ存在する場合や、contentから復元する場合でも
    // ページ跨ぎの途中折り返し(endsMidParagraph / 文中折り返し)では \n を挟まない
    const nonBlankPages = sectionPages.filter(function (p) {
      return !p.isBlankAdjustment && !(p.type === 'blank' && !p.content);
    });
    while (
      nonBlankPages.length > 1 &&
      /^[\r\n]*$/.test(nonBlankPages[nonBlankPages.length - 1].content || '')
    ) {
      nonBlankPages.pop();
    }
    if (nonBlankPages.length === 0) return '';

    let combined = '';
    for (let i = 0; i < nonBlankPages.length; i++) {
      const p = nonBlankPages[i];
      let c = p.content || '';
      if (i === nonBlankPages.length - 1 && /\n$/.test(c)) {
        c = c.replace(/\n+$/, '');
      }
      combined += c;
      if (i < nonBlankPages.length - 1) {
        const lastLine = c.replace(/\n$/, '').split('\n').pop() || '';
        const nextContent = nonBlankPages[i + 1].content || '';
        const endsMid =
          Boolean(p.endsMidParagraph) ||
          (typeof p.charEnd === 'number' &&
            typeof p.contentEnd === 'number' &&
            p.charEnd === p.contentEnd &&
            c.length > 0) ||
          (global.TategakiTypesetter.isMidSentenceContinuation(lastLine) &&
            nextContent.length > 0 &&
            !/^[　 \t\n「『（【〈《〔｛［“‘]/.test(nextContent));
        if (!endsMid && !/\n$/.test(c) && !/^\n/.test(nextContent)) {
          combined += '\n';
        }
      }
    }
    return combined;
  }

  // =========================================================================
  // 元に戻す（アンドゥ）履歴管理システム
  // =========================================================================
  function clonePagesForHistory(pages) {
    return (pages || []).map(function (p) {
      const copy = JSON.parse(JSON.stringify(p));
      delete copy._precomputedLines;
      return copy;
    });
  }

  function updateUndoButtonState() {
    const btn = document.getElementById('btn-undo-action');
    if (!btn) return;
    btn.disabled = App.undoStack.length === 0;
  }

  function pushUndoSnapshot(actionLabel) {
    const bodyTextarea = document.getElementById('editor-body-textarea');
    const snap = {
      pages: clonePagesForHistory(App.pages),
      activePageIndex: App.activePageIndex,
      selectionStart: bodyTextarea ? bodyTextarea.selectionStart || 0 : 0,
      selectionEnd: bodyTextarea ? bodyTextarea.selectionEnd || 0 : 0,
      scrollTop: bodyTextarea ? bodyTextarea.scrollTop || 0 : 0,
      label: actionLabel || '編集'
    };

    if (App.undoStack.length > 0) {
      const last = App.undoStack[App.undoStack.length - 1];
      if (
        last.activePageIndex === snap.activePageIndex &&
        JSON.stringify(last.pages) === JSON.stringify(snap.pages)
      ) {
        return;
      }
    }

    App.undoStack.push(snap);
    if (App.undoStack.length > 50) {
      App.undoStack.shift();
    }
    updateUndoButtonState();
  }

  function performUndo() {
    if (App.undoStack.length === 0) {
      showToast('これ以上元に戻せる履歴がありません');
      return;
    }

    const snap = App.undoStack.pop();
    App.hasPendingTypingUndo = false;
    clearTimeout(App.typingUndoTimer);

    App.pages = snap.pages;
    App.activePageIndex = Math.min(snap.activePageIndex, Math.max(0, App.pages.length - 1));
    repaginateAllLinkedSections({ fromPageContents: false });
    App.selectedPageIds = App.pages.map(function (p) {
      return p.id;
    });

    syncEditorToCurrentPage({ forceReloadText: true });

    const bodyTextarea = document.getElementById('editor-body-textarea');
    if (bodyTextarea) {
      const maxLen = bodyTextarea.value.length;
      bodyTextarea.focus();
      bodyTextarea.selectionStart = Math.min(maxLen, snap.selectionStart || 0);
      bodyTextarea.selectionEnd = Math.min(maxLen, snap.selectionEnd || 0);
      bodyTextarea.scrollTop = snap.scrollTop || 0;
    }

    renderSpreadPreview();
    renderPageStripAndCounters();
    saveToLocalStorage();
    updateUndoButtonState();
    showToast('元に戻しました' + (snap.label ? '（' + snap.label + '）' : ''));
  }

  /**
   * 1つの本文連動区間 [startIdx .. endIdx] に対して、連なったテキスト(sectionText)を元に
   * リアルタイム自動ページ割りを適用し、App.pages の該当範囲を更新する。
   * 区間内に「空白(blank)」属性ページが含まれる場合は、そのページ位置を維持したまま空白ページを飛ばして本文を配する。
   */
  function paginateAndReplaceSection(startIdx, endIdx, sectionText) {
    const existingPages = App.pages.slice(startIdx, endIdx + 1);
    const templatePage = existingPages[0] || {
      id: 'page-' + Date.now(),
      type: 'body',
      flowBreakBefore: false,
      fontOverride: null
    };

    const anySelected = existingPages.some(function (p) {
      return App.selectedPageIds.indexOf(p.id) !== -1;
    });
    const oldIdsSet = new Set(
      existingPages.map(function (p) {
        return p.id;
      })
    );

    const startPageNum = (App.settings.headerFooter.startPageNumber || 1) + startIdx;

    // 既存の「空白(blank)」属性ページの区間内相対位置と「本文(body)」ページを分離
    const blankPageEntries = [];
    const existingBodyPages = [];
    const reservedBlankPageNums = new Set();
    existingPages.forEach(function (p, relIdx) {
      if (p && p.type === 'blank') {
        blankPageEntries.push({
          relIdx: relIdx,
          page: p
        });
        reservedBlankPageNums.add(startPageNum + relIdx);
      } else if (p) {
        existingBodyPages.push(p);
      }
    });

    // テキスト内に [連動区切り] タグが含まれている場合は複数区間へ分割
    const normalizedText = String(sectionText || '');
    const splitParts = normalizedText.split(/\n?[［\[]連動区切り[］\]]\n?/g);
    const newPages = [];
    const firstSectionSlices = [];
    let reuseCursor = 0;
    let blankCursor = 0;

    function pushBlankPageEntry(entry, partIdx, forceSectionStartBreak) {
      const bp = entry.page;
      const isFirstInNewPages = newPages.length === 0;
      const blankObj = {
        id:
          bp.id ||
          'page-blank-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
        type: 'blank',
        flowBreakBefore: isFirstInNewPages
          ? Boolean(templatePage.flowBreakBefore)
          : Boolean(forceSectionStartBreak),
        isBlankAdjustment: false,
        tobiraData: null,
        tocData: null,
        content: '',
        rawSlice: '',
        charStart: 0,
        charEnd: 0,
        contentEnd: 0,
        usedLines: 0,
        startsMidParagraph: false,
        endsMidParagraph: false,
        _precomputedLines: [],
        fontOverride: bp.fontOverride ? Object.assign({}, bp.fontOverride) : null
      };
      newPages.push(blankObj);
      if (partIdx === 0) {
        firstSectionSlices.push(blankObj);
      }
    }

    function flushBlankPagesUpToCurrentPosition(partIdx, isAtPartStart) {
      let firstFlushed = true;
      while (
        blankCursor < blankPageEntries.length &&
        blankPageEntries[blankCursor].relIdx <= newPages.length
      ) {
        const entry = blankPageEntries[blankCursor++];
        const forceBreak = firstFlushed && isAtPartStart && partIdx > 0;
        pushBlankPageEntry(entry, partIdx, forceBreak);
        firstFlushed = false;
      }
      return !firstFlushed;
    }

    // 区間内が「空白」ページのみで、かつ本文テキストも空の場合は空白ページのみを維持する
    if (
      splitParts.length === 1 &&
      normalizedText.length === 0 &&
      existingBodyPages.length === 0 &&
      blankPageEntries.length > 0
    ) {
      while (blankCursor < blankPageEntries.length) {
        pushBlankPageEntry(blankPageEntries[blankCursor++], 0, false);
      }
    } else {
      splitParts.forEach(function (partText, partIdx) {
        const runningPageNum = startPageNum + newPages.length;
        const slices = global.TategakiTypesetter.paginateFlowText(
          partText,
          App.settings,
          runningPageNum,
          partIdx === 0 ? reservedBlankPageNums : null
        );
        slices.forEach(function (slice, sliceIdx) {
          const flushedBlankAtStart = flushBlankPagesUpToCurrentPosition(
            partIdx,
            sliceIdx === 0
          );

          const reusePage =
            reuseCursor < existingBodyPages.length ? existingBodyPages[reuseCursor++] : null;
          const pageId = reusePage
            ? reusePage.id
            : 'page-' +
              Date.now() +
              '-' +
              partIdx +
              '-' +
              sliceIdx +
              '-' +
              Math.random().toString(36).slice(2, 6);

          const isFirstInNewPages = newPages.length === 0;
          const isFlowBreak = isFirstInNewPages
            ? Boolean(templatePage.flowBreakBefore)
            : sliceIdx === 0 && partIdx > 0 && !flushedBlankAtStart;

          const bodyPageObj = {
            id: pageId,
            type: 'body',
            flowBreakBefore: isFlowBreak,
            isBlankAdjustment: Boolean(slice.isBlankAdjustment),
            tobiraData: null,
            tocData: null,
            content: slice.content,
            rawSlice: slice.rawSlice,
            charStart: slice.charStart,
            charEnd: slice.charEnd,
            contentEnd: slice.contentEnd,
            usedLines: slice.usedLines,
            startsMidParagraph: Boolean(slice.startsMidParagraph),
            endsMidParagraph: Boolean(slice.endsMidParagraph),
            _precomputedLines: slice._precomputedLines,
            fontOverride:
              reusePage && reusePage.fontOverride
                ? Object.assign({}, reusePage.fontOverride)
                : templatePage.fontOverride
                ? Object.assign({}, templatePage.fontOverride)
                : null
          };

          newPages.push(bodyPageObj);
          if (partIdx === 0) {
            firstSectionSlices.push(bodyPageObj);
          }

          flushBlankPagesUpToCurrentPosition(partIdx, false);
        });
      });

      // 本文ページ数が減った場合や区間末尾に「空白」ページがある場合も消失させず末尾に維持する
      while (blankCursor < blankPageEntries.length) {
        pushBlankPageEntry(blankPageEntries[blankCursor++], 0, false);
      }
    }

    // App.pages の [startIdx .. endIdx] を newPages で置き換え
    App.pages.splice.apply(
      App.pages,
      [startIdx, endIdx - startIdx + 1].concat(newPages)
    );

    // 選択ページIDリストの整合性を維持
    const newIdsSet = new Set(
      newPages.map(function (p) {
        return p.id;
      })
    );
    App.selectedPageIds = App.selectedPageIds.filter(function (id) {
      return !oldIdsSet.has(id) || newIdsSet.has(id);
    });
    if (anySelected) {
      newPages.forEach(function (p) {
        if (App.selectedPageIds.indexOf(p.id) === -1) {
          App.selectedPageIds.push(p.id);
        }
      });
    }

    return {
      startIdx: startIdx,
      endIdx: startIdx + newPages.length - 1,
      slices: firstSectionSlices,
      hadInlineSectionSplit: splitParts.length > 1
    };
  }

  /**
   * 文書内のすべての「本文連動区間」を現在のレイアウト・組版設定で再ページ割りする
   */
  function repaginateAllLinkedSections(options) {
    const opts = options || {};
    const activePageBefore = App.pages[App.activePageIndex];
    const activeIdBefore = activePageBefore ? activePageBefore.id : null;

    let idx = 0;
    while (idx < App.pages.length) {
      const p = App.pages[idx];
      if (!isFlowSectionPage(p)) {
        idx++;
        continue;
      }
      const range = getLinkedBodySectionRange(idx);
      const combinedText = getSectionCombinedText(
        range.startIdx,
        range.endIdx,
        Boolean(opts.fromPageContents)
      );
      const res = paginateAndReplaceSection(range.startIdx, range.endIdx, combinedText);
      idx = res.endIdx + 1;
    }

    if (activeIdBefore) {
      const foundIdx = App.pages.findIndex(function (p) {
        return p.id === activeIdBefore;
      });
      if (foundIdx !== -1) {
        App.activePageIndex = foundIdx;
      }
    }
    if (App.activePageIndex >= App.pages.length) {
      App.activePageIndex = Math.max(0, App.pages.length - 1);
    }
  }

  /**
   * 連動区間テキスト内のカーソル位置(cursorOffset)がどのページスライスに属するかを判定
   * （改丁調整空白頁や「空白(blank)」属性ページは飛ばして本文ページを返す）
   */
  function findSliceIndexForCursor(slices, cursorOffset, preferredRelIdx) {
    if (!slices || slices.length <= 1) return 0;
    const pos = Math.max(0, cursorOffset || 0);

    const bodyIndices = [];
    for (let i = 0; i < slices.length; i++) {
      const s = slices[i];
      if (!s || s.isBlankAdjustment || s.type === 'blank') continue;
      bodyIndices.push(i);
    }
    if (bodyIndices.length === 0) return 0;
    if (bodyIndices.length === 1) return bodyIndices[0];

    for (let k = 0; k < bodyIndices.length; k++) {
      const i = bodyIndices[k];
      const s = slices[i];
      if (k === bodyIndices.length - 1) return i;

      const nextBodyIdx = bodyIndices[k + 1];

      // 改行または[改ページ]でページが区切られた場合 (charEnd > contentEnd)
      if (s.charEnd > s.contentEnd) {
        if (pos < s.charEnd) {
          return i;
        }
      } else {
        // 段落途中の自動折り返しでページが区切られた場合 (charEnd === contentEnd)
        if (pos < s.charEnd) {
          return i;
        }
        if (pos === s.charEnd) {
          if (preferredRelIdx === nextBodyIdx) {
            return nextBodyIdx;
          }
          return i;
        }
      }
    }
    return bodyIndices[bodyIndices.length - 1];
  }

  /**
   * 本文テキストエリア入力時のリアルタイム連動ページ割り処理
   */
  function handleLiveBodySectionInput() {
    const bodyTextarea = document.getElementById('editor-body-textarea');
    const page = getCurrentPage();
    if (!bodyTextarea || !page) return;

    // 空白属性ページの場合は本文入力を行わない
    if (page.type === 'blank') {
      return;
    }

    // 扉ページ・目次ページの自由テキスト欄の場合
    if (page.type !== 'body') {
      page.content = bodyTextarea.value;
      updateCurrentPageLineUsage();
      scheduleRender();
      return;
    }

    const range = getLinkedBodySectionRange(App.activePageIndex);
    if (!range) return;

    const cursorOffset = bodyTextarea.selectionStart || 0;
    const prevRelIdx = App.activePageIndex - range.startIdx;
    const res = paginateAndReplaceSection(range.startIdx, range.endIdx, bodyTextarea.value);

    // インラインで [連動区切り] が入力された場合は区間を再同期
    if (res.hadInlineSectionSplit) {
      App.activePageIndex = Math.min(App.pages.length - 1, res.endIdx);
      syncEditorToCurrentPage({ forceReloadText: true });
      renderSpreadPreview();
      renderPageStripAndCounters();
      saveToLocalStorage();
      showToast('本文内の [連動区切り] に従って連動区間を分割しました');
      return;
    }

    const targetRelIdx = findSliceIndexForCursor(res.slices, cursorOffset, prevRelIdx);
    App.activePageIndex = Math.min(res.endIdx, range.startIdx + targetRelIdx);
    App.currentRenderedSectionStart = range.startIdx;

    // テキストエリアの値とカーソル位置は一切書き換えず、ヘッダー・連動バー・プレビューのみ即時更新
    if (App.searchQuery) {
      collectBodySearchMatches(App.searchQuery);
    }
    updateEditorHeaderAndSectionIndicators();
    schedulePreviewAndCounterRender();
  }

  /**
   * テキストエリア内でカーソル移動（クリック・矢印キー）した際にプレビューの表示ページを追従させる
   */
  function syncActivePageFromTextareaCursor() {
    const bodyTextarea = document.getElementById('editor-body-textarea');
    const page = getCurrentPage();
    if (!bodyTextarea || !page || page.type !== 'body') return;

    const range = getLinkedBodySectionRange(App.activePageIndex);
    if (!range) return;

    const sectionPages = App.pages.slice(range.startIdx, range.endIdx + 1);
    const cursorOffset = bodyTextarea.selectionStart || 0;
    const prevRelIdx = App.activePageIndex - range.startIdx;
    const nextRelIdx = findSliceIndexForCursor(sectionPages, cursorOffset, prevRelIdx);
    const nextPageIdx = range.startIdx + nextRelIdx;

    if (nextPageIdx !== App.activePageIndex && nextPageIdx >= 0 && nextPageIdx < App.pages.length) {
      App.activePageIndex = nextPageIdx;
      updateEditorHeaderAndSectionIndicators();
      renderSpreadPreview();
      renderPageStripAndCounters();
    }
  }

  /**
   * エディタ上部の現在ページバッジ・連動区間バー・行数バッジを更新（textarea本体は触らない）
   */
  function updateEditorHeaderAndSectionIndicators() {
    const page = getCurrentPage();
    if (!page) return;

    const startNum = App.settings.headerFooter.startPageNumber || 1;
    const pageNum = startNum + App.activePageIndex;
    const isEven = pageNum % 2 === 0;

    const titleBadge = document.getElementById('editor-current-page-label');
    if (titleBadge) {
      titleBadge.textContent =
        'P.' +
        pageNum +
        ' (' +
        (isEven ? '偶数頁・見開き右' : '奇数頁・見開き左') +
        ')';
    }

    document.querySelectorAll('.page-type-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-page-type') === page.type);
    });

    renderLinkedSectionBar();
    updateCurrentPageLineUsage();
    renderEditorPageBgBackdrop();
  }

  function escapeHtmlForBackdrop(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function syncEditorBackdropScroll() {
    const bodyTextarea = document.getElementById('editor-body-textarea');
    const backdropEl = document.getElementById('editor-page-bg-backdrop');
    const backdropContentEl = document.getElementById('editor-page-bg-content');
    if (!bodyTextarea || !backdropEl || !backdropContentEl) return;
    if (bodyTextarea.clientWidth > 0) {
      backdropContentEl.style.width = bodyTextarea.clientWidth + 'px';
    }
    backdropEl.scrollTop = bodyTextarea.scrollTop;
    backdropEl.scrollLeft = bodyTextarea.scrollLeft;
  }

  /**
   * 本文テキストエリア背面の割付ページ別背景ハイライト描画
   */
  function renderEditorPageBgBackdrop() {
    const stageEl = document.getElementById('editor-textarea-stage');
    const backdropEl = document.getElementById('editor-page-bg-backdrop');
    const backdropContentEl = document.getElementById('editor-page-bg-content');
    const bodyTextarea = document.getElementById('editor-body-textarea');
    if (!stageEl || !backdropEl || !backdropContentEl || !bodyTextarea) return;

    const page = getCurrentPage();
    const enabled = Boolean(
      App.settings &&
        App.settings.rules &&
        App.settings.rules.showPageBgHighlight &&
        page &&
        page.type === 'body'
    );

    if (!enabled) {
      stageEl.classList.remove('has-page-bg-highlight');
      backdropEl.style.display = 'none';
      backdropContentEl.innerHTML = '';
      return;
    }

    stageEl.classList.add('has-page-bg-highlight');
    backdropEl.style.display = 'block';

    const startNum = App.settings.headerFooter.startPageNumber || 1;
    const range = getLinkedBodySectionRange(App.activePageIndex);
    let html = '';

    if (range) {
      let bodySeqIndex = 0;
      let lastRawEndedWithNewline = false;
      for (let k = range.startIdx; k <= range.endIdx; k++) {
        const p = App.pages[k];
        if (!p || p.type === 'blank') continue;
        const raw = typeof p.rawSlice === 'string' ? p.rawSlice : p.content || '';
        const toneIdx = bodySeqIndex % 3;
        bodySeqIndex++;
        if (!raw) continue;
        const pageNum = startNum + k;
        const activeCls = k === App.activePageIndex ? ' is-active-page' : '';
        lastRawEndedWithNewline = raw.endsWith('\n');
        html +=
          '<span class="editor-page-chunk tone-' +
          toneIdx +
          activeCls +
          '" data-page-badge="P.' +
          pageNum +
          '">' +
          escapeHtmlForBackdrop(raw) +
          '</span>';
      }
      if (lastRawEndedWithNewline) {
        html += '\u200b';
      }
    } else {
      const raw = bodyTextarea.value || '';
      if (raw) {
        const pageNum = startNum + App.activePageIndex;
        html =
          '<span class="editor-page-chunk tone-0 is-active-page" data-page-badge="P.' +
          pageNum +
          '">' +
          escapeHtmlForBackdrop(raw) +
          (raw.endsWith('\n') ? '\u200b' : '') +
          '</span>';
      }
    }

    backdropContentEl.innerHTML = html;
    syncEditorBackdropScroll();
  }

  /**
   * 本文連動区間バー（連動中のページ範囲ピル・連動区切りボタン・結合ボタン）の描画
   */
  function renderLinkedSectionBar() {
    const bar = document.getElementById('linked-section-bar');
    const badgeEl = document.getElementById('linked-section-badge');
    const pillsContainer = document.getElementById('linked-section-page-pills');
    const btnToggleBreak = document.getElementById('btn-toggle-page-flow-break');
    const page = getCurrentPage();

    if (!bar || !page) return;

    if (!isFlowSectionPage(page)) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';

    const startNum = App.settings.headerFooter.startPageNumber || 1;
    const allSections = getAllLinkedBodySections();
    const curRange = getLinkedBodySectionRange(App.activePageIndex);
    if (!curRange) return;

    const curSectionObj = allSections.find(function (s) {
      return s.startIdx === curRange.startIdx;
    });
    const sectionNum = curSectionObj ? curSectionObj.sectionNumber : 1;
    const totalSections = allSections.length;
    const startPageNum = startNum + curRange.startIdx;
    const endPageNum = startNum + curRange.endIdx;
    const pageCount = curRange.endIdx - curRange.startIdx + 1;

    if (badgeEl) {
      badgeEl.textContent =
        '🔗 本文連動区間 ' +
        sectionNum +
        '/' +
        totalSections +
        ' ： ' +
        (pageCount === 1
          ? 'P.' + startPageNum + ' (1頁)'
          : 'P.' + startPageNum + '〜P.' + endPageNum + ' (' + pageCount + '頁が連なって自動ページ割り中)');
    }

    // 「この頁から連動を区切る / 前の区間と連動結合」ボタンのラベルと動作状態を動的に更新
    if (btnToggleBreak) {
      const idx = App.activePageIndex;
      const hasPrevBody = idx > 0 && isFlowSectionPage(App.pages[idx - 1]);
      const hasNextBody =
        idx + 1 < App.pages.length && isFlowSectionPage(App.pages[idx + 1]);

      btnToggleBreak.classList.remove('is-merge', 'is-split');

      if (hasPrevBody) {
        if (page.flowBreakBefore) {
          btnToggleBreak.textContent =
            '🔗 前の頁(P.' + (startNum + idx - 1) + ')と連動結合';
          btnToggleBreak.classList.add('is-merge');
          btnToggleBreak.disabled = false;
        } else {
          btnToggleBreak.textContent =
            '✂ この頁(P.' + (startNum + idx) + ')から連動を区切る';
          btnToggleBreak.classList.add('is-split');
          btnToggleBreak.disabled = false;
        }
      } else if (hasNextBody) {
        const nextPage = App.pages[idx + 1];
        if (nextPage.flowBreakBefore) {
          btnToggleBreak.textContent =
            '🔗 次頁(P.' + (startNum + idx + 1) + ')の区間と連動結合';
          btnToggleBreak.classList.add('is-merge');
          btnToggleBreak.disabled = false;
        } else {
          btnToggleBreak.textContent =
            '✂ 次頁(P.' + (startNum + idx + 1) + ')以降と連動を区切る';
          btnToggleBreak.classList.add('is-split');
          btnToggleBreak.disabled = false;
        }
      } else {
        btnToggleBreak.textContent = '✂ ページ境界での連動区切り（前後本文頁なし）';
        btnToggleBreak.disabled = true;
      }
    }

    // 全連動区間のページピル＆区切りバッジを描画
    if (pillsContainer) {
      pillsContainer.innerHTML = '';

      allSections.forEach(function (sec, sIdx) {
        // 前の本文連動区間と隣接している場合は「✂区切り中（クリックで結合）」バッジを表示
        if (sIdx > 0 && allSections[sIdx - 1].endIdx === sec.startIdx - 1) {
          const dividerBtn = document.createElement('button');
          dividerBtn.type = 'button';
          dividerBtn.className = 'flow-break-divider-pill';
          dividerBtn.textContent = '✂ 区切り中 (結合)';
          dividerBtn.title =
            'P.' +
            (startNum + sec.startIdx - 1) +
            ' と P.' +
            (startNum + sec.startIdx) +
            ' の間の連動区切りを解除して1つの連動区間に結合します';
          dividerBtn.addEventListener('click', function () {
            togglePageFlowBreak(sec.startIdx);
          });
          pillsContainer.appendChild(dividerBtn);
        }

        const groupEl = document.createElement('div');
        groupEl.className =
          'flow-section-group' + (sec.startIdx === curRange.startIdx ? ' active-section' : '');

        const labelSpan = document.createElement('span');
        labelSpan.className = 'flow-section-label';
        labelSpan.textContent = '区間' + sec.sectionNumber + ':';
        groupEl.appendChild(labelSpan);

        for (let pIdx = sec.startIdx; pIdx <= sec.endIdx; pIdx++) {
          const pObj = App.pages[pIdx];
          const pNum = startNum + pIdx;
          const pill = document.createElement('button');
          pill.type = 'button';
          pill.className =
            'flow-page-pill' + (pIdx === App.activePageIndex ? ' active-page' : '');
          const pillSuffix =
            pObj && pObj.type === 'blank'
              ? '(空白)'
              : pObj && pObj.isBlankAdjustment
              ? '(空)'
              : '';
          pill.textContent = 'P.' + pNum + pillSuffix;
          pill.title =
            'P.' +
            pNum +
            (pObj && pObj.type === 'blank'
              ? '（空白ページ：本文を飛ばして連動します）へ移動'
              : ' へ移動（同区間内はテキストが連なって連動します）');
          pill.addEventListener('click', function () {
            selectActivePage(pIdx, { scrollEditorToPage: true });
          });
          groupEl.appendChild(pill);
        }

        pillsContainer.appendChild(groupEl);
      });
    }
  }

  /**
   * 現在のカーソル位置で本文の連動を区切り、カーソル以降のテキストを新しい独立した連動区間へ分割する
   */
  function splitLinkedSectionAtCursor() {
    const bodyTextarea = document.getElementById('editor-body-textarea');
    const page = getCurrentPage();
    if (!bodyTextarea || !page || page.type !== 'body') {
      showToast('「本文」属性のページ編集中に実行してください', true);
      return;
    }

    const range = getLinkedBodySectionRange(App.activePageIndex);
    if (!range) return;

    const fullText = bodyTextarea.value;
    let splitPos = bodyTextarea.selectionStart || 0;

    // カーソルが先頭にある場合で、かつ2ページ目以降が選択されている場合はそのページの先頭で区切る
    if (splitPos <= 0 && App.activePageIndex > range.startIdx) {
      togglePageFlowBreak(App.activePageIndex);
      return;
    }

    if (splitPos <= 0 || splitPos >= fullText.length) {
      showToast(
        '連動を区切りたい文章の途中にカーソルを置いて押すか、「この頁から連動を区切る」を使用してください',
        true
      );
      return;
    }

    const beforeText = fullText.slice(0, splitPos).replace(/\n$/, '');
    const afterText = fullText.slice(splitPos).replace(/^\n/, '');

    pushUndoSnapshot('カーソル位置で連動区切り');

    // 前半テキストを現在の連動区間に適用
    const firstRes = paginateAndReplaceSection(range.startIdx, range.endIdx, beforeText);
    const newSectionInsertIdx = firstRes.endIdx + 1;

    // 後半テキストを flowBreakBefore: true の新しい独立連動区間として挿入
    const secondSeedPage = {
      id: 'page-' + Date.now() + '-split-' + Math.random().toString(36).slice(2, 6),
      type: 'body',
      flowBreakBefore: true,
      tobiraData: null,
      tocData: null,
      content: afterText,
      fontOverride: page.fontOverride ? Object.assign({}, page.fontOverride) : null
    };
    App.pages.splice(newSectionInsertIdx, 0, secondSeedPage);
    App.selectedPageIds.push(secondSeedPage.id);

    paginateAndReplaceSection(newSectionInsertIdx, newSectionInsertIdx, afterText);

    App.activePageIndex = newSectionInsertIdx;
    syncEditorToCurrentPage({ forceReloadText: true, scrollToActivePage: true });
    renderSpreadPreview();
    renderPageStripAndCounters();
    saveToLocalStorage();

    const startNum = App.settings.headerFooter.startPageNumber || 1;
    showToast(
      'カーソル位置で本文連動を区切りました（P.' +
        (startNum + newSectionInsertIdx) +
        ' 以降を新しい独立区間に分割）'
    );
  }

  /**
   * 指定ページ（または現在のアクティブページ境界）での「連動区切り(flowBreakBefore)」をON/OFF切り替え
   */
  function togglePageFlowBreak(explicitPageIndex) {
    const startNum = App.settings.headerFooter.startPageNumber || 1;
    let targetIdx =
      typeof explicitPageIndex === 'number' ? explicitPageIndex : App.activePageIndex;

    const curPage = App.pages[targetIdx];
    if (!isFlowSectionPage(curPage)) return;

    const hasPrevBody =
      targetIdx > 0 && isFlowSectionPage(App.pages[targetIdx - 1]);
    const hasNextBody =
      targetIdx + 1 < App.pages.length &&
      isFlowSectionPage(App.pages[targetIdx + 1]);

    // 区間の先頭ページ（前が扉・目次）でボタンを押した場合は、次ページとの境界を対象にする
    if (!hasPrevBody && hasNextBody && explicitPageIndex === undefined) {
      targetIdx = targetIdx + 1;
    } else if (!hasPrevBody) {
      showToast('前後に連動可能な本文ページがありません', true);
      return;
    }

    const boundaryPage = App.pages[targetIdx];
    if (!isFlowSectionPage(boundaryPage)) return;

    pushUndoSnapshot('連動区切りの切替');

    if (boundaryPage.flowBreakBefore) {
      // 【結合】連動区切りを解除して前の区間と1つに繋げる
      const prevRange = getLinkedBodySectionRange(targetIdx - 1);
      const curRange = getLinkedBodySectionRange(targetIdx);
      const prevText = getSectionCombinedText(prevRange.startIdx, prevRange.endIdx);
      const curText = getSectionCombinedText(curRange.startIdx, curRange.endIdx);
      const mergedText =
        prevText && curText ? prevText + '\n' + curText : prevText + curText;

      boundaryPage.flowBreakBefore = false;
      paginateAndReplaceSection(prevRange.startIdx, curRange.endIdx, mergedText);

      App.activePageIndex = Math.min(App.activePageIndex, App.pages.length - 1);
      syncEditorToCurrentPage({ forceReloadText: true, scrollToActivePage: true });
      renderSpreadPreview();
      renderPageStripAndCounters();
      saveToLocalStorage();

      showToast(
        'P.' +
          (startNum + targetIdx) +
          ' の連動区切りを解除し、前の本文区間と連動結合しました'
      );
    } else {
      // 【分割】このページから新しい独立した連動区間に区切る
      const fullRange = getLinkedBodySectionRange(targetIdx);
      const firstText = getSectionCombinedText(fullRange.startIdx, targetIdx - 1, true);
      const secondText = getSectionCombinedText(targetIdx, fullRange.endIdx, true);

      boundaryPage.flowBreakBefore = true;
      const firstRes = paginateAndReplaceSection(
        fullRange.startIdx,
        targetIdx - 1,
        firstText
      );
      const newSecondStart = firstRes.endIdx + 1;
      const newSecondEnd =
        newSecondStart + (fullRange.endIdx - targetIdx);
      if (App.pages[newSecondStart]) {
        App.pages[newSecondStart].flowBreakBefore = true;
      }
      paginateAndReplaceSection(newSecondStart, newSecondEnd, secondText);

      App.activePageIndex = newSecondStart;
      syncEditorToCurrentPage({ forceReloadText: true, scrollToActivePage: true });
      renderSpreadPreview();
      renderPageStripAndCounters();
      saveToLocalStorage();

      showToast(
        'P.' +
          (startNum + newSecondStart) +
          ' から本文の連動を区切りました（前の区間と独立してページ割りされます）'
      );
    }
  }

  /**
   * 現在の連動区間の直後に、連動を区切った新しい本文区間（新章など）を追加する
   */
  function addNewLinkedSectionAfterCurrent() {
    pushUndoSnapshot('新規連動区間の追加');
    const curPage = getCurrentPage();
    let insertPos = App.activePageIndex + 1;
    if (isFlowSectionPage(curPage)) {
      const range = getLinkedBodySectionRange(App.activePageIndex);
      if (range) {
        insertPos = range.endIdx + 1;
      }
    }

    const newPage = {
      id: 'page-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      type: 'body',
      flowBreakBefore: true,
      tobiraData: null,
      tocData: null,
      content: '　新しい章の本文をここに入力します。',
      fontOverride: null
    };

    App.pages.splice(insertPos, 0, newPage);
    App.selectedPageIds.push(newPage.id);
    paginateAndReplaceSection(insertPos, insertPos, newPage.content);

    App.activePageIndex = insertPos;
    syncEditorToCurrentPage({ forceReloadText: true, scrollToActivePage: true });
    renderAll();

    const startNum = App.settings.headerFooter.startPageNumber || 1;
    showToast(
      'P.' +
        (startNum + insertPos) +
        ' に連動を区切った新しい本文区間を追加しました'
    );
  }

  // =========================================================================
  // エディタ領域のバインディング（記法挿入、常時連動ページ割り）
  // ※上部のページ属性表示（.page-type-btn）は現在表示中ページの属性表示専用（クリック切替不可）
  // =========================================================================
  function bindEditorControls() {
    // ページ別フォント・文字サイズ個別オーバーライド
    onInput('page-font-override', function (val) {
      const page = getCurrentPage();
      if (!page) return;
      if (!page.fontOverride) page.fontOverride = {};
      page.fontOverride.fontId = val || null;
      if (!page.fontOverride.fontId && !page.fontOverride.fontSizePt) {
        page.fontOverride = null;
      }
      scheduleRender();
    });

    onInput('page-size-override', function (val) {
      const page = getCurrentPage();
      if (!page) return;
      const num = parseFloat(val);
      if (!page.fontOverride) page.fontOverride = {};
      page.fontOverride.fontSizePt = !isNaN(num) && num > 0 ? num : null;
      if (!page.fontOverride.fontId && !page.fontOverride.fontSizePt) {
        page.fontOverride = null;
      }
      scheduleRender();
    });

    // 本文テキストエリア入力（常時リアルタイム自動ページ割り＆カーソル位置連動＆アンドゥ記録）
    const bodyTextarea = document.getElementById('editor-body-textarea');
    if (bodyTextarea) {
      bodyTextarea.addEventListener('keydown', function (e) {
        // Ctrl+Z / Cmd+Z で元に戻す（アンドゥ）
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
          if (App.undoStack.length > 0) {
            e.preventDefault();
            performUndo();
            return;
          }
        }

        // 連続検索の選択ハイライト中に Enter または F3 が押された場合は、改行を入力せず次を検索
        if (
          (e.key === 'F3') ||
          (e.key === 'Enter' && App.isSearchSelectionActive && App.searchMatches.length > 0)
        ) {
          e.preventDefault();
          executeBodySearchStep(e.shiftKey ? -1 : 1);
          return;
        }

        App.isSearchSelectionActive = false;

        // 通常の文字入力・削除開始時にタイピング直前の状態をアンドゥ履歴へ保存
        const isNavKey =
          e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' ||
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight' ||
          e.key === 'PageUp' ||
          e.key === 'PageDown' ||
          e.key === 'Home' ||
          e.key === 'End' ||
          e.key === 'Shift' ||
          e.key === 'Control' ||
          e.key === 'Alt' ||
          e.key === 'Meta' ||
          e.key === 'Escape';

        if (!isNavKey && !e.ctrlKey && !e.metaKey && !App.hasPendingTypingUndo) {
          pushUndoSnapshot('本文入力');
          App.hasPendingTypingUndo = true;
        }
        clearTimeout(App.typingUndoTimer);
        App.typingUndoTimer = setTimeout(function () {
          App.hasPendingTypingUndo = false;
        }, 900);
      });

      bodyTextarea.addEventListener('paste', function () {
        if (!App.hasPendingTypingUndo) {
          pushUndoSnapshot('貼り付け');
          App.hasPendingTypingUndo = true;
        }
      });

      bodyTextarea.addEventListener('cut', function () {
        if (!App.hasPendingTypingUndo) {
          pushUndoSnapshot('切り取り');
          App.hasPendingTypingUndo = true;
        }
      });

      bodyTextarea.addEventListener('compositionstart', function () {
        if (!App.hasPendingTypingUndo) {
          pushUndoSnapshot('本文入力');
          App.hasPendingTypingUndo = true;
        }
        App.isComposingIme = true;
      });
      bodyTextarea.addEventListener('compositionend', function () {
        App.isComposingIme = false;
        handleLiveBodySectionInput();
      });
      bodyTextarea.addEventListener('input', function () {
        App.isSearchSelectionActive = false;
        handleLiveBodySectionInput();
      });
      bodyTextarea.addEventListener('click', function () {
        App.isSearchSelectionActive = false;
        syncActivePageFromTextareaCursor();
      });
      bodyTextarea.addEventListener('keyup', function (e) {
        if (
          e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' ||
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight' ||
          e.key === 'PageUp' ||
          e.key === 'PageDown' ||
          e.key === 'Home' ||
          e.key === 'End'
        ) {
          syncActivePageFromTextareaCursor();
        }
      });
      bodyTextarea.addEventListener('scroll', function () {
        syncEditorBackdropScroll();
      });
      window.addEventListener('resize', function () {
        syncEditorBackdropScroll();
      });
    }

    // 元に戻す（アンドゥ）ボタン
    bindClick('btn-undo-action', function () {
      performUndo();
    });

    // 本文内検索機能（入力・Enter連続検索・前/次ボタン）
    const searchInput = document.getElementById('editor-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function () {
        App.searchQuery = searchInput.value;
        App.searchCurrentIndex = -1;
        collectBodySearchMatches(App.searchQuery);
        renderSpreadPreview();
      });
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          executeBodySearchStep(e.shiftKey ? -1 : 1);
        }
      });
    }
    bindClick('btn-search-next', function () {
      executeBodySearchStep(1);
    });
    bindClick('btn-search-prev', function () {
      executeBodySearchStep(-1);
    });

    // 連動区切り・区間管理ボタン
    bindClick('btn-split-flow-at-cursor', function () {
      splitLinkedSectionAtCursor();
    });
    bindClick('btn-toggle-page-flow-break', function () {
      togglePageFlowBreak();
    });
    bindClick('btn-add-new-flow-section', function () {
      addNewLinkedSectionAfterCurrent();
    });

    // 扉ページ専用入力フォーム
    ['tobira-title', 'tobira-subtitle', 'tobira-author', 'tobira-note'].forEach(function (fieldId) {
      const el = document.getElementById(fieldId);
      if (!el) return;
      el.addEventListener('input', function () {
        const page = getCurrentPage();
        if (!page || page.type !== 'tobira') return;
        if (!page.tobiraData) page.tobiraData = {};
        const key = fieldId.replace('tobira-', '');
        page.tobiraData[key] = el.value;
        schedulePreviewAndCounterRender();
      });
    });

    // 扉ページの小説タイトル（表題）テキスト位置微調整
    const tobiraOffsetYEl = document.getElementById('tobira-title-offset-y');
    if (tobiraOffsetYEl) {
      tobiraOffsetYEl.addEventListener('input', function () {
        const page = getCurrentPage();
        if (!page || page.type !== 'tobira') return;
        if (!page.tobiraData) page.tobiraData = {};
        const num = parseFloat(tobiraOffsetYEl.value);
        const yMm = isNaN(num) ? 18 : num;
        page.tobiraData.titleOffsetYMm = yMm;
        App.settings.typography.tobira.titleYOffsetMm = yMm;
        setVal('cfg-tobira-top-offset', yMm);
        schedulePreviewAndCounterRender();
      });
    }
    const tobiraOffsetXEl = document.getElementById('tobira-title-offset-x');
    if (tobiraOffsetXEl) {
      tobiraOffsetXEl.addEventListener('input', function () {
        const page = getCurrentPage();
        if (!page || page.type !== 'tobira') return;
        if (!page.tobiraData) page.tobiraData = {};
        const num = parseFloat(tobiraOffsetXEl.value);
        const xMm = isNaN(num) ? 0 : num;
        page.tobiraData.titleOffsetXMm = xMm;
        App.settings.typography.tobira.titleXOffsetMm = xMm;
        setVal('cfg-tobira-x-offset', xMm);
        schedulePreviewAndCounterRender();
      });
    }
    bindClick('btn-reset-tobira-title-pos', function () {
      const page = getCurrentPage();
      if (!page || page.type !== 'tobira') return;
      if (!page.tobiraData) page.tobiraData = {};
      page.tobiraData.titleOffsetYMm = 18;
      page.tobiraData.titleOffsetXMm = 0;
      App.settings.typography.tobira.titleYOffsetMm = 18;
      App.settings.typography.tobira.titleXOffsetMm = 0;
      setVal('tobira-title-offset-y', 18);
      setVal('tobira-title-offset-x', 0);
      setVal('cfg-tobira-top-offset', 18);
      setVal('cfg-tobira-x-offset', 0);
      schedulePreviewAndCounterRender();
      showToast('小説タイトル（表題）の位置を標準に戻しました');
    });

    // 目次ページ専用入力フォーム
    const tocHeadingInput = document.getElementById('toc-heading-input');
    if (tocHeadingInput) {
      tocHeadingInput.addEventListener('input', function () {
        const page = getCurrentPage();
        if (!page || page.type !== 'toc') return;
        if (!page.tocData) page.tocData = { heading: '目　次', items: [] };
        page.tocData.heading = tocHeadingInput.value;
        schedulePreviewAndCounterRender();
      });
    }

    const btnAddTocItem = document.getElementById('btn-add-toc-item');
    if (btnAddTocItem) {
      btnAddTocItem.addEventListener('click', function () {
        const page = getCurrentPage();
        if (!page || page.type !== 'toc') return;
        if (!page.tocData) page.tocData = { heading: '目　次', items: [] };
        page.tocData.items.push({ title: '新しい章', page: String(App.pages.length) });
        renderTocItemsEditor(page);
        schedulePreviewAndCounterRender();
      });
    }

    const btnAutoCollectToc = document.getElementById('btn-auto-collect-toc');
    if (btnAutoCollectToc) {
      btnAutoCollectToc.addEventListener('click', function () {
        autoCollectTocFromBodyPages();
      });
    }

    // 執筆補助ツールバーボタン（ルビ・縦中横・ダッシュ・三点リーダー・改ページ・改丁）
    bindInsertTagButton('btn-insert-ruby', function (selected) {
      return '｜' + (selected || '親文字') + '《ルビ》';
    });
    bindInsertTagButton('btn-insert-tcy', function (selected) {
      return '[縦中横:' + (selected || '12') + ']';
    });
    bindInsertTagButton('btn-insert-dash', function () {
      return '――';
    });
    bindInsertTagButton('btn-insert-ellipsis', function () {
      return '……';
    });
    bindInsertTagButton('btn-insert-pagebreak', function () {
      return '\n[改ページ]\n';
    });
    bindInsertTagButton('btn-insert-kaicho', function () {
      return '\n[改丁]\n';
    });

    // 文頭の空白1文字（字下げ）忘れ注意喚起＆補完アクション
    bindClick('btn-jump-indent-warning', function () {
      jumpToNextUnindentedLine();
    });
    bindClick('btn-fix-current-line-indent', function () {
      fixCurrentLineIndentation();
    });
  }

  function bindInsertTagButton(btnId, generatorFn) {
    const btn = document.getElementById(btnId);
    const textarea = document.getElementById('editor-body-textarea');
    if (!btn || !textarea) return;
    btn.addEventListener('click', function () {
      const page = getCurrentPage();
      if (page && page.type === 'blank') {
        showToast('「空白」属性のページには本文を入力できません', true);
        return;
      }
      pushUndoSnapshot('記法挿入');
      const start = textarea.selectionStart || 0;
      const end = textarea.selectionEnd || 0;
      const val = textarea.value;
      const selected = val.slice(start, end);
      const replacement = generatorFn(selected);
      textarea.value = val.slice(0, start) + replacement + val.slice(end);
      textarea.focus();
      textarea.selectionStart = start + replacement.length;
      textarea.selectionEnd = start + replacement.length;

      handleLiveBodySectionInput();
    });
  }

  // =========================================================================
  // 本文内検索（連続検索・ページ跨ぎ自動移動対応）
  // =========================================================================
  function collectBodySearchMatches(query) {
    const countEl = document.getElementById('editor-search-count');
    const q = String(query || '');
    App.searchMatches = [];

    if (!q) {
      if (countEl) {
        countEl.textContent = '0/0';
        countEl.className = 'editor-search-count';
      }
      return [];
    }

    const qLower = q.toLowerCase();
    const sections = getAllLinkedBodySections();

    sections.forEach(function (sec) {
      const sectionText = getSectionCombinedText(sec.startIdx, sec.endIdx);
      const textLower = sectionText.toLowerCase();
      const sectionPages = App.pages.slice(sec.startIdx, sec.endIdx + 1);
      let searchFrom = 0;

      while (searchFrom <= textLower.length - qLower.length) {
        const foundPos = textLower.indexOf(qLower, searchFrom);
        if (foundPos === -1) break;

        const relPageIdx = findSliceIndexForCursor(sectionPages, foundPos, 0);
        const pageIndex = Math.min(sec.endIdx, sec.startIdx + relPageIdx);
        const lineNumber = sectionText.slice(0, foundPos).split('\n').length;

        App.searchMatches.push({
          sectionStartIdx: sec.startIdx,
          sectionEndIdx: sec.endIdx,
          pageIndex: pageIndex,
          charStart: foundPos,
          charEnd: foundPos + q.length,
          lineNumber: lineNumber
        });

        searchFrom = foundPos + Math.max(1, q.length);
      }
    });

    if (countEl) {
      if (App.searchMatches.length === 0) {
        countEl.textContent = '0件';
        countEl.className = 'editor-search-count no-matches';
      } else {
        const dispIdx = App.searchCurrentIndex >= 0 ? App.searchCurrentIndex + 1 : 0;
        countEl.textContent = dispIdx + '/' + App.searchMatches.length;
        countEl.className = 'editor-search-count has-matches';
      }
    }

    return App.searchMatches;
  }

  /**
   * 指定したページ（pageIndex）が属する本文連動区間内の検索ヒット一覧をプレビュー描画用に返す
   */
  function getSearchHighlightsForPage(pageIndex) {
    if (!App.searchQuery || !Array.isArray(App.searchMatches) || App.searchMatches.length === 0) {
      return null;
    }
    const page = App.pages[pageIndex];
    if (!page || page.type !== 'body') return null;

    const highlights = [];
    for (let i = 0; i < App.searchMatches.length; i++) {
      const m = App.searchMatches[i];
      if (pageIndex >= m.sectionStartIdx && pageIndex <= m.sectionEndIdx) {
        highlights.push({
          charStart: m.charStart,
          charEnd: m.charEnd,
          isCurrent: i === App.searchCurrentIndex
        });
      }
    }
    return highlights.length > 0 ? highlights : null;
  }

  function executeBodySearchStep(direction) {
    const searchInput = document.getElementById('editor-search-input');
    const countEl = document.getElementById('editor-search-count');
    const q = searchInput ? searchInput.value : App.searchQuery;

    if (!q) {
      showToast('検索したい文字を入力してください');
      if (searchInput) searchInput.focus();
      return;
    }

    collectBodySearchMatches(q);
    const total = App.searchMatches.length;

    if (total === 0) {
      showToast('「' + q + '」に一致する箇所は本文内に見つかりませんでした', true);
      return;
    }

    const step = direction < 0 ? -1 : 1;
    if (App.searchCurrentIndex < 0 || App.searchCurrentIndex >= total) {
      App.searchCurrentIndex = step > 0 ? 0 : total - 1;
    } else {
      App.searchCurrentIndex = (App.searchCurrentIndex + step + total) % total;
    }

    const match = App.searchMatches[App.searchCurrentIndex];
    if (countEl) {
      countEl.textContent = App.searchCurrentIndex + 1 + '/' + total;
      countEl.className = 'editor-search-count has-matches';
    }

    // 該当ページ・連動区間へ移動してエディタ上で選択ハイライト＆スクロール
    if (App.activePageIndex !== match.pageIndex) {
      App.activePageIndex = match.pageIndex;
    }
    syncEditorToCurrentPage({ forceReloadText: false });
    renderSpreadPreview();
    renderPageStripAndCounters();

    const bodyTextarea = document.getElementById('editor-body-textarea');
    if (bodyTextarea) {
      App.isSearchSelectionActive = true;
      bodyTextarea.focus();
      bodyTextarea.setSelectionRange(match.charStart, match.charEnd);
      const approxLineHeight = 27.5;
      bodyTextarea.scrollTop = Math.max(0, (match.lineNumber - 1) * approxLineHeight - 80);
    }

    const startNum = App.settings.headerFooter.startPageNumber || 1;
    showToast(
      '検索一致 (' +
        (App.searchCurrentIndex + 1) +
        '/' +
        total +
        '件): P.' +
        (startNum + match.pageIndex) +
        ' ・ ' +
        match.lineNumber +
        '行目'
    );
  }

  function autoCollectTocFromBodyPages() {
    const page = getCurrentPage();
    if (!page || page.type !== 'toc') return;
    const collected = [];
    const startNum = App.settings.headerFooter.startPageNumber || 1;

    App.pages.forEach(function (p, idx) {
      if (!p || p.type !== 'tobira') return;
      const titleStr = p.tobiraData && p.tobiraData.title ? String(p.tobiraData.title).trim() : '';
      if (titleStr) {
        collected.push({
          title: titleStr.replace(/[｜|]([^《]+)《[^》]+》/g, '$1'),
          page: String(startNum + idx)
        });
      }
    });

    if (collected.length === 0) {
      showToast('扉ページの小説タイトルが見つかりませんでした', true);
      return;
    }

    pushUndoSnapshot('扉から目次見出しを自動抽出');
    if (!page.tocData) page.tocData = { heading: '目　次', items: [] };
    page.tocData.items = collected;
    renderTocItemsEditor(page);
    scheduleRender();
    showToast('扉ページから ' + collected.length + ' 件の目次見出しを自動抽出しました');
  }

  function getCurrentPage() {
    if (App.activePageIndex < 0 || App.activePageIndex >= App.pages.length) {
      App.activePageIndex = Math.max(0, App.pages.length - 1);
    }
    return App.pages[App.activePageIndex] || null;
  }

  function syncEditorToCurrentPage(options) {
    const opts = options || {};
    const page = getCurrentPage();
    if (!page) return;

    const startNum = App.settings.headerFooter.startPageNumber || 1;
    const pageNum = startNum + App.activePageIndex;
    const isEven = pageNum % 2 === 0;

    const titleBadge = document.getElementById('editor-current-page-label');
    if (titleBadge) {
      titleBadge.textContent =
        'P.' +
        pageNum +
        ' (' +
        (isEven ? '偶数頁・見開き右' : '奇数頁・見開き左') +
        ')';
    }

    // 属性ボタンのハイライト
    document.querySelectorAll('.page-type-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-page-type') === page.type);
    });

    // 個別フォントオーバーライドの同期（有効時のみ表示）
    updatePageFontOverrideVisibility();
    setVal('page-font-override', (page.fontOverride && page.fontOverride.fontId) || '');
    setVal(
      'page-size-override',
      page.fontOverride && page.fontOverride.fontSizePt ? page.fontOverride.fontSizePt : ''
    );

    // 属性別パネルの表示切替
    const panelTobira = document.getElementById('editor-panel-tobira');
    const panelToc = document.getElementById('editor-panel-toc');
    const panelBody = document.getElementById('editor-panel-body');

    if (panelTobira) panelTobira.style.display = page.type === 'tobira' ? 'block' : 'none';
    if (panelToc) panelToc.style.display = page.type === 'toc' ? 'block' : 'none';
    if (panelBody) panelBody.style.display = 'flex';

    if (page.type === 'tobira') {
      const d = page.tobiraData || {};
      setVal('tobira-title', d.title || '');
      setVal('tobira-subtitle', d.subtitle || '');
      setVal('tobira-author', d.author || '');
      setVal('tobira-note', d.note || '');
      const yOffset =
        d.titleOffsetYMm !== undefined && d.titleOffsetYMm !== null && d.titleOffsetYMm !== ''
          ? d.titleOffsetYMm
          : App.settings.typography.tobira.titleYOffsetMm !== undefined
          ? App.settings.typography.tobira.titleYOffsetMm
          : 18;
      const xOffset =
        d.titleOffsetXMm !== undefined && d.titleOffsetXMm !== null && d.titleOffsetXMm !== ''
          ? d.titleOffsetXMm
          : App.settings.typography.tobira.titleXOffsetMm !== undefined
          ? App.settings.typography.tobira.titleXOffsetMm
          : 0;
      setVal('tobira-title-offset-y', yOffset);
      setVal('tobira-title-offset-x', xOffset);
    } else if (page.type === 'toc') {
      const d = page.tocData || { heading: '目　次', items: [] };
      const headingInputEl = document.getElementById('toc-heading-input');
      if (headingInputEl && document.activeElement !== headingInputEl) {
        setVal('toc-heading-input', d.heading !== undefined && d.heading !== null ? d.heading : '目　次');
      }
      setVal('toc-panel-num-style', App.settings.typography.toc.numberStyle || 'kanji');
      setVal('toc-panel-layout-align', App.settings.typography.toc.layoutAlign || 'right');
      const tocListEl = document.getElementById('toc-items-list');
      const isFocusInsideTocList = Boolean(
        tocListEl && document.activeElement && tocListEl.contains(document.activeElement)
      );
      if (opts.forceReloadText || !isFocusInsideTocList) {
        renderTocItemsEditor(page);
      }
    }

    const bodyTextarea = document.getElementById('editor-body-textarea');
    if (bodyTextarea) {
      if (page.type === 'body') {
        bodyTextarea.readOnly = false;
        const range = getLinkedBodySectionRange(App.activePageIndex);
        const combinedText = range
          ? getSectionCombinedText(range.startIdx, range.endIdx)
          : page.content || '';

        if (
          opts.forceReloadText ||
          App.currentRenderedSectionStart !== (range ? range.startIdx : -1) ||
          bodyTextarea.value !== combinedText
        ) {
          bodyTextarea.value = combinedText;
          App.currentRenderedSectionStart = range ? range.startIdx : -1;
        }

        if (opts.scrollToActivePage && typeof page.charStart === 'number') {
          const targetChar = Math.min(bodyTextarea.value.length, Math.max(0, page.charStart));
          bodyTextarea.selectionStart = targetChar;
          bodyTextarea.selectionEnd = targetChar;
          // 該当ページの先頭付近へスクロール
          const prefixLines = bodyTextarea.value.slice(0, targetChar).split('\n').length - 1;
          const approxLineHeight = 27.5;
          bodyTextarea.scrollTop = Math.max(0, prefixLines * approxLineHeight - 40);
        }

        bodyTextarea.placeholder =
          'ここに小説本文を流し込むか執筆します（連動区間内のすべての本文ページがリアルタイムに自動ページ割りされます）...\n・感嘆符（！）や疑問符（？）の直後は自動で全角一マス空けが補完されます\n・2〜3桁の数字や !? は自動で縦中横になります\n・｜漢字《かんじ》 でルビを振れます';
      } else if (page.type === 'blank') {
        bodyTextarea.readOnly = true;
        App.currentRenderedSectionStart = -1;
        bodyTextarea.value = '';
        bodyTextarea.placeholder =
          '【空白ページ】\n挿絵を追加するため等に空けておくページです。この属性のページには本文が入りません（ノンブル等は反映されます）。\n本文連動中の場合は、この空白ページを飛ばして前後の本文ページに本文が配されます。';
      } else {
        bodyTextarea.readOnly = false;
        App.currentRenderedSectionStart = -1;
        if (opts.forceReloadText || bodyTextarea.value !== (page.content || '')) {
          bodyTextarea.value = page.content || '';
        }
        bodyTextarea.placeholder =
          page.type === 'tobira'
            ? '（任意）扉ページに追加で配置する自由文を入力...'
            : '（任意）目次ページに追加で配置する自由文を入力...';
      }
    }

    renderLinkedSectionBar();
    updateCurrentPageLineUsage();
    renderEditorPageBgBackdrop();
  }

  function renderTocItemsEditor(page) {
    const container = document.getElementById('toc-items-list');
    if (!container || !page || !page.tocData) return;
    container.innerHTML = '';

    const items = page.tocData.items || [];
    items.forEach(function (item, idx) {
      const row = document.createElement('div');
      row.className = 'toc-item-row';

      const titleInput = document.createElement('input');
      titleInput.type = 'text';
      titleInput.className = 'toc-item-title-input';
      titleInput.placeholder = '章タイトル';
      titleInput.value = item.title || '';
      titleInput.addEventListener('input', function () {
        item.title = titleInput.value;
        schedulePreviewAndCounterRender();
      });

      const pageInput = document.createElement('input');
      pageInput.type = 'text';
      pageInput.className = 'toc-item-page-input';
      pageInput.placeholder = '頁';
      pageInput.value = item.page || '';
      pageInput.addEventListener('input', function () {
        item.page = pageInput.value;
        schedulePreviewAndCounterRender();
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn-icon-small danger';
      delBtn.textContent = '×';
      delBtn.title = 'この目次項目を削除';
      delBtn.addEventListener('click', function () {
        items.splice(idx, 1);
        renderTocItemsEditor(page);
        schedulePreviewAndCounterRender();
      });

      row.appendChild(titleInput);
      row.appendChild(pageInput);
      row.appendChild(delBtn);
      container.appendChild(row);
    });
  }

  function updateCurrentPageLineUsage() {
    const badge = document.getElementById('editor-line-usage');
    const page = getCurrentPage();
    if (!badge || !page) return;

    const maxLines =
      (App.settings.layout.linesPerPage || 18) * (App.settings.layout.columns || 1);
    const lines = Array.isArray(page._precomputedLines)
      ? page._precomputedLines
      : global.TategakiTypesetter.layoutBodyTextToLines(page.content || '', App.settings);
    const used = lines.filter(function (l) {
      return !l.isControlBreak;
    }).length;

    const startNum = App.settings.headerFooter.startPageNumber || 1;
    const pageNum = startNum + App.activePageIndex;

    if (page.type === 'body' || page.type === 'blank') {
      const range = getLinkedBodySectionRange(App.activePageIndex);
      let sectionTotalLines = page.type === 'blank' ? 0 : used;
      let sectionPagesCount = 1;
      if (range) {
        sectionPagesCount = range.endIdx - range.startIdx + 1;
        sectionTotalLines = 0;
        for (let k = range.startIdx; k <= range.endIdx; k++) {
          const p = App.pages[k];
          if (p && p.type !== 'blank') {
            sectionTotalLines +=
              typeof p.usedLines === 'number'
                ? p.usedLines
                : global.TategakiTypesetter.layoutBodyTextToLines(
                    p.content || '',
                    App.settings
                  ).filter(function (l) {
                    return !l.isControlBreak;
                  }).length;
          }
        }
      }

      if (page.type === 'blank') {
        badge.textContent =
          '現在頁(P.' +
          pageNum +
          ') 【空白ページ（本文なし）】 ｜ 連動区間計: ' +
          sectionTotalLines +
          ' 行 (' +
          sectionPagesCount +
          '頁)';
      } else {
        badge.textContent =
          '現在頁(P.' +
          pageNum +
          ') 組版行数: ' +
          used +
          ' / ' +
          maxLines +
          ' 行 ｜ 連動区間計: ' +
          sectionTotalLines +
          ' 行 (' +
          sectionPagesCount +
          '頁・' +
          App.settings.layout.charsPerLine +
          '字×' +
          App.settings.layout.linesPerPage +
          '行' +
          (App.settings.layout.columns > 1 ? '×2段' : '') +
          ')';
      }
    } else {
      badge.textContent =
        '組版行数: ' +
        used +
        ' / ' +
        maxLines +
        ' 行 (' +
        App.settings.layout.charsPerLine +
        '字×' +
        App.settings.layout.linesPerPage +
        '行)';
    }
    badge.classList.toggle('over-limit', used > maxLines);
    updateIndentWarningBar();
  }

  /**
   * 文頭の空白1文字（字下げ）忘れ注意喚起バーの更新（ページ跨ぎ箇所を除外）
   */
  function updateIndentWarningBar() {
    const bar = document.getElementById('indent-assist-bar');
    const statusEl = document.getElementById('indent-warning-status');
    const btnJump = document.getElementById('btn-jump-indent-warning');
    const bodyTextarea = document.getElementById('editor-body-textarea');
    const page = getCurrentPage();

    if (!bar || !statusEl || !page) return;

    if (page.type !== 'body') {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'flex';

    const enabled = App.settings.rules.checkIndentWarning !== false;
    if (!enabled) {
      bar.classList.remove('has-warning');
      statusEl.className = 'indent-warning-status is-disabled';
      statusEl.textContent = '文頭1字下げチェック: オフ';
      if (btnJump) btnJump.style.display = 'none';
      return;
    }

    const range = getLinkedBodySectionRange(App.activePageIndex);
    const sectionPages = range ? App.pages.slice(range.startIdx, range.endIdx + 1) : [page];
    const text = bodyTextarea ? bodyTextarea.value : page.content || '';
    const warnings = global.TategakiTypesetter.analyzeParagraphIndentWarnings(text, sectionPages);

    if (warnings.length === 0) {
      bar.classList.remove('has-warning');
      statusEl.className = 'indent-warning-status is-ok';
      statusEl.textContent = '✓ 文頭1字下げOK';
      if (btnJump) btnJump.style.display = 'none';
    } else {
      bar.classList.add('has-warning');
      statusEl.className = 'indent-warning-status is-warning';
      const first = warnings[0];
      statusEl.textContent =
        '⚠️ 文頭1字下げ忘れ候補: ' +
        warnings.length +
        '箇所 （例: ' +
        first.lineNumber +
        '行目「' +
        first.snippet +
        '」）';
      if (btnJump) btnJump.style.display = '';
    }
  }

  /**
   * 次の「文頭1字下げ忘れ候補」行へエディタカーソルを移動・選択する
   */
  function jumpToNextUnindentedLine() {
    const bodyTextarea = document.getElementById('editor-body-textarea');
    const page = getCurrentPage();
    if (!bodyTextarea || !page || page.type !== 'body') return;

    const range = getLinkedBodySectionRange(App.activePageIndex);
    const sectionPages = range ? App.pages.slice(range.startIdx, range.endIdx + 1) : [page];
    const warnings = global.TategakiTypesetter.analyzeParagraphIndentWarnings(
      bodyTextarea.value,
      sectionPages
    );
    if (warnings.length === 0) {
      showToast('現在の連動区間内に文頭1字下げ忘れ候補はありません');
      return;
    }

    const curPos = bodyTextarea.selectionEnd || 0;
    let target = warnings.find(function (w) {
      return w.charOffset > curPos;
    });
    if (!target) {
      target = warnings[0];
    }

    bodyTextarea.focus();
    bodyTextarea.selectionStart = target.charOffset;
    bodyTextarea.selectionEnd = target.lineEndOffset;

    const approxLineHeight = 27.5;
    bodyTextarea.scrollTop = Math.max(0, target.lineIndex * approxLineHeight - 60);

    syncActivePageFromTextareaCursor();
    showToast(
      target.lineNumber +
        '行目「' +
        target.snippet +
        '」へ移動しました（文頭に全角空白がありません）'
    );
  }

  /**
   * 現在カーソルがある行の先頭に全角空白（　）を1文字挿入する
   */
  function fixCurrentLineIndentation() {
    const bodyTextarea = document.getElementById('editor-body-textarea');
    const page = getCurrentPage();
    if (!bodyTextarea || !page) return;

    const val = bodyTextarea.value;
    const selStart = bodyTextarea.selectionStart || 0;
    const lineStart = val.lastIndexOf('\n', Math.max(0, selStart - 1)) + 1;

    if (val[lineStart] === '　') {
      showToast('現在の行頭にはすでに全角空白（　）が入っています');
      return;
    }

    pushUndoSnapshot('行頭1字下げ');
    bodyTextarea.value = val.slice(0, lineStart) + '　' + val.slice(lineStart);
    bodyTextarea.focus();
    bodyTextarea.selectionStart = selStart + 1;
    bodyTextarea.selectionEnd = selStart + 1;

    handleLiveBodySectionInput();
    showToast('現在の行頭に全角空白（　）を1文字挿入しました');
  }

  // =========================================================================
  // 見開きプレビュー ／ 単ページ ／ 9頁グリッド俯瞰 ＆ ドラッグ＆ドロップ管理
  // =========================================================================
  function setPreviewMode(mode) {
    App.settings.view.mode = mode;
    const btnViewSpread = document.getElementById('btn-view-spread');
    const btnViewSingle = document.getElementById('btn-view-single');
    const btnViewGrid = document.getElementById('btn-view-grid');
    const pairingSelect = document.getElementById('spread-pairing-select');
    const gridDirSelect = document.getElementById('grid-direction-select');
    const gridRangeLabel = document.getElementById('grid-range-label');
    const btnPrev = document.getElementById('btn-prev-page');
    const btnNext = document.getElementById('btn-next-page');

    if (btnViewSpread) btnViewSpread.classList.toggle('active', mode === 'spread');
    if (btnViewSingle) btnViewSingle.classList.toggle('active', mode === 'single');
    if (btnViewGrid) btnViewGrid.classList.toggle('active', mode === 'grid');

    if (gridDirSelect) {
      if (mode === 'grid') {
        gridDirSelect.style.display = '';
        gridDirSelect.style.visibility = 'visible';
      } else {
        gridDirSelect.style.display = 'none';
      }
    }
    if (pairingSelect) {
      pairingSelect.style.display = 'none';
    }
    if (gridRangeLabel) gridRangeLabel.style.display = mode === 'grid' ? '' : 'none';

    if (btnPrev && btnNext) {
      btnPrev.textContent = '◀';
      btnNext.textContent = '▶';
      btnPrev.title = mode === 'grid' ? '次の9頁へ (←)' : '次のページへ (←)';
      btnNext.title = mode === 'grid' ? '前の9頁へ (→)' : '前のページへ (→)';
    }

    renderSpreadPreview();
  }

  function stepPreviewPageForward() {
    if (App.settings.view.mode === 'grid') {
      const curGroupStart = Math.floor(App.activePageIndex / 9) * 9;
      if (curGroupStart + 9 < App.pages.length) {
        selectActivePage(curGroupStart + 9, { scrollEditorToPage: true });
      } else if (App.activePageIndex < App.pages.length - 1) {
        selectActivePage(App.pages.length - 1, { scrollEditorToPage: true });
      }
    } else if (App.activePageIndex < App.pages.length - 1) {
      selectActivePage(App.activePageIndex + 1, { scrollEditorToPage: true });
    }
  }

  function stepPreviewPageBackward() {
    if (App.settings.view.mode === 'grid') {
      const curGroupStart = Math.floor(App.activePageIndex / 9) * 9;
      const prevTarget = Math.max(0, curGroupStart - 9);
      selectActivePage(prevTarget, { scrollEditorToPage: true });
    } else if (App.activePageIndex > 0) {
      selectActivePage(App.activePageIndex - 1, { scrollEditorToPage: true });
    }
  }

  function bindPreviewControls() {
    const btnViewSpread = document.getElementById('btn-view-spread');
    const btnViewSingle = document.getElementById('btn-view-single');
    const btnViewGrid = document.getElementById('btn-view-grid');

    if (btnViewSpread) {
      btnViewSpread.addEventListener('click', function () {
        setPreviewMode('spread');
      });
    }
    if (btnViewSingle) {
      btnViewSingle.addEventListener('click', function () {
        setPreviewMode('single');
      });
    }
    if (btnViewGrid) {
      btnViewGrid.addEventListener('click', function () {
        setPreviewMode('grid');
      });
    }

    const btnPrevPage = document.getElementById('btn-prev-page');
    const btnNextPage = document.getElementById('btn-next-page');
    if (btnPrevPage) {
      btnPrevPage.addEventListener('click', function () {
        stepPreviewPageForward();
      });
    }
    if (btnNextPage) {
      btnNextPage.addEventListener('click', function () {
        stepPreviewPageBackward();
      });
    }

    // プレビュー解像度・表示倍率は常時100%固定のため廃止（将来的に使用する可能性があるためコメントアウトで温存）
    // const zoomSelect = document.getElementById('preview-zoom-select');
    // if (zoomSelect) {
    //   zoomSelect.addEventListener('change', function () {
    //     App.settings.view.zoom = parseFloat(zoomSelect.value) || 1.0;
    //     renderSpreadPreview();
    //   });
    // }

    const pairingSelect = document.getElementById('spread-pairing-select');
    if (pairingSelect) {
      pairingSelect.addEventListener('change', function () {
        App.settings.view.spreadPairing = pairingSelect.value;
        renderSpreadPreview();
      });
    }

    const gridDirSelect = document.getElementById('grid-direction-select');
    if (gridDirSelect) {
      gridDirSelect.addEventListener('change', function () {
        App.settings.view.gridDirection = gridDirSelect.value || 'ltr';
        renderSpreadPreview();
      });
    }

    // 見開き左キャンバス（奇数頁）・右キャンバス（偶数頁）クリックで編集対象ページを切り替え
    const leftWrapper = document.getElementById('spread-left-card');
    const rightWrapper = document.getElementById('spread-right-card');
    if (leftWrapper) {
      leftWrapper.addEventListener('click', function () {
        const idx = parseInt(leftWrapper.getAttribute('data-page-index'), 10);
        if (!isNaN(idx) && idx >= 0 && idx < App.pages.length) {
          selectActivePage(idx, { scrollEditorToPage: true });
        }
      });
    }
    if (rightWrapper) {
      rightWrapper.addEventListener('click', function () {
        const idx = parseInt(rightWrapper.getAttribute('data-page-index'), 10);
        if (!isNaN(idx) && idx >= 0 && idx < App.pages.length) {
          selectActivePage(idx, { scrollEditorToPage: true });
        }
      });
    }

    // ページ追加・複製・削除・選択ボタン
    bindClick('btn-add-body-page', function () {
      insertNewPageAfterActive('body');
    });
    bindClick('btn-add-tobira-page', function () {
      insertNewPageAfterActive('tobira');
    });
    bindClick('btn-add-toc-page', function () {
      insertNewPageAfterActive('toc');
    });
    bindClick('btn-add-blank-page', function () {
      insertNewPageAfterActive('blank');
    });
    bindClick('btn-dup-page', function () {
      duplicateActivePage();
    });
    bindClick('btn-del-page', function () {
      deleteActivePage();
    });
    bindClick('btn-move-page-left', function () {
      moveActivePage(-1);
    });
    bindClick('btn-move-page-right', function () {
      moveActivePage(1);
    });

    // カウンター用ページ選択操作
    bindClick('btn-select-all-pages', function () {
      App.selectedPageIds = App.pages.map(function (p) {
        return p.id;
      });
      renderPageStripAndCounters();
    });
    bindClick('btn-select-current-only', function () {
      const cur = getCurrentPage();
      App.selectedPageIds = cur ? [cur.id] : [];
      renderPageStripAndCounters();
    });
    bindClick('btn-clear-selected-pages', function () {
      App.selectedPageIds = [];
      renderPageStripAndCounters();
    });
  }

  function bindClick(id, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  }

  function selectActivePage(index, options) {
    if (index < 0 || index >= App.pages.length) return;
    const opts = options || {};
    App.activePageIndex = index;
    syncEditorToCurrentPage({ scrollToActivePage: Boolean(opts.scrollEditorToPage) });
    renderSpreadPreview();
    renderPageStripAndCounters();
  }

  function insertNewPageAfterActive(pageType) {
    if (pageType === 'body') {
      addNewLinkedSectionAfterCurrent();
      return;
    }

    pushUndoSnapshot('ページの追加');
    const newPage = {
      id: 'page-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      type: pageType,
      flowBreakBefore: false,
      tobiraData:
        pageType === 'tobira'
          ? { title: '新しい小説タイトル', subtitle: '', author: '著者名', note: '' }
          : null,
      tocData:
        pageType === 'toc'
          ? { heading: '目　次', items: [{ title: '第一話', page: '3' }] }
          : null,
      content: '',
      rawSlice: pageType === 'blank' ? '' : undefined,
      fontOverride: null
    };

    const insertPos = App.activePageIndex + 1;
    App.pages.splice(insertPos, 0, newPage);
    App.selectedPageIds.push(newPage.id);
    // content だけではページ境界の空行や [改ページ] 等が失われるため rawSlice から復元する
    repaginateAllLinkedSections({ fromPageContents: false });
    App.activePageIndex = insertPos;
    syncEditorToCurrentPage({ forceReloadText: true });
    renderAll();
    showToast(
      'P.' +
        ((App.settings.headerFooter.startPageNumber || 1) + insertPos) +
        ' に「' +
        typeLabel(pageType) +
        '」ページを挿入しました'
    );
  }

  function duplicateActivePage() {
    const cur = getCurrentPage();
    if (!cur) return;
    pushUndoSnapshot('ページの複製');
    const copy = JSON.parse(JSON.stringify(cur));
    delete copy._precomputedLines;
    copy.id = 'page-' + Date.now() + '-dup';
    if (copy.type === 'body') {
      copy.flowBreakBefore = true;
    }
    const insertPos = App.activePageIndex + 1;
    App.pages.splice(insertPos, 0, copy);
    App.selectedPageIds.push(copy.id);
    // content だけではページ境界の空行や [改ページ] 等が失われるため rawSlice から復元する
    repaginateAllLinkedSections({ fromPageContents: false });
    App.activePageIndex = insertPos;
    syncEditorToCurrentPage({ forceReloadText: true });
    renderAll();
    showToast('ページを複製しました');
  }

  function deleteActivePage() {
    if (App.pages.length <= 1) {
      showToast('最後の1ページは削除できません', true);
      return;
    }
    pushUndoSnapshot('ページの削除');
    const wasFirstOfBreak = Boolean(App.pages[App.activePageIndex].flowBreakBefore);
    const removed = App.pages.splice(App.activePageIndex, 1)[0];
    if (
      wasFirstOfBreak &&
      App.activePageIndex < App.pages.length &&
      isFlowSectionPage(App.pages[App.activePageIndex])
    ) {
      App.pages[App.activePageIndex].flowBreakBefore = true;
    }
    App.selectedPageIds = App.selectedPageIds.filter(function (id) {
      return id !== removed.id;
    });
    if (App.activePageIndex >= App.pages.length) {
      App.activePageIndex = App.pages.length - 1;
    }
    // content だけではページ境界の空行や [改ページ] 等が失われるため rawSlice から復元する
    repaginateAllLinkedSections({ fromPageContents: false });
    syncEditorToCurrentPage({ forceReloadText: true });
    renderAll();
    showToast('ページを削除しました');
  }

  function moveActivePage(delta) {
    const from = App.activePageIndex;
    const to = from + delta;
    if (to < 0 || to >= App.pages.length) return;
    reorderPages(from, to);
  }

  function reorderPages(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    pushUndoSnapshot('ページの順序入替');
    const moved = App.pages.splice(fromIndex, 1)[0];
    App.pages.splice(toIndex, 0, moved);
    App.activePageIndex = toIndex;
    // content だけではページ境界の空行や [改ページ] 等が失われるため rawSlice から復元する
    repaginateAllLinkedSections({ fromPageContents: false });
    syncEditorToCurrentPage({ forceReloadText: true });
    renderAll();
  }

  /**
   * プレビュー描画（見開きプレビュー ／ 単ページ表示 ／ 9頁グリッド俯瞰）
   */
  function renderSpreadPreview() {
    const startNum = App.settings.headerFooter.startPageNumber || 1;
    const activePageNum = startNum + App.activePageIndex;
    const isEvenActive = activePageNum % 2 === 0;

    const spreadContainer = document.getElementById('spread-stage');
    const gridStage = document.getElementById('grid-overview-stage');
    const leftCard = document.getElementById('spread-left-card');
    const rightCard = document.getElementById('spread-right-card');
    const leftCanvas = document.getElementById('spread-left-canvas');
    const rightCanvas = document.getElementById('spread-right-canvas');
    const leftLabel = document.getElementById('spread-left-label');
    const rightLabel = document.getElementById('spread-right-label');

    if (!leftCard || !rightCard || !leftCanvas || !rightCanvas) return;

    // 9頁グリッド俯瞰モード時
    if (App.settings.view.mode === 'grid') {
      if (spreadContainer) spreadContainer.style.display = 'none';
      if (gridStage) gridStage.style.display = 'flex';
      renderGridOverview();
      return;
    }

    if (spreadContainer) spreadContainer.style.display = 'flex';
    if (gridStage) gridStage.style.display = 'none';

    // プレビュー解像度・表示倍率は常時100%(1.0)固定（将来的に使用する可能性があるため旧コードはコメントアウトで温存）
    // const previewDpi = Math.round(160 * (App.settings.view.zoom || 1.0));
    const previewDpi = 160;
    const renderOpts = {
      dpi: previewDpi,
      showGuides: App.settings.paper.showMarginGuides,
      includeTrimMarks: App.settings.paper.showTrimMarksInPreview,
      includeBleedArea: App.settings.paper.showTrimMarksInPreview
    };

    if (App.settings.view.mode === 'single') {
      // 単ページ表示モード
      spreadContainer.classList.add('single-mode');
      if (isEvenActive) {
        leftCard.style.display = 'none';
        rightCard.style.display = 'flex';
        rightCard.setAttribute('data-page-index', String(App.activePageIndex));
        rightCard.classList.add('active-page');
        rightLabel.textContent =
          '偶数頁 P.' +
          activePageNum +
          ' [' +
          typeLabel(App.pages[App.activePageIndex].type) +
          '] （ノド＝左1.5cm / 小口＝右1cm）';
        global.TategakiTypesetter.renderPageToCanvas(
          rightCanvas,
          App.pages[App.activePageIndex],
          App.activePageIndex,
          App.pages,
          App.settings,
          Object.assign({}, renderOpts, {
            searchHighlights: getSearchHighlightsForPage(App.activePageIndex)
          })
        );
      } else {
        rightCard.style.display = 'none';
        leftCard.style.display = 'flex';
        leftCard.setAttribute('data-page-index', String(App.activePageIndex));
        leftCard.classList.add('active-page');
        leftLabel.textContent =
          '奇数頁 P.' +
          activePageNum +
          ' [' +
          typeLabel(App.pages[App.activePageIndex].type) +
          '] （ノド＝右1.5cm / 小口＝左1cm）';
        global.TategakiTypesetter.renderPageToCanvas(
          leftCanvas,
          App.pages[App.activePageIndex],
          App.activePageIndex,
          App.pages,
          App.settings,
          Object.assign({}, renderOpts, {
            searchHighlights: getSearchHighlightsForPage(App.activePageIndex)
          })
        );
      }
      return;
    }

    // 見開き表示モード（常に 左＝奇数頁、右＝偶数頁）
    spreadContainer.classList.remove('single-mode');
    leftCard.style.display = 'flex';
    rightCard.style.display = 'flex';

    // アクティブページを含む見開きペア（奇数頁インデックスと偶数頁インデックス）を算出（常時「右綴じ見開き」）
    let oddPageIndex;
    let evenPageIndex;
    const isRtlBookSpread = true;

    if (isRtlBookSpread) {
      // 右綴じ製本順見開き：P.1(左奇)は単独、以降は [左:P.3(奇) | 右:P.2(偶)]、[左:P.5(奇) | 右:P.4(偶)]
      if (isEvenActive) {
        evenPageIndex = App.activePageIndex;
        oddPageIndex = App.activePageIndex + 1;
      } else {
        oddPageIndex = App.activePageIndex;
        evenPageIndex = App.activePageIndex - 1;
      }
    } else {
      // ペア順見開き：[左:P.1(奇) | 右:P.2(偶)]、[左:P.3(奇) | 右:P.4(偶)]
      if (isEvenActive) {
        evenPageIndex = App.activePageIndex;
        oddPageIndex =
          startNum % 2 === 1 ? App.activePageIndex - 1 : App.activePageIndex + 1;
      } else {
        oddPageIndex = App.activePageIndex;
        evenPageIndex =
          startNum % 2 === 1 ? App.activePageIndex + 1 : App.activePageIndex - 1;
      }
    }

    // 左側（奇数頁）の描画
    if (oddPageIndex >= 0 && oddPageIndex < App.pages.length) {
      const oddPage = App.pages[oddPageIndex];
      const oddNum = startNum + oddPageIndex;
      leftCard.classList.remove('empty-spread-side');
      leftCard.classList.toggle('active-page', oddPageIndex === App.activePageIndex);
      leftCard.setAttribute('data-page-index', String(oddPageIndex));
      leftLabel.textContent =
        '左：奇数頁 P.' + oddNum + ' [' + typeLabel(oddPage.type) + '] （ノド＝右）';
      leftLabel.title =
        '左：奇数頁 P.' +
        oddNum +
        ' [' +
        typeLabel(oddPage.type) +
        '] （ノド＝右 / ノンブル＝左＋タイトル）';
      global.TategakiTypesetter.renderPageToCanvas(
        leftCanvas,
        oddPage,
        oddPageIndex,
        App.pages,
        App.settings,
        Object.assign({}, renderOpts, {
          searchHighlights: getSearchHighlightsForPage(oddPageIndex)
        })
      );
    } else {
      leftCard.classList.add('empty-spread-side');
      leftCard.classList.remove('active-page');
      leftCard.setAttribute('data-page-index', '-1');
      leftLabel.textContent = '左：奇数頁（ページなし）';
      renderBlankSlotCanvas(leftCanvas, previewDpi);
    }

    // 右側（偶数頁）の描画
    if (evenPageIndex >= 0 && evenPageIndex < App.pages.length) {
      const evenPage = App.pages[evenPageIndex];
      const evenNum = startNum + evenPageIndex;
      rightCard.classList.remove('empty-spread-side');
      rightCard.classList.toggle('active-page', evenPageIndex === App.activePageIndex);
      rightCard.setAttribute('data-page-index', String(evenPageIndex));
      rightLabel.textContent =
        '右：偶数頁 P.' + evenNum + ' [' + typeLabel(evenPage.type) + '] （ノド＝左）';
      rightLabel.title =
        '右：偶数頁 P.' +
        evenNum +
        ' [' +
        typeLabel(evenPage.type) +
        '] （ノド＝左 / ノンブル＝右）';
      global.TategakiTypesetter.renderPageToCanvas(
        rightCanvas,
        evenPage,
        evenPageIndex,
        App.pages,
        App.settings,
        Object.assign({}, renderOpts, {
          searchHighlights: getSearchHighlightsForPage(evenPageIndex)
        })
      );
    } else {
      rightCard.classList.add('empty-spread-side');
      rightCard.classList.remove('active-page');
      rightCard.setAttribute('data-page-index', '-1');
      rightLabel.textContent = '右：偶数頁（ページなし）';
      renderBlankSlotCanvas(rightCanvas, previewDpi);
    }
  }

  /**
   * 3×3（1画面9頁）グリッド俯瞰モードの描画＆ドラッグ＆ドロップによるページ順序入れ替え
   */
  function renderGridOverview() {
    const matrix = document.getElementById('grid-cards-container');
    const rangeLabel = document.getElementById('grid-range-label');
    if (!matrix) return;

    matrix.innerHTML = '';
    matrix.classList.toggle('rtl-grid', App.settings.view.gridDirection === 'rtl');

    const startNum = App.settings.headerFooter.startPageNumber || 1;
    const baseOffset = Math.floor(App.activePageIndex / 9) * 9;
    const endPageNum = startNum + baseOffset + 8;

    if (rangeLabel) {
      rangeLabel.textContent =
        '表示中: P.' +
        (startNum + baseOffset) +
        '〜P.' +
        endPageNum +
        ' （全 ' +
        App.pages.length +
        ' 頁）';
    }

    // プレビュー解像度・表示倍率は常時100%(1.0)固定（将来的に使用する可能性があるため旧コードはコメントアウトで温存）
    // const gridDpi = Math.round(78 * (App.settings.view.zoom || 1.0));
    const gridDpi = 78;
    const stats = global.TategakiCounter.calculatePagesStats(
      App.pages,
      App.selectedPageIds
    );

    for (let slot = 0; slot < 9; slot++) {
      const pageIdx = baseOffset + slot;

      if (pageIdx < App.pages.length) {
        const page = App.pages[pageIdx];
        const pageNum = startNum + pageIdx;
        const isEven = pageNum % 2 === 0;
        const isSelectedForCount = App.selectedPageIds.indexOf(page.id) !== -1;
        const pageStat = stats.perPage[page.id] || { effectiveCount: 0, rawCount: 0 };

        const card = document.createElement('div');
        card.className =
          'grid-page-card' +
          (pageIdx === App.activePageIndex ? ' active' : '') +
          (isSelectedForCount ? ' count-selected' : '');
        card.draggable = true;
        card.setAttribute('data-index', String(pageIdx));

        // ドラッグ＆ドロップによるページ順序入れ替え
        card.addEventListener('dragstart', function (e) {
          App.dragSourceIndex = pageIdx;
          card.classList.add('dragging');
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(pageIdx));
          }
        });

        card.addEventListener('dragend', function () {
          card.classList.remove('dragging');
          document.querySelectorAll('.grid-page-card').forEach(function (c) {
            c.classList.remove('drag-over');
          });
        });

        card.addEventListener('dragover', function (e) {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
          card.classList.add('drag-over');
        });

        card.addEventListener('dragleave', function () {
          card.classList.remove('drag-over');
        });

        card.addEventListener('drop', function (e) {
          e.preventDefault();
          card.classList.remove('drag-over');
          const fromIdx =
            App.dragSourceIndex !== null
              ? App.dragSourceIndex
              : parseInt(e.dataTransfer.getData('text/plain'), 10);
          if (!isNaN(fromIdx) && fromIdx !== pageIdx) {
            reorderPages(fromIdx, pageIdx);
            showToast(
              '9頁グリッドでページ順序を入れ替えました (P.' +
                (startNum + fromIdx) +
                ' → P.' +
                pageNum +
                ')'
            );
          }
          App.dragSourceIndex = null;
        });

        // 上部バー（ドラッググリップ＋チェックボックス＋頁番号＋偶奇表示＋属性バッジ）
        const topBar = document.createElement('div');
        topBar.className = 'grid-card-top';

        const leftMeta = document.createElement('div');
        leftMeta.className = 'grid-card-left-meta';

        const grip = document.createElement('span');
        grip.className = 'grid-drag-grip';
        grip.textContent = '⋮⋮';
        grip.title = 'ドラッグしてページ順を入れ替え';

        const chkLabel = document.createElement('label');
        chkLabel.className = 'thumb-check-label';
        chkLabel.title = '文字数カウント対象に含める';
        chkLabel.addEventListener('click', function (e) {
          e.stopPropagation();
        });

        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = isSelectedForCount;
        chk.addEventListener('change', function () {
          if (chk.checked) {
            if (App.selectedPageIds.indexOf(page.id) === -1) {
              App.selectedPageIds.push(page.id);
            }
          } else {
            App.selectedPageIds = App.selectedPageIds.filter(function (id) {
              return id !== page.id;
            });
          }
          renderPageStripAndCounters();
          renderGridOverview();
        });

        const titleNum = document.createElement('span');
        titleNum.className = 'grid-page-title-num';
        titleNum.textContent = 'P.' + pageNum + ' ' + (isEven ? '(偶・右)' : '(奇・左)');

        chkLabel.appendChild(chk);
        chkLabel.appendChild(titleNum);

        leftMeta.appendChild(grip);
        leftMeta.appendChild(chkLabel);

        const badgeWrap = document.createElement('div');
        badgeWrap.style.display = 'flex';
        badgeWrap.style.alignItems = 'center';
        badgeWrap.style.gap = '3px';

        if (isFlowSectionPage(page) && pageIdx > 0 && isFlowSectionPage(App.pages[pageIdx - 1])) {
          const flowBadge = document.createElement('span');
          const isBreak = Boolean(page.flowBreakBefore);
          flowBadge.className = 'thumb-flow-badge ' + (isBreak ? 'is-break' : 'is-linked');
          flowBadge.textContent = isBreak ? '✂区切り' : '🔗連動';
          flowBadge.title = isBreak
            ? '前の本文ページから連動が区切られています（クリックで連動を再開）'
            : '前の本文ページと連動しています（クリックでここから連動を区切る）';
          flowBadge.addEventListener('click', function (e) {
            e.stopPropagation();
            togglePageFlowBreak(pageIdx);
          });
          badgeWrap.appendChild(flowBadge);
        }

        const badge = document.createElement('span');
        badge.className = 'thumb-type-badge type-' + page.type;
        badge.textContent = typeLabel(page.type);
        if (page.type === 'blank') {
          badge.title = '挿絵を追加するため等に空けておくページ、本文が入りません';
        }
        badgeWrap.appendChild(badge);

        topBar.appendChild(leftMeta);
        topBar.appendChild(badgeWrap);

        // 中央プレビューCanvas
        const canvasWrap = document.createElement('div');
        canvasWrap.className = 'grid-card-canvas-wrap';
        const gridCanvas = document.createElement('canvas');
        gridCanvas.className = 'grid-card-canvas';

        global.TategakiTypesetter.renderPageToCanvas(
          gridCanvas,
          page,
          pageIdx,
          App.pages,
          App.settings,
          {
            dpi: gridDpi,
            showGuides: App.settings.paper.showMarginGuides,
            includeTrimMarks: App.settings.paper.showTrimMarksInPreview,
            includeBleedArea: App.settings.paper.showTrimMarksInPreview,
            searchHighlights: getSearchHighlightsForPage(pageIdx)
          }
        );
        canvasWrap.appendChild(gridCanvas);

        // 下部バー（抜粋テキスト＋実文字数）
        const bottomBar = document.createElement('div');
        bottomBar.className = 'grid-card-bottom';

        const snippet = document.createElement('span');
        snippet.className = 'grid-card-snippet';
        snippet.textContent = getPageSummarySnippet(page);

        const charCount = document.createElement('span');
        charCount.className = 'grid-card-charcount';
        charCount.textContent =
          '実 ' + pageStat.effectiveCount + '字 (純 ' + pageStat.rawCount + '字)';

        bottomBar.appendChild(snippet);
        bottomBar.appendChild(charCount);

        card.appendChild(topBar);
        card.appendChild(canvasWrap);
        card.appendChild(bottomBar);

        // クリックで編集対象ページとして選択、ダブルクリックで見開きプレビューに切替
        card.addEventListener('click', function () {
          selectActivePage(pageIdx);
        });
        card.addEventListener('dblclick', function () {
          selectActivePage(pageIdx);
          setPreviewMode('spread');
        });

        matrix.appendChild(card);
      } else {
        // 9枠のうち未作成の枠には空き枠スロットのみ表示（クリックによる自動ページ追加は行わない）
        const emptySlot = document.createElement('div');
        emptySlot.className = 'grid-empty-slot';
        emptySlot.innerHTML = '<span>P.' + (startNum + pageIdx) + ' 枠（空き）</span>';

        // 空き枠へのドロップで末尾へ移動可能にする
        emptySlot.addEventListener('dragover', function (e) {
          e.preventDefault();
        });
        emptySlot.addEventListener('drop', function (e) {
          e.preventDefault();
          const fromIdx =
            App.dragSourceIndex !== null
              ? App.dragSourceIndex
              : parseInt(e.dataTransfer.getData('text/plain'), 10);
          if (!isNaN(fromIdx) && fromIdx >= 0 && fromIdx < App.pages.length) {
            reorderPages(fromIdx, App.pages.length - 1);
            showToast('ページを末尾へ移動しました');
          }
          App.dragSourceIndex = null;
        });

        matrix.appendChild(emptySlot);
      }
    }
  }

  function getPageSummarySnippet(page) {
    if (!page) return '';
    if (page.type === 'blank') {
      return '（空白ページ・本文なし）';
    }
    if (page.type === 'tobira' && page.tobiraData) {
      return page.tobiraData.title || '（扉ページ）';
    }
    if (page.type === 'toc' && page.tocData) {
      return (page.tocData.heading || '目次') + ' (' + (page.tocData.items || []).length + '項目)';
    }
    const firstNonEmpty = String(page.content || '')
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map(function (l) {
        return l.trim();
      })
      .find(Boolean);
    return firstNonEmpty || '（空白ページ）';
  }

  function renderBlankSlotCanvas(canvas, dpi) {
    const geom = global.TategakiTypesetter.computePageGeometry(1, App.settings, {
      dpi: dpi
    });
    canvas.width = geom.canvasW;
    canvas.height = geom.canvasH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f2efe9';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#999287';
    ctx.font = Math.round(geom.canvasW * 0.045) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('（対向ページなし）', canvas.width / 2, canvas.height / 2);
  }

  function typeLabel(t) {
    if (t === 'tobira') return '扉';
    if (t === 'toc') return '目次';
    if (t === 'blank') return '空白';
    return '本文';
  }

  /**
   * 下部ページサムネイル一覧（ドラッグ＆ドロップ入れ替え＋複数ページ選択カウンター）の描画
   */
  function renderPageStripAndCounters() {
    const stats = global.TategakiCounter.calculatePagesStats(
      App.pages,
      App.selectedPageIds
    );

    // 上部・下部カウンター数値の更新
    setText('cnt-total-raw', stats.total.rawCount.toLocaleString());
    setText('cnt-total-nospace', stats.total.noSpaceNewlineCount.toLocaleString());
    setText('cnt-total-effective', stats.total.effectiveCount.toLocaleString());
    setText('cnt-total-sheets', stats.total.manuscriptSheets400.toLocaleString());

    setText('cnt-sel-pages', stats.selectedPageCount + ' / ' + stats.totalPageCount + ' 頁');
    setText('cnt-sel-raw', stats.selected.rawCount.toLocaleString());
    setText('cnt-sel-nospace', stats.selected.noSpaceNewlineCount.toLocaleString());
    setText('cnt-sel-effective', stats.selected.effectiveCount.toLocaleString());

    const dockToggleBtn = document.getElementById('btn-toggle-bottom-dock');
    const isDockCollapsed = Boolean(App.settings.ui && App.settings.ui.bottomDockCollapsed);
    if (dockToggleBtn) {
      dockToggleBtn.innerHTML = isDockCollapsed
        ? '<span id="dock-toggle-arrow">▲</span> ページ管理を開く (全 ' + App.pages.length + ' 頁)'
        : '<span id="dock-toggle-arrow">▼</span> ページ管理を折り畳む';
    }

    // ページサムネイルカードの生成
    const strip = document.getElementById('page-thumbnail-strip');
    if (!strip) return;
    strip.innerHTML = '';

    const startNum = App.settings.headerFooter.startPageNumber || 1;

    App.pages.forEach(function (page, idx) {
      const pageNum = startNum + idx;
      const isEven = pageNum % 2 === 0;
      const isSelectedForCount = App.selectedPageIds.indexOf(page.id) !== -1;
      const pageStat = stats.perPage[page.id] || { effectiveCount: 0, rawCount: 0 };

      const card = document.createElement('div');
      card.className =
        'page-thumb-card' +
        (idx === App.activePageIndex ? ' active' : '') +
        (isSelectedForCount ? ' count-selected' : '');
      card.draggable = true;
      card.setAttribute('data-index', String(idx));

      // HTML5 Drag & Drop イベント（ページの自由な入れ替え）
      card.addEventListener('dragstart', function (e) {
        App.dragSourceIndex = idx;
        card.classList.add('dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(idx));
        }
      });

      card.addEventListener('dragend', function () {
        card.classList.remove('dragging');
        document.querySelectorAll('.page-thumb-card').forEach(function (c) {
          c.classList.remove('drag-over');
        });
      });

      card.addEventListener('dragover', function (e) {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        card.classList.add('drag-over');
      });

      card.addEventListener('dragleave', function () {
        card.classList.remove('drag-over');
      });

      card.addEventListener('drop', function (e) {
        e.preventDefault();
        card.classList.remove('drag-over');
        const fromIdx =
          App.dragSourceIndex !== null
            ? App.dragSourceIndex
            : parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (!isNaN(fromIdx) && fromIdx !== idx) {
          reorderPages(fromIdx, idx);
          showToast('ページ順序を入れ替えました (P.' + (startNum + fromIdx) + ' → P.' + pageNum + ')');
        }
        App.dragSourceIndex = null;
      });

      // カードヘッダー（チェックボックス＋頁番号＋偶奇＋属性バッジ）
      const header = document.createElement('div');
      header.className = 'thumb-card-header';

      const chkLabel = document.createElement('label');
      chkLabel.className = 'thumb-check-label';
      chkLabel.title = '文字数カウント対象に含める';
      chkLabel.addEventListener('click', function (e) {
        e.stopPropagation();
      });

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = isSelectedForCount;
      chk.addEventListener('change', function () {
        if (chk.checked) {
          if (App.selectedPageIds.indexOf(page.id) === -1) {
            App.selectedPageIds.push(page.id);
          }
        } else {
          App.selectedPageIds = App.selectedPageIds.filter(function (id) {
            return id !== page.id;
          });
        }
        renderPageStripAndCounters();
      });

      const numSpan = document.createElement('span');
      numSpan.className = 'thumb-page-num';
      numSpan.textContent = 'P.' + pageNum + (isEven ? '(偶・右)' : '(奇・左)');

      chkLabel.appendChild(chk);
      chkLabel.appendChild(numSpan);

      const badgeWrap = document.createElement('div');
      badgeWrap.style.display = 'flex';
      badgeWrap.style.alignItems = 'center';
      badgeWrap.style.gap = '2px';

      if (isFlowSectionPage(page) && idx > 0 && isFlowSectionPage(App.pages[idx - 1])) {
        const flowBadge = document.createElement('span');
        const isBreak = Boolean(page.flowBreakBefore);
        flowBadge.className = 'thumb-flow-badge ' + (isBreak ? 'is-break' : 'is-linked');
        flowBadge.textContent = isBreak ? '✂区切' : '🔗連動';
        flowBadge.title = isBreak
          ? '前の本文ページから連動が区切られています（クリックで連動を再開）'
          : '前の本文ページと連動しています（クリックでここから連動を区切る）';
        flowBadge.addEventListener('click', function (e) {
          e.stopPropagation();
          togglePageFlowBreak(idx);
        });
        badgeWrap.appendChild(flowBadge);
      }

      const badge = document.createElement('span');
      badge.className = 'thumb-type-badge type-' + page.type;
      badge.textContent = typeLabel(page.type);
      if (page.type === 'blank') {
        badge.title = '挿絵を追加するため等に空けておくページ、本文が入りません';
      }
      badgeWrap.appendChild(badge);

      header.appendChild(chkLabel);
      header.appendChild(badgeWrap);

      // ミニプレビューCanvas
      const miniCanvas = document.createElement('canvas');
      miniCanvas.className = 'thumb-mini-canvas';
      global.TategakiTypesetter.renderPageToCanvas(
        miniCanvas,
        page,
        idx,
        App.pages,
        App.settings,
        {
          dpi: 42,
          showGuides: false,
          includeTrimMarks: false
        }
      );

      // カードフッター（文字数表示）
      const footer = document.createElement('div');
      footer.className = 'thumb-card-footer';
      footer.textContent = '実 ' + pageStat.effectiveCount + '字 (純 ' + pageStat.rawCount + '字)';

      card.appendChild(header);
      card.appendChild(miniCanvas);
      card.appendChild(footer);

      card.addEventListener('click', function () {
        selectActivePage(idx);
      });

      strip.appendChild(card);
    });
  }

  function setText(id, str) {
    const el = document.getElementById(id);
    if (el) el.textContent = str;
  }

  // =========================================================================
  // ファイル保存・読み込み・印刷入稿書き出しアクション
  // =========================================================================
  function bindFileAndExportActions() {
    // 1. 統合PDF出力
    // 動作が保証できないためコメントアウト。使う場合は自己責任で
    /*
    bindClick('btn-export-pdf', function () {
      runWithProgressModal(async function (updateProgress) {
        await global.TategakiExporters.exportPrintReadyPdf(
          App.pages,
          App.settings,
          App.customFontBytes,
          updateProgress
        );
      }, '印刷所対応 統合PDFを書き出しました');
    });
    */

    // 1-B. 全ページ連番PSD (ZIP一括) 出力
    bindClick('btn-export-psd-zip', function () {
      runWithProgressModal(async function (updateProgress) {
        await global.TategakiExporters.exportSequentialPsdZip(
          App.pages,
          App.settings,
          updateProgress
        );
      }, '全ページ連番PSD (ZIP) を書き出しました');
    });

    // 2. ページ連番PNG (ZIP) 出力
    bindClick('btn-export-png-zip', function () {
      runWithProgressModal(async function (updateProgress) {
        await global.TategakiExporters.exportSequentialPngZip(
          App.pages,
          App.settings,
          updateProgress
        );
      }, '全ページ連番PNG (ZIP) を書き出しました');
    });

    // 3. 現在のページ単体PNG出力
    bindClick('btn-export-single-png', function () {
      const page = getCurrentPage();
      if (!page) return;
      const dpi = App.settings.paper.dpi || 600;
      const offCanvas = document.createElement('canvas');
      global.TategakiTypesetter.renderPageToCanvas(
        offCanvas,
        page,
        App.activePageIndex,
        App.pages,
        App.settings,
        {
          dpi: dpi,
          includeTrimMarks: App.settings.exportOptions.includeTrimMarks,
          includeBleedArea: App.settings.exportOptions.exportBleedMm > 0,
          bleedMm: App.settings.exportOptions.exportBleedMm,
          isExport: true,
          grayscaleK100: App.settings.exportOptions.pdfColorMode === 'grayscale-k100'
        }
      );
      offCanvas.toBlob(function (blob) {
        const pageNum = (App.settings.headerFooter.startPageNumber || 1) + App.activePageIndex;
        global.TategakiExporters.triggerDownload(
          blob,
          'page_' + String(pageNum).padStart(3, '0') + '_' + dpi + 'dpi.png'
        );
        showToast('P.' + pageNum + ' のPNG (' + dpi + 'dpi) を出力しました');
      }, 'image/png');
    });

    // 4. 汎用フォーマット入出力 (EPUB3 / DOCX は動作が保証できないためコメントアウト。使う場合は自己責任で)
    /* 動作が保証できないためコメントアウト。使う場合は自己責任で
    bindClick('btn-export-epub', function () {
      global.TategakiExporters.exportEpub3(App.pages, App.settings).then(function () {
        showToast('EPUB3ファイルを書き出しました');
      });
    });

    bindClick('btn-export-docx', function () {
      global.TategakiExporters.exportDocx(App.pages, App.settings);
      showToast('Word (.docx) ファイルを書き出しました');
    });
    */

    // 4-B. プレーンテキスト (.txt) 出力（青空文庫形式とは別の純粋なテキスト出力）
    bindClick('btn-export-plain-txt', function () {
      global.TategakiExporters.exportPlainText(App.pages);
      showToast('プレーンテキスト (.txt) を書き出しました');
    });

    bindClick('btn-export-aozora', function () {
      global.TategakiExporters.exportAozoraText(App.pages);
      showToast('青空文庫形式テキスト (.txt) を書き出しました');
    });

    bindClick('btn-export-md', function () {
      global.TategakiExporters.exportMarkdown(App.pages);
      showToast('Markdown (.md) ファイルを書き出しました');
    });

    // 5. 外部テキスト読み込み (.txt / .md) ※ .epub / .docx はコメントアウト
    const inputImportUniversal = document.getElementById('input-import-universal');
    if (inputImportUniversal) {
      inputImportUniversal.addEventListener('change', function (e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        // const ext = file.name.split('.').pop().toLowerCase();

        /* 動作が保証できないためコメントアウト。使う場合は自己責任で
        if (ext === 'epub') {
          file.arrayBuffer().then(function (ab) {
            global.TategakiExporters.importEpub3(ab)
              .then(function (pages) {
                if (pages && pages.length > 0) {
                  App.pages = pages;
                  App.activePageIndex = 0;
                  repaginateAllLinkedSections({ fromPageContents: true });
                  App.selectedPageIds = App.pages.map(function (p) {
                    return p.id;
                  });
                  syncEditorToCurrentPage();
                  renderAll();
                  showToast('EPUB3ファイル（' + App.pages.length + '頁）を読み込みました');
                }
              })
              .catch(function (err) {
                showToast('EPUB読込エラー: ' + err.message, true);
              });
          });
        } else if (ext === 'docx') {
          file.arrayBuffer().then(function (ab) {
            global.TategakiExporters.importDocx(ab)
              .then(function (pages) {
                if (pages && pages.length > 0) {
                  App.pages = pages;
                  App.activePageIndex = 0;
                  repaginateAllLinkedSections({ fromPageContents: true });
                  App.selectedPageIds = App.pages.map(function (p) {
                    return p.id;
                  });
                  syncEditorToCurrentPage();
                  renderAll();
                  showToast('Word (.docx) ファイル（' + App.pages.length + '頁）を読み込みました');
                }
              })
              .catch(function (err) {
                showToast('DOCX読込エラー: ' + err.message, true);
              });
          });
        } else {
        */
        file.text().then(function (txt) {
          const pages = global.TategakiExporters.importAozoraOrMarkdownText(
            txt,
            App.settings
          );
          if (pages && pages.length > 0) {
            App.pages = pages;
            App.activePageIndex = 0;
            repaginateAllLinkedSections({ fromPageContents: true });
            App.selectedPageIds = App.pages.map(function (p) {
              return p.id;
            });
            syncEditorToCurrentPage();
            renderAll();
            showToast(
              'テキスト/Markdown（' + App.pages.length + '頁に自動分割）を読み込みました'
            );
          }
        });
        /* } */
        e.target.value = '';
      });
    }

    // 6. 「設定ファイル (CSV)」保存・読み込み
    bindClick('btn-save-settings-csv', function () {
      global.TategakiExporters.saveSettingsToCsv(App.settings);
      showToast('設定ファイル (.csv) を保存しました');
    });
    bindClick('btn-top-save-settings-csv', function () {
      global.TategakiExporters.saveSettingsToCsv(App.settings);
      showToast('設定ファイル (.csv) を保存しました');
    });

    const inputSettingsCsv = document.getElementById('input-load-settings-csv');
    if (inputSettingsCsv) {
      inputSettingsCsv.addEventListener('change', function (e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        file.text().then(function (csvText) {
          App.settings = global.TategakiExporters.loadSettingsFromCsv(
            csvText,
            App.settings
          );
          syncSettingsToInputs();
          repaginateAllLinkedSections({ fromPageContents: false });
          renderAll();
          showToast('設定ファイル (' + file.name + ') を読み込みました');
        });
        e.target.value = '';
      });
    }

    // 7. 「本文ファイル (CSV)」保存・読み込み
    bindClick('btn-save-manuscript-csv', function () {
      global.TategakiExporters.saveManuscriptToCsv(App.pages);
      showToast('本文ファイル (.csv) を保存しました');
    });
    bindClick('btn-top-save-manuscript-csv', function () {
      global.TategakiExporters.saveManuscriptToCsv(App.pages);
      showToast('本文ファイル (.csv) を保存しました');
    });

    const inputManuscriptCsv = document.getElementById('input-load-manuscript-csv');
    if (inputManuscriptCsv) {
      inputManuscriptCsv.addEventListener('change', function (e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        file.text().then(function (csvText) {
          const loadedPages = global.TategakiExporters.loadManuscriptFromCsv(csvText);
          if (loadedPages && loadedPages.length > 0) {
            App.pages = loadedPages;
            App.activePageIndex = 0;
            repaginateAllLinkedSections({ fromPageContents: true });
            App.selectedPageIds = App.pages.map(function (p) {
              return p.id;
            });
            syncEditorToCurrentPage();
            renderAll();
            showToast(
              '本文ファイル (' + file.name + ' / ' + App.pages.length + '頁) を読み込みました'
            );
          } else {
            showToast('有効なページデータが見つかりませんでした', true);
          }
        });
        e.target.value = '';
      });
    }

    // 8. プロジェクト一括JSON保存・読込・初期化
    bindClick('btn-save-project-json', function () {
      global.TategakiExporters.saveProjectBundleJson(App.settings, App.pages);
      showToast('プロジェクト一括ファイル (.json) を保存しました');
    });

    const inputProjectJson = document.getElementById('input-load-project-json');
    if (inputProjectJson) {
      inputProjectJson.addEventListener('change', function (e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        file.text().then(function (txt) {
          try {
            const parsed = JSON.parse(txt);
            if (parsed.settings) App.settings = parsed.settings;
            if (Array.isArray(parsed.pages) && parsed.pages.length > 0) {
              App.pages = parsed.pages;
              App.activePageIndex = 0;
              // content だけではページ境界の空行や [改ページ] 等が失われるため rawSlice から復元する
              repaginateAllLinkedSections({ fromPageContents: false });
              App.selectedPageIds = App.pages.map(function (p) {
                return p.id;
              });
            }
            syncSettingsToInputs();
            syncEditorToCurrentPage();
            renderAll();
            showToast('プロジェクト一括ファイルを読み込みました');
          } catch (err) {
            showToast('JSONファイルの解析に失敗しました', true);
          }
        });
        e.target.value = '';
      });
    }

    // 確認モーダル（別窓：初期サンプル原稿に戻す ／ 新規作成）
    const confirmModal = document.getElementById('confirm-action-modal');
    const confirmMessageEl = document.getElementById('confirm-modal-message');
    let pendingConfirmAction = null;

    function openConfirmModal(message, onConfirmFn) {
      pendingConfirmAction = onConfirmFn;
      if (confirmMessageEl) {
        confirmMessageEl.textContent = message;
      }
      if (confirmModal) {
        confirmModal.style.display = 'flex';
      }
    }

    function closeConfirmModal() {
      pendingConfirmAction = null;
      if (confirmModal) {
        confirmModal.style.display = 'none';
      }
    }

    bindClick('btn-confirm-modal-yes', function () {
      const fn = pendingConfirmAction;
      closeConfirmModal();
      if (typeof fn === 'function') {
        fn();
      }
    });

    bindClick('btn-confirm-modal-no', function () {
      closeConfirmModal();
    });

    if (confirmModal) {
      confirmModal.addEventListener('click', function (e) {
        if (e.target === confirmModal) {
          closeConfirmModal();
        }
      });
    }

    bindClick('btn-reset-sample', function () {
      openConfirmModal('初期サンプル原稿に戻しますか？', function () {
        pushUndoSnapshot('初期サンプル原稿に戻す');
        App.settings = global.TategakiState.createDefaultSettings();
        App.pages = global.TategakiState.createSamplePages();
        App.activePageIndex = 0;
        repaginateAllLinkedSections({ fromPageContents: true });
        App.selectedPageIds = [];
        syncSettingsToInputs();
        syncEditorToCurrentPage({ forceReloadText: true });
        renderAll();
        showToast('初期サンプル原稿・デフォルト設定に戻しました');
      });
    });

    bindClick('btn-new-blank-document', function () {
      openConfirmModal('新規作成（白紙にする）を実行しますか？', function () {
        pushUndoSnapshot('新規作成（白紙にする）');
        App.pages = [
          {
            id: 'page-1',
            type: 'body',
            flowBreakBefore: false,
            tobiraData: null,
            tocData: null,
            content: '',
            fontOverride: null
          }
        ];
        App.activePageIndex = 0;
        repaginateAllLinkedSections({ fromPageContents: true });
        App.selectedPageIds = [];
        syncEditorToCurrentPage({ forceReloadText: true });
        renderAll();
        showToast('新規作成（白紙の本文1ページ）にしました');
      });
    });
  }

  async function runWithProgressModal(taskFn, doneMsg) {
    const modal = document.getElementById('export-progress-modal');
    const textEl = document.getElementById('export-progress-text');
    const barEl = document.getElementById('export-progress-bar');

    if (modal) modal.style.display = 'flex';
    try {
      await taskFn(function (cur, total, msg) {
        if (textEl) textEl.textContent = msg;
        if (barEl) barEl.style.width = Math.round((cur / total) * 100) + '%';
      });
      showToast(doneMsg);
    } catch (err) {
      console.error(err);
      showToast('出力エラー: ' + err.message, true);
    } finally {
      if (modal) modal.style.display = 'none';
    }
  }

  function scheduleRender() {
    clearTimeout(App.renderTimer);
    App.renderTimer = setTimeout(function () {
      renderAll();
    }, 35);
  }

  function scheduleRepaginateAndRender() {
    clearTimeout(App.renderTimer);
    App.renderTimer = setTimeout(function () {
      repaginateAllLinkedSections({ fromPageContents: false });
      renderAll();
    }, 35);
  }

  function schedulePreviewAndCounterRender() {
    clearTimeout(App.renderTimer);
    App.renderTimer = setTimeout(function () {
      updateEditorHeaderAndSectionIndicators();
      renderSpreadPreview();
      renderPageStripAndCounters();
      saveToLocalStorage();
    }, 35);
  }

  function renderAll() {
    syncEditorToCurrentPage();
    renderSpreadPreview();
    renderPageStripAndCounters();
    saveToLocalStorage();
  }

  document.addEventListener('DOMContentLoaded', init);
})(window);
