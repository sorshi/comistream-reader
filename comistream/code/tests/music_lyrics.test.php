<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/music_metadata.php';
require_once dirname(__DIR__) . '/music_lyrics.php';

function expectMusicLyricsTest(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function musicLyricsTestCleanup(string $path): void
{
    if (is_dir($path) && !is_link($path)) {
        foreach (scandir($path) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            musicLyricsTestCleanup($path . DIRECTORY_SEPARATOR . $entry);
        }
        rmdir($path);
        return;
    }
    if (file_exists($path) || is_link($path)) {
        unlink($path);
    }
}

function musicLyricsTestID3Syncsafe(int $value): string
{
    return chr(($value >> 21) & 0x7f)
        . chr(($value >> 14) & 0x7f)
        . chr(($value >> 7) & 0x7f)
        . chr($value & 0x7f);
}

function musicLyricsTestFLACComment(string $key, string $value): string
{
    $comment = $key . '=' . $value;
    return pack('V', strlen($comment)) . $comment;
}

$temporaryRoot = sys_get_temp_dir() . '/comistream-music-lyrics-' . bin2hex(random_bytes(8));
mkdir($temporaryRoot, 0775, true);

try {
    $lrc = "\xEF\xBB\xBF[offset:-100]\n[00:01.00][00:02.000]一行目\n[00:02.000]二行目\n[00:03.5]";
    $parsedLrc = normalizeMusicLyrics($lrc, 'lrc');
    expectMusicLyricsTest(is_array($parsedLrc), 'LRC was not parsed.');
    expectMusicLyricsTest($parsedLrc['format'] === 'lrc', 'LRC format was not returned.');
    expectMusicLyricsTest($parsedLrc['lines'][0]['timeMs'] === 900, 'LRC offset or fraction was incorrect.');
    expectMusicLyricsTest($parsedLrc['lines'][1]['text'] === '一行目', 'Multiple LRC timestamps were not preserved.');
    expectMusicLyricsTest($parsedLrc['lines'][2]['text'] === '二行目', 'Same-time LRC order was not preserved.');
    expectMusicLyricsTest($parsedLrc['lines'][3]['timeMs'] === 3400, 'One-digit LRC fraction was incorrect.');

    $lateOffset = normalizeMusicLyrics("[00:01.00]offset後\n[offset:250]", 'lrc');
    expectMusicLyricsTest(is_array($lateOffset) && $lateOffset['lines'][0]['timeMs'] === 1250, 'LRC offset was not applied globally.');

    $plain = 'UTF-16の歌詞\n二行目';
    $utf16 = "\xFF\xFE" . iconv('UTF-8', 'UTF-16LE', $plain);
    $decoded = normalizeMusicLyrics($utf16, 'txt');
    expectMusicLyricsTest(is_array($decoded) && $decoded['text'] === $plain, 'UTF-16 sidecar was not decoded.');

    $mp3Path = $temporaryRoot . '/uslt.mp3';
    $usltPayload = chr(3) . 'jpn' . "\0" . "[00:01.00]MP3の歌詞";
    $usltFrame = 'USLT' . musicLyricsTestID3Syncsafe(strlen($usltPayload)) . "\0\0" . $usltPayload;
    file_put_contents(
        $mp3Path,
        'ID3' . chr(4) . chr(0) . chr(0) . musicLyricsTestID3Syncsafe(strlen($usltFrame)) . $usltFrame
    );
    $mp3Candidates = readMP3EmbeddedLyrics($mp3Path);
    expectMusicLyricsTest($mp3Candidates === ["[00:01.00]MP3の歌詞"], 'MP3 USLT was not parsed.');
    $mp3Lyrics = readEmbeddedMusicLyrics($mp3Path, 'mp3');
    expectMusicLyricsTest(is_array($mp3Lyrics) && $mp3Lyrics['format'] === 'lrc', 'MP3 USLT LRC was not normalized.');

    $utf16Uslt = chr(1) . 'jpn' . "\xFF\xFE" . "\0\0"
        . iconv('UTF-8', 'UTF-16LE', "UTF-16のUSLT歌詞");
    $parsedUtf16Uslt = parseMusicLyricsUSLT($utf16Uslt);
    expectMusicLyricsTest(is_array($parsedUtf16Uslt) && $parsedUtf16Uslt['text'] === 'UTF-16のUSLT歌詞', 'UTF-16 USLT was not decoded.');

    $flacPath = $temporaryRoot . '/comment.flac';
    $vendor = 'test';
    $comments = pack('V', strlen($vendor)) . $vendor . pack('V', 2)
        . musicLyricsTestFLACComment('LYRICS', '通常歌詞')
        . musicLyricsTestFLACComment('SYNCEDLYRICS', '[00:02.00]同期歌詞');
    $blockHeader = chr(0x84) . chr(($comments === '' ? 0 : strlen($comments)) >> 16)
        . chr((strlen($comments) >> 8) & 0xff) . chr(strlen($comments) & 0xff);
    file_put_contents($flacPath, 'fLaC' . $blockHeader . $comments);
    $flacLyrics = readEmbeddedMusicLyrics($flacPath, 'flac');
    expectMusicLyricsTest(is_array($flacLyrics) && $flacLyrics['format'] === 'lrc', 'FLAC synchronized lyrics were not preferred.');
    expectMusicLyricsTest($flacLyrics['lines'][0]['text'] === '同期歌詞', 'FLAC lyrics text was incorrect.');

    $sourcePath = $temporaryRoot . '/sidecar.mp3';
    $lrcPath = $temporaryRoot . '/sidecar.lrc';
    $txtPath = $temporaryRoot . '/sidecar.txt';
    file_put_contents($sourcePath, 'not an ID3 file');
    file_put_contents($lrcPath, "[00:01.00]LRCが優先");
    file_put_contents($txtPath, 'TXTは次候補');
    $sidecarLyrics = resolveLocalMusicLyrics($sourcePath, 'mp3', [
        ['path' => $lrcPath, 'name' => 'sidecar.lrc', 'format' => 'lrc'],
        ['path' => $txtPath, 'name' => 'sidecar.txt', 'format' => 'txt'],
    ]);
    expectMusicLyricsTest($sidecarLyrics['source'] === 'sidecar', 'Sidecar source was not selected.');
    expectMusicLyricsTest($sidecarLyrics['lines'][0]['text'] === 'LRCが優先', 'LRC was not preferred over TXT.');

    $cacheDirectory = $temporaryRoot . '/cache';
    $toolDirectory = $temporaryRoot . '/tool';
    $cacheKey = hash('sha256', 'cache-key');
    $cacheValue = [
        'status' => 'ok',
        'source' => 'sidecar',
        'format' => 'plain',
        'text' => 'キャッシュ歌詞',
        'lines' => [],
        'provider' => null,
        'attribution' => null,
    ];
    expectMusicLyricsTest(
        writeMusicLyricsCache($cacheDirectory, $toolDirectory, $cacheKey, 'source-version', [], $cacheValue),
        'Lyrics cache was not written.'
    );
    $cached = readMusicLyricsCache($cacheDirectory, $toolDirectory, $cacheKey, 'source-version');
    expectMusicLyricsTest(is_array($cached) && $cached['text'] === 'キャッシュ歌詞', 'Lyrics cache was not read.');
    expectMusicLyricsTest(readMusicLyricsCache($cacheDirectory, $toolDirectory, $cacheKey, 'other-version') === null, 'Stale lyrics cache was used.');
} finally {
    musicLyricsTestCleanup($temporaryRoot);
}

echo "music_lyrics.test.php: OK\n";
