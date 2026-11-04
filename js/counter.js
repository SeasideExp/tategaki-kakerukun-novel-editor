/**
 * 縦書き同人小説書けるくん - Character Counter Engine (多様なカウント方式)
 */
(function (global) {
  'use strict';

  /**
   * ページオブジェクトからカウント対象のテキスト文字列を抽出する
   */
  function extractPageRawText(page) {
    if (!page || page.type === 'blank') return '';
    if (page.type === 'tobira' && page.tobiraData) {
      const d = page.tobiraData;
      return [d.title || '', d.subtitle || '', d.author || '', d.note || '', page.content || '']
        .filter(Boolean)
        .join('\n');
    }
    if (page.type === 'toc' && page.tocData) {
      const d = page.tocData;
      const itemLines = (d.items || []).map(function (it) {
        return (it.title || '') + (it.page ? ' ' + it.page : '');
      });
      return [d.heading || '', itemLines.join('\n'), page.content || '']
        .filter(Boolean)
        .join('\n');
    }
    return page.content || '';
  }

  /**
   * 文字列の各種文字数を算出する
   * 1. rawCount: 純粋な文字数（空白・改行・ルビ・制御記号すべて含む）
   * 2. noSpaceNewlineCount: 空白・改行を除いた文字数
   * 3. effectiveCount: ルビ・制御記号・空白・改行を除いた実文字数
   * 4. effectiveWithSpaceCount: ルビ・制御記号・改行を除いた文字数（字下げ等の空白を含む実文字数）
   * 5. manuscriptSheets400: 400字詰め原稿用紙換算枚数
   */
  function analyzeTextCounts(text) {
    const src = String(text || '').replace(/\r\n/g, '\n');

    // 1. 純粋な文字数（サロゲートペアを考慮してArray.fromで計測）
    const rawCount = Array.from(src).length;

    // 2. 空白・改行を除いた文字数
    const noSpaceStr = src.replace(/[\s\u3000\r\n]+/g, '');
    const noSpaceNewlineCount = Array.from(noSpaceStr).length;

    // 3. ルビ・制御記号を除いた実文字数
    // - 制御タグ除去: [改ページ], [改丁], [改丁:奇数], [改丁:偶数], ［＃...］
    // - [縦中横:ABC] → ABC（中の文字は残し制御記号のみ除去）
    // - ルビ記号除去: ｜親文字《ルビ》 → 親文字, 漢字《ルビ》 → 漢字
    let cleaned = src;

    // ［＃...］（青空文庫形式の注記・制御記号）を除去
    cleaned = cleaned.replace(/[［\[][＃#][^］\]]*[］\]]/g, '');

    // [改ページ] / ［改ページ］ / [改丁] / ［改丁］ 等を除去
    // 組版側（typesetter.js）と同じく全角コロンの ［改丁：奇数］ も制御タグとして扱う
    cleaned = cleaned.replace(/[［\[](?:改ページ|改頁|改丁(?:[:：](?:奇数|偶数))?)[］\]]/g, '');

    // [縦中横:XXX] または ［縦中横：XXX］ は中身のXXXだけ残す
    cleaned = cleaned.replace(/[［\[]縦中横[:：]([^］\]]+)[］\]]/g, '$1');

    // [見出し:XXX] は中身のXXXだけ残す
    cleaned = cleaned.replace(/[［\[]見出し[:：]([^］\]]+)[］\]]/g, '$1');

    // ルビ《...》を除去し、直前のルビ開始記号｜または|を除去
    cleaned = cleaned.replace(/[｜|]([^《\n]+)《[^》\n]*》/g, '$1');
    cleaned = cleaned.replace(/《[^》\n]*》/g, '');

    // Markdownの見出し記号等（行頭の # ）も制御記号として除外
    cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');

    // 空白・改行を除いた実文字数
    const effectiveNoSpaceStr = cleaned.replace(/[\s\u3000\r\n]+/g, '');
    const effectiveCount = Array.from(effectiveNoSpaceStr).length;

    // 改行のみ除いた実文字数（全角空白を含む）
    const effectiveWithSpaceStr = cleaned.replace(/[\r\n]+/g, '');
    const effectiveWithSpaceCount = Array.from(effectiveWithSpaceStr).length;

    const manuscriptSheets400 = effectiveCount > 0 ? Math.ceil((effectiveCount / 400) * 10) / 10 : 0;

    return {
      rawCount: rawCount,
      noSpaceNewlineCount: noSpaceNewlineCount,
      effectiveCount: effectiveCount,
      effectiveWithSpaceCount: effectiveWithSpaceCount,
      manuscriptSheets400: manuscriptSheets400
    };
  }

  /**
   * ページ配列に対する集計を行う
   */
  function calculatePagesStats(pages, selectedPageIds) {
    const list = Array.isArray(pages) ? pages : [];
    const selectedSet = new Set(Array.isArray(selectedPageIds) ? selectedPageIds : []);

    const totalText = list.map(extractPageRawText).join('\n');
    const totalStats = analyzeTextCounts(totalText);

    const selectedPages = list.filter(function (p) {
      return selectedSet.has(p.id);
    });
    const selectedText = selectedPages.map(extractPageRawText).join('\n');
    const selectedStats = analyzeTextCounts(selectedText);

    const perPageStats = {};
    list.forEach(function (p) {
      perPageStats[p.id] = analyzeTextCounts(extractPageRawText(p));
    });

    return {
      totalPageCount: list.length,
      selectedPageCount: selectedPages.length,
      total: totalStats,
      selected: selectedStats,
      perPage: perPageStats
    };
  }

  global.TategakiCounter = {
    extractPageRawText: extractPageRawText,
    analyzeTextCounts: analyzeTextCounts,
    calculatePagesStats: calculatePagesStats
  };
})(window);
