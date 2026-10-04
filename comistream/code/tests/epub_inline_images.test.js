const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { chrome, runBrowserFixture } = require('./browser_fixture');

const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const textImageCode = between('function hasUsableDocumentBody(', 'function preserveIllustrationInlineStyles(');
const imagePageCode = between('function markImageOnlyPage(', 'function getNodeTextLengthBefore(');
const openingCode = between('function markOpeningIllustrationBreak(', 'function markMediaPageLayout(');
const areaCode = between('function getMediaArea(', 'function scheduleMediaPageLayoutRefresh(');
const cssCode = between('function buildReaderCSS(', 'function buildRendererPrefsSignature(');
const mediaCode = between('function hasUsableDocumentBody(', 'function hasEpubTypeToken(');

function fixture({ className = '', ruby = false, text = '本文', complete = true } = {}) {
    const attributes = new Map();
    const media = {
        complete, naturalWidth: complete ? 640 : 0, naturalHeight: complete ? 640 : 0,
        matches: (selector) => selector.split(',').some(value => value.trim() === '.' + className),
        closest: (selector) => ruby && selector === 'ruby' ? {} : null,
        getBoundingClientRect: () => ({ width: 24, height: 24 }),
        setAttribute: (name, value) => attributes.set(name, value)
    };
    const body = {
        nodeType: 1, textContent: text,
        querySelectorAll: () => [media],
        setAttribute: (name, value) => attributes.set('body:' + name, value)
    };
    const doc = {
        body,
        documentElement: { setAttribute: (name, value) => attributes.set('html:' + name, value) }
    };
    media.parentElement = body;
    let styled = 0;
    let refreshed = 0;
    const context = vm.createContext({
        Node: { ELEMENT_NODE: 1 }, window: { innerWidth: 800, innerHeight: 600 },
        ILLUSTRATION_MIN_NATURAL_AREA: 120000,
        ILLUSTRATION_MIN_RENDERED_AREA_RATIO: 0.18,
        ILLUSTRATION_MAX_TEXT_BEFORE_CHARS: 20,
        isSpecialFrontmatterDoc: () => false,
        getNormalizedBodyText: (value) => value.body.textContent,
        getNodeTextLengthBefore: () => 0,
        getIllustrationBreakCandidate: (value) => value,
        applyIllustrationPageStyles: () => { styled++; return {}; },
        insertIllustrationSpacers: () => 0,
        scheduleMediaPageLayoutRefresh: () => refreshed++,
        debugLog: () => {}
    });
    vm.runInContext(textImageCode + imagePageCode + areaCode + openingCode, context);
    return { context, doc, attributes, styled: () => styled, refreshed: () => refreshed };
}

test('high-resolution gaiji and ruby images never become opening illustrations', () => {
    for (const options of [{ className: 'gaiji' }, { className: 'gaiji-line' }, { className: 'gaiji-wide' }, { ruby: true }]) {
        const f = fixture(options);
        assert.equal(f.context.markOpeningIllustrationBreak(f.doc), false, JSON.stringify(options));
        assert.equal(f.attributes.size, 0);
        assert.equal(f.styled(), 0);
    }
});

test('text images without text nodes are not treated as image-only pages', () => {
    for (const options of [{ className: 'gaiji' }, { className: 'gaiji-line' }, { className: 'gaiji-wide' }, { ruby: true }]) {
        const f = fixture({ ...options, text: '' });
        assert.equal(f.context.markImageOnlyPage(f.doc), false, JSON.stringify(options));
        assert.equal(f.attributes.size, 0);
    }
});

test('ordinary covers and large opening illustrations keep their page treatment', () => {
    const cover = fixture({ text: '' });
    assert.equal(cover.context.markImageOnlyPage(cover.doc), true);
    assert.equal(cover.attributes.get('data-comistream-page-media'), '1');
    const opening = fixture();
    assert.equal(opening.context.markOpeningIllustrationBreak(opening.doc), true);
    assert.equal(opening.styled(), 1);
    const late = fixture();
    late.context.getNodeTextLengthBefore = () => 21;
    assert.equal(late.context.markOpeningIllustrationBreak(late.doc), false);
});

test('pending text images cannot schedule illustration layout refreshes', () => {
    const f = fixture({ className: 'gaiji', complete: false });
    assert.equal(f.context.markOpeningIllustrationBreak(f.doc), false);
    assert.equal(f.refreshed(), 0);
});

