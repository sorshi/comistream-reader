<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/lib/lib_preview_status.php';

$sevenZip = trim((string)shell_exec('command -v 7zz 2>/dev/null'));
$magick = trim((string)shell_exec('command -v magick 2>/dev/null'));
if ($sevenZip === '' || $magick === '' || !class_exists('ZipArchive') || !function_exists('imagepng')) {
    echo "epub_preview_cli.test.php: SKIP (requires 7zz, magick, PHP Zip/GD)\n";
    exit(0);
}

function expectEpubPreview(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

function removeEpubPreviewFixture(string $directory): void
{
    foreach (new FilesystemIterator($directory) as $entry) {
        if ($entry->isDir() && !$entry->isLink()) removeEpubPreviewFixture($entry->getPathname());
        else unlink($entry->getPathname());
    }
    rmdir($directory);
}

function makePreviewEpub(string $path, int $count, string $mode, string $png): void
{
    $archive = new ZipArchive();
    $archive->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE);
    $archive->addFromString('mimetype', 'application/epub+zip');
    $archive->addFromString('META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf"/></rootfiles></container>');
    if ($mode === 'broken-container') $archive->addFromString('META-INF/container.xml', '<container>');
    $manifest = '<item id="body" href="body.xhtml" media-type="application/xhtml+xml"/>';
    $markup = '<p>本文だけの書籍</p>';
    for ($i = 1; $i <= $count; $i++) {
        $manifest .= '<item id="image' . $i . '" href="images/' . $i . '.png" media-type="image/png"/>';
        if ($mode !== 'missing') $archive->addFromString('OPS/images/' . $i . '.png', $mode === 'corrupt' ? 'invalid PNG' : $png);
        $markup .= '<img src="images/' . $i . '.png"/>';
    }
    if ($mode === 'unlisted-missing') $markup .= '<img src="missing.png"/>';
    if ($mode === 'svg-reference') {
        $archive->addFromString('OPS/vector.svg', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
        $markup .= '<img src="vector.svg"/>';
    }
    if ($mode === 'unlisted-percent') $archive->addFromString('OPS/images/art%2F.png', $png);
    $archive->addFromString('OPS/body.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body>' . $markup . '</body></html>');
    $opf = '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata/><manifest>' . $manifest . '</manifest><spine><itemref idref="body"/></spine></package>';
    $archive->addFromString('OPS/package.opf', $mode === 'broken-opf' ? '<package>' : $opf);
    $archive->close();
    chmod($path, 0444);
}

function runPreviewCli(string $tool, string $relative): int
{
    exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg($tool . '/code/make_cover_preview.php')
        . ' --file=' . escapeshellarg($relative) . ' --type=preview 2>&1', $output, $status);
    return $status;
}

