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
    <link rel="stylesheet" href="/theme/skeleton.css">
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
                    width: 150px !important;
                    height: 310px !important;
                    margin: 3px !important;
                    border-bottom: 0px !important;
                `;
                row.innerHTML = `
                    <td class="indexcolicon" style="
                        display: block !important;
                        position: absolute !important;
                        width: 150px !important;
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
                            width: 150px;
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

            // スケルトン行のみをフェードアウト（より安全なアプローチ）
            const skeletonRows = tbody.querySelectorAll('.skeleton-row');
            skeletonRows.forEach(row => row.classList.add('fade-out'));

            setTimeout(() => {
                // 実際のコンテンツを設定
                tbody.innerHTML = actualHtml;

                // スケルトンクラスを削除
                tableContainer.classList.remove('skeleton-loading');

                // コンテンツクラスを追加してから、フェードイン効果を設定
                tbody.classList.add('actual-content');

                // 初期状態を明示的に設定（opacity: 0から開始）
                tbody.style.opacity = '0';

                // 次のフレームでフェードイン開始
                requestAnimationFrame(() => {
                    tbody.style.transition = 'opacity 0.3s ease-in';
                    tbody.style.opacity = '1';

                    // アニメーション完了後にインラインスタイルをクリーンアップ
                    setTimeout(() => {
                        tbody.style.opacity = '';
                        tbody.style.transition = '';
                    }, 300);
                });

                // フッターを表示
                const footer = document.querySelector('.footer');
                if (footer) {
                    footer.style.opacity = '1';
                }

                // コンテンツが置換された後、すべての機能を再初期化
                setTimeout(() => {
                    // 検索機能のためのid属性とイベントハンドラーを設定
                    if (typeof reinitializeContentFeatures === 'function') {
                        reinitializeContentFeatures();
                    }
                    // カスタムディレクトリアイコンを適用
                    if (typeof applyDirectoryCustomIcons === 'function') {
                        applyDirectoryCustomIcons();
                    }
                    // プレビュー機能を再初期化
                    if (typeof reinitializePreviewFeatures === 'function') {
                        reinitializePreviewFeatures();
                    }
                    // 読書進捗とお気に入り・履歴を安全に呼び出し（dir_list.js 読込遅延に耐性）
                    try {
                        callGetBookmarkWhenReady();
                        callGetHistoryWhenReady();
                    } catch (e) {
                        console.error('ERROR Normal render: schedule getBookmark/getHistory failed:', e);
                    }
                    // キャッシュ済み既読・お気に入りを即時反映（取得済みなら）
                    try {
                        if (typeof applyBookmarkCache === 'function') {
                            debugLog('DEBUG Normal render: Applying bookmark cache');
                            applyBookmarkCache();
                        }
                    } catch (e) {
                        console.error('ERROR Normal render: applyBookmarkCache failed:', e);
                    }

                    // 不要なクリーンアップ処理は削除（インラインスタイル制御のため）
                }, 100);
            }, 200);
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
    // スケルトンローディングを表示してからディレクトリ処理を開始
    if (ob_get_level()) ob_end_flush();
    flush();

    // 実際のディレクトリ処理開始
    ob_start(); // 出力バッファを開始

    $tbody_content = '';

    if ($physical_path !== $document_root) {
        $parent_path = dirname($request_path);
        if (DIRECTORY_SEPARATOR !== '/') $parent_path = str_replace(DIRECTORY_SEPARATOR, '/', $parent_path);
        if ($parent_path === '/' || $parent_path === '.' || $parent_path === '') $parent_path = '/';
        // Parent Directoryでも問題のある文字を一時的に置換
        $escaped_parent_path = escape_problematic_chars($parent_path);
        $tbody_content .= '<tr class="parent-dir-row">';
        $parent_icon_src = ($viewmode === 'cover') ? '/theme/icons/blank.png' : get_icon_map()['__parent'];
        $tbody_content .= '<td class="indexcolicon"><a href="' . htmlspecialchars($parent_path) . '" data-filepath="' . htmlspecialchars($escaped_parent_path) . '"><img src="' . $parent_icon_src . '" alt="[PARENTDIR]"></a></td>';
        $tbody_content .= '<td class="indexcolname"><a href="' . htmlspecialchars($parent_path) . '" data-filepath="' . htmlspecialchars($escaped_parent_path) . '">Parent Directory</a></td>';
        $tbody_content .= '<td class="indexcollastmod">&nbsp;</td>';
        $tbody_content .= '<td class="indexcolsize">-</td>';
        $tbody_content .= '</tr>';
    }

    // Performance measurement: Start scandir
    $perf_scandir_start = microtime(true);

    $dirs = [];
    $files = [];
    $all_items = [];

    if (!$is_404_mode) {
        // 通常モード: ディレクトリをスキャン
        $items = scandir($physical_path, SCANDIR_SORT_NONE);

        foreach ($items as $item) {
            if ($item === '.' || $item === '..') continue;
            // Skip hidden files (files starting with dot)
            if (strpos($item, '.') === 0) continue;
            $item_path = $physical_path . '/' . $item;
            $is_dir = is_dir($item_path);
            $stat = stat($item_path);
            $entry = [
                'name' => $item,
                'is_dir' => $is_dir,
                'size' => $is_dir ? -1 : $stat['size'],
                'lastmod' => $stat['mtime']
            ];

            // すべてのアイテムを配列に追加
            $all_items[] = $entry;

            // 従来の分割ソート用に分類も保持
            if ($is_dir) $dirs[] = $entry;
            else $files[] = $entry;
        }
    }
    // 404モードの場合は配列は空のまま（空のディレクトリとして表示）

    // Performance measurement: End scandir
    $perf_scandir_end = microtime(true);
    $perf_scandir_time = ($perf_scandir_end - $perf_scandir_start) * 1000; // milliseconds

    // ソート設定：name順とlastmod順の場合は混在ソート、それ以外は分割ソート
    // ハードコーディング設定：分割ソートを強制する場合は true に変更
    $force_separate_sort = false;
    $use_mixed_sort = (($sort_by === 'name' || $sort_by === 'lastmod') && !$force_separate_sort);

    // Performance measurement: Start sort
    $perf_sort_start = microtime(true);

    if ($use_mixed_sort) {
        // 混在ソート（MacのFinderライク）
        $sort_func = function ($a, $b) use ($sort_by, $sort_order) {
            $val_a = $a[$sort_by];
            $val_b = $b[$sort_by];
            $cmp = ($sort_by === 'name') ? strnatcasecmp($val_a, $val_b) : ($val_a <=> $val_b);
            return ($sort_order === 'asc') ? $cmp : -$cmp;
        };
        usort($all_items, $sort_func);
        $sorted_items = $all_items;
    } else {
        // 分割ソート（従来通り：ディレクトリが先、ファイルが後）
        $sort_func = function ($a, $b) use ($sort_by, $sort_order) {
            $val_a = $a[$sort_by];
            $val_b = $b[$sort_by];
            $cmp = ($sort_by === 'name') ? strnatcasecmp($val_a, $val_b) : ($val_a <=> $val_b);
            return ($sort_order === 'asc') ? $cmp : -$cmp;
        };
        usort($dirs, $sort_func);
        usort($files, $sort_func);
        $sorted_items = array_merge($dirs, $files);
    }

    // Performance measurement: End sort
    $perf_sort_end = microtime(true);
    $perf_sort_time = ($perf_sort_end - $perf_sort_start) * 1000; // milliseconds

    // Performance log: Output performance data
    $total_items = count($all_items);
    $dir_count = count($dirs);
    $file_count = count($files);
    $sort_mode = $use_mixed_sort ? 'mixed' : 'separate';

    // Fast rendering判定ロジック
    $total_process_time = $perf_scandir_time + $perf_sort_time;
    $fast_render_threshold_ms = 50; // 50ms以下なら高速モード
    $fast_render_item_threshold = 100; // 100個以下も高速モード対象

    // デバッグフラグ: スケルトンアニメーション強制実行 (URLパラメータやconfigで制御可能)
    $force_skeleton_animation = isset($_GET['force_skeleton']) ||
        (isset($conf['forceSkeletonAnimation']) && $conf['forceSkeletonAnimation']);

    $fast_render_mode = !$force_skeleton_animation &&
        ($total_process_time <= $fast_render_threshold_ms || $total_items <= $fast_render_item_threshold);

    writelog("DEBUG dir_list: " . sprintf(
        "PERF dir_list: scandir=%.2fms sort=%.2fms total=%.2fms mode=%s key=%s order=%s total=%d dirs=%d files=%d path=%s fast_render=%s force_skeleton=%s 404_mode=%s",
        $perf_scandir_time,
        $perf_sort_time,
        $total_process_time,
        $sort_mode,
        $sort_by,
        $sort_order,
        $total_items,
        $dir_count,
        $file_count,
        $request_path,
        $fast_render_mode ? 'true' : 'false',
        $force_skeleton_animation ? 'true' : 'false',
        $is_404_mode ? 'true' : 'false'
    ), "dir_list");

    foreach ($sorted_items as $item) {
        $icon = get_icon($item['name'], $item['is_dir']);
        $href = rtrim($request_path, '/') . '/' . rawurlencode($item['name']);
        // JavaScript用に生のファイルパスも保存（#文字対応）
        $raw_filepath = rtrim($request_path, '/') . '/' . $item['name'];
        // #文字を一時的に置換（ブラウザが#でURLを切るのを防ぐ）
        $escaped_filepath = escape_problematic_chars($raw_filepath);
        if ($item['is_dir']) {
            $href .= '/';
            $raw_filepath .= '/';
            $escaped_filepath .= '/';
        }

        // デバッグ用ログ（問題のある文字を含むファイルの場合のみ）
        if (preg_match('/[#?&=%\\:@<>"\'|* ]/', $item['name'])) {
            writelog("DEBUG dir_list: Special characters found in filename: " . $item['name'] . ", raw_filepath: " . $raw_filepath . ", percent_encoded: " . $escaped_filepath, "dir_list");
        }

        $tbody_content .= '<tr>';
        // For directories in cover view, the icon is a background image on the link, not an img tag.
        // So, we provide a blank image for cover view directories to maintain layout.
        $icon_img_src = ($viewmode === 'cover' && $item['is_dir']) ? '/theme/icons/blank.png' : $icon;
        $tbody_content .= '<td class="indexcolicon"><a href="' . htmlspecialchars($href) . '" data-filepath="' . htmlspecialchars($escaped_filepath) . '"><img src="' . $icon_img_src . '" alt="[ICO]"></a></td>';

        // Add onclick handler for files (not directories) to maintain compatibility with mod_autoindex
        $onclick_attr = '';
        if (!$item['is_dir']) {
            $onclick_attr = ' onclick="return linkhook(event)"';
        }

        // カバービューモードでファイルの場合は表紙画像を追加
        $indexcolname_content = '';
        $data_image_attr = '';

        if (!$item['is_dir']) {
            // ファイルの場合、プレビュー画像のdata-image属性を設定（問題文字はパーセントエンコード）
            $preview_path = preg_replace('/\.[^.]+$/', '.webp', $raw_filepath);
            $escaped_preview_path = escape_problematic_chars($preview_path);
            $preview_image_url = '/theme/preview' . $escaped_preview_path;
            $data_image_attr = ' data-image="' . htmlspecialchars($preview_image_url) . '"';

            // デバッグ用ログ（最初の数個のファイルのみ）
            static $debug_count = 0;
            if ($debug_count < 3) {
                writelog("DEBUG dir_list: preview data-image for '{$item['name']}': raw_filepath='$raw_filepath', preview_url='$preview_image_url'", "dir_list");
                $debug_count++;
            }

            if ($viewmode === 'cover') {
                // カバービューモードでファイルの場合、/theme/covers/ 以下の.jpg画像を使用（問題文字はパーセントエンコード）
                $cover_path = preg_replace('/\.[^.]+$/', '.jpg', $raw_filepath);
                $escaped_cover_path = escape_problematic_chars($cover_path);
                $cover_image_url = '/theme/covers' . $escaped_cover_path;
                $indexcolname_content = '<img src="' . htmlspecialchars($cover_image_url) . '" alt="Cover" onerror="this.style.display=\'none\'">';
            }
        }

        // td要素にもid属性を設定（getBookmark関数で使用される）
        $td_id_attr = !$item['is_dir'] ? ' id="' . htmlspecialchars($item['name']) . '"' : '';
        $tbody_content .= '<td class="indexcolname"' . $data_image_attr . $td_id_attr . '>' . $indexcolname_content . '<a href="' . htmlspecialchars($href) . '" data-filepath="' . htmlspecialchars($escaped_filepath) . '"' .
            (!$item['is_dir'] ? ' id="' . htmlspecialchars($item['name']) . '"' : '') .
            $onclick_attr . '>' . htmlspecialchars($item['name']) . '</a></td>';
        $tbody_content .= '<td class="indexcollastmod">' . date('Y-m-d H:i', $item['lastmod']) . '</td>';
        $tbody_content .= '<td class="indexcolsize">' . format_size($item['size']) . '</td>';
        $tbody_content .= '</tr>';
    }

    // パフォーマンス測定完了後、最終的なJavaScript設定を作成
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
        'debugFlag' => $global_debug_flag,
        'fastRenderMode' => $fast_render_mode,
        'forceSkeletonAnimation' => $force_skeleton_animation,
        'totalProcessTime' => round($total_process_time, 2), // デバッグ用に処理時間も送信
        'totalItems' => $total_items // デバッグ用にアイテム数も送信
    ]);

    // JSONエンコードして JavaScript に送信
    $tbody_content_json = json_encode($tbody_content);
    ?>

    <script>
        // 処理完了後の最終設定でcomistreamConfigを更新
        const comistreamConfig = <?php echo $js_config; ?>;

        // 高速レンダリングモードのログ出力（デバッグ用）
        if (debugFlag) {
            console.debug('Fast Render Mode:', comistreamConfig.fastRenderMode);
            console.debug('Force Skeleton Animation:', comistreamConfig.forceSkeletonAnimation);
            console.debug('Process Time:', comistreamConfig.totalProcessTime + 'ms');
            console.debug('Total Items:', comistreamConfig.totalItems);
        }

        // 高速レンダリングモードの場合、スケルトンアニメーションをスキップ
        if (comistreamConfig.fastRenderMode) {
            // スケルトン表示をスキップ
            window.shouldShowSkeleton = false;
            debugLog('Fast render mode: skipping skeleton animation entirely');

            // 即座にコンテンツを表示
            setTimeout(function() {
                const actualContent = <?php echo $tbody_content_json; ?>;
                // スケルトンが表示されていない場合は直接コンテンツを設定
                const tbody = document.querySelector('#table-tbody');
                const tableContainer = document.getElementById('indexlist');

                tbody.innerHTML = actualContent;

                // transitionを無効化してからクラス操作（アニメーション競合回避）
                tableContainer.style.transition = 'none';
                tbody.style.transition = 'none';

                tableContainer.classList.remove('skeleton-loading');
                tbody.classList.add('actual-content');
                tbody.style.opacity = '1'; // 即座に表示

                // フッターを表示
                const footer = document.querySelector('.footer');
                if (footer) {
                    footer.style.opacity = '1';
                }

                // 機能を再初期化
                debugLog('DEBUG Fast render: Starting function initialization');

                if (typeof reinitializeContentFeatures === 'function') {
                    try {
                        debugLog('DEBUG Fast render: Calling reinitializeContentFeatures');
                        reinitializeContentFeatures();
                        debugLog('DEBUG Fast render: reinitializeContentFeatures completed');
                    } catch (e) {
                        console.error('ERROR Fast render: reinitializeContentFeatures failed:', e);
                    }
                } else {
                    console.error('ERROR Fast render: reinitializeContentFeatures is not a function');
                }

                if (typeof applyDirectoryCustomIcons === 'function') {
                    try {
                        debugLog('DEBUG Fast render: Calling applyDirectoryCustomIcons');
                        applyDirectoryCustomIcons();
                        debugLog('DEBUG Fast render: applyDirectoryCustomIcons completed');
                    } catch (e) {
                        console.error('ERROR Fast render: applyDirectoryCustomIcons failed:', e);
                    }
                } else {
                    console.error('ERROR Fast render: applyDirectoryCustomIcons is not a function');
                }

                if (typeof reinitializePreviewFeatures === 'function') {
                    try {
                        debugLog('DEBUG Fast render: Calling reinitializePreviewFeatures');
                        reinitializePreviewFeatures();
                        debugLog('DEBUG Fast render: reinitializePreviewFeatures completed');
                    } catch (e) {
                        console.error('ERROR Fast render: reinitializePreviewFeatures failed:', e);
                    }
                } else {
                    console.error('ERROR Fast render: reinitializePreviewFeatures is not a function');
                }

                // キャッシュ済み既読・お気に入りを即時反映
                try {
                    if (typeof applyBookmarkCache === 'function') {
                        debugLog('DEBUG Fast render: Applying bookmark cache');
                        applyBookmarkCache();
                    }
                } catch (e) {
                    console.error('ERROR Fast render: applyBookmarkCache failed:', e);
                }

                // 読書進捗とお気に入り機能を再初期化（inlineで出力されるため即座に利用可能）
                // getBookmark/getHistory は dir_list.js インライン読込のため遅れることがある
                try {
                    debugLog('DEBUG Fast render: Scheduling getBookmark/getHistory');
                    callGetBookmarkWhenReady();
                    callGetHistoryWhenReady();
                } catch (e) {
                    console.error('ERROR Fast render: schedule getBookmark/getHistory failed:', e);
                }

                // 次のフレームでtransitionを復活（クリーンアップ）
                requestAnimationFrame(() => {
                    tableContainer.style.transition = '';
                    tbody.style.transition = '';
                });
            }, 0);
        } else {
            // 通常モード: 既存のアニメーション
            debugLog('Normal render mode: showing skeleton animation');
            setTimeout(function() {
                const actualContent = <?php echo $tbody_content_json; ?>;
                hideSkeletonLoading(actualContent);
            }, 150); // 少し遅延させてスケルトン表示を確実にする
        }
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
