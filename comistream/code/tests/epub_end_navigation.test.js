const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function fixture() {
    let generation = 0, opened = false, opens = 0, pageTurns = 0, previousTurns = 0, completed = 0;
    const confirmations = [];
    const context = vm.createContext({
        console, readerClosing: false, viewInitialized: true, currentFlowMode: 'paginated', currentLocation: { cfi: 'before', section: { current: 0 }, fraction: 0.9 },
        navigationLoadingFeedback: { begin: () => () => {} },
        view: { book: { sections: [{}] }, renderer: { atEnd: false } },
        epubEndController: {
            isOpen: () => opened, getGeneration: () => generation,
            open() { opened = true; generation++; opens++; }
        },
        epubProgressManager: { beforeNavigation: async () => true },
        navigationIntentSeq: 0, pendingNavigationCount: 0, navigationChain: Promise.resolve(),
        forwardNavigationSeq: 0, endNavigationSeq: 0, navigationEventSeq: 0, relocationEventSeq: 0, rendererVisibilityGuardSeq: 0,
        NAVIGATION_SPINNER_DELAY_MS: 450, NAVIGATION_SETTLE_TIMEOUT_MS: 2600,
        window: { setTimeout: () => 1, clearTimeout() {}, confirm: message => { confirmations.push(message); return false; } },
        t: (key, fallback) => key === 'reader_start_confirm' ? '先頭ページです。リーダーを閉じますか？' : fallback,
        isNavigationReady: () => true, waitForNavigationReady: async () => true, waitForNavigationSettled: async () => true,
        normalizeNavigationTarget: () => ({}), stabilizeRendererVisibility: async () => false,
        ensureLocationForNavigationTarget: () => false, getRendererDiagnostics: () => ({}),
        getAdjacentLinearSectionIndex: () => null,
        goToAdjacentSpineSection: async () => null,
        getLocationSectionIndexOrNull: value => value.section,
        ...Object.fromEntries(['debugLog', 'cancelPageTurnAnimation', 'clearInitialRestorePin', 'scheduleRendererVisibilityGuard',
            'focusReader', 'hideReaderLoading', 'recordEpubUserPosition', 'ensureRendererVisible'].map(name => [name, () => {}]))
    });
    context.summarizeLocation = (location = context.currentLocation) => ({ cfi: location.cfi, section: location.section.current, fraction: location.fraction });
    context.markEpubCompletedIfAtEnd = () => { completed++; };
    context.view.next = async () => {
        pageTurns++;
        context.view.renderer.atEnd = true;
        context.currentLocation = { cfi: 'last', section: { current: 0 }, fraction: 1 };
        context.view.lastLocation = context.currentLocation;
    };
    context.view.prev = async () => {
        previousTurns++;
        context.view.renderer.atStart = true;
        context.currentLocation = { cfi: 'first', section: { current: 0 }, fraction: 0 };
        context.view.lastLocation = context.currentLocation;
    };
    vm.runInContext(section('function isEpubAtStartOfLinearReadingOrder(', 'function didNavigateForward('), context);
    vm.runInContext(section('function didNavigateForward(', 'function markEpubCompletedIfAtEnd('), context);
    vm.runInContext(section('async function navigate(', 'async function jumpToFraction('), context);
    vm.runInContext(section('async function goPreviousPage(', 'async function goPhysicalLeft('), context);
    return { context, confirmations, close() { opened = false; generation++; }, opens: () => opens,
        previousTurns: () => previousTurns,
        pageTurns: () => pageTurns, completed: () => completed };
}

test('entering the first screen stays readable; another backward operation confirms closing without waiting for relocation', async () => {
    const f = fixture();
    const c = f.context;
    await c.navigate(() => c.goPreviousPage());
    assert.deepEqual(f.confirmations, []);
    assert.equal(f.previousTurns(), 1);
    c.waitForNavigationSettled = () => assert.fail('The start boundary must not wait for a relocation');
    await c.navigate(() => c.goPreviousPage());
    assert.deepEqual(f.confirmations, ['先頭ページです。リーダーを閉じますか？']);
    assert.equal(f.previousTurns(), 1);
    assert.equal(c.currentLocation.cfi, 'first');
    assert.equal(c.pendingNavigationCount, 0);
    assert.equal(f.completed(), 0);
});

