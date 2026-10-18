const test = require('node:test');
const { withPhpFixture } = require('./http_fixture');
const { chrome } = require('./browser_fixture');
const { runEpubBrowserFixture } = require('./epub_browser_fixture');
const library = JSON.stringify(require.resolve('../comistream_lib.php'));
const phpString = value => `json_decode(${JSON.stringify(JSON.stringify(value))})`;

// COMISTREAM_FOLIATE_DIRがあればローカルfork、なければReaderの固定SHAを検証するルン。
function harness(vertical) {
    return `
(async () => {
    localStorage.setItem('comistream_epub_flow_mode', 'paginated');
    for (let i = 0; (!viewInitialized || !currentLocation?.cfi) && i < 150; i++) await waitTimeout(100);
    if (!viewInitialized || !currentLocation?.cfi) throw new Error('Reader initialization timed out');
    const renderer = view.renderer;
    renderer.removeAttribute('animated');
    if (renderer.getAttribute('swipe-min-distance') !== '40') throw new Error('Swipe threshold is not configured');
    await navigate(() => view.goTo(0));
    for (let i = 0; i < 4; i++) await navigate(() => goNextPage());
    await waitTimeout(350);
    if (isEpubAtStartOfLinearReadingOrder() || isEpubAtEndOfLinearReadingOrder()) throw new Error('Fixture must start inside the book');
    if (currentDirectionInfo.vertical !== ${vertical} || getNavigationIsRtl() !== ${vertical}) throw new Error('Unexpected writing mode or progression');
    const failures = [];
    const settle = async () => {
        await waitTimeout(350);
        await navigationChain;
        await waitAnimationFrame();
        await waitAnimationFrame();
    };
    const position = () => ({
        page: renderer.page,
        cfi: currentLocation.cfi,
        save: getProgressSaveSnapshot(),
        locator: epubProgressManager.getState().locator
    });
    const expectSame = (before, label) => {
        const after = position();
        if (JSON.stringify(after) !== JSON.stringify(before)) {
            failures.push(label + ': ' + JSON.stringify({ before, after }));
        }
    };
    function touch(target, type, x, count = 1) {
        const point = new Touch({ identifier: 1, target, clientX: x, pageX: x, screenX: x,
            clientY: 300, pageY: 300, screenY: 300 });
        const touches = ['touchcancel', 'touchend'].includes(type) ? [] : [point];
        if (touches.length && count === 2) touches.push(new Touch({ identifier: 2, target,
            clientX: x + 30, pageX: x + 30, screenX: x + 30, clientY: 300, pageY: 300, screenY: 300 }));
        target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true,
            touches, targetTouches: touches, changedTouches: [point] }));
    }
    // fork側のテストを借りず、Readerの本文と保存用データを独立して検証するルン。
    for (const scenario of [
        { name: 'cancel only', move: 140, cancel: true },
        { name: 'cancel then delayed end', move: 140, cancel: true, end: 140 },
        { name: '20px drift', move: 180, end: 180 },
        { name: '20px end only', end: 180 },
        { name: '40px threshold', move: 160, end: 160, turn: true },
        { name: '60px end only', end: 140, turn: true },
        { name: '20px move then 60px end', move: 180, end: 140, turn: true },
        { name: 'duplicate end', move: 140, end: 140, turn: true, duplicate: true },
        { name: 'ended drift then displaced end', end: 180, duplicate: true },
        { name: 'multiple fingers', move: 140, end: 140, multi: true },
        { name: 'selected text', move: 140, end: 140, selection: true },
        { name: 'selected text end only', end: 140, selection: true },
        { name: 'no-swipe', move: 140, end: 140, noSwipe: true },
        { name: 'no-swipe end only', end: 140, noSwipe: true },
        { name: 'scroll locked end only', end: 140, locked: true }
    ]) {
        await navigate(() => view.goTo(0));
        for (let i = 0; i < 4; i++) await navigate(() => goNextPage());
        await settle();
        const content = getRendererContents().find(item => item.index === renderer.primaryIndex);
        const doc = content.doc ?? content.document;
        const target = doc.body;
        if (scenario.selection) {
            const range = doc.createRange();
            range.selectNodeContents(doc.querySelector('p'));
            doc.getSelection().removeAllRanges();
            doc.getSelection().addRange(range);
        }
        if (scenario.noSwipe) renderer.setAttribute('no-swipe', '');
        renderer.scrollLocked = Boolean(scenario.locked);
        const before = position();
        if (!before.save || before.save.cfi !== before.cfi || before.page <= 0 || before.page >= renderer.pages - 1) {
            throw new Error('Fixture needs a stable interior page and a saveable CFI: ' + JSON.stringify(before));
        }
        touch(target, 'touchstart', 200, scenario.multi ? 2 : 1);
        await waitTimeout(80);
        if (scenario.move !== undefined) touch(target, 'touchmove', scenario.move, scenario.multi ? 2 : 1);
        await waitTimeout(20);
        if (scenario.cancel) {
            touch(target, 'touchcancel', scenario.move);
            await waitTimeout(250);
            expectSame(before, scenario.name + ' at cancel');
        }
        if (scenario.end !== undefined) touch(target, 'touchend', scenario.end);
        await settle();
        if (scenario.turn) {
            const after = position();
            const direction = ${vertical} ? -1 : 1;
            if (after.page !== before.page + direction || after.cfi === before.cfi || after.save?.cfi !== after.cfi) {
                failures.push(scenario.name + ': expected one page turn, ' + JSON.stringify({ before, after }));
            }
        } else expectSame(before, scenario.name);
        if (scenario.duplicate) {
            const ended = position();
            touch(target, 'touchend', 140);
            await settle();
            expectSame(ended, scenario.name + ' after duplicate');
        }
        doc.getSelection().removeAllRanges();
        renderer.removeAttribute('no-swipe');
        renderer.scrollLocked = false;
    }
    if (failures.length) throw new Error(failures.join('\\n'));
    window.__progressNativeResult = { ok: true };
})().catch(error => { window.__progressNativeResult = { ok: false, error: error.stack }; });
`;
}

