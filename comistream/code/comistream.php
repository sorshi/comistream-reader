<?php
/**
 * Comistream Reader
 *
 * 高性能なサーバーサイドコミックブックリーダー。ZIP、RAR、7z、PDFなど
 * 様々な形式の電子書籍をスムーズに閲覧できます。動画ファイルもHLSに
 * 変換して再生可能です。
 *
 * @package     sorshi/comistream-reader
 * @author      Comistream Project.
 * @copyright   2024 Comistream Project.
 * @license     GPL3.0 License
 * @version     1.0.1
 * @link        https://github.com/sorshi/comistream-reader
 *
 */

// 環境宣言
mb_internal_encoding('UTF-8');
putenv('LANG=ja_JP.UTF-8');
setlocale(LC_ALL, 'ja_JP.UTF-8');

// library
if (file_exists(__DIR__ . "/comistream_lib.php")) {
    require(__DIR__ . "/comistream_lib.php");
    writelog("DEBUG library file exist:" . __DIR__ . "/comistream_lib.php");
} else {
    exit(1);
}

// セッションスタート
session_start();
global $writelog_process_name;
$writelog_process_name = "comistream";

// DB接続
if ($global_use_db_flag == 1) {
    // SQLite設定
    if (databaseExists()) {
        $DSN = "sqlite:" . __DIR__ . '/../data/db/comistream.sqlite';
        try {
            $dbh = new PDO($DSN);
            $dbh->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            $dbh->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        } catch (PDOException $e) {
            echo '接続エラー: ' . $e->getMessage();
            die();
        }
    } else {
        // 初期設定
        // POSTされてきたら
        if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action']) && $_POST['action'] === 'initial_setup') {
            // 初期設定のフォームが送信された場合の処理
            writelog("DEBUG admin and DB setup");
            handleInitialSetup($_POST);
        } else {
            // 通常のアクセス時
            writelog("DEBUG initial setup" . $_SERVER['REQUEST_METHOD'] . " action:" . $_POST['action']);
            if (displayInitialSetupScreen()) {
                // 初期設定画面が表示された場合は、ここで処理を終了
                exit;
            }
            // 本来ならここに来ないはず
            errorExit("config invalid", "設定内容が異常です。");
        }
    }
} else {
    errorExit("config invalid", "設定内容が異常です。");
}

// 設定ファイル読み込み
global $conf;
global $publicDir, $md5cmd, $convert, $montage, $unzip, $unrar, $cpdf, $p7zip, $ffmpeg, $book_search_url, $cacheSize, $isPageSave, $isPreCache, $async, $width, $quality, $fullsize_png_compress, $global_debug_flag, $global_resize, $usm, $global_preload_pages, $global_preload_delay_ms;
// デフォルト値
$width = 800;
$quality = 75;
readConfig($dbh);
// 先読みキャッシュ枚数
$global_preload_pages = $conf["global_preload_pages"];
// 先読み実行遅延時間
$global_preload_delay_ms = $conf["global_preload_delay_ms"];

// パラメータ取得
$param = array(); // パラメータの初期化を追加

if ($_SERVER["REQUEST_METHOD"] == "POST") {
    $param = $_POST;
    // php://input から生のPOSTデータを取得
    $raw_post_data = file_get_contents('php://input');
    // +を一時的な文字列に置換してからparse_strを実行
    $raw_post_data = str_replace('+', '__PLUS__', $raw_post_data);
    parse_str($raw_post_data, $queryParams);
    foreach ($queryParams as $key => $value) {
        $param[$key] = str_replace('__PLUS__', '+', $value);
    }
    // GETパラメータがある場合
    if (!empty($_SERVER['QUERY_STRING'])) {
        // QUERY_STRINGを&で分割
        $query_parts = explode('&', $_SERVER['QUERY_STRING']);
        foreach ($query_parts as $query_part) {
            // =で分割してkey-valueを取得
            $parts = explode('=', $query_part, 2);
            if (count($parts) == 2) {
                $key = urldecode($parts[0]);
                // +を一時的な文字列に置換してからurldecodeし、その後+に戻す
                $value = str_replace('__PLUS__', '+',
                    urldecode(str_replace('+', '__PLUS__', $parts[1]))
                );
                $param[$key] = $value;
            }
        }
    }
} else {
    // QUERY_STRINGを&で分割
    $query_parts = explode('&', $_SERVER['QUERY_STRING']);
    foreach ($query_parts as $query_part) {
        // =で分割してkey-valueを取得
        $parts = explode('=', $query_part, 2);
        if (count($parts) == 2) {
            $key = urldecode($parts[0]);
            // +を一時的な文字列に置換してからurldecodeし、その後+に戻す
            $value = str_replace('__PLUS__', '+',
                urldecode(str_replace('+', '__PLUS__', $parts[1]))
            );
            $param[$key] = $value;
        }
    }
}

writelog("DEBUG QUERY_STRING:" . print_r($param, true) . " method:" . $_SERVER["REQUEST_METHOD"]);
// debugRequestParams();

