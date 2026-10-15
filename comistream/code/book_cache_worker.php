<?php

/**
 * 書籍の非同期展開も、削除・再生成と同じロックで実行するルン。
 * @license AGPL-3.0-only
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
require_once __DIR__ . '/lib/lib_book_cache.php';
if ($argc !== 6) exit(1);
[$script, $root, $id, $generation, $source, $command] = $argv;
try {
    acquireReaderBookCacheLock($root, $id);
    $directory = readerBookCacheRoot($root) . '/' . $id;
    $record = readReaderBookCacheRecord($directory);
    if ($record === null || $record['generation'] !== $generation) exit(0);
    $cache = ['directory' => $directory, 'record' => $record];
    finishReaderBookCache($cache, $source);
    $output = [];
    exec($command, $output, $status);
    if ($status !== 0) throw new RuntimeException('Book cache extraction failed.');
    finishReaderBookCache($cache, $source);
} catch (Throwable $error) {
    error_log('Book cache worker: ' . $error->getMessage());
    if (isset($cache)) {
        // 待機画面が完了を待ち続けないよう、失敗を伝えるルン。
        markReaderBookCacheFailed($cache['directory']);
    }
    exit(1);
}
