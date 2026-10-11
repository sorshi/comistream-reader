<?php

declare(strict_types=1);

if (($argv[1] ?? '') === '--hash') {
    echo md5(stream_get_contents(STDIN)) . "\n";
    exit(0);
}

require_once dirname(__DIR__) . '/comistream_lib.php';

function expectHistoryRecency(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

if (($argv[1] ?? '') === '--worker') {
    $scenario = $argv[2];
    $dbh = new PDO('sqlite::memory:');
    $dbh->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $schema = file_get_contents(dirname(__DIR__, 2) . '/rsrc/sql/make-comistream-db-ddl.sql');
    $dbh->exec(substr($schema, 0, strpos($schema, 'CREATE TABLE IF NOT EXISTS reader_markers')));
    $user = 'reader';
    $global_use_db_flag = 1;
    $insert = $dbh->prepare('INSERT INTO book_history(user,base_file,request_uri,created_at,updated_at) VALUES (?,?,?,?,?)');
    for ($i = 0; $i < 50; $i++) {
        $insert->execute([$user, 'old-' . $i . '.cbz', '/old', '2000-01-01 00:00:00', '2000-01-01 00:00:00']);
    }
    // 別ユーザーの新しい履歴を混ぜず、作成日時より更新日時を優先するルン。
    $insert->execute(['other', 'other.cbz', '/other', '2999-01-01 00:00:00', '2999-01-01 00:00:00']);
    $insert->execute([$user, 'created-later.cbz', '/old', '2999-01-01 00:00:00', '2000-01-01 00:00:00']);
    $book = 'new.' . ($scenario === 'pdf' ? 'pdf' : 'cbz');
    if ($scenario === 'legacy') {
        $insert->execute([$user, $book, '/new', '2001-01-01 00:00:00', null]);
    } else {
        $sharePath = '/fixture';
        $openFile = $sharePath . '/' . $book;
        $bookmarkDir = '/fixture-bookmarks';
        $page = 1;
        $maxPage = 30;
        $file = 'fixture-hash';
        $escapedFile = $book;
        $md5cmd = escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' --hash';
        $_SERVER['REQUEST_URI'] = '/cgi-bin/comistream.php?mode=open&file=' . $book;
        makeBookmark();
        $format = $scenario === 'pdf' ? 'pdf' : 'archive';
        $state = initializeReaderProgress($dbh, $user, $book, $format, 30);
        $row = readerProgressHistory($dbh, $user, $book);
        expectHistoryRecency($row['updated_at'] !== null, 'First open left the history timestamp empty.');
        expectHistoryRecency($state['revision'] === 0 && $state['locator'] === '1', 'Opening changed reading progress.');
        if ($scenario === 'reopen') {
            $dbh->prepare('UPDATE book_history SET current_page=7, max_page=0, has_read=1, favorite=1 WHERE user=? AND base_file=?')
                ->execute([$user, $book]);
            $before = readerProgressState($dbh, $user, $book);
            makeBookmark();
            $row = readerProgressHistory($dbh, $user, $book);
            expectHistoryRecency((int)$row['current_page'] === 7 && (int)$row['max_page'] === 0
                && (int)$row['has_read'] === 1 && (int)$row['favorite'] === 1, 'Reopening changed saved book state.');
            expectHistoryRecency(readerProgressState($dbh, $user, $book) === $before, 'Reopening changed shared progress.');
        }
        if ($scenario === 'same-second') {
            // 時計待ちをせず、同じ秒に開いた既存履歴との並び順を確認するルン。
            $dbh->exec('DROP TRIGGER update_book_history_updated_at');
            $dbh->prepare('UPDATE book_history SET updated_at=? WHERE user=?')->execute([$row['updated_at'], $user]);
        }
    }
    // closeや位置保存を呼ばなくても、実際の履歴APIで先頭に出る必要があるルン。
    if ($argv[3] === 'latest') getHistory();
    getRecentBooks();
}

foreach (['archive', 'pdf', 'legacy', 'same-second', 'reopen'] as $scenario) {
    foreach (['latest', 'recent'] as $api) {
        $output = [];
        $status = 0;
        exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' --worker '
            . escapeshellarg($scenario) . ' ' . escapeshellarg($api) . ' 2>&1', $output, $status);
        $response = implode("\n", $output);
        expectHistoryRecency($status === 0, $scenario . '/' . $api . ': ' . $response);
        $book = 'new.' . ($scenario === 'pdf' ? 'pdf' : 'cbz');
        if ($api === 'latest') {
            expectHistoryRecency(str_contains($response, '>' . $book . '</a>'), $scenario . ': latest history omitted the book.');
        } else {
            $recent = json_decode($response, true, 512, JSON_THROW_ON_ERROR);
            expectHistoryRecency(count($recent) === 50 && $recent[0]['baseFile'] === $book,
                $scenario . ': recent history did not put the book first.');
            expectHistoryRecency(!in_array('other.cbz', array_column($recent, 'baseFile'), true), 'Other user history leaked.');
        }
    }
}

echo "history_recency.test.php: OK\n";
