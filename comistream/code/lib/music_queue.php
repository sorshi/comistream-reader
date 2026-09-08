<?php

declare(strict_types=1);

/**
 * 音楽キューの検証と列挙を担当するルン。
 *
 * 画面や音声プローブへ依存せず、共有領域からの相対パスだけを扱う。
 */

if (!class_exists('MusicQueueException')) {
    class MusicQueueException extends RuntimeException
    {
        private int $statusCode;

        public function __construct(string $message, int $statusCode)
        {
            parent::__construct($message, $statusCode);
            $this->statusCode = $statusCode;
        }

        public function getStatusCode(): int
        {
            return $this->statusCode;
        }
    }
}

if (!defined('MUSIC_QUEUE_MAX_TRACKS')) {
    define('MUSIC_QUEUE_MAX_TRACKS', 5000);
}
if (!defined('MUSIC_QUEUE_MAX_DEPTH')) {
    define('MUSIC_QUEUE_MAX_DEPTH', 16);
}
if (!defined('MUSIC_QUEUE_MAX_ENTRIES')) {
    define('MUSIC_QUEUE_MAX_ENTRIES', 50000);
}
if (!defined('MUSIC_QUEUE_MAX_SECONDS')) {
    define('MUSIC_QUEUE_MAX_SECONDS', 10.0);
}

/**
 * 共有領域からの相対ディレクトリを一度だけ正規化するルン。
 */
function musicQueueNormalizeRelativeDirectory(string $directory): string
{
    if ($directory === '') {
        return '.';
    }
    if (strpos($directory, "\0") !== false) {
        throw new MusicQueueException('directory contains a NUL byte', 400);
    }
    if ($directory[0] === '/' || $directory[0] === '\\' || preg_match('/^[A-Za-z]:[\\\\\/]/', $directory) === 1) {
        throw new MusicQueueException('absolute directory paths are not accepted', 400);
    }
    if (strpos($directory, '\\') !== false) {
        throw new MusicQueueException('backslash is not accepted in directory paths', 400);
    }
    if (preg_match('~(^|/)\.\.(/|$)~', $directory) === 1) {
        throw new MusicQueueException('parent directory traversal is not accepted', 400);
    }

    $segments = [];
    foreach (explode('/', $directory) as $segment) {
        if ($segment === '' || $segment === '.') {
            continue;
        }
        if (strpos($segment, "\0") !== false || $segment === '..') {
            throw new MusicQueueException('invalid directory segment', 400);
        }
        $segments[] = $segment;
    }

    return $segments === [] ? '.' : implode('/', $segments);
}

/**
 * パスの前方一致を区切り文字境界付きで判定するルン。
 */
function musicQueueIsWithinDirectory(string $path, string $baseDirectory): bool
{
    $baseDirectory = rtrim($baseDirectory, DIRECTORY_SEPARATOR);
    if ($path === $baseDirectory) {
        return true;
    }

    $prefix = $baseDirectory . DIRECTORY_SEPARATOR;
    return strncmp($path, $prefix, strlen($prefix)) === 0;
}

/**
 * 共有ルート配下の相対パスを絶対パスへ解決するルン。
 */
function musicQueueResolveDirectory(string $sharePath, string $relativeDirectory): array
{
    $relativeDirectory = musicQueueNormalizeRelativeDirectory($relativeDirectory);
    $realSharePath = realpath($sharePath);
    if ($realSharePath === false || !is_dir($realSharePath)) {
        throw new MusicQueueException('share directory is unavailable', 503);
    }

    $candidate = $realSharePath;
    if ($relativeDirectory !== '.') {
        foreach (explode('/', $relativeDirectory) as $segment) {
            $candidate .= DIRECTORY_SEPARATOR . $segment;
            if (is_link($candidate)) {
                throw new MusicQueueException('directory symlinks are not accepted', 403);
            }
        }
    }

    $realDirectory = realpath($candidate);
    if ($realDirectory === false) {
        throw new MusicQueueException('directory was not found', 404);
    }
    if (!musicQueueIsWithinDirectory($realDirectory, $realSharePath)) {
        throw new MusicQueueException('directory is outside the share', 403);
    }
    if (!is_dir($realDirectory)) {
        throw new MusicQueueException('requested path is not a directory', 404);
    }
    if (!is_readable($realDirectory) || !is_executable($realDirectory)) {
        throw new MusicQueueException('directory is not readable', 503);
    }

    return [
        'sharePath' => $realSharePath,
        'relativeDirectory' => $relativeDirectory,
        'directoryPath' => $realDirectory,
    ];
}

