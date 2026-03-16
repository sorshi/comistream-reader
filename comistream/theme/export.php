<?php

declare(strict_types=1);

/**
 * Comistream Reader History Export
 *
 * 読書履歴を新しい履歴移行バンドル形式でエクスポートする画面ルン。
 * 単一ユーザーを選択して、`manifest.json` / `history.ndjson` /
 * `book_relations.ndjson` を `tar.zst` にまとめて配信するルン。
 *
 * @package sorshi/comistream-reader
 */

mb_internal_encoding('UTF-8');

$historyExportRequestStartedAt = microtime(true);
$historyExportPendingLogs = [];
$historyExportCleanupDirs = [];

/**
 * ログ値を key=value 形式へ安全に整形するルン。
 *
 * @param mixed $value ログへ埋め込む値
 * @return string 整形後の文字列
 */
function historyExportFormatLogValue(mixed $value): string
{
    if ($value === null) {
        return 'null';
    }

    if (is_bool($value)) {
        return $value ? 'true' : 'false';
    }

    if (is_int($value) || is_float($value)) {
        return (string)$value;
    }

    $stringValue = (string)$value;
    if (preg_match('/\A[A-Za-z0-9._:\/@+-]+\z/', $stringValue) === 1) {
        return $stringValue;
    }

    return '"' . addcslashes($stringValue, "\\\"") . '"';
}

/**
 * エクスポート処理の計測ログを syslog へ流すルン。
 *
 * @param string $stage 処理段階名
 * @param array<string, mixed> $context 追加情報
 * @param string $level DEBUG / INFO / WARNING / ERROR
 * @return void
 */
function historyExportPerfLog(string $stage, array $context = [], string $level = 'DEBUG'): void
{
    global $historyExportRequestStartedAt;
    global $historyExportPendingLogs;

    $fields = array_merge([
        'stage' => $stage,
        'elapsed_ms' => round((microtime(true) - $historyExportRequestStartedAt) * 1000, 1),
        'memory_mb' => round(memory_get_usage(true) / 1024 / 1024, 2),
        'request_method' => $_SERVER['REQUEST_METHOD'] ?? 'CLI',
    ], $context);

    $parts = [];
    foreach ($fields as $key => $value) {
        $parts[] = $key . '=' . historyExportFormatLogValue($value);
    }

    $message = strtoupper($level) . ' history-export ' . implode(' ', $parts);

    if (function_exists('writelog')) {
        writelog($message, 'HistoryExport');
        return;
    }

    $historyExportPendingLogs[] = $message;
}

/**
 * `writelog()` 読み込み前に溜めたログをまとめて流すルン。
 *
 * @return void
 */
function historyExportFlushPendingLogs(): void
{
    global $historyExportPendingLogs;

    if (!function_exists('writelog') || $historyExportPendingLogs === []) {
        return;
    }

    foreach ($historyExportPendingLogs as $message) {
        writelog($message, 'HistoryExport');
    }

    $historyExportPendingLogs = [];
}

register_shutdown_function(static function (): void {
    historyExportCleanupRegisteredDirs();
    $error = error_get_last();
    if ($error !== null) {
        historyExportPerfLog('shutdown.error', [
            'type' => $error['type'] ?? null,
            'message' => $error['message'] ?? '',
            'file' => $error['file'] ?? '',
            'line' => $error['line'] ?? 0,
        ], 'ERROR');
    }
});

historyExportPerfLog('bootstrap.start', ['file' => __FILE__]);

$historyExportRealFile = realpath(__FILE__);
define(
    'HISTORY_EXPORT_BASE_DIR',
    $historyExportRealFile !== false ? dirname($historyExportRealFile) : __DIR__
);

$requireStartedAt = microtime(true);
require_once HISTORY_EXPORT_BASE_DIR . '/../code/comistream_lib.php';
historyExportFlushPendingLogs();
historyExportPerfLog('bootstrap.require_complete', [
    'stage_ms' => round((microtime(true) - $requireStartedAt) * 1000, 1),
    'base_dir' => HISTORY_EXPORT_BASE_DIR,
]);

const HISTORY_EXPORT_FORMAT_VERSION = 2;
const HISTORY_EXPORT_CSRF_COOKIE = 'comistreamHistoryExportCsrf';

/**
 * JSON を compact 形式でエンコードするルン。
 *
 * @param mixed $value JSON 化する値
 * @return string JSON 文字列
 * @throws JsonException エンコード失敗時
 */
function historyExportJsonEncode(mixed $value): string
{
    return json_encode(
        $value,
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
    );
}

/**
 * JSON を整形付きでエンコードするルン。
 *
 * @param mixed $value JSON 化する値
 * @return string Pretty JSON 文字列
 * @throws JsonException エンコード失敗時
 */
function historyExportPrettyJsonEncode(mixed $value): string
{
    return json_encode(
        $value,
        JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR
    );
}

/**
 * 一時ディレクトリを再帰削除するルン。
 *
 * @param string $dir 削除対象ディレクトリ
 * @return void
 */
function historyExportDeleteDir(string $dir): void
{
    if ($dir === '' || !is_dir($dir)) {
        return;
    }

    $items = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );

    foreach ($items as $item) {
        if ($item->isDir()) {
            @rmdir($item->getPathname());
        } else {
            @unlink($item->getPathname());
        }
    }

    @rmdir($dir);
}

