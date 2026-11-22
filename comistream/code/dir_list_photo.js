// SPDX-License-Identifier: AGPL-3.0-only
const coverLayoutPrefix = 'comistream_cover_layout:';
const photoDirectoryPrefix = 'comistream_photo_dir:';
let photoDirectoryMeta = null;
let photoItemsByHref = new Map();
let currentCoverOverride;

function photoDirectoryKey() {
  return location.pathname.replace(/\/+$/, '') || '/';
}

function readPhotoPreference(prefix) {
  try {
    return localStorage.getItem(prefix + photoDirectoryKey());
  } catch (_) {
    return null;
  }
}

function writePhotoPreference(prefix, value) {
  try {
    const key = prefix + photoDirectoryKey();
    const orderKey = prefix.slice(0, -1) + '_order';
    const order = JSON.parse(localStorage.getItem(orderKey) || '[]')
      .filter(entry => typeof entry === 'string' && entry.startsWith(prefix) && entry !== key);
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      order.push(key);
      for (const oldest of order.splice(0, Math.max(0, order.length - 500))) {
        localStorage.removeItem(oldest);
      }
      localStorage.setItem(key, value);
    }
    localStorage.setItem(orderKey, JSON.stringify(order));
  } catch (_) {
    // 保存を拒否された場合も、このページ内の切り替えは使えるルン。
  }
}

function setPhotoDirectory(items, meta) {
  photoDirectoryMeta = meta.photo ?? {};
  photoItemsByHref = new Map(items.filter(item => item.kind === 'image').map(item => [item.href, item]));
  if (typeof photoDirectoryMeta.is_photo_dir === 'boolean' && !meta.is_404_mode) {
    writePhotoPreference(photoDirectoryPrefix, photoDirectoryMeta.is_photo_dir ? '1' : '0');
  }
  syncCoverPhotoLayout();
}

function syncCoverPhotoLayout() {
  const table = document.getElementById('indexlist');
  if (!table) return;
  const cover = getCookie('viewmode') === 'cover';
  const automatic = (photoDirectoryMeta?.is_photo_dir ?? (readPhotoPreference(photoDirectoryPrefix) === '1'))
    ? 'photo' : 'book';
  const stored = currentCoverOverride === undefined ? readPhotoPreference(coverLayoutPrefix) : currentCoverOverride;
  const override = stored === 'book' || stored === 'photo' ? stored : null;
  const layout = (photoDirectoryMeta === null || photoDirectoryMeta.show_layout_chip ? override : null) ?? automatic;
  const photoLayout = cover && layout === 'photo';
  if (table.classList.contains('photo-layout') !== photoLayout) {
    table.classList.toggle('photo-layout', photoLayout);
    if (!table.classList.contains('skeleton-loading')) applySortChangeCore();
  }

  const chip = document.getElementById('coverLayoutChip');
  if (!chip) return;
  chip.hidden = !cover || !photoDirectoryMeta?.show_layout_chip;
  for (const button of chip.querySelectorAll('button')) {
    const selected = button.dataset.layout === layout;
    button.setAttribute('aria-pressed', String(selected));
    button.classList.toggle('manual-layout', selected && override !== null);
    button.onclick = () => {
      const wasPhoto = table.classList.contains('photo-layout');
      currentCoverOverride = button.dataset.layout === automatic ? null : button.dataset.layout;
      writePhotoPreference(coverLayoutPrefix, currentCoverOverride);
      syncCoverPhotoLayout();
      if (wasPhoto !== table.classList.contains('photo-layout')) {
        updateCoverSideGutter();
        if (!wasPhoto) removeCoverImages(true);
        addCoverImages();
      }
    };
  }
}

