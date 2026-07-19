const FOLIATE_MODULE_BASE = 'https://cdn.jsdelivr.net/gh/sorshi/comistream-foliate-js@e6777e15e279700e8a745f98a948ec1f29658184/';

const TAP_MAX_DISTANCE_PX = 10;
const TAP_MAX_DURATION_MS = 300;
const SCROLLED_CENTER_TAP_MAX_DISTANCE_PX = 20;
const SCROLLED_CENTER_TAP_MAX_DURATION_MS = 500;
const NAVIGATION_SETTLE_TIMEOUT_MS = 2600;
const NAVIGATION_SPINNER_DELAY_MS = 450;
const NAVIGATION_VISIBILITY_CHECK_DELAYS_MS = [0, 80, 240, 600, 1200];
const PROGRESS_SAVE_DEBOUNCE_MS = 5000;
const CFI_STORAGE_PREFIX = 'comistream_epub_cfi:';
const STATE_STORAGE_PREFIX = 'comistream_epub_state:';
const FONT_SCALE_KEY = 'comistream_epub_font_scale';
const FONT_SCALE_SOURCE_KEY = 'comistream_epub_font_scale_source';
const FONT_SCALE_VERSION_KEY = 'comistream_epub_font_scale_version';
const FLOW_MODE_KEY = 'comistream_epub_flow_mode';
const THEME_KEY = 'comistream_epub_theme';
const DIRECTION_OVERRIDE_KEY = 'comistream_epub_direction_override';
const WRITING_MODE_OVERRIDE_KEY = 'comistream_epub_writing_mode_override';
const OPTIONAL_PACKAGE_MISSING_PREFIX = 'comistream_epub_optional_missing:';
const CLOCK_DISPLAY_KEY = 'clockDisplay';
const DEFAULT_FONT_SCALE = 1.0;
const MIN_FONT_SCALE = 0.8;
const MAX_FONT_SCALE = 2.0;
const FONT_STEP = 0.1;
const SLIDER_MAX = 1000;
const NAVIGATION_READY_TIMEOUT_MS = 1600;
const LAYOUT_RESIZE_DEBOUNCE_MS = 250;
const BASE_FONT_SIZE_PX = 16;
const TARGET_CHARS_PER_LINE = 40;
const MIN_CHARS_PER_LINE = 25;
const MIN_TWO_COLUMN_CHARS_PER_LINE = 36;
const MIN_INITIAL_FONT_PX = 14;
const MAX_INITIAL_FONT_PX = 25;
const COLUMN_GAP_RATIO = 0.07;
const MIN_MULTI_COLUMN_BLOCK_SIZE_PX = 600;
const DEFAULT_READER_MARGIN_PX = 48;
const PHONE_SHORT_EDGE_MAX_PX = 480;
const TABLET_SHORT_EDGE_MAX_PX = 900;
const MIN_TWO_COLUMN_INLINE_SIZE_PX = 1180;
const MIN_TWO_COLUMN_BLOCK_AXIS_PX = 700;
const ILLUSTRATION_MIN_NATURAL_AREA = 120000;
const ILLUSTRATION_MIN_RENDERED_AREA_RATIO = 0.18;
const ILLUSTRATION_MAX_TEXT_BEFORE_CHARS = 20;
const ILLUSTRATION_MAX_SPACER_COUNT = 3;
const FONT_SCALE_SOURCE_AUTO = 'auto';
const FONT_SCALE_SOURCE_MANUAL = 'manual';
const FONT_SCALE_ALGORITHM_VERSION = '2026-04-19-v3';

const NS_CONTAINER = 'urn:oasis:names:tc:opendocument:xmlns:container';
const NS_OPF = 'http://www.idpf.org/2007/opf';
const OPTIONAL_PACKAGE_PATHS = new Set([
    'META-INF/encryption.xml',
    'META-INF/com.apple.ibooks.display-options.xml',
    'META-INF/com.kobobooks.display-options.xml'
]);

let view = null;
let currentLocation = null;
let menuVisible = false;
let currentFontScale = DEFAULT_FONT_SCALE;
let currentFlowMode = 'paginated';
let currentTheme = 'paper';
let currentDirectionOverride = 'auto';
let currentWritingModeOverride = 'auto';
let currentFontScaleSource = FONT_SCALE_SOURCE_AUTO;
let currentDirectionInfo = {
    rtl: true,
    vertical: true,
    explicitRtl: false,
    explicitVertical: false
};
let layoutDirectionInfo = {
    rtl: true,
    vertical: true,
    explicitRtl: false,
    explicitVertical: false
};
let layoutDirectionLocked = false;
let sliderDragActive = false;
let clockTimer = null;
let viewInitialized = false;
let navigationChain = Promise.resolve();
let navigationIntentSeq = 0;
let navigationEventSeq = 0;
let relocationEventSeq = 0;
let rendererVisibilityGuardSeq = 0;
let rendererRecoveryActive = false;
let rendererRecoveryScheduledSeq = 0;
let relocateSideEffectsFrame = null;
let relocateSideEffectsImmediateSave = false;
let progressSaveTimer = null;
let progressSaveInFlight = false;
let progressSavePending = false;
let lastProgressSaveKey = '';
let hasStoredFontScale = false;
let hasAdjustedInitialFontScale = false;
let lastRendererPrefsSignature = '';
let initialRestoreCfi = '';
let initialRestoreReconcileUntil = 0;
let initialRestorePinnedLocation = null;
const illustrationStyleSnapshots = new WeakMap();

const appConfig = window.epubReaderConfig || {};
const i18n = window.epubReaderI18n || {};
const escapedFile = appConfig.escapedFile || '';
const baseFile = appConfig.baseFile || '';
const csrfToken = appConfig.csrfToken || '';
const epubPackageBase = appConfig.epubPackageBase || '';
const epubUrl = appConfig.epubUrl || '';
const savedCfi = appConfig.savedCfi || '';
const savedUpdatedAt = Number(appConfig.savedUpdatedAt) || 0;
const readerFallbackParentUrl = appConfig.readerFallbackParentUrl || '/';
const readerFallbackHomeUrl = appConfig.readerFallbackHomeUrl || '/';
const serviceWorkerUrl = appConfig.serviceWorkerUrl || '';
const serviceWorkerScope = appConfig.serviceWorkerScope || '/';

const THEMES = {
    paper: {
        bg: '#f5f0e6',
        color: '#2c2416',
        shellBg: '#606060',
        themeColor: '#606060',
        colorScheme: 'light only'
    },
    white: {
        bg: '#ffffff',
        color: '#1a1a1a',
        shellBg: '#e0e0e0',
        themeColor: '#e0e0e0',
        colorScheme: 'light only'
    },
    dark: {
        bg: '#121212',
        color: '#e8e4dc',
        shellBg: '#050505',
        themeColor: '#050505',
        colorScheme: 'dark'
    }
};
const THEME_OPTION_SYSTEM = 'system';
const SYSTEM_DARK_MODE_QUERY = '(prefers-color-scheme: dark)';
const systemDarkModeMedia = typeof window.matchMedia === 'function'
    ? window.matchMedia(SYSTEM_DARK_MODE_QUERY)
    : null;

function $(id) {
    return document.getElementById(id);
}

function t(key, fallback = null) {
    const translated = i18n[key];
    return typeof translated === 'string' && translated !== ''
        ? translated
        : (fallback ?? key);
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function roundToStep(value, step) {
    return Math.round(value / step) * step;
}

function debounce(fn, waitMs) {
    let timerId = null;
    return (...args) => {
        if (timerId !== null) {
            window.clearTimeout(timerId);
        }
        timerId = window.setTimeout(() => {
            timerId = null;
            fn(...args);
        }, waitMs);
    };
}

function waitAnimationFrame() {
    return new Promise((resolve) => {
        window.requestAnimationFrame(resolve);
    });
}

function waitTimeout(delayMs) {
    return new Promise((resolve) => {
        window.setTimeout(resolve, Math.max(0, Number(delayMs) || 0));
    });
}

function getViewportSize() {
    return {
        width: window.innerWidth || document.documentElement.clientWidth || 0,
        height: window.innerHeight || document.documentElement.clientHeight || 0
    };
}

function classifyViewport(viewportWidth, viewportHeight) {
    const shortEdge = Math.min(viewportWidth, viewportHeight);
    if (shortEdge <= PHONE_SHORT_EDGE_MAX_PX) {
        return 'phone';
    }
    if (shortEdge <= TABLET_SHORT_EDGE_MAX_PX) {
        return 'tablet';
    }
    return 'desktop';
}

function getEffectiveFontSizePx(fontScale = currentFontScale) {
    return BASE_FONT_SIZE_PX * clamp(fontScale, MIN_FONT_SCALE, MAX_FONT_SCALE);
}

function getComfortableInitialFontPx(deviceClass) {
    if (deviceClass === 'phone') {
        return 18;
    }
    if (deviceClass === 'tablet') {
        return 19;
    }
    return 19.5;
}

function getReaderMarginPx(deviceClass) {
    if (deviceClass === 'phone') {
        return 24;
    }
    if (deviceClass === 'tablet') {
        return 36;
    }
    return DEFAULT_READER_MARGIN_PX;
}

function normalizeDirectionValue(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isDebugEnabled() {
    return Boolean(
        appConfig.debugConsoleEnabled
        ?? window.DEBUG_CONSOLE_ENABLED
        ?? false
    );
}

function summarizeLocation(location = currentLocation) {
    return {
        section: Number(location?.section?.current ?? -1),
        fraction: Math.round(clamp(Number(location?.fraction) || 0, 0, 1) * 10000) / 10000,
        cfi: typeof location?.cfi === 'string' ? location.cfi : ''
    };
}

function debugLog(message, detail = null) {
    if (!isDebugEnabled()) {
        return;
    }

    const payload = {
        ts: new Date().toISOString(),
        message,
        detail
    };

    window.__epubDebugLog = Array.isArray(window.__epubDebugLog)
        ? window.__epubDebugLog
        : [];
    window.__epubDebugLog.push(payload);
    if (window.__epubDebugLog.length > 200) {
        window.__epubDebugLog.shift();
    }

    const logger = typeof window.debugLog === 'function' ? window.debugLog : console.debug.bind(console);
    if (detail === null) {
        logger(`[EPUB] ${message}`);
    } else {
        logger(`[EPUB] ${message}`, detail);
    }
}

function isRestoreTraceEnabled() {
    return isDebugEnabled();
}

function traceRestore(message, detail = {}) {
    if (!isRestoreTraceEnabled()) {
        return;
    }
    debugLog(`restore: ${message}`, detail);
}

function createPerfTimer(scope) {
    const startedAt = performance.now();
    let lastAt = startedAt;
    return (label, detail = {}) => {
        if (!isDebugEnabled()) {
            return;
        }
        const now = performance.now();
        debugLog(`${scope}: ${label}`, {
            stepMs: Math.round(now - lastAt),
            totalMs: Math.round(now - startedAt),
            ...detail
        });
        lastAt = now;
    };
}

function formatPercent(fraction) {
    return `${Math.round(clamp(Number(fraction) || 0, 0, 1) * 100)}%`;
}

function estimateInitialColumnCount(viewportWidth, viewportHeight, isVertical) {
    const deviceClass = classifyViewport(viewportWidth, viewportHeight);
    if (deviceClass === 'phone') {
        return 1;
    }

    const blockAxisSize = isVertical ? viewportWidth : viewportHeight;
    const inlineAxisSize = isVertical ? viewportHeight : viewportWidth;
    if (
        blockAxisSize < MIN_TWO_COLUMN_BLOCK_AXIS_PX
        || inlineAxisSize < MIN_TWO_COLUMN_INLINE_SIZE_PX
    ) {
        return 1;
    }
    return 2;
}

function calculateInitialFontScale(isVertical = true) {
    const { width: viewportWidth, height: viewportHeight } = getViewportSize();
    const deviceClass = classifyViewport(viewportWidth, viewportHeight);
    const marginPx = getReaderMarginPx(deviceClass);
    const inlineAxisSize = isVertical ? viewportHeight : viewportWidth;
    const effectiveSize = Math.max(
        (inlineAxisSize - (marginPx * 2)) * (1 - (COLUMN_GAP_RATIO * 2)),
        MIN_INITIAL_FONT_PX * TARGET_CHARS_PER_LINE
    );
    const columnCount = estimateInitialColumnCount(viewportWidth, viewportHeight, isVertical);

    let columnTextSize = effectiveSize;
    if (!isVertical && columnCount >= 2) {
        const interColumnGap = inlineAxisSize * COLUMN_GAP_RATIO;
        columnTextSize = (effectiveSize - interColumnGap * (columnCount - 1)) / columnCount;
    }

    const idealFontPx = columnTextSize / TARGET_CHARS_PER_LINE;
    const minFontPx = Math.max(MIN_INITIAL_FONT_PX, getComfortableInitialFontPx(deviceClass));
    const clampedFontPx = clamp(idealFontPx, minFontPx, MAX_INITIAL_FONT_PX);
    const rawScale = clampedFontPx / BASE_FONT_SIZE_PX;
    const roundedScale = roundToStep(rawScale, 0.05);
    return clamp(roundedScale, MIN_FONT_SCALE, MAX_FONT_SCALE);
}

function calculateColumnLayout(viewportWidth, viewportHeight, isVertical, effectiveFontSize) {
    const deviceClass = classifyViewport(viewportWidth, viewportHeight);
    const marginPx = getReaderMarginPx(deviceClass);
    const inlineSize = isVertical ? viewportHeight : viewportWidth;
    const blockSize = isVertical ? viewportWidth : viewportHeight;
    const gap = inlineSize * COLUMN_GAP_RATIO;
    const verticalCapacity = (inlineSize - (marginPx * 3)) / effectiveFontSize;
    const horizontalSingleCapacity = (inlineSize - gap - marginPx) / effectiveFontSize;
    const horizontalDoubleCapacity = ((inlineSize / 2) - gap - marginPx) / effectiveFontSize;
    const singleCapacity = isVertical ? verticalCapacity : horizontalSingleCapacity;
    const doubleCapacity = isVertical ? verticalCapacity : horizontalDoubleCapacity;
    const targetInlineSize = isVertical
        ? Math.round((TARGET_CHARS_PER_LINE * effectiveFontSize) + (marginPx * 3))
        : Math.round((TARGET_CHARS_PER_LINE * effectiveFontSize) + gap + marginPx);
    const safeHorizontalSingleInlineSize = Math.max(
        1,
        Math.floor(inlineSize - gap - marginPx)
    );
    const maxBlockSize = `${Math.max(1, Math.round(blockSize - (marginPx * 2)))}px`;

    const canFitTwoColumns = deviceClass !== 'phone'
        && blockSize >= MIN_TWO_COLUMN_BLOCK_AXIS_PX
        && (
            isVertical
                ? inlineSize >= targetInlineSize
                : inlineSize >= MIN_TWO_COLUMN_INLINE_SIZE_PX
        )
        && doubleCapacity >= MIN_TWO_COLUMN_CHARS_PER_LINE;

    if (canFitTwoColumns) {
        return {
            maxColumnCount: isVertical ? 1 : 2,
            maxInlineSize: `${Math.max(1, targetInlineSize)}px`,
            maxBlockSize,
            marginPx,
            deviceClass,
            charsPerLine: doubleCapacity
        };
    }

    return {
        maxColumnCount: 1,
        maxInlineSize: isVertical
            ? `${Math.max(Math.ceil(inlineSize) + 1, targetInlineSize)}px`
            : `${Math.min(targetInlineSize, safeHorizontalSingleInlineSize)}px`,
        maxBlockSize,
        marginPx,
        deviceClass,
        charsPerLine: singleCapacity
    };
}

function formatDateTime(timestamp) {
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
        return t('epub_unknown', 'Unknown');
    }
    try {
        return new Intl.DateTimeFormat(undefined, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        }).format(new Date(timestamp));
    } catch (error) {
        console.warn(error);
        return new Date(timestamp).toLocaleString();
    }
}

function setStatusText(text, error = false) {
    const status = $('epub-status');
    if (!status) {
        return;
    }
    status.textContent = text;
    status.classList.toggle('epub-status-error', Boolean(error));
}

function setReaderLoading(visible, message = '') {
    const overlay = $('epub-loading-overlay');
    const messageNode = $('epub-loading-message');
    if (!overlay) {
        return;
    }

    if (messageNode && message) {
        messageNode.textContent = message;
    }

    overlay.classList.toggle('epub-loading-hidden', !visible);
    overlay.setAttribute('aria-hidden', visible ? 'false' : 'true');
}

function hideReaderLoading() {
    setReaderLoading(false);
}

function getBookDisplayMetadata() {
    const metadata = view?.book?.metadata || {};
    const unknown = t('epub_unknown', 'Unknown');
    const title = normalizeMetadataValue(metadata.title);
    const author = normalizeMetadataValue(metadata.author);
    const fallbackTitle = baseFile.split('/').pop()?.replace(/\.epub$/i, '') || document.title;
    return {
        title: title !== unknown ? title : fallbackTitle,
        author
    };
}

function updateBookHeading() {
    const heading = $('epub-book-heading');
    if (!heading) {
        return;
    }

    const metadata = getBookDisplayMetadata();
    const unknown = t('epub_unknown', 'Unknown');
    const lines = [];
    if (metadata.author && metadata.author !== unknown) {
        lines.push(metadata.author);
    }
    if (metadata.title) {
        lines.push(metadata.title);
    }
    if (lines.length > 0) {
        heading.textContent = lines.join('\n');
    }
}

function localCfiKey() {
    return `${CFI_STORAGE_PREFIX}${baseFile}`;
}

function localStateKey() {
    return `${STATE_STORAGE_PREFIX}${baseFile}`;
}

function getStoredLocation() {
    const localState = getStoredState();
    const localUpdatedAt = Number(localState?.updatedAt) || 0;
    if (savedCfi && savedUpdatedAt > localUpdatedAt) {
        return savedCfi;
    }
    if (localState?.cfi) {
        return localState.cfi;
    }
    const localCfi = localStorage.getItem(localCfiKey());
    if (localCfi) {
        return localCfi;
    }
    if (savedCfi) {
        return savedCfi;
    }
    return null;
}

function getStoredState() {
    try {
        const raw = localStorage.getItem(localStateKey());
        if (!raw) {
            return null;
        }
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
        console.warn(error);
        return null;
    }
}

function persistCurrentLocation() {
    if (!currentLocation?.cfi) {
        return;
    }
    localStorage.setItem(localCfiKey(), currentLocation.cfi);
    localStorage.setItem(localStateKey(), JSON.stringify({
        cfi: currentLocation.cfi,
        fraction: currentLocation.fraction ?? 0,
        section: currentLocation.section?.current ?? 0,
        updatedAt: Date.now()
    }));
}

