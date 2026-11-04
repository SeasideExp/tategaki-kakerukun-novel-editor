/**
 * 縦書き同人小説書けるくん - Exporters & Importers Engine
 *
 * 対応フォーマット:
 * 1. ページ連番PNG出力 (600dpi等、単体またはZIP一括出力)
 * 2. 印刷所対応統合PDF出力 (PDF/X-1a・PDF/X-4準拠メタデータ、K100%グレースケール単色 FlateDecode、トンボ・塗り足し3mm/5mm、TrimBox/BleedBox、フォントサブセット情報)
 * 3. EPUB3 入出力 (縦書きリフロー / 縦書き固定レイアウト)
 * 4. Word (.docx) 入出力 (縦書き tbRl, A6サイズ, ミラー余白, ルビ構造)
 * 5. 青空文庫テキスト (.txt) 入出力
 * 6. Markdown (.md) 入出力
 * 7. 設定ファイル (.csv) & 本文ファイル (.csv) & プロジェクト一括 (.csv / .json) の保存・読み込み
 */
(function (global) {
  'use strict';

  // =========================================================================
  // 1. CRC32 & Pure-JS ZIP Archive Writer / Reader (外部通信不要・完全オフライン動作)
  // =========================================================================
  const CRC_TABLE = (function () {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  }

  function stringToUtf8Bytes(str) {
    return new TextEncoder().encode(String(str));
  }

  function utf8BytesToString(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
  }

  /**
   * 複数のファイルエントリ [{ name: string, data: Uint8Array }] から無圧縮(STORE) ZIPバイナリを生成する
   * EPUB3仕様（先頭mimetypeが無圧縮かつExtraフィールドなし）にも完全準拠
   */
  function createZipArchive(entries) {
    const localHeaders = [];
    const centralHeaders = [];
    let offset = 0;

    // 保存時の現在日時をMS-DOS Date/Time形式に変換
    const now = new Date();
    const year = Math.max(1980, now.getFullYear());
    const month = now.getMonth() + 1;
    const day = now.getDate();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    const seconds = Math.floor(now.getSeconds() / 2);
    const dosTime = ((hours & 0x1f) << 11) | ((minutes & 0x3f) << 5) | (seconds & 0x1f);
    const dosDate = (((year - 1980) & 0x7f) << 9) | ((month & 0x0f) << 5) | (day & 0x1f);

    entries.forEach(function (entry) {
      const nameBytes = stringToUtf8Bytes(entry.name);
      const dataBytes =
        entry.data instanceof Uint8Array ? entry.data : stringToUtf8Bytes(entry.data || '');
      const crc = crc32(dataBytes);
      const size = dataBytes.length;

      // Local file header (30 bytes + name)
      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true); // signature
      lv.setUint16(4, 20, true); // version needed
      lv.setUint16(6, 0x0800, true); // UTF-8 flag
      lv.setUint16(8, 0, true); // compression: 0 (STORE)
      lv.setUint16(10, dosTime, true); // mod time (saved time)
      lv.setUint16(12, dosDate, true); // mod date (saved date)
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);
      lv.setUint32(22, size, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      localHeaders.push(local);
      localHeaders.push(dataBytes);

      // Central directory header (46 bytes + name)
      const central = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true);
      cv.setUint16(14, dosDate, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      central.set(nameBytes, 46);

      centralHeaders.push(central);
      offset += local.length + size;
    });

    const centralSize = centralHeaders.reduce(function (acc, b) {
      return acc + b.length;
    }, 0);

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    const totalSize = offset + centralSize + 22;
    const out = new Uint8Array(totalSize);
    let pos = 0;
    localHeaders.forEach(function (chunk) {
      out.set(chunk, pos);
      pos += chunk.length;
    });
    centralHeaders.forEach(function (chunk) {
      out.set(chunk, pos);
      pos += chunk.length;
    });
    out.set(eocd, pos);

    return out;
  }

  /* 動作が保証できないためコメントアウト。使う場合は自己責任で
  // ZIPバイナリ(ArrayBuffer)を展開して { [filename]: Uint8Array } を返す非同期関数
  // (EPUBおよびDOCXのインポート用)
  async function readZipArchive(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const view = new DataView(arrayBuffer);
    const files = {};

    // End of Central Directory を末尾から探索
    let eocdPos = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) {
        eocdPos = i;
        break;
      }
    }
    if (eocdPos === -1) {
      throw new Error('有効なZIPコンテナ（EPUB/DOCX）ではありません。');
    }

    const totalEntries = view.getUint16(eocdPos + 10, true);
    let cdPos = view.getUint32(eocdPos + 16, true);

    for (let e = 0; e < totalEntries; e++) {
      if (view.getUint32(cdPos, true) !== 0x02014b50) break;
      const compressionMethod = view.getUint16(cdPos + 10, true);
      const compSize = view.getUint32(cdPos + 20, true);
      const nameLen = view.getUint16(cdPos + 28, true);
      const extraLen = view.getUint16(cdPos + 30, true);
      const commentLen = view.getUint16(cdPos + 32, true);
      const localHeaderOffset = view.getUint32(cdPos + 42, true);

      const nameBytes = bytes.slice(cdPos + 46, cdPos + 46 + nameLen);
      const fileName = utf8BytesToString(nameBytes);

      const localNameLen = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const compressedData = bytes.slice(dataStart, dataStart + compSize);

      if (compressionMethod === 0) {
        files[fileName] = compressedData;
      } else if (compressionMethod === 8 && typeof DecompressionStream !== 'undefined') {
        try {
          const ds = new DecompressionStream('deflate-raw');
          const writer = ds.writable.getWriter();
          writer.write(compressedData);
          writer.close();
          const resp = new Response(ds.readable);
          const ab = await resp.arrayBuffer();
          files[fileName] = new Uint8Array(ab);
        } catch (err) {
          console.warn('ZIP展開スキップ:', fileName, err);
        }
      }

      cdPos += 46 + nameLen + extraLen + commentLen;
    }

    return files;
  }
  */

  /**
   * ブラウザでのファイルダウンロード発火ヘルパー
   */
  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 500);
  }

  function adler32(bytes) {
    let a = 1;
    let b = 0;
    const MOD = 65521;
    let i = 0;
    const len = bytes.length;
    while (i < len) {
      const end = Math.min(i + 5550, len);
      while (i < end) {
        a += bytes[i++];
        b += a;
      }
      a %= MOD;
      b %= MOD;
    }
    return ((b << 16) | a) >>> 0;
  }

  async function compressZlibBytes(rawBytes) {
    if (typeof CompressionStream !== 'undefined') {
      try {
        const cs = new CompressionStream('deflate');
        const writer = cs.writable.getWriter();
        writer.write(rawBytes);
        writer.close();
        const ab = await new Response(cs.readable).arrayBuffer();
        return new Uint8Array(ab);
      } catch (e) {
        // CompressionStream失敗時は無圧縮zlibブロックへフォールバック
      }
    }
    // Pure-JS Zlib (RFC 1950) Stored Blocks フォールバック
    const maxBlock = 65535;
    const numBlocks = Math.max(1, Math.ceil(rawBytes.length / maxBlock));
    const out = new Uint8Array(2 + numBlocks * 5 + rawBytes.length + 4);
    let pos = 0;
    out[pos++] = 0x78; // CMF
    out[pos++] = 0x01; // FLG
    for (let b = 0; b < numBlocks; b++) {
      const start = b * maxBlock;
      const end = Math.min(start + maxBlock, rawBytes.length);
      const blockLen = end - start;
      const isLast = b === numBlocks - 1 ? 1 : 0;
      const nlen = ~blockLen & 0xffff;
      out[pos++] = isLast;
      out[pos++] = blockLen & 0xff;
      out[pos++] = (blockLen >>> 8) & 0xff;
      out[pos++] = nlen & 0xff;
      out[pos++] = (nlen >>> 8) & 0xff;
      out.set(rawBytes.subarray(start, end), pos);
      pos += blockLen;
    }
    const adler = adler32(rawBytes);
    const dv = new DataView(out.buffer);
    dv.setUint32(pos, adler, false);
    return out;
  }

  function makePngChunk(typeFourCC, dataBytes) {
    const data = dataBytes || new Uint8Array(0);
    const chunk = new Uint8Array(12 + data.length);
    const view = new DataView(chunk.buffer);
    view.setUint32(0, data.length, false);
    for (let i = 0; i < 4; i++) {
      chunk[4 + i] = typeFourCC.charCodeAt(i) & 0xff;
    }
    if (data.length > 0) {
      chunk.set(data, 8);
    }
    const crc = crc32(chunk.subarray(4, 8 + data.length));
    view.setUint32(8 + data.length, crc, false);
    return chunk;
  }

  /**
   * CanvasからPNGバイナリ(Uint8Array)を生成する
   * ・isGrayscale === true の場合: 8bit グレースケール (Color Type = 0, 1チャンネル) PNGとして出力
   * ・isGrayscale === false の場合: RGBカラーPNGとして出力
   * ・dpi指定時は pHYs チャンク（解像度情報）も記録
   */
  async function canvasToPngUint8Array(canvas, isGrayscale, dpi) {
    if (isGrayscale) {
      const width = canvas.width;
      const height = canvas.height;
      const ctx = canvas.getContext('2d');
      const rgba = ctx.getImageData(0, 0, width, height).data;

      // 各走査線: 先頭1バイト(Filter=0: None) + widthバイト(8bit Grayscale値)
      const rowStride = width + 1;
      const rawScanlines = new Uint8Array(height * rowStride);
      for (let y = 0; y < height; y++) {
        const rowOffset = y * rowStride;
        rawScanlines[rowOffset] = 0; // Filter type 0 (None)
        const rgbaRowBase = y * width * 4;
        for (let x = 0; x < width; x++) {
          const p = rgbaRowBase + x * 4;
          const r = rgba[p];
          const g = rgba[p + 1];
          const b = rgba[p + 2];
          const a = rgba[p + 3];
          const lum = r === g && g === b ? r : Math.round(r * 0.299 + g * 0.587 + b * 0.114);
          const gray = a === 255 ? lum : Math.round((lum * a + 255 * (255 - a)) / 255);
          rawScanlines[rowOffset + 1 + x] = gray;
        }
      }

      const idatCompressed = await compressZlibBytes(rawScanlines);

      // IHDR (13 bytes): width(4), height(4), bitDepth=8(1), colorType=0:Grayscale(1), comp=0, filter=0, interlace=0
      const ihdrData = new Uint8Array(13);
      const ihdrView = new DataView(ihdrData.buffer);
      ihdrView.setUint32(0, width, false);
      ihdrView.setUint32(4, height, false);
      ihdrData[8] = 8; // Bit depth = 8
      ihdrData[9] = 0; // Color type = 0 (Grayscale)
      ihdrData[10] = 0;
      ihdrData[11] = 0;
      ihdrData[12] = 0;

      // pHYs (9 bytes): pixels per meter X(4), Y(4), unit=1:meter(1)
      const ppm = Math.round(((dpi || 600) * 1000) / 25.4);
      const physData = new Uint8Array(9);
      const physView = new DataView(physData.buffer);
      physView.setUint32(0, ppm, false);
      physView.setUint32(4, ppm, false);
      physData[8] = 1;

      const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      const ihdrChunk = makePngChunk('IHDR', ihdrData);
      const physChunk = makePngChunk('pHYs', physData);
      const idatChunk = makePngChunk('IDAT', idatCompressed);
      const iendChunk = makePngChunk('IEND', new Uint8Array(0));

      const totalLen =
        sig.length + ihdrChunk.length + physChunk.length + idatChunk.length + iendChunk.length;
      const out = new Uint8Array(totalLen);
      let pos = 0;
      out.set(sig, pos);
      pos += sig.length;
      out.set(ihdrChunk, pos);
      pos += ihdrChunk.length;
      out.set(physChunk, pos);
      pos += physChunk.length;
      out.set(idatChunk, pos);
      pos += idatChunk.length;
      out.set(iendChunk, pos);
      return out;
    }

    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) {
        blob.arrayBuffer().then(function (ab) {
          resolve(new Uint8Array(ab));
        });
      }, 'image/png');
    });
  }

  // =========================================================================
  // 2. ページ連番PNG出力 (600dpi等、単体またはZIP一括)
  // =========================================================================
  async function exportSequentialPngZip(pages, settings, onProgress) {
    const dpi = settings.paper.dpi || 600;
    const includeTrim = settings.exportOptions.includeTrimMarks;
    const bleedMm = settings.exportOptions.exportBleedMm;
    const grayscale = settings.exportOptions.pdfColorMode === 'grayscale-k100';

    const offCanvas = document.createElement('canvas');
    const zipEntries = [];

    for (let i = 0; i < pages.length; i++) {
      if (onProgress) {
        onProgress(i + 1, pages.length, 'ページ ' + (i + 1) + ' (' + dpi + 'dpi) を描画中...');
      }
      // UIスレッドに描画更新の猶予を与える
      await new Promise(function (r) {
        setTimeout(r, 15);
      });

      global.TategakiTypesetter.renderPageToCanvas(offCanvas, pages[i], i, pages, settings, {
        dpi: dpi,
        includeTrimMarks: includeTrim,
        includeBleedArea: bleedMm > 0,
        bleedMm: bleedMm,
        isExport: true,
        grayscaleK100: grayscale
      });

      const pngBytes = await canvasToPngUint8Array(offCanvas, grayscale, dpi);
      const pageNumStr = String((settings.headerFooter.startPageNumber || 1) + i).padStart(3, '0');
      zipEntries.push({
        name: 'page_' + pageNumStr + '.png',
        data: pngBytes
      });
    }

    const zipBytes = createZipArchive(zipEntries);
    const blob = new Blob([zipBytes], { type: 'application/zip' });
    const title = global.TategakiTypesetter.findNovelTitleFromPages(pages) || 'tategaki_novel';
    triggerDownload(blob, title + '_' + dpi + 'dpi_pngs.zip');
  }

  // =========================================================================
  // 2-B. 全ページ連番PSD (ZIP一括) 出力 (Adobe Photoshop PSD 形式・解像度情報0x03ED・PackBits圧縮・グレースケールK100%/RGB対応)
  // =========================================================================

  /**
   * 1走査線（1行分のチャンネルバイト列）を PackBits RLE で圧縮する
   */
  function encodePackBitsRow(rowBytes) {
    const len = rowBytes.length;
    const out = [];
    let i = 0;

    while (i < len) {
      // 3バイト以上同じ値が連続するランを探す
      let runEnd = i + 1;
      while (
        runEnd < len &&
        runEnd - i < 128 &&
        rowBytes[runEnd] === rowBytes[i]
      ) {
        runEnd++;
      }

      const runLen = runEnd - i;
      if (runLen >= 3) {
        // 連続ラン: header = 257 - runLen (- (runLen - 1))
        out.push((257 - runLen) & 0xff);
        out.push(rowBytes[i]);
        i = runEnd;
      } else {
        // 非連続リテラルラン: 次に3バイト以上連続する箇所または128バイト上限まで進める
        let litEnd = i;
        while (litEnd < len && litEnd - i < 128) {
          if (
            litEnd + 2 < len &&
            rowBytes[litEnd] === rowBytes[litEnd + 1] &&
            rowBytes[litEnd] === rowBytes[litEnd + 2]
          ) {
            break;
          }
          litEnd++;
        }
        const litLen = Math.max(1, litEnd - i);
        out.push((litLen - 1) & 0xff);
        for (let k = 0; k < litLen; k++) {
          out.push(rowBytes[i + k]);
        }
        i += litLen;
      }
    }

    return new Uint8Array(out);
  }

  /**
   * CanvasからAdobe Photoshop (.psd) バイナリ(Uint8Array)を生成する
   * ・isGrayscale === true の場合: 8bit グレースケール (ColorMode = 1, 1チャンネル) として出力
   * ・isGrayscale === false の場合: 8bit RGB (ColorMode = 3, 3チャンネル) として出力
   * ・Image Resource 0x03ED (ResolutionInfo) に指定DPIを書き込み、印刷所やDTPソフトで実寸mm認識可能
   */
  function canvasToPsdUint8Array(canvas, dpi, isGrayscale) {
    const width = canvas.width;
    const height = canvas.height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, width, height).data;

    const channels = isGrayscale ? 1 : 3;
    const colorMode = isGrayscale ? 1 : 3; // 1 = Grayscale, 3 = RGB
    const resolutionDpi = Math.max(72, Math.round(dpi || 600));

    // 各チャンネル×各行のPackBits圧縮データを生成
    const totalRows = channels * height;
    const rowByteCounts = new Uint16Array(totalRows);
    const compressedRows = new Array(totalRows);
    let compressedDataTotalBytes = 0;

    const rowBuffer = new Uint8Array(width);

    for (let ch = 0; ch < channels; ch++) {
      for (let y = 0; y < height; y++) {
        const rowBase = y * width * 4;
        if (isGrayscale) {
          for (let x = 0; x < width; x++) {
            rowBuffer[x] = imgData[rowBase + x * 4];
          }
        } else {
          for (let x = 0; x < width; x++) {
            rowBuffer[x] = imgData[rowBase + x * 4 + ch];
          }
        }
        const encoded = encodePackBitsRow(rowBuffer);
        const flatIdx = ch * height + y;
        rowByteCounts[flatIdx] = encoded.length;
        compressedRows[flatIdx] = encoded;
        compressedDataTotalBytes += encoded.length;
      }
    }

    // PSDファイル構造のサイズ計算:
    // 1. File Header: 26 bytes
    // 2. Color Mode Data: 4 bytes (length = 0)
    // 3. Image Resources: 4 bytes (length = 28) + 28 bytes (8BIM 0x03ED ResolutionInfo) = 32 bytes
    // 4. Layer and Mask Info: 4 bytes (length = 0)
    // 5. Image Data: 2 bytes (compression = 1: RLE) + (totalRows * 2) bytes + compressedDataTotalBytes
    const headerAndMetaSize = 26 + 4 + 32 + 4;
    const byteCountTableSize = totalRows * 2;
    const totalFileSize =
      headerAndMetaSize + 2 + byteCountTableSize + compressedDataTotalBytes;

    const psdBytes = new Uint8Array(totalFileSize);
    const view = new DataView(psdBytes.buffer);
    let pos = 0;

    // --- 1. File Header (26 bytes) ---
    psdBytes[pos++] = 0x38; // '8'
    psdBytes[pos++] = 0x42; // 'B'
    psdBytes[pos++] = 0x50; // 'P'
    psdBytes[pos++] = 0x53; // 'S'
    view.setUint16(pos, 1, false); // Version = 1
    pos += 2;
    // Reserved 6 bytes = 0
    pos += 6;
    view.setUint16(pos, channels, false); // Channels (1 or 3)
    pos += 2;
    view.setUint32(pos, height, false); // Height (rows)
    pos += 4;
    view.setUint32(pos, width, false); // Width (columns)
    pos += 4;
    view.setUint16(pos, 8, false); // Depth = 8 bits
    pos += 2;
    view.setUint16(pos, colorMode, false); // Color Mode (1=Grayscale, 3=RGB)
    pos += 2;

    // --- 2. Color Mode Data Section (4 bytes) ---
    view.setUint32(pos, 0, false);
    pos += 4;

    // --- 3. Image Resources Section (32 bytes) ---
    view.setUint32(pos, 28, false); // Resource section length = 28 bytes
    pos += 4;
    psdBytes[pos++] = 0x38; // '8'
    psdBytes[pos++] = 0x42; // 'B'
    psdBytes[pos++] = 0x49; // 'I'
    psdBytes[pos++] = 0x4d; // 'M'
    view.setUint16(pos, 0x03ed, false); // Resource ID 1005 (ResolutionInfo)
    pos += 2;
    view.setUint16(pos, 0x0000, false); // Empty Pascal string padded to even 2 bytes
    pos += 2;
    view.setUint32(pos, 16, false); // Resource data size = 16 bytes
    pos += 4;
    // ResolutionInfo data (16 bytes):
    // hRes (Fixed 16.16), hResUnit (1=ppi), widthUnit (2=cm), vRes (Fixed 16.16), vResUnit (1=ppi), heightUnit (2=cm)
    view.setUint32(pos, (resolutionDpi << 16) >>> 0, false);
    pos += 4;
    view.setUint16(pos, 1, false); // 1 = pixels per inch
    pos += 2;
    view.setUint16(pos, 2, false); // 2 = cm
    pos += 2;
    view.setUint32(pos, (resolutionDpi << 16) >>> 0, false);
    pos += 4;
    view.setUint16(pos, 1, false); // 1 = pixels per inch
    pos += 2;
    view.setUint16(pos, 2, false); // 2 = cm
    pos += 2;

    // --- 4. Layer and Mask Information Section (4 bytes) ---
    view.setUint32(pos, 0, false);
    pos += 4;

    // --- 5. Image Data Section ---
    view.setUint16(pos, 1, false); // Compression = 1 (PackBits RLE)
    pos += 2;

    // Scanline byte counts (Big-Endian uint16 per row per channel)
    for (let r = 0; r < totalRows; r++) {
      view.setUint16(pos, rowByteCounts[r], false);
      pos += 2;
    }

    // Compressed scanline data
    for (let r = 0; r < totalRows; r++) {
      const rowData = compressedRows[r];
      psdBytes.set(rowData, pos);
      pos += rowData.length;
    }

    return psdBytes;
  }

  /**
   * 全ページ連番PSDファイルをZIP一括で書き出す
   */
  async function exportSequentialPsdZip(pages, settings, onProgress) {
    const dpi = settings.paper.dpi || 600;
    const includeTrim = settings.exportOptions.includeTrimMarks;
    const bleedMm = settings.exportOptions.exportBleedMm;
    const grayscale = settings.exportOptions.pdfColorMode === 'grayscale-k100';

    const offCanvas = document.createElement('canvas');
    const zipEntries = [];

    for (let i = 0; i < pages.length; i++) {
      if (onProgress) {
        onProgress(
          i + 1,
          pages.length,
          'PSD用ページ ' + (i + 1) + '/' + pages.length + ' (' + dpi + 'dpi) を生成中...'
        );
      }
      await new Promise(function (r) {
        setTimeout(r, 15);
      });

      global.TategakiTypesetter.renderPageToCanvas(offCanvas, pages[i], i, pages, settings, {
        dpi: dpi,
        includeTrimMarks: includeTrim,
        includeBleedArea: bleedMm > 0,
        bleedMm: bleedMm,
        isExport: true,
        grayscaleK100: grayscale
      });

      const psdBytes = canvasToPsdUint8Array(offCanvas, dpi, grayscale);
      const pageNumStr = String((settings.headerFooter.startPageNumber || 1) + i).padStart(3, '0');
      zipEntries.push({
        name: 'page_' + pageNumStr + '.psd',
        data: psdBytes
      });
    }

    const zipBytes = createZipArchive(zipEntries);
    const blob = new Blob([zipBytes], { type: 'application/zip' });
    const title = global.TategakiTypesetter.findNovelTitleFromPages(pages) || 'tategaki_novel';
    triggerDownload(blob, title + '_' + dpi + 'dpi_psds.zip');
  }

  // =========================================================================
  // 3. 印刷所対応 統合PDF出力 (PDF/X-1a:2001・PDF/X-4準拠 / K100%単色DeviceGray対応)
  // 動作が保証できないためコメントアウト。使う場合は自己責任で
  // =========================================================================
  /* 動作が保証できないためコメントアウト。使う場合は自己責任で
  async function compressFlateBytes(rawBytes) {
    if (typeof CompressionStream !== 'undefined') {
      try {
        const cs = new CompressionStream('deflate');
        const writer = cs.writable.getWriter();
        writer.write(rawBytes);
        writer.close();
        const ab = await new Response(cs.readable).arrayBuffer();
        return { bytes: new Uint8Array(ab), filter: '/FlateDecode' };
      } catch (e) {
        // フォールバック
      }
    }
    return { bytes: rawBytes, filter: null };
  }

  async function exportPrintReadyPdf(pages, settings, customFontBytes, onProgress) {
    const dpi = settings.paper.dpi || 600;
    const includeTrim = settings.exportOptions.includeTrimMarks;
    const bleedMm = settings.exportOptions.exportBleedMm;
    const isGrayscaleK100 = settings.exportOptions.pdfColorMode === 'grayscale-k100';
    const pdfStandard = settings.exportOptions.pdfStandard || 'PDF/X-1a:2001';
    const novelTitle =
      global.TategakiTypesetter.findNovelTitleFromPages(pages) || '縦書き同人小説書けるくん出力';

    const offCanvas = document.createElement('canvas');
    const renderedPages = [];

    for (let i = 0; i < pages.length; i++) {
      if (onProgress) {
        onProgress(
          i + 1,
          pages.length,
          'PDF用高解像度組版 (' + (i + 1) + '/' + pages.length + '頁, ' + dpi + 'dpi) を生成中...'
        );
      }
      await new Promise(function (r) {
        setTimeout(r, 15);
      });

      const geom = global.TategakiTypesetter.renderPageToCanvas(
        offCanvas,
        pages[i],
        i,
        pages,
        settings,
        {
          dpi: dpi,
          includeTrimMarks: includeTrim,
          includeBleedArea: bleedMm > 0,
          bleedMm: bleedMm,
          isExport: true,
          grayscaleK100: isGrayscaleK100
        }
      );

      const ctx = offCanvas.getContext('2d');
      const imgData = ctx.getImageData(0, 0, geom.canvasW, geom.canvasH).data;

      let channelBytes;
      let colorSpace;
      if (isGrayscaleK100) {
        // K100%単色（DeviceGray 8bit 1チャンネル）データ抽出
        channelBytes = new Uint8Array(geom.canvasW * geom.canvasH);
        for (let p = 0, q = 0; p < imgData.length; p += 4, q++) {
          channelBytes[q] = imgData[p];
        }
        colorSpace = '/DeviceGray';
      } else {
        // DeviceRGB 3チャンネルデータ抽出
        channelBytes = new Uint8Array(geom.canvasW * geom.canvasH * 3);
        for (let p = 0, q = 0; p < imgData.length; p += 4, q += 3) {
          channelBytes[q] = imgData[p];
          channelBytes[q + 1] = imgData[p + 1];
          channelBytes[q + 2] = imgData[p + 2];
        }
        colorSpace = '/DeviceRGB';
      }

      const compressed = await compressFlateBytes(channelBytes);
      renderedPages.push({
        widthPx: geom.canvasW,
        heightPx: geom.canvasH,
        outerMarginMm: geom.outerCanvasMarginMm,
        bleedMm: bleedMm,
        trimWidthMm: settings.paper.widthMm || 105,
        trimHeightMm: settings.paper.heightMm || 148,
        streamBytes: compressed.bytes,
        filter: compressed.filter,
        colorSpace: colorSpace
      });
    }

    // PDFバイナリの構築 (PDF-1.4 / PDF/X-1a:2001 または PDF/X-4 メタデータ付き)
    const chunks = [];
    const offsets = [];
    let byteOffset = 0;

    function writeAscii(str) {
      const b = stringToUtf8Bytes(str);
      chunks.push(b);
      byteOffset += b.length;
    }

    function writeBytes(b) {
      chunks.push(b);
      byteOffset += b.length;
    }

    function startObject(objId) {
      offsets[objId] = byteOffset;
      writeAscii(objId + ' 0 obj\n');
    }

    function endObject() {
      writeAscii('\nendobj\n');
    }

    const mmToPt = function (mm) {
      return Number(((mm / 25.4) * 72.0).toFixed(4));
    };

    // Header (with binary comment for PDF/X compliance)
    writeAscii(pdfStandard === 'PDF/X-4' ? '%PDF-1.6\n%\xE2\xE3\xCF\xD3\n' : '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

    // Object IDs:
    // 1: Catalog
    // 2: Pages
    // 3: Info (GTS_PDFXVersion, Trapped)
    // 4: OutputIntent (Japan Color / Grayscale Print Intent)
    // 5: Embedded Font Descriptor / Font Subset Resource
    let nextObjId = 6;
    const pageObjIds = [];

    renderedPages.forEach(function () {
      const pId = nextObjId++;
      const imgId = nextObjId++;
      const contentId = nextObjId++;
      pageObjIds.push({ pageId: pId, imgId: imgId, contentId: contentId });
    });

    // 1: Catalog
    startObject(1);
    writeAscii(
      '<< /Type /Catalog /Pages 2 0 R /OutputIntents [4 0 R] /PageMode /UseNone /ViewerPreferences << /Direction /R2L >> >>'
    );
    endObject();

    // 2: Pages
    const kidsRef = pageObjIds
      .map(function (p) {
        return p.pageId + ' 0 R';
      })
      .join(' ');
    startObject(2);
    writeAscii('<< /Type /Pages /Kids [' + kidsRef + '] /Count ' + pageObjIds.length + ' >>');
    endObject();

    // 3: Info (PDF/X-1a:2001 or PDF/X-4 compliant keys)
    const nowStr = 'D:20261019220000+09\'00\'';
    startObject(3);
    writeAscii(
      '<< /Title (' +
        novelTitle.replace(/[()\\]/g, '') +
        ') /Creator (Tategaki Doujin Shousetsu Kakeru-kun) /Producer (Tategaki DTP Engine) ' +
        '/CreationDate (' +
        nowStr +
        ') /ModDate (' +
        nowStr +
        ') /GTS_PDFXVersion (' +
        pdfStandard +
        ') /GTS_PDFXConformance (' +
        pdfStandard +
        ') /Trapped /False >>'
    );
    endObject();

    // 4: OutputIntent
    startObject(4);
    writeAscii(
      '<< /Type /OutputIntent /S /GTS_PDFX /OutputCondition (Japan Color 2001 Coated / K100 Monochrome) ' +
        '/OutputConditionIdentifier (JC200103) /RegistryName (http://www.color.org) ' +
        '/Info (Japan Color 2001 Coated / K100 Monochrome Print Ready) >>'
    );
    endObject();

    // 5: Embedded Font Subset Resource Dictionary (and optional custom TTF stream)
    startObject(5);
    if (customFontBytes && customFontBytes.length > 0) {
      const compressedFont = await compressFlateBytes(customFontBytes);
      writeAscii(
        '<< /Type /FontDescriptor /FontName /ABCDEF+TategakiSubsetFont /Flags 4 /FontBBox [0 -200 1000 880] ' +
          '/ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 ' +
          '/Length ' +
          compressedFont.bytes.length +
          ' /Length1 ' +
          customFontBytes.length +
          (compressedFont.filter ? ' /Filter ' + compressedFont.filter : '') +
          ' >>\nstream\n'
      );
      writeBytes(compressedFont.bytes);
      writeAscii('\nendstream');
    } else {
      writeAscii(
        '<< /Type /Font /Subtype /Type0 /BaseFont /ABCDEF+YuMincho-Regular-Identity-V /Encoding /Identity-V >>'
      );
    }
    endObject();

    // 各ページのPage, XObject(Image), Contentsオブジェクトを出力
    for (let i = 0; i < renderedPages.length; i++) {
      const rp = renderedPages[i];
      const ids = pageObjIds[i];

      const totalW = rp.trimWidthMm + rp.outerMarginMm * 2;
      const totalH = rp.trimHeightMm + rp.outerMarginMm * 2;

      const mediaW = mmToPt(totalW);
      const mediaH = mmToPt(totalH);

      const trimX = mmToPt(rp.outerMarginMm);
      const trimY = mmToPt(rp.outerMarginMm);
      const trimW = mmToPt(rp.trimWidthMm);
      const trimH = mmToPt(rp.trimHeightMm);

      const bleedOffset = mmToPt(Math.max(0, rp.outerMarginMm - rp.bleedMm));
      const bleedRight = mmToPt(totalW - Math.max(0, rp.outerMarginMm - rp.bleedMm));
      const bleedTop = mmToPt(totalH - Math.max(0, rp.outerMarginMm - rp.bleedMm));

      const mediaBox = '[0 0 ' + mediaW + ' ' + mediaH + ']';
      const trimBox =
        '[' +
        trimX +
        ' ' +
        trimY +
        ' ' +
        Number((trimX + trimW).toFixed(4)) +
        ' ' +
        Number((trimY + trimH).toFixed(4)) +
        ']';
      const bleedBox =
        '[' + bleedOffset + ' ' + bleedOffset + ' ' + bleedRight + ' ' + bleedTop + ']';

      // Page Object
      startObject(ids.pageId);
      writeAscii(
        '<< /Type /Page /Parent 2 0 R /MediaBox ' +
          mediaBox +
          ' /BleedBox ' +
          bleedBox +
          ' /TrimBox ' +
          trimBox +
          ' /ArtBox ' +
          trimBox +
          ' /Resources << /XObject << /Im0 ' +
          ids.imgId +
          ' 0 R >> /Font << /F1 5 0 R >> >> /Contents ' +
          ids.contentId +
          ' 0 R >>'
      );
      endObject();

      // Image XObject
      startObject(ids.imgId);
      writeAscii(
        '<< /Type /XObject /Subtype /Image /Width ' +
          rp.widthPx +
          ' /Height ' +
          rp.heightPx +
          ' /ColorSpace ' +
          rp.colorSpace +
          ' /BitsPerComponent 8 ' +
          (rp.filter ? '/Filter ' + rp.filter + ' ' : '') +
          '/Length ' +
          rp.streamBytes.length +
          ' >>\nstream\n'
      );
      writeBytes(rp.streamBytes);
      writeAscii('\nendstream');
      endObject();

      // Page Content Stream
      const contentStr = 'q\n' + mediaW + ' 0 0 ' + mediaH + ' 0 0 cm\n/Im0 Do\nQ\n';
      const contentBytes = stringToUtf8Bytes(contentStr);
      startObject(ids.contentId);
      writeAscii('<< /Length ' + contentBytes.length + ' >>\nstream\n');
      writeBytes(contentBytes);
      writeAscii('\nendstream');
      endObject();
    }

    // Xref Table
    const xrefStart = byteOffset;
    writeAscii('xref\n0 ' + nextObjId + '\n');
    writeAscii('0000000000 65535 f \n');
    for (let id = 1; id < nextObjId; id++) {
      const offStr = String(offsets[id] || 0).padStart(10, '0');
      writeAscii(offStr + ' 00000 n \n');
    }

    // Trailer
    writeAscii(
      'trailer\n<< /Size ' +
        nextObjId +
        ' /Root 1 0 R /Info 3 0 R >>\nstartxref\n' +
        xrefStart +
        '\n%%EOF\n'
    );

    const pdfBlob = new Blob(chunks, { type: 'application/pdf' });
    triggerDownload(pdfBlob, novelTitle + '_入稿用統合.pdf');
  }
  */

  // =========================================================================
  // 4. EPUB3 エクスポート & インポート（縦書きリフロー・固定レイアウト両対応）
  // 動作が保証できないためコメントアウト。使う場合は自己責任で
  // =========================================================================
  /* 動作が保証できないためコメントアウト。使う場合は自己責任で
  function escapeXml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function convertBodyTextToXhtml(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    return lines
      .map(function (line) {
        if (!line.trim()) return '<p><br/></p>';
        let escaped = escapeXml(line);
        // ルビ変換
        escaped = escaped.replace(/[｜|]([^《]+)《([^》]+)》/g, '<ruby>$1<rt>$2</rt></ruby>');
        escaped = escaped.replace(/([一-龠々〆ヵヶ]+)《([^》]+)》/g, '<ruby>$1<rt>$2</rt></ruby>');
        // 縦中横変換
        escaped = escaped.replace(
          /[［\[]縦中横[:：]([^］\]]+)[］\]]/g,
          '<span class="tcy">$1</span>'
        );
        escaped = escaped.replace(/(?<![0-9])([0-9]{2,3})(?![0-9])/g, '<span class="tcy">$1</span>');
        escaped = escaped.replace(/(!\?|\?!|!!|\?\?)/g, '<span class="tcy">$1</span>');
        return '<p>' + escaped + '</p>';
      })
      .join('\n');
  }

  async function exportEpub3(pages, settings) {
    const isFixed = settings.exportOptions.epubLayout === 'fixed';
    const title = global.TategakiTypesetter.findNovelTitleFromPages(pages) || '縦書き同人小説';
    let author = '著者';
    pages.forEach(function (p) {
      if (p.type === 'tobira' && p.tobiraData && p.tobiraData.author) {
        author = p.tobiraData.author;
      }
    });

    const entries = [];
    // 1. mimetype (MUST be first and uncompressed)
    entries.push({
      name: 'mimetype',
      data: stringToUtf8Bytes('application/epub+zip')
    });

    // 2. META-INF/container.xml
    entries.push({
      name: 'META-INF/container.xml',
      data: stringToUtf8Bytes(
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n' +
          '  <rootfiles>\n' +
          '    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n' +
          '  </rootfiles>\n' +
          '</container>'
      )
    });

    // 3. OEBPS/style.css
    const cssContent = [
      '@charset "UTF-8";',
      'html, body {',
      '  writing-mode: vertical-rl;',
      '  -webkit-writing-mode: vertical-rl;',
      '  -epub-writing-mode: vertical-rl;',
      '  font-family: "Yu Mincho", "游明朝", serif;',
      '  line-height: 1.8;',
      '  margin: 0;',
      '  padding: 2%;',
      '}',
      'p { margin: 0; text-align: justify; }',
      '.tcy {',
      '  text-combine-upright: all;',
      '  -webkit-text-combine: horizontal;',
      '  -epub-text-combine: horizontal;',
      '}',
      '.tobira-box { text-align: center; padding-top: 2em; }',
      '.tobira-title { font-size: 1.8em; font-weight: bold; margin-left: 1em; }',
      '.tobira-author { font-size: 1.1em; margin-left: 2em; }'
    ].join('\n');
    entries.push({
      name: 'OEBPS/style.css',
      data: stringToUtf8Bytes(cssContent)
    });

    const manifestItems = [
      '<item id="style" href="style.css" media-type="text/css"/>',
      '<item id="nav" href="toc.xhtml" media-type="application/xhtml+xml" properties="nav"/>'
    ];
    const spineItems = [];
    const navLiItems = [];

    const offCanvas = document.createElement('canvas');

    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      const itemId = 'page_' + (i + 1);
      const xhtmlName = itemId + '.xhtml';
      let xhtmlBody = '';

      if (isFixed) {
        // 固定レイアウトEPUB3：ページをCanvasで描画しPNGとして同梱
        global.TategakiTypesetter.renderPageToCanvas(offCanvas, p, i, pages, settings, {
          dpi: 300,
          includeTrimMarks: false,
          includeBleedArea: false
        });
        const pngBytes = await canvasToPngUint8Array(offCanvas);
        const imgName = 'img_' + (i + 1) + '.png';
        entries.push({
          name: 'OEBPS/' + imgName,
          data: pngBytes
        });
        manifestItems.push(
          '<item id="img_' + (i + 1) + '" href="' + imgName + '" media-type="image/png"/>'
        );
        xhtmlBody =
          '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;">' +
          '<img src="' +
          imgName +
          '" alt="page ' +
          (i + 1) +
          '" style="max-width:100%;max-height:100%;"/></div>';
      } else if (p.type === 'tobira') {
        const d = p.tobiraData || {};
        xhtmlBody =
          '<div class="tobira-box" data-page-type="tobira">' +
          '<h1 class="tobira-title">' +
          escapeXml(d.title || '') +
          '</h1>' +
          (d.subtitle ? '<p class="tobira-sub">' + escapeXml(d.subtitle) + '</p>' : '') +
          (d.author ? '<p class="tobira-author">' + escapeXml(d.author) + '</p>' : '') +
          (d.note ? '<p class="tobira-note">' + escapeXml(d.note) + '</p>' : '') +
          '</div>';
      } else if (p.type === 'toc') {
        const d = p.tocData || { heading: '目次', items: [] };
        const listHtml = (d.items || [])
          .map(function (it) {
            return '<li>' + escapeXml(it.title) + ' …… ' + escapeXml(it.page) + '</li>';
          })
          .join('\n');
        xhtmlBody =
          '<div data-page-type="toc"><h2>' +
          escapeXml(d.heading || '目次') +
          '</h2><ul>' +
          listHtml +
          '</ul></div>';
      } else {
        xhtmlBody =
          '<div data-page-type="body">\n' + convertBodyTextToXhtml(p.content || '') + '\n</div>';
      }

      const viewportMeta = isFixed
        ? '<meta name="viewport" content="width=1050, height=1480"/>'
        : '';

      const xhtmlDoc =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<!DOCTYPE html>\n' +
        '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja">\n' +
        '<head>\n' +
        '  <meta charset="UTF-8"/>\n' +
        '  <title>' +
        escapeXml(title) +
        ' - P.' +
        (i + 1) +
        '</title>\n' +
        '  ' +
        viewportMeta +
        '\n' +
        '  <link rel="stylesheet" type="text/css" href="style.css"/>\n' +
        '</head>\n' +
        '<body>\n' +
        xhtmlBody +
        '\n</body>\n</html>';

      entries.push({
        name: 'OEBPS/' + xhtmlName,
        data: stringToUtf8Bytes(xhtmlDoc)
      });

      manifestItems.push(
        '<item id="' + itemId + '" href="' + xhtmlName + '" media-type="application/xhtml+xml"/>'
      );
      const pageSideProp = (i + 1) % 2 === 0 ? 'page-spread-right' : 'page-spread-left';
      spineItems.push('<itemref idref="' + itemId + '" properties="' + pageSideProp + '"/>');
      navLiItems.push(
        '<li><a href="' +
          xhtmlName +
          '">ページ ' +
          (i + 1) +
          ' (' +
          (p.type === 'tobira' ? '扉' : p.type === 'toc' ? '目次' : '本文') +
          ')</a></li>'
      );
    }

    // 4. OEBPS/toc.xhtml
    const tocXhtml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<!DOCTYPE html>\n' +
      '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ja">\n' +
      '<head><meta charset="UTF-8"/><title>目次</title></head>\n' +
      '<body>\n' +
      '  <nav epub:type="toc" id="toc">\n' +
      '    <h1>' +
      escapeXml(title) +
      '</h1>\n' +
      '    <ol>\n' +
      navLiItems.join('\n') +
      '\n    </ol>\n' +
      '  </nav>\n' +
      '</body>\n</html>';
    entries.push({
      name: 'OEBPS/toc.xhtml',
      data: stringToUtf8Bytes(tocXhtml)
    });

    // 5. OEBPS/content.opf
    const layoutMeta = isFixed
      ? '<meta property="rendition:layout">pre-paginated</meta>\n    <meta property="rendition:spread">landscape</meta>'
      : '<meta property="rendition:layout">reflowable</meta>';

    const opfContent =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId" xml:lang="ja">\n' +
      '  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n' +
      '    <dc:identifier id="BookId">urn:uuid:tategaki-' +
      Date.now() +
      '</dc:identifier>\n' +
      '    <dc:title>' +
      escapeXml(title) +
      '</dc:title>\n' +
      '    <dc:creator>' +
      escapeXml(author) +
      '</dc:creator>\n' +
      '    <dc:language>ja</dc:language>\n' +
      '    <meta property="dcterms:modified">2026-10-19T12:00:00Z</meta>\n' +
      '    ' +
      layoutMeta +
      '\n' +
      '  </metadata>\n' +
      '  <manifest>\n    ' +
      manifestItems.join('\n    ') +
      '\n  </manifest>\n' +
      '  <spine page-progression-direction="rtl">\n    ' +
      spineItems.join('\n    ') +
      '\n  </spine>\n' +
      '</package>';
    entries.push({
      name: 'OEBPS/content.opf',
      data: stringToUtf8Bytes(opfContent)
    });

    const zipBytes = createZipArchive(entries);
    const blob = new Blob([zipBytes], { type: 'application/epub+zip' });
    triggerDownload(blob, title + (isFixed ? '_固定EPUB3.epub' : '_縦書きEPUB3.epub'));
  }

  async function importEpub3(arrayBuffer) {
    const files = await readZipArchive(arrayBuffer);
    const xhtmlKeys = Object.keys(files)
      .filter(function (k) {
        return (
          /\.(xhtml|html)$/i.test(k) &&
          !/toc\.xhtml$/i.test(k) &&
          !/nav\.xhtml$/i.test(k)
        );
      })
      .sort();

    const importedPages = [];
    const parser = new DOMParser();

    xhtmlKeys.forEach(function (key, idx) {
      const xmlStr = utf8BytesToString(files[key]);
      const doc = parser.parseFromString(xmlStr, 'application/xhtml+xml');
      const body = doc.querySelector('body');
      if (!body) return;

      // rubyタグを ｜親文字《ルビ》 形式に復元
      const rubies = body.querySelectorAll('ruby');
      rubies.forEach(function (r) {
        const rt = r.querySelector('rt');
        const rubyText = rt ? rt.textContent : '';
        if (rt) rt.remove();
        r.querySelectorAll('rp').forEach(function (rp) {
          rp.remove();
        });
        const baseText = r.textContent || '';
        r.textContent = '｜' + baseText + '《' + rubyText + '》';
      });

      const tobiraEl = body.querySelector('[data-page-type="tobira"], .tobira-box');
      if (tobiraEl) {
        const t = tobiraEl.querySelector('.tobira-title, h1');
        const s = tobiraEl.querySelector('.tobira-sub');
        const a = tobiraEl.querySelector('.tobira-author');
        const n = tobiraEl.querySelector('.tobira-note');
        importedPages.push({
          id: 'page-epub-' + (idx + 1),
          type: 'tobira',
          tobiraData: {
            title: t ? t.textContent.trim() : '無題',
            subtitle: s ? s.textContent.trim() : '',
            author: a ? a.textContent.trim() : '',
            note: n ? n.textContent.trim() : ''
          },
          tocData: null,
          content: '',
          fontOverride: null
        });
        return;
      }

      const paras = Array.from(body.querySelectorAll('p, h1, h2, h3, li')).map(function (el) {
        return el.textContent || '';
      });
      importedPages.push({
        id: 'page-epub-' + (idx + 1),
        type: 'body',
        tobiraData: null,
        tocData: null,
        content: paras.length > 0 ? paras.join('\n') : (body.textContent || '').trim(),
        fontOverride: null
      });
    });

    return importedPages;
  }

  // =========================================================================
  // 5. Word (.docx) エクスポート & インポート（縦書き tbRl・ミラー余白対応）
  // =========================================================================
  function exportDocx(pages, settings) {
    const title = global.TategakiTypesetter.findNovelTitleFromPages(pages) || '縦書き同人小説';
    const mmToTwips = function (mm) {
      return Math.round((mm / 25.4) * 1440);
    };

    const pageW = mmToTwips(settings.paper.widthMm || 105);
    const pageH = mmToTwips(settings.paper.heightMm || 148);
    const topTw = mmToTwips(settings.layout.margins.topMm || 16);
    const bottomTw = mmToTwips(settings.layout.margins.bottomMm || 12);
    const gutterTw = mmToTwips(settings.layout.margins.gutterMm || 15);
    const outerTw = mmToTwips(settings.layout.margins.outerMm || 10);

    const paragraphsXml = [];

    function lineToWordRuns(line) {
      // ルビを <w:ruby> または ｜親《ルビ》 テキストとして保持しつつXML化
      const pattern = /[｜|]([^《\n]+)《([^》\n]+)》|([一-龠々〆ヵヶ]+)《([^》\n]+)》/g;
      let last = 0;
      let m;
      const runs = [];
      while ((m = pattern.exec(line)) !== null) {
        if (m.index > last) {
          runs.push('<w:r><w:t>' + escapeXml(line.slice(last, m.index)) + '</w:t></w:r>');
        }
        const base = m[1] !== undefined ? m[1] : m[3];
        const rt = m[2] !== undefined ? m[2] : m[4];
        runs.push(
          '<w:r><w:ruby><w:rubyPr><w:rubyAlign w:val="distributeSpace"/></w:rubyPr>' +
            '<w:rt><w:r><w:t>' +
            escapeXml(rt) +
            '</w:t></w:r></w:rt>' +
            '<w:rubyBase><w:r><w:t>' +
            escapeXml(base) +
            '</w:t></w:r></w:rubyBase></w:ruby></w:r>'
        );
        last = pattern.lastIndex;
      }
      if (last < line.length) {
        runs.push('<w:r><w:t>' + escapeXml(line.slice(last)) + '</w:t></w:r>');
      }
      return runs.join('');
    }

    pages.forEach(function (p, idx) {
      if (idx > 0) {
        paragraphsXml.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
      }
      if (p.type === 'tobira' && p.tobiraData) {
        const d = p.tobiraData;
        [d.title, d.subtitle, d.author, d.note].filter(Boolean).forEach(function (ln) {
          paragraphsXml.push('<w:p>' + lineToWordRuns(ln) + '</w:p>');
        });
      } else if (p.type === 'toc' && p.tocData) {
        paragraphsXml.push('<w:p>' + lineToWordRuns(p.tocData.heading || '目次') + '</w:p>');
        (p.tocData.items || []).forEach(function (it) {
          paragraphsXml.push(
            '<w:p>' + lineToWordRuns((it.title || '') + ' …… ' + (it.page || '')) + '</w:p>'
          );
        });
      } else {
        const lines = String(p.content || '').replace(/\r\n/g, '\n').split('\n');
        lines.forEach(function (ln) {
          paragraphsXml.push('<w:p>' + lineToWordRuns(ln) + '</w:p>');
        });
      }
    });

    const documentXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">\n' +
      '  <w:body>\n    ' +
      paragraphsXml.join('\n    ') +
      '\n    <w:sectPr>\n' +
      '      <w:textDirection w:val="tbRl"/>\n' +
      '      <w:pgSz w:w="' +
      pageW +
      '" w:h="' +
      pageH +
      '"/>\n' +
      '      <w:pgMar w:top="' +
      topTw +
      '" w:bottom="' +
      bottomTw +
      '" w:left="' +
      outerTw +
      '" w:right="' +
      gutterTw +
      '" w:header="450" w:footer="400" w:gutter="0"/>\n' +
      '    </w:sectPr>\n' +
      '  </w:body>\n' +
      '</w:document>';

    const contentTypesXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
      '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
      '  <Default Extension="xml" ContentType="application/xml"/>\n' +
      '  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>\n' +
      '</Types>';

    const relsXml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
      '  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>\n' +
      '</Relationships>';

    const entries = [
      { name: '[Content_Types].xml', data: stringToUtf8Bytes(contentTypesXml) },
      { name: '_rels/.rels', data: stringToUtf8Bytes(relsXml) },
      { name: 'word/document.xml', data: stringToUtf8Bytes(documentXml) }
    ];

    const zipBytes = createZipArchive(entries);
    const blob = new Blob([zipBytes], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    });
    triggerDownload(blob, title + '.docx');
  }

  async function importDocx(arrayBuffer) {
    const files = await readZipArchive(arrayBuffer);
    const docBytes = files['word/document.xml'];
    if (!docBytes) {
      throw new Error('Word文書 (word/document.xml) が見つかりませんでした。');
    }
    const xmlStr = utf8BytesToString(docBytes);
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlStr, 'application/xml');

    const pElements = Array.from(doc.getElementsByTagName('w:p'));
    const pagesOut = [];
    let currentLines = [];

    pElements.forEach(function (pEl) {
      // 改ページ要素チェック
      const brs = Array.from(pEl.getElementsByTagName('w:br'));
      const hasPageBreak = brs.some(function (b) {
        return b.getAttribute('w:type') === 'page';
      });
      if (hasPageBreak && currentLines.length > 0) {
        pagesOut.push({
          id: 'page-docx-' + (pagesOut.length + 1),
          type: 'body',
          tobiraData: null,
          tocData: null,
          content: currentLines.join('\n'),
          fontOverride: null
        });
        currentLines = [];
      }

      // ルビおよびテキストの抽出
      let lineStr = '';
      const children = Array.from(pEl.childNodes);
      children.forEach(function (node) {
        if (node.nodeName === 'w:r') {
          const rubyNodes = node.getElementsByTagName('w:ruby');
          if (rubyNodes.length > 0) {
            const rNode = rubyNodes[0];
            const rtNode = rNode.getElementsByTagName('w:rt')[0];
            const baseNode = rNode.getElementsByTagName('w:rubyBase')[0];
            const rtText = rtNode ? rtNode.textContent : '';
            const baseText = baseNode ? baseNode.textContent : '';
            lineStr += '｜' + baseText + '《' + rtText + '》';
          } else {
            lineStr += node.textContent || '';
          }
        }
      });

      if (!hasPageBreak || lineStr.trim()) {
        currentLines.push(lineStr);
      }
    });

    if (currentLines.length > 0 || pagesOut.length === 0) {
      pagesOut.push({
        id: 'page-docx-' + (pagesOut.length + 1),
        type: 'body',
        tobiraData: null,
        tocData: null,
        content: currentLines.join('\n'),
        fontOverride: null
      });
    }

    return pagesOut;
  }
  */

  // =========================================================================
  // 6. プレーンテキスト (.txt) ＆ 青空文庫テキスト (.txt) ＆ Markdown (.md) 入出力
  // =========================================================================

  /**
   * ルビ記法（｜親《ルビ》）や制御タグ（[縦中横:...]、[改ページ]、[改丁] 等）を除去し、
   * 純粋なプレーンテキストに変換するヘルパー
   */
  function stripToPlainText(str) {
    let cleaned = String(str || '').replace(/\r\n/g, '\n');
    // 青空文庫形式の注記 ［＃...］ を除去
    cleaned = cleaned.replace(/[［\[][＃#][^］\]]*[］\]]/g, '');
    // 単独行の [改ページ] / [改丁] / [連動区切り] 行はその行ごと除去
    cleaned = cleaned.replace(
      /^[ \t　]*[［\[](?:改ページ|改頁|改丁(?::(?:奇数|偶数)|：(?:奇数|偶数))?|連動区切り)[］\]][ \t　]*\n?/gm,
      ''
    );
    // 行中の [改ページ] / [改丁] / [連動区切り] を除去
    cleaned = cleaned.replace(
      /[［\[](?:改ページ|改頁|改丁(?::(?:奇数|偶数)|：(?:奇数|偶数))?|連動区切り)[］\]]/g,
      ''
    );
    // [縦中横:XXX] / [見出し:XXX] は中身の文字のみ残す
    cleaned = cleaned.replace(/[［\[]縦中横[:：]([^］\]]+)[］\]]/g, '$1');
    cleaned = cleaned.replace(/[［\[]見出し[:：]([^］\]]+)[］\]]/g, '$1');
    // ルビ ｜親文字《ルビ》 → 親文字、漢字《ルビ》 → 漢字
    cleaned = cleaned.replace(/[｜|]([^《\n]+)《[^》\n]*》/g, '$1');
    cleaned = cleaned.replace(/《[^》\n]*》/g, '');
    return cleaned;
  }

  /**
   * 連続する本文連動区間（sectionPages）のテキストをページ跨ぎ途中改行なしで1つに結合するヘルパー
   */
  function combineLinkedBodySectionRaw(sectionPages) {
    if (!Array.isArray(sectionPages) || sectionPages.length === 0) return '';
    const allHaveRawSlice = sectionPages.every(function (sp) {
      return typeof sp.rawSlice === 'string';
    });
    if (allHaveRawSlice) {
      return sectionPages
        .map(function (sp) {
          return sp.rawSlice;
        })
        .join('');
    }
    const nonBlank = sectionPages.filter(function (sp) {
      return sp && !sp.isBlankAdjustment && sp.type !== 'blank';
    });
    let combined = '';
    for (let i = 0; i < nonBlank.length; i++) {
      const p = nonBlank[i];
      const c = p.content || '';
      combined += c;
      if (i < nonBlank.length - 1) {
        const nextContent = nonBlank[i + 1].content || '';
        const endsMid =
          Boolean(p.endsMidParagraph) ||
          Boolean(nonBlank[i + 1].startsMidParagraph) ||
          (typeof p.charEnd === 'number' &&
            typeof p.contentEnd === 'number' &&
            p.charEnd === p.contentEnd &&
            c.length > 0);
        if (!endsMid && !/\n$/.test(c) && !/^\n/.test(nextContent)) {
          combined += '\n';
        }
      }
    }
    return combined;
  }

  /**
   * プレーンなテキスト（.txt）として書き出す（青空文庫形式のタグを含まない純粋なテキスト出力）
   */
  function exportPlainText(pages) {
    const blocks = [];
    let idx = 0;

    while (idx < pages.length) {
      const p = pages[idx];
      if (!p) {
        idx++;
        continue;
      }

      if (p.type === 'tobira' && p.tobiraData) {
        const d = p.tobiraData;
        const tobiraLines = [d.title, d.subtitle, d.author, d.note]
          .map(function (s) {
            return stripToPlainText(s || '').trim();
          })
          .filter(Boolean);
        if (p.content && p.content.trim()) {
          tobiraLines.push(stripToPlainText(p.content).trim());
        }
        if (tobiraLines.length > 0) {
          blocks.push(tobiraLines.join('\r\n'));
        }
        idx++;
      } else if (p.type === 'toc' && p.tocData) {
        const tocLines = [];
        if (p.tocData.heading) {
          tocLines.push(stripToPlainText(p.tocData.heading).trim());
        }
        (p.tocData.items || []).forEach(function (it) {
          const t = stripToPlainText(it.title || '').trim();
          const pg = String(it.page || '').trim();
          if (t || pg) {
            tocLines.push(t + (pg ? '　' + pg : ''));
          }
        });
        if (tocLines.length > 0) {
          blocks.push(tocLines.join('\r\n'));
        }
        idx++;
      } else {
        // 連なった本文区間（連動区間）を1つの連続テキストとして結合してからプレーンテキスト化
        let endIdx = idx;
        while (
          endIdx + 1 < pages.length &&
          pages[endIdx + 1] &&
          (pages[endIdx + 1].type === 'body' || pages[endIdx + 1].type === 'blank') &&
          !pages[endIdx + 1].flowBreakBefore
        ) {
          endIdx++;
        }
        const sectionPages = pages.slice(idx, endIdx + 1);
        const combinedSectionRaw = combineLinkedBodySectionRaw(sectionPages);

        const plainSection = stripToPlainText(combinedSectionRaw).replace(/\n/g, '\r\n');
        if (plainSection.trim()) {
          blocks.push(plainSection);
        }
        idx = endIdx + 1;
      }
    }

    const title = global.TategakiTypesetter.findNovelTitleFromPages(pages) || 'novel_text';
    const blob = new Blob(['\uFEFF' + blocks.join('\r\n\r\n')], {
      type: 'text/plain;charset=utf-8'
    });
    triggerDownload(blob, title + '.txt');
  }

  function exportAozoraText(pages) {
    const blocks = [];
    let idx = 0;

    while (idx < pages.length) {
      const p = pages[idx];
      if (!p) {
        idx++;
        continue;
      }

      if (p.type === 'tobira' && p.tobiraData) {
        const d = p.tobiraData;
        const lines = [];
        if (d.title) lines.push('［＃大見出し］' + d.title + '［＃大見出し終わり］');
        if (d.subtitle) lines.push(d.subtitle);
        if (d.author) lines.push(d.author);
        if (d.note) lines.push(d.note);
        if (p.content && p.content.trim()) lines.push(p.content.trim());
        if (lines.length > 0) {
          blocks.push(lines.join('\r\n'));
        }
        idx++;
      } else if (p.type === 'toc' && p.tocData) {
        const lines = [];
        if (p.tocData.heading !== undefined && p.tocData.heading !== null && String(p.tocData.heading).trim() !== '') {
          lines.push('［＃中見出し］' + p.tocData.heading + '［＃中見出し終わり］');
        }
        (p.tocData.items || []).forEach(function (it) {
          lines.push((it.title || '') + '　……　' + (it.page || ''));
        });
        if (p.content && p.content.trim()) lines.push(p.content.trim());
        if (lines.length > 0) {
          blocks.push(lines.join('\r\n'));
        }
        idx++;
      } else {
        // 連なった本文連動区間を結合し、自動ページ折り返しの段落途中に［＃改ページ］が入らないようにする
        let endIdx = idx;
        while (
          endIdx + 1 < pages.length &&
          pages[endIdx + 1] &&
          (pages[endIdx + 1].type === 'body' || pages[endIdx + 1].type === 'blank') &&
          !pages[endIdx + 1].flowBreakBefore
        ) {
          endIdx++;
        }
        const sectionPages = pages.slice(idx, endIdx + 1);
        const hasBodyPage = sectionPages.some(function (sp) {
          return sp && sp.type === 'body' && !sp.isBlankAdjustment;
        });
        if (hasBodyPage) {
          let text = combineLinkedBodySectionRaw(sectionPages);
          text = text.replace(/[［\[](?:改ページ|改頁)[］\]]/g, '［＃改ページ］');
          text = text.replace(/[［\[]改丁(?:[:：](?:奇数|偶数))?[］\]]/g, '［＃改丁］');
          blocks.push(text.replace(/\r?\n/g, '\r\n'));
        }
        idx = endIdx + 1;
      }
    }

    const title = global.TategakiTypesetter.findNovelTitleFromPages(pages) || 'aozora_novel';
    const blob = new Blob(['\uFEFF' + blocks.join('\r\n［＃改ページ］\r\n')], {
      type: 'text/plain;charset=utf-8'
    });
    triggerDownload(blob, title + '_青空文庫形式.txt');
  }

  function exportMarkdown(pages) {
    const blocks = [];
    let idx = 0;

    while (idx < pages.length) {
      const p = pages[idx];
      if (!p) {
        idx++;
        continue;
      }

      if (p.type === 'tobira' && p.tobiraData) {
        const d = p.tobiraData;
        const lines = [];
        if (d.title) lines.push('# ' + d.title);
        if (d.subtitle) lines.push('## ' + d.subtitle);
        if (d.author) lines.push('- 著者: ' + d.author);
        if (d.note) lines.push('- 備考: ' + d.note);
        if (p.content && p.content.trim()) lines.push(p.content.trim());
        if (lines.length > 0) {
          blocks.push(lines.join('\n'));
        }
        idx++;
      } else if (p.type === 'toc' && p.tocData) {
        const lines = [];
        if (p.tocData.heading !== undefined && p.tocData.heading !== null && String(p.tocData.heading).trim() !== '') {
          lines.push('## ' + p.tocData.heading);
        }
        (p.tocData.items || []).forEach(function (it) {
          lines.push('- ' + (it.title || '') + ' (P.' + (it.page || '') + ')');
        });
        if (p.content && p.content.trim()) lines.push(p.content.trim());
        if (lines.length > 0) {
          blocks.push(lines.join('\n'));
        }
        idx++;
      } else {
        // 連なった本文連動区間を結合し、自動ページ折り返しの段落途中に --- が入らないようにする
        let endIdx = idx;
        while (
          endIdx + 1 < pages.length &&
          pages[endIdx + 1] &&
          (pages[endIdx + 1].type === 'body' || pages[endIdx + 1].type === 'blank') &&
          !pages[endIdx + 1].flowBreakBefore
        ) {
          endIdx++;
        }
        const sectionPages = pages.slice(idx, endIdx + 1);
        const hasBodyPage = sectionPages.some(function (sp) {
          return sp && sp.type === 'body' && !sp.isBlankAdjustment;
        });
        if (hasBodyPage) {
          const text = combineLinkedBodySectionRaw(sectionPages);
          blocks.push(text);
        }
        idx = endIdx + 1;
      }
    }

    const title = global.TategakiTypesetter.findNovelTitleFromPages(pages) || 'novel_markdown';
    const blob = new Blob(['\uFEFF' + blocks.join('\n\n---\n\n')], {
      type: 'text/markdown;charset=utf-8'
    });
    triggerDownload(blob, title + '.md');
  }

  function importAozoraOrMarkdownText(rawText, settings) {
    const normalized = String(rawText || '').replace(/\r\n/g, '\n');
    // ［連動区切り］または Markdown の --- で連動区間を分割（［＃改ページ］は同一連動区間内の改ページとして維持）
    const sectionChunks = normalized.split(/(?:^|\n)(?:［連動区切り］|\[連動区切り\]|---)(?:\n|$)/g);
    const resultPages = [];

    sectionChunks.forEach(function (chunk, sectionIdx) {
      const cleaned = chunk
        .replace(/［＃大見出し］(.*?)［＃大見出し終わり］/g, '$1')
        .replace(/［＃中見出し］(.*?)［＃中見出し終わり］/g, '　$1');

      const subPages = global.TategakiTypesetter.paginateFlowText(
        cleaned.trim(),
        settings,
        resultPages.length + 1
      );
      subPages.forEach(function (sp, subIdx) {
        resultPages.push({
          id: 'page-txt-' + (resultPages.length + 1) + '-' + Math.random().toString(36).slice(2, 6),
          type: 'body',
          flowBreakBefore: sectionIdx > 0 && subIdx === 0,
          isBlankAdjustment: Boolean(sp.isBlankAdjustment),
          tobiraData: null,
          tocData: null,
          content: sp.content,
          rawSlice: sp.rawSlice,
          charStart: sp.charStart,
          charEnd: sp.charEnd,
          contentEnd: sp.contentEnd,
          usedLines: sp.usedLines,
          startsMidParagraph: Boolean(sp.startsMidParagraph),
          endsMidParagraph: Boolean(sp.endsMidParagraph),
          _precomputedLines: sp._precomputedLines,
          fontOverride: null
        });
      });
    });

    return resultPages;
  }

  // =========================================================================
  // 7. CSV形式での「設定ファイル」および「本文ファイル」の保存・読み込み機能
  // =========================================================================
  function escapeCsvCell(val) {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (/[",\r\n]/.test(str)) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  function rowsToCsvString(rows) {
    return (
      '\uFEFF' +
      rows
        .map(function (row) {
          return row.map(escapeCsvCell).join(',');
        })
        .join('\r\n')
    );
  }

  /**
   * RFC-4180準拠のCSVパーサー（セル内改行・ダブルクォートエスケープ完全対応）
   */
  function parseCsvString(csvText) {
    const text = String(csvText || '').replace(/^\uFEFF/, '');
    const rows = [];
    let currentRow = [];
    let currentCell = '';
    let inQuotes = false;
    let i = 0;

    while (i < text.length) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < text.length && text[i + 1] === '"') {
            currentCell += '"';
            i += 2;
          } else {
            inQuotes = false;
            i++;
          }
        } else {
          currentCell += ch;
          i++;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
          i++;
        } else if (ch === ',') {
          currentRow.push(currentCell);
          currentCell = '';
          i++;
        } else if (ch === '\r') {
          currentRow.push(currentCell);
          rows.push(currentRow);
          currentRow = [];
          currentCell = '';
          if (i + 1 < text.length && text[i + 1] === '\n') {
            i += 2;
          } else {
            i++;
          }
        } else if (ch === '\n') {
          currentRow.push(currentCell);
          rows.push(currentRow);
          currentRow = [];
          currentCell = '';
          i++;
        } else {
          currentCell += ch;
          i++;
        }
      }
    }

    if (currentCell.length > 0 || currentRow.length > 0) {
      currentRow.push(currentCell);
      rows.push(currentRow);
    }

    return rows;
  }

  /**
   * オブジェクトをフラットなドット区切りキー配列に変換
   */
  function flattenObject(obj, prefix, out) {
    const res = out || [];
    Object.keys(obj || {}).forEach(function (k) {
      const path = prefix ? prefix + '.' + k : k;
      const val = obj[k];
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        flattenObject(val, path, res);
      } else {
        res.push([path, typeof val === 'object' ? JSON.stringify(val) : String(val), typeof val]);
      }
    });
    return res;
  }

  function applyFlattenedKeyValue(targetObj, dotPath, rawVal, valType) {
    const keys = dotPath.split('.');
    let cur = targetObj;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (typeof cur[k] !== 'object' || cur[k] === null) {
        cur[k] = {};
      }
      cur = cur[k];
    }
    const lastKey = keys[keys.length - 1];
    if (valType === 'number') {
      cur[lastKey] = Number(rawVal);
    } else if (valType === 'boolean') {
      cur[lastKey] = rawVal === 'true' || rawVal === '1';
    } else {
      cur[lastKey] = rawVal;
    }
  }

  /**
   * 「設定ファイル」をCSVとして保存
   */
  function saveSettingsToCsv(settings) {
    const rows = [['設定キー(Key)', '設定値(Value)', 'データ型(Type)']];
    const flat = flattenObject(settings, '');
    flat.forEach(function (item) {
      rows.push(item);
    });
    const csvStr = rowsToCsvString(rows);
    const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8' });
    triggerDownload(blob, '縦書き書けるくん_設定ファイル.csv');
  }

  /**
   * 「設定ファイル」CSVを読み込んでsettingsオブジェクトに反映
   */
  function loadSettingsFromCsv(csvText, currentSettings) {
    const rows = parseCsvString(csvText);
    const nextSettings = JSON.parse(JSON.stringify(currentSettings));
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 2) continue;
      const key = (row[0] || '').trim();
      const val = row[1];
      const type = (row[2] || 'string').trim();
      if (!key || key === '設定キー(Key)') continue;
      applyFlattenedKeyValue(nextSettings, key, val, type);
    }
    return nextSettings;
  }

  /**
   * 「本文ファイル」をCSVとして保存（ページ属性・扉情報・目次情報・本文・連動区切りすべて保持）
   */
  function saveManuscriptToCsv(pages) {
    const rows = [
      [
        'page_number',
        'page_type',
        'title_or_heading',
        'subtitle',
        'author',
        'note_or_toc_json',
        'content',
        'font_override_id',
        'font_override_size_pt',
        'flow_break_before',
        'raw_slice'
      ]
    ];

    pages.forEach(function (p, idx) {
      let titleOrHeading = '';
      let subtitle = '';
      let author = '';
      let noteOrToc = '';

      if (p.type === 'tobira' && p.tobiraData) {
        titleOrHeading = p.tobiraData.title || '';
        subtitle = p.tobiraData.subtitle || '';
        author = p.tobiraData.author || '';
        noteOrToc = p.tobiraData.note || '';
      } else if (p.type === 'toc' && p.tocData) {
        titleOrHeading =
          p.tocData.heading !== undefined && p.tocData.heading !== null ? p.tocData.heading : '';
        noteOrToc = JSON.stringify(p.tocData.items || []);
      }

      rows.push([
        String(idx + 1),
        p.type || 'body',
        titleOrHeading,
        subtitle,
        author,
        noteOrToc,
        p.content || '',
        p.fontOverride && p.fontOverride.fontId ? p.fontOverride.fontId : '',
        p.fontOverride && p.fontOverride.fontSizePt ? String(p.fontOverride.fontSizePt) : '',
        p.flowBreakBefore ? 'true' : 'false',
        (p.type === 'body' || p.type === 'blank') && typeof p.rawSlice === 'string'
          ? p.rawSlice
          : ''
      ]);
    });

    const csvStr = rowsToCsvString(rows);
    const title = global.TategakiTypesetter.findNovelTitleFromPages(pages) || '縦書き書けるくん';
    const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8' });
    triggerDownload(blob, title + '_本文ファイル.csv');
  }

  /**
   * 「本文ファイル」CSVを読み込んでページ配列を復元
   */
  function loadManuscriptFromCsv(csvText) {
    const rows = parseCsvString(csvText);
    const pagesOut = [];

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length === 0 || (r.length === 1 && !r[0].trim())) continue;
      if (r[0] === 'page_number') continue;

      const type = (r[1] || 'body').trim();
      const titleOrHeading = r[2] || '';
      const subtitle = r[3] || '';
      const author = r[4] || '';
      const noteOrToc = r[5] || '';
      const content = String(r[6] || '').replace(/\r\n/g, '\n');
      const fontId = (r[7] || '').trim();
      const fontSizePt = parseFloat(r[8]);
      const flowBreakBefore = (r[9] || '').trim().toLowerCase() === 'true';
      const rawSlice = r.length > 10 ? String(r[10] || '').replace(/\r\n/g, '\n') : undefined;

      let tobiraData = null;
      let tocData = null;

      if (type === 'tobira') {
        tobiraData = {
          title: titleOrHeading,
          subtitle: subtitle,
          author: author,
          note: noteOrToc
        };
      } else if (type === 'toc') {
        let items = [];
        try {
          items = JSON.parse(noteOrToc || '[]');
        } catch (e) {
          items = [];
        }
        tocData = {
          heading:
            titleOrHeading !== undefined && titleOrHeading !== null ? titleOrHeading : '',
          items: items
        };
      }

      let fontOverride = null;
      if (fontId || !isNaN(fontSizePt)) {
        fontOverride = {
          fontId: fontId || null,
          fontSizePt: !isNaN(fontSizePt) ? fontSizePt : null
        };
      }

      const pageObj = {
        id: 'page-csv-' + (pagesOut.length + 1) + '-' + Math.random().toString(36).slice(2, 6),
        type: type,
        flowBreakBefore: flowBreakBefore,
        tobiraData: tobiraData,
        tocData: tocData,
        content: content,
        fontOverride: fontOverride
      };
      if (
        (type === 'body' || type === 'blank') &&
        r.length > 10 &&
        rawSlice.indexOf(content) !== -1
      ) {
        pageObj.rawSlice = rawSlice;
      }

      pagesOut.push(pageObj);
    }

    return pagesOut;
  }

  /**
   * 設定＋本文を1つのプロジェクトファイル(.json)として一括保存・読込
   */
  function saveProjectBundleJson(settings, pages) {
    const title = global.TategakiTypesetter.findNovelTitleFromPages(pages) || '縦書き書けるくん';
    const cleanPages = (pages || []).map(function (p) {
      const copy = Object.assign({}, p);
      delete copy._precomputedLines;
      return copy;
    });
    const payload = {
      app: '縦書き同人小説書けるくん',
      version: (global.TategakiState && global.TategakiState.APP_VERSION) || '1.02',
      savedAt: new Date().toISOString(),
      settings: settings,
      pages: cleanPages
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json;charset=utf-8'
    });
    triggerDownload(blob, title + '_プロジェクト一括.json');
  }

  global.TategakiExporters = {
    exportSequentialPngZip: exportSequentialPngZip,
    exportSequentialPsdZip: exportSequentialPsdZip,
    canvasToPngUint8Array: canvasToPngUint8Array,
    canvasToPsdUint8Array: canvasToPsdUint8Array,
    // 動作が保証できないためコメントアウト。使う場合は自己責任で
    // exportPrintReadyPdf: exportPrintReadyPdf,
    // exportEpub3: exportEpub3,
    // importEpub3: importEpub3,
    // exportDocx: exportDocx,
    // importDocx: importDocx,
    exportPlainText: exportPlainText,
    exportAozoraText: exportAozoraText,
    exportMarkdown: exportMarkdown,
    importAozoraOrMarkdownText: importAozoraOrMarkdownText,
    saveSettingsToCsv: saveSettingsToCsv,
    loadSettingsFromCsv: loadSettingsFromCsv,
    saveManuscriptToCsv: saveManuscriptToCsv,
    loadManuscriptFromCsv: loadManuscriptFromCsv,
    saveProjectBundleJson: saveProjectBundleJson,
    triggerDownload: triggerDownload
  };
})(window);
