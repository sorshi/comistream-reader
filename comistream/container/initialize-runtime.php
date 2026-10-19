<?php

// 非rootでデータ領域を準備し、配備側で固定したパスだけをDBへ反映するルン。
require_once __DIR__ . '/../code/lib/lib_deployment.php';
if (!readerUsesManagedDeployment()) exit(1);
$toolRoot = dirname(__DIR__);
if (!prepareReaderRuntimeDirectories($toolRoot)) {
    fwrite(STDERR, "Cannot initialize data directories. Ensure the data volume is writable by UID/GID 48 and contains no directory symlinks.\n");
    exit(1);
}
$dbPath = $toolRoot . '/data/db/comistream.sqlite';
if (is_file($dbPath)) {
    try {
        $db = new PDO('sqlite:' . $dbPath, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $db->exec('PRAGMA busy_timeout = 5000');
        $db->beginTransaction();
        $stmt = $db->prepare('INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)');
        foreach (readerManagedSettings() as $key => $value) $stmt->execute([$key, $value]);
        $db->commit();
    } catch (Throwable $error) {
        fwrite(STDERR, "Cannot initialize deployment settings: " . $error->getMessage() . "\n");
        exit(1);
    }
}
