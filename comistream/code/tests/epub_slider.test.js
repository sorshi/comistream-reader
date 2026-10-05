const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const metricsCode = source.slice(source.indexOf('function getBookSectionCount('), source.indexOf('function calculateSectionPagePosition('));
const sliderCode = source.slice(source.indexOf('function commitSliderPosition('), source.indexOf('function wireToolbar('));
const uiCode = source.slice(source.indexOf('function updateProgressUI('), source.indexOf('async function reconcileCurrentLocationProgressFromCfi('));

function fixture({ sections = 3, fixed = false, flow = 'paginated' } = {}) {
    const actions = [];
    const frames = [];
    const slider = { min: '1', max: String(sections + 1), value: '1', setAttribute(key, value) { this[key] = value; } };
    const elements = { 'epub-slider': slider, 'epub-slider-value': {}, progress: { style: {} } };
    const context = vm.createContext({
        view: { isFixedLayout: fixed, book: { sections: Array(sections).fill({ size: 15000 }) },
            renderer: { atEnd: false, goTo: async (target) => { actions.push({ ...target }); } } },
        currentLocation: { section: { current: 0 }, cfi: 'screen-cfi' },
        latestRendererPageLocation: null,
        currentFlowMode: flow,
        REFLOW_SECTION_SLIDER_SPAN: 0.999999,
        SLIDER_MAX: 1000,
        pendingSliderValue: null,
        sliderDragActive: false,
        sliderCommitScheduled: false,
        menuVisible: false,
        clamp: (v, a, b) => Math.min(Math.max(v, a), b),
        t: (_, fallback) => fallback,
        $: (id) => elements[id],
        setStatusText() {},
        window: { requestAnimationFrame: (callback) => frames.push(callback) },
        navigate: async (action) => action(),
        jumpToFraction: async (fraction) => actions.push({ fraction }),
        goPhysicalLeft: async () => actions.push('left'),
        goPhysicalRight: async () => actions.push('right'),
        goPreviousPage: async () => actions.push('previous'),
        goNextPage: async () => actions.push('next')
    });
    vm.runInContext(metricsCode + uiCode + sliderCode, context);
    function relocate(index, column, count, columns = 1) {
        context.currentLocation = { section: { current: index }, cfi: 'screen-cfi' };
        context.latestRendererPageLocation = {
            index, fraction: column / count, size: columns / count,
            columnCount: columns, flowMode: flow, cfi: 'screen-cfi'
        };
    }
    return { context, actions, frames, slider, elements, relocate };
}

test('reflow slider can select every screen, including odd spreads and long sections', () => {
    const f = fixture();
    for (const [count, columns] of [[1, 1], [1, 2], [34, 1], [67, 2], [68, 2], [10001, 1]]) {
        for (let column = 0; column < count; column += columns) {
            f.relocate(1, column, count, columns);
            const metrics = f.context.getLocationProgressMetrics();
            assert.equal(metrics.currentPage, 2);
            assert.equal(metrics.totalPages, 3);
            assert.equal(metrics.sliderStep, 'any');
            const target = f.context.getReflowSliderTarget(metrics.sliderValue);
            assert.equal(target.index, 1);
            const landed = Math.floor(Math.round(target.anchor * (count - 1)) / columns);
            assert.equal(landed, column / columns);
            assert.equal(f.context.getEpubSliderReadout(metrics.sliderValue), `2–${landed + 1}`);
        }
    }
});

test('a one-section book progresses within the section and reaches the final slider endpoint', () => {
    const f = fixture({ sections: 1 });
    f.relocate(0, 10, 34);
    const metrics = f.context.getLocationProgressMetrics();
    assert.ok(metrics.progressRatio > 0 && metrics.progressRatio < 1);
    assert.equal(metrics.sliderMax, 2);
    assert.equal(f.context.getReflowSliderTarget(1).anchor, 0);
    assert.equal(f.context.getReflowSliderTarget(2).anchor, 1);
    f.relocate(0, 33, 34);
    f.context.view.renderer.atEnd = true;
    assert.equal(f.context.getLocationProgressMetrics().progressRatio, 1);
    assert.equal(f.context.getLocationProgressMetrics().sliderValue, 2);
});

