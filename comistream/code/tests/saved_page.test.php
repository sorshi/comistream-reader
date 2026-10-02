<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/comistream_lib.php';
if (($argv[1] ?? '') === '--invalid-close') {
    $page = '0;alert(1)';
    register_shutdown_function(static function () { echo 'status:' . http_response_code(); });
    saveBookmark();
    throw new RuntimeException('Invalid close reached persistence.');
}

foreach (['0;alert(1)', '1.2', [], null, '-1'] as $invalid) {
    if (readerPageForDisplay($invalid, 10) !== 1) throw new RuntimeException('Unsafe stored page survived.');
}
if (readerPageForDisplay('5', 10) !== 5 || readerPageForDisplay(100, 10) !== 10 || readerPageForDisplay(0, 10) !== 1) {
    throw new RuntimeException('Normal page behavior changed.');
}
$dbh = new PDO('sqlite::memory:');
$dbh->exec('CREATE TABLE book_history (user TEXT, base_file TEXT, current_page INTEGER, favorite INTEGER, max_page INTEGER, updated_at TEXT)');
$dbh->prepare('INSERT INTO book_history VALUES (?, ?, ?, 0, 10, NULL)')->execute(['reader', 'book.zip', '0;alert(1)']);
$user = 'reader'; $openFile = '/fixture/book.zip'; $sharePath = '/fixture'; $global_use_db_flag = 1;
getCurrentPageNumberFromBookmarkfile();
if ($page !== 1) throw new RuntimeException('Stored SQLite text reached reader state.');
$output = shell_exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' --invalid-close');
if ($output !== 'status:400') throw new RuntimeException('Invalid close not rejected before DB access.');

$conf = ['comistream_tool_dir' => dirname(__DIR__, 2), 'siteName' => 'fixture'];
foreach (['cacheDir', 'size', 'degree', 'indexArray', 'position', 'direction', 'autosplit', 'baseFile', 'escapedFile', 'file', 'view_query', 'publicDir', 'pageTitle', 'bookName', 'contents', 'split_button_class', 'split_button_text', 'pagemode_button_class', 'pagemode_button_text'] as $key) $$key = '';
$global_preload_pages = 3; $global_debug_flag = false; $global_preload_delay_ms = 100;
$fileSize = 1; $averagePageBytes = 1; $maxPage = 10; $readerMarkerCsrfToken = '';
$page = '0;alert(1)';
$html = generateHTML();
if (!str_contains($html, 'var page = 1;') || !str_contains($html, 'var prevPage = 1;') || str_contains($html, '0;alert(1)')) {
    throw new RuntimeException('Unsafe page reached generated JavaScript.');
}
echo "saved_page.test.php: OK\n";
