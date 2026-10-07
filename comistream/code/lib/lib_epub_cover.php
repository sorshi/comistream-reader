<?php

/**
 * 画像を持たないEPUBの定型表紙を作るルン。
 * @license AGPL-3.0-only
 */

function normalizeEpubCoverText(string $text, int $limit): string
{
    // 改行や制御文字は空白へ寄せ、異常に長いメタデータを制限するルン。
    $text = preg_replace('/[\p{Z}\p{Cc}\p{Cf}]+/u', ' ', $text) ?? '';
    return mb_substr(trim($text), 0, $limit, 'UTF-8');
}

function getEpubFallbackCoverMetadata(SimpleXMLElement $package, string $filename): array
{
    $package->registerXPathNamespace('opf', 'http://www.idpf.org/2007/opf');
    $package->registerXPathNamespace('dc', 'http://purl.org/dc/elements/1.1/');
    $title = '';
    foreach ($package->xpath('/opf:package/opf:metadata/dc:title') ?: [] as $value) {
        $title = normalizeEpubCoverText((string)$value, 512);
        if ($title !== '') break;
    }
    if ($title === '') {
        $title = normalizeEpubCoverText(pathinfo(basename($filename), PATHINFO_FILENAME), 512);
    }
    $authors = [];
    foreach ($package->xpath('/opf:package/opf:metadata/dc:creator') ?: [] as $value) {
        $author = normalizeEpubCoverText((string)$value, 128);
        if ($author !== '' && !in_array($author, $authors, true)) $authors[] = $author;
        if (count($authors) === 8) break;
    }
    return ['title' => $title !== '' ? $title : 'EPUB', 'author' => implode(' / ', $authors)];
}

function getEpubCoverDocumentImage(string $root, string $documentPath): ?string
{
    // 文字だけの表紙XHTMLと、壊れた画像参照を区別するルン。
    $previous = libxml_use_internal_errors(true);
    try {
        $source = file_get_contents($documentPath);
        if ($source === false || stripos($source, '<!ENTITY') !== false) {
            throw new RuntimeException('Cannot read EPUB cover document or it contains entity declarations.');
        }
        $document = simplexml_load_string($source, SimpleXMLElement::class, LIBXML_NONET);
        if ($document === false) throw new RuntimeException('Invalid EPUB cover document XML.');
        $references = $document->xpath('//*[local-name()="img"]/@src | //*[local-name()="image"]/@*[local-name()="href"]');
        if (empty($references)) return null;
        $base = substr(dirname($documentPath), strlen(realpath($root)) + 1);
        $image = resolveEpubFileWithinExtractionRoot($root, $base === '' ? '.' : $base, (string)$references[0]);
        if ($image === false) throw new RuntimeException('EPUB cover image is missing or outside the extraction directory.');
        return $image;
    } finally {
        libxml_clear_errors();
        libxml_use_internal_errors($previous);
    }
}

function epubCoverTextWidth(string $text, int $size, string $font): int
{
    $box = imagettfbbox($size, 0, $font, $text);
    if ($box === false) throw new RuntimeException('Cannot measure cover text.');
    return max($box[0], $box[2], $box[4], $box[6]) - min($box[0], $box[2], $box[4], $box[6]);
}

function wrapEpubCoverText(string $text, int $size, string $font, int $width): array
{
    preg_match_all('/\X/u', $text, $matches);
    $lines = [];
    $line = '';
    foreach ($matches[0] as $character) {
        if ($line !== '' && epubCoverTextWidth($line . $character, $size, $font) > $width) {
            // 欧文は可能なら単語の境界で改行するルン。
            $space = mb_strrpos($line, ' ', 0, 'UTF-8');
            if ($space !== false && $space > mb_strlen($line, 'UTF-8') / 2) {
                $lines[] = rtrim(mb_substr($line, 0, $space, 'UTF-8'));
                $line = ltrim(mb_substr($line, $space + 1, null, 'UTF-8'));
            } else {
                $lines[] = rtrim($line);
                $line = '';
            }
        }
        $line .= $line === '' ? ltrim($character) : $character;
    }
    if ($line !== '') $lines[] = rtrim($line);
    return $lines;
}

function layoutEpubCoverText(string $text, string $font, int $maximumSize, int $minimumSize, int $maxLines, int $width): array
{
    if ($text === '') return ['size' => $maximumSize, 'lines' => []];
    // 短い題名は一行に収め、末尾一文字だけの改行を避けるルン。
    $preferredLines = epubCoverTextWidth($text, $minimumSize, $font) <= $width ? 1 : $maxLines;
    for ($size = $maximumSize; $size >= $minimumSize; $size -= 2) {
        $lines = wrapEpubCoverText($text, $size, $font, $width);
        if (count($lines) <= $preferredLines) {
            // 行数を保ったまま行幅を絞り、複数行の長さを揃えるルン。
            $low = 1;
            $high = $width;
            $count = count($lines);
            while ($low < $high) {
                $middle = intdiv($low + $high, 2);
                $candidate = wrapEpubCoverText($text, $size, $font, $middle);
                if (count($candidate) <= $count) $high = $middle;
                else $low = $middle + 1;
            }
            return ['size' => $size, 'lines' => wrapEpubCoverText($text, $size, $font, $high)];
        }
    }
    // 最小サイズでも収まらない書名だけ末尾を省略するルン。
    $lines = array_slice(wrapEpubCoverText($text, $minimumSize, $font, $width), 0, $maxLines);
    $last = array_pop($lines);
    while ($last !== '' && epubCoverTextWidth($last . '…', $minimumSize, $font) > $width) {
        $last = mb_substr($last, 0, -1, 'UTF-8');
    }
    $lines[] = rtrim($last) . '…';
    return ['size' => $minimumSize, 'lines' => $lines];
}

