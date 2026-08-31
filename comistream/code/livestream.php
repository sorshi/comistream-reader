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
 * @license     AGPL-3.0-only for Comistream Reader project-specific portions; see repository-root LICENSING.md
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

// CLI workerから呼ぶ場合は --mode=thumb_worker --id=<fileId> をREQUESTへ反映する
if (PHP_SAPI === 'cli' && isset($argv) && is_array($argv)) {
  for ($i = 1; $i < count($argv); $i++) {
    if (preg_match('/^--([^=]+)=(.*)$/', $argv[$i], $m)) {
      $_REQUEST[$m[1]] = $m[2];
    } elseif (preg_match('/^--(.+)$/', $argv[$i], $m) && isset($argv[$i + 1])) {
      $_REQUEST[$m[1]] = $argv[$i + 1];
      $i++;
    }
  }
}

// セグメント長(秒)。プレイリストのEXTINFとffmpegのキーフレーム強制を一致させる
define('LS_SEG_DURATION', 3);
// エンコード先端からこのセグメント数以内のリクエストは再起動せず完成を待つ
define('LS_AHEAD_SEGMENTS', 10);
// セグメント完成待ちのタイムアウト(秒)
define('LS_WAIT_TIMEOUT', 30);
// シーク待ち時間を埋めるサムネイル設定ルン
define('LS_THUMB_INTERVAL', 30);
define('LS_THUMB_WIDTH', 160);
define('LS_THUMB_HEIGHT', 90);
define('LS_THUMB_WARMUP_LIMIT', 4);

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
if (!(PHP_SAPI === 'cli' && $mode === 'thumb_worker')) {
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
 * 実行可能なffprobeのパスを探す。見つからない場合は空文字を返す。
 * 探索順: conf['ffprobe'] → ffmpegと同じディレクトリ → PATH → 定番の場所
 */
function ls_find_ffprobe($ffmpeg)
{
  global $conf;
  $candidates = [];
  if (!empty($conf['ffprobe'])) {
    $candidates[] = $conf['ffprobe'];
  }
  if (strpos($ffmpeg, '/') !== false) {
    $candidates[] = dirname($ffmpeg) . '/ffprobe';
  }
  $which = trim((string)exec('command -v ffprobe 2>/dev/null'));
  if ($which !== '') {
    $candidates[] = $which;
  }
  $candidates[] = '/usr/local/bin/ffprobe';
  $candidates[] = '/usr/bin/ffprobe';
  foreach ($candidates as $c) {
    if ($c !== '' && is_executable($c)) {
      writelog("DEBUG ls_find_ffprobe() using:$c", 'Livestream');
      return $c;
    }
  }
  writelog("WARN ls_find_ffprobe() ffprobe not found. checked: " . implode(', ', $candidates), 'Livestream');
  return '';
}

/**
 * ffmpeg -i が標準エラーに出す "Duration: HH:MM:SS.cc" 表記から
 * 総再生時間(秒)を取得する。ffprobeがインストールされていない環境向け
 */
function ls_duration_from_ffmpeg($ffmpeg, $path)
{
  $cmd = $ffmpeg . " -hide_banner -i " . escapeshellarg($path) . " 2>&1";
  $out = [];
  exec($cmd, $out, $rc);
  foreach ($out as $line) {
    if (preg_match('/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/', $line, $m)) {
      $durationSec = intval($m[1]) * 3600 + intval($m[2]) * 60 + floatval($m[3]);
      writelog("INFO ls_duration_from_ffmpeg() duration:$durationSec from line:" . trim($line), 'Livestream');
      return $durationSec;
    }
  }
  writelog("WARN ls_duration_from_ffmpeg() Duration not found rc:$rc output:" . substr(implode(' | ', $out), 0, 1000), 'Livestream');
  return 0.0;
}

/**
 * 動画の総再生時間(秒)を取得する。取得できない場合は0を返す。
 * ffprobeがあればコンテナ(format)とストリーム両方のdurationの最大値を採用
 * (ヘッダ情報が不正なAVI等でformat側だけ短く出るケースへの対策)。
 * ffprobeがない場合はffmpeg -iの出力から取得する
 */
function ls_probe_duration($ffmpeg, $path)
{
  $realPath = realpath($path);
  writelog("DEBUG ls_probe_duration() path:$path realpath:" . ($realPath !== false ? $realPath : 'FALSE'), 'Livestream');

  $ffprobe = ls_find_ffprobe($ffmpeg);
  if ($ffprobe !== '') {
    $cmd = $ffprobe . " -v error -show_entries format=duration:stream=duration -of default=noprint_wrappers=1 " . escapeshellarg($path) . " 2>&1";
    $out = [];
    exec($cmd, $out, $rc);
    writelog("DEBUG ls_probe_duration() ffprobe rc:$rc output:" . substr(implode(' | ', $out), 0, 1000), 'Livestream');
    $candidates = [];
    foreach ($out as $line) {
      if (preg_match('/^duration=([0-9.]+)/', trim($line), $m)) {
        $candidates[] = floatval($m[1]);
      }
    }
    if ($rc === 0 && !empty($candidates)) {
      $durationSec = max($candidates);
      writelog("INFO ls_probe_duration() duration:$durationSec (candidates: " . implode(',', $candidates) . ") path:$path", 'Livestream');
      return $durationSec;
    }
    writelog("WARN ls_probe_duration() ffprobe failed rc:$rc, falling back to ffmpeg -i", 'Livestream');
  }

  // ffprobeが使えない・失敗した場合のフォールバック
  return ls_duration_from_ffmpeg($ffmpeg, $path);
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
 * PIDが生存しているか確認する
 */
function ls_pid_is_running($pid)
{
  $pid = intval($pid);
  if ($pid <= 0) {
    return false;
  }
  $out = [];
  exec("ps -p $pid -o pid= 2>/dev/null", $out);
  return isset($out[0]) && trim($out[0]) !== '';
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

/**
 * JSONレスポンスを返して終了する
 */
function ls_json_response($payload, $statusCode = 200)
{
  http_response_code($statusCode);
  header('Content-Type: application/json; charset=UTF-8');
  header('Cache-Control: no-store');
  echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
  exit;
}

/**
 * サムネイルキャッシュのルートディレクトリを返す
 */
function ls_thumb_root_dir()
{
  global $conf;
  return $conf["comistream_tool_dir"] . "/data/theme/hls_thumbnails";
}

/**
 * サムネイルキャッシュディレクトリを作成する
 */
function ls_ensure_thumb_dir($thumbDir)
{
  if (is_dir($thumbDir)) {
    return true;
  }
  return @mkdir($thumbDir, 0775, true);
}

/**
 * サムネイル対象のstateを読み、id/source/durationを検証する
 */
function ls_read_thumb_state($hlsDir, $id)
{
  $state = ls_read_state($hlsDir);
  if (!$state) {
    return [null, 'state not found'];
  }
  if ($id === '' || !preg_match('/^[a-f0-9]{64}$/', $id)) {
    return [null, 'invalid id'];
  }
  if (($state['id'] ?? '') !== $id) {
    return [null, 'file id mismatch'];
  }
  if (!isset($state['source']) || !is_file($state['source'])) {
    return [null, 'source not found'];
  }
  if (($state['playback'] ?? '') !== 'vod' || empty($state['total_duration'])) {
    return [$state, 'thumbnail disabled'];
  }
  return [$state, ''];
}

/**
 * サムネイル時刻を30秒単位に丸める
 */
function ls_thumb_round_time($seconds, $duration)
{
  $seconds = max(0.0, floatval($seconds));
  $duration = max(0.0, floatval($duration));
  if ($duration > 0) {
    $seconds = min($seconds, max(0.0, $duration - 0.001));
  }
  $rounded = intval(round($seconds / LS_THUMB_INTERVAL) * LS_THUMB_INTERVAL);
  if ($duration > 0 && $rounded >= $duration) {
    $rounded = intval(floor(max(0.0, $duration - 0.001) / LS_THUMB_INTERVAL) * LS_THUMB_INTERVAL);
  }
  return max(0, $rounded);
}

/**
 * サムネイルキャッシュにある時刻一覧を返す
 */
function ls_thumb_ready_times($thumbDir)
{
  $ready = [];
  foreach (['webp', 'jpg'] as $ext) {
    $files = glob("$thumbDir/[0-9][0-9][0-9][0-9][0-9][0-9].$ext");
    if (empty($files)) {
      continue;
    }
    foreach ($files as $file) {
      if (preg_match('/^(\d{6})\.(webp|jpg)$/', basename($file), $m)) {
        $ready[intval($m[1])] = true;
      }
    }
  }
  $times = array_keys($ready);
  sort($times, SORT_NUMERIC);
  return $times;
}

/**
 * 既存サムネイルを探す
 */
function ls_thumb_existing_file($thumbDir, $second)
{
  $base = sprintf("%s/%06d", $thumbDir, $second);
  $candidates = [
    [$base . '.webp', 'image/webp'],
    [$base . '.jpg', 'image/jpeg'],
  ];
  foreach ($candidates as $candidate) {
    if (is_file($candidate[0]) && filesize($candidate[0]) > 0) {
      return $candidate;
    }
  }
  return [null, null];
}

/**
 * サムネイルmanifestを書き込む
 */
function ls_read_thumb_manifest($thumbDir)
{
  $manifestFile = "$thumbDir/manifest.json";
  if (!is_file($manifestFile)) {
    return null;
  }
  $json = file_get_contents($manifestFile);
  $manifest = $json !== false ? json_decode($json, true) : null;
  return is_array($manifest) ? $manifest : null;
}

/**
 * サムネイルmanifestを書き込む
 */
function ls_write_thumb_manifest($thumbDir, $state, $extra = [])
{
  $source = $state['source'];
  $existing = ls_read_thumb_manifest($thumbDir);
  $generated = ls_thumb_ready_times($thumbDir);
  $duration = floatval($state['total_duration']);
  $total = $duration > 0 ? intval(ceil($duration / LS_THUMB_INTERVAL)) : 0;
  $manifest = [
    'id' => $state['id'],
    'source' => $source,
    'source_mtime' => filemtime($source),
    'duration' => $duration,
    'interval' => LS_THUMB_INTERVAL,
    'width' => LS_THUMB_WIDTH,
    'height' => LS_THUMB_HEIGHT,
    'format' => 'webp',
    'fallback_format' => 'jpg',
    'generated' => $generated,
    'complete' => $total > 0 && count($generated) >= $total,
    'updated' => time(),
  ];
  foreach (['worker_pid', 'worker_status', 'worker_started', 'worker_updated', 'worker_progress', 'worker_total'] as $key) {
    if (isset($existing[$key])) {
      $manifest[$key] = $existing[$key];
    }
  }
  foreach ($extra as $key => $value) {
    $manifest[$key] = $value;
  }
  file_put_contents("$thumbDir/manifest.json", json_encode($manifest, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), LOCK_EX);
  return $manifest;
}

/**
 * manifestと現在の動画が合わない場合はキャッシュを初期化する
 */
function ls_prepare_thumb_cache($thumbDir, $state)
{
  if (!ls_ensure_thumb_dir($thumbDir)) {
    return false;
  }
  $manifest = ls_read_thumb_manifest($thumbDir);
  $source = $state['source'];
  $valid = $manifest
    && ($manifest['id'] ?? '') === ($state['id'] ?? '')
    && ($manifest['source'] ?? '') === $source
    && intval($manifest['source_mtime'] ?? -1) === intval(filemtime($source))
    && intval($manifest['interval'] ?? 0) === LS_THUMB_INTERVAL
    && intval($manifest['width'] ?? 0) === LS_THUMB_WIDTH
    && intval($manifest['height'] ?? 0) === LS_THUMB_HEIGHT;

  if (!$valid) {
    $files = glob("$thumbDir/*");
    if (!empty($files)) {
      foreach ($files as $file) {
        if (is_file($file) && preg_match('/\.(webp|jpg|json|lock)$/', $file)) {
          @unlink($file);
        }
      }
    }
    ls_write_thumb_manifest($thumbDir, $state);
  }
  return true;
}

/**
 * 指定時刻のサムネイルを1枚生成する
 */
function ls_generate_thumb($thumbDir, $state, $second, $preferKeyframe = false)
{
  global $ffmpeg;

  if (!ls_ensure_thumb_dir($thumbDir)) {
    return [null, null];
  }
  $lockFile = sprintf("%s/%06d.lock", $thumbDir, $second);
  $lockFp = fopen($lockFile, 'c');
  if ($lockFp === false) {
    return [null, null];
  }
  flock($lockFp, LOCK_EX);
  try {
    list($existing, $contentType) = ls_thumb_existing_file($thumbDir, $second);
    if ($existing !== null) {
      return [$existing, $contentType];
    }

    $vf = "scale=" . LS_THUMB_WIDTH . ":" . LS_THUMB_HEIGHT . ":force_original_aspect_ratio=decrease,pad=" . LS_THUMB_WIDTH . ":" . LS_THUMB_HEIGHT . ":(ow-iw)/2:(oh-ih)/2";
    $base = sprintf("%s/%06d", $thumbDir, $second);
    $source = $state['source'];
    $targets = [
      ['ext' => 'webp', 'type' => 'image/webp', 'quality' => '60'],
      ['ext' => 'jpg', 'type' => 'image/jpeg', 'quality' => '5'],
    ];

    $keyframeModes = $preferKeyframe ? [true, false] : [false];
    foreach ($keyframeModes as $keyframeMode) {
      foreach ($targets as $target) {
        $tmp = $base . '.tmp.' . $target['ext'];
        $final = $base . '.' . $target['ext'];
        @unlink($tmp);
        $cmd = $ffmpeg . " -nostdin -y ";
        if ($keyframeMode) {
          // 全量作成workerではIフレーム寄りにしてデコード量を抑えるルン
          $cmd .= "-skip_frame nokey ";
        }
        $cmd .= "-ss " . escapeshellarg((string)$second)
          . " -i " . escapeshellarg($source)
          . " -frames:v 1 -vf " . escapeshellarg($vf)
          . " -q:v " . $target['quality'] . " " . escapeshellarg($tmp) . " 2>&1";
        $out = [];
        exec($cmd, $out, $rc);
        if ($rc === 0 && is_file($tmp) && filesize($tmp) > 0) {
          @rename($tmp, $final);
          ls_write_thumb_manifest($thumbDir, $state);
          writelog("DEBUG thumbnail generated second:$second file:$final keyframe:" . ($keyframeMode ? 1 : 0), 'Livestream');
          return [$final, $target['type']];
        }
        @unlink($tmp);
        writelog("WARN thumbnail generation failed ext:" . $target['ext'] . " keyframe:" . ($keyframeMode ? 1 : 0) . " second:$second rc:$rc output:" . substr(implode(' | ', $out), 0, 1000), 'Livestream');
      }
    }
  } finally {
    flock($lockFp, LOCK_UN);
    fclose($lockFp);
  }
  return [null, null];
}

/**
 * PHP CLIの実行パスを探す
 */
function ls_find_php_cli()
{
  $candidates = [];
  $which = trim((string)exec('command -v php 2>/dev/null'));
  if ($which !== '') {
    $candidates[] = $which;
  }
  $candidates[] = '/usr/local/bin/php';
  $candidates[] = '/usr/bin/php';
  if (defined('PHP_BINARY') && PHP_BINARY !== '') {
    $candidates[] = PHP_BINARY;
  }
  foreach ($candidates as $candidate) {
    if ($candidate === '' || !is_executable($candidate)) {
      continue;
    }
    $base = strtolower(basename($candidate));
    // Web SAPIのphp-cgiやphp-fpmを避けて、CLIのphp本体を優先する
    if ($base === 'php' || $base === 'php.exe') {
      return $candidate;
    }
  }
  foreach ($candidates as $candidate) {
    if ($candidate !== '' && is_executable($candidate) && stripos(basename($candidate), 'php') !== false) {
      return $candidate;
    }
  }
  return '';
}

/**
 * manifestからworker用stateを復元する
 */
function ls_thumb_state_from_manifest($id, $manifest)
{
  if (!is_array($manifest)) {
    return [null, 'manifest not found'];
  }
  if ($id === '' || !preg_match('/^[a-f0-9]{64}$/', $id) || ($manifest['id'] ?? '') !== $id) {
    return [null, 'invalid id'];
  }
  $source = $manifest['source'] ?? '';
  if ($source === '' || !is_file($source)) {
    return [null, 'source not found'];
  }
  if (intval($manifest['source_mtime'] ?? -1) !== intval(filemtime($source))) {
    return [null, 'source changed'];
  }
  if (intval($manifest['interval'] ?? 0) !== LS_THUMB_INTERVAL
    || intval($manifest['width'] ?? 0) !== LS_THUMB_WIDTH
    || intval($manifest['height'] ?? 0) !== LS_THUMB_HEIGHT) {
    return [null, 'thumbnail spec changed'];
  }
  return [[
    'id' => $id,
    'source' => $source,
    'total_duration' => floatval($manifest['duration'] ?? 0),
  ], ''];
}

/**
 * サムネイル全量作成workerをバックグラウンド起動する
 */
function ls_start_thumb_worker($thumbDir, $state)
{
  $manifest = ls_write_thumb_manifest($thumbDir, $state);
  if (($manifest['complete'] ?? false) === true) {
    return ['started' => false, 'pid' => 0, 'status' => 'complete'];
  }
  $oldPid = intval($manifest['worker_pid'] ?? 0);
  if (($manifest['worker_status'] ?? '') === 'running' && ls_pid_is_running($oldPid)) {
    return ['started' => false, 'pid' => $oldPid, 'status' => 'running'];
  }

  $php = ls_find_php_cli();
  if ($php === '') {
    return ['started' => false, 'pid' => 0, 'status' => 'php not found'];
  }

  $id = $state['id'];
  $logFile = "$thumbDir/worker.log";
  $cmd = "nice -n 10 " . escapeshellarg($php)
    . " " . escapeshellarg(__FILE__)
    . " --mode=thumb_worker --id=" . escapeshellarg($id)
    . " >> " . escapeshellarg($logFile) . " 2>&1 & echo $!";
  $out = [];
  exec($cmd, $out);
  $pid = isset($out[0]) ? intval($out[0]) : 0;
  ls_write_thumb_manifest($thumbDir, $state, [
    'worker_pid' => $pid,
    'worker_status' => $pid > 0 ? 'running' : 'start_failed',
    'worker_started' => time(),
    'worker_updated' => time(),
    'worker_progress' => count(ls_thumb_ready_times($thumbDir)),
    'worker_total' => intval(ceil(floatval($state['total_duration']) / LS_THUMB_INTERVAL)),
  ]);
  writelog("INFO thumbnail worker start id:$id pid:$pid", 'Livestream');
  return ['started' => $pid > 0, 'pid' => $pid, 'status' => $pid > 0 ? 'running' : 'start_failed'];
}

/**
 * サムネイル全量作成worker本体
 */
function ls_run_thumb_worker($id)
{
  $thumbDir = ls_thumb_root_dir() . "/" . $id;
  if (!preg_match('/^[a-f0-9]{64}$/', $id) || !is_dir($thumbDir)) {
    writelog("WARN thumbnail worker invalid id or dir id:$id dir:$thumbDir", 'Livestream');
    return 1;
  }
  $workerLock = fopen("$thumbDir/worker.lock", 'c');
  if ($workerLock === false || !flock($workerLock, LOCK_EX | LOCK_NB)) {
    writelog("INFO thumbnail worker already running id:$id", 'Livestream');
    return 0;
  }

  try {
    writelog("INFO thumbnail worker boot id:$id sapi:" . PHP_SAPI . " binary:" . PHP_BINARY, 'Livestream');
    $manifest = ls_read_thumb_manifest($thumbDir);
    list($state, $reason) = ls_thumb_state_from_manifest($id, $manifest);
    if (!$state) {
      writelog("WARN thumbnail worker rejected id:$id reason:$reason", 'Livestream');
      return 1;
    }
    $duration = floatval($state['total_duration']);
    $total = $duration > 0 ? intval(ceil($duration / LS_THUMB_INTERVAL)) : 0;
    ls_write_thumb_manifest($thumbDir, $state, [
      'worker_status' => 'running',
      'worker_pid' => getmypid(),
      'worker_updated' => time(),
      'worker_total' => $total,
    ]);

    for ($second = 0; $second < $duration; $second += LS_THUMB_INTERVAL) {
      list($thumbFile, $contentType) = ls_thumb_existing_file($thumbDir, $second);
      if ($thumbFile === null) {
        ls_generate_thumb($thumbDir, $state, $second, true);
      }
      $ready = count(ls_thumb_ready_times($thumbDir));
      ls_write_thumb_manifest($thumbDir, $state, [
        'worker_status' => 'running',
        'worker_pid' => getmypid(),
        'worker_updated' => time(),
        'worker_progress' => $ready,
        'worker_total' => $total,
      ]);
      clearstatcache();
    }

    $ready = count(ls_thumb_ready_times($thumbDir));
    ls_write_thumb_manifest($thumbDir, $state, [
      'worker_status' => 'complete',
      'worker_pid' => 0,
      'worker_updated' => time(),
      'worker_progress' => $ready,
      'worker_total' => $total,
    ]);
    writelog("INFO thumbnail worker complete id:$id ready:$ready total:$total", 'Livestream');
  } finally {
    flock($workerLock, LOCK_UN);
    fclose($workerLock);
  }
  return 0;
}

// ============================================================
// モード別処理
// ============================================================

if ($mode == 'thumb_worker') {
  if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit;
  }
  $id = isset($_REQUEST['id']) ? preg_replace('/[^a-f0-9]/', '', $_REQUEST['id']) : '';
  exit(ls_run_thumb_worker($id));
} elseif ($mode == 'stop') {
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
} elseif ($mode == 'thumb_manifest') {
  $hlsDir = $conf["comistream_tool_dir"] . "/data/theme/hls/$user";
  $id = isset($_REQUEST['id']) ? preg_replace('/[^a-f0-9]/', '', $_REQUEST['id']) : '';
  list($state, $rejectReason) = ls_read_thumb_state($hlsDir, $id);
  if (!$state) {
    writelog("WARN thumb_manifest rejected user:$user reason:$rejectReason", $writelog_process_name);
    ls_json_response(['enabled' => false, 'error' => $rejectReason], 404);
  }
  if ($rejectReason === 'thumbnail disabled') {
    ls_json_response(['enabled' => false, 'id' => $id]);
  }

  $thumbDir = ls_thumb_root_dir() . "/" . $id;
  if (!ls_prepare_thumb_cache($thumbDir, $state)) {
    writelog("ERROR thumb_manifest cache dir failed:$thumbDir", $writelog_process_name);
    ls_json_response(['enabled' => false, 'error' => 'cache directory unavailable'], 503);
  }
  $manifest = ls_write_thumb_manifest($thumbDir, $state);
  ls_json_response([
    'enabled' => true,
    'id' => $id,
    'duration' => floatval($state['total_duration']),
    'interval' => LS_THUMB_INTERVAL,
    'width' => LS_THUMB_WIDTH,
    'height' => LS_THUMB_HEIGHT,
    'format' => $manifest['format'],
    'fallback_format' => $manifest['fallback_format'],
    'url_template' => $_SERVER['SCRIPT_NAME'] . "?mode=thumb&id=$id&t={time}",
    'warmup_url' => $_SERVER['SCRIPT_NAME'] . "?mode=thumb_warmup&id=$id",
    'worker_start_url' => $_SERVER['SCRIPT_NAME'] . "?mode=thumb_worker_start&id=$id",
    'ready' => $manifest['generated'],
    'complete' => $manifest['complete'],
    'worker_status' => $manifest['worker_status'] ?? '',
    'worker_progress' => $manifest['worker_progress'] ?? count($manifest['generated']),
    'worker_total' => $manifest['worker_total'] ?? intval(ceil(floatval($state['total_duration']) / LS_THUMB_INTERVAL)),
  ]);
} elseif ($mode == 'thumb_worker_start') {
  $hlsDir = $conf["comistream_tool_dir"] . "/data/theme/hls/$user";
  $id = isset($_REQUEST['id']) ? preg_replace('/[^a-f0-9]/', '', $_REQUEST['id']) : '';
  session_write_close();

  list($state, $rejectReason) = ls_read_thumb_state($hlsDir, $id);
  if (!$state || $rejectReason !== '') {
    ls_json_response(['enabled' => false, 'error' => $rejectReason], $rejectReason === 'thumbnail disabled' ? 200 : 403);
  }
  $thumbDir = ls_thumb_root_dir() . "/" . $id;
  if (!ls_prepare_thumb_cache($thumbDir, $state)) {
    ls_json_response(['enabled' => false, 'error' => 'cache directory unavailable'], 503);
  }
  $worker = ls_start_thumb_worker($thumbDir, $state);
  $manifest = ls_write_thumb_manifest($thumbDir, $state);
  ls_json_response([
    'enabled' => true,
    'started' => $worker['started'],
    'pid' => $worker['pid'],
    'status' => $worker['status'],
    'complete' => $manifest['complete'],
    'ready' => $manifest['generated'],
    'worker_progress' => $manifest['worker_progress'] ?? count($manifest['generated']),
    'worker_total' => $manifest['worker_total'] ?? intval(ceil(floatval($state['total_duration']) / LS_THUMB_INTERVAL)),
  ]);
} elseif ($mode == 'thumb') {
  $hlsDir = $conf["comistream_tool_dir"] . "/data/theme/hls/$user";
  $id = isset($_REQUEST['id']) ? preg_replace('/[^a-f0-9]/', '', $_REQUEST['id']) : '';
  $seconds = isset($_REQUEST['t']) ? floatval($_REQUEST['t']) : 0.0;
  session_write_close();
  set_time_limit(0);

  list($state, $rejectReason) = ls_read_thumb_state($hlsDir, $id);
  if (!$state || $rejectReason !== '') {
    writelog("WARN thumb rejected user:$user id:$id t:$seconds reason:$rejectReason", $writelog_process_name);
    http_response_code($rejectReason === 'thumbnail disabled' ? 404 : 403);
    exit;
  }
  $thumbDir = ls_thumb_root_dir() . "/" . $id;
  if (!ls_prepare_thumb_cache($thumbDir, $state)) {
    http_response_code(503);
    exit;
  }
  $thumbSecond = ls_thumb_round_time($seconds, $state['total_duration']);
  list($thumbFile, $contentType) = ls_thumb_existing_file($thumbDir, $thumbSecond);
  if ($thumbFile === null) {
    list($thumbFile, $contentType) = ls_generate_thumb($thumbDir, $state, $thumbSecond);
  }
  if ($thumbFile === null) {
    http_response_code(503);
    header('Retry-After: 2');
    exit;
  }
  header('Content-Type: ' . $contentType);
  header('Content-Length: ' . filesize($thumbFile));
  header('Cache-Control: private, max-age=86400');
  readfile($thumbFile);
  exit;
} elseif ($mode == 'thumb_warmup') {
  $hlsDir = $conf["comistream_tool_dir"] . "/data/theme/hls/$user";
  $id = isset($_REQUEST['id']) ? preg_replace('/[^a-f0-9]/', '', $_REQUEST['id']) : '';
  $from = isset($_REQUEST['from']) ? floatval($_REQUEST['from']) : 0.0;
  $limit = isset($_REQUEST['limit']) ? intval($_REQUEST['limit']) : LS_THUMB_WARMUP_LIMIT;
  $limit = max(1, min($limit, LS_THUMB_WARMUP_LIMIT));
  session_write_close();
  set_time_limit(0);

  list($state, $rejectReason) = ls_read_thumb_state($hlsDir, $id);
  if (!$state || $rejectReason !== '') {
    ls_json_response(['enabled' => false, 'error' => $rejectReason], $rejectReason === 'thumbnail disabled' ? 200 : 403);
  }
  $thumbDir = ls_thumb_root_dir() . "/" . $id;
  if (!ls_prepare_thumb_cache($thumbDir, $state)) {
    ls_json_response(['enabled' => false, 'error' => 'cache directory unavailable'], 503);
  }
  $start = ls_thumb_round_time($from, $state['total_duration']);
  $generated = [];
  for ($second = $start; $second < floatval($state['total_duration']) && count($generated) < $limit; $second += LS_THUMB_INTERVAL) {
    list($thumbFile, $contentType) = ls_thumb_existing_file($thumbDir, $second);
    if ($thumbFile === null) {
      list($thumbFile, $contentType) = ls_generate_thumb($thumbDir, $state, $second);
    }
    if ($thumbFile !== null) {
      $generated[] = $second;
    }
  }
  $manifest = ls_write_thumb_manifest($thumbDir, $state);
  ls_json_response([
    'enabled' => true,
    'generated' => $generated,
    'ready' => $manifest['generated'],
  ]);
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
  $fileId = hash('sha256', $openFile);

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
      'total_duration' => $totalDuration,
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
  $thumbInterval = LS_THUMB_INTERVAL;
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
    #seek_preview {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: none;
      overflow: hidden;
      color: white;
      z-index: 2;
      pointer-events: none;
      font-family: sans-serif;
      font-size: 14px;
      line-height: 1.2;
    }
    #seek_preview img {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translateX(-50%) translateY(-50%);
      width: 100%;
      height: auto;
      max-width: none;
      max-height: none;
      background-color: black;
    }
    #seek_preview_time {
      position: absolute;
      left: 50%;
      bottom: 64px;
      transform: translateX(-50%);
      min-width: 64px;
      padding: 8px 10px;
      color: white;
      background-color: rgba(0,0,0,0.72);
      border-radius: 4px;
      text-align: center;
      white-space: nowrap;
      z-index: 3;
    }
  </style>
    <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
</head>
<body>
<div class="video_wrapper">
    <div id="movie_title" class="movie_title"><span>$baseFile</span></div>
    <div id="progress"></div>
    <video id="video" controls autoplay width="854" height="480" poster="$poster"></video>
    <div id="seek_preview" aria-hidden="true">
      <img id="seek_preview_image" alt="">
      <span id="seek_preview_time"></span>
    </div>
</div>
<script>
  const publicDir = "$publicDir";
  const themeDir = "";
  const cgiPath = "$cgiPath";
  const user = "$user";
  const fileId = "$fileId";
  const playbackMode = "$playbackMode";
  const startPosition = $startPosition;
  const thumbInterval = $thumbInterval;

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
