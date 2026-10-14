const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { chrome } = require('./browser_fixture');
const { runEpubBrowserFixture } = require('./epub_browser_fixture');

const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const fontCode = source.slice(source.indexOf('function parseReaderFontLocale('), source.indexOf('function collectReaderDashRanges('));
const fontPath = '/theme/fonts/kana-repeat/ComistreamKanaRepeat-v2.ttf';
const font = fs.readFileSync(require.resolve('../../theme/fonts/kana-repeat/ComistreamKanaRepeat-v2.ttf'));
const referenceFontPath = '/theme/fonts/kana-repeat/ComistreamKanaRepeat-v1.ttf';
const referenceFont = fs.readFileSync(require.resolve('../../theme/fonts/kana-repeat/ComistreamKanaRepeat-v1.ttf'));

async function checkKanaRepeat() {
    const expect = (condition, message) => { if (!condition) throw Error(message); };
    const settle = async doc => {
        void doc.body.offsetHeight;
        await doc.fonts.ready;
        await new Promise(resolve => setTimeout(resolve, 100));
    };
    const requests = async () => (await (await fetch('/requests')).json()).count;
    const rect = (doc, node, start, end) => {
        const range = doc.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        return range.getBoundingClientRect();
    };
    for (const packetSave of [true, false]) {
        appConfig.packetSave = packetSave;
        // 外部Google FontsをCSPで止め、実際のblob章と自サーバー配信を検証するルン。
        const url = URL.createObjectURL(new Blob([`<!doctype html><html lang="ja"><head>
            <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'">
            <style>
            html { writing-mode:vertical-rl; font-size:24px; }
            body { font-family:"${packetSave ? 'Hiragino Mincho ProN' : 'BIZ UDMincho'}", serif !important; }
            @media all { .nested { font:700 24px/1.8 "Hiragino Mincho ProN", serif; } }
            @font-face { font-family:Publisher; src:local("Hiragino Mincho ProN"); }
            .publisher { font-family:Publisher, serif; }
            .variable { --book-font:"Hiragino Mincho ProN"; font-family:var(--book-font); }
            </style></head><body><p id="plain">通常の文章、星・月。</p>
            <p id="ruby">通常の<ruby>漢字<rt>かんじ</rt></ruby>と<ruby>東京<rt>とうきょう</rt></ruby>。</p>
            <p id="pair" style="inline-size:4em;line-break:strict">あああ〳〵文、あああ〴〵文。</p>
            <p id="single" class="nested"></p>
            <p id="inline" style="font-family:'Hiragino Mincho ProN',serif"></p>
            <p class="publisher">書籍のフォント</p><p class="variable">変数の書体</p>
            </body></html>`], { type: 'text/html' }));
        const frame = document.createElement('iframe');
        frame.style.cssText = 'width:760px;height:620px;border:0';
        frame.src = url;
        const loaded = new Promise(resolve => { frame.onload = resolve; });
        document.body.append(frame);
        await loaded;
        const doc = frame.contentDocument, win = frame.contentWindow;
        await settle(doc);
        const text = doc.getElementById('plain').firstChild;
        const plainBefore = rect(doc, text, 0, text.length).toJSON();
        const rubyDistance = () => [...doc.querySelectorAll('#ruby ruby')].map(ruby => {
            const base = rect(doc, ruby.firstChild, 0, ruby.firstChild.length);
            const annotation = ruby.querySelector('rt').firstChild;
            const rt = rect(doc, annotation, 0, annotation.length);
            return rt.left + rt.width / 2 - base.left - base.width / 2;
        });
        const rubyBefore = rubyDistance();
        const pairFamily = win.getComputedStyle(doc.getElementById('pair')).fontFamily;
        const originalText = doc.body.textContent;
        applyReaderFontStyles(doc);
        applyReaderFontStyles(doc);
        await settle(doc);
        const face = Array.from(doc.fonts).find(item => item.family.replaceAll('"', '') === 'Comistream Kana Repeat');
        expect(face, 'Supplement font was not registered');
        // WebKitは対象文字がなくても行寸法のために取得するので、重複取得だけを検出するルン。
        expect(await requests() <= 1, 'Supplement was requested more than once');
        expect(doc.body.textContent === originalText && text === doc.getElementById('plain').firstChild, 'Book text was replaced');
        expect(JSON.stringify(plainBefore) === JSON.stringify(rect(doc, text, 0, text.length).toJSON()), 'Ordinary text moved');
        expect(rubyDistance().every((distance, index) => Math.abs(distance - rubyBefore[index]) < 0.1),
            'Supplement increased ruby spacing without repeat marks');
        expect(doc.querySelectorAll('[data-comistream-reader-font]').length === 1, 'Repeated initialization duplicated styles');
        const computed = element => win.getComputedStyle(element);
        expect(computed(doc.querySelector('.publisher')).fontFamily === '"Comistream Kana Repeat", Publisher, serif', 'Publisher family lost');
        expect(computed(doc.querySelector('.variable')).fontFamily === '"Hiragino Mincho ProN"', 'CSS variable changed');
        const single = doc.getElementById('single');
        single.textContent = '一〱一〲一';
        doc.getElementById('inline').textContent = '一〱一〲一';
        const referenceStyle = doc.createElement('style');
        const referenceURL = new URL('/theme/fonts/kana-repeat/ComistreamKanaRepeat-v1.ttf', window.location.href);
        referenceStyle.textContent = `@font-face { font-family: "Kana Reference"; src: url("${referenceURL.href}"); unicode-range: U+3031-3032; }`;
        doc.head.append(referenceStyle);
        const referenceSingle = doc.createElement('p');
        referenceSingle.style.cssText = 'position:absolute;visibility:hidden;font-family:"Kana Reference",serif';
        referenceSingle.textContent = single.textContent;
        const referencePair = doc.createElement('p');
        referencePair.style.cssText = 'position:absolute;visibility:hidden;inline-size:4em;line-break:strict';
        referencePair.style.fontFamily = pairFamily;
        referencePair.textContent = doc.getElementById('pair').textContent;
        doc.body.append(referenceSingle, referencePair);
        await settle(doc);
        expect(face.status === 'loaded', 'Supplement did not load in a blob chapter');
        expect(await requests() === 1, 'Font was not cached across chapters');
        for (const mode of ['vertical-rl', 'vertical-lr']) {
            doc.documentElement.style.writingMode = mode;
            for (const size of [16, 24, 40]) {
                for (const weight of [400, 700]) {
                    for (const element of [single, doc.getElementById('inline'), doc.getElementById('pair'), referenceSingle, referencePair]) {
                        element.style.fontSize = `${size}px`;
                        element.style.fontWeight = weight;
                    }
                    await settle(doc);
                    for (const element of [single, doc.getElementById('inline')]) {
                        const node = element.firstChild;
                        for (const start of [1, 3]) {
                            const mark = rect(doc, node, start, start + 1);
                            const next = rect(doc, node, start + 1, start + 2);
                            const reference = rect(doc, referenceSingle.firstChild, start, start + 1);
                            const referenceNext = rect(doc, referenceSingle.firstChild, start + 1, start + 2);
                            // 合成太字の追加幅も含め、旧字形と同じ字送りかを確認するルン。
                            expect(Math.abs((next.top - mark.top) - (referenceNext.top - reference.top)) < 0.1,
                                `Repeat mark advance changed: ${mode}, ${size}px, ${weight}, ${element.id}`);
                            if (weight === 400) expect(Math.abs(next.top - mark.top - size * 2) < 0.1,
                                'Regular repeat mark is not two cells high');
                        }
                    }
                    const pair = doc.getElementById('pair').firstChild;
                    for (const match of pair.data.matchAll(/[〳〴]〵/g)) {
                        const upper = rect(doc, pair, match.index, match.index + 1);
                        const lower = rect(doc, pair, match.index + 1, match.index + 2);
                        const referenceUpper = rect(doc, referencePair.firstChild, match.index, match.index + 1);
                        const referenceLower = rect(doc, referencePair.firstChild, match.index + 1, match.index + 2);
                        expect(Math.abs(upper.left - lower.left) < 0.1, 'Pair split across columns');
                        expect(Math.abs((lower.top - upper.top) - (referenceLower.top - referenceUpper.top)) < 0.1,
                            'Pair cell advance changed');
                        expect(Math.abs((lower.bottom - upper.top) - (referenceLower.bottom - referenceUpper.top)) < 0.1,
                            'Pair metrics changed');
                    }
                }
            }
        }
        expect(single.textContent === '一〱一〲一', 'Repeat marks were replaced with different codepoints');
        frame.remove();
        URL.revokeObjectURL(url);
    }
    // 固定レイアウトは元の組版を維持するルン。
    view.isFixedLayout = true;
    const fixed = document.createElement('iframe');
    document.body.append(fixed);
    const doc = fixed.contentDocument;
    doc.documentElement.lang = 'ja';
    doc.body.innerHTML = '<p style="font-family:serif">〱〲</p>';
    const before = doc.body.innerHTML;
    applyReaderFontStyles(doc);
    expect(!doc.head.textContent.includes('Comistream Kana Repeat'), 'Fixed layout received supplement');
    expect(doc.body.innerHTML === before, 'Fixed-layout styles changed');
    fixed.remove();
}

