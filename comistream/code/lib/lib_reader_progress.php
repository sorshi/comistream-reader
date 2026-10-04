<?php

/** 読書位置を更新番号と操作連番で共有するルン。 */
final class ReaderProgressException extends RuntimeException
{
    public function __construct(public readonly string $reason, public readonly int $status = 400)
    {
        parent::__construct($reason);
    }
}

function readerProgressCfiParts(string $cfi): array
{
    if (strlen($cfi) > 8192 || preg_match('//u', $cfi) !== 1 || !preg_match('/\Aepubcfi\((.+)\)\z/D', $cfi, $match)) {
        throw new ReaderProgressException('unsupported_locator', 422);
    }
    // assertion内の区切りとエスケープを比較用の経路から除くルン。
    $path = ''; $assertion = false; $escaped = false;
    foreach (str_split($match[1]) as $char) {
        if ($escaped) { $escaped = false; continue; }
        if ($assertion && $char === '^') { $escaped = true; continue; }
        if ($char === '[' && !$assertion) { $assertion = true; continue; }
        if ($char === ']' && $assertion) { $assertion = false; continue; }
        if (!$assertion) $path .= $char;
    }
    if ($assertion || $escaped) throw new ReaderProgressException('unsupported_locator', 422);
    $range = explode(',', $path);
    if (count($range) !== 1 && count($range) !== 3) throw new ReaderProgressException('unsupported_locator', 422);
    $parse = static function (string $value): array {
        $parts = [];
        foreach (explode('!', $value) as $segment) {
            if (!preg_match('/\A(?:\/[1-9][0-9]{0,9})+(?::[0-9]{1,10})?\z/D', $segment)) {
                throw new ReaderProgressException('unsupported_locator', 422);
            }
            [$steps, $offset] = array_pad(explode(':', $segment), 2, '0');
            $indices = array_map('intval', explode('/', substr($steps, 1)));
            if (count($indices) > 64 || max($indices) > 2147483647 || (int)$offset > 2147483647) {
                throw new ReaderProgressException('unsupported_locator', 422);
            }
            $parts[] = ['steps' => $indices, 'offset' => (int)$offset];
        }
        if (count($parts) > 8) throw new ReaderProgressException('unsupported_locator', 422);
        return $parts;
    };
    $parts = $parse($range[0]);
    if (count($range) === 3) {
        // 範囲CFIの開始位置を使い、末尾側も対応構文か確認するルン。
        // 空の相対経路は文書内の共通経路そのものを指すルン。
        if (($range[1] === '' || $range[2] === '') && count($parts) < 2) {
            throw new ReaderProgressException('unsupported_locator', 422);
        }
        $start = $range[1] === '' ? [] : $parse($range[1]);
        if ($range[2] !== '') $parse($range[2]);
        if ($start) {
            $last = count($parts) - 1;
            $parts[$last]['steps'] = array_merge($parts[$last]['steps'], $start[0]['steps']);
            $parts[$last]['offset'] = $start[0]['offset'];
            $parts = array_merge($parts, array_slice($start, 1));
        }
    }
    return $parts;
}

function compareReaderProgressCfi(string $left, string $right): int
{
    $a = readerProgressCfiParts($left); $b = readerProgressCfiParts($right);
    for ($i = 0; $i < max(count($a), count($b)); $i++) {
        $x = $a[$i]['steps'] ?? []; $y = $b[$i]['steps'] ?? [];
        for ($j = 0; $j < max(count($x), count($y)); $j++) {
            $result = ($x[$j] ?? -1) <=> ($y[$j] ?? -1);
            if ($result !== 0) return $result;
        }
        $result = ($a[$i]['offset'] ?? 0) <=> ($b[$i]['offset'] ?? 0);
        if ($result !== 0) return $result;
    }
    return 0;
}

