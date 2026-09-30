const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const tapCode = source.slice(source.indexOf('function parseTapZone('), source.indexOf('function isEditableTarget('));

function fixture({ fixedLayout = true } = {}) {
    const listeners = new Map();
    let menuOpens = 0;
    const document = { documentElement: { clientWidth: 1028 } };
    const context = vm.createContext({
        Node: { TEXT_NODE: 3 },
        TAP_MAX_DISTANCE_PX: 10,
        TAP_MAX_DURATION_MS: 300,
        SCROLLED_CENTER_TAP_MAX_DISTANCE_PX: 20,
        SCROLLED_CENTER_TAP_MAX_DURATION_MS: 500,
        currentFlowMode: 'paginated',
        document,
        window: { innerWidth: 1028 },
        isNavigationReady: () => true,
        isFixedLayoutBook: () => fixedLayout,
        openMenu: () => { menuOpens++; },
        navigate: () => {},
        goPhysicalLeft: () => {},
        goPhysicalRight: () => {}
    });
    vm.runInContext(tapCode, context);
    const viewer = {
        addEventListener: (name, listener) => listeners.set(name, listener)
    };
    return { context, viewer, listeners, menuOpens: () => menuOpens };
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

test('ready reflowable content does not use the fixed-layout whitespace fallback', () => {
    const { context, viewer, listeners, menuOpens } = fixture({ fixedLayout: false });
    context.setupViewerFallbackTapNavigation(viewer);
    const target = { nodeType: 1, closest: () => null };
    listeners.get('pointerdown')({ button: 0, target, clientX: 514, clientY: 400, pointerId: 1 });
    listeners.get('pointerup')({ clientX: 514, clientY: 400, pointerId: 1 });
    assert.equal(menuOpens(), 0);
});