const photoFormatProbes = {
  heic: 'data:image/heic;base64,AAAAHGZ0eXBoZWljAAAAAG1pZjFoZWljbWlhZgAAAWhtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAABjAABAAAAAAAAADQAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAA5waXRtAAAAAAABAAAA6GlwcnAAAADJaXBjbwAAAHVodmNDAQNwAAAAkAAAAAAAHvAA/P34+AAADwNgAAEAGEABDAH//wNwAAADAJAAAAMAAAMAHroCQGEAAQApQgEBA3AAAAMAkAAAAwAAAwAeoCCBBZbqrprm4CGgwIAAAAyAAAADAIRiAAEABkQBwXPBiQAAABRpc3BlAAAAAAAAAEAAAABAAAAAKGNsYXAAAAAIAAAAAQAAAAgAAAAB////yAAAAAL////IAAAAAgAAABBwaXhpAAAAAAMICAgAAAAXaXBtYQAAAAAAAAABAAEEgQIEgwAAADxtZGF0AAAAMCgBrxMhZmNA+BD3Z//rvBX/lWs/8zex6c7IR0DA0iCAm0BIk11QCxYQgId2pVbc+A==',
  tiff: 'data:image/tiff;base64,SUkqAA4AAAD//wAAAAAPAAABAwABAAAAAQAAAAEBAwABAAAAAQAAAAIBAwADAAAAyAAAAAMBAwABAAAAAQAAAAYBAwABAAAAAgAAAAoBAwABAAAAAQAAABEBBAABAAAACAAAABIBAwABAAAAAQAAABUBAwABAAAAAwAAABYBAwABAAAAAQAAABcBBAABAAAABgAAABwBAwABAAAAAQAAACkBAwACAAAAAAABAD4BBQACAAAA/gAAAD8BBQAGAAAAzgAAAAAAAAAQABAAEACF61EAAACAAMP1qAAAAAACzcxMAAAAAAHNzEwAAACAAM3MTAAAAAACj8L1AAAAABA3GqAAAAAAAiuHCgAAACAA',
};
const photoFormatSupport = new Map();
let photoViewer = null;
const photoMaxZoom = 4;
const photoTapDelay = 300;

function photoFormat(name) {
  const extension = name.split('.').pop().toLowerCase();
  if (extension === 'heif') return 'heic';
  if (extension === 'tif') return 'tiff';
  return extension;
}

function photoCanDisplay(format) {
  if (!photoFormatProbes[format]) return Promise.resolve(true);
  if (!photoFormatSupport.has(format)) {
    photoFormatSupport.set(format, (async () => {
      const key = 'comistream_photo_support:' + format;
      try {
        const cached = sessionStorage.getItem(key);
        if (cached === '1' || cached === '0') return cached === '1';
      } catch (_) {
        // セッションに保存できなくても形式を確かめるルン。
      }
      const probe = new Image();
      probe.src = photoFormatProbes[format];
      const supported = await probe.decode().then(() => true, () => false);
      try {
        sessionStorage.setItem(key, supported ? '1' : '0');
      } catch (_) {
        // このページでは判定結果を使い続けるルン。
      }
      return supported;
    })());
  }
  return photoFormatSupport.get(format);
}

function photoViewWidth(width, height, ratio) {
  const pixels = Math.max(width, height) * ratio;
  return [1024, 1600, 2048].find(size => size >= pixels) ?? 2048;
}

function photoImageEntries() {
  return Array.from(document.querySelectorAll('#table-tbody tr[data-kind="image"] .indexcolname a'))
    .map(anchor => ({ anchor, item: photoItemsByHref.get(anchor.getAttribute('href')) }))
    .filter(entry => entry.item);
}

function requestPhotoImage(view, item, allowConversion) {
  const cached = view.cache.get(item.href);
  if (cached && (!allowConversion || !cached.deferred)) {
    cached.allowConversion ||= allowConversion;
    return cached;
  }
  if (cached) releasePhotoImage(cached);

  const image = new Image();
  image.alt = item.name;
  const controller = new AbortController();
  const request = { image, controller, allowConversion, objectUrl: null };
  view.cache.set(item.href, request);

  request.result = (async () => {
    const native = item.view_convert ? await photoCanDisplay(photoFormat(item.name)) : true;
    if (controller.signal.aborted) return null;
    if (native) {
      image.src = item.href;
      try {
        await image.decode();
        return { mode: 'native' };
      } catch (_) {
        if (!item.view_convert) return { mode: 'fallback' };
      }
    }
    if (controller.signal.aborted) return null;
    if (!request.allowConversion) {
      request.deferred = true;
      return null;
    }
    try {
      const url = new URL(item.view_convert, location.href);
      url.searchParams.set('w', photoViewWidth(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1));
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return { mode: 'fallback', retry: response.status === 503 };
      const blob = await response.blob();
      if (controller.signal.aborted) return null;
      request.objectUrl = URL.createObjectURL(blob);
      image.src = request.objectUrl;
      await image.decode();
      return { mode: 'converted' };
    } catch (_) {
      return { mode: 'fallback' };
    }
  })();
  return request;
}

function releasePhotoImage(request) {
  request.controller.abort();
  request.image.removeAttribute('src');
  if (request.objectUrl !== null) URL.revokeObjectURL(request.objectUrl);
}

