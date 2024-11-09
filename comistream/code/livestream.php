<?php
/**
 * Comistream Reader - Livestream PHP
 *
 * 選択したファイルをhls出力します。
 *
 *
 * @package     sorshi/comistream-reader
 * @author      Comistream Project.
 * @copyright   2024 Comistream Project.
 * @license     GPL3.0 License
 * @version     1.0.0
 * @link        https://github.com/sorshi/comistream-reader
 *
 */

// TODO 動画カバー作成

// library
if (file_exists(__DIR__ . "/comistream_lib.php")) {
  require(__DIR__ . "/comistream_lib.php");
  writelog("DEBUG library file exist:" . __DIR__ . "/comistream_lib.php", 'Livestream');
} else {
  exit(1);
}

// セッションスタート
session_start();

// DB接続
// SQLite設定
if (databaseExists()) {
  $DSN = "sqlite:" . __DIR__ . '/../data/db/comistream.sqlite';
  try {
    $dbh = new PDO($DSN);
    $dbh->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $dbh->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
  } catch (PDOException $e) {
    echo '接続エラー: ' . $e->getMessage();
    die();
  }
} else {
  errorExit("config invalid", "設定内容が異常です。");
}

// 設定ファイル読み込み
global $conf;
global $publicDir, $md5cmd, $convert, $montage, $unzip, $unrar, $cpdf, $p7zip, $ffmpeg, $book_search_url, $cacheSize, $isPageSave, $isPreCache, $async, $width, $quality, $fullsize_png_compress, $global_debug_flag, $global_resize, $usm;
global $writelog_process_name;
$writelog_process_name = 'Livestream';

readConfig($dbh);

// コーデック選択の参考
// https://qiita.com/CyberRex/items/960bbd0f348ad8dca544
//  DEV.LS h264                 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (decoders: libopenh264 ) (encoders: libopenh264 h264_amf h264_nvenc h264_qsv h264_v4l2m2m h264_vaapi )
//  .EV.L. hevc                 H.265 / HEVC (High Efficiency Video Coding) (encoders: hevc_amf hevc_nvenc hevc_qsv hevc_v4l2m2m hevc_vaapi )
// 画質調整を行いたい場合はpresetとビットレート、ピクセルサイズを編集する。負荷低減のためにハードウェアエンコード使える場合にはハードコーティングがよさそう。
// $encoder="-vcodec libx264 -preset veryfast -b:v 800k -s 854x480 -acodec aac -b:a 64k -ar 44100 -map 0";
// 参考:https://github.com/kaikoma-soft/raspirec/blob/5cd595db5c6c9077ce53e2fdd3d290467283795d/src/tool/ts2hls_sample.sh
$iso_encoder = "-movflags faststart -preset superfast -max_muxing_queue_size 1024 -analyzeduration 10M -probesize 10M -c:v h264 -g 10 -b:v 800k -s 640x360 -c:a aac -b:a 64k -ar 44100 -ac 2 -flags +cgop+global_header"; // DVD ISO用
$mkv_encoder = $iso_encoder . " -pix_fmt yuv420p "; // mkv用
$encoder = $iso_encoder . " -map 0"; // mp4|m4v|avi|mkv|wmv|mpg|m2p|webm用
$mpeg2ts_encoder = "-bsf:v h264_mp4toannexb " . $iso_encoder . " -map 0:v:0 -map 0:a -ignore_unknown"; // MPEG2-TS用

$mode = isset($_REQUEST['mode']) ? $_REQUEST['mode'] : '';
$file = isset($_REQUEST['file']) ? $_REQUEST['file'] : '';
$duration = isset($_REQUEST['duration']) ? $_REQUEST['duration'] : '';
writelog("DEBUG QUERY mode:$mode file:$file duration:$duration", $writelog_process_name);

// Cookieの取得
$user = isset($_COOKIE['comistreamUser'])  ? $_COOKIE['comistreamUser'] : 'guest';
$liveStreamMode = $conf['liveStreamMode'];
// 'liveStreamMode' => 'LiveStreamによるHLS再圧縮機能を利用できるユーザーを制限します。デフォルトは0で全てのユーザーが利用可能です。1:ゲストユーザーが利用できなくなります。2:管理者のみ利用できます。',
switch ($liveStreamMode) {
  case 1:
    if ($user == 'guest') {
      writelog("INFO Guest user is not allowed to use LiveStream", $writelog_process_name);
      errorExit("Guest user is not allowed to use LiveStream", "サーバー設定でゲストユーザーはLiveStream機能を利用できません。ファイルをダウンロードするか直接再生してください。");
    }
    break;
  case 2:
    if (!$_SESSION['is_admin']) {
      writelog("INFO Only admin user is allowed to use LiveStream", $writelog_process_name);
      errorExit("Only admin user is allowed to use LiveStream", "サーバー設定で管理者以外はLiveStream機能を利用できません。ファイルをダウンロードするか直接再生してください。管理者の場合はログインしてください。");
    }
    break;
  default:
    // デフォルトは全てのユーザーが利用可能
    break;
}

