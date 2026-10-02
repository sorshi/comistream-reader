const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withPhpFixture } = require('./http_fixture');

test('プレイリストの成功・エラー・悪意ある名前をJSON MIMEで返す', async () => {
  const root = path.join(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'music_player.php'), 'utf8');
  const headers = source.slice(source.indexOf("if (in_array($mode, ['create_playlist'"), source.indexOf('// プレイリスト関連のDB'));
  const functions = source.slice(source.indexOf('function createMusicTables('), source.indexOf('function resolveMusicLyricsSidecars('));
  const dispatch = source.slice(source.indexOf("if ($mode == 'open'"), source.indexOf('/**\n * 音楽プレイヤーテーブル'));
  const router = `<?php require ${JSON.stringify(path.join(root, 'comistream_lib.php'))};
    $dbh = new PDO('sqlite::memory:'); $dbh->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC); $writelog_process_name = 'MusicPlayerTest';
    $mode = $_REQUEST['mode']; $user = 'guest'; $playlist_id = 1; $file = '<img src=x onerror=alert(1)>.mp3';
    ${functions}
    createMusicTables($dbh);
    $dbh->prepare('INSERT INTO music_playlists(user,name,description) VALUES(?,?,?)')->execute([$user, '<img src=x onerror=alert(1)>', '日本語']);
    ${headers}
    ${dispatch}`;
  await withPhpFixture(router, async (url) => {
    if (url === null) return;
    for (const mode of ['create_playlist', 'add_to_playlist', 'get_playlists', 'get_playlist_tracks', 'delete_playlist']) {
      const response = await fetch(url + '/?mode=' + mode, { method: 'POST', body: new URLSearchParams({ name: '<img src=x onerror=alert(1)>' }) });
      assert.match(response.headers.get('content-type'), /^application\/json; charset=UTF-8$/i);
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      const text = await response.text();
      let payload;
      try { payload = JSON.parse(text); } catch (error) { throw new Error(`${mode} returned non-JSON: ${text}`); }
      assert.equal(payload.success, true);
      if (mode === 'get_playlists') assert.equal(payload.playlists[0].name, '<img src=x onerror=alert(1)>');
    }
    const error = await fetch(url + '/?mode=create_playlist', { method: 'POST' });
    assert.match(error.headers.get('content-type'), /^application\/json/);
    assert.equal((await error.json()).success, false);
  });
});
