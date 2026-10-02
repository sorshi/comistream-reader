<?php

function ls_resolve_hls_directory(string $root, $user): string|false
{
    if (!is_string($user) || $user === '' || $user === '.' || $user === '..'
        || preg_match('~[\\\\/\x00-\x1f\x7f]~', $user) === 1) {
        return false;
    }
    $base = realpath($root);
    if ($base === false || !is_dir($base)) {
        return false;
    }
    $candidate = $base . DIRECTORY_SEPARATOR . $user;
    if (is_link($candidate)) {
        return false;
    }
    if (!file_exists($candidate)) {
        return $candidate;
    }
    $real = realpath($candidate);
    return $real !== false && is_dir($real) && dirname($real) === $base ? $real : false;
}

function ls_encoder_process_pattern(string $user): string
{
    // シェル引用とは別に、pkillの正規表現から名前を保護するルン。
    $literal = preg_replace('/([.\\\\+*?\[\]^$(){}|])/', '\\\\$1', $user);
    return 'ffmpeg.*hls/' . $literal . '/';
}

function ls_validate_source(string $share, $source): string|false
{
    $base = realpath($share);
    $real = is_string($source) ? realpath($source) : false;
    if ($base === false || $real === false || !is_file($real) || !is_readable($real)
        || !str_starts_with($real, $base . DIRECTORY_SEPARATOR)) {
        return false;
    }
    $formats = ['m2t', 'ts', 'iso', 'mp4', 'm4v', 'avi', 'mkv', 'wmv', 'mpg', 'm2p', 'webm', 'mov', 'flv', 'mpeg'];
    return in_array(strtolower(pathinfo($real, PATHINFO_EXTENSION)), $formats, true) ? $real : false;
}

function ls_resolve_source(string $share, $requested): string|false
{
    if (!is_string($requested)) return false;
    $path = resolveFileWithinBaseDirectory($share, rawurldecode($requested));
    return $path === false ? false : ls_validate_source($share, $path);
}

function ls_remove_legacy_source_links(string $root): void
{
    foreach (@scandir($root) ?: [] as $user) {
        $directory = ls_resolve_hls_directory($root, $user);
        if ($directory !== false && is_link($directory . '/file')) {
            // 旧版が公開領域へ置いた原本リンクだけを取り除くルン。
            @unlink($directory . '/file');
        }
    }
}

function ls_reset_hls_dir($hlsDir)
{
    global $conf;
    $root = ($conf['comistream_tool_dir'] ?? '') . '/data/theme/hls';
    $expected = is_string($hlsDir)
        ? ls_resolve_hls_directory($root, basename(rtrim($hlsDir, '/'))) : false;
    if ($expected === false || rtrim($hlsDir, '/') !== $expected) {
        writelog('ERROR ls_reset_hls_dir() path outside HLS directory', 'Livestream');
        return false;
    }
    if (!is_dir($hlsDir)) {
        return true;
    }
    $items = scandir($hlsDir);
    if ($items === false) {
        return false;
    }
    $failed = false;
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') continue;
        $path = $hlsDir . '/' . $item;
        if (is_link($path) || is_file($path)) {
            if (!@unlink($path)) $failed = true;
        } else {
            // 予期しないサブディレクトリには触れないルン。
            $failed = true;
        }
    }
    return !$failed;
}
