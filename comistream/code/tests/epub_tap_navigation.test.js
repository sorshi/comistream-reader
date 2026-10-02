const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const tapCode = source.slice(source.indexOf('function parseTapZone('), source.indexOf('function isEditableTarget('));

function fixture({ fixedLayout = true, ready = true, flow = 'paginated', contents = [] } = {}) {
    const listeners = new Map();
    let menuOpens = 0;
    const pageTurns = [];
    const document = { documentElement: { clientWidth: 1028 } };
    const context = vm.createContext({
        Node: { TEXT_NODE: 3 },
        TAP_MAX_DISTANCE_PX: 10,
        TAP_MAX_DURATION_MS: 300,
        SCROLLED_CENTER_TAP_MAX_DISTANCE_PX: 20,
        SCROLLED_CENTER_TAP_MAX_DURATION_MS: 500,
        currentFlowMode: flow,
        document,
        window: { innerWidth: 1028 },
        isNavigationReady: () => ready,
        isFixedLayoutBook: () => fixedLayout,
        getRendererContents: () => contents,
        openMenu: () => { menuOpens++; },
        navigate: (action) => action(),
        goPhysicalLeft: () => pageTurns.push('left'),
        goPhysicalRight: () => pageTurns.push('right')
    });
    vm.runInContext(tapCode, context);
    const viewer = {
        addEventListener: (name, listener) => listeners.set(name, listener)
    };
    return { context, viewer, listeners, pageTurns, menuOpens: () => menuOpens };
}

function tap(listeners, clientX, overrides = {}) {
    const event = {
        button: 0,
        target: { nodeType: 1, closest: () => null },
        clientX,
        clientY: 400,
        pointerId: 1,
        ...overrides
    };
    listeners.get('pointerdown')(event);
    listeners.get('pointerup')(event);
}

test('fixed-layout iframe taps use their position in the reader viewport', () => {
    const { context } = fixture();
    const rightPage = {
        defaultView: {
            innerWidth: 514,
            frameElement: { getBoundingClientRect: () => ({ left: 514, width: 514 }) }
        }
    };
    assert.equal(context.parseTapZone(100, rightPage), 'center');
    assert.equal(context.parseTapZone(400, rightPage), 'right');

    const scaledPage = {
        defaultView: {
            innerWidth: 1028,
            frameElement: { getBoundingClientRect: () => ({ left: 257, width: 514 }) }
        }
    };
    assert.equal(context.parseTapZone(514, scaledPage), 'center');
    assert.equal(context.parseTapZone(100, context.document), 'left');
});

test('iframe pointer and scrolled touch events open the menu at the visual center', () => {
    const { context, menuOpens } = fixture();
    const listeners = new Map();
    const doc = {
        defaultView: {
            innerWidth: 514,
            frameElement: { getBoundingClientRect: () => ({ left: 514, width: 514 }) }
        },
        addEventListener: (name, listener) => listeners.set(name, listener),
        getSelection: () => null
    };
    context.setupTapNavigation(doc);
    const target = { nodeType: 1, closest: () => null };
    listeners.get('pointerdown')({ button: 0, target, clientX: 100, clientY: 400, pointerId: 1 });
    listeners.get('pointerup')({ clientX: 100, clientY: 400, pointerId: 1 });
    assert.equal(menuOpens(), 1);

    context.currentFlowMode = 'scrolled';
    const touch = { identifier: 2, clientX: 100, clientY: 400 };
    listeners.get('touchstart')({ target, touches: [touch], changedTouches: [touch] });
    listeners.get('touchend')({ changedTouches: [touch] });
    assert.equal(menuOpens(), 2);
});

test('center whitespace in the viewer opens the menu after navigation is ready', () => {
    const { context, viewer, listeners, menuOpens } = fixture();
    context.setupViewerFallbackTapNavigation(viewer);
    const target = { nodeType: 1, closest: () => null };
    listeners.get('pointerdown')({ button: 0, target, clientX: 514, clientY: 400, pointerId: 1 });
    listeners.get('pointerup')({ clientX: 514, clientY: 400, pointerId: 1 });
    assert.equal(menuOpens(), 1);
});

test('paginated reflowable chapter-end whitespace turns pages and opens the center menu', () => {
    const { context, viewer, listeners, pageTurns, menuOpens } = fixture({ fixedLayout: false });
    context.setupViewerFallbackTapNavigation(viewer);
    tap(listeners, 100);
    tap(listeners, 900);
    tap(listeners, 514);
    assert.deepEqual(pageTurns, ['left', 'right']);
    assert.equal(menuOpens(), 1);
});

test('fixed-layout and loading whitespace do not add fallback page turns', () => {
    for (const options of [{ fixedLayout: true }, { fixedLayout: false, ready: false }]) {
        const { context, viewer, listeners, pageTurns, menuOpens } = fixture(options);
        context.setupViewerFallbackTapNavigation(viewer);
        tap(listeners, 100);
        tap(listeners, 900);
        tap(listeners, 514);
        assert.deepEqual(pageTurns, []);
        assert.equal(menuOpens(), 1);
    }
});

test('scrolled reflowable whitespace keeps its existing behavior', () => {
    const { context, viewer, listeners, pageTurns, menuOpens } = fixture({ fixedLayout: false, flow: 'scrolled' });
    context.setupViewerFallbackTapNavigation(viewer);
    tap(listeners, 100);
    tap(listeners, 514);
    assert.deepEqual(pageTurns, []);
    assert.equal(menuOpens(), 0);
});

test('chapter-end whitespace ignores modified clicks and interactive targets', () => {
    const { context, viewer, listeners, pageTurns, menuOpens } = fixture({ fixedLayout: false });
    context.setupViewerFallbackTapNavigation(viewer);
    for (const overrides of [
        { button: 2 }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { shiftKey: true },
        { target: { nodeType: 1, closest: () => ({ tagName: 'A' }) } }
    ]) {
        tap(listeners, 100, overrides);
    }
    assert.deepEqual(pageTurns, []);
    assert.equal(menuOpens(), 0);
});

test('chapter-end whitespace ignores drags and cancelled pointers', () => {
    const { context, viewer, listeners, pageTurns } = fixture({ fixedLayout: false });
    context.setupViewerFallbackTapNavigation(viewer);
    const event = { button: 0, target: { nodeType: 1, closest: () => null }, clientX: 100, clientY: 400, pointerId: 1 };
    listeners.get('pointerdown')(event);
    listeners.get('pointermove')({ ...event, clientY: 420 });
    listeners.get('pointerup')(event);
    listeners.get('pointerdown')(event);
    listeners.get('pointercancel')(event);
    listeners.get('pointerup')(event);
    assert.deepEqual(pageTurns, []);
});

test('chapter-end whitespace does not navigate while EPUB text is selected', () => {
    const doc = { getSelection: () => ({ isCollapsed: false }) };
    const { context, viewer, listeners, pageTurns, menuOpens } = fixture({ fixedLayout: false, contents: [{ doc }] });
    context.setupViewerFallbackTapNavigation(viewer);
    tap(listeners, 100);
    tap(listeners, 514);
    assert.deepEqual(pageTurns, []);
    assert.equal(menuOpens(), 0);
});

test('iframe left and right taps still turn one page each', () => {
    const { context, pageTurns } = fixture({ fixedLayout: false });
    const listeners = new Map();
    const doc = {
        addEventListener: (name, listener) => listeners.set(name, listener),
        getSelection: () => null
    };
    context.setupTapNavigation(doc);
    tap(listeners, 100);
    tap(listeners, 900);
    assert.deepEqual(pageTurns, ['left', 'right']);
});
