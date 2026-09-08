<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/lib/music_queue.php';

function musicQueueTestAssert(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

function musicQueueTestCleanup(string $path): void
{
    if (is_dir($path) && !is_link($path)) {
        foreach (scandir($path) ?: [] as $entry) {
            if ($entry !== '.' && $entry !== '..') {
                musicQueueTestCleanup($path . DIRECTORY_SEPARATOR . $entry);
            }
        }
        @rmdir($path);
        return;
    }
    if (file_exists($path) || is_link($path)) {
        @unlink($path);
    }
}

function musicQueueTestExpectStatus(callable $callback, int $status, string $message): void
{
    try {
        $callback();
    } catch (MusicQueueException $exception) {
        musicQueueTestAssert($exception->getStatusCode() === $status, $message . ' (wrong status)');
        return;
    }
    throw new RuntimeException($message . ' (no exception)');
}

$temporaryRoot = sys_get_temp_dir() . '/comistream-music-queue-' . bin2hex(random_bytes(8));
$shareRoot = $temporaryRoot . '/share';
$outsideRoot = $temporaryRoot . '/outside';
$publicRoot = $temporaryRoot . '/public';
if (!mkdir($shareRoot . '/Disc 1/Sub', 0775, true) || !mkdir($shareRoot . '/Disc 2', 0775, true)
    || !mkdir($shareRoot . '/Disc 10', 0775, true) || !mkdir($outsideRoot, 0775, true)) {
    throw new RuntimeException('Unable to create music queue test directories.');
}
if (!mkdir($publicRoot, 0775, true)) {
    throw new RuntimeException('Unable to create public test directory.');
}

try {
    foreach ([
        '00-root.mp3',
        '01+title #100%.flac',
        '02&question?.ogg',
        'ignored.mp4',
        '.hidden.mp3',
    ] as $fileName) {
        file_put_contents($shareRoot . '/' . $fileName, 'track');
    }
    file_put_contents($shareRoot . '/Disc 1/01.mp3', 'track');
    file_put_contents($shareRoot . '/Disc 1/02.mp3', 'track');
    file_put_contents($shareRoot . '/Disc 1/Sub/03.mp3', 'track');
    file_put_contents($shareRoot . '/Disc 2/01.mp3', 'track');
    file_put_contents($shareRoot . '/Disc 10/01.mp3', 'track');
    file_put_contents($outsideRoot . '/outside.mp3', 'outside');

    if (function_exists('symlink')) {
        @symlink($outsideRoot . '/outside.mp3', $shareRoot . '/outside-link.mp3');
        @symlink($shareRoot . '/Disc 2/01.mp3', $shareRoot . '/inside-alias.mp3');
        @symlink($shareRoot . '/Disc 1', $shareRoot . '/Disc-link');
        @symlink($shareRoot, $publicRoot . '/nas');
    }

    $queue = musicQueueCollectRecursiveTracks($shareRoot, '.', ['mp3', 'flac', 'ogg']);
    $paths = array_column($queue['tracks'], 'path');
    musicQueueTestAssert($paths === [
        '00-root.mp3',
        '01+title #100%.flac',
        '02&question?.ogg',
        'Disc 1/01.mp3',
        'Disc 1/02.mp3',
        'Disc 1/Sub/03.mp3',
        'Disc 2/01.mp3',
        'Disc 10/01.mp3',
    ], 'Recursive queue ordering or path preservation was incorrect.');
    musicQueueTestAssert($queue['tracks'][5]['relativeDirectory'] === 'Disc 1/Sub', 'Relative track directories were not preserved.');

    $nestedQueue = musicQueueCollectRecursiveTracks($shareRoot, 'Disc 1', ['mp3']);
    musicQueueTestAssert(
        array_column($nestedQueue['tracks'], 'relativeDirectory') === ['', '', 'Sub'],
        'Track directories should be relative to the selected queue root.'
    );

    $directQueue = musicQueueCollectDirectTracks(
        $shareRoot,
        $shareRoot . '/Disc 1',
        $shareRoot . '/Disc 1/02.mp3',
        ['mp3']
    );
    musicQueueTestAssert(
        array_column($directQueue['tracks'], 'path') === ['Disc 1/01.mp3', 'Disc 1/02.mp3'],
        'File-origin queue should contain only direct sibling tracks.'
    );
    musicQueueTestAssert($directQueue['currentIndex'] === 1, 'File-origin current index was incorrect.');

    if (function_exists('symlink') && is_link($shareRoot . '/inside-alias.mp3')) {
        $aliasQueue = musicQueueCollectDirectTracks(
            $shareRoot,
            $shareRoot,
            realpath($shareRoot . '/inside-alias.mp3'),
            ['mp3'],
            'inside-alias.mp3'
        );
        musicQueueTestAssert(
            $aliasQueue['tracks'][$aliasQueue['currentIndex']]['path'] === 'inside-alias.mp3',
            'File-origin queues should preserve an in-share symlink path.'
        );
        musicQueueTestAssert(
            $aliasQueue['root'] === '.',
            'File-origin symlinks should keep the lexical parent directory as the queue root.'
        );
        musicQueueTestAssert(
            !in_array('outside-link.mp3', array_column($aliasQueue['tracks'], 'path'), true),
            'File-origin queues should exclude symlinks that resolve outside the share.'
        );
    }

    musicQueueTestExpectStatus(
        static function () use ($shareRoot): void {
            musicQueueCollectRecursiveTracks($shareRoot, '../outside', ['mp3']);
        },
        400,
        'Traversal should be rejected'
    );
    musicQueueTestExpectStatus(
        static function () use ($shareRoot): void {
            musicQueueCollectRecursiveTracks($shareRoot, '/tmp', ['mp3']);
        },
        400,
        'Absolute paths should be rejected'
    );
    musicQueueTestExpectStatus(
        static function () use ($shareRoot): void {
            musicQueueCollectRecursiveTracks($shareRoot, 'missing', ['mp3']);
        },
        404,
        'Missing directories should return 404'
    );
    musicQueueTestExpectStatus(
        static function () use ($shareRoot): void {
            musicQueueCollectRecursiveTracks($shareRoot, '.', ['mp3'], ['maxTracks' => 1]);
        },
        422,
        'Track limits should reject partial queues'
    );
    musicQueueTestExpectStatus(
        static function () use ($shareRoot): void {
            musicQueueCollectRecursiveTracks($shareRoot, '.', ['mp3'], ['maxDepth' => 1]);
        },
        422,
        'Depth limits should reject nested queues'
    );

    if (function_exists('symlink') && is_link($shareRoot . '/Disc-link')) {
        musicQueueTestExpectStatus(
            static function () use ($shareRoot): void {
                musicQueueCollectRecursiveTracks($shareRoot, 'Disc-link', ['mp3']);
            },
            403,
            'Symlink directory roots should be rejected'
        );
    }
    if (function_exists('symlink') && is_link($publicRoot . '/nas')) {
        musicQueueTestAssert(
            musicQueueMapPublicDirectoryToShareRelative($publicRoot, '/nas', $shareRoot) === '.',
            'The public share-root symlink should map to the share root.'
        );
        musicQueueTestAssert(
            musicQueueMapPublicDirectoryToShareRelative($publicRoot, '/nas/Disc 1', $shareRoot) === 'Disc 1',
            'The public path should map to a share-relative directory.'
        );
        musicQueueTestAssert(
            musicQueueMapPublicDirectoryToShareRelative($publicRoot, '/nas/Disc-link', $shareRoot) === null,
            'A symlink below the public share-root mount should not expose folder actions.'
        );
    }

    echo "music_queue.test.php: OK\n";
} finally {
    musicQueueTestCleanup($temporaryRoot);
}
