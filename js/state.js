/**
 * 縦書き同人小説書けるくん - State & Default Configuration
 */
(function (global) {
  'use strict';

  const PAPER_PRESETS = {
    A6: { name: 'A6（文庫サイズ）', widthMm: 105, heightMm: 148 },
    SHINSHO: { name: '新書判', widthMm: 103, heightMm: 182 },
    B6: { name: 'B6判', widthMm: 128, heightMm: 182 },
    A5: { name: 'A5判', widthMm: 148, heightMm: 210 },
    CUSTOM: { name: 'カスタムサイズ', widthMm: 105, heightMm: 148 }
  };

  // 英語フォントファミリー名 → 日本語表示名の変換辞書テーブル
  const FONT_NAME_JA_MAP = {
    'Yu Mincho': '游明朝 (Yu Mincho)',
    'YuMincho': '游明朝 (Yu Mincho)',
    'Yu Gothic': '游ゴシック (Yu Gothic)',
    'YuGothic': '游ゴシック (Yu Gothic)',
    'Yu Gothic UI': '游ゴシック UI (Yu Gothic UI)',
    'Meiryo': 'メイリオ (Meiryo)',
    'Meiryo UI': 'メイリオ UI (Meiryo UI)',
    'MS Mincho': 'ＭＳ 明朝 (MS Mincho)',
    'MS Gothic': 'ＭＳ ゴシック (MS Gothic)',
    'BIZ UDPMincho': 'BIZ UDP明朝 (BIZ UDPMincho)',
    'BIZ UDMincho': 'BIZ UD明朝 (BIZ UDMincho)',
    'BIZ UDPGothic': 'BIZ UDPゴシック (BIZ UDPGothic)',
    'BIZ UDGothic': 'BIZ UDゴシック (BIZ UDGothic)',
    'UD Digi Kyokasho N-R': 'UD デジタル 教科書体 N-R',
    'UD Digi Kyokasho NK-R': 'UD デジタル 教科書体 NK-R',
    'UD Digi Kyokasho NP-R': 'UD デジタル 教科書体 NP-R',
    'HGMinchoB': 'ＨＧ明朝Ｂ (HGMinchoB)',
    'HGKyokashotai': 'ＨＧ教科書体 (HGKyokashotai)',
    'Hiragino Mincho ProN': 'ヒラギノ明朝 ProN (Hiragino Mincho ProN)',
    'Hiragino Kaku Gothic ProN': 'ヒラギノ角ゴ ProN (Hiragino Kaku Gothic ProN)',
    'Hiragino Maru Gothic ProN': 'ヒラギノ丸ゴ ProN (Hiragino Maru Gothic ProN)',
    'Source Han Serif JP': '源ノ明朝 (Source Han Serif JP)',
    'Source Han Sans JP': '源ノ角ゴシック (Source Han Sans JP)',
    'IPAexMincho': 'IPAex明朝 (IPAexMincho)',
    'IPAMincho': 'IPA明朝 (IPAMincho)',
    'GenEi Koburi Mincho v6': '源暎こぶり明朝 (GenEi Koburi Mincho)',
    'GenEi Chikugo Mincho v2': '源暎ちくご明朝 (GenEi Chikugo Mincho)'
  };

  // 全ブラウザ対応：指定したフォントがPCに入っているか判定する関数
  function isFontInstalled(fontName) {
    try {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      const testText = 'あいうえおアイウエオ漢字ABC0123';

      // 基準となる標準フォント（monospace）での描画幅を計測
      ctx.font = '72px monospace';
      const baselineWidth = ctx.measureText(testText).width;

      // 調査したいフォントを指定し、存在しなければ monospace にフォールバックさせる
      ctx.font = `72px "${fontName}", monospace`;
      const targetWidth = ctx.measureText(testText).width;

      // 幅が変わっていれば、そのフォントがPCにインストールされていると判定できる
      return baselineWidth !== targetWidth;
    } catch (e) {
      return false;
    }
  }

  // 主要システムフォント候補定義（PCに入っていることが確認できたものだけプルダウンに表示）
  const SYSTEM_FONT_CANDIDATES = [
    {
      id: 'yumincho',
      familyEn: 'Yu Mincho',
      familyJa: '游明朝',
      label: FONT_NAME_JA_MAP['Yu Mincho'],
      css: '"Yu Mincho", "游明朝", YuMincho, "Hiragino Mincho ProN", "MS PMincho", serif',
      isDefault: true
    },
    {
      id: 'yugothic',
      familyEn: 'Yu Gothic',
      familyJa: '游ゴシック',
      label: FONT_NAME_JA_MAP['Yu Gothic'],
      css: '"Yu Gothic", "游ゴシック", YuGothic, "Hiragino Sans", sans-serif'
    },
    {
      id: 'biz-udpmincho',
      familyEn: 'BIZ UDPMincho',
      familyJa: 'BIZ UDP明朝',
      label: FONT_NAME_JA_MAP['BIZ UDPMincho'],
      css: '"BIZ UDPMincho", "BIZ UDP明朝", "Yu Mincho", serif'
    },
    {
      id: 'biz-udmincho',
      familyEn: 'BIZ UDMincho',
      familyJa: 'BIZ UD明朝',
      label: FONT_NAME_JA_MAP['BIZ UDMincho'],
      css: '"BIZ UDMincho", "BIZ UD明朝", "Yu Mincho", serif'
    },
    {
      id: 'biz-udgothic',
      familyEn: 'BIZ UDPGothic',
      familyJa: 'BIZ UDPゴシック',
      label: FONT_NAME_JA_MAP['BIZ UDPGothic'],
      css: '"BIZ UDPGothic", "BIZ UDPゴシック", "Yu Gothic", sans-serif'
    },
    {
      id: 'biz-udgothic-mono',
      familyEn: 'BIZ UDGothic',
      familyJa: 'BIZ UDゴシック',
      label: FONT_NAME_JA_MAP['BIZ UDGothic'],
      css: '"BIZ UDGothic", "BIZ UDゴシック", "Yu Gothic", sans-serif'
    },
    {
      id: 'ms-mincho',
      familyEn: 'MS Mincho',
      familyJa: 'ＭＳ 明朝',
      label: FONT_NAME_JA_MAP['MS Mincho'],
      css: '"MS Mincho", "ＭＳ 明朝", "Yu Mincho", serif'
    },
    {
      id: 'ms-gothic',
      familyEn: 'MS Gothic',
      familyJa: 'ＭＳ ゴシック',
      label: FONT_NAME_JA_MAP['MS Gothic'],
      css: '"MS Gothic", "ＭＳ ゴシック", "Yu Gothic", sans-serif'
    },
    {
      id: 'meiryo',
      familyEn: 'Meiryo',
      familyJa: 'メイリオ',
      label: FONT_NAME_JA_MAP['Meiryo'],
      css: '"Meiryo", "メイリオ", "Yu Gothic", sans-serif'
    },
    {
      id: 'ud-digi-kyokasho',
      familyEn: 'UD Digi Kyokasho N-R',
      familyJa: 'UD デジタル 教科書体 N-R',
      label: FONT_NAME_JA_MAP['UD Digi Kyokasho N-R'],
      css: '"UD Digi Kyokasho N-R", "UD デジタル 教科書体 N-R", "Yu Mincho", serif'
    },
    {
      id: 'hg-mincho-b',
      familyEn: 'HGMinchoB',
      familyJa: 'ＨＧ明朝Ｂ',
      label: FONT_NAME_JA_MAP['HGMinchoB'],
      css: '"HGMinchoB", "ＨＧ明朝Ｂ", "Yu Mincho", serif'
    },
    {
      id: 'hg-kyokasho',
      familyEn: 'HGKyokashotai',
      familyJa: 'ＨＧ教科書体',
      label: FONT_NAME_JA_MAP['HGKyokashotai'],
      css: '"HGKyokashotai", "ＨＧ教科書体", "Yu Mincho", serif'
    },
    {
      id: 'hiragino-mincho',
      familyEn: 'Hiragino Mincho ProN',
      familyJa: 'ヒラギノ明朝 ProN',
      label: FONT_NAME_JA_MAP['Hiragino Mincho ProN'],
      css: '"Hiragino Mincho ProN", "ヒラギノ明朝 ProN", "Yu Mincho", serif'
    },
    {
      id: 'hiragino-gothic',
      familyEn: 'Hiragino Kaku Gothic ProN',
      familyJa: 'ヒラギノ角ゴ ProN',
      label: FONT_NAME_JA_MAP['Hiragino Kaku Gothic ProN'],
      css: '"Hiragino Kaku Gothic ProN", "ヒラギノ角ゴ ProN", "Yu Gothic", sans-serif'
    },
    {
      id: 'hiragino-maru',
      familyEn: 'Hiragino Maru Gothic ProN',
      familyJa: 'ヒラギノ丸ゴ ProN',
      label: FONT_NAME_JA_MAP['Hiragino Maru Gothic ProN'],
      css: '"Hiragino Maru Gothic ProN", "ヒラギノ丸ゴ ProN", "Yu Gothic", sans-serif'
    },
    {
      id: 'source-han-serif',
      familyEn: 'Source Han Serif JP',
      familyJa: '源ノ明朝 JP',
      label: FONT_NAME_JA_MAP['Source Han Serif JP'],
      css: '"Source Han Serif JP", "源ノ明朝 JP", "Noto Serif JP", "Yu Mincho", serif'
    },
    {
      id: 'source-han-sans',
      familyEn: 'Source Han Sans JP',
      familyJa: '源ノ角ゴシック JP',
      label: FONT_NAME_JA_MAP['Source Han Sans JP'],
      css: '"Source Han Sans JP", "源ノ角ゴシック JP", "Noto Sans JP", "Yu Gothic", sans-serif'
    },
    {
      id: 'ipaex-mincho',
      familyEn: 'IPAexMincho',
      familyJa: 'IPAex明朝',
      label: FONT_NAME_JA_MAP['IPAexMincho'],
      css: '"IPAexMincho", "IPAex明朝", "Yu Mincho", serif'
    },
    {
      id: 'ipa-mincho',
      familyEn: 'IPAMincho',
      familyJa: 'IPA明朝',
      label: FONT_NAME_JA_MAP['IPAMincho'],
      css: '"IPAMincho", "IPA明朝", "Yu Mincho", serif'
    },
    {
      id: 'genei-koburi',
      familyEn: 'GenEi Koburi Mincho v6',
      familyJa: '源暎こぶり明朝 v6',
      label: FONT_NAME_JA_MAP['GenEi Koburi Mincho v6'],
      css: '"GenEi Koburi Mincho v6", "源暎こぶり明朝 v6", "Yu Mincho", serif'
    },
    {
      id: 'genei-chikugo',
      familyEn: 'GenEi Chikugo Mincho v2',
      familyJa: '源暎ちくご明朝 v2',
      label: FONT_NAME_JA_MAP['GenEi Chikugo Mincho v2'],
      css: '"GenEi Chikugo Mincho v2", "源暎ちくご明朝 v2", "Yu Mincho", serif'
    }
  ];

  // 候補リストからPCに入っているものだけを抽出する用リスト
  const CANDIDATE_FONTS = SYSTEM_FONT_CANDIDATES.map(function (c) {
    return c.familyEn;
  });

  // 全環境で同じように使えるWebフォント定義
  const WEB_FONT_PRESETS = [
    {
      id: 'noto-serif',
      label: '【Web】源ノ明朝 / Noto Serif JP',
      css: '"Noto Serif JP", "Source Han Serif JP", "Yu Mincho", serif',
      category: 'web'
    },
    {
      id: 'web-shippori-mincho',
      label: '【Web】しっぽり明朝 (Shippori Mincho)',
      css: '"Shippori Mincho", "Yu Mincho", serif',
      category: 'web'
    },
    {
      id: 'web-zen-old-mincho',
      label: '【Web】Zen オールド明朝 (Zen Old Mincho)',
      css: '"Zen Old Mincho", "Yu Mincho", serif',
      category: 'web'
    },
    {
      id: 'web-sawarabi-mincho',
      label: '【Web】さわらび明朝 (Sawarabi Mincho)',
      css: '"Sawarabi Mincho", "Yu Mincho", serif',
      category: 'web'
    },
    {
      id: 'web-klee-one',
      label: '【Web】Klee One（教科書体風）',
      css: '"Klee One", "UD Digi Kyokasho N-R", "Yu Mincho", serif',
      category: 'web'
    },
    {
      id: 'web-noto-sans-jp',
      label: '【Web】源ノ角ゴシック / Noto Sans JP',
      css: '"Noto Sans JP", "Source Han Sans JP", "Yu Gothic", sans-serif',
      category: 'web'
    },
    {
      id: 'web-zen-kaku-gothic',
      label: '【Web】Zen 角ゴシック New',
      css: '"Zen Kaku Gothic New", "Yu Gothic", sans-serif',
      category: 'web'
    }
  ];

  // ユーザーが読み込んだ複数カスタムフォントの保持リスト
  const CUSTOM_FONT_LIST = [];

  // OpenType / TrueType バイナリの name テーブルから日本語フォント名（または英語名）を抽出するヘルパー
  function extractOpenTypeFontName(arrayBuffer, fallbackFileName) {
    const cleanFallback = String(fallbackFileName || 'カスタムフォント').replace(/\.[a-z0-9]+$/i, '');
    try {
      if (!arrayBuffer || arrayBuffer.byteLength < 12) return cleanFallback;
      const view = new DataView(arrayBuffer);
      const sfntVersion = view.getUint32(0, false);
      // TrueType (0x00010000), OpenType CFF ('OTTO' = 0x4F54544F), 'true' (0x74727565)
      if (
        sfntVersion !== 0x00010000 &&
        sfntVersion !== 0x4f54544f &&
        sfntVersion !== 0x74727565
      ) {
        return cleanFallback;
      }
      const numTables = view.getUint16(4, false);
      let nameTableOffset = 0;
      let nameTableLength = 0;

      for (let i = 0; i < numTables; i++) {
        const entryOffset = 12 + i * 16;
        if (entryOffset + 16 > view.byteLength) break;
        const tag = String.fromCharCode(
          view.getUint8(entryOffset),
          view.getUint8(entryOffset + 1),
          view.getUint8(entryOffset + 2),
          view.getUint8(entryOffset + 3)
        );
        if (tag === 'name') {
          nameTableOffset = view.getUint32(entryOffset + 8, false);
          nameTableLength = view.getUint32(entryOffset + 12, false);
          break;
        }
      }

      if (!nameTableOffset || nameTableOffset + 6 > view.byteLength) {
        return cleanFallback;
      }

      const count = view.getUint16(nameTableOffset + 2, false);
      const stringStorageOffset = nameTableOffset + view.getUint16(nameTableOffset + 4, false);

      let jaFamily = '';
      let jaFull = '';
      let enFamily = '';
      let enFull = '';

      for (let i = 0; i < count; i++) {
        const recOffset = nameTableOffset + 6 + i * 12;
        if (recOffset + 12 > view.byteLength) break;
        const platformID = view.getUint16(recOffset, false);
        const encodingID = view.getUint16(recOffset + 2, false);
        const languageID = view.getUint16(recOffset + 4, false);
        const nameID = view.getUint16(recOffset + 6, false);
        const length = view.getUint16(recOffset + 8, false);
        const strOffset = stringStorageOffset + view.getUint16(recOffset + 10, false);

        if (nameID !== 1 && nameID !== 4 && nameID !== 16) continue;
        if (strOffset + length > view.byteLength || length <= 0) continue;

        let decoded = '';
        if (platformID === 3 && (encodingID === 1 || encodingID === 10)) {
          // Windows UTF-16BE
          const chars = [];
          for (let b = 0; b + 1 < length; b += 2) {
            const code = view.getUint16(strOffset + b, false);
            if (code !== 0) chars.push(String.fromCharCode(code));
          }
          decoded = chars.join('').trim();
          if (languageID === 0x0411) {
            if (nameID === 16 || nameID === 1) jaFamily = jaFamily || decoded;
            if (nameID === 4) jaFull = jaFull || decoded;
          } else {
            if (nameID === 16 || nameID === 1) enFamily = enFamily || decoded;
            if (nameID === 4) enFull = enFull || decoded;
          }
        } else if (platformID === 1 && encodingID === 0 && languageID === 0) {
          // Macintosh Roman (ASCII)
          const chars = [];
          for (let b = 0; b < length; b++) {
            const code = view.getUint8(strOffset + b);
            if (code >= 32 && code < 127) chars.push(String.fromCharCode(code));
          }
          decoded = chars.join('').trim();
          if (nameID === 1) enFamily = enFamily || decoded;
          if (nameID === 4) enFull = enFull || decoded;
        }
      }

      const bestName = jaFull || jaFamily || enFull || enFamily;
      if (bestName) {
        return FONT_NAME_JA_MAP[bestName] || bestName;
      }
    } catch (e) {
      // パース失敗時はファイル名へフォールバック
    }
    return FONT_NAME_JA_MAP[cleanFallback] || cleanFallback;
  }

  const FONT_PRESETS = [];

  function refreshAvailableFonts() {
    FONT_PRESETS.length = 0;

    // 1. 候補リスト照合でPCにインストールされている主要システムフォントのみ抽出（デフォルト「游明朝 (Yu Mincho)」は常時先頭に配置）
    SYSTEM_FONT_CANDIDATES.forEach(function (cand) {
      const installed =
        cand.isDefault ||
        isFontInstalled(cand.familyEn) ||
        Boolean(cand.familyJa && isFontInstalled(cand.familyJa));
      if (installed) {
        FONT_PRESETS.push({
          id: cand.id,
          label: cand.label,
          css: cand.css,
          category: 'system'
        });
      }
    });

    // 2. 全環境共通で使えるWebフォントを追加
    WEB_FONT_PRESETS.forEach(function (wf) {
      FONT_PRESETS.push({
        id: wf.id,
        label: wf.label,
        css: wf.css,
        category: 'web'
      });
    });

    // 3. ユーザーが追加読み込みしたカスタムフォント（複数対応・実フォント名表示）を追加
    CUSTOM_FONT_LIST.forEach(function (cf) {
      FONT_PRESETS.push({
        id: cf.id,
        label: cf.label,
        css: cf.css,
        category: 'custom',
        displayName: cf.displayName,
        fileName: cf.fileName
      });
    });

    return FONT_PRESETS;
  }

  function registerCustomFont(fontEntry) {
    if (!fontEntry || !fontEntry.id) return null;
    const existingIdx = CUSTOM_FONT_LIST.findIndex(function (item) {
      return item.id === fontEntry.id || item.displayName === fontEntry.displayName;
    });
    if (existingIdx !== -1) {
      CUSTOM_FONT_LIST[existingIdx] = fontEntry;
    } else {
      CUSTOM_FONT_LIST.push(fontEntry);
    }
    refreshAvailableFonts();
    return fontEntry;
  }

  // 起動時にインストール済みフォント照合＆Webフォント一覧を構築
  refreshAvailableFonts();

  const UI_THEMES = {
    'dark-sumi': {
      name: '墨色ダーク（標準）',
      bgApp: '#191b20',
      bgPanel: '#22252c',
      bgCard: '#2a2e37',
      bgInput: '#17191e',
      bgEditor: '#16181d',
      textMain: '#ece9e2',
      textMuted: '#a6a29a',
      borderSubtle: '#383d49',
      accentGold: '#d4a857'
    },
    'light-washi': {
      name: '生成り和紙（ライト）',
      bgApp: '#ebe6dc',
      bgPanel: '#f5f1e8',
      bgCard: '#ffffff',
      bgInput: '#fcfaf5',
      bgEditor: '#faf7f0',
      textMain: '#2b2823',
      textMuted: '#6e685f',
      borderSubtle: '#d5cec0',
      accentGold: '#9c6b21'
    },
    'sepia-amber': {
      name: '琥珀セピア（暖色）',
      bgApp: '#231d18',
      bgPanel: '#2d251e',
      bgCard: '#382e25',
      bgInput: '#1d1712',
      bgEditor: '#201a15',
      textMain: '#f2e6d8',
      textMuted: '#b5a390',
      borderSubtle: '#4d3f33',
      accentGold: '#df9e4b'
    },
    'midnight-indigo': {
      name: '群青ミッドナイト（濃紺）',
      bgApp: '#121824',
      bgPanel: '#192233',
      bgCard: '#212d42',
      bgInput: '#0f141f',
      bgEditor: '#111724',
      textMain: '#e6edf7',
      textMuted: '#94a3b8',
      borderSubtle: '#2e3e59',
      accentGold: '#63b3ed'
    },
    'matcha-green': {
      name: '深緑モダン（抹茶）',
      bgApp: '#161f1b',
      bgPanel: '#1e2924',
      bgCard: '#26352e',
      bgInput: '#121916',
      bgEditor: '#141c18',
      textMain: '#e7f0ec',
      textMuted: '#9ab0a5',
      borderSubtle: '#354a40',
      accentGold: '#7bc496'
    }
  };

  function createDefaultSettings() {
    return {
      // 1. サイズ設定 (デフォルト: A6 / 600dpi / 塗り足し3mm)
      paper: {
        preset: 'A6',
        widthMm: 105,
        heightMm: 148,
        dpi: 600,
        bleedMm: 3,
        showTrimMarksInPreview: false,
        showMarginGuides: true
      },

      // 2. 環境設定：フォントと文字サイズ（本文・扉・目次・ノンブル・ノンブル右横コメントで別々に保持）
      typography: {
        enablePageFontOverride: false, // ページ毎にフォントを設定する（デフォルトOFF）
        body: {
          fontId: 'yumincho',
          fontSizePt: 8.5,
          charSpacingRatio: 0.0 // 微調整用（0で自動または標準字送り）
        },
        tobira: {
          fontId: 'yumincho',
          titleFontSizePt: 18.0,
          subtitleFontSizePt: 10.5,
          authorFontSizePt: 10.0,
          bodyFontSizePt: 9.0,
          layoutStyle: 'classic-center', // 'classic-center' | 'right-top' | 'framed-double' | 'free-vertical'
          titleYOffsetMm: 18,
          titleXOffsetMm: 0,
          authorBottomOffsetMm: 18,
          showBorder: true
        },
        toc: {
          fontId: 'yumincho',
          headingFontSizePt: 13.0,
          itemFontSizePt: 9.0,
          linePitchMm: 7.5,
          topIndentChars: 2,
          showLeaderDots: true,
          numberStyle: 'kanji', // 'kanji' | 'arabic-tcy'
          layoutAlign: 'right', // 'right' (右揃え) | 'center' (見出しを含めず中央揃え) | 'center-all' (見出しを含めて中央揃え)
          autoCollectFromBody: false
        },
        nombre: {
          fontId: 'yumincho'
        },
        nombreComment: {
          fontId: 'yumincho'
        }
      },

      // 3. 段組み・レイアウト設定
      layout: {
        columns: 1, // 1 or 2
        columnGapMm: 5.0,
        charsPerLine: 41,
        linesPerPage: 18,
        autoLineSpacing: true,
        manualLineGapMm: 1.5,
        autoFitCharPitch: true, // 41文字を行長エリア内に綺麗に収める自動字送り調整
        margins: {
          // ノド側1.5cm・小口側1cm・天あき1.6cm・地あき1.2cm
          gutterMm: 15.0,   // ノド側 (偶数頁で左、奇数頁で右)
          outerMm: 10.0,    // 小口側 (偶数頁で右、奇数頁で左)
          topMm: 16.0,      // 天あき
          bottomMm: 12.0    // 地あき
        }
      },

      // 4. ヘッダーとフッター設定（天あき・地あきに配置する例外処理）
      headerFooter: {
        useHeader: true,
        useFooter: false,
        fontSizePt: 7.0,
        headerDistanceFromTopMm: 8.5, // 天あき(16mm)内に配置
        footerDistanceFromBottomMm: 6.5, // 地あき(12mm)内に配置
        nombrePlacement: 'header', // 'header' | 'footer'
        startPageNumber: 1,
        hideOnTobira: true,
        hideOnToc: false,
        oddPageCommentGapMm: 5.0, // 奇数頁にはノンブルの0.5cm(5mm)右横にコメント配置
        oddPageCommentSource: 'tobira-title', // 'tobira-title' | 'custom'
        customOddPageComment: '',
        evenPageComment: '',
        nombreFormat: 'plain' // 'plain' | 'padded' | 'dash'
      },

      // 5. 組版処理（禁則・縦中横・約物・改丁）
      rules: {
        // 禁則処理と行末調整
        enableKinsoku: true,
        lineEndAdjustMode: 'burasage', // 'burasage' (ぶら下げ組) | 'oidashi' (追い出し) | 'oikomi' (追い込み)
        hangingChars: '、。，．',
        lineStartProhibited: '、。，．・：；！？）」』】〉》〕｝］”’ーゝゞ々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ',
        lineEndProhibited: '（「『【〈《〔｛［“‘',

        // 縦中横と英数字・欧文処理
        autoTcyDigits: 2, // 0: オフ, 2: 2桁まで自動縦中横, 3: 3桁まで自動縦中横
        autoTcyExclamation: true, // !?, !!, ?!, ?? 等を1マス縦中横に
        latinMode: 'rotate', // 'rotate' (プロポーショナル横組み90度回転) | 'smart' (2?3字略語は正立・英文は回転) | 'rotate-mono' (等幅90度回転) | 'upright' (一文字ずつ縦に並べる)
        latinWordWrap: true, // 英単語が行末で途中分割されないようワードラップ
        latinWaouSpacing: 'sixth', // 'sixth' (六分アキ) | 'quarter' (四分アキ) | 'none' (ベタ)
        latinFontScale: 0.95, // 欧文の文字サイズ比率 (0.80 ? 1.15)
        latinBaselineOffset: 0.0, // 欧文の左右中心位置微調整 (-0.25 ? +0.25)

        // 約物の連続・アキ調整
        connectDashEllipsis: true, // 2倍ダッシュ（――）や三点リーダー（……）の隙間なし連結描画
        bracketSpacing: 'beta', // 'beta' (ベタ組み) | 'nibun' (二分アキ)
        punctuationAfterSpacing: 'beta', // 'beta' (ベタ組み) | 'nibun' (二分アキ)
        lineStartBracketIndent: 'none', // 'none' (行頭天付き) | 'nibun' (二分アキ)
        autoFullSpaceAfterExclQuest: true, // ！や？直後の全角一マス空け自動補完

        // 改丁の基準
        kaichoTarget: 'odd', // 'odd' (次の奇数頁へ) | 'even' (次の偶数頁へ)

        // 割付ページに応じた本文エディタ背景色変化表示（デフォルトOFF）
        showPageBgHighlight: false,

        // 文頭の空白1文字（字下げ）下げ忘れ注意喚起・補助機能
        checkIndentWarning: true
      },

      // 6. プレビュー表示設定（デフォルトは「右綴じ見開き」）
      view: {
        mode: 'spread', // 'spread' (見開き: 右偶数・左奇数) | 'single' (単ページ) | 'grid' (9頁グリッド俯瞰)
        spreadPairing: 'pair-rtl', // デフォルト: 'pair-rtl' (右綴じ見開き: P.3左奇・P.2右偶)
        gridDirection: 'ltr', // 'ltr' (左上から順) | 'rtl' (右上から縦書き順)
        gridPageOffset: 0, // 9頁単位グリッド表示時の開始オフセット(0, 9, 18...)
        zoom: 1.0
      },

      // 7. UIパネル折り畳み状態＆UI設定（色調・ゲージ色・締切・ショートカットキー）
      ui: {
        leftSidebarCollapsed: true,
        bottomDockCollapsed: true,
        linkedSectionBarCollapsed: true,
        themePanelCollapsed: true,
        editorPaneRatio: 0.445,
        themePreset: 'dark-sumi',
        customColors: {
          bgApp: '#191b20',
          bgPanel: '#22252c',
          bgEditor: '#16181d',
          textMain: '#ece9e2',
          accentGold: '#d4a857'
        },
        gaugeColors: {
          elapsed: '#5b9bd5',
          deadlineSafe: '#4caf50',
          deadlineWarn: '#f5a623',
          deadlineDanger: '#e5484d'
        },
        deadline: {
          startAt: 0,
          targetAt: 0
        },
        shortcuts: {
          saveManuscriptCsv: 'Ctrl+S',
          saveSettingsCsv: '',
          saveProjectJson: '',
          exportPlainTxt: '',
          exportPsdZip: '',
          exportPngZip: '',
          insertRuby: '',
          insertTcy: '',
          insertDash: '',
          insertEllipsis: '',
          insertPageBreak: '',
          insertKaicho: '',
          addNewFlowSection: '',
          previewForward: '',
          previewBackward: ''
        },
        headerDisplay: {
          showTimeDeadlineBar: true,
          showTotalCounterBar: true,
          showRawAndNoSpace: true,
          show400Sheets: false
        }
      },

      // 8. 出力・PDF設定
      exportOptions: {
        pdfColorMode: 'grayscale-k100', // 'grayscale-k100' | 'rgb'
        pdfStandard: 'PDF/X-1a:2001', // 'PDF/X-1a:2001' | 'PDF/X-4'
        includeTrimMarks: true,
        exportBleedMm: 3, // 0 | 3 | 5
        embedFontSubset: true,
        epubLayout: 'reflow' // 'reflow' (縦書きリフロー) | 'fixed' (縦書き固定レイアウト)
      }
    };
  }

  function createSamplePages() {
    return [
      {
        id: 'page-1',
        type: 'blank',
        flowBreakBefore: false,
        tobiraData: null,
        tocData: null,
        content: '',
        fontOverride: null
      },
      {
        id: 'page-2',
        type: 'blank',
        flowBreakBefore: false,
        tobiraData: null,
        tocData: null,
        content: '',
        fontOverride: null
      },
      {
        id: 'page-3',
        type: 'toc',
        flowBreakBefore: false,
        tobiraData: null,
        tocData: {
          heading: '目　次',
          items: [
            { title: 'ミズギのタクシー（見本）', page: '7' },
            { title: '説明等', page: '11' }
          ]
        },
        content: '',
        fontOverride: null
      },
      {
        id: 'page-4',
        type: 'tobira',
        flowBreakBefore: false,
        tobiraData: {
          title: 'ミズギのタクシー（見本）',
          subtitle: '',
          author: 'しーさいど',
          note: ''
        },
        tocData: null,
        content: '',
        fontOverride: null
      },
      {
        id: 'page-5',
        type: 'body',
        flowBreakBefore: false,
        tobiraData: null,
        tocData: null,
        content: [
          '　どれくらい眠っていたのだろう、時間の感覚が全くなかった。ゴウンゴウンと心地よい音が車内に響いている。窓の外に目をやれば、列車は長大な橋を渡っている所だった。眼下には淀んだ色の水面が拡がっており、波のない滑らかなそれは、海か大河か、見当もつかない。',
          '',
          '　じきに鉄橋が尽き、車内が幾分静かになって、少し走ってからアナウンスが入る。',
          '「まもなく、遠渡《とおわたり》に着きます。お降りの方は、お支度をお願いします」',
          '　聞き覚えのない駅名だが、ここで降りなければ、という確信が心中にあった。降りる支度をしようとする間に、やや荒い制動と共に列車がホームに停まる。',
          '　ホームに降り立てば『ようこそ遠渡へ』という達筆な看板が目に入る。',
          '「さて……」',
          '　何気なくスーツのポケットへ手を突っ込むと、右手の指先に折り畳まれた紙片が触れた。取り出して広げてみる。',
          '『とこなぎ旅館、遠渡駅から車で５分』',
          '　ボールペンで走り書きされた、見慣れた自分の筆跡に、そうだったと、俺は合点が行った。',
          '　あまりにも仕事が立て込んでおり、このままでは心身が擦り減るばかりと、半ば強引に有給休暇を取って、会社からそのまま旅に出たのだ。静かな旅館でリフレッシュするつもりだった。メモの文字をきっかけに、記憶の空白が帳尻合わせのように埋まっていく。',
          '　だが、それならば、この左手にぶら下げている紙袋は一体なんだろうか。濃紺の地に金色の獅子があしらわれた老舗和菓子店の紙袋の中には、羊羹が二棹入っている。俺はなぜ、旅行に進物用の羊羹など持ってきたのだろうか？　得意先に詫びを入れに行くわけでもないのに……。',
          '　紙袋の中身は気にかかったが、ここで悩んでも仕方ない。宿で茶請けにすればいいのだと頭を振り、改札へ向かった。',
          '',
          '　暇そうな駅員が立っている改札を抜けると、駅前のロータリーに出る。華やかさには欠けるが、人の気配はあり、ロータリーの出口あたりには『歓迎・遠渡』というゲートのような構造物がやや錆びて立っていた。',
          '　そのロータリーの一角に、ぽつんと一台のタクシーが停まっていた。屋根の上の行灯には、青い小さな風車のマークがあしらわれている。俺が近づくと、運転手が気配を察したのか、後部座席の自動ドアが開く。俺は身をかがめてシートに滑り込むと、紙袋を膝上に置いた。',
          '',
          '「すみません、とこなぎ旅館までお願いします」',
          '「はーい、とこなぎ旅館ですね。かしこまりました！」',
          '　返ってきたのは、朗らかで、よく通る若い娘の声だった。タクシーは静かに発車すると、駅前から連なる商店街が左右に構える道を走り出した。',
          '　街の様子を見ようと前方に目を向けると、座席越しに見える運転手の姿に、違和感を覚えた。',
          '　白手袋がハンドルを掴んでいる。だが、袖がない。',
          '　タクシー運転手といえば、開襟シャツにベストというのが相場だ。しかし目の前の運転手は、滑らかな素肌の腕をそのまま伸ばしている。',
          '　驚いて視線を凝らす。バックミラーに映る顔は、まだ十代の終わりくらいに見えるあどけない少女だった。何より奇異なのは、その服装だった。',
          '　深い紺色の、伸縮性のある布地。飾りのない簡素なワンピース。どう見ても、学校のプールで女子生徒が着るようなスクール水着だった。',
          '　冗談だろうか。それとも何かの悪ふざけか。しかし、彼女の佇まいには、客を煽るような卑俗な色気もなく、どこか素朴ですらある。窓から差し込む淡い光の中に、彼女は不思議なほど自然に溶け込んでいた。',
          '',
          '「お客さん、遠くから来られたんですか？」',
          '　バックミラー越しに目が合う。',
          '「ええ……まあ、横浜のほうから」',
          '　俺は動揺を悟られまいと、平然とした声を出すように努めた。だが、視線のやり場に困ってしまう。',
          '「へえー、遠くからわざわざ！　ここに来る前は、何されてたんですか？」',
          '「何って……普通に、仕事ですよ。会社員なんで」',
          '「お仕事、忙しかったですか？」',
          '「まぁ営業なんで結構。それで少し、疲れが溜まってしまって」',
          '「それは大変でしたねぇ。この町は何もないですけど、静かで良い所ですから、ゆっくり休んでいってくださいね」',
          '「ありがとう……」',
          '　当たり障りのない返答を重ねながらも、俺の頭の中は「なぜ水着なのか」という疑問で埋め尽くされていた。新手の観光プロモーションなのだろうか。',
          '',
          '　気づけば車は小高い丘の細道を登っており、その中腹あたり、松林に囲まれた古い日本家屋の前で停車した。どうやら目的地の旅館のようだ。',
          '「はい、到着しましたー」',
          '「あ、はい。クレジットカードで……」',
          '「ごめんなさい、うち、使えないんですよ」',
          '　弱った。最近は何かとキャッシュレスで済んでしまうから、小銭の備えが心許ない。俺はポケットから財布を取り出し、小銭入れを開く。ちょうど銀色の硬貨が六枚、お誂《あつら》え向きのように入っていた。',
          '「あ、ちょうどあります」',
          '「はい、ちょうどいただきますね。ありがとうございます！」',
          '　少女の笑顔が眩しかった。',
          '',
          '　ドアが開く。車から降りかけたところで、俺はどうしても喉元まで出かかっていた問いを飲み込みきれず、振り返って尋ねてしまった。',
          '「あの……ひとつ、聞いてもいいですか」',
          '「なんですか？」',
          '「その格好……その水着は一体」',
          '「え、これ制服ですけど？」',
          '　さも当たり前のことを聞かれたというように、屈託のない声が返ってきた。',
          '「風車交通の乗務員は、みんなこれですよ？」',
          '「……制服、ですか」',
          '「はい！　動きやすいですし」',
          '「……そうなんだ。変なことを聞いてすみませんでした」',
          '「いいえ、全然！ それじゃあ、ごゆっくりどうぞー」',
          '',
          '　自動ドアがパタンと閉まり、風車のマークを乗せたタクシーは、軽やかなエンジン音を残して走り去る。',
          '　俺は、しばらくその後ろ姿を見送っていた。',
          '　世の中には、随分と奇妙なタクシーもあるものだ。この地方独特の風習か何かだろうか。俺はふっと小さく苦笑し、左手に提げた羊羹の紙袋を持ち直した。'
        ].join('\n'),
        fontOverride: null
      },
      {
        id: 'page-11',
        type: 'tobira',
        flowBreakBefore: false,
        tobiraData: {
          title: '説明等',
          subtitle: '',
          author: '',
          note: ''
        },
        tocData: null,
        content: '',
        fontOverride: null
      },
      {
        id: 'page-12',
        type: 'body',
        flowBreakBefore: true,
        tobiraData: null,
        tocData: null,
        content: [
          '　このテキストエディタは、作者（しーさいど）が文学フリマで小説を出すに当たり、既存のテキストエディタの仕様に納得行っていなかったので自分で作ったものである。テキストエディタ作成にあたってはＡＩを全面活用している（Google Gemini4Argon）。',
          '',
          '　機能としては「とりあえずテキストをどんどん打っていき、そのまま割付する」もしくは「別のテキストエディタで書いたテキストを流し込んで割付する」を想定している。',
          '',
          '　仕様面では二段組のオプションはあるが、基本的にはＡ６文庫本サイズの一段組を想定している（作者がその仕様で同人誌を作ったためである）。',
          '',
          '　便利機能《ルビを振る》や[縦中横:12345]は対応しているが、機能として最低限である。',
          '',
          'あと文頭１文字下げ忘れのチェック機能もついており、これはテキスト入力画面の下側にチェックを入れると使用できる（デフォルトではON）',
          '',
          '　使用フォントを変える機能も一応ついているが、文中の一部だけフォントを変えるような芸当には対応していない。これも現状の仕様である。',
          '',
          '　ページ属性は４つある。',
          '　本文……通常時に使うページ',
          '　扉………扉ページに使う',
          '　目次……目次ページに使う',
          '　空白……挿絵予定のページや、表１・表２などの予定ページに使う',
          '',
          '　このテキストエディタは「本文を書き出す」事のみを想定しており、同人誌として仕上げる場合、表紙や挿絵は別のソフトを使う想定である。オールインワンではないのは仕様。',
          '　なので「空白」ページをうまく活用し、他ソフトの編集労力削減に役立てて欲しい。',
          '',
          '　画像書き出しについては連番PSDおよび連番PNGに対応している。PDF出力機能については非対応だが、実はコード上にはAIが実装したものが存在している（PDF、EPUB3、Wordについてexporters.js上にあり）。動くはずだが、作者が現状で使わないので今回は表面上実装しなかった。使いたい方は自己責任で弄ってください。',
          '',
          '　初期化等は右側の「ファイル」タブの下の方にボタンがある。'
        ].join('\n'),
        fontOverride: {
          fontId: 'yumincho',
          fontSizePt: null
        }
      }
    ];
  }

  global.TategakiState = {
    APP_VERSION: '1.02',
    APP_LAST_UPDATED: '2026年11月4日',
    PAPER_PRESETS: PAPER_PRESETS,
    FONT_PRESETS: FONT_PRESETS,
    FONT_NAME_JA_MAP: FONT_NAME_JA_MAP,
    CANDIDATE_FONTS: CANDIDATE_FONTS,
    WEB_FONT_PRESETS: WEB_FONT_PRESETS,
    CUSTOM_FONT_LIST: CUSTOM_FONT_LIST,
    isFontInstalled: isFontInstalled,
    extractOpenTypeFontName: extractOpenTypeFontName,
    refreshAvailableFonts: refreshAvailableFonts,
    registerCustomFont: registerCustomFont,
    UI_THEMES: UI_THEMES,
    createDefaultSettings: createDefaultSettings,
    createSamplePages: createSamplePages
  };
})(window);
