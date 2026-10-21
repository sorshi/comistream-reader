const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../comistream.js'), 'utf8');

function fixture(options = {}) {
  const images = [];
  const PreCache = vm.runInNewContext(
    source.slice(source.indexOf('class PreCache'), source.indexOf('var preCaches =')) + '\nPreCache;',
    {
      size: 'FULL', averagePageKBytes: 100, performance, debugLog() {},
      URL, document: { baseURI: 'https://reader.test/' },
      ...options,
      Image: class {
        constructor() { images.push(this); }
        set src(value) { this.url = value; }
      }
    }
  );
  const cache = new PreCache(9);
  const updates = [];
  cache.onChange = () => updates.push(images.map(image => cache.getStatus(image.url)));
  return { cache, images, updates };
}

test('preload status observes loading, retention and eviction without requesting images', async () => {
  const { cache, images, updates } = fixture();
  const url = 'https://reader.test/?page=21&size=FULL';
  assert.equal(cache.getStatus(url), 'empty');
  assert.equal(images.length, 0);
  const loading = cache.add(url);
  assert.equal(cache.getStatus(url), 'loading');
  assert.equal(updates.at(-1)[0], 'loading');
  images[0].onload();
  await loading;
  assert.equal(cache.getStatus(url), 'loaded');
  assert.equal(updates.at(-1)[0], 'loaded');
  await cache.add(url);
  assert.equal(images.length, 1);
  cache.maxCacheEntries = 0;
  cache.evictOldEntries();
  assert.equal(cache.getStatus(url), 'empty');
  assert.equal(updates.at(-1)[0], 'empty');
});

test('failed preloads retry and use exact URLs including size, split and generation', async () => {
  const { cache, images } = fixture();
  const url = 'https://reader.test/?page=21&size=FULL&cache_version=a';
  const failed = cache.add(url);
  images[0].onerror();
  await failed;
  assert.equal(cache.getStatus(url), 'failed');
  const retry = cache.add(url);
  assert.equal(cache.getStatus(url), 'loading');
  images[1].onload();
  await retry;
  assert.equal(cache.getStatus(url), 'loaded');
  assert.equal(cache.getStatus(url + '&als=1'), 'empty');
  assert.equal(cache.getStatus(url.replace('FULL', 'comp')), 'empty');
  assert.equal(cache.getStatus(url.replace('cache_version=a', 'cache_version=b')), 'empty');
});

test('overlapping requests remain loading until settled and a success survives a later failure', async () => {
  const { cache, images } = fixture();
  const first = cache.add('page21');
  const second = cache.add('page21');
  images[0].onerror();
  await first;
  assert.equal(cache.getStatus('page21'), 'loading');
  images[1].onload();
  await second;
  assert.equal(cache.getStatus('page21'), 'loaded');
  assert.equal(cache.loadingCounts.size, 0);

  const third = cache.add('page22');
  const fourth = cache.add('page22');
  images[2].onload();
  await third;
  images[3].onerror();
  await fourth;
  assert.equal(cache.getStatus('page22'), 'loaded');
  assert.equal(cache.failedImages.has('page22'), false);
  assert.equal(cache.loadingCounts.size, 0);
});

test('failure history is bounded and size changes notify the inspector', async () => {
  const { cache, images, updates } = fixture();
  cache.maxCacheEntries = 2;
  for (let page = 1; page <= 3; page++) {
    const pending = cache.add('page' + page);
    images.at(-1).onerror();
    await pending;
  }
  assert.equal(cache.failedImages.size, 2);
  assert.equal(cache.getStatus('page1'), 'empty');
  assert.equal(cache.getStatus('page3'), 'failed');
  const before = updates.length;
  cache.resize(5);
  assert.equal(cache.getSize(), 5);
  assert.ok(updates.length > before);
});

function timingFixture() {
  let now = 100;
  let deliver;
  const timers = new Map();
  const result = fixture({
    performance: { now: () => now },
    PerformanceObserver: class {
      static supportedEntryTypes = ['resource'];
      constructor(callback) { deliver = entries => callback({ getEntries: () => entries }); }
      observe(options) { assert.deepEqual(Array.from(options.entryTypes), ['resource']); }
    },
    setTimeout(callback, delay) { const token = {}; timers.set(token, { callback, at: now + delay }); return token; },
    clearTimeout(token) { timers.delete(token); }
  });
  return {
    ...result, deliver,
    advance(value) {
      now = value;
      for (const [token, timer] of [...timers]) {
        if (timer.at <= now) { timers.delete(token); timer.callback(); }
      }
    },
    entry(url, startTime, responseStart, responseEnd, extra = {}) {
      return { name: new URL(url, 'https://reader.test/').href, entryType: 'resource', initiatorType: 'img',
        startTime, requestStart: startTime + 1, responseStart, responseEnd,
        encodedBodySize: 65536, transferSize: 65836, responseStatus: 200, ...extra };
    }
  };
}