if ($mode == 'stop') {
  // エンコード停止
  writelog("DEBUG ffmpeg process kill", $writelog_process_name);
  exec("pkill -15 -f 'ffmpeg.*$user/file'");
  sleep(1);
  writelog("DEBUG hls dir delete.", $writelog_process_name);
  $hlsContentDir = $conf['comistream_tool_dir'] . "/data/theme/hls/$user";
  // exec("cd \"$hlsContentDir/\"; rm -rf *");
  deleteDirectory($hlsContentDir);
  writelog("INFO Livestream stopped.", $writelog_process_name);
  exit;
} elseif ($mode == 'open' && $file != '') {
  // ファイルオープン
  $file = str_replace('../', '', $file);
  # デコード前ファイルパスを保存
  $escapedFile = $file;
  $openFile = "$sharePath/$file";
  $openFile = str_replace('+', '%2B', $openFile);
  $openFile = urldecode($openFile);
  $baseFile = basename($openFile);

  $cgiPath = $_SERVER['SCRIPT_NAME'];

  // ファイルIDを作成
  $file = `echo "$openFile" | $md5cmd | awk '{print \$1}'`;

  // HLS出力領域削除、ffmpegプロセスKILL（引数にユーザ名を含むもの）
  exec("pkill -9 -f 'ffmpeg.*$user/file'");
  // exec("mkdir -p \"$sharePath/hls/$user\"");
  $hlsDir = $conf["comistream_tool_dir"] . "/data/theme/hls/$user";

  if (!chkAndMakeDir($hlsDir)) {
    exit(1);
  }

  exec("cd \"$hlsDir/\"; rm -rf *");
  exec("ln -s \"$openFile\" \"$hlsDir/file\"");

  // ポスター画像を設定
  $poster = $conf["comistream_tool_dir"] . "data/theme/covers/" . basename($file, '.*') . ".jpg";
  writelog("DEBUG poster:" . $poster, $writelog_process_name);

  // 再生位置の指定がある場合
  if ($duration != '') {
    $duration = "-ss $duration";
  } else {
    $duration = ' ';
  }

  // フォーマット判定してエンコードオプション設定
  if (preg_match('/\.(m2t|ts)$/i', $openFile)) {
    $encoder = $mpeg2ts_encoder;
  } elseif (preg_match('/\.(iso)$/i', $openFile)) {
    $encoder = $iso_encoder;
  } elseif (preg_match('/\.(mkv)$/i', $openFile)) {
    $encoder = $mkv_encoder;
  }

  // エンコード開始
  $command = "$ffmpeg $duration -i \"$hlsDir/file\" $encoder -f hls -hls_time 3 -hls_playlist_type event -hls_segment_filename \"$hlsDir/%04d.ts\" \"$hlsDir/index.m3u8\"";
  exec("$command 1>\"$hlsDir/encode_log\" 2>&1 &");
  // 履歴
  // TODO DBに書き込むように
  // file_put_contents("$bookmarkDir/$user/history", "<a class=\"history_movie\" href=\"$_SERVER[REQUEST_URI]\">$baseFile</a>\n", FILE_APPEND);

  // JavaScriptファイルの読み込み
  if (file_exists($conf["comistream_tool_dir"] . '/code/livestream.js')) {
    $contents_js = file_get_contents($conf["comistream_tool_dir"] . '/code/livestream.js');
    writelog("DEBUG JS file exist.", $writelog_process_name);
  } else {
    writelog("ERROR JS not found:" . __DIR__, $writelog_process_name);
    errorExit("config not found", "livestream.jsファイルがみつかりません。");
  }

  // ベースhtml出力
  // header('Content-Type: text/html');
  echo <<<HTML
<html>
<head>
    <meta http-equiv="Content-Type" CONTENT="text/html; charset=UTF-8">
    <meta name="viewport" content="width=device-width, viewport-fit=cover" />

    <style type="text/css">
    body{
      padding:0;
      margin:0;
      background-color:black;
    }
    .video_wrapper {
      position: relative;
      width:100%;
      height:100%;
      overflow: hidden;
    }
    .movie_title {
      position: absolute;
      background-color:rgba(0,0,0,0.5);
      padding:10px;
      color:white;
      z-index:1;
    }
    video {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translateX(-50%) translateY(-50%);
      min-width: 100%;
      min-height: 100%;
      filter: drop-shadow(0px 0px rgba(0,0,0,0));
      outline: none;
      border: none;
    }
    #progress {
      position: absolute;
      top: 44px;
      left: 0;
      width: 100%;
      height: 97%;
      color: white;
      background-color: rgba(0,0,0,0.5);
      overflow: scroll;
      z-index: 2;
    }
  </style>
    <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
</head>
<body>
<div class="video_wrapper">
    <div id="movie_title" class="movie_title"><span>$baseFile</span></div>
    <div id="progress"></div>
    <video id="video" controls autoplay width="854" height="480" poster="$poster"></video>
</div>
<script>
  const publicDir = "$publicDir";
  const themeDir = "";
  const cgiPath = "$cgiPath";
  const user = "$user";

    $contents_js
</script>
</body>
</html>
HTML;
  exit;
} else {
  echo '<html><head><title>NO PARAM</title></head><body><h1>No parameters.</h1></body></html>';
  exit(1);
}
