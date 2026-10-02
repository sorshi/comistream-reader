const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const start = source.indexOf('function setPaginatedSwipeMinimumDistance(');
const end = source.indexOf('function isValidThemeName(', start);
const context = vm.createContext({ EPUB_PAGE_SWIPE_MIN_DISTANCE_PX: 40 });
vm.runInContext(source.slice(start, end), context);

function renderer() {
    return {
        attributes: new Map(),
        setAttribute(name, value) {
            this.attributes.set(name, value);
        },
        removeAttribute(name) {
            this.attributes.delete(name);
        }
    };
}

test('reflowable paginated reading enables the swipe distance threshold', () => {
    const target = renderer();
    context.setPaginatedSwipeMinimumDistance(target, false, 'paginated');
    assert.equal(target.attributes.get('swipe-min-distance'), '40');
});

test('fixed-layout and scrolled reading remove the swipe distance threshold', () => {
    for (const [isFixedLayout, flowMode] of [[true, 'paginated'], [false, 'scrolled']]) {
        const target = renderer();
        target.setAttribute('swipe-min-distance', '40');
        context.setPaginatedSwipeMinimumDistance(target, isFixedLayout, flowMode);
        assert.equal(target.attributes.has('swipe-min-distance'), false);
    }
});
