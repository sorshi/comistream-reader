<?php

/**
 * Comistream Reader Marker Library
 *
 * 読者が任意位置へ追加するしおりを管理するルン。
 *
 * @package sorshi/comistream-reader
 */

const READER_MARKER_LIMIT_PER_BOOK = 100;
const READER_MARKER_MAX_CFI_BYTES = 8192;
const READER_MARKER_MAX_CHAPTER_LABEL_LENGTH = 512;
const READER_MARKER_MAX_CUSTOM_LABEL_LENGTH = 120;

final class ReaderMarkerLimitException extends RuntimeException
{
}

/**
 * 既存DBにもreader_markersテーブルが存在することを保証するルン。
 */
function ensureReaderMarkersTable(PDO $database): void
{
    $database->exec(
        "CREATE TABLE IF NOT EXISTS reader_markers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user TEXT NOT NULL,
            base_file TEXT NOT NULL,
            base_file_hash TEXT,
            format TEXT NOT NULL
                CHECK (format IN ('archive', 'pdf', 'epub')),
            locator_type TEXT NOT NULL
                CHECK (locator_type IN ('page', 'epub_cfi')),
            locator TEXT NOT NULL,
            locator_hash TEXT NOT NULL,
            page_number INTEGER,
            section_index INTEGER,
            progress_fraction REAL,
            chapter_label TEXT,
            custom_label TEXT,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CHECK (page_number IS NULL OR page_number >= 1),
            CHECK (section_index IS NULL OR section_index >= 0),
            CHECK (
                progress_fraction IS NULL
                OR (progress_fraction >= 0.0 AND progress_fraction <= 1.0)
            ),
            CHECK (
                (format IN ('archive', 'pdf') AND locator_type = 'page' AND page_number IS NOT NULL)
                OR (format = 'epub' AND locator_type = 'epub_cfi')
            ),
            UNIQUE (user, base_file, locator_hash)
        )"
    );
    $database->exec(
        'CREATE INDEX IF NOT EXISTS idx_reader_markers_book_order '
        . 'ON reader_markers (user, base_file, progress_fraction, page_number, created_at)'
    );
}

/**
 * Readerへ埋め込むCSRFトークンを用意するルン。
 */
