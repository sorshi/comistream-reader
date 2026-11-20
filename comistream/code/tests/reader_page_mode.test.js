const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const viewport = require('../comistream_viewport.js');
const source = fs.readFileSync(require.resolve('../comistream.js'), 'utf8');
const directionSource = fs.readFileSync(require.resolve('../reader_direction.js'), 'utf8');

function reader({ preference = 'auto', width = 900, height = 600, wide = [], count = 9,
  progressState = null, storage = new Map(), isGuest = false, userKey = 'test', bookKey = 'book', directionPost } = {}) {
  let remote = progressState;
  const posts = [];
  const elements = new Map();
  storage.set('readerPageModePreference', preference);
  const writes = [];
  const beacons = [];
  const alerts = [];
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
      toc_button_auto: 'Auto', tooltip_auto_page: 'Automatic',
      toc_button_direction_left: 'Left-bound', toc_button_direction_right: 'Right-bound' },
    debugLog() {}, scroll() {}, scrollTo() {}, alert(message) { alerts.push(message); },
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
      removeAttribute() {}
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
  if (progressState || isGuest) {
    context.readerProgressConfig = { isGuest, userKey, bookKey };
    context.fetch = async (_url, init) => {
      if (init.body) {
        const operation = { ...init.body.values };
        posts.push(operation);
        if (operation.mode === 'saveReadingDirection') {
          if (directionPost) return directionPost(operation, init);
          assert.equal(operation.state_id, remote.state_id);
          assert.equal(Number(operation.expected_direction_revision), remote.direction_revision);
          remote = acceptDirection(remote, operation);
        } else {
          remote = { ...remote, locator: operation.locator,
            has_read: remote.has_read || Boolean(operation.completion_locator), revision: remote.revision + 1 };
        }
      }
      return { ok: true, status: 200, json: async () => ({ ok: true, result: 'applied', state: { ...remote } }) };
    };
    context.confirm = () => true;
  }
  context.window = context;
  vm.createContext(context);
  if (context.readerProgressConfig) {
    vm.runInContext(fs.readFileSync(require.resolve('../reader_progress.js'), 'utf8'), context);
    vm.runInContext(directionSource, context);
  }
  vm.runInContext(source, context);
  context.sugguestbook = () => {};
  context.checkAndShowLargePageNotification = () => {};
  context.updateFullScreenButton = () => {};
  context.unixtime = Math.floor(Date.now() / 1000);
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  return { c: context, element, storage, writes, beacons, events, settle, posts, alerts,
    getRemote: () => remote, setRemote: (state) => { remote = state; } };
}

