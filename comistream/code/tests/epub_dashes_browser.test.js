const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { chrome } = require('./browser_fixture');
const { runEpubBrowserFixture } = require('./epub_browser_fixture');

const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const dashCode = source.slice(source.indexOf('function collectReaderDashRanges('), source.indexOf('function buildReaderCSS('));
const positionEvents = source.slice(source.indexOf('function bindRendererPagePositionEvents('), source.indexOf('function recordEpubUserPosition('));
const moduleBase = source.match(/const FOLIATE_MODULE_BASE = '([^']+)'/)[1];

async function checkDashes() {
    const wait = () => new Promise(resolve => setTimeout(resolve, 100));
    const expect = (condition, message) => { if (!condition) throw Error(message); };
    const frame = document.querySelector('iframe');
    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    const name = 'comistream-reader-dashes';
    const style = doc.createElement('style');
    style.textContent = `html { writing-mode: vertical-rl; font: 24px/1.8 "Hiragino Mincho ProN", serif; }
        body { margin: 20px; } .horizontal { writing-mode: horizontal-tb; }
        .combined { text-combine-upright: all; } .hidden { opacity: 0; }`;
    doc.head.append(style);
    doc.documentElement.lang = 'ja';
    doc.body.innerHTML = '<p id="sample">これは――遠い宇宙。これは―――長い航路。これは——文章。</p>'
        + '<p class="horizontal">横書き――文字</p><p lang="en">English――text</p>'
        + '<code>code――text</code><p><span class="combined">――</span></p>'
        + '<p class="hidden">不可視――文字</p><p>単体：―、—、–、−、ー。</p>';
    view.renderer = { getContents: () => [{ doc }] };
    const textNodes = () => {
        const walker = doc.createTreeWalker(doc.body, 4), nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        return nodes;
    };
    const characterRects = () => textNodes().flatMap(node => Array.from(node.data, (_, offset) => {
        const range = doc.createRange();
        range.setStart(node, offset); range.setEnd(node, offset + 1);
        return Array.from(range.getClientRects(), rect => [rect.x, rect.y, rect.width, rect.height]);
    }));
    const beforeDOM = doc.body.innerHTML;
    const beforeNodes = textNodes();
    const beforeRects = JSON.stringify(characterRects());
    prepareReaderDashes(doc);
    prepareReaderDashes(doc);
    await wait();
    expect(doc.body.innerHTML === beforeDOM, 'Publisher DOM changed');
    expect(textNodes().every((node, i) => node === beforeNodes[i]), 'Text nodes changed');
    expect(JSON.stringify(characterRects()) === beforeRects, 'Characters moved');
    expect(doc.querySelectorAll('[data-comistream-dash-style]').length === 1, 'Styles duplicated');
    expect(frame.parentElement.querySelectorAll('[data-comistream-dash-overlay]').length === 1, 'Overlays duplicated');
    const overlay = frame.parentElement.querySelector('[data-comistream-dash-overlay]');
    expect(getComputedStyle(overlay).pointerEvents === 'none', 'Overlay intercepts reader input');
    function verify(expectedCount = 3) {
        const ranges = Array.from(win.CSS.highlights.get(name) || []);
        const lines = Array.from(overlay.querySelectorAll('line'));
        expect(lines.length === expectedCount && ranges.length === expectedCount, 'Wrong number of corrected runs');
        ranges.forEach((range, i) => {
            const rect = range.getBoundingClientRect();
            const computed = win.getComputedStyle(range.startContainer.parentElement);
            const line = lines[i];
            const size = parseFloat(computed.fontSize);
            expect(Math.abs(Number(line.getAttribute('x1')) - rect.left - rect.width / 2) < 0.01, 'Line is off center');
            expect(Number(line.getAttribute('x1')) === Number(line.getAttribute('x2')), 'Line is slanted');
            expect(Math.abs(Number(line.getAttribute('y1')) - rect.top) < 0.01, 'Start moved');
            expect(Math.abs(Number(line.getAttribute('y2')) - (rect.bottom - size * 0.12)) < 0.01, 'Endpoint is not shortened by 0.12em');
            expect(line.getAttribute('stroke') === computed.color, 'Color does not follow text');
            const selection = win.getSelection();
            selection.removeAllRanges(); selection.addRange(range);
            expect(selection.toString() === range.toString(), 'Selected text changed');
            selection.removeAllRanges();
        });
    }
    for (const mode of ['vertical-rl', 'vertical-lr']) {
        for (const size of [16, 24, 40]) {
            for (const weight of [400, 700]) {
                Object.assign(doc.documentElement.style, { writingMode: mode, fontSize: `${size}px`, fontWeight: weight });
                await wait();
                verify();
            }
        }
    }
    style.textContent += 'body { color: rgb(238, 238, 238); background: #111; }';
    await wait(); verify();
    doc.documentElement.style.writingMode = 'horizontal-tb';
    await wait(); verify(0);
    expect(!win.CSS.highlights.has(name), 'Horizontal text remains hidden');
    doc.documentElement.style.writingMode = 'vertical-rl';
    await wait(); verify();
    doc.documentElement.lang = 'en';
    await wait(); verify(0);
    doc.documentElement.lang = 'ja';
    await wait(); verify();
    const sample = doc.getElementById('sample');
    sample.textContent = '変更後は――続く。';
    await wait(); verify(1);
    sample.textContent = '連続ダーシなし';
    await wait(); verify(0);
    sample.textContent = '再び――続く。';
    await wait(); verify(1);
    const originalRects = win.Range.prototype.getClientRects;
    win.Range.prototype.getClientRects = () => { throw Error('Simulated layout failure'); };
    prepareReaderDashes(doc);
    await wait();
    expect(!win.CSS.highlights.has(name) && !overlay.childElementCount, 'Failure hid the original text');
    win.Range.prototype.getClientRects = originalRects;
    prepareReaderDashes(doc);
    await wait(); verify(1);
    view.isFixedLayout = true;
    refreshReaderDashes();
    expect(!readerDashDocuments.size && !win.CSS.highlights.has(name), 'Fixed layout kept correction');
    expect(!frame.parentElement.querySelector('[data-comistream-dash-overlay]'), 'Overlay was not removed');
    view.isFixedLayout = false;
    const originalHighlight = win.Highlight;
    win.Highlight = undefined;
    prepareReaderDashes(doc);
    expect(!readerDashDocuments.size && !win.CSS.highlights.has(name), 'Unsupported browser hides text');
    win.Highlight = originalHighlight;
    prepareReaderDashes(doc);
    await wait();
    view.renderer.getContents = () => [];
    refreshReaderDashes();
    expect(!readerDashDocuments.size && !win.CSS.highlights.has(name), 'Unloaded document retained correction');
}

