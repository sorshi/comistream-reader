<?php

// SPDX-License-Identifier: AGPL-3.0-only
require_once __DIR__ . '/comistream_lib.php';
require_once __DIR__ . '/lib/lib_photo.php';

function photoViewLock(string $toolDirectory)
{
    if ($toolDirectory === '') return false;
    $toolRoot = realpath($toolDirectory);
    if ($toolRoot === false || is_link($toolRoot . '/data')) return false;
    $runtime = $toolRoot . '/data/runtime';
    if (is_link($runtime) || (!is_dir($runtime) && !@mkdir($runtime, 0750, true) && !is_dir($runtime))) return false;
    if (realpath($runtime) !== $runtime) return false;
    $deadline = microtime(true) + 2;
    do {
        for ($slot = 0; $slot < 2; ++$slot) {
            $lockPath = $runtime . '/photo-view-' . $slot . '.lock';
            if (is_link($lockPath)) continue;
            $lock = @fopen($lockPath, 'c');
            if ($lock === false) continue;
            if (flock($lock, LOCK_EX | LOCK_NB)) return $lock;
            fclose($lock);
        }
        usleep(50000);
    } while (microtime(true) < $deadline);
    return false;
}

function photoViewRun(array $command, string $input, float $deadline): string|false
{
    if (microtime(true) >= $deadline) return false;
    $process = @proc_open($command, [
        0 => ['file', $input, 'rb'],
        1 => ['pipe', 'w'],
        2 => ['file', '/dev/null', 'w'],
    ], $pipes);
    if (!is_resource($process)) return false;

    // PHPの実行時間制限と別に、外部変換にも実時間の上限をかけるルン。
    $output = '';
    stream_set_blocking($pipes[1], false);
    $exitCode = -1;
    try {
        do {
            $chunk = fread($pipes[1], 65536);
            if ($chunk === false) break;
            $output .= $chunk;
            if (strlen($output) > 24 * 1024 * 1024) break;
            if (feof($pipes[1])) {
                $status = proc_get_status($process);
                if (!$status['running']) {
                    $exitCode = $status['exitcode'];
                    break;
                }
            }
            if ($chunk === '') usleep(10000);
        } while (microtime(true) < $deadline);
    } finally {
        if ($exitCode < 0) proc_terminate($process, 9);
        fclose($pipes[1]);
        proc_close($process);
    }

    return $exitCode === 0 && substr($output, 0, 4) === 'RIFF'
        && substr($output, 8, 4) === 'WEBP' ? $output : false;
}

function servePhotoView(): void
{
    $requested = $_GET['file'] ?? null;
    $extension = is_string($requested) ? strtolower(pathinfo($requested, PATHINFO_EXTENSION)) : '';
    if (!in_array($extension, PHOTO_CONVERT_EXTENSIONS, true)) {
        http_response_code(404);
        return;
    }

    $dbPath = __DIR__ . '/../data/db/comistream.sqlite';
    $settings = readerManagedSettings();
    if (is_file($dbPath)) {
        $db = new PDO('sqlite:' . $dbPath);
        $settings = getSettings($db);
        $db = null;
    }

    // 一覧と原本の公開範囲に合わせ、ゲストも共有内の写真を開けるルン。
    $path = resolveFileWithinBaseDirectory($settings['sharePath'] ?? '', $requested);
    $sourceExtension = $path === false ? '' : strtolower(pathinfo($path, PATHINFO_EXTENSION));
    if ($path === false || !is_readable($path)
        || !in_array($sourceExtension, PHOTO_CONVERT_EXTENSIONS, true)
        || ($original = @stat($path)) === false) {
        http_response_code(404);
        return;
    }
    // コンテナの httpd.conf が原本の配信を拒否する名前にも合わせるルン。
    $blockedName = '/(?:^\.|\.(php[0-9]*|phtml|phar|cgi|pl|py|sh|shtml)(\.|$))/i';
    if (readerUsesManagedDeployment()
        && (preg_match($blockedName, basename($requested)) || preg_match($blockedName, basename($path)))) {
        http_response_code(404);
        return;
    }

    $requestedWidth = $_GET['w'] ?? null;
    $width = is_string($requestedWidth) && ctype_digit($requestedWidth)
        ? max(1, min(2048, (int)$requestedWidth)) : 1600;
    $lock = photoViewLock($settings['comistream_tool_dir'] ?? '');
    if ($lock === false) {
        http_response_code(503);
        header('Retry-After: 2');
        return;
    }

    $start = microtime(true);
    $deadline = $start + 20;
    try {
        $webp = false;
        $cli = PHP_BINDIR . '/php';
        if (isVipsAvailable() && is_executable($cli)) {
            $webp = photoViewRun([$cli, __DIR__ . '/lib/photo_view_vips.php', $path, (string)$width], '/dev/null', $deadline);
        }
        if ($webp === false) {
            $format = in_array($sourceExtension, ['tif', 'tiff'], true) ? 'tiff' : 'heic';
            $webp = photoViewRun([
                'magick', '-limit', 'disk', '0', $format . ':-[0]', '-auto-orient',
                '-resize', $width . 'x' . $width . '>', '-strip', '-quality', '80', 'webp:-',
            ], $path, $deadline);
        }
    } finally {
        fclose($lock);
    }

    if ($webp === false) {
        writelog('ERROR photo_view: conversion failed or exceeded its resource or time limit');
        http_response_code(500);
        return;
    }

    clearstatcache(true, $path);
    $current = @stat($path);
    $version = $original['mtime'] . '-' . $original['size'];
    if (($_GET['v'] ?? null) === $version && $current !== false
        && $current['mtime'] === $original['mtime'] && $current['size'] === $original['size']
        && $current['ino'] === $original['ino']) {
        header('Cache-Control: private, max-age=2592000, immutable');
    }
    header('Content-Type: image/webp');
    header('X-Content-Type-Options: nosniff');
    header('Content-Length: ' . strlen($webp));
    writelog(sprintf('DEBUG photo_view: converted in %.0fms, %d bytes', (microtime(true) - $start) * 1000, strlen($webp)));
    echo $webp;
}

header('Cache-Control: no-store');
try {
    servePhotoView();
} catch (Throwable $error) {
    writelog('ERROR photo_view: ' . $error->getMessage());
    http_response_code(500);
}
