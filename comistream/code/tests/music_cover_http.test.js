const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withPhpFixture } = require('./http_fixture');

function synchsafe(value) {
  return String.fromCharCode((value >> 21) & 127, (value >> 14) & 127, (value >> 7) & 127, value & 127);
}

function id3Cover(mime, data) {
  const picture = Buffer.concat([Buffer.from([0]), Buffer.from(mime), Buffer.from([0, 3, 0]), data]);
  const frame = Buffer.concat([Buffer.from('APIC'), Buffer.from([picture.length >>> 24, picture.length >>> 16, picture.length >>> 8, picture.length, 0, 0]), picture]);
  const header = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), Buffer.from(synchsafe(frame.length))]);
  return Buffer.concat([header, frame]);
}

test('MP3・FLACの偽装MIMEを拒否し、rasterのContent-Typeを実データから決める', async () => {
  const root = path.join(__dirname, '..');
  const player = fs.readFileSync(path.join(root, 'music_player.php'), 'utf8');
  const start = player.indexOf('function getCoverArt()');
  const end = player.indexOf('// --- 解析ヘルパ ---', start);
  const functions = player.slice(start, end) + player.slice(player.indexOf('function extractMP3CoverFromBuffer'), player.length);
  const metadata = path.join(root, 'music_metadata.php');
  const router = `<?php
    require ${JSON.stringify(metadata)};
    require ${JSON.stringify(path.join(root, 'comistream_lib.php'))};
    function musicAudioReleaseSessionLock(): void {}
    function resolveMusicPlayerAudioPath(string $file) { global $conf; return resolveFileWithinBaseDirectory($conf['sharePath'], $file); }
    $sharePath = __DIR__ . '/share'; if (!is_dir($sharePath)) mkdir($sharePath); $conf = ['sharePath' => $sharePath];
    $audioFormats = ['mp3', 'flac']; $writelog_process_name = 'CoverTest'; $global_debug_flag = false; error_reporting(0);
    if (isset($_GET['seed'])) file_put_contents($sharePath . '/cover.' . $_GET['kind'], base64_decode($_GET['seed']));
    $mode = 'get_cover_art'; $_REQUEST['file'] = 'cover.' . ($_GET['kind'] ?? 'mp3');
    ${functions}
    getCoverArt();`;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cSukAAAAASUVORK5CYII=', 'base64');
  await withPhpFixture(router, async (url) => {
    if (url === null) return;
    for (const kind of ['mp3', 'flac']) {
      const fake = kind === 'mp3' ? id3Cover('text/html', Buffer.from('<img src=x onerror=alert(1)>')) : flacCover('text/html', Buffer.from('<img src=x onerror=alert(1)>'));
      const response = await fetch(`${url}/?` + new URLSearchParams({ kind, seed: fake.toString('base64') }));
      assert.equal(response.status, 204, kind + ': ' + await response.text());
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(await response.text(), '');
    }
    const spoofedImageMime = id3Cover('text/html\r\nX-Test: bad', png);
    const response = await fetch(`${url}/?` + new URLSearchParams({ kind: 'mp3', seed: spoofedImageMime.toString('base64') }));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^image\/png/i);
    assert.equal(response.headers.get('x-test'), null);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
  });
});

function flacCover(mime, data) {
  const le = (n) => Buffer.from([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
  const block = Buffer.concat([le(3), le(Buffer.byteLength(mime)), Buffer.from(mime), le(0), Buffer.alloc(16), le(data.length), data]);
  return Buffer.concat([Buffer.from([0x86, (block.length >>> 16) & 255, (block.length >>> 8) & 255, block.length & 255]), block]);
}
