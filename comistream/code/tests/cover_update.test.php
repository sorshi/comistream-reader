<?php

declare(strict_types=1);
require_once dirname(__DIR__) . '/comistream_lib.php';

if (($argv[1] ?? '') === '--worker') {
    $fixture = json_decode(file_get_contents($argv[2]), true, 512, JSON_THROW_ON_ERROR);
    $conf = ['comistream_tool_dir' => $fixture['tool']];
    $publicDir = '/nas';
    $user = $fixture['user'];
    // フォームの内側のエンコードだけ残った、PHPパラメータ解析後の値を渡すルン。
    parse_str(http_build_query(['file' => rawurlencode($fixture['relative'])]), $parameters);
    $file = $parameters['file'];
    coverUpdate();
    exit(2);
}

function expectCoverUpdate(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

function removeCoverUpdateFixture(string $root): void
{
    foreach (new FilesystemIterator($root) as $item) {
        if ($item->isDir() && !$item->isLink()) removeCoverUpdateFixture($item->getPathname());
        else unlink($item->getPathname());
    }
    rmdir($root);
}

$root = sys_get_temp_dir() . '/comistream-cover-update-' . bin2hex(random_bytes(8));
mkdir($root, 0700);
try {
    foreach (['japanese', 'literal-percent', 'without-preview', 'without-preview-root', 'leaf-link', 'traversal', 'parent-link', 'parent-link-missing', 'guest'] as $case) {
        $tool = $root . '/' . $case;
        $relative = 'Comic/動作検証用特殊ファイル等/epub/[谷崎潤一郎] 春琴抄 + #?&.epub';
        if ($case === 'literal-percent') $relative = 'Comic/%2F %2e%2e 100% +.epub';
        if ($case === 'traversal') $relative = '../outside.epub';
        if ($case === 'parent-link') $relative = 'escape/outside.epub';
        if ($case === 'parent-link-missing') $relative = 'escape/missing/outside.epub';
        $base = preg_replace('/\.[^.]+$/', '', $relative);
        $cover = $tool . '/data/theme/covers/nas/' . $base . '.jpg';
        $preview = $tool . '/data/theme/preview/nas/' . $base . '.webp';
        mkdir($tool . '/data/theme/covers/nas', 0700, true);
        if ($case !== 'without-preview-root') mkdir($tool . '/data/theme/preview/nas', 0700, true);
        $outside = $tool . '/outside';
        mkdir($outside, 0700);
        file_put_contents($outside . '/outside.jpg', 'keep');
        file_put_contents($outside . '/outside.webp', 'keep');
        if (in_array($case, ['parent-link', 'parent-link-missing'], true)) {
            symlink($outside, $tool . '/data/theme/covers/nas/escape');
            symlink($outside, $tool . '/data/theme/preview/nas/escape');
        } elseif ($case !== 'traversal') {
            mkdir(dirname($cover), 0700, true);
            if ($case === 'leaf-link') symlink($outside . '/outside.jpg', $cover);
            else file_put_contents($cover, 'cover');
            if (!in_array($case, ['without-preview', 'without-preview-root'], true)) {
                mkdir(dirname($preview), 0700, true);
                file_put_contents($preview, 'preview');
            }
        }
        $fixturePath = $tool . '/fixture.json';
        file_put_contents($fixturePath, json_encode(['tool' => $tool, 'relative' => $relative, 'user' => $case === 'guest' ? 'guest' : 'reader'], JSON_THROW_ON_ERROR));
        $output = [];
        $status = 0;
        exec(escapeshellarg(PHP_BINARY) . ' ' . escapeshellarg(__FILE__) . ' --worker ' . escapeshellarg($fixturePath) . ' 2>&1', $output, $status);
        if (in_array($case, ['guest', 'traversal', 'parent-link', 'parent-link-missing'], true)) {
            expectCoverUpdate($status !== 0, $case . ': unsafe or unauthenticated deletion succeeded.');
            if ($case === 'guest') expectCoverUpdate(is_file($cover) && is_file($preview), 'Guest removed cached images.');
        } else {
            expectCoverUpdate($status === 0 && !file_exists($cover) && !is_link($cover), $case . ': cover was not deleted: ' . implode("\n", $output));
            expectCoverUpdate(!file_exists($preview), $case . ': preview was not deleted.');
        }
        expectCoverUpdate(file_get_contents($outside . '/outside.jpg') === 'keep' && file_get_contents($outside . '/outside.webp') === 'keep', $case . ': external target changed.');
    }
} finally {
    removeCoverUpdateFixture($root);
}

echo "cover_update.test.php: OK\n";
