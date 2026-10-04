const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const animationCode = source.slice(source.indexOf('function updatePageTurnAnimationSetting('), source.indexOf('async function init('));

function fixture({ rtl = false, fixed = false, flow = 'paginated', initialized = true } = {}) {
    const listeners = new Map();
    const frames = new Map();
    const animations = [];
    let frameId = 0;
    let now = 0;
    const storage = new Map();
    const windowListeners = new Map();
    const mediaListeners = new Map();
    const button = { classList: { toggle() {} }, setAttribute(name, value) { this[name] = value; } };
    const localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
    const renderer = {
        addEventListener: (type, listener) => listeners.set(type, listener),
        animate(keyframes, options) {
            const animation = { keyframes, options, cancelled: false, cancel() { this.cancelled = true; } };
            animations.push(animation);
            return animation;
        }
    };
    const context = vm.createContext({
        $: () => button,
        performance: { now: () => now },
        localStorage,
        pageTurnAnimationEnabled: true,
        lastPageTurnAnimationAt: -Infinity,
        pendingNavigationCount: 0,
        reducedMotionMedia: { matches: false, addEventListener: (type, fn) => mediaListeners.set(type, fn) },
        PAGE_TURN_ANIMATION_KEY: 'comistream_epub_page_turn_animation',
        EPUB_PAGE_TURN_MIN_INTERVAL_MS: 200,
        window: {
            addEventListener: (type, fn) => windowListeners.set(type, fn),
            requestAnimationFrame: (callback) => { frames.set(++frameId, callback); return frameId; },
            cancelAnimationFrame: (id) => frames.delete(id)
        },
        view: { renderer, isFixedLayout: fixed },
        viewInitialized: initialized,
        currentFlowMode: flow,
        pageTurnAnimation: null,
        pageTurnAnimationFrame: null,
        EPUB_PAGE_TURN_DURATION_MS: 100,
        EPUB_PAGE_TURN_OFFSET_PX: 32,
        getNavigationIsRtl: () => rtl,
        schedulePagePositionUpdate: () => {}
    });
    vm.runInContext(animationCode, context);
    context.bindRendererPagePositionEvents();
    return {
        context, animations, frames, storage, windowListeners, mediaListeners, button,
        advance: (ms) => { now += ms; },
        relocate: (index, fraction, reason = 'page') => listeners.get('relocate')({ detail: { index, fraction, reason } }),
        frame() {
            const callbacks = [...frames.values()];
            frames.clear();
            callbacks.forEach(callback => callback());
        }
    };
}

test('page turns slide in the reading direction for 100ms, including section boundaries', () => {
    for (const rtl of [false, true]) {
        const f = fixture({ rtl });
        f.relocate(0, 0, 'navigation');
        assert.equal(f.frames.size, 0);
        for (const [index, fraction, reason, forward] of [
            [0, 0.2, 'page', true],
            [0, 0.1, 'snap', false],
            [1, 0, 'navigation', true],
            [0, 0.9, 'navigation', false]
        ]) {
            f.advance(250);
            f.relocate(index, fraction, reason);
            f.frame();
            const animation = f.animations.at(-1);
            const offset = 32 * (rtl ? -1 : 1) * (forward ? 1 : -1);
            assert.equal(animation.keyframes[0].transform, `translateX(${offset}px)`);
            assert.equal(animation.keyframes[1].transform, 'translateX(0)');
            assert.equal(animation.options.duration, 100);
        }
    }
});

test('initial restore, layout changes, duplicate events and book boundaries do not animate', () => {
    const f = fixture({ initialized: false });
    f.relocate(0, 0);
    f.relocate(1, 0, 'navigation');
    assert.equal(f.frames.size, 0);
    f.context.viewInitialized = true;
    f.relocate(1, 0.1, 'anchor');
    f.relocate(1, 0.1, 'container-scroll');
    f.relocate(1, 0.1, 'page');
    assert.equal(f.frames.size, 0);
    assert.equal(f.context.getPageTurnDirection(null, {}), 0);
    assert.equal(f.context.getPageTurnDirection({ index: 0, fraction: 0 }, { index: 0 }), 0);
});

test('fixed-layout and scrolled books do not animate', () => {
    for (const options of [{ fixed: true }, { flow: 'scrolled' }]) {
        const f = fixture(options);
        f.relocate(0, 0);
        f.relocate(0, 0.2);
        assert.equal(f.frames.size, 0);
    }
});

test('rapid turns cancel the running animation and resume after the interval', () => {
    const f = fixture();
    f.relocate(0, 0);
    f.relocate(0, 0.1);
    f.frame();
    const first = f.animations[0];
    f.advance(50);
    f.relocate(0, 0.2);
    assert.equal(first.cancelled, true);
    f.frame();
    assert.equal(f.animations.length, 1);
    f.advance(150);
    f.relocate(0, 0.3);
    f.frame();
    assert.equal(f.animations.length, 2);
    first.onfinish();
    assert.equal(f.context.pageTurnAnimation, f.animations[1]);
    f.animations[1].onfinish();
    assert.equal(f.context.pageTurnAnimation, null);
});

