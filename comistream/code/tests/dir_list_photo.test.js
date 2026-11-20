const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chrome, literal, runBrowserFixture } = require('./browser_fixture');

const source = fs.readFileSync(path.resolve(__dirname, '../dir_list_photo.js'), 'utf8');
const markup = fs.readFileSync(path.resolve(__dirname, '../dir_list.php'), 'utf8');
const css = fs.readFileSync(path.resolve(__dirname, '../../theme/style_cover.css'), 'utf8');

test('形式判定用の画像と変換幅の段階', () => {
  const context = vm.createContext({ document: { addEventListener() {} } });
  vm.runInContext(source, context);
  const run = text => vm.runInContext(text, context);
  for (const format of ['heic', 'tiff']) {
    const fromSource = run(`photoFormatProbes.${format}`).split(',')[1];
    const fromFixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'photo-probe.' + format)).toString('base64');
    assert.equal(fromSource, fromFixture);
  }
  assert.equal(run("photoFormat('IMG.HEIF')"), 'heic');
  assert.equal(run("photoFormat('IMG.TIF')"), 'tiff');
  assert.equal(run('photoViewWidth(512, 400, 2)'), 1024);
  assert.equal(run('photoViewWidth(400, 513, 2)'), 1600);
  assert.equal(run('photoViewWidth(800, 601, 2.01)'), 2048);
  assert.equal(run('photoViewWidth(8000, 400, 4)'), 2048);
});

