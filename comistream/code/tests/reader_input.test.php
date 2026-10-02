<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/comistream_lib.php';

function expectReaderInput(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

foreach ([1, '1', '001', 800, '32768'] as $input) {
    expectReaderInput(parseReaderInteger($input, 1, 32768) === (int)$input, 'Valid integer rejected.');
}
foreach ([0, -1, '', [], null, 1.5, '1.5', '1;printf injected', '$(printf injected)', '999999999999999999'] as $input) {
    expectReaderInput(parseReaderInteger($input, 1, 32768) === null, 'Invalid integer accepted.');
}

$root = sys_get_temp_dir() . '/comistream-reader-input-' . bin2hex(random_bytes(8));
mkdir($root . '/cache/fixture', 0700, true);
mkdir($root . '/outside', 0700);
file_put_contents($root . '/cache/fixture/index', " first.jxl \nlast.jxl\n");
file_put_contents($root . '/fixture.cbz', 'fixture');
symlink($root . '/fixture.cbz', $root . '/cache/fixture/file');
symlink($root . '/outside', $root . '/cache/alias');
try {
    $cacheDir = $root . '/cache';
    $file = 'fixture';
    $page = 1;
    $width = 800;
    $quality = 75;
    $view = '';
    file_put_contents($root . '/cache/fixture/ first.jxl ', 'literal');
    $directory = resolveReaderCacheDirectory($cacheDir, $file);
    expectReaderInput($directory !== false, 'Normal cache rejected.');
    expectReaderInput(readReaderIndexPage($directory, 1) === ' first.jxl ', 'Member whitespace changed.');
    expectReaderInput(readReaderIndexPage($directory, 2) === 'last.jxl', 'Last page not found.');
    expectReaderInput(readReaderIndexPage($directory, 3) === false, 'Out-of-range page accepted.');
    foreach (['../outside', 'a/b', 'a\\b', '.', '..', '$(printf injected)', 'alias'] as $id) {
        expectReaderInput(resolveReaderCacheDirectory($cacheDir, $id) === false, 'Unsafe cache accepted.');
    }
    expectReaderInput(str_contains(outputPage(true), 'cat '), 'Valid extraction command missing.');
    foreach (['1;printf injected', '`printf injected`', '0'] as $badPage) {
        $page = $badPage;
        expectReaderInput(outputPage(true) === '', 'Unsafe page reached extraction.');
    }
    $page = 1;
    $width = '800;printf injected';
    expectReaderInput(outputPage(true) === '', 'Unsafe width reached extraction.');
} finally {
    unlink($root . '/cache/alias');
    unlink($root . '/cache/fixture/index');
    unlink($root . '/cache/fixture/file');
    unlink($root . '/fixture.cbz');
    unlink($root . '/cache/fixture/ first.jxl ');
    rmdir($root . '/cache/fixture');
    rmdir($root . '/cache');
    rmdir($root . '/outside');
    rmdir($root);
}
echo "reader_input.test.php: OK\n";
