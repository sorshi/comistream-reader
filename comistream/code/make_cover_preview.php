<?php

/**
 * comistream/code/make_cover_preview.php
 *
 * コマンドラインから実行します。
 * 日次バッチでmake_image_run.shから呼び出されて表紙画像かプレビュー画像を作成します。
 * 電子書籍ファイルを開いたときにも実行されて表紙画像とプレビュー画像を作成します。
 *
 * @package     sorshi/comistream-reader
 * @author      Comistream Project.
 * @copyright   2024 Comistream Project.
 * @license     AGPL-3.0-only for Comistream Reader project-specific portions; see repository-root LICENSING.md
 * @version     1.0.0
 * @link        https://github.com/sorshi/comistream-reader
 *
 * @param  string  --file      処理対象のファイルパス
 * @param  string  --type      作成する画像タイプ (covers|preview)
 * @param  bool    --cache     キャッシュディレクトリを使用するかどうか
 * @param  int     --trimming  トリミングするかどうか (1:トリミング, 2:トリミングしない)
 */

/**
 * 動作条件
 * A:本のオープンと同時 / バッチ処理
 * B:nested archive / 通常アーカイブ
 *
 * A:$cacheDirと$conf["cacheDir"]が等しいかどうかで判定
 * 本のオープンと同時
 * $options['cache'] → true
 *
 * バッチ処理
 * $options['cache'] → false
 * /dev/shm/に上書きして展開する
 *
 * B:
 * nested archive
 * loading画面を出さず$cacheDirに展開して終了しない
 * $cacheDir/make_picture/$file/に展開
 *
 * 通常アーカイブ
 * そのまま実行

 */
global $writelog_process_name;
$writelog_process_name = 'make_cover_preview';

global $conf;
global $cacheDir;

// import
// library
if (file_exists(__DIR__ . "/comistream_lib.php")) {
    require(__DIR__ . "/comistream_lib.php");
    writelog("DEBUG library file exist:" . __DIR__ . "/comistream_lib.php", $writelog_process_name);
} else {
    exit(1);
}

// DB接続
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
    writelog("ERROR config invalid", $writelog_process_name);
}

// 設定ファイル読み込み
global $conf;
global $publicDir, $md5cmd, $convert, $montage, $unzip, $unrar, $cpdf, $p7zip, $ffmpeg, $book_search_url, $cacheSize, $isPageSave, $isPreCache, $async, $width, $quality, $fullsize_png_compress, $global_debug_flag, $global_resize, $usm;
global $maxPage;

readConfig($dbh);
$resize = $global_resize;

// HUP受け取ったらキャッシュディレクトリ内削除
// 非同期シグナルを有効にします
pcntl_async_signals(true);
// SIGTERMを監視
// 受信したら、プログラムを終了する
pcntl_signal(SIGTERM, function ($sig) {
    global $conf, $writelog_process_name, $file;
    writelog("SIGTERM received.waiting...");
    clean_shm_dir();
    $nestedExtractDir = $conf["cacheDir"] . '/make_picture/' . $file;
    if (is_dir($nestedExtractDir)) {
        writelog("DEBUG rm $nestedExtractDir", $writelog_process_name);
        deleteDirectory($conf["cacheDir"] . '/make_picture/' . $file);
    }
    exit;
});

register_shutdown_function(function () {
    global $conf, $writelog_process_name, $file;
    clean_shm_dir();
    $nestedExtractDir = $conf["cacheDir"] . '/make_picture/' . $file;
    if (is_dir($nestedExtractDir)) {
        writelog("DEBUG rm $nestedExtractDir", $writelog_process_name);
        deleteDirectory($conf["cacheDir"] . '/make_picture/' . $file);
    }
});


// シングルファイルモードなら
// コマンドライン引数を取得
$options = getopt("", ["file:", "type:", "cache:", "trimming::"]);

// 引数のバリデーション
if (!isset($options['file']) || !isset($options['type'])) {
    writelog("ERROR invalid arguments;require file and type. file:" . $options['file'] . " type:" . $options['type'], $writelog_process_name);
    exit(1);
}

$file = $options['file'];
$type = $options['type'];
writelog("DEBUG Start process, type:$type", $writelog_process_name);
// 作業ディレクトリ作成
// $conf_cacheDir = $cacheDir;
if ((isset($options['cache'])) && ($options['cache'] == true)) {
    // ファイルオープン時はわざわざキャッシュ作らなくても読書用がすでに用意されているはずなので上書き不要
    if (is_dir($cacheDir)) {
        writelog("DEBUG cacheDir:$cacheDir", $writelog_process_name);
    } else {
        writelog('ERROR The specified directory does not exist, although it was opened by the reader.' . $cacheDir, $writelog_process_name);
        exit(1);
    }
} else {
    // バッチ処理起動
    $cacheDir = $conf["comistream_tmp_dir_root"] . '/make_picture/' . $type . '/' . getmypid(); // shmを利用するように上書き

    if (!chkAndMakeDir($cacheDir)) {
        exit(1);
    }
}
// VIPSのバージョン情報を取得
$isVipsAvailable = isVipsAvailable(true);

// 最終作成ファイル
$coverFile = $conf["comistream_tool_dir"] . "/data/theme/covers" . $conf["publicDir"] . '/' . $file;
$coverFile = preg_replace('/\.[^.]+$/', '.jpg', $coverFile);
$previewFile = $conf["comistream_tool_dir"] . "/data/theme/preview" . $conf["publicDir"] . '/' . $file;
$previewFile = preg_replace('/\.[^.]+$/', '.webp', $previewFile);
writelog("DEBUG coverFile:$coverFile previewFile:$previewFile", $writelog_process_name);

// 拡張子取得
$ext = getPathExtensionIgnoringTrailingSpaces($file);
writelog("DEBUG file:$file ext:$ext", $writelog_process_name);

$fullpathFile = $sharePath . '/' . $file;

