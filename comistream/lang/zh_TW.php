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
    'fullscreen' => '全螢幕',
    'trimmingmode_trimming' => '裁切邊緣',
    'trimmingmode_normal' => '完整顯示',
    'clock' => '時鐘',

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
]; 
