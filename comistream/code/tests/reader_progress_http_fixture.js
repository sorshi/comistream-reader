const path = require('node:path');
const library = JSON.stringify(path.resolve(__dirname, '../comistream_lib.php'));
const router = `<?php
require ${library};
$sharePath = __DIR__ . '/books'; $cacheDir = __DIR__ . '/cache';
@mkdir($sharePath); @mkdir($cacheDir); @mkdir($cacheDir . '/fixture');
file_put_contents($sharePath . '/book.cbz', 'fixture');
file_put_contents($cacheDir . '/fixture/index', implode("\\n", array_fill(0, 30, 'page.jpg')) . "\\n");
$dbh = new PDO('sqlite:' . __DIR__ . '/test.sqlite');
$dbh->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$dbh->exec('CREATE TABLE IF NOT EXISTS book_history (id INTEGER PRIMARY KEY, user TEXT, base_file TEXT, path_hash TEXT, current_page INTEGER, max_page INTEGER, has_read INTEGER, epub_cfi TEXT, UNIQUE(user,base_file))');
$dbh->exec("INSERT OR IGNORE INTO book_history VALUES (1,'reader','book.cbz','fixture',3,30,0,NULL)");
if (!is_link($sharePath . '/alias.cbz')) symlink($sharePath . '/book.cbz', $sharePath . '/alias.cbz');
$dbh->exec("INSERT OR IGNORE INTO book_history VALUES (2,'reader','alias.cbz','fixture',5,30,0,NULL)");
$user = $_SERVER['HTTP_X_TEST_USER'] ?? 'reader';
$_SESSION['reader_marker_csrf'] = 'fixture-token';
$input = $_SERVER['REQUEST_METHOD'] === 'POST' ? $_POST : $_GET;
$mode = $input['mode'] ?? '';
if ($mode === 'testRead') {
    updateReaderProgressPolicy($dbh, 'reader', [1], true);
    readerProgressJson(['ok'=>true]);
}
if ($mode === 'legacy') {
    try { persistBookReadingProgress($dbh, 'reader', 'book.cbz', 1, null, '', false, false); }
    catch (ReaderProgressException $e) { http_response_code($e->status); }
    exit;
}
handleReaderProgressApi($mode, $input);
`;
module.exports = { router };
