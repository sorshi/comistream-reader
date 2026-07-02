<?php
/**
 * Comistream Reader - Livestream PHP
 *
 * 選択した動画ファイルをHLSでリアルタイムトランスコード出力します。
 * Just-In-Time方式: 最初に総再生時間から完全なVODプレイリストを生成し、
 * セグメントはPHPゲートウェイ(mode=segment)経由で配信します。
 * 未エンコード地点へのシーク時はffmpegをその位置から再起動するため、
 * 動画のどの位置からでも速やかに再生を開始できます。
 *
 * @package     sorshi/comistream-reader
 * @author      Comistream Project.
 * @copyright   2024 Comistream Project.
 * @license     GPL3.0 License
 * @version     1.1.0
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
  errorExit('invalid_config');
}

// 設定ファイル読み込み
global $conf;
global $publicDir, $md5cmd, $convert, $montage, $unzip, $unrar, $cpdf, $p7zip, $ffmpeg, $book_search_url, $cacheSize, $isPageSave, $isPreCache, $async, $width, $quality, $fullsize_png_compress, $global_debug_flag, $global_resize, $usm;
global $writelog_process_name;
$writelog_process_name = 'Livestream';

readConfig($dbh);

// セグメント長(秒)。プレイリストのEXTINFとffmpegのキーフレーム強制を一致させる
define('LS_SEG_DURATION', 3);
// エンコード先端からこのセグメント数以内のリクエストは再起動せず完成を待つ
define('LS_AHEAD_SEGMENTS', 10);
// セグメント完成待ちのタイムアウト(秒)
define('LS_WAIT_TIMEOUT', 30);

// コーデック選択の参考
// https://qiita.com/CyberRex/items/960bbd0f348ad8dca544
//  DEV.LS h264                 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (decoders: libopenh264 ) (encoders: libopenh264 h264_amf h264_nvenc h264_qsv h264_v4l2m2m h264_vaapi )
//  .EV.L. hevc                 H.265 / HEVC (High Efficiency Video Coding) (encoders: hevc_amf hevc_nvenc hevc_qsv hevc_v4l2m2m hevc_vaapi )
// 画質調整を行いたい場合はpresetとビットレート、ピクセルサイズを編集する。負荷低減のためにハードウェアエンコード使える場合にはハードコーティングがよさそう。
// GOP指定(-g)ではなくforce_key_framesでセグメント境界(3秒)にキーフレームを強制する
$base_encoder = "-preset superfast -max_muxing_queue_size 1024 -analyzeduration 10M -probesize 10M -c:v h264 -b:v 800k -s 640x360 -pix_fmt yuv420p -c:a aac -b:a 64k -ar 44100 -ac 2 -flags +cgop+global_header";
$iso_encoder = $base_encoder; // DVD ISO用
$mkv_encoder = $base_encoder; // mkv用
$encoder = $base_encoder . " -map 0"; // mp4|m4v|avi|wmv|mpg|m2p|webm用
$mpeg2ts_encoder = "-bsf:v h264_mp4toannexb " . $base_encoder . " -map 0:v:0 -map 0:a -ignore_unknown"; // MPEG2-TS用

$mode = isset($_REQUEST['mode']) ? $_REQUEST['mode'] : '';
$file = isset($_REQUEST['file']) ? $_REQUEST['file'] : '';
$duration = isset($_REQUEST['duration']) ? $_REQUEST['duration'] : '';
if ($mode != 'segment') {
  writelog("DEBUG QUERY mode:$mode file:$file duration:$duration", $writelog_process_name);
}

// Cookieの取得
$user = isset($_COOKIE['comistreamUser'])  ? $_COOKIE['comistreamUser'] : 'guest';
$liveStreamMode = $conf['liveStreamMode'];
// 'liveStreamMode' => 'LiveStreamによるHLS再圧縮機能を利用できるユーザーを制限します。デフォルトは0で全てのユーザーが利用可能です。1:ゲストユーザーが利用できなくなります。2:管理者のみ利用できます。',
switch ($liveStreamMode) {
  case 1:
    if ($user == 'guest') {
      writelog("INFO Guest user is not allowed to use LiveStream", $writelog_process_name);
      errorExit('guest_not_allowed', 'guest_not_allowed_detail');
    }
    break;
  case 2:
    if (!isset($_SESSION['is_admin']) || !$_SESSION['is_admin']) {
      writelog("INFO Only admin user is allowed to use LiveStream", $writelog_process_name);
      errorExit('admin_only', 'admin_only_detail');
    }
    break;
  default:
    // デフォルトは全てのユーザーが利用可能
    break;
}

// ============================================================
// ヘルパー関数
// ============================================================

/**
 * "HH:MM:SS"や"MM:SS"、秒数文字列を秒(float)へ変換する
 */