test('accepting the start confirmation drains navigation and saves before leaving without repeated confirmation', async () => {
    const f = fixture();
    const c = f.context;
    await c.navigate(() => c.goPreviousPage());
    const events = [];
    let confirmations = 0;
    c.window.confirm = () => { confirmations++; return true; };
    c.window.history = { length: 2, back: () => events.push('back') };
    c.epubProgressManager.finish = async () => events.push('save');
    c.persistCurrentLocation = () => events.push('persist');
    c.sendProgressBeacon = () => events.push('beacon');
    c.exitFullScreenIfNeeded = () => {};
    vm.runInContext(section('async function backListPage(', '/**\n * foliate-js epub.js'), c);
    await Promise.all([
        c.navigate(() => c.goPreviousPage()),
        c.navigate(() => c.goPreviousPage())
    ]);
    await new Promise(setImmediate);
    assert.deepEqual(events, ['save', 'persist', 'beacon', 'back']);
    assert.equal(confirmations, 1);
    assert.equal(c.pendingNavigationCount, 0);
    assert.equal(c.readerClosing, false);
});

test('start detection requires the first linear section and the renderer start, independent of rounded progress', () => {
    const f = fixture();
    const c = f.context;
    c.view.book.sections = [{ linear: 'no' }, {}, {}];
    c.view.renderer.atStart = true;
    c.currentLocation = { cfi: 'first', section: { current: 1 }, fraction: 0.03 };
    assert.equal(c.isEpubAtStartOfLinearReadingOrder(), true);
    c.currentLocation.section.current = 2;
    assert.equal(c.isEpubAtStartOfLinearReadingOrder(), false);
    c.currentLocation.section.current = 0;
    assert.equal(c.isEpubAtStartOfLinearReadingOrder(), false);
    c.currentLocation.section.current = 1;
    c.view.renderer.atStart = false;
    c.currentLocation.fraction = 0;
    assert.equal(c.isEpubAtStartOfLinearReadingOrder(), false);
    c.view.renderer.atStart = true;
    c.viewInitialized = false;
    assert.equal(c.isEpubAtStartOfLinearReadingOrder(), false);
    c.viewInitialized = true;
    c.currentLocation.cfi = '';
    assert.equal(c.isEpubAtStartOfLinearReadingOrder(), false);
});

test('remote position restoration consumes the start request without confirming', async () => {
    const f = fixture();
    const c = f.context;
    c.view.renderer.atStart = true;
    c.epubProgressManager.beforeNavigation = async () => false;
    await c.navigate(() => c.goPreviousPage());
    assert.deepEqual(f.confirmations, []);
    assert.equal(f.previousTurns(), 0);
});

test('fixed-layout start requires the first linear section to be visible in the current spread', () => {
    const f = fixture();
    const c = f.context;
    c.view.isFixedLayout = true;
    c.view.book.sections = [{ linear: 'no' }, {}, {}];
    c.view.renderer.atStart = true;
    c.currentLocation = { cfi: 'spread', section: { current: 2 } };
    c.window.innerWidth = 800; c.window.innerHeight = 600;
    let rect = { width: 400, height: 600, left: 0, top: 0, right: 400, bottom: 600 };
    c.getRendererContents = () => [{ index: 1, doc: { defaultView: { frameElement: { getBoundingClientRect: () => rect } } } }];
    assert.equal(c.isEpubAtStartOfLinearReadingOrder(), true);
    rect = { ...rect, left: -400, right: 0 };
    assert.equal(c.isEpubAtStartOfLinearReadingOrder(), false);
});

test('entering the last screen keeps reading; one further forward operation opens the end panel', async () => {
    const f = fixture();
    await f.context.navigate(() => f.context.goNextPage());
    assert.equal(f.opens(), 0);
    assert.equal(f.pageTurns(), 1);
    await f.context.navigate(() => f.context.goNextPage());
    assert.equal(f.opens(), 1);
    assert.equal(f.pageTurns(), 1);
    assert.equal(f.completed(), 2);
    assert.equal(f.context.pendingNavigationCount, 0);
});

test('scrolled forward navigation at the end keeps the body and existing completion handling', async () => {
    const f = fixture();
    f.context.currentFlowMode = 'scrolled';
    f.context.view.renderer.atEnd = true;
    await f.context.navigate(() => f.context.goNextPage());
    assert.equal(f.opens(), 0);
    assert.equal(f.pageTurns(), 1);
    assert.equal(f.completed(), 1);
});

