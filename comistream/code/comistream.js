/**
 * Comistream Reader - Core JavaScript
 *
 * Comistream Reader のコア機能を提供するJavaScriptファイル。
 * ページめくり、画像プリロード、ビューワー制御などの
 * フロントエンド機能を実装しています。
 *
 * @package     sorshi/comistream-reader
 * @author      Comistream Project.
 * @copyright   2024 Comistream Project.
 * @license     AGPL-3.0-only for Comistream Reader project-specific portions; see repository-root LICENSING.md
 * @version     1.1.0
 *
 * 主な機能:
 * - ページめくり制御
 * - 画像プリロード
 * - 自動ページ分割
 * - フルスクリーン制御
 * - キーボードショートカット
 * - タッチ操作対応
 */

/**
 * ★ PreCache - ブラウザメモリキャッシュウォーマー ルン！
 *
 * 先読みした画像の Image オブジェクト参照を imageCache (Map) で保持することで、
 * ブラウザのメモリキャッシュにデコード済み画像を維持するルン。
 * サーバーが Pragma: no-cache を返す環境でも、メモリキャッシュから
 * 即座に画像を返せるため、表示済みページへの再リクエストが発生しないルン。
 *
 * このクラスの役割：
 * - 先読みページ数(size)の管理と動的調整
 * - Image参照の保持によるメモリキャッシュ維持
 * - ネットワーク帯域の推定
 * - ページめくり速度の計測
 *
 * 注意: 以前のリングバッファは get() で取り出して使うコードが存在せず
 * 構造的に無駄だったため廃止し、代わりにシンプルな Map で
 * Image 参照を保持する方式に変更したルン。
 */
class PreCache {
  constructor(size) {
    this.size = size;
    this.imageCache = new Map(); // ★ URL→Image参照を保持してメモリキャッシュを維持するルン
    this.maxCacheEntries = 50;   // ★ メモリキャッシュの最大保持数ルン
    this.pageLoadTimes = [];     // ページめくり速度の記録ルン
    this.networkSpeed = 0;       // ネットワーク帯域
    this.networkSpeedKBps = 0;
    this.adjustPreloadPages();
  }

  /**
   * ★ 画像をブラウザメモリキャッシュに先読みするルン！
   *
   * Image()オブジェクトを作成してsrcを設定し、ブラウザが画像をダウンロードするルン。
   * 読み込み完了後も Image 参照を imageCache に保持することで、
   * ブラウザのメモリキャッシュにデコード済み画像を維持するルン。
   * loadPage() 等で同じURLの background-image が指定されたとき、
   * ネットワークリクエストなしで即座に表示されるルン！
   *
   * @param {string} imageUrl 先読みする画像のURL
   */
  async add(imageUrl) {
    // ★ 同じURLが既にキャッシュにある場合はスキップするルン
    if (this.imageCache.has(imageUrl)) {
      return;
    }

    let img = new Image();
    // ★ 注意: crossOrigin属性を設定するとCORSヘッダーが必要になるルン
    // 画像配信元がCORSヘッダーを返さない場合、画像自体が読み込めなくなるルン
    // そのため、crossOrigin属性は設定せず、Canvas操作（帯域測定）は諦めるルン
    img.src = imageUrl;

    let startTime = performance.now();

    await new Promise((resolve) => {
      img.onload = () => {
        let endTime = performance.now();
        let durationInMSeconds = endTime - startTime;

        // ★ ダウンロード時間と平均ページサイズから帯域を推定するルン
        if (typeof averagePageKBytes !== "undefined" && averagePageKBytes > 0 && durationInMSeconds > 0) {
          let estimatedFileSizeBytes = averagePageKBytes * 1024;
          let bandwidthInKbps = (estimatedFileSizeBytes * 8) / durationInMSeconds;

          this.networkSpeedKBps = bandwidthInKbps.toFixed(2);
          this.networkSpeed = bandwidthInKbps / 20000;

          debugLog(
            "PreCache.add() Estimated bandwidth: " +
              bandwidthInKbps.toFixed(2) +
              " Kbps (duration: " +
              durationInMSeconds.toFixed(0) +
              "ms, avgPageSize: " +
              averagePageKBytes +
              "KB)"
          );
        }

        // ★ Image参照をMapに保持してメモリキャッシュを維持するルン
        // Mapの挿入順序により、古いものから evict できるルン
        this.imageCache.set(imageUrl, img);
        this.evictOldEntries();

        this.adjustPreloadPages();
        resolve();
      };

      img.onerror = () => {
        // ★ エラー時もPromiseを解決してハングを防ぐルン
        debugLog("PreCache.add() image load error: " + imageUrl);
        resolve();
      };
    });
  }

  /**
   * ★ キャッシュが上限を超えたら古いエントリを削除するルン
   * Map の挿入順序を利用して、最も古いものから順に削除するルン
   */
  evictOldEntries() {
    while (this.imageCache.size > this.maxCacheEntries) {
      const oldestKey = this.imageCache.keys().next().value;
      this.imageCache.delete(oldestKey);
    }
  }

  /**
   * ★ 先読みページ数のサイズを変更するルン
   *
   * @param {number} newSize 新しい先読みページ数
   */
  resize(newSize) {
    this.size = newSize;
  }

  getSize() {
    return this.size;
  }

  getBps() {
    return Math.floor(this.networkSpeedKBps);
  }

  // ★ ページめくり速度の計測ルン
  recordPageTurn() {
    const now = Date.now();
    if (this.lastPageTurnTime) {
      const turnTime = now - this.lastPageTurnTime;
      this.pageLoadTimes.push(turnTime);
      if (this.pageLoadTimes.length > 5) {
        this.pageLoadTimes.shift(); // 古いデータを削除ルン
      }
    }
    this.lastPageTurnTime = now;
    this.adjustPreloadPages();
  }

  // ★ 先読みページ数の動的調整ルン
  adjustPreloadPages() {
    let averageTurnTime =
      this.pageLoadTimes.reduce((a, b) => a + b, 0) / this.pageLoadTimes.length;
    if (isNaN(averageTurnTime)) {
      averageTurnTime = 1000; // デフォルト値
      debugLog(
        "adjustPreloadPages() default averageTurnTime:" + averageTurnTime
      );
    } else {
      debugLog("adjustPreloadPages() averageTurnTime:" + averageTurnTime);
    }

    // ページめくり速度に基づいて調整ルン
    let plusPageCacheRate = 1;
    if (size === "FULL") {
      plusPageCacheRate = 2;
    }
    if (averageTurnTime < 1000) {
      this.size = 10 * plusPageCacheRate;
    } else if (averageTurnTime < 2000) {
      this.size = 6 * plusPageCacheRate;
    } else {
      this.size = 4 * plusPageCacheRate;
    }
    debugLog("Preloading read speed initial " + this.size + " pages");

    // ★ ネットワーク帯域に基づいて調整ルン
    if (this.networkSpeedKBps < 160) {
      this.size += 15;
    } else if (this.networkSpeedKBps < 320) {
      this.size += 10;
    } else if (this.networkSpeedKBps < 640) {
      this.size += 8;
    } else if (this.networkSpeedKBps < 2048) {
      this.size += 4;
    } else if (this.networkSpeedKBps < 4096) {
      this.size += 2;
    }
    debugLog(
      "Preloading adjust " +
        this.size +
        " pages. networkSpeedKBps:" +
        this.networkSpeedKBps
    );
    // ★ 平均ページサイズが大きい場合は先読み数を増やすルン！
    if (typeof averagePageKBytes !== "undefined" && averagePageKBytes >= 1000) {
      this.size = Math.floor(this.size * 1.5);
      debugLog(
        "Large page size detected! Increasing preload pages to " +
          this.size +
          " pages"
      );
    }

    // ★ メモリキャッシュの上限も先読み数に連動して調整するルン
    // 先読み数 + 過去閲覧分のバッファ（最低50、最大80）
    this.maxCacheEntries = Math.min(Math.max(this.size * 3, 50), 80);
  }
}

var preCaches = new PreCache(global_preload_pages);
var nextimage1 = new Image();
var nextimage2 = new Image();
// pageは回転で変えない読書位置、displayedStart/Endは実際の表示範囲ルン
var mode = 1;
var pageModePreference = "single";
var readerReady = false;
var readerProgressManager = null;
var readerNavigationPending = false;
var readerNavigationPromise = null;
var readerClosing = false;
var readerLayoutPending = false;
var readerRenderId = 0;
var displayedStart = 1;
var displayedEnd = 1;
var readerRenderPending = false;
var spreadLayoutPaired = false;
var quickSpreadTimer = null;
var quickSpreadGeneration = 0;
const pageShapeCache = new Map();
var indexName = ""; // 未使用?? コードには$indexが代入されてたけど見当たらない。削除漏れ?
var tapFlag = false;
var timer;
var fixPage = 0;
var startX, endX;
var startY, endY; // 親指上スワイプ用Y座標
var isSkipPageFwdFlag = false;
var unixtime = 0;
var timeout = null;
// ページ保存制御用の変数 ルン！
var lastSaveTime = 0; // 最後にsaveCurrentPage()を実行した時刻
var savePageTimer = null; // 5秒後保存用のタイマー
var readerMarkerManager = null;
// 拡張light wide split
var req;
var autoLightSplitMode = false; //false:縦長なのでそのまま true:横長を自動分割表示
var virtratio = 100; //表示の縦比率
var imagex = 0; //画像の横幅
var imagey = 0; //画像の縦幅
var cutrate = 1; // 自動分割時の横方向分割数ルン
var als = ""; // Auto Light Split Mode使ってるかのクエリパラメータ
var autoLightSplitModeViewPosition = "right"; // 横長画像のどっち側表示しているか
var xDown = null; // 2本指スワイプダウン検出用
var yDown = null; // 2本指スワイプダウン検出用
let globalDivImageUrl = "";
var isPinching = false; // ピンチ操作中フラグ
var originalViewportContent = ""; // To store the original viewport meta tag content
var viewportRelayoutTimer = null;
var viewportDiagnosticTimer = null;
var autoLightSplitLayoutRequestId = 0;
const VIEWPORT_RELAYOUT_DEBOUNCE_MS = 200;
// const isAndroid = /Android/i.test(navigator.userAgent);