// ファイルフォーマットごとの処理
// epubの処理 =======================================================================================
if (strcasecmp($ext, 'epub') == 0) {
    writelog("DEBUG epub detected.", $writelog_process_name);
    // 一時ディレクトリを作成
    // epubの画像は開かれたときではなくバッチでしか作成されない
    $epubTempDir = $cacheDir . '/make_picture_epub_extract_tmp_' . getmypid();
    if (!chkAndMakeDir($epubTempDir)) {
        exit(1);
    } else {
        register_shutdown_function(function () {
            global $conf, $cacheDir;
            $epubTempDir = $cacheDir . '/make_picture_epub_extract_tmp_' . getmypid();
            deleteDirectory($epubTempDir);
        });
    }
    // 7zzコマンドを使用してEPUBファイルを展開
    // ファイル名に特殊文字（!、()、;、~など）が含まれる場合があるのでescapeshellarg()でエスケープするルン

    // ファイルの存在確認（デバッグ用）
    writelog("DEBUG EPUB file existence check: " . (file_exists($fullpathFile) ? "EXISTS" : "NOT FOUND"), $writelog_process_name);
    writelog("DEBUG EPUB file path bytes: " . bin2hex($fullpathFile), $writelog_process_name);

    if (!file_exists($fullpathFile)) {
        // ファイルが見つからない場合、ディレクトリ内のファイル一覧を取得して類似ファイルを探すルン
        $parentDir = dirname($fullpathFile);
        $targetBasename = basename($fullpathFile);
        writelog("DEBUG Parent directory: $parentDir", $writelog_process_name);
        writelog("DEBUG Target basename: $targetBasename", $writelog_process_name);
        writelog("DEBUG Target basename bytes: " . bin2hex($targetBasename), $writelog_process_name);
        writelog("DEBUG Normalizer class exists: " . (class_exists('Normalizer') ? "YES" : "NO"), $writelog_process_name);

        if (is_dir($parentDir)) {
            $filesInDir = scandir($parentDir);

            // 類似ファイル名を探す（Unicode正規化の違いを吸収）
            $foundMatch = false;
            $epubCount = 0;
            foreach ($filesInDir as $fileInDir) {
                if (stripos($fileInDir, '.epub') !== false) {
                    $epubCount++;

                    // NFC/NFD正規化を試みるルン（両方の方向で試す）
                    if (class_exists('Normalizer')) {
                        // ターゲットをNFCに正規化
                        $normalizedTargetNFC = \Normalizer::normalize($targetBasename, \Normalizer::NFC);
                        // ファイル名をNFCに正規化
                        $normalizedFileNFC = \Normalizer::normalize($fileInDir, \Normalizer::NFC);
                        // ターゲットをNFDに正規化
                        $normalizedTargetNFD = \Normalizer::normalize($targetBasename, \Normalizer::NFD);
                        // ファイル名をNFDに正規化
                        $normalizedFileNFD = \Normalizer::normalize($fileInDir, \Normalizer::NFD);

                        // NFC同士、NFD同士、または交差で比較
                        if ($normalizedTargetNFC === $normalizedFileNFC ||
                            $normalizedTargetNFD === $normalizedFileNFD ||
                            $normalizedTargetNFC === $normalizedFileNFD ||
                            $normalizedTargetNFD === $normalizedFileNFC) {
                            writelog("DEBUG Found matching file with different normalization: $fileInDir", $writelog_process_name);
                            writelog("DEBUG Matched file bytes: " . bin2hex($fileInDir), $writelog_process_name);
                            $fullpathFile = $parentDir . '/' . $fileInDir;
                            $foundMatch = true;
                            break;
                        }
                    } else {
                        // Normalizerがない場合は単純比較
                        if ($targetBasename === $fileInDir) {
                            $fullpathFile = $parentDir . '/' . $fileInDir;
                            $foundMatch = true;
                            break;
                        }
                    }
                }
            }

            writelog("DEBUG Scanned $epubCount epub files, match found: " . ($foundMatch ? "YES" : "NO"), $writelog_process_name);

            // まだ見つからない場合、ファイル名の一部で検索（最初の10文字）
            if (!$foundMatch) {
                $targetPrefix = mb_substr($targetBasename, 0, 10, 'UTF-8');
                $normalizedPrefix = class_exists('Normalizer') ? \Normalizer::normalize($targetPrefix, \Normalizer::NFC) : $targetPrefix;
                writelog("DEBUG Trying partial match with prefix: $targetPrefix", $writelog_process_name);

                foreach ($filesInDir as $fileInDir) {
                    if (stripos($fileInDir, '.epub') !== false) {
                        $filePrefix = mb_substr($fileInDir, 0, 10, 'UTF-8');
                        $normalizedFilePrefix = class_exists('Normalizer') ? \Normalizer::normalize($filePrefix, \Normalizer::NFC) : $filePrefix;

                        if ($normalizedPrefix === $normalizedFilePrefix) {
                            writelog("DEBUG Found partial matching file: $fileInDir", $writelog_process_name);
                            writelog("DEBUG Partial matched file bytes: " . bin2hex($fileInDir), $writelog_process_name);
                            $fullpathFile = $parentDir . '/' . $fileInDir;
                            $foundMatch = true;
                            break;
                        }
                    }
                }
            }

            if (!$foundMatch) {
                writelog("DEBUG No matching file found after all attempts", $writelog_process_name);
            }
        }
    }

    $escapedEpubTempDir = escapeshellarg($epubTempDir);
    $escapedFullpathFile = escapeshellarg($fullpathFile);
    // LANG環境変数を明示的に設定してUTF-8ファイル名を正しく扱うルン
    $cmd = "LANG=ja_JP.UTF-8 " . $p7zip . " x -o" . $escapedEpubTempDir . " " . $escapedFullpathFile;
    writelog("DEBUG EPUB extract command: $cmd", $writelog_process_name);
    exec($cmd, $output, $return_var);

    if ($return_var !== 0) {
        writelog("ERROR: Failed to extract EPUB file: $cmd (return_var=$return_var)", $writelog_process_name);
        if (!empty($output)) {
            writelog("ERROR: 7zz output: " . implode("\n", $output), $writelog_process_name);
        }
        // 再度ファイル存在確認
        writelog("ERROR: File exists after failure: " . (file_exists($fullpathFile) ? "YES" : "NO"), $writelog_process_name);
        deleteDirectory($epubTempDir);
        clean_shm_dir();
        exit(1);
    }
    if ($type == 'covers') {
        writelog("DEBUG type covers", $writelog_process_name);
        // EPUBファイルの処理
        writelog("DEBUG fullpathFile:$fullpathFile", $writelog_process_name);

        // EPUB表紙作成開始ログ
        writelog("DEBUG [EPUB-COVER] === EPUB表紙作成処理開始 ===", $writelog_process_name);
        writelog("DEBUG [EPUB-COVER] 対象ファイル: $fullpathFile", $writelog_process_name);
        writelog("DEBUG [EPUB-COVER] 展開先: $epubTempDir", $writelog_process_name);
        writelog("DEBUG [EPUB-COVER] 出力先: $coverFile", $writelog_process_name);

        // container.xmlファイルを探す
        $containerXmlPath = "$epubTempDir/META-INF/container.xml";
        writelog("DEBUG [EPUB-COVER] container.xml読み込み: $containerXmlPath", $writelog_process_name);
        $containerXml = file_get_contents($containerXmlPath);
        if ($containerXml === false) {
            writelog("ERROR [EPUB-COVER] container.xml not found in EPUB file: $file", $writelog_process_name);
            deleteDirectory($epubTempDir);
            clean_shm_dir();
            exit(1);
        }
        writelog("DEBUG [EPUB-COVER] container.xml読み込み成功 (サイズ: " . strlen($containerXml) . " bytes)", $writelog_process_name);

        // content.opfファイルのパスを取得
        $xml = new SimpleXMLElement($containerXml);
        $contentOpfPath = $xml->rootfiles->rootfile['full-path'];
        writelog("DEBUG [EPUB-COVER] content.opfパス: $contentOpfPath", $writelog_process_name);

        // content.opfファイルの内容を取得
        $contentOpfFullPath = "$epubTempDir/$contentOpfPath";
        writelog("DEBUG [EPUB-COVER] content.opf読み込み: $contentOpfFullPath", $writelog_process_name);
        if (!file_exists($contentOpfFullPath)) {
            writelog("ERROR [EPUB-COVER] content.opfファイルが存在しません: $contentOpfFullPath", $writelog_process_name);
            deleteDirectory($epubTempDir);
            clean_shm_dir();
            exit(1);
        }
        $contentOpf = file_get_contents($contentOpfFullPath);
        $contentXml = new SimpleXMLElement($contentOpf);
        writelog("DEBUG [EPUB-COVER] content.opf読み込み成功 (サイズ: " . strlen($contentOpf) . " bytes)", $writelog_process_name);

        // 表紙画像のファイル名を探す
        $coverFileName = null;
        // 相対パスの場合、content.opfファイルのディレクトリを基準にするルン
        $contentOpfDir = dirname($contentOpfPath);
        writelog("DEBUG [EPUB-COVER] contentOpfDir: $contentOpfDir", $writelog_process_name);

        // manifestの全アイテムをログ出力（デバッグ用）
        writelog("DEBUG [EPUB-COVER] --- manifestアイテム一覧 ---", $writelog_process_name);
        $manifestItemCount = 0;
        foreach ($contentXml->manifest->item as $item) {
            $itemId = (string)$item['id'];
            $itemHref = (string)$item['href'];
            $itemProps = (string)$item['properties'];
            $itemMediaType = (string)$item['media-type'];
            writelog("DEBUG [EPUB-COVER]   id:$itemId href:$itemHref props:$itemProps media-type:$itemMediaType", $writelog_process_name);
            $manifestItemCount++;

            if ($itemId === 'cover' || $itemProps === 'cover-image') {
                $coverFileName = $itemHref;
                writelog("DEBUG [EPUB-COVER] >>> 表紙候補発見 (id=$itemId, props=$itemProps): $coverFileName", $writelog_process_name);
                break;
            }
        }
        writelog("DEBUG [EPUB-COVER] manifestアイテム総数: $manifestItemCount", $writelog_process_name);

        // 表紙画像が見つからない場合、または.xhtmlファイルだった場合の処理
        if ($coverFileName === null || pathinfo($coverFileName, PATHINFO_EXTENSION) === 'xhtml') {
            writelog("DEBUG [EPUB-COVER] 表紙が未発見またはxhtml。manifestから画像を直接探索...", $writelog_process_name);
            foreach ($contentXml->manifest->item as $item) {
                $itemHref = (string)$item['href'];
                $itemExt = pathinfo($itemHref, PATHINFO_EXTENSION);
                if (in_array($itemExt, ['jpg', 'jpeg', 'png', 'gif'])) {
                    $coverFileName = $itemHref;
                    writelog("DEBUG [EPUB-COVER] >>> manifest内の最初の画像を表紙として採用: $coverFileName", $writelog_process_name);
                    break;
                }
            }

            // .xhtmlファイルの場合、中身を解析して画像ファイルを探す
            if ($coverFileName !== null && pathinfo($coverFileName, PATHINFO_EXTENSION) === 'xhtml') {
                writelog("DEBUG [EPUB-COVER] xhtmlファイルを解析中: $coverFileName", $writelog_process_name);
                $xhtmlFullPath = "$epubTempDir/$contentOpfDir/$coverFileName";
                if (file_exists($xhtmlFullPath)) {
                    $xhtmlContent = file_get_contents($xhtmlFullPath);
                    $xhtmlXml = new SimpleXMLElement($xhtmlContent);
                    $xhtmlXml->registerXPathNamespace('xlink', 'http://www.w3.org/1999/xlink');
                    $images = $xhtmlXml->xpath('//image[@xlink:href]');
                    if (!empty($images)) {
                        $coverFileName = (string)$images[0]['xlink:href'];
                        writelog("DEBUG [EPUB-COVER] >>> xhtmlから画像参照を抽出: $coverFileName", $writelog_process_name);
                    } else {
                        writelog("WARNING [EPUB-COVER] xhtml内にimage要素が見つかりません", $writelog_process_name);
                    }
                } else {
                    writelog("WARNING [EPUB-COVER] xhtmlファイルが存在しません: $xhtmlFullPath", $writelog_process_name);
                }
            }
        }

        writelog("DEBUG [EPUB-COVER] 表紙ファイル名（SVG解析前）: " . ($coverFileName ?? "null"), $writelog_process_name);

        // SVGファイルの場合、SVG内の画像参照を解析するルン
        if ($coverFileName !== null && strtolower(pathinfo($coverFileName, PATHINFO_EXTENSION)) === 'svg') {
            writelog("DEBUG [EPUB-COVER] SVGファイルを検出: $coverFileName", $writelog_process_name);
            $svgFilePath = "$epubTempDir/$contentOpfDir/$coverFileName";
            writelog("DEBUG [EPUB-COVER] SVGファイルパス: $svgFilePath", $writelog_process_name);
            writelog("DEBUG [EPUB-COVER] SVGファイル存在確認: " . (file_exists($svgFilePath) ? "存在する" : "存在しない"), $writelog_process_name);

            if (file_exists($svgFilePath)) {
                $svgContent = file_get_contents($svgFilePath);
                writelog("DEBUG [EPUB-COVER] SVGコンテンツ (先頭500文字): " . substr($svgContent, 0, 500), $writelog_process_name);
                $svgDir = dirname($coverFileName);
                writelog("DEBUG [EPUB-COVER] SVGディレクトリ (相対パス解決用): '$svgDir'", $writelog_process_name);

                $extractedImage = extractImageFromSvg($svgContent, $svgDir);
                writelog("DEBUG [EPUB-COVER] extractImageFromSvg結果: " . ($extractedImage ?? "null"), $writelog_process_name);

                if ($extractedImage !== null) {
                    writelog("DEBUG [EPUB-COVER] >>> SVGから画像パス抽出成功: $extractedImage", $writelog_process_name);
                    $coverFileName = $extractedImage;
                } else {
                    writelog("WARNING [EPUB-COVER] SVGから画像を抽出できませんでした", $writelog_process_name);
                }
            }
        }

        writelog("DEBUG [EPUB-COVER] 最終的な表紙ファイル名: " . ($coverFileName ?? "null"), $writelog_process_name);

        // 表紙が見つからない場合、フォールバック検索を行うルン
        if ($coverFileName === null) {
            writelog("DEBUG [EPUB-COVER] === フォールバック検索開始 ===", $writelog_process_name);
            writelog("DEBUG [EPUB-COVER] 展開ディレクトリ内から *cover* パターンの画像を検索...", $writelog_process_name);

            $fallbackCover = findFallbackCoverImage($epubTempDir);

            if ($fallbackCover !== null) {
                // フォールバックで見つかった場合、相対パスに変換するルン
                // $epubTempDir/$contentOpfDir/ からの相対パスにする
                $baseDir = "$epubTempDir/$contentOpfDir";
                if (strpos($fallbackCover, $baseDir) === 0) {
                    $coverFileName = substr($fallbackCover, strlen($baseDir) + 1);
                } else {
                    // baseDirの外にある場合は$epubTempDirからの相対パスを使うルン
                    $coverFileName = substr($fallbackCover, strlen($epubTempDir) + 1);
                    // contentOpfDirを考慮して調整
                    if ($contentOpfDir !== '.') {
                        // 親ディレクトリに戻る必要があるかもしれないルン
                        $depthCount = substr_count($contentOpfDir, '/') + 1;
                        $coverFileName = str_repeat('../', $depthCount) . $coverFileName;
                    }
                }
                writelog("DEBUG [EPUB-COVER] >>> フォールバック検索で表紙発見: $coverFileName", $writelog_process_name);
                writelog("DEBUG [EPUB-COVER] >>> 元のフルパス: $fallbackCover", $writelog_process_name);
            } else {
                writelog("DEBUG [EPUB-COVER] フォールバック検索でも表紙が見つかりませんでした", $writelog_process_name);
            }
        }

        if ($coverFileName === null) {
            writelog("ERROR [EPUB-COVER] Cover image not found in EPUB file: $file", $writelog_process_name);
            deleteDirectory($epubTempDir);
            clean_shm_dir();
            exit(1);
        }

        // 最終的なパスを構築して確認
        $coverFilePathRaw = "$epubTempDir/$contentOpfDir/$coverFileName";
        writelog("DEBUG [EPUB-COVER] 表紙画像パス（realpath前）: $coverFilePathRaw", $writelog_process_name);
        writelog("DEBUG [EPUB-COVER] ファイル存在確認（realpath前）: " . (file_exists($coverFilePathRaw) ? "存在する" : "存在しない"), $writelog_process_name);

        $coverFilePath = realpath($coverFilePathRaw);
        writelog("DEBUG [EPUB-COVER] 表紙画像パス（realpath後）: " . ($coverFilePath ?: "false"), $writelog_process_name);

        if ($coverFilePath === false || !file_exists($coverFilePath)) {
            writelog("ERROR [EPUB-COVER] Cover image file not found: $coverFilePath", $writelog_process_name);
            // ディレクトリ内のファイル一覧を出力
            $dirToList = dirname($coverFilePathRaw);
            if (is_dir($dirToList)) {
                $filesInDir = scandir($dirToList);
                writelog("DEBUG [EPUB-COVER] ディレクトリ '$dirToList' 内のファイル: " . implode(", ", $filesInDir), $writelog_process_name);
            }
            deleteDirectory($epubTempDir);
            clean_shm_dir();
            exit(1);
        }

        writelog("DEBUG [EPUB-COVER] 表紙画像ファイル確認OK: $coverFilePath", $writelog_process_name);
        writelog("DEBUG [EPUB-COVER] 表紙画像ファイルサイズ: " . filesize($coverFilePath) . " bytes", $writelog_process_name);

        // 作成ファイルのディレクトリを作成
        create_cover_dir($coverFile);
        writelog("DEBUG [EPUB-COVER] 出力ディレクトリ作成完了", $writelog_process_name);

        // 画像を処理し、$coverFileに保存（libvips優先、フォールバック：ImageMagick）
        writelog("DEBUG [EPUB-COVER] === 画像変換処理開始 ===", $writelog_process_name);
        writelog("DEBUG [EPUB-COVER] libvips利用可能: " . ($isVipsAvailable ? "YES" : "NO"), $writelog_process_name);

        if ($isVipsAvailable) {
            writelog("DEBUG: Using libvips for EPUB cover image processing", $writelog_process_name);

            try {
                // リサイズ処理のターゲットサイズを計算（ImageMagick形式の'x400'から数値を抽出）
                $targetSize = intval(preg_replace('/[^0-9]/', '', $resize));
                if ($targetSize <= 0) {
                    $targetSize = 400; // フォールバック値
                }
                writelog("DEBUG [EPUB-COVER] リサイズターゲットサイズ: $targetSize", $writelog_process_name);

                // 画像情報を取得して最適な処理方法を選択するルン（オーバーヘッドはほぼゼロ！）
                $imageInfo = @getimagesize($coverFilePath);
                $shouldUseThumbnailImage = false;

                if ($imageInfo !== false) {
                    $imgWidth = $imageInfo[0];
                    $imgHeight = $imageInfo[1];
                    $mimeType = $imageInfo['mime'];
                    $maxDimension = max($imgWidth, $imgHeight);

                    // JPEG/WebP かつ 3000px以上の大きい画像の場合のみthumbnail_image()を使用するルン
                    $shouldUseThumbnailImage = (
                        ($mimeType === 'image/jpeg' || $mimeType === 'image/webp') &&
                        $maxDimension >= 3000
                    );

                    writelog("DEBUG: EPUB cover analysis - format:$mimeType size:{$imgWidth}x{$imgHeight} max:$maxDimension use_thumbnail_image:" . ($shouldUseThumbnailImage ? 'YES' : 'NO'), $writelog_process_name);
                } else {
                    writelog("WARNING [EPUB-COVER] getimagesize()失敗。thumbnail_image()を使用", $writelog_process_name);
                    $shouldUseThumbnailImage = true;
                }

                // 画像特性に応じた最適な処理方法を選択するルン！
                if ($shouldUseThumbnailImage) {
                    // 大きいJPEG/WebP: thumbnail_image()でshrink-on-load（高速！）
                    writelog("DEBUG [EPUB-COVER] thumbnail()メソッドで処理", $writelog_process_name);
                    $image = \Jcupitt\Vips\Image::thumbnail($coverFilePath, $targetSize, [
                        'height' => $targetSize,
                        'size' => 'down'
                    ]);
                    writelog("DEBUG: EPUB cover used thumbnail_image() (shrink-on-load)", $writelog_process_name);
                } else {
                    // AVIF/小さい画像: 従来のnewFromFile() + resize()（高速！）
                    writelog("DEBUG [EPUB-COVER] newFromFile() + resize()メソッドで処理", $writelog_process_name);
                    $image = \Jcupitt\Vips\Image::newFromFile($coverFilePath);
                    $scale = $targetSize / max($image->width, $image->height);
                    if ($scale < 1) {
                        $image = $image->resize($scale, ['kernel' => 'lanczos3']);
                    }
                    writelog("DEBUG: EPUB cover used newFromFile() + resize()", $writelog_process_name);
                }

                writelog("DEBUG: EPUB cover resized - targetSize:$targetSize final size:" . $image->width . "x" . $image->height, $writelog_process_name);

                // JPEG形式で保存（strip=メタデータ削除）
                writelog("DEBUG [EPUB-COVER] JPEG保存実行: $coverFile", $writelog_process_name);
                $image->jpegsave($coverFile, ['Q' => 80, 'strip' => true]);

                writelog("DEBUG: Cover image successfully processed with libvips", $writelog_process_name);
            } catch (\Jcupitt\Vips\Exception $e) {
                writelog("WARNING [EPUB-COVER] libvips例外発生、ImageMagickにフォールバック: " . $e->getMessage(), $writelog_process_name);

                // フォールバック：ImageMagick
                // オヨ！ファイル名にバッククォートや特殊文字が含まれる場合があるからescapeshellarg()でエスケープするルン！
                $escapedCoverFilePath = escapeshellarg($coverFilePath);
                $escapedCoverFile = escapeshellarg($coverFile);
                $cmd = "$convert $escapedCoverFilePath $usm -strip -resize $resize -quality 80 -format jpeg jpeg:$escapedCoverFile";
                writelog("DEBUG [EPUB-COVER] ImageMagickコマンド: $cmd", $writelog_process_name);
                exec($cmd, $output, $return_var);

                if ($return_var !== 0) {
                    writelog("ERROR [EPUB-COVER] ImageMagick変換失敗 (return_var=$return_var): $cmd", $writelog_process_name);
                    deleteDirectory($epubTempDir);
                    clean_shm_dir();
                    exit(1);
                }
                writelog("DEBUG [EPUB-COVER] ImageMagickでの変換成功", $writelog_process_name);
            }
        } else {
            // ImageMagickを使用して画像を処理し、$coverFileに保存
            writelog("DEBUG [EPUB-COVER] ImageMagickで画像変換を実行", $writelog_process_name);
            // オヨ！ファイル名にバッククォートや特殊文字が含まれる場合があるからescapeshellarg()でエスケープするルン！
            $escapedCoverFilePath = escapeshellarg($coverFilePath);
            $escapedCoverFile = escapeshellarg($coverFile);
            $cmd = "$convert $escapedCoverFilePath $usm -strip -resize $resize -quality 80 -format jpeg jpeg:$escapedCoverFile";
            writelog("DEBUG [EPUB-COVER] ImageMagickコマンド: $cmd", $writelog_process_name);
            exec($cmd, $output, $return_var);

            if ($return_var !== 0) {
                writelog("ERROR [EPUB-COVER] ImageMagick変換失敗 (return_var=$return_var): $cmd", $writelog_process_name);
                deleteDirectory($epubTempDir);
                clean_shm_dir();
                exit(1);
            }
            writelog("DEBUG [EPUB-COVER] ImageMagickでの変換成功", $writelog_process_name);
        }

        // 出力ファイルの確認
        if (file_exists($coverFile)) {
            $outputFileSize = filesize($coverFile);
            writelog("DEBUG [EPUB-COVER] === 処理完了 ===", $writelog_process_name);
            writelog("DEBUG [EPUB-COVER] 出力ファイル: $coverFile", $writelog_process_name);
            writelog("DEBUG [EPUB-COVER] 出力ファイルサイズ: $outputFileSize bytes", $writelog_process_name);
            if ($outputFileSize === 0) {
                writelog("WARNING [EPUB-COVER] 出力ファイルが0バイトです！", $writelog_process_name);
            }
        } else {
            writelog("ERROR [EPUB-COVER] 出力ファイルが作成されませんでした: $coverFile", $writelog_process_name);
        }

        // 一時ディレクトリを削除
        deleteDirectory($epubTempDir);
        clean_shm_dir();
        writelog("DEBUG [EPUB-COVER] 一時ディレクトリ削除完了", $writelog_process_name);
    } else {
        // epubのpreview
        writelog("DEBUG type preview", $writelog_process_name);

        // container.xmlファイルを探してopfのパスを取得するルン
        $containerXml = file_get_contents("$epubTempDir/META-INF/container.xml");
        if ($containerXml === false) {
            writelog("ERROR: container.xml not found in EPUB file: $file", $writelog_process_name);
            deleteDirectory($epubTempDir);
            clean_shm_dir();
            exit(1);
        }

        // content.opfファイルのパスを取得
        $xml = new SimpleXMLElement($containerXml);
        $contentOpfPath = (string)$xml->rootfiles->rootfile['full-path'];
        $contentOpfDir = dirname($contentOpfPath);

        // content.opfファイルの内容を取得してspineを解析するルン
        $contentOpf = file_get_contents("$epubTempDir/$contentOpfPath");
        $contentXml = new SimpleXMLElement($contentOpf);

        // manifestからidでhrefを引けるマップを作成
        $manifestMap = [];
        foreach ($contentXml->manifest->item as $item) {
            $manifestMap[(string)$item['id']] = (string)$item['href'];
        }

        // spineの順序で画像ファイルを収集するルン
        $imageFiles = [];
        foreach ($contentXml->spine->itemref as $itemref) {
            $idref = (string)$itemref['idref'];
            if (isset($manifestMap[$idref])) {
                $href = $manifestMap[$idref];
                $fullPath = "$epubTempDir/$contentOpfDir/$href";

                // SVGファイルの場合、中の画像参照を解析するルン
                if (strtolower(pathinfo($href, PATHINFO_EXTENSION)) === 'svg' && file_exists($fullPath)) {
                    $svgContent = file_get_contents($fullPath);
                    $extractedImage = extractImageFromSvg($svgContent, dirname($href));
                    if ($extractedImage !== null) {
                        $imagePath = realpath("$epubTempDir/$contentOpfDir/$extractedImage");
                        if ($imagePath !== false && file_exists($imagePath)) {
                            $imageFiles[] = $imagePath;
                            writelog("DEBUG preview image from SVG: $imagePath", $writelog_process_name);
                        }
                    }
                }
                // 直接画像ファイルの場合
                elseif (in_array(strtolower(pathinfo($href, PATHINFO_EXTENSION)), ['jpg', 'jpeg', 'png', 'gif', 'webp'])) {
                    if (file_exists($fullPath)) {
                        $imageFiles[] = $fullPath;
                    }
                }
            }

            // 12枚集まったらループを抜けるルン
            if (count($imageFiles) >= 12) {
                break;
            }
        }

        writelog("DEBUG collected " . count($imageFiles) . " images from spine", $writelog_process_name);

        // spineから画像が見つからなかった場合、従来の方法で探すルン
        if (empty($imageFiles)) {
            writelog("DEBUG falling back to directory search", $writelog_process_name);
            $imageDirs = ['images', 'OEBPS/Images', 'OEBPS/images', 'OPS/Images', 'OPS/images'];

            foreach ($imageDirs as $imageDir) {
                $fullImageDir = $epubTempDir . '/' . $imageDir;
                if (is_dir($fullImageDir)) {
                    $files = glob($fullImageDir . '/*.{jpg,jpeg,png,gif,webp}', GLOB_BRACE);
                    $imageFiles = array_merge($imageFiles, $files);
                }
            }

            // 画像が見つからない場合、EPUBの全ディレクトリを検索
            if (empty($imageFiles)) {
                $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($epubTempDir));
                foreach ($iterator as $file) {
                    if ($file->isFile() && in_array(strtolower($file->getExtension()), ['jpg', 'jpeg', 'png', 'gif', 'webp'])) {
                        $imageFiles[] = $file->getPathname();
                    }
                }
            }
        }

        // 画像が12枚未満の場合、警告を出す
        if (count($imageFiles) < 12) {
            writelog("WARNING: Less than 12 images found in EPUB file: " . count($imageFiles), $writelog_process_name);
        }

        // 最初の12枚の画像を処理
        $shmDir = create_shm_dir();
        for ($i = 0; $i < min(12, count($imageFiles)); $i++) {
            $outputFileBasename = sprintf("%03d", $i + 1);

            // libvipsが利用可能なら高速処理を使用（ライブラリ版）
            if ($isVipsAvailable) {
                try {
                    // リサイズ処理のターゲットサイズを計算（ImageMagick形式の'x400'から数値を抽出）
                    $targetSize = intval(preg_replace('/[^0-9]/', '', $resize));
                    if ($targetSize <= 0) {
                        $targetSize = 400; // フォールバック値
                    }

                    // 画像情報を取得して最適な処理方法を選択するルン（オーバーヘッドはほぼゼロ！）
                    $imageInfo = @getimagesize($imageFiles[$i]);
                    $shouldUseThumbnailImage = false;

                    if ($imageInfo !== false) {
                        $imgWidth = $imageInfo[0];
                        $imgHeight = $imageInfo[1];
                        $mimeType = $imageInfo['mime'];
                        $maxDimension = max($imgWidth, $imgHeight);

                        // JPEG/WebP かつ 3000px以上の大きい画像の場合のみthumbnail()を使用するルン
                        $shouldUseThumbnailImage = (
                            ($mimeType === 'image/jpeg' || $mimeType === 'image/webp') &&
                            $maxDimension >= 3000
                        );
                    }

                    // 画像特性に応じた最適な処理方法を選択するルン！
                    if ($shouldUseThumbnailImage) {
                        // 大きいJPEG/WebP: thumbnail()でshrink-on-load（高速！）
                        $image = \Jcupitt\Vips\Image::thumbnail($imageFiles[$i], $targetSize, [
                            'height' => $targetSize,
                            'size' => 'down'
                        ]);
                    } else {
                        // AVIF/小さい画像: 従来のnewFromFile() + resize()（高速！）
                        $image = \Jcupitt\Vips\Image::newFromFile($imageFiles[$i]);
                        $scale = $targetSize / max($image->width, $image->height);
                        if ($scale < 1) {
                            $image = $image->resize($scale, ['kernel' => 'lanczos3']);
                        }
                    }

                    // PNG形式で保存（strip=メタデータ削除）
                    $outputPath = "$shmDir/" . $outputFileBasename . ".png";
                    $image->pngsave($outputPath, ['strip' => true]);

                    writelog("DEBUG: Image $i successfully processed with libvips", $writelog_process_name);
                } catch (\Jcupitt\Vips\Exception $e) {
                    writelog("ERROR: Failed to convert image with libvips: " . $e->getMessage(), $writelog_process_name);
                    // フォールバック：ImageMagick
                    // オヨ！ファイル名に特殊文字が含まれる場合があるからescapeshellarg()でエスケープするルン！
                    $escapedImageFile = escapeshellarg($imageFiles[$i]);
                    $cmd = "$convert $escapedImageFile $usm -strip -resize $resize -quality $quality -format png png:\"$shmDir/" . $outputFileBasename . ".png\"";
                    exec($cmd, $output, $return_var);

                    if ($return_var !== 0) {
                        writelog("ERROR: Failed to convert image with ImageMagick: $cmd", $writelog_process_name);
                    }
                }
            } else {
                // ImageMagickを使用
                // オヨ！ファイル名に特殊文字が含まれる場合があるからescapeshellarg()でエスケープするルン！
                $escapedImageFile = escapeshellarg($imageFiles[$i]);
                $cmd = "$convert $escapedImageFile $usm -strip -resize $resize -quality $quality -format png png:\"$shmDir/" . $outputFileBasename . ".png\"";
                exec($cmd, $output, $return_var);

                if ($return_var !== 0) {
                    writelog("ERROR: Failed to convert image: $cmd", $writelog_process_name);
                }
            }
            unset($image);
        }

        // プレビュー画像を作成
        create_preview_dir($previewFile);
        // オヨ！ファイル名にバッククォートや特殊文字が含まれる場合があるからescapeshellarg()でエスケープするルン！
        $escapedPreviewFile = escapeshellarg($previewFile);
        $concatCmd = "LANG=ja_JP.UTF8 nice $montage -background '#000000' -geometry +3+3 $shmDir/004.png $shmDir/003.png $shmDir/002.png $shmDir/001.png $shmDir/008.png $shmDir/007.png $shmDir/006.png $shmDir/005.png $shmDir/012.png $shmDir/011.png $shmDir/010.png $shmDir/009.png -tile 4x3 - | $convert - -quality $quality -define webp:lossless=false $escapedPreviewFile";
        writelog("DEBUG concatCmd:$concatCmd", $writelog_process_name);
        exec($concatCmd, $output, $return_var);

        if ($return_var !== 0) {
            writelog('ERROR exec failed. Command: ' . $concatCmd . ' Return code: ' . $return_var, $writelog_process_name);
            clean_shm_dir();
            deleteDirectory($epubTempDir);
            exit(1);
        } else {
            writelog('DEBUG exec succeeded. Command: ' . $concatCmd . ' Output: ' . implode("\n", $output), $writelog_process_name);
        }

        // 一時ディレクトリを削除
        clean_shm_dir();
        deleteDirectory($epubTempDir);
    }
    exit(0);
} elseif (in_array(strtolower($ext), ['zip', 'cbz', 'rar', 'cbr', '7z', 'cb7', 'pdf'])) {
    // zip/rarの場合 =======================================================================================
    // nested archiveの場合は/dev/shm/ではなく$cacheDirに展開する
    // # ファイルオープン
    $user = 'guest';
    $size = 'FULL';
    openPage();
    // 画像は余白をトリミングするかどうかを制御するルン
    if (isset($options['trimming']) && $options['trimming'] == 2) {
        // --trimming=2 が明示的に指定された場合はトリミングしないルン
        $view = '';
    } elseif ($type == 'preview') {
        // プレビュー画像作成時はusePreviewTrim設定で制御するルン（デフォルト:トリミングしない）
        // ImageMagickの-fuzz -trim処理はCPU負荷が非常に高いため、デフォルトでは無効ルン
        $usePreviewTrim = checkSystemConfig($dbh, 'usePreviewTrim', 0);
        if (intval($usePreviewTrim) === 1) {
            $view = 'trimming';
            writelog("DEBUG usePreviewTrim is enabled, trimming mode for preview", $writelog_process_name);
        } else {
            $view = '';
            writelog("DEBUG usePreviewTrim is disabled, skip trimming for preview (CPU saving)", $writelog_process_name);
        }
    } else {
        $view = 'trimming';
    }

    if ($type == 'covers') {

        create_cover_dir($coverFile);
        $page = 1;
        $pageOutCmd = outputPage(true);
        writelog('DEBUG $type outputPage() returned:' . $pageOutCmd, $writelog_process_name);

        // libvipsが利用可能なら高速処理を使用
        if ($isVipsAvailable) {
            writelog("DEBUG: Using libvips for cover image processing", $writelog_process_name);

            try {
                // outputPageのコマンドを実行して画像データを取得
                writelog("DEBUG: will run pageOutCmd:" . $pageOutCmd, $writelog_process_name);
                $imageData = shell_exec($pageOutCmd);

                if ($imageData === null || strlen($imageData) === 0) {
                    throw new Exception("Failed to get image data from outputPage command");
                }

                // リサイズ処理のターゲットサイズを計算（ImageMagick形式の'x400'から数値を抽出）
                $targetSize = intval(preg_replace('/[^0-9]/', '', $resize));
                if ($targetSize <= 0) {
                    $targetSize = 400; // フォールバック値
                }

                // 画像情報を取得して最適な処理方法を選択するルン（オーバーヘッドはほぼゼロ！）
                $imageInfo = @getimagesizefromstring($imageData);
                $shouldUseThumbnailBuffer = false;

                if ($imageInfo !== false) {
                    $imgWidth = $imageInfo[0];
                    $imgHeight = $imageInfo[1];
                    $mimeType = $imageInfo['mime'];
                    $maxDimension = max($imgWidth, $imgHeight);

                    // JPEG/WebP かつ 3000px以上の大きい画像の場合のみthumbnail_buffer()を使用するルン
                    $shouldUseThumbnailBuffer = (
                        ($mimeType === 'image/jpeg' || $mimeType === 'image/webp') &&
                        $maxDimension >= 3000
                    );

                    writelog("DEBUG: Cover image analysis - format:$mimeType size:{$imgWidth}x{$imgHeight} max:$maxDimension use_thumbnail_buffer:" . ($shouldUseThumbnailBuffer ? 'YES' : 'NO'), $writelog_process_name);
                } else {
                    writelog("WARNING: Could not get cover image info, using thumbnail_buffer() as fallback", $writelog_process_name);
                    $shouldUseThumbnailBuffer = true;
                }

                // 画像特性に応じた最適な処理方法を選択するルン！
                if ($shouldUseThumbnailBuffer) {
                    // 大きいJPEG/WebP: thumbnail_buffer()でshrink-on-load（高速！）
                    $image = \Jcupitt\Vips\Image::thumbnail_buffer($imageData, $targetSize, [
                        'height' => $targetSize,
                        'size' => 'down'
                    ]);
                    writelog("DEBUG: Cover used thumbnail_buffer() (shrink-on-load)", $writelog_process_name);
                } else {
                    // AVIF/小さい画像: 従来のnewFromBuffer() + resize()（高速！）
                    $image = \Jcupitt\Vips\Image::newFromBuffer($imageData);
                    $scale = $targetSize / max($image->width, $image->height);
                    if ($scale < 1) {
                        $image = $image->resize($scale, ['kernel' => 'lanczos3']);
                    }
                    writelog("DEBUG: Cover used newFromBuffer() + resize()", $writelog_process_name);
                }
                unset($imageData);

                writelog("DEBUG: Cover image resized - targetSize:$targetSize final size:" . $image->width . "x" . $image->height, $writelog_process_name);

                // JPEG形式で保存（strip=メタデータ削除）
                $image->jpegsave($coverFile, ['Q' => intval($conf["quality"]), 'strip' => true]);

                writelog("DEBUG: Cover image successfully processed with libvips", $writelog_process_name);
            } catch (\Jcupitt\Vips\Exception $e) {
                writelog("ERROR: Failed to convert cover image with libvips: " . $e->getMessage(), $writelog_process_name);
                writelog("DEBUG: Falling back to ImageMagick", $writelog_process_name);

                // フォールバック：ImageMagick
                // オヨ！ファイル名にバッククォートや特殊文字が含まれる場合があるからescapeshellarg()でエスケープするルン！
                $escapedCoverFile = escapeshellarg($coverFile);
                $cmd = $pageOutCmd . " | $convert - $usm -strip -resize $resize -quality " . $conf["quality"] . " -format jpeg jpeg:- > $escapedCoverFile";
                exec($cmd, $output, $return_var);

                if ($return_var !== 0) {
                    writelog('ERROR exec failed. Command: ' . $cmd . ' Return code: ' . $return_var, $writelog_process_name);
                    exit(1);
                }
            } catch (Exception $e) {
                writelog("ERROR: Failed to process cover image: " . $e->getMessage(), $writelog_process_name);
                writelog("DEBUG: Falling back to ImageMagick", $writelog_process_name);

                // フォールバック：ImageMagick
                // オヨ！ファイル名にバッククォートや特殊文字が含まれる場合があるからescapeshellarg()でエスケープするルン！
                $escapedCoverFile = escapeshellarg($coverFile);
                $cmd = $pageOutCmd . " | $convert - $usm -strip -resize $resize -quality " . $conf["quality"] . " -format jpeg jpeg:- > $escapedCoverFile";
                exec($cmd, $output, $return_var);

                if ($return_var !== 0) {
                    writelog('ERROR exec failed. Command: ' . $cmd . ' Return code: ' . $return_var, $writelog_process_name);
                    exit(1);
                }
            }
        } else {
            // ImageMagickを使用
            // オヨ！ファイル名にバッククォートや特殊文字が含まれる場合があるからescapeshellarg()でエスケープするルン！
            $escapedCoverFile = escapeshellarg($coverFile);
            $cmd = $pageOutCmd . " | $convert - $usm -strip -resize $resize -quality " . $conf["quality"] . " -format jpeg jpeg:- > $escapedCoverFile";
            exec($cmd, $output, $return_var);

            if ($return_var !== 0) {
                writelog('ERROR exec failed. Command: ' . $cmd . ' Return code: ' . $return_var, $writelog_process_name);
                exit(1);
            }
        }

        // 表紙ファイルのサイズを確認
        if (!file_exists($coverFile) || filesize($coverFile) === 0) {
            writelog('WARNING Cover file is empty, deleting: ' . $coverFile, $writelog_process_name);
            if (file_exists($coverFile)) {
                unlink($coverFile);
            }
        } else {
            writelog('DEBUG Cover file successfully created. Size: ' . filesize($coverFile) . ' bytes', $writelog_process_name);
        }
        unset($image);
    } elseif ($type == 'preview') {

        create_preview_dir($previewFile);
        $page = 1;
        $count = 1;

        $shmDir = create_shm_dir();
        while ($count <= 12 && $page <= $maxPage) {

            // ページの静止画作成 / 12ページ
            $outputFileBasename = sprintf("%03d", $count);
            $pageOutCmd = outputPage(true);
            writelog("DEBUG --- while start $type page:$page count:$count outputPage() returned:" . $pageOutCmd, $writelog_process_name);

            $outputFile = "$shmDir/" . $outputFileBasename . ".png";
            $imageProcessed = false;

            // libvipsで取得する画像サイズの初期化（libvipsが使われない場合のnotice回避）ルン
            $vipsImageWidth = 0;
            $vipsImageHeight = 0;

            // libvipsが利用可能なら高速処理を使用
            if ($isVipsAvailable) {
                writelog("DEBUG: Using libvips for preview image processing (page $page)", $writelog_process_name);

                try {
                    // outputPageのコマンドを実行して画像データを取得するルン
                    $imageData = shell_exec($pageOutCmd);

                    if ($imageData === null || strlen($imageData) === 0) {
                        throw new Exception("Failed to get image data from outputPage command");
                    }

                    // リサイズ処理のターゲットサイズを計算するルン（ImageMagick形式の'x400'から数値を抽出）
                    $targetSize = intval(preg_replace('/[^0-9]/', '', $global_resize));
                    if ($targetSize <= 0) {
                        $targetSize = 400; // フォールバック値ルン
                    }

                    // 画像情報を取得して最適な処理方法を選択するルン（オーバーヘッドはほぼゼロ！）
                    $imageInfo = @getimagesizefromstring($imageData);
                    $shouldUseThumbnailBuffer = false;

                    if ($imageInfo !== false) {
                        $imgWidth = $imageInfo[0];
                        $imgHeight = $imageInfo[1];
                        $mimeType = $imageInfo['mime'];
                        $maxDimension = max($imgWidth, $imgHeight);

                        // JPEG/WebP かつ 3000px以上の大きい画像の場合のみthumbnail_buffer()を使用するルン
                        // それ以外（AVIF、小さい画像など）は従来のnewFromBuffer() + resize()の方が速いルン！
                        $shouldUseThumbnailBuffer = (
                            ($mimeType === 'image/jpeg' || $mimeType === 'image/webp') &&
                            $maxDimension >= 3000
                        );

                        writelog("DEBUG: Image analysis - format:$mimeType size:{$imgWidth}x{$imgHeight} max:$maxDimension use_thumbnail_buffer:" . ($shouldUseThumbnailBuffer ? 'YES' : 'NO'), $writelog_process_name);
                    } else {
                        writelog("WARNING: Could not get image info, using thumbnail_buffer() as fallback", $writelog_process_name);
                        $shouldUseThumbnailBuffer = true; // 情報取得失敗時はthumbnail_buffer()を使うルン
                    }

                    // 画像特性に応じた最適な処理方法を選択するルン！
                    if ($shouldUseThumbnailBuffer) {
                        // 大きいJPEG/WebP: thumbnail_buffer()でshrink-on-load（高速！）
                        $image = \Jcupitt\Vips\Image::thumbnail_buffer($imageData, $targetSize, [
                            'height' => $targetSize,
                            'size' => 'down'
                        ]);
                        writelog("DEBUG: Used thumbnail_buffer() (shrink-on-load)", $writelog_process_name);
                    } else {
                        // AVIF/小さい画像: 従来のnewFromBuffer() + resize()（高速！）
                        $image = \Jcupitt\Vips\Image::newFromBuffer($imageData);
                        $scale = $targetSize / max($image->width, $image->height);
                        if ($scale < 1) {
                            $image = $image->resize($scale, ['kernel' => 'lanczos3']);
                        }
                        writelog("DEBUG: Used newFromBuffer() + resize()", $writelog_process_name);
                    }
                    unset($imageData);

                    // トリミング処理（libvipsでは自動トリミング機能がないためスキップするルン）
                    // writelog("DEBUG: Trimming skipped when using libvips (not supported)", $writelog_process_name);

                    // 画像の縦横サイズ情報を取得するルン
                    $vipsImageWidth = $image->width;
                    $vipsImageHeight = $image->height;
                    writelog("DEBUG: Image dimensions after processing - width: $vipsImageWidth, height: $vipsImageHeight (target: $targetSize)", $writelog_process_name);

                    // PNG形式で保存（strip=メタデータ削除）するルン
                    $image->pngsave($outputFile, ['strip' => true]);

                    $imageProcessed = true;
                    writelog("DEBUG: Preview image successfully processed with libvips", $writelog_process_name);
                } catch (\Jcupitt\Vips\Exception $e) {
                    writelog("ERROR: Failed to convert preview image with libvips: " . $e->getMessage(), $writelog_process_name);
                    writelog("DEBUG: Falling back to ImageMagick", $writelog_process_name);
                } catch (Exception $e) {
                    writelog("ERROR: Failed to process preview image: " . $e->getMessage(), $writelog_process_name);
                    writelog("DEBUG: Falling back to ImageMagick", $writelog_process_name);
                }
            }

            // libvipsで処理できなかった場合はImageMagickを使用
            if (!$imageProcessed) {
                // トリミング設定に応じてコマンドを構築するルン
                $trimOption = "";
                if (!isset($options['trimming']) || $options['trimming'] != 2) {
                    // トリミングが有効な場合のみ -fuzz 10% -trim +repage を追加するルン
                    $trimOption = " -fuzz 10% -trim +repage";
                }
                // オヨ！念のためescapeshellarg()でエスケープするルン！
                $escapedOutputFile = escapeshellarg($outputFile);
                $cmd = $pageOutCmd . " | $convert -" . $trimOption . " -format png -resize $global_resize -quality $quality $escapedOutputFile";
                exec($cmd, $output, $return_var);

                if ($return_var !== 0) {
                    writelog('WARNING exec failed. Command: ' . $cmd . ' Return code: ' . $return_var, $writelog_process_name);
                    // exit(1);
                } else {
                    $imageProcessed = true;
                }
            }

            // 処理結果を確認
            if ($imageProcessed && file_exists($outputFile)) {
                $fileBytes = filesize($outputFile);
                if ($fileBytes > 0) {
                    // 画像ファイルが作成された場合
                    writelog('DEBUG exec succeeded. fileBytes:' . $fileBytes, $writelog_process_name);
                    if ($page > 1) {
                        // # 2p目以降は帯とかロゴとかそーゆーので横長になってたらそのページ飛ばす

                        // アスペクト比計算
                        if (($vipsImageWidth > 10) && ($vipsImageHeight > 10)) {
                            $image_aspect_ratio = $vipsImageWidth / $vipsImageHeight;
                            writelog("DEBUG: vipsImageWidth:$vipsImageWidth vipsImageHeight:$vipsImageHeight image_aspect_ratio:$image_aspect_ratio", $writelog_process_name);
                            $vipsImageWidth = 0;
                            $vipsImageHeight = 0;
                        } else {
                            $image_aspect_ratio = get_image_aspect_ratio($outputFile);
                            writelog("DEBUG: get_image_aspect_ratio:$image_aspect_ratio", $writelog_process_name);
                        }
                        // 横長比率が2.1倍超えてたらその画像は使わない
                        if ($image_aspect_ratio > 2.1) {
                            writelog("WARNING re generate file.", $writelog_process_name);
                            if (file_exists($outputFile)) {
                                unlink($outputFile);
                                $count--;
                            }
                        } else {
                            writelog("DEBUG image_aspect_ratio:$image_aspect_ratio", $writelog_process_name);
                        }
                    }
                } else {
                    // 画像ファイルが0バイトの場合
                    writelog('WARNING preview image file is empty. fileBytes:' . $fileBytes, $writelog_process_name);
                    unlink($outputFile);
                    if ($count > 1) {
                        $count--;
                    }
                }
            } else {
                writelog('WARNING preview image processing failed completely', $writelog_process_name);
                if ($count > 1) {
                    $count--;
                }
            }
            // 通常はpageとcountを++
            // 帯とかでページをスキップした場合はpageだけ++
            $page++;
            $count++;
            // メモリ解放
            unset($image);
        }
        // $concatCmd = "LANG=ja_JP.UTF8 nice $montage -background '#000000' -geometry +3+3 $shmDir/004.png $shmDir/003.png $shmDir/002.png $shmDir/001.png $shmDir/008.png $shmDir/007.png $shmDir/006.png $shmDir/005.png $shmDir/012.png $shmDir/011.png $shmDir/010.png $shmDir/009.png -tile 4x3 - | $convert - -quality $quality -define webp:lossless=false \"$previewFile\"";
        // 一時ファイルに出力するルン！バイナリデータはexec()の$outputに入らないルンから！
        $tmpMergedPng = "$shmDir/__previde.png";

        // 実際に存在するプレビューファイルのリストを作成するルン！ページ数が12未満でも対応するルン！
        // montageで正しく表示するために 4,3,2,1 / 8,7,6,5 / 12,11,10,9 の順に並べるルン！
        $previewFiles = [];
        $targetOrder = [4, 3, 2, 1, 8, 7, 6, 5, 12, 11, 10, 9];
        foreach ($targetOrder as $i) {
            $filename = sprintf("%03d.png", $i);
            $filepath = "$shmDir/$filename";
            if (file_exists($filepath)) {
                $previewFiles[] = $filepath;
            }
        }

        // 存在するファイルがない場合はエラーで終了するルン
        if (empty($previewFiles)) {
            writelog('ERROR No preview images were created', $writelog_process_name);
            clean_shm_dir();
            exit(1);
        }

        // montageコマンドを構築（実際に存在するファイルだけを使うルン）
        $fileList = implode(' ', $previewFiles);
        $actualFileCount = count($previewFiles);
        writelog("DEBUG Created $actualFileCount preview images for montage", $writelog_process_name);

        // 標準エラー出力もキャプチャするために 2>&1 を追加するルン
        $concatCmd = "LANG=ja_JP.UTF8 nice $montage -background '#000000' -geometry +3+3 $fileList -tile 4x3 $tmpMergedPng 2>&1";
        writelog("DEBUG concatCmd:$concatCmd", $writelog_process_name);

        // パフォーマンス計測開始ルン！
        $perfStartTime = microtime(true);

        exec($concatCmd, $output, $return_var);

        // montageコマンドの出力をログに記録するルン
        if (!empty($output)) {
            writelog('DEBUG montage output: ' . implode("\n", $output), $writelog_process_name);
        }

        if ($return_var !== 0) {
            writelog('ERROR exec failed. Command: ' . $concatCmd . ' Return code: ' . $return_var, $writelog_process_name);
            clean_shm_dir();
            exit(1);
        }

        // ファイルが実際に作成されたかチェックするルン
        if (!file_exists($tmpMergedPng)) {
            writelog('ERROR montage did not create output file. Command: ' . $concatCmd . ' Return code: ' . $return_var, $writelog_process_name);
            clean_shm_dir();
            exit(1);
        }

        $tmpFileSize = filesize($tmpMergedPng);
        writelog("DEBUG tmpMergedPng created. Size: $tmpFileSize bytes", $writelog_process_name);

        try {
            // 一時ファイルから画像を読み込むルン
            $image = \Jcupitt\Vips\Image::newFromFile($tmpMergedPng);
            unset($output);
            // Convert to WebP with quality settings using libvips
            $image->webpsave($previewFile, [
                'Q' => $quality,
                'lossless' => false
            ]);
            unset($image);

            // webpsave()が完了してから一時ファイルを削除するルン（遅延読み込み対策）
            unlink($tmpMergedPng);

            $fileBytes = filesize($previewFile);
            if ($fileBytes === 0) {
                writelog('WARNING Preview file ' . $previewFile . ' is empty, deleting: ' . $previewFile, $writelog_process_name);
                unlink($previewFile);
            } else {
                writelog('DEBUG montage exec succeeded. fileBytes:' . $fileBytes, $writelog_process_name);
            }
        } catch (\Jcupitt\Vips\Exception $e) {
            writelog("ERROR: Failed to process preview image with libvips: " . $e->getMessage(), $writelog_process_name);
            // 一時ファイルが残ってたら削除するルン
            if (file_exists($tmpMergedPng)) {
                unlink($tmpMergedPng);
            }
        } catch (Exception $e) {
            writelog("ERROR: Failed to process preview image: " . $e->getMessage(), $writelog_process_name);
            // 一時ファイルが残ってたら削除するルン
            if (file_exists($tmpMergedPng)) {
                unlink($tmpMergedPng);
            }
        }

        // パフォーマンス計測終了ルン！
        $perfEndTime = microtime(true);
        $perfElapsedMs = round(($perfEndTime - $perfStartTime) * 1000, 2);
        writelog("DEBUG: Preview montage and conversion took {$perfElapsedMs}ms", $writelog_process_name);
    } else {
        writelog("DEBUG type:" . $type, $writelog_process_name);
    }
    // nested archive展開したキャッシュがあったら消す
    $nestedExtractDir = $conf["cacheDir"] . '/make_picture/' . $file;
    if (is_dir($nestedExtractDir)) {
        writelog("DEBUG rm $nestedExtractDir", $writelog_process_name);
        deleteDirectory($conf["cacheDir"] . '/make_picture/' . $file);
    } else {
        writelog("DEBUG no nestedExtractDir:" . $nestedExtractDir, $writelog_process_name);
    }
    clean_shm_dir();
    exit(0);
}


