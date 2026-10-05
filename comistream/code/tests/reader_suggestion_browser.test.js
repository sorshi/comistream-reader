const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { chrome, literal, runBrowserFixture } = require('./browser_fixture');
const panels = chrome ? JSON.parse(execFileSync('php', [path.join(__dirname, 'reader_end_panel.test.php'), '--fixture-json'], { encoding: 'utf8' })) : null;

test('readerの続刊名は文字列になり、リンクはreader URLと保存処理を維持する', { skip: !chrome }, async () => {
  const source = fs.readFileSync(path.join(__dirname, '../comistream.js'), 'utf8');
  const start = source.indexOf('async function sugguestbook()');
  const end = source.indexOf('async function refreshAutoLightSplitLayout', start);
  const code = source.slice(start, end);
  const filename = '<img src=x onerror=alert(1)>.zip';
  const nextTitle = "Sequel <img src=x onerror=alert(2)> ' quoted";
  await runBrowserFixture(`
    const baseFile = ${literal(filename)}, publicDir = '/nas', themeDir = '', cgiPath = '/cgi-bin/comistream.php';
    const saved = { count: 0 }, suggest = document.getElementById('suggest');
    location.pathname = '/cgi-bin/comistream.php';
    location.replace = (href) => { window.nextLocation = href; };
    window.readerClosing = false; window.readerNavigationPromise = null; window.savePageTimer = null; window.lastSaveTime = 0; window.readerProgressManager = null;
    globalThis.saveCurrentPage = () => { saved.count++; };
    globalThis.debugLog = () => {};
    globalThis.fetch = async () => ({ ok: true, json: async () => ({
      title: { new: { [${literal(nextTitle)}]: '/nas/Next Book.zip' }, old: {}, }, author: {},
    }) });
    ${code}
    document.addEventListener('click', (event) => event.preventDefault(), true);
    window.testDone = false;
    sugguestbook().then(() => {
      try {
        expect(!suggest.querySelector('[onerror],img[src="x"],script'), 'Filenames became active markup');
        expect(suggest.textContent.includes(${literal(filename)}) && suggest.textContent.includes(${literal(nextTitle)}), 'Normal titles changed');
        const next = [...suggest.querySelectorAll('a')].find((anchor) => anchor.textContent === ${literal(nextTitle)});
        expect(next && next.href.startsWith('https://reader.invalid/cgi-bin/comistream.php?'), 'Continue link no longer uses the reader endpoint');
        next.click();
        expect(saved.count === 1, 'Reader position was not saved before following the book link');
        const savedUrl = new URL(window.nextLocation);
        expect(savedUrl.searchParams.get('file') === 'Next Book.zip' && savedUrl.searchParams.get('mode') === 'open', 'Next book path changed');
        expect(window.pwned === 0, 'A script handler was run');
      } catch (error) { window.pwned++; }
      window.testDone = true;
    }, () => { window.pwned++; window.testDone = true; });
  `, panels.cbz);
});

test('recommendation endpoint failure still displays the book title as text', { skip: !chrome }, async () => {
  const source = fs.readFileSync(path.join(__dirname, '../comistream.js'), 'utf8');
  const start = source.indexOf('async function sugguestbook()');
  const end = source.indexOf('async function refreshAutoLightSplitLayout', start);
  const baseFile = '<img src=x onerror=alert(1)>.zip';
  await runBrowserFixture(`
    const baseFile = ${literal(baseFile)}, themeDir = '';
    const suggestElement = document.getElementById('suggest');
    globalThis.debugLog = () => {};
    globalThis.fetch = async () => { throw new Error('extension unavailable'); };
    ${source.slice(start, end)}
    window.testDone = false;
    sugguestbook().then(() => {
      try {
        expect(!suggestElement.querySelector('[onerror],img[src="x"],script'), 'Error title became active markup');
        expect(suggestElement.textContent.includes(${literal(baseFile)}), 'Error title changed');
      } catch (_) { window.pwned++; }
      window.testDone = true;
    }, () => { window.pwned++; window.testDone = true; });
  `, panels.cbz);
});
