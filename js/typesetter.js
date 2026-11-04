/**
 * 縦書き同人小説書けるくん - Japanese Vertical Typesetting & High-DPI Canvas Renderer
 *
 * 対応機能:
 * - A6 / カスタムサイズ / 600dpi / 塗り足し(3mm/5mm) / トンボ(内トンボ・外トンボ・センタートンボ)
 * - ノド1.5cm(偶数頁=左, 奇数頁=右) / 小口1.0cm(偶数頁=右, 奇数頁=左) / 天1.6cm / 地1.2cm
 * - ヘッダー・フッター例外配置（偶数頁ノンブル右、奇数頁ノンブル左＋0.5cm右横に扉タイトル自動参照コメント）
 * - 1段組み・2段組み、1行41文字×18行（行間自動調整）
 * - 禁則処理（行頭・行末禁則）＋ ぶら下げ組・追い出し・追い込み
 * - 自動・手動の縦中横（2〜3桁数字、!? / !! 等）
 * - 欧文回転（90度回転）と全角縦並びの切替
 * - 連続約物（――、……）の隙間なし連結描画
 * - 約物のアキ量調整（二分アキ・ベタ組み）＋ ！・？直後の全角一マス空け自動補完
 * - 改ページ・改丁（奇数頁/偶数頁送り）
 * - 「本文」「扉」「目次」ページ属性別レンダリング
 */
