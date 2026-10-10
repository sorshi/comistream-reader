<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/comistream_lib.php';

if (($argv[1] ?? '') === '--hash') {
    echo md5(stream_get_contents(STDIN)) . "\n";
    exit(0);
}

if (in_array($argv[1] ?? '', ['--open', '--cover'], true)) {
    $fixture = json_decode(file_get_contents($argv[2]), true, 512, JSON_THROW_ON_ERROR);
    $conf = $fixture['conf'];
    $sharePath = $fixture['sharePath'];
    $cacheDir = $fixture['cacheDir'];
    $publicDir = $conf['publicDir'];
    $file = urlEncodeFilePath($fixture['relative']);
    $md5cmd = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' --hash';
    $p7zip = $fixture['extractor'];
    $dbh = null;
    $user = 'guest';
    $readerMarkerCsrfToken = '';
    // 呼び出し元の出力先を使い、別のグローバル変数に引きずられないか確認するルン。
    $coverFile = $previewFile = $fixture['sentinel'];
    if ($argv[1] === '--cover') {
        makeCover($file, $fixture['cover'], $fixture['preview']);
        exit(0);
    }
    handleFoliateEpubOpen();
}

function expectEpubCoverOpen(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$root = sys_get_temp_dir() . '/comistream-epub-cover-' . bin2hex(random_bytes(8));
mkdir($root, 0700);
try {
    foreach ([
        ['fresh', false, false, false, '--open', ['covers', 'preview']],
        ['cached', true, false, false, '--open', ['covers', 'preview']],
        ['cover-only', true, false, true, '--open', ['covers']],
        ['preview-only', true, true, false, '--open', ['preview']],
        ['complete', true, true, true, '--open', []],
        ['unavailable', true, true, false, '--open', []],
        ['unavailable-new-cover', true, false, false, '--open', ['covers']],
        ['cbz', true, false, false, '--cover', ['covers', 'preview']],
    ] as [$name, $cached, $hasCover, $hasPreview, $mode, $expectedTypes]) {
        $caseRoot = $root . '/' . $name;
        $tool = $caseRoot . '/tool space+$';
        $share = $caseRoot . '/media';
        $cache = $caseRoot . '/cache';
        $web = $caseRoot . '/web';
        $relative = '棚 空白+%/本 "\'`printf probe` $(printf probe) & #?.' . ($mode === '--cover' ? 'cbz' : 'EPUB');
        $publicPath = '/public/' . $relative;
        $cover = preg_replace('/\.[^.]+$/', '.jpg', $tool . '/data/theme/covers' . $publicPath);
        $preview = preg_replace('/\.[^.]+$/', '.webp', $tool . '/data/theme/preview' . $publicPath);
        foreach ([$tool . '/code', $tool . '/calls', dirname($share . '/' . $relative), $cache, $web . '/theme/bibi', dirname($cover), dirname($preview)] as $directory) {
            mkdir($directory, 0700, true);
        }
        file_put_contents($share . '/' . $relative, 'EPUB fixture');
        if (str_starts_with($name, 'unavailable')) {
            expectEpubCoverOpen(savePreviewUnavailable($tool, $relative, $share . '/' . $relative, previewSourceSignature($share . '/' . $relative)), 'Could not save unavailable fixture.');
        }
        $sentinel = $caseRoot . '/unrelated-existing-image';
        file_put_contents($sentinel, 'unrelated');
        if ($hasCover) file_put_contents($cover, 'existing cover');
        if ($hasPreview) file_put_contents($preview, 'existing preview');
        foreach (array_merge(glob(dirname(__DIR__) . '/*.js'), glob(dirname(__DIR__) . '/*.css')) as $asset) {
            symlink($asset, $tool . '/code/' . basename($asset));
        }
        // 生成コマンドの境界だけ差し替え、実際のオープン処理と非同期起動を検証するルン。
        file_put_contents($tool . '/code/make_cover_preview.php', <<<'PHP'
<?php
$options = getopt('', ['file:', 'type:', 'cache:']);
file_put_contents(dirname(__DIR__) . '/calls/' . $options['type'] . '.json', json_encode($options, JSON_THROW_ON_ERROR));
PHP);
        $extractor = $caseRoot . '/extract';
        file_put_contents($extractor, '#!' . PHP_BINARY . "\n" . <<<'PHP'
<?php
foreach ($argv as $argument) {
    if (str_starts_with($argument, '-o')) {
        $destination = substr($argument, 2);
        mkdir($destination . '/META-INF', 0700, true);
        file_put_contents($destination . '/META-INF/container.xml', '<container/>');
    }
}
PHP);
        chmod($extractor, 0700);
        $hash = md5($relative);
        if ($cached) {
            mkdir($cache . '/' . $hash, 0700);
            file_put_contents($cache . '/' . $hash . '/DONE', '');
            symlink($cache . '/' . $hash, $web . '/theme/bibi/' . $hash);
        }
        $fixturePath = $caseRoot . '/fixture.json';
        file_put_contents($fixturePath, json_encode([
            'conf' => ['comistream_tool_dir' => $tool, 'publicDir' => '/public', 'webRoot' => $web],
            'sharePath' => $share, 'cacheDir' => $cache, 'relative' => $relative,
            'extractor' => $extractor, 'cover' => $cover, 'preview' => $preview, 'sentinel' => $sentinel,
        ], JSON_THROW_ON_ERROR));
        $output = [];
        $status = 0;
        exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' ' . $mode . ' ' . escapeshellarg($fixturePath) . ' 2>&1', $output, $status);
        expectEpubCoverOpen($status === 0, $name . ': worker failed: ' . implode("\n", $output));
        if ($mode === '--open') {
            expectEpubCoverOpen(str_contains(implode("\n", $output), 'window.epubReaderConfig ='), $name . ': reader HTML was not returned.');
            expectEpubCoverOpen(is_file($cache . '/' . $hash . '/DONE'), $name . ': extraction cache was not completed.');
        }
        $deadline = microtime(true) + 3;
        do {
            usleep(20000);
            $calls = glob($tool . '/calls/*.json');
        } while (count($calls) < count($expectedTypes) && microtime(true) < $deadline);
        $actualTypes = array_map(static fn ($path) => basename($path, '.json'), $calls);
        sort($actualTypes);
        sort($expectedTypes);
        expectEpubCoverOpen($actualTypes === $expectedTypes, $name . ': expected generation commands were not launched.');
        foreach ($calls as $call) {
            $options = json_decode(file_get_contents($call), true, 512, JSON_THROW_ON_ERROR);
            expectEpubCoverOpen($options === ['file' => $relative, 'type' => basename($call, '.json'), 'cache' => 'true'], $name . ': generation arguments changed the filename or cache mode.');
        }
        if ($hasCover) expectEpubCoverOpen(file_get_contents($cover) === 'existing cover', $name . ': existing cover changed.');
        if ($hasPreview) expectEpubCoverOpen(file_get_contents($preview) === 'existing preview', $name . ': existing preview changed.');
        expectEpubCoverOpen(file_get_contents($share . '/' . $relative) === 'EPUB fixture', $name . ': media file changed.');
    }
} finally {
    $entries = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($entries as $entry) {
        if ($entry->isLink() || $entry->isFile()) unlink($entry->getPathname());
        else rmdir($entry->getPathname());
    }
    rmdir($root);
}
echo "epub_cover_open.test.php: OK\n";
