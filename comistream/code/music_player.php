<?php
/**
 * Comistream Reader - Music Player PHP
 *
 * 音楽ファイルの再生とプレイリスト管理を行います。
 * iOS 18 Safariでのバックグラウンド再生に対応しています。
 *
 * @package     sorshi/comistream-reader
 * @author      Comistream Project.
 * @copyright   2024 Comistream Project.
 * @license     GPL3.0 License
 * @version     1.0.0
 * @link        https://github.com/sorshi/comistream-reader
 */

// library
if (file_exists(__DIR__ . "/comistream_lib.php")) {
  require(__DIR__ . "/comistream_lib.php");
  writelog("DEBUG library file exist:" . __DIR__ . "/comistream_lib.php", 'MusicPlayer');
} else {
  exit(1);
}

// セッションスタート
session_start();

// DB接続
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
} else {
  errorExit("config invalid", "設定内容が異常です。");
}

// 設定ファイル読み込み
global $conf;
global $publicDir, $writelog_process_name;
$writelog_process_name = 'MusicPlayer';

readConfig($dbh);

// 対応音楽フォーマット
$audioFormats = ['mp3', 'mp4', 'm4a', 'aac', 'flac', 'aiff', 'aif', 'wav', 'wave', 'ogg', 'oga', 'wma'];

$mode = isset($_REQUEST['mode']) ? $_REQUEST['mode'] : '';
$file = isset($_REQUEST['file']) ? $_REQUEST['file'] : '';
$playlist_id = isset($_REQUEST['playlist_id']) ? $_REQUEST['playlist_id'] : '';

writelog("DEBUG QUERY mode:$mode file:$file playlist_id:$playlist_id", $writelog_process_name);

// Cookieの取得
$user = isset($_COOKIE['comistreamUser']) ? $_COOKIE['comistreamUser'] : 'guest';

// プレイリスト関連のDB テーブル作成
createMusicTables($dbh);

if ($mode == 'open' && $file != '') {
    // 音楽ファイルオープン
    openMusicPlayer();
} elseif ($mode == 'create_playlist') {
    // プレイリスト作成
    createPlaylist();
} elseif ($mode == 'add_to_playlist') {
    // プレイリストに楽曲追加
    addToPlaylist();
} elseif ($mode == 'get_playlists') {
    // プレイリスト一覧取得
    getPlaylists();
} elseif ($mode == 'get_playlist_tracks') {
    // プレイリストの楽曲一覧取得
    getPlaylistTracks();
} elseif ($mode == 'delete_playlist') {
    // プレイリスト削除
    deletePlaylist();
} else {
    errorExit("invalid mode", "無効なモードです。");
}

/**
 * 音楽プレイヤーテーブル作成
 */
function createMusicTables($dbh) {
    // プレイリストテーブル
    $sql = "CREATE TABLE IF NOT EXISTS music_playlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )";
    $dbh->exec($sql);

    // プレイリスト楽曲テーブル
    $sql = "CREATE TABLE IF NOT EXISTS music_playlist_tracks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        playlist_id INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        track_order INTEGER NOT NULL,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (playlist_id) REFERENCES music_playlists (id) ON DELETE CASCADE
    )";
    $dbh->exec($sql);
}

/**
 * 音楽プレイヤーを開く
 */
