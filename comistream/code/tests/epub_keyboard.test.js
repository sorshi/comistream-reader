const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { chrome, runBrowserFixture } = require('./browser_fixture');

const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const navigationCode = source.slice(source.indexOf('async function navigate('), source.indexOf('async function jumpToFraction('));
const keyboardCode = source.slice(source.indexOf('function handleKeydown('), source.indexOf('function sendProgressBeacon('));
const sliderCode = source.slice(source.indexOf('function handleEpubSliderKeydown('), source.indexOf('async function jumpToReflowSliderBoundary('));

function fixture() {
    const actions = [];
    let releaseAction;
    const context = vm.createContext({
        navigationIntentSeq: 0, pendingNavigationCount: 0, readerClosing: false, navigationChain: Promise.resolve(),
        navigationLoadingFeedback: { begin: () => () => {} },
        forwardNavigationSeq: 0, endNavigationSeq: 0, navigationEventSeq: 0, relocationEventSeq: 0, rendererVisibilityGuardSeq: 0,
        NAVIGATION_SPINNER_DELAY_MS: 1000, NAVIGATION_SETTLE_TIMEOUT_MS: 1000,
        view: { isFixedLayout: false }, currentLocation: {}, epubInspectorUI: null,
        menuVisible: false, sliderDragActive: false, pendingSliderValue: null,
        window: { setTimeout, clearTimeout }, console,
        $: () => null, isEditableTarget: () => false,
        debugLog() {}, summarizeLocation: () => ({}), cancelPageTurnAnimation() {}, clearInitialRestorePin() {},
        waitForNavigationReady: async () => true, waitForNavigationSettled: async () => true,
        normalizeNavigationTarget: () => ({}), stabilizeRendererVisibility: async () => false,
        ensureLocationForNavigationTarget() {}, isEpubAtEndOfLinearReadingOrder: () => false,
        scheduleRendererVisibilityGuard() {}, focusReader() {}, getRendererDiagnostics: () => ({}), ensureRendererVisible() {}
    });
    for (const name of ['goPhysicalLeft', 'goPhysicalRight', 'goNextPage', 'goPreviousPage', 'goToAdjacentSection', 'goToBoundary', 'jumpToReflowSliderBoundary']) {
        context[name] = async (...args) => {
            actions.push([name, ...args]);
            await new Promise(resolve => { releaseAction = resolve; });
        };
    }
    vm.runInContext(navigationCode + keyboardCode + sliderCode, context);
    const key = (code, options = {}, slider = false) => {
        const event = {
            code, key: code === 'Space' ? ' ' : code, repeat: false, ...options,
            preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }
        };
        context[slider ? 'handleEpubSliderKeydown' : 'handleKeydown'](event);
        return event;
    };
    const tick = () => new Promise(resolve => setImmediate(resolve));
    const finish = () => { releaseAction?.(); releaseAction = null; };
    const drain = async () => {
        while (context.pendingNavigationCount > 0) {
            await tick();
            finish();
        }
        await context.navigationChain;
    };
    return { context, actions, key, finish, tick, drain };
}

test('held page keys do not build a backlog while a page turn is pending', async () => {
    for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'Space']) {
        const f = fixture();
        f.key(code);
        await f.tick();
        for (let i = 0; i < 80; i++) {
            const event = f.key(code, { repeat: true });
            assert.equal(event.defaultPrevented, true);
            assert.equal(event.stopped, true);
        }
        const queued = f.context.pendingNavigationCount;
        await f.drain();
        assert.equal(queued, 1, `${code} queued repeated page turns`);
        assert.equal(f.actions.length, 1);
        assert.equal(f.context.pendingNavigationCount, 0);
    }
});

test('holding a key continues to turn pages after each completed navigation', async () => {
    const f = fixture();
    for (let i = 0; i < 3; i++) {
        f.key('ArrowLeft', { repeat: i > 0 });
        await f.tick();
        assert.equal(f.actions.length, i + 1);
        f.finish();
        await f.context.navigationChain;
    }
});

test('separate key presses and non-keyboard navigation keep their queued actions', async () => {
    const f = fixture();
    f.key('ArrowLeft');
    f.key('ArrowRight');
    void f.context.navigate(() => f.context.goNextPage());
    assert.equal(f.context.pendingNavigationCount, 3);
    for (let i = 0; i < 3; i++) {
        await f.tick();
        f.finish();
    }
    await f.context.navigationChain;
    assert.deepEqual(f.actions, [['goPhysicalLeft'], ['goPhysicalRight'], ['goNextPage']]);
});

