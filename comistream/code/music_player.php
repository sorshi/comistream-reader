<?php

/**
 * Comistream Reader - Music Player PHP
 *
 * 音楽ファイルの再生とプレイリスト管理を行います。（BETA版）
 * iOS 18 Safariでのバックグラウンド再生に対応しています。
 *
 * @package     sorshi/comistream-reader
 * @author      Comistream Project.
 * @copyright   2024 Comistream Project.
 * @license     AGPL-3.0-only for Comistream Reader project-specific portions; see repository-root LICENSING.md
 * @version     2.0.0
 * @link        https://github.com/sorshi/comistream-reader
 */

// library
if (file_exists(__DIR__ . "/comistream_lib.php")) {
    require(__DIR__ . "/comistream_lib.php");
    require_once(__DIR__ . "/music_metadata.php");
    require_once(__DIR__ . "/music_lyrics.php");
    require_once(__DIR__ . "/music_audio.php");
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
} elseif ($mode == 'get_metadata') {
    // 音声メタデータ取得（タイトル/アーティスト）
    getMetadata();
} elseif ($mode == 'get_cover_art') {
    // カバーアート取得
    getCoverArt();
} elseif ($mode == 'get_lyrics') {
    // 歌詞取得
    getLyrics();
} elseif ($mode == 'get_playback_info') {
    // 原本のコーデックと互換再生候補を取得
    musicAudioGetPlaybackInfo();
} elseif ($mode == 'prepare_audio') {
    // 検証済み音源の変換ジョブを準備
    musicAudioPrepareAudio();
} elseif ($mode == 'get_audio_status') {
    // 変換ジョブの状態を取得
    musicAudioGetStatus();
} elseif ($mode == 'touch_audio') {
    // 再生中キャッシュの利用リースを延長
    musicAudioTouch();
} elseif ($mode == 'stream_audio') {
    // 完成済み音源をRange対応で配信
    musicAudioStream();
} else {
    errorExit("invalid mode", "無効なモードです。");
}

/**
 * 音楽プレイヤーテーブル作成
 */
