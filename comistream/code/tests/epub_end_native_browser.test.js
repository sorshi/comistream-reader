const test = require('node:test');
const { withPhpFixture } = require('./http_fixture');
const { chrome } = require('./browser_fixture');
const { runEpubBrowserFixture } = require('./epub_browser_fixture');
const library = JSON.stringify(require.resolve('../comistream_lib.php'));

function harness(notFound, fixed, portrait) {
    return `
let suggestionRequests = 0, resolveSuggestions;
const originalFetch = window.fetch.bind(window);
window.fetch = (url, options) => {
    if (String(url).startsWith('/suggest.php?')) {
        suggestionRequests++;
        if (${notFound}) return Promise.resolve(new Response('', { status:404 }));
        return new Promise(resolve => { resolveSuggestions = resolve; });
    }
    return originalFetch(url, options);
};
(async () => {
    for (let i = 0; !viewInitialized && i < 150; i++) await waitTimeout(100);
    if (!viewInitialized) throw new Error('Reader initialization timed out');
    if (suggestionRequests !== 1) throw new Error('Suggestions did not start once after initial rendering');
    if (${fixed} && ${portrait}) {
        await navigate(() => view.goTo(getBookSectionCount() - 2), { allowReadCompletion:false, recordProgress:false });
        if (isEpubAtEndOfLinearReadingOrder()) throw new Error('Portrait first half of the final spread counted as the end');
        await navigate(() => goNextPage());
        if (document.getElementById('epub-end-panel').open || !isEpubAtEndOfLinearReadingOrder()) {
            throw new Error('Last spread remaining half did not stay readable');
        }
    } else {
        await navigate(() => goToBoundary(false), { allowReadCompletion:false, recordProgress:false });
    }
    const panel = document.getElementById('epub-end-panel');
    if (!isEpubAtEndOfLinearReadingOrder() || panel.open) throw new Error('Last-page jump hid the body or did not reach the end');
    const content = getRendererContents().find(item => item.index === getBookSectionCount() - 1);
    const doc = content.doc ?? content.document;
    const target = doc.body;
    function touch(type, x) {
        const point = new Touch({ identifier: 1, target, clientX: x, clientY: 100, screenX: x, screenY:100 });
        target.dispatchEvent(new TouchEvent(type, {
            bubbles:true, cancelable:true, touches:type === 'touchend' ? [] : [point],
            targetTouches:type === 'touchend' ? [] : [point], changedTouches:[point]
        }));
    }
    touch('touchstart',150);
    touch('touchmove',getNavigationIsRtl() ? 230 : 70);
    touch('touchend',getNavigationIsRtl() ? 230 : 70);
    await navigationChain;
    await waitTimeout(100);
    if (!panel.matches(':modal')) throw new Error('Actual Foliate touch path did not open the end panel');
    if (!document.getElementById('epub-end-books').hidden) throw new Error('Pending or 404 response showed candidate UI');
    if (!${notFound}) {
        resolveSuggestions(new Response(JSON.stringify({
            title:{new:{'次の本 <img src=x onerror=alert(1)>':'/nas/Next & #?.cbz'},old:{}},author:{}
        }), {headers:{'Content-Type':'application/json'}}));
        await epubEndController.startSuggestions();
        const link = panel.querySelector('a');
        if (!link || new URL(link.href).searchParams.get('file') !== 'Next & #?.cbz'
            || panel.querySelector('[onerror]')) throw new Error('Candidate link or title is unsafe');
    }
    const lastCfi = currentLocation.cfi;
    document.getElementById('epub-prev-page').click();
    await navigationChain;
    if (currentLocation.cfi !== lastCfi) throw new Error('Behind-panel input moved the body');
    panel.dispatchEvent(new Event('cancel', {cancelable:true}));
    await waitTimeout(30);
    if (panel.open) throw new Error('Cancel did not return to the body');
    await navigate(() => goNextPage());
    if (!panel.open || suggestionRequests !== 1 || panel.querySelectorAll('a').length !== (${notFound} ? 0 : 1)) {
        throw new Error('Reopening refetched or duplicated suggestions');
    }
    await waitTimeout(350);
    window.__progressNativeResult = {ok:true};
})().catch(error => { window.__progressNativeResult = {ok:false, error:error.stack}; });
`;
}

function router(notFound, fixed, portrait) {
    return `<?php
require ${library};
require_once dirname(${library}) . '/i18n.php';
$package = __DIR__ . '/package';
@mkdir($package); @mkdir($package . '/META-INF');
file_put_contents($package . '/META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
file_put_contents($package . '/book.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">end-fixture</dc:identifier><dc:title>End fixture</dc:title><dc:language>en</dc:language>${fixed ? '<meta property="rendition:layout">pre-paginated</meta>' : ''}</metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/>${fixed ? '<item id="c" href="c.xhtml" media-type="application/xhtml+xml"/>' : ''}</manifest><spine><itemref idref="a"/><itemref idref="b"/>${fixed ? '<itemref idref="c"/>' : ''}</spine></package>');
foreach (['a','b','c'] as $section) file_put_contents($package . '/' . $section . '.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><meta name="viewport" content="width=600,height=800"/><title>Chapter</title></head><body><h1>Chapter ' . $section . '</h1><p>End navigation fixture.</p></body></html>');
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (str_starts_with($path, '/theme/bibi/end-fixture/')) {
    $file = resolveReaderCacheFile($package, substr($path, strlen('/theme/bibi/end-fixture/')));
    if ($file === false) { http_response_code(404); exit; }
    header('Content-Type: ' . (str_ends_with($file,'.xhtml') ? 'application/xhtml+xml' : 'application/xml'));
    readfile($file); exit;
}
if ($path !== '/') { http_response_code(404); exit; }
$conf = ['comistream_tool_dir'=>dirname(${library},2), 'publicDir'=>'/nas', 'epub_reader_package_base'=>'/theme/bibi/end-fixture/'];
$bookName = $baseFile = $escapedFile = 'End fixture.epub'; $user = 'guest'; $readerMarkerCsrfToken = '';
I18n::getInstance()->setLang('ja');
$html = generateEpubHTML();
$harness = json_decode(${JSON.stringify(JSON.stringify(harness(notFound, fixed, portrait)))});
echo preg_replace('~(\\s*</script>\\s*</body>)~', $harness . '$1', $html);
`;
}

for (const { notFound, fixed = false, portrait = false } of [
    { notFound:true }, { notFound:false }, { notFound:true, fixed:true }, { notFound:false, fixed:true, portrait:true }
]) {
    test(`generated ${fixed ? 'fixed-layout' : 'reflow'} EPUB ${portrait ? 'portrait' : 'landscape'} and actual Foliate end swipe with ${notFound ? '404' : 'delayed JSON'}`, {
        skip: !chrome || process.env.COMISTREAM_EPUB_BROWSER_TESTS !== '1' || process.env.COMISTREAM_HTTP_TESTS !== '1'
    }, async () => {
        await withPhpFixture(router(notFound, fixed, portrait), url => runEpubBrowserFixture(url, {
            screenshotPath: !notFound && !fixed ? process.env.COMISTREAM_EPUB_SCREENSHOT : null,
            viewport: portrait ? { width:390, height:844 } : { width:1024, height:768 }
        }));
    });
}
