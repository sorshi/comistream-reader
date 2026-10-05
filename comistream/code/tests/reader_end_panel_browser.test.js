const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chrome, runBrowserFixture } = require('./browser_fixture');
const css = fs.readFileSync(require.resolve('../comistream.css'), 'utf8');
const source = fs.readFileSync(require.resolve('../comistream.js'), 'utf8');
const code = source.slice(source.indexOf('let suggestRestoreFocus ='), source.indexOf('async function next()'));
const keys = source.slice(source.indexOf('function funcKey('), source.indexOf('function toggleRaw('));
const gestures = source.slice(source.indexOf('window.addEventListener(\n  "touchstart"'), source.indexOf('window.addEventListener(\n  "gesturechange"'));
const panels = chrome ? JSON.parse(execFileSync('php', [path.join(__dirname, 'reader_end_panel.test.php'), '--fixture-json'], { encoding: 'utf8' })) : null;

test('generated CBZ and EPUB panels share geometry, labels and link styles, including narrow screens', { skip: !chrome }, async () => {
    await runBrowserFixture(`
        const cbz = document.getElementById('suggest');
        const epub = document.getElementById('epub-end-panel');
        document.getElementById('epub-end-book-title').textContent = 'Book.cbz';
        for (const id of ['suggest-books', 'epub-end-books']) {
            const list = document.getElementById(id);
            const row = document.createElement('p'), icon = document.createElement('img'), link = document.createElement('a');
            icon.alt = ''; link.href = '#next'; link.textContent = 'Next volume'; row.append(icon,link);
            list.append(row); list.hidden = false;
        }
        const values = panel => {
            const style = getComputedStyle(panel), rect = panel.getBoundingClientRect();
            const heading = getComputedStyle(panel.querySelector('h2'));
            const button = getComputedStyle(panel.querySelector('button'));
            const actions = getComputedStyle(panel.querySelector('.reader-end-actions'));
            const link = getComputedStyle(panel.querySelector('a'));
            const icon = getComputedStyle(panel.querySelector('img'));
            return JSON.stringify([rect.width, rect.height, rect.left, rect.top, style.padding, style.borderRadius,
                style.backgroundColor, style.color, style.maxHeight, heading.fontSize, heading.margin,
                button.minHeight, button.cssFloat, actions.gap, link.color, link.textDecoration, icon.width, icon.height,
                [...panel.querySelectorAll('button')].map(item => item.textContent)]);
        };
        for (const width of [280,320,390,768,1280]) {
            cbz.style.width = epub.style.width = width + 'px';
            cbz.showModal(); const cbzStyle = values(cbz); cbz.close();
            epub.showModal(); const epubStyle = values(epub); epub.close();
            expect(cbzStyle === epubStyle, 'Panel geometry or controls differ at width ' + width);
        }
    `, `<style>${css}</style>${panels?.cbz || ''}${panels?.epub || ''}`);
});

test('CBZ body return, list exit, Escape and backdrop close remain distinct and panel input does not reach reading shortcuts', { skip: !chrome }, async () => {
    await runBrowserFixture(`
        window.testDone = false;
        window.addEventListener('error', () => { window.testFailed = true; });
        let exits = 0;
        function backListPage() { exits++; }
        function closeQuickSpread() {}
        const matchMedia = window.matchMedia;
        window.matchMedia = () => ({ matches:true });
        ${code}
        ${keys}
        ${gestures}
        window.hideSuggestPanel = hideSuggestPanel;
        window.backListPage = backListPage;
        window.addEventListener('keydown', funcKey);
        (async () => {
            try {
                const panel = document.getElementById('suggest');
                const origin = document.getElementById('origin');
                origin.focus(); showSuggestPanel(); showSuggestPanel();
                expect(panel.matches(':modal') && document.activeElement.id === 'suggest-return', 'CBZ modal or initial focus is incorrect');
                for (const code of ['ArrowDown','Space','Escape']) {
                    const event = new KeyboardEvent('keydown', { code, bubbles:true, cancelable:true });
                    document.getElementById('suggest-return').dispatchEvent(event);
                    expect(!event.defaultPrevented, 'Reader intercepted dialog keys');
                }
                for (const type of ['touchstart','touchmove','touchend']) {
                    const event = new Event(type, { bubbles:true, cancelable:true });
                    document.getElementById('suggest-book-title').dispatchEvent(event);
                    expect(!event.defaultPrevented, 'Reader intercepted panel touch events');
                }
                document.getElementById('suggest-return').click();
                await new Promise(resolve => setTimeout(resolve,0));
                expect(!panel.open && exits === 0 && document.activeElement === origin, 'Body return left the reader or lost focus');
                showSuggestPanel(); document.getElementById('suggest-back').click();
                expect(exits === 1, 'List exit did not use its own callback');
                panel.dispatchEvent(new Event('cancel', {cancelable:true}));
                await new Promise(resolve => setTimeout(resolve,0));
                expect(!panel.open && exits === 1, 'Escape left the reader');
                showSuggestPanel();
                panel.dispatchEvent(new PointerEvent('pointerdown', {clientX:0,clientY:0}));
                panel.dispatchEvent(new MouseEvent('click', {clientX:0,clientY:0}));
                await new Promise(resolve => setTimeout(resolve,0));
                expect(!panel.open && exits === 1, 'Backdrop did not return to reading');
                window.matchMedia = matchMedia;
            } catch (error) { window.testFailed = true; document.getElementById('result').textContent = error.stack; }
            window.testDone = true;
        })();
    `, `<style>${css}</style><button id="origin">Reader</button>${panels?.cbz || ''}`);
});