function isZoomed() {
  // visualViewportが存在しない古いブラウザでは常にfalseを返す
  if (typeof window.visualViewport === "undefined") {
    return false;
  }
  // スケールが1より大きい場合にtrueを返す (誤差を考慮)
  return window.visualViewport.scale > 1.05;
}

function logViewportSnapshot(reason) {
  if (!window.DEBUG_ENABLED || !window.ComistreamViewport) {
    return;
  }

  const snapshot = window.ComistreamViewport.createViewportSnapshot(
    window,
    document.documentElement,
    navigator,
    window.screen
  );
  debugLog(
    "Viewport state [" + reason + "]: " + JSON.stringify(snapshot)
  );
}

function scheduleViewportDiagnostics(reason) {
  if (!window.DEBUG_ENABLED) {
    return;
  }

  if (viewportDiagnosticTimer !== null) {
    clearTimeout(viewportDiagnosticTimer);
  }
  viewportDiagnosticTimer = setTimeout(function () {
    viewportDiagnosticTimer = null;
    logViewportSnapshot(reason);
  }, VIEWPORT_RELAYOUT_DEBOUNCE_MS);
}

function scheduleReaderViewportRelayout(reason) {
  // 待機中でも要求番号を進め、古い画像計測を即座に無効化するルン
  const requestId = ++autoLightSplitLayoutRequestId;

  if (viewportRelayoutTimer !== null) {
    clearTimeout(viewportRelayoutTimer);
  }
  viewportRelayoutTimer = setTimeout(function () {
    viewportRelayoutTimer = null;
    logViewportSnapshot(reason);
    void updateReaderViewport(reason, requestId);
  }, VIEWPORT_RELAYOUT_DEBOUNCE_MS);
}

window.addEventListener("keydown", funcKey);
window.addEventListener("resize", function () {
  scheduleReaderViewportRelayout("window.resize");
});

if (
  navigator.devicePosture &&
  typeof navigator.devicePosture.addEventListener === "function"
) {
  navigator.devicePosture.addEventListener("change", function () {
    scheduleReaderViewportRelayout("devicePosture.change");
  });
}

if (
  window.screen &&
  window.screen.orientation &&
  typeof window.screen.orientation.addEventListener === "function"
) {
  window.screen.orientation.addEventListener("change", function () {
    scheduleReaderViewportRelayout("screen.orientation.change");
  });
}

if (
  window.visualViewport &&
  typeof window.visualViewport.addEventListener === "function"
) {
  // visual viewportの寸法は判定せず、診断とズーム保留解除に使うルン
  window.visualViewport.addEventListener("resize", function () {
    scheduleViewportDiagnostics("visualViewport.resize");
    if (readerLayoutPending && !isZoomed()) {
      scheduleReaderViewportRelayout("zoom.end");
    }
  });
}

document.addEventListener("focusout", function () {
  if (readerLayoutPending) scheduleReaderViewportRelayout("focusout");
});
window.addEventListener("touchend", function () {
  if (readerLayoutPending) scheduleReaderViewportRelayout("touchend");
});

// 全画面モードの変更を監視するイベントリスナー ルン！
// ESCキーでの解除にも対応できるルン！
document.addEventListener("fullscreenchange", updateFullScreenButton);
document.addEventListener("webkitfullscreenchange", updateFullScreenButton);
document.addEventListener("mozfullscreenchange", updateFullScreenButton);
document.addEventListener("MSFullscreenChange", updateFullScreenButton);

window.addEventListener(
  "load",
  function () {
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
      originalViewportContent = viewport.getAttribute("content");
    }

    setTimeout(scrollTo, 0, 0, 1);
  },
  false
);

window.addEventListener(
  "touchstart",
  function (evt) {
    if (document.getElementById("suggest")?.open) return;
    const touches = evt.touches;
    if (touches.length > 1) {
      isPinching = true;
      startX = -1;
      endX = -1;
      // 2本指スワイプの開始点を記録
      xDown = touches[0].clientX;
      yDown = touches[0].clientY;
      return;
    }

    // isPinching = false; // ここではリセットしない
    // 2本指スワイプ用の座標をリセット
    xDown = null;
    yDown = null;

    if (tapFlag) {
      evt.preventDefault();
    } else if (evt.changedTouches.length == 1) {
      startX = evt.touches[0].pageX;
      startY = evt.touches[0].pageY; // 親指上スワイプ用Y座標記録
      endX = -1;
      endY = -1;
    }
  },
  { passive: false }
);

window.addEventListener(
  "touchend",
  function (evt) {
    if (document.getElementById("suggest")?.open) return;
    if (isPinching) {
      if (evt.touches.length === 0) {
        isPinching = false;
      }
      // ピンチ操作の終了なので、ページめくりやタップの処理は行わない
      startX = -1;
      endX = -1;
      startY = -1;
      endY = -1;
      xDown = null;
      yDown = null;
      return;
    }

    if (startX != -1 && endX != -1 && startY != -1 && endY != -1) {
      let deltaX = startX - endX;
      let deltaY = startY - endY;

      // Android下端ナビゲーションスワイプ対策ルン！
      // 画面の下端から上方向のスワイプはナビゲーション操作の可能性があるので無視するルン☆
      const isAndroid = /Android/i.test(navigator.userAgent);
      const bottomEdgeThreshold = 50; // 下端から50px以内をナビゲーション領域とみなすルン
      const isBottomEdgeSwipe = startY > window.innerHeight - bottomEdgeThreshold;
      if (isAndroid && isBottomEdgeSwipe && deltaY > 0) {
        // Androidの下端から上方向のスワイプは何もしないルン！
        debugLog(
          "Android bottom edge swipe detected, ignoring: startY=" +
            startY +
            " threshold=" +
            (window.innerHeight - bottomEdgeThreshold)
        );
        return;
      }

      // 親指上スワイプ判定（画面下半分での上向きスワイプ）
      if (
        startY > window.innerHeight / 2 &&
        deltaY > 50 &&
        Math.abs(deltaX) < 30
      ) {
        // 画面下半分で開始し、上向きスワイプ（50px以上）かつ横移動が少ない（30px未満）
        debugLog(
          "Thumb up swipe detected: startY=" +
            startY +
            " deltaY=" +
            deltaY +
            " deltaX=" +
            deltaX
        );
        next(); // ページ送り
      } else if (deltaX < -50) {
        leftward();
      } else if (deltaX > 50) {
        rightward();
      }
    } else {
      tapFlag = true;
      clearTimeout(timer);
      timer = setTimeout(function () {
        tapFlag = false;

        // iOS/Androidでの長押し後のタッチ無反応修正
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        if (
          isMobile &&
          document.getElementById("modal").style.display !== "block"
        ) {
          // モーダルが表示されていなければ、タッチイベントを確実に有効化
          document.body.style.pointerEvents = "auto";
        }
      }, 350);
    }

    // タッチイベント終了時に値をリセット（バグ防止）
    if (document.getElementById("modal").style.display !== "block") {
      startX = -1;
      endX = -1;
      startY = -1;
      endY = -1;
    }
  },
  { passive: false }
);

window.addEventListener(
  "touchmove",
  function (evt) {
    if (document.getElementById("suggest")?.open) return;
    // isPinching中も2本指スワイプは判定したいので、条件を変更
    // if (isZoomed()) return; // 拡大中のスワイプを許可するためコメントアウト

    // 2本指スワイプの処理
    if (evt.touches.length >= 2 && xDown !== null && yDown !== null) {
      var xUp = evt.touches[0].clientX;
      var yUp = evt.touches[0].clientY;

      var xDiff = xDown - xUp;
      var yDiff = yDown - yUp;

      if (Math.abs(xDiff) < Math.abs(yDiff)) {
        // if (yDiff < -10) {
        //   // 下向きスワイプ
        //   /* 下向きスワイプ */
        //   showInspector();
        //   // 連続で発火しないようにリセット
        //   xDown = null;
        //   yDown = null;
        // }
      }
      return; // 2本指操作中は1本指の処理をしない
    }

    // ピンチ操作が始まっていたら1本指スワイプは無効
    if (isPinching) return;
    // 1本指スワイプの処理
    if (document.getElementById("contents").style.display == "block") {
      startX = -1;
      endX = -1;
      startY = -1;
      endY = -1;
    } else {
      endX = evt.touches[0].pageX;
      endY = evt.touches[0].pageY; // 親指上スワイプ用Y座標更新
    }
  },
  { passive: false }
);

window.addEventListener(
  "gesturechange",
  function (evt) {
    isPinching = true; // ジェスチャー中はピンチ操作とみなす
    startX = -1;
    endX = -1;
    startY = -1;
    endY = -1;
  },
  { passive: false }
);

window.addEventListener("pagehide", saveCurrentPage);

// 長押しでクイック見開きモード
// https://github.com/john-doherty/long-press-event
window.addEventListener("long-press", function (e) {
  if (isPinching || isZoomed()) return;
  // stop the event from bubbling up
  e.preventDefault();

  // モバイルデバイスで長押し後の無反応状態を防止
  // iOS/Androidでの長押し後の遅延問題対策
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  debugLog("long tap:" + e.target + " isMobile:" + isMobile);

  // クイック見開きモード表示
  quickSpredView();

  // モバイルデバイスの場合の追加対策
  if (isMobile) {
    // タッチイベントを強制的に解放するためのハック
    setTimeout(function () {
      const tempDiv = document.createElement("div");
      tempDiv.style.position = "absolute";
      tempDiv.style.width = "1px";
      tempDiv.style.height = "1px";
      tempDiv.style.opacity = "0";
      document.body.appendChild(tempDiv);
      setTimeout(function () {
        document.body.removeChild(tempDiv);
      }, 100);
    }, 50);
  }
});