function showPhotoFallback(view, item) {
  const fallback = new Image();
  fallback.alt = item.name;
  fallback.className = 'photo-lightbox-icon';
  fallback.src = '/theme/icons/image.png';
  view.media.replaceChildren(fallback);
}

function setPhotoZoom(view, scale = 1, x = 0, y = 0) {
  if (!view.image || scale <= 1) {
    view.zoom = { scale: 1, x: 0, y: 0 };
    view.media.style.transform = '';
    return;
  }

  const { clientWidth: width, clientHeight: height } = view.stage;
  if (!width || !height) return;
  const { naturalWidth, naturalHeight } = view.image;
  const fit = Math.min(width / naturalWidth, height / naturalHeight);
  const limitX = Math.max(0, (naturalWidth * fit * scale - width) / 2);
  const limitY = Math.max(0, (naturalHeight * fit * scale - height) / 2);
  x = Math.min(limitX, Math.max(-limitX, x));
  y = Math.min(limitY, Math.max(-limitY, y));
  view.zoom = { scale, x, y };
  view.media.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
}

function zoomPhotoAt(view, from, to, scale) {
  if (!view.image) return;
  const bounds = view.stage.getBoundingClientRect();
  const centerX = bounds.left + bounds.width / 2;
  const centerY = bounds.top + bounds.height / 2;
  const zoom = Math.min(photoMaxZoom, Math.max(1, scale));
  const ratio = zoom / view.zoom.scale;
  // 指の下にあった写真の位置を、拡大後も指の下に保つルン。
  setPhotoZoom(view, zoom,
    to.clientX - centerX + (view.zoom.x - from.clientX + centerX) * ratio,
    to.clientY - centerY + (view.zoom.y - from.clientY + centerY) * ratio);
}

async function displayPhoto(view) {
  const index = view.index;
  const item = view.entries[index].item;
  const version = ++view.version;
  const adjacent = view.entries.slice(Math.max(0, index - 1), index + 2);
  const keep = new Set(adjacent.map(entry => entry.item.href));
  for (const [href, request] of view.cache) {
    if (!keep.has(href)) {
      releasePhotoImage(request);
      view.cache.delete(href);
    }
  }

  view.image = null;
  setPhotoZoom(view);
  view.media.replaceChildren();
  view.loading.hidden = false;
  view.notice.hidden = true;
  view.retry.hidden = true;
  view.count.textContent = (index + 1) + ' / ' + view.entries.length;
  view.filename.textContent = item.name;
  const size = item.size_formatted || '';
  view.fileSize.textContent = size;
  view.fileSize.hidden = !size;
  view.downloadSize.textContent = size ? ' (' + size + ')' : '';
  view.previous.disabled = index === 0;
  view.next.disabled = index === view.entries.length - 1;
  view.download.href = item.href;
  view.download.download = item.name;
  view.original.href = item.href;

  const request = requestPhotoImage(view, item, true);
  const result = await request.result;
  if (photoViewer !== view || version !== view.version || result === null) return;

  view.loading.hidden = true;
  if (result.mode === 'fallback') {
    showPhotoFallback(view, item);
    view.notice.textContent = view.dialog.dataset.unavailable;
    view.notice.hidden = false;
    view.retry.hidden = !result.retry;
  } else {
    view.image = request.image;
    view.media.replaceChildren(request.image);
    if (result.mode === 'converted') {
      view.notice.textContent = view.dialog.dataset.converted.replace('{format}', item.name.split('.').pop().toUpperCase());
      view.notice.hidden = false;
    }
  }

  const next = view.entries[index + 1]?.item;
  const previous = view.entries[index - 1]?.item;
  if (next) requestPhotoImage(view, next, true);
  if (previous) requestPhotoImage(view, previous, false);
}

function movePhoto(view, step) {
  const index = view.index + step;
  if (index < 0 || index >= view.entries.length) return;
  view.index = index;
  displayPhoto(view);
}

