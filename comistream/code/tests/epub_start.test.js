const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const init = between('async function init()', "document.addEventListener('DOMContentLoaded'");
const initialNavigation = init.slice(init.indexOf('    if (location) {'), init.indexOf('\n    if (!view.lastLocation) {'));

function fixture({ sections = [{ id: 'cover.xhtml' }, { id: 'text.xhtml' }], landmarks = [], targets = {}, location = null, restoreFails = false } = {}) {
    const moves = [];
    const restored = [];
    const context = vm.createContext({
        location,
        view: {
            book: { sections, landmarks },
            resolveNavigation(href) {
                if (href === 'broken.xhtml') throw new Error('Invalid cover target');
                return { index: targets[href] };
            },
            async init(options) {
                if (options.lastLocation) {
                    restored.push(options.lastLocation);
                    if (restoreFails) throw new Error('Invalid saved location');
                    moves.push(options.lastLocation);
                } else if (options.showTextStart) {
                    moves.push('text.xhtml');
                }
            },
            async goTo(target) { moves.push(target); }
        },
        initialRestoreCfi: '', initialRestoreReconcileUntil: 0,
        initialRestoreTargetInfo: null, beforeInitialRelocationSeq: 0,
        beforeInitialLocation: null, relocationEventSeq: 0, currentLocation: null,
        normalizeNavigationTarget: target => ({ target }),
        summarizeLocation: () => ({}),
        traceRestore() {}, debugLog() {}, perf() {}, clearInitialRestorePin() {},
        console: { warn() {} }
    });
    vm.runInContext(between('function resolveNavigationIndex(', 'function getCurrentNavigationIndex(')
        + between('function getDefaultStartTarget(', 'function bindViewLifecycleEvents('), context);
    return {
        context, moves, restored,
        open: () => vm.runInContext(`(async () => { ${initialNavigation} })()`, context)
    };
}

test('first open chooses the cover landmark even when bodymatter comes first', async () => {
    const f = fixture({
        landmarks: [
            { type: ['bodymatter'], href: 'text.xhtml' },
            { type: ['cover'], href: 'cover.xhtml#art' }
        ],
        targets: { 'text.xhtml': 1, 'cover.xhtml#art': 0 }
    });
    await f.open();
    assert.deepEqual(f.moves, ['cover.xhtml#art']);
    assert.deepEqual(f.restored, []);
});

test('EPUB2 cover guides and non-linear cover sections remain eligible', async () => {
    const f = fixture({
        sections: [{}, { id: 'cover.xhtml', linear: 'no' }, {}],
        landmarks: [{ type: ['cover'], href: 'cover.xhtml' }, { type: ['text'], href: 'text.xhtml' }],
        targets: { 'cover.xhtml': 1, 'text.xhtml': 2 }
    });
    await f.open();
    assert.deepEqual(f.moves, ['cover.xhtml']);
});

test('without a usable cover landmark first open uses the first section', async () => {
    for (const landmarks of [
        [],
        [{ type: ['bodymatter'], href: 'text.xhtml' }],
        [{ type: ['cover'] }],
        [{ type: ['cover'], href: 'missing.xhtml' }],
        [{ type: ['cover'], href: 'cover.jpg' }],
        [{ type: ['cover'], href: 'outside.xhtml' }],
        [{ type: ['cover'], href: 'broken.xhtml' }]
    ]) {
        const f = fixture({
            sections: [{ id: 'cover.xhtml', linear: 'no' }, { id: 'text.xhtml' }],
            landmarks, targets: { 'text.xhtml': 1, 'cover.jpg': -1, 'outside.xhtml': 2 }
        });
        await f.open();
        assert.deepEqual(f.moves, [0]);
    }
});

test('saved reading locations are restored instead of opening the cover', async () => {
    const f = fixture({ location: 'saved-cfi' });
    await f.open();
    assert.deepEqual(f.moves, ['saved-cfi']);
    assert.deepEqual(f.restored, ['saved-cfi']);
});

test('failed restore falls back to the same cover target as first open', async () => {
    const f = fixture({
        location: 'invalid-cfi', restoreFails: true,
        landmarks: [{ type: ['cover'], href: 'cover.xhtml' }], targets: { 'cover.xhtml': 0 }
    });
    await f.open();
    assert.deepEqual(f.moves, ['cover.xhtml']);
});

test('empty books have no start target', () => {
    assert.equal(fixture({ sections: [] }).context.getDefaultStartTarget(), null);
});
