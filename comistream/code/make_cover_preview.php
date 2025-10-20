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
 * @license     GPL3.0 License
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
$ext = pathinfo($file, PATHINFO_EXTENSION);
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
    $cmd = $p7zip . " x -o\"$epubTempDir\" \"$fullpathFile\"";
    exec($cmd, $output, $return_var);

    if ($return_var !== 0) {
        writelog("ERROR: Failed to extract EPUB file: $cmd", $writelog_process_name);
        deleteDirectory($epubTempDir);
        clean_shm_dir();
        exit(1);
    }
    if ($type == 'covers') {
        writelog("DEBUG type covers", $writelog_process_name);
        // EPUBファイルの処理
        writelog("DEBUG fullpathFile:$fullpathFile", $writelog_process_name);


        // container.xmlファイルを探す
        $containerXml = file_get_contents("$epubTempDir/META-INF/container.xml");
        if ($containerXml === false) {
            writelog("ERROR: container.xml not found in EPUB file: $file", $writelog_process_name);
            deleteDirectory($epubTempDir);
            clean_shm_dir();
            exit(1);
        }

        // content.opfファイルのパスを取得
        $xml = new SimpleXMLElement($containerXml);
        $contentOpfPath = $xml->rootfiles->rootfile['full-path'];

        // content.opfファイルの内容を取得
        $contentOpf = file_get_contents("$epubTempDir/$contentOpfPath");
        $contentXml = new SimpleXMLElement($contentOpf);

        // 表紙画像のファイル名を探す
        $coverFileName = null;
        foreach ($contentXml->manifest->item as $item) {
            if ((string)$item['id'] === 'cover' || (string)$item['properties'] === 'cover-image') {
                $coverFileName = (string)$item['href'];
                writelog("DEBUG coverFileName:$coverFileName", $writelog_process_name);
                break;
            }
        }

        // 表紙画像が見つからない場合、または.xhtmlファイルだった場合の処理
        if ($coverFileName === null || pathinfo($coverFileName, PATHINFO_EXTENSION) === 'xhtml') {
            foreach ($contentXml->manifest->item as $item) {
                if (in_array(pathinfo((string)$item['href'], PATHINFO_EXTENSION), ['jpg', 'jpeg', 'png', 'gif'])) {
                    $coverFileName = (string)$item['href'];
                    writelog("DEBUG coverFileName (from manifest):$coverFileName", $writelog_process_name);
                    break;
                }
            }

            // .xhtmlファイルの場合、中身を解析して画像ファイルを探す
            if (pathinfo($coverFileName, PATHINFO_EXTENSION) === 'xhtml') {
                $xhtmlContent = file_get_contents("$epubTempDir/$contentOpfDir/$coverFileName");
                $xhtmlXml = new SimpleXMLElement($xhtmlContent);
                $xhtmlXml->registerXPathNamespace('xlink', 'http://www.w3.org/1999/xlink');
                $images = $xhtmlXml->xpath('//image[@xlink:href]');
                if (!empty($images)) {
                    $coverFileName = (string)$images[0]['xlink:href'];
                    writelog("DEBUG coverFileName (from xhtml):$coverFileName", $writelog_process_name);
                }
            }
        }

        if ($coverFileName === null) {
            writelog("ERROR: Cover image not found in EPUB file: $file", $writelog_process_name);
            deleteDirectory($epubTempDir);
            clean_shm_dir();
            exit(1);
        }

        // 相対パスの場合、content.opfファイルのディレクトリを基準にする
        $contentOpfDir = dirname($contentOpfPath);
        $coverFilePath = realpath("$epubTempDir/$contentOpfDir/$coverFileName");

        if ($coverFilePath === false || !file_exists($coverFilePath)) {
            writelog("ERROR: Cover image file not found: $coverFilePath", $writelog_process_name);
            deleteDirectory($epubTempDir);
            clean_shm_dir();
            exit(1);
        }

        // 作成ファイルのディレクトリを作成
        create_cover_dir($coverFile);

        // 画像を処理し、$coverFileに保存（libvips優先、フォールバック：ImageMagick）
        if ($isVipsAvailable) {
            writelog("DEBUG: Using libvips for cover image processing", $writelog_process_name);

            try {
                // 画像を読み込み
                $image = \Jcupitt\Vips\Image::newFromFile($coverFilePath);

                // リサイズ処理（ImageMagick形式の'x400'から数値を抽出）
                $targetSize = intval(preg_replace('/[^0-9]/', '', $resize));
                if ($targetSize <= 0) {
                    $targetSize = 400; // フォールバック値
                }
                $scale = $targetSize / max($image->width, $image->height);

                if ($scale < 1) {
                    $image = $image->resize($scale, ['kernel' => 'lanczos3']);
                    writelog("DEBUG: Cover image resized with scale: $scale", $writelog_process_name);
                }

                // JPEG形式で保存（strip=メタデータ削除）
                $image->jpegsave($coverFile, ['Q' => 80, 'strip' => true]);

                writelog("DEBUG: Cover image successfully processed with libvips", $writelog_process_name);
            } catch (\Jcupitt\Vips\Exception $e) {
                writelog("ERROR: Failed to convert cover image with libvips: " . $e->getMessage(), $writelog_process_name);
                writelog("DEBUG: Falling back to ImageMagick", $writelog_process_name);

                // フォールバック：ImageMagick
                $cmd = "$convert \"$coverFilePath\" $usm -strip -resize $resize -quality 80 -format jpeg jpeg:\"$coverFile\"";
                exec($cmd, $output, $return_var);

                if ($return_var !== 0) {
                    writelog("ERROR: Failed to convert cover image with ImageMagick: $cmd", $writelog_process_name);
                    deleteDirectory($epubTempDir);
                    clean_shm_dir();
                    exit(1);
                }
            }
        } else {
            // ImageMagickを使用して画像を処理し、$coverFileに保存
            $cmd = "$convert \"$coverFilePath\" $usm -strip -resize $resize -quality 80 -format jpeg jpeg:\"$coverFile\"";
            exec($cmd, $output, $return_var);

            if ($return_var !== 0) {
                writelog("ERROR: Failed to convert cover image: $cmd", $writelog_process_name);
                deleteDirectory($epubTempDir);
                clean_shm_dir();
                exit(1);
            }
        }

        // 一時ディレクトリを削除
        deleteDirectory($epubTempDir);
        clean_shm_dir();
    } else {
        // epubのpreview
        writelog("DEBUG type preview", $writelog_process_name);

        // 画像ファイルを探す
        $imageFiles = [];
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
                    // 画像を読み込み
                    $image = \Jcupitt\Vips\Image::newFromFile($imageFiles[$i]);

                    // リサイズ処理（ImageMagick形式の'x400'から数値を抽出）
                    $targetSize = intval(preg_replace('/[^0-9]/', '', $resize));
                    if ($targetSize <= 0) {
                        $targetSize = 400; // フォールバック値
                    }
                    $scale = $targetSize / max($image->width, $image->height);

                    if ($scale < 1) {
                        $image = $image->resize($scale, ['kernel' => 'lanczos3']);
                    }

                    // PNG形式で保存（strip=メタデータ削除）
                    $outputPath = "$shmDir/" . $outputFileBasename . ".png";
                    $image->pngsave($outputPath, ['strip' => true]);

                    writelog("DEBUG: Image $i successfully processed with libvips", $writelog_process_name);
                } catch (\Jcupitt\Vips\Exception $e) {
                    writelog("ERROR: Failed to convert image with libvips: " . $e->getMessage(), $writelog_process_name);
                    // フォールバック：ImageMagick
                    $cmd = "$convert \"" . $imageFiles[$i] . "\" $usm -strip -resize $resize -quality $quality -format png png:\"$shmDir/" . $outputFileBasename . ".png\"";
                    exec($cmd, $output, $return_var);

                    if ($return_var !== 0) {
                        writelog("ERROR: Failed to convert image with ImageMagick: $cmd", $writelog_process_name);
                    }
                }
            } else {
                // ImageMagickを使用
                $cmd = "$convert \"" . $imageFiles[$i] . "\" $usm -strip -resize $resize -quality $quality -format png png:\"$shmDir/" . $outputFileBasename . ".png\"";
                exec($cmd, $output, $return_var);

                if ($return_var !== 0) {
                    writelog("ERROR: Failed to convert image: $cmd", $writelog_process_name);
                }
            }
            unset($image);
        }

        // プレビュー画像を作成
        create_preview_dir($previewFile);
        $concatCmd = "LANG=ja_JP.UTF8 nice $montage -background '#000000' -geometry +3+3 $shmDir/004.png $shmDir/003.png $shmDir/002.png $shmDir/001.png $shmDir/008.png $shmDir/007.png $shmDir/006.png $shmDir/005.png $shmDir/012.png $shmDir/011.png $shmDir/010.png $shmDir/009.png -tile 4x3 - | $convert - -quality $quality -define webp:lossless=false \"$previewFile\"";
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
    // 画像は余白をトリミングするかどうかを--trimmingオプションで制御するルン
    if (isset($options['trimming']) && $options['trimming'] == 2) {
        $view = '';
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

                // libvipsで画像データを読み込み
                $image = \Jcupitt\Vips\Image::newFromBuffer($imageData);
                unset($imageData);
                // リサイズ処理（ImageMagick形式の'x400'から数値を抽出）
                $targetSize = intval(preg_replace('/[^0-9]/', '', $resize));
                if ($targetSize <= 0) {
                    $targetSize = 400; // フォールバック値
                }
                $scale = $targetSize / max($image->width, $image->height);

                if ($scale < 1) {
                    $image = $image->resize($scale, ['kernel' => 'lanczos3']);
                    writelog("DEBUG: Cover image resized with scale:$scale targetSize:" . $targetSize . " image->width:" . $image->width . " image->height:" . $image->height, $writelog_process_name);
                } else {
                    writelog("ERROR: Cover image not resized scale:$scale", $writelog_process_name);
                }

                // JPEG形式で保存（strip=メタデータ削除）
                $image->jpegsave($coverFile, ['Q' => intval($conf["quality"]), 'strip' => true]);

                writelog("DEBUG: Cover image successfully processed with libvips", $writelog_process_name);
            } catch (\Jcupitt\Vips\Exception $e) {
                writelog("ERROR: Failed to convert cover image with libvips: " . $e->getMessage(), $writelog_process_name);
                writelog("DEBUG: Falling back to ImageMagick", $writelog_process_name);

                // フォールバック：ImageMagick
                $cmd = $pageOutCmd . " | $convert - $usm -strip -resize $resize -quality " . $conf["quality"] . " -format jpeg jpeg:- > \"$coverFile\"";
                exec($cmd, $output, $return_var);

                if ($return_var !== 0) {
                    writelog('ERROR exec failed. Command: ' . $cmd . ' Return code: ' . $return_var, $writelog_process_name);
                    exit(1);
                }
            } catch (Exception $e) {
                writelog("ERROR: Failed to process cover image: " . $e->getMessage(), $writelog_process_name);
                writelog("DEBUG: Falling back to ImageMagick", $writelog_process_name);

                // フォールバック：ImageMagick
                $cmd = $pageOutCmd . " | $convert - $usm -strip -resize $resize -quality " . $conf["quality"] . " -format jpeg jpeg:- > \"$coverFile\"";
                exec($cmd, $output, $return_var);

                if ($return_var !== 0) {
                    writelog('ERROR exec failed. Command: ' . $cmd . ' Return code: ' . $return_var, $writelog_process_name);
                    exit(1);
                }
            }
        } else {
            // ImageMagickを使用
            $cmd = $pageOutCmd . " | $convert - $usm -strip -resize $resize -quality " . $conf["quality"] . " -format jpeg jpeg:- > \"$coverFile\"";
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
                    // outputPageのコマンドを実行して画像データを取得
                    $imageData = shell_exec($pageOutCmd);

                    if ($imageData === null || strlen($imageData) === 0) {
                        throw new Exception("Failed to get image data from outputPage command");
                    }

                    // libvipsで画像データを読み込み
                    $image = \Jcupitt\Vips\Image::newFromBuffer($imageData);
                    unset($imageData);

                    // トリミング処理（libvipsでは自動トリミング機能がないためスキップ）
                    // writelog("DEBUG: Trimming skipped when using libvips (not supported)", $writelog_process_name);

                    // リサイズ処理（ImageMagick形式の'x400'から数値を抽出）
                    $targetSize = intval(preg_replace('/[^0-9]/', '', $global_resize));
                    if ($targetSize <= 0) {
                        $targetSize = 400; // フォールバック値
                    }
                    $scale = $targetSize / max($image->width, $image->height);

                    if ($scale < 1) {
                        $image = $image->resize($scale, ['kernel' => 'lanczos3']);
                        writelog("DEBUG: Preview image resized with scale: $scale", $writelog_process_name);
                    }

                    // 画像の縦横サイズ情報を取得するルン
                    $vipsImageWidth = $image->width;
                    $vipsImageHeight = $image->height;
                    writelog("DEBUG: Image dimensions - width: $vipsImageWidth, height: $vipsImageHeight", $writelog_process_name);

                    // PNG形式で保存（strip=メタデータ削除）
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
                $cmd = $pageOutCmd . " | $convert -" . $trimOption . " -format png -resize $global_resize -quality $quality $outputFile";
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
        $previewFiles = [];
        for ($i = 1; $i <= 12; $i++) {
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
