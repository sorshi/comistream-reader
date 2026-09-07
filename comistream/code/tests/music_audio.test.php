<?php

require_once dirname(__DIR__) . '/music_audio.php';

function musicAudioTestAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
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

    // 同じサイズ・同じmtimeでも内容ハッシュが違えば世代を分けるルン。
    $mtime = filemtime($sourcePath);
    file_put_contents($sourcePath, 'second-track');
    touch($sourcePath, $mtime);
    $secondManifest = musicAudioBuildSourceManifest($sourcePath);
    musicAudioTestAssert(is_array($secondManifest), 'A second source manifest should be created');
    musicAudioTestAssert($firstManifest['version'] !== $secondManifest['version'], 'Content changes should invalidate the source version');

    $entryDirectory = $temporaryRoot . '/entry';
    mkdir($entryDirectory, 0775, true);
    $entryManifest = ['status' => 'ready', 'profile' => 'flac'];
    musicAudioTestAssert(musicAudioWriteManifest($entryDirectory, $entryManifest), 'A manifest should be written atomically');
    musicAudioTestAssert(musicAudioReadManifest($entryDirectory) === $entryManifest, 'The manifest should be readable');
} finally {
    foreach (glob($temporaryRoot . '/*') ?: [] as $path) {
        if (is_dir($path) && !is_link($path)) {
            foreach (glob($path . '/*') ?: [] as $child) {
                @unlink($child);
            }
            @rmdir($path);
        } else {
            @unlink($path);
        }
    }
    @rmdir($temporaryRoot);
}

echo "music_audio.test.php: OK\n";
