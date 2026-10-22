const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./precache_fixture');

test('time reserve follows five-second reading and faster books, with bounded timeouts', () => {
  const { context: { calculate } } = fixture();
  const plan = (read, ready, horizon) => calculate({ read, ready, horizon, packetSaving: false, readPages: 0, readSeconds: 0 });
  assert.equal(plan(5, 2, 90).target, 21);
  assert.equal(plan(5, 0.47, 60).target, 15);
  assert.equal(plan(5, 13, 120).target, 32);
  assert.equal(plan(5, 6.6, 180).target, 41);
  assert.equal(plan(3, 13, 120).target, 51);
  assert.equal(plan(3, 6.6, 180).target, 67);
  assert.equal(plan(2, 100, 180).target, 72);
  assert.equal(plan(120, 0.1, 60).target, 4);
  assert.equal(plan(5, 0.1, 60).timeout, 20000);
  assert.equal(plan(5, 100, 180).timeout, 90000);
});

test('saving stages require both forward pages and reading time regardless of network failures', () => {
  const { context: { calculate } } = fixture();
  for (const [pages, seconds, target] of [[0, 0, 2], [3, 14, 2], [2, 15, 2], [3, 15, 3],
    [10, 49, 3], [10, 50, 6], [20, 89, 6], [20, 90, 8]]) {
    const p = calculate({ read: 2, ready: 30, horizon: 180, packetSaving: true, readPages: pages, readSeconds: seconds });
    assert.equal(p.target, target);
    assert.equal(p.budget, target * 1024 * 1024);
  }
});

test('fresh body sizes, response waits and readiness drive policy; cached and stale speed do not', async () => {
  const f = fixture();
  for (let page = 1; page <= 3; page++) {
    const pending = f.cache.add(f.url(page));
    f.complete(page, { duration: 4000, wait: 3900, body: 65536 });
    await pending;
  }
  const estimate = f.cache.estimate();
  assert.equal(estimate.bytes, 65536);
  assert.ok(estimate.kbps > 5000);
  assert.ok(estimate.ready >= 4);
  assert.equal(f.cache.plan().parallel, 1);
  assert.ok(f.cache.target >= 28);
  f.advance(31000);
  assert.equal(f.cache.estimate().kbps, null);
  assert.ok(f.cache.getNetworkSpeed().kbps > 0);
  const pending = f.cache.add(f.url(4));
  f.complete(4, { duration: 5000, body: 9999999, cached: true });
  await pending;
  assert.equal(f.cache.estimate().bytes, 65536);
  assert.equal(f.cache.networkSamples.length, 3);
  f.advance(120000);
  assert.equal(f.cache.estimate().known, false);
});

test('saving starts with two images, stops on byte budget, and viewing replenishes only once', async () => {
  const f = fixture({ saving: true, bytes: 1024 * 1024 });
  await f.open();
  assert.equal(f.cache.active.size, 1);
  f.complete(2); f.complete(3);
  assert.equal(f.cache.active.size, 0);
  assert.equal(f.cache.budgetBalance, 0);
  assert.equal(f.cache.imageCache.size, 3);
  f.advance(5000);
  f.cache.recordPageTurn(2); f.view(2); f.cache.present(true, true);
  assert.equal(f.cache.active.size, 1);
  assert.ok(f.cache.active.has(f.url(4)));
  f.complete(4);
  const balance = f.cache.budgetBalance;
  f.view(1); f.cache.present(); f.view(2); f.cache.present();
  assert.equal(f.cache.budgetBalance, balance);
});

test('failed background attempts consume saving budget without refunds or forced refills', async () => {
  const f = fixture({ saving: true, bytes: 1024 * 1024 });
  await f.open();
  f.complete(2, { success: false });
  f.advance(1000);
  assert.ok(f.cache.active.has(f.url(2)));
  f.complete(2, { success: false });
  f.advance(10000);
  assert.equal(f.cache.active.size, 0);
  assert.equal(f.cache.budgetBalance, 0);
  assert.equal(f.cache.plan().target, 2);
  const foreground = f.cache.request(f.url(2), true);
  f.complete(2);
  assert.ok(await foreground);
  assert.equal(f.cache.budgetBalance, 0);
});

test('actual larger response debits estimates, and jumps cannot grant a fresh trial allowance', async () => {
  const f = fixture({ saving: true, bytes: 500000 });
  await f.open();
  f.complete(2, { body: 2500000 });
  assert.ok(f.cache.budgetBalance < 0);
  assert.equal(f.cache.active.size, 0);
  f.cache.readPages = 20; f.cache.readSeconds = 100; f.cache.plan();
  f.cache.budgetBalance = 0;
  f.cache.resetReading(); f.cache.plan();
  f.cache.readPages = 20; f.cache.readSeconds = 100; f.cache.plan();
  assert.equal(f.cache.budgetBalance, 0);
});

