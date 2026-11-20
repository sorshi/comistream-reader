/**
 * Comistream Reader - Core JavaScript
 *
 * Comistream Reader のコア機能を提供するJavaScriptファイル。
 * ページめくり、画像プリロード、ビューワー制御などの
 * フロントエンド機能を実装しています。
 *
 * @package     sorshi/comistream-reader
 * @author      Comistream Project.
 * @copyright   2024 Comistream Project.
 * @license     AGPL-3.0-only for Comistream Reader project-specific portions; see repository-root LICENSING.md
 * @version     1.1.0
 *
 * 主な機能:
 * - ページめくり制御
 * - 画像プリロード
 * - 自動ページ分割
 * - フルスクリーン制御
 * - キーボードショートカット
 * - タッチ操作対応
 */

/**
 * Image要求を共有し、現在表示・近い先読みの順に補充するルン。
 * ブラウザのキャッシュ再利用を促す仕組みで、オフライン保持の保証ではないルン。
 */
class PreCache {
  constructor() {
    this.packetSaving = typeof size !== "undefined" && size === "comp";
    this.imageCache = new Map();
    this.records = new Map();
    this.active = new Map();
    this.timingPending = new Map();
    this.failedImages = new Set();
    this.onChange = null;
    this.maxCacheEntries = 80;
    this.maxBytes = 64 * 1024 * 1024;
    this.maxPixels = 96000000;
    this.readTimes = [];
    this.readySamples = [];
    this.networkSamples = [];
    this.failures = [];
    this.readPages = 0;
    this.readSeconds = 0;
    this.readFrontier = 0;
    this.viewedRanges = [];
    this.budgetLimit = 2 * 1024 * 1024;
    this.budgetHighWater = this.budgetLimit;
    this.budgetBalance = this.budgetLimit;
    this.view = null;
    this.presentation = null;
    this.intent = null;
    this.enabled = false;
    this.hidden = Boolean(document.hidden);
    this.closing = false;
    this.pumping = false;
    this.wakeTimer = null;
    this.lastActivity = performance.now();
    this.lastShrinkAt = this.lastActivity;
    this.lastPressureAt = this.lastActivity;
    this.performanceTarget = 0;
    this.unstableUntil = 0;
    this.slowUntil = 0;
    this.parallelPenaltyUntil = 0;
    this.globalRetryAt = 0;
    this.globalFailures = 0;
    this.supplyPeriods = [];
    this.demandSince = null;
    this.target = 0;
    this.size = this.packetSaving ? 2 : 21;
    this.wanted = new Map();
    this.transferMeter = new ImageTransferMeter(
      () => this.onChange?.(), (request) => this.observeTransfer(request)
    );
  }

  normalizeUrl(url) {
    try { return new URL(url, document.baseURI).href; }
    catch (_) { return url; }
  }

  estimate() {
    const now = performance.now();
    this.networkSamples = this.networkSamples.filter(sample => now - sample.end < 120000 && !sample.request.ambiguous);
    this.readySamples = this.readySamples.filter(sample => now - sample.end < 120000 && sample.cached !== true);
    const fallback = typeof averagePageKBytes !== "undefined" && Number.isFinite(averagePageKBytes) && averagePageKBytes > 0
      ? averagePageKBytes * 1000 : 1024 * 1024;
    const bytes = preloadQuantile(this.networkSamples.map(sample => sample.bytes), 0.75) || fallback;
    const dimensions = [...this.records.values()].filter(record => record.pixels > 0).map(record => record.pixels);
    const pixels = preloadQuantile(dimensions, 0.75) || 6000000;
    const read = preloadQuantile(this.readTimes, 0.3) || 5;
    const measured = this.transferMeter.getLastMeasurement();
    const kbps = measured.stale ? null : measured.kbps;
    const wait = preloadQuantile(this.networkSamples.map(sample => sample.wait), 0.9);
    const loads = this.transferMeter.observer ? this.networkSamples : this.readySamples;
    const load = preloadQuantile(loads.map(sample => sample.duration), 0.9);
    const transfer = kbps > 0 ? bytes * 8 / (kbps * 1000) : null;
    const ready = Math.max(load || 0, transfer === null ? 0 : (wait || 0) + transfer) || 2;
    return { bytes, pixels, read, kbps, ready, known: loads.length >= 3 || kbps > 0 };
  }

  plan() {
    const now = performance.now();
    const metrics = this.estimate();
    const pressure = metrics.known && (metrics.ready > metrics.read / 2 ||
      (metrics.kbps > 0 && metrics.kbps / (metrics.bytes * 8 / metrics.read / 1000) < 1.5));
    if (pressure) {
      this.slowUntil = Math.max(this.slowUntil, now + 120000);
      this.lastPressureAt = now;
    }
    const horizon = now < this.unstableUntil ? 180 :
      (pressure || now < this.slowUntil ? 120 : (metrics.known ? 60 : 90));
    const result = calculatePreloadPlan({ ...metrics, horizon, packetSaving: this.packetSaving,
      readPages: this.readPages, readSeconds: this.readSeconds });
    if (!this.packetSaving) {
      if (result.target >= this.performanceTarget) this.performanceTarget = result.target;
      else if (metrics.known && now - this.lastPressureAt >= 120000 && now - this.lastShrinkAt >= 30000) {
        this.performanceTarget = Math.max(result.target, this.performanceTarget - 2);
        this.lastShrinkAt = now;
      }
      result.target = this.performanceTarget;
    }
    if (result.budget > this.budgetHighWater) {
      this.budgetBalance += result.budget - this.budgetHighWater;
      this.budgetHighWater = result.budget;
    }
    this.budgetLimit = result.budget;
    this.budgetBalance = Math.min(this.budgetBalance, this.budgetLimit);
    result.parallel = this.packetSaving || !metrics.known || now < this.parallelPenaltyUntil ||
      this.globalFailures > 0 || metrics.ready > metrics.read / 2 ? 1 : 2;
    return { ...metrics, ...result };
  }

  getSize() { return this.size; }
  getBps() { return this.transferMeter.getKbps(); }
  getNetworkSpeed() { return this.transferMeter.getLastMeasurement(); }
  getStatus(url) {
    url = this.normalizeUrl(url);
    if (this.imageCache.has(url)) return "loaded";
    if (this.active.has(url)) return "loading";
    return this.failedImages.has(url) ? "failed" : "empty";
  }

  // 手動の範囲指定にも同じ待ち行列を使うルン。
  resize(count) { this.fixedTarget = Math.max(0, Math.floor(count)); this.replan(); }
  add(url) { return this.request(url, false); }

  request(url, foreground = false) {
    url = this.normalizeUrl(url);
    let record = this.records.get(url);
    if (this.imageCache.has(url)) return Promise.resolve(this.imageCache.get(url));
    if (this.closing) return Promise.resolve(null);
    if (!record) {
      record = { url, status: "empty", attempts: 0, retryAt: 0, bytes: 0, pixels: 0, credited: false };
      this.records.set(url, record);
    }
    record.foreground ||= foreground;
    if (!record.promise) {
      record.promise = new Promise(resolve => { record.resolve = resolve; });
      record.status = "queued";
    }
    const promise = record.promise;
    this.pump();
    return promise;
  }

  backgroundAllowed() {
    return !this.closing && !this.hidden && !this.backgroundPaused && (!this.view || (this.enabled && this.view.ready)) &&
      (!this.packetSaving || performance.now() - this.lastActivity < 30000);
  }

  prepareView(start, end, maximum, urlForPage) {
    this.view = { start, end, maximum, urlForPage, ready: false };
    // 大きく移動した後に、古い範囲の完了待ちを残さないルン。
    for (const attempt of [...this.active.values()]) {
      if (!this.isVisible(attempt.record.url) && !this.isUpcoming(attempt.record.url, 72)) this.cancel(attempt);
    }
    for (const record of this.records.values()) {
      if (record.status === "queued" && record.foreground && !this.isVisible(record.url) &&
          !this.isUpcoming(record.url, 1)) this.resolve(record, null);
    }
  }

  recordPageTurn(target) {
    const now = performance.now();
    this.intent = { target, at: now, presentation: this.presentation };
    if (now - this.lastActivity >= 120000) this.resetReading();
    this.lastActivity = now;
  }

  resetReading() {
    this.readPages = 0; this.readSeconds = 0;
    this.readFrontier = this.view?.end || 0;
  }

  present(ready = true, navigation = false) {
    if (!this.view) return;
    const now = performance.now();
    const previous = this.intent?.presentation;
    const target = this.intent?.target;
    if (navigation && previous && previous.valid) {
      const elapsed = (this.intent.at - previous.at) / 1000;
      if (target === previous.end + 1 && this.view.end > previous.end && elapsed >= 0.5 && elapsed <= 120) {
        const consumed = previous.end - previous.start + 1;
        this.readTimes.push(Math.min(120, Math.max(2, elapsed / consumed)));
        this.readTimes = this.readTimes.slice(-12);
        if (this.view.end > this.readFrontier) {
          this.readPages += this.view.end - previous.end;
          this.readSeconds += Math.min(15, elapsed);
        }
      } else if (Math.abs(target - previous.start) > 3) this.resetReading();
    }
    this.intent = null;
    if (navigation || !this.presentation || this.presentation.start !== this.view.start || this.presentation.end !== this.view.end) {
      this.presentation = { start: this.view.start, end: this.view.end, at: now, ready, valid: ready && !this.hidden };
    } else if (!navigation) {
      // 回転や表示方式の変更に費やした区間を読書速度へ混ぜないルン。
      this.presentation.at = now;
      this.presentation.ready = ready;
      this.presentation.valid = false;
    }
    this.readFrontier = Math.max(this.readFrontier, this.view.end);
    this.view.ready = true;
    this.creditVisible();
    this.replan();
  }

  creditVisible() {
    if (!this.view || this.hidden) return;
    for (let page = this.view.start; page <= this.view.end; page++) {
      const record = this.records.get(this.normalizeUrl(this.view.urlForPage(page)));
      if (record) record.page = page;
      if (record?.status === "loaded" && this.markViewed(page)) this.credit(record);
    }
  }

  markViewed(page) {
    if (this.viewedRanges.some(([start, end]) => page >= start && page <= end)) return false;
    const merged = [];
    for (const range of [...this.viewedRanges, [page, page]].sort((a, b) => a[0] - b[0])) {
      const last = merged[merged.length - 1];
      if (last && range[0] <= last[1] + 1) last[1] = Math.max(last[1], range[1]);
      else merged.push(range);
    }
    // 極端な飛び読みでも履歴を有限にし、不明な古い範囲へ予算を再付与しないルン。
    if (merged.length > 128) merged.splice(0, 2, [merged[0][0], merged[1][1]]);
    this.viewedRanges = merged;
    return true;
  }

  credit(record) {
    if (!record || record.credited || record.status !== "loaded") return;
    record.credited = true;
    if (this.packetSaving) this.budgetBalance = Math.min(this.budgetLimit,
      this.budgetBalance + (record.bytes || this.estimate().bytes));
  }

  isVisible(url) {
    if (!this.view) return false;
    for (let page = this.view.start; page <= this.view.end; page++) {
      if (this.normalizeUrl(this.view.urlForPage(page)) === url) return true;
    }
    return false;
  }

  isUpcoming(url, count = this.size) {
    if (!this.view) return false;
    for (let page = this.view.end + 1; page <= Math.min(this.view.maximum, this.view.end + count); page++) {
      if (this.normalizeUrl(this.view.urlForPage(page)) === url) return true;
    }
    return false;
  }

  replan() {
    if (this.closing) return;
    const plan = this.plan();
    this.target = this.fixedTarget ?? plan.target;
    this.wanted.clear();
    if (this.view) {
      // 表示中と取得予定を予算へ先に割り当て、同じ遠方画像の取得・解放を防ぐルン。
      let bytes = 0, pixels = 0, count = 0, remaining = this.budgetBalance;
      for (let page = this.view.start; page <= this.view.end; page++) {
        const record = this.records.get(this.normalizeUrl(this.view.urlForPage(page)));
        bytes += record?.bytes || plan.bytes;
        pixels += record?.pixels || plan.pixels;
        count++;
      }
      for (let page = this.view.end + 1; page <= Math.min(this.view.maximum, this.view.end + this.target); page++) {
        const url = this.normalizeUrl(this.view.urlForPage(page));
        const record = this.records.get(url);
        const cost = { bytes: record?.bytes || plan.bytes, pixels: record?.pixels || plan.pixels };
        if (bytes + cost.bytes > this.maxBytes || pixels + cost.pixels > this.maxPixels || count >= this.maxCacheEntries) break;
        if (this.packetSaving && !this.imageCache.has(url) && !this.active.has(url)) {
          if (cost.bytes > remaining) break;
          remaining -= cost.bytes;
        }
        this.wanted.set(url, page);
        bytes += cost.bytes; pixels += cost.pixels; count++;
      }
      this.size = this.wanted.size;
      if (this.view.ready && !this.hidden && !this.backgroundPaused) {
        for (let page = this.view.start; page <= this.view.end; page++) {
          const record = this.records.get(this.normalizeUrl(this.view.urlForPage(page)));
          if (record && ["failed", "empty"].includes(record.status) && !record.promise) {
            record.foreground = true;
            record.promise = new Promise(resolve => { record.resolve = resolve; });
            record.status = "queued";
          }
        }
      }
      for (const record of this.records.values()) {
        if (record.status === "queued" && !record.foreground && !this.wanted.has(record.url)) this.resolve(record, null);
      }
      if (this.backgroundAllowed()) for (const [url, page] of this.wanted) {
        let record = this.records.get(url);
        if (!record) {
          record = { url, page, status: "empty", attempts: 0, retryAt: 0, bytes: 0, pixels: 0, credited: false };
          this.records.set(url, record);
        }
        record.page = page;
        if (!this.imageCache.has(url) && !record.promise) {
          record.promise = new Promise(resolve => { record.resolve = resolve; });
          record.status = "queued";
        }
      }
    } else this.size = this.target;
    this.evictOldEntries();
    this.pump();
    this.onChange?.();
  }

