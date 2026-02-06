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
 * @license     GPL3.0 License
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
    // R2 WorkerがCORSヘッダーを返さない場合、画像自体が読み込めなくなるルン
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
var mode = 1;
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
// 拡張light wide split
var req;
var autoLightSplitMode = false; //false:縦長なのでそのまま true:横長を自動分割表示
var virtratio = 100; //表示の縦比率
var imagex = 0; //画像の横幅
var imagey = 0; //画像の縦幅
var als = ""; // Auto Light Split Mode使ってるかのクエリパラメータ
var autoLightSplitModeViewPosition = "right"; // 横長画像のどっち側表示しているか
var xDown = null; // 2本指スワイプダウン検出用
var yDown = null; // 2本指スワイプダウン検出用
let globalDivImageUrl = "";
var isPinching = false; // ピンチ操作中フラグ
var originalViewportContent = ""; // To store the original viewport meta tag content
// const isAndroid = /Android/i.test(navigator.userAgent);

function isZoomed() {
  // visualViewportが存在しない古いブラウザでは常にfalseを返す
  if (typeof window.visualViewport === "undefined") {
    return false;
  }
  // スケールが1より大きい場合にtrueを返す (誤差を考慮)
  return window.visualViewport.scale > 1.05;
}

window.addEventListener("keydown", funcKey);

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
    modal.style.display = "none";
    overlay.style.display = "none";
  }
};

// 端末の回転を検知して横位置ならクイック見開きモードにする
window.addEventListener("orientationchange", () => {
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
    }, 50);
  }
}

