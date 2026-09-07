<?php

require_once dirname(__DIR__) . '/music_audio.php';

function musicAudioTestAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function musicAudioTestCleanup(string $path): void
{
    if (is_dir($path) && !is_link($path)) {
        foreach (scandir($path) ?: [] as $entry) {
            if ($entry !== '.' && $entry !== '..') {
                musicAudioTestCleanup($path . DIRECTORY_SEPARATOR . $entry);
            }
        }
        @rmdir($path);
        return;
    }
    if (file_exists($path) || is_link($path)) {
        @unlink($path);
    }
}

musicAudioTestAssert(musicAudioNormalizeProfile('flac') === 'flac', 'FLAC profile should be accepted');
musicAudioTestAssert(musicAudioNormalizeProfile('aac') === 'aac_lc', 'AAC alias should be normalized');
musicAudioTestAssert(musicAudioNormalizeProfile('shell') === null, 'Unknown profile should be rejected');
musicAudioTestAssert(musicAudioParseRange('bytes=0-9', 100) === [0, 9], 'A byte range should be parsed');
musicAudioTestAssert(musicAudioParseRange('bytes=-10', 100) === [90, 99], 'A suffix range should be parsed');
musicAudioTestAssert(musicAudioParseRange('bytes=100-101', 100) === false, 'An out-of-range request should be rejected');
musicAudioTestAssert(musicAudioCacheEntryName(str_repeat('a', 64)) === 'music-audio-' . str_repeat('a', 64), 'Cache ID should be constrained');
musicAudioTestAssert(musicAudioCacheEntryName('../cache') === null, 'Cache traversal should be rejected');

$temporaryRoot = sys_get_temp_dir() . '/comistream-music-audio-' . bin2hex(random_bytes(8));
if (!mkdir($temporaryRoot, 0775, true)) {
    throw new RuntimeException('Unable to create temporary test directory');
}
try {
    $sourcePath = $temporaryRoot . '/source.m4a';
    file_put_contents($sourcePath, 'first-source');
    $firstManifest = musicAudioBuildSourceManifest($sourcePath);
    musicAudioTestAssert(is_array($firstManifest), 'A source manifest should be created');
    $manifestWrapper = [
        'sourceVersion' => $firstManifest['version'],
        'source' => $firstManifest,
    ];
    musicAudioTestAssert(
        musicAudioManifestSourceIsCurrent($manifestWrapper, $sourcePath),
        'Fast source identity validation should accept the current source'
    );
    musicAudioTestAssert(
        musicAudioManifestSourceIsCurrent($manifestWrapper, $sourcePath, true),
        'Full source content validation should accept the current source'
    );

    // 同じサイズ・同じmtimeでも内容ハッシュが違えば世代を分けるルン。
    $mtime = filemtime($sourcePath);
    file_put_contents($sourcePath, 'second-track');
    touch($sourcePath, $mtime);
    $secondManifest = musicAudioBuildSourceManifest($sourcePath);
    musicAudioTestAssert(is_array($secondManifest), 'A second source manifest should be created');
    musicAudioTestAssert($firstManifest['version'] !== $secondManifest['version'], 'Content changes should invalidate the source version');
    musicAudioTestAssert(
        !musicAudioManifestSourceIsCurrent($manifestWrapper, $sourcePath, true),
        'Full source content validation should reject replaced content'
    );

    $entryDirectory = $temporaryRoot . '/entry';
    mkdir($entryDirectory, 0775, true);
    $entryManifest = ['status' => 'ready', 'profile' => 'flac'];
    musicAudioTestAssert(musicAudioWriteManifest($entryDirectory, $entryManifest), 'A manifest should be written atomically');
    musicAudioTestAssert(musicAudioReadManifest($entryDirectory) === $entryManifest, 'The manifest should be readable');

    $toolDirectory = $temporaryRoot . '/tool';
    $firstAssetId = 'aa' . str_repeat('0', 62);
    $secondAssetId = 'bb' . str_repeat('0', 62);
    $firstLock = musicAudioOpenEntryLock($toolDirectory, $firstAssetId);
    musicAudioTestAssert(is_resource($firstLock) && flock($firstLock, LOCK_EX), 'The first entry lock should open');
    $secondLock = musicAudioOpenEntryLock($toolDirectory, $secondAssetId);
    musicAudioTestAssert(
        is_resource($secondLock) && flock($secondLock, LOCK_EX | LOCK_NB),
        'Unrelated cache entries should not share one global lock'
    );
    $sameLock = musicAudioOpenEntryLock($toolDirectory, $firstAssetId);
    musicAudioTestAssert(
        is_resource($sameLock) && !flock($sameLock, LOCK_EX | LOCK_NB),
        'The same cache entry should remain protected'
    );
    musicAudioTestAssert(
        !musicAudioJobIsStale(['updatedAt' => 1], time(), $toolDirectory, $firstAssetId),
        'A worker holding the entry lock should not be considered stale'
    );
    fclose($sameLock);
    flock($secondLock, LOCK_UN);
    fclose($secondLock);
    flock($firstLock, LOCK_UN);
    fclose($firstLock);
    musicAudioTestAssert(
        musicAudioJobIsStale(['updatedAt' => 1], time(), $toolDirectory, $firstAssetId),
        'An old job without an entry lock should be considered stale'
    );
} finally {
    musicAudioTestCleanup($temporaryRoot);
}

if (session_status() === PHP_SESSION_NONE) {
    session_start();
    musicAudioReleaseSessionLock();
    musicAudioTestAssert(
        session_status() !== PHP_SESSION_ACTIVE,
        'Long-running audio handlers should release the PHP session lock'
    );
}

echo "music_audio.test.php: OK\n";
