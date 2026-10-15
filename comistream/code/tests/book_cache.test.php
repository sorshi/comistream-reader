<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/lib/lib_book_cache.php';

function expectBookCache(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

function expectBookCacheFailure(callable $operation): void
{
    try {
        $operation();
    } catch (Throwable $error) {
        return;
    }
    throw new RuntimeException('Expected cache operation to fail.');
}

$root = sys_get_temp_dir() . '/comistream-book-cache-' . bin2hex(random_bytes(8));
mkdir($root, 0700);
$source = $root . '/book.epub';
$id = md5('book.epub');
$cacheRoot = $root . '/cache';
file_put_contents($source, 'original');
try {
    $first = prepareReaderBookCache($cacheRoot, $id, $source);
    $directory = $first['directory'];
    file_put_contents($directory . '/cached-page', 'old page');
    finishReaderBookCache($first, $source);
    $second = prepareReaderBookCache($cacheRoot, $id, $source);
    expectBookCache($second['reused'] && $first['record'] === $second['record'], 'Unchanged source was invalidated.');
    expectBookCache(is_file($directory . '/cached-page'), 'Unchanged cache was deleted.');

    // 同サイズで更新日時だけ変わった上書きを検出するルン。
    file_put_contents($source, 'modified');
    touch($source, $first['record']['source']['mtime'] + 10);
    $changed = prepareReaderBookCache($cacheRoot, $id, $source);
    expectBookCache(!$changed['reused'] && !file_exists($directory . '/cached-page'), 'Same-size update was not detected.');
    expectBookCache($changed['record']['generation'] !== $first['record']['generation'], 'Generation did not change.');

    // サイズとmtimeを保ったrename置換はinodeで検出するルン。
    file_put_contents($root . '/replacement', 'replaced');
    touch($root . '/replacement', $changed['record']['source']['mtime']);
    rename($root . '/replacement', $source);
    $replaced = prepareReaderBookCache($cacheRoot, $id, $source);
    expectBookCache(!$replaced['reused'], 'Same-size, same-mtime replacement was not detected.');
    expectBookCache($replaced['record']['source']['ino'] !== $changed['record']['source']['ino'], 'Replacement fixture did not change inode.');

    // 同じmtimeでもサイズが違えば無効化するルン。
    file_put_contents($source, 'different length');
    touch($source, $replaced['record']['source']['mtime']);
    $resized = prepareReaderBookCache($cacheRoot, $id, $source);
    expectBookCache(!$resized['reused'], 'Size-only update was not detected.');

    foreach ([null, '{broken', '{"schema":999}', str_repeat('x', 5000)] as $record) {
        file_put_contents($directory . '/old', 'old');
        if ($record === null) unlink($directory . '/_comistream-reader-source.json');
        else file_put_contents($directory . '/_comistream-reader-source.json', $record);
        $rebuilt = prepareReaderBookCache($cacheRoot, $id, $source);
        expectBookCache(!$rebuilt['reused'] && !file_exists($directory . '/old'), 'Legacy or corrupt record was reused.');
    }

    mkdir($root . '/outside');
    file_put_contents($root . '/outside/keep', 'keep');
    unlink($directory . '/_comistream-reader-source.json');
    symlink($root . '/outside/keep', $directory . '/_comistream-reader-source.json');
    symlink($root . '/outside', $directory . '/directory-link');
    symlink($source, $directory . '/file');
    $rebuilt = prepareReaderBookCache($cacheRoot, $id, $source);
    expectBookCache(file_get_contents($root . '/outside/keep') === 'keep' && is_file($source), 'Cache deletion followed a symlink.');
    expectBookCache(!is_link($directory . '/_comistream-reader-source.json'), 'Record symlink was reused.');

    symlink($root . '/outside/keep', $directory . '/_comistream-reader-failed');
    file_put_contents($source, 'changed while extracting');
    expectBookCacheFailure(fn () => finishReaderBookCache($rebuilt, $source));
    expectBookCache(readReaderBookCacheRecord($directory) === null, 'Changed source was committed as current.');
    expectBookCache(file_get_contents($root . '/outside/keep') === 'keep' && !is_link($directory . '/_comistream-reader-failed'), 'Failure marker followed a symlink.');
    foreach (['../outside', '', '.', 'not-a-hash', $id . '/x'] as $badId) {
        expectBookCacheFailure(fn () => removeReaderBookCache($cacheRoot, $badId));
    }

    // 古い非同期ジョブは、新世代に対して実行しないルン。
    $current = prepareReaderBookCache($cacheRoot, $id, $source);
    $lock = acquireReaderBookCacheLock($cacheRoot, $id);
    fclose($lock);
    $worker = dirname(__DIR__) . '/book_cache_worker.php';
    $marker = $root . '/worker-ran';
    $command = 'touch ' . escapeshellarg($marker);
    $runWorker = static function (string $generation) use ($worker, $cacheRoot, $id, $source, $command): int {
        $args = [PHP_BINARY, $worker, $cacheRoot, $id, $generation, $source, $command];
        exec(implode(' ', array_map('escapeshellarg', $args)) . ' 2>&1', $output, $status);
        return $status;
    };
    expectBookCache($runWorker($first['record']['generation']) === 0 && !file_exists($marker), 'Obsolete worker ran.');
    expectBookCache($runWorker($current['record']['generation']) === 0 && is_file($marker), 'Current worker did not run.');
    unlink($marker);
    file_put_contents($source, 'new source before queued job');
    expectBookCache($runWorker($current['record']['generation']) !== 0 && !file_exists($marker), 'Worker ran against a changed source.');

    // 別プロセスの生成中は排他ロックを取得できないルン。
    $lock = acquireReaderBookCacheLock($cacheRoot, $id);
    $probe = 'require $argv[1]; try { acquireReaderBookCacheLock($argv[2], $argv[3], LOCK_EX | LOCK_NB); exit(1); } catch (Throwable $e) { exit(0); }';
    $args = [PHP_BINARY, '-r', $probe, dirname(__DIR__) . '/lib/lib_book_cache.php', $cacheRoot, $id];
    exec(implode(' ', array_map('escapeshellarg', $args)), $output, $status);
    expectBookCache($status === 0, 'Concurrent cache lock was not exclusive.');
    fclose($lock);

    // 実際の非同期起動でも、親のロック解除後に動き、FD継承で停止しないルン。
    $readerBookCache = prepareReaderBookCache($cacheRoot, $id, $source);
    $openFile = $source;
    $cacheDir = $cacheRoot;
    $file = $id;
    $lock = acquireReaderBookCacheLock($cacheRoot, $id);
    runReaderBookCacheCommand($command, true);
    usleep(100000);
    clearstatcache();
    expectBookCache(!file_exists($marker), 'Worker ignored the parent lock.');
    fclose($lock);
    $deadline = microtime(true) + 5;
    do {
        usleep(20000);
        clearstatcache();
    } while (!file_exists($marker) && microtime(true) < $deadline);
    expectBookCache(is_file($marker), 'Background worker inherited the lock or did not run.');
    $lock = acquireReaderBookCacheLock($cacheRoot, $id);
    expectBookCache(readReaderBookCacheRecord($directory) === $readerBookCache['record'], 'Background worker lost its source record.');
    fclose($lock);
} finally {
    removeReaderBookCacheTree($root);
}

echo "book_cache.test.php: OK\n";
