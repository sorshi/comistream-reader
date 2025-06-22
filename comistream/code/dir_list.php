<?php

require_once __DIR__ . '/comistream_lib.php';

// Script configuration
ini_set('output_buffering', 'On');
error_reporting(E_ALL);
ini_set('display_errors', 1);

// DB接続
$dbh = null;
if ($global_use_db_flag == 1) {
    $db_path = __DIR__ . '/../data/db/comistream.sqlite';
    if (file_exists($db_path)) {
        $DSN = "sqlite:" . $db_path;
        try {
            $dbh = new PDO($DSN);
            $dbh->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            $dbh->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        } catch (PDOException $e) {
            // In a real app, you'd want to log this error properly
            error_log('Connection failed: ' . $e->getMessage());
            // For security, don't echo detailed errors to the user
            http_response_code(500);
            echo "Database connection error.";
            exit;
        }
    }
}

// Read config from DB if connected
if ($dbh) {
    readConfig($dbh);
    global $conf;
    $cgiPath = $conf['cgiPath'] ?? '/cgi-bin/comistream.php';
    $hlsCgiPath = $conf['hlsCgiPath'] ?? '/cgi-bin/livestream.php';
    $bibiPath = $conf['bibiPath'] ?? '/bibi/';
    $publicDir = '';
} else {
    // Fallback to defaults if DB is not available
    $cgiPath = '/cgi-bin/comistream.php';
    $hlsCgiPath = '/cgi-bin/livestream.php';
    $bibiPath = '/bibi/';
    $publicDir = '';
}

