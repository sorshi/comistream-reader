<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/comistream_lib.php';
require_once dirname(__DIR__) . '/i18n.php';

$conf = ['comistream_tool_dir' => dirname(__DIR__, 2), 'epub_reader_package_base' => '/theme/bibi/test/'];
$bookName = $baseFile = $escapedFile = 'Test.epub';
$user = 'guest';
$readerMarkerCsrfToken = '';
$i18n = I18n::getInstance();
foreach (['ja', 'en', 'zh_TW', 'zh_HK'] as $lang) {
    $i18n->setLang($lang);
    $html = generateEpubHTML();
    if (!preg_match('/window\.epubReaderI18n = (.+);/', $html, $matches)) {
        throw new RuntimeException('EPUB translation data is missing.');
    }
    $translations = json_decode($matches[1], true, 512, JSON_THROW_ON_ERROR);
    foreach (['title', 'menu', 'back', 'return'] as $key) {
        $label = $i18n->get('epub_end_' . $key);
        if ($label === 'epub_end_' . $key || !str_contains($html, htmlspecialchars($label, ENT_QUOTES, 'UTF-8'))) {
            throw new RuntimeException("EPUB end navigation translation is missing: $lang / $key");
        }
    }
    if (!str_contains($html, '<dialog id="epub-end-panel" aria-modal="true" aria-labelledby="epub-end-title">')
        || !str_contains($html, 'global.ComistreamEpubEnd = api;')) {
        throw new RuntimeException("EPUB end navigation markup or script is missing: $lang");
    }
    $closeLabel = htmlspecialchars($i18n->get('alt_close_button'), ENT_QUOTES, 'UTF-8');
    if (!str_contains($html, '<dialog id="inspector"')
        || !str_contains($html, 'id="inspector-close" type="button" aria-label="' . $closeLabel . '"')
        || !str_contains($html, 'window.ComistreamInspector =')
        || isset($translations['epub_inspector_title'])) {
        throw new RuntimeException("Inspector markup or translation policy is incorrect: $lang");
    }

    foreach (['epub_page_position', 'epub_section_progress'] as $key) {
        if (!isset($translations[$key]) || $translations[$key] === $key || $translations[$key] !== $i18n->get($key)) {
            throw new RuntimeException("EPUB translation is missing or incorrect: $lang / $key");
        }
    }
}
echo "epub_menu_i18n.test.php: OK\n";
