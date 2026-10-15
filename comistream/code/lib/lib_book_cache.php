<?php

/**
 * 原本の属性で書籍キャッシュを更新し、削除と生成を同じロックで守るルン。
 * @license AGPL-3.0-only
 */

function isReaderBookCacheId($id): bool
{
    return is_string($id) && preg_match('/\A[a-f0-9]{32,128}\z/', $id) === 1;
}

function readerBookSourceSignature(string $source): array
{
    clearstatcache(true, $source);
    $stat = @stat($source);
    if ($stat === false || !is_file($source) || !is_readable($source)) {
        throw new RuntimeException('Cannot read book source attributes.');
    }
    return array_intersect_key($stat, array_flip(['size', 'mtime', 'ctime', 'ino', 'dev']));
}

function readerBookCacheId(string $relative, string $source): string
{
    global $md5cmd;
    if (preg_match('/\.epub\s*$/i', $relative)) {
        $id = basefilename2hash(ltrim($relative, '/'));
    } else {
        // 画像書籍の既存IDは絶対パスと末尾改行を使うので、その方式を保つルン。
        $id = trim((string)shell_exec(sprintf("echo %s | %s | awk '{print \$1}'", escapeshellarg($source), $md5cmd)));
    }
    if (!isReaderBookCacheId($id)) throw new RuntimeException('Invalid book cache ID.');
    return $id;
}

function readerBookCacheRoot(string $root): string
{
    if (!is_dir($root) && !@mkdir($root, 0775, true) && !is_dir($root)) {
        throw new RuntimeException('Cannot create book cache root.');
    }
    $resolved = realpath($root);
    if ($resolved === false) throw new RuntimeException('Cannot resolve book cache root.');
    return $resolved;
}

function acquireReaderBookCacheLock(string $root, string $id, int $mode = LOCK_EX)
{
    // 表紙バッチがopenPageとoutputPageを続けて呼んでも、同じロックを使うルン。
    static $locks = [];
    if (!isReaderBookCacheId($id)) throw new RuntimeException('Invalid book cache ID.');
    $root = readerBookCacheRoot($root);
    $key = $root . '/' . $id;
    if (isset($locks[$key]) && is_resource($locks[$key])) return $locks[$key];
    $runtime = dirname($root) . '/runtime';
    $directory = $runtime . '/book-cache';
    foreach ([$runtime, $directory] as $path) {
        if (is_link($path)) throw new RuntimeException('Book cache lock directory must not be a symlink.');
        if (!is_dir($path)) {
            if (@mkdir($path, 0775)) {
                if (!chgrp($path, filegroup(dirname($path))) || !chmod($path, 02775)) {
                    throw new RuntimeException('Cannot set book cache lock directory permissions.');
                }
            } elseif (!is_dir($path)) {
                throw new RuntimeException('Cannot create book cache lock directory.');
            }
        }
    }
    $path = $directory . '/' . $id . '.lock';
    if (is_link($path)) throw new RuntimeException('Book cache lock must not be a symlink.');
    $newLock = !file_exists($path);
    // 非同期PHPへロックFDを継承すると自分自身を待つので、exec時に閉じるルン。
    $lock = @fopen($path, 'ce');
    if ($lock === false) throw new RuntimeException('Cannot open book cache lock.');
    if ($newLock && (!chgrp($path, filegroup($directory)) || !chmod($path, 0664))) {
        fclose($lock);
        throw new RuntimeException('Cannot set book cache lock permissions.');
    }
    if (!flock($lock, $mode)) {
        fclose($lock);
        throw new RuntimeException('Book cache is busy.');
    }
    $locks[$key] = $lock;
    return $lock;
}

function readReaderBookCacheRecord(string $directory): ?array
{
    $path = $directory . '/_comistream-reader-source.json';
    clearstatcache(true, $path);
    if (is_link($directory) || is_link($path) || !is_file($path) || filesize($path) > 4096) return null;
    $record = json_decode((string)@file_get_contents($path), true);
    if (!is_array($record) || ($record['schema'] ?? null) !== 1
        || !is_array($record['source'] ?? null)
        || !is_string($record['generation'] ?? null)
        || preg_match('/\A[a-f0-9]{32}\z/', $record['generation']) !== 1) return null;
    return $record;
}

function writeReaderBookCacheRecord(string $directory, array $record): void
{
    if (is_link($directory) || !is_dir($directory)) throw new RuntimeException('Invalid book cache directory.');
    $temporary = tempnam($directory, '_comistream-reader-source-');
    if ($temporary === false) throw new RuntimeException('Cannot create book source record.');
    try {
        $json = json_encode($record, JSON_THROW_ON_ERROR);
        if (file_put_contents($temporary, $json) !== strlen($json) || !chmod($temporary, 0664)
            || !rename($temporary, $directory . '/_comistream-reader-source.json')) {
            throw new RuntimeException('Cannot save book source record.');
        }
    } finally {
        if (is_file($temporary)) unlink($temporary);
    }
}