function ensureReaderProgressTable(PDO $database): void
{
    $database->exec("CREATE TABLE IF NOT EXISTS reader_progress (
        history_id INTEGER PRIMARY KEY,
        state_id TEXT NOT NULL,
        format TEXT NOT NULL CHECK (format IN ('archive','pdf','epub')),
        locator TEXT,
        total_units INTEGER CHECK (total_units IS NULL OR total_units > 0),
        revision INTEGER NOT NULL DEFAULT 0,
        policy_epoch INTEGER NOT NULL DEFAULT 0,
        position_updated_at TEXT,
        last_writer_id TEXT,
        last_writer_seq INTEGER NOT NULL DEFAULT 0,
        writer_base_revision INTEGER NOT NULL DEFAULT 0,
        last_operation_hash TEXT,
        FOREIGN KEY (history_id) REFERENCES book_history(id) ON DELETE CASCADE
    )");
    // foreign_keysが無効な既存環境でも履歴削除を反映するルン。
    $database->exec('CREATE TRIGGER IF NOT EXISTS delete_reader_progress AFTER DELETE ON book_history '
        . 'BEGIN DELETE FROM reader_progress WHERE history_id = OLD.id; END');
}

function readerProgressHistory(PDO $database, string $user, string $baseFile): array
{
    $statement = $database->prepare('SELECT * FROM book_history WHERE user = ? AND base_file = ?');
    $statement->execute([$user, $baseFile]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);
    $statement->closeCursor();
    if (!$row) throw new ReaderProgressException('history_not_found', 404);
    return $row;
}

function readerProgressState(PDO $database, string $user, string $baseFile): ?array
{
    $statement = $database->prepare('SELECT p.*, h.has_read, h.current_page FROM reader_progress p '
        . 'JOIN book_history h ON h.id = p.history_id WHERE h.user = ? AND h.base_file = ?');
    $statement->execute([$user, $baseFile]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);
    $statement->closeCursor();
    if (!$row) return null;
    foreach (['history_id','revision','policy_epoch','last_writer_seq','writer_base_revision','current_page'] as $key) $row[$key] = (int)$row[$key];
    $row['has_read'] = (int)$row['has_read'] === 1;
    $row['total_units'] = $row['total_units'] === null ? null : (int)$row['total_units'];
    $row['resume_policy'] = 'last_position';
    return $row;
}

function initializeReaderProgress(PDO $database, string $user, string $baseFile, string $format, ?int $total = null): array
{
    ensureReaderProgressTable($database);
    $history = readerProgressHistory($database, $user, $baseFile);
    $locator = null;
    if ($format === 'epub') {
        try {
            $candidate = (string)($history['epub_cfi'] ?? '');
            readerProgressCfiParts($candidate); $locator = $candidate;
        } catch (ReaderProgressException $e) { /* 不正な旧位置は復元候補にしないルン。 */ }
    } else {
        $candidate = parseReaderInteger($history['current_page'], 1, 2147483647);
        if ($candidate !== null) $locator = (string)($total === null ? $candidate : min($candidate, $total));
    }
    $total ??= parseReaderInteger($history['max_page'], 1, 2147483647);
    $statement = $database->prepare('INSERT OR IGNORE INTO reader_progress '
        . '(history_id,state_id,format,locator,total_units) VALUES (?,?,?,?,?)');
    $statement->execute([$history['id'], bin2hex(random_bytes(16)), $format, $locator, $total]);
    if ($total !== null) {
        $statement = $database->prepare('UPDATE reader_progress SET total_units = ? WHERE history_id = ?');
        $statement->execute([$total, $history['id']]);
    }
    return readerProgressState($database, $user, $baseFile);
}

function readerProgressInteger(mixed $value, int $minimum = 0): int
{
    $number = parseReaderInteger($value, $minimum, 2147483647);
    if ($number === null) throw new ReaderProgressException('invalid_operation');
    return $number;
}

function normalizeReaderProgressLocator(mixed $value, string $format, ?int $total): string
{
    if (!is_string($value) && !is_int($value)) throw new ReaderProgressException('invalid_locator');
    if ($format === 'epub') {
        readerProgressCfiParts((string)$value);
        return (string)$value;
    }
    return (string)readerProgressInteger($value, 1);
}

function readerProgressCompare(string $format, string $a, string $b): int
{
    return $format === 'epub' ? compareReaderProgressCfi($a, $b) : ((int)$a <=> (int)$b);
}