test('pending frames collapse and cancellation leaves no transform or queued animation', () => {
    const f = fixture();
    f.relocate(0, 0);
    f.relocate(0, 0.1);
    f.relocate(0, 0.2);
    assert.equal(f.frames.size, 1);
    f.context.cancelPageTurnAnimation();
    f.frame();
    assert.equal(f.animations.length, 0);
    f.context.view.renderer.animate = undefined;
    f.relocate(0, 0.3);
    assert.equal(f.frames.size, 0);
});

test('queued navigation suppresses intermediate animations but permits the final turn', () => {
    const f = fixture();
    f.relocate(0, 0);
    f.context.pendingNavigationCount = 10;
    for (let i = 1; i <= 9; i++) {
        f.relocate(0, i / 20);
        f.frame();
        f.advance(250);
        f.context.pendingNavigationCount--;
    }
    assert.equal(f.animations.length, 0);
    f.relocate(0, 0.5);
    f.frame();
    assert.equal(f.animations.length, 1);
});

test('a queued input before the animation frame prevents that animation', () => {
    const f = fixture();
    f.relocate(0, 0);
    f.relocate(0, 0.1);
    f.context.pendingNavigationCount = 2;
    f.frame();
    assert.equal(f.animations.length, 0);
});

test('turning OFF cancels pending and active animations and saves one global preference', () => {
    const f = fixture();
    f.relocate(0, 0);
    f.relocate(0, 0.1);
    f.context.setPageTurnAnimationEnabled(false);
    f.frame();
    assert.equal(f.animations.length, 0);
    assert.equal(f.button['aria-pressed'], 'false');
    assert.equal(f.storage.get('comistream_epub_page_turn_animation'), '0');
    f.context.setPageTurnAnimationEnabled(true);
    f.relocate(0, 0.2);
    f.frame();
    f.context.setPageTurnAnimationEnabled(false);
    assert.equal(f.animations[0].cancelled, true);
    f.advance(1000);
    f.relocate(0, 0.3);
    f.frame();
    assert.equal(f.animations.length, 1);
    assert.equal(f.storage.size, 1);
});

test('storage updates and clearing storage synchronize the preference across books and tabs', () => {
    const f = fixture();
    f.context.bindPageTurnAnimationPreferences();
    const notify = (key) => f.windowListeners.get('storage')({ key, storageArea: f.context.localStorage });
    f.storage.set('comistream_epub_page_turn_animation', '0');
    notify('comistream_epub_page_turn_animation');
    assert.equal(f.context.pageTurnAnimationEnabled, false);
    f.storage.clear();
    notify(null);
    assert.equal(f.context.pageTurnAnimationEnabled, true);
    assert.equal(f.storage.size, 0);
});

test('reduced motion suppresses animations and changes cancel an active effect', () => {
    const f = fixture();
    f.context.bindPageTurnAnimationPreferences();
    f.relocate(0, 0);
    f.relocate(0, 0.1);
    f.frame();
    f.context.reducedMotionMedia.matches = true;
    f.mediaListeners.get('change')();
    assert.equal(f.animations[0].cancelled, true);
    f.advance(1000);
    f.relocate(0, 0.2);
    f.frame();
    assert.equal(f.animations.length, 1);
    assert.equal(f.context.pageTurnAnimationEnabled, true);
});

test('navigation queue counters drain after skipped or failed navigation', async () => {
    for (const fails of [false, true]) {
        const context = vm.createContext({
            navigationIntentSeq: 0,
            pendingNavigationCount: 0,
            readerClosing: false,
            navigationChain: Promise.resolve(),
            cancelPageTurnAnimation: () => {},
            debugLog: () => {},
            summarizeLocation: () => ({}),
            clearInitialRestorePin: () => {},
            waitForNavigationReady: async () => {
                if (fails) throw new Error('renderer failure');
                return false;
            },
            console: { warn() {}, error() {} },
            ensureRendererVisible: () => {},
            scheduleRendererVisibilityGuard: () => {},
            getRendererDiagnostics: () => ({})
        });
        const start = source.indexOf('async function navigate(');
        const end = source.indexOf('async function jumpToFraction(', start);
        vm.runInContext(source.slice(start, end), context);
        const jobs = Array.from({ length: 5 }, () => context.navigate(() => assert.fail('not ready')));
        assert.equal(context.pendingNavigationCount, 5);
        await Promise.all(jobs);
        assert.equal(context.pendingNavigationCount, 0);
    }
});


test('remote EPUB restore consumes the triggering navigation before renderer actions', async () => {
    const context = vm.createContext({
        navigationIntentSeq: 0, pendingNavigationCount: 0, readerClosing: false, navigationChain: Promise.resolve(),
        epubProgressManager: { beforeNavigation: async () => false },
        debugLog() {}, summarizeLocation: () => ({}), cancelPageTurnAnimation() {},
    });
    const start = source.indexOf('async function navigate(');
    const end = source.indexOf('async function jumpToFraction(', start);
    vm.runInContext(source.slice(start, end), context);
    await context.navigate(() => assert.fail('Consumed navigation reached renderer'));
    assert.equal(context.pendingNavigationCount, 0);
});
