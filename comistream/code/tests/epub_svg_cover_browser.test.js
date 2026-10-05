const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { chrome } = require('./browser_fixture');
const { runEpubBrowserFixture } = require('./epub_browser_fixture');

const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const css = between('function buildReaderCSS(', 'function buildRendererPrefsSignature(');
const marking = between('function hasUsableDocumentBody(', 'function preserveIllustrationInlineStyles(')
    + between('function markImageOnlyPage(', 'function getNodeTextLengthBefore(');

async function checkSvgCovers() {
    const expect = (condition, message) => { if (!condition) throw new Error(message); };
    const frame = document.querySelector('iframe');
    const doc = frame.contentDocument;
    const style = doc.createElement('style');
    style.textContent = buildReaderCSS(1).replace(/^@import .*;$/gm, '');
    doc.head.append(style);
    // 採取したiPadと同じ、段組み・Flexbox・SVG画像の組み合わせを検証するルン。
    for (const flow of ['paginated', 'scrolled']) {
        for (const [artWidth, artHeight] of [[1804, 2560], [2560, 1804]]) {
            const url = URL.createObjectURL(new Blob([
                '<svg xmlns="http://www.w3.org/2000/svg" width="' + artWidth + '" height="' + artHeight
                + '"><rect width="100%" height="100%" fill="red"/></svg>'
            ], { type: 'image/svg+xml' }));
            try {
                const decoded = new Image();
                decoded.src = url;
                await decoded.decode();
                doc.body.innerHTML = '<div style="text-align:center"><svg width="100%" height="100%" viewBox="0 0 '
                    + artWidth + ' ' + artHeight + '"><image width="' + artWidth + '" height="' + artHeight
                    + '" xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="' + url + '"/></svg></div>';
                expect(markImageOnlyPage(doc), 'SVG cover was not marked');
                const svg = doc.querySelector('svg');
                const image = doc.querySelector('image');
                // 同じDOMを回転相当で再配置し、サイズ指定が一度きりにならないことも確認するルン。
                for (const [width, height] of [[834, 980], [1194, 834], [320, 568]]) {
                    const margin = width < 480 ? 24 : 36;
                    const horizontalMargin = width === 834 ? 49.375 : margin;
                    const availableWidth = width - horizontalMargin * 2;
                    const availableHeight = height - margin * 2;
                    const label = JSON.stringify({ flow, width, height, artWidth, artHeight });
                    frame.style.width = width + 'px';
                    frame.style.height = height + 'px';
                    doc.documentElement.style.cssText = 'width:' + width + 'px;height:'
                        + (flow === 'paginated' ? height + 'px' : 'auto')
                        + ';box-sizing:border-box;padding:' + margin + 'px ' + horizontalMargin + 'px;'
                        + (flow === 'paginated' ? 'column-width:' + Math.floor(availableWidth)
                            + 'px;column-gap:' + horizontalMargin * 2 + 'px;column-fill:auto;overflow:hidden;' : '');
                    svg.style.cssText = 'max-height:' + availableHeight
                        + 'px!important;max-width:100%!important;break-inside:avoid!important;box-sizing:border-box!important';
                    const rect = svg.getBoundingClientRect();
                    const art = image.getBoundingClientRect();
                    const parent = svg.parentElement.getBoundingClientRect();
                    expect(rect.width > 0 && rect.height > 0, 'SVG collapsed: ' + label);
                    const scale = Math.min(availableWidth / artWidth, availableHeight / artHeight);
                    expect(Math.abs(art.width - artWidth * scale) < 1 && Math.abs(art.height - artHeight * scale) < 1,
                        'Artwork is not fitted with its aspect ratio: ' + label + ': ' + art.width + 'x' + art.height);
                    expect(art.left >= parent.left - 1 && art.right <= parent.right + 1
                        && art.top >= parent.top - 1 && art.bottom <= parent.bottom + 1, 'Artwork is clipped: ' + label);
                    expect(Math.abs(art.left + art.width / 2 - parent.left - parent.width / 2) < 1
                        && Math.abs(art.top + art.height / 2 - parent.top - parent.height / 2) < 1,
                        'Artwork is not centered: ' + label);
                    expect(svg.getAttribute('viewBox') === '0 0 ' + artWidth + ' ' + artHeight, 'Publisher viewBox changed');
                }
            } finally { URL.revokeObjectURL(url); }
        }
    }
    // 同じSVGでも本文の一部なら出版社の寸法指定を維持するルン。
    doc.documentElement.removeAttribute('data-comistream-image-page');
    doc.body.innerHTML = '<p>Text<svg style="width:24px;height:18px" viewBox="0 0 4 3"><rect width="4" height="3"/></svg></p>';
    expect(!markImageOnlyPage(doc), 'Inline SVG became a cover');
    const inline = doc.querySelector('svg').getBoundingClientRect();
    expect(Math.abs(inline.width - 24) < 0.1 && Math.abs(inline.height - 18) < 0.1, 'Inline SVG dimensions changed');
}

const html = `<!doctype html><meta charset="utf-8"><iframe style="border:0"></iframe><script>
    const currentDirectionOverride = 'auto', currentWritingModeOverride = 'auto';
    const resolveEffectiveReadingMode = () => ({ vertical: false, rtl: false });
    const getEffectiveThemeName = () => 'white';
    const getEffectiveTheme = () => ({ bg: '#fff', color: '#000', colorScheme: 'light' });
    ${css}
    ${marking}
    (${checkSvgCovers.toString()})().then(() => window.__progressNativeResult = { ok: true })
        .catch(error => window.__progressNativeResult = { ok: false, error: error.message + '\\n' + (error.stack || '') });
</script>`;

async function withCoverFixture(run) {
    const server = http.createServer((_, response) => { response.setHeader('Content-Type', 'text/html'); response.end(html); });
    try {
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        await run('http://127.0.0.1:' + server.address().port);
    } finally { await new Promise(resolve => server.close(resolve)); }
}

test('SVG covers fit portrait, landscape and scrolled layouts in Chromium', { skip: !chrome }, async () => {
    await withCoverFixture(runEpubBrowserFixture);
});

// 任意の既存Playwrightを指定すればWebKitでも同じ回帰テストを実行できるルン。
test('SVG covers fit portrait, landscape and scrolled layouts in WebKit', {
    skip: !process.env.COMISTREAM_WEBKIT_PLAYWRIGHT
}, async () => {
    const { webkit } = require(process.env.COMISTREAM_WEBKIT_PLAYWRIGHT);
    const browser = await webkit.launch({ headless: true });
    try {
        await withCoverFixture(async url => {
            const page = await browser.newPage();
            await page.goto(url);
            await page.waitForFunction(() => window.__progressNativeResult);
            const result = await page.evaluate(() => window.__progressNativeResult);
            assert.equal(result.ok, true, result.error);
        });
    } finally { await browser.close(); }
});
