<?php

/** @license AGPL-3.0-only */
// バッチの事前確認ではDB接続や展開処理を起動しないルン。
if (PHP_SAPI !== 'cli') exit(2);
require_once __DIR__ . '/lib/lib_preview_status.php';
$options = getopt('', ['tool-root:', 'source-root:', 'file:']);
foreach (['tool-root', 'source-root', 'file'] as $required) {
    if (!isset($options[$required]) || !is_string($options[$required])) exit(2);
}
exit(previewUnavailableMatches(
    $options['tool-root'],
    $options['file'],
    rtrim($options['source-root'], '/') . '/' . $options['file']
) ? 0 : 1);
