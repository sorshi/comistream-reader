<?php

/**
 * Comistream Reader Library
 *
 * Comistreamの主要な機能を提供するライブラリファイル。
 * ファイル操作、画像処理、データベース処理などの
 * コア機能を実装しています。
 *
 * @package     sorshi/comistream-reader
 * @author      Comistream Project.
 * @copyright   2024 Comistream Project.
 * @license     GPL3.0 License
 * @version     1.0.1
 * @link        https://github.com/sorshi/comistream-reader
 */

//  DBを使うかどうか 0:つかわない/1:つかう
$global_use_db_flag = 1;

// デフォルト値のままなので明示的定義コメントアウト
// ini_set('session.gc_probability', 1);
// ini_set('session.gc_divisor', 1000);
// セッションの有効期限を31日に設定
ini_set('session.gc_maxlifetime', 2678400);
// セッションクッキーの有効期限を31日に設定
session_set_cookie_params(86400 * 31);

// 多言語化対応のためのファイルを読み込み
require_once(__DIR__ . '/i18n.php');

##### ヘッダデバッグ表示 ######################################################################
function debugRequestParams()
{

    // URLから直接クエリ文字列を取得
    $query_string = $_SERVER['QUERY_STRING'];
    writelog("DEBUG QUERY_STRING:" . $query_string);

    // $_GET変数の内容
    writelog("DEBUG _GET:" . print_r($_GET, true));

    // $_POST変数の内容
    writelog("DEBUG _POST:" .  print_r($_POST, true));

    // php://input から生のPOSTデータを取得
    $raw_post_data = file_get_contents('php://input');
    writelog("DEBUG raw_post_data:" . $raw_post_data);

    // $_REQUEST変数の内容（GET、POST、COOKIEの組み合わせ）
    writelog("DEBUG _REQUEST:" . print_r($_REQUEST, true));

    // HTTPヘッダー情報
    $headers = getallheaders();
    writelog("DEBUG headers:" . print_r($headers, true));

    // http method
    writelog("DEBUG method:" . $_SERVER['REQUEST_METHOD']);
} // end function debugRequestParams

##### Cookie取得 ######################################################################
function getCookie()
{
    $cookies = [];
    if (isset($_SERVER['HTTP_COOKIE'])) {
        $cookie_parts = explode(';', $_SERVER['HTTP_COOKIE']);
        foreach ($cookie_parts as $cookie_part) {
            $cookie_part = trim($cookie_part);
            list($name, $value) = explode('=', $cookie_part);
            $cookies[trim($name)] = trim($value);
        }
    }
    return $cookies;
} // end function getCookie


##### syslogにログ出力 ######################################################################
function writelog($messages, $processname = 'Comistream')
{
    global $writelog_process_name, $global_debug_flag;
    if (!empty($writelog_process_name)) {
        $processname = $writelog_process_name;
    }

    $messages = mb_convert_encoding($messages, 'UTF-8', 'auto');
    $messages = str_replace(array("\r\n", "\r", "\n"), ' ', $messages);
    openlog($processname, LOG_NDELAY, LOG_USER);
    $bt = debug_backtrace();
    $file = preg_replace('/\/.*?\/.*?\//', '', $bt[0]['file']);
    $line = $bt[0]['line'];
    // $func = $bt[0]['function'];
    $messages = $messages . " :FILE:" . $file . " LINE:" . $line;

    if (preg_match("/EMERG/", $messages)) {
        syslog(LOG_EMERG, $messages);
    } elseif (preg_match("/ALERT/", $messages)) {
        syslog(LOG_ALERT, $messages);
    } elseif (preg_match("/CRIT/", $messages)) {
        syslog(LOG_CRIT, $messages);
    } elseif (preg_match("/ERR/", $messages)) {
        syslog(LOG_ERR, $messages);
    } elseif (preg_match("/WARN/", $messages)) {
        syslog(LOG_WARNING, $messages);
    } elseif (preg_match("/NOTICE/", $messages)) {
        syslog(LOG_NOTICE, $messages);
    } elseif (preg_match("/INFO/", $messages)) {
        syslog(LOG_INFO, $messages);
    } else {
        if ($global_debug_flag) {
            syslog(LOG_DEBUG, $messages);
        }
    }
    closelog();
} //end function writelog

##### 任意のエラー画面を表示してスクリプトを終了する  ############################################################
function errorExit($title, $message, $isError = true)
{
    // I18nインスタンスを取得
    $i18n = I18n::getInstance();

    // エラー出力して終了
    if ($isError) {
        header("HTTP/1.1 404 Not Found");
        header("Cache-Control: no-store");
    } else {
        header("Cache-Control: no-store");
    }
    echo <<<EOF
<!DOCTYPE html>
<html lang="{$i18n->getCurrentLang()}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>$title</title>
    <script>alert("$message");window.history.back();</script>
</head>
<body></body>
</html>

EOF;

    if ($isError) {
        writelog("ERROR errorExit() $title; $message");
        exit(1);
    } else {
        writelog("INFO errorExit() but NORMAL EXIT $title; $message");
        exit;
    }
} //end function errorExit



##### ファイル削除 ######################################################################
function fileDelete()
{
    // 未使用関数

    # 未使用
    # $orgname =~ s/\.\.\///g;
    # $orgname =~ s/%([\da-fA-F][\da-fA-F])/pack("C",hex($1))/eg;

    # $baseDir = $ENV{'HTTP_REFERER'};
    # $baseDir =~ s/http.+?\/.+?(\/)/$1/;
    # $baseDir =~ s/$publicDir//;

    # print "Content-type: text/html\n\n";
    # print "{$sharePath}{$baseDir}";

    # exit 0;
} //end function fileDelete


##### ファイルリネーム ###################################################################
function fileRename()
{
    // 未使用関数
    # 未使用
} //end function fileRename


##### 表紙/プレビュー画像削除、更新 ###################################################################
function coverUpdate()
{
    global $conf;
    global $publicDir, $user, $file, $coverFile, $previewFile;

    if (($user !== "guest") && !empty($user) && (strlen($user) > 0) && !empty($file)) {
        // writelog("DEBUG coverUpdate() file:".$file);
        $file = preg_replace('/\.\.\//', '', $file);
        // 表紙画像のパスを作成
        $file = preg_replace('/^(.*)\..*$/', '$1', $file);
        $file = str_replace('+', '%2B', $file);
        $file = urldecode($file);
        // writelog("DEBUG coverUpdate() file:".$file);

        // $coverFile = "$sharePath/theme/covers/" . $file . ".jpg";
        // $previewFile = "$sharePath/theme/preview/" . $file . ".webp";
        $coverFile = $conf["comistream_tool_dir"] . '/data/theme/covers' . $publicDir . '/' . $file . ".jpg";
        $previewFile = $conf["comistream_tool_dir"] . '/data/theme/preview' . $publicDir . '/' . $file . ".webp";
        if (file_exists($coverFile)) {
            unlink($coverFile);
            writelog("INFO coverUpdate() cover deleted:$coverFile");
        } else {
            writelog("ERROR coverUpdate() cover not found:$coverFile");
        }

        if (file_exists($previewFile)) {
            unlink($previewFile);
            writelog("INFO coverUpdate() preview deleted:$previewFile");
        } else {
            writelog("ERROR coverUpdate() preview not found:$previewFile");
        }

        errorExit("Cover deleted.", "表紙画像とプレビュー画像を削除しました。", false);
    } else {
        writelog("INFO coverUpdate() guest user or no file: $user $file");
        errorExit("Cover update failed.", "権限が足りないかファイルが指定されていません。");
    }
} //end function coverUpdate


##### 書籍詳細表示へリダイレクト ###################################################################
function openBookDetail()
{
    global $file;

    // リダイレクト先のURLを指定
    $file = preg_replace('/\.\.\//', '', $file);
    $file = str_replace('+', '%2B', $file);
    $file = urldecode($file);

    $redirect_url = "/book_detail.php?file=" . urlencode($file);
    writelog("DEBUG Redirect: $redirect_url");

    // HTTPヘッダを出力
    header("Status: 302 Found");
    header("Location: $redirect_url");
    exit;
} //end function openBookDetail


##### お気に入り設定 ####################################################################
function setFavorite()
{
    global $user, $base_file_hash, $file, $bookmarkDir, $global_use_db_flag, $dbh, $mode;

    if ($user !== "guest") {
        $use_base_file_hash = 0;
        writelog("DEBUG setFavorite() REQUEST_URI:" . $_SERVER['REQUEST_URI']);

        if (strlen($base_file_hash) > 1) {
            // base_file_hash指定での更新
            $use_base_file_hash = 1;
            writelog("DEBUG setFavorite() use_base_file_hash mode $base_file_hash");
        } else {
            $use_base_file_hash = 0;
            $file = preg_replace('/\.\.\//', '', $file);
            $file = str_replace('+', '%2B', $file);
            $file = urldecode($file);
            $bookmarkPath = dirname("$bookmarkDir/$user/$file");
            $baseFile = basename($file);
            writelog("DEBUG setFavorite() filename mode $base_file_hash");
        }

        if ($global_use_db_flag == 1) {
            $favorite_flag = ($mode === "favON") ? 1 : 0;
            $has_read = ($favorite_flag === 1) ? 1 : 0;

            if ($use_base_file_hash == 1) {
                $query = "UPDATE book_history SET favorite = ? WHERE user = ? AND base_file_hash = ?";
                $sth = $dbh->prepare($query);
                $sth->execute([$favorite_flag, $user, $base_file_hash]);;
            } else {
                $base_file_utf = $baseFile;
                $base_file_hash = basefilename2hash($base_file_utf);
                if ($mode === "favON") {
                    // お気に入りONの場合は、既読もONにする
                    $query = "INSERT INTO book_history (user, base_file, base_file_hash, favorite, has_read) VALUES (?, ?, ?, 1, 1) ON CONFLICT(user, base_file) DO UPDATE SET favorite=excluded.favorite, has_read=excluded.has_read";
                    $sth = $dbh->prepare($query);
                    writelog("DEBUG setFavorite() user:$user base_file_utf:$base_file_utf  base_file_hash:$base_file_hash favorite_flag:$favorite_flag");
                    $sth->execute([$user, $base_file_utf, $base_file_hash]);
                    // DBのレコード更新のためにページを開いたことにする
                    openPage();
                } else {
                    $query = "INSERT INTO book_history (user, base_file, base_file_hash, favorite) VALUES (?, ?, ?, 0) ON CONFLICT(user, base_file) DO UPDATE SET favorite=excluded.favorite";
                    $sth = $dbh->prepare($query);
                    writelog("DEBUG setFavorite() user:$user base_file_utf:$base_file_utf  base_file_hash:$base_file_hash favorite_flag:$favorite_flag");
                    $sth->execute([$user, $base_file_utf, $base_file_hash]);
                }
            }
            if ($dbh->errorInfo()[2]) {
                writelog("ERROR setFavorite() SQL error: " . $dbh->errorInfo()[2] . " $query:$user, $base_file_hash, $favorite_flag");
            }
            writelog("DEBUG setFavorite() $user, $base_file_utf, $base_file_hash, $favorite_flag with DB");
        } else {
            $result = shell_exec("mkdir -p \"$bookmarkPath\"");

            // ブックマークファイル内のページ書き換え
            $result = shell_exec("grep -nF \"$baseFile\" \"$bookmarkPath/bookmark\"");
            $lineNo = trim($result) ? explode(':', trim($result))[0] : null;

            if ($lineNo) {
                // 末尾の \t* を一旦削除してから追加
                shell_exec("sed -i \"{$lineNo}s/\\t\\*\$//\" \"$bookmarkPath/bookmark\"");
                if ($mode === "favON") {
                    shell_exec("sed -i \"{$lineNo}s/\$/\\t\\*/\" \"$bookmarkPath/bookmark\"");
                }
            } else {
                if ($mode === "favON") {
                    shell_exec("echo -e \"$baseFile\t0\t0\t*\" >> \"$bookmarkPath/bookmark\"");
                } else {
                    shell_exec("echo -e \"$baseFile\t0\t0\" >> \"$bookmarkPath/bookmark\"");
                }
            }
        }
    }
    exit(0);
} //end function setFavorite


##### 既読したか設定 ####################################################################
function setHasRead()
{
    global $user, $base_file_hash, $file, $global_use_db_flag, $dbh, $mode, $bookmarkDir;

    if ($user !== "guest") {
        $use_base_file_hash = 0;

        if (strlen($base_file_hash) > 1) {
            // base_file_hash指定での更新
            $use_base_file_hash = 1;
            writelog("DEBUG setHasRead() use_base_file_hash mode $base_file_hash");
        } else {
            $use_base_file_hash = 0;
            $file = preg_replace('/\.\.\//', '', $file);
            $file = str_replace('+', '%2B', $file);
            $file = urldecode($file);

            $bookmarkPath = dirname("$bookmarkDir/$user/$file");
            $baseFile = basename($file);
            writelog("DEBUG setHasRead() filename mode $base_file_hash");
        }

        if ($global_use_db_flag == 1) {
            $hasRead_flag = ($mode === "readON") ? 1 : 0;

            if ($use_base_file_hash == 1) {
                $query = "UPDATE book_history SET has_read = ? WHERE user = ? AND base_file_hash = ?";
                $sth = $dbh->prepare($query);
                $sth->execute([$hasRead_flag, $user, $base_file_hash]);
            } else {
                $base_file_utf = $baseFile;
                $base_file_hash = basefilename2hash($base_file_utf);
                $query = "INSERT INTO book_history (user, base_file, base_file_hash, has_read) VALUES (?, ?, ?, ?) ON CONFLICT(user, base_file) DO UPDATE SET has_read=excluded.has_read";
                $sth = $dbh->prepare($query);
                $sth->execute([$user, $base_file_utf, $base_file_hash, $hasRead_flag]);
            }
            if ($dbh->errorInfo()[2]) {
                writelog("ERROR setHasRead() SQL error: " . $dbh->errorInfo()[2] . " $query:$user, $base_file_hash, $hasRead_flag");
            }
            writelog("DEBUG setHasRead() $user, $base_file_utf, $base_file_hash, $hasRead_flag with DB");
        } else {
            // TODO DB未使用環境未実装
        }
    }
    exit(0);
} //end function setHasRead


##### 読書履歴からファイル削除 ####################################################################
function delHistory()
{
    global $user, $global_use_db_flag, $dbh, $file;

    if ($user !== "guest") {
        writelog("DEBUG delHistory() file:" . $file);
        $file = str_replace('+', '%2B', $file);
        $file = preg_replace('/\.\.\//', '', $file);
        $file = str_replace('+', '%2B', $file);
        $file = urldecode($file);
        $baseFile = basename($file);

        if ($global_use_db_flag == 1) {
            $baseFileUtf = $baseFile;
            // $baseFileHash = basefilename2hash($baseFileUtf);
            $query = "DELETE FROM book_history WHERE user = ? AND base_file = ?";
            $stmt = $dbh->prepare($query);
            $stmt->execute([$user, $baseFileUtf]);

            if ($dbh->errorInfo()[2]) {
                writelog("ERROR delHistory() SQL error: " . $dbh->errorInfo()[2] . " query: $query");
            }
            writelog("DEBUG delHistory() $user, $baseFileUtf with DB");
        } else {
            // TODO 未実装
            writelog("ERROR delHistory() not implemented.");
        }
    }
    exit(0);
} //end function delHistory


##### 単独での現在のページ位置取得 ############################################################
function getCurrentPage()
{
    global $user, $file, $page, $sharePath;
    global $escapedFile;
    global $openFile;

    // デコード前ファイルパスを保存
    $escapedFile = preg_replace('/\.\.\//', '', $file);

    // ファイルパスを作成
    $file = str_replace('+', '%2B', $file);
    $file = urldecode($file);
    $openFile = "$sharePath/$file";
    getCurrentPageNumberFromBookmarkfile();

    if ($user !== "guest") {
        if ($page > 0) {
            echo "$page\n";
            writelog("DEBUG getCurrentPage() $user page:$page");
        } else {
            echo "0\n";
            writelog("DEBUG getCurrentPage() $user page:0");
        }
    } else {
        echo "0\n";
        writelog("DEBUG getCurrentPage() guest page:0");
    }
    exit(0);
} //end function getCurrentPage


