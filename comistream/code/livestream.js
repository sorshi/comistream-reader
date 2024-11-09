/**
 * Comistream Reader - Livestream JavaScript
 *
 * Comistream Reader のコア機能を提供するJavaScriptファイル。
 * ページめくり、画像プリロード、ビューワー制御などの
 * フロントエンド機能を実装しています。
 *
 * @package     sorshi/comistream-reader
 * @author      Comistream Project.
 * @copyright   2024 Comistream Project.
 * @license     GPL3.0 License
 * @version     1.0.0
 *
 * 主な機能:
 * - 
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
  stop_task();
});

setTimeout(async function(){
  const videoSrc=themeDir+"/theme/hls/"+user+"/index.m3u8";
  const video=document.getElementById('video');
  const sleep = waitTime => new Promise( resolve => setTimeout(resolve, waitTime) );

  var xmlHttp = new XMLHttpRequest();

  var now = new Date();
  xmlHttp.open("GET", videoSrc+"?"+now.getTime(), false);
  xmlHttp.send(null);

  while( !xmlHttp.responseText.match(/0000\.ts/) ){
    now = new Date();
    xmlHttp.open("GET", videoSrc+"?"+now.getTime(), false);
    xmlHttp.send(null);
    await sleep(700);
  }

  stop_task()
  now = new Date();
  if (Hls.isSupported()) {
    const config = {
      // manifestLoadingMaxRetry: 5, // HLSマニフェストの再読み込み試行回数
      // manifestLoadingMaxRetryTimeout: 1000, // 再読み込み試行の間隔(ミリ秒)
      // startFromLevel: 0, // 再生を0番目のレベル(最高品質)から開始する
      startPosition: 0, // 先頭から再生
      debug: false,
    };
    var hls = new Hls(config);
    hls.loadSource(videoSrc+"?"+now.getTime());
    hls.attachMedia(video);
  }else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = videoSrc+"?"+now.getTime();
  }
  document.getElementById('movie_title').style.display="none";
  document.getElementById('progress').style.display="none";
  video.play();
},3000);


// HLSエンコード進捗表示
async function showEncdeProgress() {
  sseSource = new EventSource("/livestream_progress_sse.php?u="+user);
  sseSource.onmessage = function(event) {
    let result = JSON.parse(event.data);
    // console.log("New message", result.message);
    add_log(result.message);
  };
  sseSource.addEventListener('error', function(e) {
    add_log('Error occured');
    console.error("Error occured");
    sseSource.close();
  });
}

function stop_task() {
  // 追加のファイルが必要なため一旦停止
  // sseSource.close();
}

function add_log(message) {
  document.getElementById("progress").innerHTML += message + "<br>";
}

// ロードされたらHLSエンコード進捗表示開始
// 追加のファイルが必要なため一旦停止
// window.addEventListener("load", (event) => {
//   showEncdeProgress();
// });

