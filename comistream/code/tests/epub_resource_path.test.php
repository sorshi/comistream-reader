<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/comistream_lib.php';

function expectEpubResourcePath(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$root = sys_get_temp_dir() . '/comistream-epub-resource-' . bin2hex(random_bytes(8));
$outsideRoot = $root . '-outside';
mkdir($root . '/OPS/images', 0700, true);
mkdir($root . '/META-INF', 0700, true);
mkdir($outsideRoot, 0700);
$realRoot = realpath($root);
file_put_contents($root . '/META-INF/container.xml', '<container/>');
file_put_contents($root . '/OPS/package.opf', '<package/>');
file_put_contents($root . '/OPS/images/cover art.png', 'inside');
file_put_contents($root . '/OPS/cover.png', 'inside parent');
file_put_contents($outsideRoot . '/sentinel.png', 'keep');
symlink($outsideRoot . '/sentinel.png', $root . '/OPS/images/outside.png');

try {
    expectEpubResourcePath(
        resolveEpubFileWithinExtractionRoot($root, '.', 'META-INF/container.xml')
            === $realRoot . '/META-INF/container.xml',
        'Container path did not resolve inside the extraction root.'
    );
    expectEpubResourcePath(
        resolveEpubFileWithinExtractionRoot($root, '.', 'OPS/package.opf')
            === $realRoot . '/OPS/package.opf',
        'Normal OPF path did not resolve.'
    );
    expectEpubResourcePath(
        resolveEpubFileWithinExtractionRoot($root, 'OPS', 'images/cover%20art.png#cover')
            === $realRoot . '/OPS/images/cover art.png',
        'Encoded in-root image reference did not resolve.'
    );
    expectEpubResourcePath(
        resolveEpubFileWithinExtractionRoot($root, 'OPS/images', '../../OPS/cover.png')
            === $realRoot . '/OPS/cover.png',
        'A relative reference that stays inside the root was rejected.'
    );

    $externalRelativePath = '../../../' . basename($outsideRoot) . '/sentinel.png';
    foreach ([$externalRelativePath, '/etc/passwd', '//host/share.png', 'https://example.test/image.png', 'data:image/png;base64,AA==', '%2fetc%2fpasswd', "bad\nimage.png"] as $href) {
        expectEpubResourcePath(
            resolveEpubFileWithinExtractionRoot($root, 'OPS/images', $href) === false,
            'External or malformed EPUB image reference was accepted.'
        );
    }
    expectEpubResourcePath(
        resolveEpubFileWithinExtractionRoot($root, 'OPS/images', 'outside.png') === false,
        'Image symlink escaped the extraction root.'
    );
    expectEpubResourcePath(
        resolveEpubFileWithinExtractionRoot($root, '../' . basename($outsideRoot), 'sentinel.png') === false,
        'OPF base directory escaped the extraction root.'
    );
    expectEpubResourcePath(file_get_contents($outsideRoot . '/sentinel.png') === 'keep', 'External sentinel changed.');
} finally {
    foreach ([$root . '/META-INF/container.xml', $root . '/OPS/package.opf', $root . '/OPS/images/cover art.png', $root . '/OPS/images/outside.png', $root . '/OPS/cover.png', $outsideRoot . '/sentinel.png'] as $path) {
        if (is_file($path) || is_link($path)) unlink($path);
    }
    rmdir($root . '/META-INF');
    rmdir($root . '/OPS/images');
    rmdir($root . '/OPS');
    rmdir($root);
    rmdir($outsideRoot);
}

echo "epub_resource_path.test.php: OK\n";