function create_cover_dir($coverFile)
{
    global $writelog_process_name;
    writelog("DEBUG create_cover_dir() coverFile:$coverFile", $writelog_process_name);
    $coverFileDir = dirname($coverFile);

    if (!chkAndMakeDir($coverFileDir)) {
        exit(1);
    }
}

function create_preview_dir($previewFile)
{
    global $writelog_process_name;
    writelog("DEBUG create_preview_dir() previewFile:$previewFile", $writelog_process_name);
    $previewFileDir = dirname($previewFile);

    if (!chkAndMakeDir($previewFileDir)) {
        exit(1);
    }
}

function create_shm_dir()
{
    global $writelog_process_name, $conf, $type;
    $shmDir = $conf["comistream_tmp_dir_root"] . '/make_picture/' . $type . '/' . getmypid();

    if (!chkAndMakeDir($shmDir)) {
        exit(1);
    }
    return $shmDir;
}

/**
 * SVGファイルから画像パスを抽出するルン
 * xlink:href属性を持つimage要素を探して、画像ファイルのパスを返すルン
 *
 * @param string $svgContent SVGファイルの内容
 * @param string $svgDir SVGファイルが存在するディレクトリ（相対パス解決用）
 * @return string|null 画像ファイルのパス（相対パス）、見つからない場合はnull
 */