/**
 * shutdown 時に消す一時ディレクトリを登録するルン。
 *
 * @param string $dir 一時ディレクトリ
 * @return void
 */
function historyExportRegisterCleanupDir(string $dir): void
{
    global $historyExportCleanupDirs;
    $historyExportCleanupDirs[] = $dir;
}

/**
 * 登録済みの一時ディレクトリをまとめて掃除するルン。
 *
 * @return void
 */
function historyExportCleanupRegisteredDirs(): void
{
    global $historyExportCleanupDirs;

    foreach (array_reverse($historyExportCleanupDirs) as $dir) {
        historyExportDeleteDir($dir);
    }

    $historyExportCleanupDirs = [];
}

/**
 * 外部コマンドを安全に実行して標準出力を返すルン。
 *
 * @param array<int, string> $command 実行コマンド
 * @param string|null $cwd 実行ディレクトリ
 * @return string 標準出力
 * @throws RuntimeException 実行失敗時
 */
function historyExportRunCommand(array $command, ?string $cwd = null): string
{
    $descriptorSpec = [
        0 => ['pipe', 'r'],
        1 => ['pipe', 'w'],
        2 => ['pipe', 'w'],
    ];

    $process = proc_open($command, $descriptorSpec, $pipes, $cwd);
    if (!is_resource($process)) {
        throw new RuntimeException('外部コマンドの起動に失敗しました。');
    }

    fclose($pipes[0]);
    $stdout = stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    $stderr = stream_get_contents($pipes[2]);
    fclose($pipes[2]);
    $exitCode = proc_close($process);

    if ($exitCode !== 0) {
        throw new RuntimeException('外部コマンド実行失敗: ' . implode(' ', $command) . ' stderr=' . trim($stderr));
    }

    return trim((string)$stdout);
}

/**
 * 候補一覧から利用可能な実行ファイルを探すルン。
 *
 * @param array<int, string> $candidates コマンド候補
 * @return string|null 見つかった実行ファイルのパス
 */
function historyExportFindExecutable(array $candidates): ?string
{
    foreach ($candidates as $candidate) {
        if (!is_string($candidate) || $candidate === '') {
            continue;
        }

        if (str_contains($candidate, DIRECTORY_SEPARATOR) && is_executable($candidate)) {
            return $candidate;
        }

        $resolved = trim((string)shell_exec('command -v ' . escapeshellarg($candidate) . ' 2>/dev/null'));
        if ($resolved !== '' && is_executable($resolved)) {
            return $resolved;
        }
    }

    return null;
}

/**
 * CSRF 用 cookie の属性を返すルン。
 *
 * @return array<string, int|string|bool> cookie オプション
 */
function historyExportCookieParams(): array
{
    $isHttps = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (isset($_SERVER['SERVER_PORT']) && (string)$_SERVER['SERVER_PORT'] === '443');

    return [
        'expires' => time() + 3600,
        'path' => '/',
        'secure' => $isHttps,
        'httponly' => false,
        'samesite' => 'Lax',
    ];
}

/**
 * CSRF token を cookie ベースで払い出すルン。
 *
 * @return string CSRF token
 * @throws Exception 乱数生成失敗時
 */
function historyExportEnsureCsrfToken(): string
{
    $cookie = getCookie();
    $token = $cookie[HISTORY_EXPORT_CSRF_COOKIE] ?? '';

    if (!is_string($token) || !preg_match('/\A[a-f0-9]{64}\z/', $token)) {
        $token = bin2hex(random_bytes(32));
        setcookie(HISTORY_EXPORT_CSRF_COOKIE, $token, historyExportCookieParams());
        $_COOKIE[HISTORY_EXPORT_CSRF_COOKIE] = $token;
        historyExportPerfLog('csrf.cookie_issued');
    } else {
        historyExportPerfLog('csrf.cookie_reused');
    }

    return $token;
}

/**
 * SQLite に接続するルン。export 画面は既存 DB をそのまま使うルン。
 *
 * @return PDO SQLite 接続
 * @throws RuntimeException DB ファイルが無い場合
 * @throws PDOException 接続失敗時
 */
function openHistoryExportDb(): PDO
{
    $startedAt = microtime(true);
    $dbPath = HISTORY_EXPORT_BASE_DIR . '/../data/db/comistream.sqlite';
    if (!is_file($dbPath)) {
        throw new RuntimeException('履歴データベースが見つかりません。');
    }

    $dbh = new PDO('sqlite:' . $dbPath);
    $dbh->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $dbh->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $dbh->exec('PRAGMA busy_timeout = 3000');

    historyExportPerfLog('db.open', [
        'stage_ms' => round((microtime(true) - $startedAt) * 1000, 1),
        'db_path' => $dbPath,
    ]);

    return $dbh;
}

/**
 * ログイン中ユーザー名を cookie から取るルン。
 *
 * @return string ユーザー名。未ログイン時は guest
 */
function historyExportLoginUser(): string
{
    $cookie = getCookie();
    $user = $cookie['comistreamUser'] ?? 'guest';
    return is_string($user) ? trim($user) : 'guest';
}

