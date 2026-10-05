const test = require('node:test');
const { withPhpFixture } = require('./http_fixture');
const { chrome } = require('./browser_fixture');
const { runEpubBrowserFixture } = require('./epub_browser_fixture');
const library = JSON.stringify(require.resolve('../comistream_lib.php'));

function harness(mode) {
    return `
const mode = ${JSON.stringify(mode)};
const rawFetch = window.fetch.bind(window);
let delaySection = false, requestedSection = false, releaseFast, blockStart, blockEnd, spinnerRect;
window.fetch = async (url, options) => {
    if (delaySection && String(url).includes('/b.xhtml')) {
        requestedSection = true;
        if (mode === 'fast') await new Promise(resolve => { releaseFast = resolve; });
        else if (mode !== 'blocked') await waitTimeout(1800);
    }
    return rawFetch(url, options);
};
(async () => {
    for (let i = 0; !viewInitialized && i < 150; i++) await waitTimeout(100);
    if (!viewInitialized) throw new Error('Reader initialization timed out');
    await navigate(() => view.goTo(0), { recordProgress: false });
    await waitTimeout(250);
    const overlay = document.getElementById('epub-loading-overlay');
    let feedbackShown = false;
    const observer = new MutationObserver(() => {
        if (overlay.getAttribute('aria-hidden') === 'false') feedbackShown = true;
    });
    observer.observe(overlay, { attributes: true });
    const visible = () => {
        const style = getComputedStyle(overlay);
        return overlay.getAttribute('aria-hidden') === 'false'
            && style.visibility === 'visible' && Number(style.opacity) > 0;
    };
    if (mode === 'blocked') view.addEventListener('load', event => {
        if (event.detail.index !== 1) return;
        const rect = document.querySelector('.epub-loading-spinner').getBoundingClientRect();
        spinnerRect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        blockStart = Date.now();
        const until = performance.now() + 1800;
        while (performance.now() < until) {}
        blockEnd = Date.now();
    });
    let releaseSync;
    if (mode === 'sync') {
        epubProgressManager.beforeNavigation = () => new Promise(resolve => { releaseSync = resolve; });
    } else delaySection = true;
    let operation;
    if (mode !== 'swipe') {
        document.getElementById('epub-next-page').click();
        operation = navigationChain;
    } else {
        const target = getRendererContents()[0].doc.body;
        const startX = getNavigationIsRtl() ? 150 : 300;
        const endX = getNavigationIsRtl() ? 300 : 150;
        function touch(type, x) {
            const point = new Touch({ identifier: 1, target, clientX: x, clientY: 150, screenX: x, screenY: 150 });
            target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true,
                touches: type === 'touchend' ? [] : [point], targetTouches: type === 'touchend' ? [] : [point],
                changedTouches: [point] }));
        }
        touch('touchstart', startX); await waitTimeout(25);
        touch('touchmove', endX); await waitTimeout(25);
        touch('touchend', endX);
    }
    if (mode === 'fast') {
        for (let i = 0; !requestedSection && i < 40; i++) await waitTimeout(5);
        if (!requestedSection) throw new Error('Chapter loading did not start');
        await waitTimeout(Math.min(100, NAVIGATION_SPINNER_DELAY_MS / 5));
        if (overlay.getAttribute('aria-hidden') !== 'true') throw new Error('Fast chapter loading displayed feedback before the delay');
        if (Number(getComputedStyle(overlay).opacity) !== 0) throw new Error('Fast chapter loading was not visually transparent');
        releaseFast();
    } else if (mode !== 'blocked') {
        await waitTimeout(850);
        if (mode !== 'sync' && !requestedSection) throw new Error('Chapter loading did not start');
        if (!visible()) throw new Error('Loading feedback is missing during ' + mode);
        if (mode === 'sync') releaseSync(true);
    }
    if (operation) await operation;
    for (let i = 0; getCurrentSectionIndex() !== 1 && i < 50; i++) await waitTimeout(100);
    if (getCurrentSectionIndex() !== 1) throw new Error('Next chapter did not render');
    for (let i = 0; overlay.getAttribute('aria-hidden') !== 'true' && i < 20; i++) await waitTimeout(100);
    if (overlay.getAttribute('aria-hidden') !== 'true') throw new Error('Loading feedback remained after rendering');
    const completedStyle = getComputedStyle(overlay);
    if (completedStyle.visibility !== 'hidden' || Number(completedStyle.opacity) !== 0) {
        throw new Error('Loading feedback left a fading remnant after rendering');
    }
    observer.disconnect();
    if (mode === 'fast' && feedbackShown) throw new Error('Fast chapter loading flashed feedback');
    if (pendingNavigationCount !== 0) throw new Error('Navigation did not drain');
    window.__progressNativeResult = { ok: true, blockStart, blockEnd, spinnerRect, delay: NAVIGATION_SPINNER_DELAY_MS };
})().catch(error => { window.__progressNativeResult = { ok: false, error: error.stack }; });
`;
}

