<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/comistream_lib.php';
require_once dirname(__DIR__) . '/lib/lib_hls_paths.php';

function expectHlsPath(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$tool = sys_get_temp_dir() . '/comistream-hls-paths-' . bin2hex(random_bytes(8));
$root = $tool . '/data/theme/hls';
mkdir($root . '/guest', 0700, true);
mkdir($tool . '/data/db', 0700);
file_put_contents($tool . '/data/db/sentinel', 'keep');
symlink($tool . '/data/db', $root . '/alias');
symlink($tool . '/absent', $root . '/broken');
symlink($tool . '/data/db/sentinel', $root . '/guest/file');
file_put_contents($root . '/guest/index.m3u8', 'playlist');
$conf = ['comistream_tool_dir' => $tool];
try {
    foreach (['guest', '日本語 reader', 'name.with.dots', 'a|b', '100%'] as $name) {
        expectHlsPath(ls_resolve_hls_directory($root, $name) === realpath($root) . '/' . $name, 'Valid user rejected.');
    }
    foreach (['', '.', '..', '../../db', 'a/b', 'a\\b', "a\0b", "a\nb", 'alias', 'broken'] as $name) {
        expectHlsPath(ls_resolve_hls_directory($root, $name) === false, 'Unsafe user accepted.');
    }
    expectHlsPath(!ls_reset_hls_dir($root . '/../../db'), 'Database cleanup accepted.');
    expectHlsPath(!ls_reset_hls_dir($root), 'Root cleanup accepted.');
    expectHlsPath(ls_reset_hls_dir(realpath($root) . '/guest'), 'Normal cleanup failed.');
    expectHlsPath(file_get_contents($tool . '/data/db/sentinel') === 'keep', 'Symlink target deleted.');
    mkdir($root . '/guest/unexpected');
    expectHlsPath(!ls_reset_hls_dir(realpath($root) . '/guest') && is_dir($root . '/guest/unexpected'), 'Unexpected directory deleted.');
    $pattern = ls_encoder_process_pattern('a|b.*');
    expectHlsPath(preg_match('~' . $pattern . '~', 'ffmpeg hls/a|b.*/file') === 1, 'Literal process pattern mismatch.');
    expectHlsPath(preg_match('~' . $pattern . '~', 'ffmpeg hls/another/file') === 0, 'Process pattern matched another user.');
} finally {
    rmdir($root . '/guest/unexpected');
    rmdir($root . '/guest');
    unlink($root . '/alias');
    unlink($root . '/broken');
    unlink($tool . '/data/db/sentinel');
    rmdir($tool . '/data/db');
    rmdir($root);
    rmdir($tool . '/data/theme');
    rmdir($tool . '/data');
    rmdir($tool);
}
echo "hls_paths.test.php: OK\n";
