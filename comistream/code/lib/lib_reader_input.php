<?php

function resolveReaderSizeMode($requestedSize, $rawMode, $packetSave): string
{
    if ($requestedSize === 'FULL' || $requestedSize === 'comp') {
        return $requestedSize;
    }
    // 一覧のトグルはCookieを更新するので、残っているセッションより先に反映するルン。
    if ($rawMode === 'raw') {
        return 'FULL';
    }
    if ($rawMode === 'cmp' || $rawMode === 'compressed') {
        return 'comp';
    }
    // 環境に設定が残っていなければオリジナルサイズにするルン。
    return $packetSave === true ? 'comp' : 'FULL';
}

function parseReaderInteger($value, int $minimum, int $maximum): ?int
{
    if (!is_int($value) && (!is_string($value) || preg_match('/\A[0-9]{1,10}\z/', $value) !== 1)) {
        return null;
    }
    $number = (int)$value;
    return $number >= $minimum && $number <= $maximum ? $number : null;
}

function readerPageForDisplay($value, $maximum): int
{
    $page = parseReaderInteger($value, 0, 2147483647);
    $last = parseReaderInteger($maximum, 1, 2147483647);
    // 旧DBの不正値も切り詰めず、安全な開始位置へ戻すルン。
    return $page === null || $page === 0 ? 1 : ($last === null ? $page : min($page, $last));
}

function resolveReaderCacheDirectory(string $root, $id): string|false
{
    if (!is_string($id) || preg_match('/\A[A-Za-z0-9_-]+\z/', $id) !== 1) {
        return false;
    }
    $base = realpath($root);
    if ($base === false || !is_dir($base)) {
        return false;
    }
    $candidate = $base . DIRECTORY_SEPARATOR . $id;
    $directory = realpath($candidate);
    return !is_link($candidate) && $directory !== false && is_dir($directory)
        && dirname($directory) === $base ? $directory : false;
}

function readReaderIndexPage(string $directory, int $page): string|false
{
    $index = $directory . '/index';
    if ($page < 1 || !is_file($index) || is_link($index)) {
        return false;
    }
    $handle = @fopen($index, 'rb');
    if ($handle === false) {
        return false;
    }
    try {
        for ($number = 1; ($line = fgets($handle)) !== false; $number++) {
            if ($number === $page) {
                return rtrim($line, "\r\n");
            }
        }
        return false;
    } finally {
        fclose($handle);
    }
}

function isSafeReaderPagePath($path): bool
{
    if (!is_string($path) || $path === '' || strlen($path) > 4096
        || preg_match('/[\x00-\x1f\x7f]/', $path) === 1
        || $path[0] === '/' || $path[0] === '\\'
        || preg_match('/\A[A-Za-z]:/', $path) === 1) {
        return false;
    }

    foreach (explode('/', str_replace('\\', '/', $path)) as $segment) {
        if ($segment === '..') {
            return false;
        }
    }
    return true;
}

function resolveReaderCacheFile(string $directory, $relativePath, bool $allowMissing = false): string|false
{
    if (!isSafeReaderPagePath($relativePath)) {
        return false;
    }
    $base = realpath($directory);
    if ($base === false || !is_dir($base)) {
        return false;
    }

    $candidate = $base . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relativePath);
    $resolved = realpath($candidate);
    if ($resolved !== false) {
        return is_file($resolved) && str_starts_with($resolved, $base . DIRECTORY_SEPARATOR)
            ? $resolved : false;
    }
    if (!$allowMissing || is_link($candidate)) {
        return false;
    }

    $parent = realpath(dirname($candidate));
    if ($parent === false || !is_dir($parent)
        || ($parent !== $base && !str_starts_with($parent, $base . DIRECTORY_SEPARATOR))) {
        return false;
    }
    return $parent . DIRECTORY_SEPARATOR . basename($candidate);
}

function resolveGeneratedImageDeletionPath(string $root, $relativePath, string $extension): string|false
{
    if (!isSafeReaderPagePath($relativePath) || preg_match('/\A[a-z0-9]+\z/i', $extension) !== 1
        || str_ends_with(str_replace('\\', '/', $relativePath), '/')) {
        return false;
    }

    $base = realpath($root);
    if ($base === false || !is_dir($base)) {
        return false;
    }
    $candidate = $base . DIRECTORY_SEPARATOR
        . str_replace('/', DIRECTORY_SEPARATOR, $relativePath) . '.' . $extension;
    $parent = realpath(dirname($candidate));
    if ($parent === false || !is_dir($parent)
        || ($parent !== $base && !str_starts_with($parent, $base . DIRECTORY_SEPARATOR))) {
        return false;
    }

    // 親ディレクトリだけを実体確認し、末尾の symlink は unlink 対象として残すルン。
    return $parent . DIRECTORY_SEPARATOR . basename($candidate);
}

function resolveEpubFileWithinExtractionRoot(string $root, string $baseRelativePath, string $href): string|false
{
    if ($href === '' || strlen($href) > 4096 || strlen($baseRelativePath) > 4096) {
        return false;
    }
    $urlParts = parse_url($href);
    if ($urlParts === false || isset($urlParts['scheme']) || isset($urlParts['host'])
        || isset($urlParts['user']) || isset($urlParts['pass']) || !isset($urlParts['path'])) {
        return false;
    }

    $relativeHref = rawurldecode($urlParts['path']);
    $relativeBase = rawurldecode($baseRelativePath);
    if ($relativeHref === '' || preg_match('/[\x00-\x1f\x7f\\\\]/', $relativeHref) === 1
        || preg_match('/[\x00-\x1f\x7f\\\\]/', $relativeBase) === 1
        || $relativeHref[0] === '/' || preg_match('/\A[A-Za-z]:/', $relativeHref) === 1
        || $relativeBase !== '.' && ($relativeBase[0] === '/' || preg_match('/\A[A-Za-z]:/', $relativeBase) === 1)) {
        return false;
    }

    $realRoot = realpath($root);
    if ($realRoot === false || !is_dir($realRoot)) {
        return false;
    }
    $baseCandidate = $relativeBase === '.' || $relativeBase === ''
        ? $realRoot
        : $realRoot . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relativeBase);
    $realBase = realpath($baseCandidate);
    if ($realBase === false || !is_dir($realBase)
        || ($realBase !== $realRoot && !str_starts_with($realBase, $realRoot . DIRECTORY_SEPARATOR))) {
        return false;
    }

    $candidate = $realBase . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $relativeHref);
    $resolved = realpath($candidate);
    return $resolved !== false && is_file($resolved)
        && str_starts_with($resolved, $realRoot . DIRECTORY_SEPARATOR) ? $resolved : false;
}