// Define mappings from file extensions to icons.
// This replaces the AddIcon directives from .htaccess.
function get_icon_map() {
    return [
        // Special icons
        '__parent' => '/theme/icons/folder-home.png',
        '__dir' => '/theme/icons/folder.png',

        // Book-like files
        '.zip' => '/theme/icons/book.png', '.cbz' => '/theme/icons/book.png',
        '.rar' => '/theme/icons/book.png', '.pdf' => '/theme/icons/book.png',
        '.epub' => '/theme/icons/book.png', '.7z' => '/theme/icons/book.png',
        '.cb7' => '/theme/icons/book.png',

        // Other file types from the original .htaccess
        '.txt' => '/theme/icons/text.png',
        '.jpg' => '/theme/icons/image.png', '.jpeg' => '/theme/icons/image.png', '.png' => '/theme/icons/image.png', '.gif' => '/theme/icons/image.png', '.bmp' => '/theme/icons/image.png',
        '.mp3' => '/theme/icons/audio.png', '.wav' => '/theme/icons/audio.png', '.flac' => '/theme/icons/audio.png', '.m4a' => '/theme/icons/audio.png',
        '.mp4' => '/theme/icons/video.png', '.mkv' => '/theme/icons/video.png', '.avi' => '/theme/icons/video.png', '.mov' => '/theme/icons/video.png', '.wmv' => '/theme/icons/video.png', '.webm' => '/theme/icons/video.png',
        '.7z' => '/theme/icons/archive.png', '.bz2' => '/theme/icons/archive.png', '.cab' => '/theme/icons/archive.png', '.gz' => '/theme/icons/archive.png', '.tar' => '/theme/icons/archive.png',
        '.aac' => '/theme/icons/audio.png', '.aif' => '/theme/icons/audio.png', '.aifc' => '/theme/icons/audio.png', '.aiff' => '/theme/icons/audio.png', '.ape' => '/theme/icons/audio.png', '.au' => '/theme/icons/audio.png', '.iff' => '/theme/icons/audio.png', '.mid' => '/theme/icons/audio.png', '.mpa' => '/theme/icons/audio.png', '.ra' => '/theme/icons/audio.png', '.wma' => '/theme/icons/audio.png', '.f4a' => '/theme/icons/audio.png', '.f4b' => '/theme/icons/audio.png', '.oga' => '/theme/icons/audio.png', '.ogg' => '/theme/icons/audio.png', '.xm' => '/theme/icons/audio.png', '.it' => '/theme/icons/audio.png', '.s3m' => '/theme/icons/audio.png', '.mod' => '/theme/icons/audio.png',
        '.bin' => '/theme/icons/bin.png', '.hex' => '/theme/icons/bin.png',
        '.c' => '/theme/icons/c.png',
        '.xlsx' => '/theme/icons/calc.png', '.xlsm' => '/theme/icons/calc.png', '.xltx' => '/theme/icons/calc.png', '.xltm' => '/theme/icons/calc.png', '.xlam' => '/theme/icons/calc.png', '.xlr' => '/theme/icons/calc.png', '.xls' => '/theme/icons/calc.png', '.csv' => '/theme/icons/calc.png',
        '.iso' => '/theme/icons/cd.png',
        '.cpp' => '/theme/icons/cpp.png',
        '.css' => '/theme/icons/css.png', '.sass' => '/theme/icons/css.png', '.scss' => '/theme/icons/css.png',
        '.deb' => '/theme/icons/deb.png',
        '.doc' => '/theme/icons/doc.png', '.docx' => '/theme/icons/doc.png', '.docm' => '/theme/icons/doc.png', '.dot' => '/theme/icons/doc.png', '.dotx' => '/theme/icons/doc.png', '.dotm' => '/theme/icons/doc.png', '.log' => '/theme/icons/doc.png', '.msg' => '/theme/icons/doc.png', '.odt' => '/theme/icons/doc.png', '.pages' => '/theme/icons/doc.png', '.rtf' => '/theme/icons/doc.png', '.tex' => '/theme/icons/doc.png', '.wpd' => '/theme/icons/doc.png', '.wps' => '/theme/icons/doc.png',
        '.svg' => '/theme/icons/draw.png', '.svgz' => '/theme/icons/draw.png',
        '.ai' => '/theme/icons/eps.png', '.eps' => '/theme/icons/eps.png',
        '.exe' => '/theme/icons/exe.png',
        '.h' => '/theme/icons/h.png',
        '.html' => '/theme/icons/html.png', '.xhtml' => '/theme/icons/html.png', '.shtml' => '/theme/icons/html.png', '.htm' => '/theme/icons/html.png', '.URL' => '/theme/icons/html.png', '.url' => '/theme/icons/html.png',
        '.ico' => '/theme/icons/ico.png',
        '.jar' => '/theme/icons/java.png',
        '.js' => '/theme/icons/js.png', '.json' => '/theme/icons/js.png',
        '.md' => '/theme/icons/markdown.png',
        '.pkg' => '/theme/icons/package.png', '.dmg' => '/theme/icons/package.png',
        '.php' => '/theme/icons/php.png', '.phtml' => '/theme/icons/php.png',
        '.m3u' => '/theme/icons/playlist.png', '.m3u8' => '/theme/icons/playlist.png', '.pls' => '/theme/icons/playlist.png', '.pls8' => '/theme/icons/playlist.png',
        '.ps' => '/theme/icons/ps.png',
        '.psd' => '/theme/icons/psd.png',
        '.py' => '/theme/icons/py.png',
        '.rb' => '/theme/icons/rb.png',
        '.rpm' => '/theme/icons/rpm.png',
        '.rss' => '/theme/icons/rss.png',
        '.bat' => '/theme/icons/script.png', '.cmd' => '/theme/icons/script.png', '.sh' => '/theme/icons/script.png',
        '.sql' => '/theme/icons/sql.png',
        '.tiff' => '/theme/icons/tiff.png', '.tif' => '/theme/icons/tiff.png',
        '.nfo' => '/theme/icons/text.png',
        '.asf' => '/theme/icons/video.png', '.asx' => '/theme/icons/video.png', '.flv' => '/theme/icons/video.png', '.mov' => '/theme/icons/video.png', '.mpg' => '/theme/icons/video.png', '.rm' => '/theme/icons/video.png', '.srt' => '/theme/icons/video.png', '.swf' => '/theme/icons/video.png', '.vob' => '/theme/icons/video.png', '.m4v' => '/theme/icons/video.png', '.f4v' => '/theme/icons/video.png', '.f4p' => '/theme/icons/video.png', '.ogv' => '/theme/icons/video.png', '.m2t' => '/theme/icons/video.png', '.ts' => '/theme/icons/video.png',
        '.xml' => '/theme/icons/xml.png',
        '__default' => '/theme/icons/default.png'
    ];
}