test('kana repeat font preserves ruby spacing, joins vertically, and is cached across blob chapters', { skip: !chrome }, async () => {
    let count = 0;
    const html = `<!doctype html><meta charset="utf-8"><script>
        const appConfig = { packetSave:true }, readerFontStyles = new WeakMap();
        const view = { isFixedLayout:false, book:{metadata:{language:['ja']}} };
        ${fontCode}
        window.addEventListener('load', () => (${checkKanaRepeat.toString()})()
            .then(() => window.__progressNativeResult = {ok:true})
            .catch(error => window.__progressNativeResult = {ok:false,error:error.stack}));
        </script>`;
    const server = http.createServer((request, response) => {
        if (request.url === fontPath) {
            count++;
            response.writeHead(200, { 'Content-Type':'font/ttf', 'Cache-Control':'public, max-age=31536000, immutable' });
            response.end(font);
        } else if (request.url === referenceFontPath) {
            response.writeHead(200, { 'Content-Type':'font/ttf', 'Cache-Control':'public, max-age=31536000, immutable' });
            response.end(referenceFont);
        } else if (request.url === '/requests') {
            response.writeHead(200, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
            response.end(JSON.stringify({ count }));
        } else {
            response.setHeader('Content-Type', 'text/html');
            response.end(html);
        }
    });
    try {
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        await runEpubBrowserFixture(`http://127.0.0.1:${server.address().port}/`);
        assert.equal(count, 1);
    } finally { await new Promise(resolve => server.close(resolve)); }
});
