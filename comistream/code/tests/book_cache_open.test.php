<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/comistream_lib.php';

if (($argv[1] ?? '') === '--hash') {
    echo md5(stream_get_contents(STDIN)) . "\n";
    exit(0);
}
if (($argv[1] ?? '') === '--open') {
    $fixture = json_decode(file_get_contents($argv[2]), true, 512, JSON_THROW_ON_ERROR);
    $conf = $fixture['conf'];
    $sharePath = $fixture['share'];
    $cacheDir = $conf['cacheDir'];
    $tempDir = $fixture['root'] . '/tmp';
    $publicDir = '/nas';
    // PHPがクエリを一度復号した、実際のリクエストと同じ値を渡すルン。
    $file = $fixture['relative'];
    $md5cmd = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' --hash';
    $p7zip = $fixture['root'] . '/bin/extract';
    $cpdf = $fixture['root'] . '/bin/cpdf';
    $unzip = '/unused';
    $dbh = null;
    $user = 'guest';
    $readerMarkerCsrfToken = '';
    $page = '1';
    $view = '';
    $cacheSize = 0;
    $isPreCache = true;
    $async = '';
    $traceFile = '/dev/null';
    putenv('PATH=' . $fixture['root'] . '/bin:' . getenv('PATH'));
    if (str_ends_with($fixture['relative'], '.epub')) handleFoliateEpubOpen();
    [$escapedFile, $coverFile, $previewFile] = openPage();
    makeCover($escapedFile, $coverFile, $previewFile);
    echo json_encode(['pages' => $maxPage, 'generation' => $conf['reader_cache_generation']], JSON_THROW_ON_ERROR);
    exit(0);
}

