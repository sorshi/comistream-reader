const test = require('node:test');
const { withPhpFixture } = require('./http_fixture');
const { chrome } = require('./browser_fixture');
const { runEpubBrowserFixture } = require('./epub_browser_fixture');
const library = JSON.stringify(require.resolve('../comistream_lib.php'));

function harness(mode) {
    return `
(async () => {
    const expect = (value, message) => { if (!value) throw new Error(message); };
    for (let i = 0; !viewInitialized && i < 150; i++) await waitTimeout(100);
    expect(viewInitialized && epubSearchController, 'Search initialization');
    if (${JSON.stringify(mode)} === 'scrolled') {
        currentFlowMode = 'scrolled'; applyRendererPrefs();
    }
    await navigate(() => view.goTo(0), { recordProgress: false, allowReadCompletion: false });
    const controller = epubSearchController;
    let origin = currentLocation.cfi;
    const records = [];
    const record = epubProgressManager.record.bind(epubProgressManager);
    epubProgressManager.record = (cfi, options) => { records.push({cfi, ...options}); return record(cfi, options); };
    openMenu();
    expect(document.activeElement !== $('epub-search-menu-input'), 'Menu must not open keyboard');
    await controller.search('銀河');
    let state = controller.getState();
    expect(state.status === 'complete', 'Search status: ' + state.status + ' failures:' + state.failures);
    expect(state.results.length === 3, 'Ruby and section-end matches: ' + state.results.length);
    expect(records.length === 0, 'Search alone changed progress');
    expect($('epub-search-panel').open, 'Search panel is not open');
    const panel = $('epub-search-panel');
    expect(panel.scrollWidth <= panel.clientWidth, 'Search panel overflows');
    for (const button of panel.querySelectorAll('button:not([hidden])')) {
        expect(button.scrollWidth <= button.clientWidth, 'Clipped button: ' + button.id);
    }
    const input = $('epub-search-input');
    input.focus(); focusReader();
    expect(document.activeElement === input, 'Reader stole search focus');
    input.value = 'not submitted'; input.dispatchEvent(new Event('input'));
    expect($('epub-search-query').textContent.includes('銀河'), 'Draft changed active query');
    input.dispatchEvent(new CompositionEvent('compositionstart'));
    $('epub-search-form').requestSubmit();
    expect(state.query === '銀河', 'IME composition submitted a search');
    input.dispatchEvent(new CompositionEvent('compositionend'));
    const beforeKey = currentLocation.cfi;
    input.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight',code:'ArrowRight',bubbles:true,cancelable:true}));
    await waitTimeout(50);
    expect(currentLocation.cfi === beforeKey, 'Search key navigated the book');
    origin = currentLocation.cfi;
    await controller.move(state.results[0]);
    expect(isSearchTargetVisible(state.results[0].cfi), 'Ruby result CFI is not visible');
    const overlay = getRendererContents().find(item=>item.index===0)?.overlayer;
    expect(overlay?.element.querySelector('g[stroke] rect'), 'Selected match was not highlighted');
    controller.open();
    await controller.move(state.results.at(-1));
    expect(!panel.open && state.selected, 'Result navigation failed: ' + $('epub-search-error').textContent);
    expect(state.origin === origin, 'Search origin was not captured: '+JSON.stringify({origin,actual:state.origin}));
    expect(isSearchTargetVisible(state.results.at(-1).cfi), 'Target range is not visible');
    expect(!epubEndController.isOpen(), 'Search opened the end panel');
    expect(!records.some(item => item.completed), 'Search marked the book completed');
    expect(records.length > 0, 'Search navigation did not save position');
    expect(!$('epub-search-bar').hidden, 'Result bar is missing');
    $('epub-search-collapse').click();
    expect($('epub-search-bar-actions').hidden, 'Bar did not collapse');
    controller.open();
    expect(document.activeElement !== input, 'Reopening search opened keyboard');
    await controller.search('観測所。');
    expect(state.origin === origin, 'Re-search replaced the origin');
    expect(state.results.length === 1, 'Inline text match');
    await controller.move(state.results[0]);
    await controller.move(null, true);
    expect(state.status === 'idle', 'Return did not end search: '+JSON.stringify({origin:state.origin,current:currentLocation.cfi,error:$('epub-search-error').textContent,index:getLocationSectionIndex(currentLocation),visible:getRendererContents().map(item=>item.index)}));
    expect(isSearchTargetVisible(origin), 'Original reading range not restored');
    expect(!records.some(item => item.completed), 'Return marked completion');
    if (${JSON.stringify(mode)} === 'paged') {
        const cases = [['ぎんが',0],['隠された語',0],['片方',0],['境界',0],['a.b',1],['(a+)',1],['galaxy',1],['かく',1]];
        for (const [query, count] of cases) {
            await controller.search(query);
            expect(state.results.length === count && state.status === 'complete', 'Literal/filter search: '+query+' '+state.results.length);
        }
        await controller.search('<img');
        expect(state.results.length === 1 && !$('epub-search-list').querySelector('img'), 'Result interpreted as HTML');
        const old = controller.search('銀河');
        const latest = controller.search('観測所。');
        await Promise.all([old, latest]);
        expect(state.query === '観測所。' && state.results.length === 1, 'Old search results leaked');
        const canceled = controller.search('銀河');
        controller.stop(); await canceled;
        expect(state.status === 'stopped' && !state.results.length, 'Canceled search appended results');
        const scan = window.ComistreamEpubSearch.scanBook;
        const [{searchMatcher},{textWalker}] = await Promise.all([
            import(FOLIATE_MODULE_BASE+'search.js'), import(FOLIATE_MODULE_BASE+'text-walker.js')]);
        const loadModules = async () => ({searchMatcher,textWalker});
        const doc = new DOMParser().parseFromString('<html xmlns="http://www.w3.org/1999/xhtml"><body><p>銀河銀河銀河</p></body></html>', 'application/xhtml+xml');
        let results = [];
        const fake = {book:{sections:[{createDocument:async()=>doc},{createDocument:async()=>{throw Error('unavailable');}}]},getCFI:()=> 'test-cfi'};
        const partial = await scan({view:fake,query:'銀河',loadModules,current:()=>true,onMatch:item=>results.push(item)});
        expect(partial.failures === 1 && results.length === 3, 'Partial failure lost results');
        results = [];
        const capped = await scan({view:fake,query:'銀河',loadModules,current:()=>true,limit:2,onMatch:item=>results.push(item)});
        expect(capped.capped && results.length === 2, 'Result cap did not stop collection');
        let release, valid = true;
        fake.book.sections = [{createDocument:()=>new Promise(resolve=>{release=()=>resolve(doc);})}];
        results = [];
        const pending = scan({view:fake,query:'銀河',loadModules,current:()=>valid,onMatch:item=>results.push(item)});
        for(let i=0;!release && i<50;i++) await waitTimeout(10);
        expect(release, 'Delayed scan not started'); valid=false; release(); await pending;
        expect(!results.length, 'Canceled document load published results');
        const makeDocument = body => new DOMParser().parseFromString('<html xmlns="http://www.w3.org/1999/xhtml"><body>'+body+'</body></html>', 'application/xhtml+xml');
        const largeDoc = makeDocument('<p>'+'星'.repeat(1000000)+'</p>');
        fake.book.sections = [{createDocument:async()=>largeDoc}];
        const started = performance.now();
        const large = await scan({view:fake,query:'一致しない語',loadModules,current:()=>true,onMatch:()=>{throw Error('unexpected');}});
        expect(large.hasText && !large.failures && performance.now()-started < 2000, 'Large no-match document blocked search');
        const originalCreate = view.book.sections[0].createDocument;
        view.book.sections[0].createDocument = async()=>makeDocument('<p>頻出</p>'.repeat(125));
        try {
            await controller.search('頻出');
            expect(state.results.length === 125 && $('epub-search-list').children.length === 50, 'Initial result batch');
            $('epub-search-more').click();
            expect($('epub-search-list').children.length === 100, 'Show more result batch');
            controller.finish();
        } finally { view.book.sections[0].createDocument = originalCreate; }
    }
    controller.finish();
    expect(!$('epub-search-panel').open && $('epub-search-bar').hidden, 'Search did not finish');
    await controller.search('銀河');
    panel.style.setProperty('--epub-search-height','350px');
    expect(input.getBoundingClientRect().bottom <= panel.getBoundingClientRect().bottom, 'Keyboard hid search input');
    expect($('epub-search-close').getBoundingClientRect().bottom <= panel.getBoundingClientRect().bottom, 'Keyboard hid close button');
    panel.style.removeProperty('--epub-search-height');
    document.documentElement.style.fontSize = '200%';
    expect(panel.scrollWidth <= panel.clientWidth, 'Enlarged text overflows panel');
    expect(input.getBoundingClientRect().right <= panel.getBoundingClientRect().right, 'Enlarged input overflows panel');
    document.documentElement.style.fontSize = '';
    controller.finish();
    if (${JSON.stringify(Boolean(process.env.COMISTREAM_SEARCH_SCREENSHOT))}) await controller.search('銀河');
    window.__progressNativeResult = {ok:true};
})().catch(error => { window.__progressNativeResult = {ok:false,error:error.stack}; });
`;
}

