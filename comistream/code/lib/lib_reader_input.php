<?php

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
    $last = parseReaderInteger($maximum, 1, 2147483647) ?? 1;
    // 旧DBの不正値も切り詰めず、安全な開始位置へ戻すルン。
    return $page === null || $page === 0 ? 1 : min($page, $last);
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