function openMusicPlayer() {
    global $conf, $file, $user, $audioFormats, $writelog_process_name;

    $file = str_replace('../', '', $file);
    $escapedFile = $file;
    $openFile = $conf['sharePath'] . "/$file";
    $openFile = str_replace('+', '%2B', $openFile);
    $openFile = urldecode($openFile);
    $baseFile = basename($openFile);

    // ファイル存在チェック
    if (!file_exists($openFile)) {
        errorExit("file not found", "ファイルが見つかりません: " . $baseFile);
    }

    // 音楽ファイルかチェック
    $extension = strtolower(pathinfo($openFile, PATHINFO_EXTENSION));
    if (!in_array($extension, $audioFormats)) {
        errorExit("unsupported format", "サポートされていない音楽フォーマットです: " . $extension);
    }

    // ディレクトリ内の音楽ファイル一覧を取得
    $directory = dirname($openFile);
    $musicFiles = [];
    $currentIndex = 0;

    if ($handle = opendir($directory)) {
        while (false !== ($entry = readdir($handle))) {
            if ($entry != "." && $entry != "..") {
                $fullPath = $directory . '/' . $entry;
                if (is_file($fullPath)) {
                    $ext = strtolower(pathinfo($entry, PATHINFO_EXTENSION));
                    if (in_array($ext, $audioFormats)) {
                        $musicFiles[] = [
                            'path' => str_replace($conf['sharePath'] . '/', '', $fullPath),
                            'name' => $entry
                        ];
                        if ($entry === $baseFile) {
                            $currentIndex = count($musicFiles) - 1;
                        }
                    }
                }
            }
        }
        closedir($handle);
    }

    // 音楽ファイルをソート
    usort($musicFiles, function($a, $b) {
        return strnatcmp($a['name'], $b['name']);
    });

    // ソート後にcurrentIndexを再計算（起動ファイルがズレる不具合の修正）
    foreach ($musicFiles as $idx => $mf) {
        if ($mf['name'] === $baseFile) {
            $currentIndex = $idx;
            break;
        }
    }

    // JavaScriptファイルの読み込み
    if (file_exists($conf["comistream_tool_dir"] . '/code/music_player.js')) {
        $contents_js = file_get_contents($conf["comistream_tool_dir"] . '/code/music_player.js');
        writelog("DEBUG JS file exist.", $writelog_process_name);
    } else {
        writelog("ERROR JS not found:" . __DIR__, $writelog_process_name);
        errorExit("config not found", "music_player.jsファイルがみつかりません。");
    }

    // 音楽ファイルリストをJSONに変換
    $musicFilesJson = json_encode($musicFiles);
    $themeDir = $conf["comistream_tool_dir"];

    // HTMLページ出力
    echo <<<HTML
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <!-- iOS 18 Safari PWA および バックグラウンド再生対応 -->
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="apple-mobile-web-app-title" content="Music Player">
    <meta name="theme-color" content="#667eea">
    <link rel="apple-touch-icon" href="/theme/icons/audio.png">
    <link rel="manifest" href="/theme/manifest.json">
    <title>$baseFile - Music Player</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            height: 100vh;
            overflow: hidden;
        }
        
        .music-player {
            display: flex;
            flex-direction: column;
            height: 100vh;
            max-width: 400px;
            margin: 0 auto;
            background: rgba(0, 0, 0, 0.3);
            backdrop-filter: blur(10px);
        }
        
        .player-header {
            text-align: center;
            padding: 20px;
            background: rgba(0, 0, 0, 0.2);
        }
        
        .album-art {
            width: 200px;
            height: 200px;
            border-radius: 15px;
            margin: 20px auto;
            background: rgba(255, 255, 255, 0.1);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 48px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }
        
        .track-info {
            text-align: center;
            padding: 20px;
        }
        
        .track-title {
            font-size: 20px;
            font-weight: bold;
            margin-bottom: 8px;
            word-break: break-word;
        }
        
        .track-artist {
            font-size: 16px;
            opacity: 0.8;
            margin-bottom: 20px;
        }
        
        .progress-container {
            padding: 0 30px;
            margin-bottom: 20px;
        }
        
        .progress-bar {
            width: 100%;
            height: 4px;
            background: rgba(255, 255, 255, 0.3);
            border-radius: 2px;
            margin: 10px 0;
            cursor: pointer;
        }
        
        .progress-fill {
            height: 100%;
            background: white;
            border-radius: 2px;
            width: 0%;
            transition: width 0.1s ease;
        }
        
        .time-display {
            display: flex;
            justify-content: space-between;
            font-size: 12px;
            opacity: 0.8;
        }
        
        .controls {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 20px;
            padding: 20px;
        }
        
        .control-btn {
            background: rgba(255, 255, 255, 0.2);
            border: none;
            border-radius: 50%;
            width: 50px;
            height: 50px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            color: white;
            font-size: 18px;
            transition: all 0.3s ease;
            position: relative;
        }
        
        .control-btn:hover {
            background: rgba(255, 255, 255, 0.3);
            transform: scale(1.1);
        }
        
        .play-pause-btn {
            width: 60px;
            height: 60px;
            font-size: 24px;
            background: rgba(255, 255, 255, 0.9);
            color: #333;
        }
        
        /* アイコンはISO/IEC 10646準拠のUnicode記号を使用 */
        .icon-play::before { content: '▶'; }
        .icon-pause::before { content: '⏸'; }
        .icon-prev::before { content: '⏮'; }
        .icon-next::before { content: '⏭'; }
        .icon-shuffle::before { content: '🔀'; }
        .icon-repeat::before { content: '🔁'; }
        .icon-repeat-one::before { content: '🔂'; }
        .icon-download::before { content: '⤓'; }
        .control-btn::before {
            font-size: 18px;
            line-height: 1;
        }
        
        .shuffle-active {
            background: rgba(255, 255, 255, 0.4) !important;
        }
        
        .repeat-active {
            background: rgba(255, 255, 255, 0.4) !important;
        }
        
        .volume-container {
            padding: 0 30px 20px;
        }
        
        .volume-slider {
            width: 100%;
            height: 4px;
            background: rgba(255, 255, 255, 0.3);
            border-radius: 2px;
            outline: none;
            -webkit-appearance: none;
        }
        
        .volume-slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: white;
            cursor: pointer;
        }
        
        .playlist-container {
            flex: 1;
            overflow-y: auto;
            padding: 20px;
            background: rgba(0, 0, 0, 0.2);
        }
        
        .playlist-item {
            padding: 10px;
            border-radius: 8px;
            margin-bottom: 8px;
            cursor: pointer;
            transition: background 0.2s ease;
            display: flex;
            align-items: center;
        }
        
        .playlist-item:hover {
            background: rgba(255, 255, 255, 0.1);
        }
        
        .playlist-item.active {
            background: rgba(255, 255, 255, 0.2);
        }
        
        .track-number {
            width: 30px;
            text-align: center;
            opacity: 0.6;
            font-size: 14px;
        }
        
        .track-name {
            flex: 1;
            padding-left: 10px;
            word-break: break-word;
        }

        .playlist-controls {
            padding: 15px 20px;
            background: rgba(0, 0, 0, 0.3);
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
        
        .playlist-btn {
            background: rgba(255, 255, 255, 0.2);
            border: none;
            border-radius: 20px;
            padding: 8px 16px;
            color: white;
            cursor: pointer;
            font-size: 14px;
            transition: background 0.3s ease;
        }
        
        .playlist-btn:hover {
            background: rgba(255, 255, 255, 0.3);
        }

        /* デスクトップ向けカスタムツールチップ */
        @media (hover: hover) and (pointer: fine) {
            .control-btn[data-tooltip] {
                position: relative;
            }
            .control-btn[data-tooltip]:hover::after {
                content: attr(data-tooltip);
                position: absolute;
                bottom: 110%;
                left: 50%;
                transform: translateX(-50%);
                background: rgba(0,0,0,0.75);
                color: #fff;
                padding: 6px 8px;
                border-radius: 6px;
                white-space: nowrap;
                font-size: 12px;
                pointer-events: none;
            }
            .control-btn[data-tooltip]:hover::before {
                filter: drop-shadow(0 0 2px rgba(0,0,0,0.3));
            }
        }

        .hidden {
            display: none;
        }

        @media (max-width: 480px) {
            .music-player {
                max-width: 100%;
            }
            
            .album-art {
                width: 150px;
                height: 150px;
                font-size: 36px;
            }
            
            .controls {
                gap: 15px;
            }
            
            .control-btn {
                width: 45px;
                height: 45px;
                font-size: 16px;
            }
            
            .play-pause-btn {
                width: 55px;
                height: 55px;
                font-size: 20px;
            }
        }
    </style>
</head>
<body>
    <div class="music-player">
        <div class="player-header">
            <div class="album-art">🎵</div>
        </div>
        
        <div class="track-info">
            <div class="track-title" id="trackTitle">$baseFile</div>
            <div class="track-artist" id="trackArtist">Unknown Artist</div>
        </div>
        
        <div class="progress-container">
            <div class="progress-bar" id="progressBar">
                <div class="progress-fill" id="progressFill"></div>
            </div>
            <div class="time-display">
                <span id="currentTime">0:00</span>
                <span id="totalTime">0:00</span>
            </div>
        </div>
        
        <div class="controls">
            <button class="control-btn icon-prev" id="prevBtn" title="前の曲" data-tooltip="前の曲"></button>
            <button class="control-btn play-pause-btn icon-play" id="playPauseBtn" title="再生" data-tooltip="再生"></button>
            <button class="control-btn icon-next" id="nextBtn" title="次の曲" data-tooltip="次の曲"></button>
            <button class="control-btn icon-shuffle" id="shuffleBtn" title="シャッフル: OFF" data-tooltip="シャッフル: OFF"></button>
            <button class="control-btn icon-repeat" id="repeatBtn" title="リピート: OFF" data-tooltip="リピート: OFF"></button>
            <a class="control-btn icon-download" id="downloadBtn" title="ダウンロード" data-tooltip="ダウンロード" href="#" download></a>
        </div>
        
        <div class="volume-container">
            <input type="range" class="volume-slider" id="volumeSlider" min="0" max="100" value="70">
        </div>

        <div class="playlist-controls">
            <button class="playlist-btn" id="showPlaylistBtn">プレイリスト</button>
            <button class="playlist-btn" id="createPlaylistBtn">新規作成</button>
            <button class="playlist-btn" id="addToPlaylistBtn">追加</button>
        </div>
        
        <div class="playlist-container" id="playlistContainer">
            <!-- プレイリストアイテムがここに動的に追加される -->
        </div>
    </div>
    
    <!-- iOS 18 Safari バックグラウンド再生対応のオーディオ要素 -->
    <audio id="audioPlayer" preload="auto" crossorigin="anonymous" playsinline webkit-playsinline x-webkit-airplay="allow"></audio>

    <script>
        // PHP から JavaScript へのデータ渡し
        window.musicFiles = $musicFilesJson;
        window.currentIndex = $currentIndex;
        window.user = '$user';
        window.themeDir = '$themeDir';
        window.baseDir = window.location.origin + '/';
    </script>
    
    <script>
        $contents_js
    </script>
</body>
</html>
HTML;

    writelog("DEBUG openMusicPlayer() completed for: $baseFile", $writelog_process_name);
}

