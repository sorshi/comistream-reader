<?php

/**
 * Comistream Directory Listing
 *
 * Apacheのmod_autoindexの代わりにディレクトリリスティング表示を行います
 *
 * @package     sorshi/comistream-reader
 * @author      Comistream Project.
 * @copyright   2024-2025 Comistream Project.
 * @license     GPL3.0 License
 * @version     1.2.0
 * @link        https://github.com/sorshi/comistream-reader
 */

require_once __DIR__ . '/comistream_lib.php';

// Script configuration
ini_set('zlib.output_compression', '8');
ini_set('output_buffering', 'On');
error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);

// DB接続
$dbh = null;
if (isset($global_use_db_flag) && $global_use_db_flag == 1) {
    $db_path = __DIR__ . '/../data/db/comistream.sqlite';
    if (file_exists($db_path)) {
        $DSN = "sqlite:" . $db_path;
        try {
            $dbh = new PDO($DSN);
            $dbh->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            $dbh->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        } catch (PDOException $e) {
            // In a real app, you'd want to log this error properly
            error_log('Connection failed: ' . $e->getMessage());
            // For security, don't echo detailed errors to the user
            http_response_code(500);
            echo "Database connection error.";
            exit;
        }
    }
}

// Read config from DB if connected
if ($dbh) {
    readConfig($dbh);
    global $conf;
    $cgiPath = $conf['cgiPath'] ?? '/cgi-bin/comistream.php';
    $hlsCgiPath = $conf['hlsCgiPath'] ?? '/cgi-bin/livestream.php';
    $bibiPath = $conf['bibiPath'] ?? '/bibi/';
    $publicDir = $conf['publicDir'] ?? '';
} else {
    // Fallback to defaults if DB is not available
    $cgiPath = '/cgi-bin/comistream.php';
    $hlsCgiPath = '/cgi-bin/livestream.php';
    $bibiPath = '/bibi/';
    $publicDir = '';
}

function escape_problematic_chars($filepath)
{
    // 問題を引き起こす特定の文字のみをパーセントエンコード（/は保持）
    // 注意: '%' までエンコードすると "%25XX" となり、もともとエンコード済みのシーケンスが二重化するため除外する
    $problematic_chars = ['#', '?', '&', '=', '\\', ':', '@', '<', '>', '"', "'", '|', '*', ' '];
    $encoded_chars = array_map('rawurlencode', $problematic_chars);
    return str_replace($problematic_chars, $encoded_chars, $filepath);
}

// Define mappings from file extensions to icons.
// This replaces the AddIcon directives from .htaccess.
function get_icon_map()
{
    return [
        // Special icons
        '__parent' => '/theme/icons/folder-home.png',
        '__dir' => '/theme/icons/folder.png',

        // Book-like files
        '.zip' => '/theme/icons/book.png',
        '.cbz' => '/theme/icons/book.png',
        '.rar' => '/theme/icons/book.png',
        '.pdf' => '/theme/icons/book.png',
        '.epub' => '/theme/icons/book.png',
        '.ePub' => '/theme/icons/book.png',
        '.7z' => '/theme/icons/book.png',
        '.cb7' => '/theme/icons/book.png',

        // Other file types from the original .htaccess
        '.txt' => '/theme/icons/text.png',
        '.jpg' => '/theme/icons/image.png',
        '.jpeg' => '/theme/icons/image.png',
        '.jpe' => '/theme/icons/image.png',
        '.png' => '/theme/icons/image.png',
        '.gif' => '/theme/icons/image.png',
        '.bmp' => '/theme/icons/image.png',
        '.mp3' => '/theme/icons/audio.png',
        '.m4a' => '/theme/icons/audio.png',
        '.mp4' => '/theme/icons/video.png',
        '.mkv' => '/theme/icons/video.png',
        '.avi' => '/theme/icons/video.png',
        '.mov' => '/theme/icons/video.png',
        '.wmv' => '/theme/icons/video.png',
        '.webm' => '/theme/icons/video.png',
        '.bz2' => '/theme/icons/archive.png',
        '.cab' => '/theme/icons/archive.png',
        '.gz' => '/theme/icons/archive.png',
        '.tar' => '/theme/icons/archive.png',
        '.aac' => '/theme/icons/audio.png',
        '.flac' => '/theme/icons/audio.png',
        '.aif' => '/theme/icons/audio.png',
        '.aifc' => '/theme/icons/audio.png',
        '.aiff' => '/theme/icons/audio.png',
        '.ape' => '/theme/icons/audio.png',
        '.au' => '/theme/icons/audio.png',
        '.iff' => '/theme/icons/audio.png',
        '.mid' => '/theme/icons/audio.png',
        '.mpa' => '/theme/icons/audio.png',
        '.ra' => '/theme/icons/audio.png',
        '.wav' => '/theme/icons/audio.png',
        '.wave' => '/theme/icons/audio.png',
        '.wma' => '/theme/icons/audio.png',
        '.f4a' => '/theme/icons/audio.png',
        '.f4b' => '/theme/icons/audio.png',
        '.oga' => '/theme/icons/audio.png',
        '.ogg' => '/theme/icons/audio.png',
        '.xm' => '/theme/icons/audio.png',
        '.it' => '/theme/icons/audio.png',
        '.s3m' => '/theme/icons/audio.png',
        '.mod' => '/theme/icons/audio.png',
        '.bin' => '/theme/icons/bin.png',
        '.hex' => '/theme/icons/bin.png',
        '.c' => '/theme/icons/c.png',
        '.xlsx' => '/theme/icons/calc.png',
        '.xlsm' => '/theme/icons/calc.png',
        '.xltx' => '/theme/icons/calc.png',
        '.xltm' => '/theme/icons/calc.png',
        '.xlam' => '/theme/icons/calc.png',
        '.xlr' => '/theme/icons/calc.png',
        '.xls' => '/theme/icons/calc.png',
        '.csv' => '/theme/icons/calc.png',
        '.iso' => '/theme/icons/cd.png',
        '.cpp' => '/theme/icons/cpp.png',
        '.css' => '/theme/icons/css.png',
        '.sass' => '/theme/icons/css.png',
        '.scss' => '/theme/icons/css.png',
        '.deb' => '/theme/icons/deb.png',
        '.diff' => '/theme/icons/diff.png',
        '.doc' => '/theme/icons/doc.png',
        '.docx' => '/theme/icons/doc.png',
        '.docm' => '/theme/icons/doc.png',
        '.dot' => '/theme/icons/doc.png',
        '.dotx' => '/theme/icons/doc.png',
        '.dotm' => '/theme/icons/doc.png',
        '.log' => '/theme/icons/doc.png',
        '.msg' => '/theme/icons/doc.png',
        '.odt' => '/theme/icons/doc.png',
        '.pages' => '/theme/icons/doc.png',
        '.rtf' => '/theme/icons/doc.png',
        '.tex' => '/theme/icons/doc.png',
        '.wpd' => '/theme/icons/doc.png',
        '.wps' => '/theme/icons/doc.png',
        '.svg' => '/theme/icons/draw.png',
        '.svgz' => '/theme/icons/draw.png',
        '.ai' => '/theme/icons/eps.png',
        '.eps' => '/theme/icons/eps.png',
        '.exe' => '/theme/icons/exe.png',
        '.h' => '/theme/icons/h.png',
        '.hpp' => '/theme/icons/hpp.png',
        '.html' => '/theme/icons/html.png',
        '.xhtml' => '/theme/icons/html.png',
        '.shtml' => '/theme/icons/html.png',
        '.htm' => '/theme/icons/html.png',
        '.URL' => '/theme/icons/html.png',
        '.url' => '/theme/icons/html.png',
        '.ico' => '/theme/icons/ico.png',
        '.jar' => '/theme/icons/java.png',
        '.js' => '/theme/icons/js.png',
        '.json' => '/theme/icons/js.png',
        '.md' => '/theme/icons/markdown.png',
        '.pkg' => '/theme/icons/package.png',
        '.dmg' => '/theme/icons/package.png',
        '.php' => '/theme/icons/php.png',
        '.phtml' => '/theme/icons/php.png',
        '.m3u' => '/theme/icons/playlist.png',
        '.m3u8' => '/theme/icons/playlist.png',
        '.pls' => '/theme/icons/playlist.png',
        '.pls8' => '/theme/icons/playlist.png',
        '.ps' => '/theme/icons/ps.png',
        '.psd' => '/theme/icons/psd.png',
        '.py' => '/theme/icons/py.png',
        '.rb' => '/theme/icons/rb.png',
        '.rpm' => '/theme/icons/rpm.png',
        '.rss' => '/theme/icons/rss.png',
        '.bat' => '/theme/icons/script.png',
        '.cmd' => '/theme/icons/script.png',
        '.sh' => '/theme/icons/script.png',
        '.sql' => '/theme/icons/sql.png',
        '.tiff' => '/theme/icons/tiff.png',
        '.tif' => '/theme/icons/tiff.png',
        '.nfo' => '/theme/icons/text.png',
        // 動画ファイル
        '.mp4' => '/theme/icons/video.png',
        '.asf' => '/theme/icons/video.png',
        '.asx' => '/theme/icons/video.png',
        '.avi' => '/theme/icons/video.png',
        '.flv' => '/theme/icons/video.png',
        '.mkv' => '/theme/icons/video.png',
        '.mov' => '/theme/icons/video.png',
        '.mpg' => '/theme/icons/video.png',
        '.rm' => '/theme/icons/video.png',
        '.srt' => '/theme/icons/video.png',
        '.swf' => '/theme/icons/video.png',
        '.vob' => '/theme/icons/video.png',
        '.wmv' => '/theme/icons/video.png',
        '.webm' => '/theme/icons/video.png',
        '.m4v' => '/theme/icons/video.png',
        '.f4v' => '/theme/icons/video.png',
        '.f4p' => '/theme/icons/video.png',
        '.ogv' => '/theme/icons/video.png',
        '.m2t' => '/theme/icons/video.png',
        '.ts' => '/theme/icons/video.png',
        // アーカイブファイル（書籍以外の圧縮ファイル）
        '.bz2' => '/theme/icons/archive.png',
        '.cab' => '/theme/icons/archive.png',
        '.gz' => '/theme/icons/archive.png',
        '.tar' => '/theme/icons/archive.png',
        // その他
        '.xml' => '/theme/icons/xml.png',
        '__default' => '/theme/icons/default.png'
    ];
}

