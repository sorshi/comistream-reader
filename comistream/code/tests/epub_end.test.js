const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { normalizeSuggestions, isForwardSwipe, create } = require('../epub_end');

const options = { publicDir: '/nas', baseFile: 'Current.epub', readerUrl: 'https://reader.invalid/cgi-bin/comistream.php?file=Current.epub&mode=open#old' };

test('suggestions retain classification order, encode filenames and exclude unsafe and duplicate paths', () => {
    const title = '<img src=x onerror=alert(1)>';
    const rows = normalizeSuggestions({
        title: { new: { [title]: '/nas/次 & #?.cbz', current: '/nas/Current.epub', remote: '//evil.invalid/book.cbz',
            prefix: '/nas-other/book.cbz', traversal: '/nas/../book.cbz', windows: '/nas/a\\b.cbz', control: '/nas/a\n.cbz' },
        old: { previous: '/nas/Previous.cbz', duplicate: '/nas/次 & #?.cbz' } },
        author: { another: '/nas/Another.pdf', external: 'https://evil.invalid/book.cbz' }
    }, options);
    assert.deepEqual(rows.map(row => row.title), [title, 'previous', 'another']);
    const url = new URL(rows[0].href);
    assert.equal(url.origin, 'https://reader.invalid');
    assert.equal(url.pathname, '/cgi-bin/comistream.php');
    assert.equal(url.searchParams.get('file'), '次 & #?.cbz');
    assert.equal(url.searchParams.get('mode'), 'open');
    assert.equal(url.hash, '');
});

test('root deployments, literal percent signs, partial and empty JSON are supported', () => {
    const root = { ...options, publicDir: '' };
    const rows = normalizeSuggestions({ author: { book: '/folder/100% & %2e.cbz', relative: 'folder/book.cbz' } }, root);
    assert.equal(rows.length, 1);
    assert.equal(new URL(rows[0].href).searchParams.get('file'), 'folder/100% & %2e.cbz');
    for (const data of [null, 'invalid', [], {}, { title: { new: [], old: {} }, author: { bad: 42 } }]) {
        assert.deepEqual(normalizeSuggestions(data, options), []);
    }
});

test('forward swipes follow RTL, LTR and the vertical block axis with the existing distance threshold', () => {
    assert.equal(isForwardSwipe(40, 0, { rtl: true, vertical: true }), true);
    assert.equal(isForwardSwipe(-40, 0, { rtl: false, vertical: false }), true);
    assert.equal(isForwardSwipe(-40, 0, { rtl: true, vertical: true }), false);
    assert.equal(isForwardSwipe(39, 0, { rtl: true, vertical: true }), false);
    assert.equal(isForwardSwipe(0, -50, { rtl: true, vertical: true }), true);
    assert.equal(isForwardSwipe(0, 50, { rtl: true, vertical: true }), false);
    assert.equal(isForwardSwipe(0, -50, { rtl: false, vertical: false }), false);
});

function fixture(fetch, onError = () => {}) {
    return create({ ...options, document: { getElementById: () => null }, isAtEnd: () => false, fetch, onError });
}

test('404 is silent, skips JSON parsing and is requested only once per reader', async () => {
    let calls = 0;
    const controller = fixture(async (url, init) => {
        calls++;
        assert.equal(url, '/suggest.php?booktitle=Current.epub');
        assert.equal(init.credentials, 'same-origin');
        assert.equal(init.headers.Accept, 'application/json');
        return { status: 404, ok: false, json: () => assert.fail('404 body must not be parsed') };
    }, () => assert.fail('404 must not report an error'));
    await Promise.all([controller.startSuggestions(), controller.startSuggestions()]);
    await controller.startSuggestions();
    assert.equal(calls, 1);
    assert.equal(controller.isOpen(), false);
});

test('HTTP errors, broken JSON and network failures are caught without retry or reader errors', async () => {
    for (const fetch of [
        async () => ({ status: 503, ok: false }),
        async () => ({ status: 200, ok: true, json: async () => { throw new SyntaxError('bad JSON'); } }),
        async () => { throw new Error('offline'); }
    ]) {
        const errors = [];
        const controller = fixture(fetch, error => errors.push(error));
        await controller.startSuggestions();
        await controller.startSuggestions();
        assert.equal(errors.length, 1);
        assert.equal(controller.isOpen(), false);
    }
});

test('slow suggestion requests time out and settle without blocking reader state', async () => {
    let timeout, timeoutCleared = false;
    const scope = vm.createContext({ window: {
        setTimeout(callback, delay) { assert.equal(delay, 5000); timeout = callback; return 1; },
        clearTimeout() { timeoutCleared = true; }
    }, AbortController, URL });
    vm.runInContext(fs.readFileSync(require.resolve('../epub_end'), 'utf8'), scope);
    const errors = [];
    const controller = scope.window.ComistreamEpubEnd.create({ ...options,
        document: { getElementById: () => null }, isAtEnd: () => false,
        fetch: async (_, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
        onError: error => errors.push(error)
    });
    const loading = controller.startSuggestions();
    assert.equal(controller.isOpen(), false);
    timeout();
    await loading;
    assert.equal(timeoutCleared, true);
    assert.equal(errors.length, 1);
});
