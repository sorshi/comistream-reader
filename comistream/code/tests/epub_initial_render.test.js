const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
function section(start, end) {
    const from = source.indexOf(start);
    assert.notEqual(from, -1);
    return source.slice(from, source.indexOf(end, from));
}

function rendererFixture(packetSave = false) {
    const attributes = new Map();
    const renders = [];
    const writes = [];
    const cssModes = [];
    const renderer = {
        primaryIndex: 0,
        loaded: false,
        getAttribute: name => attributes.get(name) ?? null,
        hasAttribute: name => attributes.has(name),
        setAttribute(name, value) {
            writes.push(name);
            attributes.set(name, value);
            this.render();
        },
        removeAttribute(name) {
            writes.push(name);
            if (attributes.delete(name)) this.render();
        },
        toggleAttribute(name, enabled) {
            if (enabled) attributes.set(name, '');
            else attributes.delete(name);
        },
        setStyles(css) { this.css = css; },
        render() {
            if (this.loaded) renders.push({ attributes: new Map(attributes), css: this.css });
        }
    };
    const listeners = new Map();
    const context = vm.createContext({
        appConfig: { packetSave }, recordCssMode: mode => cssModes.push(mode),
        epubEndController: null,
        view: { renderer, isFixedLayout: false, addEventListener: (type, fn) => listeners.set(type, fn) },
        currentFlowMode: 'paginated', currentFontScale: 1,
        currentFontScaleSource: 'auto', lastRendererPrefsSignature: '',
        navigationEventSeq: 0, currentDirectionInfo: {}, currentLocation: null, layoutVertical: false,
        getViewportSize: () => ({ width: 1200, height: 800 }),
        getEffectiveFontSizePx: () => 20,
        calculateColumnLayout: () => ({ marginPx: 48, maxInlineSize: 800, maxBlockSize: 1200, maxColumnCount: 2 }),
        getRendererContents: () => [],
        debugLog: () => {},
        ...Object.fromEntries([
            'cancelPageTurnAnimation', 'applyShellTheme', 'updateToolbarState',
            'setPaginatedSwipeMinimumDistance', 'configurePaginatedSectionIsolation',
            'preparePaperImages', 'markMediaPageLayout', 'setupTapNavigation',
            'bindKeyboardShortcuts', 'updateNavigationMode', 'hidePagePositionHelp',
            'refreshReadingModeInfo', 'applyInitialFontScaleCorrection', 'updateDirectionState',
            'renderInspector', 'focusReader'
        ].map(name => [name, () => {}])),
        summarizeLocation: () => ({})
    });
    vm.runInContext(`
        function resolveEffectiveLayoutMode() { return { vertical: layoutVertical }; }
        function updateLayoutDirectionInfo() { layoutVertical = true; return true; }
        function buildRendererPrefsSignature({ layout }) { return JSON.stringify([layoutVertical, layout, currentFlowMode, currentFontScale]); }
        function buildReaderCSS(fontScale, packetSave) {
            recordCssMode(packetSave);
            return 'body { font-size: ' + (20 * currentFontScale) + 'px; }';
        }
    `, context);
    vm.runInContext(section('function setRendererAttribute(', 'function setPaginatedSwipeMinimumDistance('), context);
    vm.runInContext(section('function applyRendererPrefs(', 'function applyInitialFontScaleCorrection('), context);
    const lifecycle = section('function bindViewLifecycleEvents(', 'function shouldAnimatePageTurn(');
    const loadStart = lifecycle.indexOf("    view.addEventListener('load',");
    const loadEnd = lifecycle.indexOf("    view.addEventListener('relocate',", loadStart);
    vm.runInContext(lifecycle.slice(loadStart, loadEnd), context);
    return { context, renderer, attributes, renders, writes, listeners, cssModes };
}

test('resolved packet saving mode reaches initial and subsequent reader styles', () => {
    for (const mode of [false, true]) {
        const f = rendererFixture(mode);
        f.context.applyRendererPrefs();
        f.context.currentFontScale = 1.1;
        f.context.applyRendererPrefs();
        assert.deepEqual(f.cssModes, [mode, mode]);
    }
});

test('unchanged renderer attributes do not trigger layout', () => {
    const f = rendererFixture();
    f.renderer.loaded = true;
    f.context.setRendererAttribute('gap', '7%');
    f.context.setRendererAttribute('gap', '7%');
    f.context.setRendererAttribute('max-column-count', 2);
    f.context.setRendererAttribute('max-column-count', '2');
    f.context.setRendererAttribute('absent', null);
    f.context.setRendererAttribute('gap', null);
    f.context.setRendererAttribute('gap', null);
    assert.deepEqual(f.writes, ['gap', 'max-column-count', 'gap']);
});

test('preferences render once with all final attributes and styles', () => {
    const f = rendererFixture();
    f.renderer.loaded = true;
    const originalRender = f.renderer.render;
    f.context.applyRendererPrefs();
    assert.equal(f.renders.length, 1);
    assert.equal(f.renders[0].attributes.get('flow'), 'paginated');
    assert.equal(f.renders[0].attributes.get('margin-left'), '48px');
    assert.equal(f.renders[0].attributes.get('max-column-count'), '2');
    assert.equal(f.renders[0].css, 'body { font-size: 20px; }');
    assert.equal(f.renderer.render, originalRender);
    f.context.applyRendererPrefs();
    assert.equal(f.renders.length, 1);
    f.context.currentFlowMode = 'scrolled';
    f.context.applyRendererPrefs();
    assert.equal(f.renders.length, 2);
    assert.equal(f.renders[1].attributes.get('flow'), 'scrolled');
});

