<?php
/**
 * English Language File
 *
 * Provides English UI translations for Comistream
 *
 * @package     sorshi/comistream-reader
 * @author      Comistream Project.
 * @copyright   2024 Comistream Project.
 * @license     GPL3.0 License
 * @version     1.0.1
 * @link        https://github.com/sorshi/comistream-reader
 */

return [
    // Header and Navigation
    'back' => 'Back',
    'full_size' => 'Full',
    'compressed' => 'Compressed',
    'single_page' => 'Single',
    'spread_page' => 'Spread',
    'spread_fix' => 'Fix Spread',
    'direction' => 'Direction',
    'direction_right' => 'Right-to-Left',
    'direction_left' => 'Left-to-Right',
    'fullscreen' => 'Fullscreen',
    'windowed' => 'Windowed',
    'trimmingmode_trimming' => 'Trimming',
    'trimmingmode_normal' => 'NoTrim',
    'clock' => 'Clock',
    'epub_menu' => 'Menu',
    'epub_font_size' => 'Font Size',
    'epub_theme' => 'Background',
    'epub_theme_paper' => 'Paper',
    'epub_theme_white' => 'White',
    'epub_theme_dark' => 'Dark Mode',
    'epub_theme_system' => 'System',
    'epub_flow_mode' => 'Flow',
    'epub_flow_paginated' => 'Page',
    'epub_flow_scrolled' => 'Scroll',
    'epub_toc' => 'Contents',
    'epub_progress' => 'Progress',
    'epub_jump_to_progress' => 'Jump to progress',
    'epub_prev_page' => 'Prev Page',
    'epub_next_page' => 'Next Page',
    'epub_prev_section' => 'Prev Chapter',
    'epub_next_section' => 'Next Chapter',
    'epub_auto' => 'Auto',
    'epub_override' => 'Override',
    'epub_direction' => 'Direction',
    'epub_direction_ltr' => 'Left-to-Right',
    'epub_direction_rtl' => 'Right-to-Left',
    'epub_writing_mode' => 'Writing',
    'epub_writing_horizontal' => 'Horizontal',
    'epub_writing_vertical' => 'Vertical',
    'epub_status_loading' => 'Loading...',
    'epub_loading_opening' => 'Opening EPUB...',
    'epub_loading_fetching' => 'Loading EPUB resources...',
    'epub_loading_rendering' => 'Rendering content...',
    'epub_load_failed' => 'Failed to load EPUB',
    'epub_offline_last_location' => 'Offline. Last saved location: %s',
    'epub_inspector_title' => 'Title',
    'epub_inspector_author' => 'Author',
    'epub_inspector_language' => 'Language',
    'epub_inspector_progress' => 'Progress',
    'epub_inspector_fraction' => 'Fraction',
    'epub_inspector_section' => 'Section',
    'epub_inspector_cfi' => 'CFI',
    'epub_inspector_renderer' => 'Renderer',
    'epub_inspector_package_base' => 'Package Base',
    'epub_inspector_signature_expiration' => 'Signature Expiration',
    'epub_inspector_last_saved' => 'Last Saved',
    'epub_unknown' => 'Unknown',
    'reader_markers' => 'Bookmarks',
    'reader_marker_default' => 'Bookmark',
    'reader_marker_add' => 'Add bookmark here',
    'reader_marker_edit' => 'Edit name',
    'reader_marker_delete' => 'Delete',
    'reader_marker_save' => 'Save',
    'reader_marker_cancel' => 'Cancel',
    'reader_marker_name_placeholder' => 'Bookmark name (optional)',
    'reader_marker_added' => 'Bookmark added.',
    'reader_marker_updated' => 'Bookmark updated.',
    'reader_marker_deleted' => 'Bookmark deleted.',
    'reader_marker_limit' => 'Up to 100 bookmarks can be added per book.',
    'reader_marker_error' => 'The bookmark operation failed.',
    'reader_marker_empty' => 'No bookmarks yet.',
    'reader_marker_page' => 'Page %s',
    'reader_marker_progress' => 'Progress %s%%',
    'reader_marker_section' => 'Chapter %s',
    'reader_marker_cluster' => '%s bookmarks',
    'tooltip_epub_prev_page' => 'Go to the previous page',
    'tooltip_epub_next_page' => 'Go to the next page',
    'tooltip_epub_prev_section' => 'Jump to the previous chapter or section',
    'tooltip_epub_next_section' => 'Jump to the next chapter or section',
    'tooltip_epub_flow_toggle' => 'Switch between paged and scrolling display',
    'tooltip_epub_font_decrease' => 'Decrease the EPUB text size',
    'tooltip_epub_font_increase' => 'Increase the EPUB text size',
    'tooltip_epub_theme_paper' => 'Use a paper-colored reading background',
    'tooltip_epub_theme_white' => 'Use a white reading background',
    'tooltip_epub_theme_dark' => 'Use a dark reading background',
    'tooltip_epub_theme_system' => 'Follow the system appearance setting',
    'tooltip_epub_direction_auto' => 'Use the reading direction specified by the EPUB',
    'tooltip_epub_direction_ltr' => 'Force left-to-right reading direction',
    'tooltip_epub_direction_rtl' => 'Force right-to-left reading direction',
    'tooltip_epub_writing_auto' => 'Use the writing direction specified by the EPUB',
    'tooltip_epub_writing_horizontal' => 'Force horizontal writing mode',
    'tooltip_epub_writing_vertical' => 'Force vertical writing mode',

    // Error Messages
    'config_not_found' => 'Configuration not found',
    'file_not_found' => 'File not found',
    'invalid_config' => 'Invalid configuration',
    
    // System Related Errors
    'invalid_arguments' => 'Invalid arguments',
    'database_execution_error' => 'Database execution error occurred',
    'system_error' => 'System Error',
    'not_found_files' => 'Required files not found',
    
    // File and Access Related Errors
    'file_not_readable' => 'File is not readable',
    'file_processing_failed' => 'File processing failed',
    'invalid_file_type' => 'Unsupported file type',
    'pdf_file_error' => 'Failed to load PDF file',
    'access_denied' => 'Access Denied',
    
    // Directory and Permission Related Errors
    'mkdir_failed' => 'Failed to create directory',
    'permission_error' => 'Permission error',
    'symlink_failed' => 'Failed to create symbolic link',
    
    // Archive Related Errors
    'archive_corrupted' => 'Archive file is corrupted',
    'archive_expanding' => 'Archive is being expanded',
    'archive_open_failed' => 'Failed to extract archive file',
    
    // LiveStream Related Errors
    'guest_not_allowed' => 'Guest users are not allowed to use LiveStream',
    'admin_only' => 'Only administrators are allowed to use LiveStream',
    'livestream_config_not_found' => 'livestream.js file not found',
    
    // Success and Completion Messages
    'cover_deleted' => 'Cover image and preview image deleted',
    'cover_update_failed' => 'Insufficient permissions or file not specified',
    'processing_complete' => 'Processing completed successfully',
    
    // Detailed Error Messages
    'file_not_found_detail' => 'The specified file does not exist or may have been deleted',
    'permission_denied_detail' => 'You do not have permission to access this file',
    'invalid_arguments_detail' => 'Please provide file information like ?mode=open&file=[file/to/path.zip]',
    'file_not_readable_detail' => 'Please check file permissions',
    'file_processing_failed_detail' => 'Internal error. Modifying the filename may resolve the issue',
    'mkdir_failed_detail' => 'Please check permissions',
    'symlink_failed_detail' => 'Please check server-side permissions',
    'archive_corrupted_detail' => 'Archive file is corrupted.Please check the file',
    'archive_expanding_detail' => 'Please wait a moment and try opening the file again',
    'archive_open_failed_detail' => 'Possible causes include unsupported format or file corruption',
    'guest_not_allowed_detail' => 'Server settings prevent guest users from using LiveStream. Please download the file or play directly',
    'admin_only_detail' => 'Server settings prevent non-administrators from using LiveStream. Please download the file or play directly. If you are an administrator, please log in',
    'database_connection_error' => 'Failed to connect to database. Please contact the administrator',
    'cache_dir_creation_failed' => 'Failed to create cache directory. Please check server-side permissions',
    'webserver_write_permission' => 'Please check if the web server has write permissions',
    'reinstall_required' => 'Please reinstall',
    'upload_dir_creation_failed' => 'Failed to create upload directory',

    // Other UI Elements
    'loading' => 'Loading',
    'page_of' => 'Page / ',
    'connection_error' => 'Connection Error',
    'language_selection' => 'Language',

    // TOC MENU
    'toc_cover' => 'Cover',
    'last_page' => 'Last Page',
    'page_unit' => 'page',

    // Settings Screen
    'settings' => 'Settings',
    'theme' => 'Theme',
    'cache_size' => 'Cache Size',
    'quality' => 'Quality',

    // Login Related
    'login' => 'Login',
    'logout' => 'Logout',
    'username' => 'Username',
    'password' => 'Password',
    'admin_username' => 'Administrator Username',
    'admin_password' => 'Administrator Password',

    // File Operations
    'delete' => 'Delete',
    'rename' => 'Rename',
    'update' => 'Update',

    // JavaScript Messages
    'fullscreen_not_supported' => 'Fullscreen not supported',
    'author_link_not_found' => 'Author link not found.',
    'title_link_not_found' => 'Title link not found.',
    'input_alphanumeric' => 'Please enter up to 16 alphanumeric characters',

    // Large page size notification
    'large_page_notification' => 'Large page size may cause slow display. Switching to compressed mode or downloading to your device may improve performance.',

    // Alt text for accessibility
    'alt_close_button' => 'Close button',
    'alt_quick_spread_left' => 'Quick spread mode left page',
    'alt_quick_spread_right' => 'Quick spread mode right page',

    // Tooltips for TOC menu buttons
    'tooltip_back' => 'Close the reader and return to the previous screen',
    'tooltip_full_size' => 'Display original image files without compression. Higher quality but uses more data',
    'tooltip_compressed' => 'Display compressed images. Reduces data usage but lowers quality. Often sufficient for smartphone displays',
    'tooltip_single_page' => 'Display pages one at a time. Optimal for portrait viewing. Long press or space key for quick spread view',
    'tooltip_spread_page' => 'Display two pages side by side. Optimal for landscape viewing',
    'tooltip_spread_fix' => 'Adjust left and right page alignment in spread view mode',
    'tooltip_direction' => 'Change the reading direction',
    'tooltip_fullscreen' => 'Toggle between fullscreen and windowed display',
    'tooltip_trimmingmode_trimming' => 'Remove margins from all sides of pages. Optimal for images with large margins from scanning',
    'tooltip_trimmingmode_normal' => 'Display images without trimming margins',
    'tooltip_clock' => 'Display time in the upper left corner',
    'tooltip_inspector' => 'Display detailed information in the lower left corner',
    'tooltip_language' => 'Switch display language',
];
