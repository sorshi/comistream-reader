<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/comistream_lib.php';
$writelog_process_name = 'managed-deployment-test';

function expectManagedDeployment(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$previous = getenv('COMISTREAM_MANAGED_INSTALL');
$root = sys_get_temp_dir() . '/comistream-deployment-' . bin2hex(random_bytes(8));
mkdir($root, 0700);
try {
    putenv('COMISTREAM_MANAGED_INSTALL=0');
    expectManagedDeployment(readerManagedSettings() === [], 'Manual installation settings changed.');
    putenv('COMISTREAM_MANAGED_INSTALL=1');
    $fixed = readerManagedSettings();
    $dbh = new PDO('sqlite::memory:');
    $dbh->exec('CREATE TABLE system_config (key TEXT PRIMARY KEY, value TEXT)');
    $insert = $dbh->prepare('INSERT INTO system_config VALUES (?, ?)');
    foreach (array_merge($fixed, ['siteName' => 'Original', 'mutool' => '', 'isLowMemoryMode' => '1']) as $key => $value) {
        $insert->execute([$key, $value]);
    }
    foreach ($fixed as $key => $value) {
        updateSetting($dbh, $key, '/untrusted/path');
        expectManagedDeployment(getSettings($dbh)[$key] === $value, 'Deployment setting changed: ' . $key);
    }
    $dbh->exec("UPDATE system_config SET value = '/untrusted/path' WHERE key = 'webRoot'");
    readConfig($dbh);
    expectManagedDeployment($conf['webRoot'] === $fixed['webRoot'], 'Stored configuration changed the deployment root.');
    $siteName = "日本語 \"quoted\" & name\nnext line";
    updateSetting($dbh, 'siteName', $siteName);
    expectManagedDeployment(getSettings($dbh)['siteName'] === $siteName, 'Site name cannot be configured.');
    $template = json_decode(file_get_contents(dirname(__DIR__, 2) . '/theme/manifest.json'), true);
    $manifest = json_decode(json_encode(readerWebManifest($template, $siteName), JSON_THROW_ON_ERROR), true);
    expectManagedDeployment($manifest['name'] === $siteName && $manifest['short_name'] === $siteName, 'Manifest name encoding failed.');
    expectManagedDeployment($manifest['icons'] === $template['icons'] && $manifest['scope'] === $template['scope'], 'Manifest settings changed.');

    expectManagedDeployment(prepareReaderRuntimeDirectories($root), 'Runtime directories could not be initialized.');
    expectManagedDeployment(prepareReaderRuntimeDirectories($root), 'Repeated initialization failed.');
    rmdir($root . '/data/theme/covers');
    mkdir($root . '/outside');
    symlink($root . '/outside', $root . '/data/theme/covers');
    expectManagedDeployment(!prepareReaderRuntimeDirectories($root), 'Runtime initialization accepted a directory symlink.');
    expectManagedDeployment(scandir($root . '/outside') === ['.', '..'], 'Runtime initialization modified a symlink target.');
} finally {
    putenv($previous === false ? 'COMISTREAM_MANAGED_INSTALL' : 'COMISTREAM_MANAGED_INSTALL=' . $previous);
    $items = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($items as $item) {
        if ($item->isLink() || $item->isFile()) unlink($item->getPathname());
        else rmdir($item->getPathname());
    }
    rmdir($root);
}
echo "managed_deployment.test.php: OK\n";
