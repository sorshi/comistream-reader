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
 * @version     1.0.0
 *
 * 主な機能:
 * - ページめくり制御
 * - 画像プリロード
 * - 自動ページ分割
 * - フルスクリーン制御
 * - キーボードショートカット
 * - タッチ操作対応
 */

class PreCache {
  constructor(size) {
    this.buffer = new Array(size);
    this.size = size;
    this.start = 0;
    this.end = 0;

    //this.currentPage = 0;
    //this.preloadPages = size; // 初期先読みページ数
    this.pageLoadTimes = []; // ページめくり速度の記録
    this.networkSpeed = 0; // ネットワーク帯域
    this.networkSpeedKBps = 0;
    this.adjustPreloadPages();
  }

  async addOld(imageUrl) {
    let img = new Image();
    img.src = imageUrl;
    await new Promise((resolve) => (img.onload = resolve));
    this.buffer[this.end] = img;
    this.end = (this.end + 1) % this.size;
    if (this.end === this.start) {
      this.start = (this.start + 1) % this.size;
    }
  }

  async add(imageUrl) {
    let img = new Image();
    img.src = imageUrl;

    let fileSizeInBytes;
    let startTime = performance.now();

    await new Promise((resolve, reject) => {
      img.onload = async () => {
        let canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext('2d').drawImage(img, 0, 0);

        await new Promise(resolve =>
          canvas.toBlob(function(blob) {
            fileSizeInBytes = blob.size;
            resolve();
          })
        );

        let endTime = performance.now();
        let durationInMSeconds = (endTime - startTime);
        let bandwidthInKbps = (fileSizeInBytes * 4) / durationInMSeconds; // fileSizeInBytesがなぜか倍のサイズになっている？
        debugLog("DEBUG fileSizeInBytes: "+fileSizeInBytes+" durationInMSeconds:"+durationInMSeconds);

        this.networkSpeedKBps = bandwidthInKbps.toFixed(2);
        this.networkSpeed = bandwidthInKbps/20000; // ナゾ単位

        debugLog("Bandwidth: "+bandwidthInKbps.toFixed(2)+" Kbps");

        // TODO 拡大すると先読みキャッシュに歯抜けが生じる
        this.adjustPreloadPages();

        resolve();
      };

      img.onerror = () => {
        reject(new Error('Image load error'));
      };
    });
  }

  get(index) {
    if (index >= this.size || index < 0) {
      throw new Error("Index out of bounds");
    }
    return this.buffer[(this.start + index) % this.size];
  }

  resize(newSize) {
    let newBuffer = new Array(newSize);
    for (let i = 0; i < Math.min(this.size, newSize); i++) {
      newBuffer[i] = this.buffer[(this.start + i) % this.size];
    }
    this.size = newSize;
    this.start = 0;
    this.end = Math.min(this.size, this.buffer.length);
    this.buffer = newBuffer;
  }

  getSize() {
    return this.size;
  }

  getBps() {
    return Math.floor(this.networkSpeedKBps);
  }

  // ページめくり速度の計測
  recordPageTurn() {
    const now = Date.now();
    if (this.lastPageTurnTime) {
      const turnTime = now - this.lastPageTurnTime;
      this.pageLoadTimes.push(turnTime);
      if (this.pageLoadTimes.length > 5) {
        this.pageLoadTimes.shift(); // 古いデータを削除
      }
    }
    this.lastPageTurnTime = now;
    this.adjustPreloadPages();
  }

  // ネットワーク帯域の測定(旧仕様 もう未使用なはず)
  measureNetworkSpeed() {
    const startTime = Date.now();
    fetch("/theme/bench/80KB.dat", {
      method: "GET",
      cache: "no-store",
    }).then(() => {
      const endTime = Date.now();
      const duration = endTime - startTime;
      if (duration > 0) {
        this.networkSpeed = 100 / duration; // 非常に単純な帯域計測
        this.networkSpeedKBps = (80 * 1024 * 8) / duration; // 80KBのファイル転送してるから
        debugLog("measureNetworkSpeed() " + this.networkSpeed + " startTime:" + startTime + " endTime:" + endTime + " duration:" + duration + "msec bandwidth:" + this.networkSpeedKBps + "Kbps");
      } else {
        debugLog("measureNetworkSpeed() duration is 0");
      }
      this.adjustPreloadPages();
    });
  }

