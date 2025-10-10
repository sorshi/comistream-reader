<?php

/**
 * Comistream Reader DB Library
 *
 * ComistreamのDB処理を提供するライブラリファイル。
 * データベースの操作、データの取得、データの更新、データの削除などの機能を実装しています。
 *
 * @package     sorshi/comistream-reader
 * @author      Comistream Project.
 * @copyright   2024 Comistream Project.
 * @license     GPL3.0 License
 * @version     2.0.0
 * @link        https://github.com/sorshi/comistream-reader
 */

/**
 * system_configテーブルから設定値を取得し、存在しなければデフォルト値を挿入します
 *
 * キャッシュ（$conf配列）を優先的にチェックし、パフォーマンスを向上させます。
 * DBに該当のキーが存在しない場合は、指定されたデフォルト値でINSERTを実行し、
 * そのデフォルト値を返します。
 *
 * @param PDO $dbh データベースハンドル
 * @param string $key 設定キー（system_configテーブルのkey列）
 * @param string|int|null $defaultValue キーが存在しない場合に使用するデフォルト値
 * @return string|int|null 設定値（存在する場合はDB値、存在しない場合はデフォルト値）
 *
 * @example
 * // キャッシュから取得（最速ルン！）
 * $value = checkSystemConfig($dbh, 'webRoot', '/var/www/html');
 *
 * // DBから取得してキャッシュに保存するルン
 * $cacheSize = checkSystemConfig($dbh, 'cacheSize', 3000);
 *
 * // 存在しないキーはデフォルト値でINSERTされるルン
 * $newSetting = checkSystemConfig($dbh, 'newFeature', 1);
 *
 * @since 2.0.0
 * @author Comistream Project
 */
function checkSystemConfig($dbh, $key, $defaultValue = null)
{
  // グローバルな$conf配列にアクセスするルン！
  global $conf;

  // まずはキャッシュをチェックするルン！これが一番速いルン☆
  if (isset($conf[$key])) {
    // writelog("DEBUG checkSystemConfig() キャッシュから取得ルン！ key:$key value:".$conf[$key]);
    return $conf[$key];
  }

  // キャッシュに無いから、DBから取得するルン！
  try {
    $query = "SELECT value FROM system_config WHERE key = :key";
    $stmt = $dbh->prepare($query);
    $stmt->bindValue(':key', $key, PDO::PARAM_STR);
    $stmt->execute();
    $row = $stmt->fetch(PDO::FETCH_ASSOC);

    if ($row) {
      // DBに値があったルン！キャッシュに保存して返すルン☆
      $conf[$key] = $row['value'];
      // writelog("DEBUG checkSystemConfig() DBから取得してキャッシュに保存したルン！ key:$key value:".$row['value']);
      return $row['value'];
    } else {
      // DBに無かったから、デフォルト値でINSERTするルン！
      if ($defaultValue !== null) {
        $insertQuery = "INSERT OR REPLACE INTO system_config (key, value) VALUES (:key, :value)";
        $insertStmt = $dbh->prepare($insertQuery);
        $insertStmt->bindValue(':key', $key, PDO::PARAM_STR);
        $insertStmt->bindValue(':value', $defaultValue, PDO::PARAM_STR);
        $insertStmt->execute();

        // キャッシュにも保存するルン！
        $conf[$key] = $defaultValue;
        writelog("NOTICE checkSystemConfig() Key not found in DB, inserted with default value. key:$key value:$defaultValue");
      }

      return $defaultValue;
    }
  } catch (PDOException $e) {
    // エラーが出ちゃったルン...でもデフォルト値を返すルン
    writelog("ERROR checkSystemConfig() DB error for key:$key - " . $e->getMessage());
    return $defaultValue;
  }
} // end function checkSystemConfig
