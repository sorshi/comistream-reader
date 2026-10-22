const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../comistream.js'), 'utf8');
const preloadSource = source.slice(source.indexOf('class PreCache'), source.indexOf('var preCaches ='));

function fixture({ saving = false, observer = true, bytes = 800000 } = {}) {
  let now = 100, timerId = 0, deliver;
  const timers = new Map(), images = [];
  const context = vm.createContext({
    URL, document: { baseURI: 'https://reader.test/', hidden: false },
    size: saving ? 'comp' : 'FULL', averagePageKBytes: bytes / 1000,
    performance: { now: () => now }, Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
    setTimeout(fn, ms) { timers.set(++timerId, { fn, at: now + ms }); return timerId; },
    clearTimeout(id) { timers.delete(id); },
    Image: class {
      constructor() { this.width = this.naturalWidth = 800; this.height = this.naturalHeight = 1200; images.push(this); }
      set src(url) { this.url = url; }
      removeAttribute() { this.cancelled = true; }
    },
    ...(observer ? { PerformanceObserver: class {
      static supportedEntryTypes = ['resource'];
      constructor(callback) { deliver = entries => callback({ getEntries: () => entries }); }
      observe() {}
    } } : {})
  });
  vm.runInContext(preloadSource + '\nthis.cache = new PreCache(); this.calculate = calculatePreloadPlan;', context);
  const cache = context.cache;
  context.preCaches = cache;
  vm.runInContext(source.slice(source.indexOf('async function load_image('), source.indexOf('function changeAutoLightSplitMode(')), context);
  const url = page => `https://reader.test/image?page=${page}`;
  function advance(ms) {
    const until = now + ms;
    for (let count = 0; count < 1000; count++) {
      const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) { now = until; return; }
      now = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    throw new Error('Timer loop did not settle');
  }
  function complete(page, { duration = 100, wait = 20, body = bytes, cached = false, success = true, timing = true } = {}) {
    const attempt = cache.active.get(url(page));
    if (!attempt) throw new Error(`Page ${page} is not active`);
    const start = attempt.start, image = attempt.image;
    advance(duration);
    const end = now;
    image[success ? 'onload' : 'onerror']();
    if (deliver && timing) deliver([{ name: url(page), entryType: 'resource', initiatorType: 'img',
      startTime: start + 0.1, requestStart: start + 1, responseStart: start + wait,
      responseEnd: end - 1, encodedBodySize: body, transferSize: cached ? 0 : body + 300, responseStatus: 200 }]);
  }
  function view(start, end = start, maximum = 200) { cache.prepareView(start, end, maximum, url); }
  async function open(page = 1) {
    view(page);
    const pending = cache.request(url(page), true);
    complete(page);
    await pending;
    cache.present(); cache.enable();
  }
  return { cache, context, images, timers, url, advance, complete, view, open, now: () => now, deliver };
}

module.exports = { fixture, preloadSource };
