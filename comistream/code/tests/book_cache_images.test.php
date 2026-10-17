<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/comistream_lib.php';

function expectBookCacheImages(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$root = sys_get_temp_dir() . '/comistream-book-images-' . bin2hex(random_bytes(8));
mkdir($root, 0700);
try {
    foreach (['normal', 'missing-images', 'missing-roots', 'missing-parents', 'leaf-link', 'parent-link', 'parent-link-missing', 'directory', 'status-failure', 'traversal'] as $case) {
        $tool = $root . '/' . $case;
        $relative = '棚 + %2F/' . ($case === 'parent-link-missing' ? 'sub/' : '') . '本 #?.epub';
        $base = preg_replace('/\.[^.]+$/', '', $relative);
        $cache = $tool . '/data/cache';
        $cover = $tool . '/data/theme/covers/nas/' . $base . '.jpg';
        $preview = $tool . '/data/theme/preview/nas/' . $base . '.webp';
        mkdir($cache, 0700, true);
        mkdir($tool . '/outside', 0700);
        file_put_contents($tool . '/outside/keep', 'keep');
        file_put_contents($tool . '/outside/本 #?.webp', 'keep');
        if ($case !== 'missing-roots') {
            foreach ([$cover, $preview] as $path) mkdir(dirname($path), 0700, true);
        }
        if ($case === 'leaf-link') {
            symlink($tool . '/outside/keep', $cover);
            symlink($tool . '/outside', $preview);
        } elseif (!in_array($case, ['missing-images', 'missing-roots', 'missing-parents'], true)) {
            file_put_contents($cover, 'old cover');
            if ($case === 'directory') {
                mkdir($preview, 0700);
                file_put_contents($preview . '/keep', 'keep');
            } elseif (str_starts_with($case, 'parent-link')) {
                $parentLink = $tool . '/data/theme/preview/nas/棚 + %2F';
                removeReaderBookCacheTree($parentLink);
                symlink($tool . '/outside', $parentLink);
            } else {
                file_put_contents($preview, 'old preview');
            }
        }
        if ($case === 'missing-parents') {
            rmdir(dirname($cover));
            rmdir(dirname($preview));
        }

        $source = $tool . '/book.epub';
        file_put_contents($source, 'old source');
        $status = previewStatusPaths($tool, $relative, true);
        if ($case === 'status-failure') mkdir($status['record'], 0700);
        else expectBookCacheImages(savePreviewUnavailable($tool, $relative, $source, previewSourceSignature($source)), $case . ': status fixture failed.');
        $imageRelative = $case === 'traversal' ? '../outside.epub' : $relative;
        $invalidate = static function () use ($tool, &$imageRelative) {
            invalidateReaderBookImages($tool, '/nas', $imageRelative);
        };
        $id = md5($relative);
        $first = prepareReaderBookCache($cache, $id, $source, false, $invalidate);
        $directory = $first['directory'];
        file_put_contents($directory . '/body', 'old body');
        $unchanged = prepareReaderBookCache($cache, $id, $source, false, $invalidate);
        expectBookCacheImages($unchanged['reused'] && $unchanged['record'] === $first['record'], $case . ': unchanged cache was reset.');
        expectBookCacheImages(file_exists($status['record']), $case . ': initial or unchanged open cleared preview status.');

        file_put_contents($source, 'new source');
        touch($source, $first['record']['source']['mtime'] + 10);
        chmod($source, 0444);
        if (in_array($case, ['parent-link', 'parent-link-missing', 'directory', 'status-failure', 'traversal'], true)) {
            // 削除できない場合は旧属性と本文を保持し、安全な状態に直した後で再試行するルン。
            $failed = false;
            try {
                prepareReaderBookCache($cache, $id, $source, false, $invalidate);
            } catch (RuntimeException $error) {
                $failed = true;
            }
            expectBookCacheImages($failed, $case . ': unsafe invalidation succeeded.');
            expectBookCacheImages(readReaderBookCacheRecord($directory) === $first['record']
                && file_get_contents($directory . '/body') === 'old body', $case . ': failed reset committed the new source.');
            expectBookCacheImages(file_get_contents($cover) === 'old cover', $case . ': validation failure partially deleted images.');
            if (str_starts_with($case, 'parent-link')) unlink($parentLink);
            elseif ($case === 'directory') {
                expectBookCacheImages(file_get_contents($preview . '/keep') === 'keep', 'Image reset recursively deleted a directory.');
                unlink($preview . '/keep');
                rmdir($preview);
            } elseif ($case === 'status-failure') rmdir($status['record']);
            $imageRelative = $relative;
        }

        $updated = prepareReaderBookCache($cache, $id, $source, false, $invalidate);
        expectBookCacheImages(!$updated['reused'] && $updated['record']['generation'] !== $first['record']['generation'], $case . ': changed source was reused.');
        foreach ([$cover, $preview] as $path) {
            expectBookCacheImages(!file_exists($path) && !is_link($path), $case . ': old image survived.');
        }
        expectBookCacheImages(!file_exists($status['record']), $case . ': unavailable status survived.');
        expectBookCacheImages(file_get_contents($tool . '/outside/keep') === 'keep'
            && file_get_contents($tool . '/outside/本 #?.webp') === 'keep', $case . ': external target changed.');
        expectBookCacheImages(file_get_contents($source) === 'new source', $case . ': read-only source changed.');
    }
} finally {
    removeReaderBookCacheTree($root);
}

echo "book_cache_images.test.php: OK\n";