function extractImageFromSvg($svgContent, $svgDir = '')
{
    global $writelog_process_name;

    writelog("DEBUG [EPUB-COVER] extractImageFromSvg() 開始", $writelog_process_name);
    writelog("DEBUG [EPUB-COVER] SVGコンテンツ長（処理前）: " . strlen($svgContent) . " bytes", $writelog_process_name);
    writelog("DEBUG [EPUB-COVER] svgDir引数: '$svgDir'", $writelog_process_name);

    // SVGファイルの末尾にゴミデータがある場合があるので、</svg>タグまでで切り取るルン
    $svgEndPos = strpos($svgContent, '</svg>');
    if ($svgEndPos !== false) {
        $svgContent = substr($svgContent, 0, $svgEndPos + 6); // '</svg>'の長さは6
        writelog("DEBUG [EPUB-COVER] SVGコンテンツ長（クリーンアップ後）: " . strlen($svgContent) . " bytes", $writelog_process_name);
    } else {
        writelog("WARNING [EPUB-COVER] </svg>タグが見つかりません", $writelog_process_name);
    }

    // SVGをパースするルン
    // XMLパースエラーを抑制して処理
    libxml_use_internal_errors(true);
    $svg = simplexml_load_string($svgContent);

    if ($svg === false) {
        $errors = libxml_get_errors();
        $errorMessages = [];
        foreach ($errors as $error) {
            $errorMessages[] = trim($error->message);
        }
        writelog("WARNING [EPUB-COVER] SVGパース失敗。エラー: " . implode("; ", $errorMessages), $writelog_process_name);
        libxml_clear_errors();

        // フォールバック：正規表現でxlink:hrefを直接抽出するルン
        writelog("DEBUG [EPUB-COVER] フォールバック: 正規表現でxlink:href抽出を試行", $writelog_process_name);
        if (preg_match('/xlink:href\s*=\s*["\']([^"\']+)["\']/', $svgContent, $matches)) {
            $imagePath = $matches[1];
            writelog("DEBUG [EPUB-COVER] 正規表現でxlink:href発見: '$imagePath'", $writelog_process_name);
            // 相対パスを解決するルン
            if (!empty($svgDir) && $svgDir !== '.' && !preg_match('/^(https?:|\/)/i', $imagePath)) {
                $imagePath = $svgDir . '/' . $imagePath;
            }
            writelog("DEBUG [EPUB-COVER] >>> 正規表現による最終結果: '$imagePath'", $writelog_process_name);
            return $imagePath;
        }
        writelog("WARNING [EPUB-COVER] 正規表現でもxlink:hrefが見つかりませんでした", $writelog_process_name);
        return null;
    }
    writelog("DEBUG [EPUB-COVER] SVGパース成功", $writelog_process_name);

    // xlink名前空間を登録するルン
    $svg->registerXPathNamespace('xlink', 'http://www.w3.org/1999/xlink');
    $svg->registerXPathNamespace('svg', 'http://www.w3.org/2000/svg');

    // SVG内の名前空間を確認
    $namespaces = $svg->getNamespaces(true);
    writelog("DEBUG [EPUB-COVER] SVG内の名前空間: " . json_encode($namespaces), $writelog_process_name);

    // image要素のxlink:href属性を探すルン
    writelog("DEBUG [EPUB-COVER] XPath検索1: '//image/@xlink:href | //svg:image/@xlink:href'", $writelog_process_name);
    $images = $svg->xpath('//image/@xlink:href | //svg:image/@xlink:href');
    writelog("DEBUG [EPUB-COVER] XPath検索1結果: " . count($images) . "件", $writelog_process_name);

    // image要素が見つからなかった場合、直接image要素を探すルン
    if (empty($images)) {
        writelog("DEBUG [EPUB-COVER] XPath検索2: '//image' (直接image要素を探索)", $writelog_process_name);
        $images = $svg->xpath('//image');
        writelog("DEBUG [EPUB-COVER] XPath検索2結果: " . count($images) . "件", $writelog_process_name);

        if (!empty($images)) {
            $elementNamespaces = $images[0]->getNamespaces(true);
            writelog("DEBUG [EPUB-COVER] image要素の名前空間: " . json_encode($elementNamespaces), $writelog_process_name);

            if (isset($elementNamespaces['xlink'])) {
                $xlinkAttrs = $images[0]->attributes($elementNamespaces['xlink']);
                writelog("DEBUG [EPUB-COVER] xlink属性: " . json_encode((array)$xlinkAttrs), $writelog_process_name);

                if (isset($xlinkAttrs['href'])) {
                    $imagePath = (string)$xlinkAttrs['href'];
                    writelog("DEBUG [EPUB-COVER] xlink:href発見（生の値）: '$imagePath'", $writelog_process_name);

                    // 相対パスを解決するルン
                    if (!empty($svgDir) && $svgDir !== '.' && !preg_match('/^(https?:|\/)/i', $imagePath)) {
                        $originalPath = $imagePath;
                        $imagePath = $svgDir . '/' . $imagePath;
                        writelog("DEBUG [EPUB-COVER] 相対パス解決: '$originalPath' -> '$imagePath'", $writelog_process_name);
                    }
                    writelog("DEBUG extractImageFromSvg: found image path: $imagePath", $writelog_process_name);
                    return $imagePath;
                } else {
                    writelog("WARNING [EPUB-COVER] xlink:href属性が見つかりません", $writelog_process_name);
                }
            } else {
                writelog("WARNING [EPUB-COVER] xlink名前空間が見つかりません", $writelog_process_name);
            }
        }
    }

    if (!empty($images)) {
        $imagePath = (string)$images[0];
        writelog("DEBUG [EPUB-COVER] XPath結果から画像パス取得（生の値）: '$imagePath'", $writelog_process_name);

        // 相対パスを解決するルン
        if (!empty($svgDir) && $svgDir !== '.' && !preg_match('/^(https?:|\/)/i', $imagePath)) {
            $originalPath = $imagePath;
            $imagePath = $svgDir . '/' . $imagePath;
            writelog("DEBUG [EPUB-COVER] 相対パス解決: '$originalPath' -> '$imagePath'", $writelog_process_name);
        }
        writelog("DEBUG extractImageFromSvg: found image path: $imagePath", $writelog_process_name);
        return $imagePath;
    }

    writelog("DEBUG extractImageFromSvg: no image found in SVG", $writelog_process_name);
    writelog("WARNING [EPUB-COVER] SVG内に画像参照が見つかりませんでした", $writelog_process_name);
    return null;
}

