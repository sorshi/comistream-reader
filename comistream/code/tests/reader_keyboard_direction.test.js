const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { chrome, literal, runBrowserFixture } = require('./browser_fixture');

const imageSource = fs.readFileSync(require.resolve('../comistream.js'), 'utf8');
const epubSource = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');

function section(source, start, end) {
    const first = source.indexOf(start);
    const last = source.indexOf(end, first);
    assert.ok(first >= 0 && last > first);
    return source.slice(first, last);
}

const imageCode = `
    const actions = [], maxPage = 25, imageInspectorUI = null;
    let page = 10, direction = 'left';
    function debugLog() {}
    function isZoomed() { return false; }
    function closeQuickSpread() {}
    function next() { actions.push('next'); }
    function back() { actions.push('previous'); }
    function loadPage() { actions.push(page === 1 ? 'start' : 'end'); }
    ${section(imageSource, 'function leftward(', 'function leftIndex(')}
    ${section(imageSource, 'function funcKey(', 'function toggleRaw(')}
    globalThis.readerKeys = {
        actions, handleKeydown: funcKey,
        setDirection(rtl) { direction = rtl ? 'left' : 'right'; }
    };
`;

const epubCode = `
    const actions = [], epubInspectorUI = null;
    const view = { book: { dir: 'rtl' } }, currentDirectionInfo = { rtl: true };
    let currentDirectionOverride = 'auto';
    const $ = () => null, isEditableTarget = () => false;
    function debugLog() {}
    function summarizeLocation() { return {}; }
    function navigate(action) { return action(); }
    function goNextPage() { actions.push('next'); }
    function goPreviousPage() { actions.push('previous'); }
    function goToBoundary(atStart) { actions.push(atStart ? 'start' : 'end'); }
    ${section(epubSource, 'function normalizeDirectionValue(', 'function isDebugEnabled(')}
    ${section(epubSource, 'function getNavigationIsRtl(', 'function formatDirectionLabel(')}
    ${section(epubSource, 'async function goPhysicalLeft(', 'function renderInspector(')}
    ${section(epubSource, 'function handleKeydown(', 'function sendProgressBeacon(')}
    globalThis.readerKeys = {
        actions, handleKeydown,
        setDirection(rtl) { view.book.dir = rtl ? 'rtl' : 'ltr'; },
        setOverride(value) { currentDirectionOverride = value; },
        bind: bindKeyboardShortcuts
    };
`;

function cases(rtl) {
    return [
        ['ArrowLeft', 'ArrowLeft', false, rtl ? 'next' : 'previous'],
        ['ArrowRight', 'ArrowRight', false, rtl ? 'previous' : 'next'],
        ['Comma', ',', false, rtl ? 'end' : 'start'],
        ['Comma', '<', true, rtl ? 'end' : 'start'],
        ['Period', '.', false, rtl ? 'start' : 'end'],
        ['Period', '>', true, rtl ? 'start' : 'end']
    ];
}

function fixture(code) {
    const context = vm.createContext({ document: { getElementById: () => null } });
    vm.runInContext(code, context);
    return context.readerKeys;
}

function checkKey(reader, code, key, shiftKey, expected, extra = {}) {
    reader.handleKeydown({ code, key, shiftKey, preventDefault() {}, stopPropagation() {}, ...extra });
    assert.equal(reader.actions.pop(), expected, `${code || key} should navigate to ${expected}`);
    assert.equal(reader.actions.length, 0);
}

for (const [name, code] of [['CBZ/PDF', imageCode], ['EPUB', epubCode]]) {
    test(`${name} angle and arrow keys follow reading direction when it changes`, () => {
        const reader = fixture(code);
        for (const rtl of [true, false, true]) {
            reader.setDirection(rtl);
            for (const args of cases(rtl)) checkKey(reader, ...args);
        }
    });

    test(`${name} native keyboard events follow reading direction`, { skip: !chrome }, async () => {
        await runBrowserFixture(`
            ${code}
            window.testDone = false;
            (async () => {
                ${name === 'EPUB' ? 'readerKeys.bind(document);' : "window.addEventListener('keydown', readerKeys.handleKeydown);"}
                const targets = [document];
                if (${name === 'EPUB'}) {
                    const frame = document.getElementById('book');
                    if (frame.contentDocument?.URL !== 'about:srcdoc' || frame.contentDocument.readyState !== 'complete') {
                        await new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
                    }
                    targets.push(frame.contentDocument);
                    readerKeys.bind(targets[1]);
                }
                for (const doc of targets) {
                    for (const rtl of [true, false, true]) {
                        readerKeys.setDirection(rtl);
                        const cases = rtl ? ${literal(cases(true))} : ${literal(cases(false))};
                        for (const [code, key, shiftKey, expected] of cases) {
                            doc.body.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { code, key, shiftKey, bubbles: true, cancelable: true }));
                            expect(readerKeys.actions.pop() === expected, code + ' navigated in the wrong direction');
                            expect(readerKeys.actions.length === 0, 'Key triggered multiple actions');
                        }
                    }
                }
                window.testDone = true;
            })().catch(error => { window.testFailed = true; document.getElementById('result').textContent = error.stack; });
        `, '<iframe id="book" srcdoc="<body>EPUB content</body>"></iframe>');
    });
}

test('CBZ/PDF legacy punctuation key codes follow reading direction', () => {
    const reader = fixture(imageCode);
    for (const rtl of [true, false]) {
        reader.setDirection(rtl);
        checkKey(reader, '', '', false, rtl ? 'end' : 'start', { keyCode: 188 });
        checkKey(reader, '', '', false, rtl ? 'start' : 'end', { keyCode: 190 });
    }
});

test('EPUB angle keys respect direction overrides and key-only events; Home/End remain absolute', () => {
    const reader = fixture(epubCode);
    reader.setDirection(true);
    for (const override of ['ltr', 'rtl', 'auto']) {
        const rtl = override !== 'ltr';
        reader.setOverride(override);
        checkKey(reader, '', '<', true, rtl ? 'end' : 'start');
        checkKey(reader, '', '>', true, rtl ? 'start' : 'end');
        checkKey(reader, 'Home', 'Home', false, 'start');
        checkKey(reader, 'End', 'End', false, 'end');
    }
});
