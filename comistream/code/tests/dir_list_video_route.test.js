const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const dirListSource = fs.readFileSync(
  path.join(__dirname, "..", "dir_list.js"),
  "utf8"
);
const linkhookSource = dirListSource.slice(
  dirListSource.indexOf("function linkhook(e) {"),
  dirListSource.indexOf("// ビューモード切り替え")
);

function openFromList(fileName, { loginuser = "user", raw = false } = {}) {
  const href = "https://reader.example/videos/" + encodeURIComponent(fileName);
  const anchor = {
    tagName: "A",
    href,
    innerText: fileName,
    getAttribute: (name) => (name === "data-filepath" ? "/videos/" + fileName : null),
    closest: () => null,
  };
  const context = vm.createContext({
    cgiPath: "/cgi-bin/comistream.php",
    hlsCgiPath: "/cgi-bin/livestream.php",
    loginuser,
    location: { href: "" },
    document: {
      getElementById: (id) =>
        id === "rawMode" ? { classList: { contains: (name) => raw && name === "raw" } } : null,
    },
    getCleanFilePath: () => "videos/" + fileName,
    saveScrollPosition: () => {},
    showFileLoadingSpinner: () => {},
    renderHistoryEntry: () => {},
    debugLog: () => {},
    console,
  });
  vm.runInContext(linkhookSource, context);
  context.linkhook({ target: anchor, altKey: false, preventDefault: () => {} });
  return { location: context.location.href, href };
}

test("ログイン中は mov・flv・mpeg を livestream で開く", () => {
  for (const fileName of ["IMG_0001.MOV", "clip.mov", "old.flv", "capture.mpeg"]) {
    const { location } = openFromList(fileName);
    assert.ok(
      location.startsWith("/cgi-bin/livestream.php?file="),
      `${fileName} は livestream へ遷移するはずが ${location}`
    );
    assert.ok(location.endsWith("&mode=open"), `${fileName} の mode=open が欠落: ${location}`);
  }
});

test("ゲストは mov を原本 URL で開く(HLS は使わない)", () => {
  const { location, href } = openFromList("IMG_0001.MOV", { loginuser: "guest" });
  assert.equal(location, href);
});

test("既存の動画形式の振り分けは変わらない", () => {
  assert.ok(openFromList("movie.mp4").location.startsWith("/cgi-bin/livestream.php?file="));
  const raw = openFromList("movie.mp4", { raw: true });
  assert.equal(raw.location, raw.href);
});