function router(mode) {
    return `<?php
require ${library};
require_once dirname(${library}) . '/i18n.php';
$package = __DIR__ . '/package';
@mkdir($package); @mkdir($package . '/META-INF');
file_put_contents($package . '/META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
file_put_contents($package . '/book.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">loading-fixture</dc:identifier><dc:title>Loading fixture</dc:title><dc:language>en</dc:language></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>');
foreach (['a', 'b'] as $section) file_put_contents($package . '/' . $section . '.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title></head><body><h1>Chapter ' . $section . '</h1><p>Loading feedback fixture.</p></body></html>');
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (str_starts_with($path, '/theme/bibi/loading-fixture/')) {
    $file = resolveReaderCacheFile($package, substr($path, strlen('/theme/bibi/loading-fixture/')));
    if ($file === false) { http_response_code(404); exit; }
    header('Content-Type: ' . (str_ends_with($file, '.xhtml') ? 'application/xhtml+xml' : 'application/xml'));
    readfile($file); exit;
}
if ($path !== '/') { http_response_code(404); exit; }
$conf = ['comistream_tool_dir'=>dirname(${library}, 2), 'publicDir'=>'/nas', 'epub_reader_package_base'=>'/theme/bibi/loading-fixture/'];
$bookName = $baseFile = $escapedFile = 'Loading fixture.epub'; $user = 'guest'; $readerMarkerCsrfToken = '';
I18n::getInstance()->setLang('ja');
$html = generateEpubHTML();
$harness = json_decode(${JSON.stringify(JSON.stringify(harness(mode)))});
echo preg_replace('~(\\s*</script>\\s*</body>)~', $harness . '$1', $html);
`;
}

async function verifyLoadingFrames(result, frames) {
    const during = frames.filter(frame => frame.at >= result.blockStart + result.delay + 250
        && frame.at <= result.blockEnd - 100);
    if (during.length < 2) throw new Error('No compositor frames were drawn while JavaScript was blocked');
    const pixels = [];
    for (const frame of [during[0], during.find(frame => frame.at >= during[0].at + 200) || during.at(-1)]) {
        const image = new Image();
        image.src = 'data:image/png;base64,' + frame.data;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const rect = result.spinnerRect;
        const data = context.getImageData(Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)).data;
        let white = 0, background = 0;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) white++;
            if (data[i] < 225 && data[i + 1] < 225 && data[i + 2] < 225) background++;
        }
        if (white < 60 || background < data.length / 16) throw new Error('Spinner pixels were not visible during blocked rendering');
        pixels.push(data);
    }
    let changed = 0;
    for (let i = 0; i < pixels[0].length; i += 4) {
        if (Math.abs(pixels[0][i] - pixels[1][i]) > 20) changed++;
    }
    if (changed < 40) throw new Error('The spinner did not rotate during blocked rendering');
}

for (const mode of ['tap', 'swipe', 'sync', 'blocked', 'fast']) {
    test(`actual EPUB ${mode} loading respects delayed feedback and clears it after rendering`, {
        skip: !chrome || process.env.COMISTREAM_EPUB_BROWSER_TESTS !== '1' || process.env.COMISTREAM_HTTP_TESTS !== '1'
    }, async () => {
        await withPhpFixture(router(mode), url => runEpubBrowserFixture(url, {
            viewport: { width: 1024, height: 768 },
            verifyFrames: mode === 'blocked' ? verifyLoadingFrames : null
        }));
    });
}