test('scrolled chapter navigation at the end does not request the end panel', async () => {
    const f = fixture();
    const c = f.context;
    c.currentFlowMode = 'scrolled';
    c.view.renderer.atEnd = true;
    c.getCurrentNavigationIndex = () => 0;
    c.getAdjacentEpubMarker = () => null;
    c.getTocNavigationTargets = () => [];
    c.getBookSectionCount = () => 1;
    vm.runInContext(section('async function goToAdjacentSection(', 'function handleKeydown('), c);
    assert.equal(await c.goToAdjacentSection(false), null);
    assert.equal(f.opens(), 0);
});

test('queued inputs are discarded when the panel opens and closing permits only fresh inputs', async () => {
    const f = fixture();
    f.context.view.renderer.atEnd = true;
    let behindPanel = 0;
    await Promise.all([
        f.context.navigate(() => f.context.goNextPage()),
        f.context.navigate(() => { behindPanel++; }),
        f.context.navigate(() => { behindPanel++; })
    ]);
    assert.equal(f.opens(), 1);
    assert.equal(behindPanel, 0);
    await f.context.navigate(() => { behindPanel++; });
    assert.equal(behindPanel, 0);
    f.close();
    await f.context.navigate(() => { behindPanel++; }, { allowReadCompletion: false });
    assert.equal(behindPanel, 1);
});

test('remote position restoration consumes the end request and never opens the panel', async () => {
    const f = fixture();
    f.context.view.renderer.atEnd = true;
    f.context.epubProgressManager.beforeNavigation = async () => {
        f.context.view.renderer.atEnd = false;
        return false;
    };
    await f.context.navigate(() => f.context.goNextPage());
    assert.equal(f.opens(), 0);
    assert.equal(f.completed(), 0);
    assert.equal(f.pageTurns(), 0);
});

test('fixed-layout last spread counts only when its final linear section is actually visible', () => {
    const f = fixture();
    const c = f.context;
    c.view.isFixedLayout = true;
    c.view.book.sections = [{}, {}, { linear: 'no' }];
    c.view.renderer.atEnd = true;
    c.window.innerWidth = 800; c.window.innerHeight = 600;
    let rect = { width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 };
    c.getRendererContents = () => [{ index: 1, doc: { defaultView: { frameElement: { getBoundingClientRect: () => rect } } } }];
    assert.equal(c.isEpubAtEndOfLinearReadingOrder(), false);
    rect = { width: 400, height: 600, left: 400, top: 0, right: 800, bottom: 600 };
    assert.equal(c.isEpubAtEndOfLinearReadingOrder(), true);
    rect = { width: 400, height: 600, left: 800, top: 0, right: 1200, bottom: 600 };
    assert.equal(c.isEpubAtEndOfLinearReadingOrder(), false);
    c.currentLocation.section.current = 2;
    assert.equal(c.isEpubAtEndOfLinearReadingOrder(), false);
});

test('suggested-book navigation drains movement and finishes saving before leaving, ignoring duplicate exits', async () => {
    const events = [];
    let releaseNavigation, releaseSave;
    const context = vm.createContext({
        readerClosing: false,
        navigationChain: new Promise(resolve => { releaseNavigation = resolve; }),
        epubProgressManager: { finish: async () => {
            events.push('save');
            await new Promise(resolve => { releaseSave = resolve; });
            return false;
        } },
        persistCurrentLocation: () => events.push('persist'),
        sendProgressBeacon: () => events.push('beacon'),
        window: { location: { replace: href => events.push(href) } }
    });
    vm.runInContext(section('async function toEpubSuggestedBook(', 'async function initializeEpubProgress('), context);
    const href = 'https://reader.invalid/cgi-bin/comistream.php?file=Next.cbz&mode=open';
    const leaving = context.toEpubSuggestedBook(href);
    await context.toEpubSuggestedBook('duplicate');
    assert.deepEqual(events, []);
    releaseNavigation();
    await new Promise(setImmediate);
    assert.deepEqual(events, ['save']);
    releaseSave();
    await leaving;
    assert.deepEqual(events, ['save', 'persist', 'beacon', href]);
    assert.equal(context.readerClosing, false);
});