test('Chromeで写真チップ・先読み画像の再利用・戻る・503再試行を確認する', { skip: !chrome }, async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAE0lEQVQI12P8z8DAwMDAxIBMAQAUQAEF4rfbNgAAAABJRU5ErkJggg==';
  const webp = 'UklGRjgAAABXRUJQVlA4ICwAAACQAQCdASoCAAMAAgA0JaACdLoAA5gA/vmTb/+QH/+QH/+QH/8gP+IXeyAwAA==';
  const start = markup.indexOf('<dialog id="photoLightbox"');
  const finish = markup.indexOf('</dialog>', start) + '</dialog>'.length;
  const dialog = markup.slice(start, finish).replace(/<\?php echo \$photoText\('([^']+)'\); \?>/g, '$1');
  const items = [
    { name: 'a.png', kind: 'image', href: png + '#a' },
    { name: 'movie.mov', kind: 'video', href: '/movie.mov' },
    { name: 'b.png', kind: 'image', href: png + '#b' },
    { name: 'c.HEIC', kind: 'image', href: 'data:image/heic;base64,AAAA', view_convert: '/cgi-bin/photo_view.php?file=c.HEIC&v=100-400', thumb: png, size_formatted: '400B' },
  ];
  const rows = items.map(item => `<tr data-kind="${item.kind}"><td class="indexcolname"><a href="${item.href}">${item.name}</a></td></tr>`).join('');
  const html = `<style>${css}</style>
    <div id="coverLayoutChip" hidden><button data-layout="book">Books</button><button data-layout="photo">Photos</button></div>
    <table id="indexlist"><thead><tr class="indexhead"><th>Name</th></tr></thead><tbody id="table-tbody">${rows}</tbody></table>${dialog}`;
  await runBrowserFixture(`
    location.pathname = '/album/';
    ${source}
    let mode = 'cover';
    function getCookie() { return mode; }
    function applySortChangeCore() {}
    function addCoverImages() {}
    function removeCoverImages() {}
    function updateCoverSideGutter() {}
    const items = ${literal(items)};
    const chip = document.getElementById('coverLayoutChip');
    const table = document.getElementById('indexlist');
    const book = chip.querySelector('[data-layout=book]');
    const photo = chip.querySelector('[data-layout=photo]');
    window.testDone = false;
    window.addEventListener('DOMContentLoaded', async () => {
      try {
        setPhotoDirectory(items, { photo: { is_photo_dir: true, show_layout_chip: true } });
        expect(!chip.hidden && table.classList.contains('photo-layout'), 'Auto grid did not appear');
        expect(getComputedStyle(table).display === 'grid', 'Photo table is not a grid');
        const firstTile = table.querySelector('tbody tr').getBoundingClientRect();
        expect(Math.abs(firstTile.width - firstTile.height) < 1, 'Tile is not square');
        expect(getComputedStyle(table.tHead).display === 'none', 'Header occupies a grid position');
        book.click();
        expect(!table.classList.contains('photo-layout') && book.classList.contains('manual-layout'), 'Manual layout not applied');
        expect(localStorage.getItem('comistream_cover_layout:/album') === 'book', 'Override was not saved');
        mode = 'list';
        syncCoverPhotoLayout();
        expect(chip.hidden && !table.classList.contains('photo-layout'), 'List showed photo controls');
        mode = 'cover';
        syncCoverPhotoLayout();
        expect(book.getAttribute('aria-pressed') === 'true', 'Cover layout preference lost on toggle');
        photo.click();
        expect(table.classList.contains('photo-layout') && localStorage.getItem('comistream_cover_layout:/album') === null, 'Returning to automatic did not clear the override');
        const originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function () { throw new Error('Storage disabled'); };
        book.click();
        expect(!table.classList.contains('photo-layout'), 'Blocked storage prevented switching');
        photo.click();
        Storage.prototype.setItem = originalSetItem;

        let conversions = 0;
        window.fetch = async url => {
          expect(url.searchParams.get('w') === String(photoViewWidth(innerWidth, innerHeight, devicePixelRatio)), 'Wrong conversion width');
          conversions++;
          if (conversions === 1) return { ok: false, status: 503 };
          const bytes = Uint8Array.from(atob(${literal(webp)}), value => value.charCodeAt(0));
          return { ok: true, blob: async () => new Blob([bytes], { type: 'image/webp' }) };
        };
        photoFormatSupport.set('heic', Promise.resolve(true));
        expect(openPhotoViewer(items[0].href), 'Lightbox did not open');
        const view = photoViewer;
        const stage = view.dialog.querySelector('.photo-lightbox-stage');
        stage.click();
        expect(view.dialog.classList.contains('photo-controls-hidden'), 'Tapping did not hide the controls');
        stage.click();
        await view.cache.get(items[0].href).result;
        const preloaded = view.cache.get(items[2].href);
        await preloaded.result;
        expect(view.count.textContent === '1 / 3', 'Video appears in the photo count');
        const historyLength = history.length;
        view.dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await preloaded.result;
        expect(view.media.firstChild === preloaded.image, 'Navigation created a new image element');
        expect(view.count.textContent === '2 / 3' && history.length === historyLength, 'Navigation changed the history length');
        await view.cache.get(items[3].href).result;
        stage.setPointerCapture = () => {};
        stage.dispatchEvent(new PointerEvent('pointerdown', { isPrimary: true, pointerId: 1, clientX: 160 }));
        stage.dispatchEvent(new PointerEvent('pointerup', { isPrimary: true, pointerId: 1, clientX: 60 }));
        expect(view.count.textContent === '3 / 3', 'Swiping left did not advance the photo');
        await view.cache.get(items[3].href).result;
        expect(!view.retry.hidden && !view.notice.hidden && view.download.download === 'c.HEIC', 'Unavailable photo did not show retry and download');
        view.retry.click();
        await view.cache.get(items[3].href).result;
        expect(view.retry.hidden && view.notice.textContent === 'photo_converted' && conversions === 2, 'Converted image was not shown after retry');
        const closed = new Promise(resolve => window.addEventListener('popstate', resolve, {once: true}));
        history.back();
        await closed;
        expect(!view.dialog.open && document.activeElement === view.entries[2].anchor, 'Back did not restore the last viewed tile');
        window.testDone = true;
        document.getElementById('result').dataset.result = 'passed';
      } catch (error) {
        document.getElementById('result').textContent = error.stack;
        window.testFailed = true;
      }
    });
  `, html);
});
