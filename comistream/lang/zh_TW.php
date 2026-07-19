<?php
/**
 * 台灣語言檔案
 *
 * 提供Comistream的台灣中文UI翻譯（Machine Translation）
 *
 * @package     sorshi/comistream-reader
 * @author      Comistream Project.
 * @copyright   2024 Comistream Project.
 * @license     GPL3.0 License
 * @version     1.0.1
 * @link        https://github.com/sorshi/comistream-reader
 */

return [
    // 頁首與導覽
    'back' => '返回',
    'full_size' => '原尺寸',
    'compressed' => '壓縮',
    'single_page' => '單頁',
    'spread_page' => '雙頁',
    'spread_fix' => '雙頁修正',
    'direction' => '閱讀方向',
    'direction_right' => '右翻',
    'direction_left' => '左翻',
    'fullscreen' => '全螢幕',
    'windowed' => '視窗顯示',
    'trimmingmode_trimming' => '裁切邊緣',
    'trimmingmode_normal' => '完整顯示',
    'clock' => '時鐘',
    'epub_menu' => '選單',
    'epub_font_size' => '字體大小',
    'epub_theme' => '背景',
    'epub_theme_paper' => '原稿',
    'epub_theme_white' => '白底',
    'epub_theme_dark' => '深色模式',
    'epub_theme_system' => '系統',
    'epub_flow_mode' => '顯示模式',
    'epub_flow_paginated' => '分頁',
    'epub_flow_scrolled' => '捲動',
    'epub_toc' => '目錄',
    'epub_progress' => '進度',
    'epub_jump_to_progress' => '移動到進度',
    'epub_prev_page' => '上一頁',
    'epub_next_page' => '下一頁',
    'epub_prev_section' => '上一章',
    'epub_next_section' => '下一章',
    'epub_auto' => '自動',
    'epub_override' => '覆寫',
    'epub_direction' => '閱讀方向',
    'epub_direction_ltr' => '由左至右',
    'epub_direction_rtl' => '由右至左',
    'epub_writing_mode' => '書寫方向',
    'epub_writing_horizontal' => '橫排',
    'epub_writing_vertical' => '直排',
    'epub_status_loading' => '載入中...',
    'epub_loading_opening' => '正在開啟 EPUB...',
    'epub_loading_fetching' => '正在載入 EPUB 資源...',
    'epub_loading_rendering' => '正在繪製內容...',
    'epub_load_failed' => 'EPUB載入失敗',
    'epub_offline_last_location' => '目前離線。上次位置：%s',
    'epub_inspector_title' => '標題',
    'epub_inspector_author' => '作者',
    'epub_inspector_language' => '語言',
    'epub_inspector_progress' => '進度',
    'epub_inspector_fraction' => '進度比例',
    'epub_inspector_section' => '章節',
    'epub_inspector_cfi' => 'CFI',
    'epub_inspector_renderer' => '渲染器',
    'epub_inspector_package_base' => '套件網址',
    'epub_inspector_signature_expiration' => '簽章有效期限',
    'epub_inspector_last_saved' => '最後儲存',
    'epub_unknown' => '未知',
    'tooltip_epub_prev_page' => '移動到上一頁',
    'tooltip_epub_next_page' => '移動到下一頁',
    'tooltip_epub_prev_section' => '跳到上一章或上一節',
    'tooltip_epub_next_section' => '跳到下一章或下一節',
    'tooltip_epub_flow_toggle' => '切換分頁顯示與捲動顯示',
    'tooltip_epub_font_decrease' => '縮小 EPUB 內文文字大小',
    'tooltip_epub_font_increase' => '放大 EPUB 內文文字大小',
    'tooltip_epub_theme_paper' => '切換為紙張色閱讀背景',
    'tooltip_epub_theme_white' => '切換為白色閱讀背景',
    'tooltip_epub_theme_dark' => '切換為深色閱讀背景',
    'tooltip_epub_theme_system' => '依照系統外觀設定切換',
    'tooltip_epub_direction_auto' => '使用 EPUB 指定的閱讀方向',
    'tooltip_epub_direction_ltr' => '固定為由左至右閱讀',
    'tooltip_epub_direction_rtl' => '固定為由右至左閱讀',
    'tooltip_epub_writing_auto' => '使用 EPUB 指定的書寫方向',
    'tooltip_epub_writing_horizontal' => '固定為橫書顯示',
    'tooltip_epub_writing_vertical' => '固定為直書顯示',

    // 錯誤訊息
    'config_not_found' => '找不到設定',
    'file_not_found' => '找不到檔案',
    'invalid_config' => '設定內容異常',
    
    // 系統相關錯誤
    'invalid_arguments' => '參數不正確',
    'database_execution_error' => '資料庫執行錯誤',
    'system_error' => '系統錯誤',
    'not_found_files' => '找不到必要檔案',
    
    // 檔案與存取相關錯誤
    'file_not_readable' => '檔案無法讀取',
    'file_processing_failed' => '檔案處理失敗',
    'invalid_file_type' => '不支援的檔案類型',
    'pdf_file_error' => 'PDF檔案載入失敗',
    'access_denied' => '存取被拒絕',
    
    // 目錄與權限相關錯誤
    'mkdir_failed' => '建立目錄失敗',
    'permission_error' => '權限錯誤',
    'symlink_failed' => '建立符號連結失敗',
    
    // 壓縮檔相關錯誤
    'archive_corrupted' => '壓縮檔已損壞',
    'archive_expanding' => '壓縮檔解壓縮中',
    'archive_open_failed' => '壓縮檔解壓縮失敗',
    
    // 直播串流相關錯誤
    'guest_not_allowed' => '訪客使用者無法使用直播串流功能',
    'admin_only' => '只有管理員可以使用直播串流功能',
    'livestream_config_not_found' => '找不到 livestream.js 檔案',
    
    // 成功與完成訊息
    'cover_deleted' => '封面圖片和預覽圖片已刪除',
    'cover_update_failed' => '權限不足或未指定檔案',
    'processing_complete' => '處理成功完成',
    
    // 詳細錯誤訊息
    'file_not_found_detail' => '指定的檔案不存在或可能已被刪除',
    'permission_denied_detail' => '您沒有存取此檔案的權限',
    'invalid_arguments_detail' => '請提供類似 ?mode=open&file=[file/to/path.zip] 的檔案資訊',
    'file_not_readable_detail' => '請檢查檔案權限',
    'file_processing_failed_detail' => '內部錯誤。修改檔案名稱可能可以解決此問題',
    'mkdir_failed_detail' => '請檢查權限',
    'symlink_failed_detail' => '請檢查伺服器端權限',
    'archive_corrupted_detail' => '壓縮檔已損壞。請檢查檔案',
    'archive_expanding_detail' => '請稍候再次嘗試開啟檔案',
    'archive_open_failed_detail' => '可能原因包括不支援的格式或檔案損壞',
    'guest_not_allowed_detail' => '伺服器設定不允許訪客使用者使用直播串流功能。請下載檔案或直接播放',
    'admin_only_detail' => '伺服器設定只允許管理員使用直播串流功能。請下載檔案或直接播放。如果您是管理員，請先登入',
    'database_connection_error' => '無法連接到資料庫。請聯絡管理員',
    'cache_dir_creation_failed' => '建立快取目錄失敗。請檢查伺服器端權限',
    'webserver_write_permission' => '請檢查網頁伺服器是否有寫入權限',
    'reinstall_required' => '請重新安裝',
    'upload_dir_creation_failed' => '建立上傳目錄失敗',

    // 其他UI元素
    'loading' => '載入中',
    'page_of' => '頁 / ',
    'connection_error' => '連線錯誤',
    'language_selection' => '語言',

    // 目錄選單
    'toc_cover' => '封面',
    'last_page' => '最後一頁',
    'page_unit' => '頁',

    // 設定畫面
    'settings' => '設定',
    'theme' => '主題',
    'cache_size' => '快取大小',
    'quality' => '畫質',

    // 登入相關
    'login' => '登入',
    'logout' => '登出',
    'username' => '使用者名稱',
    'password' => '密碼',
    'admin_username' => '管理員使用者名稱',
    'admin_password' => '管理員密碼',

    // 檔案操作
    'delete' => '刪除',
    'rename' => '重新命名',
    'update' => '更新',

    // JavaScript訊息
    'fullscreen_not_supported' => '不支援全螢幕',
    'author_link_not_found' => '找不到作者連結。',
    'title_link_not_found' => '找不到標題連結。',
    'input_alphanumeric' => '請輸入16字以內的半形英數字',

    // Large page size notification
    'large_page_notification' => '頁面大小較大，可能導致顯示緩慢。切換至壓縮模式或下載到您的裝置可能會改善效能。',

    // Alt text for accessibility
    'alt_close_button' => '關閉按鈕',
    'alt_quick_spread_left' => '快速雙頁模式左頁',
    'alt_quick_spread_right' => '快速雙頁模式右頁',

    // Tooltips for TOC menu buttons
    'tooltip_back' => '關閉閱讀器並返回上一個畫面',
    'tooltip_full_size' => '顯示原始圖片檔案。高畫質但資料用量較多',
    'tooltip_compressed' => '顯示壓縮圖片。減少資料用量但降低畫質。智慧型手機顯示通常已足夠清晰',
    'tooltip_single_page' => '逐頁顯示。最適合直向顯示。長按或空白鍵可快速雙頁顯示',
    'tooltip_spread_page' => '並排顯示兩頁。最適合橫向顯示',
    'tooltip_spread_fix' => '調整雙頁顯示模式中的左右頁位置',
    'tooltip_direction' => '變更閱讀方向',
    'tooltip_fullscreen' => '切換全螢幕和視窗顯示',
    'tooltip_trimmingmode_trimming' => '移除頁面四周邊緣。最適合掃描時留有大邊緣的圖片檔案',
    'tooltip_trimmingmode_normal' => '不裁切邊緣直接顯示圖片檔案',
    'tooltip_clock' => '在左上角顯示時間',
    'tooltip_inspector' => '在左下角顯示詳細資訊',
    'tooltip_language' => '切換顯示語言',
]; 
