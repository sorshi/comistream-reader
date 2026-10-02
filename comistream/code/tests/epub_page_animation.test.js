const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
const animationCode = source.slice(source.indexOf('function cancelPageTurnAnimation('), source.indexOf('async function init('));

function fixture({ rtl = false, fixed = false, flow = 'paginated', initialized = true } = {}) {
    const listeners = new Map();
    const frames = new Map();
    const animations = [];
    let frameId = 0;
    const renderer = {
        addEventListener: (type, listener) => listeners.set(type, listener),
        animate(keyframes, options) {
            const animation = { keyframes, options, cancelled: false, cancel() { this.cancelled = true; } };
            animations.push(animation);
            return animation;
        }
    };
    const context = vm.createContext({
        window: {
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
        context, animations, frames,
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

test('a new turn replaces the running animation without waiting for it', () => {
    const f = fixture();
    f.relocate(0, 0);
    f.relocate(0, 0.1);
    f.frame();
    const first = f.animations[0];
    f.relocate(0, 0.2);
    assert.equal(first.cancelled, true);
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
