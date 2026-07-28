"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

global.window = global;
require("../reader_markers.js");

function createManager() {
  return global.ComistreamReaderMarkers.create({
    baseFile: "sample.cbz",
    i18n: {
      reader_marker_default: "しおり",
    },
  });
}

test("未命名しおりは位置順の番号で表示する", () => {
  const manager = createManager();
  manager.markers = [
    { id: 3, locatorType: "page", pageNumber: 30, progressFraction: 0.3 },
    { id: 1, locatorType: "page", pageNumber: 10, progressFraction: 0.1 },
    {
      id: 2,
      locatorType: "page",
      pageNumber: 20,
      progressFraction: 0.2,
      customLabel: "確認",
    },
  ];

  manager.sortMarkers();

  assert.deepEqual(
    manager.markers.map((marker) => marker.pageNumber),
    [10, 20, 30]
  );
  assert.equal(manager.markerDisplayName(manager.markers[0], 0), "しおり 1");
  assert.equal(manager.markerDisplayName(manager.markers[1], 1), "確認");
  assert.equal(manager.markerDisplayName(manager.markers[2], 2), "しおり 3");
});

test("16px以内のしおりをスライダー上でまとめる", () => {
  const manager = createManager();
  manager.markers = [
    { id: 1, locatorType: "page", pageNumber: 1, progressFraction: 0.1 },
    { id: 2, locatorType: "page", pageNumber: 2, progressFraction: 0.11 },
    { id: 3, locatorType: "page", pageNumber: 80, progressFraction: 0.8 },
  ];

  const clusters = manager.markerClusters(1000, false);

  assert.equal(clusters.length, 2);
  assert.deepEqual(
    clusters.map((cluster) => cluster.markers.length),
    [2, 1]
  );
});

test("1ページ本ではすべてのしおりを中央位置として扱う", () => {
  const manager = createManager();
  manager.markers = [
    { id: 1, locatorType: "page", pageNumber: 1, progressFraction: 0 },
  ];

  const clusters = manager.markerClusters(500, true);

  assert.equal(clusters[0].fraction, 0.5);
});

test("マーカー値をrangeのminとmaxに対する位置へ変換する", () => {
  const helpers = global.ComistreamReaderMarkers;

  assert.equal(helpers.rangeValueFraction(1, 1, 101), 0);
  assert.equal(helpers.rangeValueFraction(26, 1, 101), 0.25);
  assert.equal(helpers.rangeValueFraction(101, 1, 101), 1);
  assert.equal(helpers.rangeValueFraction(1, 1, 1), 0.5);
  assert.equal(helpers.rangeValueFraction(null, 1, 101), 0.5);
});

test("マーカー座標をrange thumbの中心移動範囲へ揃える", () => {
  const position = global.ComistreamReaderMarkers.rangeThumbCenterX;

  assert.equal(position(0, 300, 30), 15);
  assert.equal(position(0.25, 300, 30), 82.5);
  assert.equal(position(0.5, 300, 30), 150);
  assert.equal(position(0.75, 300, 30), 217.5);
  assert.equal(position(1, 300, 30), 285);
});

test("マーカー位置は進捗率よりsliderと同じ値を優先する", () => {
  const manager = createManager();
  const slider = { min: "1", max: "101" };

  assert.equal(
    manager.markerSliderFraction(
      { pageNumber: 26, progressFraction: 0.9 },
      slider,
      false
    ),
    0.25
  );
  assert.equal(
    manager.markerSliderFraction(
      { pageNumber: null, progressFraction: 0.75 },
      slider,
      false
    ),
    0.75
  );
});

test("章ページとしおりページを重複なしのジャンプ停止点にまとめる", () => {
  const jumpStops = global.ComistreamReaderMarkers.mergePageJumpStops(
    [1, 10, 30, 50],
    [
      { locatorType: "page", locator: "20", pageNumber: 20 },
      { locatorType: "page", locator: "30", pageNumber: 30 },
      { locatorType: "epub_cfi", locator: "epubcfi(/6/2)" },
      { locatorType: "page", locator: "101", pageNumber: 101 },
    ],
    100
  );

  assert.deepEqual(jumpStops, [1, 10, 20, 30, 50]);
});

test("章ジャンプはしおりで停止し見開き内の停止点は通過済みとする", () => {
  const jumpStops = [1, 10, 14, 18, 30];
  const helpers = global.ComistreamReaderMarkers;

  assert.equal(helpers.findAdjacentPageStop(jumpStops, 10, 1, false), 14);
  assert.equal(helpers.findAdjacentPageStop(jumpStops, 13, 2, false), 18);
  assert.equal(helpers.findAdjacentPageStop(jumpStops, 18, 1, true), 14);
});

test("EPUB章ジャンプ用に現在位置から最も近いしおりを選ぶ", () => {
  const markers = [
    { id: 1, locator: "epubcfi(/6/2)", progressFraction: 0.2 },
    { id: 2, locator: "epubcfi(/6/4)", progressFraction: 0.4 },
    { id: 3, locator: "epubcfi(/6/6)", progressFraction: 0.6 },
    { id: 4, locator: "epubcfi(/6/8)", progressFraction: 0.8 },
  ];

  assert.equal(
    global.ComistreamReaderMarkers.findAdjacentMarker(
      markers,
      0.5,
      false,
      ""
    ).id,
    3
  );
  assert.equal(
    global.ComistreamReaderMarkers.findAdjacentMarker(
      markers,
      0.5,
      true,
      ""
    ).id,
    2
  );
});

test("現在開いているEPUBしおりは次の停止点候補から除外する", () => {
  const markers = [
    { id: 1, locator: "epubcfi(/6/2)", progressFraction: 0.5 },
    { id: 2, locator: "epubcfi(/6/4)", progressFraction: 0.50000001 },
    { id: 3, locator: "epubcfi(/6/6)", progressFraction: 0.7 },
  ];

  assert.equal(
    global.ComistreamReaderMarkers.findAdjacentMarker(
      markers,
      0.5,
      false,
      "epubcfi(/6/2)"
    ).id,
    3
  );
});