/** キャッシュ済み書籍から上限と通常読書順を取得するルン。 */
function readerProgressBookMetadata(array $book, array $history, string $cacheRoot): array
{
    $directory = resolveReaderCacheDirectory($cacheRoot, $history['path_hash'] ?? '');
    if ($directory === false) throw new ReaderProgressException('book_metadata_unavailable', 503);
    if ($book['format'] !== 'epub') {
        $index = resolveReaderCacheFile($directory, 'index');
        if ($index === false) throw new ReaderProgressException('book_metadata_unavailable', 503);
        $handle = fopen($index, 'rb'); $count = 0;
        if (!$handle) throw new ReaderProgressException('book_metadata_unavailable', 503);
        try { while (fgets($handle) !== false) $count++; } finally { fclose($handle); }
        if ($count < 1) throw new ReaderProgressException('book_metadata_unavailable', 503);
        return ['total' => $count, 'linear' => null];
    }
    $readXml = static function (string|false $path): DOMDocument {
        if ($path === false || filesize($path) > 4194304) throw new ReaderProgressException('book_metadata_unavailable', 503);
        $text = file_get_contents($path);
        if ($text === false || stripos($text, '<!DOCTYPE') !== false) throw new ReaderProgressException('book_metadata_unavailable', 503);
        $document = new DOMDocument();
        $previous = libxml_use_internal_errors(true);
        try { $ok = $document->loadXML($text, LIBXML_NONET); }
        finally { libxml_clear_errors(); libxml_use_internal_errors($previous); }
        if (!$ok) throw new ReaderProgressException('book_metadata_unavailable', 503);
        return $document;
    };
    $container = $readXml(resolveReaderCacheFile($directory, 'META-INF/container.xml'));
    $xpath = new DOMXPath($container);
    $package = $xpath->evaluate('string((//*[local-name()="rootfile"])[1]/@full-path)');
    $document = $readXml(resolveReaderCacheFile($directory, rawurldecode($package)));
    $xpath = new DOMXPath($document); $linear = [];
    foreach ($xpath->query('//*[local-name()="spine"]/*[local-name()="itemref"]') as $item) {
        $linear[] = $item->getAttribute('linear') !== 'no';
    }
    if (!$linear) throw new ReaderProgressException('book_metadata_unavailable', 503);
    return ['total' => count($linear), 'linear' => $linear];
}

function readerProgressSection(string $cfi, array $linear): int
{
    $parts = readerProgressCfiParts($cfi);
    $steps = $parts[0]['steps'];
    if (count($steps) !== 2 || $steps[0] !== 6 || $steps[1] % 2 !== 0) throw new ReaderProgressException('unsupported_locator', 422);
    $section = intdiv($steps[1], 2) - 1;
    if (!array_key_exists($section, $linear)) throw new ReaderProgressException('invalid_locator');
    return $section;
}