  enable() {
    this.enabled = true;
    this.replan();
    return Promise.all([...this.wanted.keys()].map(url => this.records.get(url)?.promise));
  }

  usage() {
    let bytes = 0, pixels = 0;
    for (const url of this.imageCache.keys()) {
      const record = this.records.get(url);
      bytes += record?.bytes || 0; pixels += record?.pixels || 0;
    }
    for (const attempt of this.active.values()) { bytes += attempt.bytes; pixels += attempt.pixels; }
    return { bytes, pixels, count: this.imageCache.size + this.active.size };
  }

  evictOldEntries(extra = { bytes: 0, pixels: 0, count: 0 }) {
    const distance = url => {
      if (this.isVisible(url)) return -Infinity;
      const page = this.records.get(url)?.page;
      if (!this.view || !Number.isFinite(page)) return Infinity;
      if (page < this.view.start - 4) return 10000 + this.view.start - page;
      if (page < this.view.start) return 1000 + this.view.start - page;
      return page - this.view.end;
    };
    const candidates = [...this.imageCache.keys()].sort((a, b) => distance(b) - distance(a));
    let used = this.usage();
    for (const url of candidates) {
      if (used.count + extra.count <= this.maxCacheEntries && used.bytes + extra.bytes <= this.maxBytes && used.pixels + extra.pixels <= this.maxPixels) break;
      if (this.isVisible(url)) continue;
      const record = this.records.get(url);
      this.imageCache.delete(url);
      if (record) { record.status = "empty"; record.image = null; }
      used = this.usage();
    }
    // 本文画像・未完了要求を残し、古い診断用メタデータだけ上限付きで捨てるルン。
    for (const [url, record] of this.records) {
      if (this.records.size <= 256) break;
      if (!record.promise && !this.imageCache.has(url) && !this.wanted.has(url)) this.records.delete(url);
    }
  }

  resolve(record, image) {
    const resolve = record.resolve;
    record.resolve = null;
    record.promise = null;
    record.foreground = false;
    if (record.status === "queued") record.status = "empty";
    resolve?.(image);
  }

  cancel(attempt) {
    if (this.active.get(attempt.record.url) !== attempt) return;
    attempt.cancelled = true;
    attempt.image.onload = null;
    attempt.image.onerror = null;
    clearTimeout(attempt.timer);
    this.active.delete(attempt.record.url);
    this.transferMeter.finish(attempt.transfer, false);
    attempt.image.removeAttribute("src");
    attempt.image = null;
    attempt.record.status = "empty";
    this.resolve(attempt.record, null);
  }

  pump() {
    if (this.pumping || this.closing) return;
    this.pumping = true;
    clearTimeout(this.wakeTimer);
    this.wakeTimer = null;
    try {
      const now = performance.now();
      const plan = this.plan();
      const queue = [...this.records.values()].filter(record => record.status === "queued")
        .sort((a, b) => Number(b.foreground) - Number(a.foreground) || (a.page ?? 0) - (b.page ?? 0));
      const foreground = queue.some(record => record.foreground);
      if (foreground && this.active.size >= 2) {
        const expendable = [...this.active.values()].filter(attempt => !attempt.record.foreground)
          .sort((a, b) => (b.record.page ?? Infinity) - (a.record.page ?? Infinity));
        if (expendable.length) this.cancel(expendable[0]);
      }
      let nextWake = Infinity;
      let demand = false;
      for (const [attempt, deadline] of this.timingPending) {
        if (deadline <= now) this.timingPending.delete(attempt);
        else nextWake = Math.min(nextWake, deadline);
      }
      for (const record of queue) {
        if (!record.promise) continue;
        if (this.hidden || (!record.foreground && (!this.backgroundAllowed() || foreground))) continue;
        if (!record.foreground && this.timingPending.size) continue;
        if (!record.foreground && this.packetSaving && (record.bytes || plan.bytes) > this.budgetBalance) continue;
        demand = true;
        const retryAt = Math.max(record.retryAt, record.foreground ? 0 : this.globalRetryAt);
        if (retryAt > now) { nextWake = Math.min(nextWake, retryAt); continue; }
        if (this.active.size >= (record.foreground ? 2 : plan.parallel)) continue;
        const bytes = record.bytes || plan.bytes;
        const pixels = record.pixels || plan.pixels;
        if (!record.foreground) {
          if (this.packetSaving && bytes > this.budgetBalance) continue;
          this.evictOldEntries({ bytes, pixels, count: 1 });
          const used = this.usage();
          if (used.count >= this.maxCacheEntries || used.bytes + bytes > this.maxBytes || used.pixels + pixels > this.maxPixels) continue;
        }
        this.start(record, { bytes, pixels, timeout: plan.timeout });
      }
      this.trackDemand(!this.hidden && !this.backgroundPaused &&
        (demand || [...this.active.values()].some(attempt => !attempt.record.foreground)));
      if (this.packetSaving && this.backgroundAllowed()) nextWake = Math.min(nextWake, this.lastActivity + 30000);
      if (Number.isFinite(nextWake) && (!this.hidden || foreground)) {
        this.wakeTimer = setTimeout(() => this.replan(), Math.max(1, nextWake - now));
      }
    } finally { this.pumping = false; }
  }

  start(record, estimate) {
    const image = new Image();
    const attempt = { record, image, ...estimate, start: performance.now(), foreground: record.foreground,
      retry: record.attempts > 0, parallel: this.active.size + 1, charge: 0 };
    record.status = "loading";
    this.failedImages.delete(record.url);
    if (this.packetSaving && !record.foreground) {
      attempt.charge = estimate.bytes;
      this.budgetBalance -= attempt.charge;
    }
    this.active.set(record.url, attempt);
    for (const running of this.active.values()) running.parallel = Math.max(running.parallel, this.active.size);
    const finish = (success, timeout = false) => {
      if (this.active.get(record.url) !== attempt) return;
      image.onload = null;
      image.onerror = null;
      clearTimeout(attempt.timer);
      this.active.delete(record.url);
      attempt.end = performance.now();
      attempt.duration = (attempt.end - attempt.start) / 1000;
      attempt.success = success;
      attempt.image = null;
      if (success) {
        record.status = "loaded";
        record.image = image;
        record.bytes = record.bytes || estimate.bytes;
        record.pixels = (image.naturalWidth || image.width || 0) * (image.naturalHeight || image.height || 0) || estimate.pixels;
        this.imageCache.set(record.url, image);
        record.attempts = 0; record.retryAt = 0;
        if (!this.transferMeter.observer) { this.globalFailures = 0; this.globalRetryAt = 0; }
        if (attempt.duration >= 0.005) this.readySamples.push(attempt);
        this.readySamples = this.readySamples.slice(-20);
        // Observerの通知を少し待ち、実サイズで残高を直してから次を取得するルン。
        // キャッシュ等で通知が来なくても50msで補充を再開するルン。
        if (this.transferMeter.observer) this.timingPending.set(attempt, attempt.end + 50);
      } else {
        record.status = "failed";
        record.attempts++;
        const backoff = Math.min(30000, 1000 * 2 ** Math.min(5, record.attempts - 1));
        record.retryAt = attempt.end + backoff * (0.9 + Math.random() * 0.2);
        this.failedImages.add(record.url);
        while (this.failedImages.size > this.maxCacheEntries) this.failedImages.delete(this.failedImages.values().next().value);
        this.failures = this.failures.filter(failure => attempt.end - failure.at < 30000);
        this.failures.push({ url: record.url, at: attempt.end });
        if (timeout || new Set(this.failures.map(failure => failure.url)).size >= 2) {
          this.unstableUntil = attempt.end + 300000;
          this.lastPressureAt = attempt.end;
          this.globalFailures++;
          this.globalRetryAt = attempt.end + Math.min(30000, 1000 * 2 ** Math.min(5, this.globalFailures - 1));
        }
        if (timeout) image.removeAttribute("src");
      }
      this.transferMeter.finish(attempt.transfer, success);
      this.resolve(record, success ? image : null);
      this.evictOldEntries();
      this.replan();
      if (success && this.isVisible(record.url) && this.view.ready &&
          (attempt.retry || !this.presentation?.ready)) this.onVisibleReady?.();
    };
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    attempt.timer = setTimeout(() => finish(false, true), estimate.timeout);
    attempt.transfer = this.transferMeter.begin(record.url, !record.foreground);
    if (attempt.transfer) attempt.transfer.attempt = attempt;
    image.src = record.url;
    this.onChange?.();
  }

  observeTransfer(request) {
    const attempt = request.attempt;
    const entry = request.entry;
    if (!attempt || !attempt.success || request.ambiguous || !entry) return;
    this.timingPending.delete(attempt);
    const bytes = entry.encodedBodySize;
    if (!Number.isFinite(bytes) || bytes <= 0) return;
    const record = attempt.record;
    const cached = entry.transferSize === 0 || entry.transferSize === 300 || entry.deliveryType === "cache";
    const network = Number.isFinite(entry.transferSize) && entry.transferSize > 300 && entry.transferSize >= bytes &&
      !(entry.workerStart > 0) && (entry.responseStatus === undefined || (entry.responseStatus >= 200 && entry.responseStatus < 300));
    attempt.cached = cached;
    if (cached || network) {
      record.bytes = bytes;
      if (attempt.charge) this.budgetBalance = Math.min(this.budgetLimit, this.budgetBalance + attempt.charge - (cached ? 0 : bytes));
    }
    let responseStart = entry.responseStart;
    if (Number.isFinite(entry.finalResponseHeadersStart) && entry.finalResponseHeadersStart >= responseStart && entry.finalResponseHeadersStart < entry.responseEnd) {
      responseStart = entry.finalResponseHeadersStart;
    }
    if (network && Number.isFinite(entry.requestStart) && entry.requestStart > 0 && entry.requestStart >= entry.startTime &&
        Number.isFinite(responseStart) && Number.isFinite(entry.responseEnd) &&
        !(entry.firstInterimResponseStart > 0 && !(entry.finalResponseHeadersStart >= entry.responseStart)) &&
        responseStart >= entry.requestStart && entry.responseEnd > responseStart && entry.responseEnd <= request.end) {
      this.networkSamples.push({ request, bytes, wait: (responseStart - entry.requestStart) / 1000,
        duration: attempt.duration, start: attempt.start, end: attempt.end, parallel: attempt.parallel });
      this.networkSamples = this.networkSamples.slice(-20);
      this.globalFailures = 0;
      this.globalRetryAt = 0;
      const solo = this.networkSamples.filter(sample => sample.parallel === 1);
      const parallel = this.networkSamples.filter(sample => sample.parallel === 2);
      if (attempt.parallel === 2 && solo.length >= 3 && parallel.length >= 4 &&
          preloadGoodput(parallel) <= preloadGoodput(solo) * 1.1 &&
          preloadQuantile(parallel.map(sample => sample.duration), 0.9) > preloadQuantile(solo.map(sample => sample.duration), 0.9) * 1.3) {
        this.parallelPenaltyUntil = performance.now() + 60000;
      }
    }
    this.replan();
  }

  trackDemand(active) {
    const now = performance.now();
    if (active && this.demandSince === null) this.demandSince = now;
    if (!active && this.demandSince !== null) {
      this.supplyPeriods.push({ start: this.demandSince, end: now });
      this.demandSince = null;
    }
    this.supplyPeriods = this.supplyPeriods.filter(period => now - period.end < 60000).slice(-64);
    const periods = this.demandSince === null ? this.supplyPeriods : [...this.supplyPeriods, { start: this.demandSince, end: now }];
    const seconds = periods.reduce((sum, period) => sum + Math.max(0, period.end - Math.max(now - 60000, period.start)), 0) / 1000;
    const completed = this.networkSamples.filter(sample => now - sample.end < 60000).length;
    const read = preloadQuantile(this.readTimes, 0.3) || 5;
    if (seconds >= 20 && completed >= 2 && completed / seconds < 1 / read) this.slowUntil = now + 120000;
  }

  setHidden(hidden) {
    this.hidden = hidden;
    if (this.presentation) this.presentation.valid = false;
    if (hidden) {
      clearTimeout(this.wakeTimer);
      this.trackDemand(false);
    } else {
      if (performance.now() - this.lastActivity >= 120000) this.resetReading();
      this.lastActivity = performance.now();
      if (this.presentation) { this.presentation.at = this.lastActivity; this.presentation.valid = false; }
      this.creditVisible();
      this.replan();
    }
  }

  pauseBackground() {
    this.backgroundPaused = true;
    clearTimeout(this.wakeTimer);
    for (const attempt of [...this.active.values()]) if (!attempt.record.foreground) this.cancel(attempt);
    this.trackDemand(false);
  }

  resume() {
    this.closing = false;
    this.backgroundPaused = false;
    this.setHidden(Boolean(document.hidden));
    this.transferMeter.refresh();
  }

  stop() {
    this.closing = true;
    clearTimeout(this.wakeTimer);
    for (const attempt of [...this.active.values()]) this.cancel(attempt);
    for (const record of this.records.values()) if (record.promise) this.resolve(record, null);
    if (this.presentation) this.presentation.valid = false;
    clearTimeout(this.transferMeter.expiryTimer);
    this.trackDemand(false);
  }
}

function preloadQuantile(values, percentile) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * percentile) - 1)];
}

function calculatePreloadPlan({ read, ready, horizon, packetSaving, readPages, readSeconds }) {
  const stage = readPages >= 20 && readSeconds >= 90 ? 3 :
    (readPages >= 10 && readSeconds >= 50 ? 2 : (readPages >= 3 && readSeconds >= 15 ? 1 : 0));
  const target = Math.max(4, Math.min(72, Math.ceil((horizon + 2 * ready) / read) + 2));
  return { target: packetSaving ? Math.min(target, [2, 3, 6, 8][stage]) : target,
    budget: [2, 3, 6, 8][stage] * 1024 * 1024,
    timeout: Math.min(90000, Math.max(20000, ready * 4000)) };
}

