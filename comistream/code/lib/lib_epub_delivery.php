<?php

/**
 * 完成したEPUBの公開資産だけを配信するルン。
 * @license AGPL-3.0-only
 */
require_once __DIR__ . '/lib_book_cache.php';

function resolveReaderEpubResource(string $cacheRoot, string $id, string $relative): array|false
{
    if (!isReaderBookCacheId($id) || $relative === '' || preg_match('/[\x00-\x1f\x7f\\\\]/', $relative)) return false;
    if (is_link($cacheRoot) || !is_dir($cacheRoot)) return false;
    $root = realpath($cacheRoot);
    $directory = $root . '/' . $id;
    if (is_link($directory) || !is_dir($directory)) return false;
    $record = readReaderBookCacheRecord($directory);
    if ($record === null || !is_file($directory . '/DONE') || is_link($directory . '/DONE')
        || !is_file($directory . '/META-INF/container.xml') || is_link($directory . '/META-INF')
        || is_link($directory . '/META-INF/container.xml')) return false;

    $path = $directory;
    foreach (explode('/', $relative) as $part) {
        if ($part === '' || $part[0] === '.' || str_starts_with($part, '_comistream-reader-')
            || in_array($part, ['file', 'index', 'DONE', 'access'], true)) return false;
        $path .= '/' . $part;
        if (is_link($path)) return false;
    }
    $resolved = realpath($path);
    if ($resolved === false || !str_starts_with($resolved, $directory . '/') || !is_file($resolved) || !is_readable($resolved)) return false;

    // サーバー側のスクリプトや内部データは、ソースとしても公開しないルン。
    $types = [
        'xhtml' => 'application/xhtml+xml', 'html' => 'text/html', 'htm' => 'text/html',
        'css' => 'text/css', 'js' => 'text/javascript', 'mjs' => 'text/javascript',
        'xml' => 'application/xml', 'opf' => 'application/oebps-package+xml',
        'ncx' => 'application/x-dtbncx+xml', 'smil' => 'application/smil+xml', 'txt' => 'text/plain',
        'svg' => 'image/svg+xml', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg',
        'gif' => 'image/gif', 'webp' => 'image/webp', 'avif' => 'image/avif', 'jxl' => 'image/jxl',
        'bmp' => 'image/bmp', 'tif' => 'image/tiff', 'tiff' => 'image/tiff', 'ico' => 'image/vnd.microsoft.icon',
        'woff' => 'font/woff', 'woff2' => 'font/woff2', 'ttf' => 'font/ttf', 'otf' => 'font/otf',
        'mp3' => 'audio/mpeg', 'm4a' => 'audio/mp4', 'aac' => 'audio/aac', 'ogg' => 'audio/ogg',
        'oga' => 'audio/ogg', 'opus' => 'audio/ogg', 'flac' => 'audio/flac', 'wav' => 'audio/wav',
        'mp4' => 'video/mp4', 'webm' => 'video/webm', 'ogv' => 'video/ogg',
        'vtt' => 'text/vtt', 'json' => 'application/json',
    ];
    $type = $relative === 'mimetype' ? 'text/plain' : ($types[strtolower(pathinfo($resolved, PATHINFO_EXTENSION))] ?? null);
    if ($type === null) return false;
    $stat = lstat($resolved);
    if ($stat === false || ($stat['mode'] & 0170000) !== 0100000) return false;
    return ['path' => $resolved, 'type' => $type, 'generation' => $record['generation'], 'stat' => $stat];
}

function readerResourceRange(string $header, int $size): array|false
{
    if ($size < 1 || !preg_match('/\Abytes=(\d*)-(\d*)\z/', trim($header), $parts)) return false;
    if ($parts[1] === '') {
        $length = filter_var($parts[2], FILTER_VALIDATE_INT);
        return $length !== false && $length > 0 ? [max(0, $size - $length), $size - 1] : false;
    }
    $start = filter_var($parts[1], FILTER_VALIDATE_INT);
    $end = $parts[2] === '' ? $size - 1 : filter_var($parts[2], FILTER_VALIDATE_INT);
    if ($start === false || $end === false || $start < 0 || $start >= $size || $end < $start) return false;
    return [$start, min($end, $size - 1)];
}
