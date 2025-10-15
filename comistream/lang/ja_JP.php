<?php
/**
 * 日本語言語ファイル
 *
 * Comistreamの日本語UI翻訳を提供します
 *
 * @package     sorshi/comistream-reader
 * @author      Comistream Project.
 * @copyright   2024 Comistream Project.
 * @license     GPL3.0 License
 * @version     1.0.1
 * @link        https://github.com/sorshi/comistream-reader
 */

return [
    // ヘッダーとナビゲーション
    'back' => '戻る',
    'full_size' => '原寸',
    'compressed' => '節約',
    'single_page' => '単頁',
    'spread_page' => '見開',
    'spread_fix' => '見開補正',
    'direction' => '綴方向',
    'direction_right' => '右綴',
    'direction_left' => '左綴',
    'fullscreen' => '全画面',
    'windowed' => '窓表示',
    'trimmingmode_trimming' => '余白除',
    'trimmingmode_normal' => '全体',
    'clock' => '時計',

    // エラーメッセージ
    'config_not_found' => '設定が見つかりません',
    'file_not_found' => 'ファイルが見つかりません',
    'invalid_config' => '設定内容が異常です',
    
    // システム関連エラー
    'invalid_arguments' => '引数が正しくありません',
    'database_execution_error' => 'DB実行エラーが発生しました',
    'system_error' => 'システムエラー',
    'not_found_files' => '必要なファイルが見つかりません',
    
    // ファイル・アクセス関連エラー
    'file_not_readable' => 'ファイルが読めません',
    'file_processing_failed' => 'ファイルが処理できません',
    'invalid_file_type' => '未対応ファイルです',
    'pdf_file_error' => 'PDFファイルの読み込みに失敗しました',
    'access_denied' => 'アクセス拒否',
    
    // ディレクトリ・権限関連エラー
    'mkdir_failed' => 'ディレクトリ作成に失敗しました',
    'permission_error' => 'パーミッションエラーです',
    'symlink_failed' => 'シンボリックリンクの作成に失敗しました',
    
    // アーカイブ関連エラー
    'archive_corrupted' => 'アーカイブファイルが破損しています',
    'archive_expanding' => 'アーカイブの展開中です',
    'archive_open_failed' => 'アーカイブファイルの展開に失敗しました',
    
    // ライブストリーム関連エラー
    'guest_not_allowed' => 'ゲストユーザーはLiveStream機能を利用できません',
    'admin_only' => '管理者以外はLiveStream機能を利用できません',
    'livestream_config_not_found' => 'livestream.jsファイルがみつかりません',
    
    // 成功・完了メッセージ
    'cover_deleted' => '表紙画像とプレビュー画像を削除しました',
    'cover_update_failed' => '権限が足りないかファイルが指定されていません',
    'processing_complete' => '処理が正常に完了しました',
    
    // 詳細エラーメッセージ
    'file_not_found_detail' => '指定されたファイルは存在しないか削除された可能性があります',
    'permission_denied_detail' => 'このファイルにアクセスする権限がありません',
    'invalid_arguments_detail' => '?mode=open&file=[file/to/path.zip] のようにファイル情報を渡してください',
    'file_not_readable_detail' => 'パーミッションを確認してください',
    'file_processing_failed_detail' => '内部エラーです。ファイル名を修正すると解決する場合があります',
    'mkdir_failed_detail' => 'パーミッションを確認してください',
    'symlink_failed_detail' => 'サーバー側パーミッションを確認してください',
    'archive_corrupted_detail' => 'アーカイブが破損しています。利用することが出来ません。ファイルを確認してください',
    'archive_expanding_detail' => 'しばらく待ってもう一度ファイルを開いてください',
    'archive_open_failed_detail' => '非対応形式やファイルが異常などのケースが考えられます',
    'guest_not_allowed_detail' => 'サーバー設定でゲストユーザーはLiveStream機能を利用できません。ファイルをダウンロードするか直接再生してください',
    'admin_only_detail' => 'サーバー設定で管理者以外はLiveStream機能を利用できません。ファイルをダウンロードするか直接再生してください。管理者の場合はログインしてください',
    'database_connection_error' => 'データベースに接続できませんでした。管理者にお問い合わせください',
    'cache_dir_creation_failed' => 'キャッシュディレクトリ作成に失敗しました。サーバー側パーミッションを確認してください',
    'webserver_write_permission' => 'WebServerが書き込み出来るか確認してください',
    'reinstall_required' => '再インストールしてください',
    'upload_dir_creation_failed' => 'アップロード用ディレクトリを作成できませんでした',

    // その他のUI要素
    'loading' => '読み込み中',
    'page_of' => 'ページ目 / ',
    'connection_error' => '接続エラー',
    'language_selection' => '言語',

    // TOCメニュー
    'toc_cover' => '表紙',
    'last_page' => '最終ページ',
    'page_unit' => 'ページ',

    // 設定画面
    'settings' => '設定',
    'theme' => 'テーマ',
    'cache_size' => 'キャッシュサイズ',
    'quality' => '画質',

    // ログイン関連
    'login' => 'ログイン',
    'logout' => 'ログアウト',
    'username' => 'ユーザー名',
    'password' => 'パスワード',
    'admin_username' => '管理者ユーザー名',
    'admin_password' => '管理者パスワード',

    // ファイル操作
    'delete' => '削除',
    'rename' => '名前変更',
    'update' => '更新',

    // JavaScriptメッセージ
    'fullscreen_not_supported' => 'フルスクリーン非対応',
    'author_link_not_found' => '作者名のリンクが見つかりません。',
    'title_link_not_found' => '書名のリンクが見つかりません。',
    'input_alphanumeric' => '16文字までの半角英数字を入力してください',

    // Large page size notification
    'large_page_notification' => 'ページサイズが大きいため表示が重たい可能性があります。圧縮モードに切り換えるか、端末にダウンロードするとより快適になるかもしれません。',

    // Alt text for accessibility
    'alt_close_button' => '閉じるボタン',
    'alt_quick_spread_left' => 'クイック見開きモード左ページ',
    'alt_quick_spread_right' => 'クイック見開きモード右ページ',
];
