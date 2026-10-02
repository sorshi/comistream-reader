const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const start = source.indexOf('function didNavigateForward(');
const end = source.indexOf('function markEpubCompletedIfAtEnd(', start);
const context = vm.createContext({
    viewInitialized: true,
    currentLocation: { cfi: 'epubcfi(/6/2!/4/2:0)', section: { current: 2 } },
    view: {
        renderer: { atEnd: true },
        book: { sections: [{}, {}, {}] }
    }
});
vm.runInContext(source.slice(start, end), context);

test('a stable location on the last readable section counts as the book end', () => {
    assert.equal(context.isEpubAtEndOfLinearReadingOrder(), true);
});

test('opening the book at its start does not count as reaching the end', () => {
    context.view.renderer.atEnd = false;
    assert.equal(context.isEpubAtEndOfLinearReadingOrder(), false);
});

test('a nonlinear section after the last readable section is not the reading end', () => {
    context.view.book.sections.push({ linear: 'no' });
    context.currentLocation.section.current = 3;
    context.view.renderer.atEnd = true;
    assert.equal(context.isEpubAtEndOfLinearReadingOrder(), false);
});

test('an incomplete location cannot mark the book as read', () => {
    context.currentLocation.cfi = '';
    context.currentLocation.section.current = 2;
    assert.equal(context.isEpubAtEndOfLinearReadingOrder(), false);
});

test('only forward movement within a section counts as progress toward completion', () => {
    assert.equal(context.didNavigateForward(
        { section: 2, fraction: 0.4 },
        { section: 2, fraction: 0.8 }
    ), true);
    assert.equal(context.didNavigateForward(
        { section: 2, fraction: 0.8 },
        { section: 2, fraction: 0.4 }
    ), false);
});

test('moving to a later section counts as forward progress even when its fraction restarts', () => {
    assert.equal(context.didNavigateForward(
        { section: 1, fraction: 0.95 },
        { section: 2, fraction: 0.02 }
    ), true);
    assert.equal(context.didNavigateForward(
        { section: 2, fraction: 0.02 },
        { section: 1, fraction: 0.95 }
    ), false);
});