test('nearest failed hole retries without navigation; hidden, stopped and resumed readers obey lifecycle', async () => {
  const f = fixture();
  await f.open();
  f.complete(2, { success: false });
  f.complete(3, { success: false });
  assert.ok(f.cache.unstableUntil > f.now());
  assert.equal(f.cache.active.size, 0);
  f.cache.setHidden(true); f.advance(2000);
  assert.equal(f.cache.active.size, 0);
  f.cache.setHidden(false);
  assert.ok(f.cache.active.has(f.url(2)));
  f.complete(2);
  assert.equal(f.cache.globalFailures, 0);
  assert.ok(f.cache.plan().target >= 39);
  const held = f.cache.imageCache.get(f.url(2));
  f.cache.stop();
  assert.equal(f.cache.active.size, 0);
  f.advance(100000);
  assert.equal(f.cache.active.size, 0);
  f.cache.resume();
  assert.ok(f.cache.active.size > 0);
  assert.equal(f.cache.imageCache.get(f.url(2)), held);
});

test('timeouts release hung Images and old callbacks cannot complete a new attempt', async () => {
  const f = fixture();
  await f.open();
  const image = f.cache.active.get(f.url(2)).image;
  const late = image.onload;
  f.advance(20000);
  assert.equal(image.cancelled, true);
  assert.equal(f.cache.getStatus(f.url(2)), 'failed');
  f.advance(1000);
  const replacement = f.cache.active.get(f.url(2));
  assert.ok(replacement);
  late();
  assert.equal(f.cache.active.get(f.url(2)), replacement);
  f.complete(2);
  assert.equal(f.cache.getStatus(f.url(2)), 'loaded');
});

test('display wait remains fifteen seconds while a slow image can finish without restarting', async () => {
  const f = fixture();
  let recovered = 0;
  f.cache.onVisibleReady = () => { recovered++; f.cache.present(true); };
  f.view(1);
  const display = f.context.load_image(f.url(1));
  f.advance(15000);
  assert.equal(await display, null);
  assert.equal(f.cache.active.size, 1);
  f.cache.present(false);
  f.complete(1, { duration: 3000 });
  assert.equal(f.images.length, 1);
  assert.equal(f.cache.getStatus(f.url(1)), 'loaded');
  assert.equal(recovered, 1);
  assert.equal(f.cache.presentation.ready, true);
});

test('foreground shares an active preload and displaces distant work when both slots are occupied', async () => {
  const f = fixture();
  await f.open();
  f.complete(2); f.complete(3);
  assert.equal(f.cache.plan().parallel, 2);
  assert.equal(f.cache.active.size, 2);
  const count = f.images.length;
  const shared = f.cache.request(f.url(4), true);
  assert.equal(f.images.length, count);
  const next = f.cache.request(f.url(50), true);
  assert.equal(f.cache.active.size, 2);
  assert.ok(f.cache.active.has(f.url(50)));
  assert.equal(f.cache.active.has(f.url(5)), false);
  f.complete(4); f.complete(50);
  assert.ok(await shared); assert.ok(await next);
});

test('reading pace counts images, excludes wait, backtracking, jumps, rotation and hidden intervals', () => {
  const f = fixture();
  f.view(1, 2); f.cache.present();
  f.advance(6000); f.cache.recordPageTurn(3);
  f.advance(10000); f.view(3, 4); f.cache.present(true, true);
  assert.equal(f.cache.estimate().read, 3);
  assert.equal(f.cache.readPages, 2);
  f.advance(5000); f.cache.recordPageTurn(1); f.view(1, 2); f.cache.present(true, true);
  f.advance(5000); f.cache.recordPageTurn(3); f.view(3, 4); f.cache.present(true, true);
  assert.equal(f.cache.readPages, 2);
  f.advance(5000); f.cache.recordPageTurn(50); f.view(50); f.cache.present(true, true);
  assert.equal(f.cache.readPages, 0);
  const count = f.cache.readTimes.length;
  f.cache.setHidden(true); f.advance(5000); f.cache.setHidden(false);
  f.advance(5000); f.cache.recordPageTurn(51); f.view(51); f.cache.present(true, true);
  assert.equal(f.cache.readTimes.length, count);
  f.cache.present(); f.advance(5000); f.cache.recordPageTurn(52); f.view(52); f.cache.present(true, true);
  assert.equal(f.cache.readTimes.length, count);
  f.advance(100); f.cache.recordPageTurn(53); f.view(53); f.cache.present(true, true);
  assert.equal(f.cache.readTimes.length, count);
});

test('saving idles after thirty seconds and resets stages after a long break', async () => {
  const f = fixture({ saving: true });
  await f.open(); f.complete(2); f.complete(3);
  f.advance(30000);
  f.cache.readPages = 20; f.cache.readSeconds = 100; f.cache.replan();
  assert.equal(f.cache.active.size, 0);
  f.advance(120000); f.cache.recordPageTurn(2); f.view(2); f.cache.present(true, true);
  assert.equal(f.cache.plan().target, 2);
});

