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
 * @license     GPL3.0 License
 * @version     2.0.0
 * @link        https://github.com/sorshi/comistream-reader
 */


##### ベースhtml出力 #####################################################################

/**
 * HTML生成関数 ルン！テストしやすいようにHTML文字列を返すルン！
 * 
 * @return string 生成されたHTML文字列
 */
function generateHTML()
{
    global $conf, $size, $global_preload_pages, $global_debug_flag, $page, $maxPage, $degree,
        $indexArray, $position, $direction, $autosplit, $fileSize, $averagePageBytes, $baseFile,
        $escapedFile, $file, $size, $view_query, $global_preload_delay_ms, $publicDir, $pageTitle,
        $bookName, $contents, $split_button_class, $split_button_text, $pagemode_button_class, $pagemode_button_text;

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
    if (file_exists($conf["comistream_tool_dir"] . '/code/comistream.js')) {
        $contents_js = file_get_contents($conf["comistream_tool_dir"] . '/code/comistream.js');
        writelog("DEBUG JS file exist.");
    } else {
        writelog("ERROR JS not found:" . __DIR__);
        errorExit('js_file_missing', 'JavaScript file not found at: ' . $conf["comistream_tool_dir"] . '/code/comistream.js');
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
    if ($page > $maxPage) {
        $page = $maxPage;
    }
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

    // HTMLエスケープ処理 ルン！XSS対策大事ルン！
    $apple_mobile_web_app_title = htmlspecialchars($apple_mobile_web_app_title, ENT_QUOTES, 'UTF-8');
    $size_button_flag = htmlspecialchars($size_button_flag, ENT_QUOTES, 'UTF-8');
    $pagemode_button_text = htmlspecialchars($pagemode_button_text, ENT_QUOTES, 'UTF-8');
    $split_button_text = htmlspecialchars($split_button_text, ENT_QUOTES, 'UTF-8');
    $direction_button_text = htmlspecialchars($direction_button_text, ENT_QUOTES, 'UTF-8');
    $alt_close_button = htmlspecialchars($i18n->get('alt_close_button'), ENT_QUOTES, 'UTF-8');
    $alt_quick_spread_left = htmlspecialchars($i18n->get('alt_quick_spread_left'), ENT_QUOTES, 'UTF-8');
    $alt_quick_spread_right = htmlspecialchars($i18n->get('alt_quick_spread_right'), ENT_QUOTES, 'UTF-8');

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
        'toc_button_direction_right' => $i18n->get('direction_right'),
        'toc_button_direction_left' => $i18n->get('direction_left'),
        'toc_button_fullscreen' => $i18n->get('fullscreen'),
        'toc_button_windowed' => $i18n->get('windowed'),
        'large_page_notification' => $i18n->get('large_page_notification')
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

        var page = $page;
        var prevPage = $page;
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
        let global_preload_pages = $global_preload_pages;
        $pageGenerator

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
        <div class="toc-buttons">
            <img src="$themeDir/theme/icons/close.png" alt="$alt_close_button" class="close" onclick="document.getElementById('contents').style.display='none'">
            <span class="button button-close" onclick="backListPage();" data-tooltip="$tooltip_back">{$i18n->get('back')}</span>
            <span id="rawMode" class="$size_button_class button-mode" onclick="toggleRaw();" data-tooltip-full="$tooltip_full_size" data-tooltip-compressed="$tooltip_compressed">$size_button_flag</span>
            <span id="pageMode" class="$pagemode_button_class button-mode" onclick="togglePageMode()" data-tooltip-single="$tooltip_single_page" data-tooltip-spread="$tooltip_spread_page">$pagemode_button_text</span>
            <span class="button button-mode" onclick="fixSpreadPage();" data-tooltip="$tooltip_spread_fix">{$i18n->get('spread_fix')}</span>
            <span class="$direction_button_class button-mode" id="direction" onclick="toggleDirection()" data-tooltip="$tooltip_direction">$direction_button_text</span>
            <span class="button button-mode" id="fullScreenButton" onclick="toggleFullScreen()" data-tooltip="$tooltip_fullscreen">{$i18n->get('fullscreen')}</span>
            <span class="$split_button_class button-mode" id="splitFile" onclick="toggleTrimmingFile()" data-tooltip-trimming="$tooltip_trimmingmode_trimming" data-tooltip-normal="$tooltip_trimmingmode_normal">$split_button_text</span>
            $langSelectorHtml
            <span class="clock-icon-button" id="clockToggleButton" onclick="toggleClock()" data-tooltip="$tooltip_clock"><i data-feather="clock"></i></span>
            <span class="inspector-icon-button" id="inspectorToggleButton" onclick="showInspector()" data-tooltip="$tooltip_inspector"><i data-feather="info"></i></span>
        </div>
        <div style="clear:both;">
            <div class="bookName">$bookName</div>
            <input id="slider" type="range" value="$maxPage" min="1" max="$maxPage" step="1" /><span id="value" class="value">1</span>
        </div>
        <hr>
        <div class="toclist">$contents</div>
    </div>
</div>

<div id="suggest" hidden >
    <input type="hidden" autofocus="autofocus" />
        <span class="button" onclick="backListPage();">{$i18n->get('back')}</span>
</div>

<div id="overlay" class="overlay"></div>
<div id="modal" class="modal">
    <div class="modal-content">
        <img id="image1" alt="$alt_quick_spread_left">
        <img id="image2" alt="$alt_quick_spread_right">
    </div>
</div>

<div id="inspector" class="inspector"></div>

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
    $html = generateHTML();

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