// 2本指スワイプダウン検出用
// document.addEventListener("touchstart", handleTouchStart, false);
// document.addEventListener("touchmove", handleTouchMove, false);

// function handleTouchStart(evt) {
//   if (isPinching) return;
//   if (evt.touches.length == 2) {
//     xDown = evt.touches[0].clientX;
//     yDown = evt.touches[0].clientY;
//   } else {
//     xDown = null;
//     yDown = null;
//   }
// }

// function handleTouchMove(evt) {
//   if (isPinching) return;
//   if (!xDown || !yDown) {
//     return;
//   }

//   var xUp = evt.touches[0].clientX;
//   var yUp = evt.touches[0].clientY;

//   var xDiff = xDown - xUp;
//   var yDiff = yDown - yUp;

//   if (Math.abs(xDiff) < Math.abs(yDiff)) {
//     if (yDiff > 0) {
//       /* 上向きスワイプ */
//     } else {
//       /* 下向きスワイプ */
//       showInspector();
//     }
//   }
//   /* 値リセット */
//   xDown = null;
//   yDown = null;
// }

document.onmousemove = function () {
  // マウスを一定時間操作してない場合はカーソル非表示に
  clearTimeout(timeout);
  if (document.body.classList.contains("cursor-hide")) {
    document.body.classList.remove("cursor-hide");
    let elements = document.querySelectorAll("td.center");
    elements.forEach((element) => {
      element.style.cursor = `var(--setting-url), help`;
    });
    elements = document.querySelectorAll("td.right, td.right-under");
    elements.forEach((element) => {
      element.style.cursor = `var(--arrowR-url), e-resize`;
    });
    elements = document.querySelectorAll("td.left, td.left-under");
    elements.forEach((element) => {
      element.style.cursor = `var(--arrowL-url), w-resize`;
    });
    elements = document.querySelectorAll("td.rightIndex");
    elements.forEach((element) => {
      element.style.cursor = `var(--nextR-url), e-resize`;
    });
    elements = document.querySelectorAll("td.leftIndex");
    elements.forEach((element) => {
      element.style.cursor = `var(--nextL-url), w-resize`;
    });
    debugLog("cursor show");
  }
  timeout = setTimeout(function () {
    document.body.classList.add("cursor-hide");
    let elements = document.querySelectorAll(
      "td.center, td.right, td.right-under, td.left, td.left-under, td.rightIndex, td.leftIndex"
    );
    elements.forEach((element) => {
      element.style.cursor = "none";
    });
    debugLog("cursor-hide");
  }, 2000);
};

window.onclick = function (event) {
  // クイック見開きモード表示時に外側クリックしたら閉じて戻る
  var overlay = document.getElementById("overlay");
  var modal = document.getElementById("modal");
  if (event.target == overlay) {
    // 巻末パネル表示中はクイック見開きへ操作を渡さないルン。
    if (document.getElementById("suggest")?.open) return;
    closeQuickSpread();
  }
};

// 端末の回転を検知して横位置ならクイック見開きモードにする
window.addEventListener("orientationchange", () => {
  scheduleReaderViewportRelayout("window.orientationchange");

  if (!readerReady || pageModePreference === "auto") return;

  // 端末の傾きを絶対値で取得する
  var direction = Math.abs(window.orientation);
  if (direction == 90) {
    // 横向きの処理
    debugLog("direction Landscape");
    quickSpredView();
  } else {
    // 縦向きの処理
    debugLog("direction Portrait");
    quickSpredView();
  }
});

window.onfocus = function () {
  // ズームレベルをリセット
  document.body.style.zoom = 1;
};

// 以下関数定義

function resetZoom() {
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport && originalViewportContent) {
    // maximum-scale=1.0 を一瞬でも適用すると Android でピンチが永久無効になるバグ回避ルン
    // initial-scale のみを指定して強制再レイアウトし、その後元に戻すルン☆
    viewport.setAttribute("content", "width=device-width, initial-scale=1.0");

    // 位置をリセット
    window.scrollTo(0, 0);

    // 元の viewport 設定に戻す（短い遅延を入れてレイアウトを安定させる）
    setTimeout(() => {
      viewport.setAttribute("content", originalViewportContent);
      if (readerLayoutPending) scheduleReaderViewportRelayout("resetZoom");
    }, 50);
  }
}

function saveCurrentPage() {
  if (readerProgressManager) {
    return readerProgressManager.beacon();
  }
  // ページ離脱時に最終ページ保存
  // タイマーが残っていたらクリアするルン！
  if (savePageTimer) {
    clearTimeout(savePageTimer);
    savePageTimer = null;
  }

  if (!readerReady) return;
  const localPage = page;
  if (page >= maxPage) {
    document.cookie = "lastCloseFile=" + baseFile + "; path=/;";
  } else {
    document.cookie = "lastCloseFile=; path=/; max-age=0";
  }
  debugLog("saveCurrentPage(); current page:" + page);
  let data = new FormData();
  data.append("mode", "close");
  data.append("file", escapedFile);
  data.append("page", localPage);
  readerProgressManager ? readerProgressManager.beacon() : navigator.sendBeacon("comistream.php", data);
}

function jump() {
  nextpage = window.prompt("移動するページを入力 (1-" + maxPage + ")", page);
  if (nextpage.match(/^[0-9]+\$/) && nextpage > 0 && nextpage <= maxPage) {
    page = nextpage;
    loadPage(1);
  }
}

function leftward() {
  if (isZoomed()) {
    resetZoom();
  }
  if (direction == "left") next();
  else back();
}

function rightward() {
  if (isZoomed()) {
    resetZoom();
  }
  if (direction == "left") back();
  else next();
}

function leftIndex() {
  if (direction == "left") nextIndex();
  else backIndex();
}

function rightIndex() {
  if (direction == "left") backIndex();
  else nextIndex();
}

let suggestRestoreFocus = null;
let suggestPanelAnimation = null;

