const test = require('node:test');
const fs = require('node:fs');
const http = require('node:http');
const { chrome } = require('./browser_fixture');
const { runEpubBrowserFixture } = require('./epub_browser_fixture');

const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const fontCode = source.slice(source.indexOf('function parseReaderFontLocale('), source.indexOf('function collectReaderDashRanges('));
const referenceFont = fs.readFileSync(require.resolve('../../rsrc/fonts/shippori-mincho/ShipporiMincho-Regular.ttf'));
const kanaFont = fs.readFileSync(require.resolve('../../theme/fonts/kana-repeat/ComistreamKanaRepeat-v2.ttf'));

async function verifyMixedFonts() {
    const expect = (condition, message) => { if (!condition) throw new Error(message); };
    const frame = document.createElement('iframe');
    frame.style.cssText = 'width:1100px;height:900px';
    document.body.append(frame);
    const doc = frame.contentDocument;
    doc.documentElement.lang = 'ja';
    const publisher = doc.createElement('style');
    // 和文の比較基準には同梱の明朝体を使い、欧文は実際の配信元から読み込むルン。
    publisher.textContent = '@font-face { font-family:"BIZ UDMincho"; src:url("/reference.ttf"); }'
        + '@font-face { font-family:"UDP Reference"; src:url("https://fonts.gstatic.com/s/bizudpmincho/v11/ypvfbXOBrmYppy7oWWTg1_58rhFStHb0.woff2"); font-weight:400; }'
        + '@font-face { font-family:"UDP Reference"; src:url("https://fonts.gstatic.com/s/bizudpmincho/v11/ypvfbXOBrmYppy7oWWTg1_58rh9StA.woff2"); font-weight:400; }'
        + '@font-face { font-family:"UDP Reference"; src:url("https://fonts.gstatic.com/s/bizudpmincho/v11/ypvCbXOBrmYppy7oWWTg1_58pqR3oUfVnKAy.woff2"); font-weight:700; }'
        + '@font-face { font-family:"UDP Reference"; src:url("https://fonts.gstatic.com/s/bizudpmincho/v11/ypvCbXOBrmYppy7oWWTg1_58pqR3oUnVnA.woff2"); font-weight:700; }'
        + 'html { font-size:32px; } p { margin:0; white-space:nowrap; line-height:1.8; }'
        + '.japanese-reference,.publisher { font-family:"BIZ UDMincho",serif; }'
        + '.latin-reference { font-family:"UDP Reference",serif; }'
        + '.alias { font-family:serif-ja,serif; } .code { font-family:monospace; }'
        + '.upright { text-orientation:upright; } .tcy { text-combine-upright:all; }';
    doc.head.append(publisher);
    const japanese = 'あいうえお漢字、。「」・Ａ１―—…';
    const latin = 'iWméĀe\u0301 0123&';
    doc.body.innerHTML = '<p id="reader"><span class="jp">' + japanese + '</span><span class="lat">' + latin + '</span></p>'
        + '<p class="alias"><span class="jp">' + japanese + '</span><span class="lat">' + latin + '</span></p>'
        + '<p class="japanese-reference"><span class="jp">' + japanese + '</span><span class="lat">' + latin + '</span></p>'
        + '<p class="latin-reference"><span class="lat">' + latin + '</span></p>'
        + '<p class="publisher"><span class="lat">' + latin + '</span></p>'
        + '<p class="code">iiiiWWWW</p><p><span class="upright">iW</span><span class="tcy">12</span></p>'
        + '<p><ruby>星雲<rt>せいうん</rt></ruby>と<ruby>観測<rt>かんそく</rt></ruby>。</p>';
    const text = doc.body.textContent;
    const node = doc.querySelector('#reader .lat').firstChild;
    applyReaderFontStyles(doc);
    applyReaderFontStyles(doc);
    const computed = selector => doc.defaultView.getComputedStyle(doc.querySelector(selector));
    const rect = selector => {
        const range = doc.createRange();
        range.selectNodeContents(doc.querySelector(selector));
        return range.getBoundingClientRect();
    };
    const equal = (a, b, message) => expect(Math.abs(a - b) < 0.2, `${message}: ${a} != ${b}`);
    for (const weight of [400, 700]) {
        doc.body.style.fontWeight = weight;
        // 構成書体を明示的に読み込み、CSS候補名だけで合格にしないルン。
        const faces = await doc.fonts.load(`${weight} 32px "Comistream BIZ UDP Latin"`, latin);
        expect(faces.length > 0 && faces.every(face => face.status === 'loaded'), 'Latin font was not loaded');
        for (const mode of ['horizontal-tb', 'vertical-rl', 'vertical-lr']) {
            doc.documentElement.style.writingMode = mode;
            void doc.body.offsetHeight;
            await doc.fonts.ready;
            const dimension = mode === 'horizontal-tb' ? 'width' : 'height';
            for (const selector of ['#reader', '.alias']) {
                equal(rect(selector + ' .jp')[dimension], rect('.japanese-reference .jp')[dimension], 'Japanese advance changed: ' + mode);
                equal(rect(selector + ' .lat')[dimension], rect('.latin-reference .lat')[dimension], 'Latin font mismatch: ' + mode);
            }
            equal(rect('.publisher .lat')[dimension], rect('.japanese-reference .lat')[dimension], 'Publisher font changed');
            expect(computed('.code').fontFamily === '"Comistream Kana Repeat", monospace', 'Code font changed');
            expect(computed('.upright').textOrientation === 'upright', 'Upright setting changed');
            expect(computed('.tcy').textCombineUpright === 'all', 'Tate-chu-yoko setting changed');
            if (mode !== 'horizontal-tb') {
                equal(rect('.upright').height, 64, 'Upright Latin must keep full-height cells');
                equal(rect('.tcy').height, 32, 'Tate-chu-yoko must occupy one cell');
            }
            expect(rect('rt').width > 0 && rect('rt').height > 0, 'Ruby did not render');
        }
    }
    // 文字列・テキストノード・参照位置を加工せずにフォントだけを選ぶルン。
    expect(doc.body.textContent === text && doc.querySelector('#reader .lat').firstChild === node, 'Book text or DOM changed');
    for (const config of [{ save:true, fixed:false, lang:'ja' }, { save:false, fixed:true, lang:'ja' }, { save:false, fixed:false, lang:'en' }]) {
        const excluded = document.createElement('iframe');
        document.body.append(excluded);
        const other = excluded.contentDocument;
        other.documentElement.lang = config.lang;
        other.body.textContent = '本文 iW';
        appConfig.packetSave = config.save;
        view.isFixedLayout = config.fixed;
        applyReaderFontStyles(other);
        const css = other.querySelector('[data-comistream-reader-font]').textContent;
        expect(!/Comistream BIZ UDP Latin|bizudpmincho/.test(css), 'Latin override leaked into excluded mode');
        if (config.save) expect(!/googleapis|gstatic/.test(css), 'Saving mode requested web fonts');
        excluded.remove();
    }
}