test('section boundaries distinguish the preceding final screen from the next section head', () => {
    const f = fixture();
    f.relocate(0, 33, 34);
    const value = f.context.getLocationProgressMetrics().sliderValue;
    assert.ok(value < 2);
    assert.equal(f.context.getReflowSliderTarget(value).index, 0);
    assert.equal(f.context.getReflowSliderTarget(2).index, 1);
    assert.equal(f.context.getReflowSliderTarget(2).anchor, 0);
    assert.equal(f.context.getReflowSliderTarget(4).index, 2);
    assert.equal(f.context.getReflowSliderTarget(4).anchor, 1);
});

test('scroll progress uses viewport location and rejects old section, CFI and flow snapshots', () => {
    const f = fixture({ flow: 'scrolled' });
    f.relocate(1, 25, 100);
    assert.equal(f.context.getReflowSectionFraction(), 0.25);
    f.context.currentLocation = { section: { current: 0 }, sectionFraction: 0.3 };
    assert.equal(f.context.getReflowSectionFraction(), 0.3);
    f.context.currentLocation = { section: { current: 1 }, cfi: 'restored', fraction: 0.5 };
    assert.equal(f.context.getReflowSectionFraction(), 0.5);
    f.context.latestRendererPageLocation.flowMode = 'paginated';
    assert.equal(f.context.getReflowSectionFraction(), 0.5);
});

test('CFI restore falls back to existing content sizes without changing saved section units', () => {
    const f = fixture();
    f.context.view.book.sections = [{ size: 100 }, { size: 300 }, { linear: 'no', size: 1000 }];
    f.context.currentLocation = { section: { current: 1 }, fraction: 0.625 };
    const metrics = f.context.getLocationProgressMetrics();
    assert.equal(f.context.getReflowSectionFraction(), 0.5);
    assert.equal(metrics.currentPage, 2);
    assert.equal(metrics.totalPages, 3);
    assert.equal(f.context.getReflowSliderTarget(metrics.sliderValue).index, 1);
});

test('progress preserves sub-percent changes and keeps the drag preview intact', () => {
    const f = fixture({ sections: 100 });
    f.relocate(2, 1, 101);
    f.context.updateProgressUI();
    assert.ok(parseFloat(f.elements.progress.style.width) > 2);
    assert.ok(parseFloat(f.elements.progress.style.width) < 2.1);
    assert.equal(f.slider.step, 'any');
    assert.equal(f.elements['epub-slider-value'].textContent, '3–2');
    f.context.sliderDragActive = true;
    f.slider.value = '8.5';
    f.elements['epub-slider-value'].textContent = 'preview';
    f.context.updateProgressUI();
    assert.equal(f.slider.value, '8.5');
    assert.equal(f.elements['epub-slider-value'].textContent, 'preview');
});

test('touch, pointer and change commits coalesce without loading other sections during dragging', async () => {
    const f = fixture();
    f.context.pendingSliderValue = 2.5;
    f.context.sliderDragActive = true;
    f.context.scheduleSliderCommit();
    f.context.scheduleSliderCommit();
    f.context.scheduleSliderCommit();
    assert.equal(f.actions.length, 0);
    assert.equal(f.frames.length, 1);
    f.frames.shift()();
    await Promise.resolve();
    assert.equal(f.actions.length, 1);
    assert.equal(f.actions[0].index, 1);
    assert.ok(f.actions[0].anchor > 0.5);
    f.context.scheduleSliderCommit();
    f.frames.shift()();
    assert.equal(f.actions.length, 1);
});