  // 先読みページ数の調整
  adjustPreloadPages() {
    let averageTurnTime =
      this.pageLoadTimes.reduce((a, b) => a + b, 0) / this.pageLoadTimes.length;
    if (isNaN(averageTurnTime)) {
      averageTurnTime = 1000; // デフォルト値
      debugLog("adjustPreloadPages() default averageTurnTime:" + averageTurnTime);
    } else {
      debugLog("adjustPreloadPages() averageTurnTime:" + averageTurnTime);
    }

    // ページめくり速度に基づいて調整
    if (averageTurnTime < 1000) {
      this.size = 10;
    } else if (averageTurnTime < 2000) {
      this.size = 6;
    } else {
      this.size = 4;
    }
    this.resize(this.size);
    debugLog("Preloading read speed initial " + this.size + " pages");

    // ネットワーク帯域に基づいて調整
    // 80KBダウンロード 1で6.5Mbps 0.2で1280kbps 0.1で640kbps 0.05で320kbps 0.025で160kbps ← 旧仕様
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
    this.resize(this.size);
    debugLog("Preloading adjust " + this.size + " pages. networkSpeedKBps:"+this.networkSpeedKBps);
  }
}

  var preCaches  = new PreCache(global_preload_pages);
  var nextimage1 = new Image();
  var nextimage2 = new Image();
  var mode = 1;
  var indexName = ""; // 未使用?? コードには$indexが代入されてたけど見当たらない。削除漏れ?
  var tapFlag = false;
  var timer;
  var fixPage = 0;
  var startX, endX;
  var isSkipPageFwdFlag = false;
  var unixtime = 0;
  var timeout = null;
  // 拡張light wide split
  var req;
  var autoLightSplitMode = false; //false:縦長なのでそのまま true:横長を自動分割表示
  var virtratio = 100; //表示の縦比率
  var imagex = 0; //画像の横幅
  var imagey = 0; //画像の縦幅
  var als = ''; // Auto Light Split Mode使ってるかのクエリパラメータ
  var autoLightSplitModeViewPosition = 'right'; // 横長画像のどっち側表示しているか
  var xDown = null; // 2本指スワイプダウン検出用
  var yDown = null; // 2本指スワイプダウン検出用
  let globalDivImageUrl = '';

  window.addEventListener('keydown',funcKey);

  window.addEventListener('load', function(){
    setTimeout(scrollTo, 0, 0, 1);
  }, false);

  window.addEventListener('touchstart', function(evt){
    if (tapFlag) {
      evt.preventDefault();
    }else if( evt.changedTouches.length == 1 ){
      startX = evt.touches[0].pageX;
      endX = -1;
    }
  }, {passive: false});

  window.addEventListener('touchend', function(evt){
    if ( startX != -1 && endX != -1 ){
      if ( startX - endX < 0 ){
        leftward();
      }else if ( startX - endX > 0 ){
        rightward();
      }
    }else{
      tapFlag = true;
      clearTimeout(timer);
      timer = setTimeout(function() {tapFlag = false;}, 350);
    }
  }, {passive: false});

  window.addEventListener('touchmove', function(evt){
    if( document.getElementById("contents").style.display == "block" ){
      startX = -1;
      endX = -1;
    }else{
      endX = evt.touches[0].pageX;
    }
  }, {passive: false});

  window.addEventListener('gesturechange', function(evt){
    startX = -1;
    endX = -1;
  }, {passive: false});

  window.addEventListener('pagehide',saveCurrentPage);

  // 長押しでクイック見開きモード
  // https://github.com/john-doherty/long-press-event
  window.addEventListener('long-press', function(e) {
    // stop the event from bubbling up
    e.preventDefault();
    debugLog("long tap:"+ e.target);
    quickSpredView();
  });

  // 2本指スワイプダウン検出用
  document.addEventListener('touchstart', handleTouchStart, false);
  document.addEventListener('touchmove', handleTouchMove, false);

  function handleTouchStart(evt) {
      if(evt.touches.length == 2) {
          xDown = evt.touches[0].clientX;
          yDown = evt.touches[0].clientY;
      } else {
          xDown = null;
          yDown = null;
      }
  };

  function handleTouchMove(evt) {
      if ( ! xDown || ! yDown ) {
          return;
      }

      var xUp = evt.touches[0].clientX;
      var yUp = evt.touches[0].clientY;

      var xDiff = xDown - xUp;
      var yDiff = yDown - yUp;

      if ( Math.abs( xDiff ) < Math.abs( yDiff ) ) {
          if ( yDiff > 0 ) {
              /* 上向きスワイプ */
          } else {
              /* 下向きスワイプ */
              showInspector();
          }
      }
      /* 値リセット */
      xDown = null;
      yDown = null;
  };

  document.onmousemove = function(){
    // マウスを一定時間操作してない場合はカーソル非表示に
    clearTimeout(timeout);
    if (document.body.classList.contains('cursor-hide')) {
      document.body.classList.remove('cursor-hide');
      let elements = document.querySelectorAll('td.center');
      elements.forEach((element) => {
        element.style.cursor = `var(--setting-url), help`;
      });
      elements = document.querySelectorAll('td.right, td.right-under');
      elements.forEach((element) => {
        element.style.cursor = `var(--arrowR-url), e-resize`;
      });
      elements = document.querySelectorAll('td.left, td.left-under');
      elements.forEach((element) => {
        element.style.cursor = `var(--arrowL-url), w-resize`;
      });
      elements = document.querySelectorAll('td.rightIndex');
      elements.forEach((element) => {
        element.style.cursor = `var(--nextR-url), e-resize`;
      });
      elements = document.querySelectorAll('td.leftIndex');
      elements.forEach((element) => {
        element.style.cursor = `var(--nextL-url), w-resize`;
      });
      debugLog("cursor show");
    }
    timeout = setTimeout(function() {
      document.body.classList.add('cursor-hide');
      let elements = document.querySelectorAll('td.center, td.right, td.right-under, td.left, td.left-under, td.rightIndex, td.leftIndex');
      elements.forEach((element) => {
        element.style.cursor = 'none';
      });
      debugLog("cursor-hide");
    }, 2000);
  }


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
  if(direction == 90) {
    // 横向きの処理
    debugLog("direction Landscape");
    quickSpredView();
  } else {
    // 縦向きの処理
    debugLog("direction Portrait");
    quickSpredView();
  }
  });

  window.onfocus = function() {
    // ズームレベルをリセット
    document.body.style.zoom = 1;
  };

