<?php

/**
 * Comistream Reader - Music Audio CLI Worker
 *
 * Webリクエストから切り離して、1曲分の音声変換と完成検証を行います。
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit(1);
}
require_once __DIR__ . '/comistream_lib.php';
require_once __DIR__ . '/music_audio.php';

$jobId = '';
foreach (array_slice($argv, 1) as $argument) {
    if (strncmp($argument, '--job-id=', 9) === 0) {
        $jobId = substr($argument, 9);
        break;
    }
}
if ($jobId === '' && isset($argv[1], $argv[2]) && $argv[1] === '--job-id') {
    $jobId = (string)$argv[2];
}
if (preg_match('/^[a-f0-9]{64}$/', $jobId) !== 1) {
    fwrite(STDERR, "Invalid audio job id.\n");
    exit(2);
}

$toolDirectory = dirname(__DIR__);
$databasePath = $toolDirectory . '/data/db/comistream.sqlite';
if (!is_file($databasePath)) {
    fwrite(STDERR, "Comistream database is unavailable.\n");
    exit(1);
}

try {
    $dbh = new PDO('sqlite:' . $databasePath);
    $dbh->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    readConfig($dbh);
    global $conf;
    exit(musicAudioRunWorker($conf, $jobId) ? 0 : 1);
} catch (Throwable $exception) {
    musicAudioLog('ERROR', 'music_audio_worker.php failed: ' . $exception->getMessage());
    fwrite(STDERR, "Audio worker failed.\n");
    exit(1);
}
