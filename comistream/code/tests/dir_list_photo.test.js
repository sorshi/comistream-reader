const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chrome, literal, runBrowserFixture } = require('./browser_fixture');

const source = fs.readFileSync(path.resolve(__dirname, '../dir_list_photo.js'), 'utf8');
const markup = fs.readFileSync(path.resolve(__dirname, '../dir_list.php'), 'utf8');
const css = fs.readFileSync(path.resolve(__dirname, '../../theme/style_cover.css'), 'utf8');
const dialogStart = markup.indexOf('<dialog id="photoLightbox"');
const dialogEnd = markup.indexOf('</dialog>', dialogStart) + '</dialog>'.length;
const dialog = markup.slice(dialogStart, dialogEnd).replace(/<\?php echo \$photoText\('([^']+)'\); \?>/g, '$1');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAE0lEQVQI12P8z8DAwMDAxIBMAQAUQAEF4rfbNgAAAABJRU5ErkJggg==';

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

test('Chromeで写真の拡大・移動、先読み画像の再利用、戻る、503再試行を確認する', { skip: !chrome }, async () => {
  const webp = 'UklGRjgAAABXRUJQVlA4ICwAAACQAQCdASoCAAMAAgA0JaACdLoAA5gA/vmTb/+QH/+QH/+QH/8gP+IXeyAwAA==';
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
        const bounds = stage.getBoundingClientRect();
        const centerX = bounds.left + bounds.width / 2;
        const centerY = bounds.top + bounds.height / 2;
        const finger = (id, x, y) => new Touch({ identifier: id, target: stage, clientX: x, clientY: y });
        function touch(type, active, changed = active) {
          const event = new TouchEvent(type, { bubbles: true, cancelable: true, targetTouches: active, touches: active, changedTouches: changed });
          stage.dispatchEvent(event);
          expect(event.defaultPrevented, 'Browser gesture was not canceled for ' + type);
        }
        function tapPhoto(point) {
          touch('touchstart', [point]);
          touch('touchend', [], [point]);
        }
        const focalPoint = finger(1, centerX, centerY + 45);
        const controls = view.dialog.querySelector('header');
        const controlsTop = controls.getBoundingClientRect().top;
        const viewportScale = window.visualViewport.scale;
        tapPhoto(focalPoint);
        expect(!view.media.style.transform && !view.dialog.classList.contains('photo-controls-hidden'), 'First tap was not held for double tap');
        tapPhoto(focalPoint);
        expect(view.zoom.scale === 2 && Math.abs(view.zoom.y + 45) < 1, 'Double tap did not zoom around the touch point');
        expect(controls.getBoundingClientRect().top === controlsTop && window.visualViewport.scale === viewportScale, 'Zoom moved the controls or viewport');
        const dragEnd = finger(1, centerX - 100, centerY + 100);
        touch('touchstart', [focalPoint]);
        touch('touchmove', [dragEnd]);
        touch('touchend', [], [dragEnd]);
        expect(view.count.textContent === '1 / 3' && view.zoom.y > 0, 'Drag while zoomed advanced the photo instead of panning');
        tapPhoto(focalPoint);
        tapPhoto(focalPoint);
        expect(view.zoom.scale === 1 && !view.media.style.transform, 'Second double tap did not restore fit');
        expect(!view.dialog.classList.contains('photo-controls-hidden'), 'Double tap toggled the controls');

        const inner = [finger(1, centerX - 40, centerY), finger(2, centerX + 40, centerY)];
        const outer = [finger(1, centerX - 80, centerY), finger(2, centerX + 80, centerY)];
        touch('touchstart', [inner[0]]);
        touch('touchstart', inner, [inner[1]]);
        touch('touchmove', outer);
        expect(view.zoom.scale === 2, 'Pinch out did not enlarge the photo');
        touch('touchmove', inner);
        expect(view.zoom.scale === 1 && !view.media.style.transform, 'Pinch in did not restore fit');
        touch('touchend', [inner[0]], [inner[1]]);
        const lastFinger = finger(1, centerX - 130, centerY);
        touch('touchmove', [lastFinger]);
        touch('touchend', [], [lastFinger]);
        expect(view.count.textContent === '1 / 3', 'Ending a pinch advanced the photo');
        tapPhoto(focalPoint);
        tapPhoto(focalPoint);
        expect(view.zoom.scale === 2, 'Photo was not zoomed before navigation');

        const historyLength = history.length;
        view.dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await preloaded.result;
        expect(view.media.firstChild === preloaded.image, 'Navigation created a new image element');
        expect(view.zoom.scale === 1 && !view.media.style.transform, 'Navigation carried zoom over to the next photo');
        expect(view.count.textContent === '2 / 3' && history.length === historyLength, 'Navigation changed the history length');
        await view.cache.get(items[3].href).result;
        stage.setPointerCapture = () => {};
        stage.dispatchEvent(new PointerEvent('pointerdown', { isPrimary: true, pointerId: 1, clientX: 160 }));
        stage.dispatchEvent(new PointerEvent('pointerup', { isPrimary: true, pointerId: 1, clientX: 60 }));
        expect(view.count.textContent === '3 / 3', 'Swiping left did not advance the photo');
        await view.cache.get(items[3].href).result;
        expect(!view.retry.hidden && !view.notice.hidden && view.download.download === 'c.HEIC', 'Unavailable photo did not show retry and download');
        expect(view.media.firstElementChild.classList.contains('photo-lightbox-icon'), 'Unavailable photo showed the cropped thumbnail');
        view.retry.click();
        await view.cache.get(items[3].href).result;
        expect(view.retry.hidden && view.notice.textContent === 'photo_converted' && conversions === 2, 'Converted image was not shown after retry');
        tapPhoto(focalPoint);
        tapPhoto(focalPoint);
        expect(view.zoom.scale === 2 && conversions === 2, 'Zooming the converted photo required another fetch');
        const closed = new Promise(resolve => window.addEventListener('popstate', resolve, {once: true}));
        history.back();
        await closed;
        expect(!view.dialog.open && document.activeElement === view.entries[2].anchor, 'Back did not restore the last viewed tile');
        expect(view.zoom.scale === 1 && !view.media.style.transform, 'Closing did not clear zoom');
        window.testDone = true;
        document.getElementById('result').dataset.result = 'passed';
      } catch (error) {
        document.getElementById('result').textContent = error.stack;
        window.testFailed = true;
      }
    });
  `, html);
});

test('Chromeで矢印キーで写真を送り、BackspaceとDeleteで閉じて写真へ戻る', { skip: !chrome }, async () => {
  const items = ['a.png', 'b.png'].map(name => ({ href: png + '#' + name, kind: 'image', name }));
  const rows = items.map(({ href, name }) =>
    `<tr data-kind="image"><td class="indexcolname"><a href="${href}">${name}</a></td></tr>`).join('');
  const html = `<style>${css}</style><table id="indexlist" class="photo-layout"><tbody id="table-tbody">${rows}</tbody></table>${dialog}`;
  await runBrowserFixture(`
    ${source}
    const items = ${literal(items)};
    window.addEventListener('DOMContentLoaded', () => {
      try {
        photoItemsByHref = new Map(items.map(item => [item.href, item]));
        const press = (target, key, repeat = false) =>
          target.dispatchEvent(new KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true }));
        for (const key of ['Backspace', 'Delete']) {
          expect(openPhotoViewer(items[0].href, false), 'Lightbox did not open');
          const view = photoViewer;
          const close = view.dialog.querySelector('[data-action=close]');
          expect(!press(close, key, true), key + ' repeat default action was not canceled');
          expect(view.dialog.open, key + ' repeat closed the lightbox');
          if (key === 'Delete') view.stage.click();
          const target = key === 'Delete' ? document.body : close;
          for (const [arrow, index] of [['ArrowUp', 0], ['ArrowDown', 1], ['ArrowDown', 1],
            ['ArrowUp', 0], ['ArrowRight', 1], ['ArrowLeft', 0], ['ArrowDown', 1]]) {
            expect(!press(target, arrow) && view.index === index, arrow + ' did not stay within the album in the expected direction');
          }
          const tile = view.entries[view.index].anchor;
          expect(!press(target, key), key + ' default action was not canceled');
          expect(!view.dialog.open && document.activeElement === tile, key + ' did not close and return to the photo');
          expect(press(tile, key), key + ' was captured outside the lightbox');
          expect(press(tile, 'ArrowUp') && press(tile, 'ArrowDown'), 'Arrow keys were captured outside the lightbox');
        }
      } catch (error) {
        document.getElementById('result').textContent = error.stack;
        window.testFailed = true;
      }
    });
  `, html);
});

test('Chromeで縦長と横長の写真を全体表示し、半透明の操作欄を重ねる', { skip: !chrome }, async () => {
  const items = [[1200, 4500], [4500, 1200]].map(([width, height]) => ({
    name: width + 'x' + height + '.jpg',
    kind: 'image',
    thumb: png,
    href: 'data:image/svg+xml,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="red"/></svg>`
    ),
  }));
  const rows = items.map(({ href, name }) =>
    `<tr data-kind="image"><td class="indexcolname"><a href="${href}">${name}</a></td></tr>`).join('');
  const html = `<style>${css}</style><table id="indexlist" class="photo-layout"><tbody id="table-tbody">${rows}</tbody></table>${dialog}`;
  await runBrowserFixture(`
    ${source}
    const items = ${literal(items)};
    window.testDone = false;
    window.addEventListener('DOMContentLoaded', async () => {
      try {
        photoItemsByHref = new Map(items.map(item => [item.href, item]));
        expect(openPhotoViewer(items[0].href, false), 'Lightbox did not open');
        const { dialog, stage, next, download } = photoViewer;
        const header = dialog.querySelector('header');
        const footer = dialog.querySelector('footer');
        function checkFit() {
          const image = photoViewer.image;
          const frame = dialog.getBoundingClientRect();
          const area = stage.getBoundingClientRect();
          const box = image.getBoundingClientRect();
          expect(area.left === frame.left && area.top === frame.top &&
            area.right === frame.right && area.bottom === frame.bottom, 'Controls changed the full-size photo area');
          expect(Math.abs(box.width - area.width) < 1 && Math.abs(box.height - area.height) < 1,
            'Intrinsic image size overflowed the photo area');
          expect(Math.abs(box.left - area.left) < 1 && Math.abs(box.top - area.top) < 1,
            'Image box is offset from the photo area');
          expect(getComputedStyle(image).objectFit === 'contain', 'Image does not preserve its full aspect ratio');
        }

        for (const [index, item] of items.entries()) {
          if (index > 0) movePhoto(photoViewer, 1);
          await photoViewer.cache.get(item.href).result;
          checkFit();
        }
        const controlBackground = getComputedStyle(next).backgroundColor;
        expect(controlBackground === 'rgba(0, 0, 0, 0.6)', 'Navigation buttons are not translucent');
        for (const bar of [header, footer]) {
          expect(getComputedStyle(bar).backgroundColor === controlBackground, 'Bar background does not match navigation buttons');
        }
        const area = stage.getBoundingClientRect();
        expect(header.getBoundingClientRect().top === area.top && footer.getBoundingClientRect().bottom === area.bottom,
          'Overlays are not attached to the top and bottom edges');
        for (const control of [header.querySelector('button'), download]) {
          const bounds = control.getBoundingClientRect();
          expect(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2) === control,
            'Photo intercepted an overlay control');
        }
        expect(getComputedStyle(dialog).backgroundColor === 'rgb(0, 0, 0)', 'Letterbox background is not black');
        expect(!dialog.querySelector('.photo-lightbox-background'), 'Thumbnail was used as the letterbox background');
        stage.click();
        checkFit();
        expect([header, footer, next].every(control => getComputedStyle(control).visibility === 'hidden'),
          'Controls remained visible');
        window.testDone = true;
        document.getElementById('result').dataset.result = 'passed';
      } catch (error) {
        document.getElementById('result').textContent = error.stack;
        window.testFailed = true;
      }
    });
  `, html);
});

