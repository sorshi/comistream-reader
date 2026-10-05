const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { chrome } = require('./browser_fixture');
const { runEpubBrowserFixture } = require('./epub_browser_fixture');

const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const metrics = source.slice(source.indexOf('function getBookSectionCount('), source.indexOf('function calculateSectionPagePosition('));
const commits = source.slice(source.indexOf('function commitSliderPosition('), source.indexOf('function wireToolbar('));
const ui = source.slice(source.indexOf('function updateProgressUI('), source.indexOf('async function reconcileCurrentLocationProgressFromCfi('));
const binding = source.slice(source.indexOf('    const slider =', source.indexOf('function wireToolbar(')), source.indexOf('function renderTocItems('));
const rendererBinding = source.slice(source.indexOf('function bindRendererPagePositionEvents('), source.indexOf('function recordEpubUserPosition('));
const isolation = source.slice(source.indexOf('function configurePaginatedSectionIsolation('), source.indexOf('function isValidThemeName('));
const moduleBase = source.match(/const FOLIATE_MODULE_BASE = '([^']+)'/)[1];

async function checkSlider() {
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const expect = (value, message) => { if (!value) throw new Error(message); };
    const slider = $('epub-slider');
    for (const { count, columns, vertical, rtl = vertical } of [
        { count: 19, columns: 2, vertical: true },
        { count: 20, columns: 2, vertical: true },
        { count: 19, columns: 1, vertical: true },
        { count: 1, columns: 2, vertical: true },
        { count: 19, columns: 1, vertical: false },
        { count: 19, columns: 2, vertical: false },
        { count: 19, columns: 2, vertical: false, rtl: true }
    ]) {
        const label = JSON.stringify({ count, columns, vertical, rtl });
        const paginator = new Paginator();
        paginator.style.cssText = 'position:fixed;left:0;top:80px;width:834px;height:1000px';
        for (const [name, value] of Object.entries({
            flow: 'paginated', gap: '0', 'margin-top': '0', 'margin-right': '0',
            'margin-bottom': '0', 'margin-left': '0',
            'max-inline-size': columns === 1 ? '2000' : '600',
            'max-block-size': '2000', 'max-column-count': '2', 'no-preload': ''
        })) paginator.setAttribute(name, value);
        configurePaginatedSectionIsolation(paginator, false, 'paginated');
        document.body.append(paginator);
        const makeSection = (id, length) => URL.createObjectURL(new Blob([
            `<!doctype html><html dir="${!vertical && rtl ? 'rtl' : 'ltr'}"><meta charset="utf-8"><style>
            body { writing-mode: ${vertical ? 'vertical-rl' : 'horizontal-tb'}; font:20px/1.8 serif; }
            p { margin:0; break-before:column; } p:first-child { break-before:auto; }
            </style><body>${Array.from({ length }, (_, i) => `<p>${id}-${i + 1} 本文</p>`).join('')}</body>`
        ], { type: 'text/html' }));
        const urls = [makeSection('A', count), makeSection('B', 3)];
        let loads = 0;
        let jumps = 0;
        const sections = urls.map((url, index) => ({ id: String(index), size: 15000, linear: 'yes', load: async () => { loads++; return url; } }));
        view = { renderer: paginator, isFixedLayout: false, book: { sections, dir: rtl ? 'rtl' : 'ltr' } };
        currentFlowMode = 'paginated';
        latestRendererPageLocation = null;
        paginator.addEventListener('relocate', ({ detail }) => {
            lastViewRelocationCfi = `${detail.index}:${detail.fraction}`;
            currentLocation = { section: { current: detail.index }, cfi: lastViewRelocationCfi };
            view.lastLocation = currentLocation;
        });
        bindRendererPagePositionEvents();
        paginator.open({ dir: rtl ? 'rtl' : 'ltr', sections });
        const goTo = paginator.goTo.bind(paginator);
        paginator.goTo = async (target) => { jumps++; return goTo(target); };
        try {
            await paginator.goTo({ index: 0, anchor: 0 });
            await delay(100);
            expect(paginator.columnCount === columns, `Column count: ${label}: ${paginator.columnCount}`);
            expect(slider.step === 'any', `Continuous slider: ${label}`);
            const lastColumn = Math.floor((count - 1) / columns) * columns;
            await paginator.goTo({ index: 0, anchor: count > 1 ? lastColumn / (count - 1) : 0 });
            await delay(80);
            const lastValue = slider.value;
            const lastText = latestRendererPageLocation.range.toString();
            expect($('epub-slider-value').textContent === `1–${Math.ceil(count / columns)}`, `Last screen label: ${label}`);
            expect(Number(lastValue) < 2, `Last screen crossed section boundary: ${label}`);
            await paginator.goTo({ index: 0, anchor: 0 });
            await delay(80);
            const beforeLoads = loads;
            const beforeJumps = jumps;
            slider.dispatchEvent(new PointerEvent('pointerdown'));
            for (const value of [2.1, 2.8, lastValue]) {
                slider.value = value;
                slider.dispatchEvent(new Event('input'));
                await delay(20);
            }
            expect(loads === beforeLoads && jumps === beforeJumps, `Dragging rendered another section: ${label}`);
            slider.dispatchEvent(new Event('change'));
            slider.dispatchEvent(new PointerEvent('pointerup'));
            slider.dispatchEvent(new Event('touchend'));
            await delay(80);
            await navigationChain;
            expect(jumps === beforeJumps + 1, `Duplicate commit: ${label}: ${jumps - beforeJumps}`);
            expect(latestRendererPageLocation.range.toString() === lastText, `Slider did not restore the same screen: ${label}`);
            slider.value = '2.5';
            slider.dispatchEvent(new Event('input'));
            slider.dispatchEvent(new Event('change'));
            await delay(80);
            await navigationChain;
            expect(latestRendererPageLocation.index === 1, `Cross-section jump: ${label}`);
            expect(loads === beforeLoads + 1, `Unexpected section preloading: ${label}: ${loads - beforeLoads}`);
            slider.value = slider.max;
            slider.dispatchEvent(new Event('input'));
            slider.dispatchEvent(new Event('change'));
            await delay(80);
            await navigationChain;
            expect(parseFloat($('progress').style.width) === 100, `Final progress: ${label}: ${$('progress').style.width}`);
            expect(latestRendererPageLocation.range.toString().includes('B-3'),
                `Final screen: ${label}: fraction=${latestRendererPageLocation.fraction}, size=${latestRendererPageLocation.size}, text=${latestRendererPageLocation.range}`);
            const savedCfi = currentLocation.cfi;
            const result = await jumpToReflowPosition(1, 1);
            expect(result.target === savedCfi, `Same-screen jump lost its CFI: ${label}`);
            slider.dispatchEvent(new KeyboardEvent('keydown', { code: 'Home', bubbles: true, cancelable: true }));
            await navigationChain;
            await delay(200);
            expect(latestRendererPageLocation.index === 0 && latestRendererPageLocation.fraction === 0,
                `Keyboard Home: ${label}: index=${latestRendererPageLocation.index}, fraction=${latestRendererPageLocation.fraction}, text=${latestRendererPageLocation.range}`);
            const key = rtl ? 'ArrowLeft' : 'ArrowRight';
            slider.dispatchEvent(new KeyboardEvent('keydown', { code: key, bubbles: true, cancelable: true }));
            await navigationChain;
            await delay(200);
            expect(latestRendererPageLocation.fraction > 0 || latestRendererPageLocation.index === 1, `Keyboard screen navigation: ${label}`);
            if (vertical && count === 19 && columns === 2) {
                currentFlowMode = 'scrolled';
                latestRendererPageLocation = null;
                paginator.style.width = '200px';
                configurePaginatedSectionIsolation(paginator, false, 'scrolled');
                paginator.setAttribute('flow', 'scrolled');
                await delay(200);
                await jumpToReflowPosition(0, 0.4);
                await delay(200);
                expect(Math.abs(getReflowSectionFraction() - 0.4) < 0.02,
                    `Scrolled fraction: ${label}: ${getReflowSectionFraction()}, start=${paginator.start}, viewSize=${paginator.viewSize}`);
                slider.value = 1 + 0.6 * REFLOW_SECTION_SLIDER_SPAN;
                slider.dispatchEvent(new Event('input'));
                slider.dispatchEvent(new Event('change'));
                await delay(80);
                await navigationChain;
                await delay(200);
                expect(Math.abs(getReflowSectionFraction() - 0.6) < 0.02, `Scrolled slider jump: ${label}`);
            }
        } finally {
            paginator.destroy();
            paginator.remove();
            urls.forEach(url => URL.revokeObjectURL(url));
        }
    }
}