async function checkPaginatorDashes() {
    const wait = () => new Promise(resolve => setTimeout(resolve, 150));
    const expect = (condition, message) => { if (!condition) throw Error(message); };
    const paginator = new Paginator();
    paginator.style.cssText = 'position:fixed;left:0;top:0;width:600px;height:700px';
    for (const [name, value] of Object.entries({flow:'paginated',gap:'0','margin-top':'24',
        'margin-right':'24','margin-bottom':'24','margin-left':'24','max-inline-size':'2000',
        'max-block-size':'2000','max-column-count':'1','no-preload':''})) paginator.setAttribute(name,value);
    document.body.append(paginator);
    view.renderer = paginator;
    const saved = new Map();
    paginator.addEventListener('load', ({ detail: { doc, index } }) => {
        const range = doc.createRange();
        range.selectNodeContents(doc.querySelector('p').firstChild);
        expect(CFI.toRange(doc, CFI.parse(CFI.fromRange(range))).toString() === range.toString(), 'Baseline CFI does not resolve');
        saved.set(index, { cfi: CFI.fromRange(range), text: range.toString() });
        prepareReaderDashes(doc);
    });
    bindRendererPagePositionEvents();
    const urls = [0, 1].map(index => URL.createObjectURL(new Blob([`<!doctype html><html lang="ja"><style>
        html { writing-mode:vertical-rl; font:24px/1.8 "Hiragino Mincho ProN",serif; }
        p { break-before:column; margin:0; } p:first-child { break-before:auto; }
        </style><body>${Array.from({length:5}, (_, i) => `<p>${index}-${i} これは――先へ。これは―――長い航路。</p>`).join('')}</body></html>`], {type:'text/html'})));
    paginator.open({ dir:'rtl', sections:urls.map((url,index)=>({id:String(index),linear:'yes',load:async()=>url})) });
    function verify(index) {
        const { doc } = paginator.getContents().find(content=>content.index===index);
        const frame = doc.defaultView.frameElement;
        const overlay = frame.parentElement.querySelector('[data-comistream-dash-overlay]');
        const ranges = Array.from(doc.defaultView.CSS.highlights.get('comistream-reader-dashes') || []);
        const lines = Array.from(overlay?.querySelectorAll('line') || []);
        expect(lines.length === 10 && ranges.length === 10, 'Paged dashes missing');
        const range = doc.createRange(); range.selectNodeContents(doc.querySelector('p').firstChild);
        expect(CFI.fromRange(range) === saved.get(index).cfi, 'Existing CFI changed');
        expect(CFI.toRange(doc, CFI.parse(saved.get(index).cfi)).toString() === saved.get(index).text, 'CFI no longer resolves');
        const frameRect=frame.getBoundingClientRect(), overlayRect=overlay.getBoundingClientRect();
        ranges.forEach((range,i)=>{
            const rect=range.getBoundingClientRect(),line=lines[i];
            const size=parseFloat(doc.defaultView.getComputedStyle(range.startContainer.parentElement).fontSize);
            expect(Math.abs(overlayRect.left + Number(line.getAttribute('x1')) - frameRect.left - rect.left - rect.width/2)<0.1, 'Paged line shifted');
            expect(Math.abs(overlayRect.top + Number(line.getAttribute('y2')) - frameRect.top - rect.bottom + size*0.12)<0.1, 'Paged endpoint shifted');
        });
        expect(readerDashDocuments.size===paginator.getContents().length, 'Unloaded chapter was retained');
    }
    try {
        await paginator.goTo({index:0,anchor:0}); await wait(); verify(0);
        await paginator.next(); await wait(); verify(0);
        await paginator.prev(); await wait(); verify(0);
        await paginator.goTo({index:1,anchor:0}); await wait(); verify(1);
        await paginator.goTo({index:0,anchor:doc=>CFI.toRange(doc,CFI.parse(saved.get(0).cfi))}); await wait(); verify(0);
        paginator.setStyles('body { font-size:32px; color:rgb(235,235,235); background:#111; }');
        await wait(); verify(0);
        paginator.style.width='820px'; paginator.style.height='550px';
        await wait(); verify(0);
        paginator.setAttribute('flow','scrolled');
        await wait(); verify(0);
        paginator.setAttribute('flow','paginated');
        await wait(); verify(0);
    } finally {
        paginator.destroy(); paginator.remove();
        refreshReaderDashes();
        urls.forEach(url=>URL.revokeObjectURL(url));
    }
}

