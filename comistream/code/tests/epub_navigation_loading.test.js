const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const spinnerDelay = Number(source.match(/const NAVIGATION_SPINNER_DELAY_MS = (\d+);/)[1]);
const section = (start, end) => {
    const from = source.indexOf(start);
    return from < 0 ? '' : source.slice(from, source.indexOf(end, from));
};

function fixture() {
    const timers = new Map();
    const loading = [];
    let timerId = 0, now = 0;
    const context = vm.createContext({
        console: { warn() {}, error() {} }, viewInitialized: true, readerClosing: false,
        $: () => null,
        loadingFeedbackRenderers: new WeakSet(),
        currentFlowMode: 'paginated', currentLocation: { cfi: 'before' }, view: {},
        navigationIntentSeq: 0, pendingNavigationCount: 0, navigationChain: Promise.resolve(),
        forwardNavigationSeq: 0, endNavigationSeq: 0, navigationEventSeq: 0,
        relocationEventSeq: 0, rendererVisibilityGuardSeq: 0,
        NAVIGATION_SPINNER_DELAY_MS: spinnerDelay, NAVIGATION_SETTLE_TIMEOUT_MS: 2600,
        window: {
            setTimeout: (callback, delay) => { timers.set(++timerId, { callback, at: now + delay }); return timerId; },
            clearTimeout: id => timers.delete(id)
        },
        setReaderLoading: visible => loading.push(visible), hideReaderLoading: () => loading.push(false),
        waitAnimationFrame: async () => {},
        epubProgressManager: { beforeNavigation: async () => true },
        waitForNavigationReady: async () => true, waitForNavigationSettled: async () => true,
        normalizeNavigationTarget: () => ({}), stabilizeRendererVisibility: async () => false,
        ensureLocationForNavigationTarget: () => false, isEpubAtEndOfLinearReadingOrder: () => false,
        summarizeLocation: () => ({ cfi: 'before' }), getRendererDiagnostics: () => ({}),
        t: (key, fallback) => fallback,
        ...Object.fromEntries(['debugLog', 'cancelPageTurnAnimation', 'clearInitialRestorePin',
            'scheduleRendererVisibilityGuard', 'focusReader', 'ensureRendererVisible'].map(name => [name, () => {}]))
    });
    vm.runInContext(section('function createNavigationLoadingFeedback(', 'function getBookDisplayMetadata('), context);
    if (context.createNavigationLoadingFeedback) context.navigationLoadingFeedback = context.createNavigationLoadingFeedback();
    vm.runInContext(section('async function navigate(', 'async function jumpToFraction('), context);
    const advance = ms => {
        now += ms;
        for (const [id, timer] of [...timers]) {
            if (timer.at <= now) { timers.delete(id); timer.callback(); }
        }
    };
    return { context, loading, timers, advance, tick: () => new Promise(setImmediate), show: () => advance(spinnerDelay) };
}

for (const boundary of ['sync', 'renderer', 'action']) {
    test(`slow ${boundary} wait displays feedback and cleans up on completion`, async () => {
        const f = fixture();
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        if (boundary === 'sync') f.context.epubProgressManager.beforeNavigation = () => gate;
        if (boundary === 'renderer') f.context.waitForNavigationReady = () => gate;
        const navigation = f.context.navigate(() => boundary === 'action' ? gate : null);
        await f.tick();
        f.show();
        try { assert.deepEqual(f.loading, [true]); }
        finally { release(true); await navigation; }
        assert.deepEqual(f.loading, [true, false]);
        assert.equal(f.timers.size, 0);
    });
}

test('fast navigation finishes without flashing the loading overlay', async () => {
    const f = fixture();
    await f.context.navigate(() => null);
    assert.deepEqual(f.loading, []);
    assert.equal(f.timers.size, 0);
});

for (const result of [false, 'error']) {
    test(`feedback is removed when synchronization ${result === false ? 'consumes navigation' : 'fails'}`, async () => {
        const f = fixture();
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        f.context.epubProgressManager.beforeNavigation = async () => {
            await gate;
            if (result === 'error') throw new Error('Synchronization failed');
            return false;
        };
        const navigation = f.context.navigate(() => assert.fail('Navigation was consumed'));
        await f.tick(); f.show(); release(); await navigation;
        assert.deepEqual(f.loading, [true, false]);
        assert.equal(f.timers.size, 0);
        assert.equal(f.context.pendingNavigationCount, 0);
    });
}

test('overlapping operations keep feedback until the final operation finishes', () => {
    const f = fixture();
    const first = f.context.navigationLoadingFeedback.begin();
    const second = f.context.navigationLoadingFeedback.begin();
    f.show();
    first(); first();
    assert.equal(f.loading.at(-1), true);
    second();
    assert.equal(f.loading.at(-1), false);
    assert.equal(f.loading.filter(value => !value).length, 1);
});

test('native swipe navigation shows feedback, preserves the receiver and cleans up on rejection', async () => {
    const f = fixture();
    let reject;
    const gate = new Promise((resolve, fail) => { reject = fail; });
    const renderer = { snap(...args) {
        assert.equal(this, renderer);
        assert.deepEqual(args, [1, 2, 3, 4, 5]);
        return gate;
    } };
    f.context.view = { renderer, book: { sections: [] } };
    f.context.setupRendererLoadingFeedback();
    const wrapped = renderer.snap;
    f.context.setupRendererLoadingFeedback();
    assert.equal(renderer.snap, wrapped);
    const snapping = renderer.snap(1, 2, 3, 4, 5);
    f.show();
    assert.deepEqual(f.loading, [true]);
    reject(new Error('Section failed'));
    await assert.rejects(snapping, /Section failed/);
    assert.deepEqual(f.loading, [true, false]);
    assert.equal(f.timers.size, 0);
});

