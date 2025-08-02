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
ini_set('output_buffering', 'On');
error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);

// DB接続
$dbh = null;
if ($global_use_db_flag == 1) {
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
    $problematic_chars = ['#', '?', '&', '=', '%', '\\', ':', '@', '<', '>', '"', "'", '|', '*', ' '];
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
        '.7z' => '/theme/icons/book.png',
        '.cb7' => '/theme/icons/book.png',

        // Other file types from the original .htaccess
        '.txt' => '/theme/icons/text.png',
        '.jpg' => '/theme/icons/image.png',
        '.jpeg' => '/theme/icons/image.png',
        '.png' => '/theme/icons/image.png',
        '.gif' => '/theme/icons/image.png',
        '.bmp' => '/theme/icons/image.png',
        '.mp3' => '/theme/icons/audio.png',
        '.wav' => '/theme/icons/audio.png',
        '.flac' => '/theme/icons/audio.png',
        '.m4a' => '/theme/icons/audio.png',
        '.mp4' => '/theme/icons/video.png',
        '.mkv' => '/theme/icons/video.png',
        '.avi' => '/theme/icons/video.png',
        '.mov' => '/theme/icons/video.png',
        '.wmv' => '/theme/icons/video.png',
        '.webm' => '/theme/icons/video.png',
        '.7z' => '/theme/icons/archive.png',
        '.bz2' => '/theme/icons/archive.png',
        '.cab' => '/theme/icons/archive.png',
        '.gz' => '/theme/icons/archive.png',
        '.tar' => '/theme/icons/archive.png',
        '.aac' => '/theme/icons/audio.png',
        '.aif' => '/theme/icons/audio.png',
        '.aifc' => '/theme/icons/audio.png',
        '.aiff' => '/theme/icons/audio.png',
        '.ape' => '/theme/icons/audio.png',
        '.au' => '/theme/icons/audio.png',
        '.iff' => '/theme/icons/audio.png',
        '.mid' => '/theme/icons/audio.png',
        '.mpa' => '/theme/icons/audio.png',
        '.ra' => '/theme/icons/audio.png',
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
        '.asf' => '/theme/icons/video.png',
        '.asx' => '/theme/icons/video.png',
        '.flv' => '/theme/icons/video.png',
        '.mov' => '/theme/icons/video.png',
        '.mpg' => '/theme/icons/video.png',
        '.rm' => '/theme/icons/video.png',
        '.srt' => '/theme/icons/video.png',
        '.swf' => '/theme/icons/video.png',
        '.vob' => '/theme/icons/video.png',
        '.m4v' => '/theme/icons/video.png',
        '.f4v' => '/theme/icons/video.png',
        '.f4p' => '/theme/icons/video.png',
        '.ogv' => '/theme/icons/video.png',
        '.m2t' => '/theme/icons/video.png',
        '.ts' => '/theme/icons/video.png',
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

// 5. 物理パスを取得
$physical_path = realpath($document_root . $request_path);

// Security check: ensure path is within doc root and exists
if ($physical_path === false || strpos($physical_path, $document_root) !== 0) {
    http_response_code(403);
    writelog("ERROR dir_list: Forbidden access attempt: " . $request_path . " -> " . ($physical_path ?: 'false'), "dir_list");
    echo "403 Forbidden";
    exit;
}

if (!is_dir($physical_path)) {
    http_response_code(404);
    writelog("ERROR dir_list: Not found attempt: " . $request_path);
    echo "404 Not Found";
    exit;
}

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

$viewmode = $_COOKIE['viewmode'] ?? 'list';
$stylesheet_path = ($viewmode === 'cover')
    ? '/theme/style_cover.css?2025062212'
    : '/theme/style.css?2025062212';

header('Content-Type: text/html; charset=utf-8');

// Define Javascript variables to be used in header/footer
$js_config = json_encode([
    'cgiPath' => $cgiPath,
    'hlsCgiPath' => $hlsCgiPath,
    'bibiPath' => $bibiPath,
    'publicDir' => $publicDir,
    'themeDir' => '', // themeDir seems to be consistently empty/root
    'currentPath' => $request_path, // Already normalized
    'loginUser' => $_COOKIE['comistreamUser'] ?? '',
    'hasSessionSortPrefs' => isset($_SESSION['dirSortPrefs']), // セッションにソート設定があるかどうか
    'currentSort' => $sort_by, // 現在のソート項目
    'currentOrder' => $sort_order // 現在のソート順序
]);

?>
<!DOCTYPE html>
<html>

<head>
    <meta charset="UTF-8">
    <title>Index of <?php echo htmlspecialchars('/' . $request_path); ?></title>
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <script>
        // Pass PHP config to Javascript
        const comistreamConfig = <?php echo $js_config; ?>;
        const cgiPath = comistreamConfig.cgiPath;
        const hlsCgiPath = comistreamConfig.hlsCgiPath;
        const bibiPath = comistreamConfig.bibiPath;
        const publicDir = comistreamConfig.publicDir;
        const themeDir = comistreamConfig.themeDir;
        const loginuser = comistreamConfig.loginUser;
        const hasSessionSortPrefs = comistreamConfig.hasSessionSortPrefs;

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

            // フェードアウト効果を開始
            tableContainer.classList.add('skeleton-loading', 'fade-out');

            setTimeout(() => {
                // 実際のコンテンツを設定
                tbody.innerHTML = actualHtml;

                // フェードイン効果
                tableContainer.classList.remove('skeleton-loading', 'fade-out');
                tbody.classList.add('actual-content', 'fade-in');

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
                }, 100);
            }, 300);
        }

        function getCookie(name) {
            const value = `; ${document.cookie}`;
            const parts = value.split(`; ${name}=`);
            if (parts.length === 2) return parts.pop().split(';').shift();
        }

        // Note: toggleView()関数はfooter.htmlで定義済み（既存処理との競合を回避）
    </script>
