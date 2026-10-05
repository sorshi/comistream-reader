const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const viewport = require('../comistream_viewport.js');
const source = fs.readFileSync(require.resolve('../comistream.js'), 'utf8');

function reader({ preference = 'auto', width = 900, height = 600, wide = [], count = 9, progressState = null } = {}) {
  let remote = progressState;
  const posts = [];
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
    console, URL, performance, AbortController, global_preload_pages: 4, size: 'FULL',
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
  if (progressState) {
    context.readerProgressConfig = { isGuest: false, userKey: 'test', bookKey: 'book' };
    context.fetch = async (_url, init) => {
      if (init.body) {
        posts.push({ ...init.body.values });
        remote = { ...remote, locator: init.body.values.locator,
          has_read: remote.has_read || Boolean(init.body.values.completion_locator), revision: remote.revision + 1 };
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, result: 'applied', state: { ...remote } }) };
    };
    context.confirm = () => true;
  }
  context.window = context;
  vm.createContext(context);
  if (progressState) vm.runInContext(fs.readFileSync(require.resolve('../reader_progress.js'), 'utf8'), context);
  vm.runInContext(source, context);
  context.sugguestbook = () => {};
  context.checkAndShowLargePageNotification = () => {};
  context.updateFullScreenButton = () => {};
  context.unixtime = Math.floor(Date.now() / 1000);
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  return { c: context, element, storage, writes, beacons, events, settle, posts, setRemote: (state) => { remote = state; } };
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

test('画像リーダーは先頭からさらに戻ると先頭の文言で確認し、承諾時だけ閉じる', async () => {
  for (const preference of ['single', 'spread']) {
    const r = reader({ preference });
    r.c.page = 3;
    const confirmations = [];
    let accepted = false, closes = 0;
    r.c.confirm = message => { confirmations.push(message); return accepted; };
    r.c.backListPage = () => { closes++; };
    await r.c.restorePage(); await r.settle();
    while (r.c.displayedStart > 1) { r.c.back(); await r.settle(); }
    assert.deepEqual(confirmations, []);
    r.c.back();
    assert.deepEqual(confirmations, ['先頭ページです。リーダーを閉じますか？']);
    assert.equal(closes, 0);
    accepted = true;
    r.c.back();
    assert.equal(closes, 1);
    assert.equal(r.c.displayedStart, 1);
  }
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
  r.element('suggest').open = true;
  r.element('modal').style.display = 'block';
  r.element('overlay').style.display = 'block';
  r.c.closeQuickSpread();
  assert.equal(r.element('overlay').style.display, 'block');
});


const initialProgress = (patch = {}) => ({ state_id: 'a'.repeat(32), revision: 0, policy_epoch: 0,
  has_read: true, locator: '1', last_writer_id: null, last_writer_seq: 0, writer_base_revision: 0,
  resume_policy: 'last_position', ...patch });

test('新方式ではサーバーの表紙を復元し、初期表示と回転で保存しない', async () => {
  const r = reader({ progressState: initialProgress(), count: 20 });
  r.storage.set('book', '3');
  await r.c.restorePage(); await r.settle();
  assert.equal(r.c.page, 1); assert.equal(r.posts.length, 0); assert.equal(r.beacons.length, 0);
  await r.c.updateReaderViewport('resize');
  await r.c.readerProgressManager.flush();
  assert.equal(r.posts.length, 0);
});

test('新方式で既読の戻り位置と読了直後の表紙を保存する', async () => {
  const r = reader({ progressState: initialProgress({ locator: '3' }), count: 20 });
  await r.c.restorePage();
  r.c.page = 1; await r.c.loadPage(-1); await r.c.readerProgressManager.flush();
  assert.equal(r.posts.at(-1).locator, '1');
  const unread = reader({ preference: 'single', progressState: initialProgress({ has_read: false, locator: '19' }), count: 20 });
  await unread.c.restorePage(); unread.c.page = 20; await unread.c.loadPage(1);
  unread.c.page = 1; await unread.c.loadPage(-1); await unread.c.readerProgressManager.flush();
  assert.equal(unread.posts.at(-1).locator, '1');
  assert.ok(unread.posts.some(post => post.completion_locator === '20'));
});

test('新方式の復帰確認は描画と保存より先に行う', async () => {
  const r = reader({ progressState: initialProgress({ locator: '3' }), count: 20 });
  await r.c.restorePage();
  r.setRemote(initialProgress({ revision: 1, locator: '1', last_writer_id: 'another_writer' }));
  for (const wake of r.events.get('focus')) wake();
  await r.settle();
  r.c.page = 4; await r.c.loadPage(1); await r.settle();
  assert.equal(r.c.page, 1); assert.equal(r.posts.length, 0);
});

test('未読CBZは先のページを見て戻った読みかけ位置を保存する', async () => {
  const r = reader({ preference:'single', progressState:initialProgress({ has_read:false, locator:'5' }), count:30 });
  await r.c.restorePage();
  r.c.page=20; await r.c.loadPage(1); await r.c.readerProgressManager.flush();
  r.c.page=5; await r.c.loadPage(-1);
  r.c.page=6; await r.c.loadPage(1); await r.c.readerProgressManager.finish();
  assert.equal(r.c.readerProgressManager.getState().locator,'6');
  assert.equal(r.c.readerProgressManager.getState().has_read,false);
  assert.equal(r.posts.at(-1).resume_policy,'last_position');
});

test('CBZの終了と続刊移動は戻り位置の描画と保存を待つ', async () => {
  for (const nextBook of [false,true]) {
    const r=reader({ preference:'single', progressState:initialProgress({ has_read:false, locator:'20' }), count:30 });
    await r.c.restorePage();
    let shown, release, left=false;
    const visible=new Promise(resolve=>{shown=resolve;});
    const gate=new Promise(resolve=>{release=resolve;});
    const render=r.c.renderReaderPage;
    r.c.renderReaderPage=async(...args)=>{await render(...args); shown(); await gate;};
    r.c.history={length:2,back:()=>{left=true;}};
    r.c.location.replace=()=>{left=true;};
    r.c.page=5; const moving=r.c.loadPage(-1); await visible;
    const exit=()=>nextBook ? r.c.toNextBook('/next') : r.c.backListPage();
    const closing=exit();
    try {
      await r.settle();
      assert.equal(left,false); assert.equal(r.posts.length,0);
      r.c.page=6; await r.c.loadPage(1); await exit();
    } finally {release();}
    await Promise.all([moving,closing]);
    assert.equal(left,true); assert.equal(r.c.readerProgressManager.getState().locator,'5');
    assert.equal(r.posts.length,1);
  }
});