// 以下関数定義

function saveCurrentPage(){
  // ページ離脱時に最終ページ保存
  let localPage = page;
  if( mode == 2 ){ localPage = page + 1 };
  if( page >= maxPage ){
    document.cookie = "lastCloseFile="+baseFile+"; path=/;";
  }else{
    document.cookie = "lastCloseFile=; path=/; max-age=0";
  }
  debugLog("saveCurrentPage(); current page:"+page);
  let data = new FormData();
  data.append('mode', 'close');
  data.append('file', escapedFile);
  data.append('page', localPage);
  navigator.sendBeacon("comistream.php", data );
}

function jump(){
  nextpage = window.prompt("移動するページを入力 (1-"+maxPage+")",page);
  if ( nextpage.match(/^[0-9]+\$/) && nextpage>0 && nextpage<=maxPage ){
    page=nextpage;
    loadPage(1);
  }
}

function leftward(){
  if( direction == "left" ) next(); else back();
}

function rightward(){
  if( direction == "left" ) back(); else next();
}

function leftIndex(){
  if( direction == "left" ) nextIndex(); else backIndex();
}

function rightIndex(){
  if( direction == "left" ) backIndex(); else nextIndex();
}

function next(){
  if (document.getElementById("image").style.backgroundPosition.includes('right')) {
    document.getElementById("image").style.backgroundPosition = 'left'
    autoLightSplitModeViewPosition = 'left';
  }else{
    if((page+mode)<=maxPage){
      page=page+mode;
      // 別デバイスでページを読み進んでいたら移動する
      let now = Math.floor( new Date().getTime() / 1000);
      if( (now - unixtime) > 60){
        // 過去同期時刻から60秒以上経過していたら同期確認
        debugLog("next() call devicePageSync() now:"+parseInt(now)+" unixtime:"+parseInt(unixtime));
        devicePageSync();
        //devicePageSyncNew();
        unixtime = Math.floor( new Date().getTime() / 1000);
        debugLog("next() page "+parseInt(page));
      }else{
        // 経過時間が60秒以内の場合はパフォーマンス向上のため同期確認しない
        debugLog("next() do nothing now:"+parseInt(now)+" unixtime:"+parseInt(unixtime));
      }
      loadPage(1);
      window.scroll({top: 0, behavior: 'smooth' });
      if(autoLightSplitMode == true){
        document.getElementById("image").style.backgroundPosition = 'right';
        autoLightSplitModeViewPosition = 'right';
      }
    }else{
      debugLog("next(); current page:"+page+" max page:"+maxPage+" mode:"+mode);
      $("#suggest").dialog({ width: "auto", height: "auto",title: "Next Book" })
    }
  }
}

function back(){
  if (document.getElementById("image").style.backgroundPosition.includes('left')) {
    document.getElementById("image").style.backgroundPosition = 'right'
    autoLightSplitModeViewPosition = 'right';
  }else{
    if(page>1){
      page=page-mode;
      loadPage(-1);
      if(autoLightSplitMode == true){
        document.getElementById("image").style.backgroundPosition = 'left';
        autoLightSplitModeViewPosition = 'left';
      }
    }else{
      debugLog("back(); current page:"+page+" max page:"+maxPage+" mode:"+mode);
      if (window.confirm("最終ページです。リーダーを閉じますか？")) {
        backListPage();
      }
    }
  }
}

function nextIndex(){
  for(var i=0; i<indexArray.length; i++){
    if(page+mode-1 < indexArray[i]){
      page=indexArray[i];
      loadPage(1);
      return true;
    }
  }
}

function backIndex(){
  for(var i=indexArray.length; i>=0; i--){
    if(page > indexArray[i]){
      page=indexArray[i];
      loadPage(1);
      return true;
    }
  }
}

async function devicePageSync(){
  //別デバイスでのページが読み進んでないかページ番号を返す
  debugLog("devicePageSync() current page:"+page+" max page:"+maxPage+" isSkipPageFwdFlag:"+isSkipPageFwdFlag);
  if(( page > 0 )&&(!isSkipPageFwdFlag)){
    try {
      const response = await fetch(
        "comistream.php?mode=currentPage&file="+escapedFile,
      );
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      let restxt = await response.text();
      let res = await parseInt(restxt);
      debugLog("devicePageSync() restxt:"+restxt);
      debugLog("devicePageSync() res:"+res);
      if( (res > page)&&(res > 1) ){
        debugLog("devicePageSync() res:"+parseInt(res)+" larger page:"+parseInt(page));
        if (window.confirm("別デバイスで"+parseInt(res)+"ページまで読み進んでいます。移動しますか？")) {
          page=res;
          debugLog("devicePageSync() Jump to "+parseInt(page));
          loadPage(1);
        }else{
          debugLog("devicePageSync() Jump canceled ");
          isSkipPageFwdFlag = true;
        }
      }
    } catch (error) {
      console.error(`Could not get products: {$error}`);
    }
  }
}

