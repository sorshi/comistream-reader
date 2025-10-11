<?php

/**
 * Comistream Directory Listing API
 *
 * ディレクトリ内容取得専用APIエンドポイント
 * Ajax呼び出し専用で、JSON形式でディレクトリ内容を返却します
 *
 * @package     sorshi/comistream-reader
 * @author      Comistream Project.
 * @copyright   2024-2025 Comistream Project.
 * @license     GPL3.0 License
 * @version     1.2.0
 * @link        https://github.com/sorshi/comistream-reader
 */

require_once __DIR__ . '/comistream_lib.php';

// API専用設定
ini_set('zlib.output_compression', '0'); // API では圧縮を無効化
header('Content-Type: application/json; charset=utf-8');
error_reporting(E_ALL);
ini_set('display_errors', 0);
ini_set('log_errors', 1);

// CORS対応（必要に応じて）
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');

// レスポンス用の構造体
$api_response = [
    'success' => false,
    'data' => [],
    'meta' => [
        'path' => '',
        'total_items' => 0,
        'directories' => 0,
        'files' => 0,
        'sort_by' => 'name',
        'sort_order' => 'asc',
        'processing_time_ms' => 0,
        'is_404_mode' => false
    ],
    'error' => null
];

try {
    // パフォーマンス測定開始
    $api_start_time = microtime(true);

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
                throw new Exception('Database connection failed: ' . $e->getMessage());
            }
        }
    }

    // コンフィグ読み込み
    if ($dbh) {
        readConfig($dbh);
        global $conf;
        $cgiPath = $conf['cgiPath'] ?? '/cgi-bin/comistream.php';
        $hlsCgiPath = $conf['hlsCgiPath'] ?? '/cgi-bin/livestream.php';
        $bibiPath = $conf['bibiPath'] ?? '/bibi/';
        $publicDir = $conf['publicDir'] ?? '';
    } else {
        $cgiPath = '/cgi-bin/comistream.php';
        $hlsCgiPath = '/cgi-bin/livestream.php';
        $bibiPath = '/bibi/';
        $publicDir = '';
    }

    // 問題文字エスケープ関数
    function escape_problematic_chars($filepath)
    {
        $problematic_chars = ['#', '?', '&', '=', '\\', ':', '@', '<', '>', '"', "'", '|', '*', ' '];
        $encoded_chars = array_map('rawurlencode', $problematic_chars);
        return str_replace($problematic_chars, $encoded_chars, $filepath);
    }

    // アイコンマップ取得関数
    function get_icon_map()
    {
        return [
            '__parent' => '/theme/icons/folder-home.png',
            '__dir' => '/theme/icons/folder.png',
            '.zip' => '/theme/icons/book.png',
            '.cbz' => '/theme/icons/book.png',
            '.rar' => '/theme/icons/book.png',
            '.pdf' => '/theme/icons/book.png',
            '.epub' => '/theme/icons/book.png',
            '.ePub' => '/theme/icons/book.png',
            '.7z' => '/theme/icons/book.png',
            '.cb7' => '/theme/icons/book.png',
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

    // カナ正規化関数（dir_list.phpから移植）
    function normalize_kana_for_sort($str)
    {
        if (!isset($str) || $str === '') {
            return $str;
        }

        try {
            if (function_exists('mb_strtolower')) {
                $normalized = mb_strtolower($str, 'UTF-8');
                if (function_exists('mb_convert_kana')) {
                    $test_result = @mb_convert_kana('テスト', 'c', 'UTF-8');
                    if ($test_result !== false && $test_result !== null) {
                        $normalized = mb_convert_kana($normalized, 'cHas', 'UTF-8');
                    }
                }
                return $normalized;
            } else {
                return strtolower($str);
            }
        } catch (Exception $e) {
            return strtolower($str);
        } catch (Throwable $t) {
            return strtolower($str);
        }
    }

    // パラメータ取得・バリデーション
    $document_root = $_SERVER['DOCUMENT_ROOT'];
    $request_path = $_GET['path'] ?? '';
    $viewmode = $_GET['viewmode'] ?? ($_COOKIE['viewmode'] ?? 'list');

    writelog("INFO dir_list_api: Raw path param: " . $request_path, "dir_list_api");

    // パスのサニタイズ（dir_list.phpと同様）
    $request_path = rawurldecode($request_path);
    $request_path = str_replace([
        "\0",
        "\r",
        "\n",
        "\t",
        chr(7),
        chr(8),
        chr(11),
        chr(12),
    ], '', $request_path);
    $request_path = str_replace(['../', '.\\', '..\\'], '', $request_path);
    $request_path = '/' . ltrim($request_path, '/');

    writelog("INFO dir_list_api: Sanitized path: " . $request_path, "dir_list_api");

    // パス検証
    $is_404_mode = false;
    $document_root_real = realpath($document_root) ?: $document_root;
    $joined_path = $document_root . $request_path;
    $parent_realpath = realpath(dirname($joined_path));

    if ($parent_realpath === false || strpos($parent_realpath, $document_root_real) !== 0) {
        http_response_code(404);
        $is_404_mode = true;
        $physical_path = null;
    } elseif (!file_exists($joined_path)) {
        http_response_code(404);
        $is_404_mode = true;
        $physical_path = null;
    } elseif (!is_dir($joined_path)) {
        http_response_code(404);
        $is_404_mode = true;
        $physical_path = null;
    } elseif (!is_readable($joined_path) || !is_executable($joined_path)) {
        throw new Exception('Directory not readable or not traversable: ' . $request_path);
    } else {
        $physical_path = realpath($joined_path) ?: $joined_path;
        if ($physical_path !== null) {
            $docroot_guard = rtrim($document_root_real, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
            $physical_guard = rtrim($physical_path, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
            if (strpos($physical_guard, $docroot_guard) !== 0) {
                http_response_code(404);
                $is_404_mode = true;
                $physical_path = null;
            }
        }
    }

    // セッション開始（必要に応じて）
    session_start();

    // メタ情報設定
    $api_response['meta']['path'] = $request_path;
    $api_response['meta']['is_404_mode'] = $is_404_mode;

    // ディレクトリ処理開始
    $perf_scandir_start = microtime(true);

    $dirs = [];
    $files = [];
    $all_items = [];

    if (!$is_404_mode) {
        $items = scandir($physical_path, SCANDIR_SORT_NONE);

        foreach ($items as $item) {
            if ($item === '.' || $item === '..') continue;
            if (strpos($item, '.') === 0) continue; // Skip hidden files

            $item_path = $physical_path . '/' . $item;
            $is_dir = is_dir($item_path);
            $stat = @stat($item_path);
            if ($stat === false) {
                writelog("WARN dir_list_api: stat failed for {$item_path}", "dir_list_api");
                continue;
            }
            $entry = [
                'name' => $item,
                'is_dir' => $is_dir,
                'size' => $is_dir ? -1 : $stat['size'],
                'lastmod' => $stat['mtime']
            ];

            $all_items[] = $entry;
            if ($is_dir) $dirs[] = $entry;
            else $files[] = $entry;
        }
    }

    $perf_scandir_end = microtime(true);
    $perf_scandir_time = ($perf_scandir_end - $perf_scandir_start) * 1000;

    // ソートはクライアント側で行うため、ここではソートしない
    $sorted_items = $all_items;

    // レスポンスデータ構築
    $response_items = [];

    // Parent Directory追加
    if ($physical_path !== $document_root) {
        $parent_path = dirname($request_path);
        if (DIRECTORY_SEPARATOR !== '/') $parent_path = str_replace(DIRECTORY_SEPARATOR, '/', $parent_path);
        if ($parent_path === '/' || $parent_path === '.' || $parent_path === '') {
            $parent_path = '/';
        } else {
            // ディレクトリパスには必ず末尾スラッシュを付ける（301リダイレクト回避）
            $parent_path = rtrim($parent_path, '/') . '/';
        }

        $escaped_parent_path = escape_problematic_chars($parent_path);
        $parent_icon_src = ($viewmode === 'cover') ? '/theme/icons/blank.png' : get_icon_map()['__parent'];

        $response_items[] = [
            'name' => 'Parent Directory',
            'is_dir' => true,
            'is_parent' => true,
            'size' => -1,
            'size_formatted' => '-',
            'lastmod' => 0,
            'lastmod_formatted' => '',
            'icon' => $parent_icon_src,
            'href' => $parent_path,
            'data_filepath' => $escaped_parent_path
        ];
    }

    // 通常のアイテム追加
    foreach ($sorted_items as $item) {
        $icon = get_icon($item['name'], $item['is_dir']);
        $href = rtrim($request_path, '/') . '/' . rawurlencode($item['name']);
        $raw_filepath = rtrim($request_path, '/') . '/' . $item['name'];
        $escaped_filepath = escape_problematic_chars($raw_filepath);

        if ($item['is_dir']) {
            $href .= '/';
            $raw_filepath .= '/';
            $escaped_filepath .= '/';
        }

        // カバービューでディレクトリの場合はblank.png
        $icon_img_src = ($viewmode === 'cover' && $item['is_dir']) ? '/theme/icons/blank.png' : $icon;

        $response_item = [
            'name' => $item['name'],
            'is_dir' => $item['is_dir'],
            'is_parent' => false,
            'size' => $item['size'],
            'size_formatted' => format_size($item['size']),
            'lastmod' => $item['lastmod'],
            'lastmod_formatted' => date('Y-m-d H:i', $item['lastmod']),
            'icon' => $icon_img_src,
            'href' => $href,
            'data_filepath' => $escaped_filepath
        ];

        // ファイルの場合、プレビュー・カバー画像情報を追加
        if (!$item['is_dir']) {
            $preview_path = preg_replace('/\.[^.]+$/', '.webp', $raw_filepath);
            $escaped_preview_path = escape_problematic_chars($preview_path);
            $response_item['preview_image'] = '/theme/preview' . $escaped_preview_path;

            if ($viewmode === 'cover') {
                $cover_path = preg_replace('/\.[^.]+$/', '.jpg', $raw_filepath);
                $escaped_cover_path = escape_problematic_chars($cover_path);
                $response_item['cover_image'] = '/theme/covers' . $escaped_cover_path;
            }
        }

        $response_items[] = $response_item;
    }

    // パフォーマンス情報
    $api_end_time = microtime(true);
    $total_processing_time = ($api_end_time - $api_start_time) * 1000;

    // メタ情報更新
    $api_response['meta']['total_items'] = count($all_items);
    $api_response['meta']['directories'] = count($dirs);
    $api_response['meta']['files'] = count($files);
    $api_response['meta']['processing_time_ms'] = round($total_processing_time, 2);
    $api_response['meta']['scandir_time_ms'] = round($perf_scandir_time, 2);

    // 成功レスポンス
    $api_response['success'] = true;
    $api_response['data'] = $response_items;

    // パフォーマンスログ
    writelog("DEBUG dir_list_api: " . sprintf(
        "PERF scandir=%.2fms total=%.2fms total=%d dirs=%d files=%d path=%s",
        $perf_scandir_time,
        $total_processing_time,
        count($all_items),
        count($dirs),
        count($files),
        $request_path
    ), "dir_list_api");
} catch (Exception $e) {
    http_response_code(500);
    $api_response['success'] = false;
    $api_response['error'] = [
        'message' => $e->getMessage(),
        'code' => $e->getCode()
    ];
    writelog("ERROR dir_list_api: " . $e->getMessage(), "dir_list_api");
} catch (Throwable $t) {
    http_response_code(500);
    $api_response['success'] = false;
    $api_response['error'] = [
        'message' => 'Unexpected error occurred',
        'code' => 500
    ];
    writelog("ERROR dir_list_api: " . $t->getMessage(), "dir_list_api");
}

// JSON出力
echo compressResponse(json_encode($api_response, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
