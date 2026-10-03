<?php
/**
 * 日本語言語ファイル
 *
 * Comistreamの日本語UI翻訳を提供します
 *
 * @package     sorshi/comistream-reader
 * @author      Comistream Project.
 * @copyright   2024 Comistream Project.
 * @license     AGPL-3.0-only for Comistream Reader project-specific portions; see repository-root LICENSING.md
 * @version     1.0.1
 * @link        https://github.com/sorshi/comistream-reader
 */

return [
    // ヘッダーとナビゲーション
    'back' => '戻る',
    'full_size' => 'オリジナル画質',
    'compressed' => '通信量節約表示',
    'single_page' => '1ページ表示',
    'spread_page' => '見開き表示',
    'auto_page' => '自動切替',
    'tooltip_auto_page' => '表示領域が横長なら見開き表示、それ以外は1ページ表示に切り替えます。横長画像は1枚で表示します。押すと1ページ表示に戻ります',
    'spread_fix' => '見開きの組み合わせを調整',
    'direction' => '読む方向',
    'direction_right' => '右から左',
    'direction_left' => '左から右',
    'fullscreen' => '全画面表示',
    'windowed' => '通常表示',
    'trimmingmode_trimming' => '余白カット',
    'trimmingmode_normal' => '余白あり',
    'clock' => '時計',
    'epub_menu' => 'メニュー',
    'epub_font_size' => '文字サイズ',
    'epub_theme' => '背景',
    'epub_theme_paper' => '原稿',
    'epub_theme_white' => 'ホワイト',
    'epub_theme_dark' => 'ダークモード',
    'epub_theme_system' => 'システム',
    'epub_flow_mode' => '表示形式',
    'epub_flow_paginated' => 'ページ表示',
    'epub_flow_scrolled' => 'スクロール表示',
    'epub_page_animation' => 'ページアニメーション',
    'epub_page_animation_toggle' => 'アニメーションを有効化',
    'epub_page_animation_help' => 'このブラウザの全EPUBに共通です。ページ表示で動作し、高速めくり中は演出を間引きます。OSの「視差効果を減らす」設定にも従います。',
    'epub_page_position' => 'ページ位置',
    'epub_page_position_toggle' => 'ページ位置を表示',
    'epub_page_position_help_label' => 'ページ位置の説明',
    'epub_page_position_help' => 'ページ位置「3–12」表記は、本の3番目の区切りの12画面目を表します。文字サイズや画面サイズを変えると番号も変わります。',
    'epub_section_progress' => '%s番目の区切り（全%s）',
    'epub_page_position_readout' => '本の%s番目の区切り、%s画面目',
    'epub_page_position_loading' => 'ページ位置を確認中',
    'epub_page_position_unavailable' => 'ページ位置を取得できません',
    'epub_toc' => '目次',
    'epub_progress' => '進捗',
    'epub_jump_to_progress' => '進捗へ移動',
    'epub_prev_page' => '前のページ',
    'epub_next_page' => '次のページ',
    'epub_prev_section' => '前の章',
    'epub_next_section' => '次の章',
    'epub_auto' => '自動',
    'epub_override' => '上書き',
    'epub_direction' => '読む方向',
    'epub_direction_ltr' => '左から右',
    'epub_direction_rtl' => '右から左',
    'epub_writing_mode' => '文字の向き',
    'epub_writing_horizontal' => '横書き',
    'epub_writing_vertical' => '縦書き',
    'epub_status_loading' => '読み込み中...',
    'epub_loading_opening' => 'EPUBを開いています...',
    'epub_loading_fetching' => 'EPUBリソースを読み込んでいます...',
    'epub_loading_rendering' => 'コンテンツを描画しています...',
    'epub_load_failed' => 'EPUBの読み込みに失敗しました',
    'epub_offline_last_location' => 'オフラインです。最後の位置: %s',
    'epub_inspector_title' => 'タイトル',
    'epub_inspector_author' => '著者',
    'epub_inspector_language' => '言語',
    'epub_inspector_progress' => '進捗',
    'epub_inspector_fraction' => '進捗率',
    'epub_inspector_section' => 'セクション',
    'epub_inspector_cfi' => 'CFI',
    'epub_inspector_renderer' => 'レンダラー',
    'epub_inspector_package_base' => 'パッケージURL',
    'epub_inspector_signature_expiration' => '署名有効期限',
    'epub_inspector_last_saved' => '最終保存',
    'epub_unknown' => '不明',
    'reader_markers' => 'しおり',
    'reader_marker_default' => 'しおり',
    'reader_marker_add' => 'この位置にしおりを追加',
    'reader_marker_edit' => '名前を編集',
    'reader_marker_delete' => '削除',
    'reader_marker_save' => '保存',
    'reader_marker_cancel' => 'キャンセル',
    'reader_marker_name_placeholder' => 'しおりの名前（任意）',
    'reader_marker_added' => 'しおりを追加しました。',
    'reader_marker_updated' => 'しおりを更新しました。',
    'reader_marker_deleted' => 'しおりを削除しました。',
    'reader_marker_limit' => 'しおりは1冊につき100個までです。',
    'reader_marker_error' => 'しおりを操作できませんでした。',
    'reader_marker_empty' => 'しおりはまだありません。',
    'reader_marker_page' => '%sページ',
    'reader_marker_progress' => '進捗 %s%%',
    'reader_marker_section' => '第%s章',
    'reader_marker_cluster' => 'しおり%s個',
    'tooltip_epub_prev_page' => '前のページへ移動します',
    'tooltip_epub_next_page' => '次のページへ移動します',
    'tooltip_epub_prev_section' => '前の章またはセクションへ移動します',
    'tooltip_epub_next_section' => '次の章またはセクションへ移動します',
    'tooltip_epub_flow_toggle' => 'ページ表示とスクロール表示を切り替えます',
    'tooltip_epub_font_decrease' => 'EPUB本文の文字サイズを小さくします',
    'tooltip_epub_font_increase' => 'EPUB本文の文字サイズを大きくします',
    'tooltip_epub_theme_paper' => '紙色の読書背景に切り替えます',
    'tooltip_epub_theme_white' => '白い読書背景に切り替えます',
    'tooltip_epub_theme_dark' => '暗い読書背景に切り替えます',
    'tooltip_epub_theme_system' => 'システムの明るさ設定に合わせます',
    'tooltip_epub_direction_auto' => 'EPUBで指定された綴じ方向を使用します',
    'tooltip_epub_direction_ltr' => '左から右へ読む方向に固定します',
    'tooltip_epub_direction_rtl' => '右から左へ読む方向に固定します',
    'tooltip_epub_writing_auto' => 'EPUBで指定された書字方向を使用します',
    'tooltip_epub_writing_horizontal' => '横書き表示に固定します',
    'tooltip_epub_writing_vertical' => '縦書き表示に固定します',

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

    // Tooltips for TOC menu buttons
    'tooltip_back' => 'リーダーを閉じて元の画面に戻ります',
    'tooltip_full_size' => 'オリジナルの画像ファイルをそのまま表示します。高画質ですが通信量が多くなります',
    'tooltip_compressed' => '画像を圧縮して表示します。通信量を抑えられますが画質は低下します。スマホサイズでは充分高画質なケースも多いです',
    'tooltip_single_page' => 'ページを1枚ずつ表示します。縦長の表示に最適です。長押しやスペースキーでクイック見開き表示が可能です',
    'tooltip_spread_page' => 'ページを2枚並べて表示します。横長の表示に最適です',
    'tooltip_spread_fix' => '見開き表示モードのときに左ページと右ページを補正します',
    'tooltip_direction' => '綴じ方向を変更します',
    'tooltip_fullscreen' => 'フルスクリーン表示とウィンドウ表示を切り替えます',
    'tooltip_trimmingmode_trimming' => 'ページの前後左右余白を取り除いて表示します。スキャン時に余白が大きい画像ファイルの表示に最適です',
    'tooltip_trimmingmode_normal' => '画像ファイルをトリミングせずそのまま表示します',
    'tooltip_clock' => '左上に時刻表示をします',
    'tooltip_inspector' => '左下に詳細情報を表示します',
    'tooltip_language' => '表示言語を切り替えます',
    'music_folder_actions' => 'フォルダ操作',
    'music_folder_play' => 'このフォルダ以下の音楽を再生',
    'music_queue' => '再生キュー',
    'music_playback_speed' => '再生速度',
    'reader_sync_forward' => '別の端末で%sページまで進んでいます。移動しますか？',
    'reader_sync_changed' => '別の端末で読書位置が%sページに変更されています。移動しますか？',
    'reader_sync_epub' => '別の端末で読書位置が更新されています。区切り%sの保存位置へ移動しますか？',
    'reader_sync_unsaved' => '読書位置をまだ同期できていません。接続を確認して、この端末で再度開いてください。',
];