function loadPage(dir){
  debugLog("current page:"+page+" max page:"+maxPage);
  if(page == 1){
    // 表紙はそのまま出す
    autoLightSplitMode = false;
    // changeAutoLightSplitMode(autoLightSplitMode);
  }
  // 現在ページを保存
  saveCurrentPage();
  if( mode == 2 ){
    if( page%2 == 1 ) page--;
    page=page+fixPage;
  }else if( mode == 1 && page <= 0 ){
    page=1;
  };
  window.localStorage.setItem(file, String(page));
  window.localStorage.setItem("pagemode", String(mode));

  if( document.getElementById("contents").style.display == "block" ) setSlider();

  document.getElementById("progress").style.width=(page/maxPage)*100+"%";

  if( page > 0 ) {

    // トリミング実行（重いため未使用）
    //var image = new Image();
    //image.src = "comistream.php?file={$file}&size={$size}&page="+page+"$view_query";
    //image.onload = function() {
    //  var trimmedImageUrl = trimImage(image);
    //  document.getElementById("image").style.backgroundImage = 'url(' + trimmedImageUrl + ')';
    //};

    debugLog("loadPage() autoLightSplitMode:"+autoLightSplitMode);
    if(autoLightSplitMode){
      als = '&als=1';
    }else{
      als = '';
    }
    // ページめくり速度計測
    preCaches.recordPageTurn();

    document.getElementById("image").style.backgroundImage="url(comistream.php?file="+file+"&size="+size+"&page="+page+view_query+als+")";
    globalDivImageUrl = getFullImageUrl(page);
    debugLog("loadPage() globalDivImageUrl:"+globalDivImageUrl);

    // 自動ページ分割機能(Auto Light Split)設定
    (async () => {
      //画面が横長の場合は画像が横長でも分割しない
      // TODO restorePageに類似処理
      const offsetx = document.getElementById("image").offsetWidth;
      const offsety = document.getElementById("image").offsetHeight;
      const naturalx = document.getElementById("image").naturalWidth;
      const naturaly = document.getElementById("image").naturalHeight;
      debugLog("loadPage() offset: %d x %d  natural: %d x %d ",offsetx,offsety,naturalx,naturaly);
      if (document.getElementById("image").offsetWidth > document.getElementById("image").offsetHeight){
        autoLightSplitMode = false;
      }else if(page == 1){
        // 表紙はそのまま出す
        autoLightSplitMode = false;
        changeAutoLightSplitMode(autoLightSplitMode);
      }else if(autoSplit == "off"){
        // オプションで停止されてるときはそのまま出す
        autoLightSplitMode = false;
      }else if(mode == 2){
        // 見開き表示モードの場合は自動分割しない
        autoLightSplitMode = false;
      }else{
        autoLightSplitMode = await isLandscape("image");
        changeAutoLightSplitMode(autoLightSplitMode);
      }
    })();

  }else{
    document.getElementById("image").style.backgroundImage="none";
  }

  if( mode == 2 ){
    if( page < maxPage ) {
      document.getElementById("nextimage").style.backgroundImage="url(comistream.php?file="+file+"&size="+size+"&page="+(1+parseInt(page))+view_query+als+")";
    }else{
      document.getElementById("nextimage").style.backgroundImage="none";
    }
  }

  nextpage = dir*mode+page;
  if( nextpage > 0 && nextpage <= maxPage ){
    nextimage1.src = "comistream.php?file="+file+"&size="+size+"&page="+nextpage+view_query+als;
      // if( document.getElementById("splitFile").classList.contains('normal') ){
        // 非分割モード時の先読み処理
        // モード関係なく常に先読みキャッシュ有効に
      // }else{
        // 分割モード時の先読み処理
        if (Math.abs(prevPage - page) > 3  ){
          // 3ページ以上離れていたら再先読みを実行
          setTimeout(() => {
            preLoadInitialImages(nextpage);
          }, global_preload_delay_ms);
        }else{
          if(nextpage + preCaches.getSize() <= maxPage){
            // なんか初期ロード時に23ページとか関係ないところ読むバグ対策（場当たり的）
            if((preCaches.getSize() - nextpage) > 15){
              debugLog("preLoadImages() SKIP:"+preCaches.getSize());
            }else{
              preLoadImages(nextpage + preCaches.getSize());
            }
          }
        }
        prevPage = page;
      // }
    if( mode == 2 ) nextimage2.src="comistream.php?file="+file+"&size="+size+"&page="+(1+parseInt(nextpage))+view_query+als;
  }else{
    // console.log("nextpage else");
  }
  document.getElementById("loading").style.display="none";
}

// 分割モード時の先読み処理
function preLoadImages(nextpage) {
  //let nextpage = dir*mode+page;
  if( nextpage > 0 && nextpage <= maxPage ){
    let nextImageUrl = "comistream.php?file="+file+"&size="+size+"&page="+nextpage+view_query+als;
    // preCaches.recordPageTurn();
    debugLog("preLoadImages() add:"+nextpage);
    // console.trace('スタックトレースを表示');
    preCaches.add(nextImageUrl);
    // preCaches.measureNetworkSpeed();
  }
}

