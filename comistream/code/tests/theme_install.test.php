<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/comistream_lib.php';
$writelog_process_name = 'theme-install-test';

function expectThemeInstall(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$root = sys_get_temp_dir() . '/comistream-theme-install-' . bin2hex(random_bytes(8));
$originalPath = getenv('PATH');
$sed = trim((string)shell_exec('command -v ' . (PHP_OS_FAMILY === 'Darwin' ? 'gsed' : 'sed')));
if ($sed === '') throw new RuntimeException('GNU sed is required for the theme installation test.');

mkdir($root, 0700);
// 所有者変更は環境の権限に依存するので、その警告だけを許容するルン。
set_error_handler(static function (int $severity, string $message): bool {
    return $severity === E_WARNING
        && (str_starts_with($message, 'chown():') || str_starts_with($message, 'chgrp():'));
});
try {
    $tool = $root . '/tool';
    $web = $root . '/web';
    foreach (['/bin', '/tool/rsrc/apache', '/tool/theme', '/tool/data/theme/covers', '/tool/data/theme/preview', '/web'] as $directory) {
        mkdir($root . $directory, 0700, true);
    }
    // macOSでも本番と同じGNU sedで実際の更新処理を通すルン。
    symlink($sed, $root . '/bin/sed');
    putenv('PATH=' . $root . '/bin:' . $originalPath);
    copy(dirname(__DIR__, 2) . '/rsrc/apache/_htaccess', $tool . '/rsrc/apache/_htaccess');
    copy(dirname(__DIR__, 2) . '/theme/manifest.json', $tool . '/theme/manifest.json');
    file_put_contents($tool . '/theme/style.css', 'body { color: black; }');

    $dbh = new PDO('sqlite::memory:');
    $dbh->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $dbh->exec('CREATE TABLE system_config (key TEXT PRIMARY KEY, value TEXT)');
    $setting = $dbh->prepare('INSERT OR REPLACE INTO system_config (key, value) VALUES (?, ?)');
    foreach (['comistream_tool_dir' => $tool, 'webRoot' => $web, 'publicDir' => '/nas',
        'siteName' => 'Theme Test', 'isLowMemoryMode' => '1', 'mutool' => ''] as $key => $value) {
        $setting->execute([$key, $value]);
    }

    // 旧HTMLがなくても初回配置と現在の配信資産の設定が完了するルン。
    expectThemeInstall(installThemeFiles($dbh), 'Initial installation without footer.html failed.');
    expectThemeInstall(file_get_contents($web . '/.htaccess') === file_get_contents($tool . '/rsrc/apache/_htaccess'), 'Apache rules were not installed.');
    expectThemeInstall(file_get_contents($web . '/theme/style.css') === file_get_contents($tool . '/theme/style.css'), 'Theme assets were not installed.');
    foreach (['covers', 'preview', 'hls'] as $name) {
        expectThemeInstall(is_link($web . '/theme/' . $name)
            && readlink($web . '/theme/' . $name) === $tool . '/data/theme/' . $name, 'Generated asset link was not installed: ' . $name);
    }
    expectThemeInstall(file_get_contents($tool . '/data/theme/hls/.htaccess') === "<Files \"file\">\nRequire all denied\n</Files>\n", 'HLS source protection was not installed.');
    $manifest = json_decode(file_get_contents($web . '/theme/manifest.json'), true, 512, JSON_THROW_ON_ERROR);
    expectThemeInstall($manifest['name'] === 'Theme Test' && $manifest['short_name'] === 'Theme Test', 'Initial manifest names were not updated.');
    $originalManifest = json_decode(file_get_contents($tool . '/theme/manifest.json'), true, 512, JSON_THROW_ON_ERROR);
    expectThemeInstall(array_diff_key($manifest, ['name' => true, 'short_name' => true])
        === array_diff_key($originalManifest, ['name' => true, 'short_name' => true]), 'Unrelated manifest settings changed.');

    // 再設定では独自の設定・資産を保ち、PWAの名前だけを更新するルン。
    file_put_contents($web . '/.htaccess', '# custom Apache configuration');
    file_put_contents($web . '/theme/style.css', 'body { color: blue; }');
    $setting->execute(['siteName', 'Renamed Theme']);
    expectThemeInstall(installThemeFiles($dbh), 'Reconfiguration without footer.html failed.');
    $manifest = json_decode(file_get_contents($web . '/theme/manifest.json'), true, 512, JSON_THROW_ON_ERROR);
    expectThemeInstall($manifest['name'] === 'Renamed Theme' && $manifest['short_name'] === 'Renamed Theme', 'Manifest names were not refreshed.');
    expectThemeInstall(!file_exists($web . '/theme/footer.html'), 'Legacy footer was unexpectedly created.');
    expectThemeInstall(file_get_contents($web . '/.htaccess') === '# custom Apache configuration', 'Existing Apache configuration was overwritten.');
    expectThemeInstall(file_get_contents($web . '/theme/style.css') === 'body { color: blue; }', 'Existing theme assets were overwritten.');

    $legacyFooter = "const publicDir = '/legacy';\nconst bibiPath = '/legacy-reader';\n";
    file_put_contents($web . '/theme/footer.html', $legacyFooter);
    expectThemeInstall(installThemeFiles($dbh), 'Reconfiguration with a legacy footer failed.');
    expectThemeInstall(file_get_contents($web . '/theme/footer.html') === $legacyFooter, 'Legacy footer was modified.');
} finally {
    restore_error_handler();
    putenv($originalPath === false ? 'PATH' : 'PATH=' . $originalPath);
    $iterator = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS),
        RecursiveIteratorIterator::CHILD_FIRST
    );
    foreach ($iterator as $item) {
        if ($item->isLink() || $item->isFile()) unlink($item->getPathname());
        else rmdir($item->getPathname());
    }
    rmdir($root);
}
echo "theme_install.test.php: OK\n";
