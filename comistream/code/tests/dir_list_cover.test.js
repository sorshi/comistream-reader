const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(
  process.env.DIR_LIST_TEST_SOURCE || path.join(__dirname, "..", "dir_list.js"),
  "utf8"
);
const coverFunctions = source.slice(
  source.indexOf("function escapeProblematicChars(filepath)"),
  source.indexOf("// デバッグ関数：アイコンの状態を確認")
);

function createFixture(coverUrl, filepath = "Comic/Book.zip", initialCover = false) {
  const images = [];
  const anchor = { getAttribute: () => filepath };
  const cell = {
    getAttribute: (name) => name === "data-cover-image" ? coverUrl : null,
    querySelector: (selector) => selector === "a" ? anchor : images[0] || null,
    insertBefore(image, target) {
      assert.equal(target, anchor);
      images.unshift(image);
    },
  };
  const row = { querySelector: () => cell };
  const createImage = () => {
    const image = {
      style: {},
      remove() { images.splice(images.indexOf(image), 1); },
    };
    return image;
  };
  if (initialCover) {
    const image = createImage();
    image.src = coverUrl;
    images.push(image);
  }
  const context = vm.createContext({
    document: {
      querySelector: () => ({
        querySelectorAll: (selector) => selector === ".indexcolname img" ? [...images] : [row],
      }),
      createElement: createImage,
    },
  });
  vm.runInContext(coverFunctions, context);
  return { images, run: (code) => vm.runInContext(code, context) };
}

for (const initialCover of [false, true]) {
  test(`APIの表紙URLを保持して繰り返し切り替える（初期カバー: ${initialCover}）`, () => {
    const url = "/theme/covers/public/本%20%23%25%3F%26.jpg";
    const fixture = createFixture(url, "different-share/本.zip", initialCover);
    for (let i = 0; i < 3; i++) {
      fixture.run("removeCoverImages(); addCoverImages(); addCoverImages();");
      assert.equal(fixture.images.length, 1);
      assert.equal(fixture.images[0].src, url);
      assert.equal(fixture.images[0].style.display, "block");
    }
  });
}

test("表紙URLがない行やディレクトリには画像を追加しない", () => {
  for (const [url, filepath] of [[null, "Book.zip"], ["/theme/covers/folder.jpg", "folder/"]]) {
    const fixture = createFixture(url, filepath);
    fixture.run("addCoverImages();");
    assert.equal(fixture.images.length, 0);
  }
});

test("読み込み失敗時は画像を非表示にする", () => {
  const fixture = createFixture("/theme/covers/missing.jpg");
  fixture.run("addCoverImages();");
  fixture.images[0].onerror();
  assert.equal(fixture.images[0].style.display, "none");
});
