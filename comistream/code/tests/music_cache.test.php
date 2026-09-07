<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/comistream_lib.php';

function expectMusicCacheTest(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function cleanupMusicCacheTest(string $path): void
{
    if (is_dir($path) && !is_link($path)) {
        foreach (scandir($path) ?: [] as $entry) {
            if ($entry !== '.' && $entry !== '..') {
                cleanupMusicCacheTest($path . DIRECTORY_SEPARATOR . $entry);
            }
        }
        @rmdir($path);
        return;
    }
    if (file_exists($path) || is_link($path)) {
        @unlink($path);
    }
}

$temporaryRoot = sys_get_temp_dir() . '/comistream-music-cache-' . bin2hex(random_bytes(8));
$toolDirectory = $temporaryRoot . '/tool';
$cacheDirectory = $toolDirectory . '/data/cache';
$entryName = 'music-audio-' . str_repeat('a', 64);
$entryDirectory = $cacheDirectory . '/' . $entryName;
mkdir($entryDirectory, 0775, true);

global $conf;
$conf = [
    'cacheDir' => $cacheDirectory,
    'comistream_tool_dir' => $toolDirectory,
];

try {
    file_put_contents($entryDirectory . '/manifest.json', '{"status":"queued"}');
    file_put_contents($entryDirectory . '/access', (string)time());
    expectMusicCacheTest(
        !deleteCacheEntryForPushout($cacheDirectory, $entryName),
        'A recently queued or leased audio entry must not be evicted.'
    );
    expectMusicCacheTest(is_dir($entryDirectory), 'The protected audio entry was deleted.');

    $oldTimestamp = time() - 600;
    file_put_contents($entryDirectory . '/access', (string)$oldTimestamp);
    touch($entryDirectory . '/access', $oldTimestamp);
    touch($entryDirectory . '/manifest.json', $oldTimestamp);
    expectMusicCacheTest(
        deleteCacheEntryForPushout($cacheDirectory, $entryName),
        'An expired audio cache lease should allow eviction.'
    );
    expectMusicCacheTest(!file_exists($entryDirectory), 'The expired audio entry was not deleted.');
} finally {
    cleanupMusicCacheTest($temporaryRoot);
}

echo "music_cache.test.php: OK\n";