function router(mode) {
    const vertical = mode === 'vertical';
    const layout = mode === 'fixed' ? '<meta property="rendition:layout">pre-paginated</meta>' : '';
    const bodyStyle = vertical ? 'writing-mode:vertical-rl' : 'writing-mode:horizontal-tb';
    return `<?php
require ${library};
require_once dirname(${library}) . '/i18n.php';
$package = __DIR__ . '/package';
@mkdir($package); @mkdir($package . '/META-INF');
file_put_contents($package . '/META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
file_put_contents($package . '/book.opf', '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">search-fixture</dc:identifier><dc:title>Search fixture</dc:title><dc:language>ja</dc:language>${layout}</metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/><itemref idref="c"/></spine></package>');
$bodies = [
    'a'=>'<h1>丘の上</h1><p><ruby>銀河<rt>ぎんが</rt></ruby>の光。観<strong>測</strong>所。</p><p>片</p><p>方</p><p>境<br/>界</p><p hidden="hidden">隠された語</p><p aria-hidden="true">隠された語</p><p>a.b axb (a+) Galaxy がくとかく。</p><p>&lt;img src=x onerror=alert(1)&gt;</p>',
    'b'=>'<h1>夜の観測所</h1><p>🌌銀河</p>',
    'c'=>'<p>銀河</p>'
];
foreach ($bodies as $name=>$body) file_put_contents($package . '/' . $name . '.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title><meta name="viewport" content="width=600,height=800"/></head><body style="${bodyStyle}">' . $body . '</body></html>');
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (str_starts_with($path, '/theme/bibi/search-fixture/')) {
    $file = resolveReaderCacheFile($package, substr($path, strlen('/theme/bibi/search-fixture/')));
    if ($file === false) { http_response_code(404); exit; }
    header('Content-Type: ' . (str_ends_with($file, '.xhtml') ? 'application/xhtml+xml' : 'application/xml'));
    readfile($file); exit;
}
if ($path !== '/') { http_response_code(404); exit; }
$conf = ['comistream_tool_dir'=>dirname(${library},2), 'publicDir'=>'/nas', 'epub_reader_package_base'=>'/theme/bibi/search-fixture/'];
$bookName = $baseFile = $escapedFile = 'Search fixture.epub'; $user = 'guest'; $readerMarkerCsrfToken = '';
I18n::getInstance()->setLang('${mode === 'english' ? 'en' : 'ja'}');
$html = generateEpubHTML();
$harness = json_decode(${JSON.stringify(JSON.stringify(harness(mode)))});
echo preg_replace('~(\\s*</script>\\s*</body>)~', $harness . '$1', $html);
`;
}

for (const mode of ['paged', 'vertical', 'scrolled', 'fixed', 'english']) {
    test(`EPUB search ${mode}: literal results, CFI navigation, return and progress`, {
        skip: !chrome || process.env.COMISTREAM_EPUB_BROWSER_TESTS !== '1' || process.env.COMISTREAM_HTTP_TESTS !== '1'
    }, async () => {
        await withPhpFixture(router(mode), url => runEpubBrowserFixture(url, {
            viewport: {width: ['paged','english'].includes(mode) ? 320 : mode === 'scrolled' ? 390 : 1024, height:768},
            screenshotPath: process.env.COMISTREAM_SEARCH_SCREENSHOT || undefined
        }));
    });
}