function showSuggestPanel() {
  const panel = document.getElementById("suggest");
  if (!panel || panel.open) return;
  suggestRestoreFocus = document.activeElement;
  closeQuickSpread();
  const contents = document.getElementById("contents");
  if (contents) contents.style.display = "none";
  if (!panel.dataset.suggestBound) {
    panel.dataset.suggestBound = "1";
    let backdropPressed = false;
    const outside = (event) => {
      const rect = panel.getBoundingClientRect();
      return event.clientX < rect.left || event.clientX > rect.right
        || event.clientY < rect.top || event.clientY > rect.bottom;
    };
    panel.addEventListener("pointerdown", (event) => {
      backdropPressed = event.target === panel && outside(event);
    });
    panel.addEventListener("pointercancel", () => { backdropPressed = false; });
    panel.addEventListener("cancel", (event) => {
      event.preventDefault();
      hideSuggestPanel();
    });
    panel.addEventListener("click", (event) => {
      if (backdropPressed && event.target === panel && outside(event)) hideSuggestPanel();
      backdropPressed = false;
    });
    panel.addEventListener("close", () => {
      if (panel.open) return;
      suggestPanelAnimation?.cancel();
      if (suggestRestoreFocus?.isConnected && !suggestRestoreFocus.disabled
        && suggestRestoreFocus.getClientRects().length) {
        suggestRestoreFocus.focus({ preventScroll: true });
      }
    });
  }
  panel.showModal();
  document.getElementById("suggest-return")?.focus({ preventScroll: true });
  // EPUBと同じ演出を使い、本文復帰と一覧への終了は表示直後から操作できるルン。
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    suggestPanelAnimation = panel.animate([
      { opacity: 0, transform: "scale(0.85)" },
      { opacity: 1, transform: "scale(1)" },
    ], { duration: 280, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
  }
}

function hideSuggestPanel() {
  const panel = document.getElementById("suggest");
  if (!panel?.open) return;
  suggestPanelAnimation?.cancel();
  panel.close();
}

async function next() {
  if (document.getElementById("suggest")?.open) return;
  if (readerRenderPending) return;
  const imageElement = document.getElementById("image");
  if (
    window.ComistreamViewport.shouldPanAutoLightSplit({
      mode,
      autoLightSplitMode,
      currentPosition: imageElement.style.backgroundPosition,
      expectedPosition: "right",
    })
  ) {
    imageElement.style.backgroundPosition = "left";
    autoLightSplitModeViewPosition = "left";
  } else {
    if (displayedEnd < maxPage) {
      page = displayedEnd + 1;
      loadPage(1);
      window.scroll({ top: 0, behavior: "smooth" });
      if (autoLightSplitMode == true) {
        document.getElementById("image").style.backgroundPosition = "right";
        autoLightSplitModeViewPosition = "right";
      }
    } else {
      // 最終ページに到達した場合の処理
      debugLog(
        "next(); current page:" +
          page +
          " max page:" +
          maxPage +
          " mode:" +
          mode
      );
      // 最終ページ到達時は即座にページ位置を保存するルン！
      if (savePageTimer) {
        clearTimeout(savePageTimer);
        savePageTimer = null;
      }
      if (readerProgressManager) {
        if (!(await readerProgressManager.beforeNavigation())) return;
        readerProgressManager.record(String(maxPage), { completed: true, immediate: true });
      }
      saveCurrentPage();
      lastSaveTime = Date.now();
      debugLog("saveCurrentPage() executed on reaching last page");

      // カーテンコールアニメーションでサジェストパネルを表示するルン！
      showSuggestPanel();
    }
  }
}

function back() {
  if (document.getElementById("suggest")?.open) return;
  if (readerRenderPending) return;
  const imageElement = document.getElementById("image");
  if (
    window.ComistreamViewport.shouldPanAutoLightSplit({
      mode,
      autoLightSplitMode,
      currentPosition: imageElement.style.backgroundPosition,
      expectedPosition: "left",
    })
  ) {
    imageElement.style.backgroundPosition = "right";
    autoLightSplitModeViewPosition = "right";
  } else {
    if (displayedStart > 1) {
      page = displayedStart - 1;
      loadPage(-1);
      if (autoLightSplitMode == true) {
        document.getElementById("image").style.backgroundPosition = "left";
        autoLightSplitModeViewPosition = "left";
      }
    } else {
      debugLog(
        "back(); current page:" +
          page +
          " max page:" +
          maxPage +
          " mode:" +
          mode
      );
      if (window.confirm("最終ページです。リーダーを閉じますか？")) {
        backListPage();
      }
    }
  }
}

async function nextIndex() {
  if (document.getElementById("suggest")?.open) return;
  if (readerRenderPending) return false;
  const jumpStops = getChapterJumpStops();
  const pageStopFinder = window.ComistreamReaderMarkers?.findAdjacentPageStop;
  const targetPage =
    typeof pageStopFinder === "function"
      ? pageStopFinder(jumpStops, displayedStart, displayedEnd - displayedStart + 1, false)
      : jumpStops.find((stop) => displayedEnd < stop);
  if (targetPage !== null && typeof targetPage !== "undefined") {
    page = targetPage;
    loadPage(1);
    return true;
  }
  // 次のインデックスが見つからない場合の終端処理ルン
  if (page >= maxPage) {
    // 既に最終ページにいる場合はsuggestパネルを表示するルン
    if (savePageTimer) {
      clearTimeout(savePageTimer);
      savePageTimer = null;
    }
    if (readerProgressManager) {
      if (!(await readerProgressManager.beforeNavigation())) return false;
      readerProgressManager.record(String(maxPage), { completed: true, immediate: true });
    }
    saveCurrentPage();
    lastSaveTime = Date.now();
    debugLog("nextIndex() reached end at maxPage, showing suggest");
    showSuggestPanel();
  } else {
    // 最終ページへ移動するルン
    page = maxPage;
    loadPage(1);
    debugLog("nextIndex() no more index, jumped to maxPage:" + maxPage);
  }
}

function backIndex() {
  if (document.getElementById("suggest")?.open) return;
  if (readerRenderPending) return false;
  const jumpStops = getChapterJumpStops();
  const pageStopFinder = window.ComistreamReaderMarkers?.findAdjacentPageStop;
  const targetPage =
    typeof pageStopFinder === "function"
      ? pageStopFinder(jumpStops, displayedStart, displayedEnd - displayedStart + 1, true)
      : jumpStops
          .slice()
          .reverse()
          .find((stop) => displayedStart > stop);
  if (targetPage !== null && typeof targetPage !== "undefined") {
    page = targetPage;
    loadPage(1);
    return true;
  }
}

function getChapterJumpStops() {
  const markerHelpers = window.ComistreamReaderMarkers;
  if (typeof markerHelpers?.mergePageJumpStops !== "function") {
    return indexArray;
  }
  return markerHelpers.mergePageJumpStops(
    indexArray,
    readerMarkerManager?.markers,
    maxPage
  );
}

async function devicePageSync() {
  if (readerProgressManager) return readerProgressManager.beforeNavigation();
  //別デバイスでのページが読み進んでないかページ番号を返す
  debugLog(
    "devicePageSync() current page:" +
      page +
      " max page:" +
      maxPage +
      " isSkipPageFwdFlag:" +
      isSkipPageFwdFlag
  );
  if (page > 0 && !isSkipPageFwdFlag) {
    try {
      const response = await fetch(
        "comistream.php?mode=currentPage&file=" + escapedFile
      );
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      let restxt = await response.text();
      let res = await parseInt(restxt);
      debugLog("devicePageSync() restxt:" + restxt);
      debugLog("devicePageSync() res:" + res);
      if (res > page && res > 1) {
        debugLog(
          "devicePageSync() res:" +
            parseInt(res) +
            " larger page:" +
            parseInt(page)
        );
        if (
          window.confirm(
            "別デバイスで" +
              parseInt(res) +
              "ページまで読み進んでいます。移動しますか？"
          )
        ) {
          page = res;
          debugLog("devicePageSync() Jump to " + parseInt(page));
          loadPage(1);
        } else {
          debugLog("devicePageSync() Jump canceled ");
          isSkipPageFwdFlag = true;
        }
      }
    } catch (error) {
      console.error(`Could not get products: ${error}`);
    }
  }
}

async function loadPage(dir, { restore = false } = {}) {
  if (readerClosing && !restore) { page = prevPage; return; }
  const targetPage = Math.max(1, Math.min(maxPage, parseInt(page, 10) || 1));
  if (readerProgressManager && !restore) {
    if (readerNavigationPending) { page = prevPage; return; }
    readerNavigationPending = true;
    page = prevPage;
    readerNavigationPromise = (async () => {
      if (!(await readerProgressManager.beforeNavigation())) return;
      page = targetPage;
      await loadPage(dir, { restore: true });
      const completed = !readerProgressManager.getState()?.has_read && dir >= 0 && displayedEnd >= maxPage;
      const locator = completed ? maxPage : page;
      readerProgressManager.record(String(locator), { completed, page: locator });
    })();
    try {
      await readerNavigationPromise;
      return;
    } finally { readerNavigationPending = false; readerNavigationPromise = null; }
  }
  closeQuickSpread();
  page = Math.max(1, Math.min(maxPage, parseInt(page, 10) || 1));
  autoLightSplitModeViewPosition = dir < 0 ? "left" : "right";
  debugLog("current page:" + page + " max page:" + maxPage);
  if (page == 1 || mode == 2) {
    // 表紙と見開きでは自動分割を引き継がないルン
    autoLightSplitMode = false;
  }

  if (!readerProgressManager) {
    // 既存の保存タイマーをクリアするルン！
    if (savePageTimer) {
      clearTimeout(savePageTimer);
      savePageTimer = null;
    }

    // 現在ページを保存（戻る操作、大きなページ後退、5秒以上経過時は即座に保存するルン！）
    const now = Date.now();
    const isLargeBackwardJump = prevPage - page > 3; // 3ページ以上戻った場合（最終ページ→先頭など）
    if (dir < 0 || isLargeBackwardJump) {
      // ページを戻る操作、または大きなページ後退は即座に保存するルン！
      // これでdevicePageSync()での誤判定を防ぐルン☆
      saveCurrentPage();
      lastSaveTime = now;
      debugLog(
        "saveCurrentPage() executed immediately (backward/large jump back)"
      );
    } else if (now - lastSaveTime >= 5000) {
      // 5秒以上経過していたら即座に保存するルン！
      saveCurrentPage();
      lastSaveTime = now;
      debugLog("saveCurrentPage() executed immediately (>5sec)");
    } else {
      // 5秒以内の前進はスキップして、タイマーで後で保存するルン！
      debugLog("saveCurrentPage() skipped (<5sec), will save after 5sec");
    }

    // 5秒そのページに留まったら保存するタイマーを設定するルン！
    savePageTimer = setTimeout(() => {
      saveCurrentPage();
      lastSaveTime = Date.now();
      savePageTimer = null;
      debugLog("saveCurrentPage() executed by timer (stayed 5sec)");
    }, 5000);
  }
  writeReaderStorage(file, String(page));
  preCaches.recordPageTurn();
  if (Math.abs(prevPage - page) > 3) {
    const preloadPage = page;
    setTimeout(() => preLoadInitialImages(preloadPage), global_preload_delay_ms);
  }
  prevPage = page;
  await renderReaderPage(restore ? "restore" : "navigation");
}

function readReaderStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function writeReaderStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    debugLog("Reader settings could not be saved");
  }
}

function resolveReaderMode() {
  const viewport = window.ComistreamViewport.getLayoutViewportSize(
    window, document.documentElement
  );
  return window.ComistreamViewport.resolvePageMode(pageModePreference, viewport, mode);
}

function updatePageModeButton() {
  const button = document.getElementById("pageMode");
  button.className = "button button-mode " + (mode === 2 ? "spread" : "single");
  const showSpread = pageModePreference === "auto" ? spreadLayoutPaired : mode === 2;
  const actual = showSpread ? window.i18n.toc_button_spread : window.i18n.toc_button_single;
  button.textContent = pageModePreference === "auto"
    ? window.i18n.toc_button_auto + " · " + actual : actual;
  const tooltip = pageModePreference === "auto"
    ? window.i18n.tooltip_auto_page
    : button.getAttribute(mode === 2 ? "data-tooltip-spread" : "data-tooltip-single");
  button.setAttribute("data-tooltip", tooltip);
  button.setAttribute("aria-label", button.textContent + ": " + tooltip);
}

function readerInteractionBlocksLayout() {
  const active = document.activeElement;
  const textInput = active && active.tagName === "INPUT" &&
    /^(text|search|email|number|tel|url|password)$/.test(active.type);
  return isPinching || isZoomed() || (active &&
    (active.isContentEditable || active.tagName === "TEXTAREA" || textInput));
}

async function updateReaderViewport(reason, requestId) {
  if (!readerReady || readerInteractionBlocksLayout()) {
    readerLayoutPending = true;
    return;
  }
  readerLayoutPending = false;
  const resolved = resolveReaderMode();
  if (resolved !== mode) {
    closeQuickSpread();
    mode = resolved;
    await renderReaderPage(reason);
  } else {
    await refreshAutoLightSplitLayout(reason, requestId);
  }
}

async function isWideReaderPage(number) {
  if (number < 1 || number > maxPage) return false;
  const url = getFullImageUrl(number, false);
  if (pageShapeCache.has(url)) return pageShapeCache.get(url);
  const image = await load_image(url);
  if (!image) return null;
  const wide = image.width >= image.height;
  // 画像本体を保持せず、寸法判定だけを上限付きで保存するルン
  pageShapeCache.set(url, wide);
  if (pageShapeCache.size > 256) pageShapeCache.delete(pageShapeCache.keys().next().value);
  return wide;
}

