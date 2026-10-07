const test = require('node:test');
const { withPhpFixture } = require('./http_fixture');
const { chrome } = require('./browser_fixture');
const { runEpubBrowserFixture } = require('./epub_browser_fixture');
const library = JSON.stringify(require.resolve('../comistream_lib.php'));
const phpString = value => `json_decode(${JSON.stringify(JSON.stringify(value))})`;

function harness(coverIndex) {
    return `
(async () => {
    for (let i = 0; !viewInitialized && i < 150; i++) await waitTimeout(100);
    if (!viewInitialized) throw new Error('Reader initialization timed out');
    const saved = sessionStorage.getItem('start-fixture-cfi');
    if (saved) {
        if (currentLocation.cfi !== saved || getCurrentNavigationIndex() !== ${coverIndex + 1}) {
            throw new Error('Reload did not restore the saved body position');
        }
        window.__progressNativeResult = { ok: true };
        return;
    }
    if (getCurrentNavigationIndex() !== ${coverIndex}) throw new Error('First open skipped the cover');
    const content = getRendererContents().find(item => item.index === ${coverIndex});
    const doc = content?.doc ?? content?.document;
    const image = doc?.querySelector('img');
    if (!image || !image.complete || image.naturalWidth <= 0) throw new Error('Cover image did not load');
    const rect = image.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) throw new Error('Cover image is not visible');
    if (epubProgressManager.getState().locator) throw new Error('Initial cover render saved a reading position');
    await navigate(() => goToTocHref('text.xhtml'));
    if (getCurrentNavigationIndex() !== ${coverIndex + 1}) throw new Error('Could not navigate from cover to body');
    if (!await epubProgressManager.finish()) throw new Error('Could not save the body position');
    sessionStorage.setItem('start-fixture-cfi', currentLocation.cfi);
    window.location.reload();
})().catch(error => { window.__progressNativeResult = { ok: false, error: error.stack }; });
`;
}

function router({ epub2 = false, landmark = true, fixed = false }) {
    const coverIndex = landmark ? 1 : 0;
    const guide = epub2 ? '<guide><reference type="text" title="Body" href="text.xhtml"/><reference type="cover" title="Cover" href="cover.xhtml"/></guide>' : '';
    const nav = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Navigation</title></head><body><nav epub:type="toc"><ol><li><a href="text.xhtml">Body</a></li></ol></nav><nav epub:type="landmarks"><ol><li><a epub:type="bodymatter" href="text.xhtml">Body</a></li>'
        + (landmark ? '<li><a epub:type="cover" href="cover.xhtml">Cover</a></li>' : '') + '</ol></nav></body></html>';
    const opf = '<package xmlns="http://www.idpf.org/2007/opf" version="' + (epub2 ? '2.0' : '3.0') + '" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">start-fixture</dc:identifier><dc:title>Start fixture</dc:title><dc:language>en</dc:language>'
        + (fixed ? '<meta property="rendition:layout">pre-paginated</meta>' : '')
        + '</metadata><manifest><item id="front" href="front.xhtml" media-type="application/xhtml+xml"/><item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="text" href="text.xhtml" media-type="application/xhtml+xml"/>'
        + (epub2 ? '' : '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>')
        + '</manifest><spine>' + (landmark ? '<itemref idref="front"/>' : '')
        + '<itemref idref="cover" linear="no"/><itemref idref="text"/></spine>' + guide + '</package>';
    const image = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="teal"/></svg>').toString('base64');
    const xhtml = body => '<html xmlns="http://www.w3.org/1999/xhtml"><head><meta name="viewport" content="width=600,height=800"/><title>Fixture</title></head><body>' + body + '</body></html>';
    return `<?php
require ${library};
require_once dirname(${library}) . '/i18n.php';
$package = __DIR__ . '/package';
@mkdir($package); @mkdir($package . '/META-INF');
file_put_contents($package . '/META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
file_put_contents($package . '/book.opf', ${phpString(opf)});
file_put_contents($package . '/nav.xhtml', ${phpString(nav)});
file_put_contents($package . '/cover.xhtml', ${phpString(xhtml('<img alt="Cover" src="data:image/svg+xml;base64,' + image + '"/>'))});
file_put_contents($package . '/front.xhtml', ${phpString(xhtml('<p>Front matter</p>'))});
file_put_contents($package . '/text.xhtml', ${phpString(xhtml('<h1>Body</h1><p>Saved reading position.</p>'))});
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (str_starts_with($path, '/theme/bibi/start-fixture/')) {
    $file = resolveReaderCacheFile($package, substr($path, strlen('/theme/bibi/start-fixture/')));
    if ($file === false) { http_response_code(404); exit; }
    header('Content-Type: ' . (str_ends_with($file, '.xhtml') ? 'application/xhtml+xml' : 'application/xml'));
    readfile($file); exit;
}
if ($path !== '/') { http_response_code(404); exit; }
$conf = ['comistream_tool_dir'=>dirname(${library},2), 'epub_reader_package_base'=>'/theme/bibi/start-fixture/'];
$bookName = $baseFile = $escapedFile = 'Start fixture.epub'; $user = 'guest'; $readerMarkerCsrfToken = '';
$_SESSION['packetSave'] = true;
I18n::getInstance()->setLang('ja');
$html = generateEpubHTML();
$harness = ${phpString(harness(coverIndex))};
echo preg_replace('~(\\s*</script>\\s*</body>)~', $harness . '$1', $html);
`;
}

for (const scenario of [
    { name: 'EPUB3 cover landmark' },
    { name: 'EPUB2 cover guide', epub2: true },
    { name: 'first section without a cover landmark', landmark: false },
    { name: 'fixed-layout cover landmark', fixed: true }
]) {
    test(`actual Foliate opens ${scenario.name} and resumes the saved body position`, {
        skip: !chrome || process.env.COMISTREAM_EPUB_BROWSER_TESTS !== '1' || process.env.COMISTREAM_HTTP_TESTS !== '1'
    }, async () => {
        await withPhpFixture(router(scenario), url => runEpubBrowserFixture(url, {
            viewport: { width: 390, height: 844 }
        }));
    });
}
