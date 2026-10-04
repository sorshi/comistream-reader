/*!
 * Comistream Reader inspector UI
 * Copyright 2026 Comistream Project.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

window.ComistreamInspector = {
  create({ menu, hideMenu, restoreMenu, focusReader }) {
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
      // 小さい画面では、背後の読書ショートカットを動かさないルン。
      return modal || panel.contains(event.target);
    }

    closeButton.addEventListener('click', () => setVisible(false));
    panel.addEventListener('cancel', (event) => {
      event.preventDefault();
      setVisible(false);
    });
    panel.addEventListener('keydown', (event) => {
      handleKeydown(event);
      // パネル内の矢印・Spaceはスクロールやボタン操作へ任せるルン。
      event.stopPropagation();
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