function getProgressSaveSnapshot() {
    if (!escapedFile || !currentLocation) {
        return null;
    }

    const metrics = getLocationProgressMetrics(currentLocation);
    return {
        file: escapedFile,
        page: metrics.currentPage,
        maxPage: metrics.totalPages,
        cfi: typeof currentLocation?.cfi === 'string' ? currentLocation.cfi : '',
        fraction: typeof currentLocation?.fraction === 'number'
            ? currentLocation.fraction
            : null
    };
}

function buildProgressFormData(snapshot) {
    const data = new FormData();
    data.append('mode', 'close');
    data.append('file', snapshot.file);
    data.append('page', String(snapshot.page));
    data.append('max_page', String(snapshot.maxPage));
    data.append('csrf_token', csrfToken);
    if (snapshot.cfi !== '') {
        data.append('epub_cfi', snapshot.cfi);
    }
    if (snapshot.fraction !== null) {
        data.append('epub_fraction', String(snapshot.fraction));
    }
    return data;
}

function getProgressSaveKey(snapshot) {
    return [
        snapshot.file,
        String(snapshot.page),
        String(snapshot.maxPage),
        snapshot.cfi
    ].join('\n');
}

async function flushProgressSave() {
    if (progressSaveTimer !== null) {
        window.clearTimeout(progressSaveTimer);
        progressSaveTimer = null;
    }

    const snapshot = getProgressSaveSnapshot();
    if (!snapshot) {
        return;
    }

    const saveKey = getProgressSaveKey(snapshot);
    if (saveKey === lastProgressSaveKey) {
        progressSavePending = false;
        return;
    }

    if (progressSaveInFlight) {
        progressSavePending = true;
        return;
    }

    progressSaveInFlight = true;
    progressSavePending = false;

    try {
        const response = await fetch('comistream.php', {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            body: buildProgressFormData(snapshot)
        });
        if (response.ok) {
            lastProgressSaveKey = saveKey;
            debugLog('flushProgressSave() saved', {
                page: snapshot.page,
                maxPage: snapshot.maxPage
            });
        } else {
            debugLog('flushProgressSave() failed', {
                status: response.status
            });
        }
    } catch (error) {
        debugLog('flushProgressSave() error', {
            message: error?.message || String(error)
        });
    } finally {
        progressSaveInFlight = false;
        if (progressSavePending) {
            progressSaveTimer = window.setTimeout(
                flushProgressSave,
                PROGRESS_SAVE_DEBOUNCE_MS
            );
        }
    }
}

function scheduleProgressSave(options = {}) {
    if (!getProgressSaveSnapshot()) {
        return;
    }

    if (progressSaveTimer !== null) {
        window.clearTimeout(progressSaveTimer);
        progressSaveTimer = null;
    }

    const immediate = options.immediate === true || lastProgressSaveKey === '';
    progressSaveTimer = window.setTimeout(
        flushProgressSave,
        immediate ? 0 : PROGRESS_SAVE_DEBOUNCE_MS
    );
}

function getSectionProgressFallback(index, fractionInSection = 0, pageFraction = 0) {
    const sections = Array.isArray(view?.book?.sections) ? view.book.sections : [];
    const sizes = sections.map((section) => {
        const size = Number(section?.size) || 0;
        return section?.linear !== 'no' && size > 0 ? size : 0;
    });
    const sizeTotal = sizes.reduce((sum, size) => sum + size, 0);
    const sectionTotal = sizes.length;
    const boundedIndex = clamp(Number(index) || 0, 0, Math.max(0, sectionTotal - 1));
    const boundedFraction = clamp(Number(fractionInSection) || 0, 0, 1);
    const boundedPageFraction = clamp(Number(pageFraction) || 0, 0, 1);
    const sizeInSection = sizes[boundedIndex] ?? 0;
    const sizeBefore = sizes.slice(0, boundedIndex).reduce((sum, size) => sum + size, 0);
    const size = sizeBefore + boundedFraction * sizeInSection;
    const nextSize = size + boundedPageFraction * sizeInSection;
    const fallbackFraction = sectionTotal > 1
        ? boundedIndex / (sectionTotal - 1)
        : 0;
    const estimatedTotalLocations = sizeTotal > 0 ? Math.ceil(sizeTotal / 1500) : 0;
    const shouldUseSizeProgress = sizeTotal > 0 && estimatedTotalLocations >= Math.max(1, sectionTotal);
    const fraction = shouldUseSizeProgress
        ? nextSize / sizeTotal
        : fallbackFraction;
    const totalLocations = shouldUseSizeProgress
        ? estimatedTotalLocations
        : Math.max(1, sectionTotal);
    const currentLocationIndex = shouldUseSizeProgress
        ? Math.floor(size / 1500)
        : boundedIndex;
    const nextLocationIndex = shouldUseSizeProgress
        ? Math.max(currentLocationIndex, Math.floor(nextSize / 1500))
        : boundedIndex;

    return {
        fraction: clamp(fraction, 0, 1),
        section: {
            current: boundedIndex,
            total: sectionTotal
        },
        location: {
            current: clamp(currentLocationIndex, 0, Math.max(0, totalLocations - 1)),
            next: clamp(nextLocationIndex, 0, Math.max(0, totalLocations - 1)),
            total: totalLocations
        },
        time: {
            section: sizeInSection > 0 ? ((1 - boundedFraction) * sizeInSection) / 1600 : 0,
            total: sizeTotal > 0 ? (sizeTotal - size) / 1600 : 0
        }
    };
}

function getSectionBaseCfi(index) {
    if (!Number.isInteger(index)) {
        return '';
    }
    try {
        const cfi = view?.getCFI?.(index, null);
        if (typeof cfi === 'string' && cfi !== '') {
            return cfi;
        }
    } catch (error) {
        debugLog('getSectionBaseCfi() failed', {
            index,
            message: error?.message || String(error)
        });
    }
    const sectionCfi = view?.book?.sections?.[index]?.cfi;
    return typeof sectionCfi === 'string' ? sectionCfi : '';
}

function isEpubCfiString(value) {
    return typeof value === 'string' && /^epubcfi\(.+\)$/.test(value);
}

function findTocItemForNavigationTarget(targetInfo, expectedIndex) {
    const target = typeof targetInfo?.target === 'string' ? targetInfo.target : '';
    const flattened = flattenTocItems(view?.book?.toc);
    if (target !== '') {
        const exact = flattened.find(({ item }) => item?.href === target);
        if (exact?.item) {
            return exact.item;
        }
    }
    const sameSection = flattened.find(({ item }) => resolveTocHrefIndex(item?.href || '') === expectedIndex);
    return sameSection?.item ?? null;
}

function createNavigationFallbackLocation(targetInfo) {
    const expectedIndex = Number.isInteger(targetInfo?.expectedIndex)
        ? targetInfo.expectedIndex
        : null;
    if (expectedIndex === null) {
        return null;
    }

    const target = typeof targetInfo?.target === 'string' ? targetInfo.target : '';
    const fallbackCfi = isEpubCfiString(target)
        ? target
        : (getSectionBaseCfi(expectedIndex) || target);
    if (!fallbackCfi) {
        return null;
    }

    return {
        ...getSectionProgressFallback(expectedIndex, 0, 0),
        tocItem: findTocItemForNavigationTarget(targetInfo, expectedIndex),
        pageItem: null,
        cfi: fallbackCfi,
        range: null
    };
}

function normalizeLocationForProgress(location, reason = 'relocate') {
    if (!location || typeof location !== 'object') {
        return location;
    }

    const expectedIndex = Number.isInteger(location?.section?.current)
        ? location.section.current
        : (Number.isInteger(location?.index) ? location.index : null);
    if (!Number.isInteger(expectedIndex)) {
        return location;
    }

    if (isUsableLocationForNavigationTarget(location, expectedIndex)) {
        return location;
    }

    const cfi = typeof location?.cfi === 'string' ? location.cfi : '';
    const fallbackLocation = createNavigationFallbackLocation({
        target: cfi,
        expectedIndex
    });
    if (!fallbackLocation) {
        return location;
    }

    debugLog('normalizeLocationForProgress() replaced unusable location', {
        reason,
        expectedIndex,
        before: summarizeLocation(location),
        beforeTotal: location?.location?.total ?? null,
        after: summarizeLocation(fallbackLocation),
        afterTotal: fallbackLocation?.location?.total ?? null
    });
    return fallbackLocation;
}

function isUsableLocationForNavigationTarget(location, expectedIndex) {
    if (!location || !Number.isInteger(expectedIndex)) {
        return false;
    }
    const sectionIndex = Number(location?.section?.current);
    if (sectionIndex !== expectedIndex) {
        return false;
    }
    const sectionCount = Array.isArray(view?.book?.sections) ? view.book.sections.length : 0;
    const totalLocations = Number(location?.location?.total);
    if (sectionCount > 1 && (!Number.isFinite(totalLocations) || totalLocations < sectionCount)) {
        return false;
    }
    const fraction = Number(location?.fraction);
    return Number.isFinite(fraction) && fraction >= 0 && fraction <= 1;
}

function ensureLocationForNavigationTarget(targetInfo, beforeRelocationSeq, beforeLocation) {
    if (!Number.isInteger(targetInfo?.expectedIndex)) {
        return false;
    }

    const latestLocation = view?.lastLocation || currentLocation;
    const afterLocation = summarizeLocation(latestLocation);
    if (
        relocationEventSeq !== beforeRelocationSeq
        &&
        hasLocationChanged(beforeLocation, afterLocation)
        && isUsableLocationForNavigationTarget(latestLocation, targetInfo.expectedIndex)
    ) {
        return false;
    }

    const fallbackLocation = createNavigationFallbackLocation(targetInfo);
    if (!fallbackLocation) {
        return false;
    }

    currentLocation = fallbackLocation;
    if (view) {
        view.lastLocation = fallbackLocation;
    }
    persistCurrentLocation();
    updateProgressUI(currentLocation);
    refreshReadingModeInfo();
    const layoutChanged = updateLayoutDirectionInfo(getPreferredContentDoc());
    if (layoutChanged) {
        applyRendererPrefs();
    }
    updateDirectionState();
    renderInspector();
    debugLog('ensureLocationForNavigationTarget() synthesized location', {
        beforeLocation,
        targetInfo,
        location: summarizeLocation(currentLocation)
    });
    return true;
}

function clearStoredLocation() {
    localStorage.removeItem(localCfiKey());
    localStorage.removeItem(localStateKey());
}

function resolveBackListFallbackUrl() {
    if (typeof readerFallbackParentUrl === 'string' && readerFallbackParentUrl !== '' && readerFallbackParentUrl !== '/') {
        return readerFallbackParentUrl;
    }
    if (typeof readerFallbackHomeUrl === 'string' && readerFallbackHomeUrl !== '' && readerFallbackHomeUrl !== '/') {
        return readerFallbackHomeUrl;
    }
    if (typeof readerFallbackParentUrl === 'string' && readerFallbackParentUrl !== '') {
        return readerFallbackParentUrl;
    }
    if (typeof readerFallbackHomeUrl === 'string' && readerFallbackHomeUrl !== '') {
        return readerFallbackHomeUrl;
    }
    return '/';
}

function hasUsableBackReferrer() {
    const referrer = typeof document.referrer === 'string'
        ? document.referrer.trim()
        : '';
    if (referrer === '') {
        return false;
    }

    try {
        const currentUrl = new URL(window.location.href);
        const referrerUrl = new URL(referrer, window.location.origin);
        return referrerUrl.href !== currentUrl.href;
    } catch (error) {
        return referrer !== window.location.href;
    }
}

function exitFullScreenIfNeeded() {
    if (document.cancelFullScreen) {
        document.cancelFullScreen();
    } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
    } else if (document.webkitCancelFullScreen) {
        document.webkitCancelFullScreen();
    } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
    } else if (document.exitFullscreen) {
        document.exitFullscreen();
    }
}

function backListPage() {
    persistCurrentLocation();
    sendProgressBeacon();
    exitFullScreenIfNeeded();

    if (window.history.length > 1) {
        window.history.back();
    } else if (hasUsableBackReferrer()) {
        window.location.href = document.referrer;
    } else {
        window.location.href = resolveBackListFallbackUrl();
    }
}

/**
 * foliate-js epub.js の resolveURL と同じ考え方ルン（エクスポートされていないのでローカル実装）
 */
function resolveEpubPath(url, relativeTo) {
    try {
        const replaced = url.replace(/%2c/gi, ',').replace(/%3a/gi, ':');
        if (relativeTo.includes(':') && !relativeTo.startsWith('OEBPS')) {
            return new URL(replaced, relativeTo).href;
        }
        const root = 'https://invalid.invalid/';
        const obj = new URL(replaced, root + relativeTo);
        obj.search = '';
        return decodeURI(obj.href.replace(root, ''));
    } catch (error) {
        console.warn(error);
        return url;
    }
}

function packageFileUrl(packageBase, innerPath) {
    const normalized = String(innerPath || '').replace(/^\/+/, '');
    const base = packageBase.endsWith('/') ? packageBase : `${packageBase}/`;
    if (/^https?:\/\//i.test(base)) {
        return new URL(normalized, base).href;
    }
    const origin = window.location.origin || '';
    const path = base.startsWith('/') ? base : `/${base}`;
    return new URL(normalized, origin + path).href;
}

function optionalPackageMissingKey(packageBase) {
    try {
        const parsed = new URL(packageBase, window.location.href);
        const segments = parsed.pathname.split('/').filter(Boolean);
        const bookIndex = segments.findIndex((segment) => segment === 'book');
        const userId = bookIndex !== -1 ? segments[bookIndex + 3] : '';
        const pathHash = bookIndex !== -1 ? segments[bookIndex + 4] : '';
        if (userId && pathHash) {
            return `${OPTIONAL_PACKAGE_MISSING_PREFIX}${parsed.origin}:${userId}:${pathHash}`;
        }
    } catch (error) {
        console.warn(error);
    }
    return `${OPTIONAL_PACKAGE_MISSING_PREFIX}${packageBase}`;
}

function restoreOptionalMissingPaths(packageBase) {
    try {
        const raw = sessionStorage.getItem(optionalPackageMissingKey(packageBase));
        if (!raw) {
            return new Set();
        }
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return new Set();
        }
        return new Set(parsed.filter((path) => OPTIONAL_PACKAGE_PATHS.has(path)));
    } catch (error) {
        console.warn(error);
        return new Set();
    }
}

function rememberOptionalMissingPath(packageBase, path, missingCache) {
    if (!OPTIONAL_PACKAGE_PATHS.has(path)) {
        return;
    }
    missingCache.add(path);
    try {
        const missingPaths = restoreOptionalMissingPaths(packageBase);
        missingPaths.add(path);
        sessionStorage.setItem(
            optionalPackageMissingKey(packageBase),
            JSON.stringify([...missingPaths])
        );
    } catch (error) {
        console.warn(error);
    }
}

async function buildHttpPackageLoader(packageBase) {
    const sizeCache = new Map();
    const textCache = new Map();
    const blobCache = new Map();
    const missingCache = restoreOptionalMissingPaths(packageBase);
    const textPending = new Map();
    const blobPending = new Map();

    async function fetchPart(path, init = {}) {
        const url = packageFileUrl(packageBase, path);
        return fetch(url, {
            credentials: 'include',
            ...init
        });
    }

    function rememberResponseSize(name, res, fallbackSize = 0) {
        const headerSize = Number(res.headers.get('content-length'));
        const size = Number.isFinite(headerSize) && headerSize > 0
            ? headerSize
            : fallbackSize;
        if (size > 0) {
            sizeCache.set(name, size);
        }
    }

    async function fetchText(name) {
        const res = await fetchPart(name);
        if (res.status === 404) {
            rememberOptionalMissingPath(packageBase, name, missingCache);
            return null;
        }
        if (!res.ok) {
            throw new Error(`EPUB fetch failed: ${name} (${res.status})`);
        }
        const text = await res.text();
        rememberResponseSize(name, res, new Blob([text]).size);
        textCache.set(name, text);
        return text;
    }

    async function loadText(name) {
        if (textCache.has(name)) {
            return textCache.get(name);
        }
        if (missingCache.has(name)) {
            return null;
        }
        if (blobCache.has(name)) {
            const text = await blobCache.get(name).text();
            textCache.set(name, text);
            rememberResponseSize(name, { headers: new Headers() }, blobCache.get(name).size);
            return text;
        }
        if (!textPending.has(name)) {
            textPending.set(name, fetchText(name).finally(() => {
                textPending.delete(name);
            }));
        }
        return await textPending.get(name);
    }

    async function fetchBlob(name) {
        const res = await fetchPart(name);
        if (res.status === 404) {
            rememberOptionalMissingPath(packageBase, name, missingCache);
            return null;
        }
        if (!res.ok) {
            throw new Error(`EPUB fetch failed: ${name} (${res.status})`);
        }
        const blob = await res.blob();
        rememberResponseSize(name, res, blob.size);
        blobCache.set(name, blob);
        return blob;
    }

    async function loadBlob(name) {
        if (blobCache.has(name)) {
            return blobCache.get(name);
        }
        if (missingCache.has(name)) {
            return null;
        }
        if (textCache.has(name)) {
            const blob = new Blob([textCache.get(name)]);
            blobCache.set(name, blob);
            rememberResponseSize(name, { headers: new Headers() }, blob.size);
            return blob;
        }
        if (!blobPending.has(name)) {
            blobPending.set(name, fetchBlob(name).finally(() => {
                blobPending.delete(name);
            }));
        }
        return await blobPending.get(name);
    }

    function getSize(name) {
        return sizeCache.get(name) ?? 0;
    }

    const containerXml = await loadText('META-INF/container.xml');
    if (!containerXml) {
        throw new Error('META-INF/container.xml not found');
    }

    const parser = new DOMParser();
    const cdoc = parser.parseFromString(containerXml, 'application/xml');
    let rootfile = cdoc.getElementsByTagNameNS(NS_CONTAINER, 'rootfile')[0];
    if (!rootfile) {
        rootfile = cdoc.querySelector('rootfile');
    }
    const fullPath = rootfile?.getAttribute('full-path')?.trim();
    if (!fullPath) {
        throw new Error('No rootfile in container');
    }

    const opfText = await loadText(fullPath);
    if (!opfText) {
        throw new Error('OPF not found');
    }
    const opfDoc = parser.parseFromString(opfText, 'application/xml');

    const pathSet = new Set(['META-INF/container.xml', fullPath]);
    const manifestHrefMap = new Map();

    let manifestItems = opfDoc.getElementsByTagNameNS(NS_OPF, 'item');
    if (!manifestItems || manifestItems.length === 0) {
        const manifestEl = opfDoc.getElementsByTagNameNS(NS_OPF, 'manifest')[0]
            || opfDoc.querySelector('manifest');
        if (manifestEl) {
            manifestItems = manifestEl.getElementsByTagNameNS(NS_OPF, 'item');
            if (!manifestItems.length) {
                manifestItems = manifestEl.getElementsByTagName('item');
            }
        }
    }
    if (!manifestItems || manifestItems.length === 0) {
        manifestItems = opfDoc.querySelectorAll('manifest > item');
    }
    for (let i = 0; i < manifestItems.length; i++) {
        const item = manifestItems[i];
        const rawHref = item.getAttribute('href');
        if (!rawHref) {
            continue;
        }
        const href = rawHref.split('#')[0].trim();
        if (!href) {
            continue;
        }
        const resolved = resolveEpubPath(href, fullPath);
        const id = item.getAttribute('id')?.trim();
        if (id) {
            manifestHrefMap.set(id, resolved);
        }
        pathSet.add(resolved);
    }

    let spineItems = opfDoc.getElementsByTagNameNS(NS_OPF, 'itemref');
    if (!spineItems || spineItems.length === 0) {
        spineItems = opfDoc.querySelectorAll('spine > itemref');
    }
    let firstSpinePath = '';
    for (let i = 0; i < spineItems.length; i++) {
        const itemref = spineItems[i];
        const idref = itemref.getAttribute('idref')?.trim();
        if (!idref) {
            continue;
        }
        const resolved = manifestHrefMap.get(idref);
        if (resolved) {
            if (!firstSpinePath && itemref.getAttribute('linear') !== 'no') {
                firstSpinePath = resolved;
            }
        }
    }

    pathSet.add('META-INF/encryption.xml');
    for (const path of OPTIONAL_PACKAGE_PATHS) {
        if (missingCache.has(path)) {
            pathSet.add(path);
        }
    }

    if (firstSpinePath) {
        // 初回描画で使う本文だけ先行取得するルン。待たずに走らせてFoliate側の再取得を避けるルン。
        void loadText(firstSpinePath).catch((error) => {
            console.warn(error);
        });
    }

    const entries = [...pathSet].map((filename) => ({ filename }));

    return { entries, loadText, loadBlob, getSize };
}