async function renderReaderPage(reason) {
  const renderId = ++readerRenderId;
  ++autoLightSplitLayoutRequestId;
  readerRenderPending = true;
  const target = page;
  const targetMode = mode;
  autoLightSplitMode = false;
  als = "";
  let layout = { start: target, end: target, paired: false };
  try {
    if (targetMode === 2) {
      const start = window.ComistreamViewport.spreadStart(target, fixPage);
      const shapes = await Promise.all([isWideReaderPage(start), isWideReaderPage(start + 1)]);
      layout = window.ComistreamViewport.resolveSpreadLayout(target, fixPage, shapes);
    }
    if (renderId !== readerRenderId || target !== page || targetMode !== mode) return;
    displayedStart = Math.max(1, layout.start);
    displayedEnd = Math.min(maxPage, layout.end);
    spreadLayoutPaired = layout.paired;
    autoLightSplitMode = false;
    als = "";
    const first = document.getElementById("image");
    const second = document.getElementById("nextimage");
    first.style.width = layout.paired ? "50%" : "100%";
    first.style.backgroundPosition = layout.paired ? direction : "center";
    first.style.float = layout.paired ? position : "none";
    first.style.marginLeft = "0px";
    first.style.height = "100%";
    first.style.backgroundSize = "contain";
    second.style.display = layout.paired ? "block" : "none";
    second.style.backgroundPosition = position;
    second.style.float = direction;
    first.style.backgroundImage = layout.start > 0
      ? "url('" + getFullImageUrl(layout.start) + "')" : "none";
    second.style.backgroundImage = layout.paired && layout.end <= maxPage
      ? "url('" + getFullImageUrl(layout.end) + "')" : "none";
    globalDivImageUrl = getFullImageUrl(target);
    updatePageModeButton();
    if (document.getElementById("contents").style.display === "block") setSlider();
    document.getElementById("progress").style.width = (page / maxPage) * 100 + "%";
    await refreshAutoLightSplitLayout(reason);
    if (renderId !== readerRenderId) return;
    if (reason === "navigation") {
      preLoadImages(displayedEnd + 1);
      preLoadImages(displayedEnd + 2);
      preLoadImages(displayedEnd + preCaches.getSize());
    }
  } finally {
    if (renderId === readerRenderId) {
      readerRenderPending = false;
      document.getElementById("loading").style.display = "none";
      // 読書を続けている間も、表示中の診断値を更新するルン。
      if (imageInspectorUI?.isOpen()) showInspector(true);
    }
  }
}

// 分割モード時の先読み処理
function preLoadImages(nextpage) {
  //let nextpage = dir*mode+page;
  if (nextpage > 0 && nextpage <= maxPage) {
    let nextImageUrl =
      pageGenerator +
      "?file=" +
      file +
      "&size=" +
      size +
      "&page=" +
      nextpage +
      view_query +
      als;
    // preCaches.recordPageTurn();
    debugLog("preLoadImages() add:" + nextpage);
    // console.trace('スタックトレースを表示');
    preCaches.add(nextImageUrl);
    // preCaches.measureNetworkSpeed();
  }
}

// 初期ロード時の先読み処理
async function preLoadInitialImages(startPage) {
  for (let i = 1; i <= preCaches.getSize(); i++) {
    let nextpage = startPage + i;
    if (nextpage > 0 && nextpage <= maxPage) {
      let nextImageUrl =
        pageGenerator +
        "?file=" +
        file +
        "&size=" +
        size +
        "&page=" +
        nextpage +
        view_query +
        als;
      debugLog("preLoadInitialImages() add:" + nextpage);
      await preCaches.add(nextImageUrl);
    }
  }
}

async function browserCanDecodeJpegXlPage(pageNumber) {
  const probeImage = new Image();
  return new Promise((resolve) => {
    probeImage.onload = () => {
      resolve(probeImage.naturalWidth > 0 && probeImage.naturalHeight > 0);
    };
    probeImage.onerror = () => {
      resolve(false);
    };
    probeImage.src = getFullImageUrl(pageNumber);
  });
}

async function ensureJpegXlSupport() {
  if (!jpegXlProbePage) {
    return true;
  }

  if (await browserCanDecodeJpegXlPage(jpegXlProbePage)) {
    return true;
  }

  alert("ブラウザで未対応の画像フォーマットです:JPEG XL");
  window.history.back();
  return false;
}

async function restorePage() {
  if (!(await ensureJpegXlSupport())) {
    return;
  }

  if (window.ComistreamReaderProgress && window.readerProgressConfig) {
    const config = window.readerProgressConfig;
    readerProgressManager = window.ComistreamReaderProgress.create({
      ...config, file: escapedFile, csrfToken: readerMarkerConfig.csrfToken,
      totalUnits: maxPage, legacyLocator: readReaderStorage(file),
      compare: (a, b) => Math.sign(Number(a) - Number(b)),
      getPosition: () => String(prevPage), isStart: (locator) => locator === "1",
      confirm: (state) => window.confirm((window.i18n.reader_sync_changed ||
        "Reading position changed to page %s on another device. Move there?").replace("%s", state.locator)),
      moveTo: async (locator) => { page = Number(locator); await loadPage(1, { restore: true }); },
      onError: (error) => debugLog("Reading position synchronization failed: " + error.message),
      onUnsynced: () => window.alert(window.i18n.reader_sync_unsaved || "Reading position is pending synchronization."),
    });
    await readerProgressManager.initialize();
    const restoreLocator = readerProgressManager.getRestoreLocator();
    if (restoreLocator) page = Number(restoreLocator);
    readerProgressManager.bindLifecycle();
  } else if (page == 1) {
    page = parseInt(readReaderStorage(file) || page, 10);
  }
  pageModePreference = window.ComistreamViewport.restorePageModePreference(
    readReaderStorage("readerPageModePreference"), readReaderStorage("pagemode")
  );
  mode = resolveReaderMode();
  writeReaderStorage("readerPageModePreference", pageModePreference);
  readerReady = true;
  readerLayoutPending = false;
  await loadPage(1, { restore: true });
  if (readerProgressManager?.getPending()) await readerProgressManager.beforeNavigation();
  if (window.readerProgressConfig?.requestedPage) {
    page = window.readerProgressConfig.requestedPage;
    await loadPage(1);
  }
  if (indexName != "") {
    Array.prototype.forEach.call(
      document.getElementsByClassName("toclink"),
      function (elm) {
        if (elm.innerHTML.indexOf(indexName) != -1) {
          elm.onclick();
        }
      }
    );
  }

  // 初期ロード時に先読みを実行
  setTimeout(() => {
    preLoadInitialImages(page);
  }, global_preload_delay_ms);

  // ネットワーク速度測定
  //debugLog("precaches.measureNetworkSpeed()");
  //preCaches.measureNetworkSpeed();
  //debugLog("precaches.measureNetworkSpeed() done");

  // 最終ページでの次の巻情報取得
  sugguestbook();

  // 大きなページサイズの通知をチェック
  checkAndShowLargePageNotification();

  // 全画面ボタンの初期状態を設定するルン！
  updateFullScreenButton();

  // ツールチップの初期状態を設定するルン！
  updateModeTooltips();

  initializeImageReaderMarkers();
}

function initializeImageReaderMarkers() {
  if (readerMarkerManager || !window.ComistreamReaderMarkers) return;

  readerMarkerManager = window.ComistreamReaderMarkers.create({
    file: escapedFile,
    baseFile: baseFile,
    format: readerMarkerConfig.format,
    isGuest: readerMarkerConfig.isGuest,
    csrfToken: readerMarkerConfig.csrfToken,
    i18n: window.i18n,
    addButtonId: "image-marker-add",
    statusId: "image-marker-status",
    listId: "image-marker-list",
    sliderId: "slider",
    railId: "image-marker-rail",
    isRtl: function () {
      return direction === "left";
    },
    getCurrentMarker: function () {
      const currentPage = Math.min(maxPage, Math.max(1, parseInt(page, 10) || 1));
      return {
        format: readerMarkerConfig.format,
        locatorType: "page",
        locator: String(currentPage),
        pageNumber: currentPage,
        sectionIndex: null,
        progressFraction: maxPage > 1 ? (currentPage - 1) / (maxPage - 1) : 0,
        chapterLabel: null,
      };
    },
    navigate: function (marker) {
      return navigateToTocPage(marker.pageNumber || marker.locator);
    },
    formatPosition: function (marker) {
      return window.i18n.reader_marker_page.replace("%s", marker.pageNumber);
    },
  });
  void readerMarkerManager.init();
}

function navigateToTocPage(targetPage) {
  const normalizedPage = parseInt(targetPage, 10);
  if (
    !Number.isInteger(normalizedPage) ||
    normalizedPage < 1 ||
    normalizedPage > maxPage
  ) {
    return false;
  }
  page = normalizedPage;
  loadPage(1);
  return true;
}

function index() {
  if (document.getElementById("contents").style.display == "block") {
    document.getElementById("contents").style.display = "none";
  } else {
    document.getElementById("contents").style.display = "block";
    setSlider();
    void readerMarkerManager?.refresh();

    var slider = document.querySelector('input[type="range"]');
    slider.addEventListener(
      "input",
      function () {
        valueChange();
      },
      false
    );

    slider.addEventListener(
      "change",
      function () {
        valueChange();
        page = parseInt(document.getElementById("slider").value);
        document.getElementById("loading").style.display = "block";
        loadPage(1);
      },
      false
    );
  }
}

function setSlider() {
  document.getElementById("slider").value = page;
  valueChange();
}

function valueChange() {
  document.getElementById("value").innerHTML =
    document.getElementById("slider").value;
}

function selectPageMode(preference) {
  pageModePreference = preference;
  mode = resolveReaderMode();
  writeReaderStorage("readerPageModePreference", preference);
  writeReaderStorage("pagemode", String(mode));
  closeQuickSpread();
  void renderReaderPage("preference");
}

function togglePageMode() {
  const choices = ["single", "spread", "auto"];
  selectPageMode(choices[(choices.indexOf(pageModePreference) + 1) % choices.length]);
}

function single() {
  selectPageMode("single");
}

function spread() {
  selectPageMode("spread");
}

