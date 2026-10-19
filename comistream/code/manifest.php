<?php

/**
 * 固定テンプレートとDBの表示名からPWA manifestを返すルン。
 * @license AGPL-3.0-only
 */
require_once __DIR__ . '/lib/lib_deployment.php';

if (!in_array($_SERVER['REQUEST_METHOD'] ?? 'GET', ['GET', 'HEAD'], true)) {
    http_response_code(405);
    header('Allow: GET, HEAD');
    exit;
}
try {
    $manifest = json_decode(file_get_contents(__DIR__ . '/../theme/manifest.json'), true, 512, JSON_THROW_ON_ERROR);
    $dbPath = __DIR__ . '/../data/db/comistream.sqlite';
    if (is_file($dbPath)) {
        $db = new PDO('sqlite:' . $dbPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $db->exec('PRAGMA query_only = ON');
        $db->exec('PRAGMA busy_timeout = 3000');
        $siteName = $db->query("SELECT value FROM system_config WHERE key = 'siteName'")->fetchColumn();
        if ($siteName !== false) $manifest = readerWebManifest($manifest, (string)$siteName);
    }
    $body = json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    header('Content-Type: application/manifest+json; charset=utf-8');
    header('Cache-Control: no-cache');
    header('X-Content-Type-Options: nosniff');
    header('Content-Length: ' . strlen($body));
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') echo $body;
} catch (Throwable $error) {
    error_log('Manifest generation failed: ' . $error->getMessage());
    http_response_code(500);
    header('Cache-Control: no-store');
}