function get_icon($filename, $is_dir)
{
    $map = get_icon_map();
    if ($is_dir) return $map['__dir'];
    $ext = strtolower(strrchr($filename, '.'));
    return $map[$ext] ?? $map['__default'];
}

function format_size($bytes)
{
    if ($bytes >= 1073741824) return number_format($bytes / 1073741824, 0) . 'G';
    if ($bytes >= 1048576) return number_format($bytes / 1048576, 0) . 'M';
    if ($bytes >= 1024) return number_format($bytes / 1024, 0) . 'K';
    if ($bytes > 0) return $bytes . 'B';
    return '-';
}

function normalize_kana_for_sort($str)
{
    // 安全性チェック：NULL や空文字の場合はそのまま返す
    if (!isset($str) || $str === '') {
        return $str;
    }

    // 初回のみ詳細なデバッグ情報を出力
    static $debug_logged = false;
    if (!$debug_logged) {
        $debug_logged = true;
        $mbstring_loaded = extension_loaded('mbstring');
        $mb_convert_kana_exists = function_exists('mb_convert_kana');
        $mb_strtolower_exists = function_exists('mb_strtolower');

        writelog("DEBUG normalize_kana_for_sort: Extension loaded: " . ($mbstring_loaded ? 'YES' : 'NO'), "dir_list");
        writelog("DEBUG normalize_kana_for_sort: mb_convert_kana exists: " . ($mb_convert_kana_exists ? 'YES' : 'NO'), "dir_list");
        writelog("DEBUG normalize_kana_for_sort: mb_strtolower exists: " . ($mb_strtolower_exists ? 'YES' : 'NO'), "dir_list");

        // PHP バージョンも記録
        writelog("DEBUG normalize_kana_for_sort: PHP version: " . PHP_VERSION, "dir_list");
    }

    try {
        // より安全な実装：段階的にフォールバック
        if (function_exists('mb_strtolower')) {
            // mb_strtolowerが使えるなら、まずはこれで小文字化
            $normalized = mb_strtolower($str, 'UTF-8');

            // mb_convert_kanaが使えるならカナ変換も実行
            if (function_exists('mb_convert_kana')) {
                // 実際に関数を呼び出してテスト（カタカナ→ひらがな変換をテスト）
                $test_result = @mb_convert_kana('テスト', 'c', 'UTF-8');
                if ($test_result !== false && $test_result !== null) {
                    // 半角カタカナを全角カタカナに変換: 'H'
                    // 全角カタカナをひらがなに変換: 'c'  
                    // 全角・半角英数字を半角に変換: 'as'
                    $normalized = mb_convert_kana($normalized, 'cHas', 'UTF-8');
                } else {
                    writelog("WARNING normalize_kana_for_sort: mb_convert_kana exists but returns false/null", "dir_list");
                }
            } else {
                // mb_convert_kanaが使えない場合は基本的な変換のみ
                writelog("INFO normalize_kana_for_sort: mb_convert_kana not available, using basic normalization for: '$str'", "dir_list");
            }

            return $normalized;
        } else {
            // mbstring関数が全く使えない場合は通常の処理にフォールバック
            writelog("INFO normalize_kana_for_sort: mbstring functions not available, using basic strtolower for: '$str'", "dir_list");
            return strtolower($str);
        }
    } catch (Exception $e) {
        // エラーが発生した場合は元の文字列を小文字化して返す
        writelog("WARNING normalize_kana_for_sort: Error processing '$str': " . $e->getMessage(), "dir_list");
        return strtolower($str);
    } catch (Throwable $t) {
        // PHP 7.x+ のより包括的なエラーハンドリング
        writelog("WARNING normalize_kana_for_sort: Throwable error processing '$str': " . $t->getMessage(), "dir_list");
        return strtolower($str);
    }
}

// Main script execution
$document_root = $_SERVER['DOCUMENT_ROOT'];
$request_path = $_GET['path'] ?? '';

writelog("INFO dir_list: Raw path param: " . $request_path, "dir_list");

// Sanitize to prevent directory traversal and handle problematic characters
// 1. URLデコード（1回のみ） - rawurldecode()を使用して+をスペースに変換しない
$request_path = rawurldecode($request_path);

