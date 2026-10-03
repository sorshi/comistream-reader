const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const epub = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const imageReader = fs.readFileSync(require.resolve('../comistream.js'), 'utf8');

for (const [name, source, start, end, handler] of [
    ['EPUB', epub, 'function handleKeydown(', 'function bindKeyboardShortcuts(', 'handleKeydown'],
    ['image/PDF', imageReader, 'function funcKey(', 'function toggleTrimmingFile(', 'funcKey']
]) {
    test(`${name} TOC buttons keep native Space and Enter activation`, () => {
        const context = vm.createContext({});
        const first = source.indexOf(start);
        const last = source.indexOf(end, first);
        assert.ok(first >= 0 && last > first);
        vm.runInContext(source.slice(first, last), context);
        for (const [key, code, keyCode] of [[' ', 'Space', 32], ['Enter', 'Enter', 13]]) {
            context[handler]({ key, code, keyCode, target: { closest: () => ({ tagName: 'BUTTON' }) } });
        }
    });
}

test('page-position OFF clears both visual and accessible selected states', () => {
    const classes = new Set(['pressed']);
    const button = {
        setAttribute(name, value) { this[name] = value; },
        classList: { toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } }
    };
    const context = vm.createContext({
        view: { isFixedLayout: false }, currentFlowMode: 'paginated', pagePositionVisible: true,
        currentPagePosition: null, menuVisible: true,
        PAGE_POSITION_VISIBLE_KEY: 'position', localStorage: { setItem() {} },
        $: (id) => id === 'epub-page-position-toggle' ? button : null,
        hidePagePosition() {}, schedulePagePositionUpdate() {}
    });
    const start = epub.indexOf('function updatePagePositionSetting(');
    vm.runInContext(epub.slice(start, epub.indexOf('function updateProgressUI(', start)), context);
    context.setPagePositionVisible(false);
    assert.equal(classes.has('pressed'), false);
    assert.equal(button['aria-pressed'], 'false');
    context.setPagePositionVisible(true);
    assert.equal(classes.has('pressed'), true);
    assert.equal(button['aria-pressed'], 'true');
});

for (const [id, initialClass, fn, expectedUrlPart] of [
    ['rawMode', 'raw', 'toggleRaw', 'file=book'],
    ['rawMode', 'cmp', 'toggleRaw', 'file=book'],
    ['splitFile', 'normal', 'toggleTrimmingFile', 'view=trimming'],
    ['splitFile', 'trimming', 'toggleTrimmingFile', 'file=book']
]) {
    test(`${fn} preserves the current button until navigation (${initialClass})`, () => {
        const button = {
            className: `button button-mode ${initialClass}`, textContent: '原寸',
            classList: { contains: (name) => name === initialClass }
        };
        let destination = '';
        const context = vm.createContext({
            document: { getElementById: () => button },
            window: { i18n: {} },
            FormData: class { append() {} },
            readerProgressManager: null, navigator: { sendBeacon() {} }, escapedFile: 'book', page: 3,
            debugLog() {},
            location: { href: 'https://reader.test/comistream.php?file=book&size=FULL' + (initialClass === 'trimming' ? '&view=trimming' : ''), replace: (url) => { destination = url; } }
        });
        const start = imageReader.indexOf('function toggleRaw(');
        const end = imageReader.indexOf('async function sugguestbook(', start);
        vm.runInContext(imageReader.slice(start, end), context);
        context[fn]();
        assert.equal(button.className, `button button-mode ${initialClass}`);
        assert.equal(button.textContent, '原寸');
        assert.ok(destination.includes(expectedUrlPart));
        if (fn === 'toggleRaw') assert.equal(destination.includes('size='), false);
        if (initialClass === 'trimming') assert.equal(destination.includes('view=trimming'), false);
    });
}

test('page and section buttons follow the physical reading direction and DOM focus order', () => {
    const elements = new Map();
    const groups = [];
    for (const type of ['page', 'section']) {
        const previous = { id: `epub-prev-${type}` };
        const next = { id: `epub-next-${type}` };
        const group = {
            children: [previous, next],
            insertBefore(item, reference) {
                this.children = this.children.filter(child => child !== item);
                this.children.splice(this.children.indexOf(reference), 0, item);
            }
        };
        previous.parentElement = next.parentElement = group;
        elements.set(previous.id, previous);
        elements.set(next.id, next);
        groups.push(group);
    }
    const context = vm.createContext({ $: id => elements.get(id) });
    const first = epub.indexOf('function updateNavigationButtonOrder(');
    vm.runInContext(epub.slice(first, epub.indexOf('function getBookSectionCount(', first)), context);
    for (const rtl of [true, false, true]) {
        context.updateNavigationButtonOrder(rtl);
        for (const group of groups) {
            assert.ok(group.children[0].id.includes(rtl ? 'next' : 'prev'));
            assert.ok(group.children[1].id.includes(rtl ? 'prev' : 'next'));
        }
    }
});

for (const [name, source, end] of [
    ['EPUB', epub, 'function toggleFullScreen('],
    ['image/PDF', imageReader, 'function toggleFullScreen(']
]) {
    test(`${name} fullscreen control reports the current mode without toggle styling`, () => {
        const rejectToggle = () => assert.fail('Unexpected toggle styling');
        const button = {
            textContent: '',
            classList: { add: rejectToggle, remove: rejectToggle, toggle: rejectToggle }
        };
        const doc = { getElementById: () => button, fullscreenElement: null };
        const context = vm.createContext({
            document: doc, $: () => button,
            window: { i18n: { toc_button_fullscreen: '全画面表示', toc_button_windowed: '通常表示' } },
            t: key => key === 'fullscreen' ? '全画面表示' : '通常表示'
        });
        const start = source.indexOf('function updateFullScreenButton(');
        vm.runInContext(source.slice(start, source.indexOf(end, start)), context);
        context.updateFullScreenButton();
        assert.equal(button.textContent, '通常表示');
        doc.fullscreenElement = {};
        context.updateFullScreenButton();
        assert.equal(button.textContent, '全画面表示');
    });
}
