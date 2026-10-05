<?php

/**
 * Comistream Reader View Library
 *
 * Comistreamのビューを提供するライブラリファイル。
 * ベースhtml出力、エラー出力などの
 * ビュー関連の機能を実装しています。
 *
 * @package     sorshi/comistream-reader
 * @author      Comistream Project.
 * @copyright   2024 Comistream Project.
 * @license     AGPL-3.0-only for Comistream Reader project-specific portions; see repository-root LICENSING.md
 * @version     2.0.0
 * @link        https://github.com/sorshi/comistream-reader
 */


function loadReaderInspectorJs(): string
{
    global $conf;
    $path = $conf['comistream_tool_dir'] . '/code/reader_inspector.js';
    if (!is_file($path)) {
        errorExit('js_file_missing', 'reader_inspector.js missing');
    }
    $source = file_get_contents($path);
    if ($source === false) {
        errorExit('js_file_read_error', 'reader_inspector.js read failed');
    }
    return $source;
}

function generateReaderInspectorHTML(string $closeLabel): string
{
    // 閉じる操作は通常のUI言語、診断情報の見出しは英語にするルン。
    $closeLabel = htmlspecialchars($closeLabel, ENT_QUOTES, 'UTF-8');
    return <<<HTML
<dialog id="inspector" class="inspector" aria-labelledby="inspector-title">
    <div class="inspector-header">
        <span id="inspector-title" lang="en">Inspector</span>
        <button id="inspector-close" type="button" aria-label="{$closeLabel}"><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
    </div>
    <div id="inspector-content" class="inspector-content" lang="en" tabindex="0"></div>
</dialog>
HTML;
}

##### ベースhtml出力 #####################################################################

/**
 * HTML生成関数 ルン！テストしやすいようにHTML文字列を返すルン！
 *
 * @return string 生成されたHTML文字列
 */