// 2. 危険な文字を除去
$request_path = str_replace([
    "\0",        // null byte
    "\r",        // carriage return
    "\n",        // newline
    "\t",        // tab
    chr(7),      // bell
    chr(8),      // backspace
    chr(11),     // vertical tab
    chr(12),     // form feed
], '', $request_path);

// 3. 相対パス攻撃を防ぐ
$request_path = str_replace(['../', '.\\', '..\\'], '', $request_path);

// 4. パスを正規化
$request_path = '/' . ltrim($request_path, '/');

writelog("INFO dir_list: Sanitized path: " . $request_path, "dir_list");

// 5. 物理パス検証とHTTPステータス整理
// - 存在しないディレクトリ: 404
// - DocumentRoot範囲外（指定不可能なはず）: 404
// - 読み取り不可ディレクトリ: 403

// 404モードフラグの初期化（エラー時に空ディレクトリ表示へ）
$is_404_mode = false;

$document_root_real = realpath($document_root) ?: $document_root;
$joined_path = $document_root . $request_path; // サニタイズ済みのため単純連結でOK
$parent_realpath = realpath(dirname($joined_path));

if ($parent_realpath === false || strpos($parent_realpath, $document_root_real) !== 0) {
    // 親ディレクトリ自体が解決不能、またはDocumentRoot外
    http_response_code(404);
    writelog("ERROR dir_list: Out-of-docroot or invalid parent path: " . $request_path . " -> parent=" . ($parent_realpath ?: 'false'), "dir_list");
    $is_404_mode = true;
    $physical_path = null;
} elseif (!file_exists($joined_path)) {
    // 対象が存在しない
    http_response_code(404);
    writelog("ERROR dir_list: Not found: " . $request_path . " - showing empty directory layout", "dir_list");
    $is_404_mode = true;
    $physical_path = null;
} elseif (!is_dir($joined_path)) {
    // ディレクトリ以外
    http_response_code(404);
    writelog("ERROR dir_list: Not a directory attempt: " . $request_path . " - showing empty directory layout", "dir_list");
    $is_404_mode = true;
    $physical_path = null;
} elseif (!is_readable($joined_path) || !is_executable($joined_path)) {
    // ディレクトリだが読み込み不可（または実行権限なしで走査不可）
    http_response_code(403);
    writelog("ERROR dir_list: Directory not readable or not traversable: " . $request_path . " -> " . $joined_path, "dir_list");
    echo "403 Forbidden";
    exit;
} else {
    // ここまで来ればディレクトリとして妥当
    $physical_path = realpath($joined_path) ?: $joined_path;
}

// 以降、$is_404_mode が true の場合は空ディレクトリとして表示を継続

// セッション開始
session_start();

// ディレクトリ別ソート設定をセッションから取得
$current_path = $request_path; // 既に正規化済み
$sort_prefs = $_SESSION['dirSortPrefs'] ?? [];

// POSTリクエストでlocalStorageからのデータを受信
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action']) && $_POST['action'] === 'sync_sort_prefs') {
    if (isset($_POST['sort_prefs'])) {
        $localStorage_data = json_decode($_POST['sort_prefs'], true);
        if ($localStorage_data) {
            $_SESSION['dirSortPrefs'] = $localStorage_data;
            $sort_prefs = $localStorage_data;
        }
    }
    // Ajax レスポンス
    header('Content-Type: application/json');
    echo json_encode(['status' => 'success']);
    exit;
}

// ソート設定を取得（URLパラメータ優先、なければセッションから）
$sort_by = strtolower($_GET['sort'] ?? 'name');
$sort_order = strtolower($_GET['order'] ?? 'asc');

// URLパラメータがない場合はセッションから取得
if (!isset($_GET['sort']) && !isset($_GET['order'])) {
    if (isset($sort_prefs[$current_path])) {
        $sort_by = $sort_prefs[$current_path]['sort'] ?? 'name';
        $sort_order = $sort_prefs[$current_path]['order'] ?? 'asc';
    }
}

// バリデーション
if (!in_array($sort_by, ['name', 'lastmod', 'size'])) $sort_by = 'name';
if (!in_array($sort_order, ['asc', 'desc'])) $sort_order = 'asc';

// ソート設定が変更された場合はセッションを更新
if (isset($_GET['sort']) || isset($_GET['order'])) {
    $sort_prefs[$current_path] = [
        'sort' => $sort_by,
        'order' => $sort_order
    ];
    $_SESSION['dirSortPrefs'] = $sort_prefs;
}

// デバッグログ表示
// $debug_flag = json_encode(isset($global_debug_flag) ? $global_debug_flag : false);
$global_debug_flag = isset($global_debug_flag) ? $global_debug_flag : false;

$viewmode = $_COOKIE['viewmode'] ?? 'list';
$stylesheet_path = ($viewmode === 'cover')
    ? '/theme/style_cover.css?2025080200'
    : '/theme/style.css?2025080200';

header('Content-Type: text/html; charset=utf-8');

// JavaScript設定は処理完了後に作成するため、ここでは仮設定のみ
$js_config_temp = json_encode([
    'cgiPath' => $cgiPath,
    'hlsCgiPath' => $hlsCgiPath,
    'bibiPath' => $bibiPath,
    'publicDir' => $publicDir,
    'themeDir' => '', // themeDir seems to be consistently empty/root
    'currentPath' => $request_path, // Already normalized
    'loginUser' => $_COOKIE['comistreamUser'] ?? '',
    'hasSessionSortPrefs' => isset($_SESSION['dirSortPrefs']), // セッションにソート設定があるかどうか
    'currentSort' => $sort_by, // 現在のソート項目
    'currentOrder' => $sort_order, // 現在のソート順序
    'debugFlag' => $global_debug_flag // デバッグフラグ
]);

?>
<!DOCTYPE html>
<html>

