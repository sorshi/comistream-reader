const test = require('node:test');
const fs = require('node:fs');
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
    const page = 3, maxPage = 25, imagex = 1200, imagey = 1800;
    const archiveFileMBytes = 20, averagePageKBytes = 800;
    const preCaches = { getSize: () => 5, getBps: () => 1500 };
    function isZoomed() { return false; }
    function debugLog() {}
    function closeQuickSpread() {}
    function quickSpredView() { window.pageMoves++; }
    function leftward() { window.pageMoves++; }
    function rightward() { window.pageMoves++; }
    function leftIndex() { window.pageMoves++; }
    function rightIndex() { window.pageMoves++; }
    function index() { window.menuToggles++; }
    ${section(imageSource, 'let imageInspectorUI =', 'function getFullImageUrl(')}
    ${section(imageSource, 'function funcKey(', 'function toggleRaw(')}
    window.openInspector = () => showInspector(true);
    window.readerKeydown = funcKey;
`;
const epubCode = `
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
    function goPhysicalLeft() { window.pageMoves++; }
    function goPhysicalRight() { window.pageMoves++; }
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
                win.pageMoves = 0; win.menuToggles = 0;
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
                panel.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'ArrowRight', key: 'ArrowRight', bubbles: true }));
                panel.dispatchEvent(new win.KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }));
                expect(win.pageMoves === 0, 'Inspector keys trigger reading actions');
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