// 初期ロード時の先読み処理
async function preLoadInitialImages(startPage) {
  for(let i = 1; i <= preCaches.getSize(); i++) {
    let nextpage = startPage + i;
    if(nextpage > 0 && nextpage <= maxPage) {
      let nextImageUrl = "comistream.php?file="+file+"&size="+size+"&page="+nextpage+view_query+als;
      debugLog("preLoadInitialImages() add:"+nextpage);
      await preCaches.add(nextImageUrl);
    }
  }
}

function restorePage(){
  if( page == 1 ){
    page=parseInt(window.localStorage.getItem(file) || page);
  }
  mode=parseInt(window.localStorage.getItem("pagemode") || mode);
  if( mode == 2 ){
    spread();
  }else{
    document.getElementById("spread").style.display="block";
    document.getElementById("single").style.display="none";
    loadPage(1);
  }
  if( indexName != "" ){
    Array.prototype.forEach.call(document.getElementsByClassName("toclink"), function(elm){
      if( elm.innerHTML.indexOf(indexName) != -1 ){
        elm.onclick();
      }
    });
  }

  // 自動ページ分割機能(Auto Light Split)設定
  (async () => {
    //画面が横長の場合は画像が横長でも分割しない
    // TODO loadPageに類似処理
    if (document.getElementById("image").offsetWidth > document.getElementById("image").offsetHeight){
      autoLightSplitMode = false;
    }else if(page == 1){
      autoLightSplitMode = false;
    }else if(autoSplit == "off"){
      autoLightSplitMode = false;
    }else if(mode == 2){
      // 見開き表示モードの場合は自動分割しない
      autoLightSplitMode = false;
    }else{
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
}

function index(){
  if( document.getElementById("contents").style.display == "block" ){
    document.getElementById("contents").style.display="none";
  }else{
    document.getElementById("contents").style.display="block";
    setSlider();

    var slider = document.querySelector('input[type="range"]');
    slider.addEventListener("input", function() {
      valueChange();
    }, false);

    slider.addEventListener("change", function() {
      valueChange();
      page = parseInt(document.getElementById("slider").value);
      document.getElementById("loading").style.display="block";
      loadPage(1);
    }, false);
  }
}

function setSlider(){
  document.getElementById("slider").value = page;
  valueChange();
}

function valueChange(){
  document.getElementById("value").innerHTML = document.getElementById("slider").value;
}

function single(){
  document.getElementById("spread").style.display="block";
  document.getElementById("single").style.display="none";

  mode=1;
  document.getElementById("image").style.width="100%";
  document.getElementById("image").style.backgroundPosition="center";
  document.getElementById("image").style.float="none";
  document.getElementById("nextimage").style.display="none";
  loadPage(1);
}

function spread(){
  document.getElementById("spread").style.display="none";
  document.getElementById("single").style.display="block";

  mode=2;
  document.getElementById("image").style.width="50%";
  document.getElementById("image").style.backgroundPosition=direction;
  document.getElementById("image").style.float=position;
  document.getElementById("nextimage").style.display="block";
  document.getElementById("nextimage").style.backgroundPosition=position;
  document.getElementById("nextimage").style.float=direction;
  loadPage(1);
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

function fixSpreadPage(){
  fixPage=1-fixPage;
  loadPage(1);
}

function toggleFullScreen() {
  if (
    document.fullscreenElement ||
    document.mozFullScreenElement ||
    document.webkitFullscreenElement ||
    document.msFullscreenElement
  ) {
    if (document.cancelFullScreen) {
      document.cancelFullScreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    } else if (document.webkitCancelFullScreen) {
      document.webkitCancelFullScreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
    document.getElementById("fullScreenButton").classList.remove("pressed");
  } else {
    if (document.documentElement.webkitRequestFullscreen) {
      document.documentElement.webkitRequestFullscreen();
      document.getElementById("fullScreenButton").classList.add("pressed");
    } else if (document.documentElement.mozRequestFullScreen) {
      document.documentElement.mozRequestFullScreen();
      document.getElementById("fullScreenButton").classList.add("pressed");
    } else if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen();
      document.getElementById("fullScreenButton").classList.add("pressed");
    } else if (document.documentElement.msRequestFullscreen) {
      document.documentElement.msRequestFullscreen();
      document.getElementById("fullScreenButton").classList.add("pressed");
    } else {
      alert("フルスクリーン非対応");
    }
  }
}

function toggleDirection(){
  if( direction == "left" ){
    direction = "right";
    position = "left";
    document.getElementById("progress").className = "progress-right";
    document.getElementById("slider").style.transform = "rotateY(0deg)";
  }else{
    direction = "left";
    position = "right";
    document.getElementById("progress").className = "progress-left";
    document.getElementById("slider").style.transform = "rotateY(180deg)";
  }
  if( mode == 2 ) spread();
}

function funcKey(evt){
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
  // 2本指スワイプダウン : インスペクター表示

  debugLog("funcKey(); key event:"+evt.code);
  if (evt.code == "Space" || evt.keyCode === 32) {
    // クイック見開きモード表示
    quickSpredView();
  }else if (evt.code == "KeyI") {
    // インスペクター表示
    showInspector();
  }else{
    // モーダル表示中は閉じる
    document.getElementById("modal").style.display = "none";
    document.getElementById("overlay").style.display = "none";
    // インスペクター表示中は閉じる
    document.getElementById("inspector").style.display = "none";
    while (document.getElementById("inspector").firstChild) {
      document.getElementById("inspector").removeChild(document.getElementById("inspector").firstChild);
    }
  }
  if( evt.code == "ArrowLeft" && evt.shiftKey ) leftIndex();
  else if( evt.code == "ArrowLeft" && evt.ctrlKey ) { page=maxPage; loadPage(1); }
  else if( evt.code == "ArrowLeft" ) leftward();
  if( evt.code == "ArrowRight" && evt.shiftKey ) rightIndex();
  else if( evt.code == "ArrowRight" && evt.ctrlKey ) { page=1; loadPage(1); }
  else if( evt.code == "ArrowRight" ) rightward();
  if( evt.code == "Escape" ) index();
  if( evt.key == "1" || evt.code == "Digit1" || evt.code == "Numpad1") single();
  if( evt.key == "2" || evt.code == "Digit2" || evt.code == "Numpad2") spread();
  if( evt.code == "Backspace" || evt.code == "Delete" ) backListPage();
  if( evt.code == "Period" || evt.keyCode === 190) { page=1; loadPage(1); } // >
  if( evt.code == "Comma" || evt.keyCode === 188) { page=maxPage; loadPage(1); } // <
  if( evt.code == "ArrowDown" ) leftward();
  if( evt.code == "ArrowUp" ) rightward();
}

function toggleRaw(){
  // 圧縮有無の切り替え
  let data = new FormData();
  data.append('mode', 'close');
  data.append('file', escapedFile);
  data.append('page', page);
  navigator.sendBeacon("comistream.php", data );
  let reload_url = location.href;
  if( document.getElementById("rawMode").classList.contains('raw') ){
    document.getElementById("rawMode").className = "button cmp";
    document.getElementById("rawMode").textContent = "圧縮";
    document.cookie = "rawMode=cmp; path=/; max-age=31536000";
    // console.log("size toggle cmp");
    // let reload_url = location.href.replace("&size=FULL", "");
    location.replace(reload_url);
  }else{
    document.getElementById("rawMode").className = "button raw";
    document.getElementById("rawMode").textContent = "フル";
    document.cookie = "rawMode=raw; path=/; max-age=31536000";
    // console.log("size toggle raw");
    // let reload_url = location.href + "&size=FULL";
    location.replace(reload_url);
  }
}

function toggleTrimmingFile(){
  // サーバー側で左右余白トリミングするモード（旧:見開きサイズ画像ファイルの左右分割表示モード）
  let data = new FormData();
  data.append('mode', 'close');
  data.append('file', escapedFile);
  data.append('page', page);
  if( document.getElementById("splitFile").classList.contains('normal') ){
    // 左右余白トリミングモードへ
    // page = page*2;
    navigator.sendBeacon("comistream.php", data );
    document.getElementById("splitFile").className = "button trimming";
    document.getElementById("splitFile").textContent = "全体";
    // console.log("toggleTrimmingFile() normal to split");
    let reload_url = location.href + "&view=trimming";
    // (reload_url);
    location.replace(reload_url);
  }else{
    // 通常表示モードへ
    // page = Math.floor((page+1)/2);
    navigator.sendBeacon("comistream.php", data );
    document.getElementById("splitFile").className = "button normal";
    document.getElementById("splitFile").textContent = "余白";
    // console.log("toggleTrimmingFile() split to normal");
    let reload_url = location.href.replace("&view=trimming", "");
    // console.log(reload_url);
    location.replace(reload_url);
  }
}

//読み終えたときに続刊、関連書籍を表示するためのデータを取得
function sugguestbook() {
  debugLog("sugguestbook(); start ajax");
  $.ajax({
    type:'GET',
    url: '/suggest.php',
    dataType: "json",
    data: {booktitle: baseFile}
  })
  .done(function(data){
    var data_stringify = JSON.stringify(data);
    var data_json = JSON.parse(data_stringify);
    Object.keys(data_json.title.new).forEach(function (key) {
        addnextbooklist(key,data_json.title.new[key])
      })
    $("#suggest").append("<p><img src=\""+themeDir+"/theme/icons/book.png\" /><b>"+baseFile+"</b><span style=\"color:#5674b9\">　now reading</span></p>")
    Object.keys(data_json.title.old).forEach(function (key) {
        addnextbooklist(key,data_json.title.old[key])
      })
    Object.keys(data_json.author).forEach(function (key) {
        addnextbooklist(key,data_json.author[key])
      })
    })
    .fail( (jqXHR, textStatus, errorThrown) => {
      debugLog("Ajax errored");
      debugLog("jqXHR          : " + jqXHR.status); // HTTPステータスを表示
      debugLog("textStatus     : " + textStatus);    // タイムアウト、パースエラーなどのエラー情報を表示
      debugLog("errorThrown    : " + errorThrown.message); // 例外情報を表示
      $("#suggest").append("<p><img src=\""+themeDir+"/theme/icons/book.png\" /><b>"+baseFile+"</b><span style=\"color:red\">　no suggest</span></p>")
    })
    ;
}

//続刊へ移動
function toNextBook(nextlocation) {
  location.replace(nextlocation);
}

//続刊リストのURL作成
function addnextbooklist(nexttitle,nextlocation) {
  let shareroot = publicDir;
  let sizeOption = "";
  // let nowlocation = location.href;
  if( document.getElementById("rawMode").classList.contains('raw') ){
    // sizeOption = "&size=FULL";
  }else{
    // sizeOption = "";
  }
  const encodeOpenFilePath = encodeURIComponent(nextlocation.substring(shareroot.length + 1));
  debugLog("addnextbooklist(); encodeOpenFilePath:" + encodeOpenFilePath);
  let nexttag = "<p><img src=\""+themeDir+"/theme/icons/book.png\" /><a href=\"" + "javascript:toNextBook('" + location.pathname + "?file=" + encodeOpenFilePath + "&mode=open" + sizeOption + "')\">" + nexttitle + "</a></p>";
  debugLog("addnextbooklist(); nexttag:"+nexttag);
  $("#suggest").append(nexttag);
}

async function isLandscape(checkdivid) {
  //canvasの画像の縦横のどちらが長いかを判定 true:横長 false:縦長
  let divId = checkdivid;
  let bgImageUrl = window.getComputedStyle(document.getElementById(divId)).backgroundImage;
  if (bgImageUrl == null){
    return false;
  }
  bgImageUrl = globalDivImageUrl;
  let image =  await load_image(bgImageUrl);
  // imageがnullならfalseを返す
  if (image == null) {
    return false;
  }
  imagex = image.width;
  imagey = image.height;
  let ret = (image.width < image.height) ? false : true;
  cutrate = 1;
  if (ret){
    cutrate = 2;
  }
  virtratio = ((window.innerWidth / (image.width / cutrate)) < (window.innerHeight / image.height) ? window.innerWidth / (image.width / cutrate) : window.innerHeight / image.height);
  debugLog("isLandscape(); "+ret+" width:" + imagex+ " height:" +imagey+ " virtratio:"+virtratio+" Aspect:"+ image.width / image.height +" Page:"+page+" bgImageUrl:"+bgImageUrl);
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

async function load_image(path){
  //画像読み込み関数（読み込み完了を待つために使用）
  const t_img = new Image();
  return new Promise(
    (resolve) => {
      t_img.onload = () => {
        resolve(t_img);
      }
      t_img.src = path;
    }
  )
}

function changeAutoLightSplitMode(autoLightSplitMode) {
  //表示を単ページのままか半分に分割表示するかを設定（横長画像の時に半分に分割するために使用） 自動ページ分割機能(Auto Light Split)
  let imgurl = window.getComputedStyle(document.getElementById("image")).backgroundImage; // url("...")形式
  imgurl = extractURLFromStyleString(imgurl);
  let campusdiv = document.getElementById("image");
  if (autoLightSplitMode){
    // 横長画像を半分に分割して表示
    // campusdiv.style.width = '100%';
    campusdiv.style.height = '100%';
    campusdiv.backgroundImage  = "url(" + imgurl + ")";
    // campusdiv.style.backgroundPosition = 'right';
    campusdiv.style.backgroundPosition = autoLightSplitModeViewPosition;
    campusdiv.style.backgroundRepeat = 'no-repeat';
    campusdiv.style.backgroundSize = Math.trunc(virtratio * imagex) + 'px ' +  Math.trunc(virtratio * imagey) +  'px';
    divwith = (virtratio * imagex /2) < window.innerWidth ? Math.trunc(virtratio * imagex /2 ) : window.innerWidth;
    campusdiv.style.width = divwith + 'px';
    if (window.innerWidth > divwith) {
      campusdiv.style.marginLeft=Math.trunc((window.innerWidth - divwith ) /2) +"px";
    }
    debugLog("Landscape:auto split image");
  } else {
    //縦長画像をそのまま表示
    campusdiv.style.width = '100%';
    campusdiv.style.height = '100%';
    campusdiv.backgroundImage  = "url(" + imgurl + ")";
    campusdiv.style.backgroundPosition = 'center';
    campusdiv.style.backgroundRepeat = 'no-repeat';
    campusdiv.style.backgroundSize = 'contain';
    debugLog("Portrait:not split image");
  }
}

function trimImage(image) {
  //画像のトリミング（重かったので未使用）
    var canvas = document.createElement('canvas');
    var context = canvas.getContext('2d');

    canvas.width = image.width;
    canvas.height = image.height;

    context.drawImage(image, 0, 0);

    var imageData = context.getImageData(0, 0, image.width, image.height);
    var data = imageData.data;

    var topLeftPixelColor = [data[0], data[1], data[2], data[3]];
    var topRightPixelColor = [data[(image.width - 1) * 4], data[(image.width - 1) * 4 + 1], data[(image.width - 1) * 4 + 2], data[(image.width - 1) * 4 + 3]];

    var left = image.width, right = 0;

    for (var y = 0; y < image.height; y++) {
        for (var x = 0; x < image.width; x++) {
            var i = (y * image.width + x) * 4;
            if ((data[i] === topLeftPixelColor[0] && data[i + 1] === topLeftPixelColor[1] && data[i + 2] === topLeftPixelColor[2] && data[i + 3] === topLeftPixelColor[3]) ||
                (data[i] === topRightPixelColor[0] && data[i + 1] === topRightPixelColor[1] && data[i + 2] === topRightPixelColor[2] && data[i + 3] === topRightPixelColor[3])) {
                data[i + 3] = 0;
            } else {
                if (x < left) left = x;
                if (x > right) right = x;
            }
        }
    }

    var trimmedCanvas = document.createElement('canvas');
    var trimmedContext = trimmedCanvas.getContext('2d');

    trimmedCanvas.width = right - left;
    trimmedCanvas.height = image.height;

    trimmedContext.putImageData(context.getImageData(left, 0, right - left, image.height), 0, 0);

    return trimmedCanvas.toDataURL();
}

function quickSpredView(){
  // スペースキーを押すとクイック見開きモード
  if(mode == 1){
    // 単ページモードしか動作させないように
    let overlay = document.getElementById("overlay");
    let modal = document.getElementById("modal");
    let image1 = document.getElementById("image1");
    let image2 = document.getElementById("image2");

    if (modal.style.display == "block") {
      // モーダル表示中はスペースキーでモーダルを閉じる
      modal.style.opacity = "0";
      overlay.style.opacity = "0";
      setTimeout(function() {
          modal.style.display = "none";
          overlay.style.display = "none";
      }, 150); // 0.15秒後に実行
    } else {
      if (autoLightSplitMode) {
        als = "&als=1";
        image1.src =
          "comistream.php?file="+file+"&size="+size+"&page=" +
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
          "comistream.php?file="+file+"&size="+size+"&page=" +
          quickWideLeftPageNo +
          view_query +
          als;
        // 見開き右側表示
        image2.style.width = "50%";
        image2.src =
          "comistream.php?file="+file+"&size="+size+"&page=" +
          quickWideRightPageNo +
          view_query +
          als;
        debugLog("keydown space LeftPage:" +quickWideLeftPageNo +" RightPage:" +quickWideRightPageNo +" direction:" +direction);
      }
      // 表示
      overlay.style.opacity = "0";
      modal.style.opacity = "0";
      overlay.style.display = "block";
      modal.style.display = "block";
      setTimeout(function() {
          overlay.style.opacity = "1";
          modal.style.opacity = "1";
      }, 50); // 少し遅延させてから実行
    }
  }else{
    debugLog("spred view mode mode:"+mode);
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
    // 新しい<ul>要素を作成します
    let list = document.createElement("ul");

    // 項目を作成し、リストに追加します
    const listItemArray = [
      "page",
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
    listItem.textContent = "アスペクト比:" + aspect;
    list.appendChild(listItem);

    listItem = document.createElement("li");
    listItem.textContent = "先読みページ数:" + preLoadCacheSize;
    list.appendChild(listItem);

    listItem = document.createElement("li");
    listItem.textContent = "ファイルサイズ:" + archiveFileMBytes + "MB";
    list.appendChild(listItem);

    listItem = document.createElement("li");
    listItem.textContent = "平均ページサイズ:" + averagePageKBytes + "KB";
    list.appendChild(listItem);

    listItem = document.createElement("li");
    listItem.textContent = "Network Speed:" + networkSpeedKBps.toLocaleString() + "Kbps";
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
    url.searchParams.append("view", viewQuery.replace('&view=', '')); // '&view='を取り除く
  }

  if (autoLightSplitMode) {
    url.searchParams.append("als", "1");
  }

  return url.href;
}

// 時計の表示/非表示を切り替える関数
function toggleClock() {
  const clock = document.getElementById('clock');
  const clockButton = document.getElementById('clockToggleButton');

  if (clock.classList.contains('clock-hidden')) {
    // 時計を表示
    clock.classList.remove('clock-hidden');
    clockButton.classList.add('pressed');
    // ローカルストレージに設定を保存
    localStorage.setItem('clockDisplay', 'show');
    // 時計の更新を開始
    updateClock();
    // 1秒ごとに時計を更新
    clockTimer = setInterval(updateClock, 1000);
  } else {
    // 時計を非表示
    clock.classList.add('clock-hidden');
    clockButton.classList.remove('pressed');
    // ローカルストレージに設定を保存
    localStorage.setItem('clockDisplay', 'hide');
    // 時計の更新を停止
    clearInterval(clockTimer);
  }
}

// 時計の表示を更新する関数
function updateClock() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('clock').textContent = `${hours}:${minutes}`;
}

// ページ読み込み時に時計の設定を復元する
window.addEventListener('load', function() {
  const clockDisplay = localStorage.getItem('clockDisplay');
  if (clockDisplay === 'show') {
    // 少し遅延させてから実行（ページロード完了後）
    setTimeout(function() {
      toggleClock();
    }, 500);
  }
});

// グローバル変数の宣言
let clockTimer;