function removeReaderBookCacheTree(string $path): void
{
    // 検証済みのキャッシュ直下からだけ呼び、原本や外部ディレクトリへのリンクは辿らないルン。
    if (is_link($path) || is_file($path)) {
        if (!unlink($path)) throw new RuntimeException('Cannot unlink book cache entry.');
    } elseif (is_dir($path)) {
        foreach (new FilesystemIterator($path) as $item) removeReaderBookCacheTree($item->getPathname());
        if (!rmdir($path)) throw new RuntimeException('Cannot remove book cache directory.');
    } elseif (file_exists($path)) {
        throw new RuntimeException('Unsupported book cache entry.');
    }
}

function removeReaderBookCache(string $root, string $id): void
{
    if (!isReaderBookCacheId($id)) throw new RuntimeException('Invalid book cache ID.');
    $root = readerBookCacheRoot($root);
    removeReaderBookCacheTree($root . '/' . $id);
    clearstatcache();
}

function removeReaderEpubLink(string $webRoot, string $id): void
{
    if (!isReaderBookCacheId($id)) throw new RuntimeException('Invalid book cache ID.');
    $root = rtrim($webRoot, '/') . '/theme/bibi';
    if (!file_exists($root) && !is_link($root)) return;
    if (is_link($root) || !is_dir($root)) throw new RuntimeException('Invalid EPUB public directory.');
    $path = $root . '/' . $id;
    // 公開側はリンクだけを管理するルン。予期しない実ディレクトリは削除しないルン。
    if (is_link($path)) {
        if (!unlink($path)) throw new RuntimeException('Cannot remove EPUB public link.');
    } elseif (file_exists($path)) {
        throw new RuntimeException('EPUB public entry is not a symlink.');
    }
}

function prepareReaderBookCache(string $root, string $id, string $source, bool $force = false): array
{
    acquireReaderBookCacheLock($root, $id);
    $directory = readerBookCacheRoot($root) . '/' . $id;
    $signature = readerBookSourceSignature($source);
    $record = readReaderBookCacheRecord($directory);
    $reused = !$force && $record !== null && $record['source'] === $signature;
    if (!$reused) {
        removeReaderBookCache($root, $id);
        if (!mkdir($directory, 0775)) throw new RuntimeException('Cannot create book cache directory.');
        $record = ['schema' => 1, 'source' => $signature, 'generation' => bin2hex(random_bytes(16))];
        writeReaderBookCacheRecord($directory, $record);
    }
    return ['directory' => $directory, 'record' => $record, 'reused' => $reused];
}

function finishReaderBookCache(array $cache, string $source): void
{
    if (readerBookSourceSignature($source) !== $cache['record']['source']) {
        // 次回オープンでは途中まで作った結果を必ず捨てるルン。
        markReaderBookCacheFailed($cache['directory']);
        throw new RuntimeException('Book source changed while preparing the cache.');
    }
    if (readReaderBookCacheRecord($cache['directory']) !== $cache['record']) {
        writeReaderBookCacheRecord($cache['directory'], $cache['record']);
    }
}

function markReaderBookCacheFailed(string $directory): void
{
    if (is_link($directory) || !is_dir($directory)) return;
    $path = $directory . '/_comistream-reader-source.json';
    if (is_file($path) || is_link($path)) @unlink($path);
    // アーカイブ内に同名リンクがあっても、そのリンク先へ書き込まないルン。
    $temporary = @tempnam($directory, '_comistream-reader-failed-');
    if ($temporary !== false) {
        @rename($temporary, $directory . '/_comistream-reader-failed');
        if (is_file($temporary)) @unlink($temporary);
    }
}

function guardReaderBookCacheAtShutdown(array $cache, string $source): void
{
    // PDFの待機画面など、途中でexitする経路でも変更を見逃さないルン。
    register_shutdown_function(static function () use ($cache, $source) {
        try {
            if (readerBookSourceSignature($source) === $cache['record']['source']) return;
        } catch (Throwable $error) {
        }
        $record = readReaderBookCacheRecord($cache['directory']);
        if ($record !== null && $record['generation'] === $cache['record']['generation']) {
            markReaderBookCacheFailed($cache['directory']);
        }
    });
}

function runReaderBookCacheCommand(string $command, bool $background = false): void
{
    global $readerBookCache, $openFile, $cacheDir, $file;
    if (!isset($readerBookCache)) {
        exec($command . ($background ? ' > /dev/null 2>&1 &' : ''));
        return;
    }
    if (!$background) {
        $output = [];
        exec($command, $output, $status);
        if ($status !== 0) throw new RuntimeException('Book cache extraction failed.');
        finishReaderBookCache($readerBookCache, $openFile);
        return;
    }
    // 待機中に削除されたジョブは、世代を照合してから終了するルン。
    $arguments = [$cacheDir, $file, $readerBookCache['record']['generation'], $openFile, $command];
    $worker = dirname(__DIR__) . '/book_cache_worker.php';
    exec('php ' . escapeshellarg($worker) . ' ' . implode(' ', array_map('escapeshellarg', $arguments)) . ' > /dev/null 2>&1 &');
}
