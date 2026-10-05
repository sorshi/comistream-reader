(function (global) {
    'use strict';

    function normalizeSuggestions(data, { publicDir, baseFile, readerUrl }) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
        const prefix = publicDir && publicDir !== '/' ? publicDir.replace(/\/+$/, '') + '/' : '/';
        const seen = new Set();
        const candidates = [];
        for (const group of [data.title?.new, data.title?.old, data.author]) {
            if (!group || typeof group !== 'object' || Array.isArray(group)) continue;
            for (const [title, path] of Object.entries(group)) {
                if (typeof path !== 'string' || !path.startsWith(prefix) || path.startsWith('//')
                    || /[\\\u0000-\u001f\u007f]/.test(path)) continue;
                const relative = path.slice(prefix.length);
                if (!relative || relative.split('/').some(part => part === '.' || part === '..')) continue;
                if (title === baseFile || relative.split('/').pop() === baseFile || seen.has(path)) continue;
                const url = new URL(readerUrl);
                url.search = '';
                url.hash = '';
                // 空白は%20にして、PHPが保持するファイル名の+と区別するルン。
                url.search = 'file=' + encodeURIComponent(relative) + '&mode=open';
                seen.add(path);
                candidates.push({ title, href: url.href });
            }
        }
        return candidates;
    }

    function isForwardSwipe(dx, dy, { rtl, vertical, minimumDistance = 40 }) {
        if (Math.abs(dx) > Math.abs(dy)) return Math.abs(dx) >= minimumDistance && (rtl ? dx > 0 : dx < 0);
        return vertical && Math.abs(dy) >= minimumDistance && dy < 0;
    }

    function create(options) {
        const doc = options.document || global.document;
        const panel = doc.getElementById('epub-end-panel');
        const list = doc.getElementById('epub-end-books');
        const returnButton = doc.getElementById('epub-end-return');
        const backButton = doc.getElementById('epub-end-back');
        let generation = 0;
        let restoreFocus = null;
        let request = null;
        let animation = null;
        let candidates = [];
        const boundTargets = new WeakSet();

        function isOpen() { return Boolean(panel?.open); }
        function close() {
            if (!isOpen()) return;
            generation++;
            animation?.cancel();
            panel.close();
        }
        panel?.addEventListener('close', () => {
            generation++;
            options.onClose?.();
            if (restoreFocus?.isConnected && !restoreFocus.disabled && restoreFocus.getClientRects().length) restoreFocus.focus({ preventScroll: true });
            else options.focusReader?.();
        });
        panel?.addEventListener('cancel', event => {
            event.preventDefault();
            close();
        });
        // 押し始めと離した場所が両方背景の場合だけ閉じるルン。
        let backdropPressed = false;
        const outsidePanel = event => {
            const rect = panel.getBoundingClientRect();
            return event.clientX < rect.left || event.clientX > rect.right
                || event.clientY < rect.top || event.clientY > rect.bottom;
        };
        panel?.addEventListener('pointerdown', event => { backdropPressed = event.target === panel && outsidePanel(event); });
        panel?.addEventListener('pointercancel', () => { backdropPressed = false; });
        panel?.addEventListener('click', event => {
            if (backdropPressed && event.target === panel && outsidePanel(event)) close();
            backdropPressed = false;
        });
        returnButton?.addEventListener('click', close);
        backButton?.addEventListener('click', () => { void options.onBack(); });
        // ダイアログのボタンとTab操作はブラウザに任せ、Readerのキー操作へ渡さないルン。
        panel?.addEventListener('keydown', event => event.stopPropagation());
        const title = doc.getElementById('epub-end-book-title');
        if (title) title.textContent = options.baseFile;

        function open() {
            if (!panel || isOpen() || !options.isAtEnd()) return false;
            restoreFocus = doc.activeElement;
            generation++;
            options.onOpen?.();
            panel.showModal();
            returnButton?.focus({ preventScroll: true });
            if (!global.matchMedia?.('(prefers-reduced-motion: reduce)').matches && panel.animate) {
                animation = panel.animate([
                    { opacity: 0, transform: 'scale(0.85)' },
                    { opacity: 1, transform: 'scale(1)' }
                ], { duration: 280, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' });
            }
            return true;
        }

        function renderCandidates() {
            if (!list) return;
            const scrollTop = panel.scrollTop;
            const fragment = doc.createDocumentFragment();
            for (const candidate of candidates) {
                const row = doc.createElement('p');
                const icon = doc.createElement('img');
                icon.src = options.iconUrl;
                icon.alt = '';
                const link = doc.createElement('a');
                link.href = candidate.href;
                link.textContent = candidate.title;
                link.addEventListener('click', event => {
                    event.preventDefault();
                    void options.onNavigate(candidate.href);
                });
                row.append(icon, link);
                fragment.appendChild(row);
            }
            list.replaceChildren(fragment);
            list.hidden = candidates.length === 0;
            panel.scrollTop = scrollTop;
        }

        function startSuggestions() {
            if (request) return request;
            request = (async () => {
                const controller = new AbortController();
                const timer = global.setTimeout(() => controller.abort(), 5000);
                try {
                    const response = await (options.fetch || global.fetch)(
                        '/suggest.php?booktitle=' + encodeURIComponent(options.baseFile),
                        { headers: { Accept: 'application/json' }, credentials: 'same-origin', signal: controller.signal }
                    );
                    if (response.status === 404) return;
                    if (!response.ok) throw new Error('Suggestion HTTP status: ' + response.status);
                    candidates = normalizeSuggestions(await response.json(), options);
                    renderCandidates();
                } catch (error) {
                    options.onError?.(error);
                } finally {
                    global.clearTimeout(timer);
                }
            })();
            return request;
        }

        function bindGestures(target) {
            if (!target || boundTargets.has(target)) return;
            boundTargets.add(target);
            let touch = null;
            const selectionActive = () => {
                const selection = (target.ownerDocument || target).getSelection?.();
                return selection && !selection.isCollapsed;
            };
            target.addEventListener('touchstart', event => {
                touch = null;
                if (isOpen() || !options.canSwipe() || event.touches.length !== 1 || selectionActive()
                    || !options.isEligibleTarget(event.target)) return;
                const point = event.touches[0];
                touch = { id: point.identifier, x: point.clientX, y: point.clientY,
                    atEnd: options.isAtEnd(), generation, cfi: options.getCfi(), direction: options.getDirection() };
            }, { passive: true });
            target.addEventListener('touchmove', event => {
                if (event.touches.length !== 1 || selectionActive()) touch = null;
            }, { passive: true });
            target.addEventListener('touchcancel', () => { touch = null; }, { passive: true });
            target.addEventListener('touchend', event => {
                const start = touch;
                touch = null;
                const point = Array.from(event.changedTouches).find(item => item.identifier === start?.id);
                if (!start || !point || event.touches.length || isOpen() || start.generation !== generation
                    || !options.canSwipe() || selectionActive()
                    || !isForwardSwipe(point.clientX - start.x, point.clientY - start.y, start.direction)) return;
                if (start.atEnd && options.isAtEnd() && start.cfi === options.getCfi()) {
                    void options.requestOpen();
                } else {
                    options.onForwardSwipe?.();
                }
            }, { passive: true });
        }

        return { open, close, isOpen, bindGestures, startSuggestions, getGeneration: () => generation };
    }

    const api = { create, normalizeSuggestions, isForwardSwipe };
    global.ComistreamEpubEnd = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
