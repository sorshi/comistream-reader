/* 画像Readerの綴じ方向を本ごとに保存するルン。 */
(function readerDirectionModule(global) {
  'use strict';

  function isDirection(value) {
    return value === 'left' || value === 'right';
  }

  function directionState(value) {
    if (typeof value?.state_id !== 'string' || !Number.isSafeInteger(value.direction_revision)
        || value.direction_revision < 0 || value.opening_direction === undefined) return null;
    return {
      state_id: value.state_id,
      direction_revision: value.direction_revision,
      opening_direction: isDirection(value.opening_direction) ? value.opening_direction : null,
      last_direction_operation_id: value.last_direction_operation_id ?? null,
    };
  }

  function latestChoice(pending) {
    return pending?.next ?? pending?.operation;
  }

  function isChoice(choice) {
    return isDirection(choice?.opening_direction) && typeof choice.operation_id === 'string'
      && /^[a-zA-Z0-9_-]{16,80}$/.test(choice.operation_id);
  }

  function makeOperation(choice, state) {
    return {
      ...choice,
      state_id: state?.state_id,
      expected_direction_revision: state?.direction_revision,
    };
  }

  function followUp(next, state) {
    return next ? { operation: makeOperation(next, state) } : null;
  }

  function wasAccepted(operation, state) {
    return operation.state_id === state.state_id
      && operation.expected_direction_revision + 1 === state.direction_revision
      && operation.operation_id === state.last_direction_operation_id
      && operation.opening_direction === state.opening_direction;
  }

  function create({ userKey, bookKey, isGuest, file, csrfToken, onUnsynced }) {
    const key = 'comistream_reader_direction:v1:' + userKey + ':' + bookKey;
    let state = null;
    let pending = null;
    let sending = false;

    function readLocal() {
      try {
        const value = JSON.parse(global.localStorage.getItem(key));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      } catch (_) {
        return {};
      }
    }

    function writeLocal(value) {
      try {
        global.localStorage.setItem(key, JSON.stringify(value));
      } catch (_) { /* 保存領域が使えなくてもその場で切り替えられるルン。 */ }
    }

    function persist(previous, { newChoice = false, initializing = false } = {}) {
      const local = readLocal();
      // 他のタブが後から記録した操作を、こちらの応答で消さないルン。
      if (newChoice || latestChoice(local.pending)?.operation_id === latestChoice(previous)?.operation_id) {
        local.pending = pending;
      }
      const cached = directionState(local.confirmed);
      const previousStateId = previous?.operation?.state_id;
      const sameState = cached?.state_id === state?.state_id;
      const canReplace = sameState ? cached?.direction_revision <= state?.direction_revision
        : initializing || cached?.state_id === previousStateId;
      if (state && (!cached || canReplace)) {
        local.confirmed = state;
      } else if (!state && previousStateId && cached?.state_id === previousStateId) {
        delete local.confirmed;
      }
      writeLocal(local);
    }

    async function send(operation) {
      const body = new FormData();
      body.append('mode', 'saveReadingDirection');
      body.append('file', file);
      body.append('csrf_token', csrfToken);
      body.append('state_id', operation.state_id);
      body.append('expected_direction_revision', String(operation.expected_direction_revision));
      body.append('opening_direction', operation.opening_direction);
      body.append('operation_id', operation.operation_id);
      const controller = new AbortController();
      const timer = global.setTimeout(() => controller.abort(), 2000);
      try {
        const response = await global.fetch('comistream.php', {
          method: 'POST', body, keepalive: true, signal: controller.signal,
          credentials: 'same-origin', cache: 'no-store',
        });
        const payload = await response.json();
        const saved = directionState(payload.state);
        if (response.status === 409) return { saved, conflict: true };
        if (!response.ok || !payload.ok || !saved || !wasAccepted(operation, saved)) {
          throw new Error(payload.reason || 'Reading direction unavailable');
        }
        return { saved, conflict: false };
      } finally {
        global.clearTimeout(timer);
      }
    }

    async function flush() {
      if (sending || !pending?.operation.state_id) return;
      sending = true;
      try {
        // 先行操作の受理を確認してから、待機中の最後の選択を送るルン。
        while (pending) {
          const { saved, conflict } = await send(pending.operation);
          const previous = pending;
          state = saved;
          pending = conflict ? null : followUp(previous.next, state);
          persist(previous);
          if (conflict) onUnsynced?.();
        }
      } catch (error) {
        onUnsynced?.(error);
      } finally {
        sending = false;
      }
    }

    function initialize(remote) {
      const local = readLocal();
      if (isGuest) return isDirection(local.direction) ? local.direction : null;

      const previous = local.pending;
      const operation = previous?.operation;
      const choice = latestChoice(previous);
      state = directionState(remote);
      if (!state) {
        return isChoice(choice) ? choice.opening_direction : directionState(local.confirmed)?.opening_direction;
      }
      if (isChoice(operation) && isChoice(choice) && operation.state_id === state.state_id) {
        if (operation.expected_direction_revision === state.direction_revision) pending = previous;
        else if (wasAccepted(operation, state)) pending = followUp(previous.next, state);
      }

      persist(previous, { initializing: true });
      void flush();
      // 確認済みのNULLは既定の右開きルン。
      return latestChoice(pending)?.opening_direction ?? state.opening_direction ?? 'left';
    }

    function record(direction) {
      if (isGuest) {
        writeLocal({ direction });
        return;
      }
      const choice = {
        opening_direction: direction,
        operation_id: global.crypto?.randomUUID?.()
          || 'direction_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2),
      };
      const previous = pending;
      pending = pending?.operation.state_id
        ? { operation: pending.operation, next: choice } : followUp(choice, state);
      persist(previous, { newChoice: true });
      void flush();
    }

    return { initialize, record };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.ComistreamReaderDirection = api;
})(typeof window === 'undefined' ? globalThis : window);