test('real EPUB renderer seeks within sections without preloading or duplicate drag commits', {
    skip: !chrome || process.env.COMISTREAM_EPUB_BROWSER_TESTS !== '1'
}, async () => {
    let moduleSource;
    if (process.env.COMISTREAM_FOLIATE_PAGINATOR) moduleSource = fs.readFileSync(process.env.COMISTREAM_FOLIATE_PAGINATOR, 'utf8');
    else {
        const response = await fetch(moduleBase + 'paginator.js');
        assert.ok(response.ok, `Foliate download failed: ${response.status}`);
        moduleSource = await response.text();
    }
    const html = `<!doctype html><meta charset="utf-8">
        <div id="progress"></div><input id="epub-slider" type="range"><span id="epub-slider-value"></span>
        <script type="module">
        import { Paginator } from '/paginator.js';
        const $ = id => document.getElementById(id);
        const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
        const t = (_, fallback) => fallback;
        const REFLOW_SECTION_SLIDER_SPAN = 0.999999, SLIDER_MAX = 1000;
        const sectionIsolationRenderers = new WeakSet();
        const epubEndController = null;
        let view, currentLocation, latestRendererPageLocation, currentFlowMode, lastViewRelocationCfi;
        let sliderDragActive = false, pendingSliderValue = null, sliderCommitScheduled = false;
        let menuVisible = true;
        let navigationChain = Promise.resolve();
        function navigate(action) {
            return navigationChain = navigationChain.then(async () => {
                const result = await action();
                await new Promise(resolve => setTimeout(resolve, 200));
                return result;
            });
        }
        function setStatusText() {}
        function getPageTurnDirection() { return 0; }
        function animatePageTurn() {}
        function schedulePagePositionUpdate(location = latestRendererPageLocation) {
            latestRendererPageLocation = location;
            updateProgressUI();
        }
        function goPhysicalLeft() { return view.book.dir === 'rtl' ? view.renderer.next() : view.renderer.prev(); }
        function goPhysicalRight() { return view.book.dir === 'rtl' ? view.renderer.prev() : view.renderer.next(); }
        function goPreviousPage() { return view.renderer.prev(); }
        function goNextPage() { return view.renderer.next(); }
        ${isolation}
        ${metrics}
        ${commits}
        ${ui}
        ${rendererBinding}
        function bindSlider() {
        ${binding}
        bindSlider();
        (${checkSlider.toString()})().then(() => { window.__progressNativeResult = { ok: true }; })
            .catch(error => { window.__progressNativeResult = { ok: false, error: error.stack }; });
        </script>`;
    const server = http.createServer((request, response) => {
        const isModule = request.url === '/paginator.js';
        response.setHeader('Content-Type', isModule ? 'text/javascript' : 'text/html');
        response.end(isModule ? moduleSource : html);
    });
    try {
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        await runEpubBrowserFixture(`http://127.0.0.1:${server.address().port}/`);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});