function get_icon($filename, $is_dir) {
    $map = get_icon_map();
    if ($is_dir) return $map['__dir'];
    $ext = strtolower(strrchr($filename, '.'));
    return $map[$ext] ?? $map['__default'];
}

function format_size($bytes) {
    if ($bytes >= 1073741824) return number_format($bytes / 1073741824, 0) . 'G';
    if ($bytes >= 1048576) return number_format($bytes / 1048576, 0) . 'M';
    if ($bytes >= 1024) return number_format($bytes / 1024, 0) . 'K';
    if ($bytes > 0) return $bytes . 'B';
    return '-';
}

// Main script execution
$document_root = $_SERVER['DOCUMENT_ROOT'];
$request_path = urldecode($_GET['path'] ?? '');

writelog("INFO dir_list: Access to " . $request_path, "dir_list");

// Sanitize to prevent directory traversal
$request_path = str_replace('..', '', $request_path);
$physical_path = realpath($document_root . '/' . $request_path);

// Security check: ensure path is within doc root and exists
if ($physical_path === false || strpos($physical_path, $document_root) !== 0) {
    http_response_code(403);
    error_log("Forbidden access attempt: " . $request_path);
    echo "403 Forbidden";
    exit;
}

if (!is_dir($physical_path)) {
    http_response_code(404);
    error_log("Not found attempt: " . $request_path);
    echo "404 Not Found";
    exit;
}

$sort_by = strtolower($_GET['sort'] ?? 'name');
$sort_order = strtolower($_GET['order'] ?? 'asc');
if (!in_array($sort_by, ['name', 'lastmod', 'size'])) $sort_by = 'name';
if (!in_array($sort_order, ['asc', 'desc'])) $sort_order = 'asc';

$viewmode = $_COOKIE['viewmode'] ?? 'list';
$stylesheet_path = ($viewmode === 'cover') 
    ? '/theme/style_cover.css?2025062202'
    : '/theme/style.css?2025062202';

header('Content-Type: text/html; charset=utf-8');

// Define Javascript variables to be used in header/footer
$js_config = json_encode([
    'cgiPath' => $cgiPath,
    'hlsCgiPath' => $hlsCgiPath,
    'bibiPath' => $bibiPath,
    'publicDir' => $publicDir,
    'themeDir' => '', // themeDir seems to be consistently empty/root
    'currentPath' => $request_path,
    'loginUser' => $_COOKIE['comistreamUser'] ?? ''
]);

?>
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Index of <?php echo htmlspecialchars('/' . $request_path); ?></title>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
  <script>
    // Pass PHP config to Javascript
    const comistreamConfig = <?php echo $js_config; ?>;
    const cgiPath = comistreamConfig.cgiPath;
    const hlsCgiPath = comistreamConfig.hlsCgiPath;
    const bibiPath = comistreamConfig.bibiPath;
    const publicDir = comistreamConfig.publicDir;
    const themeDir = comistreamConfig.themeDir;
    const loginuser = comistreamConfig.loginUser;
  </script>
  <link rel="manifest" href="/theme/manifest.json" crossorigin="use-credentials">
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black">
  <meta name="apple-mobile-web-app-title" content="Comistream">
  <meta name="theme-color" content="#7799dd">
  <link rel="shortcut icon" href="/theme/icons/comistream.png" />
  <link rel="icon" type="image/png" href="/theme/icons/comistream.png" />
  <link rel="apple-touch-icon" href="/theme/icons/comistreamapp.png" />
  <link id="stylesheet" rel="stylesheet" href="<?php echo $stylesheet_path; ?>">
</head>
<body>

<?php readfile(__DIR__ . '/../theme/header.html'); ?>

