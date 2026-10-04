const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const start = source.indexOf('function configurePaginatedSectionIsolation(');
const end = source.indexOf('function isValidThemeName(', start);
assert.ok(start >= 0 && end > start);
const context = vm.createContext({ sectionIsolationRenderers: new WeakSet(), console });
vm.runInContext(source.slice(start, end), context);

class Renderer {
    attributes = new Set();
    scrolled = false;
    get noContinuousScroll() {
        return this.scrolled && this.hasAttribute('no-continuous-scroll');
    }
    hasAttribute(name) {
        return this.attributes.has(name);
    }
    toggleAttribute(name, enabled) {
        if (enabled) this.attributes.add(name);
        else this.attributes.delete(name);
    }
}

const configure = (renderer, flow) => context.configurePaginatedSectionIsolation(renderer, false, flow);

test('paginated mode isolates sections even though the native getter only supports scrolled mode', () => {
    const renderer = new Renderer();
    renderer.toggleAttribute('no-continuous-scroll', true);
    assert.equal(renderer.noContinuousScroll, false);
    configure(renderer, 'paginated');
    assert.equal(renderer.noContinuousScroll, true);
    assert.equal(new Renderer().noContinuousScroll, false);
});

test('switching flow restores continuous scrolling and reapplies pagination isolation', () => {
    const renderer = new Renderer();
    configure(renderer, 'paginated');
    const getter = Object.getOwnPropertyDescriptor(renderer, 'noContinuousScroll').get;
    configure(renderer, 'scrolled');
    renderer.scrolled = true;
    assert.equal(renderer.noContinuousScroll, false);
    assert.equal(renderer.hasAttribute('no-continuous-scroll'), false);
    configure(renderer, 'paginated');
    renderer.scrolled = false;
    assert.equal(renderer.noContinuousScroll, true);
    assert.equal(Object.getOwnPropertyDescriptor(renderer, 'noContinuousScroll').get, getter);
});

test('the native getter still controls scrolled mode', () => {
    const renderer = new Renderer();
    configure(renderer, 'scrolled');
    renderer.scrolled = true;
    assert.equal(renderer.noContinuousScroll, false);
    renderer.toggleAttribute('no-continuous-scroll', true);
    assert.equal(renderer.noContinuousScroll, true);
    renderer.toggleAttribute('no-continuous-scroll', false);
    assert.equal(renderer.noContinuousScroll, false);
});

test('fixed-layout renderers are left unchanged', () => {
    const renderer = new Renderer();
    context.configurePaginatedSectionIsolation(renderer, true, 'paginated');
    assert.equal(Object.hasOwn(renderer, 'noContinuousScroll'), false);
    assert.equal(renderer.attributes.size, 0);
});

function paddingFixture(size = 1080, columns = 19) {
    const style = { height: `${size * columns / 2}px`, width: '834px' };
    class PaddingRenderer extends Renderer {
        viewportSize = size;
        columnCount = 2;
        scrollProp = 'scrollTop';
        sideProp = 'height';
        shadowRoot = { getElementById: () => ({ children: [{ style }] }) };
        get size() { return this.viewportSize; }
        get noContinuousScroll() { return this.hasAttribute('no-continuous-scroll'); }
    }
    const renderer = new PaddingRenderer();
    configure(renderer, 'paginated');
    return { renderer, style };
}

test('an odd vertical section gets a trailing half-screen without changing its content size', () => {
    const { renderer, style } = paddingFixture();
    assert.equal(renderer.size, 1080);
    assert.equal(style.paddingBottom, '540px');
    assert.equal(style.height, '10260px');
    assert.equal(renderer.size, 1080);
    assert.equal(style.paddingBottom, '540px');
    style.height = '10800px';
    void renderer.size;
    assert.equal(style.paddingBottom, '0px');
});

test('fractional viewport sizes pad a short section to one screen', () => {
    const { renderer, style } = paddingFixture(1079.953125, 1);
    void renderer.size;
    assert.equal(parseFloat(style.height) + parseFloat(style.paddingBottom), renderer.size);
});

test('single-column, scrolled, continuous and horizontal layouts clear the trailing padding', () => {
    for (const change of [
        renderer => { renderer.columnCount = 1; },
        renderer => { renderer.scrolled = true; },
        renderer => { renderer.toggleAttribute('no-continuous-scroll', false); },
        renderer => { renderer.scrollProp = 'scrollLeft'; renderer.sideProp = 'width'; }
    ]) {
        const { renderer, style } = paddingFixture();
        void renderer.size;
        assert.equal(style.paddingBottom, '540px');
        change(renderer);
        void renderer.size;
        assert.equal(style.paddingBottom, '0px');
        assert.equal(style.paddingLeft, '0px');
        assert.equal(style.paddingRight, '0px');
    }
});

function navigationFixture({ start = 0, end = 800, viewSize = 800.8, fraction = 0.4 } = {}) {
    const moves = [];
    const location = { section: 1, fraction, cfi: 'same-position' };
    const context = vm.createContext({
        view: {
            renderer: { start, end, viewSize },
            isFixedLayout: false,
            next: async () => {},
            prev: async () => {},
            lastLocation: location
        },
        currentLocation: location,
        currentFlowMode: 'paginated',
        forwardNavigationSeq: 0,
        waitForNavigationReady: async () => true,
        summarizeLocation: (value = location) => value,
        debugLog: () => {},
        getLocationSectionIndexOrNull: (value) => value.section,
        getAdjacentLinearSectionIndex: (previous) => previous ? 0 : 2,
        goToAdjacentSpineSection: async (previous) => { moves.push(previous); }
    });
    const startIndex = source.indexOf('async function goPreviousPage(');
    const endIndex = source.indexOf('async function goPhysicalLeft(', startIndex);
    vm.runInContext(source.slice(startIndex, endIndex), context);
    return { context, moves };
}

test('a stalled turn at a fractional section edge advances even in the middle of the book', async () => {
    const { context, moves } = navigationFixture({ start: 400, end: 800, viewSize: 800.8 });
    await context.goNextPage();
    assert.deepEqual(moves, [false]);
});

test('a stalled backward turn uses the section start rather than whole-book progress', async () => {
    const { context, moves } = navigationFixture({ start: 0.5, end: 400.5, viewSize: 800 });
    await context.goPreviousPage();
    assert.deepEqual(moves, [true]);
});

test('a stalled turn inside the section does not skip its remaining pages', async () => {
    const { context, moves } = navigationFixture({ start: 100, end: 500, viewSize: 800, fraction: 0.99 });
    await context.goNextPage();
    await context.goPreviousPage();
    assert.deepEqual(moves, []);
});

test('fixed-layout and scrolled modes keep their existing boundary handling', () => {
    const { context } = navigationFixture();
    context.view.isFixedLayout = true;
    assert.equal(context.isAtPaginatedSectionBoundary(false), null);
    context.view.isFixedLayout = false;
    context.currentFlowMode = 'scrolled';
    assert.equal(context.isAtPaginatedSectionBoundary(true), null);
});
