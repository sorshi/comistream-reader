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