##### bookmarkファイルから現在のページ位置を取得 #########################################
function getCurrentPageNumberFromBookmarkfile()
{
    global $sharePath, $global_use_db_flag,  $dbh, $page,  $user,  $bookmarkPath, $baseFile, $favorite, $openFile;

    // ブックマーク領域作成
    // DB未使用時のコードはコメントアウト
    $bookmarkPath = str_replace("$sharePath/", '', $openFile);
    // $bookmarkPath = dirname("$bookmarkDir/$user/$bookmarkPath");
    // if (!is_dir($bookmarkPath)) {
    //     if (mkdir($bookmarkPath, 0777, true)) {
    //         writelog("DEBUG getCurrentPageNumberFromBookmarkfile(); mkdir $bookmarkPath success.");
    //     } else {
    //         writelog("ERROR getCurrentPageNumberFromBookmarkfile(); mkdir $bookmarkPath failes.");
    //         errorExit('ディレクトリ作成に失敗しました', 'ディレクトリ作成に失敗しました。' . $bookmarkPath . "のパーミッションを確認してください。");
    //     }
    // }

    if (empty($openFile)) {
        writelog("ERROR getCurrentPageNumberFromBookmarkfile() openFile is empty");
        return;
    }

    $baseFile = basename($openFile);
    if (empty($baseFile)) {
        writelog("ERROR getCurrentPageNumberFromBookmarkfile() baseFile is empty");
        return;
    }

    if ($global_use_db_flag == 1) {
        // DB利用時
        $query = "SELECT count(*) FROM book_history WHERE user = ? AND base_file = ? ORDER BY updated_at DESC LIMIT 1";
        $stmt = $dbh->prepare($query);
        $stmt->execute([$user, $baseFile]);
        $row = $stmt->fetch(PDO::FETCH_NUM);

        if ($row[0] > 0) {
            $query = "SELECT current_page, favorite, max_page FROM book_history WHERE user = ? AND base_file = ? ORDER BY updated_at DESC LIMIT 1";
            $stmt = $dbh->prepare($query);
            $stmt->execute([$user, $baseFile]);
            $row = $stmt->fetch(PDO::FETCH_NUM);
            $page = $row[0];
            $favorite = $row[1] == 1 ? '*' : '';
            // $maxPage = $row[2]; // 必要に応じて使用
        } else {
            writelog("DEBUG getCurrentPageNumberFromBookmarkfile() not found with DB");
        }
        writelog("DEBUG getCurrentPageNumberFromBookmarkfile() page:$page favorite:$favorite with DB");
    } else {
        // ブックマークファイル内のファイル存在確認
        // DB未使用時のコードはコメントアウト
        // $result = shell_exec("grep -nF \"$baseFile\" \"$bookmarkPath/bookmark\"");
        // if ($result) {
        //     $lineNo = explode(':', $result)[0];
        //     list(, $page,, $favorite) = explode("\t", $result);
        //     writelog("DEBUG getCurrentPageNumberFromBookmarkfile() page:$page favorite:$favorite lineNo:$lineNo");
        // }
    }
} //end function getCurrentPageNumberFromBookmarkfile


##### ブックマークファイル更新 ##################################################################
function makeBookmark()
{
    global $global_use_db_flag, $baseFile, $bookmarkPath, $bookmarkDir, $user, $page, $maxPage,
        $file, $lineNo, $favorite, $dbh, $escapedFile, $base_file_utf, $base_file_hash, $dirname;

    getCurrentPageNumberFromBookmarkfile();

    if ($global_use_db_flag == 1) {
        // DBのページ位置更新
        $base_file_utf = $baseFile;
        writelog("DEBUG makeBookmark() base_file_utf:$base_file_utf with DB");
        $base_file_hash = basefilename2hash($base_file_utf);
        writelog("DEBUG makeBookmark() base_file_hash:$base_file_hash with DB");

        $request_uri = $_SERVER['REQUEST_URI'];
        // .phpで終わるリクエストURIの場合は、$request_uriに相当する文字列作成
        if (preg_match('/\.php$/', $request_uri)) {
            $request_uri .= "?&file=" . $escapedFile . "&mode=open";
            writelog("DEBUG makeBookmark() request_uri is replaces:$request_uri");
        }
        // $dirname = trim(shell_exec('dirname "' . $bookmarkPath . '/bookmark"'));
        $dirname = dirname($bookmarkPath);
        writelog("DEBUG makeBookmark() bookmarkPath:$bookmarkPath dirname:$dirname with DB");

        $dirname = str_replace($bookmarkDir, '', $dirname);
        $dirname = str_replace("/$user", '', $dirname);
        $dirname = preg_replace('#^//#', '/', $dirname);
        if (substr($dirname, 0, 1) !== '/') {
            $dirname = '/' . $dirname;
        }
        writelog("DEBUG makeBookmark() bookmarkPath:$bookmarkPath dirname:$dirname with DB");
        $query = "INSERT INTO book_history (user, request_uri, path_hash, relative_path, base_file, base_file_hash, current_page, max_page) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user, base_file) DO UPDATE SET current_page = excluded.current_page, max_page = excluded.max_page, request_uri = excluded.request_uri, path_hash = excluded.path_hash, relative_path = excluded.relative_path";

        $stmt = $dbh->prepare($query);
        $stmt->execute([$user, $request_uri, $file, $dirname, $base_file_utf, $base_file_hash, $page, $maxPage]);

        if ($dbh->errorInfo()[2]) {
            writelog("ERROR makeBookmark() SQL error: " . $dbh->errorInfo()[2] . " $query:$user, $request_uri, $file, $dirname, $base_file_utf, $base_file_hash, $page, $maxPage");
        }

        writelog("DEBUG makeBookmark() $user, $request_uri, $file, $dirname, $base_file_utf, $base_file_hash, $page, $maxPage with DB");
    } else {
        if ($lineNo != "") {
            // ヒットした行を一旦削除
            $result = shell_exec('flock "' . $bookmarkDir . '/' . $user . '/lock" sed -i "' . $lineNo . 'd" "' . $bookmarkPath . '/bookmark"');
            if ($favorite) {
                $favorite = "\t" . $favorite;
            }
        }

        // ブックマークファイルに追記
        $result = shell_exec('echo -e "' . $baseFile . '\t' . $page . '\t' . $maxPage . $favorite . '" >> "' . $bookmarkPath . '/bookmark"');

        // 最後に開いたファイルを記録 重複書籍があったら削除して最上位へ追加
        $result = shell_exec('flock "' . $bookmarkDir . '/' . $user . '/lock" sed -i "/' . $file . '/d" "' . $bookmarkDir . '/' . $user . '/history"');
        $result = shell_exec('echo "<a class=\"history_book\" href=\"' . $_SERVER['REQUEST_URI'] . '\"><!-- ' . $file . ' -->' . $baseFile . '</a>" >> "' . $bookmarkDir . '/' . $user . '/history"');
    }
} //end function makeBookmark


##### ブックマークファイル取得 ############################################################
function getBookmarkList()
{
    global $user, $file, $global_use_db_flag, $bookmarkDir, $dbh;

    if ($user !== "guest") {
        $file = preg_replace('/\.\.\//', '', $file);
        $file = str_replace('+', '%2B', $file);
        $file = urldecode($file);

        if ($global_use_db_flag == 1) {
            writelog("DEBUG getBookmarkList() $bookmarkDir:$user:$file with DB");
            $file = rtrim($file, '/');
            $query = "SELECT base_file, current_page, max_page, favorite, has_read FROM book_history WHERE user = ? AND relative_path = ? ORDER BY updated_at DESC LIMIT 1000";
            $stmt = $dbh->prepare($query);
            writelog("DEBUG getBookmarkList() $query:$user:$file");
            $stmt->execute([$user, $file]);

            if ($dbh->errorInfo()[2]) {
                writelog("ERROR getBookmarkList() SQL error: " . $dbh->errorInfo()[2] . " query: $query");
            }

            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                $fav = $row['favorite'] == 1 ? "\t*" : '';
                // 既読は最終ページが0に設定されている仕様
                if ($row['has_read'] === 1) {
                    // 既読なのにcurrent_pageが0になっているのは1ページにする
                    $currentPage = $row['current_page'] == 0 ? 1 : $row['current_page'];
                    $outputLine = "{$row['base_file']}\t$currentPage\t0{$fav}";
                } else {
                    $outputLine = "{$row['base_file']}\t{$row['current_page']}\t{$row['max_page']}{$fav}";
                }
                echo $outputLine . "\n";
                writelog("DEBUG getBookmarkList() " . str_replace("\t", ",", $outputLine) . " with DB");
            }
        } else {
            echo file_get_contents("$bookmarkDir/$user/$file/bookmark");
        }
    }
    exit(0);
} //end function writelog


##### 最近開いたファイル取得 ##############################################################
function getHistory()
{
    global $user, $global_use_db_flag, $bookmarkDir, $dbh;

    if ($user !== "guest") {
        if ($global_use_db_flag == 1) {
            $query = "SELECT request_uri, path_hash, base_file FROM book_history WHERE user = ? ORDER BY updated_at DESC LIMIT 1";
            $stmt = $dbh->prepare($query);
            $stmt->execute([$user]);

            if ($dbh->errorInfo()[2]) {
                writelog("ERROR getHistory() SQL error: " . $dbh->errorInfo()[2] . " query: $query");
            }

            $row = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($row) {
                echo "<a class=\"history_book\" href=\"{$row['request_uri']}\"><!-- {$row['path_hash']} -->{$row['base_file']}</a>";
                writelog("DEBUG getHistory() {$row['request_uri']}:{$row['path_hash']}:{$row['base_file']} with DB");
            }
        } else {
            echo file_get_contents("$bookmarkDir/$user/history");
        }
    }
    exit(0);
} //end function getHistory


##### 閲覧履歴取得 JSONで返す ##############################################################
function getRecentBooks()
{
    global $bookmarkDir, $user, $global_use_db_flag, $dbh;

    header("Content-type: application/json");
    if ($user !== "guest") {
        $json = [];
        if ($global_use_db_flag == 1) {
            $query = "SELECT request_uri, path_hash, base_file FROM book_history WHERE user = ? ORDER BY updated_at DESC LIMIT 50";
            $stmt = $dbh->prepare($query);
            $stmt->execute([$user]);

            if ($dbh->errorInfo()[2]) {
                writelog("ERROR getRecentBooks() SQL error: " . $dbh->errorInfo()[2] . " query: $query");
            }

            while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
                $json[] = [
                    'href' => $row['request_uri'],
                    'file' => $row['path_hash'],
                    'baseFile' => $row['base_file']
                ];
            }

            // JSON形式で結果を出力
            echo json_encode($json);
            writelog("DEBUG getRecentBooks() " . json_encode($json) . " with DB");
        } else {
            // 直近50件取得
            $lines = shell_exec("tail -n 50 \"$bookmarkDir/$user/history\" | tac");
            $linesArray = explode("\n", trim($lines));
            $json = [];

            foreach ($linesArray as $line) {
                if (preg_match('/<a class="history_book" href="([^"]+)"><!-- (.*) -->(.*)<\/a>/', $line, $matches)) {
                    $json[] = [
                        'href' => $matches[1],
                        'file' => $matches[2],
                        'baseFile' => $matches[3]
                    ];
                    writelog("DEBUG " .  $matches[1] . ':$2:' . $matches[3]);
                } else {
                    writelog("DEBUG no match line:" . $line);
                }
            }

            // JSON形式で結果を出力
            echo json_encode($json);
        }
    }
    exit(0);
} //end function writelog


##### ファイルクローズ時にページ位置を保存 ##################################################
function saveBookmark()
{
    global $bookmarkDir, $user, $global_use_db_flag, $dbh, $file, $page, $maxPage;

    if ($user !== "guest") {
        $file = preg_replace('/\.\.\//', '', $file);
        $file = str_replace('+', '%2B', $file);
        $file = urldecode($file);
        if (empty($file)) {
            writelog("ERROR saveBookmark() file is empty");
            return;
        }

        $bookmarkPath = dirname("$bookmarkDir/$user/$file");
        $baseFile = basename($file);
        if (empty($baseFile)) {
            writelog("ERROR saveBookmark() baseFile is empty");
            return;
        }

        if ($global_use_db_flag == 1) {
            $baseFileUtf = $baseFile;
            $query = "SELECT max_page, has_read FROM book_history WHERE user = ? AND base_file = ? ORDER BY updated_at DESC LIMIT 1";
            $stmt = $dbh->prepare($query);
            $stmt->execute([$user, $baseFileUtf]);
            $row = $stmt->fetch(PDO::FETCH_NUM);
            $maxPage = $row[0];
            $has_read = $row[1];

            writelog("DEBUG saveBookmark() $baseFileUtf");

            // 最後まで読んだファイルはページ数を0にする
            if ($page >= $maxPage) {
                $maxPage = 0;
                $has_read = 1;
            } elseif ($has_read == 1) {
                // 既に既読の場合はいじらない
            } else {
                $has_read = 0;
            }

            // favはここではいじらない
            $baseFileHash = basefilename2hash($baseFileUtf);
            $query = "UPDATE book_history SET current_page = ?, max_page = ?, has_read = ? WHERE user = ? AND base_file = ?";
            $stmt = $dbh->prepare($query);
            $stmt->execute([$page, $maxPage, $has_read, $user, $baseFileUtf]);

            if ($dbh->errorInfo()[2]) {
                writelog("ERROR saveBookmark() SQL error: " . $dbh->errorInfo()[2] . " query: $query");
            }
            writelog("DEBUG saveBookmark() $page, $maxPage, $has_read, $user, $baseFileHash, $baseFileUtf with DB");
        } else {
            // ブックマークファイル内のページ書き換え
            $result = shell_exec("grep -nF \"$baseFile\" \"$bookmarkPath/bookmark\"");
            $lineNo = trim($result);
            if ($lineNo !== "") {
                // ブックマークファイル中にファイル名が存在する場合はページを取得
                list(, $maxPage, $favorite) = explode("\t", $result);

                // 最後まで読んだファイルはページ数を0にする
                if ($page >= $maxPage) {
                    $maxPage = "0";
                }
                if ($favorite) {
                    $favorite = "\t{$favorite}";
                }

                // ヒットした行を一旦削除 & ブックマークファイルに追記
                shell_exec("flock \"$bookmarkPath/lock\" sed -i \"{$lineNo}d\" \"$bookmarkPath/bookmark\"; echo -e \"{$baseFile}\t{$page}\t{$maxPage}\t{$favorite}\" >> \"$bookmarkPath/bookmark\"");
                $logOutMessage = "$baseFile:$page:$maxPage:$favorite:$bookmarkPath/bookmark";
                writelog("DEBUG saveBookmark() " . $logOutMessage);
            }
        }
    }
    exit(0);
} //end function saveBookmark