function generateHTML()
{
    global $conf, $cacheDir, $size, $global_preload_pages, $global_debug_flag, $page, $maxPage, $degree,
        $indexArray, $position, $direction, $autosplit, $fileSize, $averagePageBytes, $baseFile,
        $escapedFile, $file, $size, $view_query, $global_preload_delay_ms, $publicDir, $pageTitle,
        $bookName, $contents, $split_button_class, $split_button_text, $pagemode_button_class, $pagemode_button_text;
    global $user, $readerMarkerCsrfToken;

    // I18nインスタンスを取得
    $i18n = I18n::getInstance();
    if ($i18n === null) {
        writelog("ERROR I18n instance is null");
        errorExit('i18n_init_failed', 'Failed to initialize I18n');
    }

    // CSSファイルの読み込み
    if (!isset($conf["comistream_tool_dir"])) {
        writelog("ERROR comistream_tool_dir not configured");
        errorExit('config_missing', 'comistream_tool_dir not found in configuration');
    }
    if (file_exists($conf["comistream_tool_dir"] . '/code/comistream.css')) {
        $contents_css = file_get_contents($conf["comistream_tool_dir"] . '/code/comistream.css');
        writelog("DEBUG CSS file exist.");
    } else {
        writelog("ERROR CSS not found:" . __DIR__);
        errorExit('css_file_missing', 'CSS file not found at: ' . $conf["comistream_tool_dir"] . '/code/comistream.css');
    }

    // JavaScriptファイルの読み込み
    $viewportJsPath = $conf["comistream_tool_dir"] . '/code/comistream_viewport.js';
    if (!file_exists($viewportJsPath)) {
        writelog("ERROR generateHTML() comistream_viewport.js not found: {$viewportJsPath}", 'view');
        errorExit('js_file_missing', 'JavaScript file not found at: ' . $viewportJsPath);
    }
    $viewport_js = file_get_contents($viewportJsPath);
    if ($viewport_js === false) {
        writelog("ERROR generateHTML() failed to read comistream_viewport.js", 'view');
        errorExit('js_file_read_error', 'comistream_viewport.js read failed');
    }

    $readerMarkerJsPath = $conf["comistream_tool_dir"] . '/code/reader_markers.js';
    if (!file_exists($readerMarkerJsPath)) {
        writelog("ERROR generateHTML() reader_markers.js not found: {$readerMarkerJsPath}", 'view');
        errorExit('js_file_missing', 'reader_markers.js missing');
    }
    $readerMarkerJs = file_get_contents($readerMarkerJsPath);
    if ($readerMarkerJs === false) {
        writelog("ERROR generateHTML() failed to read reader_markers.js", 'view');
        errorExit('js_file_read_error', 'reader_markers.js read failed');
    }

    $readerProgressJs = file_get_contents($conf["comistream_tool_dir"] . '/code/reader_progress.js');
    $readerProgressConfigJson = json_encode([
        'isGuest' => ($user ?? 'guest') === 'guest',
        'userKey' => hash('sha256', (string)($user ?? 'guest')),
        'bookKey' => (string)$baseFile,
        'requestedPage' => parseReaderInteger($_GET['page'] ?? null, 1, 2147483647),
    ], JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);

    $readerJsPath = $conf["comistream_tool_dir"] . '/code/comistream.js';
    if (file_exists($readerJsPath)) {
        $reader_js = file_get_contents($readerJsPath);
        if ($reader_js === false) {
            writelog("ERROR generateHTML() failed to read comistream.js", 'view');
            errorExit('js_file_read_error', 'comistream.js read failed');
        }
        $contents_js = $viewport_js . "\n" . $readerMarkerJs . "\n" . loadReaderInspectorJs() . "\n" . $reader_js;
        writelog("DEBUG JS file exist.");
    } else {
        writelog("ERROR JS not found:" . __DIR__);
        errorExit('js_file_missing', 'JavaScript file not found at: ' . $readerJsPath);
    }

    // 動作モード設定 ルン！現在のモードを表示するルン！
    if ($size === 'FULL') {
        $size_button_flag = $i18n->get('full_size'); // 現在のモードを表示
        $size_button_class = 'button raw';
        // FULLサイズはモバイルネットワークではないと想定してプリロードページ数を4倍に
        $global_preload_pages *= 4;
    } else {
        $size_button_flag = $i18n->get('compressed');
        $size_button_class = 'button cmp';
    }

    // 綴じ方向ボタンの設定 ルン！現在のモードを表示するルン！
    if ($direction === 'left') {
        // 右綴じ（デフォルト）
        $direction_button_text = $i18n->get('direction_right');
        $direction_button_class = 'button right-to-left';
    } else {
        // 左綴じ
        $direction_button_text = $i18n->get('direction_left');
        $direction_button_class = 'button left-to-right';
    }

    // デバッグフラグをJSONに変換(JS埋め込み用)
    $debug_flag = json_encode($global_debug_flag);

    // ページ数が最大ページ数を超えていたら最大ページ数に修正
    $page = readerPageForDisplay($page, $maxPage);
    $pageJson = json_encode($page);
    // サイト名
    $apple_mobile_web_app_title = $conf['siteName'];

    // themeもpath
    $themeDir = ''; // themeは常にwebroot直下

    // ツールチップ用の翻訳テキストを取得してから言語選択HTMLを生成するルン！
    $tooltip_language_text = $i18n->get('tooltip_language');

    // 言語選択用のHTMLを生成（ツールチップ付き）
    $langSelectorHtml = $i18n->getLangSelectorHtml($tooltip_language_text);
    // 言語切り替え用のJavaScript
    $langSwitcherJs = $i18n->getLangSwitcherJs();

    // 新規ページ出力モジュールテスト
    // if ($_SESSION['pageGenerator'] == 1) {
    //     $pageGenerator = "const pageGenerator = \"/cgi-bin/comistream_page_out\";";
    //     writelog("DEBUG printHTML() pageGenerator: comistream_page_out");
    // } else {
    $pageGenerator = "const pageGenerator = \"/cgi-bin/comistream.php\";";
    // }

    // JavaScript用に安全にエンコードした変数を準備
    $baseFileJson = json_encode($baseFile);
    $escapedFileJson = json_encode($escapedFile);
    $fileJson = json_encode($file);
    $positionJson = json_encode($position);
    $directionJson = json_encode($direction);
    $autosplitJson = json_encode($autosplit);
    $sizeJson = json_encode($size);
    $viewQueryJson = json_encode($view_query);
    $preloadDelayJson = json_encode($global_preload_delay_ms);
    $publicDirJson = json_encode($publicDir);
    $themeDirJson = json_encode($themeDir);
    $readerMarkerCsrfJson = json_encode((string)$readerMarkerCsrfToken);
    $readerMarkerIsGuestJson = json_encode($user === 'guest');
    $readerMarkerFormatJson = json_encode(
        strtolower(pathinfo((string)$baseFile, PATHINFO_EXTENSION)) === 'pdf' ? 'pdf' : 'archive'
    );

    // 収録されている最初のJPEG XLページをブラウザのデコード確認に使うルン！
    $jpegXlProbePage = 0;
    $archiveIndexPath = $cacheDir . '/' . $file . '/index';
    $archiveIndexLines = @file($archiveIndexPath, FILE_IGNORE_NEW_LINES);
    if (is_array($archiveIndexLines)) {
        foreach ($archiveIndexLines as $pageIndex => $archivePagePath) {
            if (preg_match('/\.jxl\s*$/i', $archivePagePath)) {
                $jpegXlProbePage = $pageIndex + 1;
                break;
            }
        }
    }

    // HTMLエスケープ処理 ルン！XSS対策大事ルン！
    $apple_mobile_web_app_title = htmlspecialchars($apple_mobile_web_app_title, ENT_QUOTES, 'UTF-8');
    $size_button_flag = htmlspecialchars($size_button_flag, ENT_QUOTES, 'UTF-8');
    $pagemode_button_text = htmlspecialchars($pagemode_button_text, ENT_QUOTES, 'UTF-8');
    $split_button_text = htmlspecialchars($split_button_text, ENT_QUOTES, 'UTF-8');
    $direction_button_text = htmlspecialchars($direction_button_text, ENT_QUOTES, 'UTF-8');
    $alt_close_button = htmlspecialchars($i18n->get('alt_close_button'), ENT_QUOTES, 'UTF-8');
    $alt_quick_spread_left = htmlspecialchars($i18n->get('alt_quick_spread_left'), ENT_QUOTES, 'UTF-8');
    $alt_quick_spread_right = htmlspecialchars($i18n->get('alt_quick_spread_right'), ENT_QUOTES, 'UTF-8');
    $readerMarkersLabel = htmlspecialchars($i18n->get('reader_markers'), ENT_QUOTES, 'UTF-8');
    $readerMarkerAddLabel = htmlspecialchars($i18n->get('reader_marker_add'), ENT_QUOTES, 'UTF-8');
    $tocLabel = htmlspecialchars($i18n->get('epub_toc'), ENT_QUOTES, 'UTF-8');
    $endTitle = htmlspecialchars($i18n->get('epub_end_title'), ENT_QUOTES, 'UTF-8');
    $endBackLabel = htmlspecialchars($i18n->get('epub_end_back'), ENT_QUOTES, 'UTF-8');
    $endReturnLabel = htmlspecialchars($i18n->get('epub_end_return'), ENT_QUOTES, 'UTF-8');
    $endBookTitle = htmlspecialchars((string)$baseFile, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');

    // $pageTitleは既にget_book_title()内でエスケープ済みルン！
    // $bookNameはHTMLタグ（<small>、<a>など）を含む前提で処理されてるから、
    // get_book_title()内で個別の値をエスケープしてからタグを追加してるルン！
    // $contentsもHTMLタグを含むTOC（目次）コンテンツルン。
    // これらは信頼できるソースから生成されるけど、念のため確認するルン！

    // $maxPageは整数型として扱うルン！念のため明示的に整数化するルン！
    $maxPage = intval($maxPage);

    // i18nのJavaScript用データを安全にエンコードするルン！
    // json_encode()を使うことで、クォートや改行などが適切にエスケープされて、
    // XSSの脆弱性を防げるルン☆
    $i18n_js_data = json_encode([
        'fullscreen_not_supported' => $i18n->get('fullscreen_not_supported'),
        'author_link_not_found' => $i18n->get('author_link_not_found'),
        'title_link_not_found' => $i18n->get('title_link_not_found'),
        'input_alphanumeric' => $i18n->get('input_alphanumeric'),
        'connection_error' => $i18n->get('connection_error'),
        'toc_button_full' => $i18n->get('full_size'),
        'toc_button_compress' => $i18n->get('compressed'),
        'toc_button_fullsize' => $i18n->get('full_size'),
        'toc_button_trimming' => $i18n->get('trimmingmode_trimming'),
        'toc_button_normal' => $i18n->get('trimmingmode_normal'),
        'toc_button_single' => $i18n->get('single_page'),
        'toc_button_spread' => $i18n->get('spread_page'),
        'toc_button_auto' => $i18n->get('auto_page'),
        'tooltip_auto_page' => $i18n->get('tooltip_auto_page'),
        'toc_button_direction_right' => $i18n->get('direction_right'),
        'toc_button_direction_left' => $i18n->get('direction_left'),
        'toc_button_fullscreen' => $i18n->get('fullscreen'),
        'toc_button_windowed' => $i18n->get('windowed'),
        'large_page_notification' => $i18n->get('large_page_notification'),
        'reader_sync_forward' => $i18n->get('reader_sync_forward'),
        'reader_start_confirm' => $i18n->get('reader_start_confirm'),
        'reader_sync_changed' => $i18n->get('reader_sync_changed'),
        'reader_sync_epub' => $i18n->get('reader_sync_epub'),
        'reader_sync_unsaved' => $i18n->get('reader_sync_unsaved'),
        'reader_markers' => $i18n->get('reader_markers'),
        'reader_marker_default' => $i18n->get('reader_marker_default'),
        'reader_marker_add' => $i18n->get('reader_marker_add'),
        'reader_marker_edit' => $i18n->get('reader_marker_edit'),
        'reader_marker_delete' => $i18n->get('reader_marker_delete'),
        'reader_marker_save' => $i18n->get('reader_marker_save'),
        'reader_marker_cancel' => $i18n->get('reader_marker_cancel'),
        'reader_marker_name_placeholder' => $i18n->get('reader_marker_name_placeholder'),
        'reader_marker_added' => $i18n->get('reader_marker_added'),
        'reader_marker_updated' => $i18n->get('reader_marker_updated'),
        'reader_marker_deleted' => $i18n->get('reader_marker_deleted'),
        'reader_marker_limit' => $i18n->get('reader_marker_limit'),
        'reader_marker_error' => $i18n->get('reader_marker_error'),
        'reader_marker_empty' => $i18n->get('reader_marker_empty'),
        'reader_marker_page' => $i18n->get('reader_marker_page'),
        'reader_marker_cluster' => $i18n->get('reader_marker_cluster')
    ], JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);

    // ツールチップ用の翻訳テキストを準備するルン！
    $tooltip_back = htmlspecialchars($i18n->get('tooltip_back'), ENT_QUOTES, 'UTF-8');
    $tooltip_full_size = htmlspecialchars($i18n->get('tooltip_full_size'), ENT_QUOTES, 'UTF-8');
    $tooltip_compressed = htmlspecialchars($i18n->get('tooltip_compressed'), ENT_QUOTES, 'UTF-8');
    $tooltip_single_page = htmlspecialchars($i18n->get('tooltip_single_page'), ENT_QUOTES, 'UTF-8');
    $tooltip_spread_page = htmlspecialchars($i18n->get('tooltip_spread_page'), ENT_QUOTES, 'UTF-8');
    $tooltip_spread_fix = htmlspecialchars($i18n->get('tooltip_spread_fix'), ENT_QUOTES, 'UTF-8');
    $tooltip_direction = htmlspecialchars($i18n->get('tooltip_direction'), ENT_QUOTES, 'UTF-8');
    $tooltip_fullscreen = htmlspecialchars($i18n->get('tooltip_fullscreen'), ENT_QUOTES, 'UTF-8');
    $tooltip_trimmingmode_trimming = htmlspecialchars($i18n->get('tooltip_trimmingmode_trimming'), ENT_QUOTES, 'UTF-8');
    $tooltip_trimmingmode_normal = htmlspecialchars($i18n->get('tooltip_trimmingmode_normal'), ENT_QUOTES, 'UTF-8');
    $tooltip_clock = htmlspecialchars($i18n->get('tooltip_clock'), ENT_QUOTES, 'UTF-8');
    $inspectorHtml = generateReaderInspectorHTML($i18n->get('alt_close_button'));
    $tooltip_inspector = htmlspecialchars($i18n->get('tooltip_inspector'), ENT_QUOTES, 'UTF-8');
    $tooltip_language = htmlspecialchars($i18n->get('tooltip_language'), ENT_QUOTES, 'UTF-8');

    $htmlContent =  <<<EOF
<!DOCTYPE html>
<html lang="{$i18n->getCurrentLang()}" data-long-press-delay="500">
<head>
    <meta http-equiv="Content-Type" CONTENT="text/html; charset=UTF-8">
    <meta name="viewport" content="width=device-width, viewport-fit=cover" />
    <meta name="theme-color" content="#606060" />
    <link rel="manifest" href="/theme/manifest.json" crossorigin="use-credentials">
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-touch-fullscreen" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="$apple_mobile_web_app_title">
    <script src="$themeDir/theme/js/long-press-event.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/feather-icons/4.29.2/feather.min.js" integrity="sha512-zMm7+ZQ8AZr1r3W8Z8lDATkH05QG5Gm2xc6MlsCdBz9l6oE8Y7IXByMgSm/rdRQrhuHt99HAYfMljBOEZ68q5A==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
    <style type="text/css"><!--
    :root {
        --arrowR-url: url("$themeDir/theme/icons/arrowR.png");
        --arrowL-url: url("$themeDir/theme/icons/arrowL.png");
        --nextR-url: url("$themeDir/theme/icons/nextR.png");
        --nextL-url: url("$themeDir/theme/icons/nextL.png");
        --setting-url: url("$themeDir/theme/icons/setting.png");
        --loading-circle-url: url("$themeDir/theme/icons/loadingCircle.gif");
        --degree: rotateY($degree);
    }
    $contents_css
    --></style>

    <script>
    <!--
        // PHPの設定に基づいてJavaScriptのデバッグフラグを設定するルン！
        window.DEBUG_ENABLED = $debug_flag;

        // 多言語対応用のメッセージを設定するルン！
        // json_encode()を使って安全にエスケープしてるから、XSSの心配はないルン☆
        window.i18n = $i18n_js_data;

        (function() {
            // 即時関数の定義と実行
            window.debugLog = function(message) {
                    if (window.DEBUG_ENABLED) {
                            console.debug(message);
                    }
            };
        })();

        var page = $pageJson;
        var prevPage = $pageJson;
        var indexArray = [$indexArray];
        var position = $positionJson;
        var direction = $directionJson;
        var autoSplit = $autosplitJson; // クエリパラメータで停止 offか空文字
        const archiveFileMBytes = $fileSize; // オープンしたファイルのサイズ（MB）
        const averagePageKBytes = $averagePageBytes; // オリジナルの平均ページサイズ(KB)
        const maxPage = $maxPage;
        const baseFile = $baseFileJson;
        const escapedFile = $escapedFileJson;
        const file = $fileJson;
        const size = $sizeJson;
        const view_query = $viewQueryJson;
        const global_preload_delay_ms = $preloadDelayJson;
        const publicDir = $publicDirJson;
        const themeDir = $themeDirJson;
        const readerMarkerConfig = {
            csrfToken: $readerMarkerCsrfJson,
            isGuest: $readerMarkerIsGuestJson,
            format: $readerMarkerFormatJson
        };
        const jpegXlProbePage = $jpegXlProbePage;
        let global_preload_pages = $global_preload_pages;
        $pageGenerator

        window.readerProgressConfig = $readerProgressConfigJson;
        $readerProgressJs
        // comistream.js
        $contents_js

        // 言語切り替え用JavaScript
        $langSwitcherJs

        // DOMが読み込まれた後にfeather.replace()を呼び出す
        document.addEventListener('DOMContentLoaded', function() {
            feather.replace();
            // 大きなページサイズの通知をチェック
            checkAndShowLargePageNotification();
        });
    //-->
    </script>
    <title>$pageTitle</title>
</head>

<body onload="restorePage()" data-long-press-delay="500">

<div id="clock" class="clock-container clock-hidden">00:00</div>

<div id="loading" class="loading"></div>

<div class="canvas" id="image"></div>
<div class="canvas" style="width:50%; display:none;" id="nextimage"></div>

<div class="canvas" style="width:0%; display:none;" id="dummyimage"></div>
<div class="progressbox"><div class="progress-left" id="progress"></div></div>

<table data-long-press-delay="500"><tr style="height: 20%;">
    <td class="leftIndex" onclick="leftIndex()" ></td>
    <td colspan="3" class="center" onclick="index()" ></td>
    <td class="rightIndex" onclick="rightIndex()" ></td>
</tr><tr>
    <td class="left" onclick="leftward()" ></td>
    <td class="left-under" onclick="leftward()" ></td>
    <td class="center" onclick="index()" ></td>
    <td class="right-under" onclick="rightward()" ></td>
    <td class="right" onclick="rightward()" ></td>
</tr></table>

<div class="contents" id="contents">
    <div>
        <div class="reader-menu-header">
            <button type="button" class="reader-menu-dismiss" aria-label="$alt_close_button" onclick="document.getElementById('contents').style.display='none'"><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
            <button type="button" class="button button-close reader-menu-back" onclick="backListPage();" data-tooltip="$tooltip_back"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m6-6-6 6 6 6"/></svg><span>{$i18n->get('back')}</span></button>
        </div>
        <div class="toc-buttons">
            <div class="reader-utility-actions">
                $langSelectorHtml
                <button type="button" aria-pressed="false" aria-label="$tooltip_clock" class="clock-icon-button" id="clockToggleButton" onclick="toggleClock()" data-tooltip="$tooltip_clock"><i data-feather="clock"></i></button>
                <button type="button" aria-pressed="false" aria-label="$tooltip_inspector" class="inspector-icon-button" id="inspectorToggleButton" onclick="showInspector()" data-tooltip="$tooltip_inspector"><i data-feather="info"></i></button>
            </div>
            <button type="button" class="$split_button_class button-mode" id="splitFile" onclick="toggleTrimmingFile()" data-tooltip-trimming="$tooltip_trimmingmode_trimming" data-tooltip-normal="$tooltip_trimmingmode_normal">$split_button_text</button>
            <button type="button" class="button button-mode" id="fullScreenButton" onclick="toggleFullScreen()" data-tooltip="$tooltip_fullscreen">{$i18n->get('windowed')}</button>
            <button type="button" class="$direction_button_class button-mode" id="direction" onclick="toggleDirection()" data-tooltip="$tooltip_direction">$direction_button_text</button>
            <button type="button" class="button button-mode" onclick="fixSpreadPage();" data-tooltip="$tooltip_spread_fix">{$i18n->get('spread_fix')}</button>
            <button type="button" id="pageMode" class="$pagemode_button_class button-mode" onclick="togglePageMode()" data-tooltip-single="$tooltip_single_page" data-tooltip-spread="$tooltip_spread_page">$pagemode_button_text</button>
            <button type="button" id="rawMode" class="$size_button_class button-mode" onclick="toggleRaw();" data-tooltip-full="$tooltip_full_size" data-tooltip-compressed="$tooltip_compressed">$size_button_flag</button>
        </div>
        <div style="clear:both;">
            <div class="bookName">$bookName</div>
            <span class="reader-marker-slider">
                <input id="slider" type="range" value="$maxPage" min="1" max="$maxPage" step="1" />
                <span id="image-marker-rail" class="reader-marker-rail"></span>
            </span><span id="value" class="value">1</span>
        </div>
        <div class="reader-marker-section">
            <div class="reader-marker-heading-row">
                <span class="reader-marker-heading">$readerMarkersLabel</span>
                <button id="image-marker-add" class="reader-marker-add" type="button">$readerMarkerAddLabel</button>
            </div>
            <div id="image-marker-status" class="reader-marker-status" role="status" aria-live="polite"></div>
            <div id="image-marker-list" class="reader-marker-list"></div>
        </div>
        <hr>
        <div class="reader-toc-heading">{$tocLabel}</div>
        <div class="toclist">$contents</div>
    </div>
</div>

<dialog id="suggest" class="reader-end-panel" aria-modal="true" aria-labelledby="suggest-title">
    <h2 id="suggest-title">{$endTitle}</h2>
    <div id="suggest-book-title" class="reader-end-book-title">{$endBookTitle}</div>
    <div class="reader-end-actions">
        <button id="suggest-return" class="button button-mode" type="button" onclick="hideSuggestPanel();">{$endReturnLabel}</button>
        <button id="suggest-back" class="button button-close" type="button" onclick="backListPage();">{$endBackLabel}</button>
    </div>
    <div id="suggest-books" class="reader-end-books" hidden></div>
</dialog>

<div id="overlay" class="overlay"></div>
<div id="modal" class="modal">
    <div class="modal-content">
        <img id="image1" alt="$alt_quick_spread_left">
        <img id="image2" alt="$alt_quick_spread_right">
    </div>
</div>

$inspectorHtml

</body>
</html>

EOF;

    return $htmlContent;
} //end function generateHTML

/**
 * HTML出力関数 ルン！ヘッダー設定して出力するルン！
 * generateHTML()を呼んで結果を出力するルン。
 *
 * @return void
 */
function printHTML()
{
    // HTML文字列を生成 ルン！
    header('Cache-Control: private, no-store');
    $html = generateHTML();
    writelog("DEBUG printHTML() HTML generated: length=" . strlen($html) . " bytes");

    // ヘッダーがまだ送信されていない場合のみContent-Typeヘッダーを設定 ルン！
    if (!headers_sent()) {
        header('Content-Type: text/html; charset=utf-8');
    } else {
        writelog("WARNING printHTML: Headers already sent, cannot set Content-Type.");
    }

    // compressResponse関数が利用可能な場合は圧縮、そうでなければそのまま出力 ルン！
    if (function_exists('compressResponse')) {
        echo compressResponse($html);
    } else {
        writelog("WARNING printHTML: compressResponse function not found, output without compression.");
        echo $html;
    }

    writelog("DEBUG printHTML done.");
} //end function printHTML

function getEpubLoadingCoverUrl(string $coverRoot, string $publicFilePath): string
{
    // 一覧と同じ拡張子置換で、作成済みの表紙だけを使うルン。
    $relativePath = preg_replace('/\.[^.]+$/', '.jpg', ltrim($publicFilePath, '/'));
    $coverPath = resolveReaderCacheFile($coverRoot, $relativePath);
    if ($coverPath === false || !is_readable($coverPath)) {
        return '';
    }
    return '/theme/covers/' . urlEncodeFilePath($relativePath);
}

function generateEpubHTML(): string
{
    global $conf, $bookName, $escapedFile, $baseFile, $user, $readerMarkerCsrfToken;

    $i18n = I18n::getInstance();
    if ($i18n === null) {
        writelog("ERROR generateEpubHTML() i18n is null");
        errorExit('i18n_init_failed', 'Failed to initialize I18n');
    }

    $epubPackageBase = (string)($conf['epub_reader_package_base'] ?? '');
    $epubUrl = (string)($conf['epub_reader_url'] ?? '');
    if ($epubPackageBase === '' && $epubUrl === '') {
        writelog("ERROR generateEpubHTML() epub_reader_package_base and epub_reader_url are empty", 'view');
        errorExit('invalid_configuration', 'epub_reader_url_not_found');
    }

    $epubJsPath = $conf["comistream_tool_dir"] . '/code/epub_reader.js';
    if (!file_exists($epubJsPath)) {
        writelog("ERROR generateEpubHTML() epub_reader.js not found: {$epubJsPath}", 'view');
        errorExit('js_file_missing', 'epub_reader.js missing');
    }
    $epubEndJs = file_get_contents($conf["comistream_tool_dir"] . '/code/epub_end.js');
    if ($epubEndJs === false) {
        errorExit('js_file_read_error', 'epub_end.js read failed');
    }
    $readerInspectorJs = loadReaderInspectorJs();
    $epubReaderJs = file_get_contents($epubJsPath);
    if ($epubReaderJs === false) {
        writelog("ERROR generateEpubHTML() failed to read epub_reader.js", 'view');
        errorExit('js_file_read_error', 'epub_reader.js read failed');
    }
    $readerMarkerJsPath = $conf["comistream_tool_dir"] . '/code/reader_markers.js';
    if (!file_exists($readerMarkerJsPath)) {
        writelog("ERROR generateEpubHTML() reader_markers.js not found: {$readerMarkerJsPath}", 'view');
        errorExit('js_file_missing', 'reader_markers.js missing');
    }
    $readerMarkerJs = file_get_contents($readerMarkerJsPath);
    if ($readerMarkerJs === false) {
        writelog("ERROR generateEpubHTML() failed to read reader_markers.js", 'view');
        errorExit('js_file_read_error', 'reader_markers.js read failed');
    }
    $constructStyleSheetsPolyfillJs = <<<'JS'
if (!('adoptedStyleSheets' in ShadowRoot.prototype) && typeof CSSStyleSheet === 'function') {
    const adoptedSheets = new WeakMap();

    Object.defineProperty(ShadowRoot.prototype, 'adoptedStyleSheets', {
        configurable: true,
        enumerable: true,
        get() {
            return adoptedSheets.get(this) || [];
        },
        set(sheets) {
            const normalizedSheets = Array.isArray(sheets) ? sheets : [];
            adoptedSheets.set(this, normalizedSheets);

            for (const style of this.querySelectorAll('style[data-comistream-construct-style-sheet]')) {
                style.remove();
            }

            for (const sheet of normalizedSheets) {
                const style = document.createElement('style');
                style.dataset.comistreamConstructStyleSheet = '1';
                style.textContent = [...sheet.cssRules].map((rule) => rule.cssText).join('\n');
                this.prepend(style);
            }
        }
    });
}
JS;
    $constructStyleSheetsPolyfillJs = str_replace(
        ['`', '${', '</script>'],
        ['\\`', '\\${', '<\\/script>'],
        $constructStyleSheetsPolyfillJs
    );

    $readerCssPath = $conf["comistream_tool_dir"] . '/code/comistream.css';
    if (!file_exists($readerCssPath)) {
        writelog("ERROR generateEpubHTML() comistream.css not found: {$readerCssPath}", 'view');
        errorExit('css_file_missing', 'comistream.css missing');
    }
    $readerCss = file_get_contents($readerCssPath);
    if ($readerCss === false) {
        writelog("ERROR generateEpubHTML() failed to read comistream.css", 'view');
        errorExit('css_file_read_error', 'comistream.css read failed');
    }

    $readerProgressJs = file_get_contents($conf["comistream_tool_dir"] . '/code/reader_progress.js');
    $savedCfi = (string)($conf['epub_saved_cfi'] ?? '');
    $loadingCoverUrl = (string)($conf['epub_loading_cover_url'] ?? '');
    $loadingCoverHtml = $loadingCoverUrl === '' ? ''
        : '<img id="epub-loading-cover" src="' . htmlspecialchars($loadingCoverUrl, ENT_QUOTES, 'UTF-8')
            . '" alt="" aria-hidden="true" decoding="async" hidden>';
    $savedUpdatedAt = (int)($conf['epub_saved_updated_at'] ?? 0);
    $readerFallbackParentUrl = (string)($conf['reader_fallback_parent_url'] ?? '/');
    $readerFallbackHomeUrl = (string)($conf['reader_fallback_home_url'] ?? '/');
    $manifestUrl = '/theme/manifest.json';
    $serviceWorkerUrl = '';
    $serviceWorkerScope = '/';
    $debugEnabled = isset($conf['isDebugMode']) && (int)$conf['isDebugMode'] === 1;
    $isDebugConsoleAdminOnly = ((int)($conf['isDebugConsoleAdminOnly'] ?? 1) === 0) ? 0 : 1;
    $isAdmin = false;
    $debugConsoleEnabled = $debugEnabled && ($isDebugConsoleAdminOnly === 0 || $isAdmin);
    $configJson = json_encode([
        'publicDir' => (string)($conf['publicDir'] ?? ''),
        'bookIconUrl' => '/theme/icons/book.png',
        'epubPackageBase' => $epubPackageBase,
        'epubUrl' => $epubUrl,
        'escapedFile' => (string)$escapedFile,
        'baseFile' => (string)$baseFile,
        'csrfToken' => (string)$readerMarkerCsrfToken,
        'isGuest' => $user === 'guest',
        'userKey' => hash('sha256', (string)$user),
        'savedCfi' => $savedCfi,
        'savedUpdatedAt' => $savedUpdatedAt,
        'readerFallbackParentUrl' => $readerFallbackParentUrl,
        'readerFallbackHomeUrl' => $readerFallbackHomeUrl,
        'manifestUrl' => $manifestUrl,
        'serviceWorkerUrl' => $serviceWorkerUrl,
        'serviceWorkerScope' => $serviceWorkerScope,
        'debugEnabled' => $debugEnabled,
        'debugConsoleEnabled' => $debugConsoleEnabled,
        'isDebugConsoleAdminOnly' => $isDebugConsoleAdminOnly,
        'isAdmin' => $isAdmin,
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
    $debugEnabledJson = json_encode($debugEnabled);
    $debugConsoleEnabledJson = json_encode($debugConsoleEnabled);

    $langSelectorHtml = $i18n->getLangSelectorHtml($i18n->get('tooltip_language'));
    $langSwitcherJs = $i18n->getLangSwitcherJs();

    $tooltipBack = htmlspecialchars($i18n->get('tooltip_back'), ENT_QUOTES, 'UTF-8');
    $tooltipFullscreen = htmlspecialchars($i18n->get('tooltip_fullscreen'), ENT_QUOTES, 'UTF-8');
    $tooltipClock = htmlspecialchars($i18n->get('tooltip_clock'), ENT_QUOTES, 'UTF-8');
    $inspectorHtml = generateReaderInspectorHTML($i18n->get('alt_close_button'));
    $tooltipInspector = htmlspecialchars($i18n->get('tooltip_inspector'), ENT_QUOTES, 'UTF-8');
    $tooltipEpubPrevPage = htmlspecialchars($i18n->get('tooltip_epub_prev_page'), ENT_QUOTES, 'UTF-8');
    $tooltipEpubNextPage = htmlspecialchars($i18n->get('tooltip_epub_next_page'), ENT_QUOTES, 'UTF-8');
    $tooltipEpubPrevSection = htmlspecialchars($i18n->get('tooltip_epub_prev_section'), ENT_QUOTES, 'UTF-8');
    $tooltipEpubNextSection = htmlspecialchars($i18n->get('tooltip_epub_next_section'), ENT_QUOTES, 'UTF-8');
    $tooltipEpubFlowToggle = htmlspecialchars($i18n->get('tooltip_epub_flow_toggle'), ENT_QUOTES, 'UTF-8');
    $tooltipEpubFontDecrease = htmlspecialchars($i18n->get('tooltip_epub_font_decrease'), ENT_QUOTES, 'UTF-8');
    $tooltipEpubFontIncrease = htmlspecialchars($i18n->get('tooltip_epub_font_increase'), ENT_QUOTES, 'UTF-8');
    $tooltipEpubThemePaper = htmlspecialchars($i18n->get('tooltip_epub_theme_paper'), ENT_QUOTES, 'UTF-8');
    $tooltipEpubThemeWhite = htmlspecialchars($i18n->get('tooltip_epub_theme_white'), ENT_QUOTES, 'UTF-8');
    $tooltipEpubThemeDark = htmlspecialchars($i18n->get('tooltip_epub_theme_dark'), ENT_QUOTES, 'UTF-8');
    $tooltipEpubThemeSystem = htmlspecialchars($i18n->get('tooltip_epub_theme_system'), ENT_QUOTES, 'UTF-8');
    $tooltipEpubDirectionAuto = htmlspecialchars($i18n->get('tooltip_epub_direction_auto'), ENT_QUOTES, 'UTF-8');
    $tooltipEpubDirectionLtr = htmlspecialchars($i18n->get('tooltip_epub_direction_ltr'), ENT_QUOTES, 'UTF-8');
    $tooltipEpubDirectionRtl = htmlspecialchars($i18n->get('tooltip_epub_direction_rtl'), ENT_QUOTES, 'UTF-8');
    $tooltipEpubWritingAuto = htmlspecialchars($i18n->get('tooltip_epub_writing_auto'), ENT_QUOTES, 'UTF-8');
    $tooltipEpubWritingHorizontal = htmlspecialchars($i18n->get('tooltip_epub_writing_horizontal'), ENT_QUOTES, 'UTF-8');
    $tooltipEpubWritingVertical = htmlspecialchars($i18n->get('tooltip_epub_writing_vertical'), ENT_QUOTES, 'UTF-8');
    $i18nJsData = json_encode([
        'back' => $i18n->get('back'),
        'fullscreen' => $i18n->get('fullscreen'),
        'windowed' => $i18n->get('windowed'),
        'fullscreen_not_supported' => $i18n->get('fullscreen_not_supported'),
        'tooltip_back' => $i18n->get('tooltip_back'),
        'tooltip_fullscreen' => $i18n->get('tooltip_fullscreen'),
        'tooltip_clock' => $i18n->get('tooltip_clock'),
        'tooltip_inspector' => $i18n->get('tooltip_inspector'),
        'tooltip_language' => $i18n->get('tooltip_language'),
        'epub_menu' => $i18n->get('epub_menu'),
        'epub_font_size' => $i18n->get('epub_font_size'),
        'epub_theme' => $i18n->get('epub_theme'),
        'epub_theme_paper' => $i18n->get('epub_theme_paper'),
        'epub_theme_white' => $i18n->get('epub_theme_white'),
        'epub_theme_dark' => $i18n->get('epub_theme_dark'),
        'epub_theme_system' => $i18n->get('epub_theme_system'),
        'epub_flow_mode' => $i18n->get('epub_flow_mode'),
        'epub_flow_paginated' => $i18n->get('epub_flow_paginated'),
        'epub_flow_scrolled' => $i18n->get('epub_flow_scrolled'),
        'epub_toc' => $i18n->get('epub_toc'),
        'toc_cover' => $i18n->get('toc_cover'),
        'last_page' => $i18n->get('last_page'),
        'epub_progress' => $i18n->get('epub_progress'),
        'epub_jump_to_progress' => $i18n->get('epub_jump_to_progress'),
        'epub_prev_page' => $i18n->get('epub_prev_page'),
        'epub_next_page' => $i18n->get('epub_next_page'),
        'epub_prev_section' => $i18n->get('epub_prev_section'),
        'epub_next_section' => $i18n->get('epub_next_section'),
        'epub_auto' => $i18n->get('epub_auto'),
        'epub_override' => $i18n->get('epub_override'),
        'epub_direction' => $i18n->get('epub_direction'),
        'epub_direction_ltr' => $i18n->get('epub_direction_ltr'),
        'epub_direction_rtl' => $i18n->get('epub_direction_rtl'),
        'epub_writing_mode' => $i18n->get('epub_writing_mode'),
        'epub_writing_horizontal' => $i18n->get('epub_writing_horizontal'),
        'epub_writing_vertical' => $i18n->get('epub_writing_vertical'),
        'epub_page_position_readout' => $i18n->get('epub_page_position_readout'),
        'epub_page_position' => $i18n->get('epub_page_position'),
        'epub_section_progress' => $i18n->get('epub_section_progress'),
        'epub_page_position_loading' => $i18n->get('epub_page_position_loading'),
        'epub_page_position_unavailable' => $i18n->get('epub_page_position_unavailable'),
        'epub_status_loading' => $i18n->get('epub_status_loading'),
        'epub_loading_opening' => $i18n->get('epub_loading_opening'),
        'epub_loading_fetching' => $i18n->get('epub_loading_fetching'),
        'epub_loading_rendering' => $i18n->get('epub_loading_rendering'),
        'epub_load_failed' => $i18n->get('epub_load_failed'),
        'epub_offline_last_location' => $i18n->get('epub_offline_last_location'),
        'epub_unknown' => $i18n->get('epub_unknown'),
        'reader_sync_forward' => $i18n->get('reader_sync_forward'),
        'reader_start_confirm' => $i18n->get('reader_start_confirm'),
        'reader_sync_changed' => $i18n->get('reader_sync_changed'),
        'reader_sync_epub' => $i18n->get('reader_sync_epub'),
        'reader_sync_unsaved' => $i18n->get('reader_sync_unsaved'),
        'reader_markers' => $i18n->get('reader_markers'),
        'reader_marker_default' => $i18n->get('reader_marker_default'),
        'reader_marker_add' => $i18n->get('reader_marker_add'),
        'reader_marker_edit' => $i18n->get('reader_marker_edit'),
        'reader_marker_delete' => $i18n->get('reader_marker_delete'),
        'reader_marker_save' => $i18n->get('reader_marker_save'),
        'reader_marker_cancel' => $i18n->get('reader_marker_cancel'),
        'reader_marker_name_placeholder' => $i18n->get('reader_marker_name_placeholder'),
        'reader_marker_added' => $i18n->get('reader_marker_added'),
        'reader_marker_updated' => $i18n->get('reader_marker_updated'),
        'reader_marker_deleted' => $i18n->get('reader_marker_deleted'),
        'reader_marker_limit' => $i18n->get('reader_marker_limit'),
        'reader_marker_error' => $i18n->get('reader_marker_error'),
        'reader_marker_empty' => $i18n->get('reader_marker_empty'),
        'reader_marker_page' => $i18n->get('reader_marker_page'),
        'reader_marker_progress' => $i18n->get('reader_marker_progress'),
        'reader_marker_section' => $i18n->get('reader_marker_section'),
        'reader_marker_cluster' => $i18n->get('reader_marker_cluster'),
    ], JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);

    $title = htmlspecialchars(strip_tags((string)$bookName), ENT_QUOTES, 'UTF-8');
    $lang = htmlspecialchars($i18n->getCurrentLang(), ENT_QUOTES, 'UTF-8');
    $fontSizeLabel = htmlspecialchars($i18n->get('epub_font_size'), ENT_QUOTES, 'UTF-8');
    $themeLabel = htmlspecialchars($i18n->get('epub_theme'), ENT_QUOTES, 'UTF-8');
    $themePaperLabel = htmlspecialchars($i18n->get('epub_theme_paper'), ENT_QUOTES, 'UTF-8');
    $themeWhiteLabel = htmlspecialchars($i18n->get('epub_theme_white'), ENT_QUOTES, 'UTF-8');
    $themeDarkLabel = htmlspecialchars($i18n->get('epub_theme_dark'), ENT_QUOTES, 'UTF-8');
    $themeSystemLabel = htmlspecialchars($i18n->get('epub_theme_system'), ENT_QUOTES, 'UTF-8');
    $flowLabel = htmlspecialchars($i18n->get('epub_flow_mode'), ENT_QUOTES, 'UTF-8');
    $flowPaginatedLabel = htmlspecialchars($i18n->get('epub_flow_paginated'), ENT_QUOTES, 'UTF-8');
    $flowScrolledLabel = htmlspecialchars($i18n->get('epub_flow_scrolled'), ENT_QUOTES, 'UTF-8');
    $tocLabel = htmlspecialchars($i18n->get('epub_toc'), ENT_QUOTES, 'UTF-8');
    $progressLabel = htmlspecialchars($i18n->get('epub_progress'), ENT_QUOTES, 'UTF-8');
    $jumpLabel = htmlspecialchars($i18n->get('epub_jump_to_progress'), ENT_QUOTES, 'UTF-8');
    $prevPageLabel = htmlspecialchars($i18n->get('epub_prev_page'), ENT_QUOTES, 'UTF-8');
    $nextPageLabel = htmlspecialchars($i18n->get('epub_next_page'), ENT_QUOTES, 'UTF-8');
    $prevSectionLabel = htmlspecialchars($i18n->get('epub_prev_section'), ENT_QUOTES, 'UTF-8');
    $nextSectionLabel = htmlspecialchars($i18n->get('epub_next_section'), ENT_QUOTES, 'UTF-8');
    $directionLabel = htmlspecialchars($i18n->get('epub_direction'), ENT_QUOTES, 'UTF-8');
    $directionAutoLabel = htmlspecialchars($i18n->get('epub_auto'), ENT_QUOTES, 'UTF-8');
    $directionLtrLabel = htmlspecialchars($i18n->get('epub_direction_ltr'), ENT_QUOTES, 'UTF-8');
    $directionRtlLabel = htmlspecialchars($i18n->get('epub_direction_rtl'), ENT_QUOTES, 'UTF-8');
    $writingModeLabel = htmlspecialchars($i18n->get('epub_writing_mode'), ENT_QUOTES, 'UTF-8');
    $writingAutoLabel = htmlspecialchars($i18n->get('epub_auto'), ENT_QUOTES, 'UTF-8');
    $writingHorizontalLabel = htmlspecialchars($i18n->get('epub_writing_horizontal'), ENT_QUOTES, 'UTF-8');
    $writingVerticalLabel = htmlspecialchars($i18n->get('epub_writing_vertical'), ENT_QUOTES, 'UTF-8');
    $pageAnimationLabel = htmlspecialchars($i18n->get('epub_page_animation'), ENT_QUOTES, 'UTF-8');
    $pageAnimationToggleLabel = htmlspecialchars($i18n->get('epub_page_animation_toggle'), ENT_QUOTES, 'UTF-8');
    $pageAnimationHelp = htmlspecialchars($i18n->get('epub_page_animation_help'), ENT_QUOTES, 'UTF-8');
    $pagePositionLabel = htmlspecialchars($i18n->get('epub_page_position'), ENT_QUOTES, 'UTF-8');
    $pagePositionToggleLabel = htmlspecialchars($i18n->get('epub_page_position_toggle'), ENT_QUOTES, 'UTF-8');
    $pagePositionHelpLabel = htmlspecialchars($i18n->get('epub_page_position_help_label'), ENT_QUOTES, 'UTF-8');
    $pagePositionHelp = htmlspecialchars($i18n->get('epub_page_position_help'), ENT_QUOTES, 'UTF-8');
    $pagePositionLoading = htmlspecialchars($i18n->get('epub_page_position_loading'), ENT_QUOTES, 'UTF-8');
    $fullscreenLabel = htmlspecialchars($i18n->get('windowed'), ENT_QUOTES, 'UTF-8');
    $backLabel = htmlspecialchars($i18n->get('back'), ENT_QUOTES, 'UTF-8');
    $endTitle = htmlspecialchars($i18n->get('epub_end_title'), ENT_QUOTES, 'UTF-8');
    $endBackLabel = htmlspecialchars($i18n->get('epub_end_back'), ENT_QUOTES, 'UTF-8');
    $endReturnLabel = htmlspecialchars($i18n->get('epub_end_return'), ENT_QUOTES, 'UTF-8');
    $statusLoadingLabel = htmlspecialchars($i18n->get('epub_status_loading'), ENT_QUOTES, 'UTF-8');
    $altCloseButton = htmlspecialchars($i18n->get('alt_close_button'), ENT_QUOTES, 'UTF-8');
    $readerMarkersLabel = htmlspecialchars($i18n->get('reader_markers'), ENT_QUOTES, 'UTF-8');
    $readerMarkerAddLabel = htmlspecialchars($i18n->get('reader_marker_add'), ENT_QUOTES, 'UTF-8');

    return <<<HTML
<!DOCTYPE html>
<html lang="{$lang}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, viewport-fit=cover">
    <meta name="theme-color" content="#606060">
    <meta name="mobile-web-app-capable" content="yes">
    <meta name="apple-touch-fullscreen" content="yes">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-title" content="Comistream">
    <link rel="manifest" href="{$manifestUrl}" crossorigin="use-credentials">
    <meta http-equiv="Content-Security-Policy" content="default-src 'self' blob:; connect-src 'self' blob: https:; frame-src 'self' blob:; style-src 'self' 'unsafe-inline' blob: https:; img-src 'self' blob: data: https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https:; font-src 'self' blob: data: https:; worker-src 'self' blob:;">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=BIZ+UDMincho:wght@400;700&display=swap" rel="stylesheet">
    <title>{$title} - Comistream</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/feather-icons/4.29.2/feather.min.js" integrity="sha512-zMm7+ZQ8AZr1r3W8Z8lDATkH05QG5Gm2xc6MlsCdBz9l6oE8Y7IXByMgSm/rdRQrhuHt99HAYfMljBOEZ68q5A==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
    <style>
{$readerCss}
        body {
            background: #606060;
        }
        .progressbox {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            z-index: 120;
            pointer-events: none;
        }
        #epub-viewer-shell {
            position: fixed;
            inset: 0;
            overflow: hidden;
        }
        #epub-viewer {
            width: 100vw;
            height: 100dvh;
            overflow: hidden;
            outline: none;
        }
        #epub-viewer foliate-view {
            display: block;
            width: 100%;
            height: 100%;
        }
        .epub-nav-zone {
            position: fixed;
            top: 0;
            bottom: 0;
            display: none;
            width: 28vw;
            min-width: 72px;
            max-width: 320px;
            z-index: 20;
            background: transparent;
            border: 0;
            padding: 0;
            cursor: pointer;
            pointer-events: none;
        }
        .epub-nav-zone-left {
            left: 0;
        }
        .epub-nav-zone-right {
            right: 0;
        }
        #epub-page-position {
            position: absolute;
            z-index: 25;
            max-width: calc(100vw - env(safe-area-inset-left, 0px) - env(safe-area-inset-right, 0px) - 8px);
            padding: 0 4px;
            color: var(--epub-page-position-color, #fff);
            font-family: system-ui, sans-serif;
            font-size: 12px;
            line-height: 16px;
            font-variant-numeric: tabular-nums;
            direction: ltr;
            writing-mode: horizontal-tb;
            text-align: center;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            opacity: 0.68;
            pointer-events: none;
            user-select: none;
            --epub-safe-left: env(safe-area-inset-left, 0px);
            --epub-safe-right: env(safe-area-inset-right, 0px);
            --epub-safe-bottom: env(safe-area-inset-bottom, 0px);
            transform: translate(-50%, -50%);
        }
        #epub-page-position[hidden],
        #epub-page-position-status[hidden],
        #epub-page-position-help[hidden],
        #epub-page-position-info[hidden],
        #epub-page-position-setting[hidden] {
            display: none;
        }
        body.epub-fixed-layout .epub-nav-zone {
            display: block;
            pointer-events: auto;
        }
        #epub-menu-panel {
            position: fixed;
            top: 0;
            left: 0;
            z-index: 95;
            display: none;
            width: min(760px, calc(100vw - 20px));
            box-sizing: border-box;
            max-width: min(760px, calc(100vw - 20px));
            max-height: calc(100dvh - 20px);
        }
        .epub-toolbar {
            display: block;
            margin-bottom: 12px;
        }
        .epub-toolbar::after {
            content: '';
            display: block;
            clear: both;
        }
        .contents .epub-toolbar :is(.reader-utility-actions, .reader-mode-actions) {
            /* CBZの操作列と同じように、個々のボタンで折り返すルン。 */
            display: contents;
        }
        .epub-toolbar-close {
            vertical-align: middle;
            margin-right: 4px;
        }
        #epub-status {
            margin-top: 8px;
            color: #d0d0d0;
            font-size: 0.82em;
            line-height: 1.45;
            min-height: 1.45em;
            white-space: pre-line;
            overflow-wrap: anywhere;
        }
        .epub-page-position-menu {
            margin-top: 4px;
            color: #d0d0d0;
            font-size: 0.82em;
            line-height: 1.45;
            overflow-wrap: anywhere;
        }
        .epub-panel-section {
            margin-bottom: 12px;
        }
        .epub-panel-grid {
            /* CBZと同じ操作高さを保ち、設定を横に詰めて折り返すルン。 */
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 6px 12px;
            margin-top: 8px;
        }
        .epub-setting-row {
            display: flex;
            align-items: center;
            gap: 6px;
            max-width: 100%;
            min-width: 0;
            flex-wrap: wrap;
        }
        .epub-setting-label {
            color: #b7bec8;
            font-size: 0.78em;
        }
        #epub-menu-panel .epub-theme-toggle-group {
            display: inline-flex;
            width: auto;
        }
        .epub-setting-value {
            font-size: 0.9em;
        }
        .epub-setting-value.button-mode {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 30px;
            margin: 0;
            float: none;
            font-size: 0.8em;
        }
        .epub-book-heading {
            white-space: pre-line;
        }
        .epub-segmented-control {
            display: inline-flex;
            flex-wrap: wrap;
            gap: 6px;
            white-space: nowrap;
        }
        .epub-segmented-control .button-mode {
            margin: 0;
            float: none;
            padding: 5px 9px;
        }
        .epub-theme-toggle-group {
            display: inline-flex;
            flex-wrap: wrap;
            gap: 6px;
        }
        .epub-mini-button {
            border: 1px solid #b8b8b8;
            border-radius: 4px;
            background: #f0f0f0;
            color: #222;
            padding: 4px 8px;
            font-size: 0.82em;
            font-weight: bold;
            cursor: pointer;
        }
        .epub-mini-button:disabled {
            opacity: 0.5;
            cursor: default;
        }
        .epub-slider-row {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-top: 8px;
        }
        .epub-slider-row label {
            min-width: 72px;
            color: #d0d0d0;
            font-size: 0.82em;
        }
        #epub-slider {
            flex: 1 1 auto;
            min-width: 0;
        }
        .epub-slider-row .reader-marker-slider {
            flex: 1 1 auto;
            width: auto;
            min-width: 0;
            margin-left: 0;
        }
        #epub-slider-value {
            min-width: 52px;
            text-align: right;
        }
        .epub-toc-item:disabled {
            opacity: 0.55;
            cursor: default;
        }
        .epub-toc-depth-1 { padding-left: 18px; }
        .epub-toc-depth-2 { padding-left: 28px; }
        .epub-status-error {
            color: #ffd2d2;
        }
        #epub-end-panel { margin: auto; }
        #epub-loading-overlay {
            position: fixed;
            inset: 0;
            z-index: 40;
            display: flex;
            align-items: center;
            justify-content: center;
            background: rgba(0, 0, 0, 0.18);
            pointer-events: none;
            opacity: 1;
            visibility: visible;
            transition: opacity 0.18s ease, visibility 0.18s ease;
        }
        #epub-loading-overlay.epub-loading-hidden {
            opacity: 0;
            visibility: hidden;
        }
        .epub-loading-box {
            position: relative;
            z-index: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
            padding: 18px 22px;
            color: #fff;
            text-align: center;
            text-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
        }
        .epub-loading-spinner {
            width: 64px;
            height: 64px;
            border: 4px solid rgba(255, 255, 255, 0.28);
            border-top-color: #fff;
            border-radius: 50%;
            animation: epub-loading-spin 0.8s linear infinite;
        }
        #epub-loading-cover {
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: contain;
            opacity: 0.4;
            pointer-events: none;
        }
        #epub-loading-cover[hidden] {
            display: none;
        }
        .epub-loading-message {
            max-width: min(72vw, 22em);
            font-size: 0.92em;
            line-height: 1.4;
            overflow-wrap: anywhere;
        }
        @keyframes epub-loading-spin {
            to {
                transform: rotate(360deg);
            }
        }
        @media (max-width: 720px) {
            body.epub-fixed-layout .epub-nav-zone {
                width: 34vw;
                min-width: 64px;
            }
            .epub-slider-row {
                flex-wrap: wrap;
            }
            .epub-slider-row label {
                min-width: auto;
            }
        }
    </style>