$source = dirname(__DIR__);
$root = sys_get_temp_dir() . '/comistream-epub-preview-' . bin2hex(random_bytes(8));
mkdir($root . '/tool/code', 0700, true);
try {
    $tool = $root . '/tool';
    foreach (['data/db', 'data/cache', 'media', 'tmp'] as $directory) mkdir($tool . '/' . $directory, 0700, true);
    foreach (['comistream_lib.php', 'make_cover_preview.php', 'check_preview_status.php'] as $file) copy($source . '/' . $file, $tool . '/code/' . $file);
    foreach (['lib', 'i18n.php'] as $file) symlink($source . '/' . $file, $tool . '/code/' . $file);
    // 実ツールへの呼び出しを記録して、2回目には展開・変換しないことを確かめるルン。
    foreach (['extract' => $sevenZip, 'convert' => $magick, 'montage' => $magick] as $name => $binary) {
        $wrapper = '#!' . PHP_BINARY . "\n<?php\n"
            . 'file_put_contents(__DIR__ . "/calls", ' . var_export($name . "\n", true) . ', FILE_APPEND | LOCK_EX);' . "\n"
            . 'if (is_file(__DIR__ . "/slow") && ' . var_export($name, true) . ' === "extract") usleep(300000);' . "\n"
            . '$process = proc_open(array_merge([' . var_export($binary, true) . '], array_slice($argv, 1)), [STDIN, STDOUT, STDERR], $pipes);' . "\n"
            . 'exit(proc_close($process));';
        file_put_contents($tool . '/' . $name, $wrapper);
        chmod($tool . '/' . $name, 0700);
    }
    $database = new PDO('sqlite:' . $tool . '/data/db/comistream.sqlite');
    $database->exec('CREATE TABLE system_config (key TEXT PRIMARY KEY, value TEXT)');
    $statement = $database->prepare('INSERT INTO system_config VALUES (?, ?)');
    foreach ([
        'comistream_tool_dir' => $tool, 'sharePath' => $tool . '/media', 'publicDir' => '/nas',
        'comistream_tmp_dir_root' => $tool . '/tmp', 'global_resize' => 'x80', 'quality' => '75',
        'p7zip' => escapeshellarg($tool . '/extract'), 'convert' => escapeshellarg($tool . '/convert'),
        'montage' => escapeshellarg($tool . '/montage') . ' montage', 'isLowMemoryMode' => '1', 'mutool' => '',
        'webRoot' => $tool . '/web', 'cover_subDir' => 'batch',
    ] as $key => $value) $statement->execute([$key, $value]);
    $statement = $database = null;
    $image = imagecreatetruecolor(60, 90);
    imagefill($image, 0, 0, imagecolorallocate($image, 210, 25, 40));
    ob_start(); imagepng($image); $png = ob_get_clean();

    $relative = '文字のみ + %2F #&.epub';
    $epub = $tool . '/media/' . $relative;
    makePreviewEpub($epub, 0, 'text', $png);
    $original = hash_file('sha256', $epub);
    expectEpubPreview(runPreviewCli($tool, $relative) === 0, 'Image-free EPUB failed.');
    expectEpubPreview(previewUnavailableMatches($tool, $relative, $epub), 'Image-free result was not saved.');
    expectEpubPreview(file_get_contents($tool . '/calls') === "extract\n", 'Image-free EPUB called image tools.');
    expectEpubPreview(runPreviewCli($tool, $relative) === 0 && file_get_contents($tool . '/calls') === "extract\n", 'Second run extracted the EPUB.');
    expectEpubPreview(hash_file('sha256', $epub) === $original, 'Read-only original changed.');
    chmod($epub, 0644);
    makePreviewEpub($epub, 1, 'image', $png);
    expectEpubPreview(runPreviewCli($tool, $relative) === 0, 'Changed EPUB was not regenerated.');
    expectEpubPreview(!previewUnavailableMatches($tool, $relative, $epub), 'Successful preview kept unavailable status.');

    foreach ([1, 3, 11, 12] as $count) {
        $relative = 'images-' . $count . '.epub';
        makePreviewEpub($tool . '/media/' . $relative, $count, 'image', $png);
        expectEpubPreview(runPreviewCli($tool, $relative) === 0, $count . '-image preview failed.');
        $info = getimagesize($tool . '/data/theme/preview/nas/images-' . $count . '.webp');
        expectEpubPreview($info !== false && $info['mime'] === 'image/webp', $count . '-image output is not WebP.');
    }
    foreach (['svg-reference', 'unlisted-percent'] as $mode) {
        $relative = $mode . '.epub';
        makePreviewEpub($tool . '/media/' . $relative, $mode === 'svg-reference' ? 1 : 0, $mode, $png);
        expectEpubPreview(runPreviewCli($tool, $relative) === 0, $mode . ': valid image preview failed.');
    }
    foreach (['missing', 'corrupt', 'broken-opf', 'broken-container', 'unlisted-missing'] as $mode) {
        $relative = $mode . '.epub';
        $epub = $tool . '/media/' . $relative;
        makePreviewEpub($epub, in_array($mode, ['missing', 'corrupt'], true) ? 1 : 0, $mode, $png);
        expectEpubPreview(runPreviewCli($tool, $relative) !== 0, $mode . ': real failure was hidden.');
        expectEpubPreview(!previewUnavailableMatches($tool, $relative, $epub), $mode . ': real failure was recorded as image-free.');
    }

    $relative = 'concurrent.epub';
    makePreviewEpub($tool . '/media/' . $relative, 0, 'text', $png);
    file_put_contents($tool . '/calls', '');
    file_put_contents($tool . '/slow', '');
    $workers = [];
    for ($i = 0; $i < 2; $i++) $workers[] = proc_open([PHP_BINARY, $tool . '/code/make_cover_preview.php', '--file=' . $relative, '--type=preview'], [0 => ['file', '/dev/null', 'r'], 1 => ['file', '/dev/null', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes);
    foreach ($workers as $worker) expectEpubPreview(proc_close($worker) === 0, 'Concurrent worker failed.');
    expectEpubPreview(file_get_contents($tool . '/calls') === "extract\n", 'Concurrent workers extracted the same image-free EPUB twice.');

    if (trim((string)shell_exec('command -v sqlite3 2>/dev/null')) !== '') {
        copy($source . '/make_image_run.sh', $tool . '/code/make_image_run.sh');
        mkdir($tool . '/media/batch', 0700);
        mkdir($tool . '/data/theme/covers/nas/batch', 0700, true);
        mkdir($tool . '/web/theme', 0700, true);
        symlink($tool . '/data/theme/covers', $tool . '/web/theme/covers');
        symlink($tool . '/data/theme/preview', $tool . '/web/theme/preview');
        $relative = 'batch/book.epub';
        makePreviewEpub($tool . '/media/' . $relative, 0, 'text', $png);
        file_put_contents($tool . '/data/theme/covers/nas/batch/book.jpg', 'existing cover');
        mkdir($tool . '/bin', 0700);
        file_put_contents($tool . '/bin/logger', "#!/bin/sh\nprintf '%s\\n' \"\$*\" >> " . escapeshellarg($tool . '/batch.log') . "\n");
        chmod($tool . '/bin/logger', 0700);
        $generator = $tool . '/code/make_cover_preview.php';
        file_put_contents($generator, str_replace("<?php\n", "<?php\nfile_put_contents(__DIR__ . '/../workers', \"worker\\n\", FILE_APPEND | LOCK_EX);\n", file_get_contents($generator)));
        $command = 'PATH=' . escapeshellarg($tool . '/bin:' . getenv('PATH')) . ' bash ' . escapeshellarg($tool . '/code/make_image_run.sh');
        $callsBefore = file_get_contents($tool . '/calls');
        exec($command . ' 2>&1', $batchOutput, $batchStatus);
        expectEpubPreview($batchStatus === 0 && previewUnavailableMatches($tool, $relative, $tool . '/media/' . $relative), 'Batch did not record image-free result.');
        expectEpubPreview(!str_contains(file_get_contents($tool . '/batch.log'), 'output NG'), 'Batch logged an expected missing WebP as failure.');
        expectEpubPreview(file_get_contents($tool . '/workers') === "worker\n", 'First batch did not start exactly one worker.');
        $batchOutput = [];
        exec($command . ' 2>&1', $batchOutput, $batchStatus);
        expectEpubPreview($batchStatus === 0 && file_get_contents($tool . '/workers') === "worker\n", 'Second batch started a generation worker.');
        expectEpubPreview(file_get_contents($tool . '/calls') === $callsBefore . "extract\n", 'Batch repeated extraction of unchanged EPUB.');
    } else {
        echo "epub_preview_cli.test.php: SKIP batch (sqlite3 unavailable)\n";
    }
} finally {
    removeEpubPreviewFixture($root);
}

echo "epub_preview_cli.test.php: OK\n";
