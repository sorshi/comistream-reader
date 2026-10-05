const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { normalizeSuggestions } = require('../epub_end');

const controller = fs.readFileSync(path.join(__dirname, '../comistream.php'), 'utf8');
const libraryPath = path.join(__dirname, '../comistream_lib.php');
const library = fs.readFileSync(libraryPath, 'utf8');
const parserStart = controller.indexOf('$param = array();');
const parserEnd = controller.indexOf('writelog("DEBUG QUERY_STRING:', parserStart);
assert.ok(parserStart >= 0 && parserEnd > parserStart, 'Reader request parser was not found.');
const parser = controller.slice(parserStart, parserEnd);
const handlerStart = library.indexOf('function handleFoliateEpubOpen()');
const decoder = library.slice(handlerStart).match(/\$remotePath = [^\n]+;/)?.[0];
assert.ok(handlerStart >= 0 && decoder, 'EPUB path decoder was not found.');

// 実際のGET解析とEPUBのデコードを使い、共有領域内のファイル解決まで確認するルン。
const php = `
$input = json_decode(stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
require $input['library'];
$_SERVER['REQUEST_METHOD'] = 'GET';
$_SERVER['QUERY_STRING'] = $input['query'];
eval($input['parser']);
$file = $param['file'];
eval($input['decoder']);
echo json_encode([
    'path' => $remotePath,
    'resolved' => resolveFileWithinBaseDirectory($input['root'], $remotePath),
    'mode' => $param['mode'],
], JSON_THROW_ON_ERROR);
`;

function imageSuggestionHref(relative) {
    const source = fs.readFileSync(path.join(__dirname, '../comistream.js'), 'utf8');
    const start = source.indexOf('function addnextbooklist(');
    const end = source.indexOf('async function refreshAutoLightSplitLayout', start);
    assert.ok(start >= 0 && end > start, 'Image reader suggestion builder was not found.');
    const list = { appendChild(row) { this.row = row; } };
    const scope = vm.createContext({
        publicDir: '/nas', themeDir: '', URL,
        location: { pathname: '/cgi-bin/comistream.php', origin: 'https://reader.invalid' },
        document: {
            getElementById: id => id === 'suggest-books' ? list : null,
            createElement: () => ({ append(...children) { this.children = children; }, addEventListener() {} }),
        },
    });
    vm.runInContext(source.slice(start, end), scope);
    scope.addnextbooklist('Next', '/nas/' + relative);
    return list.row.children[1].href;
}

for (const [reader, buildHref] of [
    ['EPUB', relative => normalizeSuggestions({ title: { new: { Next: '/nas/' + relative } } }, {
        publicDir: '/nas', baseFile: 'Current.epub', readerUrl: 'https://reader.invalid/cgi-bin/comistream.php',
    })[0].href],
    ['image', imageSuggestionHref],
]) {
    test(`${reader} suggestions resolve spaces and literal plus signs through the PHP reader`, () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comistream-suggestion-path-'));
        try {
            for (const relative of [
                'novel/サ行/作品 [作者×作画] -10 epub/作品 2【電子特典付き】.epub',
                'novel/作品+続編 2.epub',
                'novel/作品+続編.epub',
                'novel/作品 & #?= 2.epub',
                'novel/作品2.epub',
            ]) {
                const target = path.join(root, relative);
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.writeFileSync(target, 'fixture');
                const url = new URL(buildHref(relative));
                const result = JSON.parse(execFileSync('php', ['-r', php], {
                    encoding: 'utf8',
                    input: JSON.stringify({ library: libraryPath, query: url.search.slice(1), parser, decoder, root }),
                }));
                assert.equal(result.path, relative, 'The PHP reader changed the suggested filename.');
                assert.equal(result.resolved, fs.realpathSync(target), 'The suggested book could not be found.');
                assert.equal(result.mode, 'open');
                assert.equal(url.origin, 'https://reader.invalid');
                assert.equal(url.pathname, '/cgi-bin/comistream.php');
            }
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
}
