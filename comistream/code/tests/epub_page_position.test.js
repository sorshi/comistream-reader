const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const start = source.indexOf('function calculateSectionPagePosition(');
const end = source.indexOf('function getPagePositionReadout(', start);
const context = vm.createContext({ PAGE_POSITION_INTEGER_TOLERANCE: 0.001 });
vm.runInContext(source.slice(start, end), context);

test('single-page positions count screens within the ordered book section', () => {
    assert.deepEqual(
        { ...context.calculateSectionPagePosition({ index: 2, fraction: 11 / 34, size: 1 / 34 }) },
        { section: 3, page: 12, totalPages: 34, label: '3–12' }
    );
});

test('a two-column spread counts as one screen and keeps a trailing half-spread', () => {
    assert.deepEqual(
        { ...context.calculateSectionPagePosition({ index: 2, fraction: 66 / 67, size: 2 / 67 }) },
        { section: 3, page: 34, totalPages: 34, label: '3–34' }
    );
});

test('a short section is one screen and the next section starts at screen one', () => {
    assert.deepEqual(
        { ...context.calculateSectionPagePosition({ index: 3, fraction: 0, size: 1 }) },
        { section: 4, page: 1, totalPages: 1, label: '4–1' }
    );
    assert.deepEqual(
        { ...context.calculateSectionPagePosition({ index: 3, fraction: 0, size: 2 }) },
        { section: 4, page: 1, totalPages: 1, label: '4–1' }
    );
});

test('incomplete, out-of-range, and non-finite renderer positions are hidden', () => {
    for (const location of [
        null,
        { index: -1, fraction: 0, size: 1 },
        { index: 1.5, fraction: 0, size: 1 },
        { index: 0, fraction: 0.25, size: 0.1 },
        { index: 0, fraction: 1.1, size: 0.1 },
        { index: 0, fraction: 0, size: 0 },
        { index: 0, fraction: 0, size: 2.1 },
        { index: 0, fraction: Number.NaN, size: 0.5 },
        { index: 0, fraction: 0.5, size: Number.POSITIVE_INFINITY }
    ]) {
        assert.equal(context.calculateSectionPagePosition(location), null);
    }
});
