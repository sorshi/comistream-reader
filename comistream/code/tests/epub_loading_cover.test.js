const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const code = source.slice(source.indexOf('function setupInitialLoadingCover('), source.indexOf('function getBookDisplayMetadata('));

function fixture({ complete = false, naturalWidth = 0, missing = false } = {}) {
    const listeners = new Map();
    const cover = {
        complete, naturalWidth, hidden: true, isConnected: !missing,
        addEventListener: (name, handler) => listeners.set(name, handler),
        remove() { this.isConnected = false; }
    };
    const loading = [];
    const context = vm.createContext({
        $: () => cover.isConnected ? cover : null,
        setReaderLoading: (visible) => loading.push(visible)
    });
    vm.runInContext(code, context);
    return { cover, context, loading, listeners };
}

test('cached and asynchronously loaded covers appear without waiting', () => {
    for (const complete of [true, false]) {
        const f = fixture({ complete, naturalWidth: complete ? 400 : 0 });
        assert.equal(f.context.setupInitialLoadingCover(), undefined);
        if (!complete) {
            assert.equal(f.cover.hidden, true);
            f.cover.naturalWidth = 400;
            f.listeners.get('load')();
        }
        assert.equal(f.cover.hidden, false);
        assert.deepEqual(f.loading, []);
    }
});

test('missing, broken, and failed images leave loading behavior intact', () => {
    for (const options of [{ missing: true }, { complete: true }, {}]) {
        const f = fixture(options);
        f.context.setupInitialLoadingCover();
        if (!options.missing && !options.complete) f.listeners.get('error')();
        assert.equal(f.cover.isConnected, false);
        f.context.hideReaderLoading();
        assert.deepEqual(f.loading, [false]);
    }
});

test('finishing startup removes the cover even when its load event arrives later', () => {
    const f = fixture();
    f.context.setupInitialLoadingCover();
    f.context.hideReaderLoading();
    f.cover.naturalWidth = 400;
    f.listeners.get('load')();
    assert.equal(f.cover.isConnected, false);
    assert.equal(f.cover.hidden, true);
    f.context.setupInitialLoadingCover();
    assert.equal(f.cover.isConnected, false);
});