test('Chromeで写真面の左右のタップ、矢印の連打、ピンチの優先を確認する', { skip: !chrome }, async () => {
  const items = ['a.png', 'b.png', 'c.png'].map(name => ({ name, kind: 'image', href: png + '#' + name }));
  const rows = items.map(({ href, name }) =>
    `<tr data-kind="image"><td class="indexcolname"><a href="${href}">${name}</a></td></tr>`).join('');
  const html = `<style>${css}</style><table id="indexlist" class="photo-layout"><tbody id="table-tbody">${rows}</tbody></table>${dialog}`;
  await runBrowserFixture(`
    ${source}
    const items = ${literal(items)};
    window.testDone = false;
    window.addEventListener('DOMContentLoaded', async () => {
      try {
        photoItemsByHref = new Map(items.map(item => [item.href, item]));
        expect(openPhotoViewer(items[0].href, false), 'Lightbox did not open');
        const view = photoViewer;
        const { stage } = view;
        const { left, top, width, height } = stage.getBoundingClientRect();
        const y = top + height / 2;
        const finger = (id, x, target = document.elementFromPoint(x, y)) =>
          new Touch({ identifier: id, target, clientX: x, clientY: y });
        const at = fraction => finger(1, left + width * fraction);
        function touch(type, target, active, changed = active) {
          const targetTouches = active.filter(point => point.target === target);
          const event = new TouchEvent(type, { bubbles: true, cancelable: true, touches: active, targetTouches, changedTouches: changed });
          target.dispatchEvent(event);
          expect(event.defaultPrevented, 'Browser gesture was not canceled for ' + type);
        }
        function tap(point) {
          touch('touchstart', point.target, [point]);
          touch('touchend', point.target, [], [point]);
        }

        const prevButton = view.previous.getBoundingClientRect();
        const nextButton = view.next.getBoundingClientRect();
        const prevX = prevButton.left + prevButton.width / 2;
        const nextX = nextButton.left + nextButton.width / 2;
        expect(at(.82).target === stage && at(.18).target === stage, 'Edge test touches hit the visible buttons');
        tap(at(.82));
        expect(view.index === 1 && view.zoom.scale === 1, 'Right edge did not advance one photo');
        tap(at(.18));
        expect(view.index === 0, 'Left edge did not go back one photo');
        expect(finger(1, nextX).target === view.next, 'Next button was not the touch target');
        tap(finger(1, nextX));
        tap(finger(1, nextX));
        tap(finger(1, nextX));
        expect(view.index === 2 && view.zoom.scale === 1, 'Rapid next button touches failed at the end of the album');
        expect(finger(1, prevX).target === view.previous, 'Previous button was not the touch target');
        tap(finger(1, prevX));
        tap(finger(1, prevX));
        expect(view.index === 0 && view.zoom.scale === 1, 'Rapid previous button touches did not go back two photos');
        await view.cache.get(items[0].href).result;

        // The two fingers start on different elements, so targetTouches contains only one of them.
        const arrowFinger = finger(2, nextX);
        const stageFinger = at(.65);
        touch('touchstart', arrowFinger.target, [arrowFinger]);
        touch('touchstart', stage, [arrowFinger, stageFinger], [stageFinger]);
        const movedStageFinger = at(.25);
        touch('touchmove', stage, [arrowFinger, movedStageFinger], [movedStageFinger]);
        expect(view.index === 0 && view.zoom.scale > 1, 'Pinch starting on a button did not zoom');
        touch('touchend', stage, [arrowFinger], [movedStageFinger]);
        touch('touchend', arrowFinger.target, [], [arrowFinger]);
        expect(view.index === 0, 'Pinch ending on the button advanced the photo');
        tap(at(.82));
        tap(at(.82));
        expect(view.index === 0 && view.zoom.scale === 1, 'Zoomed edge took over image gestures');

        tap(at(.21));
        tap(at(.21));
        expect(view.index === 0 && view.zoom.scale === 2, 'Area inside the edge boundary cannot zoom');
        tap(finger(1, nextX));
        expect(view.index === 1 && view.zoom.scale === 1, 'Visible next button cannot advance while zoomed');
        await view.cache.get(items[1].href).result;
        tap(at(.5));
        await new Promise(resolve => setTimeout(resolve, photoTapDelay + 10));
        expect(view.dialog.classList.contains('photo-controls-hidden'), 'Single touch did not hide the controls');
        expect(finger(1, nextX).target === stage, 'Hidden next button still receives touches');
        tap(at(.82));
        await new Promise(resolve => setTimeout(resolve, photoTapDelay + 10));
        expect(view.index === 1 && !view.dialog.classList.contains('photo-controls-hidden'), 'Hidden controls did not release the edge to the photo');
        view.previous.click();
        expect(view.index === 0 && !view.dialog.classList.contains('photo-controls-hidden'), 'Button activation also toggled the controls');

        window.testDone = true;
        document.getElementById('result').dataset.result = 'passed';
      } catch (error) {
        document.getElementById('result').textContent = error.stack;
        window.testFailed = true;
      }
    });
  `, html);
});