test('slider arrow keys move one screen and Home/End target book endpoints', async () => {
    const f = fixture();
    let prevented = 0;
    for (const code of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']) {
        f.context.handleEpubSliderKeydown({ code, preventDefault() { prevented++; } });
    }
    await Promise.resolve();
    assert.equal(prevented, 6);
    assert.deepEqual(f.actions.slice(0, 4), ['left', 'right', 'previous', 'next']);
    assert.deepEqual(f.actions.slice(4), [{ index: 0, anchor: 0 }, { index: 2, anchor: 1 }]);
});

test('fixed-layout slider keeps integer values, fractional navigation and native keyboard behavior', async () => {
    const f = fixture({ fixed: true });
    f.context.currentLocation = { fraction: 0.5, location: { total: 20 } };
    const metrics = f.context.getLocationProgressMetrics();
    assert.equal(metrics.sliderStep, '1');
    assert.equal(metrics.sliderValue, 11);
    f.slider.max = '20';
    f.context.pendingSliderValue = 20;
    f.context.commitSliderPosition();
    f.context.handleEpubSliderKeydown({ code: 'End', preventDefault() { assert.fail('native key prevented'); } });
    await Promise.resolve();
    assert.deepEqual(f.actions, [{ fraction: 1 }]);
});

test('bookmark ticks retain legacy section positions and place new bookmarks within the section', () => {
    const f = fixture();
    let options;
    Object.assign(f.context, {
        readerMarkerManager: null, escapedFile: 'book.epub', baseFile: 'book.epub', csrfToken: '', i18n: {}, appConfig: {},
        getNavigationIsRtl: () => false,
        window: { ComistreamReaderMarkers: { create(config) { options = config; return { init: async () => {} }; } } }
    });
    vm.runInContext(source.slice(source.indexOf('function initializeEpubReaderMarkers('), source.indexOf('async function openEpubBook(')), f.context);
    f.context.initializeEpubReaderMarkers();
    const value = (marker) => options.getMarkerSliderValue(marker, { min: 1, max: 4 });
    assert.equal(value({ sectionIndex: 1, progressFraction: 1 / 3, pageNumber: 2 }), 2);
    assert.equal(value({ sectionIndex: 1, progressFraction: 0.5, pageNumber: 2 }), 2 + 0.5 * f.context.REFLOW_SECTION_SLIDER_SPAN);
    assert.equal(value({ sectionIndex: 2, progressFraction: 1, pageNumber: 3 }), 4);
    assert.equal(value({ sectionIndex: 1, progressFraction: 0.8, pageNumber: 2 }), 2);
    assert.equal(value({ sectionIndex: 1, pageNumber: 2 }), 2);
    f.relocate(1, 11, 34);
    const marker = options.getCurrentMarker();
    assert.equal(marker.pageNumber, 2);
    assert.equal(marker.sectionIndex, 1);
    assert.equal(marker.locator, 'screen-cfi');
    assert.ok(Math.abs(value(marker) - f.context.getLocationProgressMetrics().sliderValue) < 1e-12);
});

test('selecting the same screen returns its CFI to navigation recovery', async () => {
    const f = fixture();
    f.relocate(1, 11, 34);
    f.context.view.lastLocation = f.context.currentLocation;
    const history = [];
    f.context.view.history = { pushState: (cfi) => history.push(cfi) };
    const result = await f.context.jumpToReflowPosition(1, 11 / 33);
    assert.equal(result.target, 'screen-cfi');
    assert.equal(result.expectedIndex, 1);
    assert.deepEqual(history, ['screen-cfi']);
});

test('keyboard navigation leaves focus on the slider while its menu stays open', async () => {
    const f = fixture();
    let focused = false;
    f.context.menuVisible = true;
    f.slider.focus = () => { focused = true; };
    f.context.handleEpubSliderKeydown({ code: 'ArrowDown', preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(focused, true);
});