/**
 * 規格外EPUBで表紙が見つからない場合のフォールバック検索ルン
 * 展開ディレクトリ内から *cover* パターンの画像ファイルを探すルン
 *
 * @param string $epubTempDir EPUBを展開したディレクトリ
 * @return string|null 見つかった画像ファイルのフルパス、見つからない場合はnull
 */
function findFallbackCoverImage($epubTempDir)
{
    global $writelog_process_name;

    $imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
    $coverCandidates = [];

    // 再帰的にディレクトリを検索するルン
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($epubTempDir, RecursiveDirectoryIterator::SKIP_DOTS),
        RecursiveIteratorIterator::SELF_FIRST
    );

    foreach ($iterator as $file) {
        if (!$file->isFile()) {
            continue;
        }

        $filename = $file->getFilename();
        $extension = strtolower($file->getExtension());

        // 画像ファイルのみを対象にするルン
        if (!in_array($extension, $imageExtensions)) {
            continue;
        }

        $filenameLower = strtolower($filename);
        $filepath = $file->getPathname();
        $filesize = $file->getSize();

        // "cover" を含むファイル名を優先候補にするルン
        if (strpos($filenameLower, 'cover') !== false) {
            // 優先度を付けて追加（ファイルサイズも考慮）
            $priority = 100;

            // ファイル名が "cover" で始まる場合はさらに優先
            if (strpos($filenameLower, 'cover') === 0) {
                $priority += 50;
            }

            // "_cover" や "-cover" のようなパターンも高優先度
            if (preg_match('/[_\-]cover/i', $filenameLower)) {
                $priority += 30;
            }

            // ファイルサイズが大きい方を優先（表紙画像は通常それなりのサイズがあるルン）
            // 10KB以上のファイルにボーナス
            if ($filesize > 10240) {
                $priority += 20;
            }
            // 100KB以上ならさらにボーナス
            if ($filesize > 102400) {
                $priority += 10;
            }

            $coverCandidates[] = [
                'path' => $filepath,
                'filename' => $filename,
                'priority' => $priority,
                'size' => $filesize
            ];

            writelog("DEBUG [EPUB-COVER] フォールバック候補: $filename (優先度:$priority, サイズ:{$filesize}bytes)", $writelog_process_name);
        }
    }

    // 候補が見つからなかった場合
    if (empty($coverCandidates)) {
        writelog("DEBUG [EPUB-COVER] フォールバック: *cover*パターンの画像が見つかりませんでした", $writelog_process_name);
        return null;
    }

    // 優先度でソート（高い順）、同じ優先度ならファイルサイズが大きい順
    usort($coverCandidates, function($a, $b) {
        if ($a['priority'] !== $b['priority']) {
            return $b['priority'] - $a['priority'];
        }
        return $b['size'] - $a['size'];
    });

    $bestCandidate = $coverCandidates[0];
    writelog("DEBUG [EPUB-COVER] フォールバック: 最有力候補を選択: " . $bestCandidate['filename'] .
             " (優先度:" . $bestCandidate['priority'] . ", サイズ:" . $bestCandidate['size'] . "bytes)", $writelog_process_name);

    return $bestCandidate['path'];
}
