/**
 * Comistream Reader - Livestream JavaScript
 *
 * リアルタイムトランスコードHLS再生のフロントエンド。
 * VODモードでは完全なプレイリストが即座に提供されるため、
 * シークバーは開始直後から動画全長になる。未エンコード地点への
 * シークはサーバー側セグメントゲートウェイが透過的に処理する。
 *
 * @package     sorshi/comistream-reader
 * @author      Comistream Project.
 * @copyright   2024 Comistream Project.
 * @license     GPL3.0 License
 * @version     1.1.0
 *
 * 主な機能:
 * - hls.js(PC) / ネイティブHLS(iPhone/iPad Safari)での再生開始
 * - eventモード(総時間不明時のフォールバック)での再生開始待ちポーリング
 * - ページ離脱時のエンコード停止
 */

document.onkeydown = funcKey;
function funcKey(evt){
  if( evt.keyCode == 8 || evt.keyCode == 46 ){
    backListPage();
  }else if( evt.keyCode == 70 ){
    toggleFullScreen();
  }
}

function backListPage(){
  if( document.cancelFullScreen ){ document.cancelFullScreen(); }
  else if( document.mozCancelFullScreen ){ document.mozCancelFullScreen(); }
  else if( document.webkitCancelFullScreen ){ document.webkitCancelFullScreen(); }

  if( window.history.length > 1 ){
    window.history.back();
  }else{
    location.href=document.referrer;
  }
}

function toggleFullScreen(){
  const video=document.getElementById('video');

  if( document.fullscreenElement || document.mozFullScreenElement || document.webkitFullscreenElement ){
    if( document.cancelFullScreen ){ document.cancelFullScreen(); }
    else if( document.mozCancelFullScreen ){ document.mozCancelFullScreen(); }
    else if( document.webkitCancelFullScreen ){ document.webkitCancelFullScreen(); }
  }else{
    if( video.webkitRequestFullscreen ){ video.webkitRequestFullscreen(); }
    else if( video.mozRequestFullScreen ){ video.mozRequestFullScreen(); }
    else if( video.requestFullscreen ){ video.requestFullscreen(); }
    else{ alert("フルスクリーン非対応"); }
  }
}

window.addEventListener('pagehide',function(){
  // ページ離脱時にHLS停止
  let data = new FormData();
  data.append('mode', 'stop');
  navigator.sendBeacon(cgiPath, data );
});

let thumbnailManifest = null;
let thumbnailManifestPromise = null;
let seekPreviewHideTimer = null;
let seekPreviewRequestId = 0;
let thumbnailWorkerStarted = false;