function expectBookCacheOpen(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$root = sys_get_temp_dir() . '/comistream-book-open-' . bin2hex(random_bytes(8));
mkdir($root, 0700);
$root = realpath($root);
try {
    $tool = $root . '/tool';
    $cache = $tool . '/data/cache';
    $share = $root . '/media';
    foreach ([$root . '/bin', $tool . '/code', $tool . '/calls', $cache, $share . '/棚 + %', $root . '/web/theme/bibi'] as $directory) mkdir($directory, 0700, true);
    foreach (array_merge(glob(dirname(__DIR__) . '/*.js'), glob(dirname(__DIR__) . '/*.css')) as $asset) {
        symlink($asset, $tool . '/code/' . basename($asset));
    }
    // 画像変換の境界で原本と世代を確認し、旧画像を削除してから起動したか検証するルン。
    $imageWorker = <<<'PHP'
$options = getopt('', ['file:', 'type:', 'cache:', 'generation:']);
$tool = dirname(__DIR__);
$source = dirname($tool) . '/media/' . $options['file'];
$id = md5(str_ends_with($source, '.epub') ? $options['file'] : $source . "\n");
acquireReaderBookCacheLock($tool . '/data/cache', $id);
$record = readReaderBookCacheRecord($tool . '/data/cache/' . $id);
if ($record === null || $record['generation'] !== $options['generation']
    || $record['source'] !== readerBookSourceSignature($source)) exit(1);
$extension = $options['type'] === 'covers' ? '.jpg' : '.webp';
$target = $tool . '/data/theme/' . $options['type'] . '/nas/' . preg_replace('/\.[^.]+$/', $extension, $options['file']);
if (file_exists($target) || is_link($target)) exit(1);
if (!is_dir(dirname($target))) mkdir(dirname($target), 0700, true);
$book = json_decode(file_get_contents($source), true, 512, JSON_THROW_ON_ERROR);
file_put_contents($target, $book['content']);
file_put_contents($tool . '/calls/' . $id . '-' . $options['type'] . '.json', json_encode($options, JSON_THROW_ON_ERROR));
PHP;
    file_put_contents($tool . '/code/make_cover_preview.php', "<?php\nrequire "
        . var_export(dirname(__DIR__) . '/lib/lib_book_cache.php', true) . ";\n" . $imageWorker);
    // 外部変換コマンドだけを代役にし、PHPの実際のオープン経路を通すルン。
    $extractor = <<<'PHP'
<?php
$source = '';
$destination = '';
foreach (array_slice($argv, 1) as $arg) {
    if (str_starts_with($arg, '-o')) $destination = substr($arg, 2);
    elseif (is_file($arg)) $source = $arg;
}
$book = json_decode(file_get_contents($source), true, 512, JSON_THROW_ON_ERROR);
if ($argv[1] === 'l') {
    for ($i = 1; $i <= $book['pages']; $i++) echo "Path = page$i.jpg\nFolder = -\nSize = 20\n\n";
} else {
    if (str_ends_with($source, '.epub')) {
        mkdir($destination . '/META-INF', 0700, true);
        file_put_contents($destination . '/META-INF/container.xml', '<container/>');
        file_put_contents($destination . '/chapter.xhtml', $book['content']);
    } else {
        for ($i = 1; $i <= $book['pages']; $i++) file_put_contents($destination . "/page$i.jpg", $book['content']);
    }
}
PHP;
    $pdfTool = <<<'PHP'
<?php
$source = '';
foreach (array_slice($argv, 1) as $arg) if (is_file($arg)) $source = $arg;
$book = json_decode(file_get_contents($source), true, 512, JSON_THROW_ON_ERROR);
if (basename($argv[0]) === 'pdftotext') echo 'Text document ' . $book['content'];
elseif (basename($argv[0]) === 'pdfinfo') echo 'Pages: ' . $book['pages'] . "\n";
elseif (in_array('-pages', $argv, true)) echo $book['pages'];
elseif (in_array('-list-bookmarks', $argv, true)) echo '0 "' . $book['content'] . '" 1' . "\n";
elseif (in_array('-extract-images', $argv, true)) {
    for ($i = 1; $i <= $book['pages']; $i++) file_put_contents("p{$i}_.jpg", $book['content']);
}
PHP;
    foreach (['extract' => $extractor, 'pdftotext' => $pdfTool, 'pdfinfo' => $pdfTool, 'cpdf' => $pdfTool] as $name => $body) {
        file_put_contents($root . '/bin/' . $name, '#!' . PHP_BINARY . "\n" . $body);
        chmod($root . '/bin/' . $name, 0700);
    }
    foreach (['epub', 'cbz', 'pdf'] as $extension) {
        $relative = '棚 + %/同名差し替え.' . $extension;
        $source = $share . '/' . $relative;
        $id = md5($extension === 'epub' ? $relative : $source . "\n");
        $directory = $cache . '/' . $id;
        $cover = $tool . '/data/theme/covers/nas/' . preg_replace('/\.[^.]+$/', '.jpg', $relative);
        $preview = $tool . '/data/theme/preview/nas/' . preg_replace('/\.[^.]+$/', '.webp', $relative);
        foreach ([$cover, $preview] as $path) {
            if (!is_dir(dirname($path))) mkdir(dirname($path), 0700, true);
            file_put_contents($path, 'existing image');
        }
        file_put_contents($source, json_encode(['pages' => 2, 'content' => 'OLD CONTENT'], JSON_THROW_ON_ERROR));
        $fixture = ['root' => $root, 'share' => $share, 'relative' => $relative, 'conf' => [
            'comistream_tool_dir' => $tool, 'comistream_tmp_dir_root' => $root . '/tmp', 'cacheDir' => $cache,
            'webRoot' => $root . '/web', 'publicDir' => '/nas', 'pdfinfo' => $root . '/bin/pdfinfo',
        ]];
        $fixturePath = $root . '/fixture.json';
        file_put_contents($fixturePath, json_encode($fixture, JSON_THROW_ON_ERROR));
        $open = static function () use ($fixturePath, $extension): string {
            $output = [];
            exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' --open ' . escapeshellarg($fixturePath) . ' 2>&1', $output, $status);
            expectBookCacheOpen($status === 0, $extension . ': opening failed: ' . implode("\n", $output));
            return implode("\n", $output);
        };
        $waitImages = static function (string $content, string $generation) use ($cover, $preview, $tool, $id, $extension): void {
            $deadline = microtime(true) + 5;
            do {
                clearstatcache();
                $ready = true;
                foreach (['covers' => $cover, 'preview' => $preview] as $type => $path) {
                    $call = $tool . '/calls/' . $id . '-' . $type . '.json';
                    $options = is_file($call) ? json_decode(file_get_contents($call), true) : null;
                    $ready = $ready && is_file($path) && file_get_contents($path) === $content
                        && ($options['generation'] ?? null) === $generation;
                }
                if ($ready) return;
                usleep(20000);
            } while (microtime(true) < $deadline);
            throw new RuntimeException($extension . ': cover and preview were not regenerated from the current source: '
                . json_encode(['cover' => @file_get_contents($cover), 'preview' => @file_get_contents($preview),
                    'calls' => glob($tool . '/calls/' . $id . '-*.json')], JSON_THROW_ON_ERROR));
        };
        $open();
        $first = readReaderBookCacheRecord($directory);
        expectBookCacheOpen($first !== null, $extension . ': source record missing.');
        $pageFile = $directory . '/' . match ($extension) { 'epub' => 'chapter.xhtml', 'cbz' => 'page1.jpg', 'pdf' => 'p1_.jpg' };
        expectBookCacheOpen(file_get_contents($pageFile) === 'OLD CONTENT', $extension . ': initial content missing.');
        file_put_contents($directory . '/preserve-until-change', 'keep');
        $open();
        expectBookCacheOpen(readReaderBookCacheRecord($directory) === $first && is_file($directory . '/preserve-until-change'), $extension . ': unchanged cache was rebuilt.');
        expectBookCacheOpen(file_get_contents($cover) === 'existing image' && file_get_contents($preview) === 'existing image', $extension . ': unchanged images were replaced.');

        file_put_contents($source, json_encode(['pages' => 3, 'content' => 'NEW CONTENT'], JSON_THROW_ON_ERROR));
        touch($source, $first['source']['mtime'] + 10);
        $open();
        $updated = readReaderBookCacheRecord($directory);
        expectBookCacheOpen($updated !== null && $updated['generation'] !== $first['generation'], $extension . ': changed source was reused.');
        expectBookCacheOpen(!file_exists($directory . '/preserve-until-change') && file_get_contents($pageFile) === 'NEW CONTENT', $extension . ': old content survived.');
        if ($extension !== 'epub') expectBookCacheOpen(count(file($directory . '/index')) === 3, $extension . ': page count stayed stale.');
        if ($extension === 'pdf') {
            expectBookCacheOpen(str_contains(file_get_contents($directory . '/toc.json'), 'NEW CONTENT'), 'PDF TOC stayed stale.');
            expectBookCacheOpen(is_file($directory . '/TEXT_PDF') && is_file($directory . '/DONE'), 'PDF classification was not rebuilt.');
        }
        $html = $open();
        if ($extension === 'epub') expectBookCacheOpen(str_contains($html, '"cacheGeneration":"' . $updated['generation'] . '"'), 'EPUB did not receive current generation.');
        $waitImages('NEW CONTENT', $updated['generation']);

        // サイズとmtimeが同じrename置換でも、旧画像と生成不可判定を残さないルン。
        if ($extension === 'epub') {
            unlink($preview);
            expectBookCacheOpen(savePreviewUnavailable($tool, $relative, $source, previewSourceSignature($source)), 'Could not save unavailable preview.');
        }
        $replacement = $root . '/replacement';
        file_put_contents($replacement, json_encode(['pages' => 3, 'content' => 'ALT CONTENT'], JSON_THROW_ON_ERROR));
        touch($replacement, $updated['source']['mtime']);
        rename($replacement, $source);
        chmod($source, 0444);
        $open();
        if ($extension === 'pdf') $open();
        $replaced = readReaderBookCacheRecord($directory);
        expectBookCacheOpen($replaced['generation'] !== $updated['generation'], $extension . ': inode replacement was reused.');
        $waitImages('ALT CONTENT', $replaced['generation']);
        if ($extension === 'epub') {
            expectBookCacheOpen(!is_file(previewStatusPaths($tool, $relative)['record']), 'Replacement kept the unavailable preview record.');
        }
        $open();
        $waitImages('ALT CONTENT', $replaced['generation']);

        // 属性記録のない旧キャッシュも、一度だけ作り直すルン。
        unlink($directory . '/_comistream-reader-source.json');
        file_put_contents($pageFile, 'LEGACY CONTENT');
        $open();
        expectBookCacheOpen(file_get_contents($pageFile) === 'ALT CONTENT', $extension . ': legacy cache survived.');
        expectBookCacheOpen(file_get_contents($source) === json_encode(['pages' => 3, 'content' => 'ALT CONTENT']), $extension . ': source was modified.');
    }
} finally {
    removeReaderBookCacheTree($root);
}
echo "book_cache_open.test.php: OK\n";
