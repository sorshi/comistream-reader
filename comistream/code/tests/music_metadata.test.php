<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/music_metadata.php';

function expectMusicMetadataTest(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function musicMetadataTestAtom(string $type, string $payload): string
{
    return pack('N', 8 + strlen($payload)) . $type . $payload;
}

function musicMetadataTestDataAtom(int $type, string $payload): string
{
    // data atom の type と locale を付けるルン。
    return musicMetadataTestAtom('data', pack('N', $type) . pack('N', 0) . $payload);
}

$testFile = sys_get_temp_dir() . '/comistream-music-metadata-' . bin2hex(random_bytes(8)) . '.m4a';
$coverData = "\xff\xd8\xff\xe0COMISTREAM\xff\xd9";
$title = 'ALACテスト曲';
$artist = 'Comistreamテスト';

$items = musicMetadataTestAtom("\xA9" . 'nam', musicMetadataTestDataAtom(1, $title));
$items .= musicMetadataTestAtom("\xA9" . 'ART', musicMetadataTestDataAtom(1, $artist));
$items .= musicMetadataTestAtom('covr', musicMetadataTestDataAtom(13, $coverData));
$moov = musicMetadataTestAtom(
    'moov',
    musicMetadataTestAtom(
        'udta',
        musicMetadataTestAtom('meta', pack('N', 0) . musicMetadataTestAtom('ilst', $items))
    )
);

$handle = fopen($testFile, 'wb');
if ($handle === false) {
    throw new RuntimeException('Failed to create M4A fixture.');
}

try {
    fwrite($handle, musicMetadataTestAtom('ftyp', 'M4A ' . pack('N', 0) . 'M4A isom'));

    // 旧実装の4MB上限より後ろへ moov を置き、末尾探索を検証するルン。
    $mediaBytes = 5 * 1024 * 1024;
    fwrite($handle, pack('N', 8 + $mediaBytes) . 'mdat');
    fseek($handle, $mediaBytes, SEEK_CUR);
    fwrite($handle, $moov);
    fclose($handle);
    $handle = null;

    $metadata = readMP4MetadataFromFile($testFile);
    expectMusicMetadataTest($metadata['title'] === $title, 'M4A title was not parsed.');
    expectMusicMetadataTest($metadata['artist'] === $artist, 'M4A artist was not parsed.');

    $cover = extractMP4CoverFromFile($testFile);
    expectMusicMetadataTest(is_array($cover), 'M4A cover was not parsed.');
    expectMusicMetadataTest($cover['mime'] === 'image/jpeg', 'M4A cover MIME type was incorrect.');
    expectMusicMetadataTest($cover['data'] === $coverData, 'M4A cover bytes were incorrect.');
} finally {
    if (is_resource($handle)) {
        fclose($handle);
    }
    if (is_file($testFile)) {
        unlink($testFile);
    }
}

echo "music_metadata.test.php: OK\n";

