<?php
/**
 * comistream/code/intstallThemeDir.php
 *
 * 主にコンテナ実行時に実行環境入れ替えたときに、コンテナ起動直後に呼ばれてweb rootにthemeディレクトリをコピーするためのスクリプト
 *
 * @package     sorshi/comistream-reader
 * @author      Comistream Project.
 * @copyright   2024 Comistream Project.
 * @license     GPL3.0 License
 * @version     1.0.0
 * @link        https://github.com/sorshi/comistream-reader
 *
 */

// library
if (file_exists(__DIR__ . "/comistream_lib.php")) {
  require(__DIR__ . "/comistream_lib.php");
  writelog("DEBUG library file exist:" . __DIR__ . "/comistream_lib.php");
} else {
  exit(1);
}

global $writelog_process_name;
$writelog_process_name = "intstallThemeDir";

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
  // themeディレクトリのコピーと.htaccess設定
  installThemeFiles($dbh);
} else {
  // 初期設定 インストール直後なんでなにもしない
}