/**
 * プレイリスト作成
 */
function createPlaylist() {
    global $dbh, $user, $writelog_process_name;
    
    $name = isset($_POST['name']) ? trim($_POST['name']) : '';
    $description = isset($_POST['description']) ? trim($_POST['description']) : '';
    
    if (empty($name)) {
        echo json_encode(['success' => false, 'error' => 'プレイリスト名は必須です']);
        return;
    }
    
    try {
        $sql = "INSERT INTO music_playlists (user, name, description) VALUES (?, ?, ?)";
        $stmt = $dbh->prepare($sql);
        $stmt->execute([$user, $name, $description]);
        
        $playlistId = $dbh->lastInsertId();
        
        echo json_encode(['success' => true, 'playlist_id' => $playlistId]);
        writelog("DEBUG createPlaylist() created playlist: $name for user: $user", $writelog_process_name);
    } catch (PDOException $e) {
        echo json_encode(['success' => false, 'error' => 'データベースエラー']);
        writelog("ERROR createPlaylist() DB error: " . $e->getMessage(), $writelog_process_name);
    }
}

/**
 * プレイリストに楽曲追加
 */
function addToPlaylist() {
    global $dbh, $user, $playlist_id, $file, $writelog_process_name;
    
    if (empty($playlist_id) || empty($file)) {
        echo json_encode(['success' => false, 'error' => 'パラメータが不足しています']);
        return;
    }
    
    $fileName = basename($file);
    
    try {
        // プレイリストの存在確認
        $sql = "SELECT id FROM music_playlists WHERE id = ? AND user = ?";
        $stmt = $dbh->prepare($sql);
        $stmt->execute([$playlist_id, $user]);
        
        if (!$stmt->fetch()) {
            echo json_encode(['success' => false, 'error' => 'プレイリストが見つかりません']);
            return;
        }
        
        // 次のtrack_orderを取得
        $sql = "SELECT COALESCE(MAX(track_order), 0) + 1 as next_order FROM music_playlist_tracks WHERE playlist_id = ?";
        $stmt = $dbh->prepare($sql);
        $stmt->execute([$playlist_id]);
        $nextOrder = $stmt->fetchColumn();
        
        // 楽曲をプレイリストに追加
        $sql = "INSERT INTO music_playlist_tracks (playlist_id, file_path, file_name, track_order) VALUES (?, ?, ?, ?)";
        $stmt = $dbh->prepare($sql);
        $stmt->execute([$playlist_id, $file, $fileName, $nextOrder]);
        
        echo json_encode(['success' => true]);
        writelog("DEBUG addToPlaylist() added track: $fileName to playlist: $playlist_id", $writelog_process_name);
    } catch (PDOException $e) {
        echo json_encode(['success' => false, 'error' => 'データベースエラー']);
        writelog("ERROR addToPlaylist() DB error: " . $e->getMessage(), $writelog_process_name);
    }
}

