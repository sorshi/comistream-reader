<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/comistream_lib.php';

$database = new PDO('sqlite::memory:');
$database->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$schema = file_get_contents(dirname(__DIR__, 2) . '/rsrc/sql/make-comistream-db-ddl.sql');
$database->exec(substr($schema, 0, strpos($schema, 'CREATE TABLE IF NOT EXISTS reader_markers')));
$insert = $database->prepare('INSERT INTO book_history(user, base_file, epub_cfi, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
$insert->execute(['reader', 'book.epub', 'server-cfi', '2026-10-02 07:09:26', '2026-10-02 14:19:05']);
$insert->execute(['other', 'book.epub', 'other-user-cfi', '2026-10-02 07:09:26', '2026-10-02 14:23:04']);
$insert->execute(['reader', 'created.epub', 'created-cfi', '2026-10-02 14:19:05', null]);
$insert->execute(['reader', 'invalid.epub', null, 'invalid', null]);
$originalTimezone = date_default_timezone_get();
try {
    foreach (['UTC', 'Asia/Tokyo', 'America/New_York'] as $timezone) {
        date_default_timezone_set($timezone);
        $saved = getSavedEpubReadingPosition($database, 'reader', 'book.epub');
        if ($saved !== ['cfi' => 'server-cfi', 'updatedAt' => 1790950745000]) {
            throw new RuntimeException('Saved EPUB time depends on PHP timezone: ' . $timezone);
        }
        $created = getSavedEpubReadingPosition($database, 'reader', 'created.epub');
        if ($created['updatedAt'] !== 1790950745000) throw new RuntimeException('created_at fallback is not UTC.');
    }
    foreach (['missing.epub', 'invalid.epub'] as $book) {
        if (getSavedEpubReadingPosition($database, 'reader', $book) !== ['cfi' => '', 'updatedAt' => 0]) {
            throw new RuntimeException('Missing position fallback is invalid.');
        }
    }
    if ($database->query("SELECT updated_at FROM book_history WHERE user = 'reader' AND base_file = 'book.epub'")->fetchColumn() !== '2026-10-02 14:19:05') {
        throw new RuntimeException('Reading position changed the database.');
    }
} finally {
    date_default_timezone_set($originalTimezone);
}
echo "epub_saved_location.test.php: OK\n";
