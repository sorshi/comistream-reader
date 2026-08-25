const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const dirListSource = fs.readFileSync(
  path.join(__dirname, "..", "dir_list.js"),
  "utf8"
);

function createRow(name, { favorite = false, parent = false } = {}) {
  const nameCell = { textContent: name, innerText: name };
  const iconCell = {
    style: {
      backgroundImage: favorite ? 'url("/theme/icons/staron.png")' : "",
    },
  };

  return {
    classList: { contains: (className) => parent && className === "parent-dir-row" },
    style: { display: "" },
    querySelector(selector) {
      if (selector === ".indexcolname") return nameCell;
      if (selector === ".indexcolicon") return iconCell;
      return null;
    },
  };
}

function createContext(rows) {
  const listeners = new Map();
  const searchForm = { textbox: { value: "" } };
  const favButton = { style: { backgroundImage: "" }, getAttribute: () => "" };
  const tableBody = { querySelectorAll: () => rows };
  const history = {
    state: null,
    replaceState(nextState) {
      this.state = JSON.parse(JSON.stringify(nextState));
    },
  };

  const document = {
    cookie: "",
    documentElement: { clientWidth: 1200 },
    searchform: searchForm,
    addEventListener(type, handler) {
      listeners.set(`document:${type}`, handler);
    },
    getElementById(id) {
      if (id === "favbutton") return favButton;
      return null;
    },
    getElementsByClassName() {
      return [];
    },
    querySelector(selector) {
      if (selector === "#table-tbody") return tableBody;
      return null;
    },
  };

  const window = {
    location: { pathname: "/books/" },
    addEventListener(type, handler) {
      listeners.set(`window:${type}`, handler);
    },
  };

  const context = vm.createContext({
    console,
    debugLog() {},
    document,
    history,
    localStorage: { getItem: () => null },
    setTimeout,
    clearTimeout,
    window,
  });
  vm.runInContext(dirListSource, context);

  return { context, document, favButton, history, window };
}

test("履歴から検索語を復元し、Ajaxで再生成された行へ再適用する", () => {
  const parent = createRow("Parent Directory", { parent: true });
  const alpha = createRow("Alpha Book.cbz");
  const beta = createRow("Beta Book.cbz");
  const fixture = createContext([parent, alpha, beta]);

  fixture.document.searchform.textbox.value = "alpha";
  vm.runInContext("search()", fixture.context);

  assert.equal(fixture.history.state.comistreamDirectoryFilter.query, "alpha");
  assert.equal(parent.style.display, "");
  assert.equal(alpha.style.display, "");
  assert.equal(beta.style.display, "none");

  fixture.document.searchform.textbox.value = "";
  alpha.style.display = "";
  beta.style.display = "";
  vm.runInContext(
    "restoreDirectoryFilterState(); applyDirectoryFilter();",
    fixture.context
  );

  assert.equal(fixture.document.searchform.textbox.value, "alpha");
  assert.equal(alpha.style.display, "");
  assert.equal(beta.style.display, "none");
});

test("お気に入り絞り込みも履歴へ保存し、別パスには復元しない", () => {
  const favorite = createRow("Favorite.cbz", { favorite: true });
  const normal = createRow("Normal.cbz");
  const fixture = createContext([favorite, normal]);

  fixture.favButton.style.backgroundImage = 'url("/theme/icons/staron.png")';
  vm.runInContext("search()", fixture.context);

  assert.equal(
    fixture.history.state.comistreamDirectoryFilter.favoriteOnly,
    true
  );
  assert.equal(favorite.style.display, "");
  assert.equal(normal.style.display, "none");

  fixture.window.location.pathname = "/other/";
  fixture.favButton.style.backgroundImage = "";
  assert.equal(
    vm.runInContext("restoreDirectoryFilterState()", fixture.context),
    false
  );
  assert.equal(fixture.favButton.style.backgroundImage, "");
});
