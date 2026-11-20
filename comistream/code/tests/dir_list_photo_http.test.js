const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { withPhpFixture } = require('./http_fixture');

const php = process.env.PHP_BIN || 'php';
const magick = spawnSync('magick', ['-version']).status === 0;
const code = path.resolve(__dirname, '..');
const fixtures = path.join(__dirname, 'fixtures');

test('写真フォルダの枚数・比率・動画除外の境界', () => {
  const result = execFileSync(php, ['-r', `
    require $argv[1];
    foreach ([[7, 7, 0], [8, 8, 0], [17, 10, 0], [15, 9, 0], [27, 9, 12]] as $counts)
        $result[] = photoListingMeta(...$counts);
    echo json_encode($result);
  `, path.join(code, 'lib/lib_photo.php')]);
  const metadata = JSON.parse(result);
  assert.deepEqual(metadata.map(entry => entry.is_photo_dir), [false, true, false, true, true]);
  assert.deepEqual(metadata.map(entry => entry.show_layout_chip), [false, true, true, true, true]);
});

test('写真一覧APIとゲストの変換配信', { skip: process.env.COMISTREAM_HTTP_TESTS !== '1' }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comistream-photo-http-'));
  try {
    const publicRoot = path.join(root, 'web');
    const directory = path.join(publicRoot, 'nas', '写真 [100%]+');
    const tool = path.join(root, 'tool');
    const thumbs = path.join(tool, 'data/theme/thumbs', path.basename(directory));
    const runtime = path.join(tool, 'data/runtime');
    const db = path.join(tool, 'data/db/comistream.sqlite');
    fs.mkdirSync(directory, { recursive: true });
    fs.mkdirSync(path.dirname(db), { recursive: true });
    fs.mkdirSync(thumbs, { recursive: true });
    fs.mkdirSync(runtime, { recursive: true });
    for (const file of ['comistream_lib.php', 'dir_list_api.php', 'photo_view.php', 'i18n.php', 'lib']) {
      fs.cpSync(path.join(code, file), path.join(tool, 'code', file), { recursive: true });
    }
    execFileSync(php, ['-r', `
      $db = new PDO("sqlite:" . $argv[1]);
      $db->exec("CREATE TABLE system_config (key TEXT PRIMARY KEY, value TEXT)");
      $insert = $db->prepare("INSERT INTO system_config VALUES (?, ?)");
      foreach (["sharePath" => $argv[2], "comistream_tool_dir" => $argv[3], "isLowMemoryMode" => "1", "mutool" => ""] as $k => $v) {
          $insert->execute([$k, $v]);
      }
    `, db, path.dirname(directory), tool]);

    const names = ['a.jpg', 'b.jpeg', 'c.jpe', 'd.webp', 'e.avif', 'f.bmp', 'g.GIF', 'h.HEIC', 'a [50%]+.TIFF'];
    for (const file of [...names, 'video.MOV', 'video.flv', 'book.CBR', '1.txt', '2.txt', '3.txt', '4.txt', '5.txt', '.hidden.jpg']) {
      fs.writeFileSync(path.join(directory, file), '');
    }
    fs.mkdirSync(path.join(directory, 'sub'));
    const tif = names.at(-1);
    const original = path.join(directory, tif);
    fs.copyFileSync(path.join(fixtures, 'photo-probe.tiff'), original);
    fs.copyFileSync(path.join(fixtures, 'photo-probe.heic'), path.join(directory, 'h.HEIC'));
    const external = path.join(publicRoot, 'outside.tiff');
    fs.copyFileSync(original, external);
    const mtime = 1731990000;
    fs.utimesSync(original, mtime, mtime);
    const thumb = tif + '.' + mtime + '.256.webp';
    fs.writeFileSync(path.join(thumbs, thumb), '');
    fs.writeFileSync(path.join(thumbs, 'h.HEIC.123.256.webp'), '');

    const router = `<?php
      $_SERVER['DOCUMENT_ROOT'] = ${JSON.stringify(publicRoot)};
      putenv('COMISTREAM_MANAGED_INSTALL=0');
      if (str_starts_with($_SERVER['REQUEST_URI'], '/listing')) {
          require ${JSON.stringify(path.join(tool, 'code/dir_list_api.php'))};
          return;
      }
      if (str_starts_with($_SERVER['REQUEST_URI'], '/busy')) {
          for ($slot = 0; $slot < 2; ++$slot) {
              $locks[$slot] = fopen(${JSON.stringify(runtime + '/photo-view-')} . $slot . '.lock', 'c');
              flock($locks[$slot], LOCK_EX);
          }
      }
      require ${JSON.stringify(path.join(tool, 'code/photo_view.php'))};`;
    await withPhpFixture(router, async url => {
      const response = await fetch(url + '/listing?' + new URLSearchParams({
        path: '/nas/' + encodeURIComponent(path.basename(directory)) + '/',
      }));
      const listing = await response.json();
      assert.equal(listing.success, true);
      assert.deepEqual(listing.meta.photo, {
        file_count: 17, video_count: 2, image_count: 9, is_photo_dir: true, show_layout_chip: true,
      });
      const entries = new Map(listing.data.map(item => [item.name, item]));
      assert.equal(entries.get('video.MOV').kind, 'video');
      assert.equal(entries.get('book.CBR').kind, 'book');
      assert.equal(entries.get('1.txt').kind, 'other');
      for (const name of names) {
        const item = entries.get(name);
        assert.equal(item.kind, 'image');
        assert.equal(item.icon, '/theme/icons/image.png');
        assert.equal(item.cover_image, undefined);
        assert.equal(item.preview_image, undefined);
        assert.equal(Boolean(item.view_convert), /heic|tiff/i.test(name));
      }
      assert.equal(entries.get('h.HEIC').thumb, undefined);
      assert.equal(decodeURIComponent(entries.get(tif).thumb), '/theme/thumbs/' + path.basename(directory) + '/' + thumb);
      const converted = new URL(entries.get(tif).view_convert, url);
      assert.equal(converted.searchParams.get('file'), path.basename(directory) + '/' + tif);

      fs.symlinkSync(external, path.join(directory, 'escape.tiff'));
      for (const file of ['../outside.tiff', external, path.basename(directory) + '/escape.tiff', path.basename(directory) + '/a.jpg']) {
        const rejected = await fetch(url + '/cgi-bin/photo_view.php?' + new URLSearchParams({ file }));
        assert.equal(rejected.status, 404, file);
        assert.equal(await rejected.text(), '');
      }
      const busy = await fetch(url + '/busy' + converted.search);
      assert.equal(busy.status, 503);
      assert.equal(busy.headers.get('retry-after'), '2');

      if (!magick) return t.diagnostic('ImageMagick not installed. Image conversion skipped.');
      for (const version of [converted.searchParams.get('v'), '0-0']) {
        converted.searchParams.set('v', version);
        converted.searchParams.set('w', '1024');
        const image = await fetch(converted);
        assert.equal(image.status, 200);
        assert.equal(image.headers.get('content-type'), 'image/webp');
        assert.equal(image.headers.get('cache-control'), version === '0-0' ? 'no-store' : 'private, max-age=2592000, immutable');
        assert.equal(Buffer.from(await image.arrayBuffer()).toString('ascii', 8, 12), 'WEBP');
      }
      const formats = execFileSync('magick', ['-list', 'format'], { encoding: 'utf8' });
      if (/^\s*HEIC\*?\s+HEIC\s+r/m.test(formats)) {
        const heic = await fetch(new URL(entries.get('h.HEIC').view_convert, url));
        assert.equal(heic.status, 200);
        assert.equal(heic.headers.get('cache-control'), 'private, max-age=2592000, immutable');
        assert.equal(Buffer.from(await heic.arrayBuffer()).toString('ascii', 8, 12), 'WEBP');
      } else {
        t.diagnostic('ImageMagick HEIC delegate not installed. HEIC conversion skipped.');
      }
      const failed = await fetch(url + '/cgi-bin/photo_view.php?' + new URLSearchParams({
        file: path.basename(directory) + '/broken.tiff',
      }));
      assert.equal(failed.status, 404);
      fs.writeFileSync(path.join(directory, 'broken.tiff'), 'broken image');
      const corrupt = await fetch(failed.url);
      assert.equal(corrupt.status, 500);
      assert.equal(await corrupt.text(), '');
      assert.deepEqual(fs.readdirSync(runtime).sort(), ['photo-view-0.lock', 'photo-view-1.lock']);
      assert.deepEqual(fs.readdirSync(thumbs).sort(), [thumb, 'h.HEIC.123.256.webp'].sort());
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