function preloadGoodput(samples) {
  let duration = 0, end = 0;
  for (const sample of samples.slice().sort((a, b) => a.start - b.start)) {
    duration += Math.max(0, sample.end - Math.max(end, sample.start));
    end = Math.max(end, sample.end);
  }
  return duration > 0 ? samples.reduce((sum, sample) => sum + sample.bytes, 0) / duration : 0;
}

// 先読み通信だけを観測するルン。追加通信や共有Performanceバッファの操作はしないルン。
class ImageTransferMeter {
  constructor(onChange, onTiming = () => {}) {
    this.onChange = onChange;
    this.onTiming = onTiming;
    this.requests = [];
    this.samples = [];
    this.lastMeasurement = null;
    this.maxRequests = 128;
    this.maxSamples = 8;
    this.maxAgeMs = 30000;
    this.requestMaxAgeMs = 60000;
    this.blockedUntil = 0;
    this.expiryTimer = null;
    this.observer = null;
    if (typeof PerformanceObserver === "undefined") return;
    try {
      if (PerformanceObserver.supportedEntryTypes &&
          !PerformanceObserver.supportedEntryTypes.includes("resource")) return;
      this.observer = new PerformanceObserver((list) => this.observe(list.getEntries()));
      // 過去のエントリは取得せず、要求を登録してから届く通知だけを使うルン。
      this.observer.observe({ entryTypes: ["resource"] });
    } catch (_) {
      this.observer?.disconnect();
      this.observer = null;
    }
  }

  begin(imageUrl, eligible = true) {
    if (!this.observer) return null;
    let url;
    try {
      url = new URL(imageUrl, document.baseURI).href;
    } catch (_) {
      return null;
    }
    const start = performance.now();
    this.requests = this.requests.filter((request) => start - request.start < this.requestMaxAgeMs);
    if (start < this.blockedUntil) return null;
    if (this.requests.length >= this.maxRequests) {
      // 対応記録を失った要求との取り違えを避け、上限時は計測だけを一時休止するルン。
      for (const other of this.requests) other.ambiguous = true;
      this.requests = [];
      this.blockedUntil = start + this.requestMaxAgeMs;
      this.refresh();
      return null;
    }
    const request = { url, start, eligible, end: null, success: false, ambiguous: false, entry: null };
    // 同じURLの同時ロードはまとめられることがあるので、双方とも計測から外すルン。
    for (const other of this.requests) {
      if (other.url === url && (other.end === null || other.end >= start)) {
        other.ambiguous = true;
        request.ambiguous = true;
      }
    }
    this.requests.push(request);
    if (request.ambiguous) this.refresh();
    return request;
  }

  finish(request, success) {
    if (!request || !this.requests.includes(request)) return;
    request.end = performance.now();
    request.success = success;
    this.accept(request);
    this.publish(request);
  }

  publish(request) {
    if (request.success && request.entry && !request.ambiguous && !request.published) {
      request.published = true;
      this.onTiming(request);
    }
  }

  observe(entries) {
    const now = performance.now();
    this.requests = this.requests.filter((request) => now - request.start < this.requestMaxAgeMs);
    for (const entry of entries) {
      if (entry.entryType !== "resource" || entry.initiatorType !== "img") continue;
      // src設定直後50ms以内の開始だけを対応付けるルン。遅延・合流で曖昧なら捨てるルン。
      const candidates = this.requests.filter((request) => request.url === entry.name &&
        entry.startTime >= request.start && entry.startTime - request.start <= 50 &&
        (request.end === null || entry.startTime <= request.end));
      if (candidates.length !== 1) {
        for (const request of candidates) request.ambiguous = true;
        continue;
      }
      const request = candidates[0];
      if (request.entry) {
        if (request.entry.startTime !== entry.startTime || request.entry.responseEnd !== entry.responseEnd) {
          request.ambiguous = true;
        }
        continue;
      }
      request.entry = entry;
      this.accept(request);
      this.publish(request);
    }
    this.refresh();
  }

  accept(request) {
    const entry = request.entry;
    if (!entry || request.end === null || request.counted || !request.success ||
        !request.eligible || request.ambiguous) return;
    request.counted = true;
    const bytes = entry.encodedBodySize;
    const end = entry.responseEnd;
    let start = entry.responseStart;
    // transferSizeは通信量に使わず、0のキャッシュと300の再検証を除くために使うルン。
    // https://w3c.github.io/resource-timing/#dom-performanceresourcetiming-transfersize
    if (!Number.isFinite(bytes) || bytes < 16 * 1024 ||
        !Number.isFinite(entry.transferSize) || entry.transferSize <= 300 || entry.transferSize < bytes ||
        entry.deliveryType === "cache" || entry.workerStart > 0 ||
        (entry.responseStatus !== undefined && !(entry.responseStatus >= 200 && entry.responseStatus < 300)) ||
        !Number.isFinite(entry.requestStart) || entry.requestStart < entry.startTime || entry.requestStart <= 0 ||
        !Number.isFinite(start) || start < entry.requestStart ||
        !Number.isFinite(end) || end > request.end || end <= start) return;
    // 103などの暫定応答があっても、最終応答のヘッダー開始までの待ちを含めないルン。
    const finalStart = entry.finalResponseHeadersStart;
    if (Number.isFinite(finalStart) && finalStart >= start && finalStart < end) start = finalStart;
    else if (entry.firstInterimResponseStart > 0) return;
    if (end - start < 5 || performance.now() - end >= this.maxAgeMs) return;
    this.samples.push({ request, bytes, start, end });
    this.samples.sort((a, b) => a.end - b.end);
    this.samples = this.samples.slice(-this.maxSamples);
    this.refresh(true);
  }

  refresh(updateMeasurement = false) {
    const now = performance.now();
    this.samples = this.samples.filter((sample) => !sample.request.ambiguous && now - sample.end < this.maxAgeMs);
    // 後から対応付けが曖昧になった結果は、最終値としても残さないルン。
    if (this.lastMeasurement?.samples.some((sample) => sample.request.ambiguous)) {
      this.lastMeasurement = null;
      updateMeasurement = true;
    }
    if (updateMeasurement) {
      const kbps = this.getKbps();
      if (kbps !== null) {
        this.lastMeasurement = { kbps, end: this.samples[this.samples.length - 1].end, samples: this.samples.slice() };
      }
    }
    clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    const expirations = [];
    if (this.samples.length) expirations.push(this.samples[0].end + this.maxAgeMs);
    if (this.lastMeasurement && this.lastMeasurement.end + this.maxAgeMs > now) {
      expirations.push(this.lastMeasurement.end + this.maxAgeMs);
    }
    if (expirations.length) {
      const delay = Math.max(1, Math.min(...expirations) - now);
      this.expiryTimer = setTimeout(() => this.refresh(), delay);
    }
    this.onChange();
  }

  getLastMeasurement() {
    // 集約用サンプルが期限切れになっても、最後の結果は読書中ずっと保持するルン。
    // 保持したサンプルを次回の速度計算へ戻すことはしないルン。
    return {
      kbps: this.lastMeasurement?.kbps ?? null,
      stale: this.lastMeasurement !== null && performance.now() - this.lastMeasurement.end >= this.maxAgeMs
    };
  }

  getKbps() {
    const now = performance.now();
    const samples = this.samples.filter((sample) => !sample.request.ambiguous && now - sample.end < this.maxAgeMs);
    if (samples.length < 2) return null;
    const bytes = samples.reduce((total, sample) => total + sample.bytes, 0);
    // 並列転送の受信区間は和集合にし、待ち時間・隙間・重複を分母へ足さないルン。
    const intervals = samples.slice().sort((a, b) => a.start - b.start);
    let end = 0;
    let duration = 0;
    for (const sample of intervals) {
      duration += Math.max(0, sample.end - Math.max(end, sample.start));
      end = Math.max(end, sample.end);
    }
    // 少量・短時間の測定を保留して、時計の丸めや瞬間的な揺れを抑えるルン。
    if (bytes < 128 * 1024 || duration < 50) return null;
    return Math.floor(bytes * 8 / duration);
  }
}

var preCaches = new PreCache();
preCaches.onVisibleReady = () => {
  if (readerReady && !readerRenderPending && !readerClosing) renderReaderPage("recovery");
};
var nextimage1 = new Image();
var nextimage2 = new Image();
// pageは回転で変えない読書位置、displayedStart/Endは実際の表示範囲ルン
var mode = 1;
var pageModePreference = "single";
var readerReady = false;
var readerProgressManager = null;
var readerDirectionManager = null;
var readerNavigationPending = false;
var readerNavigationPromise = null;
var readerClosing = false;
var readerLayoutPending = false;
var readerRenderId = 0;
var displayedStart = 1;
var displayedEnd = 1;
var readerRenderPending = false;
var spreadLayoutPaired = false;
var quickSpreadTimer = null;
var quickSpreadGeneration = 0;
const pageShapeCache = new Map();
var indexName = ""; // 未使用?? コードには$indexが代入されてたけど見当たらない。削除漏れ?
var tapFlag = false;
var timer;
var fixPage = 0;
var startX, endX;
var startY, endY; // 親指上スワイプ用Y座標
var isSkipPageFwdFlag = false;
var unixtime = 0;
var timeout = null;
// ページ保存制御用の変数 ルン！
var lastSaveTime = 0; // 最後にsaveCurrentPage()を実行した時刻
var savePageTimer = null; // 5秒後保存用のタイマー
var readerMarkerManager = null;
// 拡張light wide split
var req;
var autoLightSplitMode = false; //false:縦長なのでそのまま true:横長を自動分割表示
var virtratio = 100; //表示の縦比率
var imagex = 0; //画像の横幅
var imagey = 0; //画像の縦幅
var cutrate = 1; // 自動分割時の横方向分割数ルン
var als = ""; // Auto Light Split Mode使ってるかのクエリパラメータ
var autoLightSplitModeViewPosition = "right"; // 横長画像のどっち側表示しているか
var xDown = null; // 2本指スワイプダウン検出用
var yDown = null; // 2本指スワイプダウン検出用
let globalDivImageUrl = "";
var isPinching = false; // ピンチ操作中フラグ
var originalViewportContent = ""; // To store the original viewport meta tag content
var viewportRelayoutTimer = null;
var viewportDiagnosticTimer = null;
var autoLightSplitLayoutRequestId = 0;
const VIEWPORT_RELAYOUT_DEBOUNCE_MS = 200;
// const isAndroid = /Android/i.test(navigator.userAgent);

function isZoomed() {
  // visualViewportが存在しない古いブラウザでは常にfalseを返す
  if (typeof window.visualViewport === "undefined") {
    return false;
  }
  // スケールが1より大きい場合にtrueを返す (誤差を考慮)
  return window.visualViewport.scale > 1.05;
}

function logViewportSnapshot(reason) {
  if (!window.DEBUG_ENABLED || !window.ComistreamViewport) {
    return;
  }

  const snapshot = window.ComistreamViewport.createViewportSnapshot(
    window,
    document.documentElement,
    navigator,
    window.screen
  );
  debugLog(
    "Viewport state [" + reason + "]: " + JSON.stringify(snapshot)
  );
}

function scheduleViewportDiagnostics(reason) {
  if (!window.DEBUG_ENABLED) {
    return;
  }

  if (viewportDiagnosticTimer !== null) {
    clearTimeout(viewportDiagnosticTimer);
  }
  viewportDiagnosticTimer = setTimeout(function () {
    viewportDiagnosticTimer = null;
    logViewportSnapshot(reason);
  }, VIEWPORT_RELAYOUT_DEBOUNCE_MS);
}

function scheduleReaderViewportRelayout(reason) {
  // 待機中でも要求番号を進め、古い画像計測を即座に無効化するルン
  const requestId = ++autoLightSplitLayoutRequestId;

  if (viewportRelayoutTimer !== null) {
    clearTimeout(viewportRelayoutTimer);
  }
  viewportRelayoutTimer = setTimeout(function () {
    viewportRelayoutTimer = null;
    logViewportSnapshot(reason);
    void updateReaderViewport(reason, requestId);
  }, VIEWPORT_RELAYOUT_DEBOUNCE_MS);
}

window.addEventListener("keydown", funcKey);
window.addEventListener("resize", function () {
  scheduleReaderViewportRelayout("window.resize");
});

if (
  navigator.devicePosture &&
  typeof navigator.devicePosture.addEventListener === "function"
) {
  navigator.devicePosture.addEventListener("change", function () {
    scheduleReaderViewportRelayout("devicePosture.change");
  });
}

if (
  window.screen &&
  window.screen.orientation &&
  typeof window.screen.orientation.addEventListener === "function"
) {
  window.screen.orientation.addEventListener("change", function () {
    scheduleReaderViewportRelayout("screen.orientation.change");
  });
}

if (
  window.visualViewport &&
  typeof window.visualViewport.addEventListener === "function"
) {
  // visual viewportの寸法は判定せず、診断とズーム保留解除に使うルン
  window.visualViewport.addEventListener("resize", function () {
    scheduleViewportDiagnostics("visualViewport.resize");
    if (readerLayoutPending && !isZoomed()) {
      scheduleReaderViewportRelayout("zoom.end");
    }
  });
}

document.addEventListener("focusout", function () {
  if (readerLayoutPending) scheduleReaderViewportRelayout("focusout");
});
window.addEventListener("touchend", function () {
  if (readerLayoutPending) scheduleReaderViewportRelayout("touchend");
});

// 全画面モードの変更を監視するイベントリスナー ルン！
// ESCキーでの解除にも対応できるルン！
document.addEventListener("fullscreenchange", updateFullScreenButton);
document.addEventListener("webkitfullscreenchange", updateFullScreenButton);
document.addEventListener("mozfullscreenchange", updateFullScreenButton);
document.addEventListener("MSFullscreenChange", updateFullScreenButton);

window.addEventListener(
  "load",
  function () {
    const viewport = document.querySelector('meta[name="viewport"]');
    if (viewport) {
      originalViewportContent = viewport.getAttribute("content");
    }

    setTimeout(scrollTo, 0, 0, 1);
  },
  false
);