function ls_parse_time($str)
{
  $str = trim($str);
  if ($str === '') {
    return 0.0;
  }
  if (strpos($str, ':') !== false) {
    $parts = array_reverse(explode(':', $str));
    $sec = 0.0;
    foreach ($parts as $i => $p) {
      $sec += floatval($p) * pow(60, $i);
    }
    return $sec;
  }
  return floatval($str);
}

/**
 * ffprobeで動画の総再生時間(秒)を取得する。取得できない場合は0を返す。
 * コンテナ(format)とストリーム両方のdurationを取得し最大値を採用する
 * (ヘッダ情報が不正なAVI等でformat側だけ短く出るケースへの対策)
 */
function ls_probe_duration($ffmpeg, $path)
{
  if (strpos($ffmpeg, '/') === false) {
    $ffprobe = 'ffprobe';
  } else {
    $ffprobe = dirname($ffmpeg) . '/ffprobe';
    if (!is_executable($ffprobe)) {
      writelog("WARN ls_probe_duration() ffprobe not found beside ffmpeg, fallback to PATH: $ffprobe", 'Livestream');
      $ffprobe = 'ffprobe';
    }
  }
  $realPath = realpath($path);
  writelog("DEBUG ls_probe_duration() ffprobe:$ffprobe path:$path realpath:" . ($realPath !== false ? $realPath : 'FALSE'), 'Livestream');
  $cmd = $ffprobe . " -v error -show_entries format=duration:stream=duration -of default=noprint_wrappers=1 " . escapeshellarg($path) . " 2>&1";
  $out = [];
  exec($cmd, $out, $rc);
  writelog("DEBUG ls_probe_duration() rc:$rc output:" . implode(' | ', $out), 'Livestream');
  $candidates = [];
  foreach ($out as $line) {
    if (preg_match('/^duration=([0-9.]+)/', trim($line), $m)) {
      $candidates[] = floatval($m[1]);
    }
  }
  if ($rc !== 0 || empty($candidates)) {
    writelog("WARN ls_probe_duration() failed rc:$rc candidates:" . count($candidates) . " path:$path", 'Livestream');
    return 0.0;
  }
  $durationSec = max($candidates);
  writelog("INFO ls_probe_duration() duration:$durationSec (candidates: " . implode(',', $candidates) . ") path:$path", 'Livestream');
  return $durationSec;
}

/**
 * HLS出力ディレクトリの中身を空にする(ディレクトリ自体は残す)。
 * 共通のdeleteDirectory()は削除許可パスリストにhls領域が含まれておらず
 * 常に失敗するため、ここで専用に処理する(過去動画のfileシンボリックリンクや
 * セグメントが残ると別ファイルを開いても前回の動画が再生される)
 */
