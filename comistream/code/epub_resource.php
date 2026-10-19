<?php

/**
 * /theme/bibi/のURLを保ちながら、非公開キャッシュからEPUB資産を返すルン。
 * @license AGPL-3.0-only
 */
require_once __DIR__ . '/lib/lib_epub_delivery.php';

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if (!in_array($method, ['GET', 'HEAD'], true)) {
    http_response_code(405);
    header('Allow: GET, HEAD');
    exit;
}
$requestPath = rawurldecode((string)parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH));
if (!readerUsesManagedDeployment() || !preg_match('~\A/theme/bibi/([a-f0-9]{32,128})/(.+)\z~s', $requestPath, $parts)) {
    http_response_code(404);
    exit;
}
$cacheRoot = __DIR__ . '/../data/cache';
// 存在しないIDの要求でロックファイルを増やさないルン。
if (is_link($cacheRoot) || is_link($cacheRoot . '/' . $parts[1]) || !is_dir($cacheRoot . '/' . $parts[1])) {
    http_response_code(404);
    exit;
}
try {
    // 生成・削除と共有ロックを取り、配信中の世代切替を防ぐルン。
    acquireReaderBookCacheLock($cacheRoot, $parts[1], LOCK_SH);
    $resource = resolveReaderEpubResource($cacheRoot, $parts[1], $parts[2]);
    if ($resource === false) {
        http_response_code(404);
        exit;
    }
    $stream = fopen($resource['path'], 'rb');
    if ($stream === false) throw new RuntimeException('Cannot open EPUB resource.');
    $stat = fstat($stream);
    // 解決後にファイルが差し替えられていたら、その内容は返さないルン。
    if ($stat === false || $stat['dev'] !== $resource['stat']['dev'] || $stat['ino'] !== $resource['stat']['ino']) {
        fclose($stream);
        http_response_code(404);
        exit;
    }
    $size = $stat['size'];
    $etag = '"' . hash('sha256', $resource['generation'] . ':' . $parts[2] . ':' . $size . ':' . $stat['mtime']) . '"';
    header('Content-Type: ' . $resource['type']);
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, no-cache');
    header('ETag: ' . $etag);
    header('Accept-Ranges: bytes');
    if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
        http_response_code(304);
        exit;
    }
    $start = 0;
    $end = $size - 1;
    if ($method === 'GET' && isset($_SERVER['HTTP_RANGE'])
        && (!isset($_SERVER['HTTP_IF_RANGE']) || $_SERVER['HTTP_IF_RANGE'] === $etag)) {
        $range = readerResourceRange($_SERVER['HTTP_RANGE'], $size);
        if ($range === false) {
            http_response_code(416);
            header('Content-Range: bytes */' . $size);
            exit;
        }
        [$start, $end] = $range;
        http_response_code(206);
        header('Content-Range: bytes ' . $start . '-' . $end . '/' . $size);
    }
    header('Content-Length: ' . max(0, $end - $start + 1));
    if ($method === 'HEAD') exit;
    fseek($stream, $start);
    $remaining = $end - $start + 1;
    while ($remaining > 0 && !feof($stream) && !connection_aborted()) {
        $chunk = fread($stream, min(1048576, $remaining));
        if ($chunk === false || $chunk === '') break;
        echo $chunk;
        $remaining -= strlen($chunk);
    }
    fclose($stream);
} catch (Throwable $error) {
    error_log('EPUB resource delivery failed: ' . $error->getMessage());
    if (!headers_sent()) {
        http_response_code(500);
        header('Cache-Control: no-store');
    }
}
