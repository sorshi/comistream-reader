<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/lib_reader_marker.php';

/**
 * SQLで開始したtransactionをPDOが追跡しない実機環境を再現するルン。
 */
final class ReaderMarkerManualTransactionPdo extends PDO
{
    public function commit(): bool
    {
        throw new RuntimeException('PDO::commit() must not be called.');
    }

    public function rollBack(): bool
    {
        throw new RuntimeException('PDO::rollBack() must not be called.');
    }

    public function inTransaction(): bool
    {
        return false;
    }
}

function expectMarkerTest(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

/**
 * テスト用のページしおりを作るルン。
 *
 * @return array<string, mixed>
 */
function makePageMarker(int $page, ?string $customLabel = null): array
{
    return [
        'base_file' => 'sample.cbz',
        'base_file_hash' => hash('sha256', 'sample.cbz'),
        'format' => 'archive',
        'locator_type' => 'page',
        'locator' => (string)$page,
        'locator_hash' => hash('sha256', "page\n{$page}"),
        'page_number' => $page,
        'section_index' => null,
        'progress_fraction' => ($page - 1) / 99,
        'chapter_label' => null,
        'custom_label' => $customLabel,
        'custom_label_provided' => $customLabel !== null,
    ];
}

$database = new ReaderMarkerManualTransactionPdo('sqlite::memory:');
$database->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$database->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
ensureReaderMarkersTable($database);

for ($page = 1; $page <= READER_MARKER_LIMIT_PER_BOOK; $page++) {
    $result = addReaderMarker($database, 'alice', makePageMarker($page));
    expectMarkerTest($result['created'] === true, "Page {$page} was not created.");
}

$aliceMarkers = listReaderMarkers($database, 'alice', 'sample.cbz');
expectMarkerTest(
    count($aliceMarkers) === READER_MARKER_LIMIT_PER_BOOK,
    'The per-book marker limit fixture count is incorrect.'
);
expectMarkerTest($aliceMarkers[0]['pageNumber'] === 1, 'Markers are not sorted by page.');
expectMarkerTest($aliceMarkers[99]['pageNumber'] === 100, 'The last marker is incorrect.');

$limitRejected = false;
try {
    addReaderMarker($database, 'alice', makePageMarker(101));
} catch (ReaderMarkerLimitException) {
    $limitRejected = true;
}
expectMarkerTest($limitRejected, 'The 101st marker was not rejected.');
expectMarkerTest(
    count(listReaderMarkers($database, 'alice', 'sample.cbz')) === READER_MARKER_LIMIT_PER_BOOK,
    'The rejected marker changed the marker count.'
);

$renamed = updateReaderMarkerLabel(
    $database,
    'alice',
    (int)$aliceMarkers[41]['id'],
    'Review this'
);
expectMarkerTest($renamed !== null, 'The marker label update failed.');
expectMarkerTest($renamed['customLabel'] === 'Review this', 'The updated label is incorrect.');

$duplicate = addReaderMarker($database, 'alice', makePageMarker(42));
expectMarkerTest($duplicate['created'] === false, 'A duplicate marker was created.');
expectMarkerTest(
    $duplicate['marker']['customLabel'] === 'Review this',
    'A duplicate add unexpectedly removed the custom label.'
);
expectMarkerTest(
    count(listReaderMarkers($database, 'alice', 'sample.cbz')) === READER_MARKER_LIMIT_PER_BOOK,
    'A duplicate add changed the marker count.'
);

$bobMarker = addReaderMarker($database, 'bob', makePageMarker(1));
expectMarkerTest($bobMarker['created'] === true, 'A second user could not add the same locator.');
expectMarkerTest(
    count(listReaderMarkers($database, 'bob', 'sample.cbz')) === 1,
    'The second user marker list is incorrect.'
);

deleteReaderMarker($database, 'bob', (int)$aliceMarkers[0]['id']);
expectMarkerTest(
    count(listReaderMarkers($database, 'alice', 'sample.cbz')) === READER_MARKER_LIMIT_PER_BOOK,
    'A different user deleted the marker.'
);

deleteReaderMarker($database, 'alice', (int)$aliceMarkers[0]['id']);
expectMarkerTest(
    count(listReaderMarkers($database, 'alice', 'sample.cbz')) ===
        READER_MARKER_LIMIT_PER_BOOK - 1,
    'The marker delete failed.'
);

echo "reader_marker.test.php: OK\n";
