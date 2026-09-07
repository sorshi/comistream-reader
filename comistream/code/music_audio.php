<?php

/**
 * Comistream Reader - Music Audio Compatibility Helpers
 *
 * ALACを含む音源のプローブ、変換ジョブ、共有キャッシュ、Range配信を扱います。
 * リクエストから受け取った値をFFmpegの引数として直接利用しない構成にします。
 *
 * @package     sorshi/comistream-reader
 * @license     AGPL-3.0-only for Comistream Reader project-specific portions; see repository-root LICENSING.md
 * @requires    PHP 8.3 or later
 */

/**
 * 変換キャッシュの実装バージョンを返します。
 */
function musicAudioImplementationVersion(): string
{
    return '1';
}

/**
 * 音声処理のログを既存の writelog へ渡します。
 */
function musicAudioLog(string $level, string $message): void
{
    if (function_exists('writelog')) {
        writelog($level . ' ' . $message, 'MusicPlayer');
    }
}

/**
 * サーバー側で認める固定変換プロファイルを返します。
 */
function musicAudioProfileDefinitions(): array
{
    return [
        'flac' => [
            'extension' => 'flac',
            'outputName' => 'audio.flac',
            'mime' => 'audio/flac',
            'contentType' => 'audio/flac',
            'codec' => 'flac',
            'lossless' => true,
        ],
        'aac_lc' => [
            'extension' => 'm4a',
            'outputName' => 'audio.m4a',
            'mime' => 'audio/mp4',
            'contentType' => 'audio/mp4; codecs="mp4a.40.2"',
            'codec' => 'aac',
            'lossless' => false,
        ],
    ];
}

/**
 * UIとAPIで使うプロファイル名を正規化します。
 */
function musicAudioNormalizeProfile($profile): ?string
{
    $profile = strtolower(trim((string)$profile));
    if ($profile === 'aac' || $profile === 'aac-lc') {
        $profile = 'aac_lc';
    }
    return array_key_exists($profile, musicAudioProfileDefinitions()) ? $profile : null;
}

/**
 * 互換再生の品質方針を正規化します。
 */
function musicAudioQualityPolicy(array $conf): string
{
    $policy = strtolower(trim((string)($conf['musicAudioPolicy'] ?? 'auto')));
    if (!in_array($policy, ['auto', 'lossless_only', 'bandwidth'], true)) {
        return 'auto';
    }
    return $policy;
}

/**
 * 互換再生機能が有効か確認します。
 */
function musicAudioIsEnabled(array $conf): bool
{
    return (string)($conf['musicAudioEnabled'] ?? '1') !== '0';
}

/**
 * 設定値を安全な正の整数へ変換します。
 */
function musicAudioPositiveConfig(array $conf, string $key, int $default, int $maximum): int
{
    $value = filter_var($conf[$key] ?? null, FILTER_VALIDATE_INT);
    if ($value === false || $value < 1) {
        return $default;
    }
    return min((int)$value, $maximum);
}

function musicAudioMaxOutputBytes(array $conf): int
{
    return musicAudioPositiveConfig($conf, 'musicAudioMaxOutputMB', 2048, 1048576) * 1048576;
}

/**
 * FFmpeg/FFprobe設定から、引数を含まない実行ファイルを解決します。
 */
function musicAudioResolveExecutable(?string $configured): ?string
{
    $configured = trim((string)$configured);
    if ($configured === '' || preg_match('/[\r\n]/', $configured) === 1) {
        return null;
    }

    if (strpbrk($configured, '/\\') !== false) {
        return is_file($configured) && is_executable($configured) ? $configured : null;
    }

    $resolved = trim((string)@shell_exec('command -v ' . escapeshellarg($configured) . ' 2>/dev/null'));
    if ($resolved === '' || str_contains($resolved, "\n")) {
        return null;
    }
    return is_file($resolved) && is_executable($resolved) ? $resolved : null;
}

/**
 * FFprobeの候補を設定、FFmpegの隣、PATHの順で解決します。
 */
function musicAudioResolveFFprobe(array $conf): ?string
{
    $configured = musicAudioResolveExecutable($conf['ffprobe'] ?? null);
    if ($configured !== null) {
        return $configured;
    }

    $ffmpeg = musicAudioResolveExecutable($conf['ffmpeg'] ?? null);
    if ($ffmpeg !== null) {
        $sibling = dirname($ffmpeg) . DIRECTORY_SEPARATOR . 'ffprobe';
        if (is_file($sibling) && is_executable($sibling)) {
            return $sibling;
        }
    }

    return musicAudioResolveExecutable('ffprobe');
}

/**
 * FFmpegの実行ファイルを解決します。
 */
function musicAudioResolveFFmpeg(array $conf): ?string
{
    return musicAudioResolveExecutable($conf['ffmpeg'] ?? null)
        ?? musicAudioResolveExecutable('ffmpeg');
}

/**
 * 外部コマンドを実行し、終了状態を返します。
 * stdout/stderrは指定されたファイルへ出し、パイプ詰まりを避けます。
 */
function musicAudioRunProcess(
    string $command,
    string $stdoutPath,
    string $stderrPath,
    int $timeoutSeconds,
    ?string $monitorPath = null,
    ?int $maxOutputBytes = null
): array {
    $descriptors = [
        0 => ['file', '/dev/null', 'r'],
        1 => ['file', $stdoutPath, 'wb'],
        2 => ['file', $stderrPath, 'wb'],
    ];
    $pipes = [];
    $process = @proc_open($command, $descriptors, $pipes);
    if (!is_resource($process)) {
        return ['started' => false, 'exitCode' => -1, 'timedOut' => false, 'limitExceeded' => false];
    }

    $timeoutSeconds = max(1, min($timeoutSeconds, 86400));
    $startedAt = microtime(true);
    $timedOut = false;
    $limitExceeded = false;
    $lastStatus = ['running' => true, 'exitcode' => -1];
    while (true) {
        $lastStatus = proc_get_status($process);
        if (!($lastStatus['running'] ?? false)) {
            break;
        }
        if ($monitorPath !== null && $maxOutputBytes !== null) {
            $currentSize = @filesize($monitorPath);
            if ($currentSize !== false && $currentSize > $maxOutputBytes) {
                $limitExceeded = true;
                @proc_terminate($process, 15);
                break;
            }
            $freeBytes = @disk_free_space(dirname($monitorPath));
            if ($freeBytes !== false && $freeBytes < 16777216) {
                $limitExceeded = true;
                @proc_terminate($process, 15);
                break;
            }
        }
        if (microtime(true) - $startedAt > $timeoutSeconds) {
            $timedOut = true;
            @proc_terminate($process, 15);
            usleep(250000);
            $lastStatus = proc_get_status($process);
            if (($lastStatus['running'] ?? false)) {
                @proc_terminate($process, 9);
            }
            break;
        }
        usleep(100000);
    }

    $exitCode = @proc_close($process);
    if ($exitCode < 0 && isset($lastStatus['exitcode'])) {
        $exitCode = (int)$lastStatus['exitcode'];
    }
    return [
        'started' => true,
        'exitCode' => $exitCode,
        'timedOut' => $timedOut,
        'limitExceeded' => $limitExceeded,
    ];
}

/**
 * 音声ファイルをFFprobeで調べます。画像ストリームは音声として扱いません。
 */