function createMusicTables($dbh)
{
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
function openMusicPlayer()
{
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
    usort($musicFiles, function ($a, $b) {
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
    $musicFilesJson = json_encode(
        $musicFiles,
        JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_INVALID_UTF8_SUBSTITUTE
    );
    $themeDir = $conf["comistream_tool_dir"];

    // HTMLページ出力
    $safeBaseFile = htmlspecialchars($baseFile, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $currentIndex = (int)$currentIndex;
    $userJson = json_encode(
        $user,
        JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_INVALID_UTF8_SUBSTITUTE
    );
    $musicAudioCsrfToken = htmlspecialchars(musicAudioEnsureCsrfToken(), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    echo <<<HTML
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <!-- iOS 18 Safari PWA および バックグラウンド再生対応 -->
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <meta name="theme-color" content="#0b1018">
    <link rel="apple-touch-icon" href="/theme/icons/audio.png">
    <link rel="manifest" href="/theme/manifest.json">
    <title>$safeBaseFile - Music Player</title>
    <style>
        :root {
            color-scheme: dark;
            --bg: #0b1018;
            --panel: #121b2b;
            --text: #f1f6fc;
            --muted: #9eafc3;
            --accent: #7799dd;
            --line: #293750;
        }
        * { box-sizing: border-box; }
        html { text-autospace: normal; }
        body {
            margin: 0;
            min-height: 100vh;
            min-height: 100dvh;
            background: radial-gradient(ellipse at 15% 0%, #1b2b47 0%, transparent 55%), var(--bg);
            color: var(--text);
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            -webkit-text-size-adjust: 100%;
        }
        button, input, select, textarea { font: inherit; }
        button, a, input { -webkit-tap-highlight-color: transparent; }
        button, a { touch-action: manipulation; }
        button { cursor: pointer; }
        button, a { color: inherit; }
        button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
            outline: 3px solid var(--accent);
            outline-offset: 4px;
        }
        button:disabled { opacity: .45; cursor: default; }
        .icon { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }
        .icon-definitions { position: absolute; width: 0; height: 0; overflow: hidden; }
        .music-player {
            width: min(100%, 1200px);
            margin: auto;
            padding: max(20px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left));
        }
        .app-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 8px 0 26px; }
        .brand { display: flex; align-items: center; gap: 12px; }
        .brand-mark { display: grid; place-items: center; width: 42px; height: 42px; border: 1px solid #526b9d; border-radius: 14px; color: var(--accent); background: #1c2a48; }
        .brand-name { font-size: 12px; font-weight: 700; letter-spacing: .16em; }
        .brand-subtitle { margin-top: 3px; font-size: 12px; color: var(--muted); }
        .header-note { font-size: 12px; color: var(--muted); }
        .player-layout { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 24px; align-items: start; }
        .now-playing { min-width: 0; padding: 28px; border: 1px solid var(--line); border-radius: 28px; background: linear-gradient(160deg, #1a2942, #141d2d 65%); box-shadow: 0 24px 70px #0003; }
        .section-label { margin: 0; font-size: 11px; letter-spacing: .18em; color: var(--accent); font-weight: 700; }
        .stage-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
        .track-position { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
        .album-art {
            position: relative;
            width: min(100%, 310px);
            aspect-ratio: 1;
            margin: 26px auto;
            border-radius: 22px;
            overflow: hidden;
            background: radial-gradient(circle at 20% 20%, #4e6693, #2a3d66 45%, #162239 85%);
            background-size: cover;
            background-position: center;
            box-shadow: 0 20px 35px #0005, inset 0 0 0 1px #ffffff12;
            touch-action: pan-y;
        }
        .album-art::before {
            content: '';
            position: absolute;
            inset: 12%;
            border-radius: 50%;
            background: repeating-radial-gradient(circle, #18243a 0 2px, #314365 3px 4px, #151f33 5px 7px);
            box-shadow: 8px 12px 25px #0005;
        }
        .album-art::after {
            content: 'C';
            position: absolute;
            inset: 37%;
            display: grid;
            place-items: center;
            border-radius: 50%;
            background: var(--accent);
            color: #101a32;
            font-size: 24px;
            font-weight: 800;
            transform: rotate(-20deg);
        }
        .album-art.has-cover::before, .album-art.has-cover::after { display: none; }
        .track-info { min-width: 0; text-align: center; }
        .track-title { margin: 0; font-size: clamp(21px, 2.5vw, 28px); line-height: 1.35; font-weight: 750; overflow-wrap: anywhere; }
        .track-artist { margin: 9px 0 0; font-size: 14px; line-height: 1.5; color: var(--muted); overflow-wrap: anywhere; }
        .progress-container { margin-top: 22px; }
        .range-slider { display: block; width: 100%; height: 44px; margin: 0; padding: 0; appearance: none; -webkit-appearance: none; background: transparent; cursor: pointer; }
        .range-slider::-webkit-slider-runnable-track { height: 4px; border-radius: 4px; background: linear-gradient(to right, var(--accent) var(--progress, 0%), #425270 var(--progress, 0%)); }
        .range-slider::-moz-range-track { height: 4px; border-radius: 4px; background: #425270; }
        .range-slider::-moz-range-progress { height: 4px; background: var(--accent); }
        .range-slider::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; width: 16px; height: 16px; margin-top: -6px; border-radius: 50%; background: var(--text); border: 0; box-shadow: 0 0 0 4px #ffffff0c; }
        .range-slider::-moz-range-thumb { width: 16px; height: 16px; border: 0; border-radius: 50%; background: var(--text); }
        .time-display { display: flex; justify-content: space-between; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
        .controls { display: flex; justify-content: center; align-items: center; gap: clamp(8px, 2vw, 24px); margin: 20px 0 12px; }
        .control-btn { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; width: 48px; height: 48px; border: 1px solid transparent; border-radius: 50%; background: transparent; color: var(--text); text-decoration: none; }
        .play-pause-btn { width: 68px; height: 68px; background: var(--accent); color: #101a32; box-shadow: 0 6px 24px #7799dd26; }
        .play-pause-btn .icon { width: 28px; height: 28px; }
        .icon-play .pause-symbol, .icon-pause .play-symbol { display: none; }
        .repeat-one-symbol { display: none; }
        .icon-repeat-one .repeat-one-symbol { display: block; }
        .shuffle-active, .repeat-active { color: var(--accent); background: #7799dd1f; border-color: #7799dd52; }
        .secondary-controls { display: flex; align-items: center; gap: 12px; border-top: 1px solid var(--line); padding-top: 12px; }
        .secondary-controls.volume-unavailable { justify-content: flex-end; }
        .volume-container { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; color: var(--muted); }
        .volume-slider { --progress: 70%; }
        .queue-panel { min-width: 0; border: 1px solid var(--line); border-radius: 28px; background: #111a2a; overflow: hidden; }
        .queue-heading { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 24px 22px 16px; }
        .queue-heading h2 { font-size: 20px; margin: 7px 0 0; }
        .queue-heading .section-label { color: var(--muted); }
        .queue-toggle { padding: 0 12px; min-height: 44px; border: 1px solid var(--line); border-radius: 12px; background: transparent; font-size: 12px; }
        .queue-tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); padding: 0 14px; }
        .queue-tab { flex: 1; min-height: 44px; border: 0; border-bottom: 3px solid transparent; background: transparent; color: var(--muted); font-size: 13px; }
        .queue-tab[aria-selected="true"] { border-bottom-color: var(--accent); color: var(--text); }
        .queue-view { min-width: 0; }
        .queue-summary { margin: 0; padding: 0 22px 18px; color: var(--muted); font-size: 12px; }
        .playlist-container { max-height: min(60vh, 640px); max-height: min(60dvh, 640px); overflow-y: auto; padding: 0 10px 10px; scrollbar-width: thin; scrollbar-color: #425270 transparent; }
        .playlist-item { width: 100%; min-height: 64px; display: flex; align-items: center; gap: 12px; padding: 12px; border: 1px solid transparent; border-radius: 14px; background: transparent; text-align: left; margin-bottom: 4px; }
        .playlist-item.active { background: #7799dd1f; border-color: #7799dd52; }
        .track-number { flex: 0 0 26px; text-align: center; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
        .active .track-number { color: var(--accent); }
        .track-name { min-width: 0; flex: 1; font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
        .track-format { flex-shrink: 0; color: var(--muted); font-size: 10px; letter-spacing: .05em; }
        .playlist-controls { display: flex; flex-wrap: wrap; gap: 8px; border-top: 1px solid var(--line); padding: 16px 20px; }
        .playlist-btn { min-height: 44px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 12px; background: #1a2943; font-size: 12px; }
        .lyrics-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 20px 0; }
        .lyrics-status { min-width: 0; margin: 0; color: var(--muted); font-size: 12px; line-height: 1.5; overflow-wrap: anywhere; }
        .lyrics-return { flex-shrink: 0; min-height: 40px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 10px; background: #1a2943; color: var(--text); font-size: 12px; }
        .lyrics-container { max-height: min(60vh, 640px); max-height: min(60dvh, 640px); min-height: 180px; overflow-y: auto; overscroll-behavior: contain; padding: 14px 20px 20px; scrollbar-width: thin; scrollbar-color: #425270 transparent; }
        .lyrics-plain { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text); font-size: 15px; line-height: 1.85; }
        .lyrics-line { min-height: 1.85em; margin: 0; padding: 7px 10px; border: 1px solid transparent; border-radius: 10px; color: var(--muted); font-size: 15px; line-height: 1.6; overflow-wrap: anywhere; }
        .lyrics-line.active { border-color: #7799dd52; background: #7799dd1f; color: var(--text); }
        .lyrics-attribution { margin: 0; padding: 0 20px 16px; color: var(--muted); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
        .player-status { min-height: 20px; margin: 16px 2px 0; color: var(--muted); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
        dialog { width: min(440px, calc(100% - 32px)); max-height: calc(100dvh - 32px); padding: 24px; border: 1px solid #425270; border-radius: 22px; background: var(--panel); color: var(--text); overflow-y: auto; }
        dialog::backdrop { background: #050a12bb; backdrop-filter: blur(8px); }
        dialog h2 { font-size: 20px; margin: 0 0 22px; }
        .dialog-field { display: block; margin: 16px 0; font-size: 13px; color: var(--muted); }
        .dialog-field input, .dialog-field textarea, .dialog-field select { display: block; width: 100%; margin-top: 8px; padding: 12px; border: 1px solid #425270; border-radius: 10px; background: var(--bg); color: var(--text); font-size: 16px; }
        .dialog-field textarea { resize: vertical; min-height: 80px; }
        .dialog-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 10px; margin-top: 20px; }
        .primary-btn { background: var(--accent); color: #101a32; border-color: var(--accent); font-weight: 700; }
        .dialog-status { color: var(--muted); font-size: 13px; line-height: 1.5; }
        [hidden], .hidden { display: none !important; }
        @media (hover: hover) {
            .control-btn:hover { background: #ffffff12; }
            .play-pause-btn:hover { background: #9bb8f2; }
            .playlist-item:hover, .playlist-btn:hover, .queue-toggle:hover, .queue-tab:hover, .lyrics-return:hover { border-color: #5f76a8; background: #263754; }
            .primary-btn:hover { background: #9bb8f2; color: #101a32; }
        }
        @media (max-width: 899px) {
            .music-player { padding: max(12px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left)); }
            .app-header { padding: 4px 0 18px; }
            .header-note { display: none; }
            .player-layout { grid-template-columns: minmax(0, 1fr); gap: 18px; }
            .now-playing { padding: 20px; border-radius: 24px; }
            .album-art { width: min(64vw, 270px); margin: 20px auto; }
            .queue-panel { border-radius: 24px; }
            .playlist-container { max-height: 380px; }
            .lyrics-container { max-height: 380px; }
        }
        @media (min-width: 600px) and (max-height: 540px) and (orientation: landscape) {
            .music-player { padding-top: max(8px, env(safe-area-inset-top)); }
            .app-header { padding-bottom: 12px; }
            .brand-mark { width: 34px; height: 34px; border-radius: 10px; }
            .player-layout { grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 16px; }
            .now-playing { display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 10px 14px; padding: 16px; border-radius: 20px; }
            .stage-heading, .progress-container, .controls, .secondary-controls { grid-column: 1 / -1; }
            .album-art { width: 88px; margin: 0; border-radius: 12px; }
            .album-art::after { font-size: 14px; }
            .track-info { text-align: left; align-self: center; }
            .track-title { font-size: 18px; }
            .track-artist { font-size: 12px; margin-top: 5px; }
            .progress-container { margin-top: 0; }
            .controls { margin: 0; gap: 6px; justify-content: space-between; }
            .control-btn { width: 44px; height: 44px; }
            .play-pause-btn { width: 54px; height: 54px; }
            .secondary-controls { padding-top: 4px; }
            .queue-heading { padding: 18px 16px 12px; }
            .queue-summary { padding: 0 16px 12px; }
            .playlist-container { max-height: 230px; }
            .lyrics-container { max-height: 230px; }
            .playlist-controls { padding: 12px; }
        }
        @media (prefers-reduced-motion: no-preference) {
            button, a { transition: background-color .15s, border-color .15s; }
        }
    </style>
</head>
<body>
    <svg class="icon-definitions" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <symbol id="i-music" viewBox="0 0 24 24"><path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="17" cy="16" rx="3" ry="3"/></symbol>
        <symbol id="i-play" viewBox="0 0 24 24"><path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none"/></symbol>
        <symbol id="i-pause" viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" stroke-width="4"/></symbol>
        <symbol id="i-prev" viewBox="0 0 24 24"><path d="M5 5v14m14-14L8 12l11 7Z"/></symbol>
        <symbol id="i-next" viewBox="0 0 24 24"><path d="M19 5v14M5 5l11 7-11 7Z"/></symbol>
        <symbol id="i-shuffle" viewBox="0 0 24 24"><path d="M3 6h3c5 0 7 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 3-2 4-4m4-4c1-2 2-4 4-4h3m-4-4 4 4-4 4"/></symbol>
        <symbol id="i-repeat" viewBox="0 0 24 24"><path d="M4 10V8a3 3 0 0 1 3-3h13m-4-4 4 4-4 4M20 14v2a3 3 0 0 1-3 3H4m4-4-4 4 4 4"/></symbol>
        <symbol id="i-volume" viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></symbol>
        <symbol id="i-download" viewBox="0 0 24 24"><path d="M12 3v12m-5-5 5 5 5-5M4 15v5h16v-5"/></symbol>
    </svg>
    <main class="music-player">
        <header class="app-header">
            <div class="brand"><span class="brand-mark"><svg class="icon" aria-hidden="true"><use href="#i-music"/></svg></span><div><div class="brand-name">COMISTREAM</div><div class="brand-subtitle">Music Player</div></div></div>
            <span class="header-note">あなたのライブラリを、心地よく。</span>
        </header>
        <div class="player-layout">
            <section class="now-playing" aria-label="音楽プレイヤー">
                <div class="stage-heading"><p class="section-label">NOW PLAYING</p><span class="track-position" id="trackPosition"></span></div>
                <div class="album-art" role="img" aria-label="アルバムアート"></div>
                <div class="track-info" aria-live="polite" aria-atomic="true">
                    <h1 class="track-title" id="trackTitle">$safeBaseFile</h1>
                    <p class="track-artist" id="trackArtist">アーティスト不明</p>
                </div>
                <div class="progress-container">
                    <input type="range" class="range-slider" id="progressBar" min="0" max="1000" value="0" step="1" aria-label="再生位置" aria-valuetext="0:00" disabled>
                    <div class="time-display"><span id="currentTime">0:00</span><span id="totalTime">0:00</span></div>
                </div>
                <div class="controls">
                    <button class="control-btn icon-shuffle" id="shuffleBtn" title="シャッフル: OFF" aria-label="シャッフル: OFF" aria-pressed="false"><svg class="icon" aria-hidden="true"><use href="#i-shuffle"/></svg></button>
                    <button class="control-btn icon-prev" id="prevBtn" title="前の曲" aria-label="前の曲"><svg class="icon" aria-hidden="true"><use href="#i-prev"/></svg></button>
                    <button class="control-btn play-pause-btn icon-play" id="playPauseBtn" title="再生" aria-label="再生"><svg class="icon" aria-hidden="true"><use class="play-symbol" href="#i-play"/><use class="pause-symbol" href="#i-pause"/></svg></button>
                    <button class="control-btn icon-next" id="nextBtn" title="次の曲" aria-label="次の曲"><svg class="icon" aria-hidden="true"><use href="#i-next"/></svg></button>
                    <button class="control-btn icon-repeat" id="repeatBtn" title="リピート: OFF" aria-label="リピート: OFF" aria-pressed="false"><svg class="icon" aria-hidden="true"><use href="#i-repeat"/><text class="repeat-one-symbol" x="10" y="15" stroke="none" fill="currentColor" font-size="9">1</text></svg></button>
                </div>
                <div class="secondary-controls">
                    <div class="volume-container" id="volumeContainer"><svg class="icon" aria-hidden="true"><use href="#i-volume"/></svg><input type="range" class="range-slider volume-slider" id="volumeSlider" min="0" max="100" value="70" aria-label="音量"></div>
                    <a class="control-btn" id="downloadBtn" title="ダウンロード" aria-label="現在の曲をダウンロード" href="#" download><svg class="icon" aria-hidden="true"><use href="#i-download"/></svg></a>
                </div>
            </section>
            <section class="queue-panel" aria-labelledby="queueTitle">
                <div class="queue-heading"><div><p class="section-label">PLAY QUEUE</p><h2 id="queueTitle">再生リスト</h2></div><button class="queue-toggle" id="showPlaylistBtn" aria-expanded="true" aria-controls="queueContent">折りたたむ</button></div>
                <div id="queueContent">
                    <div class="queue-tabs" role="tablist" aria-label="再生キューの表示">
                        <button class="queue-tab" id="playlistTab" role="tab" aria-controls="playlistView" aria-selected="true" tabindex="0">再生リスト</button>
                        <button class="queue-tab" id="lyricsTab" role="tab" aria-controls="lyricsView" aria-selected="false" tabindex="-1">歌詞</button>
                    </div>
                    <div class="queue-view" id="playlistView" role="tabpanel" aria-labelledby="playlistTab">
                        <p class="queue-summary" id="queueSummary"></p>
                        <div class="playlist-container" id="playlistContainer" role="group" aria-label="再生する曲を選択"></div>
                        <div class="playlist-controls"><button class="playlist-btn" id="createPlaylistBtn">＋ プレイリスト作成</button><button class="playlist-btn" id="addToPlaylistBtn">現在の曲を追加</button></div>
                    </div>
                    <div class="queue-view" id="lyricsView" role="tabpanel" aria-labelledby="lyricsTab" hidden>
                        <div class="lyrics-toolbar"><p class="lyrics-status" id="lyricsStatus" role="status" aria-live="polite">歌詞タブを開くと読み込みます。</p><button class="lyrics-return" id="lyricsReturnBtn" type="button" hidden>現在位置に戻る</button></div>
                        <div class="lyrics-container" id="lyricsContainer" role="region" aria-label="歌詞" tabindex="0"></div>
                        <p class="lyrics-attribution" id="lyricsAttribution" hidden></p>
                    </div>
                </div>
            </section>
        </div>
        <p class="player-status" id="playerStatus" role="status" aria-live="polite"></p>
    </main>
    <dialog id="playlistDialog" aria-labelledby="dialogTitle">
        <form id="playlistForm">
            <h2 id="dialogTitle">プレイリスト作成</h2>
            <div id="createFields"><label class="dialog-field">プレイリスト名<input id="playlistName" name="name" required autocomplete="off"></label><label class="dialog-field">説明（任意）<textarea id="playlistDescription" name="description" rows="2"></textarea></label></div>
            <label class="dialog-field" id="selectField" hidden>追加先のプレイリスト<select id="playlistSelect" name="playlist_id"></select></label>
            <p class="dialog-status" id="dialogStatus" role="status"></p>
            <div class="dialog-actions"><button class="playlist-btn" id="dialogCancel" type="button">キャンセル</button><button class="playlist-btn primary-btn" id="dialogSubmit" type="submit">作成</button></div>
        </form>
    </dialog>

    <!-- iOS 18 Safari バックグラウンド再生対応のオーディオ要素 -->
    <audio id="audioPlayer" preload="auto" crossorigin="anonymous" playsinline webkit-playsinline x-webkit-airplay="allow"></audio>

    <script>
        // PHP から JavaScript へのデータ渡し
        window.musicFiles = $musicFilesJson;
        window.currentIndex = $currentIndex;
        window.user = $userJson;
        window.baseDir = window.location.origin + '/';
        window.musicAudioCsrfToken = "$musicAudioCsrfToken";

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
function createPlaylist()
{
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
function addToPlaylist()
{
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
function getPlaylists()
{
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
function getPlaylistTracks()
{
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
function deletePlaylist()
{
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

/**
 * 共有領域内の音源と、同じフォルダの歌詞サイドカーを解決するルン。
 */
function resolveMusicLyricsSidecars(string $sharePath, string $sourcePath): array
{
    $realSharePath = realpath($sharePath);
    $sourceDirectory = realpath(dirname($sourcePath));
    if ($realSharePath === false || $sourceDirectory === false) {
        return [];
    }

    $sharePrefix = rtrim($realSharePath, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
    if (strncmp($sourceDirectory, $sharePrefix, strlen($sharePrefix)) !== 0
        && $sourceDirectory !== rtrim($realSharePath, DIRECTORY_SEPARATOR)) {
        return [];
    }

    $baseName = pathinfo($sourcePath, PATHINFO_FILENAME);
    $sidecars = [];
    foreach (['lrc', 'txt'] as $extension) {
        $candidate = $sourceDirectory . DIRECTORY_SEPARATOR . $baseName . '.' . $extension;
        $resolved = realpath($candidate);
        if ($resolved === false || !is_file($resolved)) {
            continue;
        }
        if (strncmp($resolved, $sharePrefix, strlen($sharePrefix)) !== 0) {
            writelog("WARNING resolveMusicLyricsSidecars() rejected sidecar outside share boundary", 'MusicPlayer');
            continue;
        }
        $sidecars[] = [
            'path' => $resolved,
            'name' => basename($candidate),
            'format' => $extension,
        ];
    }
    return $sidecars;
}

/**
 * 原本とサイドカーの更新情報から歌詞のバージョンを作るルン。
 */
function buildMusicLyricsSourceSignature(string $sourcePath, array $sidecars): ?array
{
    $sourceStat = @stat($sourcePath);
    if ($sourceStat === false) {
        return null;
    }

    $signature = [
        'parserVersion' => musicLyricsParserVersion(),
        'source' => [
            'size' => (int)($sourceStat['size'] ?? 0),
            'mtime' => (int)($sourceStat['mtime'] ?? 0),
            'ctime' => (int)($sourceStat['ctime'] ?? 0),
            'path' => $sourcePath,
        ],
        'sidecars' => [],
    ];
    foreach ($sidecars as $sidecar) {
        $sidecarStat = @stat((string)$sidecar['path']);
        if ($sidecarStat === false) {
            continue;
        }
        $signature['sidecars'][] = [
            'name' => (string)$sidecar['name'],
            'format' => (string)$sidecar['format'],
            'size' => (int)($sidecarStat['size'] ?? 0),
            'mtime' => (int)($sidecarStat['mtime'] ?? 0),
            'ctime' => (int)($sidecarStat['ctime'] ?? 0),
        ];
    }

    $encoded = json_encode($signature, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    if ($encoded === false) {
        return null;
    }
    return [
        'version' => hash('sha256', $encoded),
        'manifest' => $signature,
    ];
}

/**
 * 歌詞APIのエラー応答を返すルン。
 */
function outputMusicLyricsError(int $status, string $error): void
{
    http_response_code($status);
    echo json_encode([
        'success' => false,
        'status' => 'error',
        'error' => $error,
    ], JSON_UNESCAPED_UNICODE);
}

/**
 * 埋め込み歌詞、LRC、TXTの順で歌詞を取得する。
 */
function getLyrics(): void
{
    global $conf, $audioFormats, $writelog_process_name;

    header('Content-Type: application/json; charset=UTF-8');
    header('Cache-Control: private, max-age=60, must-revalidate');

    $requestedFile = isset($_REQUEST['file']) ? (string)$_REQUEST['file'] : '';
    $requestHash = substr(hash('sha256', $requestedFile), 0, 12);
    $sourcePath = resolveFileWithinBaseDirectory($conf['sharePath'], $requestedFile);
    if ($sourcePath === false) {
        writelog("WARNING getLyrics() rejected file request:$requestHash", $writelog_process_name);
        outputMusicLyricsError(403, 'file access denied');
        return;
    }

    $extension = strtolower(pathinfo($sourcePath, PATHINFO_EXTENSION));
    if (!in_array($extension, $audioFormats, true)) {
        writelog("WARNING getLyrics() unsupported format request:$requestHash", $writelog_process_name);
        outputMusicLyricsError(415, 'unsupported format');
        return;
    }

    $sidecars = resolveMusicLyricsSidecars($conf['sharePath'], $sourcePath);
    $sourceSignature = buildMusicLyricsSourceSignature($sourcePath, $sidecars);
    if ($sourceSignature === null) {
        writelog("ERROR getLyrics() failed to stat source request:$requestHash", $writelog_process_name);
        outputMusicLyricsError(500, 'source unavailable');
        return;
    }

    $sourceVersion = $sourceSignature['version'];
    $cacheKey = hash('sha256', $sourcePath . "\0" . $sourceVersion . "\0" . musicLyricsParserVersion());
    $cacheDirectory = (string)($conf['cacheDir'] ?? '');
    $toolDirectory = (string)($conf['comistream_tool_dir'] ?? '');
    $lyrics = null;
    if ($cacheDirectory !== '' && $toolDirectory !== '') {
        $lyrics = readMusicLyricsCache($cacheDirectory, $toolDirectory, $cacheKey, $sourceVersion);
        if (is_array($lyrics)) {
            writelog("DEBUG getLyrics() cache hit request:$requestHash", $writelog_process_name);
        }
    } else {
        writelog("NOTICE getLyrics() cache configuration unavailable request:$requestHash", $writelog_process_name);
    }

    if (!is_array($lyrics)) {
        $lyrics = resolveLocalMusicLyrics($sourcePath, $extension, $sidecars);
        if (($lyrics['status'] ?? '') === 'ok') {
            writelog("INFO getLyrics() local source:" . ($lyrics['source'] ?? 'unknown') . " format:" . ($lyrics['format'] ?? 'unknown') . " request:$requestHash", $writelog_process_name);
        } else {
            writelog("DEBUG getLyrics() no local lyrics request:$requestHash", $writelog_process_name);
        }
        if ($cacheDirectory !== '' && $toolDirectory !== '') {
            $cacheWritten = writeMusicLyricsCache(
                $cacheDirectory,
                $toolDirectory,
                $cacheKey,
                $sourceVersion,
                $sourceSignature['manifest'],
                $lyrics
            );
            if ($cacheWritten) {
                writelog("DEBUG getLyrics() cache stored request:$requestHash", $writelog_process_name);
            }
        }
    }

    $response = [
        'success' => true,
        'status' => $lyrics['status'] ?? 'none',
        'sourceVersion' => $sourceVersion,
        'source' => $lyrics['source'] ?? null,
        'format' => $lyrics['format'] ?? null,
        'text' => $lyrics['text'] ?? '',
        'lines' => $lyrics['lines'] ?? [],
        'provider' => $lyrics['provider'] ?? null,
        'attribution' => $lyrics['attribution'] ?? null,
    ];
    echo json_encode($response, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

/**
 * 音声APIで使う原本を共有領域内へ限定して解決するルン。
 */
function resolveMusicPlayerAudioPath(string $requestedFile)
{
    global $conf;
    return resolveFileWithinBaseDirectory($conf['sharePath'], $requestedFile);
}

/**
 * メタデータ取得（タイトル/アーティスト）
 */
function getMetadata()
{
    global $conf, $audioFormats, $writelog_process_name;
    $file = isset($_REQUEST['file']) ? (string)$_REQUEST['file'] : '';
    $path = resolveMusicPlayerAudioPath($file);

    header('Content-Type: application/json; charset=UTF-8');
    header('Cache-Control: private, max-age=600');

    if ($path === false) {
        writelog("WARNING getMetadata() rejected file request", $writelog_process_name);
        http_response_code(403);
        echo json_encode(['success' => false, 'error' => 'file not found']);
        return;
    }

    $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    if (!in_array($ext, $audioFormats)) {
        echo json_encode(['success' => false, 'error' => 'unsupported format']);
        return;
    }

    $meta = ['title' => '', 'artist' => ''];
    if ($ext === 'm4a' || $ext === 'mp4' || $ext === 'aac') {
        $meta = readMP4MetadataFromFile($path);
    } else {
        $max = 3145728; // ID3 / FLAC メタデータは先頭3MBまでスキャン
        $fp = @fopen($path, 'rb');
        if (!$fp) {
            echo json_encode(['success' => false, 'error' => 'open failed']);
            return;
        }
        $buf = fread($fp, $max);
        fclose($fp);

        if ($ext === 'mp3') {
            $meta = parseID3v2Metadata($buf);
        } elseif ($ext === 'flac') {
            $meta = parseFLACVorbisComment($buf);
        }
    }

    echo json_encode(['success' => true, 'title' => $meta['title'], 'artist' => $meta['artist']]);
}

/**
 * カバーアート取得
 */
function getCoverArt()
{
    global $conf, $audioFormats, $writelog_process_name;
    $file = isset($_REQUEST['file']) ? (string)$_REQUEST['file'] : '';
    $path = resolveMusicPlayerAudioPath($file);

    header('Cache-Control: private, max-age=600');

    if ($path === false) {
        writelog("WARNING getCoverArt() rejected file request", $writelog_process_name);
        http_response_code(403);
        return;
    }

    $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    if (!in_array($ext, $audioFormats)) {
        http_response_code(415);
        return;
    }

    $result = null;
    if ($ext === 'm4a' || $ext === 'mp4' || $ext === 'aac') {
        $result = extractMP4CoverFromFile($path);
    } else {
        $max = 4194304; // ID3 / FLAC カバーは先頭4MBまでスキャン
        $fp = @fopen($path, 'rb');
        if (!$fp) {
            http_response_code(500);
            return;
        }
        $buf = fread($fp, $max);
        fclose($fp);

        if ($ext === 'mp3') {
            $result = extractMP3CoverFromBuffer($buf);
        } elseif ($ext === 'flac') {
            $result = extractFLACCoverFromBuffer($buf);
        }
    }

    if ($result && isset($result['data'])) {
        $mime = isset($result['mime']) ? $result['mime'] : 'image/jpeg';
        header('Content-Type: ' . $mime);
        echo $result['data'];
        return;
    }

    // 見つからない場合は204 No Content
    http_response_code(204);
}

// --- 解析ヘルパ ---

function parseID3v2Metadata($buf)
{
    $meta = ['title' => '', 'artist' => ''];
    if (strlen($buf) < 10) return $meta;
    if (substr($buf, 0, 3) !== 'ID3') return $meta;
    $version = ord($buf[3]);
    $flags = ord($buf[5]);
    $size = 0;
    for ($i = 6; $i < 10; $i++) $size = ($size << 7) + (ord($buf[$i]) & 0x7f);
    $offset = 10;
    if ($flags & 0x40) {
        if (strlen($buf) < $offset + 4) return $meta;
        $extSize = unpack('N', substr($buf, $offset, 4))[1];
        $offset += $extSize;
    }
    while ($offset + 10 <= min(strlen($buf), $size + 10)) {
        $frameId = substr($buf, $offset, 4);
        if ($frameId === "\0\0\0\0") break;
        if ($version >= 4) {
            $fsize = 0;
            for ($i = 0; $i < 4; $i++) $fsize = ($fsize << 7) + (ord($buf[$offset + 4 + $i]) & 0x7f);
        } else {
            $fsize = unpack('N', substr($buf, $offset + 4, 4))[1];
        }
        $dataStart = $offset + 10;
        if ($fsize <= 0 || $dataStart + $fsize > strlen($buf)) break;
        if ($frameId === 'TIT2' || $frameId === 'TPE1') {
            $enc = ord($buf[$dataStart]);
            $textBytes = substr($buf, $dataStart + 1, $fsize - 1);
            $text = decodeID3Text($textBytes, $enc);
            if ($frameId === 'TIT2') $meta['title'] = $text;
            if ($frameId === 'TPE1') $meta['artist'] = $text;
        }
        $offset += 10 + $fsize;
        if ($meta['title'] !== '' && $meta['artist'] !== '') break;
    }
    return $meta;
}

function decodeID3Text($bytes, $enc)
{
    // 0: ISO-8859-1, 1: UTF-16 with BOM, 2: UTF-16BE, 3: UTF-8
    if ($enc === 0) return @iconv('ISO-8859-1', 'UTF-8//IGNORE', $bytes);
    if ($enc === 1) return @iconv('UTF-16', 'UTF-8//IGNORE', $bytes);
    if ($enc === 2) return @iconv('UTF-16BE', 'UTF-8//IGNORE', $bytes);
    if ($enc === 3) return @iconv('UTF-8', 'UTF-8//IGNORE', $bytes);
    return '';
}

function parseFLACVorbisComment($buf)
{
    $meta = ['title' => '', 'artist' => ''];
    if (strlen($buf) < 4 || substr($buf, 0, 4) !== 'fLaC') return $meta;
    $offset = 4;
    while ($offset + 4 <= strlen($buf)) {
        $hdr = unpack('N', substr($buf, $offset, 4))[1];
        $isLast = ($hdr & 0x80000000) !== 0;
        $type = ($hdr >> 24) & 0x7f;
        $size = $hdr & 0x00ffffff;
        $offset += 4;
        if ($type === 4) { // VORBIS_COMMENT
            $p = $offset;
            if ($p + 4 > strlen($buf)) break;
            $vendorLen = unpack('V', substr($buf, $p, 4))[1];
            $p += 4 + $vendorLen;
            if ($p + 4 > strlen($buf)) break;
            $userCount = unpack('V', substr($buf, $p, 4))[1];
            $p += 4;
            for ($i = 0; $i < $userCount; $i++) {
                if ($p + 4 > strlen($buf)) break;
                $len = unpack('V', substr($buf, $p, 4))[1];
                $p += 4;
                if ($p + $len > strlen($buf)) break;
                $kv = substr($buf, $p, $len);
                $p += $len;
                $eq = strpos($kv, '=');
                if ($eq !== false) {
                    $key = strtoupper(substr($kv, 0, $eq));
                    $val = substr($kv, $eq + 1);
                    if ($key === 'TITLE') $meta['title'] = $val;
                    if ($key === 'ARTIST') $meta['artist'] = $val;
                }
            }
            break;
        }
        $offset += $size;
        if ($isLast) break;
    }
    return $meta;
}

function extractMP3CoverFromBuffer($buf)
{
    if (strlen($buf) < 10 || substr($buf, 0, 3) !== 'ID3') return null;
    $version = ord($buf[3]);
    $flags = ord($buf[5]);
    $size = 0;
    for ($i = 6; $i < 10; $i++) $size = ($size << 7) + (ord($buf[$i]) & 0x7f);
    $offset = 10;
    if ($flags & 0x40) {
        if (strlen($buf) < $offset + 4) return null;
        $extSize = unpack('N', substr($buf, $offset, 4))[1];
        $offset += $extSize;
    }
    while ($offset + 10 <= min(strlen($buf), $size + 10)) {
        $frameId = substr($buf, $offset, 4);
        if ($version >= 4) {
            $fsize = 0;
            for ($i = 0; $i < 4; $i++) $fsize = ($fsize << 7) + (ord($buf[$offset + 4 + $i]) & 0x7f);
        } else {
            $fsize = unpack('N', substr($buf, $offset + 4, 4))[1];
        }
        $dataStart = $offset + 10;
        if ($frameId === 'APIC' && $fsize > 0 && $dataStart + $fsize <= strlen($buf)) {
            $p = $dataStart;
            $p++; // encoding
            // mime
            $mime = '';
            while ($p < $dataStart + $fsize && ord($buf[$p]) !== 0) {
                $mime .= $buf[$p];
                $p++;
            }
            $p++; // null
            $p++; // picture type
            // description
            while ($p < $dataStart + $fsize && ord($buf[$p]) !== 0) {
                $p++;
            }
            $p++; // null
            $img = substr($buf, $p, ($dataStart + $fsize) - $p);
            if ($mime === '') $mime = 'image/jpeg';
            return ['mime' => $mime, 'data' => $img];
        }
        $offset += 10 + $fsize;
    }
    return null;
}

function extractFLACCoverFromBuffer($buf)
{
    if (strlen($buf) < 4 || substr($buf, 0, 4) !== 'fLaC') return null;
    $offset = 4;
    while ($offset + 4 <= strlen($buf)) {
        $hdr = unpack('N', substr($buf, $offset, 4))[1];
        $isLast = ($hdr & 0x80000000) !== 0;
        $type = ($hdr >> 24) & 0x7f;
        $size = $hdr & 0x00ffffff;
        $offset += 4;
        if ($type === 6) { // PICTURE
            $p = $offset;
            $p += 4; // picture type
            $mimeLen = unpack('N', substr($buf, $p, 4))[1];
            $p += 4;
            $mime = substr($buf, $p, $mimeLen);
            $p += $mimeLen;
            $descLen = unpack('N', substr($buf, $p, 4))[1];
            $p += 4 + $descLen;
            $p += 16; // w,h,depth,colors
            $imgLen = unpack('N', substr($buf, $p, 4))[1];
            $p += 4;
            $img = substr($buf, $p, $imgLen);
            return ['mime' => $mime ?: 'image/jpeg', 'data' => $img];
        }
        $offset += $size;
        if ($isLast) break;
    }
    return null;
}