##### 指定されたページをjpg/webpストリームとして出力する #########################################
function outputPage($isFileout = false)
{
    global $view, $convert, $cacheDir, $file, $page, $size, $quality, $width, $als, $tempDir,
        $cpdf, $unzip, $p7zip, $unrar, $fullsize_png_compress, $isPageSave, $position_int, $crop_split_view_parts, $conf;
    global $conf;

    $crop_half_cmd = '';
    $crop_half_cmd_left = '';
    $crop_half_cmd_right = '';
    $output_mime = '';
    $input_format = '';
    // indexからページのファイル名を取得
    if (file_exists("$cacheDir/$file/index")) {
        $shell_cmd = "sed -n {$page}p $cacheDir/$file/index";
        $pagefile = rtrim(shell_exec($shell_cmd), "\n");
        writelog("DEBUG outputPage() pagefile:" . $pagefile . " executed:" . $shell_cmd);
    } else {
        // キャッシュファイルが存在しない場合はリロードを促す画像を返す
        showReloadRequiredImg();
        writelog("ERROR outputPage() no such file. $cacheDir/$file/index");
        exit(1);
    }
    // ImageMagick の画像 Crop
    if ($view === 'trimming') {
        if ((preg_match('/\.avif$/i', $pagefile)) && ($conf["isLowMemoryMode"] === 1)) {
            $crop_half_cmd = " ";
            writelog("DEBUG outputPage() AVIF and Low memory mode detected ,NOT trimming mode page:$page");
        } else {
            // サーバー側で左右余白トリミング
            $crop_half_cmd = " | $convert " . '- -crop 99%x99%+0+0 -fuzz 20% -trim +repage - ';
            writelog("DEBUG outputPage() trimming mode page:$page position:$position_int crop_split_view_parts:$crop_split_view_parts");
        }
    } else {
        writelog("DEBUG outputPage() NOT trimming mode page:$page");
    }
    // アーカイブファイルの拡張子取得
    $filePath = readlink("$cacheDir/$file/file");
    $allowedExtensions = ['zip', 'cbz', 'rar', 'cbr', 'pdf', '7z', 'cb7'];
    $ext = '';
    if ($filePath !== false) {
        $pathInfo = pathinfo($filePath);
        if (isset($pathInfo['extension']) && in_array(strtolower($pathInfo['extension']), $allowedExtensions)) {
            $ext = '.' . strtolower($pathInfo['extension']);
        }
    }
    $ext = trim($ext);
    // １ページ取得コマンド作成
    if (file_exists("$cacheDir/$file/$pagefile")) {
        // キャッシュファイルが存在する場合はそれを返す
        $pageInput = "cat \"$cacheDir/$file/$pagefile\"";
        writelog("DEBUG outputPage() output from cache. pageInput:" . $pageInput);
    } else {
        $fixPath = "";
        if (preg_match('/\.(zip|cbz|7z|cb7|rar|cbr)$/i', $ext)) {
            // zipから1ページ切り出し
            // unzipで[]は特殊文字のため?にエスケープする
            $pagefile = str_replace(['[', ']'], '?', $pagefile);
            if (file_exists("$cacheDir/$file/cp932")) {
                $pageInput = "LANG=ja_JP.UTF8 $unzip -p -O cp932 \"$cacheDir/$file/file\" \"$pagefile\"";
            } else {
                $pageInput = "LANG=ja_JP.UTF8 $p7zip e -so \"$cacheDir/$file/file\" \"$pagefile\"";
            }
            // } elseif (preg_match('/\.(rar|cbr)$/i', $ext)) {
            // rarから1ページ切り出し
            // $pageInput = "LANG=ja_JP.UTF8 $unrar p -inul $cacheDir/$file/file \"{$pagefile}\"";
        } elseif (preg_match('/\.pdf$/i', $ext)) {
            // PDFから画像を抽出
            $cpdfTempDir = $tempDir . '/' . getmypid();
            // IS_IMAGE_PDFファイルの存在確認
            if (file_exists("$cacheDir/$file/IS_IMAGE_PDF")) {
                // 画像のみのPDFの場合の処理
                // cpdfはレンダリングファイルのpipe渡しができないのでtmpfs上で渡す
                if (!chkAndMakeDir($cpdfTempDir)) {
                    exit(1);
                } else {
                    register_shutdown_function(function () {
                        global $conf, $tempDir;
                        $cpdfTempDir = $tempDir . '/' . getmypid();
                        deleteDirectory($cpdfTempDir);
                    });
                }
                shell_exec("cd $cpdfTempDir; $cpdf -extract-images -i $cacheDir/$file/file $page -o $file-$page");
                if (preg_match('/\.jpg$/i', shell_exec("ls $cpdfTempDir/*$file-$page* | head -n 1"))) {
                    $pageInput = "cat $cpdfTempDir/*{$file}-{$page}* ";
                    writelog("DEBUG outputPage() PDF Extract jpg");
                } else {
                    // png,gif,tiff,jpg2000が規格上あり得る
                    $pageInput = "cat $cpdfTempDir/*{$file}-{$page}* | $convert - jpeg:- ";
                    writelog("DEBUG outputPage() PDF convert jpg");
                }
            } else {
                // テキストを含むPDFはpdftoppmでレンダリング
                // フラグファイル:$cacheDir/$file/TEXT_PDF
                $pdftoppm = $conf["pdftoppm"];
                $pageInput = "$pdftoppm -f $page -l $page -scale-to-x -1 -scale-to-y -1 -singlefile $cacheDir/$file/file ";
                $pagefile = "$page.ppm";
                $input_format = ""; // ppm:-のはずだが指定するとエラーになる
            }
        }
        // $isPageSave有効時は一度表示したページをキャッシュする
        if ($isPageSave) {
            $pageInput .= " | tee \"$cacheDir/$file/$pagefile\" ";
        }
    }
    // 出力方法
    writelog("DEBUG outputPage() pageInput:" . $pageInput . " crop_half_cmd:" . $crop_half_cmd);
    // ファイル出力モードならimagemagickコマンド返す
    if ($isFileout) {
        return $pageInput . $crop_half_cmd;
    }
    if ($size === 'FULL') {
        // フルサイズで出力
        writelog("DEBUG outputPage() fullsize_png_compress:" . $fullsize_png_compress);
        $pageImg = '';

        if (((!isset($fullsize_png_compress)) || ($fullsize_png_compress == 1)) && preg_match('/\.png$/i', $pagefile)) {
            // pngは圧縮して送出(カラーページでは圧縮よく効くけど処理速度が重い)
            if (strpos($_SERVER['HTTP_ACCEPT'], 'webp') !== false) {
                // # WebP使えれば
                // $pageImg = shell_exec("$pageInput $crop_half_cmd | $cwebp -q $quality -mt -quiet -o - -- -");
                $pageImg = shell_exec("$pageInput $crop_half_cmd | $convert - -define webp:emulate-jpeg-size=true -define webp:thread-level=1 -quality $quality webp:- ");

                if (strlen($pageImg) == 0) {
                    writelog("ERROR Archive image cannot extract image. Delete cache and reload.$file");
                    deleteCacheDirAndReload();
                } else {
                    header("Content-type: image/webp");
                    header("Cache-Control: private, max-age=86400");
                    echo $pageImg;
                }
            } else {
                // JPGで再圧縮
                $pageImg = shell_exec("$pageInput $crop_half_cmd | $convert - -format jpeg -quality $quality jpeg:-");
                if (strlen($pageImg) == 0) {
                    writelog("ERROR Archive image cannot extract image. Delete cache and reload.$file");
                    deleteCacheDirAndReload();
                } else {
                    header("Content-type: image/jpeg");
                    header("Cache-Control: private, max-age=86400");
                    echo $pageImg;
                }
            }
        } else {
            // フルサイズ(デスクトップビュー)は再圧縮なしで元ファイル送る
            if (preg_match('/\.ppm$/i', $pagefile)) {
                // PDFから取り出されたPPMはWebPにして送る
                if (strpos($_SERVER['HTTP_ACCEPT'], 'webp') !== false) {
                    $output_mime = "Content-type: image/webp";
                    $crop_half_cmd .= " | $convert - $input_format -quality $quality webp:- ";
                    writelog("DEBUG outputPage() WebP Convert from ppm");
                } else {
                    $output_mime = "Content-type: image/jpeg";
                    $crop_half_cmd .= " | $convert - $input_format -quality $quality jpeg:- ";
                    writelog("DEBUG outputPage() JPG Convert from ppm");
                }
            } elseif (preg_match('/\.png$/i', $pagefile)) {
                $output_mime = "Content-type: image/png";
                writelog("DEBUG outputPage() PNG Straight");
            } elseif (preg_match('/\.webp$/i', $pagefile)) {
                if (strpos($_SERVER['HTTP_ACCEPT'], 'webp') !== false) {
                    $output_mime = "Content-type: image/webp";
                    writelog("DEBUG outputPage() WebP Straight");
                } else {
                    $output_mime = "Content-type: image/jpeg";
                    $crop_half_cmd .= " | $convert - -format jpeg -quality $quality jpeg:- ";
                    writelog("DEBUG outputPage() JPG Convert from WebP");
                }
            } elseif (preg_match('/\.avif$/i', $pagefile)) {
                if (strpos($_SERVER['HTTP_ACCEPT'], 'avif') !== false) {
                    $output_mime = "Content-type: image/avif";
                    writelog("DEBUG outputPage() AVIF Straight");
                } else {
                    $output_mime = "Content-type: image/jpeg";
                    $crop_half_cmd .= " | $convert - -format jpeg -quality $quality jpeg:- ";
                    writelog("DEBUG outputPage() JPG Convert from AVIF");
                }
            } elseif (preg_match('/\.bmp$/i', $pagefile)) {
                $output_mime = "Content-type: image/bmp";
                writelog("DEBUG outputPage() BMP Straight");
            } elseif (preg_match('/\.gif$/i', $pagefile)) {
                $output_mime = "Content-type: image/gif";
                writelog("DEBUG outputPage() GIF Straight");
            } else {
                $output_mime = "Content-type: image/jpeg";
                writelog("DEBUG outputPage() JPG Straight");
            }
            writelog("DEBUG outputPage() pageInput:" . $pageInput . " crop_half_cmd:" . $crop_half_cmd . ' $output_mime:' . $output_mime);
            $pageImg = shell_exec("$pageInput $crop_half_cmd");
            if (strlen($pageImg) == 0) {
                header("Cache-Control: no-store");
                writelog("ERROR Archive image cannot extract image. Delete cache and reload.$file");
                deleteCacheDirAndReload();
            } else {
                header($output_mime);
                header("Cache-Control: private, max-age=86400");
                echo $pageImg;
                writelog("DEBUG outputPage() filesize:" . strlen($pageImg));
            }
        }
    } else {
        // モバイル向けの圧縮して画像を出力
        if ($als == 1) {
            $width *= 2;
            writelog("DEBUG outputPage() Auto Light Split mode width:$width");
        } else {
            writelog("DEBUG outputPage() Auto Light Split mode off");
        }
        if (strpos($_SERVER['HTTP_ACCEPT'], 'webp') !== false) {
            // WebP使えればファイルをWebPで出力
            // cwebpはAVIFに対応していないのでImageMagick convertで変換
            $cmd = "$pageInput $crop_half_cmd | $convert - $input_format -define webp:emulate-jpeg-size=true -define webp:thread-level=1 -resize {$width}x -quality $quality webp:- ";
            writelog("DEBUG outputPage() webp cmd:" . $cmd);
            $pageImg = shell_exec($cmd);

            if (strlen($pageImg) == 0) {
                header("Cache-Control: no-store");
                writelog("ERROR Archive image cannot extract image. Delete cache and reload.$file");
                deleteCacheDirAndReload();
            } else {
                header("Content-type: image/webp");
                header("Cache-Control: private, max-age=86400");
                echo $pageImg;
                writelog("DEBUG outputPage() filesize:" . strlen($pageImg));
            }
        } else {
            // ファイルをJPGで出力
            $pageImg = shell_exec("$pageInput $crop_half_cmd | $convert - $input_format -format jpeg -resize {$width}x -quality $quality jpeg:-");
            if (strlen($pageImg) == 0) {
                header("Cache-Control: no-store");
                writelog("ERROR Archive image cannot extract image. Delete cache and reload.$file");
                deleteCacheDirAndReload();
            } else {
                header("Content-type: image/jpeg");
                header("Cache-Control: private, max-age=86400");
                echo $pageImg;
                writelog("DEBUG outputPage() filesize:" . strlen($pageImg));
            }
        }
    }
    // tmpfs上のファイルを削除
    if ($ext === ".pdf") {
        deleteDirectory($cpdfTempDir);
    }
} //end function outputPage


##### ファイル不整合時にキャッシュを消してユーザーにリロードを促す ############################################
function deleteCacheDirAndReload()
{
    global $cacheDir, $file;

    // 画像開けないのでキャッシュ消してリロードが必要
    if (is_dir("$cacheDir/$file")) {
        if (deleteDirectory("$cacheDir/$file")) {
            writelog("DEBUG deleteCacheDirAndReload() delete dir $cacheDir/$file/");
        } else {
            writelog("ERROR deleteCacheDirAndReload() delete failed. $cacheDir/$file/");
        }
        showReloadRequiredImg();
    } else {
        writelog("ERROR CANNOT DELETE DIR $cacheDir/$file ");
    }
} //end function deleteCacheDirAndReload


##### 中身が入ってるディレクトリを削除する汎用関数 ############################################
function deleteDirectory($dir)
{
    writelog("DEBUG deleteDirectory() $dir");

    if (!file_exists($dir)) {
        return true;
    }

    if (!is_dir($dir)) {
        return unlink($dir);
    }

    foreach (scandir($dir) as $item) {
        if ($item == '.' || $item == '..') {
            continue;
        }

        $path = $dir . DIRECTORY_SEPARATOR . $item;

        if (is_link($path)) {
            // シンボリックリンクの場合は直接unlinkで削除
            if (!unlink($path)) {
                return false;
            }
        } elseif (is_dir($path)) {
            // ディレクトリの場合は再帰的に削除
            if (!deleteDirectory($path)) {
                return false;
            }
        } else {
            // 通常のファイルの場合はunlinkで削除
            if (!unlink($path)) {
                return false;
            }
        }
    }

    // ディレクトリ自体を削除
    return rmdir($dir);
} //end function deleteDirectory


##### エラー発生時に使う画像表示部分 ############################################
function showReloadRequiredImg()
{
    global $conf;

    // キャッシュファイルが存在しない場合はリロードを促す画像を返す
    header("Content-type: image/png");
    $themeDir = $conf["webRoot"] . "/theme";
    $filePath = $themeDir . "/reload_required.png";

    if (file_exists($filePath)) {
        readfile($filePath);
    } else {
        writelog("ERROR Cannot open file: $filePath");
    }
} //end function showReloadRequiredImg


##### レスポンスコンテンツの圧縮 #####################################################################
function compressResponse($content)
{
    $encoding = null;

    // zstdの利用可能性をチェック
    if (function_exists('zstd_compress') && extension_loaded('zstd')) {
        writelog("DEBUG compressResponse() PHP zstd enable");
        $encoding = 'zstd';
    } elseif (function_exists('gzencode')) {
        writelog("DEBUG compressResponse() PHP gzip enable");
        $encoding = 'gzip';
    }

    // クライアントがサポートしている圧縮方式をチェック
    $acceptEncoding = isset($_SERVER['HTTP_ACCEPT_ENCODING']) ? $_SERVER['HTTP_ACCEPT_ENCODING'] : '';

    if ($encoding === 'zstd' && stripos($acceptEncoding, 'zstd') === false) {
        $encoding = 'gzip'; // クライアントがzstdをサポートしていない場合、gzipにフォールバック
    }

    if ($encoding === 'gzip' && stripos($acceptEncoding, 'gzip') === false) {
        $encoding = null; // クライアントがgzipもサポートしていない場合、圧縮なし
    }

    // 圧縮の実行
    switch ($encoding) {
        case 'zstd':
            if (function_exists('zstd_compress')) {
                writelog("DEBUG compressResponse() USING zstd encode");
                header('Content-Encoding: zstd');
                return zstd_compress($content);
            } else {
                // ここに来ることはないはずだけど念のため
                writelog("INFO compressResponse() zstd fallback");
                return $content;
            }
        case 'gzip':
            writelog("DEBUG compressResponse() USING gzip encode");
            header('Content-Encoding: gzip');
            return gzencode($content);
        default:
            return $content; // 圧縮をサポートしていない場合は非圧縮コンテンツを返す
    }
} //end function compressResponse