<table id="indexlist">
  <thead>
    <tr class="indexhead">
      <th class="indexcolicon"><img src="/theme/icons/blank.png" alt="[ICO]"></th>
      <?php
      function print_sort_header($title, $sort_key, $current_sort_by, $current_sort_order, $request_path) {
          $order = ($current_sort_by === $sort_key && $current_sort_order === 'asc') ? 'desc' : 'asc';
          $class = 'indexcol' . $sort_key;
          if ($current_sort_by === $sort_key) {
              $class .= ' sort-' . $current_sort_order;
          }
          $url = '?path=' . urlencode($request_path) . '&sort=' . $sort_key . '&order=' . $order;
          echo '<th class="' . $class . '"><a href="' . htmlspecialchars($url) . '">' . $title . '</a></th>';
      }
      print_sort_header('Name', 'name', $sort_by, $sort_order, $request_path);
      print_sort_header('Last modified', 'lastmod', $sort_by, $sort_order, $request_path);
      print_sort_header('Size', 'size', $sort_by, $sort_order, $request_path);
      ?>
    </tr>
  </thead>
  <tbody>
    <?php
    if ($physical_path !== $document_root) {
        $parent_path = dirname('/' . rtrim($request_path, '/'));
        if (DIRECTORY_SEPARATOR !== '/') $parent_path = str_replace(DIRECTORY_SEPARATOR, '/', $parent_path);
        if ($parent_path === '/' || $parent_path === '.') $parent_path = '/';
        echo '<tr class="parent-dir-row">';
        $parent_icon_src = ($viewmode === 'cover') ? '/theme/icons/blank.png' : get_icon_map()['__parent'];
        echo '<td class="indexcolicon"><a href="' . htmlspecialchars($parent_path) . '"><img src="' . $parent_icon_src . '" alt="[PARENTDIR]"></a></td>';
        echo '<td class="indexcolname"><a href="' . htmlspecialchars($parent_path) . '">Parent Directory</a></td>';
        echo '<td class="indexcollastmod">&nbsp;</td>';
        echo '<td class="indexcolsize">-</td>';
        echo '</tr>';
    }

    $items = scandir($physical_path);
    $dirs = [];
    $files = [];

    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        $item_path = $physical_path . '/' . $item;
        $is_dir = is_dir($item_path);
        $stat = stat($item_path);
        $entry = [
            'name' => $item,
            'is_dir' => $is_dir,
            'size' => $is_dir ? -1 : $stat['size'],
            'lastmod' => $stat['mtime']
        ];
        if ($is_dir) $dirs[] = $entry;
        else $files[] = $entry;
    }
    
    $sort_func = function($a, $b) use ($sort_by, $sort_order) {
        $val_a = $a[$sort_by];
        $val_b = $b[$sort_by];
        $cmp = ($sort_by === 'name') ? strcasecmp($val_a, $val_b) : ($val_a <=> $val_b);
        return ($sort_order === 'asc') ? $cmp : -$cmp;
    };
    usort($dirs, $sort_func);
    usort($files, $sort_func);
    $sorted_items = array_merge($dirs, $files);

    foreach ($sorted_items as $item) {
        $icon = get_icon($item['name'], $item['is_dir']);
        $href = '/' . trim($request_path, '/') . '/' . rawurlencode($item['name']);
        $href = str_replace('//', '/', $href);
        if ($item['is_dir']) $href .= '/';

        echo '<tr>';
        // For directories in cover view, the icon is a background image on the link, not an img tag.
        // So, we provide a blank image for cover view directories to maintain layout.
        $icon_img_src = ($viewmode === 'cover' && $item['is_dir']) ? '/theme/icons/blank.png' : $icon;
        echo '<td class="indexcolicon"><a href="' . htmlspecialchars($href) . '"><img src="' . $icon_img_src . '" alt="[ICO]"></a></td>';
        echo '<td class="indexcolname"><a href="' . htmlspecialchars($href) . '"' . (!$item['is_dir'] ? ' id="' . htmlspecialchars($item['name']) . '"' : '') . '>' . htmlspecialchars($item['name']) . '</a></td>';
        echo '<td class="indexcollastmod">' . date('Y-m-d H:i', $item['lastmod']) . '</td>';
        echo '<td class="indexcolsize">' . format_size($item['size']) . '</td>';
        echo '</tr>';
    }
    ?>
  </tbody>
</table>

<?php readfile(__DIR__ . '/../theme/footer.html'); ?>

</body>
</html> 
