const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withPhpFixture } = require('./http_fixture');

const lib = path.join(__dirname, '..', 'comistream_lib.php');
const bookId = 'a'.repeat(32);
const generation = 'b'.repeat(32);
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cSukAAAAASUVORK5CYII=';

// comistream.phpと同じ順でセッションを開始し、実際のoutputPage()の応答ヘッダーを確認するルン。
const router = `<?php
  require ${JSON.stringify(lib)};
  $writelog_process_name = 'PageCacheTest'; $global_debug_flag = false; error_reporting(0);
  $root = __DIR__ . '/data'; $cacheDir = $root . '/cache';
  foreach ([${JSON.stringify(bookId)}, 'legacy'] as $name) {
    $directory = $cacheDir . '/' . $name;
    if (is_dir($directory)) continue;
    mkdir($directory, 0775, true);
    file_put_contents($root . '/' . $name . '.cbz', 'archive fixture');
    symlink($root . '/' . $name . '.cbz', $directory . '/file');
    file_put_contents($directory . '/index', "001.png\\n002.jxl\\n");
    file_put_contents($directory . '/001.png', base64_decode(${JSON.stringify(png)}));
    file_put_contents($directory . '/002.jxl', 'JXL fixture');
    writeReaderBookCacheRecord($directory, ['schema' => 1, 'source' => ['size' => 1], 'generation' => ${JSON.stringify(generation)}]);
  }
  session_save_path($root);
  session_start();
  session_write_close();
  $file = $_GET['file'] ?? ''; $page = $_GET['page'] ?? '1'; $size = 'FULL'; $view = '';
  $quality = 75; $width = 800; $als = 0; $tempDir = $root . '/tmp'; $fullsize_png_compress = 0;
  $isPageSave = false; $position_int = 0; $crop_split_view_parts = '';
  $conf = ['isLowMemoryMode' => 0, 'image_max_width' => 8000, 'image_max_height' => 8000];
  $dbh = null; $convert = '/must-not-run/convert'; $cpdf = ''; $unzip = ''; $p7zip = ''; $unrar = '';
  outputPage();`;

test('世代付きURLのページ画像だけを長期キャッシュ可能にし、Pragmaを残さない', async (t) => {
  await withPhpFixture(router, async (url) => {
    if (!url) return t.skip('Set COMISTREAM_HTTP_TESTS=1 to enable HTTP fixtures.');
    const get = (query) => fetch(url + '/?' + new URLSearchParams(query), { headers: { Accept: 'image/webp,image/*' } });

    for (const page of ['1', '2']) {
      const versioned = await get({ file: bookId, page, cache_version: generation });
      assert.equal(versioned.status, 200);
      assert.equal(versioned.headers.get('cache-control'), 'private, max-age=2592000, immutable');
      assert.equal(versioned.headers.get('pragma'), null);
      assert.equal(versioned.headers.get('expires'), null);
      assert.equal(versioned.headers.get('vary'), 'Accept');
      assert.match(versioned.headers.get('content-type'), page === '1' ? /^image\/png/ : /^image\/jxl/);
      const body = Buffer.from(await versioned.arrayBuffer());
      assert.deepEqual(body, page === '1' ? Buffer.from(png, 'base64') : Buffer.from('JXL fixture'));
    }

    // 世代のないURLは原本を差し替えても同じURLなので、従来の応答を変えないルン。
    for (const query of [{ file: bookId, page: '1' }, { file: 'legacy', page: '1', cache_version: generation }]) {
      const plain = await get(query);
      assert.equal(plain.status, 200);
      assert.equal(plain.headers.get('cache-control'), 'private, max-age=86400');
      assert.equal(plain.headers.get('pragma'), 'no-cache');
      assert.equal(plain.headers.get('vary'), null);
    }

    const stale = await get({ file: bookId, page: '1', cache_version: 'c'.repeat(32) });
    assert.equal(stale.headers.get('cache-control'), 'no-store');
    assert.equal(stale.headers.get('pragma'), 'no-cache');
    assert.match(stale.headers.get('content-type'), /^image\/png/);
    assert.notDeepEqual(Buffer.from(await stale.arrayBuffer()), Buffer.from(png, 'base64'));
  });
});

test('outputPage()の成功応答はすべて共通のキャッシュヘッダー処理を通る', () => {
  const source = fs.readFileSync(lib, 'utf8');
  const start = source.indexOf('function outputPage(');
  const body = source.slice(start, source.indexOf('} //end function outputPage', start));
  assert.equal(body.match(/sendReaderPageCacheHeaders\(\$versionedPageUrl\);/g)?.length, 8);
  assert.equal(body.includes('max-age='), false);
});
