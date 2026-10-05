const test = require('node:test');
const fs = require('node:fs');
const { chrome, literal, runBrowserFixture } = require('./browser_fixture');
const source = fs.readFileSync(require.resolve('../epub_end'), 'utf8');
const body = `<button id="origin">Reader</button><button id="epub-end-menu-button" disabled>End</button>
<dialog id="epub-end-panel" aria-modal="true" aria-labelledby="epub-end-title">
<h2 id="epub-end-title">End of book</h2><div id="epub-end-book-title"></div>
<button id="epub-end-return">Reading</button><button id="epub-end-back">List</button>
<div id="epub-end-books" hidden></div></dialog><div id="gesture">Body</div>`;

test('modal end navigation stays usable during delayed loading and safely adds candidates without reopening or duplication', { skip: !chrome }, async () => {
    await runBrowserFixture(`
        ${source}
        window.testDone = false;
        let atEnd = false, requests = 0, resolveFetch, exits = 0, nextUrl = '';
        const panel = document.getElementById('epub-end-panel');
        const origin = document.getElementById('origin');
        const controller = window.ComistreamEpubEnd.create({
            baseFile: ${literal('<img src=x onerror=alert(1)>.epub')}, publicDir: '/nas',
            readerUrl: 'https://reader.invalid/cgi-bin/comistream.php', iconUrl: '/theme/icons/book.png',
            isAtEnd: () => atEnd, requestOpen: () => controller.open(), onBack: () => exits++,
            onNavigate: href => { nextUrl = href; },
            fetch: () => { requests++; return new Promise(resolve => { resolveFetch = resolve; }); }
        });
        const loading = controller.startSuggestions();
        expect(!controller.open(), 'An intermediate chapter opened the panel');
        atEnd = true; controller.refresh(); origin.focus(); controller.open();
        expect(panel.matches(':modal') && document.activeElement.id === 'epub-end-return', 'Modal focus did not move to reading button');
        expect(document.getElementById('epub-end-books').hidden, 'Loading created placeholder rows');
        controller.startSuggestions();
        resolveFetch({ ok: true, status: 200, json: async () => ({
            title: { new: { [${literal('<img src=x onerror=alert(2)> Next')}] : '/nas/次 & #?.cbz' }, old: {} }, author: {}
        }) });
        loading.then(async () => {
            try {
                expect(requests === 1 && panel.open, 'Fetching blocked or reopened navigation');
                expect(document.activeElement.id === 'epub-end-return', 'Late results stole focus');
                expect(!panel.querySelector('[onerror],script') && window.pwned === 0, 'Titles became active markup');
                const link = panel.querySelector('a'); link.click();
                expect(new URL(nextUrl).searchParams.get('file') === '次 & #?.cbz', 'Special filename did not reach reader endpoint');
                document.getElementById('epub-end-back').click();
                expect(exits === 1, 'List navigation stopped working');
                document.getElementById('epub-end-return').click();
                await new Promise(resolve => setTimeout(resolve, 0));
                expect(!panel.open && document.activeElement === origin, 'Closing did not restore focus');
                controller.open();
                expect(panel.querySelectorAll('a').length === 1, 'Reopening duplicated rows');
                panel.dispatchEvent(new Event('cancel', { cancelable: true }));
                await new Promise(resolve => setTimeout(resolve, 0));
                expect(!panel.open, 'Escape cancellation did not close the panel');
            } catch (error) { window.testFailed = true; document.getElementById('result').textContent = error.stack; }
            window.testDone = true;
        });
    `, body);
});

test('404 produces no candidate UI while forward touch gestures require a stable end, direction and uncancelled single finger', { skip: !chrome }, async () => {
    await runBrowserFixture(`
        ${source}
        window.testDone = false;
        let opens = 0, forwardMoves = 0, atEnd = true;
        const target = document.getElementById('gesture');
        const controller = window.ComistreamEpubEnd.create({
            baseFile: 'Book.epub', publicDir: '', readerUrl: 'https://reader.invalid/cgi-bin/comistream.php',
            isAtEnd: () => atEnd, getCfi: () => 'same-cfi', canSwipe: () => true,
            getDirection: () => ({ rtl: true, vertical: true }), isEligibleTarget: () => true,
            requestOpen: () => { opens++; }, onForwardSwipe: () => { forwardMoves++; },
            fetch: async () => ({ status:404, ok:false, json: () => { throw new Error('404 JSON parsing'); } }),
            onError: () => { window.testFailed = true; }
        });
        controller.bindGestures(document); controller.bindGestures(document);
        function touch(type, x, count = 1) {
            const event = new Event(type, { bubbles: true });
            const point = { identifier:1, clientX:x, clientY:100 };
            Object.defineProperties(event, {
                touches:{ value: type === 'touchend' ? [] : Array(count).fill(point) }, changedTouches:{value:[point]}
            });
            target.dispatchEvent(event);
        }
        controller.startSuggestions().then(() => {
            try {
                expect(document.getElementById('epub-end-books').hidden && !document.querySelector('#epub-end-books p'), '404 created candidate UI');
                touch('touchstart',100); touch('touchend',139);
                touch('touchstart',100); touch('touchend',40);
                touch('touchstart',100,2); touch('touchend',160);
                touch('touchstart',100); touch('touchcancel',100); touch('touchend',160);
                expect(opens === 0, 'Invalid gesture opened the panel');
                touch('touchstart',100); touch('touchend',160);
                expect(opens === 1, 'Forward end swipe did not open exactly once');
                atEnd = false; touch('touchstart',100); atEnd = true; touch('touchend',160);
                expect(opens === 1 && forwardMoves === 1, 'Entering the end opened rather than kept the body');
            } catch (error) { window.testFailed = true; document.getElementById('result').textContent = error.stack; }
            window.testDone = true;
        });
    `, body);
});
