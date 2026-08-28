<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/comistream_lib.php';

function expectFavoriteTargetTest(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$testRoot = sys_get_temp_dir() . '/comistream-favorite-' . bin2hex(random_bytes(8));
$bookPath = $testRoot . '/Series/sample.cbz';
$directoryPath = dirname($bookPath);

if (!mkdir($directoryPath, 0700, true) && !is_dir($directoryPath)) {
    throw new RuntimeException('Failed to create the favorite target fixture.');
}

try {
    file_put_contents($bookPath, 'fixture');

    expectFavoriteTargetTest(
        resolveFavoriteTargetFile($testRoot, 'Series/sample.cbz') === realpath($bookPath),
        'A regular file in the share was rejected.'
    );
    expectFavoriteTargetTest(
        resolveFavoriteTargetFile($testRoot, 'Series/') === false,
        'A directory was accepted as a favorite target.'
    );
    expectFavoriteTargetTest(
        resolveFavoriteTargetFile($testRoot, '../outside.cbz') === false,
        'A traversal path was accepted as a favorite target.'
    );
    expectFavoriteTargetTest(
        resolveFavoriteTargetFile($testRoot, 'Series/missing.cbz') === false,
        'A missing file was accepted as a favorite target.'
    );
} finally {
    if (is_file($bookPath)) {
        unlink($bookPath);
    }
    if (is_dir($directoryPath)) {
        rmdir($directoryPath);
    }
    if (is_dir($testRoot)) {
        rmdir($testRoot);
    }
}

echo "favorite_target.test.php: OK\n";
