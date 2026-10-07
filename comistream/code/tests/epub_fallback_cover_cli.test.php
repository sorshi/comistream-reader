<?php

declare(strict_types=1);

// 実際のCLIを一時DBと小さなEPUBで動かし、原本を変更しないことも確かめるルン。
$sevenZip = trim((string)shell_exec('command -v 7zz 2>/dev/null'));
$magick = trim((string)shell_exec('command -v magick 2>/dev/null'));
if ($sevenZip === '' || $magick === '' || !class_exists('ZipArchive') || !function_exists('imagettftext')) {
    echo "epub_fallback_cover_cli.test.php: SKIP (requires 7zz, magick, PHP Zip/GD)\n";
    exit(0);
}

function expectFallbackCli(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

function removeFallbackFixture(string $directory): void
{
    foreach (new FilesystemIterator($directory) as $entry) {
        if ($entry->isDir() && !$entry->isLink()) removeFallbackFixture($entry->getPathname());
        else unlink($entry->getPathname());
    }
    rmdir($directory);
}

$source = dirname(__DIR__);
$root = sys_get_temp_dir() . '/comistream-fallback-cli-' . bin2hex(random_bytes(8));
mkdir($root . '/tool/code', 0700, true);
try {
    $tool = $root . '/tool';
    foreach (['data/db', 'data/cache', 'rsrc', 'tmp', 'media'] as $path) mkdir($tool . '/' . $path, 0700, true);
    foreach (['comistream_lib.php', 'make_cover_preview.php'] as $file) copy($source . '/' . $file, $tool . '/code/' . $file);
    foreach (['lib', 'i18n.php'] as $file) symlink($source . '/' . $file, $tool . '/code/' . $file);
    symlink(dirname($source) . '/rsrc/fonts', $tool . '/rsrc/fonts');
    $database = new PDO('sqlite:' . $tool . '/data/db/comistream.sqlite');
    $database->exec('CREATE TABLE system_config (key TEXT PRIMARY KEY, value TEXT)');
    $statement = $database->prepare('INSERT INTO system_config VALUES (?, ?)');
    foreach ([
        'comistream_tool_dir' => $tool, 'sharePath' => $tool . '/media', 'publicDir' => '/nas',
        'comistream_tmp_dir_root' => $tool . '/tmp', 'global_resize' => 'x400',
        'convert' => escapeshellarg($magick), 'p7zip' => escapeshellarg($sevenZip),
        'isLowMemoryMode' => '1', 'mutool' => '', 'isDebugMode' => '0',
    ] as $key => $value) $statement->execute([$key, $value]);
    $statement = $database = null;

    $art = imagecreatetruecolor(60, 90);
    imagefill($art, 0, 0, imagecolorallocate($art, 210, 25, 40));
    ob_start();
    imagepng($art);
    $png = ob_get_clean();
    $savedCover = null;
    foreach (['text', 'text-xhtml', 'image', 'xhtml-image', 'missing-image', 'no-gd'] as $case) {
        $name = $case . ' 本 + 100% & quote\'.epub';
        $epub = $tool . '/media/' . $name;
        $archive = new ZipArchive();
        $archive->open($epub, ZipArchive::CREATE);
        $archive->addFromString('mimetype', 'application/epub+zip');
        $archive->addFromString('META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
        $manifest = '<item id="body" href="text/body.xhtml" media-type="application/xhtml+xml"/>';
        if ($case === 'image') {
            $manifest .= '<item id="cover" href="images/art.png" media-type="image/png" properties="cover-image"/>';
            $archive->addFromString('OPS/images/art.png', $png);
        } elseif (in_array($case, ['text-xhtml', 'xhtml-image', 'missing-image'], true)) {
            $manifest .= '<item id="cover" href="text/cover.xhtml" media-type="application/xhtml+xml"/>';
            $markup = $case === 'text-xhtml' ? '<h1>文字だけの表紙</h1>' : '<img src="../images/art.png"/>';
            $archive->addFromString('OPS/text/cover.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body>' . $markup . '</body></html>');
            if ($case === 'xhtml-image') $archive->addFromString('OPS/images/art.png', $png);
        }
        $archive->addFromString('OPS/package.opf', '<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>吾輩は猫である</dc:title><dc:creator>夏目漱石</dc:creator></metadata><manifest>' . $manifest . '</manifest><spine><itemref idref="body"/></spine></package>');
        $archive->addFromString('OPS/text/body.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>吾輩は猫である。</p></body></html>');
        $archive->close();
        chmod($epub, 0444);
        $before = hash_file('sha256', $epub);
        $output = [];
        $status = 0;
        exec(escapeshellarg(PHP_BINARY) . ($case === 'no-gd' ? ' -d disable_functions=imagettftext' : '')
            . ' ' . escapeshellarg($tool . '/code/make_cover_preview.php') . ' --file=' . escapeshellarg($name)
            . ' --type=covers' . ($case === 'text-xhtml' ? ' --cache=true' : '') . ' 2>&1', $output, $status);
        $target = $tool . '/data/theme/covers/nas/' . pathinfo($name, PATHINFO_FILENAME) . '.jpg';
        expectFallbackCli(hash_file('sha256', $epub) === $before, $case . ': original EPUB changed.');
        expectFallbackCli(glob($tool . '/data/theme/preview/nas/*') === [], $case . ': preview was generated during cover processing.');
        if (in_array($case, ['missing-image', 'no-gd'], true)) {
            expectFallbackCli($status !== 0 && !file_exists($target), $case . ': failure was reported as a successful cover.');
            continue;
        }
        expectFallbackCli($status === 0 && is_file($target), $case . ': CLI failed: ' . implode("\n", $output));
        $info = getimagesize($target);
        expectFallbackCli($info['mime'] === 'image/jpeg', $case . ': output is not JPEG.');
        if (in_array($case, ['image', 'xhtml-image'], true)) {
            $image = imagecreatefromjpeg($target);
            $pixel = imagecolorsforindex($image, imagecolorat($image, 5, 5));
            expectFallbackCli($pixel['red'] > 190 && $pixel['green'] < 40, $case . ': original cover was replaced by a template.');
        } else {
            expectFallbackCli($info[0] === 318 && $info[1] === 452, $case . ': wrong fallback dimensions.');
            $hash = hash_file('sha256', $target);
            if ($savedCover !== null) expectFallbackCli($hash === $savedCover, 'Text-only XHTML and image-free EPUB generated different covers.');
            $savedCover = $hash;
        }
    }
} finally {
    removeFallbackFixture($root);
}

echo "epub_fallback_cover_cli.test.php: OK\n";