</head>
<body>
    <div id="clock" class="clock-container clock-hidden">00:00</div>
    <div class="progressbox"><div class="progress-left" id="progress"></div></div>
    <div id="epub-viewer-shell">
        <button id="epub-nav-left" class="epub-nav-zone epub-nav-zone-left" type="button" aria-label="{$prevPageLabel}"></button>
        <div id="epub-viewer" tabindex="0"></div>
        <button id="epub-nav-right" class="epub-nav-zone epub-nav-zone-right" type="button" aria-label="{$nextPageLabel}"></button>
        <div id="epub-page-position" aria-hidden="true" hidden></div>
    </div>
    <div id="epub-loading-overlay" role="status" aria-live="polite" aria-hidden="false">
        {$loadingCoverHtml}
        <div class="epub-loading-box">
            <div class="epub-loading-spinner" aria-hidden="true"></div>
            <div class="epub-loading-message" id="epub-loading-message">{$statusLoadingLabel}</div>
        </div>
    </div>
    <div class="contents" id="epub-menu-panel">
        <div>
            <div class="reader-menu-header">
                <button type="button" class="reader-menu-dismiss" id="epub-menu-close" aria-label="{$altCloseButton}"><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
                <button type="button" class="button button-close reader-menu-back" id="epub-back-button" data-tooltip="{$tooltipBack}"><svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5m6-6-6 6 6 6"/></svg><span>{$backLabel}</span></button>
            </div>
            <div class="epub-toolbar">
                <div class="reader-utility-actions">
                    {$langSelectorHtml}
                    <button type="button" aria-pressed="false" aria-label="{$tooltipClock}" class="clock-icon-button" id="clockToggleButton" data-tooltip="{$tooltipClock}"><i data-feather="clock"></i></button>
                    <button type="button" aria-pressed="false" aria-label="{$tooltipInspector}" class="inspector-icon-button" id="inspectorToggleButton" data-tooltip="{$tooltipInspector}"><i data-feather="info"></i></button>
                </div>
                <div class="reader-mode-actions">
                    <button type="button" class="button button-mode" id="epub-flow-toggle" data-tooltip="{$tooltipEpubFlowToggle}"><span class="reader-mode-label"><span aria-hidden="true" class="reader-mode-sizer">{$flowPaginatedLabel}</span><span aria-hidden="true" class="reader-mode-sizer">{$flowScrolledLabel}</span><span id="epub-flow-current">{$flowPaginatedLabel}</span></span></button>
                    <button type="button" class="button button-mode" id="fullScreenButton" data-tooltip="{$tooltipFullscreen}">{$fullscreenLabel}</button>
                </div>
                <div class="reader-section-actions">
                    <button type="button" class="button button-mode" id="epub-next-section" data-tooltip="{$tooltipEpubNextSection}">{$nextSectionLabel}</button>
                    <button type="button" class="button button-mode" id="epub-prev-section" data-tooltip="{$tooltipEpubPrevSection}">{$prevSectionLabel}</button>
                </div>
                <div class="reader-page-actions">
                    <button type="button" class="button button-mode" id="epub-next-page" data-tooltip="{$tooltipEpubNextPage}">{$nextPageLabel}</button>
                    <button type="button" class="button button-mode" id="epub-prev-page" data-tooltip="{$tooltipEpubPrevPage}">{$prevPageLabel}</button>
                </div>
            </div>
            <div class="epub-panel-section">
                <div class="bookName epub-book-heading" id="epub-book-heading">{$bookName}</div>
                <div id="epub-status">{$statusLoadingLabel}</div>
                <div class="epub-position-summary">
                    <div id="epub-page-position-status" class="epub-page-position-menu" role="status" aria-live="off">{$pagePositionLoading}</div>
                    <button type="button" class="reader-help-button" id="epub-page-position-info" aria-label="{$pagePositionHelpLabel}" aria-controls="epub-page-position-help" aria-describedby="epub-page-position-help" aria-expanded="false" hidden><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg></button>
                </div>
                <div id="epub-page-position-help" class="reader-help-tooltip" role="tooltip" hidden>{$pagePositionHelp}</div>
                <div class="epub-slider-row">
                    <label for="epub-slider">{$progressLabel}</label>
                    <span class="reader-marker-slider">
                        <input id="epub-slider" type="range" value="1" min="1" max="1" step="1" aria-label="{$jumpLabel}">
                        <span id="epub-marker-rail" class="reader-marker-rail"></span>
                    </span>
                    <span id="epub-slider-value" class="value">1</span>
                </div>
                <div class="epub-panel-grid">
                    <div class="epub-setting-row">
                        <span class="epub-setting-label">{$fontSizeLabel}</span>
                        <button class="epub-mini-button" id="epub-font-minus" type="button" data-tooltip="{$tooltipEpubFontDecrease}">A-</button>
                        <span class="epub-setting-value" id="epub-font-value">100%</span>
                        <button class="epub-mini-button" id="epub-font-plus" type="button" data-tooltip="{$tooltipEpubFontIncrease}">A+</button>
                    </div>
                    <div class="epub-setting-row">
                        <span class="epub-setting-label">{$themeLabel}</span>
                        <span class="epub-theme-toggle-group">
                            <button class="button button-mode epub-setting-value" id="epub-theme-paper" type="button" data-tooltip="{$tooltipEpubThemePaper}">{$themePaperLabel}</button>
                            <button class="button button-mode epub-setting-value" id="epub-theme-white" type="button" data-tooltip="{$tooltipEpubThemeWhite}">{$themeWhiteLabel}</button>
                            <button class="button button-mode epub-setting-value" id="epub-theme-dark" type="button" data-tooltip="{$tooltipEpubThemeDark}">{$themeDarkLabel}</button>
                            <button class="button button-mode epub-setting-value" id="epub-theme-system" type="button" data-tooltip="{$tooltipEpubThemeSystem}">{$themeSystemLabel}</button>
                        </span>
                    </div>
                    <div class="epub-setting-row">
                        <span class="epub-setting-label">{$flowLabel}</span>
                        <span class="epub-setting-value" id="epub-flow-value">-</span>
                    </div>
                    <div class="epub-setting-row">
                        <span class="epub-setting-label">{$pageAnimationLabel}</span>
                        <button class="button button-mode epub-setting-value" id="epub-page-animation-toggle" type="button" aria-label="{$pageAnimationToggleLabel}" aria-pressed="true" title="{$pageAnimationHelp}">{$pageAnimationToggleLabel}</button>
                    </div>
                    <div class="epub-setting-row" id="epub-page-position-setting" hidden>
                        <span class="epub-setting-label">{$pagePositionLabel}</span>
                        <button class="button button-mode epub-setting-value" id="epub-page-position-toggle" type="button" aria-label="{$pagePositionToggleLabel}" aria-pressed="true">{$pagePositionToggleLabel}</button>
                    </div>
                    <div class="epub-setting-row">
                        <span class="epub-setting-label">{$directionLabel}</span>
                        <span class="epub-setting-value" id="epub-direction-value">-</span>
                        <span class="epub-segmented-control" role="radiogroup" aria-label="{$directionLabel}">
                            <button class="button button-mode epub-setting-value" type="button" role="radio" data-epub-direction-option="auto" data-tooltip="{$tooltipEpubDirectionAuto}">{$directionAutoLabel}</button>
                            <button class="button button-mode epub-setting-value" type="button" role="radio" data-epub-direction-option="ltr" data-tooltip="{$tooltipEpubDirectionLtr}">{$directionLtrLabel}</button>
                            <button class="button button-mode epub-setting-value" type="button" role="radio" data-epub-direction-option="rtl" data-tooltip="{$tooltipEpubDirectionRtl}">{$directionRtlLabel}</button>
                        </span>
                    </div>
                    <div class="epub-setting-row">
                        <span class="epub-setting-label">{$writingModeLabel}</span>
                        <span class="epub-setting-value" id="epub-writing-mode-value">-</span>
                        <span class="epub-segmented-control" role="radiogroup" aria-label="{$writingModeLabel}">
                            <button class="button button-mode epub-setting-value" type="button" role="radio" data-epub-writing-option="auto" data-tooltip="{$tooltipEpubWritingAuto}">{$writingAutoLabel}</button>
                            <button class="button button-mode epub-setting-value" type="button" role="radio" data-epub-writing-option="horizontal" data-tooltip="{$tooltipEpubWritingHorizontal}">{$writingHorizontalLabel}</button>
                            <button class="button button-mode epub-setting-value" type="button" role="radio" data-epub-writing-option="vertical" data-tooltip="{$tooltipEpubWritingVertical}">{$writingVerticalLabel}</button>
                        </span>
                    </div>
                </div>
            </div>
            <div class="epub-panel-section reader-marker-section">
                <div class="reader-marker-heading-row">
                    <span class="reader-marker-heading">{$readerMarkersLabel}</span>
                    <button id="epub-marker-add" class="reader-marker-add" type="button">{$readerMarkerAddLabel}</button>
                </div>
                <div id="epub-marker-status" class="reader-marker-status" role="status" aria-live="polite"></div>
                <div id="epub-marker-list" class="reader-marker-list"></div>
            </div>
            <hr>
            <div class="epub-panel-section">
                <div class="reader-toc-heading">{$tocLabel}</div>
                <div id="epub-toc" class="toclist"></div>
            </div>
        </div>
    </div>
    <dialog id="epub-end-panel" class="reader-end-panel" aria-modal="true" aria-labelledby="epub-end-title">
        <h2 id="epub-end-title">{$endTitle}</h2>
        <div id="epub-end-book-title" class="reader-end-book-title"></div>
        <div class="reader-end-actions">
            <button id="epub-end-return" class="button button-mode" type="button">{$endReturnLabel}</button>
            <button id="epub-end-back" class="button button-close" type="button">{$endBackLabel}</button>
        </div>
        <div id="epub-end-books" class="reader-end-books" hidden></div>
    </dialog>
    {$inspectorHtml}
    <script>
        window.DEBUG_ENABLED = {$debugEnabledJson};
        window.DEBUG_CONSOLE_ENABLED = {$debugConsoleEnabledJson};
        (function() {
            const canDebugConsole = {$debugConsoleEnabledJson};
            window.debugLog = function(message, detail) {
                if (!canDebugConsole) {
                    return;
                }
                if (typeof detail === 'undefined') {
                    console.debug(message);
                } else {
                    console.debug(message, detail);
                }
            };
        })();
        window.epubReaderConfig = {$configJson};
        window.epubReaderI18n = {$i18nJsData};
    </script>
    <script>
{$langSwitcherJs}
    </script>
    <script>
        const constructStyleSheetsPolyfillSource = String.raw`
{$constructStyleSheetsPolyfillJs}
`;
        const constructStyleSheetsPolyfillUrl = URL.createObjectURL(
            new Blob([constructStyleSheetsPolyfillSource], { type: 'text/javascript' })
        );
        const constructStyleSheetsImportMap = {
            imports: {
                'construct-style-sheets-polyfill': constructStyleSheetsPolyfillUrl
            }
        };
        document.write(
            '<script type="importmap">'
            + JSON.stringify(constructStyleSheetsImportMap).replace(/</g, '\\u003c')
            + '<\\/script>'
        );
    </script>
    <script>
{$readerProgressJs}
    </script>
    <script type="module">
{$readerMarkerJs}
{$readerInspectorJs}
{$epubEndJs}
{$epubReaderJs}
    </script>
</body>
</html>
HTML;
}

function printEpubViewerHTML(): void
{
    $html = generateEpubHTML();
    if (!headers_sent()) {
        header('Content-Type: text/html; charset=utf-8');
        // HTMLにはユーザーごとの最新読書位置が含まれるので、再利用しないルン。
        header('Cache-Control: private, no-store');
    }
    echo function_exists('compressResponse') ? compressResponse($html) : $html;
}