(function (global) {
  'use strict';

  const MM_PER_INCH = 25.4;
  const PT_TO_MM = 25.4 / 72.0;

  // 縦書き時に90度時計回り回転させる文字集合
  const ROTATE_90_CHARS = new Set(
    Array.from('ー〜～（）()「」『』【】〈〉《》〔〕［］[]｛｝{}“”‘’＝=－−―—─…‥：；:;→←↔⇒⇔')
  );

  // 句読点（縦書き時にセルの右上象限へ配置する文字）
  const KUTOUTEN_CHARS = new Set(Array.from('、。，．'));

  // 小書き仮名（縦書き時に少し右上へ寄せる文字）
  const SMALL_KANA_CHARS = new Set(
    Array.from('ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ')
  );

  // 開き括弧・閉じ括弧判定（アキ量調整用）
  const OPEN_BRACKETS = new Set(Array.from('（「『【〈《〔｛［“‘('));
  const CLOSE_BRACKETS = new Set(Array.from('）」』】〉》〕｝］”’)'));

  function mmToPx(mm, dpi) {
    return (mm / MM_PER_INCH) * dpi;
  }

  function ptToMm(pt) {
    return pt * PT_TO_MM;
  }

  function ptToPx(pt, dpi) {
    return mmToPx(ptToMm(pt), dpi);
  }

  function getFontCss(fontId, settings) {
    const presets = (global.TategakiState && global.TategakiState.FONT_PRESETS) || [];
    const found = presets.find(function (f) {
      return f.id === fontId;
    });
    if (found) return found.css;
    return '"Yu Mincho", "游明朝", YuMincho, "Hiragino Mincho ProN", "MS PMincho", serif';
  }

  /**
   * 漢数字変換（目次やノンブル等で利用可能）
   */
  function toKanjiNumber(num) {
    const normalized = String(num !== undefined && num !== null ? num : '').replace(
      /[０-９]/g,
      function (ch) {
        return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
      }
    );
    const n = parseInt(normalized, 10);
    if (isNaN(n)) return String(num);
    const digits = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    if (n === 0) return digits[0];
    if (n < 10) return digits[n];
    if (n < 100) {
      const tens = Math.floor(n / 10);
      const ones = n % 10;
      return (tens === 1 ? '' : digits[tens]) + '十' + (ones === 0 ? '' : digits[ones]);
    }
    if (n < 1000) {
      const hundreds = Math.floor(n / 100);
      const rem = n % 100;
      const tens = Math.floor(rem / 10);
      const ones = rem % 10;
      let res = (hundreds === 1 ? '' : digits[hundreds]) + '百';
      if (tens > 0) res += (tens === 1 ? '' : digits[tens]) + '十';
      if (ones > 0) res += digits[ones];
      return res;
    }
    return String(n)
      .split('')
      .map(function (c) {
        const d = parseInt(c, 10);
        return isNaN(d) ? c : digits[d];
      })
      .join('');
  }

  /**
   * 扉ページから小説タイトルを取得する（奇数頁ヘッダーの自動コメント用）
   * upToPageIndex が指定されている場合は、そのページ以前の直近の扉タイトルを優先参照する
   */
  function findNovelTitleFromPages(pages, upToPageIndex) {
    if (!Array.isArray(pages)) return '';
    if (typeof upToPageIndex === 'number' && upToPageIndex >= 0) {
      const startIdx = Math.min(upToPageIndex, pages.length - 1);
      for (let i = startIdx; i >= 0; i--) {
        const p = pages[i];
        if (p && p.type === 'tobira' && p.tobiraData && p.tobiraData.title) {
          return p.tobiraData.title.trim();
        }
      }
    }
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      if (p && p.type === 'tobira' && p.tobiraData && p.tobiraData.title) {
        return p.tobiraData.title.trim();
      }
    }
    return '';
  }

  /**
   * 1行分の文字列を組版トークン列に分解する（ソース文字列内のオフセット srcStart / srcEnd も保持）
   */
  function tokenizeParagraph(lineText, rules, baseOffset) {
    const rawTokens = [];
    const text = String(lineText || '');
    const offset0 = typeof baseOffset === 'number' ? baseOffset : 0;
    let rubyGroupSeq = 0;

    // インライン要素（縦中横指定・ルビ）を正規表現で順次抽出
    const inlinePattern =
      /[［\[]縦中横[:：]([^］\]]+)[］\]]|[｜|]([^《\n]+)《([^》\n]+)》|([一-龠々〆ヵヶ]+)《([^》\n]+)》/g;

    let lastIndex = 0;
    let match;
    while ((match = inlinePattern.exec(text)) !== null) {
      if (match.index > lastIndex) {
        tokenizePlainSegment(
          text.slice(lastIndex, match.index),
          rules,
          rawTokens,
          offset0 + lastIndex
        );
      }
      const matchStart = offset0 + match.index;
      const matchEnd = offset0 + inlinePattern.lastIndex;

      if (match[1] !== undefined) {
        // 手動縦中横 [縦中横:...]
        rawTokens.push({
          type: 'tcy',
          text: match[1],
          advance: 1.0,
          srcStart: matchStart,
          srcEnd: matchEnd
        });
      } else if (match[2] !== undefined) {
        // パイプ付きルビ ｜親《ルビ》
        pushRubyTokens(match[2], match[3], rawTokens, matchStart, matchEnd, ++rubyGroupSeq);
      } else if (match[4] !== undefined) {
        // 漢字自動判定ルビ 漢字《ルビ》
        pushRubyTokens(match[4], match[5], rawTokens, matchStart, matchEnd, ++rubyGroupSeq);
      }
      lastIndex = inlinePattern.lastIndex;
    }

    if (lastIndex < text.length) {
      tokenizePlainSegment(text.slice(lastIndex), rules, rawTokens, offset0 + lastIndex);
    }

    // 感嘆符・疑問符直後の全角一マス空け自動補完 + 約物アキ量調整
    return applyPostTokenRules(rawTokens, rules);
  }

  function pushRubyTokens(baseStr, rubyStr, outTokens, matchStart, matchEnd, groupId) {
    const baseChars = Array.from(baseStr);
    const hasOffsets = typeof matchStart === 'number' && typeof matchEnd === 'number';
    if (baseChars.length === 1) {
      outTokens.push({
        type: 'char',
        text: baseChars[0],
        ruby: rubyStr,
        advance: 1.0,
        srcStart: hasOffsets ? matchStart : undefined,
        srcEnd: hasOffsets ? matchEnd : undefined,
        matchSpanStart: hasOffsets ? matchStart : undefined,
        matchSpanEnd: hasOffsets ? matchEnd : undefined
      });
      return;
    }
    // 複数文字の親文字に対して、ルビを行跨ぎでも破綻しないようグループ情報を付与
    baseChars.forEach(function (ch, idx) {
      const isLast = idx === baseChars.length - 1;
      outTokens.push({
        type: 'char',
        text: ch,
        ruby: idx === 0 ? rubyStr : null,
        rubySpanCount: idx === 0 ? baseChars.length : 0,
        rubyGroupMember: true,
        rubyGroupId: groupId || 1,
        advance: 1.0,
        srcStart: hasOffsets ? matchStart : undefined,
        srcEnd: hasOffsets ? (isLast ? matchEnd : matchStart) : undefined,
        matchSpanStart: hasOffsets ? matchStart : undefined,
        matchSpanEnd: hasOffsets ? matchEnd : undefined
      });
    });
  }

  // プロポーショナル欧文字幅のフォールバックテーブル（1em = 和文1マス基準）
  const LATIN_PROPORTIONAL_WIDTH_MAP = {
    ' ': 0.32,
    '!': 0.30,
    '"': 0.38,
    '#': 0.56,
    '$': 0.54,
    '%': 0.78,
    '&': 0.72,
    "'": 0.25,
    '(': 0.34,
    ')': 0.34,
    '*': 0.46,
    '+': 0.56,
    ',': 0.28,
    '-': 0.36,
    '.': 0.28,
    '/': 0.36,
    ':': 0.30,
    ';': 0.30,
    '<': 0.56,
    '=': 0.56,
    '>': 0.56,
    '?': 0.46,
    '@': 0.84,
    '[': 0.34,
    '\\': 0.38,
    ']': 0.34,
    '^': 0.48,
    '_': 0.50,
    '`': 0.30,
    '{': 0.36,
    '|': 0.28,
    '}': 0.36,
    '~': 0.54,
    i: 0.28,
    j: 0.30,
    l: 0.28,
    f: 0.34,
    r: 0.38,
    t: 0.36,
    s: 0.44,
    c: 0.46,
    a: 0.50,
    e: 0.48,
    g: 0.50,
    k: 0.50,
    v: 0.48,
    x: 0.48,
    y: 0.48,
    z: 0.46,
    b: 0.52,
    d: 0.52,
    h: 0.52,
    n: 0.52,
    o: 0.52,
    p: 0.52,
    q: 0.52,
    u: 0.52,
    m: 0.78,
    w: 0.72,
    I: 0.34,
    J: 0.44,
    L: 0.54,
    F: 0.56,
    E: 0.58,
    P: 0.56,
    S: 0.54,
    T: 0.58,
    Z: 0.58,
    A: 0.66,
    B: 0.62,
    C: 0.66,
    D: 0.68,
    G: 0.70,
    H: 0.70,
    K: 0.66,
    N: 0.68,
    O: 0.70,
    Q: 0.70,
    R: 0.64,
    U: 0.68,
    V: 0.64,
    X: 0.64,
    Y: 0.62,
    M: 0.84,
    W: 0.88
  };

  let _sharedMeasureCtx = null;
  const _latinWidthCache = {};

  function getSharedMeasureContext() {
    if (_sharedMeasureCtx) return _sharedMeasureCtx;
    if (typeof document !== 'undefined' && document.createElement) {
      const c = document.createElement('canvas');
      _sharedMeasureCtx = c.getContext('2d');
    }
    return _sharedMeasureCtx;
  }

  /**
   * 縦書き内で90度回転配置する欧文1文字の自然な送り幅（和文1マス=1.0基準）を算出する
   */
  function getLatinCharAdvance(ch, rules) {
    const scale =
      rules && typeof rules.latinFontScale === 'number' && rules.latinFontScale > 0
        ? rules.latinFontScale
        : 0.95;
    const mode = (rules && rules.latinMode) || 'rotate';

    if (mode === 'rotate-mono') {
      return (ch === ' ' ? 0.36 : 0.60) * scale;
    }

    if (ch === ' ') {
      return 0.32 * scale;
    }

    let baseEm = LATIN_PROPORTIONAL_WIDTH_MAP[ch];
    if (baseEm === undefined) {
      if (/[0-9]/.test(ch)) {
        baseEm = ch === '1' ? 0.48 : 0.54;
      } else {
        baseEm = 0.54;
      }
    }

    // ブラウザCanvasが利用可能な場合は基準100pxフォントメトリクスとブレンドして正確な字幅を得る
    const mCtx = getSharedMeasureContext();
    if (mCtx) {
      if (_latinWidthCache[ch] === undefined) {
        mCtx.font = '100px "Yu Mincho", "游明朝", YuMincho, serif';
        const w = mCtx.measureText(ch).width;
        _latinWidthCache[ch] = w > 0 ? w / 100 : baseEm;
      }
      const measured = _latinWidthCache[ch];
      if (measured > 0.15 && measured < 1.1) {
        baseEm = measured * 0.75 + baseEm * 0.25;
      }
    }

    // 隣り合う欧文同士が詰まりすぎないよう微小なトラッキング(+0.015em)を付与
    return Math.max(0.22, Math.min(0.95, baseEm * scale + 0.015));
  }

  let _latinWordGroupSeq = 0;

  /**
   * 欧文・英数字フレーズを文字トークン列へ展開して outTokens に追加する
   */
  function pushLatinPhraseTokens(chars, startIdx, endIdx, codeUnitOffsets, rules, outTokens) {
    const phraseStr = chars.slice(startIdx, endIdx).join('');
    const latinMode = (rules && rules.latinMode) || 'rotate';

    // すべて1文字ずつ縦に並べる（正立）モード、またはスマートモードでの2〜3文字英大文字略語（SNS, AI, RGB等）
    const isShortUpperAcronym = /^[A-Z]{2,3}$/.test(phraseStr);
    if (latinMode === 'upright' || (latinMode === 'smart' && isShortUpperAcronym)) {
      for (let k = startIdx; k < endIdx; k++) {
        outTokens.push({
          type: 'char',
          text: chars[k],
          uprightLatin: true,
          advance: 1.0,
          srcStart: codeUnitOffsets[k],
          srcEnd: codeUnitOffsets[k + 1]
        });
      }
      return;
    }

    // 横組み90度回転モード（単語単位で latinWordGroupId を付与し、行末ワードラップに対応）
    let currentWordGroupId = ++_latinWordGroupSeq;
    for (let k = startIdx; k < endIdx; k++) {
      const c = chars[k];
      const isSpace = c === ' ';
      if (isSpace) {
        currentWordGroupId = ++_latinWordGroupSeq;
      }
      outTokens.push({
        type: 'latin-rotate',
        text: c,
        isLatinSpace: isSpace,
        latinWordGroupId: isSpace ? 0 : currentWordGroupId,
        advance: getLatinCharAdvance(c, rules),
        srcStart: codeUnitOffsets[k],
        srcEnd: codeUnitOffsets[k + 1]
      });
    }
  }

  /**
   * 指定位置 i から始まる連続した欧文・英数字横書きフレーズの終端インデックスを返す
   */
  function scanLatinPhraseEnd(chars, startIdx) {
    let j = startIdx;
    while (j < chars.length) {
      const c = chars[j];
      if (/[A-Za-z0-9]/.test(c)) {
        j++;
        continue;
      }
      if (/[.,'":;!?&\-\/()+#$%*@~=_]/.test(c)) {
        j++;
        continue;
      }
      // 欧文フレーズ内の半角スペース：直後に英数字または欧文開き記号＋英数字が続く場合は同一フレーズとして連結
      if (c === ' ') {
        let nextNonSpace = j + 1;
        while (nextNonSpace < chars.length && chars[nextNonSpace] === ' ') {
          nextNonSpace++;
        }
        if (
          nextNonSpace < chars.length &&
          (/[A-Za-z0-9]/.test(chars[nextNonSpace]) ||
            (/[('"$#&+\-\/]/.test(chars[nextNonSpace]) &&
              nextNonSpace + 1 < chars.length &&
              /[A-Za-z0-9]/.test(chars[nextNonSpace + 1])))
        ) {
          j = nextNonSpace;
          continue;
        }
      }
      break;
    }
    return j;
  }

  function tokenizePlainSegment(segment, rules, outTokens, segStartOffset) {
    const chars = Array.from(segment);
    const baseOff = typeof segStartOffset === 'number' ? segStartOffset : 0;
    const codeUnitOffsets = new Array(chars.length + 1);
    let cu = 0;
    for (let idx = 0; idx < chars.length; idx++) {
      codeUnitOffsets[idx] = baseOff + cu;
      cu += chars[idx].length;
    }
    codeUnitOffsets[chars.length] = baseOff + cu;

    let i = 0;
    const autoDigits = rules.autoTcyDigits || 0;
    const autoExcl = rules.autoTcyExclamation !== false;

    while (i < chars.length) {
      const ch = chars[i];

      // 0. 和文中に挿入された半角スペースで、直前または直後が英数字の場合は四分アキ(0.25マス)として扱う
      if (ch === ' ') {
        const prevCh = i > 0 ? chars[i - 1] : '';
        const nextCh = i + 1 < chars.length ? chars[i + 1] : '';
        if (/[A-Za-z0-9]/.test(prevCh) || /[A-Za-z0-9]/.test(nextCh)) {
          outTokens.push({
            type: 'space',
            text: ' ',
            isLatinAdjacentSpace: true,
            advance: 0.25,
            srcStart: codeUnitOffsets[i],
            srcEnd: codeUnitOffsets[i + 1]
          });
          i++;
          continue;
        }
      }

      // 1. 感嘆符・疑問符の連続（!?, ?!, !!, ??, ！？, ？！, ！！, ？？）の縦中横化
      if (autoExcl && i + 1 < chars.length) {
        const pair = ch + chars[i + 1];
        if (
          pair === '!?' ||
          pair === '?!' ||
          pair === '!!' ||
          pair === '??' ||
          pair === '！？' ||
          pair === '？！' ||
          pair === '！！' ||
          pair === '？？'
        ) {
          const halfPair = pair
            .replace(/！/g, '!')
            .replace(/？/g, '?');
          outTokens.push({
            type: 'tcy',
            text: halfPair,
            isExclQuest: true,
            advance: 1.0,
            srcStart: codeUnitOffsets[i],
            srcEnd: codeUnitOffsets[i + 2]
          });
          i += 2;
          continue;
        }
      }

      // 2. 半角数字列の判定（単独の2〜3桁数字は自動縦中横、単位付き数値 600dpi / 8.5pt / 100% や4桁以上は欧文処理）
      if (/[0-9]/.test(ch)) {
        let dEnd = i;
        while (dEnd < chars.length && /[0-9]/.test(chars[dEnd])) {
          dEnd++;
        }
        const digitLen = dEnd - i;
        const nextAfterDigits = dEnd < chars.length ? chars[dEnd] : '';
        const next2AfterDigits = dEnd + 1 < chars.length ? chars[dEnd + 1] : '';

        // 600dpi, 8.5pt, 100%, 3D, 1999-2026 のように直後に欧文・小数点・単位記号が結合しているか判定
        const isAttachedToLatinOrUnit =
          /[A-Za-z%]/.test(nextAfterDigits) ||
          ((nextAfterDigits === '.' || nextAfterDigits === '-' || nextAfterDigits === '/') &&
            /[A-Za-z0-9]/.test(next2AfterDigits));

        if (!isAttachedToLatinOrUnit) {
          const numStr = chars.slice(i, dEnd).join('');
          if (autoDigits >= 2 && digitLen >= 2 && digitLen <= autoDigits) {
            outTokens.push({
              type: 'tcy',
              text: numStr,
              advance: 1.0,
              srcStart: codeUnitOffsets[i],
              srcEnd: codeUnitOffsets[dEnd]
            });
            i = dEnd;
            continue;
          }
          if (digitLen === 1) {
            outTokens.push({
              type: 'char',
              text: numStr,
              uprightLatin: true,
              advance: 1.0,
              srcStart: codeUnitOffsets[i],
              srcEnd: codeUnitOffsets[dEnd]
            });
            i = dEnd;
            continue;
          }
        }

        // 4桁以上の数字、または 600dpi / 8.5pt / 100% 等の欧文・単位付き数値フレーズ
        const phraseEnd = scanLatinPhraseEnd(chars, i);
        pushLatinPhraseTokens(chars, i, phraseEnd, codeUnitOffsets, rules, outTokens);
        i = phraseEnd;
        continue;
      }

      // 3. 半角英字・欧文フレーズの判定（英単語・スペースを含む英文・PDF/X-1a 等の記号付き欧文）
      if (
        /[A-Za-z]/.test(ch) ||
        ((ch === '"' || ch === "'" || ch === '(') &&
          i + 1 < chars.length &&
          /[A-Za-z]/.test(chars[i + 1]))
      ) {
        const phraseEnd = scanLatinPhraseEnd(chars, i);
        pushLatinPhraseTokens(chars, i, phraseEnd, codeUnitOffsets, rules, outTokens);
        i = phraseEnd;
        continue;
      }

      // 4. 2倍ダッシュ構成文字（―, —, ─）
      if (ch === '―' || ch === '—' || ch === '─') {
        outTokens.push({
          type: 'dash',
          text: ch,
          advance: 1.0,
          srcStart: codeUnitOffsets[i],
          srcEnd: codeUnitOffsets[i + 1]
        });
        i++;
        continue;
      }

      // 5. 三点リーダー・二点リーダー（…, ‥）
      if (ch === '…' || ch === '‥') {
        outTokens.push({
          type: 'ellipsis',
          text: ch,
          dots: ch === '‥' ? 2 : 3,
          advance: 1.0,
          srcStart: codeUnitOffsets[i],
          srcEnd: codeUnitOffsets[i + 1]
        });
        i++;
        continue;
      }

      // 6. 単独の感嘆符・疑問符
      if (ch === '！' || ch === '？' || ch === '!' || ch === '?') {
        outTokens.push({
          type: 'char',
          text: ch === '!' ? '！' : ch === '?' ? '？' : ch,
          isExclQuest: true,
          advance: 1.0,
          srcStart: codeUnitOffsets[i],
          srcEnd: codeUnitOffsets[i + 1]
        });
        i++;
        continue;
      }

      // 7. 通常の文字
      outTokens.push({
        type: 'char',
        text: ch,
        advance: 1.0,
        srcStart: codeUnitOffsets[i],
        srcEnd: codeUnitOffsets[i + 1]
      });
      i++;
    }
  }

  /**
   * トークン列に対して約物アキ量調整・和欧間アキ・感嘆符疑問符直後の全角空白自動補完を適用
   */
  function applyPostTokenRules(tokens, rules) {
    const result = [];
    const autoSpace = rules.autoFullSpaceAfterExclQuest !== false;
    const bracketSpacing = rules.bracketSpacing || 'beta';
    const punctSpacing = rules.punctuationAfterSpacing || 'beta';
    const waouMode = rules.latinWaouSpacing || 'sixth';
    const waouAdv = waouMode === 'quarter' ? 0.25 : waouMode === 'sixth' ? 0.16 : 0;

    function isJapaneseOrUprightToken(t) {
      if (!t || t.type === 'space' || t.type === 'latin-rotate') return false;
      const c = t.text || '';
      if (!c || c === '　' || c === ' ') return false;
      return true;
    }

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      const prev = result.length > 0 ? result[result.length - 1] : null;
      const next = i + 1 < tokens.length ? tokens[i + 1] : null;

      // 開き括弧前の二分アキ設定（行頭以外）
      if (
        bracketSpacing === 'nibun' &&
        OPEN_BRACKETS.has(tok.text) &&
        prev &&
        prev.text !== '　' &&
        !OPEN_BRACKETS.has(prev.text)
      ) {
        result.push({
          type: 'space',
          text: '',
          advance: 0.5
        });
      }

      // 和文 → 横組み欧文 (latin-rotate) の境界に自動で和欧間アキを挿入
      if (
        waouAdv > 0 &&
        tok.type === 'latin-rotate' &&
        prev &&
        prev.type !== 'latin-rotate' &&
        prev.type !== 'space' &&
        isJapaneseOrUprightToken(prev) &&
        !OPEN_BRACKETS.has(prev.text)
      ) {
        result.push({
          type: 'space',
          text: '',
          isWaouSpace: true,
          advance: waouAdv
        });
      }

      // ベタ組み時の連続約物（句読点＋閉じ括弧、閉じ括弧＋開き括弧など）の半角詰め処理
      if (
        bracketSpacing === 'beta' &&
        prev &&
        ((KUTOUTEN_CHARS.has(prev.text) && CLOSE_BRACKETS.has(tok.text)) ||
          (CLOSE_BRACKETS.has(prev.text) && OPEN_BRACKETS.has(tok.text)) ||
          (CLOSE_BRACKETS.has(prev.text) && KUTOUTEN_CHARS.has(tok.text)))
      ) {
        prev.advance = 0.5;
      }

      result.push(tok);

      // 横組み欧文 (latin-rotate) → 和文 の境界に自動で和欧間アキを挿入
      if (
        waouAdv > 0 &&
        tok.type === 'latin-rotate' &&
        next &&
        next.type !== 'latin-rotate' &&
        next.type !== 'space' &&
        isJapaneseOrUprightToken(next) &&
        !CLOSE_BRACKETS.has(next.text) &&
        !KUTOUTEN_CHARS.has(next.text)
      ) {
        result.push({
          type: 'space',
          text: '',
          isWaouSpace: true,
          advance: waouAdv
        });
      }

      // 閉じ括弧後の二分アキ設定
      if (
        bracketSpacing === 'nibun' &&
        CLOSE_BRACKETS.has(tok.text) &&
        next &&
        next.text !== '　' &&
        !CLOSE_BRACKETS.has(next.text) &&
        !KUTOUTEN_CHARS.has(next.text)
      ) {
        result.push({
          type: 'space',
          text: '',
          advance: 0.5
        });
      }

      // 句読点後の二分アキ設定
      if (
        punctSpacing === 'nibun' &&
        KUTOUTEN_CHARS.has(tok.text) &&
        next &&
        next.text !== '　' &&
        !CLOSE_BRACKETS.has(next.text)
      ) {
        result.push({
          type: 'space',
          text: '',
          advance: 0.5
        });
      }

      // 感嘆符・疑問符（！、？、!?、!! 等）直後の全角一マス空け自動補完
      if (autoSpace && tok.isExclQuest && next) {
        const nextCh = next.text || '';
        const isNextSpace = nextCh === '　' || nextCh === ' ';
        const isNextClose = CLOSE_BRACKETS.has(nextCh);
        const isNextExcl = Boolean(next.isExclQuest);
        if (!isNextSpace && !isNextClose && !isNextExcl) {
          result.push({
            type: 'char',
            text: '　',
            isAutoInsertedSpace: true,
            advance: 1.0
          });
        }
      }
    }

    return result;
  }

  /**
   * 禁則文字判定ヘルパー
   */
  function isLineStartProhibited(tok, rules) {
    if (!tok || !rules.enableKinsoku) return false;
    const ch = tok.text || '';
    if (!ch || ch.length !== 1) return false;
    return (rules.lineStartProhibited || '').indexOf(ch) !== -1;
  }

  function isLineEndProhibited(tok, rules) {
    if (!tok || !rules.enableKinsoku) return false;
    const ch = tok.text || '';
    if (!ch || ch.length !== 1) return false;
    return (rules.lineEndProhibited || '').indexOf(ch) !== -1;
  }

  function isHangingChar(tok, rules) {
    if (!tok || !rules.enableKinsoku) return false;
    const ch = tok.text || '';
    if (!ch || ch.length !== 1) return false;
    return (rules.hangingChars || '、。，．').indexOf(ch) !== -1;
  }

  /**
   * 段落（1行テキスト）が「文頭の空白1文字（全角空白）を下げ忘れている地の文」かどうかを判定する
   * ・空行、全角/半角スペース始まり、会話文（カギ括弧・丸括弧等）始まり、制御タグ行、
   *   章見出し（第一話・プロローグ等）、場面転換記号行（＊・――・……のみ等）は対象外(false)とする
   */
  function isUnindentedNarrativeParagraph(rawLine) {
    if (!rawLine) return false;
    const str = String(rawLine);
    const trimmed = str.trim();
    if (!trimmed) return false;

    // すでに全角スペース・半角スペース・タブで字下げされている場合はOK
    const firstCh = str[0];
    if (firstCh === '　' || firstCh === ' ' || firstCh === '\t') {
      return false;
    }

    // 会話文・引用文などの開き括弧類で始まる行は字下げ不要（行頭括弧ルールに従う）
    if (OPEN_BRACKETS.has(firstCh) || /^[「『（【〈《〔｛［“‘"'(（]/.test(str)) {
      return false;
    }

    // 制御タグ行（[改ページ], [改丁], [連動区切り], [見出し:...], ［＃...］）は除外
    if (
      /^[［\[](?:改ページ|改頁|＃改ページ|＃改頁|改丁(?::(?:奇数|偶数)|：(?:奇数|偶数))?|＃改丁|連動区切り|見出し[:：].*?)[］\]]/.test(
        trimmed
      ) ||
      /^[［\[][＃#]/.test(trimmed)
    ) {
      return false;
    }

    // Markdown見出しや記号のみの区切り行（＊、※、◇、◆、―、… 等）は除外
    if (
      /^#{1,6}\s/.test(trimmed) ||
      /^[＊※◇◆○●☆★▽△▼▲■□―…\-=~＝〜・\s　]+$/.test(trimmed)
    ) {
      return false;
    }

    // 典型的な章・話数の見出し行（第一話、第1章、プロローグ、エピローグ、序章、終章、幕間など）は除外
    if (
      /^(?:第[一二三四五六七八九十百千万0-9０-９]+[話章節篇幕部回]|プロローグ|エピローグ|序章|終章|幕間|Interlude|Prologue|Epilogue|Chapter\s+\d+)(?:[\s　:：―\-]|$)/i.test(
        trimmed
      ) &&
      trimmed.length <= 32
    ) {
      return false;
    }

    return true;
  }

  /**
   * 前の行(prevLine)の末尾が段落途中の自動折り返し（ページ跨ぎ等による途中改行）かどうかを判定する
   */
  function isMidSentenceContinuation(prevLine) {
    if (!prevLine) return false;
    const pTrim = String(prevLine).trim();
    if (!pTrim) return false;
    // 制御タグ行や見出し行の直後は通常の段落開始とみなす
    if (/^[［\[]/.test(pTrim) && /[］\]]$/.test(pTrim)) return false;
    // 前の行が句点・感嘆符・疑問符・閉じ括弧・リーダー・ダッシュ等の文末記号で終わっていない場合（文の途中で改行されている場合）
    if (
      pTrim.length >= 16 &&
      !/[。．.!！?？」』）】〉》〕｝］”’"'…―─ー～〜♪☆★○●◇◆□■▽△▼▲※＊]$/.test(pTrim)
    ) {
      return true;
    }
    return false;
  }

  /**
   * テキスト内の「文頭1字下げ忘れ候補」の段落一覧（行番号・文字オフセット・抜粋）を返す
   * ページを跨いで折り返している箇所は除外する
   */
  function analyzeParagraphIndentWarnings(text, sectionPages) {
    const normalized = String(text || '').replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    const warnings = [];
    let offset = 0;

    // セクション内の2ページ目以降の開始オフセット集合（ページ跨ぎ位置の誤検知防止用）
    const midParaPageStarts = new Set();
    if (Array.isArray(sectionPages)) {
      for (let pIdx = 1; pIdx < sectionPages.length; pIdx++) {
        const sp = sectionPages[pIdx];
        if (sp && typeof sp.charStart === 'number') {
          if (sp.startsMidParagraph || (sectionPages[pIdx - 1] && sectionPages[pIdx - 1].endsMidParagraph)) {
            midParaPageStarts.add(sp.charStart);
          }
        }
      }
    }

    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      const prevLn = i > 0 ? lines[i - 1] : '';
      const isPageWrapCont =
        midParaPageStarts.has(offset) || (i > 0 && isMidSentenceContinuation(prevLn));

      if (!isPageWrapCont && isUnindentedNarrativeParagraph(ln)) {
        const previewSnippet = ln.replace(/[｜|]([^《]+)《[^》]+》/g, '$1').slice(0, 14);
        warnings.push({
          lineIndex: i,
          lineNumber: i + 1,
          charOffset: offset,
          lineEndOffset: offset + ln.length,
          rawLine: ln,
          snippet: previewSnippet + (ln.length > 14 ? '…' : '')
        });
      }
      offset += ln.length + 1;
    }

    return warnings;
  }

  /**
   * 1段落分のトークン列を、禁則処理（ぶら下げ組・追い出し・追い込み）および欧文ワードラップを適用して複数行に分割する
   */
  function breakTokensIntoLines(tokens, charsPerLine, rules, paraStartOffset, paraEndOffset) {
    const hasParaBounds = typeof paraStartOffset === 'number' && typeof paraEndOffset === 'number';
    if (!tokens || tokens.length === 0) {
      const s0 = hasParaBounds ? paraStartOffset : 0;
      const e0 = hasParaBounds ? paraEndOffset : s0;
      return [{ tokens: [], totalAdvance: 0, adjustMode: 'none', srcStart: s0, srcEnd: e0 }];
    }

    const lines = [];
    let idx = 0;
    const maxAdv = charsPerLine;
    const mode = rules.lineEndAdjustMode || 'burasage'; // 'burasage' | 'oidashi' | 'oikomi'
    const enableLatinWrap = rules.latinWordWrap !== false;

    // 行頭カギ括弧の二分アキ設定
    if (
      rules.lineStartBracketIndent === 'nibun' &&
      tokens.length > 0 &&
      OPEN_BRACKETS.has(tokens[0].text)
    ) {
      tokens = [{ type: 'space', text: '', advance: 0.5 }].concat(tokens);
    }

    // グループルビが行末で途中分割された場合に親文字グループごと次行へ送るヘルパー
    function popBrokenRubyGroupIfNeeded(lineTokensArr) {
      if (lineTokensArr.length <= 1 || idx >= tokens.length) return false;
      const last = lineTokensArr[lineTokensArr.length - 1];
      const next = tokens[idx];
      if (!last || !next || !last.rubyGroupId || last.rubyGroupId !== next.rubyGroupId) {
        return false;
      }
      const targetGroupId = last.rubyGroupId;
      let groupCount = 0;
      for (let k = lineTokensArr.length - 1; k >= 0; k--) {
        if (lineTokensArr[k].rubyGroupId === targetGroupId) {
          groupCount++;
        } else {
          break;
        }
      }
      if (groupCount > 0 && groupCount < lineTokensArr.length) {
        for (let c = 0; c < groupCount; c++) {
          const popped = lineTokensArr.pop();
          idx--;
          currentAdv -= popped.advance || 1.0;
        }
        return true;
      }
      return false;
    }

    // 欧文単語が行末で途中分割された場合に英単語ごと次行へ送るワードラップヘルパー
    function popBrokenLatinWordIfNeeded(lineTokensArr) {
      if (!enableLatinWrap || lineTokensArr.length <= 1 || idx >= tokens.length) return false;
      const last = lineTokensArr[lineTokensArr.length - 1];
      const next = tokens[idx];
      if (
        !last ||
        !next ||
        !last.latinWordGroupId ||
        last.latinWordGroupId !== next.latinWordGroupId
      ) {
        return false;
      }
      const targetWordId = last.latinWordGroupId;
      let wordCount = 0;
      let wordAdv = 0;
      for (let k = lineTokensArr.length - 1; k >= 0; k--) {
        if (lineTokensArr[k].latinWordGroupId === targetWordId) {
          wordCount++;
          wordAdv += lineTokensArr[k].advance || 0.5;
        } else {
          break;
        }
      }
      // 単語長が行長の40%以下の場合のみ単語ごと次行へ送る（極端に長いURL等はそのまま折り返す）
      if (wordCount > 0 && wordCount < lineTokensArr.length && wordAdv <= maxAdv * 0.4) {
        for (let c = 0; c < wordCount; c++) {
          const popped = lineTokensArr.pop();
          idx--;
          currentAdv -= popped.advance || 0.5;
        }
        // 直前に挿入されていた和欧間アキや欧文スペースが行末に残った場合は除去
        while (
          lineTokensArr.length > 1 &&
          (lineTokensArr[lineTokensArr.length - 1].isWaouSpace ||
            lineTokensArr[lineTokensArr.length - 1].isLatinSpace)
        ) {
          const trailSp = lineTokensArr.pop();
          currentAdv -= trailSp.advance || 0;
        }
        return true;
      }
      return false;
    }

    let currentAdv = 0;

    while (idx < tokens.length) {
      const lineTokens = [];
      currentAdv = 0;
      let adjustMode = 'none';

      // 折り返し後の行頭（2行目以降）に来た和欧間アキや英文単語間スペースは行頭天付きのためスキップ
      if (lines.length > 0) {
        while (
          idx < tokens.length &&
          (tokens[idx].isWaouSpace || tokens[idx].isLatinSpace || tokens[idx].isLatinAdjacentSpace)
        ) {
          idx++;
        }
        if (idx >= tokens.length) break;
      }

      while (idx < tokens.length) {
        const tok = tokens[idx];
        const nextAdv = currentAdv + (tok.advance || 1.0);
        if (nextAdv <= maxAdv + 0.001 || lineTokens.length === 0) {
          lineTokens.push(Object.assign({}, tok));
          currentAdv = nextAdv;
          idx++;
          if (currentAdv >= maxAdv - 0.001) {
            break;
          }
        } else {
          break;
        }
      }

      // グループルビおよび英単語の行跨ぎ分断を防止
      if (popBrokenRubyGroupIfNeeded(lineTokens)) {
        adjustMode = 'oidashi';
      } else if (popBrokenLatinWordIfNeeded(lineTokens)) {
        adjustMode = 'oidashi';
      }

      // 行末に到達し、かつ次のトークンが存在する場合の禁則処理
      if (idx < tokens.length && rules.enableKinsoku) {
        const nextTok = tokens[idx];
        const lastTok = lineTokens[lineTokens.length - 1];

        // 1. 行末禁則（開き括弧などが行末に来た場合 → 追い出し）
        if (isLineEndProhibited(lastTok, rules) && lineTokens.length > 1) {
          lineTokens.pop();
          idx--;
          currentAdv -= lastTok.advance || 1.0;
          popBrokenRubyGroupIfNeeded(lineTokens);
          adjustMode = 'oidashi';
        }
        // 2. 次行の先頭が行頭禁則文字の場合
        else if (isLineStartProhibited(nextTok, rules)) {
          if (mode === 'burasage' && isHangingChar(nextTok, rules)) {
            // ぶら下げ組：句読点を行末枠外にぶら下げる
            const hung = Object.assign({}, nextTok, { isHanging: true });
            lineTokens.push(hung);
            idx++;
            adjustMode = 'burasage';
          } else if (mode === 'oikomi' || mode === 'burasage') {
            // 追い込み：文字間隔を微調整（縮小）して現在行に収める
            const pulled = Object.assign({}, nextTok);
            lineTokens.push(pulled);
            currentAdv += pulled.advance || 1.0;
            idx++;
            adjustMode = 'oikomi';

            // さらにもう1文字連続して行頭禁則（例：。」）がある場合の処理
            if (idx < tokens.length && isLineStartProhibited(tokens[idx], rules)) {
              if (mode === 'burasage' && isHangingChar(tokens[idx], rules)) {
                const hung2 = Object.assign({}, tokens[idx], { isHanging: true });
                lineTokens.push(hung2);
                idx++;
              } else {
                const pulled2 = Object.assign({}, tokens[idx]);
                lineTokens.push(pulled2);
                currentAdv += pulled2.advance || 1.0;
                idx++;
              }
            }
          } else if (mode === 'oidashi' && lineTokens.length > 1) {
            // 追い出し：前の文字を次行へ送り、現在行の文字間隔を広げて揃える
            const pushed = lineTokens.pop();
            idx--;
            currentAdv -= pushed.advance || 1.0;
            popBrokenRubyGroupIfNeeded(lineTokens);
            adjustMode = 'oidashi';

            // 追い出した結果、さらに新しい行末が行末禁則になった場合はもう1文字追い出す
            if (
              lineTokens.length > 1 &&
              isLineEndProhibited(lineTokens[lineTokens.length - 1], rules)
            ) {
              const pushed2 = lineTokens.pop();
              idx--;
              currentAdv -= pushed2.advance || 1.0;
              popBrokenRubyGroupIfNeeded(lineTokens);
            }
          }
        }
      }

      lines.push({
        tokens: lineTokens,
        totalAdvance: currentAdv,
        adjustMode: adjustMode
      });
    }

    // 各行に元テキスト内の正確な文字範囲 [srcStart, srcEnd] を付与
    let prevEnd = hasParaBounds ? paraStartOffset : 0;
    for (let l = 0; l < lines.length; l++) {
      const ln = lines[l];
      const realToks = ln.tokens.filter(function (t) {
        return !t.isAutoInsertedSpace && t.type !== 'space' && typeof t.srcEnd === 'number';
      });
      const lineEnd =
        l === lines.length - 1 && hasParaBounds
          ? paraEndOffset
          : realToks.length > 0
          ? realToks[realToks.length - 1].srcEnd
          : prevEnd;
      ln.srcStart = prevEnd;
      ln.srcEnd = Math.max(ln.srcStart, lineEnd);
      prevEnd = ln.srcEnd;
    }

    return lines;
  }

  /**
   * ページ本文テキスト全体を行配列に組版する（改ページ・改丁タグも検出）
   */
  function layoutBodyTextToLines(text, settings, pageObj) {
    const charsPerLine = settings.layout.charsPerLine || 41;
    const rules = settings.rules;
    const rawLines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const resultLines = [];
    const pageStartsMidPara = Boolean(pageObj && pageObj.startsMidParagraph);
    let runningOffset = pageObj && typeof pageObj.charStart === 'number' ? pageObj.charStart : 0;

    for (let i = 0; i < rawLines.length; i++) {
      const rawLine = rawLines[i];
      const lineStartOffset = runningOffset;
      runningOffset += rawLine.length + 1;
      const trimmed = rawLine.trim();

      // 改ページ制御
      if (
        trimmed === '[改ページ]' ||
        trimmed === '［改ページ］' ||
        trimmed === '[改頁]' ||
        trimmed === '［＃改ページ］' ||
        trimmed === '［＃改頁］'
      ) {
        resultLines.push({ isControlBreak: 'page' });
        continue;
      }

      // 改丁制御
      if (
        trimmed === '[改丁]' ||
        trimmed === '［改丁］' ||
        trimmed === '［＃改丁］' ||
        trimmed === '[改丁:奇数]' ||
        trimmed === '［改丁：奇数］'
      ) {
        resultLines.push({ isControlBreak: 'kaicho-odd' });
        continue;
      }
      if (trimmed === '[改丁:偶数]' || trimmed === '［改丁：偶数］') {
        resultLines.push({ isControlBreak: 'kaicho-even' });
        continue;
      }

      const prevRawLine = i > 0 ? rawLines[i - 1] : '';
      const isContinuationFromPrev =
        (i === 0 && pageStartsMidPara) || (i > 0 && isMidSentenceContinuation(prevRawLine));

      // 段落内に [改ページ] や [改丁] が含まれる場合も分割処理
      const parts = rawLine.split(/([［\[](?:改ページ|改頁|＃改ページ|＃改頁|改丁(?::(?:奇数|偶数))?|＃改丁)[］\]])/g);
      let partOffset = lineStartOffset;
      for (let p = 0; p < parts.length; p++) {
        const part = parts[p];
        const curPartStart = partOffset;
        partOffset += part ? part.length : 0;
        if (!part && parts.length > 1) continue;
        if (/^[［\[](?:改ページ|改頁|＃改ページ|＃改頁)[］\]]$/.test(part)) {
          resultLines.push({ isControlBreak: 'page' });
        } else if (/^[［\[](?:改丁|＃改丁|改丁:奇数|改丁：奇数)[］\]]$/.test(part)) {
          resultLines.push({ isControlBreak: 'kaicho-odd' });
        } else if (/^[［\[](?:改丁:偶数|改丁：偶数)[］\]]$/.test(part)) {
          resultLines.push({ isControlBreak: 'kaicho-even' });
        } else {
          const tokens = tokenizeParagraph(part, rules, curPartStart);
          const wrapped = breakTokensIntoLines(
            tokens,
            charsPerLine,
            rules,
            curPartStart,
            curPartStart + part.length
          );
          const missingIndent =
            !(p === 0 && isContinuationFromPrev) && isUnindentedNarrativeParagraph(part);
          for (let w = 0; w < wrapped.length; w++) {
            wrapped[w].isWrappedContinuation = w > 0 || (p === 0 && isContinuationFromPrev);
            if (w === 0 && missingIndent) {
              wrapped[w].hasMissingIndentWarning = true;
            }
            resultLines.push(wrapped[w]);
          }
        }
      }
    }

    return resultLines;
  }

  /**
   * 連なった本文テキスト（連動区間テキスト）を、1ページの許容行数(linesPerPage × columns)および
   * [改ページ]・[改丁]・禁則処理に従ってリアルタイムに各ページスライスへ自動ページ割りする。
   * 各ページの正確な文字オフセット (charStart, charEnd, contentEnd, rawSlice) を返すため、
   * エディタでのテキスト編集・カーソル位置同期・再結合が完全非破壊で行える。
   */
  function paginateFlowText(sectionText, settings, startingPageNumber, reservedBlankPageNums) {
    const charsPerLine = settings.layout.charsPerLine || 41;
    const linesPerColumn = settings.layout.linesPerPage || 18;
    const columns = settings.layout.columns || 1;
    const maxLinesPerPage = linesPerColumn * columns;
    const rules = settings.rules;

    const text = String(sectionText || '').replace(/\r\n/g, '\n');

    // 1. 改行(\n)ごとの正確な文字オフセットテーブルを作成
    const rawLineEntries = [];
    let pos = 0;
    while (pos <= text.length) {
      const nextNl = text.indexOf('\n', pos);
      if (nextNl === -1) {
        rawLineEntries.push({
          rawLine: text.slice(pos),
          lineStart: pos,
          lineEnd: text.length,
          hasNewlineAfter: false,
          afterLineOffset: text.length
        });
        break;
      } else {
        rawLineEntries.push({
          rawLine: text.slice(pos, nextNl),
          lineStart: pos,
          lineEnd: nextNl,
          hasNewlineAfter: true,
          afterLineOffset: nextNl + 1
        });
        pos = nextNl + 1;
      }
    }

    // 2. 各段落を組版行（または改ページ・改丁制御イベント）のストリームへ変換
    const flowItems = [];
    const inlineCtrlPattern =
      /[［\[](?:改ページ|改頁|＃改ページ|＃改頁|改丁(?::(?:奇数|偶数)|：(?:奇数|偶数))?|＃改丁)[］\]]/g;

    for (let i = 0; i < rawLineEntries.length; i++) {
      const entry = rawLineEntries[i];
      const rawLine = entry.rawLine;
      const trimmed = rawLine.trim();

      // 単独行の [改ページ]
      if (
        trimmed === '[改ページ]' ||
        trimmed === '［改ページ］' ||
        trimmed === '[改頁]' ||
        trimmed === '［＃改ページ］' ||
        trimmed === '［＃改頁］'
      ) {
        flowItems.push({
          isControlBreak: 'page',
          srcStart: entry.lineStart,
          srcEnd: entry.lineEnd,
          afterOffset: entry.afterLineOffset
        });
        continue;
      }

      // 単独行の [改丁]
      if (
        trimmed === '[改丁]' ||
        trimmed === '［改丁］' ||
        trimmed === '［＃改丁］' ||
        trimmed === '[改丁:奇数]' ||
        trimmed === '［改丁：奇数］' ||
        trimmed === '[改丁:偶数]' ||
        trimmed === '［改丁：偶数］'
      ) {
        const wantEven =
          trimmed === '[改丁:偶数]' ||
          trimmed === '［改丁：偶数］' ||
          (trimmed !== '[改丁:奇数]' &&
            trimmed !== '［改丁：奇数］' &&
            rules.kaichoTarget === 'even');
        flowItems.push({
          isControlBreak: wantEven ? 'kaicho-even' : 'kaicho-odd',
          srcStart: entry.lineStart,
          srcEnd: entry.lineEnd,
          afterOffset: entry.afterLineOffset
        });
        continue;
      }

      // 空行（改行のみの行）
      if (rawLine.length === 0) {
        flowItems.push({
          isControlBreak: null,
          tokens: [],
          totalAdvance: 0,
          adjustMode: 'none',
          srcStart: entry.lineStart,
          srcEnd: entry.lineEnd,
          afterOffset: entry.afterLineOffset,
          endsParagraph: entry.hasNewlineAfter
        });
        continue;
      }

      // 段落内にインラインの [改ページ] / [改丁] が含まれるかを検査
      inlineCtrlPattern.lastIndex = 0;
      let ctrlMatch;
      let segStartInLine = 0;
      let hadInlineCtrl = false;

      while ((ctrlMatch = inlineCtrlPattern.exec(rawLine)) !== null) {
        hadInlineCtrl = true;
        if (ctrlMatch.index > segStartInLine) {
          const subText = rawLine.slice(segStartInLine, ctrlMatch.index);
          const subStart = entry.lineStart + segStartInLine;
          const subEnd = entry.lineStart + ctrlMatch.index;
          const subTokens = tokenizeParagraph(subText, rules, subStart);
          const subWrapped = breakTokensIntoLines(
            subTokens,
            charsPerLine,
            rules,
            subStart,
            subEnd
          );
          for (let w = 0; w < subWrapped.length; w++) {
            const ln = subWrapped[w];
            flowItems.push({
              isControlBreak: null,
              tokens: ln.tokens,
              totalAdvance: ln.totalAdvance,
              adjustMode: ln.adjustMode,
              srcStart: ln.srcStart,
              srcEnd: ln.srcEnd,
              afterOffset: ln.srcEnd,
              endsParagraph: false
            });
          }
        }

        const tagStr = ctrlMatch[0];
        const tagStart = entry.lineStart + ctrlMatch.index;
        const isAtLineEnd = inlineCtrlPattern.lastIndex === rawLine.length;
        const tagAfterOffset = isAtLineEnd
          ? entry.afterLineOffset
          : entry.lineStart + inlineCtrlPattern.lastIndex;

        if (/^[［\[](?:改ページ|改頁|＃改ページ|＃改頁)[］\]]$/.test(tagStr)) {
          flowItems.push({
            isControlBreak: 'page',
            srcStart: tagStart,
            srcEnd: entry.lineStart + inlineCtrlPattern.lastIndex,
            afterOffset: tagAfterOffset
          });
        } else {
          const wantEvenInline =
            /偶数/.test(tagStr) || (!/奇数/.test(tagStr) && rules.kaichoTarget === 'even');
          flowItems.push({
            isControlBreak: wantEvenInline ? 'kaicho-even' : 'kaicho-odd',
            srcStart: tagStart,
            srcEnd: entry.lineStart + inlineCtrlPattern.lastIndex,
            afterOffset: tagAfterOffset
          });
        }

        segStartInLine = inlineCtrlPattern.lastIndex;
      }

      const prevRawLine = i > 0 ? rawLineEntries[i - 1].rawLine : '';
      const isPrevMidSentence = i > 0 && isMidSentenceContinuation(prevRawLine);

      if (!hadInlineCtrl) {
        const tokens = tokenizeParagraph(rawLine, rules, entry.lineStart);
        const wrapped = breakTokensIntoLines(
          tokens,
          charsPerLine,
          rules,
          entry.lineStart,
          entry.lineEnd
        );
        const missingIndent =
          !isPrevMidSentence && isUnindentedNarrativeParagraph(rawLine);
        for (let w = 0; w < wrapped.length; w++) {
          const ln = wrapped[w];
          const isLastInPara = w === wrapped.length - 1;
          flowItems.push({
            isControlBreak: null,
            tokens: ln.tokens,
            totalAdvance: ln.totalAdvance,
            adjustMode: ln.adjustMode,
            isWrappedContinuation: w > 0 || isPrevMidSentence,
            hasMissingIndentWarning: w === 0 && missingIndent,
            srcStart: ln.srcStart,
            srcEnd: ln.srcEnd,
            afterOffset: isLastInPara ? entry.afterLineOffset : ln.srcEnd,
            endsParagraph: isLastInPara && entry.hasNewlineAfter
          });
        }
      } else if (segStartInLine < rawLine.length) {
        const tailText = rawLine.slice(segStartInLine);
        const tailStart = entry.lineStart + segStartInLine;
        const tailEnd = entry.lineEnd;
        const tailTokens = tokenizeParagraph(tailText, rules, tailStart);
        const tailWrapped = breakTokensIntoLines(
          tailTokens,
          charsPerLine,
          rules,
          tailStart,
          tailEnd
        );
        const missingTailIndent = isUnindentedNarrativeParagraph(tailText);
        for (let w = 0; w < tailWrapped.length; w++) {
          const ln = tailWrapped[w];
          const isLastInPara = w === tailWrapped.length - 1;
          flowItems.push({
            isControlBreak: null,
            tokens: ln.tokens,
            totalAdvance: ln.totalAdvance,
            adjustMode: ln.adjustMode,
            isWrappedContinuation: w > 0,
            hasMissingIndentWarning: w === 0 && missingTailIndent,
            srcStart: ln.srcStart,
            srcEnd: ln.srcEnd,
            afterOffset: isLastInPara ? entry.afterLineOffset : ln.srcEnd,
            endsParagraph: isLastInPara && entry.hasNewlineAfter
          });
        }
      }
    }

    // 3. 組版行ストリームを 1ページ最大行数 (maxLinesPerPage) と制御イベントでページ単位にスライス
    const pagesOut = [];
    let curLines = [];
    let curPageRawStart = 0;
    let curPageNum = startingPageNumber || 1;

    function skipReservedBlankPageNums() {
      if (!reservedBlankPageNums || typeof reservedBlankPageNums.has !== 'function') return;
      while (reservedBlankPageNums.has(curPageNum)) {
        curPageNum++;
      }
    }
    skipReservedBlankPageNums();

    function flushPageSlice(rawEndOffset, isBlankAdjustment) {
      if (isBlankAdjustment) {
        pagesOut.push({
          content: '',
          rawSlice: '',
          charStart: rawEndOffset,
          charEnd: rawEndOffset,
          contentEnd: rawEndOffset,
          usedLines: 0,
          startsMidParagraph: false,
          endsMidParagraph: false,
          isBlankAdjustment: true,
          _precomputedLines: []
        });
        curPageNum++;
        skipReservedBlankPageNums();
        return;
      }

      const contentStart = curLines.length > 0 ? curLines[0].srcStart : curPageRawStart;
      const contentEnd =
        curLines.length > 0 ? curLines[curLines.length - 1].srcEnd : curPageRawStart;
      const pageContent =
        curLines.length > 0 ? text.slice(contentStart, contentEnd) : '';
      const rawSlice = text.slice(curPageRawStart, rawEndOffset);
      const startsMidPara = Boolean(
        curLines.length > 0 && curLines[0].isWrappedContinuation
      );
      const endsMidPara = Boolean(
        curLines.length > 0 && !curLines[curLines.length - 1].endsParagraph
      );

      pagesOut.push({
        content: pageContent,
        rawSlice: rawSlice,
        charStart: curPageRawStart,
        charEnd: rawEndOffset,
        contentEnd: contentEnd,
        usedLines: curLines.length,
        startsMidParagraph: startsMidPara,
        endsMidParagraph: endsMidPara,
        isBlankAdjustment: false,
        _precomputedLines: curLines.slice()
      });

      curLines = [];
      curPageRawStart = rawEndOffset;
      curPageNum++;
      skipReservedBlankPageNums();
    }

    for (let i = 0; i < flowItems.length; i++) {
      const item = flowItems[i];

      if (item.isControlBreak) {
        flushPageSlice(item.afterOffset, false);

        if (item.isControlBreak === 'kaicho-odd' || item.isControlBreak === 'kaicho-even') {
          const wantEven = item.isControlBreak === 'kaicho-even';
          const isNextEven = curPageNum % 2 === 0;
          if (wantEven !== isNextEven) {
            flushPageSlice(item.afterOffset, true);
          }
        }
        continue;
      }

      curLines.push(item);

      // ページの許容行数に達し、かつ後続の行（改ページ制御以外）が存在する場合は次ページへ自動送り
      if (curLines.length >= maxLinesPerPage && i < flowItems.length - 1) {
        if (!flowItems[i + 1].isControlBreak) {
          flushPageSlice(item.afterOffset, false);
        }
      }
    }

    const lastItemWasBreak =
      flowItems.length > 0 && Boolean(flowItems[flowItems.length - 1].isControlBreak);

    if (curLines.length > 0 || pagesOut.length === 0 || lastItemWasBreak) {
      flushPageSlice(text.length, false);
    }

    return pagesOut;
  }

  /**
   * 長文のテキストを、1ページの許容行数(linesPerPage × columns)と改ページ・改丁制御に従って
   * 複数のページチャンクに自動分割するユーティリティ（paginateFlowTextのラッパー）
   */
  function paginateManuscriptText(text, settings, startingPageNumber) {
    return paginateFlowText(text, settings, startingPageNumber);
  }

  /**
   * トンボ（内トンボ・外トンボ・センタートンボ）をCanvasに描画する
   */
  function drawTrimMarks(ctx, geom, colorStr) {
    const trimX = geom.trimX;
    const trimY = geom.trimY;
    const trimW = geom.trimW;
    const trimH = geom.trimH;
    const bleedPx = geom.bleedPx;
    const dpi = geom.dpi;
    const markLen = mmToPx(5.0, dpi);
    const lineWidth = Math.max(1, mmToPx(0.1, dpi));

    ctx.save();
    ctx.strokeStyle = colorStr || '#000000';
    ctx.lineWidth = lineWidth;

    const corners = [
      { x: trimX, y: trimY, dx: -1, dy: -1 },
      { x: trimX + trimW, y: trimY, dx: 1, dy: -1 },
      { x: trimX, y: trimY + trimH, dx: -1, dy: 1 },
      { x: trimX + trimW, y: trimY + trimH, dx: 1, dy: 1 }
    ];

    corners.forEach(function (c) {
      // 内トンボ（仕上がり線位置）
      ctx.beginPath();
      ctx.moveTo(c.x + c.dx * bleedPx, c.y);
      ctx.lineTo(c.x + c.dx * (bleedPx + markLen), c.y);
      ctx.moveTo(c.x, c.y + c.dy * bleedPx);
      ctx.lineTo(c.x, c.y + c.dy * (bleedPx + markLen));
      ctx.stroke();

      // 外トンボ（塗り足し線位置）
      if (bleedPx > 0) {
        ctx.beginPath();
        ctx.moveTo(c.x + c.dx * bleedPx, c.y + c.dy * bleedPx);
        ctx.lineTo(c.x + c.dx * (bleedPx + markLen), c.y + c.dy * bleedPx);
        ctx.moveTo(c.x + c.dx * bleedPx, c.y + c.dy * bleedPx);
        ctx.lineTo(c.x + c.dx * bleedPx, c.y + c.dy * (bleedPx + markLen));
        ctx.stroke();
      }
    });

    // センタートンボ（天地左右中央）
    const midX = trimX + trimW / 2;
    const midY = trimY + trimH / 2;
    const crossHalf = mmToPx(2.5, dpi);
    const offset = bleedPx + mmToPx(1.5, dpi);

    // 上中央・下中央
    [
      { x: midX, y: trimY - offset, dir: -1 },
      { x: midX, y: trimY + trimH + offset, dir: 1 }
    ].forEach(function (m) {
      ctx.beginPath();
      ctx.moveTo(m.x - crossHalf, m.y);
      ctx.lineTo(m.x + crossHalf, m.y);
      ctx.moveTo(m.x, m.y - m.dir * mmToPx(1.5, dpi));
      ctx.lineTo(m.x, m.y + m.dir * mmToPx(2.5, dpi));
      ctx.stroke();
    });

    // 左中央・右中央
    [
      { x: trimX - offset, y: midY, dir: -1 },
      { x: trimX + trimW + offset, y: midY, dir: 1 }
    ].forEach(function (m) {
      ctx.beginPath();
      ctx.moveTo(m.x, m.y - crossHalf);
      ctx.lineTo(m.x, m.y + crossHalf);
      ctx.moveTo(m.x - m.dir * mmToPx(1.5, dpi), m.y);
      ctx.lineTo(m.x + m.dir * mmToPx(2.5, dpi), m.y);
      ctx.stroke();
    });

    ctx.restore();
  }

  /**
   * ヘッダーとフッターを天あき・地あき領域に描画する（例外処理）
   * - 偶数頁（右頁）：ノンブルは右（小口側）
   * - 奇数頁（左頁）：ノンブルは左（小口側）、その0.5cm右横に小説タイトル（扉設定参照）を配置
   * - 「扉」「目次」ページでコメント文字列非表示がONのときは、ノンブルは表示しコメント文字列のみ非表示にする
   */
  function drawHeaderAndFooter(ctx, page, pageNumber, geom, settings, allPages, inkColor) {
    const hf = settings.headerFooter;
    if (!hf.useHeader && !hf.useFooter) return;
    const suppressCommentOnThisPage =
      Boolean(page.type === 'tobira' && hf.hideOnTobira) ||
      Boolean(page.type === 'toc' && hf.hideOnToc);

    const dpi = geom.dpi;
    const isEven = pageNumber % 2 === 0;
    const fontPx = ptToPx(hf.fontSizePt || 7.0, dpi);
    const nombreFontId =
      (settings.typography &&
        settings.typography.nombre &&
        settings.typography.nombre.fontId) ||
      settings.typography.body.fontId;
    const commentFontId =
      (settings.typography &&
        settings.typography.nombreComment &&
        settings.typography.nombreComment.fontId) ||
      settings.typography.body.fontId;
    const nombreFontCss = getFontCss(nombreFontId, settings);
    const commentFontCss = getFontCss(commentFontId, settings);

    let nombreStr = String(pageNumber);
    if (hf.nombreFormat === 'padded') {
      nombreStr = String(pageNumber).padStart(3, '0');
    } else if (hf.nombreFormat === 'dash') {
      nombreStr = '- ' + pageNumber + ' -';
    }

    const currentPageIdx = Math.max(0, pageNumber - (hf.startPageNumber || 1));

    // 奇数頁コメント（扉設定のタイトルを自動参照、またはカスタム文字列）
    let oddComment = '';
    if (hf.oddPageCommentSource === 'tobira-title') {
      oddComment = findNovelTitleFromPages(allPages, currentPageIdx);
    } else {
      oddComment = hf.customOddPageComment || '';
    }

    const evenComment = hf.evenPageComment || '';
    const gap05cmPx = mmToPx(
      hf.oddPageCommentGapMm !== undefined && hf.oddPageCommentGapMm !== null
        ? hf.oddPageCommentGapMm
        : 5.0,
      dpi
    ); // 0.5cm = 5.0mm

    ctx.save();
    ctx.fillStyle = inkColor;
    ctx.textBaseline = 'middle';

    function renderBarAtY(yPx, showNombre, showComment) {
      if (!showNombre && !showComment) return;

      if (isEven) {
        // 偶数頁：ノンブルが右（小口側）に自動的に入る
        const rightEdgeX = geom.textBoxX + geom.textBoxW;
        ctx.textAlign = 'right';
        ctx.font = fontPx + 'px ' + nombreFontCss;
        if (showNombre) {
          ctx.fillText(nombreStr, rightEdgeX, yPx);
        }

        if (evenComment && showComment) {
          const nombreWidth = showNombre ? ctx.measureText(nombreStr).width + gap05cmPx : 0;
          ctx.font = fontPx + 'px ' + commentFontCss;
          ctx.fillText(evenComment, rightEdgeX - nombreWidth, yPx);
        }
      } else {
        // 奇数頁：ノンブルが左（小口側）に自動的に入る
        // ノンブルの0.5cm右横にコメント（小説タイトル）を入れる
        const leftEdgeX = geom.textBoxX;
        ctx.textAlign = 'left';
        ctx.font = fontPx + 'px ' + nombreFontCss;
        if (showNombre) {
          ctx.fillText(nombreStr, leftEdgeX, yPx);
        }

        if (oddComment && showComment) {
          const nombreWidth = showNombre ? ctx.measureText(nombreStr).width + gap05cmPx : 0;
          const commentX = leftEdgeX + nombreWidth;
          ctx.font = fontPx + 'px ' + commentFontCss;
          ctx.fillText(oddComment, commentX, yPx);
        }
      }
    }

    const placement = hf.nombrePlacement || 'header';
    const headerDistMm =
      hf.headerDistanceFromTopMm !== undefined && hf.headerDistanceFromTopMm !== null
        ? hf.headerDistanceFromTopMm
        : 8.5;
    const footerDistMm =
      hf.footerDistanceFromBottomMm !== undefined && hf.footerDistanceFromBottomMm !== null
        ? hf.footerDistanceFromBottomMm
        : 6.5;

    if (hf.useHeader) {
      const headerY = geom.trimY + mmToPx(headerDistMm, dpi);
      const showNombreInHeader = placement === 'header' || !hf.useFooter;
      renderBarAtY(headerY, showNombreInHeader, !suppressCommentOnThisPage);
    }

    if (hf.useFooter) {
      const footerY = geom.trimY + geom.trimH - mmToPx(footerDistMm, dpi);
      const showNombreInFooter = placement === 'footer' || !hf.useHeader || hf.useFooter;
      const showCommentInFooter =
        !hf.useHeader && placement === 'footer' && !suppressCommentOnThisPage;
      renderBarAtY(footerY, showNombreInFooter, showCommentInFooter);
    }

    ctx.restore();
  }

  /**
   * 連続した横組み90度回転欧文トークン列 (latin-rotate) を単一の光学ベースライン上に美しく描画する
   * - Cap-Height / x-Height に基づく光学センタリングで和文の縦行中心軸 (centerX) にピタッと揃える
   * - 単語・フレーズ単位の連続描画によりブラウザ本来の欧文カーニング・プロポーショナル字送りを活かす
   */
  function drawLatinRotateRun(
    ctx,
    runTokens,
    centerX,
    runTopY,
    runSpanPx,
    fontPx,
    fontCss,
    rules,
    inkColor
  ) {
    if (!runTokens || runTokens.length === 0 || runSpanPx <= 0) return;

    const runText = runTokens
      .map(function (t) {
        return t.text || '';
      })
      .join('');
    if (!runText || !runText.trim()) return;

    const scale =
      rules && typeof rules.latinFontScale === 'number' && rules.latinFontScale > 0
        ? rules.latinFontScale
        : 0.95;
    const latinFontPx = fontPx * scale;
    const userBaselineOffset =
      rules && typeof rules.latinBaselineOffset === 'number' ? rules.latinBaselineOffset : 0;
    const isMono = rules && rules.latinMode === 'rotate-mono';

    ctx.save();
    ctx.fillStyle = inkColor;
    ctx.font = latinFontPx + 'px ' + fontCss;
    ctx.textBaseline = 'alphabetic';

    // 大文字 'H' と小文字 'x' のアセント量から視覚的中心高さを計測し、90度回転後の左右中心を centerX に一致させる
    const hMet = ctx.measureText('H');
    const xMet = ctx.measureText('x');
    const capH =
      hMet && hMet.actualBoundingBoxAscent
        ? hMet.actualBoundingBoxAscent
        : latinFontPx * 0.71;
    const xH =
      xMet && xMet.actualBoundingBoxAscent
        ? xMet.actualBoundingBoxAscent
        : latinFontPx * 0.48;

    // 大文字・小文字混在文では Cap-Height と x-Height の加重中心を基準にすると最も和文の重心と揃う
    const hasLower = /[a-z]/.test(runText);
    const hasUpperOrDigit = /[A-Z0-9]/.test(runText);
    const opticalHeight =
      hasLower && hasUpperOrDigit
        ? capH * 0.62 + xH * 0.38
        : hasLower
        ? (capH * 0.4 + xH * 0.6)
        : capH;
    const baselineY = opticalHeight * 0.5 + userBaselineOffset * latinFontPx;

    const runCenterY = runTopY + runSpanPx / 2;
    ctx.translate(centerX, runCenterY);
    ctx.rotate(Math.PI / 2);

    if (isMono) {
      // 等幅回転モード：各トークンの割り当てスロット中央に同一ベースラインで配置
      ctx.textAlign = 'center';
      let localX = -runSpanPx / 2;
      for (let i = 0; i < runTokens.length; i++) {
        const tok = runTokens[i];
        const slotW = runSpanPx * ((tok.advance || 0.6) /
          runTokens.reduce(function (a, b) {
            return a + (b.advance || 0.6);
          }, 0));
        if (tok.text && tok.text !== ' ') {
          ctx.fillText(tok.text, localX + slotW / 2, baselineY);
        }
        localX += slotW;
      }
      ctx.restore();
      return;
    }

    // プロポーショナル横組みモード：ネイティブの欧文カーニングを活かして一括または均等トラッキング描画
    const naturalW = ctx.measureText(runText).width;
    if (naturalW <= 0) {
      ctx.restore();
      return;
    }

    if (naturalW > runSpanPx * 0.98) {
      // 追い込み行などで割り当て枠よりわずかに広い場合は長体スケールで枠内に綺麗に収める
      const compressX = (runSpanPx * 0.98) / naturalW;
      ctx.scale(compressX, 1.0);
      ctx.textAlign = 'center';
      ctx.fillText(runText, 0, baselineY);
    } else if (runTokens.length > 1 && runSpanPx > naturalW * 1.08) {
      // 追い出し行などで枠に余裕がある場合は、単語・文字間のトラッキングを滑らかに配分して同一ベースラインに描画
      const targetSpan = Math.min(runSpanPx * 0.94, naturalW * 1.28);
      const extraTotal = Math.max(0, targetSpan - naturalW);
      const chars = Array.from(runText);
      const gapCount = Math.max(1, chars.length - 1);
      const extraPerGap = extraTotal / gapCount;

      ctx.textAlign = 'left';
      let curX = -targetSpan / 2;
      for (let cIdx = 0; cIdx < chars.length; cIdx++) {
        const cStr = chars[cIdx];
        ctx.fillText(cStr, curX, baselineY);
        curX += ctx.measureText(cStr).width + extraPerGap;
      }
    } else {
      // 標準：ブラウザ本来のカーニング・合字（リガチャ）で中央に一括描画
      ctx.textAlign = 'center';
      ctx.fillText(runText, 0, baselineY);
    }

    ctx.restore();
  }

  /**
   * 縦書き1文字またはトークンを指定座標(centerX, topY, cellAdvancePx, fontPx)に描画する
   */
  function drawVerticalToken(ctx, tok, centerX, cellTopY, cellAdvancePx, fontPx, fontCss, rules, inkColor) {
    if (!tok || tok.type === 'space') return;
    const ch = tok.text || '';
    if (!ch || ch === '　' || ch === ' ') return;

    const cellCenterY = cellTopY + cellAdvancePx / 2;
    ctx.save();
    ctx.fillStyle = inkColor;
    ctx.strokeStyle = inkColor;
    ctx.font = fontPx + 'px ' + fontCss;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 1. 2倍ダッシュ（――）の隙間なし連結描画
    if (tok.type === 'dash' && rules.connectDashEllipsis !== false) {
      ctx.lineWidth = Math.max(1.2, fontPx * 0.085);
      ctx.beginPath();
      ctx.moveTo(centerX, cellTopY - 0.5);
      ctx.lineTo(centerX, cellTopY + cellAdvancePx + 0.5);
      ctx.stroke();
      ctx.restore();
      return;
    }

    // 2. 三点リーダー（……）の均等連結描画
    if (tok.type === 'ellipsis' && rules.connectDashEllipsis !== false) {
      const dotCount = tok.dots || 3;
      const radius = Math.max(1.0, fontPx * 0.055);
      for (let d = 0; d < dotCount; d++) {
        const ratio = (d + 0.5) / dotCount;
        const dy = cellTopY + cellAdvancePx * ratio;
        ctx.beginPath();
        ctx.arc(centerX, dy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      return;
    }

    // 3. 縦中横（2〜3桁数字や!?・!!等を1マス内に横並び配置）
    if (tok.type === 'tcy') {
      const len = ch.length;
      const scaleX = len >= 3 ? 0.62 : len === 2 ? 0.82 : 1.0;
      const tcyFontPx = fontPx * (len >= 3 ? 0.82 : 0.92);
      ctx.font = tcyFontPx + 'px ' + fontCss;
      ctx.textBaseline = 'alphabetic';
      const hMet = ctx.measureText('H');
      const capH =
        hMet && hMet.actualBoundingBoxAscent
          ? hMet.actualBoundingBoxAscent
          : tcyFontPx * 0.71;
      ctx.translate(centerX, cellCenterY);
      ctx.scale(scaleX, 1.0);
      ctx.fillText(ch, 0, capH * 0.48);
      ctx.restore();
      return;
    }

    // 4. 欧文90度回転描画（単体トークン呼び出し時も光学センタリングを適用）
    if (tok.type === 'latin-rotate') {
      ctx.restore();
      drawLatinRotateRun(
        ctx,
        [tok],
        centerX,
        cellTopY,
        cellAdvancePx,
        fontPx,
        fontCss,
        rules,
        inkColor
      );
      return;
    }

    // 5. 句読点（、。，．）をセルの右上象限へ配置
    if (KUTOUTEN_CHARS.has(ch)) {
      ctx.fillText(ch, centerX + fontPx * 0.52, cellCenterY - fontPx * 0.48);
      ctx.restore();
      return;
    }

    // 6. 小書き仮名（っゃゅょ等）を少し右上へオフセット
    if (SMALL_KANA_CHARS.has(ch)) {
      ctx.fillText(ch, centerX + fontPx * 0.11, cellCenterY - fontPx * 0.09);
      ctx.restore();
      return;
    }

    // 7. 括弧・長音符・波ダッシュ等の90度回転約物
    if (ROTATE_90_CHARS.has(ch)) {
      ctx.translate(centerX, cellCenterY);
      ctx.rotate(Math.PI / 2);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
      return;
    }

    // 8. 正立英数字（1文字ずつ縦に並べる場合の天地光学センタリング）
    if (tok.uprightLatin) {
      ctx.textBaseline = 'alphabetic';
      const hMet = ctx.measureText('H');
      const capH =
        hMet && hMet.actualBoundingBoxAscent
          ? hMet.actualBoundingBoxAscent
          : fontPx * 0.71;
      ctx.fillText(ch, centerX, cellCenterY + capH * 0.48);
      ctx.restore();
      return;
    }

    // 9. 通常の縦書き文字
    ctx.fillText(ch, centerX, cellCenterY);
    ctx.restore();

    // 10. ルビの描画（親文字の右側に配置）
    if (tok.ruby) {
      const rubyChars = Array.from(tok.ruby);
      const spanCells = tok.rubySpanCount || 1;
      const spanHeightPx = cellAdvancePx * spanCells;
      const rubyFontPx = fontPx * 0.46;
      const rubyX = centerX + fontPx * 0.68;

      ctx.save();
      ctx.fillStyle = inkColor;
      ctx.font = rubyFontPx + 'px ' + fontCss;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const step = spanHeightPx / rubyChars.length;
      rubyChars.forEach(function (rch, rIdx) {
        const ry = cellTopY + step * (rIdx + 0.5);
        if (ROTATE_90_CHARS.has(rch)) {
          ctx.save();
          ctx.translate(rubyX, ry);
          ctx.rotate(Math.PI / 2);
          ctx.fillText(rch, 0, 0);
          ctx.restore();
        } else {
          ctx.fillText(rch, rubyX, ry);
        }
      });
      ctx.restore();
    }
  }

  /**
   * トークンが検索ヒット範囲に含まれているかを判定する（'current': 現在フォーカス中の一致, 'match': その他の一致, null: 非該当）
   */
  function getTokenSearchHighlightMode(tok, searchHighlights) {
    if (!tok || !Array.isArray(searchHighlights) || searchHighlights.length === 0) return null;
    if (tok.isAutoInsertedSpace || tok.type === 'space') return null;
    const tStart =
      typeof tok.matchSpanStart === 'number'
        ? tok.matchSpanStart
        : typeof tok.srcStart === 'number'
        ? tok.srcStart
        : -1;
    const tEnd =
      typeof tok.matchSpanEnd === 'number'
        ? tok.matchSpanEnd
        : typeof tok.srcEnd === 'number'
        ? tok.srcEnd
        : -1;
    if (tStart < 0 || tEnd <= tStart) return null;

    let hitAny = false;
    for (let i = 0; i < searchHighlights.length; i++) {
      const h = searchHighlights[i];
      if (tStart < h.charEnd && tEnd > h.charStart) {
        if (h.isCurrent) return 'current';
        hitAny = true;
      }
    }
    return hitAny ? 'match' : null;
  }

  /**
   * プレビュー上の検索ヒット文字セルの背景に目立つハイライト枠を描画する
   */
  function drawTokenSearchHighlightBox(ctx, centerX, topY, heightPx, fontPx, mode) {
    if (!mode || heightPx <= 0) return;
    ctx.save();
    const boxW = fontPx * (mode === 'current' ? 1.28 : 1.16);
    const boxX = centerX - boxW / 2;
    if (mode === 'current') {
      ctx.fillStyle = 'rgba(255, 160, 0, 0.46)';
      ctx.strokeStyle = 'rgba(220, 38, 18, 0.95)';
      ctx.lineWidth = Math.max(1.4, fontPx * 0.12);
    } else {
      ctx.fillStyle = 'rgba(255, 235, 45, 0.44)';
      ctx.strokeStyle = 'rgba(225, 145, 0, 0.82)';
      ctx.lineWidth = Math.max(1.0, fontPx * 0.08);
    }
    ctx.fillRect(boxX, topY, boxW, heightPx);
    ctx.strokeRect(boxX, topY, boxW, heightPx);
    ctx.restore();
  }

  /**
   * トークン列を縦方向に順番に描画する共通ヘルパー（連続する latin-rotate トークンは一体描画）
   */
  function drawTokenListAlongColumn(
    ctx,
    tokens,
    centerX,
    startTopY,
    baseAdvancePx,
    hangingAdvancePx,
    colBottomLimitY,
    fontPx,
    fontCss,
    rules,
    inkColor,
    searchHighlights
  ) {
    let curY = startTopY;
    let t = 0;
    while (t < tokens.length) {
      const tok = tokens[t];

      // 連続した横組み90度回転欧文トークン (latin-rotate) をまとめて1つのベースライン上に描画
      if (tok && tok.type === 'latin-rotate' && !tok.isHanging) {
        const runTokens = [];
        let runSpanPx = 0;
        let runSubY = curY;
        while (
          t < tokens.length &&
          tokens[t] &&
          tokens[t].type === 'latin-rotate' &&
          !tokens[t].isHanging
        ) {
          const rTok = tokens[t];
          const advPx = (rTok.advance || 0.5) * baseAdvancePx;
          const hlMode = getTokenSearchHighlightMode(rTok, searchHighlights);
          if (hlMode) {
            drawTokenSearchHighlightBox(ctx, centerX, runSubY, advPx, fontPx, hlMode);
          }
          runTokens.push(rTok);
          runSpanPx += advPx;
          runSubY += advPx;
          t++;
        }
        drawLatinRotateRun(
          ctx,
          runTokens,
          centerX,
          curY,
          runSpanPx,
          fontPx,
          fontCss,
          rules,
          inkColor
        );
        curY += runSpanPx;
        continue;
      }

      const tokAdvPx =
        (tok.advance || 1.0) * (tok.isHanging ? hangingAdvancePx : baseAdvancePx);
      const drawTopY =
        tok.isHanging && typeof colBottomLimitY === 'number' ? colBottomLimitY : curY;

      const hlMode = getTokenSearchHighlightMode(tok, searchHighlights);
      if (hlMode) {
        drawTokenSearchHighlightBox(ctx, centerX, drawTopY, tokAdvPx, fontPx, hlMode);
      }

      drawVerticalToken(
        ctx,
        tok,
        centerX,
        drawTopY,
        tokAdvPx,
        fontPx,
        fontCss,
        rules,
        inkColor
      );

      if (!tok.isHanging) {
        curY += tokAdvPx;
      }
      t++;
    }
    return curY;
  }

  /**
   * 「扉」ページの描画（自由度の高いレイアウト対応）
   */
  function renderTobiraPage(ctx, page, geom, settings, inkColor) {
    const tobiraCfg = settings.typography.tobira;
    const usePageOverride = Boolean(
      settings.typography && settings.typography.enablePageFontOverride && page.fontOverride
    );
    const fontId = (usePageOverride && page.fontOverride.fontId) || tobiraCfg.fontId;
    const fontCss = getFontCss(fontId, settings);
    const dpi = geom.dpi;
    const data = page.tobiraData || {
      title: '無題の小説',
      subtitle: '',
      author: '',
      note: ''
    };

    const titleFontPx = ptToPx(
      (usePageOverride && page.fontOverride.fontSizePt) || tobiraCfg.titleFontSizePt || 18.0,
      dpi
    );
    const subFontPx = ptToPx(tobiraCfg.subtitleFontSizePt || 10.5, dpi);
    const authorFontPx = ptToPx(tobiraCfg.authorFontSizePt || 10.0, dpi);
    const noteFontPx = ptToPx(tobiraCfg.bodyFontSizePt || 8.5, dpi);

    const boxX = geom.textBoxX;
    const boxY = geom.textBoxY;
    const boxW = geom.textBoxW;
    const boxH = geom.textBoxH;

    ctx.save();
    ctx.strokeStyle = inkColor;
    ctx.fillStyle = inkColor;

    // 飾り罫線枠のオプション
    if (tobiraCfg.showBorder) {
      const pad = mmToPx(2.5, dpi);
      ctx.lineWidth = Math.max(1.2, mmToPx(0.25, dpi));
      ctx.strokeRect(boxX - pad, boxY - pad, boxW + pad * 2, boxH + pad * 2);

      if (tobiraCfg.layoutStyle === 'framed-double') {
        const innerPad = mmToPx(1.2, dpi);
        ctx.lineWidth = Math.max(0.8, mmToPx(0.12, dpi));
        ctx.strokeRect(
          boxX - innerPad,
          boxY - innerPad,
          boxW + innerPad * 2,
          boxH + innerPad * 2
        );
      }
    }

    // 縦書き文字列を描画する内部ヘルパー
    function drawVerticalString(str, xPx, startYPx, fPx, charPitchRatio, alignBottomY) {
      if (!str) return;
      const tokens = tokenizeParagraph(str, settings.rules);
      const pitch = fPx * (charPitchRatio || 1.12);
      const totalAdv = tokens.reduce(function (acc, t) {
        return acc + (t.advance || 1.0);
      }, 0);
      const totalH = totalAdv * pitch;
      const actualStartY = alignBottomY ? alignBottomY - totalH : startYPx;

      drawTokenListAlongColumn(
        ctx,
        tokens,
        xPx,
        actualStartY,
        pitch,
        pitch,
        null,
        fPx,
        fontCss,
        settings.rules,
        inkColor
      );
    }

    const style = tobiraCfg.layoutStyle || 'classic-center';
    const yOffsetMm =
      data.titleOffsetYMm !== undefined &&
      data.titleOffsetYMm !== null &&
      String(data.titleOffsetYMm).trim() !== ''
        ? parseFloat(data.titleOffsetYMm)
        : tobiraCfg.titleYOffsetMm !== undefined && tobiraCfg.titleYOffsetMm !== null
        ? parseFloat(tobiraCfg.titleYOffsetMm)
        : 18;
    const xOffsetMm =
      data.titleOffsetXMm !== undefined &&
      data.titleOffsetXMm !== null &&
      String(data.titleOffsetXMm).trim() !== ''
        ? parseFloat(data.titleOffsetXMm)
        : tobiraCfg.titleXOffsetMm !== undefined && tobiraCfg.titleXOffsetMm !== null
        ? parseFloat(tobiraCfg.titleXOffsetMm)
        : 0;
    const titleTopOffsetPx = mmToPx(isNaN(yOffsetMm) ? 18 : yOffsetMm, dpi);
    const titleXOffsetPx = mmToPx(isNaN(xOffsetMm) ? 0 : xOffsetMm, dpi);
    const authorBottomOffsetPx = mmToPx(tobiraCfg.authorBottomOffsetMm || 14, dpi);

    if (style === 'right-top') {
      // 右寄せタイトル＋左寄せ著者
      const titleX = boxX + boxW * 0.72 + titleXOffsetPx;
      const subX = boxX + boxW * 0.56;
      const authorX = boxX + boxW * 0.25;
      const noteX = boxX + boxW * 0.12;

      drawVerticalString(data.title, titleX, boxY + titleTopOffsetPx, titleFontPx, 1.15, null);
      drawVerticalString(
        data.subtitle,
        subX,
        boxY + titleTopOffsetPx + titleFontPx * 1.2,
        subFontPx,
        1.12,
        null
      );
      drawVerticalString(
        data.author,
        authorX,
        0,
        authorFontPx,
        1.15,
        boxY + boxH - authorBottomOffsetPx
      );
      drawVerticalString(
        data.note,
        noteX,
        0,
        noteFontPx,
        1.1,
        boxY + boxH - authorBottomOffsetPx
      );
    } else {
      // 'classic-center' または 'framed-double'
      const centerX = boxX + boxW * 0.54;
      const subX = data.subtitle ? boxX + boxW * 0.38 : centerX;
      const authorX = boxX + boxW * 0.22;
      const noteX = boxX + boxW * 0.1;
      const baseTitleX = data.subtitle ? boxX + boxW * 0.62 : centerX;

      drawVerticalString(
        data.title,
        baseTitleX + titleXOffsetPx,
        boxY + titleTopOffsetPx,
        titleFontPx,
        1.16,
        null
      );
      if (data.subtitle) {
        drawVerticalString(
          data.subtitle,
          subX,
          boxY + titleTopOffsetPx + titleFontPx * 0.8,
          subFontPx,
          1.12,
          null
        );
      }
      drawVerticalString(
        data.author,
        authorX,
        0,
        authorFontPx,
        1.15,
        boxY + boxH - authorBottomOffsetPx
      );
      if (data.note) {
        drawVerticalString(
          data.note,
          noteX,
          0,
          noteFontPx,
          1.1,
          boxY + boxH - authorBottomOffsetPx
        );
      }
    }

    // 自由テキスト（page.content）が入力されている場合は左側に追加描画
    if (page.content && page.content.trim()) {
      const lines = page.content.replace(/\r\n/g, '\n').split('\n');
      const startX = boxX + boxW * 0.35;
      const pitchX = noteFontPx * 1.8;
      lines.forEach(function (ln, idx) {
        drawVerticalString(
          ln,
          startX - idx * pitchX,
          boxY + mmToPx(12, dpi),
          noteFontPx,
          1.08,
          null
        );
      });
    }

    ctx.restore();
  }

  /**
   * 「目次」ページの描画（自由度の高い設定対応・右揃え／中央揃え対応）
   */
  function renderTocPage(ctx, page, geom, settings, inkColor) {
    const tocCfg = settings.typography.toc;
    const usePageOverride = Boolean(
      settings.typography && settings.typography.enablePageFontOverride && page.fontOverride
    );
    const fontId = (usePageOverride && page.fontOverride.fontId) || tocCfg.fontId;
    const fontCss = getFontCss(fontId, settings);
    const dpi = geom.dpi;

    const headingFontPx = ptToPx(tocCfg.headingFontSizePt || 13.0, dpi);
    const itemFontPx = ptToPx(
      (usePageOverride && page.fontOverride.fontSizePt) || tocCfg.itemFontSizePt || 9.0,
      dpi
    );
    const linePitchPx = mmToPx(tocCfg.linePitchMm || 7.5, dpi);
    const indentCells = tocCfg.topIndentChars !== undefined ? tocCfg.topIndentChars : 2;

    const data = page.tocData || { heading: '目　次', items: [] };
    const headingText =
      data.heading !== undefined && data.heading !== null ? String(data.heading) : '目　次';
    const hasHeading = headingText.trim() !== '';
    const items = Array.isArray(data.items) ? data.items : [];

    const boxX = geom.textBoxX;
    const boxY = geom.textBoxY;
    const boxW = geom.textBoxW;
    const boxH = geom.textBoxH;

    const layoutAlign = tocCfg.layoutAlign || 'right';
    const rightMostLimitX = boxX + boxW - headingFontPx * 1.2;
    let headingX = rightMostLimitX;
    let currentX = hasHeading ? rightMostLimitX - linePitchPx * 1.6 : rightMostLimitX;

    if (layoutAlign === 'center') {
      // 見出しは右端の定位置に保ち、目次項目のみを中央揃えにする
      const itemsSpanPx = Math.max(0, items.length - 1) * linePitchPx;
      const maxItemStartX = hasHeading ? rightMostLimitX - linePitchPx * 1.6 : rightMostLimitX;
      currentX = Math.min(maxItemStartX, boxX + boxW / 2 + itemsSpanPx / 2);
    } else if (layoutAlign === 'center-all') {
      // 見出し位置も含めて全体を中央揃えにする
      let totalSpanPx = 0;
      if (hasHeading && items.length > 0) {
        totalSpanPx = linePitchPx * 1.6 + Math.max(0, items.length - 1) * linePitchPx;
      } else if (!hasHeading && items.length > 0) {
        totalSpanPx = Math.max(0, items.length - 1) * linePitchPx;
      }
      headingX = Math.min(rightMostLimitX, boxX + boxW / 2 + totalSpanPx / 2);
      currentX = hasHeading ? headingX - linePitchPx * 1.6 : headingX;
    }

    // 見出し（例：「目 次」）の描画（空欄の場合は描画しない）
    if (hasHeading) {
      const hTokens = tokenizeParagraph(headingText, settings.rules);
      const startY = boxY + headingFontPx * 2.0;
      drawTokenListAlongColumn(
        ctx,
        hTokens,
        headingX,
        startY,
        headingFontPx * 1.3,
        headingFontPx * 1.3,
        null,
        headingFontPx,
        fontCss,
        settings.rules,
        inkColor
      );
    }

    // 各目次項目の描画
    const charStep = itemFontPx * 1.05;
    const itemTopY = boxY + indentCells * charStep;
    const pageNumBottomY = boxY + boxH - itemFontPx * 0.5;

    items.forEach(function (item) {
      if (currentX < boxX + itemFontPx * 0.5) return;

      const titleTokens = tokenizeParagraph(item.title || '', settings.rules);
      const titleEndY = drawTokenListAlongColumn(
        ctx,
        titleTokens,
        currentX,
        itemTopY,
        charStep,
        charStep,
        null,
        itemFontPx,
        fontCss,
        settings.rules,
        inkColor
      );

      // ページ番号のフォーマット（漢数字 or 半角数字（縦中横））
      let pageNumTokens = [];
      const rawPageStr = item.page !== undefined && item.page !== null ? String(item.page).trim() : '';
      if (rawPageStr !== '') {
        const cleanPageStr = rawPageStr
          .replace(/^[［\[]縦中横[:：]([^］\]]+)[］\]]$/, '$1')
          .replace(/[０-９]/g, function (ch) {
            return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
          });
        if (tocCfg.numberStyle === 'kanji') {
          const kStr = toKanjiNumber(cleanPageStr);
          pageNumTokens = Array.from(kStr).map(function (c) {
            return { type: 'char', text: c, advance: 1.0 };
          });
        } else {
          pageNumTokens = [{ type: 'tcy', text: cleanPageStr, advance: 1.0 }];
        }
      }

      const pageNumHeight = pageNumTokens.length * charStep;
      const pageNumStartY = pageNumBottomY - pageNumHeight;

      pageNumTokens.forEach(function (tok, idx) {
        drawVerticalToken(
          ctx,
          tok,
          currentX,
          pageNumStartY + idx * charStep,
          charStep,
          itemFontPx,
          fontCss,
          settings.rules,
          inkColor
        );
      });

      // リーダー罫線（……）の描画
      if (tocCfg.showLeaderDots && pageNumStartY - titleEndY > charStep * 1.5) {
        const leaderStart = titleEndY + charStep * 0.6;
        const leaderEnd = pageNumStartY - charStep * 0.6;
        const leaderSpan = leaderEnd - leaderStart;
        const numCells = Math.max(1, Math.floor(leaderSpan / charStep));
        const actualStep = leaderSpan / numCells;

        for (let c = 0; c < numCells; c++) {
          drawVerticalToken(
            ctx,
            { type: 'ellipsis', text: '…', dots: 3 },
            currentX,
            leaderStart + c * actualStep,
            actualStep,
            itemFontPx * 0.85,
            fontCss,
            settings.rules,
            inkColor
          );
        }
      }

      currentX -= linePitchPx;
    });
  }

  /**
   * 「本文」ページの描画（1段組み・2段組み、1行41文字×18行、行間自動調整）
   */
  function renderBodyPage(ctx, page, geom, settings, inkColor, searchHighlights) {
    const bodyCfg = settings.typography.body;
    const layoutCfg = settings.layout;
    const rules = settings.rules;
    const dpi = geom.dpi;

    const usePageOverride = Boolean(
      settings.typography && settings.typography.enablePageFontOverride && page.fontOverride
    );
    const fontId = (usePageOverride && page.fontOverride.fontId) || bodyCfg.fontId;
    const fontSizePt =
      (usePageOverride && page.fontOverride.fontSizePt) || bodyCfg.fontSizePt || 8.5;
    const fontCss = getFontCss(fontId, settings);
    const fontPx = ptToPx(fontSizePt, dpi);

    const columns = layoutCfg.columns || 1;
    const colGapPx = columns > 1 ? mmToPx(layoutCfg.columnGapMm || 5.0, dpi) : 0;
    const charsPerLine = layoutCfg.charsPerLine || 41;
    const linesPerColumn = layoutCfg.linesPerPage || 18;

    const boxX = geom.textBoxX;
    const boxY = geom.textBoxY;
    const boxW = geom.textBoxW;
    const boxH = geom.textBoxH;

    // 段ごとの高さ計算
    const colHeightPx = (boxH - colGapPx * (columns - 1)) / columns;

    // 1行あたりの基準文字送り量（41文字が段の高さに綺麗に収まるよう自動計算）
    let baseCharAdvancePx = fontPx * (1.0 + (bodyCfg.charSpacingRatio || 0));
    if (layoutCfg.autoFitCharPitch) {
      baseCharAdvancePx = colHeightPx / charsPerLine;
    }

    // 行間自動調整：18行が横幅(boxW)の右端から左端まで均等に配置されるよう計算
    let lineStepX;
    if (layoutCfg.autoLineSpacing) {
      if (linesPerColumn > 1) {
        lineStepX = (boxW - fontPx) / (linesPerColumn - 1);
      } else {
        lineStepX = boxW;
      }
    } else {
      lineStepX = fontPx + mmToPx(layoutCfg.manualLineGapMm || 1.5, dpi);
    }

    const laidOutLines = Array.isArray(page._precomputedLines)
      ? page._precomputedLines
      : layoutBodyTextToLines(page.content || '', settings, page);
    let lineCursor = 0;

    for (let col = 0; col < columns; col++) {
      const colTopY = boxY + col * (colHeightPx + colGapPx);

      // 2段組み時の段間ガイド線（プレビューガイドON時のみ薄く表示）
      if (col > 0 && geom.showGuides) {
        ctx.save();
        ctx.strokeStyle = 'rgba(120, 140, 180, 0.25)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(boxX, colTopY - colGapPx / 2);
        ctx.lineTo(boxX + boxW, colTopY - colGapPx / 2);
        ctx.stroke();
        ctx.restore();
      }

      for (let lineIdx = 0; lineIdx < linesPerColumn; lineIdx++) {
        if (lineCursor >= laidOutLines.length) break;

        const lineObj = laidOutLines[lineCursor];
        lineCursor++;

        if (lineObj.isControlBreak) {
          // ページ内の改ページトークンに遭遇した場合はこのページの描画を終了
          return;
        }

        // 右から左へ配置（0行目が右端）
        const lineCenterX = boxX + boxW - fontPx / 2 - lineIdx * lineStepX;
        const tokens = lineObj.tokens || [];
        if (tokens.length === 0) continue;

        // プレビュー用：文頭の空白1文字（字下げ）下げ忘れ注意喚起マーカー（出力画像には描画しない）
        if (
          geom.showGuides &&
          rules &&
          rules.checkIndentWarning !== false &&
          lineObj.hasMissingIndentWarning
        ) {
          ctx.save();
          // 1文字目セルの淡いアンバー枠ハイライト
          ctx.fillStyle = 'rgba(235, 145, 40, 0.20)';
          ctx.strokeStyle = 'rgba(220, 110, 20, 0.85)';
          ctx.lineWidth = Math.max(1, fontPx * 0.08);
          ctx.fillRect(
            lineCenterX - fontPx * 0.56,
            colTopY,
            fontPx * 1.12,
            baseCharAdvancePx * 1.05
          );
          ctx.strokeRect(
            lineCenterX - fontPx * 0.56,
            colTopY,
            fontPx * 1.12,
            baseCharAdvancePx * 1.05
          );
          // 行頭上部の小さな「▼」注意マーク
          ctx.fillStyle = 'rgba(220, 95, 20, 0.92)';
          const triHalfW = Math.max(2.5, fontPx * 0.32);
          const triH = Math.max(3.5, fontPx * 0.42);
          const triBottomY = colTopY - Math.max(1.5, fontPx * 0.12);
          ctx.beginPath();
          ctx.moveTo(lineCenterX, triBottomY);
          ctx.lineTo(lineCenterX - triHalfW, triBottomY - triH);
          ctx.lineTo(lineCenterX + triHalfW, triBottomY - triH);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }

        // ぶら下げ以外のトークン合計送り量を計算し、追い込み・追い出し時の文字間隔微調整を行う
        const inFrameTokens = tokens.filter(function (t) {
          return !t.isHanging;
        });
        const totalAdv = inFrameTokens.reduce(function (acc, t) {
          return acc + (t.advance || 1.0);
        }, 0);

        let scaleAdv = baseCharAdvancePx;
        if (lineObj.adjustMode === 'oikomi' && totalAdv > charsPerLine) {
          // 追い込み：文字間隔を微縮小して行枠内に収める
          scaleAdv = colHeightPx / totalAdv;
        } else if (
          lineObj.adjustMode === 'oidashi' &&
          totalAdv > 0 &&
          totalAdv < charsPerLine
        ) {
          // 追い出し：文字間隔を微拡大して行末を揃える
          scaleAdv = colHeightPx / totalAdv;
        }

        drawTokenListAlongColumn(
          ctx,
          tokens,
          lineCenterX,
          colTopY,
          scaleAdv,
          baseCharAdvancePx,
          colTopY + colHeightPx,
          fontPx,
          fontCss,
          rules,
          inkColor,
          searchHighlights
        );
      }
    }
  }

  /**
   * ページジオメトリ（仕上がり枠・塗り足し・ノド/小口マージン・文字枠）を計算する
   */
  function computePageGeometry(pageNumber, settings, options) {
    const opts = options || {};
    const dpi = opts.dpi || settings.paper.dpi || 600;
    const includeTrimMarks = Boolean(opts.includeTrimMarks);
    const bleedMm =
      opts.bleedMm !== undefined ? opts.bleedMm : settings.paper.bleedMm || 0;

    const widthMm = settings.paper.widthMm || 105;
    const heightMm = settings.paper.heightMm || 148;

    // トンボ表示時は外側に10mmの余白を確保、塗り足しのみの場合はbleedMm分を追加
    const outerCanvasMarginMm = includeTrimMarks ? bleedMm + 8.0 : opts.includeBleedArea ? bleedMm : 0;

    const totalWidthMm = widthMm + outerCanvasMarginMm * 2;
    const totalHeightMm = heightMm + outerCanvasMarginMm * 2;

    const canvasW = Math.round(mmToPx(totalWidthMm, dpi));
    const canvasH = Math.round(mmToPx(totalHeightMm, dpi));

    const trimX = mmToPx(outerCanvasMarginMm, dpi);
    const trimY = mmToPx(outerCanvasMarginMm, dpi);
    const trimW = mmToPx(widthMm, dpi);
    const trimH = mmToPx(heightMm, dpi);
    const bleedPx = mmToPx(bleedMm, dpi);

    // 製本状態を想定：
    // 偶数頁（右頁）ではノド側が左(1.5cm)、小口側が右(1.0cm)
    // 奇数頁（左頁）ではノド側が右(1.5cm)、小口側が左(1.0cm)
    const isEven = pageNumber % 2 === 0;
    const gutterPx = mmToPx(settings.layout.margins.gutterMm || 15.0, dpi);
    const outerPx = mmToPx(settings.layout.margins.outerMm || 10.0, dpi);
    const topPx = mmToPx(settings.layout.margins.topMm || 16.0, dpi);
    const bottomPx = mmToPx(settings.layout.margins.bottomMm || 12.0, dpi);

    const leftMarginPx = isEven ? gutterPx : outerPx;
    const rightMarginPx = isEven ? outerPx : gutterPx;

    const textBoxX = trimX + leftMarginPx;
    const textBoxY = trimY + topPx;
    const textBoxW = Math.max(10, trimW - leftMarginPx - rightMarginPx);
    const textBoxH = Math.max(10, trimH - topPx - bottomPx);

    return {
      dpi: dpi,
      isEven: isEven,
      canvasW: canvasW,
      canvasH: canvasH,
      trimX: trimX,
      trimY: trimY,
      trimW: trimW,
      trimH: trimH,
      bleedPx: bleedPx,
      outerCanvasMarginMm: outerCanvasMarginMm,
      leftMarginPx: leftMarginPx,
      rightMarginPx: rightMarginPx,
      topPx: topPx,
      bottomPx: bottomPx,
      textBoxX: textBoxX,
      textBoxY: textBoxY,
      textBoxW: textBoxW,
      textBoxH: textBoxH,
      showGuides: Boolean(opts.showGuides)
    };
  }

  /**
   * 指定されたページをCanvasにレンダリングするメイン関数
   */
  function renderPageToCanvas(canvas, page, pageIndex, allPages, settings, options) {
    const opts = options || {};
    const startPageNum = settings.headerFooter.startPageNumber || 1;
    const pageNumber = startPageNum + pageIndex;
    const geom = computePageGeometry(pageNumber, settings, opts);

    canvas.width = geom.canvasW;
    canvas.height = geom.canvasH;

    const ctx = canvas.getContext('2d');
    ctx.save();

    // 背景白塗り
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, geom.canvasW, geom.canvasH);

    // K100%単色グレースケール時は純黒 (#000000)
    const inkColor = '#000000';

    // プレビュー用のガイド線（仕上がり枠・文字レイアウト枠・ノド側表示）
    if (geom.showGuides && !opts.isExport) {
      // 塗り足し枠と仕上がり枠の境界
      if (geom.outerCanvasMarginMm > 0) {
        ctx.strokeStyle = 'rgba(0, 160, 233, 0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(
          geom.trimX - geom.bleedPx,
          geom.trimY - geom.bleedPx,
          geom.trimW + geom.bleedPx * 2,
          geom.trimH + geom.bleedPx * 2
        );
        ctx.strokeStyle = 'rgba(220, 60, 60, 0.45)';
        ctx.strokeRect(geom.trimX, geom.trimY, geom.trimW, geom.trimH);
      }

      // ノド側の淡いシェーディング表示
      ctx.fillStyle = 'rgba(130, 110, 90, 0.045)';
      if (geom.isEven) {
        // 偶数頁：左がノド
        ctx.fillRect(geom.trimX, geom.trimY, geom.leftMarginPx, geom.trimH);
      } else {
        // 奇数頁：右がノド
        ctx.fillRect(
          geom.trimX + geom.trimW - geom.rightMarginPx,
          geom.trimY,
          geom.rightMarginPx,
          geom.trimH
        );
      }

      // 版面（文字レイアウトエリア）ガイド枠
      ctx.strokeStyle = 'rgba(90, 120, 180, 0.28)';
      ctx.lineWidth = 1;
      ctx.strokeRect(geom.textBoxX, geom.textBoxY, geom.textBoxW, geom.textBoxH);
    }

    // トンボ描画
    if (opts.includeTrimMarks) {
      drawTrimMarks(ctx, geom, inkColor);
    }

    // ヘッダー・フッター描画（天あき・地あき例外領域）
    drawHeaderAndFooter(ctx, page, pageNumber, geom, settings, allPages, inkColor);

    // ページ属性別描画（「扉」「目次」「空白」「本文」）
    if (page.type === 'tobira') {
      renderTobiraPage(ctx, page, geom, settings, inkColor);
    } else if (page.type === 'toc') {
      renderTocPage(ctx, page, geom, settings, inkColor);
    } else if (page.type === 'blank') {
      // 空白ページ：挿絵等のため本文は描画しない（ヘッダー・フッターのノンブル等は描画済み）
    } else {
      const searchHighlights =
        !opts.isExport && Array.isArray(opts.searchHighlights) ? opts.searchHighlights : null;
      renderBodyPage(ctx, page, geom, settings, inkColor, searchHighlights);
    }

    // グレースケール（K100%単色）出力時のピクセルレベル正規化
    if (opts.isExport && opts.grayscaleK100) {
      const imgData = ctx.getImageData(0, 0, geom.canvasW, geom.canvasH);
      const d = imgData.data;
      for (let i = 0; i < d.length; i += 4) {
        const lum = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
        d[i] = lum;
        d[i + 1] = lum;
        d[i + 2] = lum;
      }
      ctx.putImageData(imgData, 0, 0);
    }

    ctx.restore();
    return geom;
  }

  global.TategakiTypesetter = {
    mmToPx: mmToPx,
    ptToMm: ptToMm,
    ptToPx: ptToPx,
    toKanjiNumber: toKanjiNumber,
    findNovelTitleFromPages: findNovelTitleFromPages,
    isUnindentedNarrativeParagraph: isUnindentedNarrativeParagraph,
    isMidSentenceContinuation: isMidSentenceContinuation,
    analyzeParagraphIndentWarnings: analyzeParagraphIndentWarnings,
    tokenizeParagraph: tokenizeParagraph,
    breakTokensIntoLines: breakTokensIntoLines,
    layoutBodyTextToLines: layoutBodyTextToLines,
    paginateFlowText: paginateFlowText,
    paginateManuscriptText: paginateManuscriptText,
    computePageGeometry: computePageGeometry,
    renderPageToCanvas: renderPageToCanvas
  };
})(window);