/** APIとテストが同じ原子的保存を使うルン。 */
function saveReaderProgress(PDO $database, string $user, string $baseFile, array $input, ?array $metadata = null): array
{
    // 最大位置を自動統合する旧タブからの保存は、新しい位置を上書きさせないルン。
    if (($input['resume_policy'] ?? null) !== 'last_position') throw new ReaderProgressException('reader_update_required', 409);
    $stateId = $input['state_id'] ?? '';
    $writer = $input['writer_id'] ?? '';
    if (!is_string($stateId) || !preg_match('/\A[a-f0-9]{32}\z/D', $stateId)
        || !is_string($writer) || !preg_match('/\A[a-zA-Z0-9_-]{16,80}\z/D', $writer)) throw new ReaderProgressException('invalid_operation');
    $revision = readerProgressInteger($input['expected_revision'] ?? null);
    $epoch = readerProgressInteger($input['policy_epoch'] ?? null);
    $seq = readerProgressInteger($input['seq'] ?? null, 1);
    $database->exec('BEGIN IMMEDIATE');
    try {
        $state = readerProgressState($database, $user, $baseFile);
        if (!$state) throw new ReaderProgressException('state_not_found', 409);
        if ($state['state_id'] !== $stateId || $state['policy_epoch'] !== $epoch) {
            $database->exec('ROLLBACK');
            return ['result' => 'conflict', 'reason' => 'state_changed', 'state' => $state];
        }
        $format = $state['format']; $total = $metadata['total'] ?? $state['total_units'];
        $locator = normalizeReaderProgressLocator($input['locator'] ?? null, $format, $total);
        $furthest = normalizeReaderProgressLocator($input['furthest'] ?? $locator, $format, $total);
        $completionSeq = null;
        $completion = $input['completion_locator'] ?? null;
        if ($completion !== null && $completion !== '') {
            $completion = normalizeReaderProgressLocator($completion, $format, $total);
            $completionSeq = readerProgressInteger($input['completion_seq'] ?? null, 1);
            if ($completionSeq > $seq) throw new ReaderProgressException('invalid_operation');
        } else $completion = null;
        if ($format !== 'epub') {
            foreach (array_filter([$locator, $furthest, $completion], static fn($v) => $v !== null) as $value) {
                if ($total === null || (int)$value > $total) throw new ReaderProgressException('invalid_locator');
            }
            if ($completion !== null && (int)$completion !== $total) throw new ReaderProgressException('invalid_completion');
        } elseif ($metadata !== null) {
            $linear = $metadata['linear'];
            $section = readerProgressSection($locator, $linear);
            $furthestSection = readerProgressSection($furthest, $linear);
            if (!$linear[$furthestSection]) $furthest = null;
            if ($completion !== null) {
                $end = array_key_last(array_filter($linear));
                if (readerProgressSection($completion, $linear) !== $end) throw new ReaderProgressException('invalid_completion');
            }
        }
        // フィールド順やCSRF更新では同じ操作を別内容にしないルン。
        $pageHint = $format === 'epub' ? readerProgressInteger($input['page'] ?? 1, 1) : null;
        $hash = hash('sha256', json_encode([$stateId, $revision, $epoch, $writer, $seq,
            $locator, $furthest, $completion, $completionSeq, $pageHint], JSON_THROW_ON_ERROR));
        if ($state['last_writer_id'] === $writer && $seq <= $state['last_writer_seq']) {
            if ($seq === $state['last_writer_seq'] && $state['last_operation_hash'] !== $hash) throw new ReaderProgressException('operation_reused');
            $database->exec('ROLLBACK');
            return ['result' => $seq === $state['last_writer_seq'] ? 'duplicate' : 'superseded', 'state' => $state];
        }
        $sameWriter = $state['last_writer_id'] === $writer;
        $ownChain = $sameWriter && $revision >= $state['writer_base_revision'] && $revision <= $state['revision'];
        if ($revision !== $state['revision'] && !$ownChain) {
            $database->exec('ROLLBACK');
            return ['result' => 'conflict', 'reason' => 'revision_changed', 'state' => $state];
        }
        $read = $state['has_read'] || $completion !== null;
        $saved = $locator;
        $statement = $database->prepare('UPDATE reader_progress SET locator=?, total_units=?, revision=revision+1, '
            . 'position_updated_at=CASE WHEN locator IS NOT ? THEN CURRENT_TIMESTAMP ELSE position_updated_at END, '
            . 'last_writer_id=?,last_writer_seq=?,writer_base_revision=?,last_operation_hash=? WHERE history_id=?');
        $statement->execute([$saved, $total, $saved, $writer, $seq,
            $sameWriter ? $state['writer_base_revision'] : $state['revision'], $hash, $state['history_id']]);
        $page = $saved === null ? 0 : ($format === 'epub'
            ? (isset($metadata['linear']) ? readerProgressSection($saved, $metadata['linear']) + 1 : $pageHint)
            : (int)$saved);
        $statement = $database->prepare('UPDATE book_history SET current_page=?,max_page=?,has_read=?,epub_cfi=? WHERE id=? AND user=?');
        $statement->execute([$page, $read ? 0 : ($total ?? 0), $read ? 1 : 0, $format === 'epub' ? $saved : null, $state['history_id'], $user]);
        $result = readerProgressState($database, $user, $baseFile);
        $database->exec('COMMIT');
        return ['result' => 'applied', 'state' => $result];
    } catch (Throwable $e) {
        $database->exec('ROLLBACK'); throw $e;
    }
}

