const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { chrome, runBrowserFixture } = require('./browser_fixture');

const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const fontCode = source.slice(source.indexOf('function parseReaderFontLocale('), source.indexOf('function buildReaderCSS('));
const cssCode = source.slice(source.indexOf('function buildReaderCSS('), source.indexOf('function buildRendererPrefsSignature('));

function fixture(language = ['ja']) {
    const context = vm.createContext({
        Intl, view: { book: { metadata: { language } }, language: { canonical: 'ja' } }
    });
    vm.runInContext(fontCode, context);
    return context;
}

function documentLanguage(lang, xmlLang) {
    return { documentElement: {
        getAttribute: name => name === 'lang' ? lang : null,
        getAttributeNS: (namespace, name) => name === 'lang' ? xmlLang : null
    } };
}

test('font profiles follow explicit scripts and traditional Chinese regions', () => {
    const f = fixture();
    const profiles = {
        japanese: ['ja', 'ja-JP', 'ja_JP', 'jpn'],
        latin: ['en', 'en-GB', 'fr', 'vi', 'el', 'ru', 'sr-Latn', 'sr-Cyrl', 'ja-Latn', 'und-Latn'],
        taiwan: ['zh-TW', 'zh-Hant-TW', 'zh-Hant', 'zh-Hant-US'],
        hongkong: ['zh-HK', 'zh-Hant-HK', 'zh-MO', 'yue', 'yue-Hant-HK'],
        generic: ['zh', 'zh-Hans', 'zh-Hans-HK', 'ko', 'ar', 'fa', 'he', 'hi', 'th', 'az-Arab', 'und', 'zz', '', 'x-private', 'invalid tag']
    };
    for (const [profile, languages] of Object.entries(profiles)) {
        for (const language of languages) {
            assert.equal(f.getReaderFontProfile(f.parseReaderFontLocale(language)), profile, language);
        }
    }
});

test('chapter language wins over package metadata and unsupported scripts stay generic', () => {
    const f = fixture(['ja', 'en']);
    assert.equal(f.getReaderFontLocale(documentLanguage('fr')).language, 'fr');
    assert.equal(f.getReaderFontLocale(documentLanguage('ja', 'en-GB')).toString(), 'en-GB');
    assert.equal(f.getReaderFontLocale({ documentElement: {
        getAttribute: name => name === 'xml:lang' ? 'fr' : 'ja'
    } }).language, 'fr');
    assert.equal(f.getReaderFontLocale(documentLanguage('bad tag', 'zh-Hant-HK')).toString(), 'zh-Hant-HK');
    assert.equal(f.getReaderFontProfile(f.getReaderFontLocale(documentLanguage('ar'))), 'generic');
    assert.equal(f.getReaderFontLocale(documentLanguage('und')).language, 'ja');
    assert.equal(f.getReaderFontLocale(documentLanguage('invalid tag')).language, 'ja');
    f.view.book.metadata.language = [null, 'invalid tag', 'ru'];
    assert.equal(f.getReaderFontLocale(documentLanguage()).language, 'ru');
    f.view.book.metadata.language = 'zh-TW';
    assert.equal(f.getReaderFontLocale(documentLanguage()).toString(), 'zh-TW');
    f.view.book.metadata.language = [];
    f.view.language = {};
    assert.equal(f.getReaderFontLocale(documentLanguage()), null);
});

test('normal mode loads only the selected web family and includes Latin italics', () => {
    const f = fixture();
    const families = {
        ja: 'BIZ+UDMincho:wght@400;700',
        fr: 'Noto+Serif:ital,wght@0,400;0,700;1,400;1,700',
        'zh-TW': 'Noto+Serif+TC:wght@400;700',
        'zh-HK': 'Noto+Serif+HK:wght@400;700'
    };
    for (const [language, family] of Object.entries(families)) {
        const css = f.buildReaderFontCSS(false, f.parseReaderFontLocale(language));
        assert.ok(css.includes(`family=${family}&display=swap`));
        assert.equal((css.match(/@import/g) || []).length, 1);
        assert.doesNotMatch(css, /!important/);
        assert.match(css, /font-feature-settings: normal;/);
        assert.doesNotMatch(css, /"palt"|"pkna"/);
    }
    for (const language of ['ar', 'he', 'hi', 'th', 'ko', 'zh-Hans', 'und']) {
        const css = f.buildReaderFontCSS(false, f.parseReaderFontLocale(language));
        assert.doesNotMatch(css, /@import|fonts\.googleapis|Noto|BIZ|Georgia/);
        assert.match(css, /font-family: serif;/);
        assert.match(css, /font-feature-settings: normal;/);
    }
});