##### ベースhtml出力 #####################################################################
function printHTML()
{
    global $conf, $size, $global_preload_pages, $global_debug_flag, $page, $maxPage, $degree,
        $indexArray, $position, $direction, $autosplit, $fileSize, $averagePageBytes, $baseFile,
        $escapedFile, $file, $size, $view_query, $global_preload_delay_ms, $publicDir, $pageTitle,
        $bookName, $contents, $split_button_class, $split_button_text;

    // I18nインスタンスを取得
    $i18n = I18n::getInstance();

    // CSSファイルの読み込み
    if (file_exists($conf["comistream_tool_dir"] . '/code/comistream.css')) {
        $contents_css = file_get_contents($conf["comistream_tool_dir"] . '/code/comistream.css');
        writelog("DEBUG CSS file exist.");
    } else {
        writelog("ERROR CSS not found:" . __DIR__);
        errorExit($i18n->get('config_not_found'), $i18n->get('config_not_found') . ": comistream.css");
    }

    // JavaScriptファイルの読み込み
    if (file_exists($conf["comistream_tool_dir"] . '/code/comistream.js')) {
        $contents_js = file_get_contents($conf["comistream_tool_dir"] . '/code/comistream.js');
        writelog("DEBUG JS file exist.");
    } else {
        writelog("ERROR JS not found:" . __DIR__);
        errorExit($i18n->get('config_not_found'), $i18n->get('config_not_found') . ": comistream.js");
    }

    // 動作モード設定
    if ($size === 'FULL') {
        $size_button_flag = $i18n->get('compressed'); // 切り換え先を表示
        $size_button_class = 'button raw';
        // FULLサイズはモバイルネットワークではないと想定してプリロードページ数を倍に
        $global_preload_pages *= 2;
    } else {
        $size_button_flag = $i18n->get('full_size');
        $size_button_class = 'button cmp';
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

    // 言語選択用のHTMLを生成
    $langSelectorHtml = $i18n->getLangSelectorHtml();
    // 言語切り替え用のJavaScript
    $langSwitcherJs = $i18n->getLangSwitcherJs();

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
    <meta name="apple-mobile-web-app-status-bar-style" content="black" />
    <meta name="robots" content="noindex, nofollow" />
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
<link rel="stylesheet" href="https://ajax.googleapis.com/ajax/libs/jqueryui/1.14.0/themes/smoothness/jquery-ui.css">
<script src="https://ajax.googleapis.com/ajax/libs/jquery/3.7.1/jquery.min.js"></script>
<script src="https://ajax.googleapis.com/ajax/libs/jqueryui/1.14.0/jquery-ui.min.js"></script>
<script src="$themeDir/theme/js/long-press-event.min.js"></script>
<script>
<!--
    // PHPの設定に基づいてJavaScriptのデバッグフラグを設定
    window.DEBUG_ENABLED = $debug_flag;

    // 多言語対応用のメッセージを設定
    window.i18n = {
        fullscreen_not_supported: "{$i18n->get('fullscreen_not_supported')}",
        author_link_not_found: "{$i18n->get('author_link_not_found')}",
        title_link_not_found: "{$i18n->get('title_link_not_found')}",
        input_alphanumeric: "{$i18n->get('input_alphanumeric')}",
        connection_error: "{$i18n->get('connection_error')}"
    };

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
    var position = "$position";
    var direction = "$direction";
    var autoSplit = "$autosplit"; // クエリパラメータで停止 offか空文字
    const archiveFileMBytes = $fileSize; // オープンしたファイルのサイズ（MB）
    const averagePageKBytes = $averagePageBytes; // オリジナルの平均ページサイズ(KB)
    const maxPage = $maxPage;
    const baseFile = "$baseFile";
    const escapedFile = "$escapedFile";
    const file = "$file";
    const size = "$size";
    const view_query = "$view_query";
    const global_preload_delay_ms = "$global_preload_delay_ms";
    const publicDir = "$publicDir";
    const themeDir = "$themeDir";
    let global_preload_pages = $global_preload_pages;

    $contents_js

    // 言語切り替え用JavaScript
    $langSwitcherJs
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
        <img src="$themeDir/theme/icons/close.png" alt="Close button" class="close" onclick="document.getElementById('contents').style.display='none'">
        <span class="button button-close" onclick="backListPage();">{$i18n->get('back')}</span>
        <span id="rawMode" class="$size_button_class button-mode" onclick="toggleRaw();">$size_button_flag</span>
        <span id="single" class="button button-mode" onclick="single()">{$i18n->get('single_page')}</span>
        <span id="spread" class="button button-mode" onclick="spread()">{$i18n->get('spread_page')}</span>
        <span class="button button-mode" onclick="fixSpreadPage()">{$i18n->get('spread_fix')}</span>
        <span class="button button-mode" id="direction" onclick="toggleDirection()">{$i18n->get('direction')}</span>
        <span class="button button-mode" id="fullScreenButton" onclick="toggleFullScreen()">{$i18n->get('fullscreen')}</span>
        <span class="$split_button_class button-mode" id="splitFile" onclick="toggleTrimmingFile()">{$i18n->get('trimmingmode')}</span>
        $langSelectorHtml<span class="button button-mode" id="clockToggleButton" onclick="toggleClock()">{$i18n->get('clock')}</span>
    </div>
    <div style="clear:both;">
        <div class="bookName">$bookName</div>
        <input id="slider" type="range" value="$maxPage" min="1" max="$maxPage" step="1" /><span id="value" class="value">1</span>
    </div>
    <hr>
    <div class="toclist">$contents</div>
</div>

<div id="suggest" hidden >
    <input type="hidden" autofocus="autofocus" />
        <span class="button" onclick="backListPage();">{$i18n->get('back')}</span>
</div>

<div id="overlay" class="overlay"></div>
<div id="modal" class="modal">
    <div class="modal-content">
        <img id="image1" alt="クイック見開きモード左ページ">
        <img id="image2" alt="クイック見開きモード右ページ">
    </div>
</div>

<div id="inspector" class="inspector"></div>

</body>
</html>

EOF;

    // Content-Type ヘッダーを設定
    header('Content-Type: text/html; charset=utf-8');
    // レスポンスを圧縮して出力
    echo compressResponse($htmlContent);
    writelog("DEBUG printHTML done.");
} //end function printHTML


##### /を維持したurlencode ###################################################################
function urlEncodeFilePath($filePath)
{
    $parts = explode('/', $filePath);
    $encodedParts = array_map('rawurlencode', $parts);
    return implode('/', $encodedParts);
} //end function urlEncodeFilePath

##### パスハッシュからファイル名を取得 ###################################################################
function searchBookByHash($dbh, $file)
{
    $sql = "SELECT count(*) FROM book_history WHERE path_hash = ? ORDER BY updated_at DESC LIMIT 1";
    $stmt = $dbh->prepare($sql);
    $stmt->execute([$file]);
    $count = (int)$stmt->fetchColumn();
    if ($count > 0) {
        writelog("DEBUG searchBookByHash() found: " . $file);
        $sql = "SELECT relative_path, base_file FROM book_history WHERE path_hash = ? ORDER BY updated_at DESC LIMIT 1";
        $stmt = $dbh->prepare($sql);
        $stmt->execute([$file]);
        return $stmt->fetch(PDO::FETCH_ASSOC);
    } else {
        writelog("DEBUG searchBookByHash() NOT found: " . $file);
        return false;
    }
} //end function searchBookByHash

##### 書籍ファイルオープン ###################################################################
function openPage()
{
    global $conf;
    global $tempDir, $cacheDir, $cacheSize, $sharePath, $publicDir, $md5cmd, $dbh,
        $page, $file, $baseFile, $maxPage, $user, $openFile, $escapedFile, $coverFile,
        $previewFile, $existDir, $direction, $position, $degree, $fileSize, $averagePageBytes, $bookName;

    // テンポラリ領域がなければ作成
    writelog("DEBUG openPage() tempDir:" . $tempDir);
    if (!chkAndMakeDir($tempDir)) {
        exit(1);
    }

    // デコード前ファイルパスを保存
    // writelog("DEBUG \$file:$file");
    $file = preg_replace('/\.\.\//', '', $file);
    $escapedFile = urlEncodeFilePath($file);

    // ファイルパスを作成
    $file = str_replace('+', '%2B', $file);
    $file = urldecode($file);
    // writelog("DEBUG \$file:" . $file);
    $openFile = "$sharePath/$file";

    // ファイル存在チェック
    if (!file_exists($openFile)) {
        writelog("DEBUG openPage() file not found " . $openFile);
        // ファイルハッシュならDB検索
        // $fileが16進数文字のみで構成されているか検証
        if (preg_match('/^[0-9a-fA-F]+$/', $file)) {
            // DB検索
            $path_hash = $file;
            $result = searchBookByHash($dbh, $file);
            if ($result) {
                $baseFile = $result['base_file'];
                $file = $result['relative_path'] . '/' . $result['base_file'];
                // 先頭の/を取り除く
                $file = ltrim($file, '/');
                $escapedFile = urlEncodeFilePath($file);
                $file = str_replace('+', '%2B', $file);
                $file = urldecode($file);
                writelog("DEBUG openPage() file:" . $file);
                $openFile = "$sharePath/$file";
                if (!file_exists($openFile)) {
                    // ファイルが存在しない場合はエラー
                    writelog("DEBUG openPage() file not found from path hash:" . $openFile . ':' . $path_hash);
                    list($book_title, $pageTitle, $onlyBookName) = get_book_title($baseFile);
                    print_book_notfound_error($onlyBookName);
                    clean_shm_dir();
                    exit(1);
                }
            } else {
                // DBにハッシュがない
                writelog("DEBUG openPage() file not found from path hash on DB:" . $path_hash);
                print_book_notfound_error("");
                clean_shm_dir();
                exit(1);
            }
        } else {
            // ファイルが存在しない
            writelog("ERROR openPage() file not found " . $openFile);
            $baseFile = basename($openFile);
            $book_title = "";
            $pageTitle = "";
            writelog("DEBUG openPage() file not found, attempting to create a search link.");
            list($book_title, $pageTitle, $onlyBookName) = get_book_title($baseFile);
            print_book_notfound_error($onlyBookName);
            clean_shm_dir();
            exit(1);
        }
    }

    // リード可能パーミッションかテストする
    if (!is_readable($openFile)) {
        writelog("ERROR openPage() file is not readable permission: " . $openFile);
        errorExit("FILE IS NOT READABLE", "ファイルが読めません。パーミッションを確認してください。");
    }

    // 表紙画像のパスを作成
    $file = preg_replace('/^(.*)\..*$/', '$1', $file);
    writelog("DEBUG \$file:" . $file);
    $coverFile = $conf["comistream_tool_dir"] . "/data/theme/covers" . $conf["publicDir"] . '/' . $file . ".jpg";
    $previewFile = $conf["comistream_tool_dir"] . "/data/theme/preview" . $conf["publicDir"] . '/' . $file . ".webp";

    // ファイルIDを作成
    $fileHash = shell_exec("echo \"$openFile\" | $md5cmd | awk '{print \$1}'");
    $fileHash = trim($fileHash);
    if (empty($fileHash)) {
        writelog("ERROR openPage() md5 hash failed." . $openFile);
        errorExit("FILE PROCESS FAILED", "ファイルが処理できません。内部エラーです。ファイル名を修正すると解決する場合があります。");
    } else {
        writelog("DEBUG openPage() fileHash:" . $fileHash);
        $file = $fileHash; // $fileはここでhashに上書き
    }

    // ファイル名から著者名/書籍名を作成
    $bookName = basename($openFile);
    list($bookName, $pageTitle, $onlyBookName) = get_book_title($bookName);

    // ディレクトリ存在チェック
    if (is_dir("$cacheDir/$file")) {
        $existDir = true;
        writelog("DEBUG openPage() dir exist $cacheDir/$file");
        touch("$cacheDir/$file");
    } else {
        $existDir = false;
        writelog("DEBUG openPage() no cache dir exist $cacheDir/$file");

        // キャッシュ領域初期化
        if (!chkAndMakeDir($cacheDir . '/' . $file)) {
            errorExit("ERROR:mkdir cache dir failed.", "キャッシュディレクトリ作成に失敗しました。サーバー側パーミッションを確認してください。");
        }
        if (!is_link("$cacheDir/$file/file")) {
            if (file_exists("$cacheDir/$file/file")) {
                unlink("$cacheDir/$file/file");
            }
            // シンボリックリンクを作成
            if (!file_exists("$cacheDir/$file/file")) {
                $linkCreated = symlink($openFile, "$cacheDir/$file/file");
                if (!$linkCreated) {
                    writelog("ERROR: シンボリックリンクの作成に失敗しました。:" . $openFile . ": $cacheDir/$file/file");
                    errorExit("Cannot create sym link.", "シンボリックリンクの作成に失敗しました。サーバー側パーミッションを確認してください。");
                }
            }
        }
    }
    // ログ出力
    writelog("DEBUG openPage() escapedFile:" . $escapedFile . ' coverFile:' . $coverFile . ' file:' . $file . ' openFile:' . $openFile . ' pageTitle:' . $pageTitle);

    // ファイルオープン処理
    if (preg_match('/\.(zip|cbz|7z|cb7|rar|cbr)$/i', $openFile)) {
        openZipRar();
    } elseif (preg_match('/\.rar$/i', $openFile)) {
        openZipRar();
    } elseif (preg_match('/\.pdf$/i', $openFile)) {
        openPdf();
    } else {
        writelog("openPage() invalid file type: $openFile");
        errorExit("Invalid file type", "未対応ファイルです");
    }
    writelog("DEBUG openPage() \$file:" . $file);

    // ページNO初期化
    if ($page > 1 && $page <= $maxPage) {
        writelog("DEBUG openPage() $page overwrite from argument.");
    } else {
        $page = 1;
        if ($user !== "guest") {
            makeBookmark();
        } else {
            $baseFile = basename($openFile);
        }
    }
    // 表紙画像とプレビュー画像作成
    // メインに移動
    // makeCover($escapedFile, $coverFile, $previewFile);

    // キャッシュ領域のサイズを取得
    if ($cacheSize > 0) {
        $tempSize = shell_exec("du -sm $cacheDir | awk '{print $1}'");
        $tempSize = trim($tempSize);

        // 超過時は古いディレクトリを削除する
        while ($tempSize > $cacheSize) {
            $cacheSubDir = shell_exec("ls -t $cacheDir | tail -n 1");
            $cacheSubDir = trim($cacheSubDir);
            shell_exec("rm -rf $cacheDir/$cacheSubDir");
            $tempSize = shell_exec("du -sm $cacheDir | awk '{print $1}'");
            $tempSize = trim($tempSize);
        }
    }
    writelog("DEBUG openPage() \$file:" . $file);
    // 60分以上前のtmpディレクトリを削除
    $comistream_tmp_dir_root = $conf["comistream_tmp_dir_root"];
    if (strpos($comistream_tmp_dir_root, '/dev/shm/') === 0) {
        $cmd = "cd \"$comistream_tmp_dir_root\" && find \"$comistream_tmp_dir_root\" -mindepth 1 -maxdepth 4 -type d -mmin +60 -exec rm -rf {} + > /dev/null 2>&1 &";
        exec($cmd);
        writelog("DEBUG openPage() Cleaning up old tmp directories in /dev/shm/");
    } else {
        writelog("WARN openPage() Skipping tmp cleanup - not in /dev/shm/:" . $comistream_tmp_dir_root);
    }

    // 右開きデフォルトに設定
    $direction = "left";
    $position = "right";
    $degree = "180deg";

    // ファイル容量取得
    $fileSize = filesize($openFile);
    if ($maxPage > 0) {
        $averagePageBytes = sprintf("%.1f", ($fileSize / $maxPage / 1000)); // KB単位に
    } else {
        $averagePageBytes = 0;
    }
    $fileSize = sprintf("%.1f", ($fileSize / 1000 / 1000)); // MB単位に
    writelog("DEBUG openPage() \$file:" . $file . " \$fileSize:" . $fileSize);

    return array($escapedFile, $coverFile, $previewFile);

    // // HTMLを出力
    // メインに移動
    // printHTML();
    // exit(0);
} //end function openPage


##### zip/rarの目次作成 ############################################################
function makeIndex($maxPage)
{
    global $cacheDir, $file;

    // I18nインスタンスを取得
    $i18n = I18n::getInstance();

    $indexArray = '';
    $contents = '';
    // ページ数が多い本は章のジャンプページ数をだいたい20章を目安に増やす
    $section_unit_pages = 8;
    if ($maxPage > 200) {
        $section_unit_pages = round($maxPage / 20);
        if ($section_unit_pages % 2 !== 0) {
            $section_unit_pages += 1;
        }
        writelog("DEBUG makeIndex() section_unit_pages:$section_unit_pages");
    }

    // $cacheDir/$file/IndexBookmark.json がある場合はそれを読み込む
    $indexBookmarkPath = "$cacheDir/$file/IndexBookmark.json";
    if (file_exists($indexBookmarkPath)) {
        $indexBookmarkJson = file_get_contents($indexBookmarkPath);
        $indexBookmark = json_decode($indexBookmarkJson, true);

        if ($indexBookmark && is_array($indexBookmark)) {
            foreach ($indexBookmark as $bookmark) {
                if (isset($bookmark['page']) && isset($bookmark['title'])) {
                    $page = $bookmark['page'];
                    $title = htmlspecialchars($bookmark['title']);
                    $indexArray .= ",$page";
                    $contents .= "<div class=\"toclink\" onclick=\"page=$page; loadPage(1);\">$title</div>\n";
                }
            }
        }
    }

    // 既存のインデックス生成ロジック
    if ($maxPage > 10) {
        $indexArray .= $indexArray ? ",1" : "1";
        $i = 10;
        $contents .= "<div class=\"toclink\" onclick=\"page=1; loadPage(1);\">" . $i18n->get('toc_cover') . "</div>\n";
        while ($i < $maxPage) {
            $indexArray .= ",$i";
            $contents .= "<div class=\"toclink\" onclick=\"page=$i; loadPage(1);\">$i " . $i18n->get('page_unit') . "</div>\n";
            $i += $section_unit_pages;
        }
        $indexArray .= ",$maxPage";
        $contents .= "<div class=\"toclink\" onclick=\"page=$maxPage; loadPage(1);\">" . $i18n->get('last_page') . "</div>\n";
    } else {
        $indexArray .= $indexArray ? ",1,$maxPage" : "1,$maxPage";
        $contents .= "<div class=\"toclink\" onclick=\"page=1; loadPage(1);\">" . $i18n->get('toc_cover') . "</div>\n";
        $contents .= "<div class=\"toclink\" onclick=\"page=$maxPage; loadPage(1);\">" . $i18n->get('last_page') . "</div>\n";
    }

    // 重複を削除し、ソートする
    $indexArray = implode(',', array_unique(explode(',', $indexArray)));
    $indexArrayParts = explode(',', $indexArray);
    sort($indexArrayParts);
    $indexArray = implode(',', $indexArrayParts);

    return [$indexArray, $contents];
} //end function makeIndex


##### zip/rarアーカイブのオープン ############################################################
function openZipRar()
{
    global $conf, $cacheDir, $cacheSize, $sharePath, $publicDir, $p7zip, $unzip, $isPreCache,
        $existDir, $openFile, $file, $coverFile, $view, $maxPage, $indexArray, $contents, $async;

    writelog("DEBUG openZipRar() cacheDir:$cacheDir file:$file");
    $shell_cmd = "LANG=ja_JP.UTF8 $p7zip l -slt \"$cacheDir/$file/file\" | tee $cacheDir/$file/rawindex | grep -Pi \"\\.(jpg|jpeg|png|webp|avif|bmp|gif)\" | grep -v \"^\\._\" | grep -v \"/\\._\" | sed \"s/Path = //\" | sort -V | head -n 1";
    $firstFile = shell_exec($shell_cmd);
    $firstFile = rtrim($firstFile, "\n");
    writelog("DEBUG openZipRar() firstFile:" . $firstFile . " executed:" . $shell_cmd);

    $shell_cmd = "cat $cacheDir/$file/rawindex | grep \"Path = \" | grep -Pi \"\\.(zip|rar|cbz|cbr|7z|cb7|rar|cbr)$\" | head -n 1";
    $nestArchive = shell_exec($shell_cmd);
    $nestArchive = trim($nestArchive);
    writelog("DEBUG openZipRar() nestedArchive:" . $nestArchive . " executed:" . $shell_cmd);

    if (!empty($nestArchive)) {
        // アーカイブ内アーカイブを検出した場合
        writelog("DEBUG openZipRar() nested detected. nestedArchive:$nestArchive");
        if ($existDir) {
            // 展開中でもここに来てしまうのでDONEファイルがあるかを検証する
            writelog("DEBUG openZipRar() cache dir exists.");
            if (file_exists("$cacheDir/$file/DONE")) {
                writelog("DEBUG openZipRar() DONE file exists.");
            } else {
                // 展開中なので待たせる
                writelog("INFO openZipRar() nested archive extracting,exit.");
                errorExit("Archive is being expanded", "アーカイブの展開中です。しばらく待ってもう一度ファイルを開いてください。", false);
                exit(0);
            }
        } else {
            // 展開が重いのでLoading画面表示
            writelog("DEBUG openZipRar():" . $cacheDir . ':' . $conf["cacheDir"]);
            if ($cacheDir == $conf["cacheDir"]) {
                // リーダーを開いた場合
                writelog("DEBUG openZipRar() send nested loading page.");
                $fileSizeBytes = filesize($openFile);
                $fileSizeMB = round($fileSizeBytes / (1000 * 1000));
                printLoading($fileSizeMB);
                $result = shell_exec("LANG=ja_JP.UTF8 bash " . $conf["comistream_tool_dir"] . "/code/nestedExtracter.sh \"$openFile\" $cacheDir/$file");
                exit(0);
            } else {
                // バッチ処理で表紙作成を開いた場合
                $cacheDir = $conf["cacheDir"] . '/make_picture';
                $bookOpenCacheDir = $cacheDir . '/' . $file;
                if (!chkAndMakeDir($bookOpenCacheDir)) {
                    errorExit('ディレクトリ作成に失敗しました', 'ディレクトリ作成に失敗しました。' . $bookOpenCacheDir . "のパーミッションを確認してください。");
                }
                $result = shell_exec("LANG=ja_JP.UTF8 bash " . $conf["comistream_tool_dir"] . "/code/nestedExtracter.sh \"$openFile\" $cacheDir/$file");
            }
        }
        $maxPage = shell_exec("ls $cacheDir/$file/ | grep -Pi \"\\.(jpg|jpeg|png|webp|avif|bmp|gif)\" | tee $cacheDir/$file/index | wc -l");
        $maxPage = trim($maxPage);

        $checkFile = shell_exec("LANG=ja_JP.UTF8 $p7zip l -slt \"$cacheDir/$file/file\" \"$nestArchive\" | grep \"Path = \" | grep -Pi \"\\.(zip|rar|cbz|cbr|7z|cb7|rar|cbr)\"");
        $checkFile = rtrim($checkFile, "\n");

        writelog("DEBUG openZipRar() nestedArchive maxPage:$maxPage checkFile:$checkFile");
    } else {
        // 通常アーカイブの場合（入れ子でない）
        writelog("DEBUG openZipRar() normal archive file.");
        if ($isPreCache && !$existDir) {
            // 事前キャッシュ作成モードかつキャッシュディレクトリがない場合zipファイル解凍
            writelog("DEBUG openZipRar() isPreCache && no cache dir.");
            // 7zコマンドでアーカイブを展開（__MACOSXディレクトリを除外）
            $cmd = "LANG=ja_JP.UTF8 $p7zip x -y -bb1 '-x!__MACOSX*' \"$cacheDir/$file/file\" -o\"$cacheDir/$file/\" $async";
            writelog("DEBUG openZipRar() executing command: " . $cmd);
            $output = array();
            $return_var = 0;
            exec($cmd, $output, $return_var);

            // より詳細なエラー情報をログに記録
            // writelog("DEBUG openZipRar() 7zz command output: " . implode("\n", $output));
            writelog("DEBUG openZipRar() 7zz command return code: " . $return_var);
            // // エラーコードの意味を解析
            // $error_message = "";
            // switch($return_var) {
            //     case 0:
            //         $error_message = "正常終了";
            //         break;
            //     case 1:
            //         $error_message = "警告（非致命的なエラー）";
            //         break;
            //     case 2:
            //         $error_message = "致命的なエラー";
            //         break;
            //     case 7:
            //         $error_message = "コマンドラインエラー";
            //         break;
            //     default:
            //         $error_message = "不明なエラー";
            // }
            // writelog("DEBUG openZipRar() error meaning: " . $error_message);
        } else {
            writelog("DEBUG openZipRar() isPreCache:" . $isPreCache . " && exist cache dir:" . $existDir);
        }
        // unzipで[]は特殊文字のため?にエスケープする
        $firstFile = str_replace(['[', ']'], '?', $firstFile);

        $checkFile = shell_exec("LANG=ja_JP.UTF8 $p7zip l -slt \"$cacheDir/$file/file\" \"$firstFile\" | grep -Pi \"\\.(jpg|jpeg|png|webp|avif|bmp|gif)\"");
        $checkFile = rtrim($checkFile, "\n");
        writelog("DEBUG openZipRar() checkFile:" . mb_convert_encoding($checkFile, 'UTF-8', 'auto'));

        $dirname = '';
        if (!empty($checkFile)) {
            // ファイル名指定でリストから検出できた場合
            writelog("DEBUG openZipRar() checkFile exist");
            $maxPage = shell_exec("cat $cacheDir/$file/rawindex | grep -Pi \"\\.(jpg|jpeg|png|webp|avif|bmp|gif)\" | grep -v \"^\\._\" | grep -v \"/\\._\" | sed \"s/Path = //\" | sort -V | tee -a $cacheDir/$file/index | wc -l");
        } else {
            // CP932で再試行
            writelog("DEBUG openZipRar() checkFile NOT exist, cp932 retry");
            $dirname = dirname($coverFile);
            if (!chkAndMakeDir($dirname)) {
                errorExit('ディレクトリ作成に失敗しました', 'ディレクトリ作成に失敗しました。' . $dirname . "のパーミッションを確認してください。");
            }
            touch("$cacheDir/$file/cp932");
            $maxPage = shell_exec("LANG=ja_JP.UTF8 $unzip -Z -1 -O cp932 \"$cacheDir/$file/file\" | grep -Pi \"\\.(jpg|jpeg|png|webp|avif|bmp|gif)\" | grep -v \"^\\._\" | grep -v \"/\\._\" | sort -V | tee -a $cacheDir/$file/index | wc -l");
        }

        $maxPage = trim($maxPage);
        writelog("DEBUG openZipRar() maxPage:$maxPage");
    }
    if ($maxPage < 1) {
        // シンボリックリンクの実体パスを取得
        $cachePath = $cacheDir . "/" . $file;
        if (is_link($cachePath . '/file')) {
            $target = readlink($cachePath . '/file');
        } else {
            $target = $cachePath;
        }
        deleteDirectory($cachePath);
        clean_shm_dir();
        writelog("ERROR openZipRar() target:" . $target);
        errorExit("Archive open failed", $target . " アーカイブファイルの展開に失敗しました。非対応形式やファイルが異常などのケースが考えられます。");
    }
    // 分割表示モード用ページ番号
    if ($view === 'split') {
        $maxFilePage = $maxPage;
        $maxPage *= 2;
    } else {
        $maxFilePage = $maxPage;
    }
    // 目次を作成
    list($indexArray, $contents) = makeIndex($maxPage);

    return [$maxPage, $maxFilePage, $indexArray, $contents];
} //end function openZipRar


##### PDFのオープン ############################################################
function openPdf()
{
    global $conf, $cacheDir, $file, $cpdf, $traceFile, $async, $isPreCache, $existDir, $maxPage, $indexArray, $contents;

    if ($isPreCache && !$existDir) {
        // キャッシュファイル保存領域にpdfファイル解凍
        shell_exec("cd $cacheDir/$file; $cpdf -extract-images -i \"$cacheDir/$file/file\" &>>$traceFile $async");
    }

    // ページ数取得/ページリスト作成
    $maxPage = shell_exec("$cpdf -pages -i \"$cacheDir/$file/file\"");
    $maxPage = trim($maxPage);
    writelog("DEBUG openPdf() $cpdf -pages -i \"$cacheDir/$file/file\"");
    // TODO pdfinfoで書き換えられないか検討
    // $pdfinfo = $conf["pdfinfo"];
    // $maxPage = shell_exec("$pdfinfo \"$cacheDir/$file/file\" | grep Pages | awk '{print $2}'");
    // writelog("DEBUG openPdf() $pdfinfo \"$cacheDir/$file/file\":".$$maxPage);
    shell_exec("seq -f \"p%g_.jpg\" $maxPage > \"$cacheDir/$file/index\"");

    // 目次を作成
    // TODO pdftocgenで書き換えられないか検討
    $cmd = "$cpdf -utf8 -list-bookmarks -i \"$cacheDir/$file/file\"";
    writelog("DEBUG openPdf() executing command: $cmd");
    $raw_contents = shell_exec($cmd . " 2>&1");
    if (strlen($raw_contents) > 1) {
        // 目次情報を整形
        list($indexArray, $contents) = formatPdfContents($raw_contents);
    } else {
        // 目次がなかったら作成
        writelog("DEBUG openPdf() Make static TOC.");
        list($indexArray, $contents) = makeIndex($maxPage);
    }
    // 画像PDFかテキストPDFかの判定フラグ書込
    $analyzer = new PDFAnalyzer();
    $result = $analyzer->analyze("$cacheDir/$file/file");
    if ($result['success']) {
        $data = $result['data'];
        // 結果の処理
        if ($data['is_image_only']) {
            touch("$cacheDir/$file/IS_IMAGE_PDF");
            writelog("DEBUG openPdf() PDF detect:This is an image-only PDF");
        } else {
            touch("$cacheDir/$file/TEXT_PDF");
            writelog("DEBUG openPdf() PDF detect:This is an text PDF");
        }
    } else {
        writelog("ERROR openPdf() PDF detect failed.:" . $result['error']);
    }
} //end function openPdf

##### PDFから目次情報取得 ############################################################
function formatPdfContents($raw_contents)
{
    global $maxPage;

    // 結果を格納する変数
    $formatted_contents = '';
    $page_numbers = [];

    // 空の入力をチェック
    if (empty($raw_contents)) {
        writelog("DEBUG formatPdfContents() raw_contents is empty");
        return ['', ''];
    }

    // 行ごとに処理
    $lines = explode("\n", $raw_contents);
    foreach ($lines as $line) {
        // 空行をスキップ
        if (trim($line) === '') {
            continue;
        }

        // 正規表現で必要な情報を抽出
        if (preg_match('/[0-9]+ "([^"]+)" ([0-9]+)/', $line, $matches)) {
            $title = $matches[1];  // 目次タイトル
            $page = $matches[2];   // ページ番号

            // HTMLの作成
            $formatted_contents .= sprintf(
                '<div class="toclink" onclick="page=%d; loadPage(1);">%s</div>' . "\n",
                $page,
                htmlspecialchars($title)
            );

            // ページ番号を配列に追加
            $page_numbers[] = $page;
        }
    }

    // ページ番号をカンマ区切りの文字列に変換
    $index_array = implode(',', array_unique($page_numbers));
    $index_array = checkContentsIndexArray($index_array);
    $index_array .= ",$maxPage";
    writelog("DEBUG formatPdfContents() indexArray:" . $index_array);
    writelog("DEBUG formatPdfContents() contents:" . $formatted_contents);

    return [$index_array, $formatted_contents];
} // end func formatPdfContents


##### インデックスのデータが異常がないか検証して修正する ################################
function checkContentsIndexArray($indexArray)
{
    global $conf;

    // カンマ区切りの昇順数列になっているか検証し、満たしていない値を削除する
    $numbers = explode(',', $indexArray);

    // 配列を昇順にソート
    sort($numbers, SORT_NUMERIC);

    // 昇順になっているか検証し、満たしていない値を削除
    $validatedNumbers = [];
    $prev = $numbers[0];
    $validatedNumbers[] = $prev;

    foreach (array_slice($numbers, 1) as $num) {
        if ($num > $prev) {
            $validatedNumbers[] = $num;
            $prev = $num;
        }
    }

    // 配列をカンマ区切���の文字列に戻す
    return implode(',', $validatedNumbers);
} //end function checkContentsIndexArray


##### 別プロセスを起動して表紙画像とプレビュー画像を作成する  ###########################
function makeCover($coverProcessFile, $coverFile, $previewFile)
{
    global $conf, $make_coverpage_path, $coverFile, $previewFile;

    $previewProcessFile = $coverProcessFile;
    $make_coverpage_path = $conf["comistream_tool_dir"] . "/code";
    $coverDir = $conf["comistream_tool_dir"] . '/data/theme/covers';

    if (!chkAndMakeDir($coverDir)) {
        errorExit('ディレクトリ作成に失敗しました', 'ディレクトリ作成に失敗しました。' . $coverDir . "のパーミッションを確認してください。");
    }
    $previewDir = $conf["comistream_tool_dir"] . '/data/theme/preview';

    if (!chkAndMakeDir($previewDir)) {
        errorExit('ディレクトリ作成に失敗しました', 'ディレクトリ作成に失敗しました。' . $previewDir . "のパーミッションを確認してください。");
    }
    // 表紙ファイル出力
    if (!file_exists($coverFile)) {
        $coverProcessFile = str_replace('+', '%2B', $coverProcessFile);
        $coverProcessFile = urldecode($coverProcessFile);
        $coverProcessFile = str_replace('`', '\\`', $coverProcessFile);
        writelog("DEBUG makeCover() cover file: $make_coverpage_path/make_cover_preview.php " . $coverProcessFile);
        shell_exec("php $make_coverpage_path/make_cover_preview.php --file=\"$coverProcessFile\" --type=\"covers\" --cache=true >/dev/null 2>&1 &");
    } else {
        writelog("DEBUG makeCover() cover exist." . $coverFile);
    }

    // プレビュー画像ファイルがなければ出力
    if (!file_exists($previewFile)) {
        $previewProcessFile = str_replace('+', '%2B', $previewProcessFile);
        $previewProcessFile = urldecode($previewProcessFile);
        $previewProcessFile = str_replace('`', '\\`', $previewProcessFile);
        writelog("DEBUG makeCover() preview file: $make_coverpage_path/make_cover_preview.php " .  $previewProcessFile);
        shell_exec("php $make_coverpage_path/make_cover_preview.php --file=\"$previewProcessFile\" --type=\"preview\" --cache=true >/dev/null 2>&1 &");
    } else {
        writelog("DEBUG makeCover() preview exist." . $previewFile);
    }
} //end function makeCover


##### 文字列を引数に取りハッシュを返す ############################################################
function basefilename2hash($baseFile)
{
    global $md5cmd;

    if (strlen($baseFile) === 0) {
        writelog("ERROR basefilename2hash() baseFile is empty");
        return '';
    } else {
        // ファイル名のハッシュを生成
        $baseFileHash = trim(shell_exec("echo -n \"$baseFile\" | $md5cmd | cut -d ' ' -f 1"));
        writelog("DEBUG basefilename2hash() $baseFile: $baseFileHash");
        return $baseFileHash;
    }
} //end function basefilename2hash


##### ファイル名から作者名とタイトルをHTMLで返す ############################################################
function get_book_author_keyword($baseFile)
{
    global $conf;

    $book_search_url = $conf["book_search_url"];
    $str = '';

    if (preg_match('/\[(.*?)\((.*?)\]/', $baseFile, $matches)) {
        $A = $matches[1];
        $B = $matches[2];
        $str .= "<a href=\"$book_search_url$A\">$A</a>,<a href=\"$book_search_url$B\">$B</a>,";
    }

    if (preg_match('/\[(.*?)\]/', $baseFile, $matches)) {
        $A = $matches[1];
        $parts = preg_split('/(×|／|、|,|×|\s)/', $A);
        foreach ($parts as $part) {
            if (!preg_match('/^(×|／|、|,|×|\s)$/', $part)) {  // 区切り文字をスキップ
                $str .= "<a href=\"$book_search_url$part\">$part</a>,";
            }
        }
    }
    return $str;
} //end function get_book_author_keyword


##### ファイル名から書籍名を返す ############################################################
function get_book_title($bookName)
{
    global $conf, $pageTitle;

    $onlyBookName = '';
    $bookName = trim($bookName);
    $bookName = preg_replace('/^\(.*?\) */', '', $bookName); // ファイル名先頭の (...) を削除
    $onlyBookName = $bookName;
    $bookName = preg_replace('/\[(.*?)\] */', '<small class="bookName">$1</small> <br>', $bookName); // [ ] 内を取り出して文字サイズを小さく
    $onlyBookName = preg_replace('/\[(.*?)\] */', '', $onlyBookName); // [ ] 内削除
    $bookName = preg_replace('/(\(|\[)[0-9]{4}-[0-9]{2}-[0-9]{2}(\)|\])/', '', $bookName); // YYYY-MM-DD を削除
    $onlyBookName = preg_replace('/(\(|\[)[0-9]{4}-[0-9]{2}-[0-9]{2}(\)|\])/', '', $onlyBookName); // YYYY-MM-DD を削除
    $bookName = preg_replace('/(\(|\[)(オリジナル|DL|DL版|よろず|修正版|AVIF|WebP|別スキャン|別炊|JPG|縮小)(\)|\])/', '', $bookName); // 付属情報を削除
    $onlyBookName = preg_replace('/(\(|\[)(オリジナル|DL|DL版|よろず|修正版|AVIF|WebP|別スキャン|別炊|JPG|縮小)(\)|\])/', '', $onlyBookName); // 付属情報を削除
    $bookName = preg_replace('/(.+)(\.[^.]+)$/', '$1', $bookName); // 拡張子を削除
    $onlyBookName = preg_replace('/(.+)(\.[^.]+)$/', '$1', $onlyBookName); // 拡張子を削除
    $pageTitle = $bookName;
    $pageTitle = preg_replace('/<("[^"]*"|\'[^\']*\'|[^\'">])*>/', '', $pageTitle); // <title>用に書名部分を取り出し、タグ削除
    $bookName = preg_replace('/\[(.*?)\] */', '', $bookName); // [ ] を捨てる

    // タグ付き作者名・書名 タグなし作者名・書名 書名のみ
    return [$bookName, $pageTitle, $onlyBookName];
} //end function get_book_title


##### オープンしようとしたファイルが存在しなかったときにエラー画面表示 ###############################################
function print_book_notfound_error($bookName)
{
    global $conf, $book_search_url, $baseFile;

    // I18nインスタンスを取得
    $i18n = I18n::getInstance();

    if (strlen($book_search_url) > 1) {
        $bookName = "<a href=\"$book_search_url$bookName\">$bookName</a>";
    } else {
        $bookName = $bookName;
    }
    $authors = get_book_author_keyword($baseFile);
    writelog("DEBUG print_book_notfound_error() bookName:" . $bookName . " authors:" . $authors);

    echo <<<EOF
<!DOCTYPE html>
<html lang="{$i18n->getCurrentLang()}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>エラー: ファイルが見つかりません</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/feather-icons/4.28.0/feather.min.js"></script>
    <style>
        body {
            font-family: 'Helvetica Neue', Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background-color: #f5f5f5;
            color: #333;
        }
        .container {
            background-color: white;
            padding: 2rem;
            border-radius: 0.5rem;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            max-width: 400px;
            width: 100%;
        }
        .alert {
            background-color: #e6e6e6;
            border-left: 4px solid #999;
            padding: 1rem;
            margin-bottom: 1rem;
            border-radius: 0.25rem;
        }
        .alert-title {
            font-weight: bold;
            margin-bottom: 0.5rem;
            display: flex;
            align-items: center;
            color: #555;
        }
        .alert-title i {
            margin-right: 0.5rem;
        }
        h2 {
            margin-top: 0;
            color: #444;
        }
        button {
            display: block;
            width: 100%;
            padding: 0.75rem;
            margin-bottom: 0.75rem;
            background-color: #555;
            color: white;
            border: none;
            border-radius: 0.25rem;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background-color 0.3s ease;
        }
        button:hover {
            background-color: #444;
        }
        button.outline {
            background-color: white;
            color: #555;
            border: 1px solid #555;
        }
        button.outline:hover {
            background-color: #f0f0f0;
        }
        button i {
            margin-right: 0.5rem;
        }
        p {
            margin-bottom: 0.5rem;
        }
        a {
            color: #555;
            text-decoration: none;
            border-bottom: 1px solid #555;
            transition: color 0.3s ease, border-color 0.3s ease;
        }
        a:hover, a:focus {
            color: #000;
            border-bottom-color: #000;
        }
        a:active {
            color: #777;
            border-bottom-color: #777;
        }
        a:visited {
            color: #000;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="alert">
            <div class="alert-title">
                <i data-feather="alert-triangle"></i>
                エラー: ファイルが見つかりません
            </div>
            <div>指定されたファイルが見つからないため、開くことができません。</div>
        </div>

        <h2>検索候補</h2>
        <p><strong>作者名:</strong> <span id="authorName">$authors</span></p>
        <p><strong>書名:</strong> <span id="bookTitle">$bookName</span></p>

        <button onclick="searchByAuthor()">
            <i data-feather="search"></i> 作者名で再検索
        </button>
        <button onclick="searchByTitle()">
            <i data-feather="search"></i> 書名で再検索
        </button>
        <button class="outline" onclick="closeScreen()">
            <i data-feather="x"></i> 閉じる
        </button>
    </div>

    <script>
        // アイコンを初期化
        feather.replace();

        // URLパラメータから作者名と書名を取得
        // const urlParams = new URLSearchParams(window.location.search);
        // const authorName = urlParams.get('author') || '不明';
        // const bookTitle = urlParams.get('title') || '不明';

        // 作者名と書名を画面に表示
        // document.getElementById('authorName').textContent = authorName;
        // document.getElementById('bookTitle').textContent = bookTitle;

        // ボタンのアクション
        function searchByAuthor() {
                    const authorNameElement = document.getElementById('authorName');
                    const firstLink = authorNameElement.querySelector('a');
                    if (firstLink) {
                            window.location.href = firstLink.href;
                    } else {
                            alert('作者名のリンクが見つかりません。');
                    }
        }

        function searchByTitle() {
                    const bookTitleElement = document.getElementById('bookTitle');
                    const firstLink = bookTitleElement.querySelector('a');
                    if (firstLink) {
                            window.location.href = firstLink.href;
                    } else {
                            alert('書名のリンクが見つかりません。');
                    }
        }

        function closeScreen() {
                    if( window.history.length > 1 ){
                        window.history.back();
                    }else{
                        location.href=document.referrer;
                    }
        }
    </script>
</body>
</html>


EOF;
} //end function print_book_notfound_error


##### システム環境設定 ############################################################
function system_config($dbh)
{
    if ($_SESSION['is_admin']) {
        if (!empty($_SESSION['referer'])) {
            $link_target = "<a href=\"" . $_SESSION['referer'] . "\">ログイン前のページへ戻る</a>";
            $link_url = $_SESSION['referer'];
            unset($_SESSION['referer']);
        } else {
            $link_target = "<a href=\"/\">トップへ移動</a>";
            unset($link_url);
        }
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            foreach ($_POST as $key => $value) {
                writelog("DEBUG system_config() UPDATE $key,$value");
                updateSetting($dbh, $key, $value);
            }
            if (installThemeFiles($dbh)) {
                $message = "設定が更新されました。" . $link_target;
            } else {
                $message = "セットアップに失敗しました。サーバーディレクトリのパーミッションを確認してください。";
            }
        }

        // 現在の設定を取得
        $settings = getSettings($dbh);

        // 設定項目のカテゴリーと説明を定義
        $categories = [
            'ディレクトリ設定' => [
                'webRoot' => 'Webサーバーのルートディレクトリ。/home/user/public_htmlなどです。末尾に/をつけません。',
                'publicDir' => 'コンテンツが格納されているディレクトリ。/nasなどです。末尾に/をつけません。webRoot直下にコンテンツディレクトリがある場合は空になります。',
                'sharePath' => 'コンテンツが格納されているディレクトリのフルパス。/home/user/public_html/nasなどです。末尾に/をつけません。webRootと同一になる場合もあります。webRootとpublicDirを合わせた値になります。',
                'comistream_tool_dir' => 'Comistreamツールのディレクトリパス。/home/user/comistreamなどです。末尾に/をつけません。',
                'comistream_tmp_dir_root' => 'Comistreamの一時ディレクトリのパス。RAMディスクを用いて高速化するために/dev/shm/comistream_tempなどを設定します。末尾に/をつけません。',
                'cover_subDir' => '表紙画像作成対象とするサブディレクトリ。sharePathの配下で電子書籍を格納しているディレクトリを指定します。複数ある場合にはスペース区切りにします。ディレクトリにスペースが含まれる場合にはダブルクォーテーションでディレクトリ名を囲います。Comic Book/Photo "Comic Book"などです。',
            ],
            'コマンド設定' => [
                'p7zip' => '7-Zipコマンドのパス',
                'cpdf' => 'CPDFコマンドのパス',
                'ffmpeg' => 'FFmpegコマンドのパス',
                'convert' => 'ImageMagick convertコマンドのパス',
                'montage' => 'ImageMagick montageコマンドのパス',
                'md5cmd' => 'ハッシュ計算コマンドのパス。b3sumコマンドがおすすめです。なければmd5sumを指定してます。',
                'pdftoppm' => 'pdftoppmコマンドのパス',
                'pdfinfo' => 'pdfinfoコマンドのパス',
                'unzip' => 'unzipコマンドのパス',
            ],
            '動作設定' => [
                'liveStreamMode' => 'LiveStreamによるHLS再圧縮機能を利用できるユーザーを制限します。デフォルトは0で全てのユーザーが利用可能です。1:ゲストユーザーが利用できなくなります。2:管理者のみ利用できます。',
                'cacheSize' => 'ストレージキャッシュ確保サイズ（MB）。0を設定すると使用容量チェックがバイパスされ書籍オープンが高速化します。その場合は使用容量が増え続けるので適宜手動で削除してください。日次バッチで消し込みする場合も0を設定します。',
                'pushoutCacheLimitSize' => '日次バッチキャッシュ削除基準値（MB）。この容量を超えた場合古いものから削除されます。0を設定すると削除されません。',
                'pushoutCacheLimitDays' => '日次バッチキャッシュ削除基準日数。この日数を超えたものから削除されます。0を設定すると削除されません。',
                'width' => '画像の最大幅。パケット節約モード（圧縮モード）は横幅をこのサイズまで縮小します。デフォルトは800です。',
                'quality' => '画像の品質（0-100）。デフォルトは75です。',
                'global_preload_pages' => '先読みページ基準値。デフォルトは3です。動作時にはネットワーク帯域幅を考慮して自動的に増減します。遅いネットワークでは自動的に先読みページ数を増やします。',
            ],
            '外見設定' => [
                'siteName' => '表示されるサイト名です',
                'mainThemeColor' => 'テーマカラーです。デフォルトは#7799ddです（未使用）',
            ],
        ];

        $url = $_SERVER['REQUEST_URI'];
?>
        <!DOCTYPE html>
        <html lang="{$i18n->getCurrentLang()}">

        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Comistream 環境設定</title>
            <style>
                body {
                    font-family: 'Lucida Grande', Verdana, AquaKana, ArialMT, 'Hiragino Kaku Gothic ProN', 'ヒラギノ角ゴ ProN W3', 'メイリオ', Meiryo, sans-serif;
                    line-height: 1.6;
                    color: #333;
                    max-width: 800px;
                    margin: 0 auto;
                    padding: 20px;
                }

                h1,
                h2 {
                    color: #2c3e50;
                }

                .section {
                    margin-bottom: 30px;
                    border: 1px solid #ddd;
                    padding: 20px;
                    border-radius: 5px;
                }

                label {
                    display: block;
                    margin-bottom: 5px;
                    font-weight: bold;
                }

                input[type="text"] {
                    width: 100%;
                    padding: 8px;
                    margin-bottom: 10px;
                    border: 1px solid #ddd;
                    border-radius: 4px;
                }

                button {
                    background-color: #3498db;
                    color: white;
                    padding: 10px 15px;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                }

                button:hover {
                    background-color: #2980b9;
                }

                .message {
                    background-color: #e8f5e9;
                    border: 1px solid #c8e6c9;
                    padding: 10px;
                    margin-bottom: 20px;
                    border-radius: 4px;
                }

                .description {
                    font-size: 0.9em;
                    color: #666;
                    margin-bottom: 5px;
                }

                .advanced-toggle {
                    background-color: #ecf0f1;
                    border: none;
                    padding: 10px;
                    width: 100%;
                    text-align: left;
                    cursor: pointer;
                    margin-bottom: 10px;
                }

                .advanced-content {
                    display: none;
                }
            </style>
        </head>

        <body>
            <h1>Comistream 環境設定</h1>
            <?php if (isset($message)): ?>
                <div class="message"><?php echo $message; ?></div>
            <?php endif; ?>
            <form method="POST" action="<?php echo $url; ?>">
                <?php
                if (!empty($link_url)) {
                    echo "<button type=\"button\" onclick=\"location.href='" . $link_url . "'\">ログイン前のページへ戻る</button>";
                    unset($_SESSION['referer']);
                } else {
                    echo "<button type=\"button\" onclick=\"location.href='/'\">トップページへ戻る</button>";
                }
                ?>

                <button type="submit">設定保存</button>

                <div class="section">
                    <h2>諸仕様</h2>
                    <p>themeディレクトリ、.htaccessは公開ディレクトリの直下に固定配置されます。同名ディレクトリがあると機能しません。</p>
                    <p>表紙画像が格納されるtheme/coverは[comistream_tool_dir]/comistream/data/theme/coverのシンボリックリンクです。プレビュー画像ディレクトリも同様です。</p>
                    <p>データ領域は[comistream_tool_dir]/comistream/data/に集約されています。</p>
                    <p>コンテンツ領域はリードオンリーでリモートマウントしていても動作します。</p>
                </div>

                <?php foreach ($categories as $category => $items): ?>
                    <div class="section">
                        <h2><?php echo htmlspecialchars($category); ?></h2>
                        <?php foreach ($items as $key => $description): ?>
                            <label for="<?php echo htmlspecialchars($key); ?>">
                                <?php echo htmlspecialchars($key); ?>:
                            </label>
                            <div class="description"><?php echo htmlspecialchars($description); ?></div>
                            <input type="text" id="<?php echo htmlspecialchars($key); ?>"
                                name="<?php echo htmlspecialchars($key); ?>"
                                value="<?php echo htmlspecialchars($settings[$key] ?? ''); ?>"
                                size="45">
                        <?php endforeach; ?>
                    </div>
                <?php endforeach; ?>

                <div class="section">
                    <h2>詳細設定</h2>
                    <button type="button" id="advancedToggle" class="advanced-toggle">詳細設定を表示</button>
                    <div id="advancedContent" class="advanced-content">
                        <?php
                        $categorized_keys = array_merge(...array_values($categories));
                        $displayed_keys = $categorized_keys;

                        foreach ($settings as $key => $value):
                            if (!isset($displayed_keys[$key])): // 既に表示されたキーでないかチェック
                        ?>
                                <label for="<?php echo htmlspecialchars($key); ?>">
                                    <?php echo htmlspecialchars($key); ?>:
                                </label>
                                <input type="text" id="<?php echo htmlspecialchars($key); ?>"
                                    name="<?php echo htmlspecialchars($key); ?>"
                                    value="<?php echo htmlspecialchars($value); ?>"
                                    size="45">
                        <?php
                            endif;
                        endforeach;
                        ?>
                    </div>
                </div>
            </form>

            <p>【<a href="comistream.php?mode=logout">ログアウト</a>】</p>

            <script>
                document.addEventListener('DOMContentLoaded', function() {
                    const advancedToggle = document.getElementById('advancedToggle');
                    const advancedContent = document.getElementById('advancedContent');

                    advancedToggle.addEventListener('click', function() {
                        if (advancedContent.style.display === 'none' || advancedContent.style.display === '') {
                            advancedContent.style.display = 'block';
                            advancedToggle.textContent = '詳細設定を隠す';
                        } else {
                            advancedContent.style.display = 'none';
                            advancedToggle.textContent = '詳細設定を表示';
                        }
                    });
                });
            </script>
        </body>

        </html>
<?php
    } else {
        $html = <<<HTML
    <!DOCTYPE html>
    <html lang="{$i18n->getCurrentLang()}">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>セッションタイムアウト</title>
    </head>
    <body>
        <h1>ログインが必要です</h1>
        <p>管理者ログインが確認できませんでした。操作に時間がかかりすぎた可能性があります。再ログインしてください。【<a href="comistream.php?mode=login">ログイン</a>】</p>
    </body>
    </html>
    HTML;
        echo $html;
    }
}

// 設定を取得する関数
function getSettings($db)
{
    $stmt = $db->query("SELECT key, value FROM system_config");
    $settings = [];
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $settings[$row['key']] = $row['value'];
    }
    return $settings;
}