/** 手動の既読変更で古い操作系列を終了するルン。 */
function updateReaderProgressPolicy(PDO $database, string $user, array $historyIds, bool $read): void
{
    ensureReaderProgressTable($database);
    $database->exec('BEGIN IMMEDIATE');
    try {
        foreach ($historyIds as $id) {
            $statement = $database->prepare('UPDATE book_history SET has_read=?, max_page=CASE WHEN ? THEN 0 '
                . 'ELSE COALESCE((SELECT total_units FROM reader_progress WHERE history_id=book_history.id),max_page) END '
                . 'WHERE id=? AND user=?');
            $statement->execute([$read ? 1 : 0, $read ? 1 : 0, $id, $user]);
            $statement = $database->prepare('UPDATE reader_progress SET policy_epoch=policy_epoch+1,revision=revision+1, '
                . 'last_writer_id=NULL,last_writer_seq=0,last_operation_hash=NULL WHERE history_id=? '
                . 'AND EXISTS (SELECT 1 FROM book_history WHERE id=? AND user=?)');
            $statement->execute([$id, $id, $user]);
        }
        $database->exec('COMMIT');
    } catch (Throwable $e) { $database->exec('ROLLBACK'); throw $e; }
}

function readerProgressJson(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=UTF-8'); header('Cache-Control: no-store');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP);
    exit;
}

function handleReaderProgressApi(string $mode, array $input): never
{
    global $dbh, $user, $sharePath, $cacheDir;
    try {
        if (!($dbh instanceof PDO)) throw new ReaderProgressException('database_unavailable', 503);
        if ($user === 'guest') throw new ReaderProgressException('login_required', 401);
        if ($mode === 'saveReadingState') {
            if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') throw new ReaderProgressException('method_not_allowed', 405);
            $token = $input['csrf_token'] ?? ''; $expected = $_SESSION['reader_marker_csrf'] ?? '';
            if (!is_string($token) || $token === '' || !is_string($expected) || !hash_equals($expected, $token)) throw new ReaderProgressException('csrf_failed', 403);
        }
        $book = resolveReaderMarkerBook(is_string($input['file'] ?? null) ? $input['file'] : '', $sharePath);
        // 共有領域内の別名symlinkでも既存履歴のファイル名を継承するルン。
        $book['base_file'] = basename($book['relative_path']);
        $history = readerProgressHistory($dbh, $user, $book['base_file']);
        $metadata = readerProgressBookMetadata($book, $history, $cacheDir);
        $dbh->exec('PRAGMA busy_timeout = 1000');
        if ($mode === 'readingState') {
            $state = initializeReaderProgress($dbh, $user, $book['base_file'], $book['format'], $metadata['total']);
            readerProgressJson(['ok' => true, 'state' => $state]);
        }
        $result = saveReaderProgress($dbh, $user, $book['base_file'], $input, $metadata);
        readerProgressJson(['ok' => $result['result'] !== 'conflict'] + $result, $result['result'] === 'conflict' ? 409 : 200);
    } catch (ReaderProgressException $e) { readerProgressJson(['ok' => false, 'reason' => $e->reason], $e->status); }
    catch (PDOException $e) { writelog('WARNING Reader progress database unavailable: ' . $e->getMessage()); readerProgressJson(['ok' => false, 'reason' => 'database_unavailable'], 503); }
}

/** 履歴から通常openするときに古い明示位置を引き継がないルン。 */
function normalizeReaderHistoryUri(string $uri): string
{
    $parts = explode('?', $uri, 2);
    if (count($parts) < 2) return $uri;
    $query = array_filter(explode('&', $parts[1]), static function (string $part): bool {
        $key = urldecode(explode('=', $part, 2)[0]);
        return !in_array($key, ['page', 'index'], true);
    });
    return $parts[0] . '?' . implode('&', $query);
}
