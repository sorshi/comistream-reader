<?php

/**
 * 画像を持たないEPUBの判定を、公開画像とは別に保存するルン。
 * @license AGPL-3.0-only
 */
require_once __DIR__ . '/lib_reader_input.php';

const COMISTREAM_PREVIEW_STATUS_VERSION = 1;

function previewSourceSignature(string $source): ?array
{
    clearstatcache(true, $source);
    $stat = @stat($source);
    return $stat !== false && is_file($source) && is_readable($source)
        ? ['size' => $stat['size'], 'mtime' => $stat['mtime']] : null;
}

function previewStatusPaths(string $toolRoot, string $relativePath, bool $create = false): ?array
{
    if (!isSafeReaderPagePath($relativePath)) throw new RuntimeException('Invalid preview status book path.');
    $data = realpath($toolRoot . '/data');
    if ($data === false || !is_dir($data)) throw new RuntimeException('Preview status data directory is missing.');
    $directory = $data . '/preview_status';
    if (is_link($directory)) throw new RuntimeException('Preview status directory must not be a symlink.');
    if (!file_exists($directory)) {
        if (!$create) return null;
        if (@mkdir($directory, 0775)) {
            // dataのグループを引き継ぎ、Apacheと日次バッチで共有するルン。
            if (!@chgrp($directory, filegroup($data)) || !chmod($directory, 02775)) throw new RuntimeException('Cannot set preview status directory permissions.');
        } elseif (!is_dir($directory)) {
            throw new RuntimeException('Cannot create preview status directory.');
        }
    }
    if (!is_dir($directory) || is_link($directory)) throw new RuntimeException('Invalid preview status directory.');
    $key = hash('sha256', $relativePath);
    return ['record' => $directory . '/' . $key . '.json', 'lock' => $directory . '/' . $key . '.lock'];
}

function previewUnavailableMatches(string $toolRoot, string $relativePath, string $source): bool
{
    if (!preg_match('/\.epub\s*$/i', $relativePath)) return false;
    try {
        $paths = previewStatusPaths($toolRoot, $relativePath);
        if ($paths === null || is_link($paths['record']) || !is_file($paths['record']) || filesize($paths['record']) > 4096) return false;
        $record = json_decode((string)@file_get_contents($paths['record']), true, 16);
        $signature = previewSourceSignature($source);
        return $signature !== null && is_array($record)
            && ($record['version'] ?? null) === COMISTREAM_PREVIEW_STATUS_VERSION
            && ($record['reason'] ?? null) === 'no_images'
            && ($record['source'] ?? null) === $signature;
    } catch (Throwable $error) {
        return false;
    }
}

function acquirePreviewStatusLock(string $toolRoot, string $relativePath, bool $create = true)
{
    $paths = previewStatusPaths($toolRoot, $relativePath, $create);
    if ($paths === null) return null;
    if (is_link($paths['lock'])) throw new RuntimeException('Preview status lock must not be a symlink.');
    $newLock = !file_exists($paths['lock']);
    $lock = @fopen($paths['lock'], 'c');
    if ($lock === false) throw new RuntimeException('Cannot open preview status lock.');
    if ($newLock && (!@chgrp($paths['lock'], filegroup(dirname($paths['lock']))) || !chmod($paths['lock'], 0664))) {
        fclose($lock);
        throw new RuntimeException('Cannot set preview status lock permissions.');
    }
    if (!flock($lock, LOCK_EX)) {
        fclose($lock);
        throw new RuntimeException('Cannot lock preview status.');
    }
    return $lock;
}

function savePreviewUnavailable(string $toolRoot, string $relativePath, string $source, array $signature): bool
{
    // 展開中に原本が変わった結果は保存しないルン。
    if (previewSourceSignature($source) !== $signature) return false;
    $temporary = false;
    try {
        $paths = previewStatusPaths($toolRoot, $relativePath, true);
        $temporary = tempnam(dirname($paths['record']), '.preview-status-');
        if ($temporary === false) return false;
        $json = json_encode(['version' => COMISTREAM_PREVIEW_STATUS_VERSION, 'reason' => 'no_images', 'source' => $signature], JSON_THROW_ON_ERROR);
        return file_put_contents($temporary, $json) === strlen($json) && chmod($temporary, 0644)
            && rename($temporary, $paths['record']);
    } catch (Throwable $error) {
        return false;
    } finally {
        if ($temporary !== false && is_file($temporary)) unlink($temporary);
    }
}

function clearPreviewUnavailable(string $toolRoot, string $relativePath, bool $takeLock = true): bool
{
    $lock = null;
    try {
        $paths = previewStatusPaths($toolRoot, $relativePath);
        if ($paths === null) return true;
        if ($takeLock) $lock = acquirePreviewStatusLock($toolRoot, $relativePath, false);
        return !file_exists($paths['record']) && !is_link($paths['record']) || @unlink($paths['record']);
    } catch (Throwable $error) {
        return false;
    } finally {
        // ロックファイル自体は残し、待機中のプロセスと同じinodeを使うルン。
        if (is_resource($lock)) fclose($lock);
    }
}
