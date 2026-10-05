const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');

function fixture() {
    const events = [];
    let recorded = 'previous-cfi';
    let saved = null;
    let release;
    const settlement = new Promise(resolve => { release = resolve; });
    const context = vm.createContext({
        console, readerClosing: false, currentLocation: { cfi: recorded }, view: {},
        navigationLoadingFeedback: { begin: () => () => {} },
        navigationIntentSeq: 0, pendingNavigationCount: 0, navigationChain: Promise.resolve(),
        forwardNavigationSeq: 0, endNavigationSeq: 0, navigationEventSeq: 0,
        relocationEventSeq: 0, rendererVisibilityGuardSeq: 0,
        NAVIGATION_SPINNER_DELAY_MS: 450, NAVIGATION_SETTLE_TIMEOUT_MS: 2600,
        window: { setTimeout: () => 1, clearTimeout() {},
            history: { length: 2, back: () => events.push('leave') } },
        epubProgressManager: {
            beforeNavigation: async () => true,
            finish: async () => { saved = recorded; events.push('save'); return true; }
        },
        waitForNavigationReady: async () => true,
        waitForNavigationSettled: () => settlement,
        normalizeNavigationTarget: () => ({ expectedIndex: 21 }),
        stabilizeRendererVisibility: async () => false,
        ensureLocationForNavigationTarget: () => false,
        getRendererDiagnostics: () => ({}),
        ...Object.fromEntries(['debugLog', 'cancelPageTurnAnimation', 'clearInitialRestorePin',
            'scheduleRendererVisibilityGuard', 'focusReader', 'hideReaderLoading',
            'persistCurrentLocation', 'sendProgressBeacon', 'exitFullScreenIfNeeded'].map(name => [name, () => {}]))
    });
    context.summarizeLocation = () => ({ ...context.currentLocation });
    context.recordEpubUserPosition = () => { recorded = context.currentLocation.cfi; events.push('record'); };
    const navigateStart = source.indexOf('async function navigate(');
    vm.runInContext(source.slice(navigateStart, source.indexOf('async function jumpToFraction(', navigateStart)), context);
    const exitStart = source.indexOf('async function backListPage(');
    vm.runInContext(source.slice(exitStart, source.indexOf('\n/**', exitStart)), context);
    return { context, events, release: () => release(true), saved: () => saved };
}

test('closing after a TOC jump waits until the visible chapter is recorded and saved', async () => {
    const f = fixture();
    let visible;
    const shown = new Promise(resolve => { visible = resolve; });
    const navigation = f.context.navigate(async () => {
        f.context.currentLocation = { cfi: 'chapter-start-cfi' };
        f.events.push('visible'); visible();
    }, { allowReadCompletion: false });
    await shown;
    const closing = f.context.backListPage();
    try {
        await new Promise(setImmediate);
        assert.deepEqual(f.events, ['visible']);
    } finally { f.release(); }
    await Promise.all([navigation, closing]);
    assert.deepEqual(f.events, ['visible', 'record', 'save', 'leave']);
    assert.equal(f.saved(), 'chapter-start-cfi');
});

test('closing drains queued movement and ignores new movement and duplicate exits', async () => {
    const f = fixture();
    const first = f.context.navigate(async () => {
        f.context.currentLocation = { cfi: 'first-cfi' };
    }, { allowReadCompletion: false });
    const second = f.context.navigate(async () => {
        f.context.currentLocation = { cfi: 'last-cfi' };
    }, { allowReadCompletion: false });
    const closing = f.context.backListPage();
    let newMovementStarted = false;
    const additional = f.context.navigate(() => { newMovementStarted = true; }, { allowReadCompletion: false });
    const duplicate = f.context.backListPage();
    try {
        await new Promise(setImmediate);
        assert.equal(f.context.pendingNavigationCount, 2);
        assert.deepEqual(f.events, []);
    } finally { f.release(); }
    await Promise.all([first, second, additional, closing, duplicate]);
    assert.equal(newMovementStarted, false);
    assert.deepEqual(f.events, ['record', 'record', 'save', 'leave']);
    assert.equal(f.saved(), 'last-cfi');
    assert.equal(f.context.pendingNavigationCount, 0);
});

test('closing an idle reader saves and leaves normally', async () => {
    const f = fixture();
    await f.context.backListPage();
    assert.deepEqual(f.events, ['save', 'leave']);
    assert.equal(f.saved(), 'previous-cfi');
});
