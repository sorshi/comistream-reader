const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const imageCode = source.slice(source.indexOf('const paperImageCache ='), source.indexOf('function buildReaderCSS('));
const cssCode = source.slice(source.indexOf('function buildReaderCSS('), source.indexOf('function buildRendererPrefsSignature('));

function pixels({ paper = [255, 255, 255], ink = [0, 0, 0], alpha = 255 } = {}) {
    const width = 40;
    const height = 40;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            data.set([...(x >= 10 && x < 30 && y >= 10 && y < 30 ? ink : paper), alpha], (y * width + x) * 4);
        }
    }
    return { data, width, height };
}

function fixture({ theme = 'paper', failure = false } = {}) {
    const tasks = [];
    let reads = 0;
    const context = vm.createContext({
        URL, theme, currentDirectionOverride: 'auto', currentWritingModeOverride: 'auto',
        resolveEffectiveReadingMode: () => ({ vertical: false, rtl: false }),
        getEffectiveThemeName: () => context.theme,
        getEffectiveTheme: () => ({ bg: '#f5f0e6', color: '#2c2416', colorScheme: 'light only' }),
        window: { setTimeout: (run) => tasks.push(run) },
        document: { createElement: () => ({ getContext: () => ({
            drawImage() {}, getImageData() { reads++; if (failure) throw new Error('SecurityError'); return pixels(); }
        }) }) }
    });
    vm.runInContext(imageCode + cssCode, context);
    function image(src = 'https://reader.test/image.png') {
        const attributes = new Set();
        return { localName: 'img', isConnected: true, src, currentSrc: src,
            naturalWidth: 400, naturalHeight: 400, decode: async () => {},
            removeAttribute: (key) => attributes.delete(key),
            toggleAttribute: (key, on) => on ? attributes.add(key) : attributes.delete(key),
            blended: () => attributes.has('data-comistream-paper-image') };
    }
    return { context, image, tasks, reads: () => reads, flush: async () => { while (tasks.length) await tasks.shift()(); } };
}

test('white monochrome ink and small JPEG channel differences are accepted', () => {
    const { context } = fixture();
    assert.equal(context.isWhitePaperMonochrome(pixels()), true);
    assert.equal(context.isWhitePaperMonochrome(pixels({ paper: [250, 248, 249], ink: [65, 69, 67] })), true);
});

test('color, transparent art, off-white scans, blank and images without white paper stay unchanged', () => {
    const { context } = fixture();
    for (const input of [
        pixels({ ink: [180, 20, 20] }), pixels({ alpha: 0 }), pixels({ paper: [230, 230, 230] }),
        pixels({ ink: [255, 255, 255] }), pixels({ paper: [80, 80, 80] })
    ]) assert.equal(context.isWhitePaperMonochrome(input), false);
    const smallColor = pixels();
    for (let i = 0; i < 5; i++) smallColor.data.set([200, 0, 0, 255], (500 + i) * 4);
    assert.equal(context.isWhitePaperMonochrome(smallColor), false);
});

test('monochrome art reaching every edge still blends when white paper remains inside', () => {
    const { context } = fixture();
    const input = pixels();
    for (let y = 0; y < input.height; y++) {
        for (let x = 0; x < input.width; x++) {
            const value = x >= 10 && x < 30 && y >= 10 && y < 30 ? 255 : 80;
            input.data.set([value, value, value, 255], (y * input.width + x) * 4);
        }
    }
    assert.equal(context.isWhitePaperMonochrome(input), true);
});

test('sparse highlights do not count as white paper; sufficient interior white does', () => {
    const { context } = fixture();
    function withWhitePixels(count) {
        const input = pixels({ paper: [80, 80, 80], ink: [80, 80, 80] });
        for (let i = 0; i < count; i++) input.data.set([255, 255, 255, 255], (400 + i) * 4);
        return input;
    }
    assert.equal(context.isWhitePaperMonochrome(withWhitePixels(159)), false);
    assert.equal(context.isWhitePaperMonochrome(withWhitePixels(160)), true);
});

test('analysis is deferred and cached by source', async () => {
    const f = fixture();
    const first = f.image();
    f.context.schedulePaperImage(first);
    assert.equal(f.reads(), 0);
    await f.flush();
    assert.equal(first.blended(), true);
    const second = f.image();
    f.context.schedulePaperImage(second);
    await f.flush();
    assert.equal(second.blended(), true);
    assert.equal(f.reads(), 1);
});

test('white, dark and system themes do not analyze or supply blend CSS', async () => {
    const f = fixture();
    assert.match(f.context.buildReaderCSS(1), /mix-blend-mode: multiply/);
    for (const theme of ['white', 'dark', 'system']) {
        f.context.theme = theme;
        f.context.schedulePaperImage(f.image());
        assert.equal(f.tasks.length, 0);
        assert.doesNotMatch(f.context.buildReaderCSS(1), /mix-blend-mode/);
    }
});

test('theme change before idle work cancels analysis and allows retry in paper', async () => {
    const f = fixture();
    const image = f.image();
    f.context.schedulePaperImage(image);
    f.context.theme = 'dark';
    await f.flush();
    assert.equal(f.reads(), 0);
    f.context.theme = 'paper';
    f.context.schedulePaperImage(image);
    await f.flush();
    assert.equal(image.blended(), true);
});

test('Canvas access failure preserves original image; replaced source cannot receive stale result', async () => {
    const failed = fixture({ failure: true });
    const original = failed.image();
    failed.context.schedulePaperImage(original);
    await failed.flush();
    assert.equal(original.blended(), false);
    const f = fixture();
    const changed = f.image();
    changed.decode = async () => { changed.currentSrc = 'https://reader.test/color.png'; };
    f.context.schedulePaperImage(changed);
    await f.flush();
    assert.equal(changed.blended(), false);
});

test('SVG raster wrappers resolve href while mixed vector content is excluded', () => {
    const { context } = fixture();
    const svg = { localName: 'svg', ownerDocument: { baseURI: 'https://reader.test/chapter/page.xhtml' },
        querySelectorAll: () => [{ getAttribute: () => '../images/mono.png' }], querySelector: () => null };
    assert.equal(context.getPaperImageSource(svg), 'https://reader.test/images/mono.png');
    svg.querySelector = () => ({});
    assert.equal(context.getPaperImageSource(svg), '');
});