// 設定を更新する関数
function updateSetting($db, $key, $value)
{
    $stmt = $db->prepare("UPDATE system_config SET value = :value WHERE key = :key");
    $stmt->execute(['value' => $value, 'key' => $key]);
}


##### NestedArchive展開など処理が重いときにLoading画面表示 #######################################
function printLoading($fileSizeMB = 0)
{
    global $conf, $file;

    // I18nインスタンスを取得
    $i18n = I18n::getInstance();

    $htmlContent =  <<<EOF
<!DOCTYPE html>
<html lang="{$i18n->getCurrentLang()}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Comistream:{$i18n->get('loading')}</title>

    <style>
      /* @import url('https://fonts.googleapis.com/css2?family=Merriweather:wght@400;700&display=swap'); */

      html {
        height: 100%;
      }

      body {
        background-image: radial-gradient(
          circle farthest-corner at center,
          #3c4b57 0%,
          #1c262b 100%
        );
      }

      .loader {
        position: absolute;
        top: calc(50% - 32px);
        left: calc(50% - 32px);
        width: 64px;
        height: 64px;
        border-radius: 50%;
        perspective: 800px;
      }

      .inner {
        position: absolute;
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        border-radius: 50%;
      }

      .inner.one {
        left: 0%;
        top: 0%;
        animation: rotate-one 1s linear infinite;
        border-bottom: 3px solid #efeffa;
      }

      .inner.two {
        right: 0%;
        top: 0%;
        animation: rotate-two 1s linear infinite;
        border-right: 3px solid #efeffa;
      }

      .inner.three {
        right: 0%;
        bottom: 0%;
        animation: rotate-three 1s linear infinite;
        border-top: 3px solid #efeffa;
      }

      @keyframes rotate-one {
        0% {
          transform: rotateX(35deg) rotateY(-45deg) rotateZ(0deg);
        }
        100% {
          transform: rotateX(35deg) rotateY(-45deg) rotateZ(360deg);
        }
      }

      @keyframes rotate-two {
        0% {
          transform: rotateX(50deg) rotateY(10deg) rotateZ(0deg);
        }
        100% {
          transform: rotateX(50deg) rotateY(10deg) rotateZ(360deg);
        }
      }

      @keyframes rotate-three {
        0% {
          transform: rotateX(35deg) rotateY(55deg) rotateZ(0deg);
        }
        100% {
          transform: rotateX(35deg) rotateY(55deg) rotateZ(360deg);
        }
      }

      /* フェードアウトのためのスタイル */
      .fade-out {
        opacity: 0;
        transition: opacity 0.4s ease-out;
      }
      footer p {
        font-size: 0.8em;
        color: #ccc;
        text-shadow: 2px 2px 4px #000000;
        font-family: "Merriweather", "Apple Garamond", "Times New Roman", serif;
      }
    </style>
    <script>
      function checkStatus() {
        fetch("/cgi-bin/comistream.php?mode=check_loading&file=$file")
          .then(response => response.text())
          .then(data => {
            if (data === "true") {
              document.body.classList.add("fade-out");
              setTimeout(() => {
                window.location.reload();
              }, 400); // フェードアウトの時間
            } else {
              setTimeout(checkStatus, 1000); // 1秒後に再度チェック
            }
          })
          .catch(error => {
            console.error("Fetch error:", error);
            window.alert("{$i18n->get('connection_error')}");
            window.history.back();
          });
      }

      document.addEventListener("DOMContentLoaded", () => {
        checkStatus(); // 初回チェック
      });
    </script>
  </head>
  <body>
    <!-- https://codepen.io/martinvd/pen/xbQJom/ -->

    <main>
      <div class="loader">
        <div class="inner one"></div>
        <div class="inner two"></div>
        <div class="inner three"></div>
      </div>
    </main>
    <footer>
      <p>Comistream: {$i18n->get('loading')}... {$fileSizeMB}MB of files</p>
    </footer>
  </body>
</html>

EOF;

    ignore_user_abort(true);
    set_time_limit(0);

    // レスポンスを圧縮して出力
    ob_flush();
    flush();
    // Content-Type ヘッダーを設定
    header('Content-Type: text/html; charset=utf-8');
    echo compressResponse($htmlContent);
    ob_flush();
    flush();
    ob_end_flush();
    ob_implicit_flush(1);

    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
        writelog("DEBUG printLoading() fastcgi_finish_request()");
    } else {
        // 代替方法
        session_write_close();
        header("Connection: close");
        header("Content-Length: " . ob_get_length());
        ob_end_flush();
        flush();
        writelog("DEBUG printLoading() ");
    }
    writelog("DEBUG printLoading done.");
} //end function printLoading