function acceptDirection(state, operation) {
  return { ...state, opening_direction: operation.opening_direction,
    direction_revision: state.direction_revision + 1, last_direction_operation_id: operation.operation_id };
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

for (const preference of ['single', 'spread']) {
  for (const isGuest of [false, true]) {
    test(`画像・PDFの${preference}表示は初期先読み範囲を越えて補充する（guest=${isGuest}）`, async () => {
      const r = reader({ preference, count: 60, progressState: initialProgress({ locator: '2' }) });
      r.c.page = 2; r.c.prevPage = 2;
      r.c.readerProgressConfig.isGuest = isGuest;
      await r.c.restorePage(); await r.settle();
      assert.equal(r.c.preCaches.enabled, false);
      assert.ok(r.c.preCaches.imageCache.size > 0);
      // 通信速度による枚数の変動を止め、初期の3〜14ページを越える動作を確認するルン。
      r.c.preCaches.resize(12);
      await r.c.preLoadInitialImages(2);
      const cached = number => r.c.preCaches.imageCache.has(r.c.getFullImageUrl(number, false));
      assert.equal(r.c.preCaches.getSize(), 12);
      assert.equal(cached(r.c.displayedEnd + 12), true);
      assert.equal(cached(r.c.displayedEnd + 13), false);

      const turns = preference === 'single' ? 16 : 8;
      for (let turn = 0; turn < turns; turn++) {
        await r.c.next();
        if (r.c.readerNavigationPromise) await r.c.readerNavigationPromise;
        await r.settle();
      }
      assert.equal(r.c.page, 18);
      assert.equal(cached(21), true);
      assert.equal(cached(r.c.displayedEnd + 1), true);
      assert.equal(cached(r.c.displayedEnd + 12), true);
      await r.c.readerProgressManager.flush();
      assert.equal(r.c.readerProgressManager.getState().locator, '18');
    });
  }
}

test('新方式ではサーバーの表紙を復元し、初期表示と回転で保存しない', async () => {
  const r = reader({ progressState: initialProgress(), count: 20 });
  r.storage.set('book', '3');
  await r.c.restorePage(); await r.settle();
  assert.equal(r.c.page, 1); assert.equal(r.posts.length, 0); assert.equal(r.beacons.length, 0);
  await r.c.updateReaderViewport('resize');
  await r.c.readerProgressManager.flush();
  assert.equal(r.posts.length, 0);
});

test('最初の見開きからサーバーの綴じ方向を使い、切替だけで読書位置を保存しない', async () => {
  const progressState = initialProgress({ locator: '5', opening_direction: 'right', direction_revision: 1 });
  const readerA = reader({ progressState });
  const render = readerA.c.renderReaderPage;
  const directionsAtRender = [];
  readerA.c.renderReaderPage = (reason) => {
    directionsAtRender.push(readerA.c.direction);
    return render(reason);
  };
  await readerA.c.restorePage();
  assert.deepEqual(directionsAtRender, ['right']);
  assert.equal(readerA.element('image').style.float, 'left');
  assert.equal(readerA.element('nextimage').style.float, 'right');
  assert.equal(readerA.element('direction').textContent, 'Left-bound');
  assert.equal(readerA.element('slider').style.transform, 'rotateY(0deg)');
  assert.equal(readerA.element('progress').className, 'progress-right');
  assert.equal(readerA.posts.length, 0);

  readerA.c.toggleDirection();
  await readerA.settle();
  assert.equal(readerA.c.page, 5);
  assert.deepEqual(readerA.posts.map(post => post.mode), ['saveReadingDirection']);
  const readerB = reader({ progressState: readerA.getRemote() });
  await readerB.c.restorePage();
  assert.equal(readerB.c.direction, 'left');
  assert.equal(readerB.c.page, 5);
  assert.equal(readerB.element('image').style.float, 'right');
  assert.equal(readerB.element('slider').style.transform, 'rotateY(180deg)');
  assert.equal(readerB.posts.length, 0);
});

test('ゲストの綴じ方向を本ごとに復元し、保存領域を使えなくても切り替えられる', async () => {
  const storage = new Map();
  const guest = reader({ isGuest: true, userKey: 'guest', storage });
  await guest.c.restorePage();
  assert.equal(guest.c.direction, 'left');
  guest.c.toggleDirection();

  const reopened = reader({ isGuest: true, userKey: 'guest', storage });
  await reopened.c.restorePage();
  assert.equal(reopened.c.direction, 'right');
  const other = reader({ isGuest: true, userKey: 'guest', bookKey: 'other', storage });
  await other.c.restorePage();
  assert.equal(other.c.direction, 'left');
  reopened.c.localStorage.setItem = () => { throw new Error('blocked'); };
  reopened.c.toggleDirection();
  assert.equal(reopened.c.direction, 'left');
  assert.equal(reopened.posts.length, 0);
});

test('連続切替後に先行操作の応答を失っても、再オープン時に最後の選択を送る', async () => {
  const progressState = initialProgress({ locator: '5', opening_direction: null, direction_revision: 0 });
  const storage = new Map();
  let loseResponse;
  const first = reader({ progressState, storage, directionPost: (_operation, request) => {
    assert.equal(request.keepalive, true);
    return new Promise((_resolve, reject) => { loseResponse = reject; });
  } });
  await first.c.restorePage();
  first.c.toggleDirection();
  first.c.toggleDirection();
  assert.equal(first.c.direction, 'left');
  assert.equal(first.posts.length, 1);
  loseResponse(new Error('Disconnected after committing the direction'));
  await first.settle();

  const reopened = reader({ progressState: acceptDirection(progressState, first.posts[0]), storage });
  await reopened.c.restorePage();
  await reopened.settle();
  assert.equal(reopened.c.direction, 'left');
  assert.equal(reopened.posts.length, 1);
  assert.equal(reopened.posts[0].opening_direction, 'left');
  assert.equal(reopened.posts[0].expected_direction_revision, '1');
  assert.equal(reopened.getRemote().direction_revision, 2);
});

test('綴じ方向が競合しても表示中の選択を保ち、次に開く画面では確定した方向を使う', async () => {
  const progressState = initialProgress({ locator: '5', opening_direction: null, direction_revision: 0 });
  const foreign = { ...progressState, opening_direction: 'left', direction_revision: 1 };
  const original = reader({ progressState, directionPost: async () => ({
    ok: false, status: 409, json: async () => ({ ok: false, state: foreign }),
  }) });
  await original.c.restorePage();
  original.c.toggleDirection();
  await original.settle();
  assert.equal(original.c.direction, 'right');
  assert.equal(original.alerts.length, 1);
  const reopened = reader({ progressState: foreign, storage: original.storage });
  await reopened.c.restorePage();
  assert.equal(reopened.c.direction, 'left');
  assert.equal(reopened.posts.length, 0);
});

test('オフラインでは綴じ方向を復元し、起動時にサーバー状態を取得できなかった操作を自動送信しない', async () => {
  const progressState = initialProgress({ locator: '5', opening_direction: 'right', direction_revision: 1 });
  const original = reader({ progressState });
  await original.c.restorePage();

  const offline = reader({ progressState, storage: original.storage });
  offline.c.fetch = async () => { throw new Error('Offline'); };
  await offline.c.restorePage();
  assert.equal(offline.c.direction, 'right');
  assert.equal(offline.c.page, 5);
  offline.c.toggleDirection();
  assert.equal(offline.c.direction, 'left');

  const online = reader({ progressState, storage: original.storage });
  await online.c.restorePage();
  assert.equal(online.c.direction, 'right');
  assert.equal(online.posts.length, 0);
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

test('画像・PDFは同期確認中に終了しても受け付けたページへの移動と保存を終える', async () => {
  const r = reader({ preference: 'single', progressState: initialProgress({ locator: '5' }), count: 30 });
  await r.c.restorePage();
  let checking, release, left = false;
  const started = new Promise(resolve => { checking = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const beforeNavigation = r.c.readerProgressManager.beforeNavigation;
  r.c.readerProgressManager.beforeNavigation = async () => {
    const allowed = await beforeNavigation();
    checking();
    await gate;
    return allowed;
  };
  r.c.history = { length: 2, back: () => { left = true; } };
  r.c.page = 6;
  const moving = r.c.loadPage(1);
  await started;
  const closing = r.c.backListPage();
  try {
    await r.settle();
    assert.equal(left, false);
    assert.equal(r.posts.length, 0);
  } finally { release(); }
  await Promise.all([moving, closing]);
  assert.equal(left, true);
  assert.equal(r.c.displayedStart, 6);
  assert.equal(r.c.readerProgressManager.getState().locator, '6');
  assert.equal(r.posts.length, 1);
});
