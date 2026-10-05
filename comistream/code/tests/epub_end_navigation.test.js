const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function fixture() {
    let generation = 0, opened = false, opens = 0, pageTurns = 0, completed = 0;
    const context = vm.createContext({
        console, readerClosing: false, viewInitialized: true, currentLocation: { cfi: 'before', section: { current: 0 }, fraction: 0.9 },
        view: { book: { sections: [{}] }, renderer: { atEnd: false } },
        epubEndController: {
            isOpen: () => opened, getGeneration: () => generation,
            open() { opened = true; generation++; opens++; }, refresh() {}
        },
        epubProgressManager: { beforeNavigation: async () => true },
        navigationIntentSeq: 0, pendingNavigationCount: 0, navigationChain: Promise.resolve(),
        forwardNavigationSeq: 0, endNavigationSeq: 0, navigationEventSeq: 0, relocationEventSeq: 0, rendererVisibilityGuardSeq: 0,
        NAVIGATION_SPINNER_DELAY_MS: 450, NAVIGATION_SETTLE_TIMEOUT_MS: 2600,
        window: { setTimeout: () => 1, clearTimeout() {} },
        isNavigationReady: () => true, waitForNavigationReady: async () => true, waitForNavigationSettled: async () => true,
        normalizeNavigationTarget: () => ({}), stabilizeRendererVisibility: async () => false,
        ensureLocationForNavigationTarget: () => false, getRendererDiagnostics: () => ({}),
        getAdjacentLinearSectionIndex: () => null,
        getLocationSectionIndexOrNull: value => value.section,
        ...Object.fromEntries(['debugLog', 'cancelPageTurnAnimation', 'clearInitialRestorePin', 'scheduleRendererVisibilityGuard',
            'focusReader', 'hideReaderLoading', 'recordEpubUserPosition'].map(name => [name, () => {}]))
    });
    context.summarizeLocation = (location = context.currentLocation) => ({ cfi: location.cfi, section: location.section.current, fraction: location.fraction });
    context.markEpubCompletedIfAtEnd = () => { completed++; };
    context.view.next = async () => {
        pageTurns++;
        context.view.renderer.atEnd = true;
        context.currentLocation = { cfi: 'last', section: { current: 0 }, fraction: 1 };
        context.view.lastLocation = context.currentLocation;
    };
    vm.runInContext(section('function didNavigateForward(', 'function markEpubCompletedIfAtEnd('), context);
    vm.runInContext(section('async function navigate(', 'async function jumpToFraction('), context);
    vm.runInContext(section('async function goNextPage(', 'async function goPhysicalLeft('), context);
    return { context, close() { opened = false; generation++; }, opens: () => opens,
        pageTurns: () => pageTurns, completed: () => completed };
}

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