function detectBaseReadingMode(preferredDoc = null) {
    const fallback = {
        rtl: true,
        vertical: true,
        explicitRtl: false,
        explicitVertical: false
    };

    try {
        const doc = preferredDoc || getPreferredContentDoc();
        if (!doc?.body || !doc?.defaultView) {
            return fallback;
        }

        const { defaultView } = doc;
        const bodyStyle = defaultView.getComputedStyle(doc.body);
        let { writingMode } = bodyStyle;
        if (!writingMode || writingMode === 'horizontal-tb') {
            const firstChild = doc.body.querySelector(':scope > :not([cfi-inert])');
            if (firstChild) {
                const childStyle = defaultView.getComputedStyle(firstChild);
                if (childStyle.writingMode === 'vertical-rl' || childStyle.writingMode === 'vertical-lr') {
                    writingMode = childStyle.writingMode;
                }
            }
        }

        const htmlDir = String(doc.documentElement?.getAttribute('dir') || '').toLowerCase();
        const bodyDir = String(doc.body?.getAttribute('dir') || '').toLowerCase();
        const computedDirection = String(bodyStyle.direction || '').toLowerCase();
        const explicitRtl = htmlDir === 'rtl' || bodyDir === 'rtl' || htmlDir === 'ltr' || bodyDir === 'ltr';
        const explicitVertical = writingMode === 'vertical-rl'
            || writingMode === 'vertical-lr'
            || writingMode === 'horizontal-tb';
        const resolvedRtl = explicitRtl
            ? (htmlDir === 'rtl' || bodyDir === 'rtl')
            : computedDirection === 'rtl'
                ? true
                : computedDirection === 'ltr'
                    ? false
                    : fallback.rtl;
        const resolvedVertical = writingMode === 'vertical-rl' || writingMode === 'vertical-lr'
            ? true
            : writingMode === 'horizontal-tb'
                ? false
                : fallback.vertical;

        return {
            rtl: resolvedRtl,
            vertical: resolvedVertical,
            explicitRtl,
            explicitVertical
        };
    } catch (error) {
        console.warn(error);
        return fallback;
    }
}

function getBookDirectionRtl() {
    const bookDirection = normalizeDirectionValue(view?.book?.dir);
    if (bookDirection === 'rtl') {
        return true;
    }
    if (bookDirection === 'ltr') {
        return false;
    }
    return null;
}

function resolveEffectiveReadingMode(preferredDoc = null) {
    const baseDirection = detectBaseReadingMode(preferredDoc);
    const bookDirectionRtl = getBookDirectionRtl();
    const autoRtl = bookDirectionRtl ?? baseDirection.rtl;
    return {
        rtl: currentDirectionOverride === 'auto'
            ? autoRtl
            : currentDirectionOverride === 'rtl',
        vertical: currentWritingModeOverride === 'auto'
            ? baseDirection.vertical
            : currentWritingModeOverride === 'vertical',
        explicitRtl: baseDirection.explicitRtl || bookDirectionRtl !== null,
        explicitVertical: baseDirection.explicitVertical
    };
}

function resolveEffectiveLayoutMode() {
    const bookDirectionRtl = getBookDirectionRtl();
    const autoRtl = bookDirectionRtl ?? layoutDirectionInfo.rtl;
    return {
        rtl: currentDirectionOverride === 'auto'
            ? autoRtl
            : currentDirectionOverride === 'rtl',
        vertical: currentWritingModeOverride === 'auto'
            ? layoutDirectionInfo.vertical
            : currentWritingModeOverride === 'vertical',
        explicitRtl: layoutDirectionInfo.explicitRtl || bookDirectionRtl !== null,
        explicitVertical: layoutDirectionInfo.explicitVertical
    };
}

function setRendererAttribute(name, value) {
    if (!view?.renderer) {
        return;
    }
    if (value === null || value === undefined || value === '') {
        view.renderer.removeAttribute?.(name);
        return;
    }
    view.renderer.setAttribute(name, String(value));
}

function isValidThemeName(themeName) {
    return themeName === THEME_OPTION_SYSTEM
        || Object.prototype.hasOwnProperty.call(THEMES, themeName);
}

function getEffectiveThemeName(themeName = currentTheme) {
    if (themeName === THEME_OPTION_SYSTEM) {
        return systemDarkModeMedia?.matches ? 'dark' : 'white';
    }
    return Object.prototype.hasOwnProperty.call(THEMES, themeName) ? themeName : 'paper';
}

function getEffectiveTheme(themeName = currentTheme) {
    return THEMES[getEffectiveThemeName(themeName)] || THEMES.paper;
}

function applyShellTheme() {
    const theme = getEffectiveTheme();
    document.body.style.background = theme.shellBg;
    document.documentElement.style.background = theme.shellBg;

    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
        themeColorMeta.setAttribute('content', theme.themeColor);
    }
}

function applyTheme(themeName, { persist = true, refreshRenderer = true } = {}) {
    if (!isValidThemeName(themeName)) {
        return;
    }

    currentTheme = themeName;
    applyShellTheme();

    if (persist) {
        localStorage.setItem(THEME_KEY, themeName);
    }

    if (refreshRenderer && view?.renderer) {
        applyRendererPrefs();
    } else {
        updateToolbarState();
    }
}

function buildReaderCSS(fontScale) {
    const effectiveLayout = resolveEffectiveReadingMode();
    const theme = getEffectiveTheme();
    const shouldOverrideDirection = currentDirectionOverride !== 'auto';
    const shouldOverrideWritingMode = currentWritingModeOverride !== 'auto';
    const writingMode = effectiveLayout.vertical
        ? (effectiveLayout.rtl ? 'vertical-rl' : 'vertical-lr')
        : 'horizontal-tb';
    const direction = effectiveLayout.rtl ? 'rtl' : 'ltr';
    const overrideCss = [
        shouldOverrideWritingMode ? `    writing-mode: ${writingMode} !important;` : '',
        shouldOverrideDirection ? `    direction: ${direction} !important;` : ''
    ].filter(Boolean).join('\n');
    const bodyOverrideCss = [
        shouldOverrideWritingMode ? '    writing-mode: inherit !important;' : '',
        shouldOverrideDirection ? '    direction: inherit !important;' : ''
    ].filter(Boolean).join('\n');

    return `
@import url('https://fonts.googleapis.com/css2?family=BIZ+UDMincho:wght@400;700&display=swap');
@namespace epub "http://www.idpf.org/2007/ops";
html {
    font-size: ${Math.round(fontScale * 100)}% !important;
    color-scheme: ${theme.colorScheme} !important;
    --theme-bg-color: ${theme.bg} !important;
    background: var(--theme-bg-color) !important;
    color: ${theme.color} !important;
    line-break: strict !important;
    hanging-punctuation: force-end allow-end;
    text-spacing-trim: space-first allow-end;
    text-rendering: optimizeLegibility;
    font-feature-settings: "palt" 1, "pkna" 1;
    -webkit-font-smoothing: antialiased;
    letter-spacing: 0 !important;
    word-spacing: normal !important;
${overrideCss}
}
body {
    background: transparent !important;
    color: inherit !important;
    font-family: "BIZ UDMincho", "Noto Serif JP", "YuMincho", "Yu Mincho",
        "Hiragino Mincho ProN", serif !important;
    line-height: 1.75 !important;
    line-break: strict !important;
    hanging-punctuation: force-end allow-end;
    text-spacing-trim: space-first allow-end;
    font-feature-settings: "palt" 1, "pkna" 1;
    font-kerning: normal;
    letter-spacing: 0 !important;
    word-spacing: normal !important;
${bodyOverrideCss}
}
img, svg {
    max-inline-size: none !important;
    max-width: 100% !important;
    max-height: 100% !important;
    width: auto !important;
    height: auto !important;
    block-size: auto !important;
}
body > img:only-child,
body > svg:only-child,
body > p:only-child > img:only-child,
body > div:only-child > img:only-child,
body > section:only-child > img:only-child {
    display: block !important;
    margin: auto !important;
    object-fit: contain;
}
html[data-comistream-image-page] {
    writing-mode: horizontal-tb !important;
    direction: ltr !important;
}
html[data-comistream-image-page] body,
html[data-comistream-image-page] [data-comistream-media-wrapper] {
    writing-mode: horizontal-tb !important;
    direction: ltr !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    width: 100% !important;
    height: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
}
html[data-comistream-image-page] [data-comistream-page-media] {
    display: block !important;
    max-width: 100% !important;
    max-height: 100% !important;
    width: auto !important;
    height: auto !important;
    margin: auto !important;
    object-fit: contain !important;
}
html[data-comistream-illustration-break-page] [data-comistream-illustration-break] {
    -webkit-column-break-after: always !important;
    break-after: column !important;
    break-inside: avoid !important;
    page-break-after: always !important;
    page-break-inside: avoid !important;
}
html[data-comistream-illustration-break-page] [data-comistream-illustration-break] img,
html[data-comistream-illustration-break-page] [data-comistream-illustration-break] svg,
html[data-comistream-illustration-break-page] [data-comistream-illustration-break] video {
    display: block !important;
}
html[data-comistream-illustration-break-page] [data-comistream-illustration-spacer] {
    -webkit-column-break-after: always !important;
    break-after: column !important;
    break-inside: avoid !important;
    page-break-after: always !important;
    page-break-inside: avoid !important;
    display: block !important;
    overflow: hidden !important;
    visibility: hidden !important;
}
`;
}

function buildRendererPrefsSignature({
    disableSectionPreload,
    layout = null
}) {
    return JSON.stringify({
        fixedLayout: Boolean(view?.isFixedLayout),
        flow: currentFlowMode,
        theme: currentTheme,
        effectiveTheme: getEffectiveThemeName(),
        fontScale: currentFontScale,
        directionOverride: currentDirectionOverride,
        writingModeOverride: currentWritingModeOverride,
        layoutDirectionInfo,
        disableSectionPreload,
        layout
    });
}

function restoreViewerPrefs() {
    const storedScale = Number(localStorage.getItem(FONT_SCALE_KEY));
    const storedScaleSource = localStorage.getItem(FONT_SCALE_SOURCE_KEY);
    const storedScaleVersion = localStorage.getItem(FONT_SCALE_VERSION_KEY);
    const hasLegacyScaleMetadata = storedScaleSource === null && !storedScaleVersion;
    const shouldReuseStoredScale = !Number.isNaN(storedScale)
        && storedScale > 0
        && (
            storedScaleSource === FONT_SCALE_SOURCE_MANUAL
            || (storedScaleSource === FONT_SCALE_SOURCE_AUTO
                && storedScaleVersion === FONT_SCALE_ALGORITHM_VERSION)
        );

    if (shouldReuseStoredScale) {
        hasStoredFontScale = true;
        currentFontScale = clamp(storedScale, MIN_FONT_SCALE, MAX_FONT_SCALE);
        currentFontScaleSource = storedScaleSource === FONT_SCALE_SOURCE_AUTO
            ? FONT_SCALE_SOURCE_AUTO
            : FONT_SCALE_SOURCE_MANUAL;
    } else {
        hasStoredFontScale = !hasLegacyScaleMetadata;
        currentFontScale = calculateInitialFontScale(true);
        currentFontScaleSource = FONT_SCALE_SOURCE_AUTO;
    }
    const storedFlow = localStorage.getItem(FLOW_MODE_KEY);
    if (storedFlow === 'paginated' || storedFlow === 'scrolled') {
        currentFlowMode = storedFlow;
    }
    const storedTheme = localStorage.getItem(THEME_KEY);
    if (storedTheme && isValidThemeName(storedTheme)) {
        currentTheme = storedTheme;
    }
    const storedDirectionOverride = localStorage.getItem(DIRECTION_OVERRIDE_KEY);
    if (storedDirectionOverride === 'auto' || storedDirectionOverride === 'rtl' || storedDirectionOverride === 'ltr') {
        currentDirectionOverride = storedDirectionOverride;
    }
    const storedWritingModeOverride = localStorage.getItem(WRITING_MODE_OVERRIDE_KEY);
    if (storedWritingModeOverride === 'auto' || storedWritingModeOverride === 'vertical' || storedWritingModeOverride === 'horizontal') {
        currentWritingModeOverride = storedWritingModeOverride;
    }
}

function saveViewerPrefs() {
    localStorage.setItem(FONT_SCALE_KEY, String(currentFontScale));
    localStorage.setItem(FONT_SCALE_SOURCE_KEY, currentFontScaleSource);
    localStorage.setItem(FONT_SCALE_VERSION_KEY, FONT_SCALE_ALGORITHM_VERSION);
    localStorage.setItem(FLOW_MODE_KEY, currentFlowMode);
    localStorage.setItem(THEME_KEY, currentTheme);
    localStorage.setItem(DIRECTION_OVERRIDE_KEY, currentDirectionOverride);
    localStorage.setItem(WRITING_MODE_OVERRIDE_KEY, currentWritingModeOverride);
}

function refreshReadingModeInfo(preferredDoc = null) {
    currentDirectionInfo = resolveEffectiveReadingMode(preferredDoc || getPreferredContentDoc());
}

function getNavigationIsRtl() {
    if (currentDirectionOverride !== 'auto') {
        return currentDirectionOverride === 'rtl';
    }

    const bookDirection = normalizeDirectionValue(view?.book?.dir);
    if (bookDirection === 'rtl') {
        return true;
    }
    if (bookDirection === 'ltr') {
        return false;
    }

    return currentDirectionInfo.rtl;
}

function formatDirectionLabel() {
    const current = currentDirectionInfo.rtl
        ? t('epub_direction_rtl', 'Right-to-Left')
        : t('epub_direction_ltr', 'Left-to-Right');
    return currentDirectionOverride === 'auto'
        ? `${t('epub_auto', 'Auto')} / ${current}`
        : current;
}

function formatWritingModeLabel() {
    const current = currentDirectionInfo.vertical
        ? t('epub_writing_vertical', 'Vertical')
        : t('epub_writing_horizontal', 'Horizontal');
    return currentWritingModeOverride === 'auto'
        ? `${t('epub_auto', 'Auto')} / ${current}`
        : current;
}

function focusReader() {
    if (typeof view?.focus === 'function') {
        view.focus();
    }
    if (typeof $('epub-viewer')?.focus === 'function') {
        $('epub-viewer').focus();
    }
}

function isFixedLayoutBook() {
    return Boolean(view?.isFixedLayout);
}

function hasUsableDocumentBody(doc) {
    return Boolean(doc?.body && doc.body.nodeType === Node.ELEMENT_NODE);
}

function preserveIllustrationInlineStyles(element, properties) {
    if (!element?.style) {
        return;
    }
    let snapshot = illustrationStyleSnapshots.get(element);
    if (!snapshot) {
        snapshot = new Map();
        illustrationStyleSnapshots.set(element, snapshot);
    }
    for (const property of properties) {
        if (!snapshot.has(property)) {
            snapshot.set(property, {
                value: element.style.getPropertyValue(property),
                priority: element.style.getPropertyPriority(property)
            });
        }
    }
}

function clearIllustrationInlineStyles(element) {
    const snapshot = illustrationStyleSnapshots.get(element);
    if (!snapshot || !element?.style) {
        return;
    }
    for (const [property, style] of snapshot.entries()) {
        if (style.value) {
            element.style.setProperty(property, style.value, style.priority);
        } else {
            element.style.removeProperty(property);
        }
    }
    illustrationStyleSnapshots.delete(element);
}

function applyImportantStyle(element, styles) {
    if (!element?.style) {
        return;
    }
    preserveIllustrationInlineStyles(element, Object.keys(styles));
    for (const [property, value] of Object.entries(styles)) {
        element.style.setProperty(property, value, 'important');
    }
}

function getIllustrationPageMetrics() {
    const { width, height } = getViewportSize();
    const layout = resolveEffectiveLayoutMode();
    const deviceClass = classifyViewport(width, height);
    const marginPx = getReaderMarginPx(deviceClass);
    const columnLayout = calculateColumnLayout(
        width,
        height,
        layout.vertical,
        getEffectiveFontSizePx(currentFontScale)
    );
    const inlineSize = Math.max(1, Math.round(layout.vertical ? height : width));
    const maxInlineSize = Math.max(1, parseFloat(columnLayout.maxInlineSize) || inlineSize);
    const maxColumnCount = Math.max(1, Number(columnLayout.maxColumnCount) || 1);
    const visualColumnCount = currentFlowMode === 'paginated'
        ? clamp(
            Math.min(
                maxColumnCount + (layout.vertical ? 1 : 0),
                Math.ceil(Math.floor(inlineSize) / Math.floor(maxInlineSize))
            ),
            1,
            ILLUSTRATION_MAX_SPACER_COUNT + 1
        )
        : 1;
    const contentWidth = Math.max(1, Math.round(width - marginPx * 2));
    const contentHeight = Math.max(1, Math.round(height - marginPx * 2));
    return {
        vertical: layout.vertical,
        inlineSize,
        blockSize: Math.max(1, Math.round(layout.vertical ? width : height)),
        columnInlineSize: Math.max(1, Math.round(inlineSize / visualColumnCount)),
        mediaMaxWidth: `${contentWidth}px`,
        mediaMaxHeight: `${contentHeight}px`,
        visualColumnCount
    };
}

