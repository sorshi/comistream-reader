const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const readerSource = fs.readFileSync(
  path.join(__dirname, "..", "comistream.js"),
  "utf8"
);
const helperStart = readerSource.indexOf(
  "async function browserCanDecodeJpegXlPage"
);
const helperEnd = readerSource.indexOf("async function restorePage", helperStart);

assert.notEqual(helperStart, -1, "JPEG XL browser probe helper was not found.");
assert.notEqual(helperEnd, -1, "JPEG XL support helper boundary was not found.");

const helperSource = readerSource.slice(helperStart, helperEnd);

function makeFixture({ probePage, loadSucceeds }) {
  const alerts = [];
  let historyBackCount = 0;
  let requestedUrl = null;

  class FakeImage {
    set src(url) {
      requestedUrl = url;
      if (loadSucceeds) {
        this.naturalWidth = 100;
        this.naturalHeight = 200;
        this.onload();
      } else {
        this.onerror();
      }
    }
  }

  const context = vm.createContext({
    Image: FakeImage,
    alert(message) {
      alerts.push(message);
    },
    getFullImageUrl(pageNumber) {
      return `/page/${pageNumber}`;
    },
    jpegXlProbePage: probePage,
    window: {
      history: {
        back() {
          historyBackCount += 1;
        },
      },
    },
  });

  vm.runInContext(
    `${helperSource}\nthis.ensureJpegXlSupportForTest = ensureJpegXlSupport;`,
    context
  );

  return {
    alerts,
    context,
    getHistoryBackCount: () => historyBackCount,
    getRequestedUrl: () => requestedUrl,
  };
}

test("JPEG XLページがなければデコード確認を省略する", async () => {
  const fixture = makeFixture({ probePage: 0, loadSucceeds: false });

  assert.equal(await fixture.context.ensureJpegXlSupportForTest(), true);
  assert.equal(fixture.getRequestedUrl(), null);
  assert.deepEqual(fixture.alerts, []);
  assert.equal(fixture.getHistoryBackCount(), 0);
});

test("JPEG XLをデコードできるブラウザではreaderを続行する", async () => {
  const fixture = makeFixture({ probePage: 3, loadSucceeds: true });

  assert.equal(await fixture.context.ensureJpegXlSupportForTest(), true);
  assert.equal(fixture.getRequestedUrl(), "/page/3");
  assert.deepEqual(fixture.alerts, []);
  assert.equal(fixture.getHistoryBackCount(), 0);
});

test("JPEG XLをデコードできないブラウザではアラート後に戻る", async () => {
  const fixture = makeFixture({ probePage: 2, loadSucceeds: false });

  assert.equal(await fixture.context.ensureJpegXlSupportForTest(), false);
  assert.equal(fixture.getRequestedUrl(), "/page/2");
  assert.deepEqual(fixture.alerts, [
    "ブラウザで未対応の画像フォーマットです:JPEG XL",
  ]);
  assert.equal(fixture.getHistoryBackCount(), 1);
});
