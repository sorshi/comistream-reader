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
 * @version     1.1.0
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


/**
 * syslogにログメッセージを出力します
 * 
 * アプリケーションのログメッセージをsyslogに書き込みます。
 * メッセージ内容に応じてログレベルを自動判定し、ファイル名と行番号情報を付加します。
 * 文字エンコーディングも自動変換するため、日本語メッセージも安全に出力できます。
 * 
 * @param string $messages ログメッセージ（改行文字は自動的にスペースに変換される）
 * @param string $processname プロセス名（デフォルト: 'Comistream'）
 * @return void
 * 
 * @example
 * // デバッグメッセージ
 * writelog("DEBUG 画像処理開始: input.jpg");
 * 
 * // エラーメッセージ
 * writelog("ERROR ファイルが見つかりません: /path/to/file.jpg");
 * 
 * // カスタムプロセス名
 * writelog("INFO カバー生成完了", "CoverGenerator");
 * 
 * // 緊急メッセージ（EMERG、ALERTなどを含む場合、適切なログレベルで記録）
 * writelog("EMERG システムが不安定な状態です");
 * 
 * @since 1.0.0
 * @author Comistream Project
 */
function writelog($messages, $processname = 'Comistream')
{
    global $writelog_process_name, $global_debug_flag;
    if (!empty($writelog_process_name)) {
        $processname = $writelog_process_name;
    }
    // UTFじゃないときだけ変換
    if ($messages && !mb_check_encoding($messages, 'UTF-8')) {
        $messages = mb_convert_encoding($messages, 'UTF-8', ['SJIS-win', 'eucJP-win', 'JIS', 'ASCII']);
    }

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

/**
 * エラー画面を表示してスクリプトを終了します
 * 
 * カスタマイズされたエラー画面を表示し、適切なHTTPステータスコードを設定して
 * スクリプトの実行を終了します。国際化対応しており、ユーザーの言語設定に
 * 応じて翻訳されたエラーメッセージを表示します。
 * 
 * @param string $titleKey エラーページのタイトルの翻訳キー
 * @param string $messageKey エラーメッセージ本文の翻訳キー（省略時はtitleKeyと同じ）
 * @param bool $isError trueの場合404エラー、falseの場合は通常レスポンス（デフォルト: true）
 * @param array $params 翻訳メッセージのパラメータ（sprintf形式、省略可）
 * @return void スクリプトはこの関数内で終了します（exit）
 * 
 * @example
 * // ファイル不存在エラー
 * errorExit('file_not_found', 'file_not_found_detail');
 * 
 * // 権限エラー
 * errorExit('access_denied', 'permission_denied_detail', true);
 * 
 * // 単なる情報表示（エラーではない）
 * errorExit('processing_complete', null, false);
 * 
 * // データベース接続エラー
 * errorExit('system_error', 'database_connection_error');
 * 
 * // パラメータ付きメッセージ（将来の拡張用）
 * errorExit('config_not_found', 'config_not_found', true, ['comistream.css']);
 * 
 * @since 1.0.0
 * @author Comistream Project
 */
function errorExit($titleKey, $messageKey = null, $isError = true, $params = [])
{
    // I18nインスタンスを取得
    $i18n = I18n::getInstance();

    // messageKeyが指定されていない場合はtitleKeyを使用
    if ($messageKey === null) {
        $messageKey = $titleKey;
    }

    // 翻訳された文字列を取得
    $title = $i18n->get($titleKey, $titleKey);
    $message = $i18n->get($messageKey, $messageKey);

    // パラメータがある場合はsprintfで処理
    if (!empty($params)) {
        $title = sprintf($title, ...$params);
        $message = sprintf($message, ...$params);
    }

    // HTMLエスケープ
    $titleEscaped = htmlspecialchars($title, ENT_QUOTES, 'UTF-8');
    $messageEscaped = htmlspecialchars($message, ENT_QUOTES, 'UTF-8');

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
    <title>$titleEscaped</title>
    <script>alert("$messageEscaped");window.history.back();</script>
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

        errorExit('cover_deleted', null, false);
    } else {
        writelog("INFO coverUpdate() guest user or no file: $user $file");
        errorExit('cover_update_failed');
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

        header("Content-type: application/json");
        $json = [];

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
                $isFavorite = $row['favorite'] == 1;
                if ($row['has_read'] === 1) {
                    $currentPage = ($row['current_page'] == 0) ? 1 : (int)$row['current_page'];
                    $maxPage = 0;
                } else {
                    $currentPage = (int)$row['current_page'];
                    $maxPage = (int)$row['max_page'];
                }
                $json[] = [
                    'file' => $row['base_file'],
                    'page' => $currentPage,
                    'max' => $maxPage,
                    'fav' => (bool)$isFavorite,
                ];
            }
            echo compressResponse(json_encode($json));
            writelog("DEBUG getBookmarkList() " . json_encode($json) . " with DB");
        } else {
            $bookmarkPath = "$bookmarkDir/$user/$file/bookmark";
            if (file_exists($bookmarkPath)) {
                $lines = @file($bookmarkPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
                if ($lines !== false) {
                    foreach ($lines as $line) {
                        $parts = explode("\t", $line);
                        if (count($parts) >= 3) {
                            $json[] = [
                                'file' => $parts[0],
                                'page' => (int)$parts[1],
                                'max' => (int)$parts[2],
                                'fav' => (isset($parts[3]) && trim($parts[3]) === '*'),
                            ];
                        }
                    }
                }
            }
            // echo json_encode($json);
            echo compressResponse(json_encode($json));
        }
    } else {
        header("Content-type: application/json");
        echo json_encode([]);
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
    $input_format = ' - ';
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
            // TODO 左右余白トリミングはlibvipsで行う ← 重すぎてメリットなかったんで廃止
            $crop_half_cmd = " | $convert " . '- -strip -crop 99%x99%+0+0 -fuzz 20% -trim +repage - ';
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
                // ファイルサイズ検証
                // 定数定義
                if (!defined('MAX_FILE_SIZE_BYTES')) {
                    define('MAX_FILE_SIZE_BYTES', 20 * 1024 * 1024); // 20MB
                }
                // 1. 7zaのリストコマンドでファイル情報を取得
                // -slt: 詳細なリスト形式で出力
                // -p: パスワード指定
                $command_list = sprintf(
                    'LANG=ja_JP.UTF8 %s l -slt %s %s',
                    $p7zip,
                    escapeshellarg($cacheDir . '/' . $file . '/file'),
                    escapeshellarg($pagefile)
                );

                // コマンドを実行し、出力を取得
                $output = shell_exec($command_list);
                // writelog("DEBUG outputPage() p7zip list output:" . $output);

                // 2. 出力から展開後のファイルサイズをパース
                // "Size = [数字]" の行を探す
                $unpackedSize = 0;
                if (preg_match('/^Size = (\d+)$/m', $output, $matches)) {
                    $unpackedSize = (int)$matches[1];
                } else {
                    // ... ファイル情報が取得できなかった場合のエラー処理
                    writelog("ERROR outputPage() Could not find the specified file in the archive.");
                }
                // ファイル情報が見つからない、またはサイズが0の場合はエラー
                if ($unpackedSize === 0) {
                    // エラー処理: 指定されたファイルがアーカイブ内に見つかりませんでした。
                    header("HTTP/1.1 500 Internal Server Error");
                    // showReloadRequiredImg(1);
                    writelog("ERROR outputPage() Could not find the specified file in the archive.");
                    deleteCacheDirAndReload();
                    exit;
                }

                // 3. ファイルサイズが上限を超えていないかチェック
                if ($unpackedSize > MAX_FILE_SIZE_BYTES) {
                    // エラー処理: ファイルサイズが大きすぎます。
                    header("HTTP/1.1 413 Content Too Large");
                    showReloadRequiredImg(3);
                    writelog("ERROR outputPage() The image file size (" . round($unpackedSize / 1024 / 1024) . "MB) exceeds the " . round(MAX_FILE_SIZE_BYTES / 1024 / 1024) . "MB limit.");
                    exit;
                } else {
                    writelog("DEBUG outputPage() The image file size (" . round($unpackedSize / 1024) . "KB) is within the " . round(MAX_FILE_SIZE_BYTES / 1024 / 1024) . "MB limit.");
                }

                $pageInput = "LANG=ja_JP.UTF8 $p7zip e -so \"$cacheDir/$file/file\" \"$pagefile\"";
            }
            // } elseif (preg_match('/\.(rar|cbr)$/i', $ext)) {
            // rarから1ページ切り出し
            // $pageInput = "LANG=ja_JP.UTF8 $unrar p -inul $cacheDir/$file/file \"{$pagefile}\"";
        } elseif (preg_match('/\.pdf$/i', $ext)) {
            // PDFから画像を抽出
            // TODO 全PDFをmutoolで処理するように
            // mutool poster -x 1 -y 1 -p $PAGE_NUM "$INPUT_PDF" "$SINGLE_PAGE_PDF" > /dev/null 2>&1
            // mutool extract -p "" -o "$WORK_DIR/img-%d.%s" "$SINGLE_PAGE_PDF" > /dev/null 2>&1
            // or draw

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
                    $input_format = "jpg:-";
                    writelog("DEBUG outputPage() PDF Extract jpg");
                } else {
                    // png,gif,tiff,jpg2000が規格上あり得る
                    $pageInput = "cat $cpdfTempDir/*{$file}-{$page}* | $convert jpeg:- ";
                    writelog("DEBUG outputPage() PDF convert jpg");
                }
            } else {
                // テキストを含むPDFは mutool > pdftoppm の優先順位でレンダリング
                // フラグファイル:$cacheDir/$file/TEXT_PDF
                $mutool = $conf["mutool"] ?? '';
                writelog("DEBUG outputPage() mutool:" . $mutool);

                if (!empty($mutool) && is_executable($mutool)) {
                    // mutoolが最速なので優先して使用
                    $pageInput = "$mutool draw -r 220 -h 1920 -F png -o - \"$cacheDir/$file/file\" $page";
                    $pagefile = "$page.png";
                    $input_format = "png:-"; // 入力はPNG
                    writelog("DEBUG outputPage() Using mutool for PDF rendering.");
                } else {
                    // 上記が使えない場合はpdftoppmにフォールバック
                    $pdftoppm = $conf["pdftoppm"];
                    $pageInput = "$pdftoppm -f $page -l $page -scale-to-x -1 -scale-to-y -1 -singlefile \"$cacheDir/$file/file\" ";
                    $pagefile = "$page.ppm";
                    $input_format = "ppm:-";
                    writelog("DEBUG outputPage() Using pdftoppm for PDF rendering, mutool not found or not executable.");
                }
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
                    $crop_half_cmd .= " | $convert $input_format -quality $quality webp:- ";
                    writelog("DEBUG outputPage() WebP Convert from ppm");
                } else {
                    $output_mime = "Content-type: image/jpeg";
                    $crop_half_cmd .= " | $convert $input_format -quality $quality jpeg:- ";
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
                // ファイルサイズチェック追加
                if (isImageSizeOverLimitAndErrorOutout($pageImg)) {
                    writelog("ERROR outputPage() Image size over limit.");
                    exit(1);
                } else {
                    header($output_mime);
                    header("Cache-Control: private, max-age=86400");
                    echo $pageImg;
                    writelog("DEBUG outputPage() filesize:" . strlen($pageImg));
                }
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

        // libvipsが利用可能なら高速処理を使用
        if (isVipsAvailable()) {
            writelog("DEBUG outputPage() Using libvips for image processing");

            if (strpos($_SERVER['HTTP_ACCEPT'], 'webp') !== false) {
                // WebP使えばlibvipsで高速処理（ライブラリ版）
                try {
                    // 画像バイナリを取得
                    $inputCmd = "$pageInput $crop_half_cmd";
                    writelog("DEBUG outputPage() vips input cmd:" . $inputCmd);
                    $imageBinary = shell_exec($inputCmd);

                    // ファイルサイズチェック追加
                    if (isImageSizeOverLimitAndErrorOutout($imageBinary)) {
                        writelog("ERROR outputPage() Image size over limit.");
                        exit(1);
                    }
                    if (strlen($imageBinary) > 0) {
                        // バイナリから画像を読み込み
                        $image = \Jcupitt\Vips\Image::newFromBuffer($imageBinary);

                        // 縮小処理
                        $currentWidth = $image->width;
                        $targetWidth = intval($width);

                        if ($targetWidth > 0 && $currentWidth > $targetWidth) {
                            $scale = $targetWidth / $currentWidth;
                            $image = $image->resize($scale, ['kernel' => 'lanczos3']);
                            writelog("DEBUG outputPage() vips resized with scale: $scale");
                        }

                        // WebP形式でバッファに出力
                        $pageImg = $image->writeToBuffer('.webp', ['Q' => intval($quality)]);

                        if (strlen($pageImg) == 0) {
                            header("Cache-Control: no-store");
                            writelog("ERROR Archive image cannot extract image. Delete cache and reload.$file");
                            deleteCacheDirAndReload();
                        } else {
                            header("Content-type: image/webp");
                            header("Cache-Control: private, max-age=86400");
                            echo $pageImg;
                            writelog("DEBUG outputPage() vips filesize:" . strlen($pageImg));
                        }
                    } else {
                        writelog("ERROR vips input command returned empty data");
                        $pageImg = null;
                    }
                } catch (\Jcupitt\Vips\Exception $e) {
                    writelog("ERROR vips processing failed: " . $e->getMessage());
                    // フォールバックコードは以下で実行される
                    $pageImg = null;
                }
            } else {
                // JPEGでlibvips高速処理（ライブラリ版）
                try {
                    // 画像バイナリを取得
                    $inputCmd = "$pageInput $crop_half_cmd";
                    writelog("DEBUG outputPage() vips input cmd:" . $inputCmd);
                    $imageBinary = shell_exec($inputCmd);

                    if (strlen($imageBinary) > 0) {
                        // バイナリから画像を読み込み
                        $image = \Jcupitt\Vips\Image::newFromBuffer($imageBinary);

                        // 縮小処理
                        $currentWidth = $image->width;
                        $targetWidth = intval($width);

                        if ($targetWidth > 0 && $currentWidth > $targetWidth) {
                            $scale = $targetWidth / $currentWidth;
                            $image = $image->resize($scale, ['kernel' => 'lanczos3']);
                            writelog("DEBUG outputPage() vips resized with scale: $scale");
                        }

                        // JPEG形式でバッファに出力
                        $pageImg = $image->writeToBuffer('.jpg', ['Q' => intval($quality)]);

                        if (strlen($pageImg) == 0) {
                            header("Cache-Control: no-store");
                            writelog("ERROR Archive image cannot extract image. Delete cache and reload.$file");
                            deleteCacheDirAndReload();
                        } else {
                            header("Content-type: image/jpeg");
                            header("Cache-Control: private, max-age=86400");
                            echo $pageImg;
                            writelog("DEBUG outputPage() vips filesize:" . strlen($pageImg));
                        }
                    } else {
                        writelog("ERROR vips input command returned empty data");
                        $pageImg = null;
                    }
                } catch (\Jcupitt\Vips\Exception $e) {
                    writelog("ERROR vips processing failed: " . $e->getMessage());
                    // フォールバックコードは以下で実行される
                    $pageImg = null;
                }
            }
        } else {
            // フォールバック：ImageMagickを使用
            writelog("DEBUG outputPage() Fallback to ImageMagick processing");

            if (strpos($_SERVER['HTTP_ACCEPT'], 'webp') !== false) {
                // WebP使えればファイルをWebPで出力
                // cwebpはAVIFに対応していないのでImageMagick convertで変換
                $cmd = "$pageInput $crop_half_cmd | $convert $input_format -define webp:emulate-jpeg-size=true -define webp:thread-level=1 -resize {$width}x -quality $quality webp:- ";
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
                $pageImg = shell_exec("$pageInput $crop_half_cmd | $convert $input_format -format jpeg -resize {$width}x -quality $quality jpeg:-");
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
    if (is_dir($cacheDir . '/' . $file)) {
        if (deleteDirectory($cacheDir . '/' . $file)) {
            writelog("DEBUG deleteCacheDirAndReload() delete dir $cacheDir/$file/");
        } else {
            writelog("ERROR deleteCacheDirAndReload() delete failed. $cacheDir/$file/");
        }
        showReloadRequiredImg();
    } else {
        writelog("CRITICAL NOT DIR $cacheDir/$file ");
    }
    exit(1);
} //end function deleteCacheDirAndReload


/**
 * 画像データが最大サイズ制限を超えているかと破損をチェックし、超過時にエラー処理を実行します
 * 
 * VIPSライブラリを使用して画像バッファからサイズ情報を取得し、
 * 幅8000px・高さ8000pxの制限を超えているかどうかを判定します。
 * 制限を超えている場合や画像処理でエラーが発生した場合は、
 * HTTPステータス413またはエラー画像を表示してtrueを返します。
 * 
 * @param string $pageImg 画像データのバイナリ
 * @return bool 画像サイズが制限を超えているかエラーが発生した場合はtrue、正常な場合はfalse
 * 
 * @throws \Jcupitt\Vips\Exception VIPS処理でエラーが発生した場合（内部でキャッチして処理）
 * 
 * @example
 * $imageData = file_get_contents('large_image.jpg');
 * if (isImageSizeOverLimitAndErrorOutout($imageData)) {
 *     // エラー処理は関数内で実行済み
 *     exit();
 * }
 * 
 * @see showReloadRequiredImg() エラー画像の表示に使用
 * @see writelog() エラーログの出力に使用
 * 
 * @since 20250802
 * @author Comistream Project
 */
function isImageSizeOverLimitAndErrorOutout($pageImg)
{
    // 最大イメージサイズ
    define("MAX_WIDTH", 8000);
    define("MAX_HEIGHT", 8000);
    if (isVipsAvailable()) {
        try {
            $image = \Jcupitt\Vips\Image::newFromBuffer($pageImg);

            if ($image->width > MAX_WIDTH || $image->height > MAX_HEIGHT) {
                // エラー処理: 解像度が大きすぎます。
                writelog("NOTICE isImageSizeOverLimitAndErrorOutout() image size is too large: " . $image->width . "x" . $image->height);
                header("HTTP/1.1 413 Content Too Large");
                // 画像表示 // ページサイズが大きすぎる
                showReloadRequiredImg(3);
                return true;
            } else {
                return false;
            }
        } catch (\Jcupitt\Vips\Exception $e) {
            // VipsExceptionがスローされた場合は、破損している可能性が高い
            // 例外メッセージをログに出力しておくとデバッグに役立ちます
            writelog("ERROR isImageSizeOverLimitAndErrorOutout() vips processing failed,may be broken image: " . $e->getMessage());
            showReloadRequiredImg(2);
            return true;
        }
    } else {
        writelog("CRITICAL isImageSizeOverLimitAndErrorOutout() vips is not available");
        return false;
    }
} //end function isImageSizeOverLimitAndErrorOutout

/**
 * libvipsライブラリが利用可能かどうかを判定します
 * 
 * 以下の条件を全て満たした場合にtrueを返します:
 * - PECL vips拡張がロードされている
 * - Composerのautoloadファイルが存在する
 * - Jcupitt\Vips\Imageクラスが存在する
 * 
 * @return bool libvipsが利用可能ならtrue、利用不可能ならfalse
 * 
 * @example
 * if (isVipsAvailable()) {
 *     // libvipsを使用した高速画像処理
 *     $result = vipsResizeStream($inputData, 800, 85, 'webp');
 * } else {
 *     // ImageMagickなどのフォールバック処理
 *     $result = shell_exec("convert input.jpg -resize 800x output.webp");
 * }
 * 
 * @see vipsConvert()
 * @see vipsResizeStream()
 * @see vipsThumbnail()
 * @see vipsGetImageInfo()
 * 
 * @since 20250721
 * @author Comistream Project
 */
function isVipsAvailable($fullLog = false)
{
    // global $conf;
    // test
    // return false;

    // PECLのvips拡張がロードされているかチェック
    if (!extension_loaded('vips')) {
        writelog("INFO isVipsAvailable() vips extension not loaded");
        return false;
    }

    // Composerのautoloadファイルが存在するかチェック
    $composerAutoload = __DIR__ . '/composer/vendor/autoload.php';
    if (!file_exists($composerAutoload)) {
        writelog("INFO isVipsAvailable() composer autoload not found: " . $composerAutoload);
        return false;
    }

    // autoloadを読み込み
    require_once $composerAutoload;

    // Jcupitt\Vips\Imageクラスが存在するかチェック
    if (!class_exists('\Jcupitt\Vips\Image')) {
        writelog("INFO isVipsAvailable() Jcupitt\\Vips\\Image class not found");
        return false;
    }

    // VIPSのバージョン情報をsyslogに出力
    if (!$fullLog) {

        try {
            // VIPS拡張のバージョン取得
            $vipsExtVersion = 'unknown';
            if (extension_loaded('vips')) {
                $vipsExtVersionInfo = phpversion('vips');
                if ($vipsExtVersionInfo !== false) {
                    $vipsExtVersion = $vipsExtVersionInfo;
                }
            }

            // libvipsの実際のバージョン取得（安全にチェック）
            $libvipsVersion = 'unknown';
            try {
                // 小さなテスト画像を作成してVIPSの動作確認とバージョン取得を試行
                $testImage = \Jcupitt\Vips\Image::black(1, 1);
                if ($testImage && method_exists($testImage, 'version')) {
                    $libvipsVersion = $testImage->version();
                } elseif (class_exists('\Jcupitt\Vips\Config')) {
                    // Configクラスがある場合はそこからバージョンを取得
                    $config = new \Jcupitt\Vips\Config();
                    if (method_exists($config, 'version')) {
                        $libvipsVersion = $config->version();
                    }
                }
            } catch (\Exception $e) {
                $libvipsVersion = 'detection failed';
            }

            // PHPラッパー（php-vips）のバージョン取得
            $phpVipsVersion = 'unknown';
            $composerLockPath = __DIR__ . '/composer/composer.lock';
            if (file_exists($composerLockPath)) {
                $lockContent = file_get_contents($composerLockPath);
                if ($lockContent !== false) {
                    $lockData = json_decode($lockContent, true);
                    if (isset($lockData['packages']) && is_array($lockData['packages'])) {
                        foreach ($lockData['packages'] as $package) {
                            if (isset($package['name']) && $package['name'] === 'jcupitt/vips' && isset($package['version'])) {
                                $phpVipsVersion = $package['version'];
                                break;
                            }
                        }
                    }
                }
            }

            // composer.jsonからの情報取得を試行
            if ($phpVipsVersion === 'unknown') {
                $composerJsonPath = __DIR__ . '/composer/composer.json';
                if (file_exists($composerJsonPath)) {
                    $jsonContent = file_get_contents($composerJsonPath);
                    if ($jsonContent !== false) {
                        $jsonData = json_decode($jsonContent, true);
                        if (isset($jsonData['require']['jcupitt/vips'])) {
                            $phpVipsVersion = $jsonData['require']['jcupitt/vips'];
                        }
                    }
                }
            }

            // パッケージ情報が取得できない場合、動作確認のみ
            if ($phpVipsVersion === 'unknown') {
                try {
                    $testImage = \Jcupitt\Vips\Image::black(1, 1);
                    if ($testImage) {
                        $phpVipsVersion = 'working (version unknown)';
                    }
                } catch (\Exception $e) {
                    $phpVipsVersion = 'error: ' . $e->getMessage();
                }
            }

            writelog("DEBUG isVipsAvailable() VIPS extension: $vipsExtVersion, libvips: $libvipsVersion, php-vips: $phpVipsVersion");
        } catch (\Exception $e) {
            writelog("WARN isVipsAvailable() version detection failed: " . $e->getMessage());
        }
    }

    writelog("DEBUG isVipsAvailable() vips is available via PECL and Composer");
    return true;
}

/**
 * libvipsを使用してファイルからファイルへの画像変換・処理を行います
 * 
 * この関数は現在未使用ですが、将来的な利用のために保持されています。
 * 高速な画像処理が可能で、リサイズ、フォーマット変換、品質調整などが行えます。
 * 
 * @param string $input 入力画像ファイルのパス
 * @param string $output 出力画像ファイルのパス
 * @param array $options 処理オプション
 *                       - 'resize': int サムネイルサイズ（最大辺の長さ）
 *                       - 'strip': bool メタデータを削除するかどうか
 *                       - 'quality': int JPEG品質（1-100）
 *                       - 'format': string 出力フォーマット（'webp', 'jpeg', 'png'）
 * @return bool 処理成功時はtrue、失敗時はfalse
 * 
 * @example
 * // JPEGをWebPに変換してリサイズ
 * $success = vipsConvert(
 *     '/path/to/input.jpg', 
 *     '/path/to/output.webp',
 *     ['resize' => 800, 'quality' => 80, 'format' => 'webp', 'strip' => true]
 * );
 * 
 * @since 未実装
 * @author Comistream Project
 */
function vipsConvert($input, $output, $options = [])
{
    if (!isVipsAvailable()) {
        return false;
    }

    try {
        writelog("INFO vipsConvert() start with input: $input, output: $output");

        // 画像を読み込み
        $image = \Jcupitt\Vips\Image::newFromFile($input);

        // リサイズオプションがある場合
        if (isset($options['resize'])) {
            $targetSize = intval($options['resize']);
            $scale = $targetSize / max($image->width, $image->height);
            if ($scale < 1) {
                $image = $image->resize($scale, ['kernel' => 'lanczos3']);
                writelog("DEBUG vipsConvert() resized to scale: $scale");
            }
        }

        // メタデータを削除（stripオプション）
        if (isset($options['strip']) && $options['strip']) {
            $image = $image->copy(['interpretation' => $image->interpretation]);
        }

        // 出力オプションを準備
        $saveOptions = [];
        if (isset($options['quality'])) {
            $saveOptions['Q'] = intval($options['quality']);
        }

        // フォーマットに基づいて保存
        $format = isset($options['format']) ? strtolower($options['format']) : 'jpeg';
        switch ($format) {
            case 'webp':
                $image->webpsave($output, $saveOptions);
                break;
            case 'png':
                $image->pngsave($output, $saveOptions);
                break;
            case 'jpeg':
            case 'jpg':
            default:
                $image->jpegsave($output, $saveOptions);
                break;
        }

        writelog("DEBUG vipsConvert() success");
        return true;
    } catch (\Jcupitt\Vips\Exception $e) {
        writelog("ERROR vipsConvert() failed: " . $e->getMessage());
        return false;
    }
}

/**
 * libvipsを使用してメモリ上で画像をリサイズし、バイナリデータとして返します
 * 
 * この関数は現在未使用ですが、将来的な利用のために保持されています。
 * ファイルまたはバイナリデータから画像を読み込み、指定幅にリサイズして
 * 指定フォーマットのバイナリデータとして返します。Webアプリケーションの
 * 画像配信に適しています。
 * 
 * @param string|resource $input 入力画像（ファイルパスまたはバイナリデータ）
 * @param int $width リサイズ後の幅（ピクセル）。アスペクト比は保持されます
 * @param int $quality 画像品質（1-100）。PNG以外のフォーマットで有効
 * @param string $format 出力フォーマット（'jpeg', 'webp', 'png'）
 * @return string|false 成功時は画像バイナリデータ、失敗時はfalse
 * 
 * @example
 * // ファイルからWebP形式でリサイズ
 * $imageData = vipsResizeStream('/path/to/image.jpg', 800, 85, 'webp');
 * if ($imageData !== false) {
 *     header('Content-Type: image/webp');
 *     echo $imageData;
 * }
 * 
 * // バイナリデータからJPEGでリサイズ  
 * $inputData = file_get_contents('/path/to/image.png');
 * $resizedData = vipsResizeStream($inputData, 600, 75, 'jpeg');
 * 
 * @since 未実装
 * @author Comistream Project
 */
function vipsResizeStream($input, $width, $quality = 75, $format = 'jpeg')
{
    if (!isVipsAvailable()) {
        return false;
    }

    try {
        writelog("DEBUG vipsResizeStream() start with width: $width, format: $format");

        // 画像データを読み込み (ファイルまたはバッファから)
        if (is_string($input) && file_exists($input)) {
            $image = \Jcupitt\Vips\Image::newFromFile($input);
        } else {
            // バッファから読み込む場合
            $image = \Jcupitt\Vips\Image::newFromBuffer($input);
        }

        // 現在の幅を取得して縮小率を計算
        $currentWidth = $image->width;
        $targetWidth = intval($width);

        if ($targetWidth > 0 && $currentWidth > $targetWidth) {
            $scale = $targetWidth / $currentWidth;
            $image = $image->resize($scale, ['kernel' => 'lanczos3']);
            writelog("DEBUG vipsResizeStream() resized with scale: $scale");
        }

        // フォーマットに応じてバッファに出力
        $saveOptions = ['Q' => intval($quality)];
        $format = strtolower($format);

        switch ($format) {
            case 'webp':
                $outputData = $image->writeToBuffer('.webp', $saveOptions);
                break;
            case 'png':
                $outputData = $image->writeToBuffer('.png', []);
                break;
            case 'jpeg':
            case 'jpg':
            default:
                $outputData = $image->writeToBuffer('.jpg', $saveOptions);
                break;
        }

        writelog("DEBUG vipsResizeStream() success, output size: " . strlen($outputData) . " bytes");
        return $outputData;
    } catch (\Jcupitt\Vips\Exception $e) {
        writelog("ERROR vipsResizeStream() failed: " . $e->getMessage());
        return false;
    }
}

/**
 * libvipsを使用してサムネイル画像を生成します
 * 
 * この関数は現在未使用ですが、将来的な利用のために保持されています。
 * 入力画像から指定サイズのサムネイルを作成し、ファイルに保存します。
 * アスペクト比を保持しながら、最大辺が指定サイズになるようにリサイズします。
 * 
 * @param string $input 入力画像ファイルのパス
 * @param string $output 出力サムネイルファイルのパス（拡張子で形式を判定）
 * @param int $size サムネイルサイズ（最大辺の長さをピクセルで指定）
 * @param int $quality 画像品質（1-100）。JPEG/WebPで有効、PNGでは無視
 * @return bool 処理成功時はtrue、失敗時はfalse
 * 
 * @example
 * // 300pxのJPEGサムネイルを作成
 * $success = vipsThumbnail('/path/to/large_image.jpg', '/path/to/thumb.jpg', 300, 85);
 * 
 * // WebPサムネイルを作成（拡張子で自動判定）
 * $success = vipsThumbnail('/path/to/photo.png', '/path/to/thumb.webp', 200, 80);
 * 
 * // PNGサムネイル（品質設定は無効）
 * $success = vipsThumbnail('/path/to/logo.svg', '/path/to/thumb.png', 150);
 * 
 * @since 未実装
 * @author Comistream Project
 */
function vipsThumbnail($input, $output, $size, $quality = 75)
{
    if (!isVipsAvailable()) {
        return false;
    }

    try {
        writelog("DEBUG vipsThumbnail() start with size: $size, quality: $quality");

        // 画像を読み込み
        $image = \Jcupitt\Vips\Image::newFromFile($input);

        // サムネイルサイズを計算
        $targetSize = intval($size);
        $scale = $targetSize / max($image->width, $image->height);

        if ($scale < 1) {
            // リサイズ
            $image = $image->resize($scale, ['kernel' => 'lanczos3']);
            writelog("DEBUG vipsThumbnail() resized to scale: $scale");
        }

        // 出力フォーマットを拡張子から判定
        $pathInfo = pathinfo($output);
        $extension = strtolower($pathInfo['extension'] ?? '');

        $saveOptions = [];
        if ($extension !== 'png') {
            $saveOptions['Q'] = intval($quality);
        }

        // フォーマットに応じて保存
        switch ($extension) {
            case 'webp':
                $image->webpsave($output, $saveOptions);
                break;
            case 'png':
                $image->pngsave($output, []);
                break;
            case 'jpg':
            case 'jpeg':
            default:
                $image->jpegsave($output, $saveOptions);
                break;
        }

        writelog("DEBUG vipsThumbnail() success");
        return true;
    } catch (\Jcupitt\Vips\Exception $e) {
        writelog("ERROR vipsThumbnail() failed: " . $e->getMessage());
        return false;
    }
}

/**
 * libvipsを使用して画像ファイルの基本情報を取得します
 * 
 * 指定された画像ファイルから幅、高さ、アスペクト比を高速で取得します。
 * libvipsが利用できない場合はfalseを返します。
 * 
 * @param string $imagePath 画像ファイルのパス
 * @return array|false 成功時は画像情報の連想配列、失敗時はfalse
 *                     連想配列の形式: ['width' => int, 'height' => int, 'ratio' => float]
 * 
 * @example
 * $info = vipsGetImageInfo('/path/to/image.jpg');
 * if ($info !== false) {
 *     echo "サイズ: {$info['width']}x{$info['height']}\n";
 *     echo "比率: {$info['ratio']}\n";
 *     
 *     if ($info['ratio'] > 1) {
 *         echo "横長画像\n";
 *     } elseif ($info['ratio'] < 1) {
 *         echo "縦長画像\n";  
 *     } else {
 *         echo "正方形画像\n";
 *     }
 * }
 * 
 * @since 20250721
 * @author Comistream Project
 */
function vipsGetImageInfo($imagePath)
{
    if (!isVipsAvailable()) {
        return false;
    }

    try {
        writelog("DEBUG vipsGetImageInfo() reading: $imagePath");

        // 画像を読み込み
        $image = \Jcupitt\Vips\Image::newFromFile($imagePath);

        // 画像情報を取得
        $width = $image->width;
        $height = $image->height;

        if ($width > 0 && $height > 0) {
            $ratio = $width / $height;

            writelog("DEBUG vipsGetImageInfo() success: {$width}x{$height}, ratio: $ratio");

            return [
                'width' => $width,
                'height' => $height,
                'ratio' => $ratio
            ];
        }

        writelog("ERROR vipsGetImageInfo() invalid dimensions: {$width}x{$height}");
        return false;
    } catch (\Jcupitt\Vips\Exception $e) {
        writelog("ERROR vipsGetImageInfo() failed: " . $e->getMessage());
        return false;
    }
}

/**
 * ディレクトリとその中身を再帰的に削除します
 * 
 * 指定されたディレクトリ内のファイル、サブディレクトリ、シンボリックリンクを
 * 全て削除してから、ディレクトリ自体を削除します。安全な削除処理を行います。
 * 
 * @param string $dir 削除対象のディレクトリパス
 * @return bool 削除成功時はtrue、失敗時はfalse
 * 
 * @example
 * // 一時ディレクトリを削除
 * if (deleteDirectory('/tmp/comistream_temp')) {
 *     echo "一時ディレクトリを削除しました\n";
 * } else {
 *     echo "削除に失敗しました\n";
 * }
 * 
 * // キャッシュディレクトリをクリーンアップ
 * $cacheDir = '/var/cache/comistream/book_123';
 * deleteDirectory($cacheDir);
 * 
 * @warning この関数は指定されたディレクトリを完全に削除します。
 *          実行前に削除対象が正しいことを確認してください。
 * 
 * @since 1.0.0
 * @author Comistream Project
 */
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
function showReloadRequiredImg($imageType = 1)
{
    global $conf;

    // キャッシュファイルが存在しない場合はリロードを促す画像を返す
    if ($imageType == 1) {
        // リロード
        $filePath = __DIR__ . "/../theme/reload_required.png";
    } elseif ($imageType == 2) {
        // ベージが破損している
        $filePath = __DIR__ . "/../theme/broken_page.png";
    } elseif ($imageType == 3) {
        // ページサイズが大きすぎる
        $filePath = __DIR__ . "/../theme/too_large_page.png";
    } else {
        $filePath = __DIR__ . "/../theme/reload_required.png";
    }
    header("Content-type: image/png");
    // $themeDir = $conf["webRoot"] . "/theme";
    // $filePath = $themeDir . "/reload_required.png";

    if (file_exists($filePath)) {
        readfile($filePath);
    } else {
        writelog("ERROR Cannot open file: $filePath");
    }
} //end function showReloadRequiredImg


/**
 * HTTPレスポンスコンテンツを圧縮します
 * 
 * クライアントがサポートする圧縮方式（zstd、gzip）を自動判定し、
 * 最適な圧縮方式でコンテンツを圧縮します。対応状況に応じて
 * 適切なContent-Encodingヘッダーも設定します。
 * 
 * @param string $content 圧縮対象のコンテンツ
 * @return string 圧縮済みのコンテンツ（圧縮できない場合は元のコンテンツをそのまま返す）
 * 
 * @example
 * // HTMLコンテンツを圧縮
 * $html = '<html><body>大きなHTMLコンテンツ...</body></html>';
 * $compressed = compressResponse($html);
 * echo $compressed;
 * 
 * // JSONレスポンスを圧縮
 * $jsonData = json_encode($largeDataArray);
 * header('Content-Type: application/json');
 * echo compressResponse($jsonData);
 * 
 * // 画像データなど（すでに圧縮済みのデータは効果が少ない）
 * $imageData = file_get_contents('large_image.jpg');
 * echo compressResponse($imageData);
 * 
 * @note クライアントのAccept-Encodingヘッダーを確認し、サポートされている場合のみ圧縮を行います
 * @note zstd > gzip > 無圧縮の優先順位で選択されます
 * 
 * @since 1.0.0
 * @author Comistream Project
 */
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
                return call_user_func('zstd_compress', $content);
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
            writelog("DEBUG compressResponse() no compress");
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
        errorExit('config_not_found', 'config_not_found');
    }

    // JavaScriptファイルの読み込み
    if (file_exists($conf["comistream_tool_dir"] . '/code/comistream.js')) {
        $contents_js = file_get_contents($conf["comistream_tool_dir"] . '/code/comistream.js');
        writelog("DEBUG JS file exist.");
    } else {
        writelog("ERROR JS not found:" . __DIR__);
        errorExit('config_not_found', 'config_not_found');
    }

    // 動作モード設定
    if ($size === 'FULL') {
        $size_button_flag = $i18n->get('compressed'); // 切り換え先を表示
        $size_button_class = 'button raw';
        // FULLサイズはモバイルネットワークではないと想定してプリロードページ数を4倍に
        $global_preload_pages *= 4;
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
<script src="$themeDir/theme/js/long-press-event.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/feather-icons/4.29.2/feather.min.js"></script>
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
        connection_error: "{$i18n->get('connection_error')}",
        toc_button_full: "{$i18n->get('full_size')}",
        toc_button_compress: "{$i18n->get('compressed')}",
        toc_button_fullsize: "{$i18n->get('full_size')}",
        toc_button_trimming: "{$i18n->get('trimmingmode_trimming')}",
        toc_button_normal: "{$i18n->get('trimmingmode_normal')}",
        large_page_notification: "{$i18n->get('large_page_notification')}"
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
            <img src="$themeDir/theme/icons/close.png" alt="{$i18n->get('alt_close_button')}" class="close" onclick="document.getElementById('contents').style.display='none'">
            <span class="button button-close" onclick="backListPage();">{$i18n->get('back')}</span>
            <span id="rawMode" class="$size_button_class button-mode" onclick="toggleRaw();">$size_button_flag</span>
            <span id="single" class="button button-mode" onclick="single()">{$i18n->get('single_page')}</span>
            <span id="spread" class="button button-mode" onclick="spread()">{$i18n->get('spread_page')}</span>
            <span class="button button-mode" onclick="fixSpreadPage()">{$i18n->get('spread_fix')}</span>
            <span class="button button-mode" id="direction" onclick="toggleDirection()">{$i18n->get('direction')}</span>
            <span class="button button-mode" id="fullScreenButton" onclick="toggleFullScreen()">{$i18n->get('fullscreen')}</span>
            <span class="$split_button_class button-mode" id="splitFile" onclick="toggleTrimmingFile()">$split_button_text</span>
            $langSelectorHtml
            <span class="clock-icon-button" id="clockToggleButton" onclick="toggleClock()"><i data-feather="clock"></i></span>
            <span class="inspector-icon-button" id="inspectorToggleButton" onclick="showInspector()"><i data-feather="info"></i></span>
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
        <img id="image1" alt="{$i18n->get('alt_quick_spread_left')}">
        <img id="image2" alt="{$i18n->get('alt_quick_spread_right')}">
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
        errorExit('file_not_readable', 'file_not_readable_detail');
    }

    // 表紙画像のパスを作成
    $file = preg_replace('/^(.*)\..*$/', '$1', $file);
    writelog("DEBUG \$file:" . $file);
    $coverFile = $conf["comistream_tool_dir"] . "/data/theme/covers" . $conf["publicDir"] . '/' . $file . ".jpg";
    $previewFile = $conf["comistream_tool_dir"] . "/data/theme/preview" . $conf["publicDir"] . '/' . $file . ".webp";

    // ファイルIDを作成
    $command_list = sprintf(
        "echo %s | %s | awk '{print \$1}'",
        escapeshellarg($openFile),
        $md5cmd
    );
    $fileHash = shell_exec($command_list);
    $fileHash = trim($fileHash);
    if (empty($fileHash)) {
        writelog("ERROR openPage() md5 hash failed." . $openFile);
        errorExit('file_processing_failed', 'file_processing_failed_detail');
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
            errorExit('mkdir_failed', 'cache_dir_creation_failed');
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
                    errorExit('symlink_failed', 'symlink_failed_detail');
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
        errorExit('invalid_file_type');
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

    // 7za l -slt でアーカイブ内容をリストし、同時に破損状態もチェック
    // アーカイプが朝臣しているとrawindex取り出すときに2で終わってerror返す、ことが多い
    // 7za tは850MBくらいのファイルでオープンするのに30秒くらい余計にかかるので廃止
    $list_cmd = "LANG=ja_JP.UTF8 $p7zip l -slt \"$cacheDir/$file/file\"";
    $list_output = [];
    $list_return_code = -1;
    exec($list_cmd . ' 2>&1', $list_output, $list_return_code);
    $list_output_text = implode("\n", $list_output);

    // リスト結果をrawindexに保存
    file_put_contents("$cacheDir/$file/rawindex", $list_output_text);
    // writelog("INFO openZipRar() rawindex saved:".$list_output_text);

    // アーカイブの状態を記録（後でisArchiveCorrupted()が参照）
    // $archive_status_data = [
    //     'list_return_code' => $list_return_code,
    //     'list_timestamp' => time(),
    //     'has_errors' => $list_return_code !== 0 || strpos($list_output_text, 'ERROR') !== false || strpos($list_output_text, 'WARNINGS') !== false
    // ];
    // file_put_contents("$cacheDir/$file/archive_list_status", json_encode($archive_status_data));

    if ($list_return_code !== 0) {
        writelog("ERROR openZipRar() Archive listing failed with return code: $list_return_code");
        writelog("ERROR openZipRar() 7-Zip output: " . $list_output_text);
        // アーカイブが破損している可能性が高い
        errorExit('archive_corrupted', 'archive_corrupted_detail');
    } else {
        writelog("DEBUG openZipRar() Archive listing successful, return code: $list_return_code");
    }

    // 画像ファイルを抽出
    $shell_cmd = "cat $cacheDir/$file/rawindex | grep \"Path = \" | grep -Pi \"\\.(jpg|jpeg|png|webp|avif|bmp|gif)\" | grep -v \"^\\._\" | grep -v \"/\\._\" | sed \"s/Path = //\" | sort -V | head -n 1";
    $firstFile = shell_exec($shell_cmd);
    $firstFile = rtrim($firstFile, "\n");
    writelog("DEBUG openZipRar() firstFile:" . $firstFile . " extracted from rawindex");

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
                errorExit('archive_expanding', 'archive_expanding_detail', false);
                exit(0);
            }
        } else {
            // 展開が重いのでLoading画面表示
            writelog("DEBUG openZipRar():" . $cacheDir . ':' . $conf["cacheDir"]);
            $command_list = sprintf(
                'LANG=ja_JP.UTF8 bash %s %s %s',
                $conf["comistream_tool_dir"] . '/code/nestedExtracter.sh',
                escapeshellarg($openFile),
                $cacheDir . '/' . $file
            );

            if ($cacheDir == $conf["cacheDir"]) {
                // リーダーを開いた場合
                writelog("DEBUG openZipRar() send nested loading page.");
                $fileSizeBytes = filesize($openFile);
                $fileSizeMB = round($fileSizeBytes / (1000 * 1000));
                printLoading($fileSizeMB);
                // $result = shell_exec("LANG=ja_JP.UTF8 bash " . $conf["comistream_tool_dir"] . "/code/nestedExtracter.sh \"$openFile\" $cacheDir/$file");
                $result = shell_exec($command_list);
                exit(0);
            } else {
                // バッチ処理で表紙作成を開いた場合
                $cacheDir = $conf["cacheDir"] . '/make_picture';
                $bookOpenCacheDir = $cacheDir . '/' . $file;
                if (!chkAndMakeDir($bookOpenCacheDir)) {
                    errorExit('mkdir_failed', 'mkdir_failed_detail');
                }
                // $result = shell_exec("LANG=ja_JP.UTF8 bash " . $conf["comistream_tool_dir"] . "/code/nestedExtracter.sh \"$openFile\" $cacheDir/$file");
                $result = shell_exec($command_list);
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
                errorExit('mkdir_failed', 'mkdir_failed_detail');
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
        errorExit('archive_open_failed', 'archive_open_failed_detail');
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
    global $conf, $cacheDir, $file, $cpdf, $traceFile, $async, $isPreCache, $existDir, $openFile;

    if ($isPreCache && !$existDir) {
        // キャッシュファイル保存領域にpdfファイル解凍
        shell_exec("cd $cacheDir/$file; $cpdf -extract-images -i \"$cacheDir/$file/file\" &>>$traceFile $async");
    }

    // 既にPDFタイプが判定済みかチェック
    if ((file_exists("$cacheDir/$file/IS_IMAGE_PDF") || file_exists("$cacheDir/$file/TEXT_PDF"))
        && file_exists("$cacheDir/$file/DONE")
    ) {
        writelog("DEBUG openPdf() PDF type already determined, skipping analysis");
        _preparePdfCache();
        return;
    } else {
        // 初回オープン時の画像PDFかテキストPDFかの判定フラグ書込
        writelog("DEBUG openPdf() Start PDF analysis.");
        $analyzer = new PDFAnalyzer();
        $result = $analyzer->analyze("$cacheDir/$file/file");
        if ($result['success']) {
            $data = $result['data'];
            // 結果の処理
            if ($data['is_image_only']) {
                touch("$cacheDir/$file/IS_IMAGE_PDF");
                writelog("INFO openPdf() PDF detect:This is an image-only PDF");
                _preparePdfCache();
            } else {
                touch("$cacheDir/$file/TEXT_PDF");
                writelog("INFO openPdf() PDF detect:This is a text PDF");

                if (!file_exists("$cacheDir/$file/DONE")) {
                    // テキストPDFでキャッシュがない場合、ローディング画面を表示してバックグラウンド処理
                    writelog("INFO openPdf() Text PDF cache not ready. Starting background preparation for $file.");
                    $fileSizeBytes = filesize($openFile);
                    $fileSizeMB = round($fileSizeBytes / (1000 * 1000));
                    printLoading($fileSizeMB);

                    // バックグラウンドでPDFの準備
                    _preparePdfCache();

                    // 完了フラグを作成
                    touch("$cacheDir/$file/DONE");
                    writelog("INFO openPdf() Background PDF preparation finished for $file.");
                    exit(0);
                } else {
                    // キャッシュがあるので通常の処理
                    writelog("INFO openPdf() Text PDF cache is ready. Loading from cache for $file.");
                    _preparePdfCache();
                }
            }
        } else {
            writelog("ERROR openPdf() PDF detect failed.:" . $result['error']);
            // 解析失敗時もとりあえず通常の準備処理を試みる
            _preparePdfCache();
        }
    }
} //end function openPdf

function _preparePdfCache()
{
    global $conf, $cacheDir, $file, $cpdf, $maxPage, $indexArray, $contents;

    $indexFilePath = "$cacheDir/$file/index";
    $tocFilePath = "$cacheDir/$file/toc.json";

    // Get maxPage
    if (file_exists($indexFilePath)) {
        $maxPage = trim(shell_exec("wc -l < " . escapeshellarg($indexFilePath)));
        writelog("DEBUG _preparePdfCache() maxPage from cache: $maxPage");
    } else {
        writelog("DEBUG _preparePdfCache() START pdfinfo ");
        $pdfinfo = $conf["pdfinfo"];
        if (empty($pdfinfo) || !is_executable($pdfinfo)) {
            writelog("DEBUG _preparePdfCache() pdfinfo is not available;retry with cpdf");
            $maxPage = shell_exec("$cpdf -pages -i \"$cacheDir/$file/file\"");
            $maxPage = trim($maxPage);
            writelog("DEBUG _preparePdfCache() COMPLETE $cpdf -pages -i \"$cacheDir/$file/file\" maxPage:" . $maxPage);
        } else {
            writelog("DEBUG _preparePdfCache() file path of pdfinfo:" . $pdfinfo);
            $maxPage = shell_exec("$pdfinfo \"$cacheDir/$file/file\" | grep Pages | awk '{print $2}'");
            $maxPage = trim($maxPage);
            writelog("DEBUG _preparePdfCache() $pdfinfo \"$cacheDir/$file/file\":" . $maxPage);
            if ((is_numeric($maxPage)) && ($maxPage >= 1)) {
                writelog("DEBUG _preparePdfCache() maxPage:" . $maxPage);
            } else {
                writelog("DEBUG _preparePdfCache() pdfinfo failed;retry with cpdf");
                $maxPage = shell_exec("$cpdf -pages -i \"$cacheDir/$file/file\"");
                $maxPage = trim($maxPage);
                writelog("DEBUG _preparePdfCache() COMPLETE $cpdf -pages -i \"$cacheDir/$file/file\" maxPage:" . $maxPage);
            }
        }

        // Validate page count
        if (!is_numeric($maxPage) || $maxPage < 1) {
            writelog("ERROR _preparePdfCache() Failed to get valid page count for PDF");
            throw new Exception("Unable to determine PDF page count");
        }
        shell_exec("seq -f \"p%g_.jpg\" $maxPage > " . escapeshellarg($indexFilePath));
    }

    // Get TOC
    if (file_exists($tocFilePath)) {
        $tocData = json_decode(file_get_contents($tocFilePath), true);
        $indexArray = $tocData['indexArray'];
        $contents = $tocData['contents'];
        writelog("DEBUG _preparePdfCache() TOC from cache.");
    } else {
        // 目次を作成
        // TODO pdftocgenで書き換えられないか検討
        $cmd = "$cpdf -utf8 -list-bookmarks -i \"$cacheDir/$file/file\"";
        writelog("DEBUG _preparePdfCache() executing command: $cmd");
        $raw_contents = shell_exec($cmd . " 2>&1");
        if (strlen($raw_contents) > 1) {
            // 目次情報を整形
            list($indexArray, $contents) = formatPdfContents($raw_contents);
        } else {
            // 目次がなかったら作成
            writelog("DEBUG _preparePdfCache() Make static TOC.");
            list($indexArray, $contents) = makeIndex($maxPage);
        }
        file_put_contents($tocFilePath, json_encode(['indexArray' => $indexArray, 'contents' => $contents]));
        writelog("DEBUG _preparePdfCache() TOC generated and cached.");
    }
} //end function _preparePdfCache

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


/**
 * 別プロセスを起動して表紙画像とプレビュー画像を作成します
 * 
 * 指定されたファイル（書籍・漫画ファイル）から表紙画像とプレビュー画像を
 * バックグラウンドプロセスで非同期生成します。すでに画像が存在する場合は
 * スキップされ、不要な重複処理を避けます。
 * 
 * @param string $coverProcessFile 処理対象ファイルのパス（URL エンコード対応）
 * @param string $coverFile 出力される表紙画像ファイルのパス
 * @param string $previewFile 出力されるプレビュー画像ファイルのパス
 * @return void 戻り値はありません（バックグラウンド処理で実行）
 * 
 * @example
 * // 書籍の表紙とプレビュー画像を生成
 * $bookPath = '/path/to/book.zip';
 * $coverPath = '/path/to/covers/book_cover.jpg';  
 * $previewPath = '/path/to/preview/book_preview.webp';
 * makeCover($bookPath, $coverPath, $previewPath);
 * 
 * // PDFファイルの場合
 * $pdfPath = '/path/to/document.pdf';
 * $coverPath = '/path/to/covers/pdf_cover.jpg';
 * $previewPath = '/path/to/preview/pdf_preview.webp';
 * makeCover($pdfPath, $coverPath, $previewPath);
 * 
 * @see make_cover_preview.php バックグラウンドで実行される実際の画像生成スクリプト
 * 
 * @since 1.0.0
 * @author Comistream Project
 */
function makeCover($coverProcessFile, $coverFile, $previewFile)
{
    global $conf, $make_coverpage_path, $coverFile, $previewFile;

    $previewProcessFile = $coverProcessFile;
    $make_coverpage_path = $conf["comistream_tool_dir"] . "/code";
    $coverDir = $conf["comistream_tool_dir"] . '/data/theme/covers';

    if (!chkAndMakeDir($coverDir)) {
        errorExit('mkdir_failed', 'mkdir_failed_detail');
    }
    $previewDir = $conf["comistream_tool_dir"] . '/data/theme/preview';

    if (!chkAndMakeDir($previewDir)) {
        errorExit('mkdir_failed', 'mkdir_failed_detail');
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
    $bookName = htmlspecialchars($bookName, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8'); // タグエスケープ
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
    // $pageTitle = htmlspecialchars($pageTitle, ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML5, 'UTF-8');
    $bookName = preg_replace('/\[(.*?)\] */', '', $bookName); // [ ] を捨てる

    // タグ付き作者名・書名 タグなし作者名・書名 書名のみ
    writelog("DEBUG get_book_title() bookName:$bookName pageTitle:$pageTitle onlyBookName:$onlyBookName");
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
                'mutool' => 'mutoolコマンドのパス。pdftocairoよりも高速なPDFレンダリングツールです。最優先で利用されます。',
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
        $i18n = I18n::getInstance();
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
    writelog("DEBUG updateSetting() $key:$value");
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


/**
 * 画像ファイルのアスペクト比（縦横比）を取得します
 * 
 * 指定された画像ファイルの縦横比を計算します。libvipsが利用可能な場合は
 * 高速処理を行い、利用できない場合はImageMagickにフォールバックします。
 * ファイルの存在チェックとサイズ検証も行います。
 * 
 * @param string $file_with_path 画像ファイルのフルパス
 * @return float|int 画像のアスペクト比（幅/高さ）。
 *                   - 1.0より大きい場合: 横長画像
 *                   - 1.0の場合: 正方形画像  
 *                   - 1.0未満の場合: 縦長画像
 *                   - 0: ファイルが存在しないかエラーが発生
 * 
 * @example
 * // 画像の向きを判定
 * $ratio = get_image_aspect_ratio('/path/to/image.jpg');
 * if ($ratio > 1.0) {
 *     echo "横長画像です（比率: $ratio）\n";
 * } elseif ($ratio < 1.0 && $ratio > 0) {
 *     echo "縦長画像です（比率: $ratio）\n";
 * } elseif ($ratio == 1.0) {
 *     echo "正方形画像です\n";
 * } else {
 *     echo "画像ファイルが読み込めませんでした\n";
 * }
 * 
 * // レイアウト判定での使用例
 * $aspectRatio = get_image_aspect_ratio($imagePath);
 * $isLandscape = ($aspectRatio > 1.33); // 4:3より横長
 * 
 * @since 1.0.0
 * @author Comistream Project
 */
function get_image_aspect_ratio($file_with_path)
{
    global $convert;

    if (!file_exists($file_with_path)) {
        writelog("WARNING get_image_aspect_ratio() no image file:" . $file_with_path);
        return 0;
    }

    // ファイルサイズをチェック
    $file_size = filesize($file_with_path);
    writelog("DEBUG get_image_aspect_ratio() file exists:" . $file_with_path . " size:" . $file_size . " bytes");

    // ファイルが極端に小さい場合は破損している可能性がある
    if ($file_size < 100) {
        writelog("WARNING get_image_aspect_ratio() file too small, possibly corrupted: " . $file_with_path);
        return 0;
    }

    // libvipsが利用可能なら高速処理を使用
    if (isVipsAvailable()) {
        writelog("DEBUG get_image_aspect_ratio() Using libvips for image info");

        $vipsInfo = vipsGetImageInfo($file_with_path);
        if ($vipsInfo && isset($vipsInfo['ratio'])) {
            writelog("DEBUG get_image_aspect_ratio() vips ratio {$vipsInfo['ratio']} width {$vipsInfo['width']} height {$vipsInfo['height']}");
            return $vipsInfo['ratio'];
        }

        // libvipsが失敗した場合はフォールバック
        writelog("DEBUG get_image_aspect_ratio() libvips failed, falling back to ImageMagick");
    }

    // フォールバック：ImageMagickを使用
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

    // shell_execの代わりにproc_openを使って詳細な情報を取得
    $command = "$magic -format \"%w,%h\" " . escapeshellarg($file_with_path);
    $descriptorspec = [
        0 => ["pipe", "r"],  // stdin
        1 => ["pipe", "w"],  // stdout
        2 => ["pipe", "w"]   // stderr
    ];

    $process = proc_open($command, $descriptorspec, $pipes);
    if (is_resource($process)) {
        fclose($pipes[0]); // stdin不要なので閉じる

        $stdout = stream_get_contents($pipes[1]);
        $stderr = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);

        $exit_code = proc_close($process);

        writelog("DEBUG get_image_aspect_ratio() command:$command exit_code:$exit_code stdout:" . trim($stdout));

        if (!empty($stderr)) {
            writelog("ERROR get_image_aspect_ratio() stderr:" . trim($stderr));
        }

        // ImageMagickが失敗した場合の処理
        if ($exit_code !== 0 || empty(trim($stdout))) {
            writelog("ERROR get_image_aspect_ratio() ImageMagick failed, exit_code:$exit_code");

            // 破損ファイルの可能性がある場合は削除を検討
            if (!empty($stderr) && (
                strpos($stderr, 'CRC error') !== false ||
                strpos($stderr, 'Read Exception') !== false ||
                strpos($stderr, 'Expected') !== false && strpos($stderr, 'bytes; found') !== false
            )) {
                writelog("WARNING get_image_aspect_ratio() corrupted file detected, consider removing:" . $file_with_path);
                // 自動削除はせず、ログに警告を出すだけに留める
            }

            return 0;
        }

        $return_value = $stdout;
    } else {
        writelog("ERROR get_image_aspect_ratio() failed to create process");
        return 0;
    }

    writelog("DEBUG get_image_aspect_ratio() ImageMagick format return_value:" . $return_value);
    $return_value = explode(',', $return_value);
    if (count($return_value) < 2) {
        writelog("ERROR get_image_aspect_ratio() invalid format return_value, expected 'width,height'");
        return 0;
    }

    $width = intval($return_value[0]);
    $height = intval($return_value[1]);

    if ($width <= 0 || $height <= 0) {
        writelog("ERROR get_image_aspect_ratio() invalid dimensions width:$width height:$height");
        return 0;
    }

    $ratio = ($width / $height);
    writelog("DEBUG get_image_aspect_ratio() ratio $ratio width $width height $height");
    return $ratio;
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
    $pdftoppm = exec('which pdftoppm');
    writelog("DEBUG handleInitialSetup() pdftoppm:$pdftoppm");
    $mutool = exec('which mutool');
    writelog("DEBUG handleInitialSetup() mutool:$mutool");
    $pdfinfo = exec('which pdfinfo');
    writelog("DEBUG handleInitialSetup() pdfinfo:$pdfinfo");
    $md5cmd = exec('which b3sum');
    writelog("DEBUG handleInitialSetup() md5cmd:$md5cmd");
    if (empty($md5cmd)) {
        $md5cmd = exec('which md5sum');
    }
    writelog("DEBUG handleInitialSetup() md5cmd:$md5cmd");
    // libvipsコマンドの検索
    // $vips = exec('which vips');
    // writelog("DEBUG handleInitialSetup() vips:$vips");
    // $vipsthumbnail = exec('which vipsthumbnail');
    // writelog("DEBUG handleInitialSetup() vipsthumbnail:$vipsthumbnail");

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
        errorExit('mkdir_failed', 'webserver_write_permission');
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
            errorExit('not_found_files', 'reinstall_required');
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
        $variablesToUpdate = ['p7zip', 'cpdf', 'ffmpeg', 'convert', 'montage', 'unzip', 'unrar', 'md5cmd', 'sharePath', 'comistream_tool_dir', 'webRoot', 'pdftoppm', 'pdfinfo', 'mutool', 'vips', 'vipsthumbnail'];
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
        errorExit('invalid_config', 'system_error');
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

        // libvipsコマンドの設定
        // $vips = $conf["vips"] ?? '';
        // $vipsthumbnail = $conf["vipsthumbnail"] ?? '';
        // $conf["vips"] = $vips;
        // $conf["vipsthumbnail"] = $vipsthumbnail;

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
        // mutoolのパスを確認
        if (!(isset($conf["mutool"]))) {
            $mutool = exec('which mutool') ?: '';
            sql_query($dbh, "INSERT OR REPLACE INTO system_config (key, value) VALUES('mutool', ?);", "クエリに失敗しました", array($mutool));
            $conf["mutool"] = $mutool;
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

/**
 * データベースクエリを安全に実行します
 * 
 * PDOを使用してプリペアードステートメントでSQL文を実行し、
 * SQLインジェクション攻撃を防ぎます。エラーが発生した場合は
 * 適切なエラーハンドリングを行います。
 * 
 * @param PDO $dbh データベースハンドル
 * @param string $query 実行するSQL文（プレースホルダーを使用可能）
 * @param string $errmessage エラー発生時に表示するメッセージ
 * @param array|null $paramarray バインドするパラメータ配列（オプション）
 * @return PDOStatement 実行済みのPDOStatementオブジェクト
 * 
 * @throws PDOException データベースエラーが発生した場合
 * 
 * @example
 * // パラメータなしのクエリ
 * $result = sql_query($dbh, "SELECT * FROM books", "書籍データの取得に失敗しました");
 * 
 * // パラメータありのクエリ
 * $result = sql_query(
 *     $dbh, 
 *     "SELECT * FROM books WHERE id = ?", 
 *     "書籍の検索に失敗しました",
 *     [$bookId]
 * );
 * 
 * // 名前付きパラメータの使用
 * $result = sql_query(
 *     $dbh,
 *     "INSERT INTO bookmarks (file, page, user) VALUES (:file, :page, :user)",
 *     "ブックマークの保存に失敗しました",
 *     [':file' => $filename, ':page' => $pageNum, ':user' => $username]
 * );
 * 
 * @since 1.0.0
 * @author Comistream Project
 */
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
        errorExit('database_execution_error');
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


/**
 * ディレクトリが存在しない場合に作成します
 * 
 * 指定されたディレクトリパスが存在しない場合、必要な親ディレクトリも含めて
 * 再帰的に作成します。適切なパーミッション（0777）が設定され、作成状況は
 * ログに記録されます。既に存在する場合はtrueを返します。
 * 
 * @param string $dir 作成するディレクトリのパス
 * @return bool 作成成功または既に存在する場合はtrue、失敗時はfalse
 * 
 * @example
 * // キャッシュディレクトリを作成
 * if (chkAndMakeDir('/var/cache/comistream/temp')) {
 *     echo "キャッシュディレクトリの準備完了\n";
 * } else {
 *     echo "ディレクトリ作成に失敗しました\n";
 * }
 * 
 * // 多階層のディレクトリも一度に作成
 * chkAndMakeDir('/app/data/books/covers/thumbnails');
 * 
 * // 条件付きディレクトリ作成
 * $uploadDir = '/uploads/user_' . $userId;
 * if (!chkAndMakeDir($uploadDir)) {
 *     errorExit("ディレクトリ作成エラー", "アップロード用ディレクトリを作成できませんでした");
 * }
 * 
 * @since 1.0.0
 * @author Comistream Project
 */
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
    public function __construct(int $minTextChars = 5)
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
            writelog("DEBUG analyze textLength:" . $textLength . " hasTextContent:" . ($hasTextContent ? 'true' : 'false'));

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
            ' pdftotext -f %d -l %d %s -',
            $page,
            $page + 3,
            escapeshellarg($pdfPath)
        );

        $output = shell_exec($command);
        // writelog("INFO analyze:extractText command:".$command);

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

##### PDFビューアーHTML出力（テキストPDF用） #####################################################################
function printPdfViewerHTML()
{
    // 大容量ファイルをダウンロードすることになるので一旦停止
    global $conf, $file, $bookName, $escapedFile, $cacheDir, $sharePath, $publicDir;

    // I18nインスタンスを取得
    $i18n = I18n::getInstance();

    // PDFファイルの実際のパスを取得
    $pdfPath = readlink("$cacheDir/$file/file");
    if ($pdfPath === false) {
        writelog("ERROR printPdfViewerHTML() Cannot read symlink: $cacheDir/$file/file");
        errorExit('pdf_file_error');
    }

    // 相対パスに変換（セキュリティのため）
    $relativePdfPath = str_replace($sharePath . '/', '', $pdfPath);
    $encodedPdfPath = urlEncodeFilePath($relativePdfPath);

    // PDFビューアー用のHTML
    $htmlContent = <<<HTML
<!DOCTYPE html>
<html lang="{$i18n->getCurrentLang()}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>$bookName - Comistream PDF Viewer</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            background-color: #2c2c2c;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            overflow: hidden;
        }

        .pdf-header {
            background-color: #1a1a1a;
            color: white;
            padding: 10px 20px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            z-index: 1000;
            position: relative;
        }

        .pdf-title {
            font-size: 16px;
            font-weight: 500;
            margin: 0;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            flex: 1;
        }

        .pdf-controls {
            display: flex;
            gap: 10px;
            align-items: center;
        }

        .btn {
            background-color: #4a4a4a;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
            transition: background-color 0.2s;
        }

        .btn:hover {
            background-color: #5a5a5a;
        }

        .btn-primary {
            background-color: #007bff;
        }

        .btn-primary:hover {
            background-color: #0056b3;
        }

        .pdf-container {
            width: 100%;
            height: calc(100vh - 60px);
            border: none;
        }

        .pdf-iframe {
            width: 100%;
            height: 100%;
            border: none;
            background-color: white;
        }

        .loading {
            display: flex;
            justify-content: center;
            align-items: center;
            height: calc(100vh - 60px);
            color: white;
            font-size: 18px;
        }

        @media (max-width: 768px) {
            .pdf-header {
                padding: 8px 15px;
            }

            .pdf-title {
                font-size: 14px;
            }

            .btn {
                padding: 6px 12px;
                font-size: 12px;
            }

            .pdf-controls {
                gap: 5px;
            }
        }
    </style>
</head>
<body>
    <div class="pdf-header">
        <h1 class="pdf-title">$bookName</h1>
        <div class="pdf-controls">
            <button class="btn" onclick="window.history.back();">{$i18n->get('back')}</button>
            <button class="btn btn-primary" onclick="downloadPdf();">Download</button>
        </div>
    </div>

    <div class="pdf-container">
        <div class="loading" id="loading">
            {$i18n->get('loading')}...
        </div>
        <iframe 
            class="pdf-iframe" 
            id="pdfFrame"
            src="$publicDir/$encodedPdfPath"
            style="display: none;"
            onload="hideLoading()">
        </iframe>
    </div>

    <script>
        function hideLoading() {
            document.getElementById('loading').style.display = 'none';
            document.getElementById('pdfFrame').style.display = 'block';
        }

        function downloadPdf() {
            const link = document.createElement('a');
            link.href = '$publicDir/$encodedPdfPath';
            link.download = '$bookName';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }

        // エラーハンドリング
        document.getElementById('pdfFrame').onerror = function() {
            document.getElementById('loading').innerHTML = 'PDFの読み込みに失敗しました。<br><a href="$publicDir/$encodedPdfPath" style="color: #007bff;">直接ダウンロード</a>';
        };

        // ページタイトルを設定
        document.title = '$bookName - Comistream PDF Viewer';
    </script>
</body>
</html>
HTML;

    // Content-Type ヘッダーを設定
    header('Content-Type: text/html; charset=utf-8');
    // レスポンスを圧縮して出力
    echo compressResponse($htmlContent);
    writelog("DEBUG printPdfViewerHTML() done for text PDF: $bookName");
} //end function printPdfViewerHTML


##### EPUB処理 ######################################################################
/**
 * EPUBファイルを開く処理
 * ファイルサイズに応じて直接bibiで開くか、事前展開してからbibiで開くかを決定
 */
function handleEpubOpen()
{
    global $conf, $file, $sharePath, $cacheDir, $md5cmd, $publicDir, $p7zip;

    writelog("DEBUG handleEpubOpen() start for file: $file");

    // ファイルパスの処理
    $file = preg_replace('/\.\.\//', '', $file);
    $file = str_replace('+', '%2B', $file);
    $file = urldecode($file);
    $epubFile = "$sharePath/$file";

    // ファイル存在チェック
    if (!file_exists($epubFile)) {
        writelog("ERROR handleEpubOpen() file not found: $epubFile");
        errorExit('file_not_found');
    }

    // ファイルサイズをチェック（5MB = 5 * 1024 * 1024 bytes）
    $fileSize = filesize($epubFile);
    $fileSizeMB = $fileSize / (1024 * 1024);
    writelog("DEBUG handleEpubOpen() file size: $fileSizeMB MB");

    // 5MB未満の場合は従来通り直接bibiで開く
    if ($fileSize < 5 * 1024 * 1024) {
        $encodedFilePath = rawurlencode($publicDir . '/' . $file);
        $bibiUrl = "/bibi/?book=" . $encodedFilePath;
        writelog("DEBUG handleEpubOpen() small file, redirecting directly to bibi: $bibiUrl");

        // 直接Bibiは積極的にキャッシュ
        header('Cache-Control: private, max-age=86400');
        header("Location: $bibiUrl", true, 302);
        exit(0);
    }

    // ファイルハッシュを生成
    $command_list = sprintf(
        "echo %s | %s | awk '{print \$1}'",
        escapeshellarg($epubFile),
        $md5cmd
    );
    $fileHash = shell_exec($command_list);
    $fileHash = trim($fileHash);

    if (empty($fileHash)) {
        writelog("ERROR handleEpubOpen() md5 hash failed: $epubFile");
        errorExit('file_processing_failed');
    }

    writelog("DEBUG handleEpubOpen() file hash: $fileHash");

    // キャッシュディレクトリパス
    $epubCacheDir = $cacheDir . '/' . $fileHash;

    // キャッシュが既に存在するかチェック
    // && file_exists($epubCacheDir . '/container.xml')
    if (is_dir($epubCacheDir)) {
        writelog("DEBUG handleEpubOpen() cache already exists, skipping extraction");
    } else {
        // キャッシュディレクトリがない場合は古いシンボリックリンクがあるかもしれないから削除
        // シンボリックリンクのパスを設定
        $webRoot = $conf['webRoot'] ?? '/home/dmng/public';
        $symlinkPath = $webRoot . '/theme/bibi/' . $fileHash;
        if (is_link($symlinkPath) && is_dir($symlinkPath)) {
            unlink($symlinkPath);
            writelog("DEBUG handleEpubOpen() old symlink removed: $symlinkPath");
        }
        // キャッシュディレクトリを作成
        if (!chkAndMakeDir($epubCacheDir)) {
            writelog("ERROR handleEpubOpen() failed to create cache directory: $epubCacheDir");
            errorExit('mkdir_failed', 'cache_dir_creation_failed');
        }

        writelog("DEBUG handleEpubOpen() extracting EPUB to cache: $epubCacheDir");

        // 7zipを使ってEPUBファイルを展開
        $cmd = $p7zip . " x -o\"$epubCacheDir\" \"$epubFile\"";
        exec($cmd, $output, $return_var);

        if ($return_var !== 0) {
            writelog("ERROR handleEpubOpen() failed to extract EPUB: $cmd");
            // 失敗したキャッシュディレクトリを削除
            if (is_dir($epubCacheDir)) {
                exec("rm -rf " . escapeshellarg($epubCacheDir));
            }
            errorExit('file_processing_failed');
        }

        writelog("DEBUG handleEpubOpen() EPUB extracted successfully");
    }

    // シンボリックリンクのパスを設定
    $webRoot = $conf['webRoot'] ?? '/home/dmng/public';
    $symlinkPath = $webRoot . '/theme/bibi/' . $fileHash;

    // シンボリックリンクが存在しない場合は作成
    if (!is_link($symlinkPath) && !is_dir($symlinkPath)) {
        // 親ディレクトリを作成
        $symlinkDir = dirname($symlinkPath);
        if (!is_dir($symlinkDir)) {
            if (!mkdir($symlinkDir, 0755, true)) {
                writelog("ERROR handleEpubOpen() failed to create symlink directory: $symlinkDir");
                errorExit('mkdir_failed');
            }
        }

        // シンボリックリンクを作成
        if (!symlink($epubCacheDir, $symlinkPath)) {
            writelog("ERROR handleEpubOpen() failed to create symlink: $epubCacheDir -> $symlinkPath");
            errorExit('symlink_failed');
        }

        writelog("DEBUG handleEpubOpen() symlink created: $symlinkPath");
    }

    // bibiにリダイレクト
    $bibiUrl = "/bibi/?book=/theme/bibi/$fileHash";
    writelog("DEBUG handleEpubOpen() redirecting to bibi: $bibiUrl");

    // 個人データを1日間ブラウザにキャッシュする設定
    header('Cache-Control: max-age=86400, private');
    header('Expires: ' . gmdate('D, d M Y H:i:s', time() + 86400) . ' GMT');
    header("Location: $bibiUrl", true, 302);
    exit(0);
} //end function handleEpubOpen

?>
