<?php

/** @license AGPL-3.0-only */

function readEpubPreviewXml(string $path): SimpleXMLElement
{
    $source = @file_get_contents($path);
    if ($source === false || stripos($source, '<!ENTITY') !== false) throw new RuntimeException('Cannot read EPUB preview XML or it contains entity declarations.');
    $previous = libxml_use_internal_errors(true);
    try {
        $xml = simplexml_load_string($source, SimpleXMLElement::class, LIBXML_NONET);
        if ($xml === false) throw new RuntimeException('Invalid EPUB preview XML.');
        return $xml;
    } finally {
        libxml_clear_errors();
        libxml_use_internal_errors($previous);
    }
}

function collectEpubPreviewImages(string $root, SimpleXMLElement $package, string $opfDirectory): array
{
    $extensions = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
    $manifest = [];
    $unsupportedImages = false;
    foreach ($package->manifest->item as $item) {
        $href = (string)$item['href'];
        $extension = strtolower(pathinfo((string)(parse_url($href, PHP_URL_PATH) ?? ''), PATHINFO_EXTENSION));
        $manifest[(string)$item['id']] = ['href' => $href, 'extension' => $extension, 'type' => (string)$item['media-type']];
        // 宣言された画像が欠けている場合は、画像なしと記録しないルン。
        if (str_starts_with((string)$item['media-type'], 'image/') || in_array($extension, $extensions, true)) {
            if (resolveEpubFileWithinExtractionRoot($root, $opfDirectory, $href) === false) throw new RuntimeException('EPUB preview image is missing or outside the extraction directory.');
            if (!in_array($extension, $extensions, true)) $unsupportedImages = true;
        }
    }
    $images = [];
    foreach ($package->spine->itemref as $itemref) {
        $item = $manifest[(string)$itemref['idref']] ?? null;
        if ($item === null) throw new RuntimeException('EPUB preview spine reference is missing from the manifest.');
        $path = resolveEpubFileWithinExtractionRoot($root, $opfDirectory, $item['href']);
        if ($path === false) throw new RuntimeException('EPUB preview section is missing or outside the extraction directory.');
        if (in_array($item['extension'], $extensions, true)) {
            $images[] = $path;
        } elseif (in_array($item['extension'], ['svg', 'xhtml', 'html'], true)) {
            $document = readEpubPreviewXml($path);
            $references = $document->xpath('//*[local-name()="img"]/@src | //*[local-name()="image"]/@*[local-name()="href"]') ?: [];
            $base = substr(dirname($path), strlen(realpath($root)) + 1);
            $base = implode('/', array_map('rawurlencode', explode('/', $base)));
            foreach ($references as $reference) {
                $imagePath = resolveEpubFileWithinExtractionRoot($root, $base === '' ? '.' : $base, (string)$reference);
                if ($imagePath === false) throw new RuntimeException('EPUB preview image reference is missing or outside the extraction directory.');
                if (in_array(strtolower(pathinfo($imagePath, PATHINFO_EXTENSION)), $extensions, true)) $images[] = $imagePath;
                else $unsupportedImages = true;
            }
            if ($item['extension'] === 'svg' && empty($references)) $unsupportedImages = true;
        }
        // 最初の12枚が揃った後も、本文の参照は検証するルン。
    }
    if (empty($images)) {
        $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $entry) {
            if (!$entry->isFile() || !in_array(strtolower($entry->getExtension()), $extensions, true)) continue;
            $relative = substr($entry->getPathname(), strlen($root) + 1);
            $relative = implode('/', array_map('rawurlencode', explode('/', $relative)));
            $path = resolveEpubFileWithinExtractionRoot($root, '.', $relative);
            if ($path === false) throw new RuntimeException('EPUB preview image escaped the extraction directory.');
            $images[] = $path;
        }
    }
    if (empty($images) && $unsupportedImages) throw new RuntimeException('EPUB has images but no supported raster images for preview.');
    return array_slice(array_values(array_unique($images)), 0, 12);
}

function writeEpubPreviewMontage(array $images, string $workDirectory, string $destination, string $montage, string $convert, int $quality): void
{
    // 実在する画像だけを4枚ずつ右から左へ並べるルン。
    $ordered = [];
    foreach (array_chunk($images, 4) as $row) array_push($ordered, ...array_reverse($row));
    if (empty($ordered)) throw new RuntimeException('No converted images for EPUB preview montage.');
    $merged = tempnam($workDirectory, 'preview-montage-');
    $temporary = tempnam(dirname($destination), '.preview-');
    try {
        if ($merged === false || $temporary === false) throw new RuntimeException('Cannot create temporary EPUB preview files.');
        $inputs = implode(' ', array_map('escapeshellarg', $ordered));
        $command = "LANG=ja_JP.UTF-8 nice $montage -background '#000000' -geometry +3+3 $inputs -tile 4x3 png:" . escapeshellarg($merged);
        exec($command . ' 2>&1', $output, $status);
        if ($status !== 0 || @getimagesize($merged) === false) throw new RuntimeException('EPUB preview montage failed: ' . implode(' ', $output));
        $command = "$convert " . escapeshellarg($merged) . " -quality $quality -define webp:lossless=false webp:" . escapeshellarg($temporary);
        $output = [];
        exec($command . ' 2>&1', $output, $status);
        $info = @getimagesize($temporary);
        if ($status !== 0 || $info === false || $info['mime'] !== 'image/webp') throw new RuntimeException('EPUB preview WebP conversion failed: ' . implode(' ', $output));
        if (!chmod($temporary, 0644) || !rename($temporary, $destination)) throw new RuntimeException('Cannot publish EPUB preview WebP.');
    } finally {
        foreach ([$merged, $temporary] as $path) if ($path !== false && is_file($path)) unlink($path);
    }
}