/**
 * 実パスを共有ルートからの相対パスへ変換するルン。
 */
function musicQueueRelativePathFromShare(string $sharePath, string $path): ?string
{
    $realSharePath = realpath($sharePath);
    $realPath = realpath($path);
    if ($realSharePath === false || $realPath === false || !musicQueueIsWithinDirectory($realPath, $realSharePath)) {
        return null;
    }
    if ($realPath === $realSharePath) {
        return '.';
    }

    $prefix = rtrim($realSharePath, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR;
    return str_replace(DIRECTORY_SEPARATOR, '/', substr($realPath, strlen($prefix)));
}

/**
 * 公開URLのディレクトリが共有領域へ安全に対応している場合だけ相対パスを返すルン。
 * 共有ルートそのものを公開するシンボリックリンクは許可するが、配下のリンクは除外する。
 */
function musicQueueMapPublicDirectoryToShareRelative(
    string $documentRoot,
    string $requestPath,
    string $sharePath
): ?string {
    $realDocumentRoot = realpath($documentRoot);
    $realSharePath = realpath($sharePath);
    $displayedPath = realpath(rtrim($documentRoot, DIRECTORY_SEPARATOR) . '/' . ltrim($requestPath, '/'));
    if ($realDocumentRoot === false || $realSharePath === false || $displayedPath === false) {
        return null;
    }
    if (!is_dir($displayedPath) || !musicQueueIsWithinDirectory($displayedPath, $realSharePath)) {
        return null;
    }

    $relativePath = musicQueueRelativePathFromShare($realSharePath, $displayedPath);
    if ($relativePath === null) {
        return null;
    }

    $relativePublicPath = trim(str_replace('\\', '/', $requestPath), '/');
    $candidate = $realDocumentRoot;
    $shareMountSeen = false;
    if ($relativePublicPath !== '') {
        foreach (explode('/', $relativePublicPath) as $segment) {
            if ($segment === '' || $segment === '.') {
                continue;
            }
            $candidate .= DIRECTORY_SEPARATOR . $segment;
            if (!is_link($candidate)) {
                continue;
            }

            $resolved = realpath($candidate);
            if ($shareMountSeen || $resolved === false || $resolved !== $realSharePath) {
                return null;
            }
            $shareMountSeen = true;
        }
    }

    return $relativePath;
}

/**
 * 同一フォルダの既存ファイル起点キューを作るルン。
 */
function musicQueueCollectDirectTracks(
    string $sharePath,
    string $directoryPath,
    string $selectedPath,
    array $audioExtensions,
    string $selectedRelativePath = ''
): array {
    $realSharePath = realpath($sharePath);
    $realDirectoryPath = realpath($directoryPath);
    $realSelectedPath = realpath($selectedPath);
    if ($realSharePath === false || $realDirectoryPath === false || $realSelectedPath === false) {
        throw new MusicQueueException('music directory was not found', 404);
    }
    if (!musicQueueIsWithinDirectory($realDirectoryPath, $realSharePath)
        || !musicQueueIsWithinDirectory($realSelectedPath, $realSharePath)
        || !is_dir($realDirectoryPath)
        || !is_file($realSelectedPath)
    ) {
        throw new MusicQueueException('music file is outside the share', 403);
    }
    if (!is_readable($realDirectoryPath) || !is_executable($realDirectoryPath)) {
        throw new MusicQueueException('music directory is not readable', 503);
    }

    $audioExtensions = musicQueueNormalizeExtensions($audioExtensions);
    $entries = @scandir($realDirectoryPath, SCANDIR_SORT_NONE);
    if ($entries === false) {
        throw new MusicQueueException('music directory could not be scanned', 503);
    }

    $selectedRelativePath = $selectedRelativePath !== ''
        ? musicQueueNormalizeRelativeDirectory($selectedRelativePath)
        : musicQueueRelativePathFromShare($realSharePath, $realSelectedPath);
    if ($selectedRelativePath === null || $selectedRelativePath === '.') {
        throw new MusicQueueException('music file path could not be resolved', 503);
    }

    $selectedCandidate = $realSharePath . DIRECTORY_SEPARATOR
        . str_replace('/', DIRECTORY_SEPARATOR, $selectedRelativePath);
    $resolvedSelectedCandidate = realpath($selectedCandidate);
    if ($resolvedSelectedCandidate === false || $resolvedSelectedCandidate !== $realSelectedPath) {
        throw new MusicQueueException('selected music file path does not match', 403);
    }

    $queueRoot = dirname($selectedRelativePath);
    if ($queueRoot === '/' || $queueRoot === '\\' || $queueRoot === '') {
        $queueRoot = '.';
    }

    $tracks = [];
    foreach ($entries as $entry) {
        if ($entry === '.' || $entry === '..' || $entry === '' || $entry[0] === '.') {
            continue;
        }
        $entryPath = $realDirectoryPath . DIRECTORY_SEPARATOR . $entry;
        if (!is_file($entryPath)) {
            continue;
        }
        $extension = strtolower(pathinfo($entry, PATHINFO_EXTENSION));
        if (!in_array($extension, $audioExtensions, true)) {
            continue;
        }
        $resolvedEntry = realpath($entryPath);
        if ($resolvedEntry === false || !musicQueueIsWithinDirectory($resolvedEntry, $realSharePath)) {
            // ファイル起点の兄弟symlinkは共有領域内だけを従来どおり含めるルン。
            continue;
        }

        $relativePath = $queueRoot === '.' ? $entry : $queueRoot . '/' . $entry;
        $tracks[] = [
            'path' => $relativePath,
            'name' => $entry,
            'relativeDirectory' => '',
        ];
    }

    // 自然順の同順位は文字列比較で確定させるルン。
    usort($tracks, 'musicQueueCompareTracks');

    $currentIndex = 0;
    foreach ($tracks as $index => $track) {
        if ($track['path'] === $selectedRelativePath || $track['path'] === str_replace('\\', '/', $selectedRelativePath)) {
            $currentIndex = $index;
            break;
        }
    }

    // 明示的に開かれた symlink は既存のファイル起点互換のため選択曲として残すルン。
    $selectedTrackFound = false;
    foreach ($tracks as $track) {
        if ($track['path'] === $selectedRelativePath) {
            $selectedTrackFound = true;
            break;
        }
    }
    if (!$selectedTrackFound && is_file($realSelectedPath)) {
        $selectedName = basename($selectedRelativePath);
        $selectedExtension = strtolower(pathinfo($selectedName, PATHINFO_EXTENSION));
        if (in_array($selectedExtension, $audioExtensions, true)) {
            $tracks[] = [
                'path' => $selectedRelativePath,
                'name' => $selectedName,
                'relativeDirectory' => '',
            ];
            usort($tracks, 'musicQueueCompareTracks');
            foreach ($tracks as $index => $track) {
                if ($track['path'] === $selectedRelativePath) {
                    $currentIndex = $index;
                    break;
                }
            }
        }
    }

    return [
        'source' => 'file',
        'root' => $queueRoot,
        'label' => $queueRoot === '.' ? basename($realDirectoryPath) : basename($queueRoot),
        'recursive' => false,
        'tracks' => $tracks,
        'currentIndex' => $currentIndex,
    ];
}

/**
 * フォルダ起点の再帰キューを上限付きで作るルン。
 */
function musicQueueCollectRecursiveTracks(
    string $sharePath,
    string $relativeDirectory,
    array $audioExtensions,
    array $options = []
): array {
    $resolved = musicQueueResolveDirectory($sharePath, $relativeDirectory);
    $audioExtensions = musicQueueNormalizeExtensions($audioExtensions);
    $limits = [
        'maxTracks' => (int)($options['maxTracks'] ?? MUSIC_QUEUE_MAX_TRACKS),
        'maxDepth' => (int)($options['maxDepth'] ?? MUSIC_QUEUE_MAX_DEPTH),
        'maxEntries' => (int)($options['maxEntries'] ?? MUSIC_QUEUE_MAX_ENTRIES),
        'maxSeconds' => (float)($options['maxSeconds'] ?? MUSIC_QUEUE_MAX_SECONDS),
    ];
    $clock = isset($options['clock']) && is_callable($options['clock'])
        ? $options['clock']
        : static function (): float {
            return function_exists('hrtime') ? hrtime(true) / 1000000000 : microtime(true);
        };
    $startedAt = $clock();
    $state = [
        'entries' => 0,
        'tracks' => 0,
    ];

    $checkLimits = static function () use (&$state, $limits, $clock, $startedAt): void {
        if ($state['entries'] > $limits['maxEntries']) {
            throw new MusicQueueException('music queue entry limit exceeded', 422);
        }
        if ($state['tracks'] > $limits['maxTracks']) {
            throw new MusicQueueException('music queue track limit exceeded', 422);
        }
        if ($limits['maxSeconds'] > 0 && ($clock() - $startedAt) > $limits['maxSeconds']) {
            throw new MusicQueueException('music queue scan timed out', 422);
        }
    };

    $tracks = [];
    $walk = null;
    $walk = static function (
        string $directoryPath,
        string $relativePath,
        string $displayRelativePath,
        int $depth
    ) use (
        &$walk,
        &$tracks,
        &$state,
        $resolved,
        $audioExtensions,
        $limits,
        $checkLimits
    ): void {
        if ($depth > $limits['maxDepth']) {
            throw new MusicQueueException('music queue depth limit exceeded', 422);
        }
        $checkLimits();
        $entries = @scandir($directoryPath, SCANDIR_SORT_NONE);
        if ($entries === false) {
            throw new MusicQueueException('music directory could not be scanned', 503);
        }

        $files = [];
        $directories = [];
        foreach ($entries as $entry) {
            $checkLimits();
            if ($entry === '.' || $entry === '..' || $entry === '' || $entry[0] === '.') {
                continue;
            }
            $state['entries']++;
            $checkLimits();
            $entryPath = $directoryPath . DIRECTORY_SEPARATOR . $entry;
            if (is_link($entryPath)) {
                continue;
            }
            $entryStat = @lstat($entryPath);
            if ($entryStat === false) {
                throw new MusicQueueException('music directory entry could not be read', 503);
            }
            if (is_file($entryPath)) {
                $extension = strtolower(pathinfo($entry, PATHINFO_EXTENSION));
                if (!in_array($extension, $audioExtensions, true)) {
                    continue;
                }
                $resolvedEntry = realpath($entryPath);
                if ($resolvedEntry === false) {
                    throw new MusicQueueException('music file could not be resolved', 503);
                }
                if (!musicQueueIsWithinDirectory($resolvedEntry, $resolved['sharePath'])) {
                    throw new MusicQueueException('music file is outside the share', 403);
                }
                $trackRelativePath = $relativePath === '.' ? $entry : $relativePath . '/' . $entry;
                $files[] = [
                    'path' => $trackRelativePath,
                    'name' => $entry,
                    'relativeDirectory' => $displayRelativePath,
                ];
                $state['tracks']++;
                $checkLimits();
                continue;
            }
            if (is_dir($entryPath)) {
                if (!is_readable($entryPath) || !is_executable($entryPath)) {
                    throw new MusicQueueException('music subdirectory is not readable', 503);
                }
                $directories[] = [
                    'path' => $entryPath,
                    'name' => $entry,
                    'relativePath' => $relativePath === '.' ? $entry : $relativePath . '/' . $entry,
                    'displayRelativePath' => $displayRelativePath === ''
                        ? $entry
                        : $displayRelativePath . '/' . $entry,
                ];
            }
        }

        usort($files, 'musicQueueCompareTracks');
        foreach ($files as $track) {
            $tracks[] = $track;
        }

        usort($directories, static function (array $left, array $right): int {
            $comparison = strnatcmp($left['name'], $right['name']);
            return $comparison !== 0 ? $comparison : strcmp($left['name'], $right['name']);
        });
        if ($depth >= $limits['maxDepth'] && $directories !== []) {
            throw new MusicQueueException('music queue depth limit exceeded', 422);
        }
        foreach ($directories as $child) {
            $walk($child['path'], $child['relativePath'], $child['displayRelativePath'], $depth + 1);
        }
    };

    $walk($resolved['directoryPath'], $resolved['relativeDirectory'], '', 0);

    $label = basename($resolved['directoryPath']);
    if ($label === '' || $label === DIRECTORY_SEPARATOR) {
        $label = $resolved['relativeDirectory'] === '.' ? 'Music' : $resolved['relativeDirectory'];
    }

    return [
        'source' => 'directory',
        'root' => $resolved['relativeDirectory'],
        'label' => $label,
        'recursive' => true,
        'tracks' => $tracks,
        'currentIndex' => 0,
    ];
}

/**
 * 音声拡張子を比較用の小文字配列へそろえるルン。
 */
function musicQueueNormalizeExtensions(array $extensions): array
{
    $normalized = [];
    foreach ($extensions as $extension) {
        $extension = strtolower(ltrim((string)$extension, '.'));
        if ($extension !== '') {
            $normalized[$extension] = true;
        }
    }
    return array_keys($normalized);
}

/**
 * キュー内の自然順を決定するルン。
 */
function musicQueueCompareTracks(array $left, array $right): int
{
    $comparison = strnatcmp($left['name'], $right['name']);
    return $comparison !== 0 ? $comparison : strcmp($left['name'], $right['name']);
}
