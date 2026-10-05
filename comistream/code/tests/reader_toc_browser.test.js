const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chrome, runBrowserFixture } = require('./browser_fixture');
const css = fs.readFileSync(require.resolve('../comistream.css'), 'utf8');

test('EPUB menu keeps settings compact and chapter touch targets separate in every language', { skip: !chrome }, async () => {
    const pages = JSON.parse(execFileSync('php', ['-r', `
        require_once $argv[1] . '/comistream/code/comistream_lib.php';
        require_once $argv[1] . '/comistream/code/i18n.php';
        $conf = ['comistream_tool_dir' => $argv[1] . '/comistream', 'epub_reader_package_base' => '/theme/bibi/test/'];
        $bookName = $baseFile = $escapedFile = 'Sample.epub';
        $user = 'guest';
        $readerMarkerCsrfToken = '';
        $i18n = I18n::getInstance();
        $pages = [];
        foreach (['ja', 'en', 'zh_TW', 'zh_HK'] as $lang) {
            $i18n->setLang($lang);
            $pages[$lang] = generateEpubHTML();
        }
        echo json_encode($pages);
    `, path.resolve(__dirname, '../../..')], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
    for (const [lang, html] of Object.entries(pages)) {
        const style = html.match(/<style>[\s\S]*?<\/style>/)[0];
        const panel = html.slice(html.indexOf('<div class="contents" id="epub-menu-panel">'), html.indexOf('<dialog id="epub-end-panel"'));
        await runBrowserFixture(`
            const panel = document.getElementById('epub-menu-panel');
            panel.style.cssText = 'display:block;min-width:0;max-width:none';
            document.getElementById('epub-page-position-setting').hidden = false;
            document.getElementById('epub-page-position-info').hidden = false;
            const toc = document.getElementById('epub-toc');
            for (let depth = 0; depth <= 2; depth++) {
                const button = document.createElement('button');
                button.className = 'epub-toc-item epub-toc-depth-' + depth;
                button.textContent = depth === 1 ? '長い章タイトル Long chapter title '.repeat(8) : 'Chapter ' + depth;
                toc.appendChild(button);
            }
            for (const width of [300, 360, 390, 760]) {
                panel.style.width = width + 'px';
                panel.scrollTop = 0;
                expect(panel.scrollWidth <= panel.clientWidth, '${lang}: Menu overflows at ' + width);
                const settings = panel.querySelector('.epub-panel-grid');
                expect(settings.getBoundingClientRect().height < (width < 400 ? 600 : 300), '${lang}: Settings take too much height at ' + width);
                for (const button of settings.querySelectorAll('button')) {
                    const rect = button.getBoundingClientRect();
                    expect(rect.height >= 44, '${lang}: Settings touch target shrank');
                    expect(button.scrollWidth <= button.clientWidth, '${lang}: Setting label is clipped');
                }
                for (const button of toc.children) {
                    button.scrollIntoView({ block: 'center' });
                    const rect = button.getBoundingClientRect();
                    expect(rect.height >= 44, '${lang}: Chapter touch target is too small');
                    expect(button.scrollWidth <= button.clientWidth, '${lang}: Chapter title is clipped');
                    for (const y of [rect.top + 4, rect.bottom - 4]) {
                        expect(document.elementFromPoint(rect.left + rect.width / 2, y) === button, '${lang}: Chapter touch area overlaps another element');
                    }
                }
            }
        `, style + panel);
    }
});

test('EPUB flow labels keep the same toolbar rows at wrapping boundaries', { skip: !chrome }, async () => {
    const template = fs.readFileSync(require.resolve('../lib/lib_view.php'), 'utf8');
    const toolbar = template.match(/<div class="epub-toolbar">[\s\S]*?(?=<div class="epub-panel-section">)/)[0];
    const labels = {
        flowLabel: 'ページ表示', flowPaginatedLabel: 'ページ表示', flowScrolledLabel: 'スクロール表示',
        fullscreenLabel: '通常表示', nextSectionLabel: '次の章', prevSectionLabel: '前の章',
        nextPageLabel: '次のページ', prevPageLabel: '前のページ', langSelectorHtml: '<span>▼</span>'
    };
    const markup = toolbar.replace(/\{\$(\w+)\}/g, (_, key) => labels[key] || 'Help');
    const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
    const start = source.indexOf('function updateToolbarState(');
    const code = source.slice(start, source.indexOf('function applyRendererPrefs(', start));
    await runBrowserFixture(`
        const $ = id => document.getElementById(id);
        const t = key => key === 'epub_flow_scrolled' ? 'スクロール表示' : 'ページ表示';
        const view = { isFixedLayout: false };
        const currentFontScale = 1;
        let currentFlowMode = 'paginated';
        function updatePagePositionSetting() {}
        function updatePageTurnAnimationSetting() {}
        function updateDirectionState() {}
        ${code}
        const panel = document.querySelector('.contents');
        const geometry = () => [...panel.querySelectorAll('button')].map(button => {
            const rect = button.getBoundingClientRect();
            return [rect.x, rect.y, rect.width, rect.height];
        });
        for (let width = 280; width <= 900; width += 2) {
            panel.style.width = width + 'px';
            currentFlowMode = 'paginated';
            updateToolbarState();
            const before = JSON.stringify(geometry());
            currentFlowMode = 'scrolled';
            updateToolbarState();
            expect(before === JSON.stringify(geometry()), 'Flow mode shifts toolbar at width ' + width);
            expect(panel.scrollWidth <= panel.clientWidth, 'Toolbar overflows at width ' + width);
            expect($('epub-flow-toggle').innerText.includes('スクロール表示'), 'Current mode label did not update');
        }
    `, `<style>${css}</style><div class="contents" style="display:block;min-width:0;max-width:none">${markup}</div>`);
});

test('TOC states differ in brightness and marker without moving or replacing tooltips', { skip: !chrome }, async () => {
    await runBrowserFixture(`
        const toggle = document.getElementById('toggle');
        const dimensions = element => {
            const rect = element.getBoundingClientRect();
            return [rect.width, rect.height, rect.top].join(',');
        };
        const off = getComputedStyle(toggle);
        const offBackground = off.backgroundColor;
        const offImage = off.backgroundImage;
        const offSize = dimensions(toggle);
        toggle.setAttribute('aria-pressed', 'true');
        toggle.classList.add('pressed');
        const on = getComputedStyle(toggle);
        expect(on.backgroundColor !== offBackground, 'Background does not identify selection');
        expect(on.backgroundImage !== offImage && on.backgroundImage.includes('path'), 'Selected marker has no check');
        expect(dimensions(toggle) === offSize, 'Selection shifts the button');
        expect(getComputedStyle(toggle, '::after').content.includes('Help text'), 'Selection replaces the tooltip');
        const radio = document.getElementById('radio');
        expect(getComputedStyle(radio).backgroundColor === on.backgroundColor, 'Radio selection differs from toggle selection');
        toggle.focus();
        expect(document.activeElement === toggle, 'Toggle cannot receive focus');
    `, `<style>${css}</style>
        <style>.contents .button.button-mode { transition: none; }</style>
        <div class="contents" style="display:block">
            <button class="button button-mode" id="toggle" aria-pressed="false" data-tooltip="Help text">Animation</button>
            <button class="button button-mode" id="radio" role="radio" aria-checked="true">Paper</button>
        </div>`);
});

test('original-size click keeps its geometry until navigation', { skip: !chrome }, async () => {
    const source = fs.readFileSync(require.resolve('../comistream.js'), 'utf8');
    const start = source.indexOf('function toggleRaw(');
    const rawCode = source.slice(start, source.indexOf('function toggleTrimmingFile(', start));
    await runBrowserFixture(`
        const readerProgressManager = null;
        const navigator = { sendBeacon() {} };
        const escapedFile = 'book';
        const page = 1;
        function debugLog() {}
        window.i18n = { toc_button_compress: 'Compressed', toc_button_full: 'Original size' };
        location.href = 'https://reader.invalid/comistream.php?file=book&size=FULL';
        let destination = '';
        location.replace = url => { destination = url; };
        ${rawCode}
        const button = document.getElementById('rawMode');
        const before = button.getBoundingClientRect();
        const appearance = getComputedStyle(button);
        const beforePadding = appearance.padding;
        button.addEventListener('click', toggleRaw);
        button.click();
        const after = button.getBoundingClientRect();
        expect(after.width === before.width && after.height === before.height, 'Original-size button changes dimensions');
        expect(getComputedStyle(button).padding === beforePadding, 'Original-size button changes padding');
        expect(button.classList.contains('button-mode'), 'Mode styling was removed');
        expect(button.textContent === 'Original size', 'Label changed before navigation');
        expect(destination && !destination.includes('size='), 'Navigation did not use the new preference');
    `, `<style>${css}</style><div class="contents" style="display:block"><div class="toc-buttons">
        <span id="rawMode" class="button button-mode raw">Original size</span>
        </div></div>`);
});

for (const toolbarClass of ['epub-toolbar', 'toc-buttons']) {
    test(`${toolbarClass} keeps the exit at top right, distinct from actions and toggles`, { skip: !chrome }, async () => {
        await runBrowserFixture(`
            const panel = document.querySelector('.contents');
            const header = document.querySelector('.reader-menu-header');
            const back = document.querySelector('.reader-menu-back');
            const dismiss = document.querySelector('.reader-menu-dismiss');
            const action = document.getElementById('action');
            const toggle = document.getElementById('toggle');
            for (const width of [300, 370, 728]) {
                panel.style.width = width + 'px';
                const h = header.getBoundingClientRect();
                const b = back.getBoundingClientRect();
                const d = dismiss.getBoundingClientRect();
                expect(Math.abs(b.right - h.right) < 1, 'Back left the right edge');
                expect(Math.abs(d.left - h.left) < 1, 'Dismiss left the left edge');
                expect(b.top === d.top, 'Header controls wrapped');
                expect(b.height >= 44 && d.height >= 44, 'Header touch targets are too small');
                expect(panel.scrollWidth <= panel.clientWidth, 'Menu overflows horizontally');
            }
            const backColor = getComputedStyle(back).backgroundColor;
            expect(backColor !== getComputedStyle(action).backgroundColor, 'Exit looks like an ordinary action');
            expect(backColor !== getComputedStyle(toggle).backgroundColor, 'Exit looks like a selected toggle');
            panel.scrollTop = 180;
            const p = panel.getBoundingClientRect();
            const b = back.getBoundingClientRect();
            expect(b.top >= p.top && b.bottom <= p.bottom, 'Exit scrolled out of sight');
            back.focus();
            expect(document.activeElement === back, 'Exit is not keyboard accessible');
        `, `<style>${css}</style><div class="contents" style="display:block;min-width:0;box-sizing:border-box;width:300px;height:300px"><div>
            <div class="reader-menu-header">
                <button type="button" class="reader-menu-dismiss" aria-label="Close menu">×</button>
                <button type="button" class="button button-close reader-menu-back">Back</button>
            </div>
            <div class="${toolbarClass}">
                <button type="button" id="action" class="button button-mode">Next</button>
                <button type="button" id="toggle" class="button button-mode" aria-pressed="true">Clock</button>
            </div><div style="height:600px">Contents</div></div></div>`);
    });
}

test('page-position help supports hover, tap, outside dismissal and Escape', { skip: !chrome }, async () => {
    const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
    const start = source.indexOf('function hidePagePositionHelp(');
    const helpCode = source.slice(start, source.indexOf('function updatePagePositionSetting(', start));
    const keyStart = source.indexOf('function handleKeydown(');
    const keyCode = source.slice(keyStart, source.indexOf('function bindKeyboardShortcuts(', keyStart));
    await runBrowserFixture(`
        let menuVisible = true;
        let epubInspectorUI = null;
        let pagePositionHelpPinned = false;
        let pagePositionHelpTimer = null;
        const $ = id => document.getElementById(id);
        ${helpCode}
        ${keyCode}
        bindPagePositionHelp();
        const button = $('epub-page-position-info');
        const help = $('epub-page-position-help');
        expect(help.hidden, 'Help is visible by default');
        button.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'touch' }));
        expect(help.hidden, 'Touch hover opened the help');
        button.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
        expect(!help.hidden, 'Mouse hover did not open help');
        handleKeydown({ key: 'Escape', preventDefault() {} });
        expect(help.hidden && menuVisible, 'Escape closed the menu instead of the help');
        button.click();
        expect(!help.hidden && button.getAttribute('aria-expanded') === 'true', 'Tap did not open help');
        const rect = help.getBoundingClientRect();
        expect(rect.left >= 0 && rect.right <= innerWidth, 'Help exceeds the viewport');
        button.click();
        expect(help.hidden, 'Second tap did not close help');
        button.click();
        document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        expect(help.hidden, 'Outside tap did not close help');
        button.click();
        $('epub-menu-panel').dispatchEvent(new Event('scroll'));
        expect(help.hidden, 'Scrolling left help detached from its anchor');
    `, `<style>${css}</style><div class="contents" id="epub-menu-panel" style="display:block">
        <button type="button" class="reader-help-button" id="epub-page-position-info" aria-expanded="false">i</button>
        <div id="epub-page-position-help" class="reader-help-tooltip" role="tooltip" hidden>ページ位置「3–12」表記は、本の3番目の区切りの12画面目を表します。</div>
        </div>`);
});