$width = array_key_exists("width", $param) ? $param["width"] : $width;
$page = array_key_exists("page", $param) ? $param["page"] : "";
$quality = array_key_exists("quality", $param) ? $param["quality"] : $quality;
$file = array_key_exists("file", $param) ? $param["file"] : "";
$base_file_hash = array_key_exists("base_file_hash", $param) ? $param["base_file_hash"] : "";
$mode = array_key_exists("mode", $param) ? $param["mode"] : "";
$size = array_key_exists("size", $param) ? $param["size"] : "";
$newname = array_key_exists("newname", $param) ? $param["newname"] : "";
$orgname = array_key_exists("orgname", $param) ? $param["orgname"] : "";

if (array_key_exists("rename", $param)) $mode = "rename";
if (array_key_exists("delete", $param)) $mode = "delete";
if (array_key_exists("update", $param)) $mode = "update";
if (array_key_exists("delete", $param)) $mode = "delete";

$autosplit = array_key_exists("autosplit", $param) ? $param["autosplit"] : "on";
if (array_key_exists("view", $param)) {
    $view = $param["view"];
    $view_query = '&view=trimming';
    $split_button_class = 'button trimming';
    $split_button_text = '通常';
    writelog("DEBUG Query string : view split:$view");
} else {
    $view_query = '';
    $split_button_class = 'button normal';
    $split_button_text = '余白';
}

// Cookieからユーザ名取得
$COOKIE = getCookie();
$user = !empty($COOKIE['comistreamUser']) ? $COOKIE['comistreamUser'] : 'guest';

// サイズ設定の取得
if ($size !== 'FULL' && $size !== 'comp') {
    // sizeパラメータが未設定の場合はcookieを確認
    if (!empty($COOKIE['rawMode'])) {
        if ($COOKIE['rawMode'] === 'raw') {
            $size = 'FULL';
            $_SESSION['packetSave'] = false;
        } elseif ($COOKIE['rawMode'] === 'cmp') {
            $size = 'comp';
            $_SESSION['packetSave'] = true;
        }else{
            $COOKIE['rawMode'] = 'cmp';
            $size = 'comp';
            $_SESSION['packetSave'] = true;
        }
        writelog("DEBUG size setting by cookie:" . $size);
    }
    // cookieも未設定の場合はデフォルト値を設定
    if (empty($size)) {
        $size = 'comp';
        $COOKIE['rawMode'] = 'cmp';
        $_SESSION['packetSave'] = true;
        writelog("DEBUG size setting by default:" . $size);
    }
}

if ($mode === 'delete' && !empty($orgname)) {

    // ファイル削除
    // 未実装
    // fileDelete();
} elseif ($mode === 'rename' && !empty($orgname) && !empty($newname)) {

    // ファイルリネーム
    // 未実装
    // fileRename();
} elseif ($mode === 'login') {
    // ログイン時にいたページに戻れるようにリファラをセッションに追加
    if (empty($_SESSION['referer'])) {
        $_SESSION['referer'] = $_SERVER['HTTP_REFERER'];
        writelog("DEBUG login set referer:" . $_SERVER['HTTP_REFERER']);
    } else {
        writelog("DEBUG login referer exist:" . $_SESSION['referer']);
    }
    // 管理者ログイン
    adminLogin($dbh);
} elseif ($mode === 'logout') {

    // ログアウト
    logout($dbh);
}elseif($mode==='checkAdminAndSession'){
    // 管理者とセッションチェック
    checkAdminAndSession($dbh);
} elseif ($mode === 'update' && !empty($orgname) && !empty($newname)) {

    // 表紙とプレビュー削除
    coverUpdate();
} elseif ($mode === 'detail') {

    // 書籍詳細表示
    // W.I.P.
    // openBookDetail();
} elseif (($mode === 'favON' || $mode === 'favOFF') && (!empty($file) || !empty($base_file_hash))) {

    // お気に入り設定
    setFavorite();
} elseif (($mode === 'readON' || $mode === 'readOFF') && (!empty($file) || !empty($base_file_hash))) {

    // お気に入り設定
    setHasRead();
} elseif ($mode === 'delHistory' && !empty($file)) {

    // 履歴から該当ファイルを削除
    delHistory();
} elseif ($mode === 'list' && !empty($file)) {

    // ブックマークファイル取得
    getBookmarkList();
} elseif ($mode === 'currentPage' && !empty($file)) {

    // 現在のページ位置取得
    getCurrentPage();
} elseif ($mode === 'history') {

    // 最近開いたファイル取得
    getHistory();
} elseif ($mode === 'recent') {

    // 閲覧履歴取得
    getRecentBooks();
} elseif ($mode === 'close' && !empty($file)) {

    // 最近開いたファイル取得
    saveBookmark();
} elseif ($mode === 'check_loading' && !empty($file)) {

    // Loading画面用ステータスを返す
    checkLoading($file);
} elseif ($mode !== 'open' && $page !== '0' && !empty($file)) {

    // 指定されたページをjpg/webpストリームとして出力する
    outputPage();
    exit(0);
} elseif ($mode === 'open' && !empty($file)) {

    // ファイルオープン
    list($escapedFile, $coverFile, $previewFile) = openPage();
    printHTML();
    makeCover($escapedFile, $coverFile, $previewFile);
    exit(0);
} elseif ($mode === 'config') {
    // 環境設定
    // 管理者ユーザーのみ可能
    system_config($dbh);
} else {
    // エラー出力して終了
    errorExit('Invalid arguments', '引数が正しくありません。?mode=open&file=[file/to/path.zip] のようにファイル情報を渡してください。');
}