function ls_reset_hls_dir($hlsDir)
{
  if (!is_dir($hlsDir)) {
    writelog("DEBUG ls_reset_hls_dir() dir not exist:$hlsDir", 'Livestream');
    return true;
  }
  $items = scandir($hlsDir);
  if ($items === false) {
    writelog("ERROR ls_reset_hls_dir() scandir failed:$hlsDir", 'Livestream');
    return false;
  }
  $removed = 0;
  $failed = 0;
  foreach ($items as $item) {
    if ($item === '.' || $item === '..') {
      continue;
    }
    $path = $hlsDir . '/' . $item;
    if (is_link($path) || is_file($path)) {
      if (@unlink($path)) {
        $removed++;
      } else {
        $failed++;
        writelog("ERROR ls_reset_hls_dir() unlink failed:$path", 'Livestream');
      }
    } else {
      // サブディレクトリは本来存在しないはず。誤削除を避け警告のみ
      $failed++;
      writelog("WARN ls_reset_hls_dir() unexpected sub directory skipped:$path", 'Livestream');
    }
  }
  writelog("DEBUG ls_reset_hls_dir() removed:$removed failed:$failed dir:$hlsDir", 'Livestream');
  return $failed === 0;
}

/**
 * エンコード状態ファイル(state.json)を読み込む
 */
function ls_read_state($hlsDir)
{
  $stateFile = "$hlsDir/state.json";
  if (!file_exists($stateFile)) {
    return null;
  }
  $json = file_get_contents($stateFile);
  if ($json === false) {
    return null;
  }
  $state = json_decode($json, true);
  return is_array($state) ? $state : null;
}

/**
 * エンコード状態ファイル(state.json)を書き込む
 */
function ls_write_state($hlsDir, $state)
{
  file_put_contents("$hlsDir/state.json", json_encode($state, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), LOCK_EX);
}

/**
 * PIDが生存しているffmpegプロセスか確認する
 */
function ls_pid_is_ffmpeg($pid)
{
  $pid = intval($pid);
  if ($pid <= 0) {
    return false;
  }
  $out = [];
  exec("ps -p $pid -o comm= 2>/dev/null", $out);
  return isset($out[0]) && strpos($out[0], 'ffmpeg') !== false;
}

/**
 * ffmpegプロセスをPID指定で停止する(TERM→KILL)
 */
function ls_kill_pid($pid)
{
  $pid = intval($pid);
  if (!ls_pid_is_ffmpeg($pid)) {
    writelog("DEBUG ls_kill_pid() pid:$pid is not a running ffmpeg, skip", 'Livestream');
    return;
  }
  exec("kill -15 $pid 2>/dev/null");
  usleep(300000);
  if (ls_pid_is_ffmpeg($pid)) {
    writelog("DEBUG ls_kill_pid() pid:$pid survived SIGTERM, sending SIGKILL", 'Livestream');
    exec("kill -9 $pid 2>/dev/null");
    usleep(100000);
  }
  if (ls_pid_is_ffmpeg($pid)) {
    writelog("WARN ls_kill_pid() pid:$pid still alive after SIGKILL", 'Livestream');
  } else {
    writelog("DEBUG ls_kill_pid() pid:$pid terminated", 'Livestream');
  }
}

/**
 * エンコード済みセグメントの最大番号を返す(なければ-1)
 */
function ls_max_segment($hlsDir)
{
  $files = glob("$hlsDir/[0-9][0-9][0-9][0-9][0-9].ts");
  if (empty($files)) {
    return -1;
  }
  $max = -1;
  foreach ($files as $f) {
    $n = intval(basename($f, '.ts'));
    if ($n > $max) {
      $max = $n;
    }
  }
  return $max;
}

/**
 * 指定セグメント位置からのffmpegエンコードコマンドを組み立てる
 */
