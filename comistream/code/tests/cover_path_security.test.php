<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/comistream_lib.php';

function expectCoverPathSecurity(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$root = sys_get_temp_dir() . '/comistream-cover-path-' . bin2hex(random_bytes(8));
mkdir($root . '/covers/nas/books', 0700, true);
mkdir($root . '/preview/nas/books', 0700, true);
mkdir($root . '/outside', 0700);
$realRoot = realpath($root);
file_put_contents($root . '/outside/sentinel.jpg', 'keep');
symlink($root . '/outside/sentinel.jpg', $root . '/covers/nas/books/link.jpg');
symlink($root . '/outside', $root . '/covers/nas/escape');

try {
    $cover = resolveGeneratedImageDeletionPath($root . '/covers/nas', 'books/Comic + 1', 'jpg');
    $preview = resolveGeneratedImageDeletionPath($root . '/preview/nas', 'books/Comic + 1', 'webp');
    expectCoverPathSecurity(
        $cover === $realRoot . '/covers/nas/books/Comic + 1.jpg'
            && $preview === $realRoot . '/preview/nas/books/Comic + 1.webp',
        'Normal cover paths changed.'
    );
    foreach (['../sentinel', '/absolute', 'C:\\sentinel', 'books/../sentinel', "books/bad\nname"] as $path) {
        expectCoverPathSecurity(
            resolveGeneratedImageDeletionPath($root . '/covers/nas', $path, 'jpg') === false,
            'Traversal or malformed cover path accepted.'
        );
    }
    expectCoverPathSecurity(
        resolveGeneratedImageDeletionPath($root . '/covers/nas', 'escape/sentinel', 'jpg') === false,
        'Parent symlink escaped the cover directory.'
    );

    $linkToDelete = resolveGeneratedImageDeletionPath($root . '/covers/nas', 'books/link', 'jpg');
    expectCoverPathSecurity($linkToDelete === $realRoot . '/covers/nas/books/link.jpg', 'Leaf symlink path changed.');
    unlink($linkToDelete);
    expectCoverPathSecurity(
        file_exists($root . '/outside/sentinel.jpg') && file_get_contents($root . '/outside/sentinel.jpg') === 'keep',
        'Deleting a generated-image link deleted its external target.'
    );
} finally {
    foreach ([$root . '/covers/nas/books/link.jpg', $root . '/covers/nas/escape', $root . '/outside/sentinel.jpg'] as $path) {
        if (is_file($path) || is_link($path)) unlink($path);
    }
    rmdir($root . '/covers/nas/books');
    rmdir($root . '/covers/nas');
    rmdir($root . '/covers');
    rmdir($root . '/preview/nas/books');
    rmdir($root . '/preview/nas');
    rmdir($root . '/preview');
    rmdir($root . '/outside');
    rmdir($root);
}

echo "cover_path_security.test.php: OK\n";