function applyIllustrationPageStyles(target, media) {
    const metrics = getIllustrationPageMetrics();
    applyImportantStyle(target, {
        'align-items': 'center',
        'block-size': `${metrics.blockSize}px`,
        'box-sizing': 'border-box',
        'display': 'flex',
        'inline-size': `${metrics.inlineSize}px`,
        'justify-content': 'center',
        'margin': '0 auto',
        'min-block-size': `${metrics.blockSize}px`,
        'min-inline-size': `${metrics.inlineSize}px`,
        'overflow': 'hidden',
        'padding': '0'
    });
    applyImportantStyle(media, {
        'display': 'block',
        'height': 'auto',
        'margin': 'auto',
        'max-height': metrics.mediaMaxHeight,
        'max-width': metrics.mediaMaxWidth,
        'object-fit': 'contain',
        'width': 'auto'
    });
    return metrics;
}

function createIllustrationSpacer(doc, metrics) {
    const spacer = doc.createElement('span');
    spacer.setAttribute('data-comistream-illustration-spacer', '1');
    spacer.setAttribute('aria-hidden', 'true');
    spacer.setAttribute('role', 'presentation');
    spacer.setAttribute('cfi-inert', '');
    applyImportantStyle(spacer, {
        'block-size': `${metrics.blockSize}px`,
        'box-sizing': 'border-box',
        'display': 'block',
        'inline-size': `${metrics.columnInlineSize}px`,
        'margin': '0',
        'min-block-size': `${metrics.blockSize}px`,
        'min-inline-size': `${metrics.columnInlineSize}px`,
        'overflow': 'hidden',
        'padding': '0',
        'visibility': 'hidden'
    });
    return spacer;
}

function insertIllustrationSpacers(target, metrics) {
    const doc = target?.ownerDocument;
    const parent = target?.parentNode;
    if (!doc || !parent) {
        return 0;
    }

    const spacerCount = clamp(
        Math.round(metrics.visualColumnCount) - 1,
        0,
        ILLUSTRATION_MAX_SPACER_COUNT
    );
    let insertAfter = target;
    for (let index = 0; index < spacerCount; index++) {
        const spacer = createIllustrationSpacer(doc, metrics);
        parent.insertBefore(spacer, insertAfter.nextSibling);
        insertAfter = spacer;
    }
    return spacerCount;
}

function clearMediaPageMarks(doc) {
    if (!hasUsableDocumentBody(doc)) {
        return;
    }

    doc.documentElement.removeAttribute('data-comistream-image-page');
    doc.documentElement.removeAttribute('data-comistream-illustration-break-page');
    doc.body.removeAttribute('data-comistream-image-page');
    doc.body.removeAttribute('data-comistream-illustration-break-page');
    for (const spacer of doc.querySelectorAll('[data-comistream-illustration-spacer]')) {
        clearIllustrationInlineStyles(spacer);
        spacer.remove();
    }
    for (const marked of doc.querySelectorAll('[data-comistream-media-wrapper], [data-comistream-page-media], [data-comistream-illustration-break]')) {
        marked.removeAttribute('data-comistream-media-wrapper');
        marked.removeAttribute('data-comistream-page-media');
        marked.removeAttribute('data-comistream-illustration-break');
        clearIllustrationInlineStyles(marked);
        for (const media of marked.querySelectorAll('img, svg, video')) {
            clearIllustrationInlineStyles(media);
        }
    }
}

function markImageOnlyPage(doc) {
    if (!hasUsableDocumentBody(doc)) {
        return false;
    }

    const mediaNodes = [...doc.body.querySelectorAll('img, svg, video')];
    if (mediaNodes.length !== 1) {
        return false;
    }

    const bodyText = (doc.body.textContent || '').replace(/\s+/g, '');
    if (bodyText !== '') {
        return false;
    }

    const media = mediaNodes[0];
    doc.documentElement.setAttribute('data-comistream-image-page', '1');
    doc.body.setAttribute('data-comistream-image-page', '1');
    media.setAttribute('data-comistream-page-media', '1');

    let ancestor = media.parentElement;
    while (ancestor && ancestor !== doc.body) {
        ancestor.setAttribute('data-comistream-media-wrapper', '1');
        ancestor = ancestor.parentElement;
    }
    return true;
}

function getNodeTextLengthBefore(root, target) {
    const nodeFilter = root.ownerDocument.defaultView?.NodeFilter ?? NodeFilter;
    const walker = root.ownerDocument.createTreeWalker(root, nodeFilter.SHOW_TEXT);
    let length = 0;
    while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node === target || target.contains(node)) {
            break;
        }
        length += String(node.textContent || '').replace(/\s+/g, '').length;
        if (length > ILLUSTRATION_MAX_TEXT_BEFORE_CHARS) {
            break;
        }
    }
    return length;
}

function getIllustrationBreakCandidate(media) {
    let candidate = media;
    let ancestor = media.parentElement;
    while (ancestor && ancestor !== media.ownerDocument.body) {
        const textLength = String(ancestor.textContent || '').replace(/\s+/g, '').length;
        const mediaCount = ancestor.querySelectorAll('img, svg, video').length;
        if (mediaCount > 1 || textLength > ILLUSTRATION_MAX_TEXT_BEFORE_CHARS) {
            break;
        }
        candidate = ancestor;
        ancestor = ancestor.parentElement;
    }
    return candidate;
}

function getMediaArea(media) {
    const rect = media.getBoundingClientRect?.();
    const renderedArea = Math.max(0, Number(rect?.width) || 0) * Math.max(0, Number(rect?.height) || 0);
    const naturalWidth = Number(media.naturalWidth || media.videoWidth || rect?.width || 0);
    const naturalHeight = Number(media.naturalHeight || media.videoHeight || rect?.height || 0);
    const naturalArea = Math.max(0, naturalWidth) * Math.max(0, naturalHeight);
    return { renderedArea, naturalArea };
}

function isLargeOpeningMedia(media) {
    const { renderedArea, naturalArea } = getMediaArea(media);
    if (naturalArea >= ILLUSTRATION_MIN_NATURAL_AREA) {
        return true;
    }

    const viewportArea = Math.max(1, window.innerWidth || 0) * Math.max(1, window.innerHeight || 0);
    return renderedArea / viewportArea >= ILLUSTRATION_MIN_RENDERED_AREA_RATIO;
}

function scheduleMediaPageLayoutRefresh(doc, media) {
    if (!media || media.__comistreamMediaPageLayoutRefreshBound) {
        return;
    }
    media.__comistreamMediaPageLayoutRefreshBound = true;
    media.addEventListener('load', () => {
        markMediaPageLayout(doc);
        if (view?.renderer) {
            applyRendererPrefs();
        }
    }, { once: true });
}

function markOpeningIllustrationBreak(doc) {
    if (!hasUsableDocumentBody(doc) || isSpecialFrontmatterDoc(doc)) {
        return false;
    }

    const bodyText = getNormalizedBodyText(doc);
    if (bodyText.length === 0) {
        return false;
    }

    const mediaNodes = [...doc.body.querySelectorAll('img, svg, video')];
    if (mediaNodes.length === 0) {
        return false;
    }

    const media = mediaNodes[0];
    if (getNodeTextLengthBefore(doc.body, media) > ILLUSTRATION_MAX_TEXT_BEFORE_CHARS) {
        return false;
    }
    if (!isLargeOpeningMedia(media)) {
        if (media.complete === false) {
            scheduleMediaPageLayoutRefresh(doc, media);
        }
        return false;
    }

    const target = getIllustrationBreakCandidate(media);
    target.setAttribute('data-comistream-illustration-break', '1');
    doc.documentElement.setAttribute('data-comistream-illustration-break-page', '1');
    doc.body.setAttribute('data-comistream-illustration-break-page', '1');
    const pageMetrics = applyIllustrationPageStyles(target, media);
    const spacerCount = insertIllustrationSpacers(target, pageMetrics);
    debugLog('markOpeningIllustrationBreak()', {
        url: doc.URL || '',
        targetTag: target.tagName || '',
        bodyTextLength: bodyText.length,
        mediaArea: getMediaArea(media),
        pageMetrics,
        spacerCount
    });
    return true;
}

function markMediaPageLayout(doc) {
    clearMediaPageMarks(doc);
    if (markImageOnlyPage(doc)) {
        return;
    }
    markOpeningIllustrationBreak(doc);
}

function isMarkedImageOnlyPage(doc) {
    return Boolean(doc?.documentElement?.hasAttribute('data-comistream-image-page'));
}

function getNormalizedBodyText(doc) {
    return String(doc?.body?.textContent || '').replace(/\s+/g, '');
}

function hasEpubTypeToken(element, token) {
    if (!element) {
        return false;
    }
    const raw = String(element.getAttribute('epub:type') || element.getAttribute('type') || '').toLowerCase();
    return raw.split(/\s+/).includes(token);
}

function isSpecialFrontmatterDoc(doc) {
    if (!hasUsableDocumentBody(doc)) {
        return false;
    }
    if (hasEpubTypeToken(doc.body, 'cover')
        || hasEpubTypeToken(doc.body, 'toc')
        || hasEpubTypeToken(doc.body, 'titlepage')
        || hasEpubTypeToken(doc.body, 'index')
        || hasEpubTypeToken(doc.body, 'landmarks')) {
        return true;
    }
    return Boolean(
        doc.querySelector('nav[epub\\:type~="toc"], nav[*|type~="toc"], nav[role="doc-toc"]')
    );
}

function isLayoutRepresentativeDoc(doc) {
    if (!hasUsableDocumentBody(doc)) {
        return false;
    }
    if (isMarkedImageOnlyPage(doc) || isSpecialFrontmatterDoc(doc)) {
        return false;
    }
    const bodyText = getNormalizedBodyText(doc);
    if (bodyText.length < 120) {
        return false;
    }
    return Boolean(doc.body.querySelector('p, section, article, div, h1, h2, h3, li, blockquote'));
}

function updateLayoutDirectionInfo(preferredDoc = null) {
    const candidateDoc = preferredDoc && isLayoutRepresentativeDoc(preferredDoc)
        ? preferredDoc
        : getRendererContents()
            .map((item) => item?.doc)
            .find((doc) => isLayoutRepresentativeDoc(doc));
    if (!candidateDoc) {
        return false;
    }

    const nextDirectionInfo = detectBaseReadingMode(candidateDoc);
    const changed = !layoutDirectionLocked
        || nextDirectionInfo.rtl !== layoutDirectionInfo.rtl
        || nextDirectionInfo.vertical !== layoutDirectionInfo.vertical
        || nextDirectionInfo.explicitRtl !== layoutDirectionInfo.explicitRtl
        || nextDirectionInfo.explicitVertical !== layoutDirectionInfo.explicitVertical;
    layoutDirectionInfo = nextDirectionInfo;
    layoutDirectionLocked = true;
    return changed;
}

function getRendererContents() {
    const contents = view?.renderer?.getContents?.();
    return Array.isArray(contents) ? contents : [];
}

function getRectSummary(rect) {
    if (!rect) {
        return null;
    }
    return {
        x: Math.round(Number(rect.x) || 0),
        y: Math.round(Number(rect.y) || 0),
        width: Math.round(Number(rect.width) || 0),
        height: Math.round(Number(rect.height) || 0)
    };
}

function getRendererShadowElement(id) {
    return view?.renderer?.shadowRoot?.getElementById?.(id) ?? null;
}

function getRendererContainer() {
    return getRendererShadowElement('container');
}

function getDocumentContentSummary(doc) {
    if (!hasUsableDocumentBody(doc)) {
        return {
            usable: false
        };
    }

    const defaultView = doc.defaultView;
    const bodyStyle = defaultView?.getComputedStyle(doc.body);
    const htmlStyle = defaultView?.getComputedStyle(doc.documentElement);
    const mediaNodes = [...doc.body.querySelectorAll('img, svg, video')];
    const firstMedia = mediaNodes[0] ?? null;
    const firstElement = doc.body.querySelector(':scope > :not(script):not(style):not(link):not(meta)');
    const normalizedText = getNormalizedBodyText(doc);

    return {
        usable: true,
        url: doc.URL || '',
        readyState: doc.readyState || '',
        title: doc.title || '',
        textLength: normalizedText.length,
        elementCount: doc.body.childElementCount,
        mediaCount: mediaNodes.length,
        bodyRect: getRectSummary(doc.body.getBoundingClientRect?.()),
        firstElementRect: getRectSummary(firstElement?.getBoundingClientRect?.()),
        firstMedia: firstMedia ? {
            tag: firstMedia.tagName,
            complete: firstMedia.complete ?? null,
            naturalWidth: firstMedia.naturalWidth ?? null,
            naturalHeight: firstMedia.naturalHeight ?? null,
            rect: getRectSummary(firstMedia.getBoundingClientRect?.())
        } : null,
        htmlScroll: {
            width: Math.round(Number(doc.documentElement?.scrollWidth) || 0),
            height: Math.round(Number(doc.documentElement?.scrollHeight) || 0),
            clientWidth: Math.round(Number(doc.documentElement?.clientWidth) || 0),
            clientHeight: Math.round(Number(doc.documentElement?.clientHeight) || 0)
        },
        bodyStyle: bodyStyle ? {
            display: bodyStyle.display,
            visibility: bodyStyle.visibility,
            opacity: bodyStyle.opacity,
            writingMode: bodyStyle.writingMode,
            direction: bodyStyle.direction
        } : null,
        htmlStyle: htmlStyle ? {
            writingMode: htmlStyle.writingMode,
            direction: htmlStyle.direction
        } : null
    };
}

function getRendererDiagnostics(expectedIndex = null) {
    const renderer = view?.renderer ?? null;
    const container = getRendererContainer();
    const containerStyle = container ? getComputedStyle(container) : null;
    const top = getRendererShadowElement('top');
    const background = getRendererShadowElement('background');
    const contents = getRendererContents();

    return {
        expectedIndex,
        initialized: viewInitialized,
        eventSeq: navigationEventSeq,
        location: summarizeLocation(view?.lastLocation || currentLocation),
        renderer: renderer ? {
            tagName: renderer.tagName,
            flow: renderer.getAttribute?.('flow') || '',
            dir: renderer.getAttribute?.('dir') || '',
            vertical: renderer.hasAttribute?.('vertical') ?? false,
            rect: getRectSummary(renderer.getBoundingClientRect?.())
        } : null,
        top: top ? {
            rect: getRectSummary(top.getBoundingClientRect?.())
        } : null,
        container: container ? {
            opacity: containerStyle?.opacity || '',
            visibility: containerStyle?.visibility || '',
            display: containerStyle?.display || '',
            overflow: containerStyle?.overflow || '',
            scrollLeft: Math.round(Number(container.scrollLeft) || 0),
            scrollTop: Math.round(Number(container.scrollTop) || 0),
            childCount: container.children.length,
            rect: getRectSummary(container.getBoundingClientRect?.())
        } : null,
        background: background ? {
            rect: getRectSummary(background.getBoundingClientRect?.()),
            childCount: background.children.length
        } : null,
        contents: contents.map((item) => ({
            index: Number(item?.index),
            expected: Number(item?.index) === expectedIndex,
            ...getDocumentContentSummary(item?.doc ?? item?.document)
        }))
    };
}

function ensureRendererVisible(reason = '') {
    const container = getRendererContainer();
    if (!container) {
        return false;
    }
    const opacity = getComputedStyle(container).opacity;
    const opacityValue = Number(opacity);
    if (opacity === '0' || (Number.isFinite(opacityValue) && opacityValue < 0.99)) {
        container.style.opacity = '1';
        debugLog('ensureRendererVisible() restored hidden renderer container', {
            reason,
            opacity,
            diagnostics: getRendererDiagnostics()
        });
        return true;
    }
    return false;
}

async function stabilizeRendererVisibility(reason = '', expectedIndex = null) {
    let restored = false;
    restored = ensureRendererVisible(`${reason}:immediate`) || restored;
    await waitAnimationFrame();
    restored = ensureRendererVisible(`${reason}:frame-1`) || restored;
    await waitAnimationFrame();
    restored = ensureRendererVisible(`${reason}:frame-2`) || restored;

    if (restored) {
        debugLog('stabilizeRendererVisibility() restored renderer visibility', {
            reason,
            diagnostics: getRendererDiagnostics(expectedIndex)
        });
    }
    return restored;
}

async function refreshNavigationAfterVisibilityRestore(
    targetInfo = null,
    guardSeq = rendererVisibilityGuardSeq,
    reason = '',
    intentSeq = navigationIntentSeq
) {
    if (
        !view
        || rendererRecoveryActive
        || guardSeq !== rendererVisibilityGuardSeq
        || intentSeq !== navigationIntentSeq
    ) {
        return false;
    }

    const normalizedTarget = normalizeNavigationTarget(targetInfo);
    const fallbackCfi = view?.lastLocation?.cfi || currentLocation?.cfi || '';
    const target = normalizedTarget.target ?? fallbackCfi;
    if (target === null || target === '') {
        return false;
    }

    rendererRecoveryActive = true;
    debugLog('refreshNavigationAfterVisibilityRestore() start', {
        reason,
        target,
        expectedIndex: normalizedTarget.expectedIndex,
        diagnostics: getRendererDiagnostics(normalizedTarget.expectedIndex)
    });

    try {
        applyRendererPrefs();
        await waitAnimationFrame();
        if (guardSeq !== rendererVisibilityGuardSeq || intentSeq !== navigationIntentSeq) {
            return false;
        }

        const beforeEventSeq = navigationEventSeq;
        const beforeLocation = summarizeLocation(view?.lastLocation || currentLocation);
        await view.goTo(target);
        if (guardSeq !== rendererVisibilityGuardSeq || intentSeq !== navigationIntentSeq) {
            debugLog('refreshNavigationAfterVisibilityRestore() cancelled after goTo', {
                reason,
                target,
                guardSeq,
                rendererVisibilityGuardSeq,
                intentSeq,
                navigationIntentSeq
            });
            return false;
        }
        const settled = await waitForNavigationSettled(
            beforeEventSeq,
            beforeLocation,
            {
                timeoutMs: NAVIGATION_SETTLE_TIMEOUT_MS,
                expectedIndex: normalizedTarget.expectedIndex
            }
        );
        await stabilizeRendererVisibility('refresh-after-visibility-restore', normalizedTarget.expectedIndex);
        debugLog('refreshNavigationAfterVisibilityRestore() end', {
            reason,
            settled,
            target,
            expectedIndex: normalizedTarget.expectedIndex,
            diagnostics: getRendererDiagnostics(normalizedTarget.expectedIndex)
        });
        return true;
    } catch (error) {
        console.warn('EPUB renderer refresh after visibility restore failed.', error);
        debugLog('refreshNavigationAfterVisibilityRestore() error', {
            reason,
            message: error?.message || String(error),
            diagnostics: getRendererDiagnostics(normalizedTarget.expectedIndex)
        });
        ensureRendererVisible('refresh-after-visibility-restore-error');
        return false;
    } finally {
        rendererRecoveryActive = false;
    }
}