<head>
    <meta charset="UTF-8">
    <title>Index of <?php echo htmlspecialchars($request_path); ?></title>
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <script>
        // Pass PHP config to Javascript (temporary config, will be updated after processing)
        const comistreamConfigTemp = <?php echo $js_config_temp; ?>;
        const cgiPath = comistreamConfigTemp.cgiPath;
        const hlsCgiPath = comistreamConfigTemp.hlsCgiPath;
        const bibiPath = comistreamConfigTemp.bibiPath;
        const publicDir = comistreamConfigTemp.publicDir;
        const themeDir = comistreamConfigTemp.themeDir;
        const loginuser = comistreamConfigTemp.loginUser;
        const hasSessionSortPrefs = comistreamConfigTemp.hasSessionSortPrefs;
        const debugFlag = comistreamConfigTemp.debugFlag;
        // PHPの設定に基づいてJavaScriptのデバッグフラグを設定
        // window.DEBUG_ENABLED = $debug_flag;
        (function() {
            // 即時関数の定義と実行
            window.debugLog = function(message) {
                if (debugFlag) {
                    console.debug(message);
                }
            };
        })();

        // localStorage + Session 同期処理
        window.addEventListener('DOMContentLoaded', function() {
            // セッションにソート設定がない場合のみlocalStorageから同期
            if (!hasSessionSortPrefs) {
                syncLocalStorageToSession();
            }

            // ソート変更時の処理
            document.addEventListener('click', function(e) {
                if (e.target.closest('th.indexcolname a, th.indexcollastmod a, th.indexcolsize a')) {
                    // ソート変更をlocalStorageに反映（非同期）
                    setTimeout(updateLocalStorageFromSession, 100);
                }
            });
        });

        function syncLocalStorageToSession() {
            const localSortPrefs = localStorage.getItem('dirSortPrefs');
            if (localSortPrefs) {
                const formData = new FormData();
                formData.append('action', 'sync_sort_prefs');
                formData.append('sort_prefs', localSortPrefs);

                fetch(window.location.href, {
                        method: 'POST',
                        body: formData
                    })
                    .then(response => response.json())
                    .then(data => {
                        if (data.status === 'success') {
                            // 同期完了後、必要に応じてページリロード
                            const currentPath = window.location.pathname;
                            const prefs = JSON.parse(localSortPrefs);
                            if (prefs[currentPath] && !window.location.search) {
                                // 保存された設定でソート
                                const sort = prefs[currentPath].sort;
                                const order = prefs[currentPath].order;
                                if (sort !== 'name' || order !== 'asc') {
                                    window.location.href = `${currentPath}?sort=${sort}&order=${order}`;
                                }
                            }
                        }
                    })
                    .catch(error => {
                        console.error('同期エラー:', error);
                    });
            }
        }

        function updateLocalStorageFromSession() {
            // 現在のソート設定をlocalStorageに保存
            const currentPath = window.location.pathname;
            const urlParams = new URLSearchParams(window.location.search);
            const sort = urlParams.get('sort') || 'name';
            const order = urlParams.get('order') || 'asc';

            let sortPrefs = JSON.parse(localStorage.getItem('dirSortPrefs') || '{}');
            sortPrefs[currentPath] = {
                sort,
                order
            };
            localStorage.setItem('dirSortPrefs', JSON.stringify(sortPrefs));
        }
    </script>
    <link rel="manifest" href="/theme/manifest.json" crossorigin="use-credentials">
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black">
    <meta name="apple-mobile-web-app-title" content="Comistream">
    <meta name="theme-color" content="#7799dd">
    <link rel="shortcut icon" href="/theme/icons/comistream.png" />
    <link rel="icon" type="image/png" href="/theme/icons/comistream.png" />
    <link rel="apple-touch-icon" href="/theme/icons/comistreamapp.png" />
    <link id="stylesheet" rel="stylesheet" href="<?php echo $stylesheet_path; ?>">
    <link rel="stylesheet" href="/theme/skeleton.css?2025082601">
    <script>
        // スケルトンローディング制御関数
        function showSkeletonLoading() {
            const viewmode = getCookie('viewmode') || 'list';

            // スケルトン表示中はフッターを非表示
            const footer = document.querySelector('.footer');
            if (footer) {
                footer.style.opacity = '0';
                footer.style.transition = 'opacity 0.3s ease';
            }

            if (viewmode === 'cover') {
                showCoverSkeleton();
            } else {
                showListSkeleton();
            }
        }

        function showListSkeleton() {
            const tbody = document.querySelector('#table-tbody');
            tbody.innerHTML = '';

            // スケルトン行を10個生成
            for (let i = 0; i < 10; i++) {
                const row = document.createElement('tr');
                row.className = 'skeleton-row';
                row.innerHTML = `
                    <td class="skeleton-cell skeleton-icon">
                        <div class="skeleton-placeholder"></div>
                    </td>
                    <td class="skeleton-cell skeleton-name">
                        <div class="skeleton-placeholder"></div>
                    </td>
                    <td class="skeleton-cell skeleton-lastmod">
                        <div class="skeleton-placeholder"></div>
                    </td>
                    <td class="skeleton-cell skeleton-size">
                        <div class="skeleton-placeholder"></div>
                    </td>
                `;
                tbody.appendChild(row);
            }
        }

        function showCoverSkeleton() {
            const tbody = document.querySelector('#table-tbody');
            tbody.innerHTML = '';

            // カバー表示用のスケルトンを12個生成（実際のカバービューレイアウトに合わせる）
            for (let i = 0; i < 12; i++) {
                const row = document.createElement('tr');
                row.className = 'skeleton-row';
                // カバービューモードのtr構造に合わせる
                row.style.cssText = `
                    display: inline-block !important;
                    position: relative !important;
                    width: 159px !important;
                    height: 310px !important;
                    margin: 3px !important;
                    border-bottom: 0px !important;
                `;
                row.innerHTML = `
                    <td class="indexcolicon" style="
                        display: block !important;
                        position: absolute !important;
                        width: 159px !important;
                        bottom: 90px !important;
                        box-sizing: border-box !important;
                        padding-left: 10px !important;
                        padding-right: 10px !important;
                        text-align: right !important;
                        z-index: 1 !important;
                    ">
                        <div class="skeleton-placeholder" style="width: 16px; height: 16px; background: #e9ecef; border-radius: 50%; margin-left: auto;">
                            <div style="position: absolute; top: 0; left: -100%; width: 100%; height: 100%; background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.7), transparent); animation: shimmer 1.5s infinite;"></div>
                        </div>
                    </td>
                    <td class="indexcolname" style="
                        display: block !important;
                        position: relative !important;
                        padding: 0px !important;
                        box-shadow: 0px 0px 15px -5px rgba(0, 0, 0, 0.8) !important;
                        height: 226px !important;
                        overflow: hidden !important;
                    ">
                        <div style="
                            position: absolute;
                            left: 0px;
                            top: 0px;
                            width: 159px;
                            height: 100%;
                            background: #e9ecef;
                            overflow: hidden;
                        ">
                            <div style="position: absolute; top: 0; left: -100%; width: 100%; height: 100%; background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.7), transparent); animation: shimmer 1.5s infinite;"></div>
                        </div>
                        <a style="
                            display: block !important;
                            padding: 5px !important;
                            font-size: 0.9em !important;
                            line-height: 1.1em !important;
                            text-align: left !important;
                            color: #444 !important;
                            position: relative !important;
                            height: 300px !important;
                            padding-top: 230px !important;
                            box-sizing: border-box !important;
                            overflow: hidden !important;
                            text-overflow: ellipsis !important;
                        ">
                            <div class="skeleton-placeholder" style="width: 80%; height: 14px; background: #e9ecef; border-radius: 4px; margin-bottom: 4px;">
                                <div style="position: absolute; top: 0; left: -100%; width: 100%; height: 100%; background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.7), transparent); animation: shimmer 1.5s infinite;"></div>
                            </div>
                            <div class="skeleton-placeholder" style="width: 60%; height: 14px; background: #e9ecef; border-radius: 4px;">
                                <div style="position: absolute; top: 0; left: -100%; width: 100%; height: 100%; background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.7), transparent); animation: shimmer 1.5s infinite;"></div>
                            </div>
                        </a>
                    </td>
                    <td class="indexcollastmod" style="display: none !important;"></td>
                    <td class="indexcolsize" style="display: none !important;"></td>
                `;
                tbody.appendChild(row);
            }
        }

        function hideSkeletonLoading(actualHtml) {
            const tbody = document.querySelector('#table-tbody');
            const tableContainer = document.getElementById('indexlist');

            debugLog('DEBUG hideSkeletonLoading: Starting smooth transition with background preservation');

            // 事前にカバービューの計算を実行（新コンテンツ用）
            try {
                if (typeof updateCoverSideGutter === 'function') {
                    updateCoverSideGutter();
                    debugLog('DEBUG hideSkeletonLoading: updateCoverSideGutter pre-calculated');
                }
            } catch (e) {
                console.error('ERROR hideSkeletonLoading: updateCoverSideGutter pre-calculation failed:', e);
            }

            // 背景色を維持してスムーズなトランジション開始
            requestAnimationFrame(() => {
                // テーブル背景色を一時的に固定（空白防止）
                const tableBackgroundColor = window.getComputedStyle(tableContainer).backgroundColor;
                tableContainer.style.backgroundColor = tableBackgroundColor || '#fff';
                tbody.style.backgroundColor = tableBackgroundColor || '#fff';

                // スケルトン行のスムーズフェードアウト
                const skeletonRows = tbody.querySelectorAll('.skeleton-row');
                skeletonRows.forEach(row => {
                    row.style.transition = 'opacity 0.2s ease-out';
                    row.style.opacity = '0';
                });

                // スケルトンフェードアウト完了を待ってコンテンツ置換
                setTimeout(() => {
                    // 実際のコンテンツを設定
                    tbody.innerHTML = actualHtml;
                    
                    // スケルトンクラスを削除
                    tableContainer.classList.remove('skeleton-loading');
                    tbody.classList.add('actual-content');
                    
                    // 新コンテンツを透明状態で設定（スムーズフェードイン準備）
                    tbody.style.opacity = '0';
                    tbody.style.transition = 'opacity 0.25s ease-in';

                    // 即座にフェードイン開始（背景色で隠れているため滑らか）
                    requestAnimationFrame(() => {
                        tbody.style.opacity = '1';

                        // フッターを表示
                        const footer = document.querySelector('.footer');
                        if (footer) {
                            footer.style.opacity = '1';
                        }

                        // フェードイン完了後に背景色スタイルをクリーンアップ
                        setTimeout(() => {
                            tableContainer.style.backgroundColor = '';
                            tbody.style.backgroundColor = '';
                            tbody.style.opacity = '';
                            tbody.style.transition = '';
                            debugLog('DEBUG hideSkeletonLoading: Smooth transition completed');
                        }, 250);
                    });

                    // すべての機能を再初期化（フェードイン中に実行）
                    setTimeout(() => {
                        try {
                            if (typeof reinitializeContentFeatures === 'function') {
                                reinitializeContentFeatures();
                            }
                            if (typeof applyDirectoryCustomIcons === 'function') {
                                applyDirectoryCustomIcons();
                            }
                            if (typeof reinitializePreviewFeatures === 'function') {
                                reinitializePreviewFeatures();
                            }
                            if (typeof applyBookmarkCache === 'function') {
                                applyBookmarkCache();
                                debugLog('DEBUG hideSkeletonLoading: applyBookmarkCache completed');
                            }
                            callGetBookmarkWhenReady();
                            callGetHistoryWhenReady();
                        } catch (e) {
                            console.error('ERROR hideSkeletonLoading: Initialization failed:', e);
                        }
                    }, 50); // フェードイン開始と同時に初期化実行

                }, 200); // スケルトンフェードアウト完了を待つ
            });
        }

        // 遅延ロードされたスクリプト（dir_list.js）定義待ちで安全に呼び出すヘルパー
        function callGetBookmarkWhenReady(maxAttempts = 20, intervalMs = 50) {
            let attempts = 0;
            const tryCall = () => {
                if (typeof getBookmark === 'function') {
                    try { getBookmark(); } catch (e) { console.error('getBookmark call failed:', e); }
                } else if (attempts < maxAttempts) {
                    attempts++;
                    setTimeout(tryCall, intervalMs);
                }
            };
            setTimeout(tryCall, 0);
        }

        function callGetHistoryWhenReady(maxAttempts = 20, intervalMs = 50) {
            let attempts = 0;
            const tryCall = () => {
                if (typeof getHistory === 'function') {
                    try { getHistory(); } catch (e) { console.error('getHistory call failed:', e); }
                } else if (attempts < maxAttempts) {
                    attempts++;
                    setTimeout(tryCall, intervalMs);
                }
            };
            setTimeout(tryCall, 0);
        }

        function getCookie(name) {
            const value = `; ${document.cookie}`;
            const parts = value.split(`; ${name}=`);
            if (parts.length === 2) return parts.pop().split(';').shift();
        }

        // Note: toggleView() は dir_list.js 側の実装を優先（ネットワーク不要での再初期化・キャッシュ反映対応）
    </script>