##### ローディング状態をチェックする #####################################################################
function checkLoading($file)
{
    global $cacheDir;
    $isDone = file_exists("$cacheDir/$file/DONE");
    writelog("DEBUG checkLoading() $file $isDone");
    echo $isDone ? "true" : "false";
    exit;
} //end function checkLoading


##### フルpathで画像ファイルを渡して画像比率を取得する #######################################################
function get_image_aspect_ratio($file_with_path)
{
    global $convert;
    $identify = explode(' ', $convert);
    $magic = $identify[0];
    if (preg_match('/convert$/', $magic)) {
        // ImageMagick6までの定義なら
        $magic = "identify";
    } else {
        // ImageMagick7以降の定義なら
        $magic .= " identify";
    }
    $width = 0;
    $height = 0;
    writelog("DEBUG get_image_aspect_ratio() ImageMagick $magic");
    if (file_exists($file_with_path)) {
        $return_value = shell_exec("$magic -format \"%w,%h\" $file_with_path");
        $return_value = explode(',', $return_value);
        $width = intval($return_value[0]);
        $height = intval($return_value[1]);
        $ratio = ($width / $height);
        writelog("DEBUG get_image_aspect_ratio() ratio $ratio width $width height $height");
        return $ratio;
    } else {
        writelog("WARNING get_image_aspect_ratio() no image file:" . $file_with_path);
        return 0;
    }
} //end function get_image_aspect_ratio


