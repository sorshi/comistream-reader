const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { chrome } = require('./browser_fixture');
const { withPhpFixture } = require('./http_fixture');
const { runEpubBrowserFixture } = require('./epub_browser_fixture');

test('browser fetches new EPUB and page content after cache generation changes', {
    skip: !chrome || process.env.COMISTREAM_HTTP_TESTS !== '1'
}, async () => {
    const imageSource = fs.readFileSync(path.join(__dirname, '../comistream.js'), 'utf8');
    const imageUrl = imageSource.slice(imageSource.indexOf('function getFullImageUrl('), imageSource.indexOf('// 時計の表示/非表示'));
    const epubSource = fs.readFileSync(path.join(__dirname, '../epub_reader.js'), 'utf8');
    const epubUrl = epubSource.slice(epubSource.indexOf('function packageFileUrl('), epubSource.indexOf('function optionalPackageMissingKey('));
    const script = `
        const file = 'stable-book-id', size = 'FULL', view_query = '', autoLightSplitMode = false;
        let readerCacheGeneration = 'first';
        const appConfig = { cacheGeneration: 'first' };
        ${imageUrl}
        ${epubUrl}
        (async () => {
            const firstPage = getFullImageUrl(1);
            const firstEpub = packageFileUrl('/epub/', 'chapter.xhtml');
            for (const url of [firstPage, firstEpub]) {
                if (await (await fetch(url)).text() !== 'old content') throw new Error('Initial content missing.');
            }
            await fetch('/replace', { method: 'POST' });
            for (const url of [firstPage, firstEpub]) {
                if (await (await fetch(url)).text() !== 'old content') throw new Error('Fixture did not retain the old HTTP cache.');
            }
            readerCacheGeneration = appConfig.cacheGeneration = 'second';
            for (const url of [getFullImageUrl(1), packageFileUrl('/epub/', 'chapter.xhtml')]) {
                if (await (await fetch(url)).text() !== 'new content') throw new Error('New generation reused old HTTP content.');
            }
            window.__progressNativeResult = { ok: true };
        })().catch(error => { window.__progressNativeResult = { ok: false, error: error.stack }; });
    `;
    const html = '<!doctype html><meta charset="utf-8"><script>' + script + '</script>';
    const router = `<?php
        $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
        if ($path === '/replace') {
            file_put_contents(__DIR__ . '/changed', '1');
            header('Cache-Control: no-store');
            exit;
        }
        if (isset($_GET['page']) || $path === '/epub/chapter.xhtml') {
            header('Content-Type: text/plain');
            header('Cache-Control: private, max-age=86400');
            echo is_file(__DIR__ . '/changed') ? 'new content' : 'old content';
            exit;
        }
        header('Content-Type: text/html');
        header('Cache-Control: no-store');
        echo base64_decode('${Buffer.from(html).toString('base64')}');
    `;
    await withPhpFixture(router, async url => {
        if (url === null) throw new Error('HTTP fixture is disabled.');
        await runEpubBrowserFixture(url);
    });
});
