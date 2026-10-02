<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/comistream_lib.php';
$name = '<img src=x onerror=alert(1)> "日本語"';
$link = renderHistoryLink('/cgi-bin/comistream.php?file=a%20b&mode=open', $name);
$doc = new DOMDocument();
$doc->loadHTML('<?xml encoding="UTF-8">' . $link);
if ($doc->getElementsByTagName('img')->length !== 0
    || $doc->getElementsByTagName('a')->item(0)->textContent !== $name) {
    throw new RuntimeException('History name became markup.');
}
foreach (['javascript:alert(1)', '//external.invalid', '/\\external.invalid', "/a\nb"] as $href) {
    if (!str_contains(renderHistoryLink($href, 'book'), 'href="#"')) throw new RuntimeException('Unsafe history URL accepted.');
}
$legacy = renderLegacyHistory('<a href="/book" onclick="alert(1)">book<img src=x onerror=alert(1)></a><script>alert(1)</script>');
if ($legacy !== '<a class="history_book" href="/book">book</a>') throw new RuntimeException('Legacy history retained active markup.');
echo "history_html.test.php: OK\n";