test('chapter feedback waits for the configured delay without postponing section loading', async () => {
    const f = fixture();
    const calls = [];
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const section = { load(value) {
        assert.equal(this, section);
        calls.push(value);
        return gate;
    } };
    const renderer = { next: () => section.load('chapter') };
    f.context.view = { renderer, book: { sections: [section] } };
    f.context.setupRendererLoadingFeedback();
    const navigation = renderer.next();
    try {
        await f.tick();
        assert.deepEqual(calls, ['chapter']);
        assert.deepEqual(f.loading, []);
        f.advance(spinnerDelay - 1);
        assert.deepEqual(f.loading, []);
        f.advance(1);
        assert.deepEqual(f.loading, [true]);
    } finally { release('chapter-url'); }
    assert.equal(await navigation, 'chapter-url');
    assert.deepEqual(calls, ['chapter']);
    assert.deepEqual(f.loading, [true, false]);
    assert.equal(f.timers.size, 0);
});

test('fast chapter changes through page buttons and swipes never flash feedback', async () => {
    for (const method of ['next', 'snap']) {
        const f = fixture();
        const section = { load: () => 'chapter-url' };
        const renderer = { [method]: () => section.load() };
        f.context.view = { renderer, book: { sections: [section] } };
        f.context.setupRendererLoadingFeedback();
        assert.equal(await renderer[method](), 'chapter-url');
        f.advance(spinnerDelay);
        assert.deepEqual(f.loading, []);
        assert.equal(f.timers.size, 0);
    }
});

test('startup and background preload do not activate chapter feedback', async () => {
    for (const mode of ['startup', 'preload', 'scrolled']) {
        const f = fixture();
        let frames = 0;
        f.context.waitAnimationFrame = async () => { frames++; };
        f.context.viewInitialized = mode !== 'startup';
        f.context.currentFlowMode = mode === 'scrolled' ? 'scrolled' : 'paginated';
        const section = { load: () => 'chapter-url' };
        const renderer = { next: () => section.load() };
        f.context.view = { renderer, book: { sections: [section] } };
        f.context.setupRendererLoadingFeedback();
        assert.equal(await (mode === 'preload' ? section.load() : renderer.next()), 'chapter-url');
        assert.deepEqual(f.loading, []);
        assert.equal(frames, 0);
        assert.equal(f.timers.size, 0);
    }
});

function compositorFixture() {
    const f = fixture();
    const animations = [];
    const events = [];
    const overlay = {
        style: {}, attributes: new Map(),
        setAttribute(name, value) { this.attributes.set(name, value); },
        animate(keyframes, options) {
            const animation = { keyframes, options, cancelled: false, cancel() {
                this.cancelled = true; events.push('cancel');
            } };
            animations.push(animation);
            return animation;
        }
    };
    f.context.$ = () => overlay;
    f.context.hideReaderLoading = () => { overlay.setAttribute('aria-hidden', 'true'); events.push('hide'); };
    return { ...f, overlay, animations, events };
}

test('compositor feedback uses the configured delay once and cancels before short work becomes visible', () => {
    const f = compositorFixture();
    const first = f.context.navigationLoadingFeedback.begin();
    f.advance(spinnerDelay - 1);
    const second = f.context.navigationLoadingFeedback.begin();
    assert.equal(f.animations.length, 1);
    const animation = f.animations[0];
    assert.equal(animation.keyframes[0].opacity, 0);
    assert.equal(animation.options.delay, spinnerDelay);
    assert.equal(animation.options.fill, 'both');
    assert.equal(f.overlay.style.transition, 'none');
    assert.equal(f.overlay.attributes.get('aria-hidden'), 'true');
    first();
    assert.equal(animation.cancelled, false);
    second();
    assert.equal(animation.cancelled, true);
    assert.deepEqual(f.events, ['hide', 'cancel']);
    f.advance(spinnerDelay);
    assert.equal(f.overlay.attributes.get('aria-hidden'), 'true');
    assert.equal(f.timers.size, 0);
});

test('chapter parsing waits only for transparent compositor preparation and cleanup also handles failure', async () => {
    const f = compositorFixture();
    const frames = [];
    let started = false;
    f.context.waitAnimationFrame = () => new Promise(resolve => frames.push(resolve));
    const section = { load() { started = true; throw new Error('Invalid chapter'); } };
    const renderer = { next: () => section.load() };
    f.context.view = { renderer, book: { sections: [section] } };
    f.context.setupRendererLoadingFeedback();
    const navigation = renderer.next();
    const failure = assert.rejects(navigation, /Invalid chapter/);
    assert.equal(started, false);
    frames.shift()(); await f.tick();
    assert.equal(started, false);
    frames.shift()();
    await failure;
    assert.equal(started, true);
    assert.deepEqual(f.events, ['hide', 'cancel']);
    assert.equal(f.timers.size, 0);
});
