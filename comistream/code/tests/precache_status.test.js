const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../comistream.js'), 'utf8');

function fixture() {
  const images = [];
  const PreCache = vm.runInNewContext(
    source.slice(source.indexOf('class PreCache'), source.indexOf('var preCaches =')) + '\nPreCache;',
    {
      size: 'FULL', averagePageKBytes: 100, performance, debugLog() {},
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
