<?php

/**
 * 固定配置と実行時データの境界を管理するルン。
 * @license AGPL-3.0-only
 */
function readerUsesManagedDeployment(): bool
{
    return getenv('COMISTREAM_MANAGED_INSTALL') === '1';
}

function readerManagedSettings(): array
{
    if (!readerUsesManagedDeployment()) return [];
    $toolRoot = dirname(__DIR__, 2);
    $webRoot = dirname($toolRoot) . '/public';
    return [
        'comistream_tool_dir' => $toolRoot,
        'webRoot' => $webRoot,
        'sharePath' => $webRoot . '/nas',
        'publicDir' => '/nas',
        'cgiPath' => '/cgi-bin/comistream.php',
        'hlsCgiPath' => '/cgi-bin/livestream.php',
        'comistream_tmp_dir_root' => '/dev/shm/comistream_temp',
    ];
}

function prepareReaderRuntimeDirectories(string $toolRoot): bool
{
    // 固定のdata配下だけを作り、既存リンクへは書き込まないルン。
    foreach (['data', 'data/db', 'data/cache', 'data/runtime', 'data/session',
        'data/etc', 'data/etc/index', 'data/etc/index/daily-list', 'data/etc/index/daily-cover',
        'data/theme', 'data/theme/covers', 'data/theme/preview', 'data/theme/hls'] as $relative) {
        $path = $toolRoot . '/' . $relative;
        if (is_link($path) || (file_exists($path) && !is_dir($path))) return false;
        if (!is_dir($path) && !@mkdir($path, 0750)) return false;
        if (!is_writable($path)) return false;
    }
    return true;
}

function readerWebManifest(array $template, string $siteName): array
{
    $template['name'] = $siteName;
    $template['short_name'] = $siteName;
    return $template;
}