##### 初期設定画面表示 #######################################################
function displayInitialSetupScreen()
{
    // データベースの存在確認
    if (databaseExists()) {
        return false; // 初期設定は不要
    }

    // 初期設定画面のHTMLを生成
    writelog("DEBUG displayInitialSetupScreen() Enter Initial Setup mode");
    $errorMessage = $_SESSION['error'] ?? '';
    unset($_SESSION['error']);
    if (strlen($errorMessage) > 1) {
        $messagecss = "block";
    } else {
        $messagecss = "none";
    }
    printLoginHtml('setup', "初期管理者パスワード設定", $errorMessage, "設定保存", $messagecss);
    return true;
} //end function displayInitialSetupScreen


##### 初期管理者パスワード設定画面/ログイン画面HTMLを出力 #######################################################
function printLoginHtml($mode, $title, $errorMessage, $buttonText, $messagecss)
{
    // I18nインスタンスを取得
    $i18n = I18n::getInstance();

    // CSRFトークンを生成
    $csrf = bin2hex(random_bytes(50));
    $_SESSION['csrf'] = $csrf;
    if ($mode === 'setup') {
        $formOption = '<input type="hidden" name="action" value="initial_setup">';
        $action = '';
    } else {
        $formOption = '<input type="hidden" name="action" value="admin_login">';
        $action = 'action="comistream.php?mode=login"';
    }
    // ログイン画面でユーザー名を指定された場合はそのユーザー名をフォームに表示する
    $formUser = isset($_GET['user']) ? htmlspecialchars($_GET['user'], ENT_QUOTES, 'UTF-8') : '';

    $html = <<<HTML
    <!DOCTYPE html>
    <html lang="{$i18n->getCurrentLang()}">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>$title</title>
        <style>
            body {
                font-family: 'Helvetica Neue', Arial, sans-serif;
                background-color: #f0f2f5;
                display: flex;
                justify-content: center;
                align-items: center;
                height: 100vh;
                margin: 0;
            }
            .setup-container {
                background-color: white;
                padding: 2rem;
                border-radius: 8px;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                width: 100%;
                max-width: 400px;
            }
            h1 {
                color: #333;
                text-align: center;
                margin-bottom: 2rem;
            }
            .input-group {
                margin-bottom: 1.5rem;
            }
            label {
                display: block;
                margin-bottom: 0.5rem;
                color: #555;
            }
            input[type="text"],
            input[type="password"] {
                width: 100%;
                padding: 0.75rem;
                border: 1px solid #ddd;
                border-radius: 4px;
                font-size: 1rem;
                box-sizing: border-box;
            }
            button {
                width: 100%;
                padding: 0.75rem;
                background-color: #7799dd;
                color: white;
                border: none;
                border-radius: 4px;
                font-size: 1rem;
                cursor: pointer;
                transition: background-color 0.3s ease;
            }
            button:hover {
                background-color: #4b79d6;
            }
            .error-message {
                background-color: #ffebee;
                border: 1px solid #ffcdd2;
                color: #b71c1c;
                padding: 10px;
                border-radius: 4px;
                margin-bottom: 20px;
                display: $messagecss;
            }
        </style>
    </head>
    <body>
        <div class="setup-container">
            <h1>$title</h1>
            <div id="error-message" class="error-message">
            $errorMessage
            </div>
            <form id="setup-form" method="POST" $action>
                <div class="input-group">
                    <label for="username">{$i18n->get('admin_username')}</label>
                    <input type="text" id="username" name="username" minlength="3" maxlength="100" value="$formUser" required>
                </div>
                <div class="input-group">
                    <label for="password">{$i18n->get('admin_password')}</label>
                    <input type="password" id="password" name="password" minlength="8" maxlength="4000" required>
                </div>
                <input type="hidden" name="csrf" value="$csrf">
                $formOption
                <button type="submit">$buttonText</button>
            </form>
        </div>
    </body>
    </html>
    HTML;

    echo $html;
} //end function printLoginHtml

##### 管理者ログイン機能 #######################################################
function adminLogin($dbh)
{
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action']) && $_POST['action'] === 'admin_login') {
        // ログイン処理
        $username = $_POST['username'] ?? '';
        $password = $_POST['password'] ?? '';
        $csrf = $_POST['csrf'] ?? '';
        if (empty($username) || empty($password)) {
            $_SESSION['error'] = "管理者ユーザー名とパスワードは必須です。";
            header('Location: comistream.php?mode=login');
            exit;
        }
        if ($csrf !== $_SESSION['csrf']) {
            $_SESSION['error'] = "ページ遷移が異常です。";
            header('Location: comistream.php?mode=login');
            exit;
        }
        // アカウント検証
        $stmt = $dbh->prepare('SELECT name, password FROM users WHERE name = :name');
        $stmt->bindValue(':name', $username, PDO::PARAM_STR);
        $stmt->execute();
        $user = $stmt->fetch();
        if (!$user || !password_verify($password, $user['password'])) {
            $_SESSION['error'] = "ログインに失敗しました。ユーザー名またはパスワードが違います。";
            header('Location: comistream.php?mode=login');
            exit;
        } else {
            // ログイン成功
            if (empty($_SESSION['referer'])) {
                // ディレクトリリスティングから来た場合はsessionに入ってないからこっち
                if (isset($_SERVER['HTTP_REFERER']) && !empty($_SERVER['HTTP_REFERER'])) {
                    $_SESSION['referer'] = $_SERVER['HTTP_REFERER'];
                }
            }
            $referer = $_SESSION['referer'] ?? '';
            session_regenerate_id(true);
            $_SESSION['name'] = $username;
            $_SESSION['is_admin'] = true;
            $_SESSION['referer'] = $referer;
            setcookie('comistreamUser', $username, time() + 31536000, '/');
            header('Location: comistream.php?mode=config');
            exit;
        }
    } else {
        $errorMessage = $_SESSION['error'] ?? '';
        unset($_SESSION['error']);
        if (strlen($errorMessage) > 1) {
            $messagecss = "block";
        } else {
            $messagecss = "none";
        }
        printLoginHtml('login', "管理者ログイン", $errorMessage, "ログイン", $messagecss);
    }
} //end function adminLogin


##### ログアウト機能 #######################################################
function logout()
{
    global $conf;
    writelog("DEBUG logout()");
    // 移動先
    $publicDir = $conf['publicDir'] . '/';
    // セッションクリア
    $_SESSION = array();
    session_destroy();
    setcookie('comistreamUser', '', time() - 3600, '/');

    header("Location: $publicDir");
    exit;
} //end function logout


##### DBファイルが存在するか判定 #######################################################
function databaseExists()
{
    // データベースファイルの存在確認
    $dbPath = __DIR__ . '/../data/db/comistream.sqlite';
    return file_exists($dbPath);
} //end function databaseExists


##### 初期設定作業、管理者作成、DB初期化 #################################################
function handleInitialSetup($postData)
{
    writelog("DEBUG handleInitialSetup() Enter admin and DB setup");
    // POSTデータから管理者情報を取得
    $adminUsername = $postData['username'] ?? '';
    $adminPassword = $postData['password'] ?? '';

    // 入力値のバリデーション
    if (empty($adminUsername) || empty($adminPassword)) {
        // die('管理者ユーザー名とパスワードは必須です。');
        writelog("ERROR handleInitialSetup() admin and DB setup error: username or password is empty");
        $_SESSION['error'] = "管理者ユーザー名とパスワードは必須です。";
        header('Location: comistream.php');
        exit;
    }
    // コマンド検索してデフォルト値を設定する
    putenv("PATH=/usr/local/bin:/usr/bin:/bin:" . getenv("PATH"));
    $p7zip = exec('which 7zz');
    writelog("DEBUG handleInitialSetup() p7zip:$p7zip");
    $cpdf = exec('which cpdf');
    writelog("DEBUG handleInitialSetup() cpdf:$cpdf");
    $ffmpeg = exec('which ffmpeg');
    writelog("DEBUG handleInitialSetup() ffmpeg:$ffmpeg");
    $convert = exec('which magick');
    writelog("DEBUG handleInitialSetup() convert:$convert");
    $montage = $convert . ' montage';
    $unzip = exec('which unzip');
    writelog("DEBUG handleInitialSetup() unzip:$unzip");
    $unrar = exec('which unrar');
    writelog("DEBUG handleInitialSetup() unrar:$unrar");
    $md5cmd = exec('which b3sum');
    writelog("DEBUG handleInitialSetup() md5cmd:$md5cmd");
    if (empty($md5cmd)) {
        $md5cmd = exec('which md5sum');
    }
    writelog("DEBUG handleInitialSetup() md5cmd:$md5cmd");
    // $webRootを定義するために、homeの下にpublicかpublic_htmlがあったらそれをフルpathにして代入する
    $webRoot = realpath(__DIR__ . '/../..');
    $publicDirPath = $webRoot . '/public';
    $publicHtmlDirPath = $webRoot . '/public_html';
    if (file_exists($publicDirPath)) {
        $webRoot = realpath($publicDirPath);
    } elseif (file_exists($publicHtmlDirPath)) {
        $webRoot = realpath($publicHtmlDirPath);
    } else {
        writelog("DEBUG handleInitialSetup() not found public or public_html");
    }
    writelog("DEBUG handleInitialSetup() webRoot:$webRoot");

    $comistream_tool_dir = realpath(__DIR__ . '/..');
    $sharePath = $webRoot . '/nas'; // 仮にホームディレクトリのwebRootに/nasつけておく

    // データベースファイルのパス
    $dbPath = __DIR__ . '/../data/db/comistream.sqlite';
    $dbDir = dirname($dbPath);

    if (!chkAndMakeDir($dbDir)) {
        writelog('ERROR mkdir failed. Check permissions;' . $dbDir);
        errorExit("mkdir failed", "ディレクトリ作成に失敗しました。パーミッションエラーです。" . $dbDir . "にWebServerが書き込み出来るか確認してください。");
        exit(1);
    }

    $DSN = "sqlite:" . __DIR__ . '/../data/db/comistream.sqlite';
    try {
        // SQLiteデータベースに接続
        $db = new PDO($DSN);
        $db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $db->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        // PRAGMA foreign_keysをONに設定
        $db->exec('PRAGMA foreign_keys = ON;');
        // DDLファイルの内容を読み込む
        // DDLファイルの存在確認
        $ddlFilePath = __DIR__ . '/../rsrc/sql/make-comistream-db-ddl.sql';
        if (!file_exists($ddlFilePath)) {
            errorExit("not found", "初期設定中にエラーが発生しました:必要なファイルが見つかりません。再インストールしてください。");
        }
        $ddlContent = file_get_contents($ddlFilePath);

        // トランザクション開始
        $db->beginTransaction();

        // DDLを実行してテーブルを作成
        $db->exec($ddlContent);

        // 管理者アカウントを作成
        $stmt = $db->prepare('INSERT INTO users (name, password, is_admin) VALUES (:name, :password, 1)');
        $stmt->bindValue(':name', $adminUsername, PDO::PARAM_STR);
        $stmt->bindValue(':password', password_hash($adminPassword, PASSWORD_DEFAULT), PDO::PARAM_STR);
        $stmt->execute();

        // システム設定を作成
        $variablesToUpdate = ['p7zip', 'cpdf', 'ffmpeg', 'convert', 'montage', 'unzip', 'unrar', 'md5cmd', 'sharePath', 'comistream_tool_dir', 'webRoot'];
        $stmt = $db->prepare('INSERT OR REPLACE INTO system_config (key, value) VALUES (:key, :value)');
        foreach ($variablesToUpdate as $variable) {
            if (isset($$variable)) {
                $value = $$variable;
                // 値をtrimし、改行コードを削除
                $value = trim(preg_replace('/\s+/', ' ', $value));
                $stmt->bindValue(':key', $variable, PDO::PARAM_STR);
                $stmt->bindValue(':value', $value, PDO::PARAM_STR);
                writelog("DEBUG handleInitialSetup() update default value $variable:$value");
                $result = $stmt->execute();

                if (!$result) {
                    throw new Exception("Failed to update $variable in system_config");
                }
            } else {
                writelog("DEBUG updateSystemConfig() Variable $variable is not set");
            }
        }

        // トランザクションをコミット
        $db->commit();
        writelog("DEBUG handleInitialSetup() DB setup completed:" . print_r($db->errorInfo(), true));

        // セッションにユーザー情報を保存
        session_regenerate_id(true);
        $_SESSION['name'] = $adminUsername;
        $_SESSION['is_admin'] = true;

        // dataディレクトリの作成
        $mkdirPath = __DIR__ . '/../data/etc/index/';
        chkAndMakeDir($mkdirPath);
        $mkdirPath = __DIR__ . '/../data/etc/index/daily-list/';
        chkAndMakeDir($mkdirPath);
        $mkdirPath = __DIR__ . '/../data/etc/index/daily-cover/';
        chkAndMakeDir($mkdirPath);
        $mkdirPath = __DIR__ . '/../data/theme/hls/';
        chkAndMakeDir($mkdirPath);
        $mkdirPath = __DIR__ . '/../data/theme/covers/';
        chkAndMakeDir($mkdirPath);
        $mkdirPath = __DIR__ . '/../data/theme/preview/';
        chkAndMakeDir($mkdirPath);

        // comistream_setup.conf削除
        $setupConfPath = '/home/user/public/.htaccess';
        if (file_exists($setupConfPath)) {
            unlink($setupConfPath);
        }

        // 初期設定完了後のリダイレクト
        header('Location: comistream.php?mode=config');
        exit;
    } catch (Exception $e) {
        // エラーが発生した場合はロールバック
        if (isset($db)) {
            $db->rollBack();
            // $db->close();
        }
        errorExit("config invalid", "初期設定中にエラーが発生しました: " . $e->getMessage());
    }
} //end function handleInitialSetup


