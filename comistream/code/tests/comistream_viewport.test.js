const test = require("node:test");
const assert = require("node:assert/strict");

const viewport = require("../comistream_viewport.js");

test("layout viewportはwindowサイズを優先する", () => {
  assert.deepEqual(
    viewport.getLayoutViewportSize(
      { innerWidth: 430, innerHeight: 932 },
      { clientWidth: 400, clientHeight: 800 }
    ),
    { width: 430, height: 932 }
  );
});

test("windowサイズが無効ならdocumentElementへフォールバックする", () => {
  assert.deepEqual(
    viewport.getLayoutViewportSize(
      { innerWidth: 0, innerHeight: undefined },
      { clientWidth: 768, clientHeight: 1024 }
    ),
    { width: 768, height: 1024 }
  );
});

test("縦長viewportの横長画像だけを自動分割する", () => {
  const base = {
    viewportWidth: 430,
    viewportHeight: 932,
    imageWidth: 2400,
    imageHeight: 1600,
    page: 2,
    mode: 1,
    autoSplit: "",
  };

  assert.equal(viewport.shouldUseAutoLightSplit(base), true);
  assert.equal(
    viewport.shouldUseAutoLightSplit({
      ...base,
      viewportWidth: 932,
      viewportHeight: 430,
    }),
    false
  );
  assert.equal(viewport.shouldUseAutoLightSplit({ ...base, page: 1 }), false);
  assert.equal(viewport.shouldUseAutoLightSplit({ ...base, mode: 2 }), false);
  assert.equal(
    viewport.shouldUseAutoLightSplit({ ...base, autoSplit: "off" }),
    false
  );
  assert.equal(
    viewport.shouldUseAutoLightSplit({
      ...base,
      imageWidth: 1200,
      imageHeight: 1800,
    }),
    false
  );
});

test("自動分割の倍率と表示サイズをviewportから計算する", () => {
  assert.deepEqual(
    viewport.calculateAutoLightSplitMetrics({
      viewportWidth: 400,
      viewportHeight: 800,
      imageWidth: 2000,
      imageHeight: 1000,
    }),
    {
      isLandscapeImage: true,
      cutRate: 2,
      ratio: 0.4,
      backgroundWidth: 800,
      backgroundHeight: 400,
      readerWidth: 400,
      marginLeft: 0,
    }
  );
});

test("無効な寸法では自動分割メトリクスを返さない", () => {
  assert.equal(
    viewport.calculateAutoLightSplitMetrics({
      viewportWidth: 0,
      viewportHeight: 800,
      imageWidth: 2000,
      imageHeight: 1000,
    }),
    null
  );
});

test("最新のページ・画像・要求だけを有効と判定する", () => {
  const current = {
    requestId: 4,
    currentRequestId: 4,
    imageUrl: "/page/10",
    currentImageUrl: "/page/10",
    page: 10,
    currentPage: 10,
    mode: 1,
  };

  assert.equal(viewport.isLayoutRequestCurrent(current), true);
  assert.equal(
    viewport.isLayoutRequestCurrent({ ...current, currentRequestId: 5 }),
    false
  );
  assert.equal(
    viewport.isLayoutRequestCurrent({ ...current, currentImageUrl: "/page/11" }),
    false
  );
  assert.equal(
    viewport.isLayoutRequestCurrent({ ...current, currentPage: 11 }),
    false
  );
  assert.equal(
    viewport.isLayoutRequestCurrent({ ...current, mode: 2 }),
    false
  );
});

test("自動左右分割中の単ページだけ表示位置を切り替える", () => {
  const base = {
    mode: 1,
    autoLightSplitMode: true,
    currentPosition: "left center",
    expectedPosition: "left",
  };

  assert.equal(viewport.shouldPanAutoLightSplit(base), true);
  assert.equal(
    viewport.shouldPanAutoLightSplit({
      ...base,
      autoLightSplitMode: false,
    }),
    false
  );
  assert.equal(
    viewport.shouldPanAutoLightSplit({
      ...base,
      mode: 2,
    }),
    false
  );
  assert.equal(
    viewport.shouldPanAutoLightSplit({
      ...base,
      expectedPosition: "right",
    }),
    false
  );
});

test("viewport segmentsを通常オブジェクトへ変換する", () => {
  assert.deepEqual(
    viewport.getViewportSegments({
      viewport: {
        segments: [
          { x: 0, y: 0, width: 400, height: 800 },
          { x: 420, y: 0, width: 400, height: 800 },
        ],
      },
    }),
    [
      { x: 0, y: 0, width: 400, height: 800 },
      { x: 420, y: 0, width: 400, height: 800 },
    ]
  );
  assert.deepEqual(viewport.getViewportSegments({}), []);
});

test("segments取得時の例外は未対応として扱う", () => {
  const view = {};
  Object.defineProperty(view, "viewport", {
    get() {
      throw new Error("unsupported");
    },
  });

  assert.deepEqual(viewport.getViewportSegments(view), []);
});

test("viewport診断スナップショットは未対応APIをnullで返す", () => {
  const snapshot = viewport.createViewportSnapshot(
    { innerWidth: 430, innerHeight: 932, devicePixelRatio: 3 },
    { clientWidth: 430, clientHeight: 932 },
    {},
    {}
  );

  assert.deepEqual(snapshot.layoutViewport, { width: 430, height: 932 });
  assert.equal(snapshot.visualViewport, null);
  assert.equal(snapshot.devicePixelRatio, 3);
  assert.equal(snapshot.screenOrientation, null);
  assert.equal(snapshot.devicePosture, null);
  assert.deepEqual(snapshot.segments, []);
});
