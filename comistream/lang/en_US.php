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
];