##### .htaccess作成、theme設定とfooter.html更新 #################################################
function installThemeFiles($dbh)
{
    global $conf;
    global $sharePath, $publicDir, $md5cmd, $convert, $montage, $unzip, $unrar, $cpdf, $p7zip,
        $ffmpeg, $book_search_url, $cacheSize, $isPageSave, $isPreCache, $async, $width, $quality, $fullsize_png_compress, $global_debug_flag;

    // themeは公開直下 /public_html/theme/ に固定配置
    // /public_html/theme/cover , /public_html/theme/preview/ は/comistream/data/theme/coverのシンボリックリンク （書込ファイルは/dataに集めるため）
    // $publicDirは公開直下にコンテンツがある場合は""、公開直下に/nasをマウントしてる場合は"/nas"
    // Apache公開ディレクトリのサーバ内フルパス
    // $sharePath = "/home/user/public_html/nas";
    // Apache公開ディレクトリのURLパス（URLスキーム・ホストを除いた部分）
    // $publicDir = "/nas";

    // コンフィグ読み込み
    readConfig($dbh);

    // .htaccess作成
    $sourceFile = $conf["comistream_tool_dir"] . "/theme/htaccess";
    $destinationFile = $conf["webRoot"] . "/.htaccess";
    $themeDir = $conf["webRoot"] . "/theme";

    if ((file_exists($destinationFile)) && (file_exists($themeDir))) {
        // $timestamp = round(microtime(true) * 1000);
        // $backupFile = $conf["sharePath"] . "/htaccess_" . $timestamp;
        // if (!rename($destinationFile, $backupFile)) {
        //     writelog("ERROR installThemeFiles() .htaccessのバックアップに失敗しました");
        //     return false;
        // } else {
        //     writelog("INFO installThemeFiles() .htaccessがバックアップされました: " . $backupFile);
        // }
        // テーマと.htaccessがすでに既存があったらなにもしない
    } else {
        // .htaccessのコピー
        // 初期セットアップ時またはコンテナ再生成時
        if (file_exists($destinationFile)) {
            // 事前削除
            unlink($destinationFile);
        }
        if (!copy($sourceFile, $destinationFile)) {
            writelog("ERROR installThemeFiles() .htaccess copy failed:" . $sourceFile . ':' . $destinationFile);
            return false;
        } else {
            writelog("INFO installThemeFiles() .htaccess copy success:" . $sourceFile . ':' . $destinationFile);
        }
    }

    // theme設定とfooter.html更新theme設定とfooter.html更新
    // themeディレクトリの作成
    // $themeDir = $conf["sharePath"] . "/theme";
    if (file_exists($themeDir)) {
        // $timestamp = round(microtime(true) * 1000);
        // $backupThemeDir = $themeDir . "_" . $timestamp;
        // if (!rename($themeDir, $backupThemeDir)) {
        //     writelog("ERROR installThemeFiles() themeディレクトリのバックアップに失敗しました");
        //     return false;
        // } else {
        //     writelog("INFO installThemeFiles() themeディレクトリがバックアップされました: " . $backupThemeDir);
        // }
        // 既存があったらなにもしない
    } else {


        if (!chkAndMakeDir($themeDir)) {
            return false;
        }
        // themeディレクトリ内のファイルをコピー
        $sourceThemeDir = $conf["comistream_tool_dir"] . "/theme";
        try {
            $sourceDirectory = $sourceThemeDir;
            $destinationDirectory = $themeDir;
            recursiveCopy($sourceDirectory, $destinationDirectory);
            writelog("DEBUG installThemeFiles() theme file copy completed");
        } catch (Exception $e) {
            writelog("ERROR installThemeFiles() theme file copy failed:" . $e->getMessage());
            return false;
        }
        // coverとpreviewのシンボリックリンクを作成
        $coverLink = $themeDir . "/covers";
        $previewLink = $themeDir . "/preview";
        $hlsLink = $themeDir . "/hls";
        if (!symlink($conf["comistream_tool_dir"] . "/data/theme/covers", $coverLink)) {
            writelog("ERROR installThemeFiles() cover symlink creation failed:" . $coverLink);
            return false;
        } else {
            writelog("INFO installThemeFiles() cover symlink created:" . $coverLink);
        }
        if (!symlink($conf["comistream_tool_dir"] . "/data/theme/preview", $previewLink)) {
            writelog("ERROR installThemeFiles() preview symlink creation failed:" . $previewLink);
            return false;
        } else {
            writelog("INFO installThemeFiles() preview symlink created:" . $previewLink);
        }
        if (!symlink($conf["comistream_tool_dir"] . "/data/theme/hls", $hlsLink)) {
            writelog("ERROR installThemeFiles() hls symlink creation failed:" . $hlsLink);
            return false;
        } else {
            writelog("INFO installThemeFiles() hls symlink created:" . $hlsLink);
        }
    }
    // footer.htmlの更新
    // footer.htmlのパスを設定
    $footerHtmlPath = $themeDir . "/footer.html";

    // sedコマンドを使用してconst publicDirの行を書き換え
    $publicDir = $conf['publicDir'];
    $command = "sed -i 's|const publicDir =.*|const publicDir = \"$publicDir\";|' $footerHtmlPath";
    exec($command, $output, $return_var);
    if ($return_var !== 0) {
        writelog("ERROR installThemeFiles() failed to update footer.html: " . implode("\n", $output));
        return false;
    } else {
        writelog("INFO installThemeFiles() footer.html updated successfully");
    }
    $bibiPath = $conf['bibiPath'];
    $command = "sed -i 's|const bibiPath =.*|const bibiPath = \"$bibiPath\";|' $footerHtmlPath";
    exec($command, $output, $return_var);
    if ($return_var !== 0) {
        writelog("ERROR installThemeFiles() failed to update footer.html: " . implode("\n", $output));
        return false;
    } else {
        writelog("INFO installThemeFiles() footer.html updated successfully");
    }
    writelog("INFO installThemeFiles() theme dir setup completed!");

    // manifest.jsonの更新
    $manifestPath = $themeDir . "/manifest.json";
    $siteName = $conf['siteName'];
    // sedコマンドを使用してconst publicDirの行を書き換え
    $command = "sed -i 's|\"name\":.*|  \"name\": \"$siteName\",|' $manifestPath";
    exec($command, $output, $return_var);
    if ($return_var !== 0) {
        writelog("ERROR installThemeFiles() failed to update manifest.json: " . implode("\n", $output));
        return false;
    } else {
        writelog("INFO installThemeFiles() manifest.json updated successfully");
    }
    $command = "sed -i 's|\"short_name\":.*|  \"short_name\": \"$siteName\",|' $manifestPath";
    exec($command, $output, $return_var);
    if ($return_var !== 0) {
        writelog("ERROR installThemeFiles() failed to update manifest.json: " . implode("\n", $output));
        return false;
    } else {
        writelog("INFO installThemeFiles() manifest.json updated successfully");
    }
    writelog("INFO installThemeFiles() theme dir setup completed!");

    // パーミッション初期化
    // テーマディレクトリの所有者とグループを変更
    if (!chown($themeDir, 'apache')) {
        writelog("ERROR installThemeFiles() failed to chown theme dir to apache");
        // return false;
    }
    if (!chgrp($themeDir, 'apache')) {
        writelog("ERROR installThemeFiles() failed to chgrp theme dir to apache");
        // return false;
    }
    // サブディレクトリも再帰的に変更
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($themeDir),
        RecursiveIteratorIterator::SELF_FIRST
    );
    foreach ($iterator as $item) {
        if (!chown($item, 'apache')) {
            writelog("ERROR installThemeFiles() failed to chown {$item} to apache");
            // return false;
        }
        if (!chgrp($item, 'apache')) {
            writelog("ERROR installThemeFiles() failed to chgrp {$item} to apache");
            // return false;
        }
    }
    writelog("INFO installThemeFiles() permissions updated successfully");

    return true;
} //end function installThemeFiles


##### DBからコンフィグ読んでグローバル変数に代入 #################################################
function readConfig($dbh)
{
    global $conf;
    global $sharePath, $publicDir, $md5cmd, $convert, $montage, $unzip, $unrar, $cpdf, $p7zip,
        $ffmpeg, $book_search_url, $cacheSize, $isPageSave, $isPreCache, $async, $width, $quality,
        $fullsize_png_compress, $global_debug_flag, $global_resize, $usm, $tempDir, $cacheDir;
    // 参考定義情報
    // Web公開ディレクトリのサーバ内フルパス
    // ＄conf["webRoot"] = "/home/user/public_html";
    //  Apache公開ディレクトリのURLパス（URLスキーム・ホストを除いた部分）（変更必須）
    // $publicDir = "/nas";
    //  Apache公開ディレクトリのサーバ内フルパス（変更必須）
    // $sharePath = "/home/user/public_html/nas";
    // $sharePath = ＄conf["webRoot"].$publicDir;

    //データ取得
    $query = "SELECT key, value FROM system_config";
    $rs = sql_query($dbh, $query, "DBクエリに失敗しました");
    $rowdata = $rs->fetch();
    if (!$rowdata) {
        writelog("ERROR readConfig() NO DATA");
    } else {
        //配列に代入
        do {
            $conf[$rowdata['key']] = $rowdata['value'];
            // writelog("DEBUG readConfig() key:".$rowdata['key']." value:".$rowdata['value']);
        } while ($rowdata = $rs->fetch());

        //グローバル変数に代入
        // ベースディレクトリの末尾のスラッシュを確実に除去
        $conf["webRoot"] = rtrim($conf["webRoot"], DIRECTORY_SEPARATOR);

        $conf["sharePath"] = rtrim($conf["sharePath"], DIRECTORY_SEPARATOR);
        $sharePath = $conf["sharePath"];
        $conf["publicDir"] = rtrim($conf["publicDir"], DIRECTORY_SEPARATOR);
        $publicDir = $conf["publicDir"];
        $md5cmd = $conf["md5cmd"];
        $convert = $conf["convert"];
        $montage = $conf["montage"];
        $unzip = $conf["unzip"];
        $unrar = $conf["unrar"];
        $cpdf = $conf["cpdf"];
        $p7zip = $conf["p7zip"];
        $ffmpeg = $conf["ffmpeg"];
        $book_search_url = $conf["book_search_url"];
        $cacheSize = $conf["cacheSize"];
        $isPageSave = $conf["isPageSave"];
        $isPreCache = $conf["isPreCache"];
        $async = $conf["async"];
        $width = $conf["width"];
        $quality = $conf["quality"];
        $fullsize_png_compress = $conf["fullsize_png_compress"];

        // デバッグモード
        if ($conf["isDebugMode"] == 1) {
            $global_debug_flag = true;
        } else {
            $global_debug_flag = false;
        }
        // 低メモリモード
        if (!(isset($conf["isLowMemoryMode"]))) {
            sql_query($dbh, "INSERT OR REPLACE INTO system_config (key, value) VALUES('isLowMemoryMode', 1);", "クエリに失敗しました");
            $conf["isLowMemoryMode"] = 1;
        } elseif ((isset($conf["isLowMemoryMode"])) && ($conf["isLowMemoryMode"] === 0)) {
            $conf["isLowMemoryMode"] = 0;
        } else {
            $conf["isLowMemoryMode"] = 1;
        }
        $conf["comistream_tmp_dir_root"] = rtrim($conf["comistream_tmp_dir_root"], DIRECTORY_SEPARATOR);
        $tempDir = $conf["comistream_tmp_dir_root"] . "/reader";
        $conf["comistream_tool_dir"] = rtrim($conf["comistream_tool_dir"], DIRECTORY_SEPARATOR);
        $cacheDir = $conf["comistream_tool_dir"] . "/data/cache";
        $bookmarkDir = $conf["comistream_tool_dir"] . '/data/bm';
        $traceFile = $conf["comistream_tool_dir"] . "/data/etc/comistream.log";
        $conf["cacheDir"] = $cacheDir;
        $global_resize = $conf["global_resize"];
        $usm = ' ' . $conf["usm"] . ' ';
    }
} //end function readConfig

##### SQL文実行汎用 #################################################
function sql_query($dbh, $query, $errmessage, $paramarray = null)
{ // SQL 文を実行
    try {
        $rtn = $dbh->prepare($query);
        $rtn->execute($paramarray);
        //$v = var_export($paramarray, true);
        //writelog("foltialib:sql_query() $query:$v");
        return ($rtn);
    } catch (PDOException $e) {
        /* エラーメッセージに SQL 文を出すのはセキュリティ上良くない！！ */
        $msg = $errmessage . " " .
            $e->getMessage() . " " .
            var_export($e->errorInfo, true) . " " .
            htmlspecialchars($query);
        writelog("ERROR sql_query() SQL EXCEPTION:$msg");
        $dbh = null;
        errorExit("DB実行エラーです", "DB実行エラーが発生しました");
    }
} //end func sql_query


##### ディレクトリごと再帰的にコピーする #################################################
function recursiveCopy($srcDir, $destDir)
{

    if (!chkAndMakeDir($destDir)) {
        writelog('ERROR mkdir failed. Check permissions;' . $destDir);
        return false;
    }

    // ソースディレクトリ内のすべてのファイルとディレクトリを取得
    $dir = opendir($srcDir);

    while (($file = readdir($dir)) !== false) {
        if ($file != '.' && $file != '..') {
            $srcPath = $srcDir . '/' . $file;
            $destPath = $destDir . '/' . $file;

            if (is_dir($srcPath)) {
                // ディレクトリの場合は再帰的にコピー
                recursiveCopy($srcPath, $destPath);
            } else {
                // ファイルの場合は直接コピー
                copy($srcPath, $destPath);
            }
        }
    }

    closedir($dir);
} //end function recursiveCopy


##### ディレクトリが存在しなければ作成する #################################################
function chkAndMakeDir($dir)
{
    global $writelog_process_name, $conf;
    if (empty($dir)) {
        writelog('ERROR chkAndMakeDir() dir is empty', $writelog_process_name);
        return false;
    }
    if (!is_dir($dir)) {
        if (mkdir($dir, 0777, true)) {
            writelog("DEBUG chkAndMakeDir() created directory on $dir", $writelog_process_name);
            return true;
        } else {
            $trace = debug_backtrace();

            writelog('ERROR chkAndMakeDir() mkdir failed. Check permissions:' . $dir . ' trace:' . print_r($trace, true), $writelog_process_name);
            return false;
        }
    } else {
        return true;
    }
} //end function chkAndMakeDir

##### JSでログインボタン押したときにAjaxで管理者とセッションチェックする #################################################
function checkAdminAndSession($dbh)
{
    if (!isset($_POST['user'])) {
        echo json_encode(['error' => 'ユーザー名が指定されていません。']);
        writelog("INFO checkAdminAndSession() user not specified");
        exit;
    }

    $username = $_POST['user'];

    // ユーザーが管理者かどうかを確認
    $stmt = $dbh->prepare('SELECT is_admin FROM users WHERE name = :name');
    $stmt->bindValue(':name', $username, PDO::PARAM_STR);
    $stmt->execute();
    $user = $stmt->fetch(PDO::FETCH_ASSOC);

    $isAdmin = false;
    if ($user && $user['is_admin'] == 1) {
        $isAdmin = true;
        writelog("INFO checkAdminAndSession() admin user found: $username");
    }

    // セッションの存在を確認
    if (session_status() == PHP_SESSION_NONE) {
        session_start();
    }
    if (isset($_SESSION['name']) && $_SESSION['name'] === $username && isset($_SESSION['is_admin']) && $_SESSION['is_admin'] === true) {
        writelog("INFO checkAdminAndSession() admin session found for user: $username");
        $hasSession = true;
    } else {
        writelog("DEBUG checkAdminAndSession() admin session not found for user: $username");
        $hasSession = false;
    }

    // 結果をJSONで返す
    echo json_encode([
        'isAdmin' => $isAdmin,
        'hasSession' => $hasSession
    ]);
    exit;
}

##### covers/preview/ 用tmpDir削除ディレクトリ削除 #################################################
function clean_shm_dir()
{
    global $conf, $type, $file;
    // ワーキングディレクトリ削除
    $shm = $conf["comistream_tmp_dir_root"] . '/make_picture/' . $type . '/' . getmypid();
    deleteDirectory($shm);
    writelog("DEBUG clean_shm_dir() rm $shm");
    // nested working directory削除
    $batch_nested_extract_dir = $conf["cacheDir"] . "/make_picture" . $file;
    if (is_dir($batch_nested_extract_dir)) {
        deleteDirectory($batch_nested_extract_dir);
        writelog("DEBUG clean_shm_dir() rm $batch_nested_extract_dir");
    }
} //end function clean_shm_dir



##### PDFの種類を分析するクラス #################################################
class PDFAnalyzer
{
    private int $minTextChars;

    /**
     * コンストラクタ
     *
     * @param int $minTextChars テキスト判定の最小文字数
     */
    public function __construct(int $minTextChars = 50)
    {
        $this->minTextChars = $minTextChars;
    }

    /**
     * PDFを分析して結果を返す
     *
     * @param string $pdfPath PDFファイルのフルパス
     * @return array{
     *     success: bool,
     *     data?: array{
     *         is_image_only: bool,
     *         has_text_content: bool,
     *         text_length: int,
     *         file_size: int,
     *         analyzed_at: string
     *     },
     *     error?: string
     * }
     */
    public function analyze(string $pdfPath): array
    {
        // 基本的なファイルチェック
        if (!file_exists($pdfPath)) {
            return [
                'success' => false,
                'error' => 'File not found'
            ];
        }

        if (!is_readable($pdfPath)) {
            return [
                'success' => false,
                'error' => 'File is not readable'
            ];
        }

        try {
            // テキスト抽出
            $textContent = $this->extractText($pdfPath);
            $textLength = mb_strlen($textContent);
            $hasTextContent = $textLength > $this->minTextChars;

            // 画像情報の取得
            // JPEG2000のPDFとかでやるとめちゃくちゃ時間かかるので廃止
            // $imagesInfo = $this->getImageInfo($pdfPath);
            // $isImageOnly = !$hasTextContent && stripos($imagesInfo, 'image') !== false;
            $isImageOnly = !$hasTextContent; // テキストがないなら画像のみとする簡易判定

            return [
                'success' => true,
                'data' => [
                    'is_image_only' => $isImageOnly,
                    'has_text_content' => $hasTextContent,
                    'text_length' => $textLength,
                    'file_size' => filesize($pdfPath),
                    'analyzed_at' => date('Y-m-d H:i:s')
                ]
            ];
        } catch (Exception $e) {
            return [
                'success' => false,
                'error' => $e->getMessage()
            ];
        }
    }

    /**
     * 複数のPDFを分析
     *
     * @param array $pdfPaths PDFファイルパスの配列
     * @return array 分析結果の配列
     */
    public function analyzeMultiple(array $pdfPaths): array
    {
        $results = [];

        foreach ($pdfPaths as $path) {
            $results[$path] = $this->analyze($path);
        }

        return $results;
    }

    /**
     * PDFからテキストを抽出
     *
     * @param string $pdfPath
     * @param int $page
     * @return string
     */
    private function extractText(string $pdfPath, int $page = 1): string
    {
        $command = sprintf(
            'pdftotext -f %d -l %d %s -',
            $page,
            $page,
            escapeshellarg($pdfPath)
        );

        $output = shell_exec($command);

        if ($output === null) {
            throw new RuntimeException('Failed to execute pdftotext');
        }

        return trim($output);
    }

    /**
     * PDFの画像情報を取得
     *
     * @param string $pdfPath
     * @return string
     */
    private function getImageInfo(string $pdfPath): string
    {
        $command = sprintf(
            'pdfimages -list %s',
            escapeshellarg($pdfPath)
        );
        $output = shell_exec($command);

        if ($output === null) {
            throw new RuntimeException('Failed to execute pdfimages');
        }

        return $output;
    }
} //end class PDFAnalyzer

?>
