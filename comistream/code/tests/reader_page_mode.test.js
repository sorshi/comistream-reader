const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const viewport = require('../comistream_viewport.js');
const source = fs.readFileSync(require.resolve('../comistream.js'), 'utf8');

function reader({ preference = 'auto', width = 900, height = 600, wide = [], count = 9 } = {}) {
  const elements = new Map();
  const storage = new Map([['readerPageModePreference', preference]]);
  const writes = [];
  const beacons = [];
  const events = new Map();
  const timers = new Map();
  let timerId = 0;
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      style: {}, textContent: '', value: 1, className: '',
      classList: { contains: () => false, add() {}, remove() {} },
      setAttribute(key, value) { this[key] = value; },
      getAttribute: () => 'Page mode', removeAttribute(key) { delete this[key]; },
      addEventListener() {},
    });
    return elements.get(id);
  }
  const context = {
    console, URL, performance, global_preload_pages: 4, size: 'FULL',
    global_preload_delay_ms: 100, averagePageKBytes: 100, jpegXlProbePage: 0,
    file: 'book', escapedFile: 'book', baseFile: 'book', page: 5, prevPage: 5,
    maxPage: count, direction: 'left', position: 'right', autoSplit: 'on',
    view_query: '', pageGenerator: '/reader', indexArray: [1, 4, 5, 8],
    readerMarkerConfig: {}, ComistreamViewport: viewport,
    innerWidth: width, innerHeight: height,
    location: { origin: 'http://reader.test', pathname: '/reader' },
    i18n: { toc_button_single: 'Single', toc_button_spread: 'Spread',
      toc_button_auto: 'Auto', tooltip_auto_page: 'Automatic' },
    debugLog() {}, scroll() {}, scrollTo() {}, alert() {},
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(name, fn) {
      if (!events.has(name)) events.set(name, []);
      events.get(name).push(fn);
    },
    localStorage: { getItem: (key) => storage.get(key) ?? null,
      setItem(key, value) { writes.push([key, value]); storage.set(key, value); } },
    navigator: { userAgent: '', sendBeacon: (url, data) => beacons.push(data) },
    FormData: class { constructor() { this.values = {}; } append(k, v) { this.values[k] = v; } },
    document: { getElementById: element, documentElement: {}, activeElement: null,
      body: { style: {} }, addEventListener() {}, querySelector: () => null },
    Image: class {
      set src(value) {
        this.url = value;
        const number = Number(new URL(value, 'http://reader.test').searchParams.get('page'));
        this.width = wide.includes(number) ? 1600 : 800;
        this.height = 1200;
        this.naturalWidth = this.width;
        this.naturalHeight = this.height;
        queueMicrotask(() => this.onload?.());
      }
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  context.sugguestbook = () => {};
  context.checkAndShowLargePageNotification = () => {};
  context.updateFullScreenButton = () => {};
  context.unixtime = Math.floor(Date.now() / 1000);
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  return { c: context, element, storage, writes, beacons, events, settle };
}

test('旧設定・不正値を復元し、固定と自動の縦横境界を区別する', () => {
  assert.equal(viewport.restorePageModePreference(null, '2'), 'spread');
  assert.equal(viewport.restorePageModePreference('broken', '1'), 'single');
  assert.equal(viewport.restorePageModePreference('auto', '2'), 'auto');
  for (const width of [0, 599, 600, 601]) {
    assert.equal(viewport.resolvePageMode('single', { width, height: 600 }), 1);
    assert.equal(viewport.resolvePageMode('spread', { width, height: 600 }), 2);
    assert.equal(viewport.resolvePageMode('auto', { width, height: 600 }), width > 600 ? 2 : 1);
  }
});

test('横向きで初期化し、回転の往復で位置・保存回数・自動選択を維持する', async () => {
  const r = reader();
  await r.c.restorePage(); await r.settle();
  assert.equal(r.c.mode, 2);
  assert.equal(r.c.page, 5);
  assert.equal(r.c.displayedStart, 4);
  assert.equal(r.c.displayedEnd, 5);
  const saved = [r.writes.length, r.beacons.length];
  r.c.innerWidth = 400;
  await r.c.updateReaderViewport('test');
  assert.equal(r.c.mode, 1);
  assert.equal(r.c.page, 5);
  r.c.innerWidth = 900;
  await r.c.updateReaderViewport('test');
  assert.equal(r.c.page, 5);
  assert.deepEqual([r.writes.length, r.beacons.length], saved);
  assert.equal(r.storage.get('readerPageModePreference'), 'auto');
});

test('縦横混在でも両方向で全ページを辿り、表紙・巻末・補正・綴じを保持する', async () => {
  for (const count of [1, 8, 9]) for (const correction of [0, 1]) for (const direction of ['left', 'right']) {
    const r = reader({ wide: [3, 4, 7], count });
    r.c.page = 1;
    r.c.fixPage = correction;
    r.c.direction = direction;
    await r.c.restorePage(); await r.settle();
    const seen = new Set();
    for (let i = 0; i <= count; i++) {
      for (let p = r.c.displayedStart; p <= r.c.displayedEnd; p++) seen.add(p);
      if ([3, 4, 7].includes(r.c.page)) assert.equal(r.element('image').style.width, '100%');
      if (r.c.displayedEnd === count) break;
      r.c.next(); await r.settle();
    }
    assert.deepEqual([...seen], Array.from({ length: count }, (_, i) => i + 1));
    const backward = new Set();
    for (let i = 0; i <= count; i++) {
      for (let p = r.c.displayedStart; p <= r.c.displayedEnd; p++) backward.add(p);
      if (r.c.displayedStart === 1) break;
      r.c.back(); await r.settle();
    }
    assert.deepEqual([...backward].sort((a, b) => a - b), [...seen]);
  }
});

test('キー相当の単頁選択は自動・単頁から固定へ移行し、保存例外でも読める', async () => {
  const r = reader({ width: 400 });
  await r.c.restorePage(); await r.settle();
  r.c.single(); await r.settle();
  r.c.innerWidth = 900;
  await r.c.updateReaderViewport('resize');
  assert.equal(r.c.mode, 1);
  assert.equal(r.storage.get('readerPageModePreference'), 'single');
  r.c.localStorage.setItem = () => { throw new Error('blocked'); };
  r.c.spread(); await r.settle();
  assert.equal(r.c.mode, 2);
});

test('遅延した組判定を新しいページへ適用せず、失敗した画像でも停止しない', async () => {
  const r = reader();
  await r.c.restorePage(); await r.settle();
  const releases = [];
  r.c.isWideReaderPage = () => new Promise((resolve) => { releases.push(resolve); });
  const old = r.c.renderReaderPage('old');
  r.c.page = 8;
  r.c.isWideReaderPage = async () => null;
  await r.c.renderReaderPage('new');
  releases.forEach((release) => release(false));
  await old;
  assert.equal(r.c.displayedStart, 8);
  assert.equal(r.c.displayedEnd, 8);
  assert.equal(r.c.readerRenderPending, false);
});

test('入力・ズーム中は保留し、解除後は最新viewportで再判定する', async () => {
  const r = reader({ width: 400 });
  await r.c.restorePage(); await r.settle();
  r.c.visualViewport = { scale: 2 };
  r.c.innerWidth = 900;
  await r.c.updateReaderViewport('resize');
  assert.equal(r.c.mode, 1);
  assert.equal(r.c.readerLayoutPending, true);
  r.c.visualViewport.scale = 1;
  await r.c.updateReaderViewport('zoom.end');
  assert.equal(r.c.mode, 2);
});

test('クイック見開きは横長画像を単独表示し、自動回転では開かない', async () => {
  const r = reader({ width: 400, wide: [5] });
  await r.c.restorePage(); await r.settle();
  await r.c.quickSpredView();
  assert.equal(r.element('image1').style.width, '100%');
  assert.equal(r.element('image2').style.display, 'none');
  r.c.innerWidth = 900;
  await r.c.updateReaderViewport('rotate');
  assert.equal(r.element('modal').style.display, 'none');
  for (const fn of r.events.get('orientationchange')) fn();
  assert.equal(r.element('modal').style.display, 'none');
});

test('縦長画面の混在画像は左右半分を往復し、次・前の画像へ正しく進む', async () => {
  const r = reader({ width: 400, wide: [5] });
  await r.c.restorePage(); await r.settle();
  assert.equal(r.c.autoLightSplitMode, true);
  assert.equal(r.element('image').style.backgroundPosition, 'right');
  r.c.next(); await r.settle();
  assert.equal(r.c.page, 5);
  assert.equal(r.element('image').style.backgroundPosition, 'left');
  r.c.next(); await r.settle();
  assert.equal(r.c.page, 6);
  r.c.back(); await r.settle();
  assert.equal(r.c.page, 5);
  assert.equal(r.element('image').style.backgroundPosition, 'left');
  r.c.back(); await r.settle();
  assert.equal(r.c.page, 5);
  assert.equal(r.element('image').style.backgroundPosition, 'right');
  r.c.back(); await r.settle();
  assert.equal(r.c.page, 4);
});

test('目次の組内を飛ばし、指定位置・保存・補正を回転後も維持する', async () => {
  const r = reader();
  await r.c.restorePage(); await r.settle();
  r.c.nextIndex(); await r.settle();
  assert.equal(r.c.page, 8);
  r.c.navigateToTocPage(5); await r.settle();
  r.c.fixSpreadPage(); await r.settle();
  assert.equal(r.c.page, 5);
  assert.deepEqual([r.c.displayedStart, r.c.displayedEnd], [5,6]);
  r.c.saveCurrentPage();
  assert.equal(r.beacons.at(-1).values.page, 5);
  r.c.innerWidth = 400;
  await r.c.updateReaderViewport('resize');
  assert.equal(r.c.page, 5);
});

test('クイック表示の遅延を取消し、続巻候補のoverlayを消さない', async () => {
  const r = reader({ width: 400 });
  await r.c.restorePage(); await r.settle();
  const releases = [];
  r.c.isWideReaderPage = () => new Promise(resolve => releases.push(resolve));
  const pending = r.c.quickSpredView();
  r.c.closeQuickSpread();
  releases.forEach(resolve => resolve(false));
  await pending;
  assert.notEqual(r.element('modal').style.display, 'block');
  r.element('suggest').classList.contains = name => name === 'suggest-active';
  r.element('modal').style.display = 'block';
  r.element('overlay').style.display = 'block';
  r.c.closeQuickSpread();
  assert.equal(r.element('overlay').style.display, 'block');
});