function musicAudioProbe(string $path, array $conf): array
{
    $ffprobe = musicAudioResolveFFprobe($conf);
    if ($ffprobe === null) {
        return ['status' => 'unavailable', 'error' => 'ffprobe unavailable'];
    }
    if (!is_file($path) || !is_readable($path)) {
        return ['status' => 'error', 'error' => 'source unavailable'];
    }

    $stdoutPath = @tempnam(sys_get_temp_dir(), 'comistream-audio-probe-');
    $stderrPath = @tempnam(sys_get_temp_dir(), 'comistream-audio-probe-error-');
    if ($stdoutPath === false || $stderrPath === false) {
        if (is_string($stdoutPath)) {
            @unlink($stdoutPath);
        }
        if (is_string($stderrPath)) {
            @unlink($stderrPath);
        }
        return ['status' => 'error', 'error' => 'probe temporary file unavailable'];
    }

    $entries = 'format=format_name,duration,size,start_time:'
        . 'stream=index,codec_type,codec_name,profile,sample_rate,channels,channel_layout,'
        . 'bits_per_sample,bits_per_raw_sample,duration,start_time,disposition';
    $command = escapeshellarg($ffprobe)
        . ' -v error -print_format json -show_entries ' . escapeshellarg($entries)
        . ' -show_streams -show_format -i ' . escapeshellarg($path);
    $result = musicAudioRunProcess($command, $stdoutPath, $stderrPath, 60);
    $json = @file_get_contents($stdoutPath, false, null, 0, 1048576);
    $diagnostic = trim((string)@file_get_contents($stderrPath, false, null, 0, 8192));
    @unlink($stdoutPath);
    @unlink($stderrPath);

    if (!$result['started'] || $result['timedOut'] || $result['exitCode'] !== 0 || !is_string($json)) {
        musicAudioLog('WARNING', 'musicAudioProbe() ffprobe failed: ' . substr($diagnostic, 0, 240));
        return ['status' => 'error', 'error' => 'probe failed'];
    }

    $decoded = json_decode($json, true);
    if (!is_array($decoded)) {
        musicAudioLog('WARNING', 'musicAudioProbe() invalid ffprobe JSON');
        return ['status' => 'error', 'error' => 'invalid probe response'];
    }

    $audioStream = null;
    $videoStreamCount = 0;
    foreach (($decoded['streams'] ?? []) as $stream) {
        if (!is_array($stream)) {
            continue;
        }
        if (($stream['codec_type'] ?? '') === 'audio' && $audioStream === null) {
            $audioStream = $stream;
        }
        if (($stream['codec_type'] ?? '') === 'video') {
            $videoStreamCount++;
        }
    }
    if ($audioStream === null || trim((string)($audioStream['codec_name'] ?? '')) === '') {
        return ['status' => 'error', 'error' => 'audio stream not found'];
    }

    $format = is_array($decoded['format'] ?? null) ? $decoded['format'] : [];
    $codec = strtolower(trim((string)$audioStream['codec_name']));
    $sampleRate = filter_var($audioStream['sample_rate'] ?? null, FILTER_VALIDATE_INT);
    $channels = filter_var($audioStream['channels'] ?? null, FILTER_VALIDATE_INT);
    $bits = filter_var($audioStream['bits_per_raw_sample'] ?? null, FILTER_VALIDATE_INT);
    if ($bits === false || $bits < 1) {
        $bits = filter_var($audioStream['bits_per_sample'] ?? null, FILTER_VALIDATE_INT);
    }
    $duration = (float)($audioStream['duration'] ?? $format['duration'] ?? 0);
    $container = strtolower((string)($format['format_name'] ?? ''));
    $contentType = musicAudioCodecContentType($codec, $container);

    return [
        'status' => 'ok',
        'codec' => $codec,
        'codecProfile' => (string)($audioStream['profile'] ?? ''),
        'container' => $container,
        'sampleRate' => $sampleRate === false ? null : (int)$sampleRate,
        'channels' => $channels === false ? null : (int)$channels,
        'channelLayout' => (string)($audioStream['channel_layout'] ?? ''),
        'bitDepth' => $bits === false ? null : (int)$bits,
        'duration' => is_finite($duration) && $duration >= 0 ? $duration : 0.0,
        'size' => (int)($format['size'] ?? @filesize($path)),
        'startTime' => (float)($audioStream['start_time'] ?? 0),
        'videoStreamCount' => $videoStreamCount,
        'mime' => $contentType['mime'],
        'codecs' => $contentType['codecs'],
    ];
}

/**
 * コーデックとコンテナからブラウザへ示すMIMEを作ります。
 */
function musicAudioCodecContentType(string $codec, string $container = ''): array
{
    $codec = strtolower($codec);
    $container = strtolower($container);
    if ($codec === 'alac') {
        return ['mime' => 'audio/mp4', 'codecs' => 'alac'];
    }
    if ($codec === 'flac') {
        return ['mime' => 'audio/flac', 'codecs' => 'flac'];
    }
    if ($codec === 'aac') {
        return ['mime' => 'audio/mp4', 'codecs' => 'mp4a.40.2'];
    }
    if ($codec === 'mp3') {
        return ['mime' => 'audio/mpeg', 'codecs' => 'mp3'];
    }
    if ($codec === 'vorbis') {
        return ['mime' => 'audio/ogg', 'codecs' => 'vorbis'];
    }
    if ($codec === 'opus') {
        return ['mime' => 'audio/ogg', 'codecs' => 'opus'];
    }
    if ($codec === 'pcm_s16le' || $codec === 'pcm_s24le' || $codec === 'pcm_s32le') {
        return ['mime' => 'audio/wav', 'codecs' => '1'];
    }
    return ['mime' => null, 'codecs' => null];
}

/**
 * 原本の内容と更新情報から、同一性を表すマニフェストを作ります。
 */