async function runFixture(check, modules = {}) {
    const imports = Object.keys(modules).length
        ? "import { Paginator } from '/paginator.js'; import * as CFI from '/epubcfi.js';" : '';
    const html = `<!doctype html><meta charset="utf-8"><div style="position:relative;width:650px;height:650px">
        <iframe style="width:600px;height:600px;border:0"></iframe></div><script type="module">
        ${imports}
        const readerDashDocuments = new Map();
        const view = { isFixedLayout:false, renderer:null };
        const debugLog = () => {};
        const getRendererContents = () => view.renderer?.getContents() || [];
        const epubEndController = null, lastViewRelocationCfi = '', currentFlowMode = 'paginated';
        const getPageTurnDirection = () => 0, schedulePagePositionUpdate = () => {};
        ${dashCode}
        ${positionEvents}
        (${check.toString()})().then(()=>window.__progressNativeResult={ok:true})
            .catch(error=>window.__progressNativeResult={ok:false,error:error.stack});
        </script>`;
    const server = http.createServer((request,response)=>{
        const module = modules[request.url];
        response.setHeader('Content-Type',module ? 'text/javascript':'text/html');
        response.end(module || html);
    });
    try {
        await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
        await runEpubBrowserFixture(`http://127.0.0.1:${server.address().port}/`);
    } finally { await new Promise(resolve=>server.close(resolve)); }
}

test('vertical dashes preserve text and positions with centered lines and 0.12em end spacing', {skip:!chrome}, async()=>{
    await runFixture(checkDashes);
});

test('native EPUB pagination preserves dash alignment and CFI across reflow and chapter changes', {
    skip:!chrome || process.env.COMISTREAM_EPUB_BROWSER_TESTS !== '1'
}, async()=>{
    const modules = {};
    for (const [file, local] of [['paginator.js', process.env.COMISTREAM_FOLIATE_PAGINATOR], ['epubcfi.js', process.env.COMISTREAM_FOLIATE_CFI]]) {
        if (local) modules['/'+file] = fs.readFileSync(local,'utf8');
        else {
            const response=await fetch(moduleBase+file);
            assert.ok(response.ok, `Foliate download failed: ${response.status}`);
            modules['/'+file]=await response.text();
        }
    }
    await runFixture(checkPaginatorDashes,modules);
});
