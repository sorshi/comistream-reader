<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/comistream_lib.php';

function expectArchiveMemberShell(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

$root = sys_get_temp_dir() . '/comistream-archive-member-' . bin2hex(random_bytes(8));
$bookCacheDirectory = $root . '/cache/fixture';
mkdir($bookCacheDirectory, 0700, true);
$archivePath = $root . '/fixture.cbz';
$capturePath = $root . '/capture';
$markerPath = $root . '/command-ran';
$member = '$(touch command-ran).jpg';
file_put_contents($archivePath, 'archive fixture');
symlink($archivePath, $bookCacheDirectory . '/file');
file_put_contents($capturePath, "#!/bin/sh\nprintf '%s\\n' \"\$@\"\n");
chmod($capturePath, 0700);

$cacheDir = $root . '/cache';
$file = 'fixture';
$page = 1;
$width = 800;
$quality = 75;
$view = '';
$size = 'FULL';
$als = 0;
$tempDir = $root . '/tmp';
$fullsize_png_compress = 1;
$isPageSave = false;
$position_int = 0;
$crop_split_view_parts = '';
$conf = ['isLowMemoryMode' => 0];
$dbh = null;
$convert = '/must-not-run/convert';
$cpdf = '';
$unzip = $capturePath;
$p7zip = $capturePath;
$unrar = '';

try {
    define('MAX_FILE_SIZE_BYTES', 1024);
    file_put_contents($bookCacheDirectory . '/index', $member . "\n");
    file_put_contents($bookCacheDirectory . '/' . $member, 'cached image');
    $cacheCommand = outputPage(true);
    expectArchiveMemberShell(
        shell_exec('cd ' . escapeshellarg($root) . ' && ' . $cacheCommand) === 'cached image',
        'Cached archive member was not passed as one literal filename.'
    );
    expectArchiveMemberShell(!file_exists($markerPath), 'Cached filename executed a shell command.');

    unlink($bookCacheDirectory . '/' . $member);
    file_put_contents($bookCacheDirectory . '/rawindex', "Path = $member\nFolder = -\nSize = 4\n\n");
    $archiveCommand = outputPage(true);
    $archiveArgs = explode("\n", trim((string)shell_exec('cd ' . escapeshellarg($root) . ' && ' . $archiveCommand)));
    expectArchiveMemberShell(
        end($archiveArgs) === $member,
        '7-Zip did not receive the archive member as a literal argument.'
    );
    expectArchiveMemberShell(!file_exists($markerPath), '7-Zip member name executed a shell command.');

    file_put_contents($bookCacheDirectory . '/cp932', '');
    $cp932Command = outputPage(true);
    $cp932Args = explode("\n", trim((string)shell_exec('cd ' . escapeshellarg($root) . ' && ' . $cp932Command)));
    expectArchiveMemberShell(
        end($cp932Args) === $member,
        'unzip did not receive the CP932 member as a literal argument.'
    );
    expectArchiveMemberShell(!file_exists($markerPath), 'CP932 member name executed a shell command.');

    foreach (['../outside.jpg', '/absolute.jpg', 'C:\\outside.jpg', "bad\nname.jpg"] as $unsafe) {
        expectArchiveMemberShell(!isSafeReaderPagePath($unsafe), 'Unsafe archive member path accepted.');
    }
} finally {
    foreach ([$bookCacheDirectory . '/index', $bookCacheDirectory . '/rawindex', $bookCacheDirectory . '/cp932', $bookCacheDirectory . '/file', $bookCacheDirectory . '/' . $member, $archivePath, $capturePath, $markerPath] as $path) {
        if (is_file($path) || is_link($path)) unlink($path);
    }
    rmdir($bookCacheDirectory);
    rmdir($root . '/cache');
    rmdir($root);
}

echo "archive_member_shell.test.php: OK\n";