function scheduleNavigationRefreshAfterVisibilityRestore(
    targetInfo = null,
    guardSeq = rendererVisibilityGuardSeq,
    reason = '',
    intentSeq = navigationIntentSeq
) {
    if (
        guardSeq !== rendererVisibilityGuardSeq
        || intentSeq !== navigationIntentSeq
        || rendererRecoveryScheduledSeq === guardSeq
    ) {
        return;
    }
    rendererRecoveryScheduledSeq = guardSeq;
    window.setTimeout(() => {
        if (guardSeq !== rendererVisibilityGuardSeq || intentSeq !== navigationIntentSeq) {
            return;
        }
        void refreshNavigationAfterVisibilityRestore(targetInfo, guardSeq, reason, intentSeq);
    }, 80);
}

function scheduleRendererVisibilityGuard(reason = '', targetInfo = null) {
    const guardSeq = ++rendererVisibilityGuardSeq;
    const intentSeq = navigationIntentSeq;
    const normalizedTarget = normalizeNavigationTarget(targetInfo);
    for (const delayMs of NAVIGATION_VISIBILITY_CHECK_DELAYS_MS) {
        window.setTimeout(() => {
            if (guardSeq !== rendererVisibilityGuardSeq || intentSeq !== navigationIntentSeq) {
                return;
            }
            const restored = ensureRendererVisible(`${reason}:delay-${delayMs}`);
            if (restored) {
                debugLog('scheduleRendererVisibilityGuard() restored delayed renderer visibility', {
                    reason,
                    delayMs,
                    diagnostics: getRendererDiagnostics(normalizedTarget.expectedIndex)
                });
                scheduleNavigationRefreshAfterVisibilityRestore(
                    normalizedTarget,
                    guardSeq,
                    `${reason}:delay-${delayMs}`,
                    intentSeq
                );
            }
        }, delayMs);
    }
}

function getCurrentSectionIndex() {
    const sectionIndex = currentLocation?.section?.current ?? view?.lastLocation?.section?.current;
    return Number.isInteger(sectionIndex) ? sectionIndex : null;
}

function getPreferredContentDoc() {
    const contents = getRendererContents();
    if (contents.length === 0) {
        return null;
    }

    const currentSectionIndex = getCurrentSectionIndex();
    if (currentSectionIndex !== null) {
        const currentContent = contents.find((item) => item?.index === currentSectionIndex);
        if (hasUsableDocumentBody(currentContent?.doc)) {
            return currentContent.doc;
        }
    }

    const firstLoaded = contents.find((item) => hasUsableDocumentBody(item?.doc));
    return firstLoaded?.doc ?? null;
}

function getContentDocForSectionIndex(sectionIndex) {
    if (!Number.isInteger(sectionIndex)) {
        return null;
    }

    const content = getRendererContents()
        .find((item) => Number(item?.index) === sectionIndex);
    return hasUsableDocumentBody(content?.doc) ? content.doc : null;
}

function resetInactivePaginatedScrollAxis(reason = '') {
    if (view?.isFixedLayout || currentFlowMode !== 'paginated') {
        return false;
    }

    const container = getRendererContainer();
    if (!container) {
        return false;
    }

    const currentDoc = getContentDocForSectionIndex(getCurrentSectionIndex())
        || getPreferredContentDoc();
    const renderedMode = detectBaseReadingMode(currentDoc);
    const inactiveProp = renderedMode.vertical ? 'scrollLeft' : 'scrollTop';
    const previousValue = Number(container[inactiveProp]) || 0;
    if (Math.abs(previousValue) < 1) {
        return false;
    }

    // 縦書き本文から横書き挿絵へ移ったとき、使わない軸のスクロールが残ると白画面になるルン。
    container[inactiveProp] = 0;
    debugLog('resetInactivePaginatedScrollAxis() cleared stale scroll axis', {
        reason,
        inactiveProp,
        previousValue: Math.round(previousValue),
        sectionIndex: getCurrentSectionIndex(),
        renderedMode,
        diagnostics: getRendererDiagnostics(getCurrentSectionIndex())
    });
    return true;
}

async function waitForDocumentAssets(doc, timeoutMs = 1600) {
    if (!doc) {
        return;
    }

    const waits = [];
    const fontsReady = doc.fonts?.ready;
    if (fontsReady && typeof fontsReady.then === 'function') {
        waits.push(fontsReady.catch(() => null));
    }

    const images = Array.from(doc.images || [])
        .filter((image) => !image.complete);
    for (const image of images) {
        waits.push(new Promise((resolve) => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
        }));
    }

    if (waits.length === 0) {
        return;
    }

    await Promise.race([
        Promise.allSettled(waits),
        waitTimeout(timeoutMs)
    ]);
}

function isNavigationReady() {
    if (!viewInitialized || !view?.renderer) {
        return false;
    }

    const contents = getRendererContents();
    if (contents.length === 0) {
        return false;
    }

    return contents.some((item) => hasUsableDocumentBody(item?.doc ?? item?.document));
}

function isNavigationReadyForIndex(expectedIndex) {
    if (!Number.isInteger(expectedIndex)) {
        return isNavigationReady();
    }
    if (!viewInitialized || !view?.renderer) {
        return false;
    }

    const contents = getRendererContents();
    return contents.some((item) => {
        const index = Number(item?.index);
        return index === expectedIndex && hasUsableDocumentBody(item?.doc ?? item?.document);
    });
}

async function waitForNavigationReady(timeoutMs = NAVIGATION_READY_TIMEOUT_MS) {
    if (isNavigationReady()) {
        return true;
    }

    const startedAt = Date.now();
    return await new Promise((resolve) => {
        const tick = () => {
            if (isNavigationReady()) {
                resolve(true);
                return;
            }
            if ((Date.now() - startedAt) >= timeoutMs) {
                resolve(false);
                return;
            }
            window.requestAnimationFrame(tick);
        };
        tick();
    });
}

function hasLocationChanged(beforeLocation, afterLocation = summarizeLocation(view?.lastLocation || currentLocation)) {
    if (!beforeLocation || !afterLocation) {
        return false;
    }
    return beforeLocation.cfi !== afterLocation.cfi
        || beforeLocation.section !== afterLocation.section
        || Math.abs(Number(beforeLocation.fraction || 0) - Number(afterLocation.fraction || 0)) > 0.0005;
}

async function waitForNavigationSettled(beforeEventSeq, beforeLocation, timeoutMs = NAVIGATION_SETTLE_TIMEOUT_MS) {
    const options = typeof timeoutMs === 'object' && timeoutMs !== null ? timeoutMs : {};
    const effectiveTimeoutMs = typeof timeoutMs === 'number'
        ? timeoutMs
        : (Number(options.timeoutMs) || NAVIGATION_SETTLE_TIMEOUT_MS);
    const expectedIndex = Number.isInteger(options.expectedIndex) ? options.expectedIndex : null;
    const startedAt = Date.now();
    return await new Promise((resolve) => {
        const tick = () => {
            const eventAdvanced = navigationEventSeq > beforeEventSeq;
            const locationChanged = hasLocationChanged(beforeLocation);
            const targetReady = expectedIndex === null
                ? isNavigationReady()
                : isNavigationReadyForIndex(expectedIndex);
            if ((eventAdvanced || locationChanged) && targetReady) {
                resolve(true);
                return;
            }
            if ((Date.now() - startedAt) >= effectiveTimeoutMs) {
                resolve(false);
                return;
            }
            window.requestAnimationFrame(tick);
        };
        tick();
    });
}

function normalizeNavigationTarget(result) {
    if (typeof result === 'string' && result !== '') {
        return {
            target: result,
            expectedIndex: resolveNavigationIndex(result)
        };
    }
    if (Number.isInteger(result)) {
        return {
            target: result,
            expectedIndex: result
        };
    }
    if (result && typeof result === 'object') {
        const target = result.target ?? result.href ?? result.cfi ?? result.index ?? null;
        const expectedIndex = Number.isInteger(result.expectedIndex)
            ? result.expectedIndex
            : (Number.isInteger(result.index) ? result.index : resolveNavigationIndex(target));
        return { target, expectedIndex };
    }
    return {
        target: null,
        expectedIndex: null
    };
}

async function recoverNavigationRender(targetInfo = null) {
    const normalizedTarget = normalizeNavigationTarget(targetInfo);
    const fallbackCfi = view?.lastLocation?.cfi || currentLocation?.cfi || '';
    const target = normalizedTarget.target ?? fallbackCfi;
    if (!view || target === null || target === '') {
        return false;
    }

        debugLog('recoverNavigationRender() start', {
            target,
            expectedIndex: normalizedTarget.expectedIndex,
            eventSeq: navigationEventSeq,
            location: summarizeLocation(view?.lastLocation || currentLocation),
            diagnostics: getRendererDiagnostics(normalizedTarget.expectedIndex)
        });

    try {
        applyRendererPrefs();
        const beforeEventSeq = navigationEventSeq;
        await view.goTo(target);
        const recovered = await waitForNavigationSettled(
            beforeEventSeq,
            summarizeLocation(currentLocation),
            {
                timeoutMs: NAVIGATION_SETTLE_TIMEOUT_MS,
                expectedIndex: normalizedTarget.expectedIndex
            }
        );
        debugLog('recoverNavigationRender() end', {
            recovered,
            eventSeq: navigationEventSeq,
            location: summarizeLocation(view?.lastLocation || currentLocation),
            diagnostics: getRendererDiagnostics(normalizedTarget.expectedIndex)
        });
        await stabilizeRendererVisibility('recover-navigation-render', normalizedTarget.expectedIndex);
        return recovered || await waitForNavigationReady();
    } catch (error) {
        console.warn('EPUB navigation recovery failed.', error);
        debugLog('recoverNavigationRender() error', {
            message: error?.message || String(error)
        });
        return false;
    }
}

function updateNavigationMode() {
    const fixedLayout = isFixedLayoutBook();
    document.body.classList.toggle('epub-fixed-layout', fixedLayout);
    document.body.classList.toggle('epub-reflowable-layout', !fixedLayout);

    for (const id of ['epub-nav-left', 'epub-nav-right']) {
        const button = $(id);
        if (!button) {
            continue;
        }
        button.hidden = !fixedLayout;
        button.disabled = !fixedLayout;
        button.tabIndex = fixedLayout ? 0 : -1;
        button.setAttribute('aria-hidden', fixedLayout ? 'false' : 'true');
    }
}

function updateDirectionState() {
    refreshReadingModeInfo();
    const directionValue = $('epub-direction-value');
    const writingModeValue = $('epub-writing-mode-value');
    const progress = $('progress');
    const slider = $('epub-slider');
    const navigationIsRtl = getNavigationIsRtl();

    if (directionValue) {
        directionValue.textContent = formatDirectionLabel();
    }
    if (writingModeValue) {
        writingModeValue.textContent = formatWritingModeLabel();
    }
    updateSegmentedButtons('[data-epub-direction-option]', currentDirectionOverride);
    updateSegmentedButtons('[data-epub-writing-option]', currentWritingModeOverride);
    if (progress) {
        progress.className = navigationIsRtl ? 'progress-left' : 'progress-right';
    }
    if (slider) {
        slider.style.transform = navigationIsRtl ? 'rotateY(180deg)' : 'rotateY(0deg)';
    }
    updateNavigationButtonOrder(navigationIsRtl);
}

function updateSegmentedButtons(selector, selectedValue) {
    for (const button of document.querySelectorAll(selector)) {
        const selected = button.dataset.epubDirectionOption === selectedValue
            || button.dataset.epubWritingOption === selectedValue;
        button.classList.toggle('pressed', selected);
        button.setAttribute('aria-checked', selected ? 'true' : 'false');
    }
}

function updateNavigationButtonOrder(navigationIsRtl) {
    const toolbar = document.querySelector('.epub-toolbar');
    if (!toolbar) {
        return;
    }

    const prevPage = $('epub-prev-page');
    const nextPage = $('epub-next-page');
    if (prevPage?.parentElement === toolbar && nextPage?.parentElement === toolbar) {
        toolbar.insertBefore(navigationIsRtl ? prevPage : nextPage, navigationIsRtl ? nextPage : prevPage);
    }

    const prevSection = $('epub-prev-section');
    const nextSection = $('epub-next-section');
    if (prevSection?.parentElement === toolbar && nextSection?.parentElement === toolbar) {
        toolbar.insertBefore(
            navigationIsRtl ? prevSection : nextSection,
            navigationIsRtl ? nextSection : prevSection
        );
    }
}

function getBookSectionCount() {
    return Array.isArray(view?.book?.sections) ? view.book.sections.length : 0;
}

function getLocationSectionIndex(location = currentLocation) {
    const sectionIndex = Number(location?.section?.current);
    if (Number.isInteger(sectionIndex)) {
        return sectionIndex;
    }
    const index = Number(location?.index);
    if (Number.isInteger(index)) {
        return index;
    }
    const currentIndex = getCurrentNavigationIndex();
    return Number.isInteger(currentIndex) ? currentIndex : 0;
}

function getLocationProgressMetrics(location = currentLocation) {
    if (!view?.isFixedLayout) {
        const sectionTotal = Math.max(1, getBookSectionCount());
        const sectionIndex = clamp(
            getLocationSectionIndex(location),
            0,
            Math.max(0, sectionTotal - 1)
        );
        const sectionFraction = clamp(Number(location?.sectionFraction) || 0, 0, 1);
        const progressRatio = sectionTotal > 1
            ? clamp((sectionIndex + sectionFraction) / sectionTotal, 0, 1)
            : 0;
        const currentPage = clamp(sectionIndex + 1, 1, sectionTotal);

        return {
            fraction: progressRatio,
            currentPage,
            totalPages: sectionTotal,
            sliderMin: 1,
            sliderMax: sectionTotal,
            sliderValue: currentPage,
            progressRatio,
            statusProgressText: `${currentPage}/${sectionTotal}`
        };
    }

    const fraction = clamp(Number(location?.fraction) || 0, 0, 1);
    const totalLocations = Math.max(0, Number(location?.location?.total) || 0);
    const displayTotal = Math.max(1, totalLocations || SLIDER_MAX);
    const currentPage = clamp(
        Math.floor(fraction * Math.max(1, displayTotal)) + 1,
        1,
        displayTotal
    );

    return {
        fraction,
        currentPage,
        totalPages: displayTotal,
        sliderMin: 1,
        sliderMax: displayTotal,
        sliderValue: currentPage,
        progressRatio: fraction,
        statusProgressText: `${currentPage}/${displayTotal}`
    };
}

function updateProgressUI(location = currentLocation) {
    const metrics = getLocationProgressMetrics(location);
    const progress = $('progress');
    const slider = $('epub-slider');
    const sliderValue = $('epub-slider-value');
    const chapter = location?.tocItem?.label || '';

    if (progress) {
        progress.style.width = `${Math.round(metrics.progressRatio * 100)}%`;
    }
    if (slider && !sliderDragActive) {
        slider.min = String(metrics.sliderMin);
        slider.max = String(metrics.sliderMax);
        slider.step = '1';
        slider.value = String(metrics.sliderValue);
    }
    if (sliderValue) {
        sliderValue.textContent = String(metrics.sliderValue);
    }

    const progressText = chapter
        ? `${metrics.statusProgressText} - ${chapter}`
        : metrics.statusProgressText;
    setStatusText(progressText);
}

async function reconcileCurrentLocationProgressFromCfi(reason = 'unknown', sourceCfi = null) {
    const location = currentLocation || view?.lastLocation;
    const cfi = typeof sourceCfi === 'string' && sourceCfi !== ''
        ? sourceCfi
        : (typeof location?.cfi === 'string' ? location.cfi : '');
    if (!view || cfi === '' || typeof view.getCFIProgress !== 'function') {
        return false;
    }

    try {
        const sourceIndex = resolveNavigationIndex(cfi);
        const cfiProgress = await view.getCFIProgress(cfi);
        const latestLocation = currentLocation || view?.lastLocation || location;
        const latestCfi = typeof latestLocation?.cfi === 'string' ? latestLocation.cfi : '';
        if (sourceCfi === null && latestCfi !== cfi) {
            return false;
        }

        let progress = cfiProgress && typeof cfiProgress === 'object' ? cfiProgress : null;
        const progressFraction = Number(progress?.fraction);
        const progressSection = Number(progress?.section?.current);
        const progressTotalLocations = Number(progress?.location?.total);
        const sectionCount = Array.isArray(view?.book?.sections) ? view.book.sections.length : 0;
        if (
            !Number.isFinite(progressFraction)
            || !Number.isInteger(progressSection)
            || (sectionCount > 1 && (!Number.isFinite(progressTotalLocations) || progressTotalLocations < sectionCount))
        ) {
            progress = Number.isInteger(sourceIndex)
                ? getSectionProgressFallback(sourceIndex, 0, 0)
                : null;
        }
        if (!progress) {
            return false;
        }

        const expectedIndex = Number.isInteger(sourceIndex)
            ? sourceIndex
            : Number(progress?.section?.current);
        const tocItem = findTocItemForNavigationTarget(
            { target: cfi, expectedIndex },
            expectedIndex
        );
        const canReuseLatestRange = latestCfi === cfi;
        const mergedLocation = {
            ...latestLocation,
            ...progress,
            tocItem: tocItem ?? latestLocation?.tocItem ?? null,
            pageItem: latestLocation?.pageItem ?? null,
            cfi,
            range: canReuseLatestRange ? (latestLocation?.range ?? null) : null
        };

        currentLocation = mergedLocation;
        view.lastLocation = mergedLocation;
        if (sourceCfi !== null && initialRestoreReconcileUntil > Date.now() && cfi === initialRestoreCfi) {
            initialRestorePinnedLocation = mergedLocation;
        }
        updateProgressUI(currentLocation);
        renderInspector();
        debugLog('reconcileCurrentLocationProgressFromCfi() updated location progress', {
            reason,
            sourceIndex,
            usedFallback: progress !== cfiProgress,
            location: summarizeLocation(currentLocation)
        });
        traceRestore('reconciled progress from CFI', {
            reason,
            sourceCfi: cfi,
            sourceIndex,
            usedFallback: progress !== cfiProgress,
            before: summarizeLocation(latestLocation),
            after: summarizeLocation(currentLocation),
            metrics: getLocationProgressMetrics(currentLocation)
        });
        return true;
    } catch (error) {
        debugLog('reconcileCurrentLocationProgressFromCfi() failed', {
            reason,
            message: error?.message || String(error)
        });
        return false;
    }
}

function applyRelocateSideEffects({ immediateSave = false } = {}) {
    if (!currentLocation) {
        return;
    }

    resetInactivePaginatedScrollAxis('relocate-side-effects');
    persistCurrentLocation();
    scheduleProgressSave({ immediate: immediateSave });
    updateProgressUI(currentLocation);
    refreshReadingModeInfo();
    const layoutChanged = updateLayoutDirectionInfo(getPreferredContentDoc());
    if (layoutChanged) {
        applyRendererPrefs();
    }
    updateDirectionState();
    renderInspector();
}

