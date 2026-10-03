const test = require('node:test');
const { withPhpFixture } = require('./http_fixture');
const { chrome } = require('./browser_fixture');
const { runEpubBrowserFixture } = require('./epub_browser_fixture');
const { router } = require('./reader_progress_http_fixture');
const harness = `
window.confirm = () => true;
window.alert = () => {};
(async () => {
  for (let count = 0; !viewInitialized && count < 100; count++) await new Promise(r => setTimeout(r, 100));
  if (!viewInitialized || !epubProgressManager) throw new Error('EPUB reader did not initialize');
  const initial = await fetch('comistream.php?mode=readingState&file=book.epub').then(r=>r.json());
  if (initial.state.revision !== 0) throw new Error('Initial render saved progress');
  await navigate(() => goNextPage());
  await epubProgressManager.flush();
  const saved = await fetch('comistream.php?mode=readingState&file=book.epub').then(r=>r.json());
  if (!saved.state.locator || !saved.state.locator.startsWith('epubcfi(') || saved.state.revision < 1) throw new Error('Actual renderer CFI not saved');
  await navigate(() => applyLayoutOverride(), { allowReadCompletion:false, recordProgress:false });
  await epubProgressManager.flush();
  const layoutState = await fetch('comistream.php?mode=readingState&file=book.epub').then(r=>r.json());
  if (layoutState.state.revision !== saved.state.revision) throw new Error('Layout override saved progress');
  await fetch('comistream.php?mode=testRead');
  await epubProgressManager.refresh();
  await navigate(() => goToBoundary(true));
  await epubProgressManager.flush();
  const cover = await fetch('comistream.php?mode=readingState&file=book.epub').then(r=>r.json());
  if (!cover.state.has_read || cover.state.locator !== currentLocation.cfi) throw new Error('Read EPUB backward position not saved');
  window.__progressNativeResult = {ok:true};
})().catch(error=>{window.__progressNativeResult={ok:false,error:error.stack};});
`;
const viewerRoute = `
$package = $cacheDir . '/fixture';
@mkdir($package . '/META-INF');
file_put_contents($package . '/META-INF/container.xml', '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
file_put_contents($package . '/book.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">fixture</dc:identifier><dc:title>Progress fixture</dc:title><dc:language>en</dc:language></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>');
$content = '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Fixture</title></head><body>' . str_repeat('<p>Reading progress fixture. This text makes multiple pages in the real EPUB renderer.</p>', 150) . '</body></html>';
file_put_contents($package . '/a.xhtml', $content); file_put_contents($package . '/b.xhtml', $content);
$resource = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (str_starts_with($resource, '/theme/bibi/fixture/')) {
    $relative = substr($resource, strlen('/theme/bibi/fixture/'));
    $path = resolveReaderCacheFile($package, $relative);
    if ($path === false) { http_response_code(404); exit; }
    header('Content-Type: ' . (str_ends_with($relative,'.xhtml') ? 'application/xhtml+xml' : 'application/xml'));
    readfile($path); exit;
}
if ($mode === 'testViewer') {
    $conf = ['comistream_tool_dir'=>dirname(${JSON.stringify(require.resolve('../comistream_lib.php'))},2), 'siteName'=>'fixture', 'epub_reader_package_base'=>'/theme/bibi/fixture/'];
    $bookName = $baseFile = $escapedFile = 'book.epub'; $readerMarkerCsrfToken = 'fixture-token';
    $html = generateEpubHTML();
    $harness = json_decode(${JSON.stringify(JSON.stringify(harness))});
    echo preg_replace('~(\\s*</script>\\s*</body>)~', $harness . '$1', $html); exit;
}
`;
const nativeRouter = router.replaceAll('book.cbz', 'book.epub').replace("if ($mode === 'testRead')", viewerRoute + "\nif ($mode === 'testRead')");
test('real Foliate renderer saves generated CFI and backward read position', {
  skip: !chrome || process.env.COMISTREAM_EPUB_BROWSER_TESTS !== '1'
}, async () => {
  await withPhpFixture(nativeRouter, async (url) => {
    await runEpubBrowserFixture(url + '/?mode=testViewer');
  });
});