function ls_build_command($ffmpeg, $input, $encoderOpts, $hlsDir, $startSeg)
{
  $startSec = $startSeg * LS_SEG_DURATION;
  $cmd = $ffmpeg . " -nostdin -y";
  if ($startSeg > 0) {
    $cmd .= " -ss $startSec";
  }
  $cmd .= " -i " . escapeshellarg($input);
  $cmd .= " " . $encoderOpts;
  $cmd .= " -force_key_frames " . escapeshellarg("expr:gte(t,n_forced*" . LS_SEG_DURATION . ")");
  if ($startSeg > 0) {
    // 途中開始でもタイムスタンプをプレイリスト上の時刻と連続させる
    $cmd .= " -output_ts_offset $startSec";
  }
  $cmd .= " -f hls -hls_time " . LS_SEG_DURATION . " -hls_playlist_type vod -hls_flags temp_file";
  $cmd .= " -start_number $startSeg";
  $cmd .= " -hls_segment_filename " . escapeshellarg("$hlsDir/%05d.ts");
  $cmd .= " " . escapeshellarg("$hlsDir/live.m3u8");
  return $cmd;
}

/**
 * ffmpegをバックグラウンド起動しPIDを返す
 */
function ls_start_encoder($command, $hlsDir)
{
  $logFile = "$hlsDir/encode_log";
  $out = [];
  exec($command . " >> " . escapeshellarg($logFile) . " 2>&1 & echo $!", $out);
  $pid = isset($out[0]) ? intval($out[0]) : 0;
  writelog("INFO ls_start_encoder() pid:$pid command:$command", 'Livestream');
  return $pid;
}

/**
 * 要求セグメントに対してエンコーダーが適切に動作しているか確認し、
 * 必要であればffmpegをその位置から再起動する(flockで排他)。
 * シーク時の再起動ストーム防止のため、判定と再起動はロック内で行う
 */
function ls_ensure_encoder($hlsDir, $n)
{
  global $ffmpeg;

  $lockFp = fopen("$hlsDir/state.lock", 'c');
  if ($lockFp === false) {
    return;
  }
  flock($lockFp, LOCK_EX);
  try {
    $state = ls_read_state($hlsDir);
    if (!$state || ($state['playback'] ?? '') !== 'vod') {
      return;
    }
    // ロック待ちの間に別リクエストが再起動して完成している場合がある
    clearstatcache();
    if (file_exists(sprintf("%s/%05d.ts", $hlsDir, $n))) {
      return;
    }
    $runStart = intval($state['run_start']);
    $head = ls_max_segment($hlsDir);
    $alive = ls_pid_is_ffmpeg($state['pid'] ?? 0);
    $windowEnd = max($head, $runStart) + LS_AHEAD_SEGMENTS;
    if ($alive && $n >= $runStart && $n <= $windowEnd) {
      // 現在のエンコードがまもなく到達する範囲。待つだけでよい
      writelog("DEBUG ls_ensure_encoder() wait for seg:$n (run_start:$runStart head:$head windowEnd:$windowEnd pid:" . $state['pid'] . ")", 'Livestream');
      return;
    }
    // シークによる範囲外リクエスト、またはエンコーダー死亡 → nから再起動
    writelog("INFO ls_ensure_encoder() restart at seg:$n (run_start:$runStart head:$head alive:" . ($alive ? 1 : 0) . ")", 'Livestream');
    ls_kill_pid($state['pid'] ?? 0);
    $command = ls_build_command($ffmpeg, $state['input'], $state['encoder'], $hlsDir, $n);
    $pid = ls_start_encoder($command, $hlsDir);
    $state['pid'] = $pid;
    $state['run_start'] = $n;
    $state['updated'] = time();
    ls_write_state($hlsDir, $state);
  } finally {
    flock($lockFp, LOCK_UN);
    fclose($lockFp);
  }
}

/**
 * 全セグメントを列挙したVOD形式のm3u8を生成する
 */