test('projected memory limits avoid repeated eviction and loading while pinning current pages', async () => {
  const f = fixture({ bytes: 1000000 });
  f.cache.maxBytes = 4000000; f.cache.maxPixels = 4000000;
  await f.open();
  f.complete(2); f.complete(3); f.complete(4);
  assert.equal(f.cache.active.size, 0);
  assert.equal(f.cache.getSize(), 3);
  for (let i = 0; i < 10; i++) f.cache.replan();
  assert.equal(f.images.length, 4);
  assert.ok(f.cache.imageCache.has(f.url(1)));
  f.cache.maxBytes = 1; f.cache.maxPixels = 1; f.cache.replan();
  assert.equal(f.cache.imageCache.size, 1);
  assert.equal(f.cache.getSize(), 0);
});

test('missing timing API still allows reading and timeout recovery', async () => {
  const f = fixture({ observer: false });
  await f.open(); f.advance(20000); f.advance(1000); f.complete(2);
  assert.equal(f.cache.getBps(), null);
  assert.equal(f.cache.globalFailures, 0);
  assert.equal(f.cache.getStatus(f.url(2)), 'loaded');
});

test('viewed-page accounting survives jumps and metadata eviction without repeated credit', () => {
  const f = fixture({ saving: true });
  assert.equal(f.cache.markViewed(50), true);
  assert.equal(f.cache.markViewed(1), true);
  assert.equal(f.cache.markViewed(2), true);
  assert.equal(f.cache.markViewed(50), false);
  assert.equal(f.cache.markViewed(1), false);
  for (let i = 0; i < 500; i++) f.cache.markViewed(100 + i * 2);
  assert.ok(f.cache.viewedRanges.length <= 128);
  assert.equal(f.cache.markViewed(1), false);
});

test('120 seconds of stability are required before reserve shrinks gradually', async () => {
  const f = fixture();
  for (let page = 1; page <= 3; page++) { f.cache.add(f.url(page)); f.complete(page, { duration: 5000 }); }
  const large = f.cache.plan().target;
  f.advance(121000);
  for (let page = 4; page <= 6; page++) { f.cache.add(f.url(page)); f.complete(page); }
  assert.equal(f.cache.plan().target, large - 2);
  for (let i = 0; i < 5; i++) f.cache.replan();
  assert.equal(f.cache.plan().target, large - 2);
  f.advance(30000);
  assert.equal(f.cache.plan().target, large - 4);
});

test('parallel contention falls back to one background request with a cooldown', async () => {
  const f = fixture();
  for (let page = 1; page <= 3; page++) { f.cache.add(f.url(page)); f.complete(page); }
  for (let page = 4; page <= 6; page += 2) {
    f.cache.add(f.url(page)); f.cache.add(f.url(page + 1));
    f.complete(page, { duration: 200 }); f.complete(page + 1, { duration: 100 });
  }
  assert.ok(f.cache.parallelPenaltyUntil > f.now());
  assert.equal(f.cache.plan().parallel, 1);
});

for (const outage of [30000, 60000, 120000]) {
  test(`retained pages survive a ${outage / 1000}s outage and recovery resumes without online events`, async () => {
    const f = fixture();
    await f.open(); f.complete(2); f.complete(3);
    const retained = f.cache.imageCache.get(f.url(2));
    for (let ms = 0; ms < outage; ms += 1000) {
      for (const attempt of [...f.cache.active.values()]) {
        f.complete(Number(new URL(attempt.record.url).searchParams.get('page')), { duration: 1, success: false });
      }
      f.advance(1000);
    }
    assert.equal(f.cache.imageCache.get(f.url(2)), retained);
    for (let ms = 0; !f.cache.active.size && ms < 31000; ms += 100) f.advance(100);
    assert.ok(f.cache.active.size > 0);
    const nearest = [...f.cache.active.values()][0];
    f.complete(Number(new URL(nearest.record.url).searchParams.get('page')));
    assert.equal(f.cache.globalFailures, 0);
    assert.ok(f.cache.unstableUntil > f.now());
  });
}

test('long reading bounds retained images, observations, metadata and timers', async () => {
  const f = fixture();
  await f.open();
  for (let page = 2; page <= 300; page++) {
    while (f.cache.active.size) {
      const attempt = [...f.cache.active.values()][0];
      f.complete(Number(new URL(attempt.record.url).searchParams.get('page')));
    }
    f.advance(5000); f.cache.recordPageTurn(page); f.view(page, page, 400);
    if (f.cache.getStatus(f.url(page)) !== 'loaded') { f.cache.request(f.url(page), true); f.complete(page); }
    f.cache.present(true, true);
    assert.ok(f.cache.imageCache.size + f.cache.active.size <= 80);
    assert.ok(f.cache.usage().bytes <= f.cache.maxBytes);
    assert.ok(f.cache.usage().pixels <= f.cache.maxPixels);
  }
  assert.ok(f.cache.records.size <= 256);
  assert.ok(f.cache.transferMeter.requests.length <= 128);
  assert.ok(f.cache.networkSamples.length <= 20);
  assert.ok(f.cache.readySamples.every(sample => sample.image === null));
  assert.ok(f.timers.size <= 4);
});