window.addEventListener(
  "touchstart",
  function (evt) {
    if (document.getElementById("suggest")?.open) return;
    const touches = evt.touches;
    if (touches.length > 1) {
      isPinching = true;
      startX = -1;
      endX = -1;
      // 2本指スワイプの開始点を記録
      xDown = touches[0].clientX;
      yDown = touches[0].clientY;
      return;
    }

    // isPinching = false; // ここではリセットしない
    // 2本指スワイプ用の座標をリセット
    xDown = null;
    yDown = null;

    if (tapFlag) {
      evt.preventDefault();
    } else if (evt.changedTouches.length == 1) {
      startX = evt.touches[0].pageX;
      startY = evt.touches[0].pageY; // 親指上スワイプ用Y座標記録
      endX = -1;
      endY = -1;
    }
  },
  { passive: false }
);

window.addEventListener(
  "touchend",
  function (evt) {
    if (document.getElementById("suggest")?.open) return;
    if (isPinching) {
      if (evt.touches.length === 0) {
        isPinching = false;
      }
      // ピンチ操作の終了なので、ページめくりやタップの処理は行わない
      startX = -1;
      endX = -1;
      startY = -1;
      endY = -1;
      xDown = null;
      yDown = null;
      return;
    }

    if (startX != -1 && endX != -1 && startY != -1 && endY != -1) {
      let deltaX = startX - endX;
      let deltaY = startY - endY;

      // Android下端ナビゲーションスワイプ対策ルン！
      // 画面の下端から上方向のスワイプはナビゲーション操作の可能性があるので無視するルン☆
      const isAndroid = /Android/i.test(navigator.userAgent);
      const bottomEdgeThreshold = 50; // 下端から50px以内をナビゲーション領域とみなすルン
      const isBottomEdgeSwipe = startY > window.innerHeight - bottomEdgeThreshold;
      if (isAndroid && isBottomEdgeSwipe && deltaY > 0) {
        // Androidの下端から上方向のスワイプは何もしないルン！
        debugLog(
          "Android bottom edge swipe detected, ignoring: startY=" +
            startY +
            " threshold=" +
            (window.innerHeight - bottomEdgeThreshold)
        );
        return;
      }

      // 親指上スワイプ判定（画面下半分での上向きスワイプ）
      if (
        startY > window.innerHeight / 2 &&
        deltaY > 50 &&
        Math.abs(deltaX) < 30
      ) {
        // 画面下半分で開始し、上向きスワイプ（50px以上）かつ横移動が少ない（30px未満）
        debugLog(
          "Thumb up swipe detected: startY=" +
            startY +
            " deltaY=" +
            deltaY +
            " deltaX=" +
            deltaX
        );
        next(); // ページ送り
      } else if (deltaX < -50) {
        leftward();
      } else if (deltaX > 50) {
        rightward();
      }
    } else {
      tapFlag = true;
      clearTimeout(timer);
      timer = setTimeout(function () {
        tapFlag = false;

        // iOS/Androidでの長押し後のタッチ無反応修正
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        if (
          isMobile &&
          document.getElementById("modal").style.display !== "block"
        ) {
          // モーダルが表示されていなければ、タッチイベントを確実に有効化
          document.body.style.pointerEvents = "auto";
        }
      }, 350);
    }

    // タッチイベント終了時に値をリセット（バグ防止）
    if (document.getElementById("modal").style.display !== "block") {
      startX = -1;
      endX = -1;
      startY = -1;
      endY = -1;
    }
  },
  { passive: false }
);

window.addEventListener(
  "touchmove",
  function (evt) {
    if (document.getElementById("suggest")?.open) return;
    // isPinching中も2本指スワイプは判定したいので、条件を変更
    // if (isZoomed()) return; // 拡大中のスワイプを許可するためコメントアウト

    // 2本指スワイプの処理
    if (evt.touches.length >= 2 && xDown !== null && yDown !== null) {
      var xUp = evt.touches[0].clientX;
      var yUp = evt.touches[0].clientY;

      var xDiff = xDown - xUp;
      var yDiff = yDown - yUp;

      if (Math.abs(xDiff) < Math.abs(yDiff)) {
        // if (yDiff < -10) {
        //   // 下向きスワイプ
        //   /* 下向きスワイプ */
        //   showInspector();
        //   // 連続で発火しないようにリセット
        //   xDown = null;
        //   yDown = null;
        // }
      }
      return; // 2本指操作中は1本指の処理をしない
    }

    // ピンチ操作が始まっていたら1本指スワイプは無効
    if (isPinching) return;
    // 1本指スワイプの処理
    if (document.getElementById("contents").style.display == "block") {
      startX = -1;
      endX = -1;
      startY = -1;
      endY = -1;
    } else {
      endX = evt.touches[0].pageX;
      endY = evt.touches[0].pageY; // 親指上スワイプ用Y座標更新
    }
  },
  { passive: false }
);

window.addEventListener(
  "gesturechange",
  function (evt) {
    isPinching = true; // ジェスチャー中はピンチ操作とみなす
    startX = -1;
    endX = -1;
    startY = -1;
    endY = -1;
  },
  { passive: false }
);

window.addEventListener("pagehide", saveCurrentPage);
window.addEventListener("pagehide", () => preCaches.stop());
window.addEventListener("pageshow", (event) => { if (event.persisted) preCaches.resume(); });
document.addEventListener("visibilitychange", () => preCaches.setHidden(Boolean(document.hidden)));
window.addEventListener("online", () => {
  // 接続通知は成功の証拠にせず、必要な画像の復旧試行を早めるだけルン。
  preCaches.globalRetryAt = 0;
  preCaches.replan();
});

// 長押しでクイック見開きモード
// https://github.com/john-doherty/long-press-event
window.addEventListener("long-press", function (e) {
  if (isPinching || isZoomed()) return;
  // stop the event from bubbling up
  e.preventDefault();

  // モバイルデバイスで長押し後の無反応状態を防止
  // iOS/Androidでの長押し後の遅延問題対策
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  debugLog("long tap:" + e.target + " isMobile:" + isMobile);

  // クイック見開きモード表示
  quickSpredView();

  // モバイルデバイスの場合の追加対策
  if (isMobile) {
    // タッチイベントを強制的に解放するためのハック
    setTimeout(function () {
      const tempDiv = document.createElement("div");
      tempDiv.style.position = "absolute";
      tempDiv.style.width = "1px";
      tempDiv.style.height = "1px";
      tempDiv.style.opacity = "0";
      document.body.appendChild(tempDiv);
      setTimeout(function () {
        document.body.removeChild(tempDiv);
      }, 100);
    }, 50);
  }
});

// 2本指スワイプダウン検出用
// document.addEventListener("touchstart", handleTouchStart, false);
// document.addEventListener("touchmove", handleTouchMove, false);

// function handleTouchStart(evt) {
//   if (isPinching) return;
//   if (evt.touches.length == 2) {
//     xDown = evt.touches[0].clientX;
//     yDown = evt.touches[0].clientY;
//   } else {
//     xDown = null;
//     yDown = null;
//   }
// }

// function handleTouchMove(evt) {
//   if (isPinching) return;
//   if (!xDown || !yDown) {
//     return;
//   }

//   var xUp = evt.touches[0].clientX;
//   var yUp = evt.touches[0].clientY;

//   var xDiff = xDown - xUp;
//   var yDiff = yDown - yUp;

//   if (Math.abs(xDiff) < Math.abs(yDiff)) {
//     if (yDiff > 0) {
//       /* 上向きスワイプ */
//     } else {
//       /* 下向きスワイプ */
//       showInspector();
//     }
//   }
//   /* 値リセット */
//   xDown = null;
//   yDown = null;
// }

document.onmousemove = function () {
  // マウスを一定時間操作してない場合はカーソル非表示に
  clearTimeout(timeout);
  if (document.body.classList.contains("cursor-hide")) {
    document.body.classList.remove("cursor-hide");
    let elements = document.querySelectorAll("td.center");
    elements.forEach((element) => {
      element.style.cursor = `var(--setting-url), help`;
    });
    elements = document.querySelectorAll("td.right, td.right-under");
    elements.forEach((element) => {
      element.style.cursor = `var(--arrowR-url), e-resize`;
    });
    elements = document.querySelectorAll("td.left, td.left-under");
    elements.forEach((element) => {
      element.style.cursor = `var(--arrowL-url), w-resize`;
    });
    elements = document.querySelectorAll("td.rightIndex");
    elements.forEach((element) => {
      element.style.cursor = `var(--nextR-url), e-resize`;
    });
    elements = document.querySelectorAll("td.leftIndex");
    elements.forEach((element) => {
      element.style.cursor = `var(--nextL-url), w-resize`;
    });
    debugLog("cursor show");
  }
  timeout = setTimeout(function () {
    document.body.classList.add("cursor-hide");
    let elements = document.querySelectorAll(
      "td.center, td.right, td.right-under, td.left, td.left-under, td.rightIndex, td.leftIndex"
    );
    elements.forEach((element) => {
      element.style.cursor = "none";
    });
    debugLog("cursor-hide");
  }, 2000);
};

window.onclick = function (event) {
  // クイック見開きモード表示時に外側クリックしたら閉じて戻る
  var overlay = document.getElementById("overlay");
  var modal = document.getElementById("modal");
  if (event.target == overlay) {
    // 巻末パネル表示中はクイック見開きへ操作を渡さないルン。
    if (document.getElementById("suggest")?.open) return;
    closeQuickSpread();
  }
};

// 端末の回転を検知して横位置ならクイック見開きモードにする
window.addEventListener("orientationchange", () => {
  scheduleReaderViewportRelayout("window.orientationchange");

  if (!readerReady || pageModePreference === "auto") return;

  // 端末の傾きを絶対値で取得する
  var direction = Math.abs(window.orientation);
  if (direction == 90) {
    // 横向きの処理
    debugLog("direction Landscape");
    quickSpredView();
  } else {
    // 縦向きの処理
    debugLog("direction Portrait");
    quickSpredView();
  }
});

window.onfocus = function () {
  // ズームレベルをリセット
  document.body.style.zoom = 1;
};

// 以下関数定義

function resetZoom() {
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport && originalViewportContent) {
    // maximum-scale=1.0 を一瞬でも適用すると Android でピンチが永久無効になるバグ回避ルン
    // initial-scale のみを指定して強制再レイアウトし、その後元に戻すルン☆
    viewport.setAttribute("content", "width=device-width, initial-scale=1.0");

    // 位置をリセット
    window.scrollTo(0, 0);

    // 元の viewport 設定に戻す（短い遅延を入れてレイアウトを安定させる）
    setTimeout(() => {
      viewport.setAttribute("content", originalViewportContent);
      if (readerLayoutPending) scheduleReaderViewportRelayout("resetZoom");
    }, 50);
  }
}

function saveCurrentPage() {
  if (readerProgressManager) {
    return readerProgressManager.beacon();
  }
  // ページ離脱時に最終ページ保存
  // タイマーが残っていたらクリアするルン！
  if (savePageTimer) {
    clearTimeout(savePageTimer);
    savePageTimer = null;
  }

  if (!readerReady) return;
  const localPage = page;
  if (page >= maxPage) {
    document.cookie = "lastCloseFile=" + baseFile + "; path=/;";
  } else {
    document.cookie = "lastCloseFile=; path=/; max-age=0";
  }
  debugLog("saveCurrentPage(); current page:" + page);
  let data = new FormData();
  data.append("mode", "close");
  data.append("file", escapedFile);
  data.append("page", localPage);
  readerProgressManager ? readerProgressManager.beacon() : navigator.sendBeacon("comistream.php", data);
}

function jump() {
  nextpage = window.prompt("移動するページを入力 (1-" + maxPage + ")", page);
  if (nextpage.match(/^[0-9]+\$/) && nextpage > 0 && nextpage <= maxPage) {
    page = nextpage;
    loadPage(1);
  }
}

function leftward() {
  if (isZoomed()) {
    resetZoom();
  }
  if (direction == "left") next();
  else back();
}

function rightward() {
  if (isZoomed()) {
    resetZoom();
  }
  if (direction == "left") back();
  else next();
}

function leftIndex() {
  if (direction == "left") nextIndex();
  else backIndex();
}

function rightIndex() {
  if (direction == "left") backIndex();
  else nextIndex();
}

let suggestRestoreFocus = null;
let suggestPanelAnimation = null;

