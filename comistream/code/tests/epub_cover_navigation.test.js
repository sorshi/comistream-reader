const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const code = source.slice(source.indexOf('async function createEpubCoverSection('), source.indexOf('async function openEpubBook('));
const coverCfi = 'epubcfi(/6/2[comistream-cover]!/2)';

function fixture({ image = false, landmarks = [], fixed = false } = {}) {
    const sections = ['first.xhtml', 'cover.xhtml', 'body.xhtml'].map((id, index) => ({
        id, cfi: `epubcfi(/6/${2 * (index + 1)})`, linear: index === 1 ? 'no' : 'yes',
        createDocument: async () => ({ body: { textContent: image ? '' : 'Body', querySelector: () => image } })
    }));
    const anchor = () => 'original anchor';
    const book = {
        sections, landmarks, rendition: { layout: fixed ? 'pre-paginated' : 'reflowable' },
        resolveHref: href => ({ index: sections.findIndex(section => section.id === href), anchor }),
        resolveCFI: cfi => ({ index: sections.findIndex(section => section.cfi === cfi), anchor })
    };
    const context = vm.createContext({
        console, EPUB_SYNTHETIC_COVER_CFI: coverCfi,
        t: (_key, fallback) => fallback,
        hasEpubTypeToken: () => false,
        getNormalizedBodyText: doc => doc.body.textContent
    });
    vm.runInContext(code, context);
    return { book, sections, anchor, context };
}

test('a nonlinear cover becomes the first readable page without changing existing CFIs', async () => {
    const f = fixture({ landmarks: [{ type: ['cover'], href: 'cover.xhtml' }] });
    const cfis = f.sections.map(section => section.cfi);
    await f.context.prepareEpubCover(f.book);
    assert.deepEqual(Array.from(f.book.sections, section => section.id), ['cover.xhtml', 'first.xhtml', 'body.xhtml']);
    assert.equal(f.book.sections[0].linear, 'yes');
    for (const [index, cfi] of cfis.entries()) {
        const resolved = f.book.resolveCFI(cfi);
        assert.equal(f.book.sections[resolved.index], f.sections[index]);
        assert.equal(resolved.anchor, f.anchor);
        assert.equal(f.sections[index].cfi, cfi);
    }
    assert.equal(f.book.resolveHref('body.xhtml').index, 2);
    assert.equal(f.book.resolveHref('missing.xhtml').index, -1);
});

test('an existing first image page is kept without generating a second cover', async () => {
    const f = fixture({ image: true });
    f.context.createEpubCoverSection = () => assert.fail('Existing cover must be reused');
    await f.context.prepareEpubCover(f.book);
    await f.context.prepareEpubCover(f.book);
    assert.equal(f.book.sections.length, 3);
    assert.equal(f.book.sections[0], f.sections[0]);
    assert.equal(f.book.comistreamCover.synthetic, false);
});

test('an image-only cover gets its own page while old body links and CFIs still resolve to the body', async () => {
    const f = fixture();
    const cover = { id: 'comistream:cover', cfi: coverCfi };
    f.context.createEpubCoverSection = async () => cover;
    await f.context.prepareEpubCover(f.book);
    assert.equal(f.book.sections.length, 4);
    assert.equal(f.book.sections[0], cover);
    assert.equal(f.book.resolveCFI(coverCfi).index, 0);
    for (const [index, section] of f.sections.entries()) {
        assert.equal(f.book.resolveCFI(section.cfi).index, index + 1);
        assert.equal(f.book.resolveHref(section.id).index, index + 1);
    }
    assert.equal(f.book.comistreamCover.originalSectionCount, 3);
});

test('a book without a cover, an empty book, and fixed layout retain their reading order', async () => {
    for (const fixed of [false, true]) {
        const f = fixture({ fixed });
        f.context.createEpubCoverSection = async () => null;
        await f.context.prepareEpubCover(f.book);
        assert.equal(f.book.sections, f.sections);
        assert.equal(f.book.comistreamCover, undefined);
    }
    const f = fixture();
    f.book.sections = [];
    await f.context.prepareEpubCover(f.book);
    assert.equal(f.book.comistreamCover, undefined);
});

test('a missing or broken cover image leaves the body readable and releases temporary URLs', async () => {
    const f = fixture();
    f.context.console = { warn() {} };
    assert.equal(await f.context.createEpubCoverSection({ getCover: async () => null }), null);
    assert.equal(await f.context.createEpubCoverSection({ getCover: async () => { throw new Error('Missing image'); } }), null);
    const released = [];
    f.context.URL = { createObjectURL: () => 'blob:cover', revokeObjectURL: url => released.push(url) };
    f.context.document = { createElement: () => ({ decode: async () => { throw new Error('Broken image'); } }) };
    assert.equal(await f.context.createEpubCoverSection({ getCover: async () => ({ size: 12, type: 'image/jpeg' }) }), null);
    assert.deepEqual(released, ['blob:cover']);
});
