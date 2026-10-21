/*!
 * Comistream Reader inspector UI
 * Copyright 2026 Comistream Project.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

window.ComistreamInspector = {
  updateText(element, text) {
    if (element.textContent === text) return;
    // コピー中の値は保持し、選択解除後の更新で最新値に戻すルン。
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.containsNode(element, true)) return;
    const content = document.getElementById('inspector-content');
    const scrollTop = content.scrollTop;
    element.textContent = text;
    content.scrollTop = scrollTop;
  },
  create({ menu, hideMenu, restoreMenu, focusReader, onBack }) {
    const panel = document.getElementById('inspector');
    const content = document.getElementById('inspector-content');
    const closeButton = document.getElementById('inspector-close');
    const toggle = document.getElementById('inspectorToggleButton');
    const compact = window.matchMedia('(max-width: 720px), (max-height: 480px)');
    let modal = false;
    let returnFocus = null;
    let restoreToc = false;
    let menuScrollTop = 0;
    let menuScrollLeft = 0;

    function present() {
      modal = compact.matches;
      panel.setAttribute('aria-modal', String(modal));
      if (modal) panel.showModal();
      else panel.show();
    }

    function setVisible(visible) {
      if (visible === panel.open) return;
      if (visible) {
        returnFocus = document.activeElement;
        restoreToc = menu?.style.display === 'block';
        menuScrollTop = menu?.scrollTop || 0;
        menuScrollLeft = menu?.scrollLeft || 0;
        if (restoreToc) hideMenu();
        content.scrollTop = 0;
        present();
        closeButton.focus({ preventScroll: true });
      } else {
        panel.close();
        if (restoreToc) {
          restoreMenu();
          menu.scrollTop = menuScrollTop;
          menu.scrollLeft = menuScrollLeft;
        }
        if (returnFocus?.isConnected && returnFocus !== document.body) {
          returnFocus.focus({ preventScroll: true });
        } else if (restoreToc) {
          toggle?.focus({ preventScroll: true });
        } else {
          focusReader?.();
        }
        restoreToc = false;
        content.replaceChildren();
      }
      toggle?.classList.toggle('pressed', visible);
      toggle?.setAttribute('aria-pressed', String(visible));
    }

    function handleKeydown(event) {
      if (!panel.open || event.defaultPrevented) return false;
      const editable = event.target?.isContentEditable || event.target?.closest?.(
        'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]'
      );
      // 文字入力・IME・ブラウザの操作は読書ショートカットへ渡さないルン。
      if (editable || event.isComposing || event.keyCode === 229 || event.metaKey || event.altKey) return true;
      if (event.ctrlKey && !['ArrowLeft', 'ArrowRight'].includes(event.code)) return true;
      if (['Delete', 'Backspace'].includes(event.code) || ['Delete', 'Backspace'].includes(event.key)) {
        if (event.shiftKey) return true;
        if (onBack) {
          // 一覧へ戻る操作は、Inspector内からも既存の読書位置保存を通すルン。
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat) void onBack();
          return true;
        }
      }
      if (event.key === 'Escape' || event.code === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setVisible(false);
        return true;
      }
      if (event.code === 'KeyI' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        event.stopPropagation();
        setVisible(false);
        return true;
      }
      // ページ送りなどは、画面幅やフォーカス位置によらず既存のリーダーへ渡すルン。
      return false;
    }

    closeButton.addEventListener('click', () => setVisible(false));
    panel.addEventListener('cancel', (event) => {
      event.preventDefault();
      setVisible(false);
    });
    panel.addEventListener('keydown', (event) => {
      if (handleKeydown(event)) event.stopPropagation();
    });
    // 情報のタップやスクロールをページ送りへ伝えないルン。
    for (const type of ['click', 'touchstart', 'touchmove', 'touchend', 'long-press']) {
      panel.addEventListener(type, (event) => event.stopPropagation());
    }
    compact.addEventListener('change', () => {
      if (!panel.open) return;
      const focused = document.activeElement;
      const scrollTop = content.scrollTop;
      // 回転時は同じ内容・位置を保ってモーダルの状態だけ切り替えるルン。
      panel.close();
      present();
      if (panel.contains(focused)) focused.focus({ preventScroll: true });
      else closeButton.focus({ preventScroll: true });
      content.scrollTop = scrollTop;
    });

    return { setVisible, handleKeydown, isOpen: () => panel.open };
  }
};
