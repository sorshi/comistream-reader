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
    foreach (['epub_page_position', 'epub_section_progress'] as $key) {
        if (!isset($translations[$key]) || $translations[$key] === $key || $translations[$key] !== $i18n->get($key)) {
            throw new RuntimeException("EPUB translation is missing or incorrect: $lang / $key");
        }
    }
}
echo "epub_menu_i18n.test.php: OK\n";
