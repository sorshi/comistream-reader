const test = require('node:test');
const assert = require('node:assert/strict');
const { withPhpFixture } = require('./http_fixture');
const { router } = require('./reader_progress_http_fixture');
test('reading state API protects authenticated progress and rejects legacy writes', async (t) => {
  await withPhpFixture(router, async (url) => {
    if (!url) return t.skip('Set COMISTREAM_HTTP_TESTS=1 to enable HTTP fixtures.');
    const endpoint = url + '/?mode=readingState&file=book.cbz';
    const response = await fetch(endpoint);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const { state } = await response.json();
    assert.equal(state.locator, '3');
    assert.equal(state.resume_policy, 'last_position');
    const operation = { mode: 'saveReadingState', file: 'book.cbz', csrf_token: 'fixture-token',
      state_id: state.state_id, expected_revision: 0, policy_epoch: 0,
      writer_id: 'writer_A_123456789', seq: 1, locator: 20, furthest: 20, resume_policy: 'last_position' };
    const post = (body) => fetch(url, { method: 'POST', body: new URLSearchParams(body) });
    assert.equal((await post({ ...operation, csrf_token: 'bad' })).status, 403);
    assert.equal((await post({ ...operation, locator: 31 })).status, 400);
    const legacy = { ...operation }; delete legacy.resume_policy;
    const rejected = await post(legacy);
    assert.equal(rejected.status, 409); assert.equal((await rejected.json()).reason, 'reader_update_required');
    const saved = await (await post(operation)).json();
    assert.equal(saved.state.locator, '20');
    assert.equal((await (await post(operation)).json()).result, 'duplicate');
    assert.equal((await post({ ...operation, writer_id: 'writer_B_123456789', seq: 2, locator: 1 })).status, 409);
    assert.equal((await fetch(url + '/?mode=legacy')).status, 409);
    assert.equal((await (await fetch(endpoint)).json()).state.locator, '20');
    const returned = await (await post({ ...operation, seq: 2, locator: 3, furthest: 20 })).json();
    assert.equal(returned.state.locator, '3'); assert.equal(returned.state.has_read, false);
    const alias = await (await fetch(url + '/?mode=readingState&file=alias.cbz')).json();
    assert.equal(alias.state.locator, '5');
    assert.notEqual(alias.state.state_id, state.state_id);
    assert.equal((await fetch(endpoint, { headers: { 'X-Test-User': 'guest' } })).status, 401);
    assert.equal((await fetch(endpoint, { headers: { 'X-Test-User': 'other' } })).status, 404);
    assert.equal((await fetch(url + '/?mode=readingState&file=../book.cbz')).status, 404);
  });
});