function scheduleRelocateSideEffects({ immediateSave = false } = {}) {
    relocateSideEffectsImmediateSave = relocateSideEffectsImmediateSave || immediateSave;
    if (relocateSideEffectsFrame !== null) {
        return;
    }

    relocateSideEffectsFrame = window.requestAnimationFrame(() => {
        relocateSideEffectsFrame = null;
        const shouldSaveImmediately = relocateSideEffectsImmediateSave;
        relocateSideEffectsImmediateSave = false;
        const restoreCfi = initialRestoreReconcileUntil > Date.now() ? initialRestoreCfi : '';
        if (restoreCfi !== '') {
            void reconcileCurrentLocationProgressFromCfi('initial-restore-relocate', restoreCfi)
                .finally(() => {
                    applyRelocateSideEffects({ immediateSave: shouldSaveImmediately });
                });
            return;
        }
        applyRelocateSideEffects({ immediateSave: shouldSaveImmediately });
    });
}

function clearInitialRestorePin() {
    initialRestoreCfi = '';
    initialRestoreReconcileUntil = 0;
    initialRestorePinnedLocation = null;
}

async function reapplyInitialRestoreTarget(target, reason) {
    if (!target || !view) {
        return false;
    }
    try {
        await view.goTo(target);
        await waitForNavigationReady();
        await waitForDocumentAssets(getPreferredContentDoc());
        await waitAnimationFrame();
        await waitAnimationFrame();
        await view.goTo(target);
        traceRestore('re-applied initial CFI', {
            reason,
            storedLocation: target,
            lastLocation: summarizeLocation(view?.lastLocation)
        });
        return true;
    } catch (error) {
        debugLog('reapplyInitialRestoreTarget() failed', {
            reason,
            message: error?.message || String(error),
            storedLocation: target
        });
        return false;
    }
}

function updateToolbarState() {
    const fontLabel = $('epub-font-value');
    const flowLabel = $('epub-flow-value');
    const flowToggle = $('epub-flow-toggle');
    const fontMinus = $('epub-font-minus');
    const fontPlus = $('epub-font-plus');
    const paperThemeButton = $('epub-theme-paper');
    const whiteThemeButton = $('epub-theme-white');
    const darkThemeButton = $('epub-theme-dark');
    const systemThemeButton = $('epub-theme-system');
    const isFixedLayout = Boolean(view?.isFixedLayout);
    const flowLabelText = currentFlowMode === 'scrolled'
        ? t('epub_flow_scrolled', 'Scroll')
        : t('epub_flow_paginated', 'Page');

    if (fontLabel) {
        fontLabel.textContent = `${Math.round(currentFontScale * 100)}%`;
    }
    if (flowLabel) {
        flowLabel.textContent = flowLabelText;
    }
    if (flowToggle) {
        flowToggle.textContent = flowLabelText;
        flowToggle.classList.toggle('pressed', currentFlowMode === 'scrolled');
    }
    if (fontMinus) {
        fontMinus.disabled = isFixedLayout;
    }
    if (fontPlus) {
        fontPlus.disabled = isFixedLayout;
    }
    if (paperThemeButton) {
        paperThemeButton.classList.toggle('pressed', currentTheme === 'paper');
        paperThemeButton.setAttribute('aria-pressed', currentTheme === 'paper' ? 'true' : 'false');
    }
    if (whiteThemeButton) {
        whiteThemeButton.classList.toggle('pressed', currentTheme === 'white');
        whiteThemeButton.setAttribute('aria-pressed', currentTheme === 'white' ? 'true' : 'false');
    }
    if (darkThemeButton) {
        darkThemeButton.classList.toggle('pressed', currentTheme === 'dark');
        darkThemeButton.setAttribute('aria-pressed', currentTheme === 'dark' ? 'true' : 'false');
    }
    if (systemThemeButton) {
        systemThemeButton.classList.toggle('pressed', currentTheme === THEME_OPTION_SYSTEM);
        systemThemeButton.setAttribute('aria-pressed', currentTheme === THEME_OPTION_SYSTEM ? 'true' : 'false');
    }

    updateDirectionState();
}

function applyRendererPrefs() {
    applyShellTheme();
    if (!view?.renderer) {
        updateToolbarState();
        return;
    }
    const disableSectionPreload = !view.isFixedLayout && currentFlowMode === 'paginated';
    let layout = null;
    let effectiveLayout = null;
    let viewportWidth = 0;
    let viewportHeight = 0;
    if (!view.isFixedLayout) {
        effectiveLayout = resolveEffectiveLayoutMode();
        ({ width: viewportWidth, height: viewportHeight } = getViewportSize());
        layout = calculateColumnLayout(
            viewportWidth,
            viewportHeight,
            effectiveLayout.vertical,
            getEffectiveFontSizePx(currentFontScale)
        );
    }
    const prefsSignature = buildRendererPrefsSignature({
        disableSectionPreload,
        layout
    });
    if (prefsSignature === lastRendererPrefsSignature) {
        debugLog('applyRendererPrefs() skipped unchanged prefs', {
            flow: currentFlowMode,
            isFixedLayout: Boolean(view.isFixedLayout),
            layout
        });
        updateToolbarState();
        return;
    }
    lastRendererPrefsSignature = prefsSignature;
    const css = buildReaderCSS(currentFontScale);

    if (typeof view.renderer.toggleAttribute === 'function') {
        // paginated + multi-section preload は section を跨いだ primary 判定が不安定になりやすいルン。
        // 安定動作を優先して、ページ送り中は現在 section ベースの遷移だけに絞るルン。
        view.renderer.toggleAttribute('no-preload', disableSectionPreload);
        debugLog('applyRendererPrefs() preload mode', {
            flow: currentFlowMode,
            isFixedLayout: Boolean(view.isFixedLayout),
            noPreload: disableSectionPreload
        });
    }
    if (!view.isFixedLayout) {
        setRendererAttribute('gap', '7%');
        setRendererAttribute('margin-top', `${layout.marginPx}px`);
        setRendererAttribute('margin-right', `${layout.marginPx}px`);
        setRendererAttribute('margin-bottom', `${layout.marginPx}px`);
        setRendererAttribute('margin-left', `${layout.marginPx}px`);
        setRendererAttribute('max-inline-size', layout.maxInlineSize);
        setRendererAttribute('max-block-size', layout.maxBlockSize);
        setRendererAttribute('max-column-count', layout.maxColumnCount);
        debugLog('applyRendererPrefs() layout', {
            viewportWidth,
            viewportHeight,
            effectiveLayout,
            effectiveFontSize: getEffectiveFontSizePx(currentFontScale),
            layout,
            fontScaleSource: currentFontScaleSource
        });
    }
    view.renderer.setStyles?.(css);
    view.renderer.setAttribute('flow', currentFlowMode);
    updateToolbarState();
}

function applyInitialFontScaleCorrection(preferredDoc = null) {
    if (hasStoredFontScale || hasAdjustedInitialFontScale || view?.isFixedLayout) {
        return;
    }
    const layoutChanged = updateLayoutDirectionInfo(preferredDoc);
    if (!layoutDirectionLocked && !layoutChanged) {
        return;
    }

    const actualVertical = resolveEffectiveLayoutMode().vertical;
    const recalculatedScale = calculateInitialFontScale(actualVertical);
    if (Math.abs(recalculatedScale - currentFontScale) > 0.05) {
        currentFontScale = recalculatedScale;
        currentFontScaleSource = FONT_SCALE_SOURCE_AUTO;
        applyRendererPrefs();
    }
    hasAdjustedInitialFontScale = true;
    saveViewerPrefs();
}

async function applyLayoutOverride() {
    applyRendererPrefs();
    saveViewerPrefs();
    if (currentLocation?.cfi) {
        await view.goTo(currentLocation.cfi);
        updateDirectionState();
        return {
            target: currentLocation.cfi,
            expectedIndex: getCurrentSectionIndex()
        };
    }
    updateDirectionState();
    return null;
}

function toggleMenu(forceVisible = null) {
    const next = forceVisible === null ? !menuVisible : Boolean(forceVisible);
    menuVisible = next;
    const panel = $('epub-menu-panel');
    if (panel) {
        panel.style.display = menuVisible ? 'block' : 'none';
    }

    const dropdown = document.querySelector('.lang-dropdown');
    if (!menuVisible && dropdown) {
        dropdown.classList.remove('show');
    }

    if (!menuVisible) {
        focusReader();
    }
}

function openMenu() {
    toggleMenu(true);
}

function closeMenu() {
    toggleMenu(false);
}

async function goPreviousPage() {
    if (!view || !await waitForNavigationReady()) {
        debugLog('goPreviousPage() skipped', {
            hasView: Boolean(view),
            navigationReady: isNavigationReady()
        });
        return;
    }
    const beforeLocation = summarizeLocation();
    debugLog('goPreviousPage() start', beforeLocation);
    await view.prev();
    const afterLocation = summarizeLocation(view?.lastLocation || currentLocation);
    const didMove = beforeLocation.cfi !== afterLocation.cfi
        || beforeLocation.section !== afterLocation.section
        || Math.abs(beforeLocation.fraction - afterLocation.fraction) > 0.0005;
    const expectedPreviousIndex = getAdjacentLinearSectionIndex(true, getLocationSectionIndexOrNull(beforeLocation));
    if (
        expectedPreviousIndex !== null
        && afterLocation.section !== beforeLocation.section
        && afterLocation.section !== expectedPreviousIndex
    ) {
        debugLog('goPreviousPage() corrected skipped spine section', {
            beforeLocation,
            afterLocation,
            expectedPreviousIndex
        });
        return await goToSpineSection(expectedPreviousIndex, true);
    }
    if (!didMove && beforeLocation.fraction <= 0.02) {
        debugLog('goPreviousPage() fallback to previous section', {
            beforeLocation,
            afterLocation
        });
        return await goToAdjacentSpineSection(true, getLocationSectionIndexOrNull(beforeLocation));
    }
    return null;
}

async function goNextPage() {
    if (!view || !await waitForNavigationReady()) {
        debugLog('goNextPage() skipped', {
            hasView: Boolean(view),
            navigationReady: isNavigationReady()
        });
        return;
    }
    const beforeLocation = summarizeLocation();
    debugLog('goNextPage() start', beforeLocation);
    await view.next();
    const afterLocation = summarizeLocation(view?.lastLocation || currentLocation);
    const didMove = beforeLocation.cfi !== afterLocation.cfi
        || beforeLocation.section !== afterLocation.section
        || Math.abs(beforeLocation.fraction - afterLocation.fraction) > 0.0005;
    const expectedNextIndex = getAdjacentLinearSectionIndex(false, getLocationSectionIndexOrNull(beforeLocation));
    if (
        expectedNextIndex !== null
        && afterLocation.section !== beforeLocation.section
        && afterLocation.section !== expectedNextIndex
    ) {
        debugLog('goNextPage() corrected skipped spine section', {
            beforeLocation,
            afterLocation,
            expectedNextIndex
        });
        return await goToSpineSection(expectedNextIndex, false);
    }
    if (!didMove && beforeLocation.fraction >= 0.98) {
        debugLog('goNextPage() fallback to next section', {
            beforeLocation,
            afterLocation
        });
        return await goToAdjacentSpineSection(false, getLocationSectionIndexOrNull(beforeLocation));
    }
    return null;
}

async function goPhysicalLeft() {
    const rtl = getNavigationIsRtl();
    debugLog('goPhysicalLeft()', {
        rtl,
        location: summarizeLocation()
    });
    if (rtl) {
        return await goNextPage();
    } else {
        return await goPreviousPage();
    }
}

async function goPhysicalRight() {
    const rtl = getNavigationIsRtl();
    debugLog('goPhysicalRight()', {
        rtl,
        location: summarizeLocation()
    });
    if (rtl) {
        return await goPreviousPage();
    } else {
        return await goNextPage();
    }
}

function renderInspector(error = null, fallbackState = null) {
    const inspector = $('inspector');
    if (!inspector) {
        return;
    }
    inspector.textContent = '';

    const list = document.createElement('ul');
    const metadata = view?.book?.metadata || {};
    const packageBaseForInspector = epubPackageBase || epubUrl || '';
    const signatureExpiration = extractSignatureExpiration(packageBaseForInspector);
    const state = fallbackState || getStoredState();
    const location = currentLocation || state || {};
    const sectionCurrent = Number(location?.section?.current ?? state?.section ?? 0);
    const sectionTotal = Number(location?.section?.total ?? view?.book?.sections?.length ?? 0);

    const appendItem = (label, value) => {
        const item = document.createElement('li');
        item.textContent = `${label}: ${value}`;
        list.appendChild(item);
    };

    appendItem(t('epub_inspector_title', 'Title'), normalizeMetadataValue(metadata.title) || document.title);
    appendItem(t('epub_inspector_author', 'Author'), normalizeMetadataValue(metadata.author));
    appendItem(
        t('epub_inspector_language', 'Language'),
        normalizeMetadataValue(metadata.language || view?.language?.canonical || view?.language?.locale?.baseName)
    );
    appendItem(t('epub_inspector_progress', 'Progress'), formatPercent(location?.fraction ?? 0));
    appendItem(
        t('epub_inspector_fraction', 'Fraction'),
        String(Math.round(clamp(Number(location?.fraction) || 0, 0, 1) * 1000) / 1000)
    );
    appendItem(
        t('epub_inspector_section', 'Section'),
        sectionTotal > 0 ? `${sectionCurrent + 1} / ${sectionTotal}` : t('epub_unknown', 'Unknown')
    );
    appendItem(t('epub_direction', 'Direction'), currentDirectionInfo.rtl
        ? t('epub_direction_rtl', 'Right-to-Left')
        : t('epub_direction_ltr', 'Left-to-Right'));
    appendItem(t('epub_writing_mode', 'Writing'), currentDirectionInfo.vertical
        ? t('epub_writing_vertical', 'Vertical')
        : t('epub_writing_horizontal', 'Horizontal'));
    appendItem(t('epub_override', 'Override'), `${formatDirectionLabel()} / ${formatWritingModeLabel()}`);
    appendItem(t('epub_inspector_cfi', 'CFI'), String(location?.cfi || state?.cfi || t('epub_unknown', 'Unknown')));
    appendItem(
        t('epub_inspector_renderer', 'Renderer'),
        view?.isFixedLayout ? 'foliate-fxl' : `foliate-paginator (${currentFlowMode})`
    );
    appendItem(
        t('epub_inspector_package_base', 'Package Base'),
        packageBaseForInspector || t('epub_unknown', 'Unknown')
    );
    appendItem(
        t('epub_inspector_signature_expiration', 'Signature Expiration'),
        signatureExpiration > 0 ? formatDateTime(signatureExpiration) : t('epub_unknown', 'Unknown')
    );
    appendItem(
        t('epub_inspector_last_saved', 'Last Saved'),
        state?.updatedAt ? formatDateTime(Number(state.updatedAt)) : t('epub_unknown', 'Unknown')
    );

    if (error?.message) {
        appendItem(t('epub_load_failed', 'Failed to load EPUB'), error.message);
    }

    inspector.appendChild(list);
}

function toggleInspector(forceVisible = null, error = null, fallbackState = null) {
    const inspector = $('inspector');
    const toggle = $('inspectorToggleButton');
    if (!inspector) {
        return;
    }
    const isOpen = inspector.style.display === 'block';
    const next = forceVisible === null ? !isOpen : Boolean(forceVisible);

    if (!next) {
        inspector.style.opacity = '0';
        if (toggle) {
            toggle.classList.remove('pressed');
        }
        window.setTimeout(() => {
            inspector.style.display = 'none';
            inspector.textContent = '';
        }, 150);
        return;
    }

    renderInspector(error, fallbackState);
    inspector.style.opacity = '0';
    inspector.style.display = 'block';
    if (toggle) {
        toggle.classList.add('pressed');
    }
    window.setTimeout(() => {
        inspector.style.opacity = '1';
    }, 50);
}

function updateFullScreenButton() {
    const fullScreenButton = $('fullScreenButton');
    if (!fullScreenButton) {
        return;
    }
    const isFullscreen = Boolean(
        document.fullscreenElement
        || document.mozFullScreenElement
        || document.webkitFullscreenElement
        || document.msFullscreenElement
    );

    fullScreenButton.textContent = isFullscreen
        ? t('fullscreen', 'Fullscreen')
        : t('windowed', 'Windowed');
    fullScreenButton.classList.toggle('pressed', isFullscreen);
}

function toggleFullScreen() {
    if (
        document.fullscreenElement
        || document.mozFullScreenElement
        || document.webkitFullscreenElement
        || document.msFullscreenElement
    ) {
        exitFullScreenIfNeeded();
        return;
    }

    const target = document.documentElement;
    if (target.webkitRequestFullscreen) {
        target.webkitRequestFullscreen();
    } else if (target.mozRequestFullScreen) {
        target.mozRequestFullScreen();
    } else if (target.requestFullscreen) {
        target.requestFullscreen();
    } else if (target.msRequestFullscreen) {
        target.msRequestFullscreen();
    } else {
        alert(t('fullscreen_not_supported', 'Fullscreen not supported'));
    }
}

function updateClock() {
    const clock = $('clock');
    if (!clock) {
        return;
    }
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    clock.textContent = `${hours}:${minutes}`;
}

function toggleClock(forceVisible = null) {
    const clock = $('clock');
    const clockButton = $('clockToggleButton');
    if (!clock || !clockButton) {
        return;
    }

    const shouldShow = forceVisible === null
        ? clock.classList.contains('clock-hidden')
        : Boolean(forceVisible);

    if (shouldShow) {
        clock.classList.remove('clock-hidden');
        clockButton.classList.add('pressed');
        localStorage.setItem(CLOCK_DISPLAY_KEY, 'show');
        updateClock();
        if (clockTimer) {
            window.clearInterval(clockTimer);
        }
        clockTimer = window.setInterval(updateClock, 1000);
    } else {
        clock.classList.add('clock-hidden');
        clockButton.classList.remove('pressed');
        localStorage.setItem(CLOCK_DISPLAY_KEY, 'hide');
        if (clockTimer) {
            window.clearInterval(clockTimer);
            clockTimer = null;
        }
    }
}

function restoreClockPreference() {
    if (localStorage.getItem(CLOCK_DISPLAY_KEY) === 'show') {
        toggleClock(true);
    }
}

function parseTapZone(clientX) {
    const width = window.innerWidth || document.documentElement.clientWidth || 1;
    const ratio = clientX / width;
    if (ratio < (1 / 3)) {
        return 'left';
    }
    if (ratio > (2 / 3)) {
        return 'right';
    }
    return 'center';
}

function isTapEligibleTarget(target) {
    const element = target?.nodeType === Node.TEXT_NODE ? target.parentElement : target;
    if (!element || typeof element.closest !== 'function') {
        return true;
    }
    return !element.closest('a, button, input, textarea, select, label, summary, [role="button"], [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]');
}