test('section load defers preference rendering to the native initial render', () => {
    const f = rendererFixture();
    f.context.applyRendererPrefs();
    f.renderer.loaded = true;
    f.listeners.get('load')({ detail: { index: 0, doc: { addEventListener() {} } } });
    assert.equal(f.context.layoutVertical, true);
    assert.equal(f.renders.length, 0);
    f.renderer.render();
    assert.equal(f.renders.length, 1);
    assert.equal(f.renders[0].attributes.get('flow'), 'paginated');
});

test('a font-only change still renders once when renderer attributes are unchanged', () => {
    const f = rendererFixture();
    f.renderer.loaded = true;
    f.context.applyRendererPrefs();
    const writesBefore = f.writes.length;
    f.context.currentFontScale = 1.1;
    f.context.applyRendererPrefs();
    assert.equal(f.writes.length, writesBefore);
    assert.equal(f.renders.length, 2);
    assert.equal(f.renders[1].css, 'body { font-size: 22px; }');
});

test('render batching restores the renderer after exceptions and nested updates', () => {
    const f = rendererFixture();
    f.renderer.loaded = true;
    const originalRender = f.renderer.render;
    assert.throws(() => f.context.batchRendererUpdates(() => {
        f.context.batchRendererUpdates(() => f.renderer.setAttribute('gap', '7%'));
        throw new Error('fixture failure');
    }), /fixture failure/);
    assert.equal(f.renderer.render, originalRender);
    assert.equal(f.renders.length, 1);
    f.renderer.render();
    assert.equal(f.renders.length, 2);
});

test('render batching preserves inherited methods and bypasses fixed layout', () => {
    const f = rendererFixture();
    f.renderer.loaded = true;
    const originalRender = f.renderer.render;
    delete f.renderer.render;
    Object.setPrototypeOf(f.renderer, { render: originalRender });
    f.context.batchRendererUpdates(() => f.renderer.setAttribute('gap', '7%'));
    assert.equal(Object.hasOwn(f.renderer, 'render'), false);
    assert.equal(f.renders.length, 1);
    f.context.view.isFixedLayout = true;
    f.context.batchRendererUpdates(() => {
        assert.equal(f.renderer.render, originalRender);
        f.renderer.setAttribute('gap', '8%');
    }, { renderAfter: false });
    assert.equal(f.renders.length, 2);
});

function readyFixture() {
    let now = 0;
    const frames = [];
    const moves = [];
    const context = vm.createContext({
        viewInitialized: false,
        currentLocation: null,
        view: { renderer: {}, goTo: async target => moves.push(target) },
        contents: [{ doc: { body: {} } }],
        hasUsableDocumentBody: doc => Boolean(doc?.body),
        NAVIGATION_READY_TIMEOUT_MS: 1600,
        Date: { now: () => now },
        window: { requestAnimationFrame: callback => frames.push(callback) },
        waitAnimationFrame: () => Promise.resolve(),
        waitForDocumentAssets: async () => {},
        getPreferredContentDoc: () => ({}),
        traceRestore: () => {}, debugLog: () => {}, summarizeLocation: () => ({})
    });
    vm.runInContext('function getRendererContents() { return contents; }', context);
    const readyStart = source.includes('function isRendererDocumentReady(')
        ? 'function isRendererDocumentReady(' : 'function isNavigationReady(';
    vm.runInContext(section(readyStart, 'function hasLocationChanged('), context);
    vm.runInContext(section('async function reapplyInitialRestoreTarget(', 'function updateToolbarState('), context);
    return {
        context, frames, moves,
        async frame() {
            now += 400;
            frames.splice(0).forEach(callback => callback());
            await Promise.resolve();
        }
    };
}

test('initial position restore uses the loaded document without a readiness timeout', async () => {
    const f = readyFixture();
    let finished = false;
    const result = f.context.reapplyInitialRestoreTarget('saved-cfi', 'fixture').then(value => { finished = value; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, true);
    await result;
    assert.deepEqual(f.moves, ['saved-cfi', 'saved-cfi']);
    assert.equal(f.frames.length, 0);
    assert.equal(f.context.viewInitialized, false);
    assert.equal(f.context.isNavigationReady(), false);
});

test('normal navigation stays gated until initialization completes', async () => {
    const f = readyFixture();
    let ready = false;
    const result = f.context.waitForNavigationReady().then(value => { ready = value; });
    await f.frame();
    assert.equal(ready, false);
    f.context.viewInitialized = true;
    await f.frame();
    await result;
    assert.equal(ready, true);
});

test('initial readiness still times out when no usable document exists', async () => {
    const f = readyFixture();
    f.context.contents = [];
    const result = f.context.waitForNavigationReady(1600, { allowInitializing: true });
    for (let i = 0; i < 4; i++) await f.frame();
    assert.equal(await result, false);
});
