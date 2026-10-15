const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('image URLs change only when the book cache generation changes', () => {
    const source = fs.readFileSync(require.resolve('../comistream.js'), 'utf8');
    const code = source.slice(source.indexOf('function getFullImageUrl('), source.indexOf('// 時計の表示/非表示'));
    const context = vm.createContext({ URL, window: { location: { origin: 'https://reader.test', pathname: '/cgi-bin/comistream.php' } }, file: 'stable-book-id', size: 'FULL', view_query: '', autoLightSplitMode: false, readerCacheGeneration: 'old' });
    vm.runInContext(code, context);
    const first = context.getFullImageUrl(1);
    assert.equal(context.getFullImageUrl(1), first);
    context.readerCacheGeneration = 'new';
    const next = new URL(context.getFullImageUrl(1));
    assert.notEqual(next.href, first);
    assert.equal(next.searchParams.get('file'), 'stable-book-id');
    assert.equal(next.searchParams.get('cache_version'), 'new');
});

test('all EPUB resource URLs and missing-resource records use the current generation', () => {
    const source = fs.readFileSync(require.resolve('../epub_reader.js'), 'utf8');
    const code = source.slice(source.indexOf('function packageFileUrl('), source.indexOf('function restoreOptionalMissingPaths('));
    const context = vm.createContext({ URL, appConfig: { cacheGeneration: 'old' }, OPTIONAL_PACKAGE_MISSING_PREFIX: 'missing:', window: { location: { origin: 'https://reader.test', href: 'https://reader.test/cgi-bin/comistream.php' } }, console });
    vm.runInContext(code, context);
    for (const base of ['/theme/bibi/book-id/', 'https://reader.test/theme/bibi/book-id/']) {
        const oldKey = context.optionalPackageMissingKey(base);
        const oldUrl = context.packageFileUrl(base, 'EPUB/章 #1.xhtml');
        context.appConfig.cacheGeneration = 'new';
        const next = new URL(context.packageFileUrl(base, 'EPUB/章 #1.xhtml'));
        assert.notEqual(next.href, oldUrl);
        assert.equal(next.searchParams.get('cache_version'), 'new');
        assert.notEqual(context.optionalPackageMissingKey(base), oldKey);
        context.appConfig.cacheGeneration = 'old';
    }
});