test('browser preserves publisher dimensions and limits page fitting to marked media', { skip: !chrome }, async () => {
    await runBrowserFixture(`
        window.testDone = false;
        const currentDirectionOverride = 'auto';
        const currentWritingModeOverride = 'auto';
        const currentFontScale = 1;
        const currentFlowMode = 'paginated';
        const illustrationStyleSnapshots = new WeakMap();
        const ILLUSTRATION_MIN_NATURAL_AREA = 120000;
        const ILLUSTRATION_MIN_RENDERED_AREA_RATIO = 0.18;
        const ILLUSTRATION_MAX_TEXT_BEFORE_CHARS = 20;
        const ILLUSTRATION_MAX_SPACER_COUNT = 3;
        const resolveEffectiveReadingMode = () => ({ vertical: false, rtl: false });
        const getEffectiveThemeName = () => 'white';
        const getEffectiveTheme = () => ({ bg: '#fff', color: '#000', colorScheme: 'light' });
        const getViewportSize = () => ({ width: 800, height: 600 });
        const resolveEffectiveLayoutMode = () => ({ vertical: false });
        const classifyViewport = () => 'tablet';
        const getReaderMarginPx = () => 48;
        const getEffectiveFontSizePx = () => 24;
        const calculateColumnLayout = () => ({ maxInlineSize: '800px', maxColumnCount: 1 });
        const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
        const isSpecialFrontmatterDoc = () => false;
        const debugLog = () => {};
        ${cssCode}
        ${mediaCode}
        (async () => {
            const frame = document.getElementById('fixture');
            const doc = frame.contentDocument;
            const publisher = doc.createElement('style');
            publisher.textContent = 'html, body { margin: 0; height: 100%; } p { margin: 0; }'
                + 'img { display: inline-block; } .gaiji { width: 1em; height: 1em; }'
                + '.gaiji-line { width: 1em; height: auto; } .gaiji-wide { width: auto; height: 1em; }'
                + '.custom { width: 1.5em; height: 1.25em; }'
                + '.logical { inline-size: 1.5em; block-size: .75em; }';
            const reader = doc.createElement('style');
            doc.head.append(publisher, reader);
            const imageURL = (width, height) => 'data:image/svg+xml,' + encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><rect width="100%" height="100%" fill="black"/></svg>');
            const image = (classes, width = 128, height = 128, styles = '') => '<img class="' + classes
                + '" style="' + styles + '" src="' + imageURL(width, height) + '">';
            const populate = async (html) => {
                clearMediaPageMarks(doc);
                doc.body.innerHTML = html;
                await Promise.all([...doc.images].map(value => value.decode()));
            };
            const dimensions = (selector, width, height, label) => {
                const rect = doc.querySelector(selector).getBoundingClientRect();
                expect(Math.abs(rect.width - width) < .1 && Math.abs(rect.height - height) < .1,
                    label + ': ' + rect.width + 'x' + rect.height + ', expected ' + width + 'x' + height);
            };
            for (const mode of ['vertical-rl', 'horizontal-tb']) {
                doc.documentElement.style.writingMode = mode;
                for (const size of [16, 24, 32]) {
                    reader.textContent = buildReaderCSS(size / 16).replace(/^@import .*;$/gm, '');
                    await populate('<p>本文' + image('gaiji') + image('gaiji-line', 320, 640)
                        + image('gaiji-wide', 640, 320) + image('custom')
                        + image('logical') + image('inline', 128, 128, 'width: 2em; height: .5em')
                        + '<ruby><rb>' + image('ruby-image', 640, 640, 'width: 1em; height: 1em')
                        + '</rb><rt>よみ</rt></ruby>'
                        + '<svg class="custom" viewBox="0 0 128 128"><rect width="128" height="128"/></svg></p>');
                    markMediaPageLayout(doc);
                    dimensions('.gaiji', size, size, mode + ' gaiji');
                    dimensions('.gaiji-line', size, size * 2, mode + ' tall gaiji');
                    dimensions('.gaiji-wide', size * 2, size, mode + ' wide gaiji');
                    dimensions('img.custom', size * 1.5, size * 1.25, mode + ' custom');
                    dimensions('svg.custom', size * 1.5, size * 1.25, mode + ' inline svg');
                    dimensions('.logical', size * (mode === 'vertical-rl' ? .75 : 1.5),
                        size * (mode === 'vertical-rl' ? 1.5 : .75), mode + ' logical');
                    dimensions('.inline', size * 2, size * .5, mode + ' inline style');
                    dimensions('.ruby-image', size, size, mode + ' ruby');
                    expect(!doc.documentElement.hasAttribute('data-comistream-illustration-break-page'), 'Text received illustration break');
                    await populate('<p>本文' + image('gaiji', 640, 640) + '続き</p>');
                    markMediaPageLayout(doc);
                    dimensions('.gaiji', size, size, mode + ' single paragraph');
                    expect(doc.defaultView.getComputedStyle(doc.querySelector('img')).display === 'inline-block', 'Text image became a block');
                    expect(!doc.documentElement.hasAttribute('data-comistream-illustration-break-page'), 'High-resolution gaiji received illustration break');
                }
            }
            await populate('<p>' + image('cover', 1200, 1800) + '</p>');
            markMediaPageLayout(doc);
            expect(doc.documentElement.hasAttribute('data-comistream-image-page'), 'Cover not marked');
            const cover = doc.querySelector('img').getBoundingClientRect();
            expect(cover.width <= 800 && cover.height <= 600 && Math.abs(cover.width / cover.height - 2 / 3) < .01, 'Cover does not fit');
            expect(Math.abs(cover.left + cover.width / 2 - 400) < 1 && Math.abs(cover.top + cover.height / 2 - 300) < 1, 'Cover not centered');
            await populate('<p>' + image('illustration', 1200, 1800, 'block-size: 2em') + '</p><p>続く本文</p>');
            markMediaPageLayout(doc);
            expect(doc.documentElement.hasAttribute('data-comistream-illustration-break-page'), 'Opening illustration not marked');
            const illustration = doc.querySelector('img').getBoundingClientRect();
            expect(illustration.width <= 704 && illustration.height <= 504
                && Math.abs(illustration.width / illustration.height - 2 / 3) < .01, 'Opening illustration does not fit');
            clearMediaPageMarks(doc);
            expect(doc.querySelector('img').style.blockSize === '2em', 'Original illustration style not restored');
            window.testDone = true;
        })().catch(error => {
            window.testFailed = true;
            document.getElementById('result').textContent = error.stack;
        });
    `, '<iframe id="fixture" style="width:800px;height:600px;border:0"></iframe>');
});