/**
 * プレイリスト一覧取得
 */
function getPlaylists() {
    global $dbh, $user, $writelog_process_name;
    
    try {
        $sql = "SELECT id, name, description, created_at FROM music_playlists WHERE user = ? ORDER BY updated_at DESC";
        $stmt = $dbh->prepare($sql);
        $stmt->execute([$user]);
        
        $playlists = $stmt->fetchAll();
        
        echo json_encode(['success' => true, 'playlists' => $playlists]);
    } catch (PDOException $e) {
        echo json_encode(['success' => false, 'error' => 'データベースエラー']);
        writelog("ERROR getPlaylists() DB error: " . $e->getMessage(), $writelog_process_name);
    }
}

/**
 * プレイリストの楽曲一覧取得
 */
function getPlaylistTracks() {
    global $dbh, $user, $playlist_id, $writelog_process_name;
    
    try {
        $sql = "SELECT pt.file_path, pt.file_name, pt.track_order 
                FROM music_playlist_tracks pt 
                INNER JOIN music_playlists p ON pt.playlist_id = p.id 
                WHERE p.id = ? AND p.user = ? 
                ORDER BY pt.track_order";
        $stmt = $dbh->prepare($sql);
        $stmt->execute([$playlist_id, $user]);
        
        $tracks = $stmt->fetchAll();
        
        echo json_encode(['success' => true, 'tracks' => $tracks]);
    } catch (PDOException $e) {
        echo json_encode(['success' => false, 'error' => 'データベースエラー']);
        writelog("ERROR getPlaylistTracks() DB error: " . $e->getMessage(), $writelog_process_name);
    }
}

/**
 * プレイリスト削除
 */
function deletePlaylist() {
    global $dbh, $user, $playlist_id, $writelog_process_name;
    
    try {
        $sql = "DELETE FROM music_playlists WHERE id = ? AND user = ?";
        $stmt = $dbh->prepare($sql);
        $stmt->execute([$playlist_id, $user]);
        
        if ($stmt->rowCount() > 0) {
            echo json_encode(['success' => true]);
            writelog("DEBUG deletePlaylist() deleted playlist: $playlist_id", $writelog_process_name);
        } else {
            echo json_encode(['success' => false, 'error' => 'プレイリストが見つかりません']);
        }
    } catch (PDOException $e) {
        echo json_encode(['success' => false, 'error' => 'データベースエラー']);
        writelog("ERROR deletePlaylist() DB error: " . $e->getMessage(), $writelog_process_name);
    }
}

?> 
