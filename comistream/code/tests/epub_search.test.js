const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));

function fixture({ permitted = true, visible = true, fail = false } = {}) {
    const moves = [], options = [];
    const context = vm.createContext({
        searchNavigationActive: false, userScrollIntentUntil: 100, completionCheckTimer: 8,
        currentLocation: { cfi: 'initial' }, window: { clearTimeout() {} },
        view: { goTo: async cfi => { if (fail) throw Error('failed'); moves.push(cfi); } },
        resolveNavigationIndex: () => 2, isSearchTargetVisible: () => visible
    });
    context.navigate = async (action, config) => {
        options.push(config);
        if (!permitted) return;
        context.currentLocation = { cfi: 'position-after-sync' };
        try { await action(); } catch (_) { /* Readerが処理する例外を再現するルン。 */ }
    };
    vm.runInContext(section('async function moveToSearchCfi(', 'function initializeEpubSearch('), context);
    return { context, moves, options };
}

test('search captures the position after synchronization and saves without completing the book', async () => {
    const f = fixture();
    const result = await f.context.moveToSearchCfi('target', () => true);
    assert.equal(result.ok, true);
    assert.equal(result.beforeCfi, 'position-after-sync');
    assert.deepEqual(f.moves, ['target']);
    assert.equal(f.options[0].allowReadCompletion, false);
    assert.equal(f.options[0].recordProgress, true);
    assert.equal(f.context.searchNavigationActive, false);
    assert.equal(f.context.userScrollIntentUntil, 0);
    assert.equal(f.context.completionCheckTimer, null);
});

for (const [name, settings] of [['sync canceled', {permitted:false}], ['render failed', {visible:false}], ['navigation threw', {fail:true}]]) {
    test(`search cannot report success when ${name}`, async () => {
        const f = fixture(settings);
        const result = await f.context.moveToSearchCfi('target', () => true);
        assert.equal(result.ok, false);
        assert.equal(f.context.searchNavigationActive, false);
    });
}

test('an invalidated search cannot navigate after waiting for synchronization', async () => {
    const f = fixture();
    const result = await f.context.moveToSearchCfi('old-query', () => false);
    assert.equal(result.ok, false);
    assert.deepEqual(f.moves, []);
});

test('search suppresses delayed scroll completion and restores normal completion afterwards', () => {
    let completed = 0;
    const context = vm.createContext({
        searchNavigationActive:true, epubProgressManager:{}, recordEpubUserPosition:()=>completed++,
        isNavigationReady:()=>true, isEpubAtEndOfLinearReadingOrder:()=>true
    });
    vm.runInContext(section('function markEpubCompletedIfAtEnd(', 'function noteEpubScrollIntent('), context);
    assert.equal(context.markEpubCompletedIfAtEnd('stale-scroll'), false);
    assert.equal(completed, 0);
    context.searchNavigationActive = false;
    assert.equal(context.markEpubCompletedIfAtEnd('user-navigation'), true);
    assert.equal(completed, 1);
});

test('section-only CFI succeeds at a visible section start or fixed page, not a later reflow page', () => {
    const context = vm.createContext({
        view:{resolveNavigation:()=>({index:0}),getCFI:()=> 'section-cfi',renderer:{start:0},isFixedLayout:false},
        getRendererContents:()=>[{index:0,doc:{}}], isNavigationReadyForIndex:()=>true,
        isEpubSectionVisible:()=>true
    });
    vm.runInContext(section('function isSearchTargetVisible(', 'async function moveToSearchCfi('), context);
    assert.equal(context.isSearchTargetVisible('section-cfi'), true);
    context.view.renderer.start = 100;
    assert.equal(context.isSearchTargetVisible('section-cfi'), false);
    context.view.isFixedLayout = true;
    assert.equal(context.isSearchTargetVisible('section-cfi'), true);
});
