const test = require('node:test');
const fs = require('node:fs');
const http = require('node:http');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { runEpubBrowserFixture } = require('./epub_browser_fixture');
const { chrome, literal, runBrowserFixture } = require('./browser_fixture');

const css = fs.readFileSync(require.resolve('../comistream.css'), 'utf8');
const helper = fs.readFileSync(require.resolve('../reader_inspector.js'), 'utf8');
const markup = chrome ? execFileSync('php', ['-r', 'require "comistream/code/lib/lib_view.php"; echo generateReaderInspectorHTML("閉じる");'], { encoding: 'utf8' }) : '';
const imageSource = fs.readFileSync(require.resolve('../comistream.js'), 'utf8');
const epubSource = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');

async function runRealtimeFixture(script) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comistream-inspector-'));
    try {
        const file = path.join(root, 'fixture.html');
        fs.writeFileSync(file, `<!doctype html><meta charset="utf-8"><body><script>
            function expect(value, message) { if (!value) throw new Error(message); }
            ${script}
        </script>`);
        await runEpubBrowserFixture(pathToFileURL(file).href);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function section(source, start, end) {
    const first = source.indexOf(start);
    return source.slice(first, source.indexOf(end, first));
}

const imageCode = `
    const maxPage = 25, imagex = 1200, imagey = 1800, direction = 'left';
    let page = 3, displayedEnd = 3;
    window.shortcutActions = [];
    function recordShortcut(action) { window.pageMoves++; window.shortcutActions.push(action); }
    const archiveFileMBytes = 20, averagePageKBytes = 800;
    const preCaches = { getSize: () => 5, getNetworkSpeed: () => ({ kbps: 1500, stale: false }), getStatus: () => 'empty' };
    function getFullImageUrl(number) { return 'https://reader.invalid/?page=' + number; }
    function isZoomed() { return false; }
    function debugLog() {}
    function closeQuickSpread() {}
    function quickSpredView() { recordShortcut('quick-spread'); }
    function leftward() { recordShortcut('left'); }
    function rightward() { recordShortcut('right'); }
    function leftIndex() { recordShortcut('section-left'); }
    function rightIndex() { recordShortcut('section-right'); }
    function loadPage() { recordShortcut(page === 1 ? 'start' : 'end'); }
    function single() { recordShortcut('single'); }
    function spread() { recordShortcut('spread'); }
    function index() { window.menuToggles++; }
    function backListPage() { window.backCalls++; }
    ${section(imageSource, 'let imageInspectorUI =', 'function getFullImageUrl(')}
    ${section(imageSource, 'function funcKey(', 'function toggleRaw(')}
    window.openInspector = () => showInspector(true);
    window.readerKeydown = funcKey;
`;

for (const width of [1000, 320]) {
    test(`image/PDF preload indicators remain selectable without hover details at width ${width}`, { skip: !chrome }, async () => {
        const body = `<style>${css}</style><button id="reader">Reader</button><div id="contents"></div>${markup}`;
        await runRealtimeFixture(`
          (async () => {
            const frame = document.createElement('iframe');
            frame.style.cssText = 'width:${width}px;height:700px;border:0';
            document.body.append(frame);
            const doc = frame.contentDocument;
            doc.open(); doc.write(${literal(body)}); doc.close();
            const win = frame.contentWindow;
            win.eval(${literal(helper + '\n' + imageCode + `
                const states = new Map([[5, 'loaded'], [6, 'loading'], [7, 'failed']]);
                displayedEnd = 4;
                preCaches.getSize = () => 9;
                preCaches.getStatus = url => states.get(Number(new URL(url).searchParams.get('page'))) || 'empty';
                window.setSpeed = (kbps, stale = false) => { preCaches.getNetworkSpeed = () => ({ kbps, stale }); preCaches.onChange(); };
                window.setPreloadState = (number, state) => { states.set(number, state); preCaches.onChange(); };
                window.movePreloadRange = end => { displayedEnd = end; showInspector(true); };
                window.enlargePreloadRange = () => { preCaches.getSize = () => 52; preCaches.onChange(); };
            `)});
            win.pageMoves = 0; win.menuToggles = 0;
            win.addEventListener('keydown', win.readerKeydown);
            win.openInspector();
            await new Promise(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(resolve)));
            const content = doc.getElementById('inspector-content');
            const cells = () => [...content.querySelectorAll('.inspector-preload-cell')];
            const count = () => content.querySelector('.inspector-preload-count').textContent;
            expect(cells().length === 9 && cells()[0].dataset.page === '5', 'Spread range includes displayed pages');
            expect(cells().map(cell => cell.textContent).join('') === '■▃×□□□□□□', 'Incorrect status symbols');
            expect(count() === '1/9', 'Incorrect loaded count');
            const row = content.querySelector('.inspector-preload-line');
            expect(!row.querySelector('button, [title]'), 'Preload row still has controls or hover tooltips');
            expect(cells()[1].getAttribute('aria-label') === 'Page 6: Loading', 'Accessible label missing');
            const beforeHover = doc.activeElement;
            const beforeText = content.textContent;
            for (const cell of cells().slice(0, 4)) {
                cell.dispatchEvent(new win.PointerEvent('pointerenter', { pointerType: 'mouse' }));
                cell.click();
            }
            expect(!content.querySelector('.inspector-preload-detail'), 'Inline hover detail still exists');
            expect(content.textContent === beforeText && doc.activeElement === beforeHover, 'Hover or click changed the inspector');
            for (const element of [row, ...row.querySelectorAll('*')]) {
                expect(win.getComputedStyle(element).userSelect === 'text', 'Preload text is not selectable');
                expect(win.getComputedStyle(element).cursor === 'text', 'Preload text has an interactive cursor');
            }
            const selection = win.getSelection();
            const range = doc.createRange();
            range.selectNodeContents(row);
            selection.removeAllRanges(); selection.addRange(range);
            const selectedText = selection.toString();
            expect(selectedText.includes('Preload Pages: 9') && selectedText.includes('■') &&
                selectedText.includes('▃') && selectedText.includes('×') && selectedText.includes('□') &&
                selectedText.includes('1/9'), 'Selection omitted label, status symbols or count');
            expect(selectedText === 'Preload Pages: 9 ■▃×□□□□□□ 1/9', 'Selection added unwanted line breaks');
            win.setPreloadState(6, 'loading');
            expect(selection.toString() === selectedText, 'Unchanged refresh disrupted text selection');
            const speedRow = content.querySelector('#inspector-network-speed');
            expect(speedRow.textContent === 'Network Speed: 1,500 kbps', 'Initial speed has wrong units');
            win.setSpeed(4321);
            expect(speedRow.textContent === 'Network Speed: 4,321 kbps', 'Speed did not update live');
            expect(selection.toString() === selectedText, 'Speed update disrupted other selected text');
            expect(content.querySelector('#inspector-network-speed') === speedRow, 'Speed row was replaced');
            range.selectNodeContents(speedRow);
            selection.removeAllRanges(); selection.addRange(range);
            const selectedSpeed = selection.toString();
            win.setSpeed(9876);
            expect(selection.toString() === selectedSpeed && speedRow.textContent === selectedSpeed, 'Speed changed during selection/copy');
            selection.removeAllRanges();
            doc.dispatchEvent(new win.Event('selectionchange'));
            expect(speedRow.textContent === 'Network Speed: 9,876 kbps', 'Deselection did not restore current speed');
            selection.removeAllRanges();
            const loadingCell = cells()[1];
            const extra = doc.createElement('div');
            extra.style.height = '1000px'; content.append(extra);
            content.scrollTop = 100;
            win.setPreloadState(6, 'loaded');
            expect(cells()[1] === loadingCell, 'Update replaced a status cell');
            expect(content.scrollTop === 100, 'Update changed scroll position');
            win.setSpeed(null);
            expect(speedRow.textContent === 'Network Speed: —', 'Unknown speed must not display zero');
            expect(content.scrollTop === 100, 'Speed update changed scroll position');
            win.setSpeed(9876, true);
            expect(speedRow.textContent === 'Network Speed: 9,876 kbps (last measurement)', 'Retained result missing');
            expect(content.scrollTop === 100, 'Retained result changed scroll position');
            expect(cells()[1].textContent === '■' && count() === '2/9', 'Completion did not refresh');
            cells()[2].dispatchEvent(new win.Event('touchend', { bubbles: true }));
            cells()[2].click();
            expect(!content.querySelector('.inspector-preload-detail'), 'Tap opened inline detail');
            expect(win.pageMoves === 0, 'Pointer interaction turned a page');
            const arrow = new win.KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', bubbles: true, cancelable: true });
            cells()[2].dispatchEvent(arrow);
            expect(win.pageMoves === 1 && arrow.defaultPrevented, 'Preload row blocked the page shortcut or also scrolled');
            win.setPreloadState(7, 'loading');
            expect(cells()[2].textContent === '▃', 'Retry did not refresh status');
            win.setPreloadState(5, 'empty');
            expect(cells()[0].textContent === '□' && count() === '1/9', 'Eviction left a loaded indicator');
            win.enlargePreloadRange();
            expect(cells().length === 21, 'Range did not stop at book end');
            expect(content.scrollWidth <= content.clientWidth, 'Indicators overflow horizontally');
            const widths = cells().map(cell => cell.getBoundingClientRect().width);
            expect(widths.every(value => value === widths[0]), 'Status cells have unequal widths');
            win.movePreloadRange(23);
            expect(cells().length === 2 && cells()[0].dataset.page === '24' && count() === '0/2', 'Near-end range incorrect');
            win.movePreloadRange(25);
            expect(cells().length === 0 && count() === '0/0', 'Last page has invalid preload cells');
            doc.getElementById('inspector-close').click();
            win.setPreloadState(24, 'loaded');
            expect(content.childElementCount === 0, 'Closed inspector was updated');
            win.movePreloadRange(23);
            expect(count() === '1/2', 'Reopened inspector did not show latest state');
          })().then(() => { window.__progressNativeResult = { ok: true }; }).catch(error => {
            window.__progressNativeResult = { ok: false, error: error.stack };
          });
        `);
    });
}
const epubCode = `
    window.shortcutActions = [];
    function recordShortcut(action) { window.pageMoves++; window.shortcutActions.push(action); }
    const $ = id => document.getElementById(id);
    const view = { book: { metadata: { title: '<img src=x onerror=alert(1)>日本語の書名', author: '著者名', language: 'ja' }, sections: [1, 2, 3] } };
    const epubPackageBase = '/package/' + 'x'.repeat(400), epubUrl = '';
    const currentLocation = { fraction: 0.25, section: { current: 1, total: 3 }, cfi: 'epubcfi(/6/2)' };
    const currentDirectionInfo = { rtl: true, vertical: true };
    const currentDirectionOverride = 'auto', currentWritingModeOverride = 'vertical';
    const currentFlowMode = 'paginated';
    let menuVisible = true;
    ${section(epubSource, 'function normalizeMetadataValue(', 'function restoreFailureState(')}
    function extractSignatureExpiration() { return 0; }
    function getStoredState() { return { updatedAt: 1700000000000 }; }
    function formatPercent(fraction) { return Math.round(fraction * 100) + '%'; }
    function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
    function isEditableTarget() { return false; }
    function hidePagePositionHelp() {}
    function schedulePagePositionUpdate() {}
    function hidePagePosition() {}
    function focusReader() { document.getElementById('reader').focus(); }
    function navigate(operation) { return operation(); }
    function goPhysicalLeft() { recordShortcut('left'); }
    function goPhysicalRight() { recordShortcut('right'); }
    function goNextPage() { recordShortcut('next'); }
    function goPreviousPage() { recordShortcut('previous'); }
    function goToAdjacentSection(left) { recordShortcut(left ? 'section-left' : 'section-right'); }
    function goToBoundary(start) { recordShortcut(start ? 'start' : 'end'); }
    function getNavigationIsRtl() { return true; }
    function summarizeLocation() { return {}; }
    function toggleFullScreen() { recordShortcut('fullscreen'); }
    function backListPage() { window.backCalls++; }
    function debugLog() {}
    function t() { throw new Error('Inspector attempted localization'); }
    ${section(epubSource, 'function formatDateTime(', 'function setStatusText(')}
    ${section(epubSource, 'function toggleMenu(', 'async function goPreviousPage(')}
    ${section(epubSource, 'function renderInspector(', 'function updateFullScreenButton(')}
    ${section(epubSource, 'function handleKeydown(', 'function bindKeyboardShortcuts(')}
    window.openInspector = () => toggleInspector(true);
    window.readerKeydown = handleKeydown;
    window.refreshInspector = renderInspector;
`;

for (const [name, menuId, code] of [['CBZ', 'contents', imageCode], ['EPUB', 'epub-menu-panel', epubCode]]) {
    for (const [width, height, modal] of [[1000, 800, false], [320, 568, true], [900, 300, true]]) {
        test(`${name} inspector closes and restores TOC at ${width}x${height}`, { skip: !chrome }, async () => {
            const body = `<style>${css}</style>
                <button id="reader">Reader</button>
                <div id="${menuId}" class="contents" style="display:block;height:180px;z-index:95">
                    <button id="inspectorToggleButton" aria-pressed="false">Inspector</button>
                    <div style="height:1000px"></div>
                </div>${markup}`;
            await runBrowserFixture(`
                const frame = document.createElement('iframe');
                frame.style.cssText = 'width:${width}px;height:${height}px;border:0';
                document.body.append(frame);
                const doc = frame.contentDocument;
                doc.open(); doc.write(${literal(body)}); doc.close();
                const win = frame.contentWindow;
                win.eval(${literal(helper + '\n' + code)});
                win.pageMoves = 0; win.menuToggles = 0; win.backCalls = 0;
                ${name === 'EPUB' ? 'doc' : 'win'}.addEventListener('keydown', win.readerKeydown, ${name === 'EPUB'});
                const panel = doc.getElementById('inspector');
                const content = doc.getElementById('inspector-content');
                const close = doc.getElementById('inspector-close');
                const menu = doc.getElementById('${menuId}');
                const toggle = doc.getElementById('inspectorToggleButton');
                menu.scrollTop = 80;
                toggle.focus({ preventScroll: true });
                win.openInspector();
                expect(panel.open, 'Panel did not open');
                expect(panel.matches(':modal') === ${modal}, 'Wrong modal state');
                expect(menu.style.display === 'none', 'TOC was not hidden');
                expect(toggle.getAttribute('aria-pressed') === 'true', 'Toggle state not updated');
                expect(close.getAttribute('aria-label') === '閉じる', 'Close label lost localization');
                const ul = content.querySelector('ul');
                for (let i = 0; i < 60; i++) {
                    const item = doc.createElement('li');
                    item.textContent = 'Diagnostic ' + 'x'.repeat(300);
                    ul.append(item);
                }
                const before = close.getBoundingClientRect();
                content.scrollTop = content.scrollHeight;
                const after = close.getBoundingClientRect();
                expect(content.scrollTop > 0, 'Long content is not scrollable');
                expect(before.top === after.top, 'Close button scrolls out of view');
                expect(after.top >= 0 && after.bottom <= ${height} && after.left >= 0 && after.right <= ${width}, 'Close button outside viewport');
                expect(content.scrollWidth <= content.clientWidth, 'Long value causes horizontal overflow');
                expect(win.getComputedStyle(panel).zIndex > 95, 'Inspector below TOC');
                const shortcuts = [
                    ['ArrowLeft', 'ArrowLeft', {}, 'left'],
                    ['ArrowRight', 'ArrowRight', {}, 'right'],
                    ['ArrowLeft', 'ArrowLeft', { shiftKey: true }, 'section-left'],
                    ['ArrowRight', 'ArrowRight', { shiftKey: true }, 'section-right'],
                    ['ArrowLeft', 'ArrowLeft', { ctrlKey: true }, 'end'],
                    ['ArrowRight', 'ArrowRight', { ctrlKey: true }, 'start'],
                    ['Comma', '<', { shiftKey: true }, 'end'],
                    ['Period', '>', { shiftKey: true }, 'start'],
                    ['ArrowLeft', 'ArrowLeft', { repeat: true }, 'left'],
                    ...${literal(name === 'EPUB' ? [
                        ['ArrowDown', 'ArrowDown', {}, 'next'], ['ArrowUp', 'ArrowUp', {}, 'previous'],
                        ['Space', ' ', {}, 'next'], ['Home', 'Home', {}, 'start'],
                        ['End', 'End', {}, 'end'], ['KeyF', 'f', {}, 'fullscreen']
                    ] : [
                        ['ArrowDown', 'ArrowDown', {}, 'left'], ['ArrowUp', 'ArrowUp', {}, 'right'],
                        ['Space', ' ', {}, 'quick-spread'], ['Digit1', '1', {}, 'single'],
                        ['Digit2', '2', {}, 'spread'], ['Numpad1', '1', {}, 'single'],
                        ['Numpad2', '2', {}, 'spread']
                    ])}
                ];
                for (const target of [close, content, panel]) {
                    for (const [code, key, options, action] of shortcuts) {
                        const moves = win.pageMoves;
                        const event = new win.KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...options });
                        target.dispatchEvent(event);
                        expect(win.pageMoves === moves + 1 && win.shortcutActions.pop() === action, code + ' was blocked or executed twice');
                        expect(event.defaultPrevented, code + ' also triggers native scrolling or button activation');
                        expect(panel.open, code + ' closed the inspector');
                    }
                }
                const moves = win.pageMoves;
                for (const options of [{ isComposing: true }, { keyCode: 229 }, { metaKey: true }, { altKey: true }]) {
                    for (const [code, key] of [['ArrowLeft', 'ArrowLeft'], ['KeyI', 'i'], ['Space', ' ']]) {
                        const event = new win.KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...options });
                        close.dispatchEvent(event);
                        expect(!event.defaultPrevented && win.pageMoves === moves && panel.open, 'IME/browser shortcut triggered reading action');
                    }
                }
                for (const [code, key, options] of [
                    ['Tab', 'Tab', {}], ['Tab', 'Tab', { shiftKey: true }], ['Enter', 'Enter', {}],
                    ['KeyC', 'c', { ctrlKey: true }], ['KeyC', 'c', { metaKey: true }],
                    ['KeyI', 'i', { ctrlKey: true }]
                ]) {
                    const event = new win.KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true, ...options });
                    close.dispatchEvent(event);
                    expect(!event.defaultPrevented && win.pageMoves === moves && panel.open, 'Native keyboard action was intercepted');
                }
                for (const [code, key, target] of [
                    ['Delete', 'Delete', close], ['Backspace', 'Backspace', content], ['', 'Delete', close]
                ]) {
                    const exits = win.backCalls;
                    const event = new win.KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true });
                    target.dispatchEvent(event);
                    expect(event.defaultPrevented && win.backCalls === exits + 1, 'Inspector exit was blocked or called twice');
                }
                const exits = win.backCalls;
                const held = new win.KeyboardEvent('keydown', { code: 'Delete', key: 'Delete', repeat: true, bubbles: true, cancelable: true });
                close.dispatchEvent(held);
                expect(held.defaultPrevented && win.backCalls === exits, 'Held Delete repeated exit');
                for (const options of [
                    { isComposing: true }, { keyCode: 229 }, { ctrlKey: true },
                    { metaKey: true }, { altKey: true }, { shiftKey: true }
                ]) {
                    const event = new win.KeyboardEvent('keydown', { code: 'Delete', key: 'Delete', bubbles: true, cancelable: true, ...options });
                    close.dispatchEvent(event);
                    expect(!event.defaultPrevented && win.backCalls === exits, 'Editing/browser shortcut triggered exit');
                }
                for (const tag of ['input', 'textarea', 'select', 'div']) {
                    const editor = doc.createElement(tag);
                    let target = editor;
                    if (tag === 'div') {
                        editor.contentEditable = 'true';
                        target = doc.createElement('span');
                        editor.append(target);
                    }
                    content.append(editor);
                    for (const [code, key] of [
                        ['Delete', 'Delete'], ['Backspace', 'Backspace'], ['ArrowLeft', 'ArrowLeft'],
                        ['Space', ' '], ['KeyI', 'i'], ['Digit1', '1'], ['Escape', 'Escape']
                    ]) {
                        const event = new win.KeyboardEvent('keydown', { code, key, bubbles: true, cancelable: true });
                        target.dispatchEvent(event);
                        expect(!event.defaultPrevented && win.backCalls === exits && win.pageMoves === moves && panel.open, 'Text editing triggered a reader shortcut');
                    }
                    editor.remove();
                }
                const cancelled = new win.KeyboardEvent('keydown', { code: 'Delete', key: 'Delete', bubbles: true, cancelable: true });
                cancelled.preventDefault();
                close.dispatchEvent(cancelled);
                expect(win.backCalls === exits, 'Cancelled key triggered exit');
                if (${modal}) {
                    doc.getElementById('reader').focus();
                    expect(doc.activeElement !== doc.getElementById('reader'), 'Focus escapes modal');
                }
                close.click();
                expect(!panel.open, 'Close button did not close');
                expect(menu.style.display === 'block' && menu.scrollTop === 80, 'TOC state was not restored');
                expect(doc.activeElement === toggle, 'Focus did not return to TOC button');
                expect(toggle.getAttribute('aria-pressed') === 'false', 'Toggle stays selected');
                win.openInspector();
                close.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true, cancelable: true }));
                expect(!panel.open && menu.style.display === 'block', 'Escape did not restore TOC');
                expect(win.menuToggles === 0, 'Escape also toggles menu');
                menu.style.display = 'none';
                doc.getElementById('reader').focus();
                win.openInspector();
                panel.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'KeyI', key: 'i', bubbles: true, cancelable: true }));
                expect(!panel.open && menu.style.display === 'none', 'Direct open unexpectedly restores TOC');
                win.openInspector(); close.click(); win.openInspector();
                expect(panel.open, 'Rapid reopening failed');
                close.click();
            `);
        });
    }
}

test('EPUB diagnostics remain English and preserve original metadata during refresh', { skip: !chrome }, async () => {
    await runBrowserFixture(`
        ${helper}
        ${epubCode}
        openInspector();
        const content = document.getElementById('inspector-content');
        const text = content.textContent;
        expect(text.includes('Title: <img src=x onerror=alert(1)>日本語の書名'), 'Metadata changed');
        expect(!content.querySelector('img'), 'Metadata was interpreted as HTML');
        expect(text.includes('Author: 著者名'), 'Author was translated');
        expect(normalizeMetadataValue([null, { name: '著者名' }], 'Unknown') === '著者名', 'Array metadata not preserved');
        expect(normalizeMetadataValue([], 'Unknown') === 'Unknown', 'Missing metadata not English');
        expect(text.includes('Direction: Right-to-Left'), 'Direction not English');
        expect(text.includes('Writing: Vertical'), 'Writing mode not English');
        expect(text.includes('Override: auto / vertical'), 'Override not English');
        expect(text.includes('Last Saved: 2023-11-14T22:13:20.000Z'), 'Date not stable UTC');
        refreshInspector(new Error('元のエラー文'));
        expect(content.textContent.includes('Failed to load EPUB: 元のエラー文'), 'Original error lost');
        expect(document.getElementById('inspector-close'), 'Refresh removed close button');
        document.getElementById('inspector-close').click();
    `, `<style>${css}</style><button id="reader">Reader</button><div id="epub-menu-panel" style="display:block"><button id="inspectorToggleButton">Inspector</button></div>${markup}`);
});

for (const [name, menuId, code] of [['CBZ', 'contents', imageCode], ['EPUB', 'epub-menu-panel', epubCode]]) {
    test(`${name} preserves inspector content and scroll during rotation and text enlargement`, { skip: !chrome }, async () => {
        await runRealtimeFixture(`
            const run = async () => {
                const frame = document.createElement('iframe');
                frame.style.cssText = 'width:1000px;height:800px;border:0';
                document.body.append(frame);
                const doc = frame.contentDocument;
                doc.open(); doc.write(${literal(`<style>${css}</style><button id="reader">Reader</button><div id="${menuId}" style="display:block"><button id="inspectorToggleButton">Inspector</button></div>${markup}`)}); doc.close();
                const win = frame.contentWindow;
                win.eval(${literal(helper + '\n' + code)});
                doc.getElementById('inspectorToggleButton').focus();
                win.openInspector();
                const panel = doc.getElementById('inspector');
                const content = doc.getElementById('inspector-content');
                const close = doc.getElementById('inspector-close');
                content.append(doc.createTextNode('Diagnostic '.repeat(2000)));
                content.scrollTop = 120;
                const text = content.textContent;
                frame.style.width = '320px'; frame.style.height = '568px';
                doc.body.style.fontSize = '32px';
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                expect(panel.matches(':modal'), 'Rotation did not switch to modal');
                expect(content.scrollTop === 120 && content.textContent === text, 'Rotation changed content or scroll');
                expect(doc.activeElement === close, 'Rotation lost close-button focus');
                const rect = close.getBoundingClientRect();
                expect(rect.top >= 0 && rect.bottom <= 568 && rect.right <= 320, 'Enlarged text hides close button');
                frame.style.width = '1000px'; frame.style.height = '800px';
                await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                expect(panel.open && !panel.matches(':modal'), 'Rotation back did not restore nonmodal panel');
                expect(content.scrollTop === 120 && content.textContent === text, 'Rotation back reset content');
                close.click();
                expect(doc.getElementById('${menuId}').style.display === 'block', 'Rotation lost TOC return state');
            };
            run().then(() => { window.__progressNativeResult = { ok: true }; }).catch(error => {
                window.__progressNativeResult = { ok: false, error: error.stack };
            });
        `);
    });
}


test('real image transfers update the inspector without counting cache, probes or response wait', { skip: !chrome }, async () => {
    const counts = new Map();
    let revalidations = 0;
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><!--' +
        'x'.repeat(65536) + '--><rect width="32" height="32" fill="blue"/></svg>');
    const precacheCode = section(imageSource, 'class PreCache', 'var preCaches =');
    const realImageCode = imageCode.replace(
        "const preCaches = { getSize: () => 5, getNetworkSpeed: () => ({ kbps: 1500, stale: false }), getStatus: () => 'empty' };",
        "const size = 'FULL';" + precacheCode + "const preCaches = new PreCache(5);"
    );
    const probeCode = section(imageSource, 'async function load_image(', 'function changeAutoLightSplitMode(');
    const server = http.createServer((request, response) => {
        const url = new URL(request.url, 'http://localhost');
        if (url.pathname.endsWith('.svg')) {
            counts.set(request.url, (counts.get(request.url) || 0) + 1);
            const cache = url.pathname === '/cache.svg';
            const validate = url.pathname === '/validated.svg';
            if (validate && request.headers['if-none-match'] === '"test-image"') {
                revalidations++;
                response.writeHead(304, { 'Cache-Control': 'no-cache', ETag: '"test-image"' });
                response.end();
                return;
            }
            setTimeout(() => {
                response.writeHead(url.pathname === '/error.svg' ? 500 : 200, {
                    'Content-Type': 'image/svg+xml',
                    'Cache-Control': cache ? 'max-age=3600' : validate ? 'no-cache' : 'no-store',
                    ETag: '"test-image"'
                });
                response.write(svg.subarray(0, 16384));
                let offset = 16384;
                const timer = setInterval(() => {
                    if (offset >= svg.length) { clearInterval(timer); response.end(); return; }
                    response.write(svg.subarray(offset, offset + 16384));
                    offset += 16384;
                }, 40);
                response.on('close', () => clearInterval(timer));
            }, 250);
            return;
        }
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        if (url.pathname === '/revalidation') {
            response.end(`<!doctype html><script>
                const size = 'FULL', averagePageKBytes = 800;
                function debugLog() {}
                ${precacheCode}
                const cache = new PreCache(5);
                cache.add('/validated.svg').then(() => setTimeout(() => {
                    window.revalidationResult = {
                        samples: cache.transferMeter.samples.length,
                        entry: performance.getEntriesByType('resource').find(entry => entry.name.endsWith('/validated.svg'))?.toJSON()
                    };
                }, 100));
            </script>`);
            return;
        }
        response.end(`<!doctype html><meta charset="utf-8"><style>${css}</style>
            <button id="reader">Reader</button><div id="contents"></div>${markup}<script>
            function expect(value, message) { if (!value) throw new Error(message); }
            ${helper}
            ${realImageCode}
            ${probeCode}
            const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
            async function waitFor(predicate, message) {
                const deadline = performance.now() + 4000;
                while (!predicate()) { if (performance.now() > deadline) throw new Error(message); await pause(20); }
            }
            (async () => {
                expect(preCaches.getBps() === null, 'Speed known before any traffic');
                // 通常バッファが満杯でもObserverから継続して受け取れることを確認するルン。
                performance.setResourceTimingBufferSize(1);
                await preCaches.add('/first.svg');
                await preCaches.add('/second.svg');
                await waitFor(() => preCaches.getBps() > 0, 'Closed inspector did not collect timing');
                expect(!imageInspectorUI, 'Collection opened the inspector');
                const meter = preCaches.transferMeter;
                expect(meter.samples.length === 2, 'Sequential samples missing');
                for (const sample of meter.samples) {
                    expect(sample.bytes === ${svg.length}, 'encodedBodySize did not equal actual chunked response size');
                    const entry = sample.request.entry;
                    expect(entry.responseStart - entry.requestStart >= 200, 'Server wait fixture failed');
                    expect(entry.responseEnd - sample.start < 240, 'Receive time included server wait');
                    expect(entry.transferSize === sample.bytes + 300, 'Unexpected transferSize');
                }
                openInspector();
                const row = document.getElementById('inspector-network-speed');
                const content = document.getElementById('inspector-content');
                expect(row.textContent.includes('kbps'), 'Opening did not show collected speed');
                const list = row.parentElement;
                const extra = document.createElement('div'); extra.style.height = '1200px'; content.append(extra);
                content.scrollTop = 100;
                await Promise.all([preCaches.add('/parallel-a.svg'), preCaches.add('/parallel-b.svg')]);
                await waitFor(() => meter.samples.length === 4, 'Parallel samples missing');
                const parallel = meter.samples.slice(-2);
                expect(Math.max(...parallel.map(s => s.start)) < Math.min(...parallel.map(s => s.end)), 'Receives did not overlap');
                let end = 0, duration = 0;
                for (const sample of [...meter.samples].sort((a, b) => a.start - b.start)) {
                    duration += Math.max(0, sample.end - Math.max(end, sample.start));
                    end = Math.max(end, sample.end);
                }
                const expected = Math.floor(4 * ${svg.length} * 8 / duration);
                expect(preCaches.getBps() === expected, 'Parallel union speed is incorrect');
                expect(row.textContent === 'Network Speed: ' + expected.toLocaleString('en-US') + ' kbps', 'Open row did not update');
                expect(row.parentElement === list && content.scrollTop === 100, 'Live update rebuilt content or moved scroll');
                await preCaches.add('/cache.svg');
                await waitFor(() => meter.samples.length === 5, 'Initial cacheable transfer missing');
                preCaches.imageCache.delete('/cache.svg');
                await preCaches.add('/cache.svg');
                await pause(100);
                expect(meter.samples.length === 5, 'Cached Image reused old timing');
                await Promise.all([preCaches.add('/probe.svg'), load_image('/probe.svg')]);
                await preCaches.add('/error.svg');
                await pause(100);
                expect(meter.samples.length === 5, 'Probe coalescing or HTTP error counted');
                await preCaches.add('/validated.svg');
                await waitFor(() => meter.samples.length === 6, 'Initial validated response missing');
                const frame = document.createElement('iframe'); frame.src = '/revalidation'; document.body.append(frame);
                await waitFor(() => frame.contentWindow.revalidationResult, 'Revalidation fixture did not finish');
                const result = frame.contentWindow.revalidationResult;
                expect(result.entry?.transferSize === 300, 'Browser did not perform 304 revalidation');
                expect(result.samples === 0, '304 response became a speed sample');
                frame.remove();
                document.getElementById('inspector-close').click();
                await preCaches.add('/closed.svg');
                await waitFor(() => meter.samples.length === 7, 'Closing inspector stopped collection');
                expect(content.childElementCount === 0, 'Collection updated closed content');
                openInspector();
                expect(document.getElementById('inspector-network-speed').textContent.includes('kbps'), 'Reopen lost measurements');
                const latestEnd = meter.samples.at(-1).end;
                const latestText = document.getElementById('inspector-network-speed').textContent;
                await pause(Math.max(0, latestEnd + 30050 - performance.now()));
                expect(preCaches.getBps() === null, 'Old speed did not expire');
                expect(document.getElementById('inspector-network-speed').textContent === latestText + ' (last measurement)', 'Expiry lost final measurement');
                document.getElementById('inspector-close').click();
                openInspector();
                expect(document.getElementById('inspector-network-speed').textContent === latestText + ' (last measurement)', 'Reopening lost final measurement');
                await preCaches.add('/resumed-a.svg');
                await pause(100);
                expect(document.getElementById('inspector-network-speed').textContent === latestText + ' (last measurement)', 'Insufficient new samples replaced final measurement');
                await preCaches.add('/resumed-b.svg');
                await waitFor(() => !preCaches.getNetworkSpeed().stale, 'Fresh measurement did not replace retained result');
                expect(document.getElementById('inspector-network-speed').textContent ===
                    'Network Speed: ' + preCaches.getBps().toLocaleString('en-US') + ' kbps', 'Resumed measurement not displayed');
                window.__progressNativeResult = { ok: true };
            })().catch(error => { window.__progressNativeResult = { ok: false, error: error.stack }; });
        </script>`);
    });
    try {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        await runEpubBrowserFixture('http://127.0.0.1:' + server.address().port, { timeoutMs: 45000 });
        assert.equal(counts.get('/cache.svg'), 1);
        assert.equal(counts.get('/probe.svg'), 1);
        assert.equal(revalidations, 1);
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});
