<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/comistream_lib.php';
require_once dirname(__DIR__) . '/i18n.php';

$conf = ['comistream_tool_dir' => dirname(__DIR__, 2), 'epub_reader_package_base' => '/theme/bibi/test/'];
$bookName = $baseFile = $escapedFile = 'Test.epub';
$user = 'guest';
$readerMarkerCsrfToken = '';
I18n::getInstance()->setLang('ja');

foreach ([true, false, null, 'true'] as $packetSave) {
    $_SESSION = $packetSave === null ? [] : ['packetSave' => $packetSave];
    $html = generateEpubHTML();
    preg_match('/<head>(.*?)<\/head>/s', $html, $head);
    preg_match('/window\.epubReaderConfig = (.+);/', $html, $config);
    $settings = json_decode($config[1], true, 512, JSON_THROW_ON_ERROR);
    $expected = $packetSave === true;
    if (($settings['packetSave'] ?? null) !== $expected) {
        throw new RuntimeException('EPUB did not receive the resolved session mode.');
    }
    foreach (['fonts.googleapis.com', 'fonts.gstatic.com'] as $domain) {
        if (str_contains($head[1], $domain) === $expected) {
            throw new RuntimeException('Google Fonts head resources do not match the session mode.');
        }
    }
}
echo "epub_packet_save.test.php: OK\n";
