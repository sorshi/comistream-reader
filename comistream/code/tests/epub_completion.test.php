<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/comistream_lib.php';

$database = new PDO('sqlite::memory:');
$database->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$schema = file_get_contents(dirname(__DIR__, 2) . '/rsrc/sql/make-comistream-db-ddl.sql');
$database->exec(substr($schema, 0, strpos($schema, 'CREATE TABLE IF NOT EXISTS reader_markers')));

$insert = $database->prepare(
    'INSERT INTO book_history(user, base_file, max_page, has_read) VALUES (?, ?, ?, ?)'
);
$insert->execute(['reader', 'new.epub', 0, 0]);
$insert->execute(['reader', 'read.epub', 20, 0]);
$insert->execute(['reader', 'comic.zip', 20, 0]);

$readState = static function (PDO $database, string $baseFile): array {
    $statement = $database->prepare(
        'SELECT current_page, max_page, has_read, epub_cfi FROM book_history WHERE user = ? AND base_file = ?'
    );
    $statement->execute(['reader', $baseFile]);
    return $statement->fetch(PDO::FETCH_ASSOC);
};

persistBookReadingProgress($database, 'reader', 'new.epub', 1, 20, 'start-cfi', true, false);
$newBook = $readState($database, 'new.epub');
if ((int)$newBook['has_read'] !== 0 || (int)$newBook['max_page'] !== 20 || $newBook['epub_cfi'] !== 'start-cfi') {
    throw new RuntimeException('Opening an EPUB must save progress without marking it as read.');
}

persistBookReadingProgress($database, 'reader', 'new.epub', 1, null, 'start-cfi', true, false);
if ((int)$readState($database, 'new.epub')['has_read'] !== 0) {
    throw new RuntimeException('An older EPUB save without a completion flag must remain unread.');
}

persistBookReadingProgress($database, 'reader', 'read.epub', 20, 20, 'end-cfi', true, true);
$completedBook = $readState($database, 'read.epub');
if ((int)$completedBook['has_read'] !== 1 || (int)$completedBook['max_page'] !== 0) {
    throw new RuntimeException('An explicit EPUB completion must use the existing read-state representation.');
}

persistBookReadingProgress($database, 'reader', 'read.epub', 2, 20, 'older-cfi', true, false);
$completedBook = $readState($database, 'read.epub');
if ((int)$completedBook['has_read'] !== 1 || (int)$completedBook['max_page'] !== 0) {
    throw new RuntimeException('A stale EPUB progress save must not undo a completed read.');
}

persistBookReadingProgress($database, 'reader', 'comic.zip', 20, null, '', false, false);
if ((int)$readState($database, 'comic.zip')['has_read'] !== 1) {
    throw new RuntimeException('The existing page-count completion rule must remain for other formats.');
}

echo "epub_completion.test.php: OK\n";