function showSuggestPanel() {
  const panel = document.getElementById("suggest");
  if (!panel || panel.open) return;
  suggestRestoreFocus = document.activeElement;
  closeQuickSpread();
  const contents = document.getElementById("contents");
  if (contents) contents.style.display = "none";
  if (!panel.dataset.suggestBound) {
    panel.dataset.suggestBound = "1";
    let backdropPressed = false;
    const outside = (event) => {
      const rect = panel.getBoundingClientRect();
      return event.clientX < rect.left || event.clientX > rect.right
        || event.clientY < rect.top || event.clientY > rect.bottom;
    };
    panel.addEventListener("pointerdown", (event) => {
      backdropPressed = event.target === panel && outside(event);
    });
    panel.addEventListener("pointercancel", () => { backdropPressed = false; });
    panel.addEventListener("cancel", (event) => {
      event.preventDefault();
      hideSuggestPanel();
    });
    // 巻末パネルでもTOCと同じDel/Backspaceキーで一覧へ戻るルン。
    panel.addEventListener("keydown", (event) => {
      if (panel.open && !event.defaultPrevented
        && (["Delete", "Backspace"].includes(event.code) || ["Delete", "Backspace"].includes(event.key))) {
        event.preventDefault();
        event.stopPropagation();
        void backListPage();
      }
    });
    panel.addEventListener("click", (event) => {
      if (backdropPressed && event.target === panel && outside(event)) hideSuggestPanel();
      backdropPressed = false;
    });
    panel.addEventListener("close", () => {
      if (panel.open) return;
      suggestPanelAnimation?.cancel();
      if (suggestRestoreFocus?.isConnected && !suggestRestoreFocus.disabled
        && suggestRestoreFocus.getClientRects().length) {
        suggestRestoreFocus.focus({ preventScroll: true });
      }
    });
  }
  panel.showModal();
  document.getElementById("suggest-return")?.focus({ preventScroll: true });
  // EPUBと同じ演出を使い、本文復帰と一覧への終了は表示直後から操作できるルン。
  if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    suggestPanelAnimation = panel.animate([
      { opacity: 0, transform: "scale(0.85)" },
      { opacity: 1, transform: "scale(1)" },
    ], { duration: 280, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" });
  }
}

function hideSuggestPanel() {
  const panel = document.getElementById("suggest");
  if (!panel?.open) return;
  suggestPanelAnimation?.cancel();
  panel.close();
}

async function next() {
  if (document.getElementById("suggest")?.open) return;
  if (readerRenderPending) return;
  const imageElement = document.getElementById("image");
  if (
    window.ComistreamViewport.shouldPanAutoLightSplit({
      mode,
      autoLightSplitMode,
      currentPosition: imageElement.style.backgroundPosition,
      expectedPosition: "right",
    })
  ) {
    imageElement.style.backgroundPosition = "left";
    autoLightSplitModeViewPosition = "left";
  } else {
    if (displayedEnd < maxPage) {
      page = displayedEnd + 1;
      loadPage(1);
      window.scroll({ top: 0, behavior: "smooth" });
      if (autoLightSplitMode == true) {
        document.getElementById("image").style.backgroundPosition = "right";
        autoLightSplitModeViewPosition = "right";
      }
    } else {
      // 最終ページに到達した場合の処理
      debugLog(
        "next(); current page:" +
          page +
          " max page:" +
          maxPage +
          " mode:" +
          mode
      );
      // 最終ページ到達時は即座にページ位置を保存するルン！
      if (savePageTimer) {
        clearTimeout(savePageTimer);
        savePageTimer = null;
      }
      if (readerProgressManager) {
        if (!(await readerProgressManager.beforeNavigation())) return;
        readerProgressManager.record(String(maxPage), { completed: true, immediate: true });
      }
      saveCurrentPage();
      lastSaveTime = Date.now();
      debugLog("saveCurrentPage() executed on reaching last page");

      // カーテンコールアニメーションでサジェストパネルを表示するルン！
      showSuggestPanel();
    }
  }
}

function back() {
  if (document.getElementById("suggest")?.open) return;
  if (readerRenderPending) return;
  const imageElement = document.getElementById("image");
  if (
    window.ComistreamViewport.shouldPanAutoLightSplit({
      mode,
      autoLightSplitMode,
      currentPosition: imageElement.style.backgroundPosition,
      expectedPosition: "left",
    })
  ) {
    imageElement.style.backgroundPosition = "right";
    autoLightSplitModeViewPosition = "right";
  } else {
    if (displayedStart > 1) {
      page = displayedStart - 1;
      loadPage(-1);
      if (autoLightSplitMode == true) {
        document.getElementById("image").style.backgroundPosition = "left";
        autoLightSplitModeViewPosition = "left";
      }
    } else {
      debugLog(
        "back(); current page:" +
          page +
          " max page:" +
          maxPage +
          " mode:" +
          mode
      );
      if (window.confirm(window.i18n?.reader_start_confirm || "先頭ページです。リーダーを閉じますか？")) {
        backListPage();
      }
    }
  }
}

async function nextIndex() {
  if (document.getElementById("suggest")?.open) return;
  if (readerRenderPending) return false;
  const jumpStops = getChapterJumpStops();
  const pageStopFinder = window.ComistreamReaderMarkers?.findAdjacentPageStop;
  const targetPage =
    typeof pageStopFinder === "function"
      ? pageStopFinder(jumpStops, displayedStart, displayedEnd - displayedStart + 1, false)
      : jumpStops.find((stop) => displayedEnd < stop);
  if (targetPage !== null && typeof targetPage !== "undefined") {
    page = targetPage;
    loadPage(1);
    return true;
  }
  // 次のインデックスが見つからない場合の終端処理ルン
  if (page >= maxPage) {
    // 既に最終ページにいる場合はsuggestパネルを表示するルン
    if (savePageTimer) {
      clearTimeout(savePageTimer);
      savePageTimer = null;
    }
    if (readerProgressManager) {
      if (!(await readerProgressManager.beforeNavigation())) return false;
      readerProgressManager.record(String(maxPage), { completed: true, immediate: true });
    }
    saveCurrentPage();
    lastSaveTime = Date.now();
    debugLog("nextIndex() reached end at maxPage, showing suggest");
    showSuggestPanel();
  } else {
    // 最終ページへ移動するルン
    page = maxPage;
    loadPage(1);
    debugLog("nextIndex() no more index, jumped to maxPage:" + maxPage);
  }
}

function backIndex() {
  if (document.getElementById("suggest")?.open) return;
  if (readerRenderPending) return false;
  const jumpStops = getChapterJumpStops();
  const pageStopFinder = window.ComistreamReaderMarkers?.findAdjacentPageStop;
  const targetPage =
    typeof pageStopFinder === "function"
      ? pageStopFinder(jumpStops, displayedStart, displayedEnd - displayedStart + 1, true)
      : jumpStops
          .slice()
          .reverse()
          .find((stop) => displayedStart > stop);
  if (targetPage !== null && typeof targetPage !== "undefined") {
    page = targetPage;
    loadPage(1);
    return true;
  }
}

function getChapterJumpStops() {
  const markerHelpers = window.ComistreamReaderMarkers;
  if (typeof markerHelpers?.mergePageJumpStops !== "function") {
    return indexArray;
  }
  return markerHelpers.mergePageJumpStops(
    indexArray,
    readerMarkerManager?.markers,
    maxPage
  );
}

async function devicePageSync() {
  if (readerProgressManager) return readerProgressManager.beforeNavigation();
  //別デバイスでのページが読み進んでないかページ番号を返す
  debugLog(
    "devicePageSync() current page:" +
      page +
      " max page:" +
      maxPage +
      " isSkipPageFwdFlag:" +
      isSkipPageFwdFlag
  );
  if (page > 0 && !isSkipPageFwdFlag) {
    try {
      const response = await fetch(
        "comistream.php?mode=currentPage&file=" + escapedFile
      );
      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`);
      }
      let restxt = await response.text();
      let res = await parseInt(restxt);
      debugLog("devicePageSync() restxt:" + restxt);
      debugLog("devicePageSync() res:" + res);
      if (res > page && res > 1) {
        debugLog(
          "devicePageSync() res:" +
            parseInt(res) +
            " larger page:" +
            parseInt(page)
        );
        if (
          window.confirm(
            "別デバイスで" +
              parseInt(res) +
              "ページまで読み進んでいます。移動しますか？"
          )
        ) {
          page = res;
          debugLog("devicePageSync() Jump to " + parseInt(page));
          loadPage(1);
        } else {
          debugLog("devicePageSync() Jump canceled ");
          isSkipPageFwdFlag = true;
        }
      }
    } catch (error) {
      console.error(`Could not get products: ${error}`);
    }
  }
}

async function loadPage(dir, { restore = false, progressChecked = false } = {}) {
  if (readerClosing && !restore && !progressChecked) { page = prevPage; return; }
  const targetPage = Math.max(1, Math.min(maxPage, parseInt(page, 10) || 1));
  if (!restore && !progressChecked) preCaches.recordPageTurn(targetPage);
  if (readerProgressManager && !restore && !progressChecked) {
    if (readerNavigationPending) { page = prevPage; return; }
    readerNavigationPending = true;
    page = prevPage;
    readerNavigationPromise = (async () => {
      if (!(await readerProgressManager.beforeNavigation())) return;
      page = targetPage;
      // 同期確認済みのページ送りも通常の描画として先読みを補充するルン。
      await loadPage(dir, { progressChecked: true });
      const completed = !readerProgressManager.getState()?.has_read && dir >= 0 && displayedEnd >= maxPage;
      const locator = completed ? maxPage : page;
      readerProgressManager.record(String(locator), { completed, page: locator });
    })();
    try {
      await readerNavigationPromise;
      return;
    } finally { readerNavigationPending = false; readerNavigationPromise = null; }
  }
  closeQuickSpread();
  page = Math.max(1, Math.min(maxPage, parseInt(page, 10) || 1));
  autoLightSplitModeViewPosition = dir < 0 ? "left" : "right";
  debugLog("current page:" + page + " max page:" + maxPage);
  if (page == 1 || mode == 2) {
    // 表紙と見開きでは自動分割を引き継がないルン
    autoLightSplitMode = false;
  }

  if (!readerProgressManager) {
    // 既存の保存タイマーをクリアするルン！
    if (savePageTimer) {
      clearTimeout(savePageTimer);
      savePageTimer = null;
    }

    // 現在ページを保存（戻る操作、大きなページ後退、5秒以上経過時は即座に保存するルン！）
    const now = Date.now();
    const isLargeBackwardJump = prevPage - page > 3; // 3ページ以上戻った場合（最終ページ→先頭など）
    if (dir < 0 || isLargeBackwardJump) {
      // ページを戻る操作、または大きなページ後退は即座に保存するルン！
      // これでdevicePageSync()での誤判定を防ぐルン☆
      saveCurrentPage();
      lastSaveTime = now;
      debugLog(
        "saveCurrentPage() executed immediately (backward/large jump back)"
      );
    } else if (now - lastSaveTime >= 5000) {
      // 5秒以上経過していたら即座に保存するルン！
      saveCurrentPage();
      lastSaveTime = now;
      debugLog("saveCurrentPage() executed immediately (>5sec)");
    } else {
      // 5秒以内の前進はスキップして、タイマーで後で保存するルン！
      debugLog("saveCurrentPage() skipped (<5sec), will save after 5sec");
    }

    // 5秒そのページに留まったら保存するタイマーを設定するルン！
    savePageTimer = setTimeout(() => {
      saveCurrentPage();
      lastSaveTime = Date.now();
      savePageTimer = null;
      debugLog("saveCurrentPage() executed by timer (stayed 5sec)");
    }, 5000);
  }
  writeReaderStorage(file, String(page));
  prevPage = page;
  await renderReaderPage(restore ? "restore" : "navigation");
}

function readReaderStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function writeReaderStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    debugLog("Reader settings could not be saved");
  }
}

function resolveReaderMode() {
  const viewport = window.ComistreamViewport.getLayoutViewportSize(
    window, document.documentElement
  );
  return window.ComistreamViewport.resolvePageMode(pageModePreference, viewport, mode);
}

function updatePageModeButton() {
  const button = document.getElementById("pageMode");
  button.className = "button button-mode " + (mode === 2 ? "spread" : "single");
  const showSpread = pageModePreference === "auto" ? spreadLayoutPaired : mode === 2;
  const actual = showSpread ? window.i18n.toc_button_spread : window.i18n.toc_button_single;
  button.textContent = pageModePreference === "auto"
    ? window.i18n.toc_button_auto + " · " + actual : actual;
  const tooltip = pageModePreference === "auto"
    ? window.i18n.tooltip_auto_page
    : button.getAttribute(mode === 2 ? "data-tooltip-spread" : "data-tooltip-single");
  button.setAttribute("data-tooltip", tooltip);
  button.setAttribute("aria-label", button.textContent + ": " + tooltip);
}

function readerInteractionBlocksLayout() {
  const active = document.activeElement;
  const textInput = active && active.tagName === "INPUT" &&
    /^(text|search|email|number|tel|url|password)$/.test(active.type);
  return isPinching || isZoomed() || (active &&
    (active.isContentEditable || active.tagName === "TEXTAREA" || textInput));
}

async function updateReaderViewport(reason, requestId) {
  if (!readerReady || readerInteractionBlocksLayout()) {
    readerLayoutPending = true;
    return;
  }
  readerLayoutPending = false;
  const resolved = resolveReaderMode();
  if (resolved !== mode) {
    closeQuickSpread();
    mode = resolved;
    await renderReaderPage(reason);
  } else {
    await refreshAutoLightSplitLayout(reason, requestId);
  }
}

async function isWideReaderPage(number) {
  if (number < 1 || number > maxPage) return false;
  const url = getFullImageUrl(number, false);
  if (pageShapeCache.has(url)) return pageShapeCache.get(url);
  const image = await load_image(url);
  if (!image) return null;
  const wide = image.width >= image.height;
  // 画像本体を保持せず、寸法判定だけを上限付きで保存するルン
  pageShapeCache.set(url, wide);
  if (pageShapeCache.size > 256) pageShapeCache.delete(pageShapeCache.keys().next().value);
  return wide;
}

async function renderReaderPage(reason) {
  const renderId = ++readerRenderId;
  ++autoLightSplitLayoutRequestId;
  readerRenderPending = true;
  const target = page;
  const targetMode = mode;
  autoLightSplitMode = false;
  als = "";
  let layout = { start: target, end: target, paired: false };
  preCaches.prepareView(target, target, maxPage, number => getFullImageUrl(number, false));
  try {
    if (targetMode === 2) {
      const start = window.ComistreamViewport.spreadStart(target, fixPage);
      const shapes = await Promise.all([isWideReaderPage(start), isWideReaderPage(start + 1)]);
      layout = window.ComistreamViewport.resolveSpreadLayout(target, fixPage, shapes);
    }
    if (renderId !== readerRenderId || target !== page || targetMode !== mode) return;
    displayedStart = Math.max(1, layout.start);
    displayedEnd = Math.min(maxPage, layout.end);
    spreadLayoutPaired = layout.paired;
    preCaches.prepareView(displayedStart, displayedEnd, maxPage, number => getFullImageUrl(number, false));
    const visibleImages = Promise.all(Array.from({ length: displayedEnd - displayedStart + 1 },
      (_, index) => load_image(getFullImageUrl(displayedStart + index, false))));
    autoLightSplitMode = false;
    als = "";
    const first = document.getElementById("image");
    const second = document.getElementById("nextimage");
    first.style.width = layout.paired ? "50%" : "100%";
    first.style.backgroundPosition = layout.paired ? direction : "center";
    first.style.float = layout.paired ? position : "none";
    first.style.marginLeft = "0px";
    first.style.height = "100%";
    first.style.backgroundSize = "contain";
    second.style.display = layout.paired ? "block" : "none";
    second.style.backgroundPosition = position;
    second.style.float = direction;
    first.style.backgroundImage = layout.start > 0
      ? "url('" + getFullImageUrl(layout.start) + "')" : "none";
    second.style.backgroundImage = layout.paired && layout.end <= maxPage
      ? "url('" + getFullImageUrl(layout.end) + "')" : "none";
    globalDivImageUrl = getFullImageUrl(target);
    updatePageModeButton();
    if (document.getElementById("contents").style.display === "block") setSlider();
    document.getElementById("progress").style.width = (page / maxPage) * 100 + "%";
    const loadedImages = await visibleImages;
    if (renderId !== readerRenderId) return;
    if (loadedImages.every(Boolean)) await refreshAutoLightSplitLayout(reason);
    if (renderId !== readerRenderId) return;
    preCaches.present(loadedImages.every(Boolean), reason === "navigation");
  } finally {
    if (renderId === readerRenderId) {
      readerRenderPending = false;
      document.getElementById("loading").style.display = "none";
      // 読書を続けている間も、表示中の診断値を更新するルン。
      if (imageInspectorUI?.isOpen()) showInspector(true);
    }
  }
}

// 初期・通常・ジャンプ後を同じ計画で補充するルン。
function preLoadImages() {
  preCaches.replan();
}

function preLoadInitialImages() {
  return preCaches.enable();
}

async function browserCanDecodeJpegXlPage(pageNumber) {
  const image = await preCaches.request(getFullImageUrl(pageNumber, false), true);
  return Boolean(image && image.naturalWidth > 0 && image.naturalHeight > 0);
}

async function ensureJpegXlSupport() {
  if (!jpegXlProbePage) {
    return true;
  }

  if (await browserCanDecodeJpegXlPage(jpegXlProbePage)) {
    return true;
  }

  alert("ブラウザで未対応の画像フォーマットです:JPEG XL");
  window.history.back();
  return false;
}

async function restorePage() {
  if (!(await ensureJpegXlSupport())) {
    return;
  }

  const config = window.readerProgressConfig;
  if (window.ComistreamReaderProgress && config) {
    readerProgressManager = window.ComistreamReaderProgress.create({
      ...config, file: escapedFile, csrfToken: readerMarkerConfig.csrfToken,
      totalUnits: maxPage, legacyLocator: readReaderStorage(file),
      compare: (a, b) => Math.sign(Number(a) - Number(b)),
      getPosition: () => String(prevPage), isStart: (locator) => locator === "1",
      confirm: (state) => window.confirm((window.i18n.reader_sync_changed ||
        "Reading position changed to page %s on another device. Move there?").replace("%s", state.locator)),
      moveTo: async (locator) => { page = Number(locator); await loadPage(1, { restore: true }); },
      onError: (error) => debugLog("Reading position synchronization failed: " + error.message),
      onUnsynced: () => window.alert(window.i18n.reader_sync_unsaved || "Reading position is pending synchronization."),
    });
    await readerProgressManager.initialize();
    const restoreLocator = readerProgressManager.getRestoreLocator();
    if (restoreLocator) page = Number(restoreLocator);
    readerProgressManager.bindLifecycle();
  } else if (page == 1) {
    page = parseInt(readReaderStorage(file) || page, 10);
  }
  if (window.ComistreamReaderDirection && config) {
    readerDirectionManager = window.ComistreamReaderDirection.create({
      ...config, file: escapedFile, csrfToken: readerMarkerConfig.csrfToken,
      onUnsynced: (error) => {
        if (error) debugLog("Reading direction synchronization failed: " + error.message);
        if (!document.hidden) window.alert(window.i18n.reader_direction_unsaved || "The reading direction could not be synchronized.");
      },
    });
    applyReaderDirection(readerDirectionManager.initialize(readerProgressManager?.getRemoteState()) ?? direction);
  }
  pageModePreference = window.ComistreamViewport.restorePageModePreference(
    readReaderStorage("readerPageModePreference"), readReaderStorage("pagemode")
  );
  mode = resolveReaderMode();
  writeReaderStorage("readerPageModePreference", pageModePreference);
  readerReady = true;
  readerLayoutPending = false;
  await loadPage(1, { restore: true });
  if (readerProgressManager?.getPending()) await readerProgressManager.beforeNavigation();
  if (window.readerProgressConfig?.requestedPage) {
    page = window.readerProgressConfig.requestedPage;
    await loadPage(1);
  }
  if (indexName != "") {
    Array.prototype.forEach.call(
      document.getElementsByClassName("toclink"),
      function (elm) {
        if (elm.innerHTML.indexOf(indexName) != -1) {
          elm.onclick();
        }
      }
    );
  }

  // 初期ロード時に先読みを実行
  setTimeout(() => {
    preLoadInitialImages(page);
  }, global_preload_delay_ms);

  // ネットワーク速度測定
  //debugLog("precaches.measureNetworkSpeed()");
  //preCaches.measureNetworkSpeed();
  //debugLog("precaches.measureNetworkSpeed() done");

  // 最終ページでの次の巻情報取得
  sugguestbook();

  // 大きなページサイズの通知をチェック
  checkAndShowLargePageNotification();

  // 全画面ボタンの初期状態を設定するルン！
  updateFullScreenButton();

  // ツールチップの初期状態を設定するルン！
  updateModeTooltips();

  initializeImageReaderMarkers();
}

function initializeImageReaderMarkers() {
  if (readerMarkerManager || !window.ComistreamReaderMarkers) return;

  readerMarkerManager = window.ComistreamReaderMarkers.create({
    file: escapedFile,
    baseFile: baseFile,
    format: readerMarkerConfig.format,
    isGuest: readerMarkerConfig.isGuest,
    csrfToken: readerMarkerConfig.csrfToken,
    i18n: window.i18n,
    addButtonId: "image-marker-add",
    statusId: "image-marker-status",
    listId: "image-marker-list",
    sliderId: "slider",
    railId: "image-marker-rail",
    isRtl: function () {
      return direction === "left";
    },
    getCurrentMarker: function () {
      const currentPage = Math.min(maxPage, Math.max(1, parseInt(page, 10) || 1));
      return {
        format: readerMarkerConfig.format,
        locatorType: "page",
        locator: String(currentPage),
        pageNumber: currentPage,
        sectionIndex: null,
        progressFraction: maxPage > 1 ? (currentPage - 1) / (maxPage - 1) : 0,
        chapterLabel: null,
      };
    },
    navigate: function (marker) {
      return navigateToTocPage(marker.pageNumber || marker.locator);
    },
    formatPosition: function (marker) {
      return window.i18n.reader_marker_page.replace("%s", marker.pageNumber);
    },
  });
  void readerMarkerManager.init();
}

function navigateToTocPage(targetPage) {
  const normalizedPage = parseInt(targetPage, 10);
  if (
    !Number.isInteger(normalizedPage) ||
    normalizedPage < 1 ||
    normalizedPage > maxPage
  ) {
    return false;
  }
  page = normalizedPage;
  loadPage(1);
  return true;
}

function index() {
  if (document.getElementById("contents").style.display == "block") {
    document.getElementById("contents").style.display = "none";
  } else {
    document.getElementById("contents").style.display = "block";
    setSlider();
    void readerMarkerManager?.refresh();

    var slider = document.querySelector('input[type="range"]');
    slider.addEventListener(
      "input",
      function () {
        valueChange();
      },
      false
    );

    slider.addEventListener(
      "change",
      function () {
        valueChange();
        page = parseInt(document.getElementById("slider").value);
        document.getElementById("loading").style.display = "block";
        loadPage(1);
      },
      false
    );
  }
}

function setSlider() {
  document.getElementById("slider").value = page;
  valueChange();
}

function valueChange() {
  document.getElementById("value").innerHTML =
    document.getElementById("slider").value;
}

function selectPageMode(preference) {
  pageModePreference = preference;
  mode = resolveReaderMode();
  writeReaderStorage("readerPageModePreference", preference);
  writeReaderStorage("pagemode", String(mode));
  closeQuickSpread();
  void renderReaderPage("preference");
}

function togglePageMode() {
  const choices = ["single", "spread", "auto"];
  selectPageMode(choices[(choices.indexOf(pageModePreference) + 1) % choices.length]);
}

function single() {
  selectPageMode("single");
}

function spread() {
  selectPageMode("spread");
}

async function backListPage() {
  if (readerClosing) return;
  readerClosing = true;
  preCaches.pauseBackground();
  let navigating = false;
  try {
    // 戻ったページの描画と位置登録が完了してから終了保存するルン。
    if (readerNavigationPromise) await readerNavigationPromise;
    if (readerProgressManager) await readerProgressManager.finish();
    // リーダーを閉じる前に確実にページ位置を保存するルン！
    if (savePageTimer) {
      clearTimeout(savePageTimer);
      savePageTimer = null;
    }
    saveCurrentPage();
    lastSaveTime = Date.now();
    debugLog("saveCurrentPage() executed before closing reader");

    if (document.cancelFullScreen) {
      document.cancelFullScreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    } else if (document.webkitCancelFullScreen) {
      document.webkitCancelFullScreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }

    navigating = true;
    preCaches.stop();
    if (window.history.length > 1) {
      window.history.back();
    } else {
      location.href = document.referrer;
    }
  } finally {
    readerClosing = false;
    if (!navigating) preCaches.resume();
  }
}

function fixSpreadPage() {
  fixPage = 1 - fixPage;
  void renderReaderPage("spreadCorrection");
}

// 全画面表示の状態をボタンに反映する関数ルン！
function updateFullScreenButton() {
  const fullScreenButton = document.getElementById("fullScreenButton");
  const isFullscreen =
    document.fullscreenElement ||
    document.mozFullScreenElement ||
    document.webkitFullscreenElement ||
    document.msFullscreenElement;

  if (isFullscreen) {
    // 全画面モード時は「全画面」を表示するルン！（現在のモード表示）
    fullScreenButton.textContent = window.i18n.toc_button_fullscreen;
  } else {
    // 窓表示時は「窓表示」を表示するルン！（現在のモード表示）
    fullScreenButton.textContent = window.i18n.toc_button_windowed;
  }
}

function toggleFullScreen() {
  if (
    document.fullscreenElement ||
    document.mozFullScreenElement ||
    document.webkitFullscreenElement ||
    document.msFullscreenElement
  ) {
    // 全画面を解除するルン！
    if (document.cancelFullScreen) {
      document.cancelFullScreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    } else if (document.webkitCancelFullScreen) {
      document.webkitCancelFullScreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
  } else {
    // 全画面にするルン！
    if (document.documentElement.webkitRequestFullscreen) {
      document.documentElement.webkitRequestFullscreen();
    } else if (document.documentElement.mozRequestFullScreen) {
      document.documentElement.mozRequestFullScreen();
    } else if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen();
    } else if (document.documentElement.msRequestFullscreen) {
      document.documentElement.msRequestFullscreen();
    } else {
      alert(window.i18n.fullscreen_not_supported || "フルスクリーン非対応");
    }
  }
  // ボタンの状態は fullscreenchange イベントで更新されるルン！
}

function applyReaderDirection(value) {
  // 復元と手動の切替で画像とコントロールの向きを揃えるルン。
  direction = value;
  const rightBound = direction === "left";
  position = rightBound ? "right" : "left";
  document.getElementById("progress").className = rightBound ? "progress-left" : "progress-right";
  document.getElementById("slider").style.transform = rightBound ? "rotateY(180deg)" : "rotateY(0deg)";
  const button = document.getElementById("direction");
  button.className = rightBound ? "button right-to-left button-mode" : "button left-to-right button-mode";
  button.textContent = rightBound ? window.i18n.toc_button_direction_right : window.i18n.toc_button_direction_left;
}

function toggleDirection() {
  if (!readerReady) return;
  applyReaderDirection(direction === "left" ? "right" : "left");
  readerDirectionManager?.record(direction);
  void renderReaderPage("direction");
  readerMarkerManager?.renderRail();
}

function funcKey(evt) {
  // 設定ボタンのSpace/Enterで読書操作を重ねて実行しないルン。
  if (['Space', 'Enter'].includes(evt.code) || evt.keyCode === 32 || evt.keyCode === 13) {
    if (evt.target?.closest?.('.contents button')) return;
  }
  if (document.getElementById("suggest")?.open) return;
  if (evt.defaultPrevented || imageInspectorUI?.handleKeydown(evt)) return;
  if (isZoomed()) return; // 拡大表示中はキー操作によるページめくり等を無効化

  // Inspector内では、読書操作とスクロール・閉じるボタンの作動を重ねないルン。
  if (imageInspectorUI?.isOpen() && (
    ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'KeyI',
      'Digit1', 'Digit2', 'Numpad1', 'Numpad2', 'Period', 'Comma'].includes(evt.code) ||
    ['1', '2'].includes(evt.key) || [32, 188, 190].includes(evt.keyCode)
  )) evt.preventDefault();

  // 【ショートカット一覧】
  // ← + Shift : 次の章へ
  // ← + Control : 最終ページへ
  // ← : 次のページへ
  // → + Shift : 前の章へ
  // → + Control : 最初のページへ
  // → : 前のページへ
  // ESC : メニュー表示
  // 1 : 単ページ表示モード
  // 2 : 見開き表示モード
  // BackSpace or Delete : 閉じる
  // > / . : 右方向の端へ移動するルン（右綴じは先頭、左綴じは末尾）。
  // < / , : 左方向の端へ移動するルン（右綴じは末尾、左綴じは先頭）。
  // ↓ : 次のページへ
  // ↑ : 前のページへ
  // Space : クイック見開き表示トグル
  // 長押し : クイック見開き表示
  // iPad回転 : クイック見開き表示
  // i : インスペクター表示トグル

  debugLog("funcKey(); key event:" + evt.code);
  if (evt.code == "Space" || evt.keyCode === 32) {
    // クイック見開きモード表示
    quickSpredView();
  } else if (evt.code == "KeyI") {
    // インスペクター表示
    showInspector();
  } else {
    closeQuickSpread();
  }
  if (evt.code == "ArrowLeft" && evt.shiftKey) leftIndex();
  else if (evt.code == "ArrowLeft" && evt.ctrlKey) {
    page = maxPage;
    loadPage(1);
  } else if (evt.code == "ArrowLeft") leftward();
  if (evt.code == "ArrowRight" && evt.shiftKey) rightIndex();
  else if (evt.code == "ArrowRight" && evt.ctrlKey) {
    page = 1;
    loadPage(1);
  } else if (evt.code == "ArrowRight") rightward();
  if (evt.code == "Escape") index();
  if (evt.key == "1" || evt.code == "Digit1" || evt.code == "Numpad1") single();
  if (evt.key == "2" || evt.code == "Digit2" || evt.code == "Numpad2") spread();
  if (evt.code == "Backspace" || evt.code == "Delete") backListPage();
  if (evt.code == "Period" || evt.keyCode === 190) {
    page = direction == "left" ? 1 : maxPage;
    loadPage(1);
  } // >
  if (evt.code == "Comma" || evt.keyCode === 188) {
    page = direction == "left" ? maxPage : 1;
    loadPage(1);
  } // <
  if (evt.code == "ArrowDown") leftward();
  if (evt.code == "ArrowUp") rightward();
}

function toggleRaw() {
  // 再読込前はラベルと装飾クラスを保ち、押した瞬間の寸法変化を防ぐルン。
  // 圧縮有無の切り替え ルン！現在のモードを表示するように変更するルン！
  let data = new FormData();
  data.append("mode", "close");
  data.append("file", escapedFile);
  data.append("page", page);
  readerProgressManager ? readerProgressManager.beacon() : navigator.sendBeacon("comistream.php", data);

  // URLからsizeパラメータを削除してCookie設定を優先させるルン！
  // URLオブジェクトを使うとエンコーディングが変わるので正規表現で削除するルン
  let reload_url = location.href
    .replace(/([?&])size=[^&]*(&|$)/g, function (match, p1, p2) {
      // &size=xxx& → & or ?size=xxx& → ?
      // &size=xxx(末尾) → 空 or ?size=xxx(末尾) → ?のまま（後で処理）
      if (p1 === "?" && p2 === "&") return "?";
      if (p1 === "&") return p2 === "&" ? "&" : "";
      return p1;
    })
    .replace(/\?$/, ""); // 末尾の?を削除

  if (document.getElementById("rawMode").classList.contains("raw")) {
    document.cookie = "rawMode=cmp; path=/; max-age=31536000";
    debugLog("toggleRaw() size toggle to cmp, reload_url:" + reload_url);
    location.replace(reload_url);
  } else {
    document.cookie = "rawMode=raw; path=/; max-age=31536000";
    debugLog("toggleRaw() size toggle to raw, reload_url:" + reload_url);
    location.replace(reload_url);
  }
}

function toggleTrimmingFile() {
  // 表示の切り替えは遷移先に任せ、現在のボタン寸法を保つルン。
  // サーバー側で左右余白トリミングするモード（旧:見開きサイズ画像ファイルの左右分割表示モード） ルン！
  let data = new FormData();
  data.append("mode", "close");
  data.append("file", escapedFile);
  data.append("page", page);
  if (document.getElementById("splitFile").classList.contains("normal")) {
    // 左右余白トリミングモードへ
    // page = page*2;
    readerProgressManager ? readerProgressManager.beacon() : navigator.sendBeacon("comistream.php", data);
    // console.log("toggleTrimmingFile() normal to split");
    let reload_url = location.href + "&view=trimming";
    // (reload_url);
    location.replace(reload_url);
  } else {
    // 通常表示モードへ
    // page = Math.floor((page+1)/2);
    readerProgressManager ? readerProgressManager.beacon() : navigator.sendBeacon("comistream.php", data);
    // console.log("toggleTrimmingFile() split to normal");
    let reload_url = location.href.replace("&view=trimming", "");
    // console.log(reload_url);
    location.replace(reload_url);
  }
}

//読み終えたときに続刊、関連書籍を表示するためのデータを取得
async function sugguestbook() {
  const title = document.getElementById("suggest-book-title");
  if (title) title.textContent = baseFile;
  const books = document.getElementById("suggest-books");
  if (!books) return;
  try {
    const response = await fetch(`/suggest.php?booktitle=${encodeURIComponent(baseFile)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (response.status === 404) return;
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    books.replaceChildren();
    books.hidden = true;
    for (const group of [data?.title?.new, data?.title?.old, data?.author]) {
      if (!group || typeof group !== "object" || Array.isArray(group)) continue;
      for (const [title, path] of Object.entries(group)) {
        if (typeof path === "string") addnextbooklist(title, path);
      }
    }
  } catch (error) {
    // 拡張がない場合もEPUBと同じ巻末UIを維持するルン。
    debugLog("Related books unavailable: " + error.message);
  }
}

//続刊へ移動
async function toNextBook(nextlocation) {
  if (readerClosing) return;
  readerClosing = true;
  preCaches.pauseBackground();
  let navigating = false;
  try {
    if (readerNavigationPromise) await readerNavigationPromise;
    if (readerProgressManager) await readerProgressManager.finish();
    // 次の本へ移動する前に確実にページ位置を保存するルン！
    if (savePageTimer) {
      clearTimeout(savePageTimer);
      savePageTimer = null;
    }
    saveCurrentPage();
    lastSaveTime = Date.now();
    debugLog("saveCurrentPage() executed before moving to next book");

    navigating = true;
    preCaches.stop();
    location.replace(nextlocation);
  } finally {
    readerClosing = false;
    if (!navigating) preCaches.resume();
  }
}

//続刊リストのURL作成
function addnextbooklist(nexttitle, nextlocation) {
  let shareroot = publicDir;
  let sizeOption = "";
  // let nowlocation = location.href;
  // rawModeの状態に応じてsizeOptionを設定するロジックは元のまま
  const rawModeElement = document.getElementById("rawMode");
  if (rawModeElement && rawModeElement.classList.contains("raw")) {
    // sizeOption = "&size=FULL"; // sizeパラメータは不要になった可能性あり
  } else {
    // sizeOption = "";
  }
  const fullPath = String(nextlocation);
  const publicPrefix = shareroot && shareroot !== '/'
    ? shareroot.replace(/\/+$/, '') + '/'
    : '/';
  if (!fullPath.startsWith(publicPrefix) || fullPath.startsWith('//')) {
    return;
  }
  const relativePath = fullPath.slice(publicPrefix.length);
  const nextUrl = new URL(location.pathname, location.origin);
  // 空白は%20にして、PHPが保持するファイル名の+と区別するルン。
  nextUrl.search = 'file=' + encodeURIComponent(relativePath) + '&mode=open';
  const suggestElement = document.getElementById("suggest-books");
  if (suggestElement) {
    const row = document.createElement('p');
    const icon = document.createElement('img');
    icon.src = themeDir + '/theme/icons/book.png';
    icon.alt = '';
    const link = document.createElement('a');
    link.href = nextUrl.href;
    link.textContent = nexttitle;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      toNextBook(link.href);
    });
    row.append(icon, link);
    suggestElement.appendChild(row);
    suggestElement.hidden = false;
  }
}

async function refreshAutoLightSplitLayout(reason, scheduledRequestId) {
  const requestId =
    typeof scheduledRequestId === "number"
      ? scheduledRequestId
      : ++autoLightSplitLayoutRequestId;
  const imageElement = document.getElementById("image");
  const viewportApi = window.ComistreamViewport;

  if (!imageElement || !viewportApi) {
    return;
  }

  const viewport = viewportApi.getLayoutViewportSize(
    window,
    document.documentElement
  );
  if (viewport.width === 0 || viewport.height === 0) {
    return;
  }

  if (mode !== 1) {
    // 見開きの50%幅を壊さず、分割表示由来のスタイルだけ戻すルン
    autoLightSplitMode = false;
    als = "";
    imageElement.style.marginLeft = "0px";
    imageElement.style.height = "100%";
    imageElement.style.backgroundRepeat = "no-repeat";
    imageElement.style.backgroundSize = "contain";
    debugLog(
      "refreshAutoLightSplitLayout() skipped spread mode reason:" + reason
    );
    return;
  }

  if (
    viewport.width > viewport.height ||
    Number(page) === 1 ||
    autoSplit === "off"
  ) {
    autoLightSplitMode = false;
    als = "";
    changeAutoLightSplitMode(false);
    debugLog(
      "refreshAutoLightSplitLayout() normal layout reason:" + reason
    );
    return;
  }

  const imageUrl = globalDivImageUrl;
  const pageAtStart = page;
  if (!imageUrl) {
    return;
  }

  const image = await load_image(imageUrl);
  if (
    !viewportApi.isLayoutRequestCurrent({
      requestId,
      currentRequestId: autoLightSplitLayoutRequestId,
      imageUrl,
      currentImageUrl: globalDivImageUrl,
      page: pageAtStart,
      currentPage: page,
      mode,
    })
  ) {
    debugLog(
      "refreshAutoLightSplitLayout() discarded stale request reason:" + reason
    );
    return;
  }
  if (image === null) {
    debugLog(
      "refreshAutoLightSplitLayout() image load failed reason:" + reason
    );
    return;
  }

  imagex = image.width;
  imagey = image.height;
  const metrics = viewportApi.calculateAutoLightSplitMetrics({
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    imageWidth: imagex,
    imageHeight: imagey,
  });
  if (metrics === null) {
    return;
  }

  cutrate = metrics.cutRate;
  virtratio = metrics.ratio;
  autoLightSplitMode = viewportApi.shouldUseAutoLightSplit({
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    imageWidth: imagex,
    imageHeight: imagey,
    page,
    mode,
    autoSplit,
  });
  als = autoLightSplitMode ? "&als=1" : "";
  changeAutoLightSplitMode(autoLightSplitMode);
  debugLog(
    "refreshAutoLightSplitLayout() applied reason:" +
      reason +
      " autoLightSplitMode:" +
      autoLightSplitMode
  );
}

async function isLandscape(checkdivid) {
  //canvasの画像の縦横のどちらが長いかを判定 true:横長 false:縦長
  let divId = checkdivid;
  let bgImageUrl = window.getComputedStyle(
    document.getElementById(divId)
  ).backgroundImage;
  if (bgImageUrl == null) {
    return false;
  }
  bgImageUrl = globalDivImageUrl;
  let image = await load_image(bgImageUrl);
  // imageがnullならfalseを返す
  if (image == null) {
    return false;
  }
  imagex = image.width;
  imagey = image.height;
  const viewport = window.ComistreamViewport.getLayoutViewportSize(
    window,
    document.documentElement
  );
  const metrics = window.ComistreamViewport.calculateAutoLightSplitMetrics({
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    imageWidth: imagex,
    imageHeight: imagey,
  });
  if (metrics === null) {
    return false;
  }
  const ret = metrics.isLandscapeImage;
  cutrate = metrics.cutRate;
  virtratio = metrics.ratio;
  debugLog(
    "isLandscape(); " +
      ret +
      " width:" +
      imagex +
      " height:" +
      imagey +
      " virtratio:" +
      virtratio +
      " Aspect:" +
      image.width / image.height +
      " Page:" +
      page +
      " bgImageUrl:" +
      bgImageUrl
  );
  image = null;
  return ret;
}

function extractURLFromStyleString(styleString) {
  // 廃止
  // const urlRegex = /url\\("([^")]+)"\\)/;
  // const match = styleString.match(urlRegex); // スタイル文字列からURLを抽出
  // if (match && match.length > 1) {
  //   return match[1]; // 抽出されたURLを返す
  // } else {
  //   return null; // マッチするURLが見つからない場合はnullを返す
  // }
}

async function load_image(path) {
  // 同じImageを共有し、表示操作の待機は従来どおり15秒で解除するルン。
  // 遅いPDF等の取得自体は取り消さず、完了時に表示を再調整するルン。
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(null), 15000);
    preCaches.request(path, true).then(image => { clearTimeout(timer); resolve(image); });
  });
}

