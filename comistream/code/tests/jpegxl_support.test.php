<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/comistream_lib.php';

function expectJpegXlTest(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$plainList = "001.jpg\n002.JXL\nnotes.txt\n";
expectJpegXlTest(
    getArchiveImagePathsFromPlainList($plainList) === ['001.jpg', '002.JXL'],
    'JPEG XL was not included in a plain archive image list.'
);

$sltList = <<<'SLT'
Path = sample.cbz
Type = zip

----------
Path = 001.jpg
Size = 10
Folder = -
Attributes = A

Path = 002.jxl
Size = 12
Folder = -
Attributes = A
SLT;
$archiveEntries = parseSevenZipSltEntries($sltList);
expectJpegXlTest(
    getArchivePathsByExtension($archiveEntries, ['jpg', 'jxl']) === ['001.jpg', '002.jxl'],
    'JPEG XL was not included in a structured archive image list.'
);

$testRoot = sys_get_temp_dir() . '/comistream-jpegxl-' . bin2hex(random_bytes(8));
$cacheDir = $testRoot . '/cache';
$file = 'fixture';
$bookCacheDir = $cacheDir . '/' . $file;
$archivePath = $testRoot . '/fixture.cbz';
$jpegXlBytes = "\x00\x00\x00\x0cJXL \x0d\x0a\x87\x0aTEST";

if (!mkdir($bookCacheDir, 0700, true) && !is_dir($bookCacheDir)) {
    throw new RuntimeException('Failed to create the JPEG XL fixture.');
}

try {
    file_put_contents($archivePath, 'archive fixture');
    symlink($archivePath, $bookCacheDir . '/file');
    file_put_contents($bookCacheDir . '/index', "001.jxl\n");
    file_put_contents($bookCacheDir . '/001.jxl', $jpegXlBytes);

    $page = 1;
    $view = '';
    $size = 'comp';
    $quality = 75;
    $width = 800;
    $als = 0;
    $tempDir = $testRoot . '/tmp';
    $fullsize_png_compress = 1;
    $isPageSave = false;
    $position_int = 0;
    $crop_split_view_parts = '';
    $conf = ['isLowMemoryMode' => 0];
    $dbh = null;
    $convert = '/must-not-run/convert';
    $cpdf = '';
    $unzip = '';
    $p7zip = '';
    $unrar = '';

    ob_start();
    outputPage();
    $output = ob_get_clean();

    expectJpegXlTest(
        $output === $jpegXlBytes,
        'JPEG XL page data was changed instead of being passed through.'
    );
} finally {
    foreach ([$bookCacheDir . '/001.jxl', $bookCacheDir . '/index', $bookCacheDir . '/file', $archivePath] as $path) {
        if (is_file($path) || is_link($path)) {
            unlink($path);
        }
    }
    if (is_dir($bookCacheDir)) {
        rmdir($bookCacheDir);
    }
    if (is_dir($cacheDir)) {
        rmdir($cacheDir);
    }
    if (is_dir($testRoot)) {
        rmdir($testRoot);
    }
}

echo "jpegxl_support.test.php: OK\n";
