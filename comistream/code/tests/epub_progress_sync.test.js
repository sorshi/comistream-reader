const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const progressCode = source.slice(source.indexOf('function localCfiKey()'), source.indexOf('function getSectionProgressFallback('));
const beaconCode = source.slice(source.indexOf('function sendProgressBeacon()'), source.indexOf('function commitSliderPosition()'));

function fixture({ savedCfi = 'server-cfi', savedUpdatedAt = 1790950980000, local = null, legacy = null } = {}) {
    const storage = new Map();
    if (local) storage.set('state:book.epub', JSON.stringify(local));
    if (legacy) storage.set('cfi:book.epub', legacy);
    const posts = [];
    const beacons = [];
    const context = vm.createContext({
        console, FormData, Date: { now: () => 1790950990000 },
        baseFile: 'book.epub', escapedFile: 'book.epub', csrfToken: 'fixture',
        CFI_STORAGE_PREFIX: 'cfi:', STATE_STORAGE_PREFIX: 'state:',
        PROGRESS_SAVE_DEBOUNCE_MS: 5000,
        savedCfi, savedUpdatedAt, currentLocation: { cfi: savedCfi, section: { current: 14 }, fraction: 0.7 },
        progressSaveReady: true, progressSaveTimer: null, progressSaveInFlight: false, progressSavePending: false, lastProgressSaveKey: '',
        localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
        window: { clearTimeout() {}, setTimeout: () => 1 },
        getLocationProgressMetrics: () => ({ currentPage: 15, totalPages: 20 }),
        debugLog() {},
        fetch: async (_url, options) => { posts.push(options.body.get('epub_cfi')); return { ok: true }; },
        navigator: { sendBeacon: (_url, data) => { beacons.push(data.get('epub_cfi')); return true; } }
    });
    vm.runInContext(progressCode + beaconCode, context);
    return { context, storage, posts, beacons };
}

test('newer server position wins over the position from a previously used device', () => {
    const f = fixture({ local: { cfi: 'old-device-cfi', updatedAt: 1790950745000 } });
    assert.equal(f.context.getStoredLocation(), 'server-cfi');
});

test('same-second server timestamp wins despite local millisecond precision', () => {
    const f = fixture({ local: { cfi: 'old-device-cfi', updatedAt: 1790950980638 } });
    assert.equal(f.context.getStoredLocation(), 'server-cfi');
});

test('strictly newer unsynced local position and guest fallback remain usable', () => {
    assert.equal(fixture({ local: { cfi: 'unsynced-cfi', updatedAt: 1790950981000 } }).context.getStoredLocation(), 'unsynced-cfi');
    assert.equal(fixture({ savedCfi: '', savedUpdatedAt: 0, legacy: 'guest-cfi' }).context.getStoredLocation(), 'guest-cfi');
    assert.equal(fixture({ savedCfi: '', savedUpdatedAt: 0 }).context.getStoredLocation(), null);
});

test('leaving an unchanged position does not refresh its local timestamp', () => {
    const local = { cfi: 'server-cfi', updatedAt: 1790950745000, fraction: 0.7, section: 14 };
    const f = fixture({ local });
    f.context.persistCurrentLocation();
    assert.equal(JSON.parse(f.storage.get('state:book.epub')).updatedAt, local.updatedAt);
    f.context.currentLocation.cfi = 'next-cfi';
    f.context.persistCurrentLocation();
    assert.equal(JSON.parse(f.storage.get('state:book.epub')).updatedAt, 1790950990000);
});

test('restoring a server position does not POST or beacon it back; later movement saves normally', async () => {
    const f = fixture();
    f.context.rememberRestoredServerPosition('server-cfi');
    await f.context.flushProgressSave();
    f.context.sendProgressBeacon();
    assert.deepEqual(f.posts, []);
    assert.deepEqual(f.beacons, []);
    f.context.currentLocation.cfi = 'next-cfi';
    await f.context.flushProgressSave();
    assert.deepEqual(f.posts, ['next-cfi']);
    f.context.sendProgressBeacon();
    assert.deepEqual(f.beacons, []);
    f.context.currentLocation.cfi = 'last-unsaved-cfi';
    f.context.sendProgressBeacon();
    assert.deepEqual(f.beacons, ['last-unsaved-cfi']);
});

test('intermediate relocation during startup cannot save locally or to the server', async () => {
    const f = fixture({ local: { cfi: 'previous-local-cfi', updatedAt: 1000 } });
    f.context.progressSaveReady = false;
    f.context.currentLocation.cfi = 'temporary-start-cfi';
    f.context.persistCurrentLocation();
    await f.context.flushProgressSave();
    f.context.sendProgressBeacon();
    assert.equal(JSON.parse(f.storage.get('state:book.epub')).cfi, 'previous-local-cfi');
    assert.deepEqual(f.posts, []);
    assert.deepEqual(f.beacons, []);
});

test('local restore and a failed server restore are not treated as acknowledged saves', async () => {
    const f = fixture();
    f.context.currentLocation.cfi = 'local-or-fallback-cfi';
    f.context.rememberRestoredServerPosition('server-cfi');
    await f.context.flushProgressSave();
    assert.deepEqual(f.posts, ['local-or-fallback-cfi']);
    const local = fixture();
    local.context.currentLocation.cfi = 'unsynced-cfi';
    local.context.rememberRestoredServerPosition('unsynced-cfi');
    local.context.sendProgressBeacon();
    assert.deepEqual(local.beacons, ['unsynced-cfi']);
});