function router(vertical) {
    const opf = '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">swipe-fixture</dc:identifier><dc:title>Swipe fixture</dc:title><dc:language>ja</dc:language></metadata><manifest><item id="text" href="text.xhtml" media-type="application/xhtml+xml"/></manifest><spine page-progression-direction="' + (vertical ? 'rtl' : 'ltr') + '"><itemref idref="text"/></spine></package>';
    const chapter = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Swipe fixture</title><style>body{writing-mode:' + (vertical ? 'vertical-rl' : 'horizontal-tb') + ';font:20px/1.8 serif}</style></head><body>'
        + Array.from({ length: 120 }, (_, i) => '<p>段落' + i + ' ページ送りと保存位置を確認する本文です。'.repeat(12) + '</p>').join('') + '</body></html>';
    return `<?php
require ${library};
require_once dirname(${library}) . '/i18n.php';
$package = __DIR__ . '/package';
@mkdir($package); @mkdir($package . '/META-INF');
file_put_contents($package . '/META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
file_put_contents($package . '/book.opf', ${phpString(opf)});
file_put_contents($package . '/text.xhtml', ${phpString(chapter)});
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (str_starts_with($path, '/theme/bibi/swipe-fixture/')) {
    $file = resolveReaderCacheFile($package, substr($path, strlen('/theme/bibi/swipe-fixture/')));
    if ($file === false) { http_response_code(404); exit; }
    header('Content-Type: ' . (str_ends_with($file, '.xhtml') ? 'application/xhtml+xml' : 'application/xml'));
    readfile($file); exit;
}
if ($path !== '/') { http_response_code(404); exit; }
$conf = ['comistream_tool_dir'=>dirname(${library}, 2), 'epub_reader_package_base'=>'/theme/bibi/swipe-fixture/'];
$bookName = $baseFile = $escapedFile = 'Swipe fixture.epub'; $user = 'guest'; $readerMarkerCsrfToken = '';
$_SESSION['packetSave'] = true;
I18n::getInstance()->setLang('ja');
$html = generateEpubHTML();
$harness = ${phpString(harness(vertical))};
echo preg_replace('~(\\s*</script>\\s*</body>)~', $harness . '$1', $html);
`;
}

for (const vertical of [false, true]) {
    test(`actual Foliate ${vertical ? 'vertical RTL' : 'horizontal LTR'} swipe lifecycle preserves page, CFI and save position`, {
        skip: !chrome || process.env.COMISTREAM_EPUB_BROWSER_TESTS !== '1' || process.env.COMISTREAM_HTTP_TESTS !== '1'
    }, async () => {
        await withPhpFixture(router(vertical), url => runEpubBrowserFixture(url, {
            viewport: { width: 390, height: 844 }, timeoutMs: 60000
        }));
    });
}