test('display speed is unknown without Resource Timing and keeps legacy preload control', async () => {
  const { cache, images } = fixture({ performance: { now: () => 100 } });
  assert.equal(cache.getBps(), null);
  const pending = cache.add('page1');
  images[0].onload();
  await pending;
  assert.equal(cache.getBps(), null);
  assert.equal(cache.getStatus('page1'), 'loaded');
});

test('display speed uses response bytes and receive time, independent of preload control', async () => {
  const f = timingFixture();
  const first = f.cache.add('page1');
  const a = f.entry('page1', 101, 1100, 1200);
  f.advance(1210);
  f.deliver([a]);
  assert.equal(f.cache.getBps(), null);
  f.images[0].onload();
  await first;
  assert.equal(f.cache.getBps(), null);
  const second = f.cache.add('page2');
  f.advance(2400);
  f.images[1].onload();
  await second;
  const size = f.cache.getSize();
  f.deliver([f.entry('page2', 1211, 2200, 2300)]);
  assert.equal(f.cache.getBps(), Math.floor(131072 * 8 / 200));
  assert.equal(f.cache.getSize(), size);
  f.deliver([a]);
  assert.equal(f.cache.getBps(), Math.floor(131072 * 8 / 200));
});

async function completeTiming(f, url, start, receiveStart, end, extra = {}, success = true) {
  f.advance(start);
  const loading = f.cache.add(url);
  const entry = f.entry(url, start + 1, receiveStart, end, extra);
  f.advance(end + 1);
  f.images.at(-1)[success ? 'onload' : 'onerror']();
  await loading;
  f.deliver([entry]);
  return entry;
}

test('parallel receive intervals use their union, including contained intervals and gaps', async () => {
  const f = timingFixture();
  const a = f.cache.add('a');
  const b = f.cache.add('b');
  const c = f.cache.add('c');
  f.advance(500);
  for (const img of f.images) img.onload();
  await Promise.all([a, b, c]);
  f.deliver([f.entry('a', 101, 200, 400), f.entry('b', 102, 300, 450), f.entry('c', 103, 310, 350)]);
  assert.equal(f.cache.getBps(), Math.floor(3 * 65536 * 8 / 250));
  await completeTiming(f, 'd', 600, 800, 900);
  assert.equal(f.cache.getBps(), Math.floor(4 * 65536 * 8 / 350));
});

test('final headers exclude interim response wait, with responseStart fallback', async () => {
  const f = timingFixture();
  await completeTiming(f, 'a', 100, 110, 1000, { firstInterimResponseStart: 110, finalResponseHeadersStart: 900 });
  await completeTiming(f, 'b', 1100, 1200, 1300, { finalResponseHeadersStart: 0 });
  assert.equal(f.cache.getBps(), Math.floor(131072 * 8 / 200));
  await completeTiming(f, 'c', 1400, 1500, 1600, { finalResponseHeadersStart: 1700 });
  assert.equal(f.cache.getBps(), Math.floor(3 * 65536 * 8 / 300));
});

for (const [reason, extra, success = true] of [
  ['memory/disk cache', { transferSize: 0 }],
  ['304 revalidation reported as 200', { transferSize: 300, responseStatus: 200 }],
  ['deliveryType cache', { deliveryType: 'cache' }],
  ['missing transferSize', { transferSize: undefined }],
  ['legacy revalidation headers', { transferSize: 800 }],
  ['service worker', { workerStart: 100 }],
  ['HTTP error', { responseStatus: 500 }],
  ['opaque timing', { responseStatus: 0 }],
  ['image decode error', {}, false],
  ['missing timing', { requestStart: 0 }],
  ['invalid time', { responseStart: NaN }],
  ['negative interval', { responseStart: 401 }],
  ['response before request', { responseStart: 100 }],
  ['response beyond onload', { responseEnd: 402 }],
  ['short interval', { responseStart: 398 }],
  ['small body', { encodedBodySize: 1024 }],
  ['unknown body size', { encodedBodySize: undefined }],
  ['interim response without final timing', { firstInterimResponseStart: 200 }],
  ['unrelated initiator', { initiatorType: 'css' }],
  ['different full URL', { name: 'https://reader.test/a?size=other' }],
  ['late request start', { startTime: 160, requestStart: 161 }]
]) {
  test('excludes ' + reason, async () => {
    const f = timingFixture();
    await completeTiming(f, 'a', 100, 200, 400, extra, success);
    await completeTiming(f, 'b', 500, 600, 800);
    assert.equal(f.cache.getBps(), null);
    assert.equal(f.cache.transferMeter.samples.length, 1);
  });
}