function changeAutoLightSplitMode(autoLightSplitMode) {
  //表示を単ページのままか半分に分割表示するかを設定（横長画像の時に半分に分割するために使用） 自動ページ分割機能(Auto Light Split)
  const campusdiv = document.getElementById("image");
  const viewport = window.ComistreamViewport.getLayoutViewportSize(
    window,
    document.documentElement
  );
  const metrics = window.ComistreamViewport.calculateAutoLightSplitMetrics({
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    imageWidth: imagex,
    imageHeight: imagey,
  });

  if (autoLightSplitMode && metrics !== null) {
    // 横長画像を半分に分割して表示
    cutrate = metrics.cutRate;
    virtratio = metrics.ratio;
    campusdiv.style.height = "100%";
    campusdiv.style.backgroundPosition = autoLightSplitModeViewPosition;
    campusdiv.style.backgroundRepeat = "no-repeat";
    campusdiv.style.backgroundSize =
      metrics.backgroundWidth + "px " + metrics.backgroundHeight + "px";
    campusdiv.style.width = metrics.readerWidth + "px";
    campusdiv.style.marginLeft = metrics.marginLeft + "px";
    debugLog("Landscape:auto split image");
  } else {
    //縦長画像をそのまま表示
    campusdiv.style.width = "100%";
    campusdiv.style.height = "100%";
    campusdiv.style.marginLeft = "0px";
    campusdiv.style.backgroundPosition = "center";
    campusdiv.style.backgroundRepeat = "no-repeat";
    campusdiv.style.backgroundSize = "contain";
    debugLog("Portrait:not split image");
  }
}