</head>

<body>

    <!-- Header content integrated from header.html -->
    <div class="menu">
      <div class="viewmode" onclick="javascript:toggleView();"></div>
      <div id="rawMode" class="raw" onclick="javascript:toggleRaw();"></div>
      <div id="languageIcon" class="language" onclick="javascript:switchLanguageMenu();"></div>
      <div id="loginIcon" class="guest" onclick="javascript:login();"></div>
      <div class="history"><span id="history" style="white-space: nowrap;">-</span></div>
    </div>

    <div id="filemenu" class="filemenu" style="position:absolute; width:80%; left:10%; padding:10px; display: none; background-color:rgba(0,0,0,0.5); border-radius:5px;">
      <form id="fileope">
        <input id="newname" type="text" name="newname" value="" style="width:99%;">
        <input id="orgname" type="hidden" name="orgname" value="">
        <input id="fileLink" type="hidden" name="file" value="">
        <input type="button" name="cancel" value="キャンセル" style="float:right;" onclick="document.getElementById('filemenu').style.display='none';">
        <input type="submit" name="update" value="更新" style="float:right;">
      </form>
    </div>

    <div id="bookdetail" class="filemenu" style="position:absolute; width:80%; left:10%; padding:10px; display: none; background-color:rgba(18, 126, 143, 0.5); border-radius:5px;">
      <form id="openbookdetail">
        <input id="fileA" type="text" name="fileA" value="" style="width:99%;">
        <input id="fileB" type="hidden" name="fileB" value="">
        <input id="detailFileLink" type="hidden" name="file" value="">
        <input type="button" name="cancel" value="キャンセル" style="float:right;" onclick="document.getElementById('bookdetail').style.display='none';">
        <input type="submit" name="detail" value="詳細" style="float:right;">
      </form>
    </div>

    <div id="languageMenu" class="filemenu" style="position:absolute; width:auto; padding:10px; display: none; background-color:rgba(0,0,0,0.7); border-radius:5px; z-index: 1100;">
      <div id="languageOptions">
        <!-- 言語オプションがここに動的に追加されます -->
      </div>
    </div>

    <!-- 多言語対応スクリプト読み込み -->
    <script src="/theme/js/i18n.js" defer></script>

    <script>
    // Cookie取得（旧実装互換: rawMode=cmp/raw を期待。compressed は cmp にマップ）
    (function(){
      const cookies = document.cookie.split(";");
      for (let i = 0; i < cookies.length; i++) {
        const parts = cookies[i].split("=");
        const key = (parts[0] || "").trim();
        const val = (parts[1] || "").trim();
        if (/comistreamUser/.test(key)) {
          document.getElementById("loginIcon").className = "login";
        } else if (/rawMode/.test(key)) {
          // 互換マップ: 'compressed' → 'cmp'
          const mapped = (val === 'compressed') ? 'cmp' : val;
          document.getElementById("rawMode").className = mapped || 'raw';
        }
      }
    })();
    // -->
    </script>

    <div id="modal" style="display: none">
      <div id="modal-content">
        <img id="modal-image" src="" alt="プレビュー画像" width="800" height="600" />
      </div>
    </div>

    <div class="wrapper">
    <!-- we open the `wrapper` element here, but close it in the footer section -->

    <div>
      <span class="breadcrumb" id="breadcrumb">/</span>
      <div class="search-controls">
        <div id="favbutton" class="favbutton" onclick="javascript:searchFavButton()"></div>
        <form name="searchform" action="javascript:search()">
          <input class="textbox" type="search" name="textbox" results="10" placeholder="ファイル名を検索">
        </form>
        <div id="sortToggle" class="sort-toggle" onclick="javascript:toggleSortPanel()"></div>
        
        <!-- ソート設定パネル（収納式） -->
        <div class="sort-panel" id="sortPanel">
          <div class="sort-panel-inner">
            <span class="sort-label" id="sortLabel">ソート:</span>
            <label for="sortBy" class="visually-hidden">ソート項目</label>
            <select id="sortBy" class="sort-select" onchange="applySortChange()">
              <option value="name">名前</option>
              <option value="lastmod">更新日時</option>
              <option value="size">サイズ</option>
            </select>
            <label for="sortOrder" class="visually-hidden">ソート順序</label>
            <select id="sortOrder" class="sort-select" onchange="applySortChange()">
              <option value="asc">昇順</option>
              <option value="desc">降順</option>
            </select>
          </div>
        </div>
      </div>
    </div>

    <br>

    <script>
        // パンくずリストを設定
        window.addEventListener('DOMContentLoaded', function() {
            const breadcrumb = document.getElementById('breadcrumb');

            if (breadcrumb) {
                // 既存のfooter.html処理を参考にしたパンくずリスト生成
                let pathAll = "/<a href=\"/\">TOP</a>";
                let path = "";
                const dirList = window.location.pathname.split("/");

                for (let i = 0; i < dirList.length; i++) {
                    if (dirList[i] !== "") {
                        path = path + "/" + dirList[i];
                        pathAll = pathAll + "/<a href='" + path + "'>" + decodeURIComponent(dirList[i]) + "</a>";
                    }
                }

                breadcrumb.innerHTML = pathAll;
            }
        });
    </script>

    <div id="skeleton-container">
        <table id="indexlist" class="skeleton-loading">
            <thead>
                <tr class="indexhead">
                    <th class="indexcolicon"><img src="/theme/icons/blank.png" alt="[ICO]"></th>
                    <?php
                    function print_sort_header($title, $sort_key, $current_sort_by, $current_sort_order, $request_path)
                    {
                        if ($current_sort_by === $sort_key) {
                            // 現在のソート対象と同じカラムがクリックされた場合は逆順にする
                            $order = ($current_sort_order === 'asc') ? 'desc' : 'asc';
                        } else {
                            // 異なるカラムがクリックされた場合の処理
                            if ($sort_key === 'lastmod') {
                                // 更新日時順への切り替えは常に降順から開始
                                $order = 'desc';

                                // デフォルトの名前順・昇順から更新日時順への切り替えをログ出力
                                if ($current_sort_by === 'name' && $current_sort_order === 'asc') {
                                    writelog("INFO dir_list: Switching from default name/asc to lastmod/desc for path: " . $request_path, "dir_list");
                                }
                            } else if ($sort_key === 'size') {
                                $order = 'desc';  // Sizeは降順が初期値
                            } else {
                                $order = 'asc';   // Nameなどは昇順が初期値
                            }
                        }
                        $class = 'indexcol' . $sort_key;
                        if ($current_sort_by === $sort_key) {
                            $class .= ' sort-' . $current_sort_order;
                        }
                        $url = '?path=' . rawurlencode($request_path) . '&sort=' . $sort_key . '&order=' . $order;
                        echo '<th class="' . $class . '"><a href="' . htmlspecialchars($url) . '">' . $title . '</a></th>';
                    }
                    print_sort_header('Name', 'name', $sort_by, $sort_order, $request_path);
                    print_sort_header('Last modified', 'lastmod', $sort_by, $sort_order, $request_path);
                    print_sort_header('Size', 'size', $sort_by, $sort_order, $request_path);
                    ?>
                </tr>
            </thead>
            <tbody id="table-tbody">
            </tbody>
        </table>
    </div>

    <script>
        // ページ読み込み時にスケルトンを表示（高速モードの場合は後で制御）
        window.shouldShowSkeleton = true; // デフォルトは表示
        document.addEventListener('DOMContentLoaded', function() {
            if (window.shouldShowSkeleton) {
                showSkeletonLoading();
            }
        });
    </script>

    <?php
    // Ajax呼び出し用の初期設定
    // 初期表示専用のJavaScript設定を作成
    $js_config = json_encode([
        'cgiPath' => $cgiPath,
        'hlsCgiPath' => $hlsCgiPath,
        'bibiPath' => $bibiPath,
        'publicDir' => $publicDir,
        'themeDir' => '',
        'currentPath' => $request_path,
        'loginUser' => $_COOKIE['comistreamUser'] ?? '',
        'hasSessionSortPrefs' => isset($_SESSION['dirSortPrefs']),
        'currentSort' => $sort_by,
        'currentOrder' => $sort_order,
        'debugFlag' => $global_debug_flag
    ]);
    ?>

    <script>
        // JavaScript設定を設定
        const comistreamConfig = <?php echo $js_config; ?>;

        // Ajax でディレクトリ内容を取得するルン！
        function loadDirectoryContent() {
            debugLog('Loading directory content via Ajax...');
            
            // パフォーマンス測定開始（高速表示判定用）
            const ajaxStartTime = performance.now();
            const FAST_RENDER_THRESHOLD_MS = 100; // 100ms以下なら高速表示
            
            // パラメータを構築
            const urlParams = new URLSearchParams(window.location.search);
            const currentPath = window.location.pathname;
            const viewmode = getCookie('viewmode') || 'list';
            
            // API URL を構築
            const apiUrl = '/cgi-bin/dir_list_api.php';
            const params = new URLSearchParams({
                path: currentPath,
                viewmode: viewmode
            });
            
            // ソートパラメータがあれば追加
            if (urlParams.get('sort')) params.set('sort', urlParams.get('sort'));
            if (urlParams.get('order')) params.set('order', urlParams.get('order'));
            
            const fullApiUrl = apiUrl + '?' + params.toString();
            debugLog('API URL:', fullApiUrl);
            
            // Ajax リクエスト実行
            fetch(fullApiUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Cache-Control': 'no-cache'
                },
                credentials: 'same-origin'
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error('HTTP ' + response.status + ': ' + response.statusText);
                }
                return response.json();
            })
            .then(data => {
                // Ajax 応答時間を測定
                const ajaxEndTime = performance.now();
                const ajaxResponseTime = ajaxEndTime - ajaxStartTime;
                const isFastRender = ajaxResponseTime <= FAST_RENDER_THRESHOLD_MS;
                
                // スケルトンタイマーをキャンセル（高速/通常どちらの場合も）
                if (window._skeletonTimer) {
                    clearTimeout(window._skeletonTimer);
                    window._skeletonTimer = null;
                    debugLog('DEBUG: Skeleton timer cancelled - response received in time');
                }
                
                debugLog('API response received:', data, 'Response time:', ajaxResponseTime.toFixed(2) + 'ms', 'Fast render:', isFastRender);
                
                if (data.success) {
                    // JavaScript設定を更新
                    if (window.comistreamConfig) {
                        window.comistreamConfig.currentSort = data.meta.sort_by;
                        window.comistreamConfig.currentOrder = data.meta.sort_order;
                    }
                    
                    // 高速表示 vs 通常表示（スケルトン）の判定
                    if (isFastRender) {
                        // 高速表示：スケルトンをスキップして直接表示
                        debugLog('Fast render mode: rendering content directly');
                        renderDirectoryContentFast(data.data, data.meta);
                    } else {
                        // 通常表示：スケルトンからの切り替え
                        debugLog('Normal render mode: using skeleton transition');
                        renderDirectoryContent(data.data, data.meta);
                    }
                    
                    debugLog('Directory content loaded successfully. Items:', data.meta.total_items, 'Server process time:', data.meta.processing_time_ms + 'ms', 'Total response time:', ajaxResponseTime.toFixed(2) + 'ms');
                } else {
                    // エラー時の処理
                    throw new Error(data.error ? data.error.message : 'Unknown API error');
                }
            })
            .catch(error => {
                // エラー時もスケルトンタイマーをキャンセル
                if (window._skeletonTimer) {
                    clearTimeout(window._skeletonTimer);
                    window._skeletonTimer = null;
                    debugLog('DEBUG: Skeleton timer cancelled due to error');
                }
                
                console.error('Failed to load directory content:', error);
                renderErrorMessage('ディレクトリの読み込みに失敗しました: ' + error.message);
            });
        }
        
        // ディレクトリ内容をレンダリング
        function renderDirectoryContent(items, meta) {
            const tbody = document.querySelector('#table-tbody');
            const tableContainer = document.getElementById('indexlist');
            
            if (!tbody || !tableContainer) {
                console.error('Required DOM elements not found');
                return;
            }
            
            // HTML構築
            let htmlContent = '';
            items.forEach(item => {
                let rowClass = '';
                if (item.is_parent) {
                    rowClass = ' class="parent-dir-row"';
                }
                
                htmlContent += '<tr' + rowClass + '>';
                
                // アイコンカラム
                htmlContent += '<td class="indexcolicon">';
                htmlContent += '<a href="' + escapeHtml(item.href) + '" data-filepath="' + escapeHtml(item.data_filepath) + '">';
                htmlContent += '<img src="' + escapeHtml(item.icon) + '" alt="[ICO]">';
                htmlContent += '</a></td>';
                
                // 名前カラム
                let nameContent = '';
                let dataImageAttr = '';
                let tdIdAttr = '';
                let onclickAttr = '';
                
                // ファイルの場合の特別処理
                if (!item.is_dir && !item.is_parent) {
                    // プレビュー画像属性
                    if (item.preview_image) {
                        dataImageAttr = ' data-image="' + escapeHtml(item.preview_image) + '"';
                    }
                    // ID属性（ブックマーク用）
                    tdIdAttr = ' id="' + escapeHtml(item.name) + '"';
                    // onclick ハンドラ
                    onclickAttr = ' onclick="return linkhook(event)"';
                    
                    // カバービューでファイルの場合、表紙画像を追加
                    const viewmode = getCookie('viewmode') || 'list';
                    if (viewmode === 'cover' && item.cover_image) {
                        nameContent = '<img src="' + escapeHtml(item.cover_image) + '" alt="Cover" onerror="this.style.display=\'none\'">';
                    }
                }
                
                htmlContent += '<td class="indexcolname"' + dataImageAttr + tdIdAttr + '>';
                htmlContent += nameContent;
                htmlContent += '<a href="' + escapeHtml(item.href) + '" data-filepath="' + escapeHtml(item.data_filepath) + '"';
                if (!item.is_dir && !item.is_parent) {
                    htmlContent += ' id="' + escapeHtml(item.name) + '"';
                }
                htmlContent += onclickAttr + '>';
                htmlContent += escapeHtml(item.name);
                htmlContent += '</a></td>';
                
                // 最終更新日カラム
                htmlContent += '<td class="indexcollastmod">' + escapeHtml(item.lastmod_formatted) + '</td>';
                
                // サイズカラム  
                htmlContent += '<td class="indexcolsize">' + escapeHtml(item.size_formatted) + '</td>';
                
                htmlContent += '</tr>';
            });
            
            // スケルトンが表示されているかどうかで処理を分ける
            if (isSkeletonCurrentlyDisplayed()) {
                debugLog('DEBUG: Normal render using skeleton transition');
                hideSkeletonLoading(htmlContent);
            } else {
                debugLog('DEBUG: Normal render without skeleton (direct) - skeleton was not displayed in time');
                // スケルトンが表示されていない場合は高速表示と同じ処理
                tbody.innerHTML = htmlContent;
                
                // カバービューの中央寄せ計算
                try {
                    if (typeof updateCoverSideGutter === 'function') {
                        updateCoverSideGutter();
                        debugLog('DEBUG Normal render (direct): updateCoverSideGutter called');
                    }
                } catch (e) {
                    console.error('ERROR Normal render (direct): updateCoverSideGutter failed:', e);
                }
                
                tableContainer.classList.remove('skeleton-loading');
                tbody.classList.add('actual-content');
                tbody.style.opacity = '1';
                
                const footer = document.querySelector('.footer');
                if (footer) {
                    footer.style.opacity = '1';
                }
                
                // 機能の再初期化
                try {
                    if (typeof reinitializeContentFeatures === 'function') {
                        reinitializeContentFeatures();
                    }
                    if (typeof applyDirectoryCustomIcons === 'function') {
                        applyDirectoryCustomIcons();
                    }
                    if (typeof reinitializePreviewFeatures === 'function') {
                        reinitializePreviewFeatures();
                    }
                    if (typeof applyBookmarkCache === 'function') {
                        applyBookmarkCache();
                    }
                    callGetBookmarkWhenReady();
                    callGetHistoryWhenReady();
                } catch (e) {
                    console.error('ERROR Normal render (direct): Initialization failed:', e);
                }
            }
        }
        
        // 高速表示用のディレクトリ内容レンダリング（スケルトンアニメーションなし）
        function renderDirectoryContentFast(items, meta) {
            const tbody = document.querySelector('#table-tbody');
            const tableContainer = document.getElementById('indexlist');
            
            if (!tbody || !tableContainer) {
                console.error('Required DOM elements not found');
                return;
            }
            
            // HTML構築（renderDirectoryContent()と同じロジック）
            let htmlContent = '';
            items.forEach(item => {
                let rowClass = '';
                if (item.is_parent) {
                    rowClass = ' class="parent-dir-row"';
                }
                
                htmlContent += '<tr' + rowClass + '>';
                
                // アイコンカラム
                htmlContent += '<td class="indexcolicon">';
                htmlContent += '<a href="' + escapeHtml(item.href) + '" data-filepath="' + escapeHtml(item.data_filepath) + '">';
                htmlContent += '<img src="' + escapeHtml(item.icon) + '" alt="[ICO]">';
                htmlContent += '</a></td>';
                
                // 名前カラム
                let nameContent = '';
                let dataImageAttr = '';
                let tdIdAttr = '';
                let onclickAttr = '';
                
                // ファイルの場合の特別処理
                if (!item.is_dir && !item.is_parent) {
                    // プレビュー画像属性
                    if (item.preview_image) {
                        dataImageAttr = ' data-image="' + escapeHtml(item.preview_image) + '"';
                    }
                    // ID属性（ブックマーク用）
                    tdIdAttr = ' id="' + escapeHtml(item.name) + '"';
                    // onclick ハンドラ
                    onclickAttr = ' onclick="return linkhook(event)"';
                    
                    // カバービューでファイルの場合、表紙画像を追加
                    const viewmode = getCookie('viewmode') || 'list';
                    if (viewmode === 'cover' && item.cover_image) {
                        nameContent = '<img src="' + escapeHtml(item.cover_image) + '" alt="Cover" onerror="this.style.display=\'none\'">';
                    }
                }
                
                htmlContent += '<td class="indexcolname"' + dataImageAttr + tdIdAttr + '>';
                htmlContent += nameContent;
                htmlContent += '<a href="' + escapeHtml(item.href) + '" data-filepath="' + escapeHtml(item.data_filepath) + '"';
                if (!item.is_dir && !item.is_parent) {
                    htmlContent += ' id="' + escapeHtml(item.name) + '"';
                }
                htmlContent += onclickAttr + '>';
                htmlContent += escapeHtml(item.name);
                htmlContent += '</a></td>';
                
                // 最終更新日カラム
                htmlContent += '<td class="indexcollastmod">' + escapeHtml(item.lastmod_formatted) + '</td>';
                
                // サイズカラム  
                htmlContent += '<td class="indexcolsize">' + escapeHtml(item.size_formatted) + '</td>';
                
                htmlContent += '</tr>';
            });
            
            // 高速表示：スケルトンをスキップして直接コンテンツ設定
            debugLog('DEBUG Fast render: Setting content directly without skeleton animation');
            
            // コンテンツを直接設定
            tbody.innerHTML = htmlContent;
            
            // カバービューの中央寄せ計算（コンテンツ設定直後に実行）
            try {
                if (typeof updateCoverSideGutter === 'function') {
                    updateCoverSideGutter();
                    debugLog('DEBUG Fast render: updateCoverSideGutter called');
                }
            } catch (e) {
                console.error('ERROR Fast render: updateCoverSideGutter failed:', e);
            }
            
            // スケルトンクラスを削除し、実際のコンテンツクラスを追加
            tableContainer.classList.remove('skeleton-loading');
            tbody.classList.add('actual-content');
            tbody.style.opacity = '1'; // 即座に表示
            
            // フッターを表示
            const footer = document.querySelector('.footer');
            if (footer) {
                footer.style.opacity = '1';
            }
            
            // すべての機能を再初期化
            try {
                debugLog('DEBUG Fast render: Starting function initialization');
                
                if (typeof reinitializeContentFeatures === 'function') {
                    reinitializeContentFeatures();
                    debugLog('DEBUG Fast render: reinitializeContentFeatures completed');
                } else {
                    debugLog('WARNING Fast render: reinitializeContentFeatures not available');
                }
                
                if (typeof applyDirectoryCustomIcons === 'function') {
                    applyDirectoryCustomIcons();
                    debugLog('DEBUG Fast render: applyDirectoryCustomIcons completed');
                }
                
                if (typeof reinitializePreviewFeatures === 'function') {
                    reinitializePreviewFeatures();
                    debugLog('DEBUG Fast render: reinitializePreviewFeatures completed');
                }
                
                // キャッシュ済み既読・お気に入りを即時反映
                if (typeof applyBookmarkCache === 'function') {
                    applyBookmarkCache();
                    debugLog('DEBUG Fast render: applyBookmarkCache completed');
                }
                
                // 読書進捗とお気に入り機能を呼び出し
                callGetBookmarkWhenReady();
                callGetHistoryWhenReady();
                
                debugLog('DEBUG Fast render: All initialization completed');
            } catch (e) {
                console.error('ERROR Fast render: Initialization failed:', e);
            }
        }
        
        // スケルトンが現在表示されているかチェック
        function isSkeletonCurrentlyDisplayed() {
            const tableContainer = document.getElementById('indexlist');
            const tbody = document.querySelector('#table-tbody');
            const skeletonRows = tbody ? tbody.querySelectorAll('.skeleton-row') : [];
            
            return tableContainer && 
                   tableContainer.classList.contains('skeleton-loading') && 
                   skeletonRows.length > 0;
        }
        
        // エラーメッセージを表示
        function renderErrorMessage(message) {
            const tbody = document.querySelector('#table-tbody');
            const tableContainer = document.getElementById('indexlist');
            
            if (!tbody || !tableContainer) return;
            
            const errorHtml = '<tr><td colspan="4" style="text-align: center; color: #d32f2f; padding: 20px;">' + escapeHtml(message) + '</td></tr>';
            
            // スケルトンが表示されているかどうかで処理を分ける
            if (isSkeletonCurrentlyDisplayed()) {
                debugLog('DEBUG: Error display using skeleton transition');
                hideSkeletonLoading(errorHtml);
            } else {
                debugLog('DEBUG: Error display without skeleton (direct)');
                // スケルトンが表示されていない場合は直接エラー表示
                tbody.innerHTML = errorHtml;
                tableContainer.classList.remove('skeleton-loading');
                tbody.classList.add('actual-content');
                tbody.style.opacity = '1';
                
                // フッターも表示
                const footer = document.querySelector('.footer');
                if (footer) {
                    footer.style.opacity = '1';
                }
            }
        }
        
        // HTMLエスケープ関数
        function escapeHtml(text) {
            if (text == null) return '';
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        // DOMContentLoaded時にAjax読み込み開始
        document.addEventListener('DOMContentLoaded', function() {
            // 高速表示判定のため、即座にAjax開始
            debugLog('DEBUG: Starting Ajax immediately for fast render detection');
            
            // スケルトン表示を遅延（Ajax応答が遅い場合のみ表示）
            const skeletonTimer = setTimeout(function() {
                debugLog('DEBUG: Showing skeleton after delay (slow response)');
                if (window.shouldShowSkeleton) {
                    showSkeletonLoading();
                }
            }, 150); // 150ms後にスケルトン表示（Ajax応答が遅い場合のみ）
            
            // スケルトンタイマーをグローバルに保存（Ajax応答時にキャンセルするため）
            window._skeletonTimer = skeletonTimer;
            
            // Ajax即座開始
            loadDirectoryContent();
        });
    </script>

    <div id="actual-content" style="display: none;">
    </div>

    </div><!--/.wrapper-->

    <!-- Directory listing JavaScript functions (inlined to avoid iOS PWA cache issues) -->
    <script>
    <?php readfile(__DIR__ . '/dir_list.js'); ?>
    </script>

    <!-- Footer content integrated from footer.html -->
    <div class="footer">
      Comistream - Nihondo 2025<br>
    </div>
    <!--/.footer-->

</body>

</html>