function ensureReaderMarkerCsrfToken(): string
{
    if (!isset($_SESSION['reader_marker_csrf'])
        || !is_string($_SESSION['reader_marker_csrf'])
        || strlen($_SESSION['reader_marker_csrf']) !== 64
    ) {
        $_SESSION['reader_marker_csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['reader_marker_csrf'];
}

/**
 * Marker APIのJSON応答を返して終了するルン。
 *
 * @param array<string, mixed> $payload
 */
function readerMarkerJsonResponse(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=UTF-8');
    header('Cache-Control: no-store');
    echo json_encode(
        $payload,
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG
        | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
    );
    exit(0);
}

/**
 * Marker APIの失敗応答を返すルン。
 */
function readerMarkerError(string $code, int $status, string $message = ''): never
{
    readerMarkerJsonResponse([
        'ok' => false,
        'error' => $code,
        'message' => $message,
    ], $status);
}

/**
 * API用の共有領域内ファイルを解決するルン。
 *
 * @return array{relative_path:string, real_path:string, base_file:string, format:string}
 */
function resolveReaderMarkerBook(string $file, string $sharePath): array
{
    if ($file === '') {
        readerMarkerError('file_required', 400);
    }

    $relativePath = urldecode(str_replace('+', '%2B', $file));
    $realPath = resolveFileWithinBaseDirectory($sharePath, $relativePath);
    if ($realPath === false) {
        readerMarkerError('book_not_found', 404);
    }

    $extension = strtolower(pathinfo($realPath, PATHINFO_EXTENSION));
    if (in_array($extension, ['zip', 'cbz', 'rar', 'cbr', '7z', 'cb7'], true)) {
        $format = 'archive';
    } elseif ($extension === 'pdf') {
        $format = 'pdf';
    } elseif ($extension === 'epub') {
        $format = 'epub';
    } else {
        readerMarkerError('unsupported_format', 400);
    }

    return [
        'relative_path' => $relativePath,
        'real_path' => $realPath,
        'base_file' => basename($realPath),
        'format' => $format,
    ];
}

/**
 * 任意表示名を正規化するルン。
 */
function normalizeReaderMarkerCustomLabel(mixed $value): ?string
{
    if (!is_string($value)) {
        readerMarkerError('invalid_custom_label', 400);
    }
    $label = trim($value);
    if ($label === '') {
        return null;
    }
    if (preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', $label) === 1
        || mb_strlen($label, 'UTF-8') > READER_MARKER_MAX_CUSTOM_LABEL_LENGTH
    ) {
        readerMarkerError('invalid_custom_label', 400);
    }
    return $label;
}

/**
 * Marker追加入力を正規化するルン。
 *
 * @param array<string, mixed> $input
 * @param array{relative_path:string, real_path:string, base_file:string, format:string, base_file_hash?:?string} $book
 * @return array<string, mixed>
 */
function normalizeReaderMarkerInput(array $input, array $book): array
{
    $format = (string)($input['format'] ?? '');
    if ($format !== $book['format']) {
        readerMarkerError('format_mismatch', 400);
    }

    $locatorType = (string)($input['locator_type'] ?? '');
    $locator = trim((string)($input['locator'] ?? ''));
    $pageNumber = null;
    $sectionIndex = null;

    if ($format === 'epub') {
        if ($locatorType !== 'epub_cfi'
            || strlen($locator) > READER_MARKER_MAX_CFI_BYTES
            || preg_match('/^epubcfi\\(.+\\)$/s', $locator) !== 1
        ) {
            readerMarkerError('invalid_epub_cfi', 400);
        }
        if (isset($input['page_number']) && $input['page_number'] !== '') {
            $pageNumber = filter_var($input['page_number'], FILTER_VALIDATE_INT);
            if ($pageNumber === false || $pageNumber < 1) {
                readerMarkerError('invalid_page_number', 400);
            }
        }
        if (isset($input['section_index']) && $input['section_index'] !== '') {
            $sectionIndex = filter_var($input['section_index'], FILTER_VALIDATE_INT);
            if ($sectionIndex === false || $sectionIndex < 0) {
                readerMarkerError('invalid_section_index', 400);
            }
        }
    } else {
        if ($locatorType !== 'page') {
            readerMarkerError('invalid_locator_type', 400);
        }
        $pageNumber = filter_var($input['page_number'] ?? $locator, FILTER_VALIDATE_INT);
        if ($pageNumber === false || $pageNumber < 1 || $pageNumber > 1000000) {
            readerMarkerError('invalid_page_number', 400);
        }
        $locator = (string)$pageNumber;
    }

    $progressFraction = null;
    if (isset($input['progress_fraction']) && $input['progress_fraction'] !== '') {
        $progressFraction = filter_var($input['progress_fraction'], FILTER_VALIDATE_FLOAT);
        if ($progressFraction === false
            || !is_finite((float)$progressFraction)
            || $progressFraction < 0
            || $progressFraction > 1
        ) {
            readerMarkerError('invalid_progress_fraction', 400);
        }
        $progressFraction = (float)$progressFraction;
    }

    $chapterLabel = null;
    if (isset($input['chapter_label']) && $input['chapter_label'] !== '') {
        if (!is_string($input['chapter_label'])) {
            readerMarkerError('invalid_chapter_label', 400);
        }
        $chapterLabel = trim($input['chapter_label']);
        if (preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', $chapterLabel) === 1
            || mb_strlen($chapterLabel, 'UTF-8') > READER_MARKER_MAX_CHAPTER_LABEL_LENGTH
        ) {
            readerMarkerError('invalid_chapter_label', 400);
        }
        if ($chapterLabel === '') {
            $chapterLabel = null;
        }
    }

    $customLabelProvided = array_key_exists('custom_label', $input);
    $customLabel = $customLabelProvided
        ? normalizeReaderMarkerCustomLabel($input['custom_label'])
        : null;

    return [
        'base_file' => $book['base_file'],
        'base_file_hash' => $book['base_file_hash'] ?? null,
        'format' => $format,
        'locator_type' => $locatorType,
        'locator' => $locator,
        'locator_hash' => hash('sha256', $locatorType . "\n" . $locator),
        'page_number' => $pageNumber,
        'section_index' => $sectionIndex,
        'progress_fraction' => $progressFraction,
        'chapter_label' => $chapterLabel,
        'custom_label' => $customLabel,
        'custom_label_provided' => $customLabelProvided,
    ];
}

/**
 * DB行をAPI応答へ整形するルン。
 *
 * @param array<string, mixed> $row
 * @return array<string, mixed>
 */
function serializeReaderMarker(array $row): array
{
    return [
        'id' => (int)$row['id'],
        'format' => (string)$row['format'],
        'locatorType' => (string)$row['locator_type'],
        'locator' => (string)$row['locator'],
        'pageNumber' => $row['page_number'] === null ? null : (int)$row['page_number'],
        'sectionIndex' => $row['section_index'] === null ? null : (int)$row['section_index'],
        'progressFraction' => $row['progress_fraction'] === null
            ? null
            : (float)$row['progress_fraction'],
        'chapterLabel' => $row['chapter_label'] === null ? null : (string)$row['chapter_label'],
        'customLabel' => $row['custom_label'] === null ? null : (string)$row['custom_label'],
        'createdAt' => (string)$row['created_at'],
        'updatedAt' => (string)$row['updated_at'],
    ];
}

/**
 * 1冊分のMarker一覧を返すルン。
 *
 * @return array<int, array<string, mixed>>
 */
function listReaderMarkers(PDO $database, string $user, string $baseFile): array
{
    $statement = $database->prepare(
        'SELECT * FROM reader_markers WHERE user = ? AND base_file = ? '
        . "ORDER BY CASE locator_type WHEN 'page' THEN page_number END ASC, "
        . "CASE locator_type WHEN 'epub_cfi' THEN progress_fraction END ASC, "
        . 'section_index ASC, created_at ASC, id ASC'
    );
    $statement->execute([$user, $baseFile]);
    return array_map('serializeReaderMarker', $statement->fetchAll(PDO::FETCH_ASSOC));
}

/**
 * 現行読書履歴と同じ書籍ハッシュがあれば引き継ぐルン。
 */
function findReaderMarkerBaseFileHash(
    PDO $database,
    string $user,
    string $baseFile
): ?string {
    $statement = $database->prepare(
        'SELECT base_file_hash FROM book_history WHERE user = ? AND base_file = ?'
    );
    $statement->execute([$user, $baseFile]);
    $value = $statement->fetchColumn();
    return is_string($value) && $value !== '' ? $value : null;
}

/**
 * Markerを冪等に追加するルン。
 *
 * @param array<string, mixed> $marker
 * @return array{marker:array<string,mixed>,created:bool}
 */
function addReaderMarker(PDO $database, string $user, array $marker): array
{
    $transactionStarted = false;
    $database->exec('BEGIN IMMEDIATE');
    $transactionStarted = true;
    try {
        $existingStatement = $database->prepare(
            'SELECT id FROM reader_markers '
            . 'WHERE user = ? AND base_file = ? AND locator_hash = ?'
        );
        $existingStatement->execute([
            $user,
            $marker['base_file'],
            $marker['locator_hash'],
        ]);
        $existingId = $existingStatement->fetchColumn();
        $created = $existingId === false;

        if ($created) {
            $countStatement = $database->prepare(
                'SELECT COUNT(*) FROM reader_markers WHERE user = ? AND base_file = ?'
            );
            $countStatement->execute([$user, $marker['base_file']]);
            if ((int)$countStatement->fetchColumn() >= READER_MARKER_LIMIT_PER_BOOK) {
                throw new ReaderMarkerLimitException('Reader marker limit reached.');
            }
        }

        $customLabelSql = $marker['custom_label_provided']
            ? 'excluded.custom_label'
            : 'reader_markers.custom_label';
        $statement = $database->prepare(
            'INSERT INTO reader_markers '
            . '(user, base_file, base_file_hash, format, locator_type, locator, locator_hash, '
            . 'page_number, section_index, progress_fraction, chapter_label, custom_label) '
            . 'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) '
            . 'ON CONFLICT(user, base_file, locator_hash) DO UPDATE SET '
            . 'base_file_hash = COALESCE(excluded.base_file_hash, reader_markers.base_file_hash), '
            . 'format = excluded.format, '
            . 'locator_type = excluded.locator_type, locator = excluded.locator, '
            . 'page_number = excluded.page_number, section_index = excluded.section_index, '
            . 'progress_fraction = excluded.progress_fraction, '
            . 'chapter_label = excluded.chapter_label, custom_label = ' . $customLabelSql . ', '
            . 'updated_at = CURRENT_TIMESTAMP'
        );
        $statement->execute([
            $user,
            $marker['base_file'],
            $marker['base_file_hash'],
            $marker['format'],
            $marker['locator_type'],
            $marker['locator'],
            $marker['locator_hash'],
            $marker['page_number'],
            $marker['section_index'],
            $marker['progress_fraction'],
            $marker['chapter_label'],
            $marker['custom_label'],
        ]);

        $selectStatement = $database->prepare(
            'SELECT * FROM reader_markers '
            . 'WHERE user = ? AND base_file = ? AND locator_hash = ?'
        );
        $selectStatement->execute([
            $user,
            $marker['base_file'],
            $marker['locator_hash'],
        ]);
        $row = $selectStatement->fetch(PDO::FETCH_ASSOC);
        $database->exec('COMMIT');
        $transactionStarted = false;

        return [
            'marker' => serializeReaderMarker($row),
            'created' => $created,
        ];
    } catch (Throwable $error) {
        if ($transactionStarted) {
            try {
                $database->exec('ROLLBACK');
            } catch (Throwable) {
                // SQLite側ですでに自動rollback済みなら、元の例外を優先するルン。
            }
        }
        throw $error;
    }
}

/**
 * Markerの任意名だけを更新するルン。
 *
 * @return array<string, mixed>|null
 */
function updateReaderMarkerLabel(
    PDO $database,
    string $user,
    int $id,
    ?string $label
): ?array {
    $statement = $database->prepare(
        'UPDATE reader_markers SET custom_label = ?, updated_at = CURRENT_TIMESTAMP '
        . 'WHERE id = ? AND user = ?'
    );
    $statement->execute([$label, $id, $user]);
    if ($statement->rowCount() === 0) {
        return null;
    }

    $statement = $database->prepare('SELECT * FROM reader_markers WHERE id = ? AND user = ?');
    $statement->execute([$id, $user]);
    $row = $statement->fetch(PDO::FETCH_ASSOC);
    return $row === false ? null : serializeReaderMarker($row);
}

/**
 * Markerを所有者条件付きで削除するルン。
 */
function deleteReaderMarker(PDO $database, string $user, int $id): void
{
    $statement = $database->prepare('DELETE FROM reader_markers WHERE id = ? AND user = ?');
    $statement->execute([$id, $user]);
}

/**
 * Reader Marker APIを処理するルン。
 *
 * @param array<string, mixed> $input
 */
function handleReaderMarkerApi(string $mode, array $input): never
{
    global $dbh, $user, $sharePath;

    if (!($dbh instanceof PDO)) {
        readerMarkerError('database_unavailable', 503);
    }
    if ($user === 'guest') {
        readerMarkerError('login_required', 401);
    }

    try {
        ensureReaderMarkersTable($dbh);

        if ($mode === 'markerList') {
            $book = resolveReaderMarkerBook((string)($input['file'] ?? ''), $sharePath);
            readerMarkerJsonResponse([
                'ok' => true,
                'version' => 1,
                'limit' => READER_MARKER_LIMIT_PER_BOOK,
                'markers' => listReaderMarkers($dbh, $user, $book['base_file']),
            ]);
        }

        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
            readerMarkerError('method_not_allowed', 405);
        }
        $providedToken = (string)($input['csrf_token'] ?? '');
        $expectedToken = (string)($_SESSION['reader_marker_csrf'] ?? '');
        if ($providedToken === ''
            || $expectedToken === ''
            || !hash_equals($expectedToken, $providedToken)
        ) {
            readerMarkerError('csrf_failed', 403);
        }

        if ($mode === 'markerAdd') {
            $book = resolveReaderMarkerBook((string)($input['file'] ?? ''), $sharePath);
            $book['base_file_hash'] = findReaderMarkerBaseFileHash(
                $dbh,
                $user,
                $book['base_file']
            );
            $marker = normalizeReaderMarkerInput($input, $book);
            $result = addReaderMarker($dbh, $user, $marker);
            readerMarkerJsonResponse([
                'ok' => true,
                'marker' => $result['marker'],
            ], $result['created'] ? 201 : 200);
        }

        $markerId = filter_var($input['marker_id'] ?? null, FILTER_VALIDATE_INT);
        if ($markerId === false || $markerId < 1) {
            readerMarkerError('invalid_marker_id', 400);
        }

        if ($mode === 'markerUpdate') {
            if (!array_key_exists('custom_label', $input)) {
                readerMarkerError('custom_label_required', 400);
            }
            $label = normalizeReaderMarkerCustomLabel($input['custom_label']);
            $marker = updateReaderMarkerLabel($dbh, $user, $markerId, $label);
            if ($marker === null) {
                readerMarkerError('marker_not_found', 404);
            }
            readerMarkerJsonResponse([
                'ok' => true,
                'marker' => $marker,
            ]);
        }

        if ($mode === 'markerDelete') {
            deleteReaderMarker($dbh, $user, $markerId);
            readerMarkerJsonResponse(['ok' => true]);
        }

        readerMarkerError('unsupported_mode', 400);
    } catch (ReaderMarkerLimitException $error) {
        readerMarkerError('marker_limit_reached', 409);
    } catch (PDOException $error) {
        $message = $error->getMessage();
        if (stripos($message, 'database is locked') !== false
            || stripos($message, 'database is busy') !== false
        ) {
            writelog('WARNING Reader marker DB is busy: ' . $message);
            readerMarkerError('database_busy', 503);
        }
        writelog('ERROR Reader marker DB operation failed: ' . $message);
        readerMarkerError('marker_operation_failed', 500);
    } catch (Throwable $error) {
        writelog('ERROR Reader marker operation failed: ' . $error->getMessage());
        readerMarkerError('marker_operation_failed', 500);
    }
}