test('cache load without an entry cannot reuse past timing, even if delivered again', async () => {
  const f = timingFixture();
  const entry = await completeTiming(f, 'same', 100, 200, 300);
  f.cache.imageCache.clear();
  f.advance(400);
  const cached = f.cache.add('same');
  f.advance(401);
  f.images.at(-1).onload();
  await cached;
  f.deliver([entry, entry]);
  assert.equal(f.cache.transferMeter.samples.length, 1);
  assert.equal(f.cache.getBps(), null);
  f.deliver([f.entry('not-requested', 400, 450, 550)]);
  assert.equal(f.cache.transferMeter.samples.length, 1);
});

test('coalesced preloads, dimension probes and multiple matching entries are excluded', async () => {
  for (const mode of ['preload', 'probe-first', 'probe-last', 'two-entries']) {
    const f = timingFixture();
    const meter = f.cache.transferMeter;
    if (mode === 'probe-first') meter.begin('same', false);
    const pending = [f.cache.add('same')];
    if (mode === 'probe-last') meter.begin('same', false);
    if (mode === 'preload') pending.push(f.cache.add('same'));
    f.advance(400);
    for (const img of f.images) img.onload();
    await Promise.all(pending);
    f.deliver([f.entry('same', 101, 200, 300)]);
    if (mode === 'two-entries') f.deliver([f.entry('same', 102, 200, 301)]);
    assert.equal(meter.samples.length, 0, mode);
  }
});

test('timing may precede onload, but decode failure must not become a sample', async () => {
  const f = timingFixture();
  const pending = f.cache.add('broken');
  f.advance(400);
  f.deliver([f.entry('broken', 101, 200, 300)]);
  assert.equal(f.cache.transferMeter.samples.length, 0);
  f.images[0].onerror();
  await pending;
  assert.equal(f.cache.transferMeter.samples.length, 0);
});

test('minimum bytes and union duration are required even with multiple samples', async () => {
  const f = timingFixture();
  await completeTiming(f, 'a', 100, 200, 210);
  await completeTiming(f, 'b', 300, 400, 410);
  assert.equal(f.cache.getBps(), null);
  await completeTiming(f, 'c', 500, 600, 700);
  assert.ok(f.cache.getBps() > 0);
  const small = timingFixture();
  await completeTiming(small, 'a', 100, 200, 300, { encodedBodySize: 32768 });
  await completeTiming(small, 'b', 400, 500, 600, { encodedBodySize: 32768 });
  assert.equal(small.cache.getBps(), null);
});

test('samples expire by response completion time and notify without further traffic', async () => {
  const f = timingFixture();
  await completeTiming(f, 'a', 100, 200, 300);
  await completeTiming(f, 'b', 400, 500, 600);
  assert.ok(f.cache.getBps() > 0);
  const before = f.updates.length;
  f.advance(30300);
  assert.equal(f.cache.getBps(), null);
  assert.ok(f.updates.length > before);
  f.advance(30600);
  assert.equal(f.cache.transferMeter.samples.length, 0);
});

test('sample window and request bookkeeping are bounded; stale requests cannot match', async () => {
  const f = timingFixture();
  for (let i = 0; i < 12; i++) await completeTiming(f, 'page' + i, 100 + i * 400, 200 + i * 400, 300 + i * 400);
  assert.equal(f.cache.transferMeter.samples.length, 8);
  for (let i = 0; i < 200; i++) f.cache.transferMeter.begin('pending' + i);
  assert.ok(f.cache.transferMeter.requests.length <= 128);
  f.advance(70000);
  f.deliver([f.entry('pending199', 5000, 6000, 7000)]);
  assert.equal(f.cache.getBps(), null);
  assert.equal(f.cache.transferMeter.requests.length, 0);
});