function saveCurrentPage() {
  // ページ離脱時に最終ページ保存
  // タイマーが残っていたらクリアするルン！
  if (savePageTimer) {
    clearTimeout(savePageTimer);
    savePageTimer = null;
  }

  let localPage = page;
  if (mode == 2) {
    localPage = page + 1;
  }
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
  navigator.sendBeacon("comistream.php", data);
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

function next() {
  if (
    document.getElementById("image").style.backgroundPosition.includes("right")
  ) {
    document.getElementById("image").style.backgroundPosition = "left";
    autoLightSplitModeViewPosition = "left";
  } else {
    if (page + mode <= maxPage) {
      page = page + mode;
      // 別デバイスでページを読み進んでいたら移動する
      let now = Math.floor(new Date().getTime() / 1000);
      if (now - unixtime > 60) {
        // 過去同期時刻から60秒以上経過していたら同期確認
        debugLog(
          "next() call devicePageSync() now:" +
            parseInt(now) +
            " unixtime:" +
            parseInt(unixtime)
        );
        devicePageSync();
        //devicePageSyncNew();
        unixtime = Math.floor(new Date().getTime() / 1000);
        debugLog("next() page " + parseInt(page));
      } else {
        // 経過時間が60秒以内の場合はパフォーマンス向上のため同期確認しない
        debugLog(
          "next() do nothing now:" +
            parseInt(now) +
            " unixtime:" +
            parseInt(unixtime)
        );
      }
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
      saveCurrentPage();
      lastSaveTime = Date.now();
      debugLog("saveCurrentPage() executed on reaching last page");

      // jQuery UI Dialogの代替: suggest要素を表示する
      const suggestElement = document.getElementById("suggest");
      const overlayElement = document.getElementById("overlay"); // 既存のオーバーレイを使用
      if (suggestElement && overlayElement) {
        // CSSでスタイルが定義されている前提で、表示を切り替えるだけにするルン！
        overlayElement.style.display = "block";
        suggestElement.style.display = "block";

        // 外側クリックで閉じるイベントリスナー
        overlayElement.onclick = () => {
          suggestElement.style.display = "none";
          overlayElement.style.display = "none";
          // クリックイベントをリセット
          overlayElement.onclick = null;
        };
      } else {
        debugLog("Suggest or Overlay element not found!"); // 見つからなかった場合のエラーログ
      }
    }
  }
}

function back() {
  if (
    document.getElementById("image").style.backgroundPosition.includes("left")
  ) {
    document.getElementById("image").style.backgroundPosition = "right";
    autoLightSplitModeViewPosition = "right";
  } else {
    if (page > 1) {
      page = page - mode;
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

function nextIndex() {
  for (var i = 0; i < indexArray.length; i++) {
    if (page + mode - 1 < indexArray[i]) {
      page = indexArray[i];
      loadPage(1);
      return true;
    }
  }
}

function backIndex() {
  for (var i = indexArray.length; i >= 0; i--) {
    if (page > indexArray[i]) {
      page = indexArray[i];
      loadPage(1);
      return true;
    }
  }
}

async function devicePageSync() {
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

function loadPage(dir) {
  debugLog("current page:" + page + " max page:" + maxPage);
  if (page == 1) {
    // 表紙はそのまま出す
    autoLightSplitMode = false;
    // changeAutoLightSplitMode(autoLightSplitMode);
  }

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
  if (mode == 2) {
    if (page % 2 == 1) page--;
    page = page + fixPage;
  } else if (mode == 1 && page <= 0) {
    page = 1;
  }
  window.localStorage.setItem(file, String(page));
  window.localStorage.setItem("pagemode", String(mode));

  if (document.getElementById("contents").style.display == "block") setSlider();

  document.getElementById("progress").style.width =
    (page / maxPage) * 100 + "%";

  if (page > 0) {
    // トリミング実行（重いため未使用）
    //var image = new Image();
    //image.src = "comistream.php?file={$file}&size={$size}&page="+page+"$view_query";
    //image.onload = function() {
    //  var trimmedImageUrl = trimImage(image);
    //  document.getElementById("image").style.backgroundImage = 'url(' + trimmedImageUrl + ')';
    //};

    debugLog("loadPage() autoLightSplitMode:" + autoLightSplitMode);
    if (autoLightSplitMode) {
      als = "&als=1";
    } else {
      als = "";
    }
    // ページめくり速度計測
    preCaches.recordPageTurn();

    document.getElementById("image").style.backgroundImage =
      "url('" +
      pageGenerator +
      "?file=" +
      file +
      "&size=" +
      size +
      "&page=" +
      page +
      view_query +
      als +
      "')";
    globalDivImageUrl = getFullImageUrl(page);
    debugLog("loadPage() globalDivImageUrl:" + globalDivImageUrl);

    // 自動ページ分割機能(Auto Light Split)設定
    (async () => {
      //画面が横長の場合は画像が横長でも分割しない
      // TODO restorePageに類似処理
      const offsetx = document.getElementById("image").offsetWidth;
      const offsety = document.getElementById("image").offsetHeight;
      const naturalx = document.getElementById("image").naturalWidth;
      const naturaly = document.getElementById("image").naturalHeight;
      debugLog(
        "loadPage() offset: %d x %d  natural: %d x %d ",
        offsetx,
        offsety,
        naturalx,
        naturaly
      );
      if (
        document.getElementById("image").offsetWidth >
        document.getElementById("image").offsetHeight
      ) {
        autoLightSplitMode = false;
      } else if (page == 1) {
        // 表紙はそのまま出す
        autoLightSplitMode = false;
        changeAutoLightSplitMode(autoLightSplitMode);
      } else if (autoSplit == "off") {
        // オプションで停止されてるときはそのまま出す
        autoLightSplitMode = false;
      } else if (mode == 2) {
        // 見開き表示モードの場合は自動分割しない
        autoLightSplitMode = false;
      } else {
        autoLightSplitMode = await isLandscape("image");
        changeAutoLightSplitMode(autoLightSplitMode);
      }
    })();
  } else {
    document.getElementById("image").style.backgroundImage = "none";
  }

  if (mode == 2) {
    if (page < maxPage) {
      document.getElementById("nextimage").style.backgroundImage =
        "url('" +
        pageGenerator +
        "?file=" +
        file +
        "&size=" +
        size +
        "&page=" +
        (1 + parseInt(page)) +
        view_query +
        als +
        "')";
    } else {
      document.getElementById("nextimage").style.backgroundImage = "none";
    }
  }

  nextpage = dir * mode + page;
  if (nextpage > 0 && nextpage <= maxPage) {
    nextimage1.src =
      pageGenerator +
      "?file=" +
      file +
      "&size=" +
      size +
      "&page=" +
      nextpage +
      view_query +
      als;
    // if( document.getElementById("splitFile").classList.contains('normal') ){
    // 非分割モード時の先読み処理
    // モード関係なく常に先読みキャッシュ有効に
    // }else{
    // 分割モード時の先読み処理
    if (Math.abs(prevPage - page) > 3) {
      // 3ページ以上離れていたら再先読みを実行
      setTimeout(() => {
        preLoadInitialImages(nextpage);
      }, global_preload_delay_ms);
    } else {
      if (nextpage + preCaches.getSize() <= maxPage) {
        // なんか初期ロード時に23ページとか関係ないところ読むバグ対策（場当たり的）
        if (preCaches.getSize() - nextpage > 15) {
          debugLog("preLoadImages() SKIP:" + preCaches.getSize());
        } else {
          preLoadImages(nextpage + preCaches.getSize());
        }
      }
    }
    prevPage = page;
    // }
    if (mode == 2)
      nextimage2.src =
        pageGenerator +
        "?file=" +
        file +
        "&size=" +
        size +
        "&page=" +
        (1 + parseInt(nextpage)) +
        view_query +
        als;
  } else {
    // console.log("nextpage else");
  }
  document.getElementById("loading").style.display = "none";
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

function restorePage() {
  if (page == 1) {
    page = parseInt(window.localStorage.getItem(file) || page);
  }
  mode = parseInt(window.localStorage.getItem("pagemode") || mode);

  // ページモードボタンの表示を現在のモードに合わせて設定 ルン！
  if (mode == 2) {
    // 見開モードの場合
    document.getElementById("pageMode").className = "button spread button-mode";
    document.getElementById("pageMode").textContent =
      window.i18n.toc_button_spread;
    document.getElementById("image").style.width = "50%";
    document.getElementById("image").style.backgroundPosition = direction;
    document.getElementById("image").style.float = position;
    document.getElementById("nextimage").style.display = "block";
    document.getElementById("nextimage").style.backgroundPosition = position;
    document.getElementById("nextimage").style.float = direction;
  } else {
    // 単頁モードの場合（デフォルト）
    document.getElementById("pageMode").className = "button single button-mode";
    document.getElementById("pageMode").textContent =
      window.i18n.toc_button_single;
    document.getElementById("image").style.width = "100%";
    document.getElementById("image").style.backgroundPosition = "center";
    document.getElementById("image").style.float = "none";
    document.getElementById("nextimage").style.display = "none";
  }
  loadPage(1);
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

  // 自動ページ分割機能(Auto Light Split)設定
  (async () => {
    //画面が横長の場合は画像が横長でも分割しない
    // TODO loadPageに類似処理
    if (
      document.getElementById("image").offsetWidth >
      document.getElementById("image").offsetHeight
    ) {
      autoLightSplitMode = false;
    } else if (page == 1) {
      autoLightSplitMode = false;
    } else if (autoSplit == "off") {
      autoLightSplitMode = false;
    } else if (mode == 2) {
      // 見開き表示モードの場合は自動分割しない
      autoLightSplitMode = false;
    } else {
      autoLightSplitMode = await isLandscape("image");
      changeAutoLightSplitMode(autoLightSplitMode);
    }
  })();

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
}

function index() {
  if (document.getElementById("contents").style.display == "block") {
    document.getElementById("contents").style.display = "none";
  } else {
    document.getElementById("contents").style.display = "block";
    setSlider();

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

// 単頁/見開モードのトグル切り替え ルン！現在のモードを表示するルン！
function togglePageMode() {
  if (mode === 1) {
    // 単頁 → 見開に切り替え
    mode = 2;
    document.getElementById("pageMode").className = "button spread button-mode";
    document.getElementById("pageMode").textContent =
      window.i18n.toc_button_spread;
    document.getElementById("image").style.width = "50%";
    document.getElementById("image").style.backgroundPosition = direction;
    document.getElementById("image").style.float = position;
    document.getElementById("nextimage").style.display = "block";
    document.getElementById("nextimage").style.backgroundPosition = position;
    document.getElementById("nextimage").style.float = direction;
  } else {
    // 見開 → 単頁に切り替え
    mode = 1;
    document.getElementById("pageMode").className = "button single button-mode";
    document.getElementById("pageMode").textContent =
      window.i18n.toc_button_single;
    document.getElementById("image").style.width = "100%";
    document.getElementById("image").style.backgroundPosition = "center";
    document.getElementById("image").style.float = "none";
    document.getElementById("nextimage").style.display = "none";
  }
  // ツールチップを更新するルン！
  updateModeTooltips();
  loadPage(1);
}

// 旧関数は互換性のため残しておくルン（fixSpreadPageなどから呼ばれる可能性）
function single() {
  if (mode === 1) return; // 既に単頁モードなら何もしない
  mode = 1;
  document.getElementById("pageMode").className = "button single button-mode";
  document.getElementById("pageMode").textContent =
    window.i18n.toc_button_single;
  document.getElementById("image").style.width = "100%";
  document.getElementById("image").style.backgroundPosition = "center";
  document.getElementById("image").style.float = "none";
  document.getElementById("nextimage").style.display = "none";
  // ツールチップを更新するルン！
  updateModeTooltips();
  loadPage(1);
}

function spread() {
  if (mode === 2) return; // 既に見開モードなら何もしない
  mode = 2;
  document.getElementById("pageMode").className = "button spread button-mode";
  document.getElementById("pageMode").textContent =
    window.i18n.toc_button_spread;
  document.getElementById("image").style.width = "50%";
  document.getElementById("image").style.backgroundPosition = direction;
  document.getElementById("image").style.float = position;
  document.getElementById("nextimage").style.display = "block";
  document.getElementById("nextimage").style.backgroundPosition = position;
  document.getElementById("nextimage").style.float = direction;
  // ツールチップを更新するルン！
  updateModeTooltips();
  loadPage(1);
}

function backListPage() {
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
}

function fixSpreadPage() {
  fixPage = 1 - fixPage;
  loadPage(1);
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
    fullScreenButton.classList.add("pressed");
  } else {
    // 窓表示時は「窓表示」を表示するルン！（現在のモード表示）
    fullScreenButton.textContent = window.i18n.toc_button_windowed;
    fullScreenButton.classList.remove("pressed");
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
  if (mode == 2) spread();
}

function funcKey(evt) {
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
    // モーダル表示中は閉じる
    if (document.getElementById("modal").style.display == "block") {
      document.getElementById("modal").style.opacity = "0";
      document.getElementById("overlay").style.opacity = "0";

      // タッチデバイス対応改善のため処理を一元化
      setTimeout(function () {
        document.getElementById("modal").style.display = "none";
        document.getElementById("overlay").style.display = "none";

        // タッチイベントを確実に有効化
        document.body.style.pointerEvents = "auto";

        // iOS/Androidでの長押し対策
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        if (isMobile) {
          setTimeout(function () {
            // 再度確認
            document.body.style.pointerEvents = "auto";
          }, 50);
        }
      }, 50);
    }

    // インスペクター表示中は閉じる
    document.getElementById("inspector").style.display = "none";
    while (document.getElementById("inspector").firstChild) {
      document
        .getElementById("inspector")
        .removeChild(document.getElementById("inspector").firstChild);
    }
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
  // 圧縮有無の切り替え ルン！現在のモードを表示するように変更するルン！
  let data = new FormData();
  data.append("mode", "close");
  data.append("file", escapedFile);
  data.append("page", page);
  navigator.sendBeacon("comistream.php", data);

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
    document.getElementById("rawMode").className = "button cmp";
    document.getElementById("rawMode").textContent =
      window.i18n.toc_button_compress;
    document.cookie = "rawMode=cmp; path=/; max-age=31536000";
    debugLog("toggleRaw() size toggle to cmp, reload_url:" + reload_url);
    location.replace(reload_url);
  } else {
    document.getElementById("rawMode").className = "button raw";
    document.getElementById("rawMode").textContent =
      window.i18n.toc_button_full;
    document.cookie = "rawMode=raw; path=/; max-age=31536000";
    debugLog("toggleRaw() size toggle to raw, reload_url:" + reload_url);
    location.replace(reload_url);
  }
}

function toggleTrimmingFile() {
  // サーバー側で左右余白トリミングするモード（旧:見開きサイズ画像ファイルの左右分割表示モード） ルン！
  let data = new FormData();
  data.append("mode", "close");
  data.append("file", escapedFile);
  data.append("page", page);
  if (document.getElementById("splitFile").classList.contains("normal")) {
    // 左右余白トリミングモードへ
    // page = page*2;
    navigator.sendBeacon("comistream.php", data);
    document.getElementById("splitFile").className = "button trimming";
    document.getElementById("splitFile").textContent =
      window.i18n.toc_button_trimming; // 現在のモードを表示するルン！
    // console.log("toggleTrimmingFile() normal to split");
    let reload_url = location.href + "&view=trimming";
    // (reload_url);
    location.replace(reload_url);
  } else {
    // 通常表示モードへ
    // page = Math.floor((page+1)/2);
    navigator.sendBeacon("comistream.php", data);
    document.getElementById("splitFile").className = "button normal";
    document.getElementById("splitFile").textContent =
      window.i18n.toc_button_normal;
    // console.log("toggleTrimmingFile() split to normal");
    let reload_url = location.href.replace("&view=trimming", "");
    // console.log(reload_url);
    location.replace(reload_url);
  }
}

//読み終えたときに続刊、関連書籍を表示するためのデータを取得
async function sugguestbook() {
  debugLog("sugguestbook(); start fetch");
  const suggestElement = document.getElementById("suggest");
  if (!suggestElement) {
    debugLog("sugguestbook(); suggest element not found");
    return;
  }
  // 既存の内容をクリア (もし必要なら)
  // suggestElement.innerHTML = '';

  try {
    const response = await fetch(
      `/suggest.php?booktitle=${encodeURIComponent(baseFile)}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // 新しい巻
    Object.keys(data.title.new).forEach(function (key) {
      addnextbooklist(key, data.title.new[key]);
    });

    // 現在読んでいる本
    const currentBookHtml = `<p><img src="${themeDir}/theme/icons/book.png" /><b>${baseFile}</b><span style="color:#5674b9">　now reading</span></p>`;
    suggestElement.insertAdjacentHTML("beforeend", currentBookHtml);

    // 古い巻
    Object.keys(data.title.old).forEach(function (key) {
      addnextbooklist(key, data.title.old[key]);
    });

    // 同じ作者の本
    Object.keys(data.author).forEach(function (key) {
      addnextbooklist(key, data.author[key]);
    });
  } catch (error) {
    debugLog("Fetch errored: " + error);
    const errorHtml = `<p><img src="${themeDir}/theme/icons/book.png" /><b>${baseFile}</b><span style="color:red">　no suggest</span></p>`;
    if (suggestElement) {
      suggestElement.insertAdjacentHTML("beforeend", errorHtml);
    }
  }

  /* 元の$.ajaxコード
  $.ajax({
    type: "GET",
    url: "/suggest.php",
    dataType: "json",
    data: { booktitle: baseFile },
  })
    .done(function (data) {
      var data_stringify = JSON.stringify(data);
      var data_json = JSON.parse(data_stringify);
      Object.keys(data_json.title.new).forEach(function (key) {
        addnextbooklist(key, data_json.title.new[key]);
      });
      $("#suggest").append(
        '<p><img src="' +
          themeDir +
          '/theme/icons/book.png" /><b>' +
          baseFile +
          '</b><span style="color:#5674b9">　now reading</span></p>'
      );
      Object.keys(data_json.title.old).forEach(function (key) {
        addnextbooklist(key, data_json.title.old[key]);
      });
      Object.keys(data_json.author).forEach(function (key) {
        addnextbooklist(key, data_json.author[key]);
      });
    })
    .fail((jqXHR, textStatus, errorThrown) => {
      debugLog("Ajax errored");
      debugLog("jqXHR          : " + jqXHR.status); // HTTPステータスを表示
      debugLog("textStatus     : " + textStatus); // タイムアウト、パースエラーなどのエラー情報を表示
      debugLog("errorThrown    : " + errorThrown.message); // 例外情報を表示
      $("#suggest").append(
        '<p><img src="' +
          themeDir +
          '/theme/icons/book.png" /><b>' +
          baseFile +
          '</b><span style="color:red">　no suggest</span></p>'
      );
    });
  */
}

//続刊へ移動
function toNextBook(nextlocation) {
  // 次の本へ移動する前に確実にページ位置を保存するルン！
  if (savePageTimer) {
    clearTimeout(savePageTimer);
    savePageTimer = null;
  }
  saveCurrentPage();
  lastSaveTime = Date.now();
  debugLog("saveCurrentPage() executed before moving to next book");

  location.replace(nextlocation);
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
  const encodeOpenFilePath = encodeURIComponent(
    nextlocation.substring(shareroot.length + 1)
  );
  debugLog("addnextbooklist(); encodeOpenFilePath:" + encodeOpenFilePath);
  let nexttag =
    '<p><img src="' +
    themeDir +
    '/theme/icons/book.png" /><a href="' +
    "javascript:toNextBook('" +
    location.pathname +
    "?file=" +
    encodeOpenFilePath +
    "&mode=open" +
    sizeOption +
    "')\">" +
    nexttitle +
    "</a></p>";
  debugLog("addnextbooklist(); nexttag:" + nexttag);
  // $("#suggest").append(nexttag);
  const suggestElement = document.getElementById("suggest");
  if (suggestElement) {
    suggestElement.insertAdjacentHTML("beforeend", nexttag);
  }
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
  let ret = image.width < image.height ? false : true;
  cutrate = 1;
  if (ret) {
    cutrate = 2;
  }
  virtratio =
    window.innerWidth / (image.width / cutrate) <
    window.innerHeight / image.height
      ? window.innerWidth / (image.width / cutrate)
      : window.innerHeight / image.height;
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
    t_img.onload = () => {
      resolve(t_img);
    };
    t_img.src = path;
  });
}

function changeAutoLightSplitMode(autoLightSplitMode) {
  //表示を単ページのままか半分に分割表示するかを設定（横長画像の時に半分に分割するために使用） 自動ページ分割機能(Auto Light Split)
  let imgurl = window.getComputedStyle(
    document.getElementById("image")
  ).backgroundImage; // url("...")形式
  imgurl = extractURLFromStyleString(imgurl);
  let campusdiv = document.getElementById("image");
  if (autoLightSplitMode) {
    // 横長画像を半分に分割して表示
    // campusdiv.style.width = '100%';
    campusdiv.style.height = "100%";
    campusdiv.backgroundImage = "url('" + imgurl + "')";
    // campusdiv.style.backgroundPosition = 'right';
    campusdiv.style.backgroundPosition = autoLightSplitModeViewPosition;
    campusdiv.style.backgroundRepeat = "no-repeat";
    campusdiv.style.backgroundSize =
      Math.trunc(virtratio * imagex) +
      "px " +
      Math.trunc(virtratio * imagey) +
      "px";
    divwith =
      (virtratio * imagex) / 2 < window.innerWidth
        ? Math.trunc((virtratio * imagex) / 2)
        : window.innerWidth;
    campusdiv.style.width = divwith + "px";
    if (window.innerWidth > divwith) {
      campusdiv.style.marginLeft =
        Math.trunc((window.innerWidth - divwith) / 2) + "px";
    }
    debugLog("Landscape:auto split image");
  } else {
    //縦長画像をそのまま表示
    campusdiv.style.width = "100%";
    campusdiv.style.height = "100%";
    campusdiv.backgroundImage = "url('" + imgurl + "')";
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

function quickSpredView() {
  // スペースキーを押すとクイック見開きモード
  if (mode == 1) {
    // 単ページモードしか動作させないように
    let overlay = document.getElementById("overlay");
    let modal = document.getElementById("modal");
    let image1 = document.getElementById("image1");
    let image2 = document.getElementById("image2");

    if (modal.style.display == "block") {
      // モーダル表示中はスペースキーでモーダルを閉じる
      modal.style.opacity = "0";
      overlay.style.opacity = "0";

      // タッチデバイス対応改善のため、遅延を短くする
      setTimeout(function () {
        modal.style.display = "none";
        overlay.style.display = "none";

        // モーダルを閉じた直後にタッチイベントを解放する
        document.body.style.pointerEvents = "none";
        setTimeout(function () {
          document.body.style.pointerEvents = "auto";
        }, 10);
      }, 50); // 0.15秒→0.05秒に短縮
    } else {
      if (autoLightSplitMode) {
        als = "&als=1";
        image1.src =
          pageGenerator +
          "?file=" +
          file +
          "&size=" +
          size +
          "&page=" +
          page +
          view_query +
          als;
        image2.src = "";
        image1.style.width = "100%";
      } else {
        // 縦長単ページモード
        als = "";
        let quickWideLeftPageNo = 0;
        let quickWideRightPageNo = 0;
        if (page > 1) {
          if (direction == "left") {
            // 右綴じ 左方向めくり
            quickWideLeftPageNo = page;
            quickWideRightPageNo = page - 1;
          } else {
            quickWideLeftPageNo = page - 1;
            quickWideRightPageNo = page;
          }
        } else {
          quickWideLeftPageNo = 1;
          quickWideRightPageNo = 1;
          image1.style.width = "100%";
        }
        // 見開き左側表示
        image1.style.width = "50%";
        image1.src =
          pageGenerator +
          "?file=" +
          file +
          "&size=" +
          size +
          "&page=" +
          quickWideLeftPageNo +
          view_query +
          als;
        // 見開き右側表示
        image2.style.width = "50%";
        image2.src =
          pageGenerator +
          "?file=" +
          file +
          "&size=" +
          size +
          "&page=" +
          quickWideRightPageNo +
          view_query +
          als;
        debugLog(
          "keydown space LeftPage:" +
            quickWideLeftPageNo +
            " RightPage:" +
            quickWideRightPageNo +
            " direction:" +
            direction
        );
      }
      // 表示
      overlay.style.opacity = "0";
      modal.style.opacity = "0";
      overlay.style.display = "block";
      modal.style.display = "block";
      setTimeout(function () {
        overlay.style.opacity = "1";
        modal.style.opacity = "1";
      }, 50); // 少し遅延させてから実行
    }
  } else {
    debugLog("spred view mode mode:" + mode);
  }
}

function showInspector() {
  // iキーを押すとインスペクターを表示
  let inspector = document.getElementById("inspector");
  let aspect = imagex / imagey;
  aspect = Math.round(aspect * 100) / 100;
  const preLoadCacheSize = preCaches.getSize();
  const networkSpeedKBps = preCaches.getBps();

  if (inspector.style.display == "block") {
    // インスペクター表示中はiキーでインスペクターを閉じる
    inspector.style.opacity = "0";
    setTimeout(function () {
      inspector.style.display = "none";
      while (inspector.firstChild) {
        inspector.removeChild(inspector.firstChild);
      }
    }, 150); // 0.15秒後に実行
  } else {
    // page / maxPageスタイルで表示
    // page / maxPageスタイルで表示
    let pages = page + " / " + maxPage;
    // 新しい<ul>要素を作成します
    let list = document.createElement("ul");

    // 項目を作成し、リストに追加します
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
        listItemArray[i].toString() + ":" + window[listItemArray[i]];
      list.appendChild(listItem);
    }
    // 関数スコープの変数追加
    listItem = document.createElement("li");
    listItem.textContent = "Page:" + pages;
    list.prepend(listItem);

    listItem = document.createElement("li");
    listItem.textContent = "Aspect:" + aspect;
    list.appendChild(listItem);

    listItem = document.createElement("li");
    listItem.textContent = "Preload pages:" + preLoadCacheSize;
    list.appendChild(listItem);

    listItem = document.createElement("li");
    listItem.textContent = "File size:" + archiveFileMBytes + "MB";
    list.appendChild(listItem);

    listItem = document.createElement("li");
    listItem.textContent = "Average page size:" + averagePageKBytes + "KB";
    list.appendChild(listItem);

    listItem = document.createElement("li");
    listItem.textContent =
      "Network Speed:" + networkSpeedKBps.toLocaleString() + "Kbps";
    list.appendChild(listItem);

    // リストを'inspector'要素に追加します
    inspector.appendChild(list);

    // 表示
    inspector.style.opacity = "0";
    inspector.style.display = "block";
    setTimeout(function () {
      inspector.style.opacity = "1";
    }, 50); // 少し遅延させてから実行
  }
}

function getFullImageUrl(page) {
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

  if (autoLightSplitMode) {
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

  // pageModeボタンのツールチップを更新 ルン！
  const pageMode = document.getElementById("pageMode");
  if (pageMode) {
    if (pageMode.classList.contains("single")) {
      // 現在単頁モードなので、単頁モードの説明をツールチップに表示するルン
      const tooltip = pageMode.getAttribute("data-tooltip-single");
      if (tooltip) pageMode.setAttribute("data-tooltip", tooltip);
    } else {
      // 現在見開(spread)モードなので、見開モードの説明をツールチップに表示するルン
      const tooltip = pageMode.getAttribute("data-tooltip-spread");
      if (tooltip) pageMode.setAttribute("data-tooltip", tooltip);
    }
  }

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