test('repeated navigation shortcuts are also dropped while rendering', async () => {
    for (const [code, options] of [
        ['ArrowLeft', { shiftKey: true }], ['ArrowRight', { shiftKey: true }],
        ['ArrowLeft', { ctrlKey: true }], ['ArrowRight', { ctrlKey: true }],
        ['Home', {}], ['End', {}], ['Period', {}], ['Comma', {}]
    ]) {
        const f = fixture();
        f.key(code, options);
        await f.tick();
        f.key(code, { ...options, repeat: true });
        const queued = f.context.pendingNavigationCount;
        await f.drain();
        assert.equal(queued, 1, `${code} queued a repeated shortcut`);
    }
});

test('slider page keys do not accumulate repeated navigation', async () => {
    for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End']) {
        const f = fixture();
        f.key(code, {}, true);
        await f.tick();
        for (let i = 0; i < 40; i++) f.key(code, { repeat: true }, true);
        const queued = f.context.pendingNavigationCount;
        await f.drain();
        assert.equal(queued, 1, `${code} queued repeated slider navigation`);
        assert.equal(f.actions.length, 1);
    }
});

test('repeats are dropped before progress synchronization or renderer readiness completes', async () => {
    for (const boundary of ['sync', 'renderer']) {
        const f = fixture();
        let release;
        const gate = new Promise(resolve => { release = () => resolve(true); });
        const wait = () => gate;
        if (boundary === 'sync') f.context.epubProgressManager = { beforeNavigation: wait };
        else f.context.waitForNavigationReady = wait;
        f.key('ArrowLeft');
        await f.tick();
        f.key('ArrowLeft', { repeat: true });
        const queued = f.context.pendingNavigationCount;
        release();
        await f.drain();
        assert.equal(queued, 1, `${boundary} accumulated repeated navigation`);
        assert.equal(f.actions.length, 1);
    }
});

test('browser key repeats stop without queued turns after release in the document and EPUB iframe', { skip: !chrome }, async () => {
    await runBrowserFixture(`
        let navigationIntentSeq = 0, pendingNavigationCount = 0, readerClosing = false, navigationChain = Promise.resolve();
        const navigationLoadingFeedback = { begin: () => () => {} };
        let forwardNavigationSeq = 0, endNavigationSeq = 0, navigationEventSeq = 0, relocationEventSeq = 0, rendererVisibilityGuardSeq = 0;
        const NAVIGATION_SPINNER_DELAY_MS = 1000, NAVIGATION_SETTLE_TIMEOUT_MS = 1000;
        const view = {}, currentLocation = {}, epubInspectorUI = null;
        const $ = () => null, isEditableTarget = () => false, summarizeLocation = () => ({});
        function debugLog() {} function cancelPageTurnAnimation() {} function clearInitialRestorePin() {}
        async function waitForNavigationReady() { return true; }
        async function waitForNavigationSettled() { return true; }
        const normalizeNavigationTarget = () => ({});
        async function stabilizeRendererVisibility() { return false; }
        function ensureLocationForNavigationTarget() {} function isEpubAtEndOfLinearReadingOrder() { return false; }
        function scheduleRendererVisibilityGuard() {} function focusReader() {} function getRendererDiagnostics() { return {}; }
        function ensureRendererVisible() {}
        let pages = 0, release;
        async function goPhysicalLeft() { pages++; await new Promise(resolve => { release = resolve; }); }
        ${navigationCode}
        ${keyboardCode}
        window.testDone = false;
        (async () => {
            for (const doc of [document, document.getElementById('book').contentDocument]) {
                bindKeyboardShortcuts(doc);
                bindKeyboardShortcuts(doc);
                const key = (type, repeat = false) => {
                    const event = new doc.defaultView.KeyboardEvent(type, { code: 'ArrowLeft', key: 'ArrowLeft', repeat, bubbles: true, cancelable: true });
                    doc.body.dispatchEvent(event);
                    return event;
                };
                const before = pages;
                key('keydown');
                await new Promise(resolve => setTimeout(resolve, 0));
                for (let i = 0; i < 80; i++) expect(key('keydown', true).defaultPrevented, 'Repeat was not consumed');
                key('keyup');
                expect(pendingNavigationCount === 1, 'Key release left a navigation backlog');
                release();
                await navigationChain;
                expect(pages === before + 1 && pendingNavigationCount === 0, 'Pages continued after release');
                key('keydown', true);
                await new Promise(resolve => setTimeout(resolve, 0));
                release();
                await navigationChain;
                expect(pages === before + 2, 'Holding a key no longer turns pages');
            }
            window.testDone = true;
        })().catch(error => { window.testFailed = true; document.getElementById('result').textContent = error.stack; });
    `, '<iframe id="book" srcdoc="<body>EPUB content</body>"></iframe>');
});
