const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { chrome } = require('./browser_fixture');
const { runEpubBrowserFixture } = require('./epub_browser_fixture');

const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const isolation = source.slice(source.indexOf('function configurePaginatedSectionIsolation('),
    source.indexOf('function isValidThemeName('));
const moduleBase = source.match(/const FOLIATE_MODULE_BASE = '([^']+)'/)[1];

async function checkSectionPadding() {
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const expect = (value, message) => { if (!value) throw new Error(message); };
    // 採用中の実描画で章末・章間移動・再分割を確認するルン。
    for (const { count, single = false, animated = false } of [
        { count: 19 }, { count: 20 }, { count: 19, single: true },
        { count: 1 }, { count: 3 }, { count: 19, animated: true }
    ]) {
        const label = JSON.stringify({ count, single, animated });
        const paginator = new Paginator();
        paginator.style.cssText = 'position:fixed;left:0;top:0;width:834px;height:1080px';
        const doubleInlineSize = '700';
        for (const [name, value] of Object.entries({
            flow: 'paginated', gap: '0', 'margin-top': '0', 'margin-right': '0',
            'margin-bottom': '0', 'margin-left': '0', 'max-block-size': '2000',
            'max-inline-size': single ? '2000' : doubleInlineSize,
            'max-column-count': '1', 'no-preload': ''
        })) paginator.setAttribute(name, value);
        if (animated) paginator.setAttribute('animated', '');
        configurePaginatedSectionIsolation(paginator, false, 'paginated');
        document.body.append(paginator);
        const makeSection = (id, length) => {
            const markup = `<!doctype html><meta charset="utf-8"><style>
                body { writing-mode: vertical-rl; font: 20px/1.8 serif; }
                p { margin: 0; break-before: column; } p:first-child { break-before: auto; }
                </style><body>${Array.from({ length }, (_, i) => `<p>${id}-${i + 1} 本文</p>`).join('')}</body>`;
            return URL.createObjectURL(new Blob([markup], { type: 'text/html' }));
        };
        const urls = [makeSection('A', count), makeSection('B', 3)];
        let location;
        paginator.addEventListener('relocate', ({ detail }) => { location = detail; });
        paginator.open({ dir: 'rtl',
            sections: urls.map((url, index) => ({ id: String(index), linear: 'yes', load: async () => url })) });
        try {
            await paginator.goTo({ index: 0, anchor: 0 });
            await delay(300);
            const columns = single ? 1 : 2;
            expect(paginator.columnCount === columns, `Column count: ${label}`);
            const lastStart = Math.floor((count - 1) / columns) * columns;
            const previousStart = Math.max(0, lastStart - columns);
            await paginator.goTo({ index: 0, anchor: count > 1 ? previousStart / (count - 1) : 0 });
            await delay(300);
            const before = { page: paginator.page, size: paginator.size, viewSize: paginator.viewSize,
                position: paginator.containerPosition, fraction: location.fraction, text: location.range.toString() };
            if (lastStart > previousStart) await paginator.next();
            const expectedText = Array.from({ length: count - lastStart }, (_, i) => `A-${lastStart + i + 1} 本文`).join('');
            expect(location.range.toString() === expectedText, `Last screen repeats text: ${label}: ${JSON.stringify(before)}: ${location.range}`);
            expect(Math.abs(Math.abs(paginator.containerPosition) - lastStart / columns * paginator.size) < 1,
                `Last screen is not aligned: ${label}`);
            expect(Math.abs(location.fraction - lastStart / count) < 0.0001, `Last fraction: ${label}: ${JSON.stringify(before)}: ${location.fraction}`);
            await paginator.next();
            await delay(300);
            const nextText = single ? 'B-1 本文' : 'B-1 本文B-2 本文';
            expect(location.index === 1 && location.range.toString() === nextText,
                `Next section did not start at its first screen: ${label}: ${location.index}: ${location.range}`);
            await paginator.prev();
            await delay(300);
            expect(location.index === 0 && location.range.toString() === expectedText,
                `Backward section entry: ${label}: ${location.index}: ${location.range}: ${paginator.containerPosition}/${paginator.size}/${paginator.viewSize}`);
            if (lastStart > previousStart) {
                await paginator.prev();
                const expectedPrevious = Array.from({ length: columns }, (_, i) => `A-${previousStart + i + 1} 本文`).join('');
                expect(location.range.toString() === expectedPrevious, `Backward page turn: ${label}`);
            }
            if (single || count !== 19 || animated) continue;
            // スクロール表示へ切り替えたら補助余白を外すルン。
            configurePaginatedSectionIsolation(paginator, false, 'scrolled');
            paginator.setAttribute('flow', 'scrolled');
            void paginator.size;
            const container = paginator.shadowRoot.getElementById('container');
            const sectionStyle = getComputedStyle(container.firstElementChild);
            expect(['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']
                .every(side => parseFloat(sectionStyle[side]) === 0),
                `Padding remains in scrolled mode: ${label}`);
            configurePaginatedSectionIsolation(paginator, false, 'paginated');
            paginator.setAttribute('flow', 'paginated');
            paginator.setAttribute('max-inline-size', '2000');
            await delay(300);
            await paginator.goTo({ index: 0, anchor: 1 });
            await delay(300);
            expect(paginator.columnCount === 1 && location.range.toString() === `A-${count} 本文`,
                `Single-column reflow: ${label}: ${paginator.columnCount}: ${location.range}`);
            paginator.setAttribute('max-inline-size', doubleInlineSize);
            await delay(300);
            await paginator.goTo({ index: 0, anchor: 1 });
            await delay(300);
            const doubleStart = Math.floor((count - 1) / 2) * 2;
            const doubleText = Array.from({ length: count - doubleStart }, (_, i) => `A-${doubleStart + i + 1} 本文`).join('');
            expect(location.range.toString() === doubleText, `Two-column reflow: ${label}`);
        } finally {
            paginator.destroy();
            paginator.remove();
            urls.forEach(url => URL.revokeObjectURL(url));
        }
    }
}

test('isolated EPUB sections keep the last screen aligned without repeating a column', {
    skip: !chrome || process.env.COMISTREAM_EPUB_BROWSER_TESTS !== '1'
}, async () => {
    // ローカルの固定版も指定できるので、CDNに接続できない環境でも再現できるルン。
    const localModule = process.env.COMISTREAM_FOLIATE_PAGINATOR;
    let moduleSource;
    if (localModule) moduleSource = fs.readFileSync(localModule, 'utf8');
    else {
        const response = await fetch(moduleBase + 'paginator.js');
        assert.ok(response.ok, `Foliate download failed: ${response.status}`);
        moduleSource = await response.text();
    }
    const html = `<!doctype html><meta charset="utf-8"><script type="module">
        import { Paginator } from '/paginator.js';
        const sectionIsolationRenderers = new WeakSet();
        ${isolation}
        (${checkSectionPadding.toString()})().then(() => {
            window.__progressNativeResult = { ok: true };
        }).catch(error => { window.__progressNativeResult = { ok: false, error: error.stack }; });
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
