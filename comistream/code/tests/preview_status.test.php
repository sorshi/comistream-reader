<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/lib/lib_preview_status.php';

function expectPreviewStatus(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$root = sys_get_temp_dir() . '/comistream-preview-status-' . bin2hex(random_bytes(8));
mkdir($root . '/data', 0700, true);
$relative = '棚 + %2F/本 #?&.epub';
$source = $root . '/source.epub';
file_put_contents($source, 'read-only source');
chmod($source, 0444);
try {
    expectPreviewStatus(!previewUnavailableMatches($root, $relative, $source), 'Missing status matched.');
    $signature = previewSourceSignature($source);
    expectPreviewStatus(savePreviewUnavailable($root, $relative, $source, $signature), 'Status was not saved.');
    expectPreviewStatus(previewUnavailableMatches($root, $relative, $source), 'Unchanged source was not skipped.');
    expectPreviewStatus(!previewUnavailableMatches($root, 'other.epub', $source), 'Another book inherited the status.');
    expectPreviewStatus(!previewUnavailableMatches($root, '../outside.epub', $source), 'Traversal status was accepted.');
    $paths = previewStatusPaths($root, $relative);
    $record = json_decode(file_get_contents($paths['record']), true, 512, JSON_THROW_ON_ERROR);
    $record['version'] = 0;
    file_put_contents($paths['record'], json_encode($record));
    expectPreviewStatus(!previewUnavailableMatches($root, $relative, $source), 'Old processor version matched.');
    file_put_contents($paths['record'], '{broken');
    expectPreviewStatus(!previewUnavailableMatches($root, $relative, $source), 'Corrupt status matched.');
    expectPreviewStatus(savePreviewUnavailable($root, $relative, $source, $signature), 'Status rewrite failed.');
    touch($source, $signature['mtime'] + 10);
    expectPreviewStatus(!previewUnavailableMatches($root, $relative, $source), 'Changed mtime did not invalidate status.');
    expectPreviewStatus(!savePreviewUnavailable($root, $relative, $source, $signature), 'A source changed during extraction was cached.');
    touch($source, $signature['mtime']);
    chmod($source, 0644);
    file_put_contents($source, 'changed size');
    expectPreviewStatus(!previewUnavailableMatches($root, $relative, $source), 'Changed size did not invalidate status.');
    expectPreviewStatus(clearPreviewUnavailable($root, $relative), 'Manual reset failed.');
    expectPreviewStatus(!is_file($paths['record']), 'Manual reset kept the record.');
    $lock = acquirePreviewStatusLock($root, $relative);
    expectPreviewStatus(is_resource($lock), 'Book lock was not acquired.');
    fclose($lock);
    expectPreviewStatus(is_file($paths['lock']), 'Stable lock file was removed.');
} finally {
    foreach (glob($root . '/data/preview_status/*') ?: [] as $path) unlink($path);
    if (is_dir($root . '/data/preview_status')) rmdir($root . '/data/preview_status');
    unlink($source);
    rmdir($root . '/data');
    rmdir($root);
}

echo "preview_status.test.php: OK\n";