async function backListPage() {
  if (readerClosing) return;
  readerClosing = true;
  try {
    // 戻ったページの描画と位置登録が完了してから終了保存するルン。
    if (readerNavigationPromise) await readerNavigationPromise;
    if (readerProgressManager) await readerProgressManager.finish();
    // リーダーを閉じる前に確実にページ位置を保存するルン！
    if (savePageTimer) {
      clearTimeout(savePageTimer);
      savePageTimer = null;
    }
    saveCurrentPage();
    lastSaveTime = Date.now();
    debugLog("saveCurrentPage() executed before closing reader");

    if (document.cancelFullScreen) {
      document.cancelFullScreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    } else if (document.webkitCancelFullScreen) {
      document.webkitCancelFullScreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }

    if (window.history.length > 1) {
      window.history.back();
    } else {
      location.href = document.referrer;
    }
  } finally {
    readerClosing = false;
  }
}

function fixSpreadPage() {
  fixPage = 1 - fixPage;
  void renderReaderPage("spreadCorrection");
}

// 全画面表示の状態をボタンに反映する関数ルン！
function updateFullScreenButton() {
  const fullScreenButton = document.getElementById("fullScreenButton");
  const isFullscreen =
    document.fullscreenElement ||
    document.mozFullScreenElement ||
    document.webkitFullscreenElement ||
    document.msFullscreenElement;

  if (isFullscreen) {
    // 全画面モード時は「全画面」を表示するルン！（現在のモード表示）
    fullScreenButton.textContent = window.i18n.toc_button_fullscreen;
  } else {
    // 窓表示時は「窓表示」を表示するルン！（現在のモード表示）
    fullScreenButton.textContent = window.i18n.toc_button_windowed;
  }
}

function toggleFullScreen() {
  if (
    document.fullscreenElement ||
    document.mozFullScreenElement ||
    document.webkitFullscreenElement ||
    document.msFullscreenElement
  ) {
    // 全画面を解除するルン！
    if (document.cancelFullScreen) {
      document.cancelFullScreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    } else if (document.webkitCancelFullScreen) {
      document.webkitCancelFullScreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
  } else {
    // 全画面にするルン！
    if (document.documentElement.webkitRequestFullscreen) {
      document.documentElement.webkitRequestFullscreen();
    } else if (document.documentElement.mozRequestFullScreen) {
      document.documentElement.mozRequestFullScreen();
    } else if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen();
    } else if (document.documentElement.msRequestFullscreen) {
      document.documentElement.msRequestFullscreen();
    } else {
      alert(window.i18n.fullscreen_not_supported || "フルスクリーン非対応");
    }
  }
  // ボタンの状態は fullscreenchange イベントで更新されるルン！
}

function toggleDirection() {
  // 綴じ方向の切り替え ルン！現在のモードを表示するように変更するルン！
  if (direction == "left") {
    // 右綴じ → 左綴じに切り替え
    direction = "right";
    position = "left";
    document.getElementById("progress").className = "progress-right";
    document.getElementById("slider").style.transform = "rotateY(0deg)";
    document.getElementById("direction").className =
      "button left-to-right button-mode";
    document.getElementById("direction").textContent =
      window.i18n.toc_button_direction_left;
  } else {
    // 左綴じ → 右綴じに切り替え
    direction = "left";
    position = "right";
    document.getElementById("progress").className = "progress-left";
    document.getElementById("slider").style.transform = "rotateY(180deg)";
    document.getElementById("direction").className =
      "button right-to-left button-mode";
    document.getElementById("direction").textContent =
      window.i18n.toc_button_direction_right;
  }
  void renderReaderPage("direction");
  readerMarkerManager?.renderRail();
}

function funcKey(evt) {
  // 設定ボタンのSpace/Enterで読書操作を重ねて実行しないルン。
  if (['Space', 'Enter'].includes(evt.code) || evt.keyCode === 32 || evt.keyCode === 13) {
    if (evt.target?.closest?.('.contents button')) return;
  }
  if (document.getElementById("suggest")?.open) return;
  if (evt.defaultPrevented || imageInspectorUI?.handleKeydown(evt)) return;
  if (isZoomed()) return; // 拡大表示中はキー操作によるページめくり等を無効化

  // 【ショートカット一覧】
  // ← + Shift : 次の章へ
  // ← + Control : 最終ページへ
  // ← : 次のページへ
  // → + Shift : 前の章へ
  // → + Control : 最初のページへ
  // → : 前のページへ
  // ESC : メニュー表示
  // 1 : 単ページ表示モード
  // 2 : 見開き表示モード
  // BackSpace or Delete : 閉じる
  // > : 最初のページへ
  // < : 最終ページへ
  // ↓ : 次のページへ
  // ↑ : 前のページへ
  // Space : クイック見開き表示トグル
  // 長押し : クイック見開き表示
  // iPad回転 : クイック見開き表示
  // i : インスペクター表示トグル

  debugLog("funcKey(); key event:" + evt.code);
  if (evt.code == "Space" || evt.keyCode === 32) {
    // クイック見開きモード表示
    quickSpredView();
  } else if (evt.code == "KeyI") {
    // インスペクター表示
    showInspector();
  } else {
    closeQuickSpread();
  }
  if (evt.code == "ArrowLeft" && evt.shiftKey) leftIndex();
  else if (evt.code == "ArrowLeft" && evt.ctrlKey) {
    page = maxPage;
    loadPage(1);
  } else if (evt.code == "ArrowLeft") leftward();
  if (evt.code == "ArrowRight" && evt.shiftKey) rightIndex();
  else if (evt.code == "ArrowRight" && evt.ctrlKey) {
    page = 1;
    loadPage(1);
  } else if (evt.code == "ArrowRight") rightward();
  if (evt.code == "Escape") index();
  if (evt.key == "1" || evt.code == "Digit1" || evt.code == "Numpad1") single();
  if (evt.key == "2" || evt.code == "Digit2" || evt.code == "Numpad2") spread();
  if (evt.code == "Backspace" || evt.code == "Delete") backListPage();
  if (evt.code == "Period" || evt.keyCode === 190) {
    page = 1;
    loadPage(1);
  } // >
  if (evt.code == "Comma" || evt.keyCode === 188) {
    page = maxPage;
    loadPage(1);
  } // <
  if (evt.code == "ArrowDown") leftward();
  if (evt.code == "ArrowUp") rightward();
}

function toggleRaw() {
  // 再読込前はラベルと装飾クラスを保ち、押した瞬間の寸法変化を防ぐルン。
  // 圧縮有無の切り替え ルン！現在のモードを表示するように変更するルン！
  let data = new FormData();
  data.append("mode", "close");
  data.append("file", escapedFile);
  data.append("page", page);
  readerProgressManager ? readerProgressManager.beacon() : navigator.sendBeacon("comistream.php", data);

  // URLからsizeパラメータを削除してCookie設定を優先させるルン！
  // URLオブジェクトを使うとエンコーディングが変わるので正規表現で削除するルン
  let reload_url = location.href
    .replace(/([?&])size=[^&]*(&|$)/g, function (match, p1, p2) {
      // &size=xxx& → & or ?size=xxx& → ?
      // &size=xxx(末尾) → 空 or ?size=xxx(末尾) → ?のまま（後で処理）
      if (p1 === "?" && p2 === "&") return "?";
      if (p1 === "&") return p2 === "&" ? "&" : "";
      return p1;
    })
    .replace(/\?$/, ""); // 末尾の?を削除

  if (document.getElementById("rawMode").classList.contains("raw")) {
    document.cookie = "rawMode=cmp; path=/; max-age=31536000";
    debugLog("toggleRaw() size toggle to cmp, reload_url:" + reload_url);
    location.replace(reload_url);
  } else {
    document.cookie = "rawMode=raw; path=/; max-age=31536000";
    debugLog("toggleRaw() size toggle to raw, reload_url:" + reload_url);
    location.replace(reload_url);
  }
}

function toggleTrimmingFile() {
  // 表示の切り替えは遷移先に任せ、現在のボタン寸法を保つルン。
  // サーバー側で左右余白トリミングするモード（旧:見開きサイズ画像ファイルの左右分割表示モード） ルン！
  let data = new FormData();
  data.append("mode", "close");
  data.append("file", escapedFile);
  data.append("page", page);
  if (document.getElementById("splitFile").classList.contains("normal")) {
    // 左右余白トリミングモードへ
    // page = page*2;
    readerProgressManager ? readerProgressManager.beacon() : navigator.sendBeacon("comistream.php", data);
    // console.log("toggleTrimmingFile() normal to split");
    let reload_url = location.href + "&view=trimming";
    // (reload_url);
    location.replace(reload_url);
  } else {
    // 通常表示モードへ
    // page = Math.floor((page+1)/2);
    readerProgressManager ? readerProgressManager.beacon() : navigator.sendBeacon("comistream.php", data);
    // console.log("toggleTrimmingFile() split to normal");
    let reload_url = location.href.replace("&view=trimming", "");
    // console.log(reload_url);
    location.replace(reload_url);
  }
}

