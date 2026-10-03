const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { withPhpFixture } = require('./http_fixture');
const library = JSON.stringify(path.resolve(__dirname, '../comistream_lib.php'));
const router = `<?php
require ${library};
$sharePath = __DIR__ . '/books'; $cacheDir = __DIR__ . '/cache';
@mkdir($sharePath); @mkdir($cacheDir); @mkdir($cacheDir . '/fixture');
file_put_contents($sharePath . '/book.cbz', 'fixture');
file_put_contents($cacheDir . '/fixture/index', implode("\\n", array_fill(0, 30, 'page.jpg')) . "\\n");
$dbh = new PDO('sqlite:' . __DIR__ . '/test.sqlite');
$dbh->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$dbh->exec('CREATE TABLE IF NOT EXISTS book_history (id INTEGER PRIMARY KEY, user TEXT, base_file TEXT, path_hash TEXT, current_page INTEGER, max_page INTEGER, has_read INTEGER, epub_cfi TEXT, UNIQUE(user,base_file))');
$dbh->exec("INSERT OR IGNORE INTO book_history VALUES (1,'reader','book.cbz','fixture',3,30,0,NULL)");
$user = $_SERVER['HTTP_X_TEST_USER'] ?? 'reader';
$_SESSION['reader_marker_csrf'] = 'fixture-token';
$input = $_SERVER['REQUEST_METHOD'] === 'POST' ? $_POST : $_GET;
$mode = $input['mode'] ?? '';
if ($mode === 'legacy') {
    try { persistBookReadingProgress($dbh, 'reader', 'book.cbz', 1, null, '', false, false); }
    catch (ReaderProgressException $e) { http_response_code($e->status); }
    exit;
}
handleReaderProgressApi($mode, $input);
`;
test('reading state API protects authenticated progress and rejects legacy writes', async (t) => {
  await withPhpFixture(router, async (url) => {
    if (!url) return t.skip('Set COMISTREAM_HTTP_TESTS=1 to enable HTTP fixtures.');
    const endpoint = url + '/?mode=readingState&file=book.cbz';
    const response = await fetch(endpoint);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const { state } = await response.json();
    assert.equal(state.locator, '3');
    const operation = { mode: 'saveReadingState', file: 'book.cbz', csrf_token: 'fixture-token',
      state_id: state.state_id, expected_revision: 0, policy_epoch: 0,
      writer_id: 'writer_A_123456789', seq: 1, locator: 20, furthest: 20 };
    const post = (body) => fetch(url, { method: 'POST', body: new URLSearchParams(body) });
    assert.equal((await post({ ...operation, csrf_token: 'bad' })).status, 403);
    assert.equal((await post({ ...operation, locator: 31 })).status, 400);
    const saved = await (await post(operation)).json();
    assert.equal(saved.state.locator, '20');
    assert.equal((await (await post(operation)).json()).result, 'duplicate');
    assert.equal((await post({ ...operation, writer_id: 'writer_B_123456789', seq: 2, locator: 1 })).status, 409);
    assert.equal((await fetch(url + '/?mode=legacy')).status, 409);
    assert.equal((await (await fetch(endpoint)).json()).state.locator, '20');
    assert.equal((await fetch(endpoint, { headers: { 'X-Test-User': 'guest' } })).status, 401);
    assert.equal((await fetch(endpoint, { headers: { 'X-Test-User': 'other' } })).status, 404);
    assert.equal((await fetch(url + '/?mode=readingState&file=../book.cbz')).status, 404);
  });
});
