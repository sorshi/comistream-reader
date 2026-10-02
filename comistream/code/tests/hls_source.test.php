<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/comistream_lib.php';
require_once dirname(__DIR__) . '/lib/lib_hls_paths.php';
$root = sys_get_temp_dir() . '/comistream-hls-source-' . bin2hex(random_bytes(8));
mkdir($root . '/share', 0700, true);
mkdir($root . '/hls/guest', 0700, true);
file_put_contents($root . '/share/日本語 + video.mp4', 'video');
file_put_contents($root . '/private.mp4', 'private');
file_put_contents($root . '/share/private.txt', 'private');
symlink($root . '/private.mp4', $root . '/share/escape.mp4');
symlink($root . '/private.mp4', $root . '/hls/guest/file');
try {
    $valid = $root . '/share/日本語 + video.mp4';
    if (ls_resolve_source($root . '/share', rawurlencode('日本語 + video.mp4')) !== realpath($valid)) {
        throw new RuntimeException('Valid encoded media rejected.');
    }
    foreach (['../private.mp4', '%2e%2e%2fprivate.mp4', '%252e%252e%252fprivate.mp4', '/private.mp4', 'escape.mp4', 'private.txt'] as $path) {
        if (ls_resolve_source($root . '/share', $path) !== false) throw new RuntimeException('Unsafe source accepted.');
    }
    if (ls_validate_source($root . '/share', $root . '/private.mp4') !== false) throw new RuntimeException('Unsafe stored source accepted.');
    ls_remove_legacy_source_links($root . '/hls');
    if (is_link($root . '/hls/guest/file') || file_get_contents($root . '/private.mp4') !== 'private') {
        throw new RuntimeException('Legacy source link cleanup failed.');
    }
} finally {
    unlink($root . '/share/escape.mp4');
    unlink($root . '/share/日本語 + video.mp4');
    unlink($root . '/share/private.txt');
    unlink($root . '/private.mp4');
    rmdir($root . '/hls/guest');
    rmdir($root . '/hls');
    rmdir($root . '/share');
    rmdir($root);
}
echo "hls_source.test.php: OK\n";