function trimImage(image) {
  //画像のトリミング（重かったので未使用）
  var canvas = document.createElement("canvas");
  var context = canvas.getContext("2d");

  canvas.width = image.width;
  canvas.height = image.height;

  context.drawImage(image, 0, 0);

  var imageData = context.getImageData(0, 0, image.width, image.height);
  var data = imageData.data;

  var topLeftPixelColor = [data[0], data[1], data[2], data[3]];
  var topRightPixelColor = [
    data[(image.width - 1) * 4],
    data[(image.width - 1) * 4 + 1],
    data[(image.width - 1) * 4 + 2],
    data[(image.width - 1) * 4 + 3],
  ];

  var left = image.width,
    right = 0;

  for (var y = 0; y < image.height; y++) {
    for (var x = 0; x < image.width; x++) {
      var i = (y * image.width + x) * 4;
      if (
        (data[i] === topLeftPixelColor[0] &&
          data[i + 1] === topLeftPixelColor[1] &&
          data[i + 2] === topLeftPixelColor[2] &&
          data[i + 3] === topLeftPixelColor[3]) ||
        (data[i] === topRightPixelColor[0] &&
          data[i + 1] === topRightPixelColor[1] &&
          data[i + 2] === topRightPixelColor[2] &&
          data[i + 3] === topRightPixelColor[3])
      ) {
        data[i + 3] = 0;
      } else {
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }

  var trimmedCanvas = document.createElement("canvas");
  var trimmedContext = trimmedCanvas.getContext("2d");

  trimmedCanvas.width = right - left;
  trimmedCanvas.height = image.height;

  trimmedContext.putImageData(
    context.getImageData(left, 0, right - left, image.height),
    0,
    0
  );

  return trimmedCanvas.toDataURL();
}

function closeQuickSpread() {
  ++quickSpreadGeneration;
  clearTimeout(quickSpreadTimer);
  const modal = document.getElementById("modal");
  if (modal.style.display !== "block") return;
  modal.style.display = "none";
  modal.style.opacity = "0";
  const overlay = document.getElementById("overlay");
  const suggest = document.getElementById("suggest");
  if (!suggest?.open) {
    overlay.style.display = "none";
    overlay.style.opacity = "0";
  }
}

async function quickSpredView() {
  if (!readerReady || readerRenderPending || mode !== 1) return;
  const suggest = document.getElementById("suggest");
  if (suggest?.open) return;
  const modal = document.getElementById("modal");
  if (modal.style.display === "block") {
    closeQuickSpread();
    return;
  }
  const generation = ++quickSpreadGeneration;
  const target = page;
  const shapes = await Promise.all([
    isWideReaderPage(target), isWideReaderPage(target - 1)
  ]);
  if (generation !== quickSpreadGeneration || target !== page || mode !== 1) return;
  const paired = target > 1 && shapes.every((shape) => shape === false);
  const left = direction === "left" ? target : target - 1;
  const right = direction === "left" ? target - 1 : target;
  const image1 = document.getElementById("image1");
  const image2 = document.getElementById("image2");
  image1.style.width = paired ? "50%" : "100%";
  image1.src = getFullImageUrl(paired ? left : target, false);
  image2.style.width = "50%";
  image2.style.display = paired ? "block" : "none";
  if (paired) image2.src = getFullImageUrl(right, false);
  else image2.removeAttribute("src");
  const overlay = document.getElementById("overlay");
  overlay.style.opacity = "0";
  modal.style.opacity = "0";
  overlay.style.display = "block";
  modal.style.display = "block";
  quickSpreadTimer = setTimeout(function () {
    if (generation !== quickSpreadGeneration) return;
    overlay.style.opacity = "1";
    modal.style.opacity = "1";
  }, 50);
}

let imageInspectorUI = null;

function updateImageNetworkSpeed() {
  const item = document.getElementById("inspector-network-speed");
  if (!item) return;
  const { kbps, stale } = preCaches.getNetworkSpeed();
  const text = "Network Speed: " + (kbps === null ? "—" :
    kbps.toLocaleString("en-US") + " kbps" + (stale ? " (last measurement)" : ""));
  window.ComistreamInspector.updateText(item, text);
}

function createImagePreloadStatus() {
  const item = document.createElement("li");
  item.id = "inspector-preload";
  const line = document.createElement("div");
  line.className = "inspector-preload-line";
  const label = document.createElement("span");
  label.className = "inspector-preload-label";
  const cells = document.createElement("span");
  cells.className = "inspector-preload-cells";
  cells.dir = "ltr";
  cells.setAttribute("role", "group");
  cells.setAttribute("aria-label", "Upcoming page preload status");
  const count = document.createElement("span");
  count.className = "inspector-preload-count";
  line.append(label, " ", cells, " ", count);
  item.append(line);
  return item;
}

function updateImagePreloadStatus() {
  const item = document.getElementById("inspector-preload");
  if (!item) return;
  const content = document.getElementById("inspector-content");
  const scrollTop = content.scrollTop;
  const cells = item.querySelector(".inspector-preload-cells");
  const size = Math.max(0, Math.floor(preCaches.getSize()));
  const length = Math.max(0, Math.min(size, maxPage - displayedEnd));
  const states = {
    empty: ["□", "Not retained"],
    loading: ["▃", "Loading"],
    loaded: ["■", "Loaded"],
    failed: ["×", "Failed"]
  };
  // 変わっていない文字列は触らず、選択中のテキストを保つルン。
  const setText = (element, value) => {
    if (element.textContent !== value) element.textContent = value;
  };
  setText(item.querySelector(".inspector-preload-label"), "Preload Pages: " + size);
  let loaded = 0;
  // 読み込み状況が変わっても同じマスのDOMを使うルン。
  for (let index = 0; index < length; index++) {
    const number = displayedEnd + index + 1;
    const status = preCaches.getStatus(getFullImageUrl(number, false));
    const [symbol, label] = states[status];
    let cell = cells.children[index];
    if (!cell) {
      cell = document.createElement("span");
      cell.className = "inspector-preload-cell";
      cell.setAttribute("role", "img");
      cells.appendChild(cell);
    }
    cell.dataset.page = String(number);
    cell.dataset.state = status;
    setText(cell, symbol);
    cell.setAttribute("aria-label", "Page " + number + ": " + label);
    if (status === "loaded") loaded++;
  }
  while (cells.children.length > length) {
    cells.lastElementChild.remove();
  }
  const count = item.querySelector(".inspector-preload-count");
  setText(count, loaded + "/" + length);
  count.setAttribute("aria-label", loaded + " of " + length + " upcoming pages loaded");
  content.scrollTop = scrollTop;
}

function showInspector(forceVisible = null) {
  if (!imageInspectorUI) {
    const menu = document.getElementById("contents");
    imageInspectorUI = window.ComistreamInspector.create({
      menu,
      hideMenu: () => { menu.style.display = "none"; },
      restoreMenu: () => { menu.style.display = "block"; },
      onBack: backListPage
    });
    preCaches.onChange = () => {
      if (imageInspectorUI.isOpen()) {
        updateImagePreloadStatus();
        updateImageNetworkSpeed();
      }
    };
    document.addEventListener("selectionchange", () => {
      if (imageInspectorUI.isOpen()) updateImageNetworkSpeed();
    });
  }
  const visible = forceVisible === null ? !imageInspectorUI.isOpen() : Boolean(forceVisible);
  if (!visible) {
    imageInspectorUI.setVisible(false);
    return;
  }
  const inspector = document.getElementById("inspector-content");
  const scrollTop = inspector.scrollTop;
  inspector.replaceChildren();
  const aspect = Math.round((imagex / imagey) * 100) / 100;
  const pages = page + " / " + maxPage;
  const list = document.createElement("ul");
  const listItemArray = [
    "imagex",
    "imagey",
    "req",
    "virtratio",
    "cutrate",
    "direction",
    "position",
    "mode",
    "autoLightSplitMode",
    "autoSplit",
    "als",
    "autoLightSplitModeViewPosition",
    "fixPage",
    "prevPage",
    "nextpage",
  ];
  for (let i = 0; i < listItemArray.length; i++) {
    let listItem = document.createElement("li");
    listItem.textContent =
      listItemArray[i].toString() + ": " + window[listItemArray[i]];
    list.appendChild(listItem);
  }
  // 関数スコープの診断値を追加するルン。
  let listItem = document.createElement("li");
  listItem.textContent = "Page: " + pages;
  list.prepend(listItem);

  listItem = document.createElement("li");
  listItem.textContent = "Aspect: " + aspect;
  list.appendChild(listItem);

  list.appendChild(createImagePreloadStatus());

  listItem = document.createElement("li");
  listItem.textContent = "File Size: " + archiveFileMBytes + " MB";
  list.appendChild(listItem);

  listItem = document.createElement("li");
  listItem.textContent = "Average Page Size: " + averagePageKBytes + " KB";
  list.appendChild(listItem);

  listItem = document.createElement("li");
  listItem.id = "inspector-network-speed";
  list.appendChild(listItem);

  inspector.appendChild(list);
  updateImagePreloadStatus();
  updateImageNetworkSpeed();
  inspector.scrollTop = scrollTop;
  imageInspectorUI.setVisible(true);
}

function getFullImageUrl(page, includeSplit = true) {
  // 現在のURLからベースURLを取得
  const baseUrl = window.location.origin; // https://www.example.com
  const path = window.location.pathname; // /cgi-bin/comistream.php

  let url = new URL(path, baseUrl);

  url.searchParams.append("file", file);
  url.searchParams.append("size", size);
  url.searchParams.append("page", page);
  // 再生成後は、ブラウザに残った同じページ番号の旧画像も更新するルン。
  if (typeof readerCacheGeneration === "string" && readerCacheGeneration) {
    url.searchParams.append("cache_version", readerCacheGeneration);
  }

  // $view_queryが空でない場合に追加
  let viewQuery = view_query;
  if (viewQuery) {
    url.searchParams.append("view", viewQuery.replace("&view=", "")); // '&view='を取り除く
  }

  if (includeSplit && autoLightSplitMode) {
    url.searchParams.append("als", "1");
  }

  return url.href;
}

// 時計の表示/非表示を切り替える関数
function toggleClock() {
  const clock = document.getElementById("clock");
  const clockButton = document.getElementById("clockToggleButton");

  if (clock.classList.contains("clock-hidden")) {
    // 時計を表示
    clock.classList.remove("clock-hidden");
    clockButton.classList.add("pressed");
    clockButton.setAttribute("aria-pressed", "true");
    // ローカルストレージに設定を保存
    localStorage.setItem("clockDisplay", "show");
    // 時計の更新を開始
    updateClock();
    // 1秒ごとに時計を更新
    clockTimer = setInterval(updateClock, 1000);
  } else {
    // 時計を非表示
    clock.classList.add("clock-hidden");
    clockButton.classList.remove("pressed");
    clockButton.setAttribute("aria-pressed", "false");
    // ローカルストレージに設定を保存
    localStorage.setItem("clockDisplay", "hide");
    // 時計の更新を停止
    clearInterval(clockTimer);
  }
}

// 時計の表示を更新する関数
function updateClock() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  document.getElementById("clock").textContent = `${hours}:${minutes}`;
}

// ページ読み込み時に時計の設定を復元する
window.addEventListener("load", function () {
  const clockDisplay = localStorage.getItem("clockDisplay");
  if (clockDisplay === "show") {
    // 少し遅延させてから実行（ページロード完了後）
    setTimeout(function () {
      toggleClock();
    }, 500);
  }
});

// グローバル変数の宣言
let clockTimer;

// 大きなページサイズの通知機能
function showLargePageNotification() {
  // 既存の通知があれば削除
  const existingNotification = document.querySelector(
    ".large-page-notification"
  );
  if (existingNotification) {
    existingNotification.remove();
  }

  // 通知要素を作成
  const notification = document.createElement("div");
  notification.className = "large-page-notification";
  notification.textContent =
    window.i18n.large_page_notification ||
    "ページサイズが大きいため表示が重たい可能性があります。端末にダウンロードすると高速に表示されます。";

  // クリックで非表示にする
  notification.addEventListener("click", function () {
    hideLargePageNotification(notification);
  });

  // ページに追加
  document.body.appendChild(notification);

  // 5秒後に自動で非表示
  setTimeout(function () {
    hideLargePageNotification(notification);
  }, 5000);
}

function hideLargePageNotification(notification) {
  if (notification && notification.parentNode) {
    notification.classList.add("fade-out");
    setTimeout(function () {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, 500);
  }
}

// ページサイズをチェックして通知を表示する関数
function checkAndShowLargePageNotification() {
  // averagePageKBytesが2000を超えていて、かつsizeが'FULL'（rawモード）の場合
  if (averagePageKBytes > 2000 && size === "FULL") {
    debugLog(
      "Large page size detected: " +
        averagePageKBytes +
        "KB, showing notification"
    );
    showLargePageNotification();
  }
}

// ツールチップを更新するヘルパー関数 ルン！
function updateTooltip(elementId, newTooltip) {
  const element = document.getElementById(elementId);
  if (element) {
    element.setAttribute("data-tooltip", newTooltip);
  }
}

// モード切り替え時にツールチップを更新する関数 ルン！
// 現在の状態に応じて、そのモードの説明をツールチップに表示するルン☆
function updateModeTooltips() {
  // rawModeボタンのツールチップを更新 ルン！
  const rawMode = document.getElementById("rawMode");
  if (rawMode) {
    if (rawMode.classList.contains("raw")) {
      // 現在原寸(raw)モードなので、原寸モードの説明をツールチップに表示するルン
      const tooltip = rawMode.getAttribute("data-tooltip-full");
      if (tooltip) rawMode.setAttribute("data-tooltip", tooltip);
    } else {
      // 現在圧縮(cmp)モードなので、圧縮モードの説明をツールチップに表示するルン
      const tooltip = rawMode.getAttribute("data-tooltip-compressed");
      if (tooltip) rawMode.setAttribute("data-tooltip", tooltip);
    }
  }

  updatePageModeButton();

  // splitFileボタンのツールチップを更新 ルン！
  const splitFile = document.getElementById("splitFile");
  if (splitFile) {
    if (splitFile.classList.contains("trimming")) {
      // 現在トリミングモードなので、トリミングモードの説明をツールチップに表示するルン
      const tooltip = splitFile.getAttribute("data-tooltip-trimming");
      if (tooltip) splitFile.setAttribute("data-tooltip", tooltip);
    } else {
      // 現在通常(normal)モードなので、通常モードの説明をツールチップに表示するルン
      const tooltip = splitFile.getAttribute("data-tooltip-normal");
      if (tooltip) splitFile.setAttribute("data-tooltip", tooltip);
    }
  }
}
