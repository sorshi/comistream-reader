const test = require('node:test');
const fs = require('node:fs');
const { chrome, runBrowserFixture } = require('./browser_fixture');
const source = fs.readFileSync(require.resolve('../epub_search.js'), 'utf8');
const clock = `
    const pending = new Map(); let nextId = 0;
    window.requestAnimationFrame = callback => { pending.set(++nextId, callback); return nextId; };
    window.cancelAnimationFrame = id => pending.delete(id);
    function step(time) {
        const callbacks = [...pending.values()]; pending.clear();
        for (const callback of callbacks) callback(time);
    }
    const media = new EventTarget(); media.matches = false;
    window.matchMedia = () => media;
    const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.append(host);
    const bounds = [{left:20,top:30,width:40,height:18}, {left:80,top:60,width:18,height:40}];
`;

test('search focus keeps text untouched, expands about each match and leaves a static marker after 300ms', { skip: !chrome }, async () => {
    await runBrowserFixture(`
        ${source}
        ${clock}
        const text = document.createElement('p'); text.textContent = '銀河の光'; document.body.append(text);
        const before = text.outerHTML;
        const painter = ComistreamEpubSearch.createHighlight(document, {animate:true});
        const group = painter.draw([...bounds, {left:0,top:0,width:0,height:0}, {left:NaN,top:0,width:2,height:2}]);
        host.append(group);
        expect(group.querySelectorAll('rect').length === 4, 'Empty or invalid geometry was painted');
        step(1000); step(1150);
        const rings = [...group.querySelectorAll('[data-epub-search-focus]')];
        for (const [index, ring] of rings.entries()) {
            const rect = bounds[index];
            const width = Number(ring.getAttribute('width')), height = Number(ring.getAttribute('height'));
            expect(width > rect.width + 4 && width <= (rect.width + 4) * 1.22, 'Pulse scale exceeds the chosen limit');
            expect(Math.abs(Number(ring.getAttribute('x')) + width / 2 - rect.left - rect.width / 2) < .001, 'Pulse moved horizontally');
            expect(Math.abs(Number(ring.getAttribute('y')) + height / 2 - rect.top - rect.height / 2) < .001, 'Pulse moved vertically');
        }
        step(1300);
        expect(!group.querySelector('[data-epub-search-focus]') && group.querySelectorAll('rect').length === 2, 'Focus did not settle into static markers');
        expect(!pending.size && text.outerHTML === before, 'Animation leaked or changed book text');
        painter.destroy();
    `);
});

test('redraw, reduced motion, detached overlays and cleanup cancel the focus without replaying it', { skip: !chrome }, async () => {
    await runBrowserFixture(`
        ${source}
        ${clock}
        let dark = false;
        const painter = ComistreamEpubSearch.createHighlight(document, {animate:true,isDark:()=>dark});
        let group = painter.draw(bounds); host.append(group); step(0);
        dark = true;
        group.remove(); group = painter.draw(bounds); host.append(group);
        expect(group.dataset.epubSearchHighlight === 'dark', 'Redraw did not follow the reader theme');
        expect(!group.querySelector('[data-epub-search-focus]') && !pending.size, 'Reflow replayed the pulse');
        painter.destroy();
        media.matches = true;
        const reduced = ComistreamEpubSearch.createHighlight(document, {animate:true});
        group = reduced.draw(bounds); host.append(group);
        expect(group.querySelector('rect') && !pending.size, 'Reduced motion lost markers or started animation');
        reduced.destroy();
        media.matches = false;
        const changing = ComistreamEpubSearch.createHighlight(document, {animate:true});
        group = changing.draw(bounds); host.append(group); step(0);
        media.matches = true; media.dispatchEvent(new Event('change'));
        expect(!group.querySelector('[data-epub-search-focus]') && !pending.size, 'Motion preference change did not stop the pulse');
        changing.destroy(); media.matches = false;
        const detached = ComistreamEpubSearch.createHighlight(document, {animate:true});
        group = detached.draw(bounds); host.append(group); group.remove(); step(0);
        expect(!pending.size, 'Detached overlay retained animation work');
        detached.destroy();
        const destroyed = ComistreamEpubSearch.createHighlight(document, {animate:true});
        group = destroyed.draw(bounds); host.append(group); destroyed.destroy();
        expect(!group.querySelector('[data-epub-search-focus]') && !pending.size, 'Cleanup retained a pulse');
    `);
});