function musicAudioBuildSourceManifest(string $path, ?array $probe = null): ?array
{
    clearstatcache(true, $path);
    $stat = @stat($path);
    if ($stat === false || !is_file($path) || is_link($path)) {
        return null;
    }
    $sha256 = @hash_file('sha256', $path);
    if (!is_string($sha256) || preg_match('/^[a-f0-9]{64}$/', $sha256) !== 1) {
        return null;
    }

    $identity = [
        'path' => realpath($path) ?: $path,
        'size' => (int)($stat['size'] ?? 0),
        'mtime' => (int)($stat['mtime'] ?? 0),
        'ctime' => (int)($stat['ctime'] ?? 0),
        'mode' => (int)($stat['mode'] ?? 0),
        'sha256' => $sha256,
    ];
    $encoded = json_encode($identity, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    if ($encoded === false) {
        return null;
    }

    return [
        'version' => hash('sha256', $encoded),
        'identity' => $identity,
        'probe' => is_array($probe) ? $probe : null,
    ];
}

/**
 * 共有音楽キャッシュの固定ロックを開きます。
 */
function musicAudioOpenCacheLock(string $toolDirectory)
{
    if (function_exists('openMusicCacheLock')) {
        return openMusicCacheLock($toolDirectory);
    }
    if ($toolDirectory === '') {
        return false;
    }
    $lockDirectory = rtrim($toolDirectory, DIRECTORY_SEPARATOR)
        . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'runtime'
        . DIRECTORY_SEPARATOR . 'music';
    if (!is_dir($lockDirectory) && !@mkdir($lockDirectory, 0775, true) && !is_dir($lockDirectory)) {
        return false;
    }
    return @fopen($lockDirectory . DIRECTORY_SEPARATOR . 'music-cache.lock', 'c');
}

/**
 * キャッシュ直下の音声項目名を安全に検証します。
 */
function musicAudioCacheEntryName(string $assetId): ?string
{
    return preg_match('/^[a-f0-9]{64}$/', $assetId) === 1
        ? 'music-audio-' . $assetId
        : null;
}

function musicAudioCacheEntryPath(string $cacheDirectory, string $assetId): ?string
{
    $entryName = musicAudioCacheEntryName($assetId);
    if ($entryName === null || $cacheDirectory === '') {
        return null;
    }
    return rtrim($cacheDirectory, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . $entryName;
}

/**
 * キャッシュJSONを一時ファイルから同一ディレクトリ内で置き換えます。
 */
function musicAudioWriteAtomic(string $path, string $contents): bool
{
    $temporary = @tempnam(dirname($path), '.audio-');
    if ($temporary === false) {
        return false;
    }
    $written = @file_put_contents($temporary, $contents, LOCK_EX);
    if ($written === false || $written !== strlen($contents) || !@rename($temporary, $path)) {
        @unlink($temporary);
        return false;
    }
    return true;
}

function musicAudioReadManifest(string $entryDirectory): ?array
{
    $path = $entryDirectory . DIRECTORY_SEPARATOR . 'manifest.json';
    if (!is_dir($entryDirectory) || is_link($entryDirectory) || is_link($path) || !is_file($path)) {
        return null;
    }
    $size = @filesize($path);
    if ($size === false || $size > 131072) {
        return null;
    }
    $manifest = json_decode((string)@file_get_contents($path), true);
    return is_array($manifest) ? $manifest : null;
}

function musicAudioWriteManifest(string $entryDirectory, array $manifest): bool
{
    $encoded = json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    return $encoded !== false && musicAudioWriteAtomic($entryDirectory . DIRECTORY_SEPARATOR . 'manifest.json', $encoded);
}

/**
 * 出力ファイルがマニフェストの期待する名前と一致するか確認します。
 */
function musicAudioOutputPath(string $entryDirectory, string $profile): ?string
{
    $definition = musicAudioProfileDefinitions()[$profile] ?? null;
    if (!is_array($definition)) {
        return null;
    }
    return $entryDirectory . DIRECTORY_SEPARATOR . $definition['outputName'];
}

function musicAudioOutputIsReady(string $entryDirectory, string $profile, ?array $manifest = null): bool
{
    $output = musicAudioOutputPath($entryDirectory, $profile);
    if ($output === null || !is_file($output) || is_link($output)) {
        return false;
    }
    $size = @filesize($output);
    if ($size === false || $size <= 0) {
        return false;
    }
    return !isset($manifest['size']) || (int)$manifest['size'] === (int)$size;
}

/**
 * 原本の音声ストリームが指定プロファイルの入力条件を満たすか確認します。
 */
function musicAudioProfileCanConvert(string $profile, array $probe): bool
{
    if (($probe['status'] ?? '') !== 'ok' || ($probe['codec'] ?? '') !== 'alac') {
        return false;
    }
    if ($profile === 'flac') {
        return true;
    }
    if ($profile === 'aac_lc') {
        $channels = (int)($probe['channels'] ?? 0);
        return $channels >= 1 && $channels <= 2;
    }
    return false;
}

/**
 * PCMのフレームダイジェストを作り、可逆変換の一致確認に使います。
 */
function musicAudioPcmDigest(string $path, array $conf, int $timeoutSeconds): ?string
{
    $ffmpeg = musicAudioResolveFFmpeg($conf);
    if ($ffmpeg === null) {
        return null;
    }
    $stdoutPath = @tempnam(sys_get_temp_dir(), 'comistream-audio-pcm-');
    $stderrPath = @tempnam(sys_get_temp_dir(), 'comistream-audio-pcm-error-');
    if ($stdoutPath === false || $stderrPath === false) {
        if (is_string($stdoutPath)) {
            @unlink($stdoutPath);
        }
        if (is_string($stderrPath)) {
            @unlink($stderrPath);
        }
        return null;
    }
    $command = escapeshellarg($ffmpeg)
        . ' -v error -nostdin -i ' . escapeshellarg($path)
        . ' -map 0:a:0 -map_metadata -1 -af ' . escapeshellarg('asetnsamples=n=4096:pad=0')
        . ' -f framemd5 -';
    $result = musicAudioRunProcess($command, $stdoutPath, $stderrPath, $timeoutSeconds);
    $contents = @file_get_contents($stdoutPath);
    $diagnostic = trim((string)@file_get_contents($stderrPath, false, null, 0, 4096));
    @unlink($stdoutPath);
    @unlink($stderrPath);
    if (!$result['started'] || $result['timedOut'] || $result['exitCode'] !== 0 || !is_string($contents)) {
        musicAudioLog('WARNING', 'musicAudioPcmDigest() ffmpeg failed: ' . substr($diagnostic, 0, 160));
        return null;
    }
    // ヘッダーは除外し、フレーム内容だけを比較するルン。
    $contents = preg_replace('/^#.*(?:\r?\n|$)/m', '', $contents) ?? $contents;
    return hash('sha256', trim($contents));
}

/**
 * 変換出力の音声形式と、原本から維持すべき属性を検証します。
 */
function musicAudioValidateOutput(
    string $outputPath,
    string $profile,
    array $sourceProbe,
    array $conf,
    int $timeoutSeconds
): array {
    if (!is_file($outputPath) || is_link($outputPath)) {
        return ['ok' => false, 'error' => 'output missing'];
    }
    $maxOutputBytes = musicAudioMaxOutputBytes($conf);
    $size = @filesize($outputPath);
    if ($size === false || $size <= 0 || $size > $maxOutputBytes) {
        return ['ok' => false, 'error' => 'output size invalid'];
    }
    $outputProbe = musicAudioProbe($outputPath, $conf);
    if (($outputProbe['status'] ?? '') !== 'ok' || ($outputProbe['videoStreamCount'] ?? 0) > 0) {
        return ['ok' => false, 'error' => 'output stream invalid'];
    }

    $sourceChannels = (int)($sourceProbe['channels'] ?? 0);
    $outputChannels = (int)($outputProbe['channels'] ?? 0);
    $sourceRate = (int)($sourceProbe['sampleRate'] ?? 0);
    $outputRate = (int)($outputProbe['sampleRate'] ?? 0);
    $sourceDuration = (float)($sourceProbe['duration'] ?? 0);
    $outputDuration = (float)($outputProbe['duration'] ?? 0);
    if ($sourceChannels > 0 && $sourceChannels !== $outputChannels) {
        return ['ok' => false, 'error' => 'channel count changed'];
    }
    if ($sourceRate > 0 && $sourceRate !== $outputRate) {
        return ['ok' => false, 'error' => 'sample rate changed'];
    }
    if ($sourceDuration > 0 && abs($sourceDuration - $outputDuration) > 1.0) {
        return ['ok' => false, 'error' => 'duration changed'];
    }

    if ($profile === 'flac') {
        if (($outputProbe['codec'] ?? '') !== 'flac') {
            return ['ok' => false, 'error' => 'not flac'];
        }
        $sourceBits = (int)($sourceProbe['bitDepth'] ?? 0);
        $outputBits = (int)($outputProbe['bitDepth'] ?? 0);
        if ($sourceBits > 0 && $outputBits > 0 && $sourceBits !== $outputBits) {
            return ['ok' => false, 'error' => 'bit depth changed'];
        }
        $sourceDigest = musicAudioPcmDigest((string)($sourceProbe['path'] ?? ''), $conf, $timeoutSeconds);
        $outputDigest = musicAudioPcmDigest($outputPath, $conf, $timeoutSeconds);
        if ($sourceDigest === null || $outputDigest === null || !hash_equals($sourceDigest, $outputDigest)) {
            return ['ok' => false, 'error' => 'pcm verification failed'];
        }
    } elseif ($profile === 'aac_lc') {
        if (($outputProbe['codec'] ?? '') !== 'aac' || $outputChannels < 1 || $outputChannels > 2) {
            return ['ok' => false, 'error' => 'not aac lc'];
        }
    } else {
        return ['ok' => false, 'error' => 'unknown output profile'];
    }

    return ['ok' => true, 'probe' => $outputProbe, 'size' => (int)$size];
}

/**
 * 変換中ジョブのプロセスがまだ存在するか確認します。
 */
function musicAudioProcessIsAlive($pid): bool
{
    $pid = filter_var($pid, FILTER_VALIDATE_INT);
    if ($pid === false || $pid < 1) {
        return false;
    }
    if (function_exists('posix_kill')) {
        return @posix_kill((int)$pid, 0);
    }
    if (is_dir('/proc/' . (int)$pid)) {
        return true;
    }
    if (PHP_OS_FAMILY !== 'Windows') {
        $process = @proc_open('kill -0 ' . (int)$pid, [
            0 => ['file', '/dev/null', 'r'],
            1 => ['file', '/dev/null', 'w'],
            2 => ['file', '/dev/null', 'w'],
        ], $pipes);
        if (is_resource($process)) {
            return @proc_close($process) === 0;
        }
    }
    return false;
}

function musicAudioJobIsStale(array $manifest, int $now): bool
{
    $updatedAt = (int)($manifest['updatedAt'] ?? $manifest['createdAt'] ?? 0);
    $pid = $manifest['pid'] ?? null;
    if ($pid !== null && musicAudioProcessIsAlive($pid)) {
        return false;
    }
    return $updatedAt < $now - 300;
}

function musicAudioMaxConcurrentJobs(array $conf): int
{
    return musicAudioPositiveConfig($conf, 'musicAudioMaxConcurrent', 1, 32);
}

function musicAudioCountActiveJobs(string $cacheDirectory): int
{
    $count = 0;
    foreach ((array)@glob(rtrim($cacheDirectory, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'music-audio-*') as $entry) {
        if (!is_dir($entry) || is_link($entry)) {
            continue;
        }
        $manifest = musicAudioReadManifest($entry);
        if (!is_array($manifest)) {
            continue;
        }
        $status = (string)($manifest['status'] ?? '');
        if (($status === 'queued' || $status === 'converting') && !musicAudioJobIsStale($manifest, time())) {
            $count++;
        }
    }
    return $count;
}

/**
 * セッション用の変換要求CSRFトークンを用意します。
 */
function musicAudioEnsureCsrfToken(): string
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        return '';
    }
    if (!isset($_SESSION['music_audio_csrf']) || !is_string($_SESSION['music_audio_csrf'])
        || preg_match('/^[a-f0-9]{64}$/', $_SESSION['music_audio_csrf']) !== 1) {
        $_SESSION['music_audio_csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['music_audio_csrf'];
}

function musicAudioValidateCsrfToken($provided): bool
{
    $expected = musicAudioEnsureCsrfToken();
    return is_string($provided) && $expected !== '' && hash_equals($expected, $provided);
}

/**
 * 原本パスを現在の共有領域の認可へ結び付けます。
 */
function musicAudioResolveManifestSource(array $conf, array $manifest): string|false
{
    $path = (string)($manifest['source']['identity']['path'] ?? '');
    if ($path === '' || !is_file($path)) {
        return false;
    }
    $sharePath = realpath((string)($conf['sharePath'] ?? ''));
    $realPath = realpath($path);
    if ($sharePath === false || $realPath === false) {
        return false;
    }
    $prefix = rtrim($sharePath, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
    if (strncmp($realPath, $prefix, strlen($prefix)) !== 0) {
        return false;
    }
    $relative = substr($realPath, strlen($prefix));
    if (!function_exists('resolveFileWithinBaseDirectory')) {
        return $realPath;
    }
    $resolved = resolveFileWithinBaseDirectory($sharePath, $relative);
    return $resolved === false ? false : $resolved;
}

/**
 * 原本の現在バージョンがキャッシュのマニフェストと一致するか確認します。
 */
function musicAudioManifestSourceIsCurrent(array $manifest, string $sourcePath): bool
{
    $current = musicAudioBuildSourceManifest($sourcePath);
    return is_array($current)
        && hash_equals((string)($manifest['sourceVersion'] ?? ''), (string)$current['version']);
}

function musicAudioStreamUrl(string $assetId): string
{
    return '/cgi-bin/music_player.php?mode=stream_audio&asset_id=' . rawurlencode($assetId);
}

function musicAudioJson(array $payload, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=UTF-8');
    header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
}

/**
 * 原本のコーデック、直接再生候補、変換候補を返します。
 */
function musicAudioGetPlaybackInfo(): void
{
    global $conf, $audioFormats, $writelog_process_name;
    $requestedFile = (string)($_REQUEST['file'] ?? '');
    $sourcePath = function_exists('resolveFileWithinBaseDirectory')
        ? resolveFileWithinBaseDirectory($conf['sharePath'] ?? '', $requestedFile)
        : false;
    if ($sourcePath === false) {
        writelog('WARNING getPlaybackInfo() rejected file request', $writelog_process_name);
        musicAudioJson(['success' => false, 'error' => 'file access denied'], 403);
        return;
    }
    $extension = strtolower(pathinfo($sourcePath, PATHINFO_EXTENSION));
    if (!in_array($extension, $audioFormats, true)) {
        musicAudioJson(['success' => false, 'error' => 'unsupported format'], 415);
        return;
    }

    $probe = musicAudioProbe($sourcePath, $conf);
    $sourceManifest = musicAudioBuildSourceManifest($sourcePath, $probe);
    if ($sourceManifest === null) {
        musicAudioJson(['success' => false, 'error' => 'source unavailable'], 500);
        return;
    }

    $direct = [];
    $conversion = [];
    if (($probe['status'] ?? '') === 'ok') {
        if (($probe['mime'] ?? null) !== null) {
            $direct[] = [
                'mime' => $probe['mime'],
                'codecs' => $probe['codecs'] ?? null,
                'contentType' => ($probe['codecs'] ?? null) !== null
                    ? $probe['mime'] . '; codecs="' . $probe['codecs'] . '"'
                    : $probe['mime'],
            ];
        }
        $profiles = musicAudioProfileDefinitions();
        $orderedProfiles = musicAudioQualityPolicy($conf) === 'bandwidth'
            ? ['aac_lc', 'flac']
            : ['flac', 'aac_lc'];
        foreach ($orderedProfiles as $profile) {
            if (!musicAudioIsEnabled($conf) || !musicAudioProfileCanConvert($profile, $probe)) {
                continue;
            }
            if (musicAudioQualityPolicy($conf) === 'lossless_only' && $profile !== 'flac') {
                continue;
            }
            $definition = $profiles[$profile];
            $conversion[] = [
                'profile' => $profile,
                'mime' => $definition['mime'],
                'codecs' => $profile === 'aac_lc' ? 'mp4a.40.2' : 'flac',
                'contentType' => $definition['contentType'],
                'lossless' => (bool)$definition['lossless'],
                'channels' => (int)($probe['channels'] ?? 0),
                'sampleRate' => (int)($probe['sampleRate'] ?? 0),
                'bitDepth' => (int)($probe['bitDepth'] ?? 0),
            ];
        }
    }

    musicAudioJson([
        'success' => true,
        'sourceVersion' => $sourceManifest['version'],
        'probeStatus' => $probe['status'] ?? 'error',
        'source' => [
            'codec' => $probe['codec'] ?? null,
            'codecProfile' => $probe['codecProfile'] ?? null,
            'container' => $probe['container'] ?? null,
            'mime' => $probe['mime'] ?? null,
            'codecs' => $probe['codecs'] ?? null,
            'sampleRate' => $probe['sampleRate'] ?? null,
            'channels' => $probe['channels'] ?? null,
            'channelLayout' => $probe['channelLayout'] ?? null,
            'bitDepth' => $probe['bitDepth'] ?? null,
            'duration' => $probe['duration'] ?? null,
        ],
        'direct' => $direct,
        'conversion' => $conversion,
        'qualityPolicy' => musicAudioQualityPolicy($conf),
    ]);
}

/**
 * 変換ワーカーをバックグラウンドで起動します。
 */
function musicAudioStartWorker(array $conf, string $assetId): bool
{
    $worker = rtrim((string)($conf['comistream_tool_dir'] ?? ''), DIRECTORY_SEPARATOR)
        . DIRECTORY_SEPARATOR . 'code' . DIRECTORY_SEPARATOR . 'music_audio_worker.php';
    if (!is_file($worker)) {
        musicAudioLog('ERROR', 'musicAudioStartWorker() worker script is missing');
        return false;
    }
    $php = musicAudioResolveExecutable($conf['php'] ?? null);
    if ($php === null && is_executable(PHP_BINARY)) {
        $php = PHP_BINARY;
    }
    if ($php === null) {
        musicAudioLog('ERROR', 'musicAudioStartWorker() PHP executable is unavailable');
        return false;
    }
    $runtimeDirectory = rtrim((string)($conf['comistream_tool_dir'] ?? ''), DIRECTORY_SEPARATOR)
        . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'runtime' . DIRECTORY_SEPARATOR . 'music';
    if (!is_dir($runtimeDirectory) && !@mkdir($runtimeDirectory, 0775, true) && !is_dir($runtimeDirectory)) {
        return false;
    }
    $logPath = $runtimeDirectory . DIRECTORY_SEPARATOR . 'music-audio-worker.log';
    $command = escapeshellarg($php) . ' ' . escapeshellarg($worker)
        . ' --job-id ' . escapeshellarg($assetId)
        . ' >> ' . escapeshellarg($logPath) . ' 2>&1 < /dev/null &';
    $output = [];
    $exitCode = 1;
    @exec($command, $output, $exitCode);
    return $exitCode === 0;
}

/**
 * 変換要求を受け、完成済みキャッシュまたはジョブ状態を返します。
 */
function musicAudioPrepareAudio(): void
{
    global $conf, $audioFormats, $writelog_process_name;
    if (strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'POST') {
        musicAudioJson(['success' => false, 'error' => 'method not allowed'], 405);
        return;
    }
    $providedCsrf = (string)($_POST['csrf'] ?? ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''));
    if (!musicAudioValidateCsrfToken($providedCsrf)) {
        musicAudioJson(['success' => false, 'error' => 'csrf failed'], 403);
        return;
    }
    if (!musicAudioIsEnabled($conf)) {
        musicAudioJson(['success' => false, 'error' => 'audio conversion disabled'], 503);
        return;
    }

    $requestedFile = (string)($_POST['file'] ?? $_REQUEST['file'] ?? '');
    $profile = musicAudioNormalizeProfile($_POST['profile'] ?? $_REQUEST['profile'] ?? '');
    if ($profile === null) {
        musicAudioJson(['success' => false, 'error' => 'invalid profile'], 400);
        return;
    }
    $sourcePath = function_exists('resolveFileWithinBaseDirectory')
        ? resolveFileWithinBaseDirectory($conf['sharePath'] ?? '', $requestedFile)
        : false;
    if ($sourcePath === false) {
        writelog('WARNING prepareAudio() rejected file request', $writelog_process_name);
        musicAudioJson(['success' => false, 'error' => 'file access denied'], 403);
        return;
    }
    $extension = strtolower(pathinfo($sourcePath, PATHINFO_EXTENSION));
    if (!in_array($extension, $audioFormats, true)) {
        musicAudioJson(['success' => false, 'error' => 'unsupported format'], 415);
        return;
    }

    $probe = musicAudioProbe($sourcePath, $conf);
    if (($probe['status'] ?? '') !== 'ok') {
        musicAudioJson(['success' => false, 'error' => 'source format could not be determined'], 422);
        return;
    }
    if (musicAudioQualityPolicy($conf) === 'lossless_only' && $profile !== 'flac') {
        musicAudioJson(['success' => false, 'error' => 'lossy conversion disabled'], 422);
        return;
    }
    if (!musicAudioProfileCanConvert($profile, $probe)) {
        musicAudioJson(['success' => false, 'error' => 'profile is not supported for this source'], 422);
        return;
    }

    $sourceManifest = musicAudioBuildSourceManifest($sourcePath, $probe);
    if ($sourceManifest === null) {
        musicAudioJson(['success' => false, 'error' => 'source unavailable'], 500);
        return;
    }
    $cacheDirectory = rtrim((string)($conf['cacheDir'] ?? ''), DIRECTORY_SEPARATOR);
    $toolDirectory = rtrim((string)($conf['comistream_tool_dir'] ?? ''), DIRECTORY_SEPARATOR);
    if ($cacheDirectory === '' || $toolDirectory === '') {
        musicAudioJson(['success' => false, 'error' => 'audio cache is not configured'], 503);
        return;
    }
    if (!is_dir($cacheDirectory) && !@mkdir($cacheDirectory, 0775, true) && !is_dir($cacheDirectory)) {
        musicAudioJson(['success' => false, 'error' => 'audio cache is unavailable'], 503);
        return;
    }

    $assetId = hash('sha256', json_encode([
        'source' => $sourceManifest['version'],
        'path' => $sourceManifest['identity']['path'],
        'profile' => $profile,
        'implementation' => musicAudioImplementationVersion(),
    ], JSON_UNESCAPED_SLASHES));
    $entryDirectory = musicAudioCacheEntryPath($cacheDirectory, $assetId);
    if ($entryDirectory === null) {
        musicAudioJson(['success' => false, 'error' => 'audio cache key failed'], 500);
        return;
    }

    $lock = musicAudioOpenCacheLock($toolDirectory);
    if ($lock === false || !@flock($lock, LOCK_EX)) {
        if (is_resource($lock)) {
            fclose($lock);
        }
        musicAudioJson(['success' => false, 'error' => 'audio cache is busy', 'retryAfter' => 2], 503);
        return;
    }

    $startWorker = false;
    $response = null;
    try {
        if (is_link($entryDirectory)) {
            musicAudioJson(['success' => false, 'error' => 'audio cache entry is invalid'], 500);
            return;
        }
        if (!is_dir($entryDirectory) && !@mkdir($entryDirectory, 0775, true) && !is_dir($entryDirectory)) {
            musicAudioJson(['success' => false, 'error' => 'audio cache entry unavailable'], 503);
            return;
        }
        $manifest = musicAudioReadManifest($entryDirectory);
        if (is_array($manifest) && ($manifest['sourceVersion'] ?? '') === $sourceManifest['version']
            && ($manifest['profile'] ?? '') === $profile) {
            $status = (string)($manifest['status'] ?? '');
            if ($status === 'ready' && musicAudioOutputIsReady($entryDirectory, $profile, $manifest)) {
                $response = ['status' => 'ready', 'httpStatus' => 200];
            } elseif (($status === 'queued' || $status === 'converting')
                && !musicAudioJobIsStale($manifest, time())) {
                $response = ['status' => $status, 'httpStatus' => 202];
            }
        }
        if ($response === null) {
            if (musicAudioCountActiveJobs($cacheDirectory) >= musicAudioMaxConcurrentJobs($conf)) {
                $response = ['status' => 'queued', 'httpStatus' => 429, 'retryAfter' => 5];
            } else {
                @unlink($entryDirectory . DIRECTORY_SEPARATOR . 'audio.flac');
                @unlink($entryDirectory . DIRECTORY_SEPARATOR . 'audio.m4a');
                @unlink($entryDirectory . DIRECTORY_SEPARATOR . 'audio.part');
                $now = time();
                $manifest = [
                    'manifestVersion' => 1,
                    'implementationVersion' => musicAudioImplementationVersion(),
                    'jobId' => $assetId,
                    'assetId' => $assetId,
                    'status' => 'queued',
                    'profile' => $profile,
                    'output' => musicAudioProfileDefinitions()[$profile]['outputName'],
                    'sourceVersion' => $sourceManifest['version'],
                    'source' => $sourceManifest,
                    'createdAt' => $now,
                    'updatedAt' => $now,
                    'pid' => null,
                    'error' => null,
                ];
                if (!musicAudioWriteManifest($entryDirectory, $manifest)) {
                    $response = ['status' => 'failed', 'httpStatus' => 503, 'error' => 'audio job could not be created'];
                } else {
                    $startWorker = true;
                    $response = ['status' => 'queued', 'httpStatus' => 202, 'retryAfter' => 1];
                }
            }
        }
    } finally {
        @flock($lock, LOCK_UN);
        fclose($lock);
    }

    if ($startWorker) {
        if (session_status() === PHP_SESSION_ACTIVE) {
            // 変換中にPHPセッションロックを保持しないルン。
            session_write_close();
        }
        if (!musicAudioStartWorker($conf, $assetId)) {
            $repairLock = musicAudioOpenCacheLock($toolDirectory);
            if ($repairLock !== false && @flock($repairLock, LOCK_EX)) {
                $repairManifest = musicAudioReadManifest($entryDirectory);
                if (is_array($repairManifest) && ($repairManifest['status'] ?? '') === 'queued') {
                    $repairManifest['status'] = 'failed';
                    $repairManifest['error'] = 'worker unavailable';
                    $repairManifest['updatedAt'] = time();
                    $repairManifest['failedAt'] = time();
                    musicAudioWriteManifest($entryDirectory, $repairManifest);
                }
                @flock($repairLock, LOCK_UN);
                fclose($repairLock);
            }
            musicAudioJson(['success' => false, 'status' => 'failed', 'error' => 'audio worker unavailable'], 503);
            return;
        }
    }

    $status = $response['status'] ?? 'failed';
    $payload = [
        'success' => $status !== 'failed' || ($response['httpStatus'] ?? 500) === 429,
        'status' => $status,
        'job_id' => $assetId,
        'asset_id' => $assetId,
        'profile' => $profile,
    ];
    if ($status === 'ready') {
        $payload['stream_url'] = musicAudioStreamUrl($assetId);
    }
    if (isset($response['retryAfter'])) {
        $payload['retry_after'] = (int)$response['retryAfter'];
    }
    if (isset($response['error'])) {
        $payload['error'] = $response['error'];
    }
    musicAudioJson($payload, (int)($response['httpStatus'] ?? 202));
}

/**
 * ジョブ状態を返します。原本へのアクセスも毎回検証します。
 */
function musicAudioGetStatus(): void
{
    global $conf;
    $assetId = strtolower((string)($_GET['job_id'] ?? $_GET['asset_id'] ?? ''));
    $cacheDirectory = rtrim((string)($conf['cacheDir'] ?? ''), DIRECTORY_SEPARATOR);
    $toolDirectory = rtrim((string)($conf['comistream_tool_dir'] ?? ''), DIRECTORY_SEPARATOR);
    $entryDirectory = musicAudioCacheEntryPath($cacheDirectory, $assetId);
    if ($entryDirectory === null || $toolDirectory === '') {
        musicAudioJson(['success' => false, 'error' => 'invalid job id'], 400);
        return;
    }
    $lock = musicAudioOpenCacheLock($toolDirectory);
    if ($lock === false || !@flock($lock, LOCK_SH)) {
        if (is_resource($lock)) {
            fclose($lock);
        }
        musicAudioJson(['success' => false, 'error' => 'audio cache is busy', 'retryAfter' => 2], 503);
        return;
    }
    $manifest = musicAudioReadManifest($entryDirectory);
    @flock($lock, LOCK_UN);
    fclose($lock);
    if (!is_array($manifest)) {
        musicAudioJson(['success' => false, 'error' => 'job not found'], 404);
        return;
    }
    $sourcePath = musicAudioResolveManifestSource($conf, $manifest);
    if ($sourcePath === false || !musicAudioManifestSourceIsCurrent($manifest, $sourcePath)) {
        musicAudioJson(['success' => false, 'status' => 'expired', 'error' => 'source unavailable'], 410);
        return;
    }
    $status = (string)($manifest['status'] ?? 'failed');
    if (($status === 'queued' || $status === 'converting') && musicAudioJobIsStale($manifest, time())) {
        $repairLock = musicAudioOpenCacheLock($toolDirectory);
        if ($repairLock !== false && @flock($repairLock, LOCK_EX)) {
            $latest = musicAudioReadManifest($entryDirectory);
            if (is_array($latest) && in_array(($latest['status'] ?? ''), ['queued', 'converting'], true)
                && musicAudioJobIsStale($latest, time())) {
                $latest['status'] = 'failed';
                $latest['error'] = 'worker stopped';
                $latest['updatedAt'] = time();
                $latest['failedAt'] = time();
                musicAudioWriteManifest($entryDirectory, $latest);
                $manifest = $latest;
                $status = 'failed';
            }
            @flock($repairLock, LOCK_UN);
            fclose($repairLock);
        }
    }

    $payload = [
        'success' => true,
        'status' => $status,
        'job_id' => $assetId,
        'asset_id' => $assetId,
        'profile' => $manifest['profile'] ?? null,
    ];
    if ($status === 'ready') {
        $profile = musicAudioNormalizeProfile($manifest['profile'] ?? '');
        if ($profile === null || !musicAudioOutputIsReady($entryDirectory, $profile, $manifest)) {
            $payload['status'] = 'failed';
            $payload['error'] = 'output unavailable';
        } else {
            $payload['stream_url'] = musicAudioStreamUrl($assetId);
            $payload['duration'] = $manifest['duration'] ?? null;
            $payload['size'] = $manifest['size'] ?? null;
            $payload['mime'] = $manifest['mime'] ?? null;
        }
    }
    if ($status === 'failed') {
        $payload['error'] = 'audio conversion failed';
    }
    if ($status === 'queued' || $status === 'converting') {
        $payload['retry_after'] = 1;
    }
    musicAudioJson($payload);
}

/**
 * 完成済み音声の利用時刻を更新します。
 */
function musicAudioTouch(): void
{
    global $conf;
    $assetId = strtolower((string)($_GET['asset_id'] ?? $_POST['asset_id'] ?? ''));
    $cacheDirectory = rtrim((string)($conf['cacheDir'] ?? ''), DIRECTORY_SEPARATOR);
    $toolDirectory = rtrim((string)($conf['comistream_tool_dir'] ?? ''), DIRECTORY_SEPARATOR);
    $entryDirectory = musicAudioCacheEntryPath($cacheDirectory, $assetId);
    if ($entryDirectory === null || $toolDirectory === '') {
        musicAudioJson(['success' => false, 'error' => 'invalid asset id'], 400);
        return;
    }
    $lock = musicAudioOpenCacheLock($toolDirectory);
    if ($lock === false || !@flock($lock, LOCK_SH)) {
        if (is_resource($lock)) {
            fclose($lock);
        }
        musicAudioJson(['success' => false, 'error' => 'audio cache is busy'], 503);
        return;
    }
    $manifest = musicAudioReadManifest($entryDirectory);
    $sourcePath = is_array($manifest) ? musicAudioResolveManifestSource($conf, $manifest) : false;
    if (is_array($manifest) && ($manifest['status'] ?? '') === 'ready'
        && $sourcePath !== false && musicAudioManifestSourceIsCurrent($manifest, $sourcePath)) {
        @file_put_contents($entryDirectory . DIRECTORY_SEPARATOR . 'access', (string)time(), LOCK_EX);
        @flock($lock, LOCK_UN);
        fclose($lock);
        musicAudioJson(['success' => true]);
        return;
    }
    @flock($lock, LOCK_UN);
    fclose($lock);
    musicAudioJson(['success' => false, 'error' => 'asset unavailable'], 410);
}

/**
 * 単一Rangeの値を解析します。
 */
function musicAudioParseRange(?string $header, int $size): array|false|null
{
    if ($header === null || $header === '') {
        return null;
    }
    if ($size < 1 || preg_match('/\Abytes=(\d*)-(\d*)\z/', trim($header), $matches) !== 1) {
        return false;
    }
    $startText = $matches[1];
    $endText = $matches[2];
    if ($startText === '' && $endText === '') {
        return false;
    }
    if ($startText === '') {
        $length = (int)$endText;
        if ($length < 1) {
            return false;
        }
        $length = min($length, $size);
        return [$size - $length, $size - 1];
    }
    $start = filter_var($startText, FILTER_VALIDATE_INT);
    if ($start === false || $start < 0 || $start >= $size) {
        return false;
    }
    $end = $endText === '' ? $size - 1 : filter_var($endText, FILTER_VALIDATE_INT);
    if ($end === false || $end < $start) {
        return false;
    }
    return [$start, min($end, $size - 1)];
}

function musicAudioIfRangeMatches(?string $ifRange, string $etag, int $mtime): bool
{
    if ($ifRange === null || trim($ifRange) === '') {
        return true;
    }
    $ifRange = trim($ifRange);
    if ($ifRange === $etag || trim($ifRange, '"') === trim($etag, '"')) {
        return true;
    }
    $timestamp = strtotime($ifRange);
    return $timestamp !== false && $mtime <= $timestamp;
}

/**
 * 完成済み音声をRange対応で配信します。
 */
function musicAudioStream(): void
{
    global $conf;
    $method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET'));
    if (!in_array($method, ['GET', 'HEAD'], true)) {
        http_response_code(405);
        header('Allow: GET, HEAD');
        return;
    }
    $assetId = strtolower((string)($_GET['asset_id'] ?? ''));
    $cacheDirectory = rtrim((string)($conf['cacheDir'] ?? ''), DIRECTORY_SEPARATOR);
    $toolDirectory = rtrim((string)($conf['comistream_tool_dir'] ?? ''), DIRECTORY_SEPARATOR);
    $entryDirectory = musicAudioCacheEntryPath($cacheDirectory, $assetId);
    if ($entryDirectory === null || $toolDirectory === '') {
        http_response_code(404);
        return;
    }
    $lock = musicAudioOpenCacheLock($toolDirectory);
    if ($lock === false || !@flock($lock, LOCK_SH)) {
        if (is_resource($lock)) {
            fclose($lock);
        }
        http_response_code(503);
        header('Retry-After: 2');
        return;
    }
    $manifest = musicAudioReadManifest($entryDirectory);
    $profile = is_array($manifest) ? musicAudioNormalizeProfile($manifest['profile'] ?? '') : null;
    $sourcePath = is_array($manifest) ? musicAudioResolveManifestSource($conf, $manifest) : false;
    if (!is_array($manifest) || $profile === null || ($manifest['status'] ?? '') !== 'ready') {
        @flock($lock, LOCK_UN);
        fclose($lock);
        http_response_code(404);
        return;
    }
    if ($sourcePath === false || !musicAudioManifestSourceIsCurrent($manifest, $sourcePath)) {
        @flock($lock, LOCK_UN);
        fclose($lock);
        http_response_code(410);
        return;
    }
    $outputPath = musicAudioOutputPath($entryDirectory, $profile);
    if ($outputPath === null || !is_file($outputPath) || is_link($outputPath)) {
        @flock($lock, LOCK_UN);
        fclose($lock);
        http_response_code(404);
        return;
    }
    $size = @filesize($outputPath);
    $stat = @stat($outputPath);
    if ($size === false || $size < 1 || $stat === false
        || (isset($manifest['size']) && (int)$manifest['size'] !== (int)$size)) {
        @flock($lock, LOCK_UN);
        fclose($lock);
        http_response_code(404);
        return;
    }
    $definition = musicAudioProfileDefinitions()[$profile];
    $etag = '"' . $assetId . '-' . (int)$size . '-' . (int)$stat['mtime'] . '"';
    header('Accept-Ranges: bytes');
    header('Content-Type: ' . $definition['mime']);
    header('Content-Length: ' . (int)$size);
    header('ETag: ' . $etag);
    header('Last-Modified: ' . gmdate('D, d M Y H:i:s', (int)$stat['mtime']) . ' GMT');
    header('Cache-Control: private, max-age=3600');
    header('X-Content-Type-Options: nosniff');
    if (isset($_SERVER['HTTP_IF_NONE_MATCH']) && trim((string)$_SERVER['HTTP_IF_NONE_MATCH']) === $etag) {
        @flock($lock, LOCK_UN);
        fclose($lock);
        http_response_code(304);
        header('Content-Length: 0');
        return;
    }

    $range = null;
    if (isset($_SERVER['HTTP_RANGE'])
        && musicAudioIfRangeMatches($_SERVER['HTTP_IF_RANGE'] ?? null, $etag, (int)$stat['mtime'])) {
        $range = musicAudioParseRange((string)$_SERVER['HTTP_RANGE'], (int)$size);
        if ($range === false) {
            @flock($lock, LOCK_UN);
            fclose($lock);
            http_response_code(416);
            header('Content-Range: bytes */' . (int)$size);
            header('Content-Length: 0');
            return;
        }
    }
    if (is_array($range)) {
        [$start, $end] = $range;
        http_response_code(206);
        header('Content-Range: bytes ' . $start . '-' . $end . '/' . (int)$size);
        header('Content-Length: ' . ($end - $start + 1));
    }
    @file_put_contents($entryDirectory . DIRECTORY_SEPARATOR . 'access', (string)time(), LOCK_EX);
    if ($method === 'HEAD') {
        @flock($lock, LOCK_UN);
        fclose($lock);
        return;
    }

    $handle = @fopen($outputPath, 'rb');
    if ($handle === false) {
        @flock($lock, LOCK_UN);
        fclose($lock);
        http_response_code(500);
        return;
    }
    if (is_array($range)) {
        fseek($handle, $range[0], SEEK_SET);
        $remaining = $range[1] - $range[0] + 1;
    } else {
        $remaining = (int)$size;
    }
    while ($remaining > 0 && !feof($handle)) {
        $chunk = fread($handle, min(1048576, $remaining));
        if ($chunk === false || $chunk === '') {
            break;
        }
        echo $chunk;
        $remaining -= strlen($chunk);
        if (function_exists('ob_flush')) {
            @ob_flush();
        }
        flush();
    }
    fclose($handle);
    @flock($lock, LOCK_UN);
    fclose($lock);
}

/**
 * ワーカー本体です。引数は検証済みキャッシュIDだけ受け取ります。
 */
function musicAudioRunWorker(array $conf, string $assetId): bool
{
    $cacheDirectory = rtrim((string)($conf['cacheDir'] ?? ''), DIRECTORY_SEPARATOR);
    $toolDirectory = rtrim((string)($conf['comistream_tool_dir'] ?? ''), DIRECTORY_SEPARATOR);
    $entryDirectory = musicAudioCacheEntryPath($cacheDirectory, $assetId);
    if ($entryDirectory === null || $toolDirectory === '' || !is_dir($entryDirectory)) {
        return false;
    }
    $lock = musicAudioOpenCacheLock($toolDirectory);
    if ($lock === false || !@flock($lock, LOCK_EX)) {
        return false;
    }
    $manifest = musicAudioReadManifest($entryDirectory);
    $success = false;
    try {
        if (!is_array($manifest) || ($manifest['jobId'] ?? '') !== $assetId) {
            return false;
        }
        $profile = musicAudioNormalizeProfile($manifest['profile'] ?? '');
        $sourcePath = musicAudioResolveManifestSource($conf, $manifest);
        $sourceProbe = $manifest['source']['probe'] ?? null;
        if ($profile === null || $sourcePath === false || !is_array($sourceProbe)
            || ($sourceProbe['status'] ?? '') !== 'ok'
            || !musicAudioProfileCanConvert($profile, $sourceProbe)
            || !musicAudioManifestSourceIsCurrent($manifest, $sourcePath)) {
            $manifest['status'] = 'failed';
            $manifest['error'] = 'source changed or unavailable';
            $manifest['failedAt'] = time();
            $manifest['updatedAt'] = time();
            musicAudioWriteManifest($entryDirectory, $manifest);
            return false;
        }
        $sourceProbe['path'] = $sourcePath;
        $manifest['status'] = 'converting';
        $manifest['pid'] = getmypid();
        $manifest['startedAt'] = time();
        $manifest['updatedAt'] = time();
        $manifest['error'] = null;
        if (!musicAudioWriteManifest($entryDirectory, $manifest)) {
            return false;
        }

        $ffmpeg = musicAudioResolveFFmpeg($conf);
        if ($ffmpeg === null) {
            throw new RuntimeException('ffmpeg unavailable');
        }
        $outputPath = $entryDirectory . DIRECTORY_SEPARATOR . 'audio.part';
        $stderrPath = $entryDirectory . DIRECTORY_SEPARATOR . 'worker.log';
        $timeout = musicAudioPositiveConfig($conf, 'musicAudioMaxSeconds', 7200, 604800);
        $maxOutputBytes = musicAudioMaxOutputBytes($conf);
        $sourceSize = max(0, (int)($sourceProbe['size'] ?? @filesize($sourcePath)));
        $requiredFreeBytes = min($maxOutputBytes, max(67108864, $sourceSize * 2));
        $freeBytes = @disk_free_space($entryDirectory);
        if ($freeBytes !== false && $freeBytes < $requiredFreeBytes) {
            throw new RuntimeException('insufficient disk space');
        }
        $map = '-map 0:a:0 -vn -map_metadata 0 -map_chapters -1';
        if ($profile === 'flac') {
            $options = '-c:a flac -f flac';
        } elseif ($profile === 'aac_lc') {
            $channels = max(1, min(2, (int)($sourceProbe['channels'] ?? 0)));
            $options = '-c:a aac -profile:a aac_low -b:a 256k -ac ' . $channels . ' -movflags +faststart -f ipod';
        } else {
            throw new RuntimeException('unknown output profile');
        }
        @unlink($outputPath);
        $command = escapeshellarg($ffmpeg)
            . ' -hide_banner -nostdin -loglevel error -y -i ' . escapeshellarg($sourcePath)
            . ' ' . $map . ' ' . $options . ' ' . escapeshellarg($outputPath);
        $result = musicAudioRunProcess($command, '/dev/null', $stderrPath, $timeout, $outputPath, $maxOutputBytes);
        if (!$result['started']) {
            throw new RuntimeException('ffmpeg could not start');
        }
        if ($result['limitExceeded']) {
            throw new RuntimeException('output or disk limit exceeded');
        }
        if ($result['timedOut']) {
            throw new RuntimeException('conversion timeout');
        }
        if ($result['exitCode'] !== 0) {
            $diagnostic = trim((string)@file_get_contents($stderrPath, false, null, 0, 8192));
            musicAudioLog('WARNING', 'musicAudioRunWorker() ffmpeg failed: ' . substr($diagnostic, 0, 240));
            throw new RuntimeException('ffmpeg conversion failed');
        }

        $validation = musicAudioValidateOutput($outputPath, $profile, $sourceProbe, $conf, $timeout);
        if (!($validation['ok'] ?? false)) {
            throw new RuntimeException((string)($validation['error'] ?? 'output validation failed'));
        }
        $finalPath = musicAudioOutputPath($entryDirectory, $profile);
        if ($finalPath === null || !@rename($outputPath, $finalPath)) {
            throw new RuntimeException('output publish failed');
        }
        $outputProbe = $validation['probe'];
        $manifest['status'] = 'ready';
        $manifest['updatedAt'] = time();
        $manifest['readyAt'] = time();
        $manifest['duration'] = $outputProbe['duration'] ?? null;
        $manifest['size'] = $validation['size'] ?? null;
        $manifest['mime'] = musicAudioProfileDefinitions()[$profile]['mime'];
        $manifest['codec'] = $outputProbe['codec'] ?? null;
        $manifest['pid'] = null;
        if (!musicAudioWriteManifest($entryDirectory, $manifest)) {
            @unlink($finalPath);
            throw new RuntimeException('manifest publish failed');
        }
        @file_put_contents($entryDirectory . DIRECTORY_SEPARATOR . 'access', (string)time(), LOCK_EX);
        $success = true;
    } catch (Throwable $exception) {
        musicAudioLog('ERROR', 'musicAudioRunWorker() ' . $exception->getMessage());
        if (is_array($manifest)) {
            @unlink($entryDirectory . DIRECTORY_SEPARATOR . 'audio.part');
            $manifest['status'] = 'failed';
            $manifest['error'] = 'conversion failed';
            $manifest['failedAt'] = time();
            $manifest['updatedAt'] = time();
            $manifest['pid'] = null;
            musicAudioWriteManifest($entryDirectory, $manifest);
        }
    } finally {
        @flock($lock, LOCK_UN);
        fclose($lock);
    }
    return $success;
}
