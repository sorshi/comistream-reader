const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { chrome, runBrowserFixture } = require('./browser_fixture');

const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const cssCode = source.slice(source.indexOf('function buildReaderCSS('), source.indexOf('function buildRendererPrefsSignature('));

function fixture() {
    const context = vm.createContext({
        currentDirectionOverride: 'auto', currentWritingModeOverride: 'auto', theme: 'paper',
        resolveEffectiveReadingMode: () => ({ vertical: true, rtl: true }),
        getEffectiveThemeName: () => context.theme,
        getEffectiveTheme: () => ({ bg: '#fff', color: '#000', colorScheme: 'light' })
    });
    vm.runInContext(cssCode, context);
    return context;
}

test('packet saving omits Google Fonts across theme and font size changes', () => {
    const context = fixture();
    for (const theme of ['paper', 'white', 'dark', 'system']) {
        context.theme = theme;
        for (const scale of [0.8, 1, 2]) {
            const css = context.buildReaderCSS(scale, true);
            assert.doesNotMatch(css, /fonts\.googleapis\.com|fonts\.gstatic\.com|@import|BIZ UDMincho/);
            assert.match(css, /"Hiragino Mincho ProN", "Hiragino Mincho Pro",\s*"Noto Serif CJK JP", "Noto Serif JP", "YuMincho", "Yu Mincho", serif !important/);
            assert.ok(css.includes(`font-size: ${Math.round(scale * 100)}% !important;`));
        }
    }
});

test('normal mode keeps the existing Google Fonts import and family order', () => {
    const context = fixture();
    assert.match(context.buildReaderCSS(1, false), /@import url\('https:\/\/fonts\.googleapis\.com\/css2\?family=BIZ\+UDMincho:wght@400;700&display=swap'\);/);
    assert.match(context.buildReaderCSS(1, false), /"BIZ UDMincho", "Noto Serif JP", "YuMincho", "Yu Mincho",\s*"Hiragino Mincho ProN", serif !important/);
    assert.equal(context.buildReaderCSS(1), context.buildReaderCSS(1, false));
});

test('browser renders vertical ruby and bold text without requesting web fonts', { skip: !chrome }, async () => {
    await runBrowserFixture(`
        window.testDone = false;
        const currentDirectionOverride = 'auto', currentWritingModeOverride = 'auto';
        const resolveEffectiveReadingMode = () => ({ vertical: true, rtl: true });
        let theme = 'paper';
        const getEffectiveThemeName = () => theme;
        const getEffectiveTheme = () => ({ bg: '#fff', color: '#000', colorScheme: 'light' });
        ${cssCode}
        (async () => {
            const frame = document.querySelector('iframe');
            const doc = frame.contentDocument;
            const style = doc.createElement('style');
            doc.head.append(style);
            doc.documentElement.lang = 'ja';
            doc.body.innerHTML = '<p style="writing-mode:vertical-rl"><ruby>明朝体<rt>みんちょうたい</rt></ruby>の本文、句読点。<strong>太字</strong></p>';
            for (const nextTheme of ['paper', 'dark', 'white']) {
                theme = nextTheme;
                style.textContent = buildReaderCSS(1.2, true);
                await doc.fonts.ready;
                expect(doc.querySelector('ruby').getBoundingClientRect().height > 0, 'Ruby text did not render');
                expect(frame.contentWindow.getComputedStyle(doc.querySelector('strong')).fontWeight === '700', 'Bold text was lost');
                expect(frame.contentWindow.getComputedStyle(doc.body).fontFamily.endsWith('serif'), 'Generic serif fallback is missing');
            }
            const resources = [...performance.getEntriesByType('resource'), ...frame.contentWindow.performance.getEntriesByType('resource')];
            expect(!resources.some(entry => /fonts\\.(googleapis|gstatic)\\.com/.test(entry.name)), 'Google Fonts was requested');
            window.testDone = true;
        })().catch(error => {
            window.testFailed = true;
            document.getElementById('result').textContent = error.stack;
        });
    `, '<iframe></iframe>');
});