function setupTapNavigation(doc) {
    if (!doc || doc.__comistreamTapNavigationBound) {
        return;
    }
    doc.__comistreamTapNavigationBound = true;

    let pointerState = null;
    let scrolledTouchState = null;

    doc.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
            pointerState = null;
            return;
        }
        if (!isTapEligibleTarget(event.target)) {
            pointerState = null;
            return;
        }
        pointerState = {
            x: event.clientX,
            y: event.clientY,
            startedAt: Date.now(),
            pointerId: event.pointerId,
            cancelled: false
        };
    }, { passive: true });

    doc.addEventListener('pointermove', (event) => {
        if (!pointerState || event.pointerId !== pointerState.pointerId) {
            return;
        }
        const dx = event.clientX - pointerState.x;
        const dy = event.clientY - pointerState.y;
        if (Math.hypot(dx, dy) > TAP_MAX_DISTANCE_PX) {
            pointerState.cancelled = true;
        }
    }, { passive: true });

    doc.addEventListener('pointercancel', (event) => {
        if (pointerState && event.pointerId === pointerState.pointerId) {
            pointerState = null;
        }
    }, { passive: true });

    doc.addEventListener('selectionchange', () => {
        if (!pointerState) {
            if (scrolledTouchState) {
                const selection = doc.getSelection();
                if (selection && !selection.isCollapsed) {
                    scrolledTouchState.cancelled = true;
                }
            }
            return;
        }
        const selection = doc.getSelection();
        if (selection && !selection.isCollapsed) {
            pointerState.cancelled = true;
            if (scrolledTouchState) {
                scrolledTouchState.cancelled = true;
            }
        }
    });

    doc.addEventListener('pointerup', (event) => {
        if (!pointerState) {
            return;
        }
        if (event.pointerId !== pointerState.pointerId) {
            return;
        }
        const dx = event.clientX - pointerState.x;
        const dy = event.clientY - pointerState.y;
        const distance = Math.hypot(dx, dy);
        const duration = Date.now() - pointerState.startedAt;
        const wasCancelled = pointerState.cancelled;
        pointerState = null;

        if (wasCancelled || distance > TAP_MAX_DISTANCE_PX || duration > TAP_MAX_DURATION_MS) {
            return;
        }
        const selection = doc.getSelection();
        if (selection && !selection.isCollapsed) {
            return;
        }

        const zone = parseTapZone(event.clientX);
        if (zone === 'left') {
            void navigate(() => goPhysicalLeft());
        } else if (zone === 'right') {
            void navigate(() => goPhysicalRight());
        } else {
            openMenu();
        }
    }, { passive: true });

    doc.addEventListener('touchstart', (event) => {
        if (currentFlowMode !== 'scrolled' || event.touches.length !== 1) {
            scrolledTouchState = null;
            return;
        }
        if (!isTapEligibleTarget(event.target)) {
            scrolledTouchState = null;
            return;
        }

        const touch = event.changedTouches[0];
        if (!touch || parseTapZone(touch.clientX) !== 'center') {
            scrolledTouchState = null;
            return;
        }

        scrolledTouchState = {
            x: touch.clientX,
            y: touch.clientY,
            identifier: touch.identifier,
            startedAt: Date.now(),
            cancelled: false
        };
    }, { passive: true });

    doc.addEventListener('touchmove', (event) => {
        if (!scrolledTouchState) {
            return;
        }

        const touch = Array.from(event.changedTouches).find((item) => item.identifier === scrolledTouchState.identifier);
        if (!touch) {
            return;
        }

        const dx = touch.clientX - scrolledTouchState.x;
        const dy = touch.clientY - scrolledTouchState.y;
        if (Math.hypot(dx, dy) > SCROLLED_CENTER_TAP_MAX_DISTANCE_PX) {
            scrolledTouchState.cancelled = true;
        }
    }, { passive: true });

    doc.addEventListener('touchcancel', (event) => {
        if (!scrolledTouchState) {
            return;
        }
        const touch = Array.from(event.changedTouches).find((item) => item.identifier === scrolledTouchState.identifier);
        if (touch) {
            scrolledTouchState = null;
        }
    }, { passive: true });

    doc.addEventListener('touchend', (event) => {
        if (!scrolledTouchState) {
            return;
        }

        const touch = Array.from(event.changedTouches).find((item) => item.identifier === scrolledTouchState.identifier);
        if (!touch) {
            return;
        }

        const dx = touch.clientX - scrolledTouchState.x;
        const dy = touch.clientY - scrolledTouchState.y;
        const distance = Math.hypot(dx, dy);
        const duration = Date.now() - scrolledTouchState.startedAt;
        const wasCancelled = scrolledTouchState.cancelled;
        scrolledTouchState = null;

        if (
            currentFlowMode !== 'scrolled'
            || wasCancelled
            || distance > SCROLLED_CENTER_TAP_MAX_DISTANCE_PX
            || duration > SCROLLED_CENTER_TAP_MAX_DURATION_MS
            || parseTapZone(touch.clientX) !== 'center'
        ) {
            return;
        }

        const selection = doc.getSelection();
        if (selection && !selection.isCollapsed) {
            return;
        }

        // iOS Safari のスクロール可能 iframe でも中央タップでメニューを開けるようにするルン。
        openMenu();
    }, { passive: true });
}

function setupViewerFallbackTapNavigation(viewer) {
    if (!viewer || viewer.__comistreamFallbackTapNavigationBound) {
        return;
    }
    viewer.__comistreamFallbackTapNavigationBound = true;

    let pointerState = null;

    viewer.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
            pointerState = null;
            return;
        }
        if (isNavigationReady() || !isTapEligibleTarget(event.target)) {
            pointerState = null;
            return;
        }
        pointerState = {
            x: event.clientX,
            y: event.clientY,
            startedAt: Date.now(),
            pointerId: event.pointerId,
            cancelled: false
        };
    }, { passive: true });

    viewer.addEventListener('pointermove', (event) => {
        if (!pointerState || event.pointerId !== pointerState.pointerId) {
            return;
        }
        const dx = event.clientX - pointerState.x;
        const dy = event.clientY - pointerState.y;
        if (Math.hypot(dx, dy) > TAP_MAX_DISTANCE_PX) {
            pointerState.cancelled = true;
        }
    }, { passive: true });

    viewer.addEventListener('pointercancel', (event) => {
        if (pointerState && event.pointerId === pointerState.pointerId) {
            pointerState = null;
        }
    }, { passive: true });

    viewer.addEventListener('pointerup', (event) => {
        if (!pointerState || event.pointerId !== pointerState.pointerId) {
            return;
        }
        const dx = event.clientX - pointerState.x;
        const dy = event.clientY - pointerState.y;
        const distance = Math.hypot(dx, dy);
        const duration = Date.now() - pointerState.startedAt;
        const wasCancelled = pointerState.cancelled;
        pointerState = null;

        if (wasCancelled || distance > TAP_MAX_DISTANCE_PX || duration > TAP_MAX_DURATION_MS) {
            return;
        }
        if (parseTapZone(event.clientX) === 'center') {
            openMenu();
        }
    }, { passive: true });
}