function closePhotoViewer() {
  const view = photoViewer;
  if (!view) return;
  photoViewer = null;
  for (const request of view.cache.values()) releasePhotoImage(request);
  setPhotoZoom(view);
  view.media.replaceChildren();
  view.dialog.close();
  const anchor = view.entries[view.index].anchor;
  anchor.focus({ preventScroll: true });
  anchor.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function requestPhotoViewerClose() {
  if (history.state?.comistreamPhoto) history.back();
  else closePhotoViewer();
}

function openPhotoViewer(href, pushHistory = true) {
  if (photoViewer || !photoItemsByHref.has(href) || !document.querySelector('#indexlist.photo-layout')) return false;
  const dialog = document.getElementById('photoLightbox');
  if (typeof dialog?.showModal !== 'function') return false;
  const entries = photoImageEntries();
  const index = entries.findIndex(entry => entry.item.href === href);
  if (index < 0) return false;

  const view = {
    dialog, entries, index, version: 0, cache: new Map(),
    stage: dialog.querySelector('.photo-lightbox-stage'),
    media: dialog.querySelector('.photo-lightbox-media'),
    loading: dialog.querySelector('.photo-lightbox-loading'),
    notice: dialog.querySelector('.photo-lightbox-notice'),
    count: dialog.querySelector('#photoCount'),
    filename: dialog.querySelector('#photoFilename'),
    fileSize: dialog.querySelector('.photo-lightbox-file-size'),
    downloadSize: dialog.querySelector('.photo-lightbox-download-size'),
    previous: dialog.querySelector('[data-action="previous"]'),
    next: dialog.querySelector('[data-action="next"]'),
    download: dialog.querySelector('[data-action="download"]'),
    original: dialog.querySelector('[data-action="original"]'),
    retry: dialog.querySelector('[data-action="retry"]'),
  };
  if (pushHistory) {
    history.pushState({ ...history.state, comistreamPhoto: href }, '');
  }
  photoViewer = view;
  photoCanDisplay('heic');
  photoCanDisplay('tiff');
  dialog.classList.remove('photo-controls-hidden');
  displayPhoto(view);
  dialog.showModal();
  return true;
}

function initializePhotoGestures(dialog) {
  const stage = dialog.querySelector('.photo-lightbox-stage');
  let gesture = null;
  let pointerId = null;
  let pendingTap = null;

  const isCurrent = interaction =>
    interaction && interaction.view === photoViewer && interaction.version === photoViewer.version;
  const distance = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  const midpoint = (a, b) => ({
    clientX: (a.clientX + b.clientX) / 2,
    clientY: (a.clientY + b.clientY) / 2,
  });
  const toggleControls = () => dialog.classList.toggle('photo-controls-hidden');

  function touchStep(view, point) {
    if (dialog.classList.contains('photo-controls-hidden')) return 0;
    if (view.previous.contains(point.target)) return -1;
    if (view.next.contains(point.target)) return 1;
    if (view.zoom.scale > 1) return 0;

    const { left, width } = stage.getBoundingClientRect();
    const x = point.clientX - left;
    const edgeWidth = width / 5;
    if (x < edgeWidth) return -1;
    if (x >= width - edgeWidth) return 1;
    return 0;
  }

  function clearTap() {
    clearTimeout(pendingTap?.timer);
    pendingTap = null;
  }

  function tap(view, point) {
    const previous = pendingTap;
    clearTap();
    if (isCurrent(previous)) {
      if (view.image && distance(point, previous.point) <= 32) {
        if (view.zoom.scale > 1) setPhotoZoom(view);
        else zoomPhotoAt(view, point, point, 2);
        return;
      }
      toggleControls();
    }
    if (!view.image) {
      toggleControls();
      return;
    }
    const current = { view, version: view.version, point };
    current.timer = setTimeout(() => {
      pendingTap = null;
      if (isCurrent(current)) toggleControls();
    }, photoTapDelay);
    pendingTap = current;
  }

  function start(points, isTouch = false) {
    if (!photoViewer || points.length === 0) return;
    if (!isCurrent(gesture)) {
      gesture = {
        view: photoViewer,
        version: photoViewer.version,
        start: points[0],
        startedZoomed: photoViewer.zoom.scale > 1,
        tapStep: isTouch ? touchStep(photoViewer, points[0]) : 0,
        moved: false,
        multiple: false,
      };
      if (gesture.tapStep) clearTap();
    }
    if (points.length > 1) {
      gesture.multiple = true;
      clearTap();
    }
    gesture.last = points;
  }

  function move(points) {
    if (!isCurrent(gesture)) return;
    const { view, last } = gesture;
    if (points.length === 2 && last.length === 2) {
      const previousSpan = distance(last[0], last[1]);
      if (previousSpan > 0) {
        const scale = view.zoom.scale * distance(points[0], points[1]) / previousSpan;
        zoomPhotoAt(view, midpoint(last[0], last[1]), midpoint(points[0], points[1]), scale);
      }
    } else if (points.length === 1 && last.length === 1) {
      const point = points[0];
      if (!gesture.moved && distance(gesture.start, point) > 8) {
        gesture.moved = true;
        clearTap();
      }
      if ((gesture.moved || gesture.multiple) && view.zoom.scale > 1) {
        setPhotoZoom(view, view.zoom.scale,
          view.zoom.x + point.clientX - last[0].clientX,
          view.zoom.y + point.clientY - last[0].clientY);
      }
    }
    gesture.last = points;
  }

  function finish(point, remaining = []) {
    if (!isCurrent(gesture)) {
      gesture = null;
      return;
    }
    if (remaining.length) {
      gesture.last = remaining;
      return;
    }
    if (!gesture.multiple && gesture.view.zoom.scale > 1) move([point]);
    const ended = gesture;
    gesture = null;
    if (ended.multiple) return;
    const x = point.clientX - ended.start.clientX;
    const y = point.clientY - ended.start.clientY;
    if (!ended.startedZoomed && Math.abs(x) > 45 && Math.abs(x) > Math.abs(y)) {
      clearTap();
      movePhoto(ended.view, x < 0 ? 1 : -1);
    } else if (!ended.moved && Math.hypot(x, y) <= 8) {
      if (ended.tapStep) {
        movePhoto(ended.view, ended.tapStep);
      } else {
        tap(ended.view, point);
      }
    }
  }

  // 写真面と矢印を同じジェスチャーで扱い、Safari のページ拡大を抑えるルン。
  const cancelBrowserGesture = event => event.preventDefault();
  const activeTouch = { passive: false };
  const stageTouches = event => Array.from(event.touches).filter(touch => stage.contains(touch.target));
  stage.addEventListener('touchstart', event => {
    cancelBrowserGesture(event);
    start(stageTouches(event), true);
  }, activeTouch);
  stage.addEventListener('touchmove', event => {
    cancelBrowserGesture(event);
    move(stageTouches(event));
  }, activeTouch);
  stage.addEventListener('touchend', event => {
    cancelBrowserGesture(event);
    finish(event.changedTouches[0], stageTouches(event));
  }, activeTouch);
  stage.addEventListener('touchcancel', () => { gesture = null; });
  dialog.addEventListener('gesturestart', cancelBrowserGesture);
  dialog.addEventListener('gesturechange', cancelBrowserGesture);

  stage.addEventListener('pointerdown', event => {
    if (event.target !== stage || event.pointerType === 'touch' || !event.isPrimary || event.button !== 0) return;
    pointerId = event.pointerId;
    start([event]);
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointermove', event => {
    if (event.pointerId === pointerId) move([event]);
  });
  stage.addEventListener('pointerup', event => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    finish(event);
  });
  stage.addEventListener('lostpointercapture', event => {
    if (event.pointerId !== pointerId) return;
    pointerId = null;
    gesture = null;
  });
  stage.addEventListener('click', event => {
    if (event.target === stage && photoViewer && event.detail === 0 && event.pointerType !== 'touch') toggleControls();
  });
  new ResizeObserver(() => {
    if (!photoViewer || !dialog.open) return;
    const { scale, x, y } = photoViewer.zoom;
    if (scale > 1) setPhotoZoom(photoViewer, scale, x, y);
  }).observe(stage);
}