// COMISTREAM_BROWSER_TESTS=1ではGoogle Fontsへの通信も含めて確認するルン。
test('Google-hosted mixed fonts preserve Japanese advances, author fonts, upright Latin and tate-chu-yoko', { skip: !chrome }, async () => {
    const html = `<!doctype html><meta charset="utf-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com">
        <script>
        const view = { isFixedLayout:false, book:{metadata:{language:['ja']}} };
        const appConfig = { packetSave:false }, readerFontStyles = new WeakMap();
        ${fontCode}
        window.addEventListener('load', () => (${verifyMixedFonts.toString()})()
            .then(() => window.__progressNativeResult = {ok:true})
            .catch(error => window.__progressNativeResult = {ok:false,error:error.stack}));
        </script>`;
    const server = http.createServer((request, response) => {
        if (request.url === '/reference.ttf') {
            response.setHeader('Content-Type', 'font/ttf');
            response.end(referenceFont);
        } else if (request.url === '/theme/fonts/kana-repeat/ComistreamKanaRepeat-v2.ttf') {
            response.setHeader('Content-Type', 'font/ttf');
            response.end(kanaFont);
        } else if (request.url === '/') {
            response.setHeader('Content-Type', 'text/html');
            response.end(html);
        } else {
            response.writeHead(404);
            response.end();
        }
    });
    try {
        await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
        await runEpubBrowserFixture(`http://127.0.0.1:${server.address().port}/`);
    } finally { await new Promise(resolve => server.close(resolve)); }
});
