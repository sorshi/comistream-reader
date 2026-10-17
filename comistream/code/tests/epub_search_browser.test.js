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
    // フォント適用後の再配置を待ち、キー操作と読書位置の検証を始めるルン。
    await waitForDocumentAssets(getPreferredContentDoc());
    await waitAnimationFrame();
    await waitAnimationFrame();
    await navigate(() => view.goTo(0), { recordProgress: false, allowReadCompletion: false });
    const controller = epubSearchController;
    let origin = currentLocation.cfi;
    const records = [];
    const record = epubProgressManager.record.bind(epubProgressManager);
    epubProgressManager.record = (cfi, options) => { records.push({cfi, ...options}); return record(cfi, options); };
    openMenu();
    expect(document.activeElement !== $('epub-search-menu-input'), 'Menu must not open keyboard');
    const formRect = $('epub-search-menu-form').getBoundingClientRect();
    expect(formRect.top >= document.querySelector('.epub-slider-row').getBoundingClientRect().bottom, 'Search form must follow the position slider');
    expect(formRect.bottom <= document.querySelector('.epub-panel-grid').getBoundingClientRect().top, 'Search form must precede display settings');
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
    const highlight = overlay?.element.querySelector('[data-epub-search-highlight]');
    expect(highlight?.querySelector('rect[fill]'), 'Selected match was not highlighted');
    expect(highlight.querySelector('[data-epub-search-focus]'), 'Search navigation did not start the focus');
    await waitTimeout(400);
    expect(!highlight.querySelector('[data-epub-search-focus]') && highlight.querySelector('rect'), 'Focus did not finish with a static marker');
    overlay.redraw();
    expect(!overlay.element.querySelector('[data-epub-search-focus]'), 'Layout redraw replayed the focus');
    applyTheme('dark', {persist:false}); await controller.refreshHighlight();
    expect(overlay.element.querySelector('[data-epub-search-highlight="dark"] rect'), 'Highlight did not follow dark mode');
    applyTheme('paper', {persist:false}); await controller.refreshHighlight();
    controller.open();
    await controller.move(state.results.at(-1));
    expect(!highlight.isConnected, 'Old result retained its highlight');
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
    for (const [query, count] of [
        ['割込非表示語', 0], ['インライン非表示語', 0], ['不可視指定語', 0], ['折畳不可視語', 0], ['外部CSS非表示語', 0],
        ['親要素非表示語', 0], ['継承不可視語', 0], ['取込CSS非表示語', 0],
        ['変数非表示語', 0], ['重要指定非表示語', 0], ['メディア非表示語', 0],
        ['対応機能非表示語', 0], ['名前空間非表示語', 0], ['埋込取込非表示語', 0],
        ['固定寸法判定語', ${JSON.stringify(mode === 'fixed' ? 0 : 1)}],
        ['子要素表示復帰語', 1], ['一覧指定表示語', 1], ['直接指定表示語', 1],
        ['印刷限定表示語', 1], ['階層指定表示語', 1], ['無効CSS表示語', 1]
    ]) {
        if (${JSON.stringify(mode !== 'paged')} && !['インライン非表示語', '不可視指定語', '外部CSS非表示語', '子要素表示復帰語', '固定寸法判定語'].includes(query)) continue;
        await controller.search(query);
        expect(state.status === 'complete' && state.results.length === count,
            'CSS visibility: '+query+' '+state.status+' '+state.results.length);
    }
    await controller.search('子要素表示復帰語');
    await controller.move(state.results[0]);
    expect(isSearchTargetVisible(state.results[0].cfi), 'Styled result CFI changed');
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
        const makeDocument = body => new DOMParser().parseFromString('<html xmlns="http://www.w3.org/1999/xhtml"><head></head><body>'+body+'</body></html>', 'application/xhtml+xml');
        const styledDoc = makeDocument('<p class="hidden">銀河</p><p>銀河</p><img src="unused.png" onerror="parent.__searchScriptRan=true"/>');
        styledDoc.head.innerHTML = '<link rel="stylesheet" href="../styles/main.css"/>';
        const styledDocs = [styledDoc, styledDoc.cloneNode(true)];
        const originals = styledDocs.map(item => item.documentElement.outerHTML);
        const reads = [];
        const stylesheets = {
            'styles/main.css': '@' + String.fromCharCode(92) + '69mport "nested/hidden.css"; @import "a%26b.css"; @font-face { font-family:Unused; src:url(unused.woff) } p { background-image:url(unused.png) }',
            'styles/nested/hidden.css': '@import "../main.css"; .hidden { display:none }',
            'styles/a&b.css': 'p { color:blue }'
        };
        fake.book.sections = styledDocs.map(item => ({
            id: 'chapters/a.xhtml', createDocument: async () => item
        }));
        fake.book.loadText = async path => {
            reads.push(path);
            expect(path in stylesheets, 'Search loaded a non-CSS resource: '+path);
            return stylesheets[path];
        };
        fake.getCFI = (index, range) => {
            expect(range.startContainer.ownerDocument === styledDocs[index], 'CFI used the style clone');
            return 'test-cfi';
        };
        results = [];
        const focused = document.activeElement;
        const styled = await scan({view:fake,query:'銀河',loadModules,current:()=>true,onMatch:item=>results.push(item)});
        expect(!styled.failures && results.length === 2, 'Imported or cyclic stylesheet filtering');
        expect(reads.length === 3 && new Set(reads).size === 3, 'Stylesheets were not cached across sections');
        expect(styledDocs.every((item, index) => item.documentElement.outerHTML === originals[index]), 'Search modified the original DOM');
        expect(!window.__searchScriptRan && document.activeElement === focused, 'Style evaluation ran book handlers or stole focus');
        expect(!document.querySelector('[data-epub-search-document]'), 'Completed search retained its style frame');
        const cancelDoc = makeDocument('<p>銀河</p>');
        cancelDoc.head.innerHTML = '<link rel="stylesheet" href="cancel.css"/>';
        let releaseCss;
        valid = true;
        fake.book.sections = [{id:'a.xhtml',createDocument:async()=>cancelDoc}];
        fake.book.loadText = () => new Promise(resolve => { releaseCss = resolve; });
        results = [];
        const canceledCss = scan({view:fake,query:'銀河',loadModules,current:()=>valid,onMatch:item=>results.push(item)});
        for (let i = 0; !releaseCss && i < 50; i++) await waitTimeout(10);
        expect(releaseCss, 'Stylesheet load did not start');
        valid = false;
        const canceledStyleScan = await canceledCss;
        expect(canceledStyleScan.canceled && !results.length && !document.querySelector('[data-epub-search-document]'), 'Canceled stylesheet load retained results or a frame');
        releaseCss('p { display:none }');
        fake.book.loadText = async () => { throw Error('unavailable stylesheet'); };
        fake.book.sections = [{id:'a.xhtml',createDocument:async()=>cancelDoc},{createDocument:async()=>doc}];
        fake.getCFI = () => 'test-cfi';
        results = [];
        const failedCss = await scan({view:fake,query:'銀河',loadModules,current:()=>true,onMatch:item=>results.push(item)});
        expect(failedCss.failures === 1 && results.length === 3, 'Stylesheet failure was silently searched or lost other sections');
        expect(!document.querySelector('[data-epub-search-document]'), 'Failed search retained its style frame');
        const htmlDoc = new DOMParser().parseFromString('<!doctype html><style>.hidden { display:none }</style><p class="hidden">銀河</p><table><tr><td>銀河</td></tr></table>', 'text/html');
        fake.book.sections = [{createDocument:async()=>htmlDoc}];
        fake.getCFI = (_, range) => {
            const rendered = document.querySelector('[data-epub-search-document]').contentDocument;
            expect(rendered.compatMode === htmlDoc.compatMode, 'Search changed the HTML rendering mode');
            expect(range.startContainer.ownerDocument === htmlDoc, 'HTML search used the clone for CFI');
            return 'test-cfi';
        };
        results = [];
        const htmlScan = await scan({view:fake,query:'銀河',loadModules,current:()=>true,onMatch:item=>results.push(item)});
        expect(!htmlScan.failures && results.length === 1, 'HTML fallback changed the parsed structure or visibility');
        fake.getCFI = () => 'test-cfi';
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
    await controller.refreshHighlight();
    expect(!getRendererContents().some(item => item.overlayer?.element.querySelector('[data-epub-search-highlight]')), 'Finishing search retained a highlight');
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
@mkdir($package . '/styles'); @mkdir($package . '/styles/imports');
file_put_contents($package . '/styles/hidden.css', '@import "imports/hidden.css" layer(imported) screen; @namespace epub url("http://www.idpf.org/2007/ops"); @media (width:600px) and (height:800px) { .viewport-hidden { display:none } } .css-hidden { display:none } .css-invisible { visibility:hidden } .visible-child { visibility:visible } #absent, .selector-visible { display:none } p.selector-visible { display:block } p#inline-visible { display:none } .variable-hidden { --search-display:none; display:var(--search-display) } .important-hidden { display:none !important } @media screen and (min-width:1px) { .media-hidden { display:none } } @media print { .print-visible { display:none } } @supports (display:grid) { .supports-hidden { display:none } } [epub|type~="note"] { display:none } @layer lower, higher; @layer lower { .layer-visible { display:none } } @layer higher { .layer-visible { display:block } }');
file_put_contents($package . '/styles/imports/hidden.css', '.import-hidden { display:none }');
file_put_contents($package . '/styles/inline.css', '.inline-import-hidden { display:none }');
file_put_contents($package . '/styles/disabled.css', '.disabled-visible { display:none }');
file_put_contents($package . '/META-INF/container.xml', '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
file_put_contents($package . '/book.opf', '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">search-fixture</dc:identifier><dc:title>Search fixture</dc:title><dc:language>ja</dc:language>${layout}</metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/><item id="style" href="styles/hidden.css" media-type="text/css"/><item id="import-style" href="styles/imports/hidden.css" media-type="text/css"/><item id="inline-style" href="styles/inline.css" media-type="text/css"/><item id="disabled-style" href="styles/disabled.css" media-type="text/css"/></manifest><spine><itemref idref="a"/><itemref idref="b"/><itemref idref="c"/></spine></package>');
$bodies = [
    'a'=>'<h1>丘の上</h1><p><ruby>銀河<rt>ぎんが</rt></ruby>の光。観<span style="display:none">割込非表示語</span><strong>測</strong>所。</p><p>片</p><p>方</p><p>境<br/>界</p><p hidden="hidden">隠された語</p><p aria-hidden="true">隠された語</p><p style="display:none">インライン非表示語</p><p style="visibility:hidden">不可視指定語</p><p style="visibility:collapse">折畳不可視語</p><p class="css-hidden">外部CSS非表示語</p><div style="display:none"><p>親要素非表示語</p></div><div class="css-invisible"><p>継承不可視語</p><p class="visible-child">子要素表示復帰語</p></div><p class="import-hidden">取込CSS非表示語</p><p class="variable-hidden">変数非表示語</p><p class="important-hidden" style="display:block">重要指定非表示語</p><p class="media-hidden">メディア非表示語</p><p class="supports-hidden">対応機能非表示語</p><p xmlns:epub="http://www.idpf.org/2007/ops" epub:type="note">名前空間非表示語</p><p class="inline-import-hidden">埋込取込非表示語</p><p class="selector-visible">一覧指定表示語</p><p id="inline-visible" style="display:block">直接指定表示語</p><p class="print-visible">印刷限定表示語</p><p class="layer-visible">階層指定表示語</p><p class="disabled-visible">無効CSS表示語</p><p class="viewport-hidden">固定寸法判定語</p><p>a.b axb (a+) Galaxy がくとかく。</p><p>&lt;img src=x onerror=alert(1)&gt;</p>',
    'b'=>'<h1>夜の観測所</h1><p>🌌銀河</p>',
    'c'=>'<p>銀河</p>'
];
foreach ($bodies as $name=>$body) file_put_contents($package . '/' . $name . '.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapter</title><meta name="viewport" content="width=600,height=800"/><link rel="stylesheet" href="styles/hidden.css"/><link rel="stylesheet" disabled="disabled" href="styles/disabled.css"/><style>@import "styles/inline.css";</style></head><body style="${bodyStyle}">' . $body . '</body></html>');
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
if (str_starts_with($path, '/theme/bibi/search-fixture/')) {
    $file = resolveReaderCacheFile($package, substr($path, strlen('/theme/bibi/search-fixture/')));
    if ($file === false) { http_response_code(404); exit; }
    header('Content-Type: ' . (str_ends_with($file, '.xhtml') ? 'application/xhtml+xml' : (str_ends_with($file, '.css') ? 'text/css' : 'application/xml')));
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