function formatLivestreamTime(seconds){
  seconds = Math.max(0, Math.floor(seconds || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }
  return m + ":" + String(s).padStart(2, "0");
}

function getSeekPreviewElements(){
  return {
    root: document.getElementById('seek_preview'),
    image: document.getElementById('seek_preview_image'),
    time: document.getElementById('seek_preview_time'),
  };
}

function loadThumbnailManifest(){
  if (playbackMode !== "vod" || !fileId) {
    return Promise.resolve(null);
  }
  if (thumbnailManifestPromise) {
    return thumbnailManifestPromise;
  }
  thumbnailManifestPromise = fetch(cgiPath + "?mode=thumb_manifest&id=" + encodeURIComponent(fileId), { cache: "no-store" })
    .then(function(res){
      if (!res.ok) {
        return null;
      }
      return res.json();
    })
    .then(function(manifest){
      if (!manifest || !manifest.enabled) {
        return null;
      }
      thumbnailManifest = manifest;
      return manifest;
    })
    .catch(function(){
      return null;
    });
  return thumbnailManifestPromise;
}

function roundThumbnailTime(seconds, manifest){
  const interval = (manifest && manifest.interval) ? manifest.interval : (thumbInterval || 30);
  const duration = manifest && manifest.duration ? manifest.duration : 0;
  let rounded = Math.round(Math.max(0, seconds || 0) / interval) * interval;
  if (duration > 0 && rounded >= duration) {
    rounded = Math.floor(Math.max(0, duration - 0.001) / interval) * interval;
  }
  return Math.max(0, rounded);
}

function thumbnailUrlFor(seconds, manifest){
  const rounded = roundThumbnailTime(seconds, manifest);
  if (manifest && manifest.url_template) {
    return manifest.url_template.replace("{time}", encodeURIComponent(String(rounded)));
  }
  return cgiPath + "?mode=thumb&id=" + encodeURIComponent(fileId) + "&t=" + encodeURIComponent(String(rounded));
}

function requestThumbnailWorkerStart(){
  if (thumbnailWorkerStarted) {
    return;
  }
  thumbnailWorkerStarted = true;
  loadThumbnailManifest().then(function(manifest){
    if (!manifest || !manifest.worker_start_url || manifest.complete) {
      return;
    }
    fetch(manifest.worker_start_url, { cache: "no-store" }).catch(function(){});
  });
}

function showSeekPreview(video){
  if (playbackMode !== "vod") {
    return;
  }
  const els = getSeekPreviewElements();
  if (!els.root || !els.image || !els.time) {
    return;
  }
  if (seekPreviewHideTimer) {
    clearTimeout(seekPreviewHideTimer);
    seekPreviewHideTimer = null;
  }

  const seconds = Number.isFinite(video.currentTime) ? video.currentTime : startPosition;
  els.time.textContent = formatLivestreamTime(seconds);
  els.root.style.display = "block";

  // シーク先の静止画で待ち時間を受けるルン
  loadThumbnailManifest().then(function(manifest){
    if (!manifest) {
      return;
    }
    const requestId = ++seekPreviewRequestId;
    const url = thumbnailUrlFor(seconds, manifest);
    els.image.onload = function(){
      if (requestId === seekPreviewRequestId) {
        els.image.style.visibility = "visible";
      }
    };
    els.image.onerror = function(){
      if (requestId === seekPreviewRequestId) {
        els.image.style.visibility = "hidden";
      }
    };
    els.image.style.visibility = "hidden";
    els.image.src = url;
  });
}

function hideSeekPreviewSoon(delay){
  const els = getSeekPreviewElements();
  if (!els.root) {
    return;
  }
  if (seekPreviewHideTimer) {
    clearTimeout(seekPreviewHideTimer);
  }
  seekPreviewHideTimer = setTimeout(function(){
    els.root.style.display = "none";
  }, delay);
}

function setupSeekPreview(video){
  if (playbackMode !== "vod") {
    return;
  }
  loadThumbnailManifest().then(function(){
    requestThumbnailWorkerStart();
  });
  video.addEventListener('seeking', function(){
    showSeekPreview(video);
  });
  video.addEventListener('waiting', function(){
    if (!video.ended) {
      showSeekPreview(video);
    }
  });
  video.addEventListener('seeked', function(){
    hideSeekPreviewSoon(500);
  });
  video.addEventListener('playing', function(){
    hideSeekPreviewSoon(300);
    requestThumbnailWorkerStart();
  });
}

function startPlayback(video, src){
  if (Hls.isSupported()) {
    const config = {
      // VODモードでは開始位置指定があればそこから再生
      startPosition: startPosition > 0 ? startPosition : -1,
      // 過剰な先読みはサーバー側の待機ワーカーを消費するため抑制する
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      // 未エンコードセグメントはゲートウェイが完成まで応答を保留する(最大30秒)
      // ため、タイムアウトとリトライを緩めに設定する
      fragLoadPolicy: {
        default: {
          maxTimeToFirstByteMs: 45000,
          maxLoadTimeMs: 60000,
          timeoutRetry: { maxNumRetry: 4, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
          errorRetry: { maxNumRetry: 8, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
        },
      },
      debug: false,
    };
    const hls = new Hls(config);
    hls.loadSource(src);
    hls.attachMedia(video);
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    // iPhone/iPad Safari ネイティブHLS
    video.src = src;
    if (startPosition > 0) {
      video.addEventListener('loadedmetadata', function(){
        try { video.currentTime = startPosition; } catch(e) {}
      }, { once: true });
    }
  } else {
    alert("HLS再生非対応のブラウザです");
    return;
  }
  document.getElementById('movie_title').style.display = "none";
  document.getElementById('progress').style.display = "none";
  video.play();
}

async function initPlayer(){
  const video = document.getElementById('video');
  const videoSrc = themeDir + "/theme/hls/" + user + "/index.m3u8";
  const sleep = waitTime => new Promise( resolve => setTimeout(resolve, waitTime) );
  setupSeekPreview(video);

  if (playbackMode === "vod") {
    // VODプレイリストは即座に提供される。最初のセグメント取得は
    // サーバー側で準備完了までブロックされるためそのまま再生開始してよい
    startPlayback(video, videoSrc + "?" + Date.now());
    return;
  }

  // eventフォールバック: 最初のセグメントがプレイリストに現れるまで待つ
  for(;;){
    try {
      const res = await fetch(videoSrc + "?" + Date.now(), { cache: "no-store" });
      if (res.ok) {
        const text = await res.text();
        if (text.match(/0000\.ts/)) { break; }
      }
    } catch(e) {
      // エンコード開始直後はプレイリスト未生成のため404になり得る
    }
    await sleep(700);
  }
  startPlayback(video, videoSrc + "?" + Date.now());
}

initPlayer();