for (const observer of [
  class { static supportedEntryTypes = ['mark']; },
  class { observe() { throw new Error('unsupported'); } disconnect() {} }
]) {
  test('unavailable resource observer leaves image preloading operational', async () => {
    const { cache, images } = fixture({ PerformanceObserver: observer });
    const pending = cache.add('page');
    images[0].onload();
    await pending;
    assert.equal(cache.getBps(), null);
    assert.equal(cache.getStatus('page'), 'loaded');
  });
}

test('existing speed thresholds and load-duration calculation remain independent of display speed', async () => {
  const f = timingFixture();
  for (const [speed, pages] of [[0, 27], [160, 22], [320, 20], [640, 16], [2048, 14], [4096, 12]]) {
    f.cache.preloadSpeedKbps = speed;
    f.cache.adjustPreloadPages();
    assert.equal(f.cache.getSize(), pages);
  }
  await completeTiming(f, 'page', 100, 500, 1099);
  assert.equal(f.cache.preloadSpeedKbps, (100 * 1024 * 8 / 1000).toFixed(2));
  assert.equal(f.cache.getSize(), 16);
  assert.equal(f.cache.getBps(), null);
});

test('request saturation discards ambiguous bookkeeping rather than reusing an entry', async () => {
  const f = timingFixture();
  const meter = f.cache.transferMeter;
  meter.maxRequests = 2;
  const pending = f.cache.add('same');
  meter.begin('other', false);
  assert.equal(meter.begin('overflow'), null);
  assert.equal(meter.begin('same'), null);
  f.advance(400);
  f.images[0].onload();
  await pending;
  f.deliver([f.entry('same', 101, 200, 300)]);
  assert.equal(meter.samples.length, 0);
  assert.equal(f.cache.getStatus('same'), 'loaded');
  f.advance(60101);
  assert.ok(meter.begin('new'));
});

test('inspector retains the last completed measurement through expiry and replaces it only with enough new data', async () => {
  const f = timingFixture();
  const display = () => ({ ...f.cache.getNetworkSpeed() });
  assert.deepEqual(display(), { kbps: null, stale: false });
  await completeTiming(f, 'a', 100, 200, 300);
  assert.deepEqual(display(), { kbps: null, stale: false });
  await completeTiming(f, 'b', 400, 500, 700);
  const kbps = Math.floor(131072 * 8 / 300);
  assert.deepEqual(display(), { kbps, stale: false });
  f.advance(30300);
  assert.deepEqual(display(), { kbps, stale: false });
  f.advance(30700);
  assert.deepEqual(display(), { kbps, stale: true });
  assert.equal(f.cache.transferMeter.samples.length, 0);
  await completeTiming(f, 'cached', 31000, 31100, 31200, { transferSize: 0 });
  assert.deepEqual(display(), { kbps, stale: true });
  await completeTiming(f, 'c', 32000, 32100, 32200);
  assert.deepEqual(display(), { kbps, stale: true });
  await completeTiming(f, 'd', 33000, 33100, 33200);
  assert.deepEqual(display(), { kbps: Math.floor(131072 * 8 / 200), stale: false });
});

test('a retained measurement is revoked if a contributing request later becomes ambiguous', async () => {
  const f = timingFixture();
  await completeTiming(f, 'a', 100, 200, 300);
  await completeTiming(f, 'b', 400, 500, 600);
  assert.ok(f.cache.getNetworkSpeed().kbps > 0);
  f.deliver([f.entry('a', 102, 200, 301)]);
  assert.deepEqual({ ...f.cache.getNetworkSpeed() }, { kbps: null, stale: false });
});

test('the retained result becomes stale on time even after its samples leave the aggregation window', async () => {
  const f = timingFixture();
  const meter = f.cache.transferMeter;
  meter.maxSamples = 2;
  await completeTiming(f, 'a', 100, 200, 300);
  await completeTiming(f, 'b', 400, 500, 700);
  await completeTiming(f, 'c', 1000, 1200, 1210);
  const kbps = f.cache.getNetworkSpeed().kbps;
  await completeTiming(f, 'd', 1300, 1400, 1410);
  await completeTiming(f, 'e', 2000, 2200, 2210);
  await completeTiming(f, 'f', 3000, 3200, 3210);
  const updates = f.updates.length;
  f.advance(31210);
  assert.deepEqual({ ...f.cache.getNetworkSpeed() }, { kbps, stale: true });
  assert.ok(f.updates.length > updates);
});
