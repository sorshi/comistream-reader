/* 読書位置の共有と送信待ちを全Readerで管理するルン。 */
(function readerProgressModule(global) {
  'use strict';
  const RESUME_POLICY = 'last_position';

  function create(options) {
    const writer = options.writerId || global.crypto?.randomUUID?.() ||
      'reader_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
    let storage;
    try { storage = options.storage || global.localStorage; }
    catch (_) { /* 保存領域を拒否するブラウザでも閲覧を継続するルン。 */ }
    const key = 'comistream_progress:v1:' + options.userKey + ':' + options.bookKey;
    const fetcher = options.fetch || global.fetch?.bind(global);
    const now = options.now || Date.now;
    const timers = options.timers || global;
    const compare = options.compare;
    let state = null;
    let remote = null;
    let pending = null;
    let carry = null;
    let sequence = 0;
    let timer = null;
    let flight = null;
    let refreshFlight = null;
    let needsCheck = false;
    let lastCheck = 0;
    let conflict = false;
    let closed = false;

    function readLocal() {
      try { return JSON.parse(storage?.getItem(key) || 'null'); }
      catch (_) { return null; }
    }
    function persist() {
      try { storage?.setItem(key, JSON.stringify({ version: 2, state, pending })); }
      catch (_) { /* 保存領域が使えなくても閲覧は継続するルン。 */ }
    }
    function clearTimer() {
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
    }
    function samePolicy(a, b) {
      return a && b && a.state_id === b.state_id && a.policy_epoch === b.policy_epoch;
    }
    function samePosition(a, b) {
      if (a === null || b === null || a === undefined || b === undefined) return a === b;
      try { return compare(String(a), String(b)) === 0; }
      catch (_) { return String(a) === String(b); }
    }
    async function request(mode, operation) {
      const controller = new AbortController();
      const timeout = timers.setTimeout(() => controller.abort(), 2000);
      try {
        const init = { credentials: 'same-origin', cache: 'no-store', signal: controller.signal };
        let url = options.endpoint || 'comistream.php';
        if (operation) {
          init.method = 'POST'; init.body = form(operation);
        } else url += '?mode=' + mode + '&file=' + encodeURIComponent(options.file);
        const response = await fetcher(url, init);
        const payload = await response.json();
        if (!response.ok && response.status !== 409) throw new Error(payload.reason || 'Reading position unavailable');
        if (payload.state && payload.state.resume_policy !== RESUME_POLICY) throw new Error('reader_update_required');
        return payload;
      } finally { timers.clearTimeout(timeout); }
    }
    function form(operation) {
      const data = new FormData();
      data.append('mode', 'saveReadingState'); data.append('file', options.file);
      data.append('csrf_token', options.csrfToken || '');
      // 旧タブの最大位置統合をサーバーで拒否できるよう、送信時に方式を付けるルン。
      data.append('resume_policy', RESUME_POLICY);
      for (const [name, value] of Object.entries(operation)) {
        if (value !== null && value !== undefined && !['unbased', 'legacy_policy', 'resume_policy'].includes(name)) data.append(name, String(value));
      }
      return data;
    }
    function acknowledge(snapshot, saved) {
      if (!state || saved.state_id !== state.state_id || saved.revision >= state.revision) {
        state = saved; remote = saved;
      }
      if (pending && pending.writer_id === snapshot.writer_id && pending.seq <= snapshot.seq) pending = null;
      conflict = false;
      persist();
    }
    async function refresh() {
      if (options.isGuest) return state;
      if (refreshFlight) return refreshFlight;
      refreshFlight = request('readingState').then((payload) => {
        remote = payload.state;
        lastCheck = now(); needsCheck = false;
        return remote;
      }).finally(() => { refreshFlight = null; });
      return refreshFlight;
    }
    async function initialize() {
      const local = readLocal();
      if (local?.version === 1 || local?.version === 2) {
        pending = local.pending || null;
        // 旧方式の未確認操作は、読者が選ぶまで再送しないルン。
        if (pending && local.version === 1) pending = { ...pending, legacy_policy: true };
      }
      if (options.isGuest) {
        state = local?.state || { state_id: 'guest', revision: 0, policy_epoch: 0,
          has_read: false, locator: options.legacyLocator || null, total_units: options.totalUnits || null };
        pending = null; persist(); return state;
      }
      try {
        state = await refresh();
        if (pending) {
          sequence = pending.writer_id === writer ? pending.seq : 0;
          if (pending.state_id === state.state_id && state.last_writer_id === pending.writer_id && state.last_writer_seq >= pending.seq) {
            pending = null;
          } else if (!pending.unbased && !pending.legacy_policy && samePolicy(pending, state)
              && (pending.expected_revision === state.revision ||
                (state.last_writer_id === pending.writer_id && pending.expected_revision >= state.writer_base_revision))) {
            await flush();
          } else { conflict = true; needsCheck = true; }
        }
        persist(); return state;
      } catch (error) {
        options.onError?.(error); state = local?.state || null; needsCheck = true;
        return state;
      }
    }
    function record(locator, detail = {}) {
      if (closed || locator === null || locator === undefined) return;
      locator = String(locator);
      const currentPending = carry || pending;
      if (pending && samePosition(pending.locator, locator) && !detail.completed) return;
      if (!pending && state && samePosition(state.locator, locator) && !detail.completed) return;
      const completion = detail.completed ? locator : currentPending?.completion_locator;
      const seq = ++sequence;
      if (options.isGuest) {
        const read = state.has_read || Boolean(completion);
        state = { ...state, has_read: read, revision: state.revision + 1,
          locator };
        carry = null; persist(); return;
      }
      pending = { state_id: state?.state_id, policy_epoch: state?.policy_epoch,
        expected_revision: currentPending?.expected_revision ?? state?.revision,
        writer_id: writer, seq, locator,
        completion_locator: completion || null,
        completion_seq: completion ? (detail.completed || currentPending?.writer_id !== writer ? seq : currentPending.completion_seq) : null,
        page: detail.page || 1, unbased: !state };
      carry = null; persist();
      if (detail.immediate || detail.completed || options.isStart?.(locator)) void flush();
      else if (timer === null) timer = timers.setTimeout(() => { timer = null; void flush(); }, 5000);
    }
    async function flush(retry = true) {
      clearTimer();
      if (options.isGuest || !pending || pending.unbased || pending.legacy_policy || conflict || needsCheck || closed) return !pending;
      if (flight) { await flight; return pending && !conflict ? flush(retry) : !pending; }
      const snapshot = { ...pending };
      flight = request('saveReadingState', snapshot).then(async (payload) => {
        if (payload.result !== 'conflict' && payload.ok) {
          acknowledge(snapshot, payload.state); return true;
        }
        remote = payload.state || null;
        conflict = true; needsCheck = true;
        // 前後どちらの競合も、読者の確認なしで更新番号を付け替えないルン。
        return false;
      }).catch((error) => { options.onError?.(error); return false; }).finally(() => { flight = null; });
      const success = await flight;
      if (!success && !conflict && pending && retry) return flush(false);
      if (pending && !conflict && timer === null) timer = timers.setTimeout(() => { timer = null; void flush(false); }, 5000);
      return success && !pending;
    }
    function beacon() {
      if (options.isGuest || !pending || pending.unbased || pending.legacy_policy || conflict || needsCheck) return false;
      persist();
      return (options.sendBeacon || global.navigator?.sendBeacon?.bind(global.navigator))?.(options.endpoint || 'comistream.php', form(pending)) || false;
    }
    async function beforeNavigation() {
      if (options.isGuest) return true;
      try {
        let latest = needsCheck || now() - lastCheck >= 60000 || !remote ? await refresh() : remote;
        if (state && latest.state_id === state.state_id && latest.revision < state.revision) latest = state;
        const position = String(options.getPosition());
        const changed = !state || !samePolicy(state, latest) || latest.revision > state.revision;
        const foreign = latest.last_writer_id !== writer;
        const shouldAsk = (conflict || (changed && foreign)) && latest.locator !== null &&
          (!samePosition(latest.locator, position) || conflict);
        if (shouldAsk) {
          clearTimer();
          const move = await options.confirm(latest);
          const oldPending = pending;
          pending = null; conflict = false;
          if (!move && samePolicy(oldPending, latest)) carry = { ...oldPending, expected_revision: latest.revision };
          state = latest; persist();
          if (move) { await options.moveTo(latest.locator); return false; }
        } else {
          if (!samePolicy(state, latest)) { pending = null; carry = null; conflict = false; }
          else if (pending && latest.revision > state.revision) {
            clearTimer();
            carry = { ...pending, expected_revision: latest.revision };
          }
          state = latest; persist();
        }
        return true;
      } catch (error) { options.onError?.(error); needsCheck = true; return true; }
    }
    function bindLifecycle(target = global, document = global.document) {
      const wake = () => { needsCheck = true; void refresh().catch((error) => options.onError?.(error)); };
      target.addEventListener?.('focus', wake);
      target.addEventListener?.('pageshow', wake);
      target.addEventListener?.('online', wake);
      target.addEventListener?.('pagehide', beacon);
      document?.addEventListener?.('visibilitychange', () => {
        if (document.visibilityState === 'hidden') beacon(); else wake();
      });
    }
    async function finish() {
      const saveAfterRefresh = async () => {
        // 復帰時の確認が済むまで待ち、保存を試す前に未同期扱いしないルン。
        if (!options.isGuest && pending && !pending.unbased && !pending.legacy_policy && !conflict && !closed && needsCheck) {
          try { await refresh(); }
          catch (error) { options.onError?.(error); return false; }
        }
        // 取得後も既存のrevisionで送り、別端末との競合判定を保つルン。
        return flush();
      };
      let deadline;
      const result = await Promise.race([saveAfterRefresh(), new Promise((resolve) => {
        deadline = timers.setTimeout(() => resolve(false), 2000);
      })]);
      timers.clearTimeout(deadline);
      if (!result && pending) { beacon(); options.onUnsynced?.(); }
      return result;
    }
    return { initialize, record, flush, beacon, beforeNavigation, bindLifecycle, finish,
      getState: () => state, getPending: () => pending,
      getRestoreLocator: () => pending?.locator ?? state?.locator ?? null, refresh, samePosition };
  }

  const api = { create };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.ComistreamReaderProgress = api;
})(typeof window === 'undefined' ? globalThis : window);
