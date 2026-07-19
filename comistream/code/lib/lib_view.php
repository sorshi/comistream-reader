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

function generateEpubHTML(): string
{
    global $conf, $bookName, $escapedFile, $baseFile;

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
    $epubReaderJs = file_get_contents($epubJsPath);
    if ($epubReaderJs === false) {
        writelog("ERROR generateEpubHTML() failed to read epub_reader.js", 'view');
        errorExit('js_file_read_error', 'epub_reader.js read failed');
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

    $savedCfi = (string)($conf['epub_saved_cfi'] ?? '');
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
        'epubPackageBase' => $epubPackageBase,
        'epubUrl' => $epubUrl,
        'escapedFile' => (string)$escapedFile,
        'baseFile' => (string)$baseFile,
        'csrfToken' => '',
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
        'epub_status_loading' => $i18n->get('epub_status_loading'),
        'epub_loading_opening' => $i18n->get('epub_loading_opening'),
        'epub_loading_fetching' => $i18n->get('epub_loading_fetching'),
        'epub_loading_rendering' => $i18n->get('epub_loading_rendering'),
        'epub_load_failed' => $i18n->get('epub_load_failed'),
        'epub_offline_last_location' => $i18n->get('epub_offline_last_location'),
        'epub_inspector_title' => $i18n->get('epub_inspector_title'),
        'epub_inspector_author' => $i18n->get('epub_inspector_author'),
        'epub_inspector_language' => $i18n->get('epub_inspector_language'),
        'epub_inspector_progress' => $i18n->get('epub_inspector_progress'),
        'epub_inspector_fraction' => $i18n->get('epub_inspector_fraction'),
        'epub_inspector_section' => $i18n->get('epub_inspector_section'),
        'epub_inspector_cfi' => $i18n->get('epub_inspector_cfi'),
        'epub_inspector_renderer' => $i18n->get('epub_inspector_renderer'),
        'epub_inspector_package_base' => $i18n->get('epub_inspector_package_base'),
        'epub_inspector_signature_expiration' => $i18n->get('epub_inspector_signature_expiration'),
        'epub_inspector_last_saved' => $i18n->get('epub_inspector_last_saved'),
        'epub_unknown' => $i18n->get('epub_unknown'),
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
    $fullscreenLabel = htmlspecialchars($i18n->get('windowed'), ENT_QUOTES, 'UTF-8');
    $backLabel = htmlspecialchars($i18n->get('back'), ENT_QUOTES, 'UTF-8');
    $statusLoadingLabel = htmlspecialchars($i18n->get('epub_status_loading'), ENT_QUOTES, 'UTF-8');
    $altCloseButton = htmlspecialchars($i18n->get('alt_close_button'), ENT_QUOTES, 'UTF-8');

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
        .epub-panel-section {
            margin-bottom: 12px;
        }
        .epub-panel-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 10px 14px;
            margin-top: 12px;
        }
        .epub-setting-row {
            display: flex;
            align-items: center;
            gap: 8px;
            min-height: 32px;
            flex-wrap: wrap;
        }
        .epub-setting-label {
            min-width: 72px;
            color: #d0d0d0;
            font-size: 0.82em;
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
        }
        .epub-book-heading {
            white-space: pre-line;
        }
        .epub-segmented-control {
            display: inline-flex;
            flex-wrap: nowrap;
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
        .epub-section-heading {
            margin-bottom: 8px;
            color: #ddd;
            font-size: 0.82em;
            font-weight: bold;
            letter-spacing: 0.03em;
            text-transform: uppercase;
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
        #epub-slider-value {
            min-width: 52px;
            text-align: right;
        }
        #epub-toc {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .epub-toc-item {
            width: 100%;
            border: 1px solid rgba(255, 255, 255, 0.18);
            border-radius: 4px;
            padding: 4px 8px;
            background: rgba(255, 255, 255, 0.06);
            color: #fff;
            text-align: left;
            line-height: 1.25;
            cursor: pointer;
        }
        .epub-toc-item:hover {
            background: rgba(255, 255, 255, 0.12);
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
        #inspector {
            overflow: auto;
        }
        #inspector li {
            overflow-wrap: anywhere;
            word-break: break-word;
        }
        @media (max-width: 720px) {
            body.epub-fixed-layout .epub-nav-zone {
                width: 34vw;
                min-width: 64px;
            }
            .epub-panel-grid {
                grid-template-columns: 1fr;
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
    </div>
    <div id="epub-loading-overlay" role="status" aria-live="polite" aria-hidden="false">
        <div class="epub-loading-box">
            <div class="epub-loading-spinner" aria-hidden="true"></div>
            <div class="epub-loading-message" id="epub-loading-message">{$statusLoadingLabel}</div>
        </div>
    </div>
    <div class="contents" id="epub-menu-panel">
        <div>
            <div class="epub-toolbar">
                <img src="/theme/icons/close.png" alt="{$altCloseButton}" class="close epub-toolbar-close" id="epub-menu-close">
                <span class="button button-close" id="epub-back-button" data-tooltip="{$tooltipBack}">{$backLabel}</span>
                <span class="button button-mode" id="epub-next-page" data-tooltip="{$tooltipEpubNextPage}">{$nextPageLabel}</span>
                <span class="button button-mode" id="epub-prev-page" data-tooltip="{$tooltipEpubPrevPage}">{$prevPageLabel}</span>
                <span class="button button-mode" id="epub-next-section" data-tooltip="{$tooltipEpubNextSection}">{$nextSectionLabel}</span>
                <span class="button button-mode" id="epub-prev-section" data-tooltip="{$tooltipEpubPrevSection}">{$prevSectionLabel}</span>
                <span class="button button-mode" id="fullScreenButton" data-tooltip="{$tooltipFullscreen}">{$fullscreenLabel}</span>
                <span class="button button-mode" id="epub-flow-toggle" data-tooltip="{$tooltipEpubFlowToggle}">{$flowLabel}</span>
                {$langSelectorHtml}
                <span class="clock-icon-button" id="clockToggleButton" data-tooltip="{$tooltipClock}"><i data-feather="clock"></i></span>
                <span class="inspector-icon-button" id="inspectorToggleButton" data-tooltip="{$tooltipInspector}"><i data-feather="info"></i></span>
            </div>
            <div class="epub-panel-section">
                <div class="bookName epub-book-heading" id="epub-book-heading">{$bookName}</div>
                <div id="epub-status">{$statusLoadingLabel}</div>
                <div class="epub-slider-row">
                    <label for="epub-slider">{$progressLabel}</label>
                    <input id="epub-slider" type="range" value="1" min="1" max="1" step="1" aria-label="{$jumpLabel}">
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
            <hr>
            <div class="epub-panel-section">
                <div class="epub-section-heading">{$tocLabel}</div>
                <div id="epub-toc" class="toclist"></div>
            </div>
        </div>
    </div>
    <div id="inspector" class="inspector"></div>
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
    <script type="module">
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
        header('Cache-Control: private, max-age=300');
    }
    echo function_exists('compressResponse') ? compressResponse($html) : $html;
}
