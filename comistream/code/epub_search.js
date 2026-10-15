/*!
 * Comistream Reader EPUB text search
 * Copyright 2026 Comistream Project.
 * SPDX-License-Identifier: AGPL-3.0-only
 */
(function (global) {
    'use strict';

    const RESULT_LIMIT = 1000;
    const VISIBLE_BATCH = 50;
    const QUERY_LIMIT = 256;
    const BLOCKS = new Set(['address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt',
        'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr',
        'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'td', 'th', 'tr', 'ul']);
    const EXCLUDED = new Set(['head', 'script', 'style', 'rt', 'rp', 'noscript', 'template']);
    const escapeLiteral = query => query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));

    function excluded(element) {
        const name = element.localName?.toLowerCase();
        const type = element.getAttributeNS?.('http://www.idpf.org/2007/ops', 'type')
            || element.getAttribute?.('epub:type') || '';
        return EXCLUDED.has(name) || element.hasAttribute('hidden')
            || element.getAttribute('aria-hidden')?.toLowerCase() === 'true'
            || (name === 'nav' && (type.split(/\s+/).includes('toc')
                || element.getAttribute('role') === 'doc-toc'));
    }

    async function* textRuns(doc, current, checkpoint) {
        const root = doc.body || doc.documentElement;
        if (!root || excluded(root)) return;
        const walker = doc.createTreeWalker(root, 13, {
            acceptNode: node => node.nodeType === 1 && excluded(node) ? 2 : 1
        });
        let run = [], block = null, count = 0;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!current()) return;
            if (node.nodeType === 1 && ['br', 'hr'].includes(node.localName?.toLowerCase())) {
                if (run.length) yield run;
                run = []; block = null;
            } else if ((node.nodeType === 3 || node.nodeType === 4) && node.nodeValue) {
                let parent = node.parentElement;
                while (parent && parent !== root && !BLOCKS.has(parent.localName?.toLowerCase())) parent = parent.parentElement;
                if (block !== parent && run.length) { yield run; run = []; }
                block = parent;
                run.push(node);
            }
            if (++count % 500 === 0) await checkpoint();
        }
        if (current() && run.length) yield run;
    }

    async function scanBook({ view, query, loadModules, current, checkpoint = nextTask,
        onMatch, onFailure = () => {}, limit = RESULT_LIMIT }) {
        const { searchMatcher, textWalker } = await loadModules();
        if (!current()) return { canceled: true };
        let count = 0, documents = 0, failures = 0, hasText = false;
        for (const [sectionIndex, section] of view.book.sections.entries()) {
            if (!current()) return { canceled: true };
            if (!section.createDocument) continue;
            await checkpoint();
            if (!current()) return { canceled: true };
            try {
                const doc = await section.createDocument();
                if (!current()) return { canceled: true };
                if (!doc?.documentElement || doc.querySelector('parsererror')) throw new Error('Invalid EPUB document');
                documents++;
                for await (const nodes of textRuns(doc, current, checkpoint)) {
                    if (!current()) return { canceled: true };
                    if (!nodes.some(node => node.nodeValue.trim())) continue;
                    hasText = true;
                    const allowed = new Set(nodes);
                    const range = doc.createRange();
                    range.setStart(nodes[0], 0);
                    range.setEnd(nodes.at(-1), nodes.at(-1).nodeValue.length);
                    // 元のノードを残し、同じ段落の親文字とインライン要素だけを結ぶルン。
                    const walk = (_doc, callback) => textWalker(range, callback,
                        node => node.nodeType === 1 ? 3 : allowed.has(node) ? 1 : 2);
                    const matcher = searchMatcher(walk, { mode: 'regex', matchCase: false });
                    for (const match of matcher(doc, escapeLiteral(query))) {
                        if (!current()) return { canceled: true };
                        if (count === limit) return { capped: true, failures, documents, hasText };
                        const cfi = view.getCFI(sectionIndex, match.range);
                        await onMatch({ id: cfi, sectionIndex, cfi, excerpt: match.excerpt });
                        if (++count % 25 === 0) await checkpoint();
                    }
                }
            } catch (_) {
                if (!current()) return { canceled: true };
                failures++;
                onFailure(sectionIndex);
            }
        }
        return { failures, documents, hasText };
    }

    function create(options) {
        const doc = options.document || document;
        const $ = id => doc.getElementById('epub-search-' + id);
        const panel = $('panel'), list = $('list'), menu = doc.getElementById('epub-menu-panel');
        const inputs = [$('menu-input'), $('input')];
        const forms = [$('menu-form'), $('form')];
        const t = (key, ...values) => {
            let index = 0;
            return String(options.labels['epub_search_' + key] || key).replace(/%s/g, () => String(values[index++] ?? ''));
        };
        const state = { draft: '', query: '', status: 'idle', results: [], failures: 0,
            selected: null, origin: null, visible: VISIBLE_BATCH, collapsed: false, moving: false };
        let generation = 0, destroyed = false, chromeVisible = true, scrollTop = 0, menuScroll = 0;
        let error = '', composing = false, paintTimer = null, metadataRunning = false;
        let highlighted = null, highlightVersion = 0, highlightChain = Promise.resolve();
        const rows = new Map();
        const current = version => !destroyed && version === generation;
        const selectedIndex = () => state.results.findIndex(result => result.id === state.selected);
        const checkpoint = async () => {
            await nextTask();
            while (!destroyed && doc.hidden) await new Promise(resolve => setTimeout(resolve, 150));
        };

        for (const element of doc.querySelectorAll('[data-epub-search-label]')) {
            element.textContent = t(element.dataset.epubSearchLabel);
        }
        for (const input of inputs) input.placeholder = t('placeholder');
        $('close').setAttribute('aria-label', t('close'));
        $('book').textContent = options.bookTitle || '';

        function countText() {
            return state.status === 'running' || ['stopped', 'partial', 'capped'].includes(state.status)
                ? t('at_least', state.results.length) : String(state.results.length);
        }

        function statusText() {
            let message;
            if (state.status === 'running') message = t('running', state.results.length);
            else if (state.status === 'stopped') message = t('stopped', state.results.length);
            else if (state.status === 'capped') message = t('limit', RESULT_LIMIT);
            else if (state.status === 'failed') message = t('failed');
            else if (state.status === 'partial') message = t('partial', state.results.length);
            else if (state.status === 'empty') message = t('no_text');
            else if (state.status === 'complete') message = state.results.length ? t('count', state.results.length) : t('none', state.query);
            else message = t('preparing');
            if (state.failures && !['partial', 'failed'].includes(state.status)) message += ' ' + t('partial', state.results.length);
            return message;
        }

        function updateRow(result, row) {
            row.querySelector('.epub-search-section').textContent = result.label || t('section', result.sectionIndex + 1);
            row.querySelector('.epub-search-position').textContent = Number.isFinite(result.fraction)
                ? t('position', Math.round(result.fraction * 100)) : '';
            const selected = result.id === state.selected;
            row.setAttribute('aria-current', String(selected));
            row.querySelector('.epub-search-shown').textContent = selected ? t('shown') : '';
            row.disabled = state.moving;
        }

        function appendRow(result) {
            const row = doc.createElement('button');
            row.type = 'button';
            row.className = 'epub-search-result';
            row.dataset.resultId = result.id;
            const heading = doc.createElement('span');
            heading.className = 'epub-search-result-heading';
            for (const className of ['section', 'position', 'shown']) {
                const span = doc.createElement('span');
                span.className = 'epub-search-' + className;
                heading.append(span);
            }
            const excerpt = doc.createElement('span');
            excerpt.className = 'epub-search-excerpt';
            const mark = doc.createElement('mark');
            mark.textContent = result.excerpt.match;
            excerpt.append(doc.createTextNode(result.excerpt.pre), mark, doc.createTextNode(result.excerpt.post));
            row.append(heading, excerpt);
            row.addEventListener('click', () => void move(result));
            rows.set(result.id, row);
            list.append(row);
            updateRow(result, row);
        }

        async function enrichVisible() {
            if (metadataRunning || destroyed) return;
            metadataRunning = true;
            try {
                const version = generation;
                for (const result of state.results.slice(0, state.visible)) {
                    if (!current(version)) break;
                    if (result.enriched) continue;
                    const view = options.getView();
                    try {
                        const item = await view.getTOCItemOf(result.cfi);
                        if (!current(version)) break;
                        result.label = item?.label || '';
                        const progress = await view.getCFIProgress(result.cfi);
                        if (!current(version)) break;
                        result.fraction = progress?.fraction;
                    } catch (_) { /* 補助情報がなくても結果は選べるルン。 */ }
                    if (!current(version)) break;
                    result.enriched = true;
                    const row = rows.get(result.id);
                    if (row) updateRow(result, row);
                    await checkpoint();
                }
            } finally {
                metadataRunning = false;
                if (!destroyed && state.results.slice(0, state.visible).some(result => !result.enriched)) {
                    setTimeout(() => void enrichVisible(), 0);
                }
            }
        }

        function paint() {
            clearTimeout(paintTimer); paintTimer = null;
            if (destroyed) return;
            $('query').textContent = state.query ? t('query', state.query) : '';
            $('status').textContent = statusText();
            $('error').textContent = error;
            $('menu-error').textContent = error;
            $('stop').hidden = state.status !== 'running';
            $('stop').disabled = state.moving;
            $('return').hidden = !state.origin;
            $('return').disabled = state.moving;
            $('more').hidden = state.visible >= state.results.length;
            $('menu-results').hidden = state.status === 'idle';
            for (const form of forms) form.querySelector('button[type="submit"]').disabled = state.moving;
            for (const result of state.results.slice(0, state.visible)) {
                if (!rows.has(result.id)) appendRow(result);
                else updateRow(result, rows.get(result.id));
            }
            const index = selectedIndex();
            $('results').textContent = index >= 0 ? t('results') + ' ' + (index + 1) + '/' + countText() : t('results');
            $('bar').hidden = state.status === 'idle' || panel.open || !chromeVisible
                || menu?.style.display === 'block' || Boolean(doc.querySelector('dialog[open]'));
            $('bar-actions').hidden = state.collapsed || index < 0;
            $('previous').disabled = state.moving || index <= 0;
            $('next').disabled = state.moving || index < 0 || index + 1 >= state.results.length;
            $('bar-finish').disabled = state.moving;
            $('finish').disabled = state.moving;
            $('collapse').hidden = state.collapsed || index < 0;
            $('results').setAttribute('aria-label', t('query', state.query) + ' · ' + $('results').textContent);
            if (panel.open) void enrichVisible();
        }

        function schedulePaint() {
            if (paintTimer === null) paintTimer = setTimeout(paint, 250);
        }

        function refreshHighlight() {
            const version = ++highlightVersion;
            const result = state.results.find(item => item.id === state.selected);
            highlightChain = highlightChain.catch(() => {}).then(async () => {
                const view = options.getView();
                if (highlighted) {
                    const old = highlighted; highlighted = null;
                    await view?.deleteAnnotation(old);
                }
                if (destroyed || version !== highlightVersion || !result) return;
                highlighted = { value: 'foliate-search:' + result.cfi };
                await view.addAnnotation(highlighted);
            }).catch(() => {});
            return highlightChain;
        }

        function viewportChanged() {
            const viewport = global.visualViewport;
            panel.style.setProperty('--epub-search-height', (viewport?.height || global.innerHeight) + 'px');
            panel.style.setProperty('--epub-search-top', (viewport?.offsetTop || 0) + 'px');
            panel.style.setProperty('--epub-search-width', (viewport?.width || global.innerWidth) + 'px');
            panel.style.setProperty('--epub-search-left', (viewport?.offsetLeft || 0) + 'px');
        }

        function focusResults() {
            const row = rows.get(state.selected);
            (row || $('status')).focus({ preventScroll: true });
        }

        function open() {
            if (destroyed || panel.open) return;
            menuScroll = menu?.scrollTop || menuScroll;
            options.hideOtherPanels();
            panel.showModal();
            viewportChanged();
            paint();
            list.scrollTop = scrollTop;
            focusResults();
        }

        function close({ focus = true } = {}) {
            if (panel.open) { scrollTop = list.scrollTop; panel.close(); }
            paint();
            if (focus && !$('bar').hidden) $('results').focus({ preventScroll: true });
        }

        async function search(query) {
            if (destroyed || state.moving) return;
            const value = String(query).trim();
            error = '';
            if (!value || Array.from(value).length > QUERY_LIMIT) {
                error = t(value ? 'too_long' : 'empty'); paint(); return;
            }
            if (!options.isReady()) { error = t('preparing'); paint(); return; }
            state.draft = value;
            for (const input of inputs) input.value = value;
            for (const input of inputs) input.blur();
            if (value === state.query && ['running', 'complete', 'empty'].includes(state.status)) { open(); return; }
            const version = ++generation;
            Object.assign(state, { query: value, status: 'running', results: [], failures: 0,
                selected: null, visible: VISIBLE_BATCH, collapsed: false });
            list.replaceChildren(); rows.clear(); scrollTop = 0;
            void refreshHighlight();
            open(); paint(); focusResults();
            const view = options.getView();
            try {
                const seen = new Set();
                const summary = await scanBook({ view, query: value, loadModules: options.loadModules,
                    current: () => current(version) && options.getView() === view,
                    checkpoint,
                    onMatch: result => {
                        if (!current(version) || seen.has(result.id)) return;
                        seen.add(result.id);
                        state.results.push(result);
                        schedulePaint();
                    },
                    onFailure: () => { state.failures++; }
                });
                if (!current(version) || summary.canceled) return;
                state.status = summary.capped ? 'capped' : summary.failures
                    ? summary.documents ? 'partial' : 'failed'
                    : summary.hasText ? 'complete' : 'empty';
            } catch (_) {
                if (current(version)) state.status = 'failed';
            }
            if (current(version)) paint();
        }

        function stop() {
            if (state.status !== 'running') return;
            generation++; state.status = 'stopped'; paint();
        }

        function finish() {
            if (state.moving) return;
            generation++;
            close({ focus: false });
            Object.assign(state, { status: 'idle', query: '', results: [], selected: null, origin: null });
            list.replaceChildren(); rows.clear(); error = ''; scrollTop = 0;
            void refreshHighlight();
            paint(); options.focusReader();
        }

        async function move(result, returning = false) {
            if (destroyed || state.moving || (!returning && !result)) return;
            const version = generation;
            state.moving = true; error = ''; paint();
            $('error').textContent = t('moving');
            try {
                const moved = await options.moveTo(returning ? state.origin : result.cfi,
                    () => current(version));
                if (!current(version)) return;
                if (!moved?.ok) { error = t('move_failed'); return; }
                if (!returning) {
                    state.origin ||= moved.beforeCfi;
                    state.selected = result.id;
                    state.visible = Math.max(state.visible, Math.ceil((selectedIndex() + 1) / VISIBLE_BATCH) * VISIBLE_BATCH);
                    state.collapsed = false;
                    await refreshHighlight();
                    close({ focus: false });
                } else {
                    state.moving = false;
                    finish();
                }
                options.focusReader();
            } catch (_) { if (current(version)) error = t('move_failed'); }
            finally { state.moving = false; paint(); }
        }

        function handleKeydown(event) {
            if (!panel.open) return Boolean(event.target?.closest?.('#epub-search-bar'))
                || (composing && Boolean(event.target?.closest?.('#epub-search-menu-form')));
            if ((event.key === 'Escape' || event.code === 'Escape') && !event.isComposing && !composing && event.keyCode !== 229) {
                event.preventDefault(); event.stopPropagation(); close();
            }
            return true;
        }

        forms.forEach((form, index) => {
            form.addEventListener('submit', event => {
                event.preventDefault();
                if (!composing) void search(inputs[index].value);
            });
            inputs[index].addEventListener('input', () => {
                state.draft = inputs[index].value;
                for (const other of inputs) if (other !== inputs[index]) other.value = state.draft;
            });
            inputs[index].addEventListener('compositionstart', () => { composing = true; });
            inputs[index].addEventListener('compositionend', () => { composing = false; });
            inputs[index].addEventListener('keydown', event => {
                if (event.key === 'Enter' && (event.isComposing || composing || event.keyCode === 229)) event.preventDefault();
            });
            form.querySelector('button[type="submit"]').disabled = false;
        });
        $('menu-results').addEventListener('click', open);
        $('results').addEventListener('click', () => { state.collapsed = false; open(); });
        $('close').addEventListener('click', () => close());
        $('toc').addEventListener('click', () => {
            close({ focus: false }); options.showMenu();
            menu.scrollTop = menuScroll;
            $('menu-results').focus({ preventScroll: true });
        });
        $('stop').addEventListener('click', stop);
        $('finish').addEventListener('click', finish);
        $('bar-finish').addEventListener('click', finish);
        $('collapse').addEventListener('click', () => { state.collapsed = true; paint(); $('results').focus({ preventScroll: true }); });
        $('more').addEventListener('click', () => { state.visible += VISIBLE_BATCH; paint(); });
        $('previous').addEventListener('click', () => void move(state.results[selectedIndex() - 1]));
        $('next').addEventListener('click', () => void move(state.results[selectedIndex() + 1]));
        $('return').addEventListener('click', () => void move(null, true));
        panel.addEventListener('cancel', event => {
            event.preventDefault();
            if (!composing) close();
        });
        let outsideDown = false;
        const outside = event => {
            const rect = panel.getBoundingClientRect();
            return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
        };
        panel.addEventListener('pointerdown', event => { outsideDown = outside(event); });
        panel.addEventListener('click', event => { if (outsideDown && outside(event)) close(); outsideDown = false; });
        panel.addEventListener('keydown', handleKeydown);
        for (const type of ['click', 'touchstart', 'touchmove', 'touchend', 'long-press']) {
            for (const element of [panel, $('bar')]) element.addEventListener(type, event => event.stopPropagation());
        }
        global.visualViewport?.addEventListener('resize', viewportChanged);
        global.visualViewport?.addEventListener('scroll', viewportChanged);
        global.addEventListener('resize', viewportChanged);
        const chromeObserver = new MutationObserver(() => paint());
        for (const element of [menu, doc.getElementById('inspector'), doc.getElementById('epub-end-panel')]) {
            if (element) chromeObserver.observe(element, { attributes: true, attributeFilter: ['open', 'style'] });
        }
        function destroy() {
            destroyed = true; generation++; clearTimeout(paintTimer);
            chromeObserver.disconnect();
            panel.close();
            void refreshHighlight();
            global.visualViewport?.removeEventListener('resize', viewportChanged);
            global.visualViewport?.removeEventListener('scroll', viewportChanged);
            global.removeEventListener('resize', viewportChanged);
        }
        global.addEventListener('pagehide', event => {
            // 戻る操作で復元される画面では、検索を終了して入力機能は残すルン。
            if (event.persisted) { state.moving = false; finish(); }
            else destroy();
        });
        paint();
        return { search, open, close, stop, finish, move, refreshHighlight, handleKeydown, destroy,
            isOpen: () => panel.open, isMoving: () => state.moving,
            setChromeVisible: visible => { chromeVisible = visible; paint(); },
            getState: () => state };
    }

    global.ComistreamEpubSearch = { create, scanBook, textRuns, escapeLiteral };
})(typeof window !== 'undefined' ? window : globalThis);
