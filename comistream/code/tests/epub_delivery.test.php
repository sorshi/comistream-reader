<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/lib/lib_epub_delivery.php';

function expectEpubDelivery(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$root = sys_get_temp_dir() . '/comistream-epub-delivery-' . bin2hex(random_bytes(8));
$id = str_repeat('a', 64);
$directory = $root . '/cache/' . $id;
mkdir($directory . '/META-INF', 0700, true);
try {
    file_put_contents($directory . '/META-INF/container.xml', '<container/>');
    file_put_contents($directory . '/DONE', '');
    writeReaderBookCacheRecord($directory, ['schema' => 1, 'source' => ['size' => 1], 'generation' => str_repeat('b', 32)]);
    file_put_contents($directory . '/日本語 + % # ?.xhtml', '<html/>');
    file_put_contents($directory . '/image.png', 'image');
    file_put_contents($directory . '/payload.php', '<?php echo "must not execute";');
    file_put_contents($directory . '/.htaccess', 'Require all granted');
    file_put_contents($root . '/private.png', 'private');
    symlink($root . '/private.png', $directory . '/escape.png');
    symlink($root, $directory . '/escape');
    $resource = resolveReaderEpubResource($root . '/cache', $id, '日本語 + % # ?.xhtml');
    expectEpubDelivery($resource !== false && $resource['type'] === 'application/xhtml+xml', 'Valid EPUB resource was rejected.');
    foreach (['../private.png', '/private.png', './image.png', '.htaccess', 'DONE', '_comistream-reader-source.json',
        'payload.php', 'escape.png', 'escape/private.png', "image.png\0", 'missing.png', 'META-INF/../image.png'] as $relative) {
        expectEpubDelivery(resolveReaderEpubResource($root . '/cache', $id, $relative) === false, 'Unsafe EPUB resource was accepted: ' . $relative);
    }
    expectEpubDelivery(resolveReaderEpubResource($root . '/cache', '../outside', 'image.png') === false, 'Invalid book ID was accepted.');
    unlink($directory . '/DONE');
    expectEpubDelivery(resolveReaderEpubResource($root . '/cache', $id, 'image.png') === false, 'Unfinished EPUB was published.');
    foreach (['bytes=0-3' => [0, 3], 'bytes=4-' => [4, 9], 'bytes=-3' => [7, 9], 'bytes=0-99' => [0, 9]] as $header => $expected) {
        expectEpubDelivery(readerResourceRange($header, 10) === $expected, 'Valid Range was rejected.');
    }
    foreach (['bytes=10-', 'bytes=5-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,4-5', 'items=0-1'] as $header) {
        expectEpubDelivery(readerResourceRange($header, 10) === false, 'Invalid Range was accepted.');
    }
} finally {
    $items = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($items as $item) {
        if ($item->isLink() || $item->isFile()) unlink($item->getPathname());
        else rmdir($item->getPathname());
    }
    rmdir($root);
}
echo "epub_delivery.test.php: OK\n";
