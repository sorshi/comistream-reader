<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/comistream_lib.php';
require_once dirname(__DIR__) . '/lib/lib_epub_cover.php';

function expectFallbackCover(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$package = new SimpleXMLElement('<package xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/">'
    . '<dc:title> 吾輩は猫である </dc:title><dc:creator>夏目漱石</dc:creator><dc:creator>夏目漱石</dc:creator>'
    . '<dc:creator>共同著者</dc:creator></metadata></package>');
expectFallbackCover(getEpubFallbackCoverMetadata($package, 'wrong.epub') === [
    'title' => '吾輩は猫である', 'author' => '夏目漱石 / 共同著者',
], 'OPF title and unique authors were not used.');
$empty = new SimpleXMLElement('<p:package xmlns:p="http://www.idpf.org/2007/opf"><p:metadata/></p:package>');
expectFallbackCover(getEpubFallbackCoverMetadata($empty, '棚/書名 + 100%.epub') === [
    'title' => '書名 + 100%', 'author' => '',
], 'Filename fallback or missing author changed.');
expectFallbackCover(normalizeEpubCoverText(" A\nB\tC\u{202e}D ", 5) === 'A B C', 'Control characters or text limit failed.');

$root = sys_get_temp_dir() . '/comistream-fallback-cover-' . bin2hex(random_bytes(8));
mkdir($root . '/OPS/text', 0700, true);
mkdir($root . '/OPS/images', 0700);
$root = realpath($root);
$document = $root . '/OPS/text/cover.xhtml';
file_put_contents($root . '/OPS/images/cover art.png', 'existing image');
try {
    file_put_contents($document, '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>文字だけの表紙</h1></body></html>');
    expectFallbackCover(getEpubCoverDocumentImage($root, $document) === null, 'Text-only XHTML was treated as an image.');
    foreach ([
        '<img src="../images/cover%20art.png"/>',
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><image xlink:href="../images/cover%20art.png"/></svg>',
    ] as $markup) {
        file_put_contents($document, '<html xmlns="http://www.w3.org/1999/xhtml"><body>' . $markup . '</body></html>');
        expectFallbackCover(getEpubCoverDocumentImage($root, $document) === $root . '/OPS/images/cover art.png', 'Existing XHTML image was not preserved.');
    }
    foreach (['../missing.png', '../../../outside.png', 'https://example.test/cover.png'] as $reference) {
        file_put_contents($document, '<html><img src="' . $reference . '"/></html>');
        $rejected = false;
        try { getEpubCoverDocumentImage($root, $document); } catch (RuntimeException $error) { $rejected = true; }
        expectFallbackCover($rejected, 'Broken or external image reference was treated as a text-only cover.');
    }
    foreach (['<html>', '<!DOCTYPE html [<!ENTITY title SYSTEM "file:///etc/passwd">]><html>&title;</html>'] as $source) {
        file_put_contents($document, $source);
        $rejected = false;
        try { getEpubCoverDocumentImage($root, $document); } catch (RuntimeException $error) { $rejected = true; }
        expectFallbackCover($rejected, 'Malformed or entity-bearing XML was accepted.');
    }

    if (function_exists('imagettftext') && function_exists('imagejpeg')) {
        $font = dirname(__DIR__, 2) . '/rsrc/fonts/shippori-mincho/ShipporiMincho-Regular.ttf';
        $short = layoutEpubCoverText('吾輩は猫である', $font, 48, 26, 4, 480);
        expectFallbackCover(count($short['lines']) === 1, 'Short title has an orphaned last character.');
        foreach (['非常に長い書名' . str_repeat('続編と補遺', 70), str_repeat('Long English title with words ', 12), '@%[fx:1+2] <&> "quoted" \\ literal'] as $text) {
            $layout = layoutEpubCoverText($text, $font, 48, 26, 4, 480);
            expectFallbackCover(count($layout['lines']) <= 4 && $layout['size'] >= 26, 'Long title overflows its block.');
            foreach ($layout['lines'] as $line) expectFallbackCover(epubCoverTextWidth($line, $layout['size'], $font) <= 480, 'Title overflows its width.');
        }
        $target = $root . '/cover.jpg';
        renderEpubFallbackCover(['title' => '吾輩は猫である', 'author' => '夏目漱石'], $font, $target);
        $info = getimagesize($target);
        expectFallbackCover($info[0] === 318 && $info[1] === 452 && $info['mime'] === 'image/jpeg', 'Output is not a 318x452 JPEG.');
        expectFallbackCover($info[0] * 226 === $info[1] * 159, 'Directory cover view would crop the generated cover.');
        $rendered = imagecreatefromjpeg($target);
        $left = imagecolorsforindex($rendered, imagecolorat($rendered, 2, 200));
        $right = imagecolorsforindex($rendered, imagecolorat($rendered, 315, 200));
        expectFallbackCover($left['red'] > 220 && $left['green'] > 220 && $right['red'] < 80 && $right['green'] < 100,
            'Binding band is not on the right edge.');
        $first = hash_file('sha256', $target);
        renderEpubFallbackCover(['title' => '吾輩は猫である', 'author' => '夏目漱石'], $font, $target);
        expectFallbackCover(hash_file('sha256', $target) === $first, 'Cover generation is not deterministic.');
        $rejected = false;
        try { renderEpubFallbackCover(['title' => 'test', 'author' => ''], $root . '/missing.ttf', $target); }
        catch (RuntimeException $error) { $rejected = true; }
        expectFallbackCover($rejected && hash_file('sha256', $target) === $first, 'Missing font damaged an existing cover.');
        expectFallbackCover(glob($root . '/.epub-cover-*') === [], 'Temporary cover files remain.');
    } else {
        echo "epub_fallback_cover.test.php: SKIP rendering (PHP GD with FreeType/JPEG unavailable)\n";
    }
} finally {
    if (is_file($root . '/cover.jpg')) unlink($root . '/cover.jpg');
    unlink($document);
    unlink($root . '/OPS/images/cover art.png');
    rmdir($root . '/OPS/text');
    rmdir($root . '/OPS/images');
    rmdir($root . '/OPS');
    rmdir($root);
}

echo "epub_fallback_cover.test.php: OK\n";
