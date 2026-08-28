"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const codeDirectory = path.join(__dirname, "..");
const dirListSource = fs.readFileSync(
  path.join(codeDirectory, "dir_list.js"),
  "utf8"
);

function createContext() {
  const beaconCalls = [];
  const document = {
    cookie: "",
    documentElement: { clientWidth: 1200 },
    addEventListener() {},
    getElementById() {
      return null;
    },
    getElementsByClassName() {
      return [];
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  const window = {
    location: { pathname: "/books/" },
    addEventListener() {},
  };

  const context = vm.createContext({
    cgiPath: "/cgi-bin/comistream.php",
    console,
    debugLog() {},
    document,
    history: { state: null, replaceState() {} },
    localStorage: { getItem: () => null },
    navigator: {
      sendBeacon(url, data) {
        beaconCalls.push({ url, data });
        return true;
      },
    },
    setTimeout,
    clearTimeout,
    window,
  });
  vm.runInContext(dirListSource, context);

  return { beaconCalls, context };
}

test("フォルダ行から呼ばれてもfav APIを送信しない", () => {
  const fixture = createContext();
  const favoriteCell = {
    closest: () => null,
    querySelector: () => null,
    style: {},
  };
  let prevented = false;

  fixture.context.favoriteEvent = {
    currentTarget: favoriteCell,
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {},
  };
  vm.runInContext("toggleFavorite(favoriteEvent)", fixture.context);

  assert.equal(prevented, false);
  assert.deepEqual(fixture.beaconCalls, []);
  assert.equal(favoriteCell.style.backgroundImage, undefined);
});

test("通常ファイル行だけfav APIを送信する", () => {
  const fixture = createContext();
  const anchor = {
    textContent: "sample.cbz",
    getAttribute(name) {
      if (name === "data-filepath") return "/books/sample.cbz";
      if (name === "href") return "/books/sample.cbz";
      return null;
    },
  };
  const favoriteCell = {
    closest: (selector) => selector === "tr.file-entry-row" ? {} : null,
    querySelector: () => anchor,
    style: { backgroundImage: "", backgroundPosition: "" },
  };
  let prevented = false;
  let stopped = false;

  fixture.context.favoriteEvent = {
    currentTarget: favoriteCell,
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {
      stopped = true;
    },
  };
  vm.runInContext("toggleFavorite(favoriteEvent)", fixture.context);

  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(fixture.beaconCalls.length, 1);
  assert.equal(fixture.beaconCalls[0].url, "/cgi-bin/comistream.php");
  assert.equal(
    fixture.beaconCalls[0].data,
    "file=books%2Fsample.cbz&mode=favON"
  );
  assert.match(favoriteCell.style.backgroundImage, /staron\.png/);
});

test("通常描画と高速描画の両方がファイル行を識別する", () => {
  const dirListPhp = fs.readFileSync(
    path.join(codeDirectory, "dir_list.php"),
    "utf8"
  );
  const markers = dirListPhp.match(
    /rowClass = ' class="file-entry-row"'/g
  ) || [];

  assert.equal(markers.length, 2);
});

test("リスト・カバー表示ともファイル行だけにfavホバーを設定する", () => {
  for (const stylesheet of ["style.css", "style_cover.css"]) {
    const css = fs.readFileSync(
      path.join(codeDirectory, "..", "theme", stylesheet),
      "utf8"
    );

    assert.match(
      css,
      /tr\.file-entry-row td\.indexcolicon:hover\s*\{\s*background-position-x:\s*5px;/
    );
    assert.doesNotMatch(css, /(?:^|\n)td\.indexcolicon:hover\s*\{/);
  }
});
