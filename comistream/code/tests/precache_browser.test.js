const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { chrome } = require('./browser_fixture');
const { runEpubBrowserFixture } = require('./epub_browser_fixture');
const { preloadSource } = require('./precache_fixture');

test('Chrome: bounded saving, fast/slow reception, interruption recovery and shared foreground Images', { skip: !chrome }, async () => {
  const counts = new Map();
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200"><!--' +
    'x'.repeat(262144) + '--><rect width="800" height="1200" fill="navy"/></svg>');
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/image.svg') {
      const key = request.url;
      counts.set(key, (counts.get(key) || 0) + 1);
      const mode = url.searchParams.get('mode'), page = Number(url.searchParams.get('page'));
      if (mode === 'flaky' && [2, 3].includes(page) && counts.get(key) === 1) {
        response.writeHead(503, { 'Cache-Control': 'no-store' }); response.end('Unavailable'); return;
      }
      if (mode === 'hang' && page === 2 && counts.get(key) === 1) return;
      const wait = mode === 'wait' ? 2700 : 20;
      const interval = mode === 'slow' ? 500 : 10;
      const delay = setTimeout(() => {
        response.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'private, max-age=3600' });
        response.write(svg.subarray(0, 32768));
        let offset = 32768;
        const timer = setInterval(() => {
          if (offset >= svg.length) { clearInterval(timer); response.end(); return; }
          response.write(svg.subarray(offset, offset + 32768)); offset += 32768;
        }, interval);
        response.on('close', () => clearInterval(timer));
      }, wait);
      response.on('close', () => clearTimeout(delay));
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><meta charset="utf-8"><script>
      let size = 'FULL', averagePageKBytes = 800;
      ${preloadSource}
      const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
      const expect = (condition, message) => { if (!condition) throw new Error(message); };
      async function waitFor(check, message, timeout = 15000) {
        const deadline = performance.now() + timeout;
        while (!check()) { if (performance.now() > deadline) throw new Error(message); await pause(20); }
      }
      async function open(mode, saving, maximum = 8) {
        size = saving ? 'comp' : 'FULL';
        const cache = new PreCache();
        const url = page => new URL('/image.svg?mode=' + mode + '&page=' + page, location.href).href;
        cache.prepareView(1, 1, maximum, url);
        await cache.request(url(1), true);
        cache.present(); cache.enable();
        return { cache, url };
      }
      (async () => {
        let f = await open('saving', true);
        await waitFor(() => f.cache.getStatus(f.url(3)) === 'loaded', 'Saving did not fill two images');
        await pause(200);
        expect(f.cache.imageCache.size === 3 && f.cache.active.size === 0, 'Saving fetched beyond trial limit');
        expect(f.cache.plan().parallel === 1, 'Saving used two background requests');
        const visible = f.cache.request(f.url(10), true);
        expect(await visible, 'Budget blocked foreground image'); f.cache.stop();

        f = await open('fast', false);
        await waitFor(() => f.cache.getStatus(f.url(8)) === 'loaded', 'Fast connection did not fill its window');
        expect(f.cache.plan().parallel === 2, 'Fast connection did not allow parallel preload');
        expect(f.cache.getBps() > 10000, 'Fast transfer was not measured');
        const fastTarget = f.cache.target;
        const cached = await f.cache.request(f.url(3), true);
        expect(cached === f.cache.imageCache.get(f.url(3)), 'Foreground did not reuse Image'); f.cache.stop();

        f = await open('slow', false, 3);
        await waitFor(() => f.cache.getStatus(f.url(3)) === 'loaded', 'Slow connection stalled', 20000);
        expect(f.cache.getBps() > 400 && f.cache.getBps() < 700, 'Shaped 500 kbps measurement outside range');
        expect(f.cache.target > fastTarget && f.cache.plan().parallel === 1, 'Slow policy did not enlarge reserve conservatively');
        expect(Math.abs(f.cache.estimate().bytes - ${svg.length}) < 1, 'Estimate did not use actual body size'); f.cache.stop();

        f = await open('wait', false, 3);
        await waitFor(() => f.cache.getStatus(f.url(3)) === 'loaded', 'Long response wait stalled');
        expect(f.cache.getBps() > 10000, 'Server wait polluted receive speed');
        expect(f.cache.estimate().ready >= 2.7 && f.cache.target > fastTarget, 'Readiness delay was ignored'); f.cache.stop();

        f = await open('flaky', false);
        await waitFor(() => f.cache.getStatus(f.url(2)) === 'loaded' && f.cache.getStatus(f.url(8)) === 'loaded', 'Recovery required page navigation');
        expect(f.cache.unstableUntil > performance.now(), 'Recovery reserve was lost');
        expect(f.cache.target >= 39, 'Recovery did not retain large target');
        f.cache.stop();

        f = await open('hang', false, 3);
        const plan = f.cache.plan.bind(f.cache);
        f.cache.plan = () => ({ ...plan(), timeout: 250 });
        // 既に始まった試験用要求にも短い期限を適用するため、位置を変えて取り消すルン。
        f.cache.prepareView(20, 20, 30, f.url); f.cache.present();
        await waitFor(() => f.cache.getStatus(f.url(21)) === 'loaded', 'Jump was blocked by hung previous request');
        f.cache.stop();
        expect(f.cache.active.size === 0, 'Closing retained active requests');
        window.__progressNativeResult = { ok: true };
      })().catch(error => { window.__progressNativeResult = { ok: false, error: error.stack }; });
    </script>`);
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    await runEpubBrowserFixture('http://127.0.0.1:' + server.address().port, { timeoutMs: 45000 });
    const saving = [...counts.keys()].filter(url => url.includes('mode=saving'));
    assert.deepEqual(saving.map(url => new URL(url, 'http://localhost').searchParams.get('page')).sort(), ['1', '10', '2', '3']);
    assert.equal(counts.get('/image.svg?mode=fast&page=3'), 1);
    assert.equal(counts.get('/image.svg?mode=flaky&page=2'), 2);
    assert.equal(counts.get('/image.svg?mode=flaky&page=3'), 2);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
