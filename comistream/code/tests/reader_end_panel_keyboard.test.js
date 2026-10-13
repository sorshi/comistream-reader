const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { create } = require('../epub_end');

function fixture(format) {
    const panel = new EventTarget();
    panel.open = false;
    panel.dataset = {};
    panel.showModal = () => { panel.open = true; };
    panel.close = () => { panel.open = false; };
    const button = new EventTarget();
    button.focus = () => {};
    const document = { getElementById: id => {
        if (id === 'suggest' || id === 'epub-end-panel') return panel;
        if (id === 'suggest-return' || id === 'epub-end-return' || id === 'epub-end-back') return button;
        return null;
    } };
    let exits = 0;
    const onBack = () => { exits++; };
    let open, close;
    if (format === 'image/PDF') {
        const source = fs.readFileSync(require.resolve('../comistream.js'), 'utf8');
        const context = vm.createContext({
            document, window: { matchMedia: () => ({ matches: true }) },
            closeQuickSpread() {}, backListPage: onBack
        });
        vm.runInContext(source.slice(source.indexOf('let suggestRestoreFocus ='), source.indexOf('async function next()')), context);
        open = context.showSuggestPanel;
        close = context.hideSuggestPanel;
    } else {
        const controller = create({ document, isAtEnd: () => true, onBack });
        open = controller.open;
        close = controller.close;
    }
    const key = (code, options = {}) => {
        const event = new Event('keydown', { cancelable: true, bubbles: true });
        Object.assign(event, { code, key: code, ...options });
        if (options.prevented) event.preventDefault();
        panel.dispatchEvent(event);
        return event;
    };
    return { open, close, key, exits: () => exits };
}

for (const format of ['image/PDF', 'EPUB']) {
    test(`${format} end panel Delete uses list exit once and consumes the key`, () => {
        const f = fixture(format);
        f.open();
        f.open();
        assert.equal(f.key('Delete').defaultPrevented, true);
        assert.equal(f.exits(), 1);
        f.close();
        f.open();
        assert.equal(f.key('', { key: 'Delete' }).defaultPrevented, true);
        assert.equal(f.exits(), 2);
    });

    test(`${format} end panel preserves other keys, cancelled events and closed-panel input`, () => {
        const f = fixture(format);
        f.open();
        for (const code of ['Escape', 'Space', 'Enter', 'Tab', 'ArrowDown', 'Backspace']) {
            assert.equal(f.key(code).defaultPrevented, false, code);
        }
        f.key('Delete', { prevented: true });
        assert.equal(f.exits(), 0);
        f.close();
        assert.equal(f.key('Delete').defaultPrevented, false);
        assert.equal(f.exits(), 0);
    });
}
