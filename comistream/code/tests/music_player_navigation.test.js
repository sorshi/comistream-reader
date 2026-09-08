const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MusicPlayer,
  hasMusicLibraryReturnMarker,
  initializeMusicLibraryReturnNavigation,
} = require("../music_player.js");

function createLibraryReturnFixture({
  href = "https://reader.example/music/album/",
  referrer = "https://reader.example/music/album/?sort=name",
  historyState = null,
  historyLength = 2,
} = {}) {
  let clickHandler = null;
  const link = {
    href,
    addEventListener(type, handler) {
      if (type === "click") clickHandler = handler;
    },
  };
  const history = {
    state: historyState,
    length: historyLength,
    replaceStateCalls: 0,
    backCalls: 0,
    replaceState(nextState) {
      this.state = nextState;
      this.replaceStateCalls += 1;
    },
    back() {
      this.backCalls += 1;
    },
  };
  const browserWindow = {
    location: { origin: "https://reader.example" },
    document: { referrer },
    history,
  };

  initializeMusicLibraryReturnNavigation(link, browserWindow);
  return { browserWindow, clickHandler, history, link };
}

function dispatchPrimaryClick(handler, overrides = {}) {
  const event = {
    altKey: false,
    button: 0,
    ctrlKey: false,
    defaultPrevented: false,
    metaKey: false,
    shiftKey: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    ...overrides,
  };
  handler(event);
  return event;
}

function makeNavigationPlayer({ currentIndex = 1, repeatMode = 0, isPlaying = true } = {}) {
  const player = Object.create(MusicPlayer.prototype);
  player.currentIndex = currentIndex;
  player.musicFiles = [{ name: "first.mp3" }, { name: "last.mp3" }];
  player.repeatMode = repeatMode;
  player.isShuffled = false;
  player.isPlaying = isPlaying;
  player.audioPlayer = { currentTime: 10 };
  player.pauseCount = 0;
  player.loadCount = 0;
  player.playCount = 0;
  player.status = "";
  player.pause = () => { player.pauseCount += 1; };
  player.loadCurrentTrack = () => { player.loadCount += 1; };
  player.play = () => { player.playCount += 1; };
  player.setStatus = (message) => { player.status = message; };
  return player;
}

test("全曲リピートOFFではキュー末尾から先頭へ戻らない", () => {
  const player = makeNavigationPlayer();

  assert.equal(player.nextTrack(), false);
  assert.equal(player.currentIndex, 1);
  assert.equal(player.pauseCount, 1);
  assert.equal(player.loadCount, 0);
  assert.equal(player.playCount, 0);
  assert.equal(player.status, "再生終了");
});

test("全曲リピートONではキュー末尾から先頭へ戻る", () => {
  const player = makeNavigationPlayer({ repeatMode: 1 });

  assert.equal(player.nextTrack(), true);
  assert.equal(player.currentIndex, 0);
  assert.equal(player.pauseCount, 0);
  assert.equal(player.loadCount, 1);
  assert.equal(player.playCount, 1);
});

test("曲の終了時は次曲だけを一度再生し、末尾では停止する", () => {
  const middlePlayer = makeNavigationPlayer({ currentIndex: 0, isPlaying: false });
  middlePlayer.onTrackEnded();
  assert.equal(middlePlayer.currentIndex, 1);
  assert.equal(middlePlayer.loadCount, 1);
  assert.equal(middlePlayer.playCount, 1);

  const lastPlayer = makeNavigationPlayer();
  lastPlayer.onTrackEnded();
  assert.equal(lastPlayer.currentIndex, 1);
  assert.equal(lastPlayer.pauseCount, 1);
  assert.equal(lastPlayer.playCount, 0);
});

test("1曲リピートONでは現在の曲を先頭から再生する", () => {
  const player = makeNavigationPlayer({ repeatMode: 2 });

  player.onTrackEnded();

  assert.equal(player.currentIndex, 1);
  assert.equal(player.audioPlayer.currentTime, 0);
  assert.equal(player.loadCount, 0);
  assert.equal(player.playCount, 1);
});

test("同じライブラリから起動したプレイヤーは履歴へ戻る", () => {
  const fixture = createLibraryReturnFixture({
    historyState: { retained: "player-state" },
  });

  assert.equal(fixture.history.replaceStateCalls, 1);
  assert.equal(fixture.history.state.retained, "player-state");
  assert.equal(
    hasMusicLibraryReturnMarker(
      fixture.history.state,
      fixture.link.href,
      fixture.browserWindow.location.origin
    ),
    true
  );

  const event = dispatchPrimaryClick(fixture.clickHandler);
  assert.equal(event.defaultPrevented, true);
  assert.equal(fixture.history.backCalls, 1);
});

test("プレイヤー再読み込み後も保存済みの戻りマーカーを使う", () => {
  const firstLoad = createLibraryReturnFixture();
  const reloaded = createLibraryReturnFixture({
    referrer: "https://reader.example/cgi-bin/music_player.php?mode=open",
    historyState: firstLoad.history.state,
  });

  assert.equal(reloaded.history.replaceStateCalls, 0);
  const event = dispatchPrimaryClick(reloaded.clickHandler);
  assert.equal(event.defaultPrevented, true);
  assert.equal(reloaded.history.backCalls, 1);
});

test("直開き、別フォルダ、別タブではライブラリリンクを通常遷移に使う", () => {
  const direct = createLibraryReturnFixture({ referrer: "", historyLength: 1 });
  const otherDirectory = createLibraryReturnFixture({
    referrer: "https://reader.example/music/other/",
  });
  const newTab = createLibraryReturnFixture({ historyLength: 1 });

  for (const fixture of [direct, otherDirectory, newTab]) {
    const event = dispatchPrimaryClick(fixture.clickHandler);
    assert.equal(event.defaultPrevented, false);
    assert.equal(fixture.history.backCalls, 0);
  }
});

test("修飾クリックでは履歴を使わず、リンク本来の新規タブ操作を維持する", () => {
  const fixture = createLibraryReturnFixture();

  const event = dispatchPrimaryClick(fixture.clickHandler, { metaKey: true });
  assert.equal(event.defaultPrevented, false);
  assert.equal(fixture.history.backCalls, 0);
});