function ls_generate_playlist($hlsDir, $cgiPath, $fileId, $totalDuration)
{
  $segTotal = intval(ceil($totalDuration / LS_SEG_DURATION));
  $lines = [];
  $lines[] = "#EXTM3U";
  $lines[] = "#EXT-X-VERSION:3";
  $lines[] = "#EXT-X-TARGETDURATION:" . (LS_SEG_DURATION + 1);
  $lines[] = "#EXT-X-MEDIA-SEQUENCE:0";
  $lines[] = "#EXT-X-PLAYLIST-TYPE:VOD";
  for ($i = 0; $i < $segTotal; $i++) {
    if ($i == $segTotal - 1) {
      $len = $totalDuration - LS_SEG_DURATION * ($segTotal - 1);
      $len = max($len, 0.001);
    } else {
      $len = LS_SEG_DURATION;
    }
    $lines[] = sprintf("#EXTINF:%.6f,", $len);
    $lines[] = "$cgiPath?mode=segment&id=$fileId&n=$i";
  }
  $lines[] = "#EXT-X-ENDLIST";
  file_put_contents("$hlsDir/index.m3u8", implode("\n", $lines) . "\n", LOCK_EX);
  return $segTotal;
}

// ============================================================
// モード別処理
// ============================================================

if ($mode == 'stop') {
  // エンコード停止
  $hlsContentDir = $conf['comistream_tool_dir'] . "/data/theme/hls/$user";
  $state = ls_read_state($hlsContentDir);
  writelog("DEBUG stop request user:$user state:" . ($state ? json_encode($state, JSON_UNESCAPED_SLASHES) : 'none'), $writelog_process_name);
  if ($state && isset($state['pid'])) {
    writelog("DEBUG ffmpeg process kill pid:" . $state['pid'], $writelog_process_name);
    ls_kill_pid($state['pid']);
  }
  // 旧バージョンや状態ファイル欠損時のフォールバック
  exec("pkill -15 -f " . escapeshellarg("ffmpeg.*hls/$user/file"));
  sleep(1);
  writelog("DEBUG hls dir cleanup:" . $hlsContentDir, $writelog_process_name);
  ls_reset_hls_dir($hlsContentDir);
  @rmdir($hlsContentDir);
  writelog("INFO Livestream stopped. user:$user", $writelog_process_name);
  exit;
} elseif ($mode == 'segment') {
  // セグメントゲートウェイ: エンコード済みなら即返却、
  // 未エンコードなら必要に応じてffmpegを再起動して完成を待つ
  $hlsDir = $conf["comistream_tool_dir"] . "/data/theme/hls/$user";
  $n = isset($_REQUEST['n']) ? intval($_REQUEST['n']) : -1;
  $id = isset($_REQUEST['id']) ? preg_replace('/[^a-f0-9]/', '', $_REQUEST['id']) : '';

  // セッションロックを解放してから待機する(並行セグメントリクエストの直列化防止)
  session_write_close();
  set_time_limit(0);

  $state = ls_read_state($hlsDir);
  $rejectReason = '';
  if (!$state) {
    $rejectReason = 'state.json not found or unreadable';
  } elseif (($state['playback'] ?? '') !== 'vod') {
    $rejectReason = 'playback mode is not vod: ' . ($state['playback'] ?? 'unset');
  } elseif ($id === '' || ($state['id'] ?? '') !== $id) {
    $rejectReason = "file id mismatch request:$id state:" . ($state['id'] ?? 'unset');
  } elseif ($n < 0 || $n >= intval($state['total_segments'])) {
    $rejectReason = "segment out of range n:$n total:" . intval($state['total_segments']);
  }
  if ($rejectReason !== '') {
    writelog("WARN segment request rejected user:$user n:$n reason: $rejectReason", $writelog_process_name);
    http_response_code(404);
    exit;
  }
  // 視聴中の生存マーカー
  @touch("$hlsDir/state.json");

  $segFile = sprintf("%s/%05d.ts", $hlsDir, $n);
  if (!file_exists($segFile)) {
    writelog("DEBUG segment not ready, waiting user:$user n:$n", $writelog_process_name);
    $waitStart = microtime(true);
    ls_ensure_encoder($hlsDir, $n);
    $deadline = microtime(true) + LS_WAIT_TIMEOUT;
    $lastEnsure = microtime(true);
    while (microtime(true) < $deadline) {
      usleep(200000);
      clearstatcache(true, $segFile);
      if (file_exists($segFile)) {
        break;
      }
      // エンコーダー死亡等からの回復用に定期的に再確認する
      if (microtime(true) - $lastEnsure > 5) {
        ls_ensure_encoder($hlsDir, $n);
        $lastEnsure = microtime(true);
      }
    }
    if (!file_exists($segFile)) {
      writelog("WARN segment wait timeout seg:$n user:$user waited:" . sprintf('%.1f', microtime(true) - $waitStart) . "s", $writelog_process_name);
      http_response_code(503);
      header('Retry-After: 2');
      exit;
    }
    writelog("DEBUG segment ready after " . sprintf('%.1f', microtime(true) - $waitStart) . "s user:$user n:$n", $writelog_process_name);
  }
  // 同一id+同一番号なら内容は同じためキャッシュ可
  header('Content-Type: video/mp2t');
  header('Content-Length: ' . filesize($segFile));
  header('Cache-Control: private, max-age=3600');
  readfile($segFile);
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

  if (!file_exists($openFile)) {
    writelog("ERROR open target not found:$openFile", $writelog_process_name);
    echo '<html><head><title>NOT FOUND</title></head><body><h1>File not found.</h1></body></html>';
    exit(1);
  }

  // ファイルIDを作成
  $fileId = md5($openFile);

  $hlsDir = $conf["comistream_tool_dir"] . "/data/theme/hls/$user";
  writelog("INFO open request user:$user openFile:$openFile fileId:$fileId", $writelog_process_name);

  // 既存エンコードの停止とHLS出力領域の初期化
  $oldState = ls_read_state($hlsDir);
  writelog("DEBUG previous state:" . ($oldState ? json_encode($oldState, JSON_UNESCAPED_SLASHES) : 'none'), $writelog_process_name);
  if ($oldState && isset($oldState['pid'])) {
    ls_kill_pid($oldState['pid']);
  }
  // 旧バージョンや状態ファイル欠損時のフォールバック
  exec("pkill -15 -f " . escapeshellarg("ffmpeg.*hls/$user/file"));
  if (!ls_reset_hls_dir($hlsDir)) {
    writelog("ERROR hls dir reset failed, stale files may remain:$hlsDir", $writelog_process_name);
  }
  if (!chkAndMakeDir($hlsDir)) {
    writelog("ERROR hls dir creation failed:$hlsDir", $writelog_process_name);
    exit(1);
  }

  // 入力用シンボリックリンクの作成。古いリンクが残っていると前回の動画が
  // 再生されてしまうため、確実に消してから張り直し、リンク先を検証する
  $inputFile = "$hlsDir/file";
  if (is_link($inputFile) || file_exists($inputFile)) {
    writelog("WARN stale input link still exists, removing:" . $inputFile . " -> " . (is_link($inputFile) ? readlink($inputFile) : 'not a link'), $writelog_process_name);
    @unlink($inputFile);
  }
  if (!symlink($openFile, $inputFile)) {
    writelog("ERROR symlink creation failed target:$openFile link:$inputFile", $writelog_process_name);
    echo '<html><head><title>ERROR</title></head><body><h1>Failed to prepare stream.</h1></body></html>';
    exit(1);
  }
  $linkTarget = readlink($inputFile);
  writelog("DEBUG input symlink created:$inputFile -> $linkTarget", $writelog_process_name);
  if ($linkTarget !== $openFile) {
    writelog("ERROR symlink target mismatch expected:$openFile actual:$linkTarget", $writelog_process_name);
    echo '<html><head><title>ERROR</title></head><body><h1>Failed to prepare stream.</h1></body></html>';
    exit(1);
  }

  // ポスター画像を設定
  $posterFile = $conf["comistream_tool_dir"] . "/data/theme/covers" . $publicDir . "/" . $fileId . ".jpg";
  $poster = file_exists($posterFile) ? "/theme/covers" . $publicDir . "/" . $fileId . ".jpg" : "";
  writelog("DEBUG poster:" . $posterFile, $writelog_process_name);

  // 再生開始位置の指定がある場合
  $startSeconds = ls_parse_time($duration);

  // フォーマット判定してエンコードオプション設定
  if (preg_match('/\.(m2t|ts)$/i', $openFile)) {
    $encoder = $mpeg2ts_encoder;
  } elseif (preg_match('/\.(iso)$/i', $openFile)) {
    $encoder = $iso_encoder;
  } elseif (preg_match('/\.(mkv)$/i', $openFile)) {
    $encoder = $mkv_encoder;
  }

  // durationはシンボリックリンクではなく実ファイルパスに対して取得する
  // (リンクの状態に依存させない)
  $totalDuration = ls_probe_duration($ffmpeg, $openFile);

  if ($totalDuration > 0) {
    // VODモード: 完全なプレイリストを即時生成し、シーク時はセグメント
    // ゲートウェイがJIT再起動する
    $segTotal = ls_generate_playlist($hlsDir, $cgiPath, $fileId, $totalDuration);
    $startSeg = min(intval(floor($startSeconds / LS_SEG_DURATION)), max($segTotal - 1, 0));
    $command = ls_build_command($ffmpeg, $inputFile, $encoder, $hlsDir, $startSeg);
    $pid = ls_start_encoder($command, $hlsDir);
    $newState = [
      'playback' => 'vod',
      'id' => $fileId,
      'pid' => $pid,
      'run_start' => $startSeg,
      'total_segments' => $segTotal,
      'seg_duration' => LS_SEG_DURATION,
      'encoder' => $encoder,
      'input' => $inputFile,
      'source' => $openFile,
      'updated' => time(),
    ];
    ls_write_state($hlsDir, $newState);
    writelog("DEBUG state written:" . json_encode($newState, JSON_UNESCAPED_SLASHES), $writelog_process_name);
    $playbackMode = 'vod';
    $startPosition = $startSeg * LS_SEG_DURATION;
    writelog("INFO Livestream opened (vod) duration:$totalDuration segments:$segTotal start:$startSeg file:$baseFile", $writelog_process_name);
  } else {
    // 総再生時間が取得できない場合は従来のevent型にフォールバック(シーク不可)
    $ssOpt = $startSeconds > 0 ? "-ss $startSeconds" : "";
    $command = "$ffmpeg -nostdin -y $ssOpt -i " . escapeshellarg($inputFile) . " $encoder"
      . " -force_key_frames " . escapeshellarg("expr:gte(t,n_forced*" . LS_SEG_DURATION . ")")
      . " -f hls -hls_time " . LS_SEG_DURATION . " -hls_playlist_type event"
      . " -hls_segment_filename " . escapeshellarg("$hlsDir/%04d.ts") . " " . escapeshellarg("$hlsDir/index.m3u8");
    writelog("WARN duration unknown, falling back to event mode (seek disabled) file:$baseFile", $writelog_process_name);
    $pid = ls_start_encoder($command, $hlsDir);
    ls_write_state($hlsDir, [
      'playback' => 'event',
      'id' => $fileId,
      'pid' => $pid,
      'source' => $openFile,
      'updated' => time(),
    ]);
    $playbackMode = 'event';
    $startPosition = 0;
    writelog("INFO Livestream opened (event fallback) file:$baseFile", $writelog_process_name);
  }

  // JavaScriptファイルの読み込み
  if (file_exists($conf["comistream_tool_dir"] . '/code/livestream.js')) {
    $contents_js = file_get_contents($conf["comistream_tool_dir"] . '/code/livestream.js');
    writelog("DEBUG JS file exist.", $writelog_process_name);
  } else {
    writelog("ERROR JS not found:" . __DIR__, $writelog_process_name);
    errorExit('livestream_config_not_found');
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
  const playbackMode = "$playbackMode";
  const startPosition = $startPosition;

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
