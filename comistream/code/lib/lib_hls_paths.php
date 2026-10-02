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
    return 'ffmpeg.*hls/' . $literal . '/file';
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
