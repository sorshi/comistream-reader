<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/comistream_lib.php';
require_once dirname(__DIR__) . '/i18n.php';

function expectLoadingCover(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$root = sys_get_temp_dir() . '/comistream-loading-cover-' . bin2hex(random_bytes(8));
mkdir($root . '/public/棚', 0700, true);
$name = '本 #?%&".jpg';
file_put_contents($root . '/public/棚/' . $name, 'cached cover');
file_put_contents($root . '/outside.jpg', 'outside');
symlink($root . '/outside.jpg', $root . '/public/linked.jpg');
try {
    $url = getEpubLoadingCoverUrl($root, '/public/棚/本 #?%&".epub');
    expectLoadingCover($url === '/theme/covers/public/' . rawurlencode('棚') . '/' . rawurlencode($name), 'Cover URL differs from the listing URL.');
    foreach (['/public/missing.epub', '/../outside.epub', '/linked.epub'] as $path) {
        expectLoadingCover(getEpubLoadingCoverUrl($root . '/public', $path) === '', 'Missing or external cover was accepted.');
    }
    expectLoadingCover(getEpubLoadingCoverUrl($root . '/missing', '/public/book.epub') === '', 'Missing cache root did not fall back.');

    $conf = ['comistream_tool_dir' => dirname(__DIR__, 2), 'epub_reader_package_base' => '/theme/bibi/test/'];
    $bookName = $baseFile = 'Test.epub';
    $escapedFile = 'Test.epub';
    $user = 'guest';
    $readerMarkerCsrfToken = '';
    $without = generateEpubHTML();
    expectLoadingCover(!str_contains($without, '<img id="epub-loading-cover"'), 'Missing cache emitted an image.');
    $conf['epub_loading_cover_url'] = $url;
    $with = generateEpubHTML();
    expectLoadingCover(str_contains($with, '<img id="epub-loading-cover" src="' . htmlspecialchars($url, ENT_QUOTES, 'UTF-8') . '" alt="" aria-hidden="true" decoding="async" hidden>'), 'Initial HTML did not contain the decorative cover.');
    expectLoadingCover(strpos($with, '<img id="epub-loading-cover"') < strpos($with, 'window.epubReaderConfig ='), 'Cover loading starts too late.');
    $conf['epub_loading_cover_url'] = '/theme/covers/a" onerror="test.jpg';
    expectLoadingCover(str_contains(generateEpubHTML(), 'a&quot; onerror=&quot;test.jpg'), 'Cover URL is not HTML escaped.');
} finally {
    unlink($root . '/public/linked.jpg');
    unlink($root . '/public/棚/' . $name);
    unlink($root . '/outside.jpg');
    rmdir($root . '/public/棚');
    rmdir($root . '/public');
    rmdir($root);
}
echo "epub_loading_cover.test.php: OK\n";
