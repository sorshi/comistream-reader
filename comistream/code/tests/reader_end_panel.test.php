<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/comistream_lib.php';
require_once dirname(__DIR__) . '/i18n.php';

function readerEndPanelFixture(string $lang, string $title): array
{
    global $conf, $cacheDir, $size, $degree, $indexArray, $position, $direction, $autosplit,
        $baseFile, $escapedFile, $file, $view_query, $publicDir, $pageTitle, $bookName, $contents,
        $split_button_class, $split_button_text, $pagemode_button_class, $pagemode_button_text,
        $global_preload_pages, $global_debug_flag, $global_preload_delay_ms, $fileSize, $averagePageBytes,
        $maxPage, $page, $readerMarkerCsrfToken, $user;
    $conf = ['comistream_tool_dir' => dirname(__DIR__, 2), 'siteName' => 'fixture',
        'epub_reader_package_base' => '/theme/bibi/test/'];
    foreach (['size', 'degree', 'indexArray', 'position', 'direction', 'autosplit', 'escapedFile', 'file',
        'view_query', 'publicDir', 'contents', 'split_button_class', 'split_button_text',
        'pagemode_button_class', 'pagemode_button_text'] as $name) $$name = '';
    $cacheDir = sys_get_temp_dir() . '/comistream-end-panel-no-cache';
    $user = 'guest';
    $global_preload_pages = 3; $global_debug_flag = false; $global_preload_delay_ms = 100;
    $fileSize = 1; $averagePageBytes = 1; $maxPage = 10; $page = 10; $readerMarkerCsrfToken = '';
    $baseFile = $title;
    $bookName = $pageTitle = htmlspecialchars($title, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    I18n::getInstance()->setLang($lang);
    $panels = [];
    foreach (['cbz' => ['suggest', generateHTML()], 'epub' => ['epub-end-panel', generateEpubHTML()]] as $format => [$id, $html]) {
        $startLabel = I18n::getInstance()->get('reader_start_confirm');
        if ($startLabel === 'reader_start_confirm'
            || !str_contains($html, '"reader_start_confirm":' . json_encode($startLabel, JSON_UNESCAPED_UNICODE))) {
            throw new RuntimeException("First-page confirmation translation missing: $format / $lang");
        }
        if (!preg_match('~<dialog id="' . $id . '".*?</dialog>~s', $html, $match)) {
            throw new RuntimeException("End dialog missing: $format / $lang");
        }
        $panels[$format] = $match[0];
    }
    return $panels;
}

if (($argv[1] ?? '') === '--fixture-json') {
    echo json_encode(readerEndPanelFixture('ja', 'Book.cbz'), JSON_THROW_ON_ERROR);
    exit;
}

foreach (['ja', 'en', 'zh_TW', 'zh_HK'] as $lang) {
    $title = 'Book <img src=x onerror=alert(1)> & "quoted".cbz';
    $panels = readerEndPanelFixture($lang, $title);
    foreach ($panels as $format => $panel) {
        foreach (['reader-end-panel', 'reader-end-actions', 'reader-end-books', 'reader-end-book-title', 'aria-modal="true"'] as $attribute) {
            if (!str_contains($panel, $attribute)) throw new RuntimeException("Shared end panel markup missing: $format / $lang / $attribute");
        }
        foreach (['title', 'back', 'return'] as $key) {
            $label = I18n::getInstance()->get('epub_end_' . $key);
            if ($label === 'epub_end_' . $key || !str_contains($panel, htmlspecialchars($label, ENT_QUOTES, 'UTF-8'))) {
                throw new RuntimeException("End panel translation missing: $format / $lang / $key");
            }
        }
    }
    if (!str_contains($panels['cbz'], htmlspecialchars($title, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'))
        || str_contains($panels['cbz'], '<img src=x')) {
        throw new RuntimeException('CBZ title became active markup.');
    }
}
echo "reader_end_panel.test.php: OK\n";