</head>

<body>

    <?php readfile(__DIR__ . '/../theme/header.html'); ?>

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
        // ページ読み込み時にスケルトンを表示
        document.addEventListener('DOMContentLoaded', function() {
            showSkeletonLoading();
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

    $items = scandir($physical_path, SCANDIR_SORT_NONE);
    $dirs = [];
    $files = [];
    $all_items = [];

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

    writelog("DEBUG dir_list: " . sprintf(
        "PERF dir_list: scandir=%.2fms sort=%.2fms mode=%s key=%s order=%s total=%d dirs=%d files=%d path=%s",
        $perf_scandir_time,
        $perf_sort_time,
        $sort_mode,
        $sort_by,
        $sort_order,
        $total_items,
        $dir_count,
        $file_count,
        $request_path
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
            // ファイルの場合、プレビュー画像のdata-image属性を設定
            $preview_path = preg_replace('/\.[^.]+$/', '.webp', $raw_filepath);
            $preview_image_url = '/theme/preview' . $preview_path;
            $data_image_attr = ' data-image="' . htmlspecialchars($preview_image_url) . '"';

            // デバッグ用ログ（最初の数個のファイルのみ）
            static $debug_count = 0;
            if ($debug_count < 3) {
                writelog("DEBUG dir_list: preview data-image for '{$item['name']}': raw_filepath='$raw_filepath', preview_url='$preview_image_url'", "dir_list");
                $debug_count++;
            }

            if ($viewmode === 'cover') {
                // カバービューモードでファイルの場合、/theme/covers/ 以下の.jpg画像を使用
                // 拡張子を.jpgに変更
                $cover_path = preg_replace('/\.[^.]+$/', '.jpg', $raw_filepath);
                $cover_image_url = '/theme/covers' . $cover_path;
                $indexcolname_content = '<img src="' . htmlspecialchars($cover_image_url) . '" alt="Cover" onerror="this.style.display=\'none\'">';
            }
        }

        $tbody_content .= '<td class="indexcolname"' . $data_image_attr . '>' . $indexcolname_content . '<a href="' . htmlspecialchars($href) . '" data-filepath="' . htmlspecialchars($escaped_filepath) . '"' .
            (!$item['is_dir'] ? ' id="' . htmlspecialchars($item['name']) . '"' : '') .
            $onclick_attr . '>' . htmlspecialchars($item['name']) . '</a></td>';
        $tbody_content .= '<td class="indexcollastmod">' . date('Y-m-d H:i', $item['lastmod']) . '</td>';
        $tbody_content .= '<td class="indexcolsize">' . format_size($item['size']) . '</td>';
        $tbody_content .= '</tr>';
    }

    // JSONエンコードして JavaScript に送信
    $tbody_content_json = json_encode($tbody_content);
    ?>

    <script>
        // 処理完了後、スケルトンを実際のコンテンツに置換
        setTimeout(function() {
            const actualContent = <?php echo $tbody_content_json; ?>;
            hideSkeletonLoading(actualContent);
        }, 200); // 少し遅延させてスケルトン表示を確実にする
    </script>

    <div id="actual-content" style="display: none;">
    </div>

    <?php readfile(__DIR__ . '/../theme/footer.html'); ?>

</body>

</html>