function isEditableTarget(target) {
    const element = target?.nodeType === Node.TEXT_NODE ? target.parentElement : target;
    if (!element || typeof element.closest !== 'function') {
        return false;
    }
    return Boolean(element.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'));
}

async function navigate(action) {
    const intentSeq = ++navigationIntentSeq;
    debugLog('navigate() queued', summarizeLocation());
    let spinnerTimer = null;
    let spinnerShown = false;
    navigationChain = navigationChain.then(async () => {
        clearInitialRestorePin();
        const readyBeforeAction = await waitForNavigationReady();
        if (!readyBeforeAction) {
            console.warn('EPUB navigation skipped because renderer is not ready.');
            debugLog('navigate() skipped: renderer not ready', {
                location: summarizeLocation()
            });
            return;
        }
        const beforeLocation = summarizeLocation();
        const beforeEventSeq = navigationEventSeq;
        const beforeRelocationSeq = relocationEventSeq;
        const navigationGuardSeq = ++rendererVisibilityGuardSeq;
        spinnerTimer = window.setTimeout(() => {
            spinnerShown = true;
            setReaderLoading(true, t('epub_loading_rendering', 'Rendering content...'));
        }, NAVIGATION_SPINNER_DELAY_MS);
        debugLog('navigate() start', {
            location: beforeLocation,
            eventSeq: beforeEventSeq
        });
        const actionResult = await action();
        const targetInfo = normalizeNavigationTarget(actionResult);
        const settled = await waitForNavigationSettled(
            beforeEventSeq,
            beforeLocation,
            {
                timeoutMs: NAVIGATION_SETTLE_TIMEOUT_MS,
                expectedIndex: targetInfo.expectedIndex
            }
        );
        if (!settled) {
            debugLog('navigate() settle timeout, attempting recovery', {
                beforeLocation,
                afterLocation: summarizeLocation(view?.lastLocation || currentLocation),
                targetInfo,
                beforeEventSeq,
                eventSeq: navigationEventSeq,
                diagnostics: getRendererDiagnostics(targetInfo.expectedIndex)
            });
            await recoverNavigationRender(targetInfo);
        }
        await waitForNavigationReady();
        const visibilityRestored = await stabilizeRendererVisibility('navigate-end', targetInfo.expectedIndex);
        if (visibilityRestored && intentSeq === navigationIntentSeq) {
            await refreshNavigationAfterVisibilityRestore(targetInfo, navigationGuardSeq, 'navigate-end', intentSeq);
        }
        const synthesizedLocation = ensureLocationForNavigationTarget(
            targetInfo,
            beforeRelocationSeq,
            beforeLocation
        );
        scheduleRendererVisibilityGuard('navigate-end', targetInfo);
        window.clearTimeout(spinnerTimer);
        if (spinnerShown) {
            hideReaderLoading();
        }
        debugLog('navigate() end', {
            settled,
            synthesizedLocation,
            targetInfo,
            location: summarizeLocation(view?.lastLocation || currentLocation),
            eventSeq: navigationEventSeq,
            relocationEventSeq,
            diagnostics: getRendererDiagnostics(targetInfo.expectedIndex)
        });
        focusReader();
    }).catch((error) => {
        console.error(error);
        ensureRendererVisible('navigate-error');
        scheduleRendererVisibilityGuard('navigate-error');
        debugLog('navigate() error', {
            message: error?.message || String(error),
            diagnostics: getRendererDiagnostics()
        });
        if (spinnerTimer !== null) {
            window.clearTimeout(spinnerTimer);
        }
        if (spinnerShown) {
            hideReaderLoading();
        }
    });

    return navigationChain;
}

async function jumpToFraction(fraction) {
    if (!view) {
        return null;
    }
    await view.goToFraction(clamp(Number(fraction) || 0, 0, 1));
    return null;
}

async function goToBoundary(atStart) {
    return await jumpToFraction(atStart ? 0 : 1);
}

function flattenTocItems(items, depth = 0, result = []) {
    if (!Array.isArray(items)) {
        return result;
    }
    for (const item of items) {
        result.push({ item, depth });
        const children = Array.isArray(item?.subitems)
            ? item.subitems
            : (Array.isArray(item?.children) ? item.children : []);
        flattenTocItems(children, depth + 1, result);
    }
    return result;
}

function resolveTocHrefIndex(href) {
    if (!href || typeof view?.resolveNavigation !== 'function') {
        return null;
    }
    const resolved = view.resolveNavigation(href);
    return Number.isInteger(resolved?.index) ? resolved.index : null;
}

function resolveNavigationIndex(target) {
    if (Number.isInteger(target)) {
        return target;
    }
    if (!target || typeof view?.resolveNavigation !== 'function') {
        return null;
    }
    try {
        const resolved = view.resolveNavigation(target);
        return Number.isInteger(resolved?.index) ? resolved.index : null;
    } catch (error) {
        traceRestore('resolveNavigationIndex failed', {
            target,
            message: error?.message || String(error)
        });
        return null;
    }
}

function getCurrentNavigationIndex() {
    const sectionIndex = getCurrentSectionIndex();
    if (sectionIndex !== null) {
        return sectionIndex;
    }
    const primaryIndex = view?.renderer?.primaryIndex;
    return Number.isInteger(primaryIndex) ? primaryIndex : null;
}

function getAdjacentLinearSectionIndex(previous, fromIndex = getCurrentNavigationIndex()) {
    if (!Number.isInteger(fromIndex)) {
        return null;
    }

    const sections = Array.isArray(view?.book?.sections) ? view.book.sections : [];
    const direction = previous ? -1 : 1;
    for (let index = fromIndex + direction; index >= 0 && index < sections.length; index += direction) {
        if (sections[index]?.linear !== 'no') {
            return index;
        }
    }
    return null;
}

async function goToSpineSection(index, previous = false) {
    if (!Number.isInteger(index) || !view) {
        return null;
    }

    if (view.isFixedLayout || !view.renderer?.goTo) {
        await view.goTo(index);
    } else {
        await view.renderer.goTo({
            index,
            anchor: previous ? () => 1 : () => 0
        });
    }
    return {
        target: index,
        expectedIndex: index
    };
}

async function goToAdjacentSpineSection(previous, fromIndex = getCurrentNavigationIndex()) {
    const targetIndex = getAdjacentLinearSectionIndex(previous, fromIndex);
    if (targetIndex === null) {
        return null;
    }
    return await goToSpineSection(targetIndex, previous);
}

function getLocationSectionIndexOrNull(location) {
    const sectionIndex = Number(location?.section);
    return Number.isInteger(sectionIndex) ? sectionIndex : null;
}

function getTocNavigationTargets() {
    return flattenTocItems(view?.book?.toc)
        .map(({ item }) => ({
            href: item?.href || '',
            index: resolveTocHrefIndex(item?.href || '')
        }))
        .filter((target) => target.href && Number.isInteger(target.index));
}

async function goToTocHref(href) {
    if (!view || !href) {
        return null;
    }
    const expectedIndex = resolveTocHrefIndex(href);
    await view.goTo(href);
    return {
        target: href,
        expectedIndex
    };
}

async function goToAdjacentSection(previous) {
    if (!view?.renderer) {
        return;
    }

    const currentIndex = getCurrentNavigationIndex();
    const tocTargets = getTocNavigationTargets();
    if (currentIndex !== null && tocTargets.length > 0) {
        const candidates = tocTargets
            .filter((target) => previous ? target.index < currentIndex : target.index > currentIndex)
            .sort((a, b) => previous ? b.index - a.index : a.index - b.index);
        if (candidates.length > 0) {
            return await goToTocHref(candidates[0].href);
        }
    }

    const sectionCount = Array.isArray(view?.book?.sections) ? view.book.sections.length : 0;
    if (currentIndex !== null && sectionCount > 0) {
        const targetIndex = previous
            ? Math.max(0, currentIndex - 1)
            : Math.min(sectionCount - 1, currentIndex + 1);
        if (targetIndex !== currentIndex) {
            await view.goTo(targetIndex);
            return {
                target: targetIndex,
                expectedIndex: targetIndex
            };
        }
    }
    return null;
}

function handleKeydown(event) {
    if (event.defaultPrevented) {
        return;
    }
    if (isEditableTarget(event.target)) {
        if (event.key === 'Escape') {
            closeMenu();
        }
        return;
    }

    const code = event.code || '';
    const key = event.key || '';
    const hasBrowserShortcutModifier = event.metaKey || event.altKey;
    if (hasBrowserShortcutModifier) {
        return;
    }
    if (code === 'ArrowLeft' || code === 'ArrowRight' || code === 'ArrowUp' || code === 'ArrowDown') {
        debugLog('handleKeydown()', {
            code,
            key,
            repeat: event.repeat,
            targetTag: event.target?.tagName || '',
            location: summarizeLocation()
        });
    }

    if (code === 'KeyI') {
        event.preventDefault();
        event.stopPropagation();
        toggleInspector();
        return;
    }
    if (code === 'Escape' || key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        const inspector = $('inspector');
        if (inspector?.style.display === 'block') {
            toggleInspector(false);
        } else {
            toggleMenu();
        }
        return;
    }
    if (code === 'KeyF') {
        event.preventDefault();
        event.stopPropagation();
        toggleFullScreen();
        return;
    }
    if (code === 'Backspace' || code === 'Delete') {
        event.preventDefault();
        event.stopPropagation();
        backListPage();
        return;
    }
    if (code === 'ArrowLeft' && event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        void navigate(() => goToAdjacentSection(true));
        return;
    }
    if (code === 'ArrowRight' && event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        void navigate(() => goToAdjacentSection(false));
        return;
    }
    if (code === 'ArrowLeft' && event.ctrlKey) {
        event.preventDefault();
        event.stopPropagation();
        void navigate(() => goToBoundary(false));
        return;
    }
    if (code === 'ArrowRight' && event.ctrlKey) {
        event.preventDefault();
        event.stopPropagation();
        void navigate(() => goToBoundary(true));
        return;
    }
    if (code === 'ArrowLeft') {
        event.preventDefault();
        event.stopPropagation();
        void navigate(() => goPhysicalLeft());
        return;
    }
    if (code === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        void navigate(() => goPhysicalRight());
        return;
    }
    if (code === 'ArrowDown') {
        event.preventDefault();
        event.stopPropagation();
        void navigate(() => goNextPage());
        return;
    }
    if (code === 'ArrowUp') {
        event.preventDefault();
        event.stopPropagation();
        void navigate(() => goPreviousPage());
        return;
    }
    if (code === 'Period' || key === '>') {
        event.preventDefault();
        event.stopPropagation();
        void navigate(() => goToBoundary(true));
        return;
    }
    if (code === 'Comma' || key === '<') {
        event.preventDefault();
        event.stopPropagation();
        void navigate(() => goToBoundary(false));
        return;
    }
    if (code === 'Home') {
        event.preventDefault();
        event.stopPropagation();
        void navigate(() => goToBoundary(true));
        return;
    }
    if (code === 'End') {
        event.preventDefault();
        event.stopPropagation();
        void navigate(() => goToBoundary(false));
        return;
    }
    if (code === 'Space' || key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        void navigate(() => goNextPage());
    }
}

function bindKeyboardShortcuts(target) {
    if (!target || target.__comistreamKeyboardBound) {
        return;
    }
    target.__comistreamKeyboardBound = true;
    target.addEventListener('keydown', handleKeydown, true);
}

function sendProgressBeacon() {
    const snapshot = getProgressSaveSnapshot();
    if (!snapshot) {
        return;
    }
    navigator.sendBeacon('comistream.php', buildProgressFormData(snapshot));
}

function commitSliderPosition() {
    const slider = $('epub-slider');
    if (!slider) {
        return;
    }
    sliderDragActive = false;
    const min = Number(slider.min);
    const max = Number(slider.max);
    const value = Number(slider.value);
    if (!view?.isFixedLayout) {
        const sectionTotal = Math.max(1, getBookSectionCount());
        const sectionIndex = clamp(
            Math.round(clamp(value, min, max) - 1),
            0,
            Math.max(0, sectionTotal - 1)
        );
        void navigate(async () => {
            await view.goTo(sectionIndex);
            return {
                target: sectionIndex,
                expectedIndex: sectionIndex
            };
        });
        return;
    }
    const targetFraction = max > min
        ? (clamp(value, min, max) - min) / (max - min)
        : 0;
    void navigate(() => jumpToFraction(targetFraction));
}

function wireToolbar() {
    const viewer = $('epub-viewer');
    setupViewerFallbackTapNavigation(viewer);
    viewer?.addEventListener('click', () => {
        focusReader();
    });
    $('epub-menu-close')?.addEventListener('click', () => closeMenu());
    $('epub-back-button')?.addEventListener('click', () => backListPage());
    $('epub-prev-page')?.addEventListener('click', () => {
        void navigate(() => goPreviousPage());
    });
    $('epub-next-page')?.addEventListener('click', () => {
        void navigate(() => goNextPage());
    });
    $('epub-prev-section')?.addEventListener('click', () => {
        void navigate(() => goToAdjacentSection(true));
    });
    $('epub-next-section')?.addEventListener('click', () => {
        void navigate(() => goToAdjacentSection(false));
    });
    $('epub-font-plus')?.addEventListener('click', () => {
        if (view?.isFixedLayout) {
            return;
        }
        currentFontScale = clamp(currentFontScale + FONT_STEP, MIN_FONT_SCALE, MAX_FONT_SCALE);
        currentFontScaleSource = FONT_SCALE_SOURCE_MANUAL;
        applyRendererPrefs();
        saveViewerPrefs();
    });
    $('epub-font-minus')?.addEventListener('click', () => {
        if (view?.isFixedLayout) {
            return;
        }
        currentFontScale = clamp(currentFontScale - FONT_STEP, MIN_FONT_SCALE, MAX_FONT_SCALE);
        currentFontScaleSource = FONT_SCALE_SOURCE_MANUAL;
        applyRendererPrefs();
        saveViewerPrefs();
    });
    $('epub-flow-toggle')?.addEventListener('click', () => {
        currentFlowMode = currentFlowMode === 'paginated' ? 'scrolled' : 'paginated';
        applyRendererPrefs();
        saveViewerPrefs();
    });
    $('epub-theme-paper')?.addEventListener('click', () => {
        applyTheme('paper');
        saveViewerPrefs();
    });
    $('epub-theme-white')?.addEventListener('click', () => {
        applyTheme('white');
        saveViewerPrefs();
    });
    $('epub-theme-dark')?.addEventListener('click', () => {
        applyTheme('dark');
        saveViewerPrefs();
    });
    $('epub-theme-system')?.addEventListener('click', () => {
        applyTheme(THEME_OPTION_SYSTEM);
        saveViewerPrefs();
    });
    for (const button of document.querySelectorAll('[data-epub-direction-option]')) {
        button.addEventListener('click', () => {
            const nextDirection = button.dataset.epubDirectionOption;
            if (nextDirection === 'auto' || nextDirection === 'rtl' || nextDirection === 'ltr') {
                currentDirectionOverride = nextDirection;
                void navigate(() => applyLayoutOverride());
            }
        });
    }
    for (const button of document.querySelectorAll('[data-epub-writing-option]')) {
        button.addEventListener('click', () => {
            const nextWritingMode = button.dataset.epubWritingOption;
            if (nextWritingMode === 'auto' || nextWritingMode === 'vertical' || nextWritingMode === 'horizontal') {
                currentWritingModeOverride = nextWritingMode;
                void navigate(() => applyLayoutOverride());
            }
        });
    }
    $('fullScreenButton')?.addEventListener('click', () => toggleFullScreen());
    $('clockToggleButton')?.addEventListener('click', () => toggleClock());
    $('inspectorToggleButton')?.addEventListener('click', () => toggleInspector());
    $('epub-nav-left')?.addEventListener('click', () => {
        void navigate(() => goPhysicalLeft());
    });
    $('epub-nav-right')?.addEventListener('click', () => {
        void navigate(() => goPhysicalRight());
    });

    const slider = $('epub-slider');
    if (slider) {
        slider.addEventListener('pointerdown', () => {
            sliderDragActive = true;
        });
        slider.addEventListener('pointerup', () => {
            commitSliderPosition();
        });
        slider.addEventListener('touchend', () => {
            commitSliderPosition();
        }, { passive: true });
        slider.addEventListener('change', () => {
            commitSliderPosition();
        });
        slider.addEventListener('input', () => {
            sliderDragActive = true;
            const sliderValue = $('epub-slider-value');
            if (sliderValue) {
                sliderValue.textContent = slider.value;
            }
        });
    }
}

function renderTocItems(items, depth = 0) {
    const tocContainer = $('epub-toc');
    if (!tocContainer || !Array.isArray(items)) {
        return;
    }

    for (const item of items) {
        const targetHref = item?.href || '';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `epub-toc-item epub-toc-depth-${Math.min(depth, 2)}`;
        button.textContent = item?.label || targetHref || '(untitled)';
        if (!targetHref) {
            button.disabled = true;
        } else {
            button.addEventListener('click', () => {
                void navigate(() => goToTocHref(targetHref));
            });
        }
        tocContainer.appendChild(button);

        const children = Array.isArray(item?.subitems)
            ? item.subitems
            : (Array.isArray(item?.children) ? item.children : []);
        if (children.length > 0) {
            renderTocItems(children, depth + 1);
        }
    }
}

function renderToc(book) {
    const tocContainer = $('epub-toc');
    if (!tocContainer) {
        return;
    }
    tocContainer.textContent = '';
    const items = Array.isArray(book?.toc) ? book.toc : [];
    renderTocItems(items, 0);
}

async function openEpubBook() {
    const perf = createPerfTimer('openEpubBook()');
    if (epubPackageBase) {
        const loader = await buildHttpPackageLoader(epubPackageBase);
        perf('package loader ready');
        const { EPUB } = await import(`${FOLIATE_MODULE_BASE}epub.js`);
        perf('foliate epub module imported');
        const book = await new EPUB(loader).init();
        perf('foliate EPUB initialized', {
            sections: Array.isArray(book?.sections) ? book.sections.length : 0,
            tocItems: Array.isArray(book?.toc) ? book.toc.length : 0
        });
        return book;
    }
    if (epubUrl) {
        perf('using monolithic epub url');
        return null;
    }
    throw new Error('epubPackageBase or epubUrl is required');
}

function registerServiceWorker() {
    if (!serviceWorkerUrl || !('serviceWorker' in navigator)) {
        return;
    }
    navigator.serviceWorker.register(serviceWorkerUrl, { scope: serviceWorkerScope })
        .catch((error) => {
            console.error('SW registration failed:', error);
        });
}

function exposeDebugHelpers() {
    if (!isDebugEnabled()) {
        return;
    }
    window.__epubDumpDiagnostics = (expectedIndex = getCurrentSectionIndex()) => getRendererDiagnostics(expectedIndex);
    window.__epubEnsureRendererVisible = () => ensureRendererVisible('manual-console');
}

function extractSignatureExpiration(url) {
    if (!url) {
        return 0;
    }
    try {
        const parsed = new URL(url, window.location.href);
        const queryExp = Number(parsed.searchParams.get('exp'));
        if (Number.isFinite(queryExp) && queryExp > 0) {
            return queryExp * 1000;
        }
        const segments = parsed.pathname.split('/').filter(Boolean);
        const bookIndex = segments.findIndex((segment) => segment === 'book');
        if (bookIndex !== -1) {
            const pathExp = Number(segments[bookIndex + 2]);
            if (Number.isFinite(pathExp) && pathExp > 0) {
                return pathExp * 1000;
            }
        }
    } catch (error) {
        console.warn(error);
    }
    return 0;
}

function normalizeMetadataValue(value) {
    if (Array.isArray(value)) {
        const normalized = value
            .map((item) => normalizeMetadataValue(item))
            .filter((item) => item && item !== t('epub_unknown', 'Unknown'));
        return normalized.length > 0 ? normalized.join(', ') : t('epub_unknown', 'Unknown');
    }
    if (value && typeof value === 'object') {
        const namedValue = value.name
            || value.fileAs
            || value.label
            || value.value
            || value.text;
        if (namedValue !== undefined) {
            return normalizeMetadataValue(namedValue);
        }

        for (const key of ['ja', 'ja-JP', 'en', 'zh', 'zh-TW', 'und']) {
            if (Object.prototype.hasOwnProperty.call(value, key)) {
                const normalized = normalizeMetadataValue(value[key]);
                if (normalized && normalized !== t('epub_unknown', 'Unknown')) {
                    return normalized;
                }
            }
        }

        const firstValue = Object.values(value).find((item) => {
            const normalized = normalizeMetadataValue(item);
            return normalized && normalized !== t('epub_unknown', 'Unknown');
        });
        if (firstValue !== undefined) {
            return normalizeMetadataValue(firstValue);
        }
    }
    if (value === null || value === undefined || value === '') {
        return t('epub_unknown', 'Unknown');
    }
    return String(value);
}

function restoreFailureState(error) {
    const storedState = getStoredState();
    let message = `${t('epub_load_failed', 'Failed to load EPUB')}: ${error.message}`;

    if (!navigator.onLine && storedState?.fraction !== undefined) {
        const template = t('epub_offline_last_location', 'Offline. Last saved location: %s');
        const offlineMessage = template.replace('%s', formatPercent(storedState.fraction));
        message += ` / ${offlineMessage}`;
    }

    setStatusText(message, true);
    hideReaderLoading();
    toggleInspector(true, error, storedState);
}

function getDefaultStartTarget() {
    const sections = view?.book?.sections;
    if (!Array.isArray(sections) || sections.length === 0) {
        return null;
    }
    const firstLinearIndex = sections.findIndex((section) => section?.linear !== 'no');
    return firstLinearIndex >= 0 ? firstLinearIndex : 0;
}

function bindViewLifecycleEvents() {
    view.addEventListener('load', (event) => {
        navigationEventSeq++;
        const doc = event.detail?.doc;
        markMediaPageLayout(doc);
        setupTapNavigation(doc);
        bindKeyboardShortcuts(doc);
        updateNavigationMode();
        const loadedIndex = event.detail?.index;
        const primaryIndex = view?.renderer?.primaryIndex;
        if (loadedIndex === primaryIndex) {
            refreshReadingModeInfo(doc);
            const layoutChanged = updateLayoutDirectionInfo(doc);
            if (layoutChanged) {
                applyRendererPrefs();
            }
        }
        applyInitialFontScaleCorrection(doc);
        updateDirectionState();
        renderInspector();
        debugLog('view.load', {
            index: event.detail?.index,
            eventSeq: navigationEventSeq,
            directionInfo: currentDirectionInfo,
            location: summarizeLocation(view?.lastLocation || currentLocation)
        });
        focusReader();
    });

    view.addEventListener('relocate', (event) => {
        navigationEventSeq++;
        relocationEventSeq++;
        const initialRestoreActive = initialRestoreReconcileUntil > Date.now();
        if (initialRestoreActive && initialRestorePinnedLocation) {
            currentLocation = initialRestorePinnedLocation;
            view.lastLocation = initialRestorePinnedLocation;
        } else {
            currentLocation = normalizeLocationForProgress(event.detail, 'view.relocate');
            view.lastLocation = currentLocation;
        }
        if (initialRestoreActive) {
            traceRestore('relocate during initial restore', {
                eventSeq: navigationEventSeq,
                relocationEventSeq,
                initialRestoreCfi,
                pinned: Boolean(initialRestorePinnedLocation),
                detail: {
                    reason: event.detail?.reason || '',
                    section: event.detail?.section?.current ?? event.detail?.index ?? -1,
                    fraction: event.detail?.fraction ?? null,
                    cfi: event.detail?.cfi || ''
                },
                effectiveLocation: summarizeLocation(currentLocation),
                metrics: getLocationProgressMetrics(currentLocation)
            });
        }
        debugLog('view.relocate', {
            reason: event.detail?.reason || '',
            index: event.detail?.section?.current ?? event.detail?.index ?? -1,
            eventSeq: navigationEventSeq,
            directionInfo: currentDirectionInfo,
            location: summarizeLocation(currentLocation),
            deferred: !viewInitialized
        });
        if (viewInitialized) {
            scheduleRelocateSideEffects();
        }
    });
}

async function init() {
    debugLog('init() start');
    const perf = createPerfTimer('init()');
    exposeDebugHelpers();
    setReaderLoading(true, t('epub_loading_opening', 'Opening EPUB...'));
    restoreViewerPrefs();
    applyShellTheme();
    wireToolbar();
    bindKeyboardShortcuts(document);
    registerServiceWorker();
    perf('shell ready');

    const { View: FoliateView } = await import(`${FOLIATE_MODULE_BASE}view.js`);
    perf('foliate view module imported');
    view = new FoliateView();
    view.id = 'epub-view';
    view.tabIndex = 0;
    $('epub-viewer')?.append(view);
    bindViewLifecycleEvents();
    perf('view element attached');

    setReaderLoading(true, t('epub_loading_fetching', 'Loading EPUB resources...'));
    const prebuiltBook = await openEpubBook();
    debugLog('init() book opened', {
        hasPrebuiltBook: Boolean(prebuiltBook)
    });
    if (prebuiltBook) {
        await view.open(prebuiltBook);
    } else {
        await view.open(epubUrl);
    }
    perf('view.open completed', {
        fixedLayout: Boolean(view?.isFixedLayout),
        sections: Array.isArray(view?.book?.sections) ? view.book.sections.length : 0
    });

    updateBookHeading();
    updateNavigationMode();
    applyRendererPrefs();
    saveViewerPrefs();
    updateFullScreenButton();
    restoreClockPreference();
    renderToc(view.book);
    focusReader();
    perf('reader chrome updated');

    setReaderLoading(true, t('epub_loading_rendering', 'Rendering content...'));
    const location = getStoredLocation();
    let initialRestoreTargetInfo = null;
    let beforeInitialRelocationSeq = relocationEventSeq;
    let beforeInitialLocation = summarizeLocation();
    debugLog('init() initial location', {
        storedLocation: location
    });
    traceRestore('initial location selected', {
        storedLocation: location,
        savedCfi,
        savedUpdatedAt,
        localState: getStoredState()
    });
    if (location) {
        initialRestoreCfi = typeof location === 'string' ? location : '';
        initialRestoreReconcileUntil = initialRestoreCfi !== '' ? Date.now() + 8000 : 0;
        initialRestoreTargetInfo = normalizeNavigationTarget(location);
        beforeInitialRelocationSeq = relocationEventSeq;
        beforeInitialLocation = summarizeLocation();
        traceRestore('before view.init restore', {
            initialRestoreTargetInfo,
            beforeInitialRelocationSeq,
            beforeInitialLocation
        });
        try {
            await view.init({ lastLocation: location });
            perf('view.init restored location');
            traceRestore('after view.init restore', {
                lastLocation: summarizeLocation(view?.lastLocation),
                currentLocation: summarizeLocation(currentLocation),
                relocationEventSeq
            });
        } catch (error) {
            console.warn('Failed to restore stored location, falling back to book start.', error);
            debugLog('init() restore failed, falling back to text start', {
                message: error?.message || String(error),
                storedLocation: location
            });
            clearInitialRestorePin();
            initialRestoreTargetInfo = null;
            await view.init({ showTextStart: true });
            perf('view.init fallback text start');
        }
    } else {
        await view.init({ showTextStart: true });
        perf('view.init text start');
    }

    if (!view.lastLocation) {
        const restoredSyntheticLocation = initialRestoreTargetInfo
            ? ensureLocationForNavigationTarget(
                initialRestoreTargetInfo,
                beforeInitialRelocationSeq,
                beforeInitialLocation
            )
            : false;
        if (restoredSyntheticLocation) {
            debugLog('init() restored synthetic location', {
                targetInfo: initialRestoreTargetInfo,
                location: summarizeLocation(view?.lastLocation || currentLocation)
            });
        }
    }

    if (!view.lastLocation) {
        const fallbackTarget = getDefaultStartTarget();
        if (fallbackTarget !== null) {
            console.warn('EPUB init completed without a rendered location. Falling back to the first readable section.');
            debugLog('init() no rendered location, forcing fallback target', {
                fallbackTarget
            });
            clearStoredLocation();
            await view.goTo(fallbackTarget);
            perf('fallback goTo completed', {
                fallbackTarget
            });
        }
    }

    if (location && view.lastLocation) {
        await reapplyInitialRestoreTarget(location, 'init-layout-settle');
    }

    viewInitialized = true;
    if (view.lastLocation) {
        currentLocation = view.lastLocation;
        if (location) {
            await waitForNavigationReady();
            await reconcileCurrentLocationProgressFromCfi('initial-restore', location);
        }
        updateProgressUI(currentLocation);
        updateDirectionState();
        scheduleRelocateSideEffects({ immediateSave: true });
    } else {
        setStatusText(t('epub_status_loading', 'Loading...'));
    }
    perf('initial relocate side effects scheduled');
    hideReaderLoading();
    perf('loading hidden');
    debugLog('init() completed', {
        location: summarizeLocation(view?.lastLocation || currentLocation),
        directionInfo: currentDirectionInfo
    });
    if (location) {
        void (async () => {
            for (const delayMs of [400, 1200, 2400]) {
                await waitTimeout(delayMs);
                if (initialRestoreCfi !== location || initialRestoreReconcileUntil <= Date.now()) {
                    return;
                }
                const reapplied = await reapplyInitialRestoreTarget(location, `delayed-${delayMs}`);
                if (reapplied) {
                    await reconcileCurrentLocationProgressFromCfi(`delayed-${delayMs}`, location);
                    applyRelocateSideEffects({ immediateSave: delayMs === 2400 });
                }
            }
        })();
    }

    document.addEventListener('fullscreenchange', updateFullScreenButton);
    document.addEventListener('webkitfullscreenchange', updateFullScreenButton);
    document.addEventListener('mozfullscreenchange', updateFullScreenButton);
    document.addEventListener('MSFullscreenChange', updateFullScreenButton);

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            persistCurrentLocation();
            sendProgressBeacon();
        }
    });

    window.addEventListener('pagehide', () => {
        persistCurrentLocation();
        sendProgressBeacon();
    });
    window.addEventListener('resize', debounce(() => {
        applyRendererPrefs();
    }, LAYOUT_RESIZE_DEBOUNCE_MS));
    if (systemDarkModeMedia) {
        const handleSystemThemeChange = () => {
            if (currentTheme !== THEME_OPTION_SYSTEM) {
                return;
            }
            // OS側の色変更に追従して、本文CSSも更新するルン。
            applyRendererPrefs();
        };
        if (typeof systemDarkModeMedia.addEventListener === 'function') {
            systemDarkModeMedia.addEventListener('change', handleSystemThemeChange);
        } else if (typeof systemDarkModeMedia.addListener === 'function') {
            systemDarkModeMedia.addListener(handleSystemThemeChange);
        }
    }

    if (window.feather?.replace) {
        window.feather.replace();
    }

}

document.addEventListener('DOMContentLoaded', () => {
    init().catch((error) => {
        console.error(error);
        restoreFailureState(error);
    });
});