test('packet saving uses local regional families without Google Fonts requests', () => {
    const f = fixture();
    const families = { ja: '"Hiragino Mincho ProN"', en: 'Georgia', 'zh-TW': '"Noto Serif CJK TC"', 'zh-HK': '"Noto Serif CJK HK"', ar: 'serif' };
    for (const [language, family] of Object.entries(families)) {
        const css = f.buildReaderFontCSS(true, f.parseReaderFontLocale(language));
        assert.doesNotMatch(css, /@import|url\(|fonts\.googleapis|fonts\.gstatic/);
        assert.ok(css.includes(`font-family: ${family}`));
        assert.match(css, /serif;/);
        assert.match(css, /font-feature-settings: normal;/);
    }
    assert.match(f.buildReaderFontCSS(true, f.parseReaderFontLocale('zh-HK')), /MingLiU_HKSCS/);
});

test('kana repeat font is restricted to two codepoints in Japanese chapters', () => {
    const f = fixture();
    const url = 'https://reader.example/theme/fonts/kana-repeat/ComistreamKanaRepeat-v2.ttf';
    for (const packetSave of [false, true]) {
        const css = f.buildReaderFontCSS(packetSave, f.parseReaderFontLocale('ja'), url);
        assert.ok(css.includes(`src: url("${url}") format("truetype")`));
        assert.match(css, /unicode-range: U\+3031-3032;/);
        assert.match(css, /font-display: swap;/);
        assert.match(css, /font-family: "Comistream Kana Repeat",/);
        if (packetSave) assert.doesNotMatch(css, /@import|googleapis|gstatic/);
    }
    for (const lang of ['en', 'zh-Hant', 'ar', 'und']) {
        assert.doesNotMatch(f.buildReaderFontCSS(true, f.parseReaderFontLocale(lang), url), /Comistream Kana Repeat|@font-face/);
    }
});

test('Japanese default uses proportional Latin faces only within Latin character ranges', () => {
    const f = fixture();
    const css = f.buildReaderFontCSS(false, f.parseReaderFontLocale('ja'));
    assert.match(css, /font-family: "Comistream BIZ UDP Latin", "BIZ UDMincho"/);
    const faces = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map(match => match[1]);
    assert.equal(faces.length, 4);
    for (const weight of [400, 700]) {
        assert.equal(faces.filter(face => face.includes(`font-weight: ${weight};`)).length, 2);
    }
    const urls = faces.map(face => face.match(/src: url\("([^"]+)"\)/)[1]);
    assert.equal(new Set(urls).size, 4);
    for (const url of urls) {
        assert.match(url, /^https:\/\/fonts\.gstatic\.com\/s\/bizudpmincho\/v11\/[\w-]+\.woff2$/);
    }
    const ranges = faces.flatMap(face => [...face.matchAll(/U\+([0-9A-F]+)(?:-([0-9A-F]+))?/gi)]
        .map(match => [parseInt(match[1], 16), parseInt(match[2] || match[1], 16)]));
    const includes = character => ranges.some(([start, end]) => character.codePointAt(0) >= start && character.codePointAt(0) <= end);
    for (const character of ['i', 'W', '0', '&', '?', 'é', 'Ā', '\u0301']) assert.ok(includes(character), character);
    for (const character of ['あ', 'ア', '漢', '、', '。', '「', '・', '〱', 'Ａ', '１', '—', '―', '…']) assert.ok(!includes(character), character);
    for (const [save, language] of [[true, 'ja'], [false, 'en'], [false, 'zh-TW']]) {
        assert.doesNotMatch(f.buildReaderFontCSS(save, f.parseReaderFontLocale(language)), /Comistream BIZ UDP Latin|bizudpmincho/);
    }
    assert.doesNotMatch(f.buildReaderFontCSS(false, f.parseReaderFontLocale('ja'), '', true), /Comistream BIZ UDP Latin|bizudpmincho/);
});

test('browser resolves Japanese serif aliases while preserving publisher font choices', { skip: !chrome }, async () => {
    await runBrowserFixture(`
        const view = { book: { metadata: { language: ['ja'] } } };
        const appConfig = { packetSave: false };
        const readerFontStyles = new WeakMap();
        ${fontCode}
        const frame = document.createElement('iframe');
        document.body.append(frame);
        const doc = frame.contentDocument;
        doc.documentElement.lang = 'ja';
        const publisher = doc.createElement('style');
        publisher.textContent = 'html { font-family:serif-ja,serif; writing-mode:vertical-rl; }'
            + '@media all { .mfont { font:700 24px/1.8 "serif-ja-v", serif-ja, serif !important; } }'
            + '.gfont { font-family:sans-serif-ja,sans-serif; }'
            + '.publisher { font-family:"Publisher Font",serif; }'
            + '.mixed { font-family:"Publisher, Serif",serif-ja,serif; }'
            + '.generic { font-family:serif; }'
            + '.quoted { font-family:"serif",serif; }'
            + '.variable { --book-font:"Publisher Font"; font-family:var(--book-font); }';
        doc.head.append(publisher);
        doc.body.innerHTML = '<p>通常の<ruby>漢字<rt>かんじ</rt></ruby>と<strong>太字</strong>。</p>'
            + '<p class="mfont">明朝指定</p><p class="inline" style="font-family:serif-ja,serif !important">本文</p>'
            + '<p class="gfont">ゴシック指定</p><p class="publisher">固有書体</p>'
            + '<p class="mixed">固有書体と汎用指定</p><p class="generic">serifのみ</p>'
            + '<p class="quoted">引用符付きの書体名</p><p class="variable">変数</p>';
        const originalText = doc.body.textContent;
        const computed = selector => frame.contentWindow.getComputedStyle(doc.querySelector(selector));
        const family = selector => computed(selector).fontFamily.replace(/^"Comistream Kana Repeat", /, '');
        for (const packetSave of [false, true, false]) {
            appConfig.packetSave = packetSave;
            applyReaderFontStyles(doc);
            applyReaderFontStyles(doc);
            const expected = packetSave ? '"Hiragino Mincho ProN"' : '"Comistream BIZ UDP Latin", "BIZ UDMincho"';
            for (const selector of ['html', 'body', 'p', '.mfont', '.inline', 'rt', 'strong']) {
                expect(family(selector).startsWith(expected), selector + ': ' + family(selector));
            }
            expect(family('.gfont') === 'sans-serif-ja, sans-serif', 'Gothic family changed');
            expect(family('.publisher') === '"Publisher Font", serif', 'Publisher family changed');
            expect(family('.mixed') === '"Publisher, Serif", serif-ja, serif', 'Named family list changed');
            expect(family('.generic') === 'serif', 'Plain serif changed');
            expect(family('.quoted') === '"serif", serif', 'Quoted family changed');
            expect(family('.variable') === '"Publisher Font"', 'CSS variable changed');
            expect(computed('.mfont').fontSize === '24px' && computed('.mfont').fontWeight === '700', 'Font shorthand lost');
            expect(computed('strong').fontWeight === '700', 'Bold lost');
            expect(computed('html').writingMode === 'vertical-rl', 'Writing mode changed');
            expect(doc.querySelector('.inline').style.getPropertyPriority('font-family') === 'important', 'Inline priority lost');
            expect(publisher.sheet.cssRules[1].cssRules[0].style.getPropertyPriority('font-family') === 'important', 'Rule priority lost');
            expect(doc.body.textContent === originalText, 'Book text changed');
            expect(doc.head.querySelectorAll('[data-comistream-reader-font]').length === 1, 'Reader styles duplicated');
            if (packetSave) expect(!/googleapis|gstatic|BIZ UDMincho/.test(doc.querySelector('[data-comistream-reader-font]').textContent), 'Web font retained in saving mode');
        }
    `, '<meta http-equiv="Content-Security-Policy" content="style-src \'unsafe-inline\'; font-src \'none\'">');
});

test('browser preserves defined serif aliases, fixed layouts and other chapter languages', { skip: !chrome }, async () => {
    await runBrowserFixture(`
        const view = { book: { metadata: { language: ['ja'] } } };
        const appConfig = { packetSave: true };
        const readerFontStyles = new WeakMap();
        ${fontCode}
        for (const [language, fixed, face] of [['ja', false, 'serif-ja'], ['ja', false, 'serif-ja-v'], ['ja', true, ''], ['en', false, '']]) {
            const frame = document.createElement('iframe');
            document.body.append(frame);
            const doc = frame.contentDocument;
            doc.documentElement.lang = language;
            view.isFixedLayout = fixed;
            const publisher = doc.createElement('style');
            // @font-faceが本文指定より後に現れても、書籍側の定義を尊重するルン。
            publisher.textContent = 'html { font-family:serif-ja-v,serif-ja,serif; }'
                + (face ? '@media all { @font-face { font-family:"' + face + '"; src:local("Times New Roman"); } }' : '');
            doc.head.append(publisher);
            doc.body.innerHTML = '<p>本文</p>';
            applyReaderFontStyles(doc);
            const family = frame.contentWindow.getComputedStyle(doc.querySelector('p')).fontFamily;
            expect(family.replace(/^"Comistream Kana Repeat", /, '') === 'serif-ja-v, serif-ja, serif', 'Author font or excluded chapter changed: ' + family);
            if (face) expect(publisher.sheet.cssRules[1].cssRules[0].style.getPropertyValue('font-family').replaceAll('"', '') === face, 'Font face name changed');
            frame.remove();
        }
    `, '<meta http-equiv="Content-Security-Policy" content="style-src \'unsafe-inline\'; font-src \'none\'">');
});

test('browser resolves imported serif aliases and preserves imported font faces', { skip: !chrome }, async () => {
    await runBrowserFixture(`
        window.testDone = false;
        const view = { book: { metadata: { language: ['ja'] } } };
        const appConfig = { packetSave: true };
        const readerFontStyles = new WeakMap();
        ${fontCode}
        (async () => {
            for (const embedded of [false, true]) {
                const cssURL = URL.createObjectURL(new Blob([
                    'html { font-family:serif-ja,serif; }'
                    + (embedded ? '@font-face { font-family:"serif-ja"; src:local("Times New Roman"); }' : '')
                ], { type: 'text/css' }));
                const frame = document.createElement('iframe');
                frame.srcdoc = '<!doctype html><html lang="ja"><head><style>@import url("' + cssURL + '");</style></head><body><p>本文</p></body></html>';
                const loaded = new Promise(resolve => { frame.onload = resolve; });
                document.body.append(frame);
                await loaded;
                const doc = frame.contentDocument;
                applyReaderFontStyles(doc);
                const family = frame.contentWindow.getComputedStyle(doc.querySelector('p')).fontFamily.replace(/^"Comistream Kana Repeat", /, '');
                expect(embedded ? family === 'serif-ja, serif' : family.startsWith('"Hiragino Mincho ProN"'), 'Imported family: ' + family);
                frame.remove();
                URL.revokeObjectURL(cssURL);
            }
            window.testDone = true;
        })().catch(error => {
            window.testFailed = true;
            document.getElementById('result').textContent = error.stack;
        });
    `, '<meta http-equiv="Content-Security-Policy" content="style-src \'unsafe-inline\' blob:; font-src \'none\'">');
});

test('browser preserves publisher fonts while chapter defaults and writing modes remain independent', { skip: !chrome }, async () => {
    await runBrowserFixture(`
        const view = { book: { metadata: { language: ['ja'] } } };
        const appConfig = { packetSave: true };
        const readerFontStyles = new WeakMap();
        const currentDirectionOverride = 'auto', currentWritingModeOverride = 'auto';
        const resolveEffectiveReadingMode = () => ({ vertical: false, rtl: false });
        const getEffectiveThemeName = () => 'white';
        const getEffectiveTheme = () => ({ bg: '#fff', color: '#000', colorScheme: 'light' });
        ${fontCode}
        ${cssCode}
        const records = [];
        const cases = [
            ['ja', '"Hiragino Mincho ProN"', 'vertical-rl'],
            ['en-GB', 'Georgia', 'horizontal-tb'],
            ['zh-TW', '"Noto Serif CJK TC"', 'vertical-rl'],
            ['zh-HK', '"Noto Serif CJK HK"', 'horizontal-tb'],
            ['ar', 'serif', 'horizontal-tb'],
            ['hi', 'serif', 'horizontal-tb']
        ];
        for (const [language, family, writingMode] of cases) {
            const frame = document.createElement('iframe');
            document.body.append(frame);
            const doc = frame.contentDocument;
            doc.documentElement.lang = language;
            if (language === 'ar') doc.documentElement.dir = 'rtl';
            doc.body.style.writingMode = writingMode;
            doc.body.innerHTML = '<p>Reading 本文 繁體中文 العربية हिन्दी</p><p class="publisher">Publisher</p><code>Code</code>';
            const publisher = doc.createElement('style');
            publisher.textContent = '.publisher { font-family: sans-serif; } code { font-family: monospace; }';
            const reader = doc.createElement('style');
            reader.textContent = buildReaderCSS(1);
            doc.head.append(publisher, reader);
            applyReaderFontStyles(doc);
            applyReaderFontStyles(doc);
            expect(doc.head.querySelectorAll('[data-comistream-reader-font]').length === 1, 'Font style was duplicated');
            expect(doc.head.firstElementChild.hasAttribute('data-comistream-reader-font'), 'Default font was not inserted before publisher styles');
            const computed = element => frame.contentWindow.getComputedStyle(element);
            const paragraph = doc.querySelector('p');
            const originalFamily = element => computed(element).fontFamily.replace(/^"Comistream Kana Repeat", /, '');
            expect(originalFamily(paragraph).startsWith(family), 'Wrong default: ' + language + ': ' + computed(paragraph).fontFamily);
            expect(computed(paragraph).fontFeatureSettings === 'normal', 'Reader injected glyph spacing: ' + language);
            expect(computed(doc.body).writingMode === writingMode, 'Writing mode changed: ' + language);
            if (language === 'ar') expect(computed(paragraph).direction === 'rtl', 'Arabic direction changed');
            expect(originalFamily(doc.querySelector('.publisher')) === 'sans-serif', 'Publisher paragraph font was overridden');
            expect(originalFamily(doc.querySelector('code')) === 'monospace', 'Code font was overridden');
            publisher.textContent += 'body { font-family: "Publisher Font", serif; }';
            expect(computed(paragraph).fontFamily.startsWith('"Publisher Font"'), 'Publisher body font was overridden');
            publisher.textContent += 'html { font-family: "Root Font", serif; } body { font-family: inherit; }';
            expect(computed(paragraph).fontFamily.startsWith('"Root Font"'), 'Publisher root font was overridden');
            const fontStyle = doc.head.querySelector('[data-comistream-reader-font]');
            expect(!/fonts\\.(googleapis|gstatic)\\.com|@import/.test(fontStyle.textContent), 'Web font requested in packet saving mode');
            records.push({ language, writingMode });
        }
        expect(records.length === cases.length, 'Some chapters did not render');
    `);
});

test('Japanese vertical punctuation uses native metrics and preserves publisher features', { skip: !chrome }, async () => {
    await runBrowserFixture(`
        const view = { book: { metadata: { language: ['ja'] } } };
        const appConfig = { packetSave: true };
        const readerFontStyles = new WeakMap();
        ${fontCode}
        const frame = document.createElement('iframe');
        document.body.append(frame);
        const doc = frame.contentDocument;
        doc.documentElement.lang = 'ja';
        const publisher = doc.createElement('style');
        publisher.textContent = 'body { font-family: "Yu Mincho", serif; } .horizontal { writing-mode: horizontal-tb; }';
        doc.head.append(publisher);
        // 禁則の強さと縦横の混在にかかわらず、横組み用の字詰めを継承させないルン。
        doc.body.innerHTML = '<p style="line-break: loose">「星・月」や（太陽）</p>'
            + '<p style="line-break: normal">「星・月」や（太陽）</p>'
            + '<p style="line-break: strict">「星・月」や（太陽）</p>'
            + '<p class="horizontal">横組み：星・月</p>';
        applyReaderFontStyles(doc);
        const computed = element => frame.contentWindow.getComputedStyle(element);
        for (const writingMode of ['vertical-rl', 'vertical-lr', 'horizontal-tb']) {
            doc.documentElement.style.writingMode = writingMode;
            for (const paragraph of doc.querySelectorAll('p')) {
                expect(computed(paragraph).fontFeatureSettings === 'normal',
                    'Horizontal glyph adjustments leaked into ' + writingMode);
            }
        }
        // 書籍が指定した縦組み用・横組み用の機能は上書きしないルン。
        doc.documentElement.style.writingMode = 'vertical-rl';
        publisher.textContent += 'body { font-feature-settings: "vpal" 1; }'
            + '.horizontal { font-feature-settings: "palt" 1; }';
        applyReaderFontStyles(doc);
        expect(computed(doc.querySelector('p')).fontFeatureSettings === '"vpal"', 'Publisher vertical features were overridden');
        expect(computed(doc.querySelector('.horizontal')).fontFeatureSettings === '"palt"', 'Publisher horizontal features were overridden');
    `);
});