/**
 * エクスポート実行可能なログイン状態か判定するルン。
 *
 * @param string $loginUser ログイン中ユーザー
 * @return bool guest 以外なら true
 */
function historyExportIsAuthenticated(string $loginUser): bool
{
    return $loginUser !== '' && $loginUser !== 'guest';
}

/**
 * CSRF token の妥当性を検証するルン。
 *
 * @param string|null $token フォームから来た token
 * @return bool 検証結果
 */
function historyExportIsValidCsrfToken(?string $token): bool
{
    $cookie = getCookie();
    $cookieToken = $cookie[HISTORY_EXPORT_CSRF_COOKIE] ?? '';

    return is_string($token)
        && is_string($cookieToken)
        && $token !== ''
        && hash_equals($cookieToken, $token);
}

/**
 * DB にある履歴ユーザー候補を集めるルン。件数も一緒に出して選びやすくするルン。
 *
 * @param PDO $dbh DB 接続
 * @return array<int, array{user:string, record_count:int}>
 */
function fetchHistoryExportUsers(PDO $dbh): array
{
    $startedAt = microtime(true);
    $stmt = $dbh->query(
        'SELECT user, COUNT(*) AS record_count
         FROM book_history
         WHERE TRIM(COALESCE(user, \'\')) <> \'\'
         GROUP BY user
         ORDER BY LOWER(user), user'
    );

    $users = [];
    foreach ($stmt->fetchAll() as $row) {
        $user = trim((string)($row['user'] ?? ''));
        if ($user === '') {
            continue;
        }

        $users[] = [
            'user' => $user,
            'record_count' => (int)($row['record_count'] ?? 0),
        ];
    }

    historyExportPerfLog('db.fetch_users', [
        'stage_ms' => round((microtime(true) - $startedAt) * 1000, 1),
        'user_count' => count($users),
    ]);

    return $users;
}

/**
 * エクスポート元の deployment mode を推定するルン。
 *
 * @param PDO $dbh DB 接続
 * @param int $historyUserCount 履歴ユーザー数
 * @return string cloud / onpremise
 */
function detectHistoryExportDeploymentMode(PDO $dbh, int $historyUserCount): string
{
    try {
        $stmt = $dbh->query('SELECT COUNT(*) FROM users');
        $userCount = (int)$stmt->fetchColumn();
        if ($historyUserCount > 1 || $userCount > 1) {
            return 'cloud';
        }
    } catch (Throwable $e) {
        historyExportPerfLog('detect_deployment_mode_failed', ['message' => $e->getMessage()], 'WARNING');
    }

    return 'onpremise';
}

/**
 * SQLite の日時文字列を ISO 8601 に正規化するルン。
 *
 * @param string|null $value DB 上の日時文字列
 * @return string|null ISO 8601 形式。空なら null
 * @throws Exception 日時変換失敗時
 */
function formatHistoryExportTimestamp(?string $value): ?string
{
    if ($value === null) {
        return null;
    }

    $trimmed = trim($value);
    if ($trimmed === '') {
        return null;
    }

    $localTimezone = new DateTimeZone(date_default_timezone_get());

    if (preg_match('/([+-]\d{2}:\d{2}|Z)$/', $trimmed) === 1) {
        $timestamp = new DateTimeImmutable($trimmed);
    } else {
        $timestamp = new DateTimeImmutable($trimmed, new DateTimeZone('UTC'));
        $timestamp = $timestamp->setTimezone($localTimezone);
    }

    return $timestamp->format(DATE_ATOM);
}

/**
 * 履歴本体を JSON 形式に合わせて整えるルン。
 *
 * @param PDO $dbh DB 接続
 * @param string $targetUser 対象ユーザー
 * @return array<int, array<string, int|string|null>>
 */
function fetchHistoryExportRows(PDO $dbh, string $targetUser): array
{
    $stmt = $dbh->prepare(
        'SELECT
            base_file,
            relative_path,
            current_page,
            max_page,
            favorite,
            has_read,
            created_at,
            updated_at
         FROM book_history
         WHERE user = :user
         ORDER BY COALESCE(updated_at, created_at) DESC, base_file COLLATE NOCASE'
    );
    $stmt->execute([':user' => $targetUser]);

    $history = [];
    foreach ($stmt->fetchAll() as $row) {
        $history[] = [
            'base_file' => (string)($row['base_file'] ?? ''),
            'relative_path' => (string)($row['relative_path'] ?? ''),
            'current_page' => (int)($row['current_page'] ?? 0),
            'max_page' => (int)($row['max_page'] ?? 0),
            'favorite' => (int)($row['favorite'] ?? 0),
            'has_read' => (int)($row['has_read'] ?? 0),
            'created_at' => formatHistoryExportTimestamp($row['created_at'] ?? null),
            'updated_at' => formatHistoryExportTimestamp($row['updated_at'] ?? null),
        ];
    }

    return $history;
}

/**
 * relation テーブルは base_file_hash で履歴とひも付けるルン。
 *
 * @param PDO $dbh DB 接続
 * @param string $targetUser 対象ユーザー
 * @return array<int, array<string, int|string>>
 */
function fetchHistoryExportRelations(PDO $dbh, string $targetUser): array
{
    $stmt = $dbh->prepare(
        'SELECT DISTINCT
            COALESCE(NULLIF(rel.filename, \'\'), bh.base_file) AS base_file,
            rel.book_code_type,
            rel.book_code
         FROM book_history AS bh
         INNER JOIN book_id_relation AS rel
            ON rel.base_file_hash = bh.base_file_hash
         WHERE bh.user = :user
           AND TRIM(COALESCE(rel.book_code, \'\')) <> \'\'
         ORDER BY base_file COLLATE NOCASE, rel.book_code COLLATE NOCASE'
    );
    $stmt->execute([':user' => $targetUser]);

    $relations = [];
    foreach ($stmt->fetchAll() as $row) {
        $relations[] = [
            'base_file' => (string)($row['base_file'] ?? ''),
            'book_code_type' => (int)($row['book_code_type'] ?? 1),
            'book_code' => (string)($row['book_code'] ?? ''),
        ];
    }

    return $relations;
}

/**
 * 画面に出す簡単な集計ルン。選択前にも件数が見えると安心ルン。
 *
 * @param PDO $dbh DB 接続
 * @param string $targetUser 対象ユーザー
 * @return array{history_count:int, relation_count:int}
 */
function fetchHistoryExportSummary(PDO $dbh, string $targetUser): array
{
    $startedAt = microtime(true);
    $historyStmt = $dbh->prepare('SELECT COUNT(*) FROM book_history WHERE user = :user');
    $historyStmt->execute([':user' => $targetUser]);

    $relationStmt = $dbh->prepare(
        'SELECT COUNT(*) FROM (
            SELECT DISTINCT rel.book_code_type, rel.book_code, COALESCE(NULLIF(rel.filename, \'\'), bh.base_file) AS base_file
            FROM book_history AS bh
            INNER JOIN book_id_relation AS rel
                ON rel.base_file_hash = bh.base_file_hash
            WHERE bh.user = :user
              AND TRIM(COALESCE(rel.book_code, \'\')) <> \'\'
        )'
    );
    $relationStmt->execute([':user' => $targetUser]);

    $summary = [
        'history_count' => (int)$historyStmt->fetchColumn(),
        'relation_count' => (int)$relationStmt->fetchColumn(),
    ];

    historyExportPerfLog('db.fetch_summary', [
        'stage_ms' => round((microtime(true) - $startedAt) * 1000, 1),
        'target_user' => $targetUser,
        'history_count' => $summary['history_count'],
        'relation_count' => $summary['relation_count'],
    ]);

    return $summary;
}

/**
 * 履歴 NDJSON 用のカーソルを返すルン。
 *
 * @param PDO $dbh DB 接続
 * @param string $targetUser 対象ユーザー
 * @return PDOStatement 実行済みステートメント
 */
function createHistoryExportHistoryStatement(PDO $dbh, string $targetUser): PDOStatement
{
    $startedAt = microtime(true);
    $stmt = $dbh->prepare(
        'SELECT
            base_file,
            relative_path,
            current_page,
            max_page,
            favorite,
            has_read,
            created_at,
            updated_at
         FROM book_history
         WHERE user = :user
         ORDER BY COALESCE(updated_at, created_at) DESC, base_file COLLATE NOCASE'
    );
    $stmt->execute([':user' => $targetUser]);

    historyExportPerfLog('db.history_cursor_ready', [
        'stage_ms' => round((microtime(true) - $startedAt) * 1000, 1),
        'target_user' => $targetUser,
    ]);

    return $stmt;
}

/**
 * 書籍関連 NDJSON 用のカーソルを返すルン。
 *
 * @param PDO $dbh DB 接続
 * @param string $targetUser 対象ユーザー
 * @return PDOStatement 実行済みステートメント
 */
function createHistoryExportRelationStatement(PDO $dbh, string $targetUser): PDOStatement
{
    $startedAt = microtime(true);
    $stmt = $dbh->prepare(
        'SELECT DISTINCT
            COALESCE(NULLIF(rel.filename, \'\'), bh.base_file) AS base_file,
            rel.book_code_type,
            rel.book_code
         FROM book_history AS bh
         INNER JOIN book_id_relation AS rel
            ON rel.base_file_hash = bh.base_file_hash
         WHERE bh.user = :user
           AND TRIM(COALESCE(rel.book_code, \'\')) <> \'\'
         ORDER BY base_file COLLATE NOCASE, rel.book_code COLLATE NOCASE'
    );
    $stmt->execute([':user' => $targetUser]);

    historyExportPerfLog('db.relation_cursor_ready', [
        'stage_ms' => round((microtime(true) - $startedAt) * 1000, 1),
        'target_user' => $targetUser,
    ]);

    return $stmt;
}

/**
 * 履歴レコードを export 用の配列へ変換するルン。
 *
 * @param array<string, mixed> $row DB レコード
 * @return array<string, int|string|null> export 用レコード
 */
function mapHistoryExportRow(array $row): array
{
    return [
        'base_file' => (string)($row['base_file'] ?? ''),
        'relative_path' => (string)($row['relative_path'] ?? ''),
        'current_page' => (int)($row['current_page'] ?? 0),
        'max_page' => (int)($row['max_page'] ?? 0),
        'favorite' => (int)($row['favorite'] ?? 0),
        'has_read' => (int)($row['has_read'] ?? 0),
        'created_at' => formatHistoryExportTimestamp($row['created_at'] ?? null),
        'updated_at' => formatHistoryExportTimestamp($row['updated_at'] ?? null),
    ];
}

/**
 * 書籍関連レコードを export 用の配列へ変換するルン。
 *
 * @param array<string, mixed> $row DB レコード
 * @return array<string, int|string> export 用レコード
 */
function mapHistoryExportRelationRow(array $row): array
{
    return [
        'base_file' => (string)($row['base_file'] ?? ''),
        'book_code_type' => (int)($row['book_code_type'] ?? 1),
        'book_code' => (string)($row['book_code'] ?? ''),
    ];
}

/**
 * BLAKE3 コマンドを解決するルン。
 *
 * @return string 実行ファイルパス
 * @throws RuntimeException コマンドが見つからない場合
 */
function historyExportResolveBlake3Command(): string
{
    global $conf;

    $candidates = [];
    $configured = $conf['md5cmd'] ?? '';
    if (is_string($configured) && $configured !== '') {
        $parts = preg_split('/\s+/', trim($configured));
        $command = $parts[0] ?? '';
        if (preg_match('/(?:^|\/)(b3sum|blake3)$/', $command) === 1) {
            $candidates[] = $command;
        }
    }

    $candidates = array_merge($candidates, ['b3sum', 'blake3', '/usr/bin/b3sum', '/usr/local/bin/b3sum']);
    $resolved = historyExportFindExecutable($candidates);
    if ($resolved === null) {
        throw new RuntimeException('BLAKE3 コマンドが見つかりません。b3sum か blake3 を利用可能にしてください。');
    }

    historyExportPerfLog('bundle.blake3_command_resolved', ['command' => $resolved]);
    return $resolved;
}

/**
 * tar コマンドを解決するルン。
 *
 * @return string 実行ファイルパス
 * @throws RuntimeException コマンドが見つからない場合
 */
function historyExportResolveTarCommand(): string
{
    $resolved = historyExportFindExecutable(['tar', '/usr/bin/tar', '/bin/tar']);
    if ($resolved === null) {
        throw new RuntimeException('tar コマンドが見つかりません。');
    }

    historyExportPerfLog('bundle.tar_command_resolved', ['command' => $resolved]);
    return $resolved;
}

/**
 * zstd コマンドを解決するルン。
 *
 * @return string 実行ファイルパス
 * @throws RuntimeException コマンドが見つからない場合
 */
function historyExportResolveZstdCommand(): string
{
    $resolved = historyExportFindExecutable(['zstd', '/usr/bin/zstd', '/usr/local/bin/zstd']);
    if ($resolved === null) {
        throw new RuntimeException('zstd コマンドが見つかりません。');
    }

    historyExportPerfLog('bundle.zstd_command_resolved', ['command' => $resolved]);
    return $resolved;
}

/**
 * エクスポート用の一時作業ディレクトリを作るルン。
 *
 * @return string 作業ディレクトリ
 * @throws RuntimeException 作成失敗時
 */
function historyExportCreateWorkDir(): string
{
    global $conf;

    $root = $conf['comistream_tmp_dir_root'] ?? sys_get_temp_dir();
    if (!is_string($root) || $root === '') {
        $root = sys_get_temp_dir();
    }

    $root = rtrim($root, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'history_export';
    if (!chkAndMakeDir($root)) {
        throw new RuntimeException('エクスポート作業ディレクトリの作成に失敗しました。');
    }

    $dir = $root . DIRECTORY_SEPARATOR . 'bundle_' . date('Ymd_His') . '_' . bin2hex(random_bytes(4));
    if (!mkdir($dir, 0700, true) && !is_dir($dir)) {
        throw new RuntimeException('エクスポート一時ディレクトリの作成に失敗しました。');
    }

    historyExportRegisterCleanupDir($dir);
    historyExportPerfLog('bundle.workdir_created', ['dir' => $dir]);
    return $dir;
}

/**
 * 履歴を `history.ndjson` へ逐次書き出すルン。
 *
 * @param PDO $dbh DB 接続
 * @param string $targetUser 対象ユーザー
 * @param string $path 出力先パス
 * @return int 書き出した件数
 * @throws RuntimeException ファイル作成失敗時
 */
function historyExportWriteHistoryNdjson(PDO $dbh, string $targetUser, string $path): int
{
    $startedAt = microtime(true);
    $fh = fopen($path, 'wb');
    if ($fh === false) {
        throw new RuntimeException('history.ndjson を作成できません。');
    }

    $stmt = createHistoryExportHistoryStatement($dbh, $targetUser);
    $count = 0;

    try {
        while (($row = $stmt->fetch(PDO::FETCH_ASSOC)) !== false) {
            fwrite($fh, historyExportJsonEncode(mapHistoryExportRow($row)) . "\n");
            $count++;
        }
    } finally {
        fclose($fh);
    }

    historyExportPerfLog('bundle.history_written', [
        'stage_ms' => round((microtime(true) - $startedAt) * 1000, 1),
        'rows' => $count,
        'path' => $path,
    ]);

    return $count;
}

/**
 * 書籍関連を `book_relations.ndjson` へ逐次書き出すルン。
 *
 * @param PDO $dbh DB 接続
 * @param string $targetUser 対象ユーザー
 * @param string $path 出力先パス
 * @return int 書き出した件数
 * @throws RuntimeException ファイル作成失敗時
 */
function historyExportWriteRelationNdjson(PDO $dbh, string $targetUser, string $path): int
{
    $startedAt = microtime(true);
    $fh = fopen($path, 'wb');
    if ($fh === false) {
        throw new RuntimeException('book_relations.ndjson を作成できません。');
    }

    $stmt = createHistoryExportRelationStatement($dbh, $targetUser);
    $count = 0;

    try {
        while (($row = $stmt->fetch(PDO::FETCH_ASSOC)) !== false) {
            fwrite($fh, historyExportJsonEncode(mapHistoryExportRelationRow($row)) . "\n");
            $count++;
        }
    } finally {
        fclose($fh);
    }

    historyExportPerfLog('bundle.relations_written', [
        'stage_ms' => round((microtime(true) - $startedAt) * 1000, 1),
        'rows' => $count,
        'path' => $path,
    ]);

    return $count;
}

/**
 * 外部コマンドで BLAKE3 digest を計算するルン。
 *
 * @param string $command BLAKE3 コマンド
 * @param string $path 対象ファイル
 * @return string 16進 digest
 * @throws RuntimeException digest 取得失敗時
 */
function historyExportComputeBlake3(string $command, string $path): string
{
    $startedAt = microtime(true);
    $output = historyExportRunCommand([$command, $path]);
    $hash = preg_split('/\s+/', trim($output))[0] ?? '';

    if (!preg_match('/\A[0-9a-f]{64}\z/i', $hash)) {
        throw new RuntimeException('BLAKE3 digest の取得に失敗しました。');
    }

    historyExportPerfLog('bundle.blake3_computed', [
        'stage_ms' => round((microtime(true) - $startedAt) * 1000, 1),
        'path' => $path,
    ]);

    return strtolower($hash);
}

/**
 * manifest.json の内容を組み立てるルン。
 *
 * @param PDO $dbh DB 接続
 * @param string $targetUser 対象ユーザー
 * @param int $historyUserCount 履歴ユーザー数
 * @param int $historyCount history.ndjson 件数
 * @param int $relationCount book_relations.ndjson 件数
 * @param string $historyDigest history.ndjson の BLAKE3
 * @param string $relationDigest book_relations.ndjson の BLAKE3
 * @return array<string, mixed> manifest 内容
 */
function historyExportBuildManifest(
    PDO $dbh,
    string $targetUser,
    int $historyUserCount,
    int $historyCount,
    int $relationCount,
    string $historyDigest,
    string $relationDigest
): array {
    return [
        'format' => 'comistream-history-bundle',
        'format_version' => HISTORY_EXPORT_FORMAT_VERSION,
        'exported_at' => (new DateTimeImmutable('now'))->format(DATE_ATOM),
        'scope' => [
            'type' => 'single_user',
            'user' => $targetUser,
        ],
        'source' => [
            'application' => 'Comistream Reader',
            'deployment_mode' => detectHistoryExportDeploymentMode($dbh, $historyUserCount),
        ],
        'archive' => [
            'container' => 'tar.zst',
            'encoding' => 'UTF-8',
            'line_ending' => 'LF',
        ],
        'files' => [
            'history' => [
                'path' => 'history.ndjson',
                'record_count' => $historyCount,
                'digests' => [
                    'blake3' => $historyDigest,
                ],
            ],
            'book_relations' => [
                'path' => 'book_relations.ndjson',
                'record_count' => $relationCount,
                'digests' => [
                    'blake3' => $relationDigest,
                ],
            ],
        ],
    ];
}

/**
 * 新仕様の履歴エクスポート bundle を作成するルン。
 *
 * @param PDO $dbh DB 接続
 * @param string $targetUser 対象ユーザー
 * @param int $historyUserCount 履歴ユーザー数
 * @return array{archive_path:string, download_name:string, history_count:int, relation_count:int}
 * @throws RuntimeException bundle 作成失敗時
 */
function historyExportCreateBundle(PDO $dbh, string $targetUser, int $historyUserCount): array
{
    $startedAt = microtime(true);
    $safeUser = preg_replace('/[^A-Za-z0-9_.-]/', '_', $targetUser) ?: 'user';
    $timestamp = (new DateTimeImmutable('now'))->format('Ymd\\THisP');
    $downloadName = sprintf('comistream-history-v2-%s-%s.tar.zst', $safeUser, str_replace(':', '', $timestamp));

    $workDir = historyExportCreateWorkDir();
    $historyPath = $workDir . '/history.ndjson';
    $relationsPath = $workDir . '/book_relations.ndjson';
    $manifestPath = $workDir . '/manifest.json';
    $tarPath = $workDir . '/bundle.tar';
    $archivePath = $workDir . '/bundle.tar.zst';

    $historyCount = historyExportWriteHistoryNdjson($dbh, $targetUser, $historyPath);
    $relationCount = historyExportWriteRelationNdjson($dbh, $targetUser, $relationsPath);

    $blake3Command = historyExportResolveBlake3Command();
    $historyDigest = historyExportComputeBlake3($blake3Command, $historyPath);
    $relationDigest = historyExportComputeBlake3($blake3Command, $relationsPath);

    $manifest = historyExportBuildManifest(
        $dbh,
        $targetUser,
        $historyUserCount,
        $historyCount,
        $relationCount,
        $historyDigest,
        $relationDigest
    );

    file_put_contents($manifestPath, historyExportPrettyJsonEncode($manifest) . "\n");
    historyExportPerfLog('bundle.manifest_written', ['path' => $manifestPath]);

    $tarCommand = historyExportResolveTarCommand();
    historyExportRunCommand([$tarCommand, '-cf', $tarPath, 'manifest.json', 'history.ndjson', 'book_relations.ndjson'], $workDir);
    historyExportPerfLog('bundle.tar_created', ['path' => $tarPath]);

    $zstdCommand = historyExportResolveZstdCommand();
    historyExportRunCommand([$zstdCommand, '-q', '-f', $tarPath, '-o', $archivePath], $workDir);
        historyExportPerfLog('bundle.tar_zst_created', [
            'stage_ms' => round((microtime(true) - $startedAt) * 1000, 1),
            'path' => $archivePath,
    ], 'INFO');

    if (!is_file($archivePath)) {
        throw new RuntimeException('tar.zst アーカイブの生成に失敗しました。');
    }

    return [
        'archive_path' => $archivePath,
        'download_name' => $downloadName,
        'history_count' => $historyCount,
        'relation_count' => $relationCount,
    ];
}

/**
 * 作成済み bundle をダウンロード出力するルン。
 *
 * @param PDO $dbh DB 接続
 * @param string $targetUser 対象ユーザー
 * @param int $historyUserCount 履歴ユーザー数
 * @return void
 */
function outputHistoryExportDownload(PDO $dbh, string $targetUser, int $historyUserCount): void
{
    $startedAt = microtime(true);
    $bundle = historyExportCreateBundle($dbh, $targetUser, $historyUserCount);
    $archivePath = $bundle['archive_path'];
    $filename = $bundle['download_name'];

    while (ob_get_level() > 0) {
        ob_end_clean();
    }

    header('Content-Type: application/octet-stream');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Content-Length: ' . (string)filesize($archivePath));
    header('X-Content-Type-Options: nosniff');

    historyExportPerfLog('stream.start', [
        'target_user' => $targetUser,
        'history_count' => $bundle['history_count'],
        'relation_count' => $bundle['relation_count'],
        'download_name' => $filename,
    ], 'INFO');

    readfile($archivePath);

    historyExportPerfLog('stream.finish', [
        'stage_ms' => round((microtime(true) - $startedAt) * 1000, 1),
        'history_rows' => $bundle['history_count'],
        'relation_rows' => $bundle['relation_count'],
    ], 'INFO');

    exit;
}

/**
 * エクスポート画面の HTML を描画するルン。
 *
 * @param string $csrfToken フォーム用 CSRF token
 * @param string $loginUser ログイン中ユーザー
 * @param array<int, array{user:string, record_count:int}> $historyUsers 候補ユーザー一覧
 * @param string $selectedUser 現在選択中のユーザー
 * @param array{history_count:int, relation_count:int} $summary 件数サマリー
 * @param string|null $errorMessage 表示用エラーメッセージ
 * @return void
 */
function renderHistoryExportPage(
    string $csrfToken,
    string $loginUser,
    array $historyUsers,
    string $selectedUser,
    array $summary,
    ?string $errorMessage = null
): void {
    $isMultiUser = count($historyUsers) > 1;
    $isAuthenticated = historyExportIsAuthenticated($loginUser);
    $title = 'Comistream History Export';
    $loginUrl = '../cgi-bin/comistream.php?mode=login&user=' . rawurlencode($loginUser);

    http_response_code($isAuthenticated ? 200 : 403);
    ?>
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?= htmlspecialchars($title, ENT_QUOTES, 'UTF-8') ?></title>
  <link rel="stylesheet" href="skeleton.css">
  <style>
    body { margin: 2rem auto; max-width: 760px; padding: 0 1.2rem; }
    .panel { border: 1px solid #d9d9d9; border-radius: 8px; padding: 1.5rem; background: #fff; }
    .error { color: #b00020; margin-bottom: 1rem; }
    .muted { color: #666; }
    .summary { margin: 1rem 0; padding: 0.9rem 1rem; background: #f6f7f8; border-radius: 6px; }
    code { background: #f4f4f4; padding: 0.1rem 0.35rem; border-radius: 4px; }
    .actions { margin-top: 1.5rem; display: flex; gap: 0.75rem; flex-wrap: wrap; }
  </style>
</head>
<body>
  <div class="panel">
    <h1>読書履歴エクスポート</h1>

    <?php if (!$isAuthenticated): ?>
      <p>エクスポートにはログインが必要です。</p>
      <p class="muted">先に通常の Comistream 画面でユーザーを設定してから開いてください。</p>
      <p><a href="<?= htmlspecialchars($loginUrl, ENT_QUOTES, 'UTF-8') ?>">管理者ログイン</a></p>
    <?php else: ?>
      <p class="muted">インポート可能な <code>tar.zst</code> 形式で、履歴と書籍関連情報をまとめて出力します。</p>

      <?php if ($errorMessage !== null && $errorMessage !== ''): ?>
        <p class="error"><?= htmlspecialchars($errorMessage, ENT_QUOTES, 'UTF-8') ?></p>
      <?php endif; ?>

      <?php if ($historyUsers === []): ?>
        <p>エクスポート対象の履歴がまだありません。</p>
      <?php else: ?>
        <form method="post" action="">
          <input type="hidden" name="csrf" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">

          <?php if ($isMultiUser): ?>
            <label for="target_user">エクスポートするユーザー</label>
            <select id="target_user" name="target_user">
              <?php foreach ($historyUsers as $historyUser): ?>
                <?php
                $userName = $historyUser['user'];
                $label = sprintf('%s (%d件)', $userName, $historyUser['record_count']);
                ?>
                <option value="<?= htmlspecialchars($userName, ENT_QUOTES, 'UTF-8') ?>"<?= $userName === $selectedUser ? ' selected' : '' ?>>
                  <?= htmlspecialchars($label, ENT_QUOTES, 'UTF-8') ?>
                </option>
              <?php endforeach; ?>
            </select>
          <?php else: ?>
            <input type="hidden" name="target_user" value="<?= htmlspecialchars($selectedUser, ENT_QUOTES, 'UTF-8') ?>">
            <p>対象ユーザー: <code><?= htmlspecialchars($selectedUser, ENT_QUOTES, 'UTF-8') ?></code></p>
          <?php endif; ?>

          <div class="summary">
            <p>対象ユーザー: <code><?= htmlspecialchars($selectedUser, ENT_QUOTES, 'UTF-8') ?></code></p>
            <p>履歴件数: <?= htmlspecialchars((string)$summary['history_count'], ENT_QUOTES, 'UTF-8') ?></p>
            <p>書籍関連件数: <?= htmlspecialchars((string)$summary['relation_count'], ENT_QUOTES, 'UTF-8') ?></p>
          </div>

          <div class="actions">
            <button type="submit">tar.zst をダウンロード</button>
          </div>
        </form>
      <?php endif; ?>
    <?php endif; ?>
  </div>
</body>
</html>
<?php
}

$dbh = null;
$loginUser = historyExportLoginUser();
$historyUsers = [];
$historyUserNames = [];
$selectedUser = $loginUser;
$summary = ['history_count' => 0, 'relation_count' => 0];
$csrfToken = historyExportEnsureCsrfToken();

try {
    historyExportPerfLog('request.enter', ['login_user' => $loginUser]);
    $dbh = openHistoryExportDb();
    readConfig($dbh);
    $historyUsers = fetchHistoryExportUsers($dbh);
    $historyUserNames = array_column($historyUsers, 'user');

    $selectedUser = $loginUser;
    if ($historyUsers !== []) {
        if (in_array($loginUser, $historyUserNames, true)) {
            $selectedUser = $loginUser;
        } else {
            $selectedUser = (string)$historyUsers[0]['user'];
        }
    }

    $errorMessage = null;

    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        historyExportPerfLog('request.post_entered', ['target_user' => $_POST['target_user'] ?? ''], 'INFO');
        if (!historyExportIsAuthenticated($loginUser)) {
            throw new RuntimeException('ログイン状態が確認できませんでした。');
        }

        if (!historyExportIsValidCsrfToken($_POST['csrf'] ?? null)) {
            throw new RuntimeException('CSRF トークンの検証に失敗しました。');
        }

        $requestedUser = trim((string)($_POST['target_user'] ?? ''));
        if ($requestedUser === '' || !in_array($requestedUser, $historyUserNames, true)) {
            throw new RuntimeException('エクスポート対象ユーザーが不正です。');
        }

        historyExportPerfLog('request.post_validated', ['target_user' => $requestedUser], 'INFO');
        outputHistoryExportDownload($dbh, $requestedUser, count($historyUsers));
    }

    if ($historyUsers !== []) {
        $summary = fetchHistoryExportSummary($dbh, $selectedUser);
    }

    historyExportPerfLog('request.get_render_ready', [
        'selected_user' => $selectedUser,
        'history_user_count' => count($historyUsers),
    ]);
    renderHistoryExportPage($csrfToken, $loginUser, $historyUsers, $selectedUser, $summary, $errorMessage);
} catch (Throwable $e) {
    historyExportPerfLog('request.error', ['message' => $e->getMessage()], 'ERROR');

    if ($dbh instanceof PDO && $historyUsers !== [] && $selectedUser !== '') {
        try {
            $summary = fetchHistoryExportSummary($dbh, $selectedUser);
        } catch (Throwable $summaryError) {
            historyExportPerfLog('request.summary_fallback_failed', ['message' => $summaryError->getMessage()], 'WARNING');
        }
    }

    renderHistoryExportPage(
        $csrfToken,
        $loginUser,
        $historyUsers,
        $selectedUser,
        $summary,
        $e->getMessage()
    );
}