function drawEpubCoverText($image, string $font, string $text, int $size, int $centerX, int $baseline, int $color): void
{
    $box = imagettfbbox($size, 0, $font, $text);
    if ($box === false) throw new RuntimeException('Cannot measure cover text.');
    $left = min($box[0], $box[2], $box[4], $box[6]);
    $right = max($box[0], $box[2], $box[4], $box[6]);
    if (imagettftext($image, $size, 0, (int)round($centerX - ($right + $left) / 2), $baseline, $color, $font, $text) === false) {
        throw new RuntimeException('Cannot render cover text.');
    }
}

function renderEpubFallbackCover(array $metadata, string $font, string $destination): void
{
    if (!function_exists('imagettftext') || !function_exists('imagejpeg')) {
        throw new RuntimeException('EPUB fallback covers require PHP GD with FreeType and JPEG support.');
    }
    if (!is_readable($font)) throw new RuntimeException('EPUB cover font is missing or unreadable.');
    // 文字と罫線を大きく描いてから、一覧の表紙枠の2倍へ縮小するルン。
    $image = imagecreatetruecolor(636, 904);
    if ($image === false) throw new RuntimeException('Cannot allocate cover image.');
    $paper = imagecolorallocate($image, 242, 235, 219);
    $ink = imagecolorallocate($image, 40, 67, 55);
    $muted = imagecolorallocate($image, 118, 116, 90);
    $grain = imagecolorallocate($image, 235, 228, 212);
    imagefill($image, 0, 0, $paper);
    // 紙の粒子は固定配置にして、同じ本の表紙を安定させるルン。
    for ($i = 0; $i < 1400; $i++) {
        $x = ($i * 193 + 17) % 636;
        $y = ($i * 317 + 41) % 904;
        imageline($image, $x, $y, $x + 1, $y, $grain);
    }
    imagefilledrectangle($image, 622, 0, 635, 903, $ink);
    imagesetthickness($image, 2);
    imagerectangle($image, 39, 37, 596, 866, $ink);
    imagesetthickness($image, 1);
    imagerectangle($image, 46, 44, 589, 859, $muted);
    drawEpubCoverText($image, $font, 'COMISTREAM', 13, 318, 112, $ink);
    imageline($image, 281, 132, 355, 132, $muted);

    $title = layoutEpubCoverText($metadata['title'], $font, 48, 26, 4, 480);
    $lineHeight = (int)round($title['size'] * 1.7);
    $baseline = (int)round(355 - (count($title['lines']) - 1) * $lineHeight / 2 + $title['size'] / 2);
    foreach ($title['lines'] as $line) {
        drawEpubCoverText($image, $font, $line, $title['size'], 318, $baseline, $ink);
        $baseline += $lineHeight;
    }
    imageline($image, 288, 563, 348, 563, $muted);
    $author = layoutEpubCoverText($metadata['author'], $font, 24, 18, 3, 456);
    $baseline = 611;
    foreach ($author['lines'] as $line) {
        drawEpubCoverText($image, $font, $line, $author['size'], 318, $baseline, $ink);
        $baseline += (int)round($author['size'] * 1.8);
    }
    // 下部の本の飾りは固定の図形だけで描くルン。
    imagesetthickness($image, 2);
    imageline($image, 318, 742, 318, 773, $ink);
    imageline($image, 294, 738, 318, 745, $ink);
    imageline($image, 318, 745, 342, 738, $ink);
    imageline($image, 294, 738, 294, 766, $ink);
    imageline($image, 342, 738, 342, 766, $ink);
    imageline($image, 294, 766, 318, 773, $ink);
    imageline($image, 318, 773, 342, 766, $ink);
    imagesetthickness($image, 1);
    drawEpubCoverText($image, $font, 'LIBRARY', 12, 318, 813, $muted);
    // 定型表紙はRetina表示に合わせて318×452px、JPEG品質85で保存するルン。
    $thumbnail = imagecreatetruecolor(318, 452);
    if ($thumbnail === false || !imagecopyresampled($thumbnail, $image, 0, 0, 0, 0, 318, 452, 636, 904)) {
        throw new RuntimeException('Cannot resize cover image.');
    }
    // 完成したJPEGだけを公開し、既存ファイルやハードリンクを途中で壊さないルン。
    $temporary = tempnam(dirname($destination), '.epub-cover-');
    if ($temporary === false) throw new RuntimeException('Cannot create temporary cover file.');
    try {
        if (!imagejpeg($thumbnail, $temporary, 85) || !is_file($temporary) || filesize($temporary) === 0) {
            throw new RuntimeException('Cannot write cover JPEG.');
        }
        if (!chmod($temporary, 0644) || !rename($temporary, $destination)) {
            throw new RuntimeException('Cannot publish cover JPEG.');
        }
    } finally {
        if (is_file($temporary)) unlink($temporary);
    }
}
