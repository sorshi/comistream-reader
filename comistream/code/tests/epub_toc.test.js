const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { chrome, runBrowserFixture } = require('./browser_fixture');

const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const navigation = section('async function jumpToFraction(', 'function getCurrentNavigationIndex(');
const toc = section('function renderTocItems(', 'async function goToMarkerCfi(');

function fixture({ items = [], sections = [{}, {}, {}], targets = {} } = {}) {
    const buttons = [];
    const jumps = [];
    const container = {
        set textContent(value) { buttons.length = 0; },
        appendChild(button) { buttons.push(button); }
    };
    const book = { toc: items, sections };
    const context = vm.createContext({
        view: {
            book,
            resolveNavigation(href) {
                if (href === 'broken.xhtml') throw new Error('Invalid TOC target');
                return { index: targets[href] };
            },
            goToFraction: async fraction => { jumps.push(fraction); },
            goTo: async href => { jumps.push(href); }
        },
        endNavigationSeq: 0,
        clamp: (value, min, max) => Math.min(Math.max(value, min), max),
        traceRestore() {},
        $: () => container,
        t: key => ({ toc_cover: '表紙', last_page: '最終ページ' })[key],
        document: {
            createElement() {
                return { addEventListener(type, callback) { this[type] = callback; } };
            }
        }
    });
    let pending;
    context.navigate = action => { pending = action(); return pending; };
    vm.runInContext(navigation + section('async function goToTocHref(', 'function getAdjacentEpubMarker(') + toc, context);
    return {
        context, book, buttons, jumps,
        labels: () => buttons.map(button => button.textContent),
        async click(index) { buttons[index].click(); await pending; }
    };
}

test('missing TOC endpoints appear around the original chapters and seek to the reading boundaries', async () => {
    const f = fixture({ items: [{ label: '第1章', href: 'chapter.xhtml#start' }], targets: { 'chapter.xhtml#start': 1 } });
    f.context.renderToc(f.book);
    assert.deepEqual(f.labels(), ['表紙', '第1章', '最終ページ']);
    assert.ok(f.buttons.every(button => button.type === 'button' && !button.disabled));
    await f.click(0);
    await f.click(1);
    await f.click(2);
    assert.deepEqual(f.jumps, [0, 'chapter.xhtml#start', 1]);
    assert.equal(f.context.endNavigationSeq, 1);
    assert.equal(f.book.toc.length, 1);
});

test('endpoint links in either child format prevent duplicate entries regardless of their labels', () => {
    const f = fixture({
        items: [{ label: '本', subitems: [
            { label: '扉', href: 'front.xhtml#title' },
            { label: '本文', children: [{ label: '奥付', href: 'colophon.xhtml' }] }
        ] }],
        targets: { 'front.xhtml#title': 0, 'colophon.xhtml': 2 }
    });
    f.context.renderToc(f.book);
    assert.deepEqual(f.labels(), ['本', '扉', '本文', '奥付']);
    assert.equal(f.buttons[0].disabled, true);
    assert.equal(f.buttons[2].disabled, true);
    assert.equal(f.buttons[1].className, 'epub-toc-item epub-toc-depth-1');
    assert.equal(f.buttons[3].className, 'epub-toc-item epub-toc-depth-2');
});

for (const [index, expected] of [[0, ['既存項目', '最終ページ']], [2, ['表紙', '既存項目']]]) {
    test(`only the missing endpoint is added when section ${index} already has a TOC link`, () => {
        const f = fixture({ items: [{ label: '既存項目', href: 'endpoint.xhtml' }], targets: { 'endpoint.xhtml': index } });
        f.context.renderToc(f.book);
        assert.deepEqual(f.labels(), expected);
    });
}

test('nonlinear resources outside the reading order do not suppress its boundary links', () => {
    const f = fixture({
        sections: [{ linear: 'no' }, {}, {}, { linear: 'no' }],
        items: [{ label: '補足', href: 'supplement.xhtml' }],
        targets: { 'supplement.xhtml': 3 }
    });
    f.context.renderToc(f.book);
    assert.deepEqual(f.labels(), ['表紙', '補足', '最終ページ']);
    f.book.toc = [{ label: '先頭', href: 'first.xhtml' }, { label: '末尾', href: 'last.xhtml' }];
    f.context.view.resolveNavigation = href => ({ index: href === 'first.xhtml' ? 1 : 2 });
    f.context.renderToc(f.book);
    assert.deepEqual(f.labels(), ['先頭', '末尾']);
});

test('books without a TOC get both links, including a single-section book, without accumulating buttons', () => {
    for (const sections of [[{}], [{}, {}]]) {
        const f = fixture({ sections });
        f.context.renderToc(f.book);
        f.context.renderToc(f.book);
        assert.deepEqual(f.labels(), ['表紙', '最終ページ']);
    }
});

test('books without readable sections do not get unusable boundary links', () => {
    for (const sections of [[], [{ linear: 'no' }]]) {
        const f = fixture({ sections });
        f.context.renderToc(f.book);
        assert.deepEqual(f.labels(), []);
    }
});

test('unresolvable TOC targets do not prevent the boundary links from being displayed', () => {
    const f = fixture({ items: [{ label: '壊れた項目', href: 'broken.xhtml' }, { label: '未知の項目', href: 'unknown.xhtml' }] });
    f.context.renderToc(f.book);
    assert.deepEqual(f.labels(), ['表紙', '壊れた項目', '未知の項目', '最終ページ']);
});

test('Chrome renders boundary buttons with native clicks and keeps EPUB TOC labels as text', { skip: !chrome }, async () => {
    await runBrowserFixture(`
        const jumps = [];
        const view = {
            book: { sections: [{}, {}, {}] },
            resolveNavigation: () => ({ index: 1 }),
            goToFraction: async fraction => { jumps.push(fraction); },
            goTo: async href => { jumps.push(href); }
        };
        let endNavigationSeq = 0;
        const $ = id => document.getElementById(id);
        const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
        const t = key => ({ toc_cover: 'Cover', last_page: 'Last Page' })[key];
        const navigate = action => action();
        function traceRestore() {}
        ${navigation}
        ${section('async function goToTocHref(', 'function getAdjacentEpubMarker(')}
        ${toc}
        renderToc({ ...view.book, toc: [{ label: '<img src=x onerror=alert(1)>', href: 'chapter.xhtml' }] });
        const buttons = document.querySelectorAll('#epub-toc button');
        expect(buttons.length === 3, 'Missing boundary buttons');
        expect(buttons[0].textContent === 'Cover' && buttons[2].textContent === 'Last Page', 'Wrong boundary labels');
        expect(!document.querySelector('#epub-toc img'), 'TOC label was interpreted as HTML');
        buttons.forEach(button => button.click());
        expect(JSON.stringify(jumps) === JSON.stringify([0, 'chapter.xhtml', 1]), 'Wrong navigation targets');
        expect(endNavigationSeq === 1, 'End navigation intent was not recorded');
    `, '<div id="epub-toc"></div>');
});