function initializePhotoViewer() {
  const dialog = document.getElementById('photoLightbox');
  if (!dialog) return;
  initializePhotoGestures(dialog);

  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    requestPhotoViewerClose();
  });
  // 操作欄を隠してフォーカスが外れても、ライトボックスのキー操作を受け取るルン。
  window.addEventListener('keydown', event => {
    if (!photoViewer || !dialog.open || event.defaultPrevented) return;
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      if (!event.repeat) requestPhotoViewerClose();
      return;
    }
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
    if (step) {
      event.preventDefault();
      movePhoto(photoViewer, step);
    }
  });
  dialog.addEventListener('click', event => {
    if (!photoViewer) return;
    const view = photoViewer;
    switch (event.target.closest('[data-action]')?.dataset.action) {
      case 'close': requestPhotoViewerClose(); break;
      case 'previous': movePhoto(view, -1); break;
      case 'next': movePhoto(view, 1); break;
      case 'retry': {
        const href = view.entries[view.index].item.href;
        releasePhotoImage(view.cache.get(href));
        view.cache.delete(href);
        displayPhoto(view);
        break;
      }
    }
  });
  window.addEventListener('popstate', event => {
    const href = event.state?.comistreamPhoto;
    if (href) openPhotoViewer(href, false);
    else closePhotoViewer();
  });
}

document.addEventListener('DOMContentLoaded', initializePhotoViewer);