//読み終えたときに続刊、関連書籍を表示するためのデータを取得
async function sugguestbook() {
  const title = document.getElementById("suggest-book-title");
  if (title) title.textContent = baseFile;
  const books = document.getElementById("suggest-books");
  if (!books) return;
  try {
    const response = await fetch(`/suggest.php?booktitle=${encodeURIComponent(baseFile)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    books.replaceChildren();
    books.hidden = true;
    for (const group of [data?.title?.new, data?.title?.old, data?.author]) {
      if (!group || typeof group !== "object" || Array.isArray(group)) continue;
      for (const [title, path] of Object.entries(group)) {
        if (typeof path === "string") addnextbooklist(title, path);
      }
    }
  } catch (error) {
    // 拡張がない場合もEPUBと同じ巻末UIを維持するルン。
    debugLog("Related books unavailable: " + error.message);
  }
}

//続刊へ移動
async function toNextBook(nextlocation) {
  if (readerClosing) return;
  readerClosing = true;
  try {
    if (readerNavigationPromise) await readerNavigationPromise;
    if (readerProgressManager) await readerProgressManager.finish();
    // 次の本へ移動する前に確実にページ位置を保存するルン！
    if (savePageTimer) {
      clearTimeout(savePageTimer);
      savePageTimer = null;
    }
    saveCurrentPage();
    lastSaveTime = Date.now();
    debugLog("saveCurrentPage() executed before moving to next book");

    location.replace(nextlocation);
  } finally {
    readerClosing = false;
  }
}

//続刊リストのURL作成
function addnextbooklist(nexttitle, nextlocation) {
  let shareroot = publicDir;
  let sizeOption = "";
  // let nowlocation = location.href;
  // rawModeの状態に応じてsizeOptionを設定するロジックは元のまま
  const rawModeElement = document.getElementById("rawMode");
  if (rawModeElement && rawModeElement.classList.contains("raw")) {
    // sizeOption = "&size=FULL"; // sizeパラメータは不要になった可能性あり
  } else {
    // sizeOption = "";
  }
  const fullPath = String(nextlocation);
  const publicPrefix = shareroot && shareroot !== '/'
    ? shareroot.replace(/\/+$/, '') + '/'
    : '/';
  if (!fullPath.startsWith(publicPrefix) || fullPath.startsWith('//')) {
    return;
  }
  const relativePath = fullPath.slice(publicPrefix.length);
  const nextUrl = new URL(location.pathname, location.origin);
  // 空白は%20にして、PHPが保持するファイル名の+と区別するルン。
  nextUrl.search = 'file=' + encodeURIComponent(relativePath) + '&mode=open';
  const suggestElement = document.getElementById("suggest-books");
  if (suggestElement) {
    const row = document.createElement('p');
    const icon = document.createElement('img');
    icon.src = themeDir + '/theme/icons/book.png';
    icon.alt = '';
    const link = document.createElement('a');
    link.href = nextUrl.href;
    link.textContent = nexttitle;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      toNextBook(link.href);
    });
    row.append(icon, link);
    suggestElement.appendChild(row);
    suggestElement.hidden = false;
  }
}

async function refreshAutoLightSplitLayout(reason, scheduledRequestId) {
  const requestId =
    typeof scheduledRequestId === "number"
      ? scheduledRequestId
      : ++autoLightSplitLayoutRequestId;
  const imageElement = document.getElementById("image");
  const viewportApi = window.ComistreamViewport;

  if (!imageElement || !viewportApi) {
    return;
  }

  const viewport = viewportApi.getLayoutViewportSize(
    window,
    document.documentElement
  );
  if (viewport.width === 0 || viewport.height === 0) {
    return;
  }

  if (mode !== 1) {
    // 見開きの50%幅を壊さず、分割表示由来のスタイルだけ戻すルン
    autoLightSplitMode = false;
    als = "";
    imageElement.style.marginLeft = "0px";
    imageElement.style.height = "100%";
    imageElement.style.backgroundRepeat = "no-repeat";
    imageElement.style.backgroundSize = "contain";
    debugLog(
      "refreshAutoLightSplitLayout() skipped spread mode reason:" + reason
    );
    return;
  }

  if (
    viewport.width > viewport.height ||
    Number(page) === 1 ||
    autoSplit === "off"
  ) {
    autoLightSplitMode = false;
    als = "";
    changeAutoLightSplitMode(false);
    debugLog(
      "refreshAutoLightSplitLayout() normal layout reason:" + reason
    );
    return;
  }

  const imageUrl = globalDivImageUrl;
  const pageAtStart = page;
  if (!imageUrl) {
    return;
  }

  const image = await load_image(imageUrl);
  if (
    !viewportApi.isLayoutRequestCurrent({
      requestId,
      currentRequestId: autoLightSplitLayoutRequestId,
      imageUrl,
      currentImageUrl: globalDivImageUrl,
      page: pageAtStart,
      currentPage: page,
      mode,
    })
  ) {
    debugLog(
      "refreshAutoLightSplitLayout() discarded stale request reason:" + reason
    );
    return;
  }
  if (image === null) {
    debugLog(
      "refreshAutoLightSplitLayout() image load failed reason:" + reason
    );
    return;
  }

  imagex = image.width;
  imagey = image.height;
  const metrics = viewportApi.calculateAutoLightSplitMetrics({
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    imageWidth: imagex,
    imageHeight: imagey,
  });
  if (metrics === null) {
    return;
  }

  cutrate = metrics.cutRate;
  virtratio = metrics.ratio;
  autoLightSplitMode = viewportApi.shouldUseAutoLightSplit({
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    imageWidth: imagex,
    imageHeight: imagey,
    page,
    mode,
    autoSplit,
  });
  als = autoLightSplitMode ? "&als=1" : "";
  changeAutoLightSplitMode(autoLightSplitMode);
  debugLog(
    "refreshAutoLightSplitLayout() applied reason:" +
      reason +
      " autoLightSplitMode:" +
      autoLightSplitMode
  );
}

async function isLandscape(checkdivid) {
  //canvasの画像の縦横のどちらが長いかを判定 true:横長 false:縦長
  let divId = checkdivid;
  let bgImageUrl = window.getComputedStyle(
    document.getElementById(divId)
  ).backgroundImage;
  if (bgImageUrl == null) {
    return false;
  }
  bgImageUrl = globalDivImageUrl;
  let image = await load_image(bgImageUrl);
  // imageがnullならfalseを返す
  if (image == null) {
    return false;
  }
  imagex = image.width;
  imagey = image.height;
  const viewport = window.ComistreamViewport.getLayoutViewportSize(
    window,
    document.documentElement
  );
  const metrics = window.ComistreamViewport.calculateAutoLightSplitMetrics({
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    imageWidth: imagex,
    imageHeight: imagey,
  });
  if (metrics === null) {
    return false;
  }
  const ret = metrics.isLandscapeImage;
  cutrate = metrics.cutRate;
  virtratio = metrics.ratio;
  debugLog(
    "isLandscape(); " +
      ret +
      " width:" +
      imagex +
      " height:" +
      imagey +
      " virtratio:" +
      virtratio +
      " Aspect:" +
      image.width / image.height +
      " Page:" +
      page +
      " bgImageUrl:" +
      bgImageUrl
  );
  image = null;
  return ret;
}

function extractURLFromStyleString(styleString) {
  // 廃止
  // const urlRegex = /url\\("([^")]+)"\\)/;
  // const match = styleString.match(urlRegex); // スタイル文字列からURLを抽出
  // if (match && match.length > 1) {
  //   return match[1]; // 抽出されたURLを返す
  // } else {
  //   return null; // マッチするURLが見つからない場合はnullを返す
  // }
}

async function load_image(path) {
  //画像読み込み関数（読み込み完了を待つために使用）
  const t_img = new Image();
  return new Promise((resolve) => {
    // 通信停止時もページ操作の保留を必ず解除するルン
    const timer = setTimeout(() => {
      t_img.onload = null;
      t_img.onerror = null;
      resolve(null);
    }, 15000);
    t_img.onload = () => {
      clearTimeout(timer);
      resolve(t_img);
    };
    t_img.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
    t_img.src = path;
  });
}

function changeAutoLightSplitMode(autoLightSplitMode) {
  //表示を単ページのままか半分に分割表示するかを設定（横長画像の時に半分に分割するために使用） 自動ページ分割機能(Auto Light Split)
  const campusdiv = document.getElementById("image");
  const viewport = window.ComistreamViewport.getLayoutViewportSize(
    window,
    document.documentElement
  );
  const metrics = window.ComistreamViewport.calculateAutoLightSplitMetrics({
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    imageWidth: imagex,
    imageHeight: imagey,
  });

  if (autoLightSplitMode && metrics !== null) {
    // 横長画像を半分に分割して表示
    cutrate = metrics.cutRate;
    virtratio = metrics.ratio;
    campusdiv.style.height = "100%";
    campusdiv.style.backgroundPosition = autoLightSplitModeViewPosition;
    campusdiv.style.backgroundRepeat = "no-repeat";
    campusdiv.style.backgroundSize =
      metrics.backgroundWidth + "px " + metrics.backgroundHeight + "px";
    campusdiv.style.width = metrics.readerWidth + "px";
    campusdiv.style.marginLeft = metrics.marginLeft + "px";
    debugLog("Landscape:auto split image");
  } else {
    //縦長画像をそのまま表示
    campusdiv.style.width = "100%";
    campusdiv.style.height = "100%";
    campusdiv.style.marginLeft = "0px";
    campusdiv.style.backgroundPosition = "center";
    campusdiv.style.backgroundRepeat = "no-repeat";
    campusdiv.style.backgroundSize = "contain";
    debugLog("Portrait:not split image");
  }
}

function trimImage(image) {
  //画像のトリミング（重かったので未使用）
  var canvas = document.createElement("canvas");
  var context = canvas.getContext("2d");

  canvas.width = image.width;
  canvas.height = image.height;

  context.drawImage(image, 0, 0);

  var imageData = context.getImageData(0, 0, image.width, image.height);
  var data = imageData.data;

  var topLeftPixelColor = [data[0], data[1], data[2], data[3]];
  var topRightPixelColor = [
    data[(image.width - 1) * 4],
    data[(image.width - 1) * 4 + 1],
    data[(image.width - 1) * 4 + 2],
    data[(image.width - 1) * 4 + 3],
  ];

  var left = image.width,
    right = 0;

  for (var y = 0; y < image.height; y++) {
    for (var x = 0; x < image.width; x++) {
      var i = (y * image.width + x) * 4;
      if (
        (data[i] === topLeftPixelColor[0] &&
          data[i + 1] === topLeftPixelColor[1] &&
          data[i + 2] === topLeftPixelColor[2] &&
          data[i + 3] === topLeftPixelColor[3]) ||
        (data[i] === topRightPixelColor[0] &&
          data[i + 1] === topRightPixelColor[1] &&
          data[i + 2] === topRightPixelColor[2] &&
          data[i + 3] === topRightPixelColor[3])
      ) {
        data[i + 3] = 0;
      } else {
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }

  var trimmedCanvas = document.createElement("canvas");
  var trimmedContext = trimmedCanvas.getContext("2d");

  trimmedCanvas.width = right - left;
  trimmedCanvas.height = image.height;

  trimmedContext.putImageData(
    context.getImageData(left, 0, right - left, image.height),
    0,
    0
  );

  return trimmedCanvas.toDataURL();
}

function closeQuickSpread() {
  ++quickSpreadGeneration;
  clearTimeout(quickSpreadTimer);
  const modal = document.getElementById("modal");
  if (modal.style.display !== "block") return;
  modal.style.display = "none";
  modal.style.opacity = "0";
  const overlay = document.getElementById("overlay");
  const suggest = document.getElementById("suggest");
  if (!suggest?.open) {
    overlay.style.display = "none";
    overlay.style.opacity = "0";
  }
}

async function quickSpredView() {
  if (!readerReady || readerRenderPending || mode !== 1) return;
  const suggest = document.getElementById("suggest");
  if (suggest?.open) return;
  const modal = document.getElementById("modal");
  if (modal.style.display === "block") {
    closeQuickSpread();
    return;
  }
  const generation = ++quickSpreadGeneration;
  const target = page;
  const shapes = await Promise.all([
    isWideReaderPage(target), isWideReaderPage(target - 1)
  ]);
  if (generation !== quickSpreadGeneration || target !== page || mode !== 1) return;
  const paired = target > 1 && shapes.every((shape) => shape === false);
  const left = direction === "left" ? target : target - 1;
  const right = direction === "left" ? target - 1 : target;
  const image1 = document.getElementById("image1");
  const image2 = document.getElementById("image2");
  image1.style.width = paired ? "50%" : "100%";
  image1.src = getFullImageUrl(paired ? left : target, false);
  image2.style.width = "50%";
  image2.style.display = paired ? "block" : "none";
  if (paired) image2.src = getFullImageUrl(right, false);
  else image2.removeAttribute("src");
  const overlay = document.getElementById("overlay");
  overlay.style.opacity = "0";
  modal.style.opacity = "0";
  overlay.style.display = "block";
  modal.style.display = "block";
  quickSpreadTimer = setTimeout(function () {
    if (generation !== quickSpreadGeneration) return;
    overlay.style.opacity = "1";
    modal.style.opacity = "1";
  }, 50);
}

let imageInspectorUI = null;

function showInspector(forceVisible = null) {
  if (!imageInspectorUI) {
    const menu = document.getElementById("contents");
    imageInspectorUI = window.ComistreamInspector.create({
      menu,
      hideMenu: () => { menu.style.display = "none"; },
      restoreMenu: () => { menu.style.display = "block"; }
    });
  }
  const visible = forceVisible === null ? !imageInspectorUI.isOpen() : Boolean(forceVisible);
  if (!visible) {
    imageInspectorUI.setVisible(false);
    return;
  }
  const inspector = document.getElementById("inspector-content");
  const scrollTop = inspector.scrollTop;
  inspector.replaceChildren();
  const aspect = Math.round((imagex / imagey) * 100) / 100;
  const preLoadCacheSize = preCaches.getSize();
  const networkSpeedKBps = preCaches.getBps();
  const pages = page + " / " + maxPage;
  const list = document.createElement("ul");
  const listItemArray = [
    "imagex",
    "imagey",
    "req",
    "virtratio",
    "cutrate",
    "direction",
    "position",
    "mode",
    "autoLightSplitMode",
    "autoSplit",
    "als",
    "autoLightSplitModeViewPosition",
    "fixPage",
    "prevPage",
    "nextpage",
  ];
  for (let i = 0; i < listItemArray.length; i++) {
    let listItem = document.createElement("li");
    listItem.textContent =
      listItemArray[i].toString() + ": " + window[listItemArray[i]];
    list.appendChild(listItem);
  }
  // 関数スコープの診断値を追加するルン。
  let listItem = document.createElement("li");
  listItem.textContent = "Page: " + pages;
  list.prepend(listItem);

  listItem = document.createElement("li");
  listItem.textContent = "Aspect: " + aspect;
  list.appendChild(listItem);

  listItem = document.createElement("li");
  listItem.textContent = "Preload Pages: " + preLoadCacheSize;
  list.appendChild(listItem);

  listItem = document.createElement("li");
  listItem.textContent = "File Size: " + archiveFileMBytes + " MB";
  list.appendChild(listItem);

  listItem = document.createElement("li");
  listItem.textContent = "Average Page Size: " + averagePageKBytes + " KB";
  list.appendChild(listItem);

  listItem = document.createElement("li");
  listItem.textContent =
    "Network Speed: " + networkSpeedKBps.toLocaleString("en-US") + " Kbps";
  list.appendChild(listItem);

  inspector.appendChild(list);
  inspector.scrollTop = scrollTop;
  imageInspectorUI.setVisible(true);
}

function getFullImageUrl(page, includeSplit = true) {
  // 現在のURLからベースURLを取得
  const baseUrl = window.location.origin; // https://www.example.com
  const path = window.location.pathname; // /cgi-bin/comistream.php

  let url = new URL(path, baseUrl);

  url.searchParams.append("file", file);
  url.searchParams.append("size", size);
  url.searchParams.append("page", page);

  // $view_queryが空でない場合に追加
  let viewQuery = view_query;
  if (viewQuery) {
    url.searchParams.append("view", viewQuery.replace("&view=", "")); // '&view='を取り除く
  }

  if (includeSplit && autoLightSplitMode) {
    url.searchParams.append("als", "1");
  }

  return url.href;
}

// 時計の表示/非表示を切り替える関数
function toggleClock() {
  const clock = document.getElementById("clock");
  const clockButton = document.getElementById("clockToggleButton");

  if (clock.classList.contains("clock-hidden")) {
    // 時計を表示
    clock.classList.remove("clock-hidden");
    clockButton.classList.add("pressed");
    clockButton.setAttribute("aria-pressed", "true");
    // ローカルストレージに設定を保存
    localStorage.setItem("clockDisplay", "show");
    // 時計の更新を開始
    updateClock();
    // 1秒ごとに時計を更新
    clockTimer = setInterval(updateClock, 1000);
  } else {
    // 時計を非表示
    clock.classList.add("clock-hidden");
    clockButton.classList.remove("pressed");
    clockButton.setAttribute("aria-pressed", "false");
    // ローカルストレージに設定を保存
    localStorage.setItem("clockDisplay", "hide");
    // 時計の更新を停止
    clearInterval(clockTimer);
  }
}

// 時計の表示を更新する関数
function updateClock() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  document.getElementById("clock").textContent = `${hours}:${minutes}`;
}

// ページ読み込み時に時計の設定を復元する
window.addEventListener("load", function () {
  const clockDisplay = localStorage.getItem("clockDisplay");
  if (clockDisplay === "show") {
    // 少し遅延させてから実行（ページロード完了後）
    setTimeout(function () {
      toggleClock();
    }, 500);
  }
});

// グローバル変数の宣言
let clockTimer;

// 大きなページサイズの通知機能
function showLargePageNotification() {
  // 既存の通知があれば削除
  const existingNotification = document.querySelector(
    ".large-page-notification"
  );
  if (existingNotification) {
    existingNotification.remove();
  }

  // 通知要素を作成
  const notification = document.createElement("div");
  notification.className = "large-page-notification";
  notification.textContent =
    window.i18n.large_page_notification ||
    "ページサイズが大きいため表示が重たい可能性があります。端末にダウンロードすると高速に表示されます。";

  // クリックで非表示にする
  notification.addEventListener("click", function () {
    hideLargePageNotification(notification);
  });

  // ページに追加
  document.body.appendChild(notification);

  // 5秒後に自動で非表示
  setTimeout(function () {
    hideLargePageNotification(notification);
  }, 5000);
}

function hideLargePageNotification(notification) {
  if (notification && notification.parentNode) {
    notification.classList.add("fade-out");
    setTimeout(function () {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 500);
  }
}

// ページサイズをチェックして通知を表示する関数
function checkAndShowLargePageNotification() {
  // averagePageKBytesが2000を超えていて、かつsizeが'FULL'（rawモード）の場合
  if (averagePageKBytes > 2000 && size === "FULL") {
    debugLog(
      "Large page size detected: " +
        averagePageKBytes +
        "KB, showing notification"
    );
    showLargePageNotification();
  }
}

// ツールチップを更新するヘルパー関数 ルン！
function updateTooltip(elementId, newTooltip) {
  const element = document.getElementById(elementId);
  if (element) {
    element.setAttribute("data-tooltip", newTooltip);
  }
}

// モード切り替え時にツールチップを更新する関数 ルン！
// 現在の状態に応じて、そのモードの説明をツールチップに表示するルン☆
function updateModeTooltips() {
  // rawModeボタンのツールチップを更新 ルン！
  const rawMode = document.getElementById("rawMode");
  if (rawMode) {
    if (rawMode.classList.contains("raw")) {
      // 現在原寸(raw)モードなので、原寸モードの説明をツールチップに表示するルン
      const tooltip = rawMode.getAttribute("data-tooltip-full");
      if (tooltip) rawMode.setAttribute("data-tooltip", tooltip);
    } else {
      // 現在圧縮(cmp)モードなので、圧縮モードの説明をツールチップに表示するルン
      const tooltip = rawMode.getAttribute("data-tooltip-compressed");
      if (tooltip) rawMode.setAttribute("data-tooltip", tooltip);
    }
  }

  updatePageModeButton();

  // splitFileボタンのツールチップを更新 ルン！
  const splitFile = document.getElementById("splitFile");
  if (splitFile) {
    if (splitFile.classList.contains("trimming")) {
      // 現在トリミングモードなので、トリミングモードの説明をツールチップに表示するルン
      const tooltip = splitFile.getAttribute("data-tooltip-trimming");
      if (tooltip) splitFile.setAttribute("data-tooltip", tooltip);
    } else {
      // 現在通常(normal)モードなので、通常モードの説明をツールチップに表示するルン
      const tooltip = splitFile.getAttribute("data-tooltip-normal");
      if (tooltip) splitFile.setAttribute("data-tooltip", tooltip);
    }
  }
}
