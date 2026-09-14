const test = require("node:test");
const assert = require("node:assert/strict");
const { MusicPlayer } = require("../music_player.js");

function makePlayer() {
  const player = Object.create(MusicPlayer.prototype);
  Object.assign(player, {
    musicFiles: Array.from({ length: 100 }, (_, i) => ({ path: `music/${i}.wav`, name: `${i}.wav` })),
    currentIndex: 50, user: "test", baseDir: "/music/", musicQueue: { source: "file" },
    audioPlayer: { currentTime: 42, addEventListener() {}, pause() {}, duration: 120, readyState: 1 },
    isShuffled: false, repeatMode: 0, requestedPlaybackRate: 1, volume: 0.7,
    allowedPlaybackRates: [1, 1.5, 2], queueExpanded: true, showingPlaylist: true,
  });
  const container = {
    clientHeight: 100, clientTop: 0, scrollTop: 980,
    getBoundingClientRect: () => ({ top: 100 }), addEventListener() {},
  };
  container.children = player.musicFiles.map((_, i) => ({
    classList: { add() {}, remove() {} }, setAttribute() {}, removeAttribute() {},
    getBoundingClientRect: () => ({ top: 100 + i * 20 - container.scrollTop, bottom: 120 + i * 20 - container.scrollTop }),
  }));
  player.playlistContainer = container;
  return player;
}

function withStorage(t, entries = new Map()) {
  t.mock.method(console, "warn", () => {});
  const oldWindow = global.window;
  const oldDocument = global.document;
  global.window = {
    location: { pathname: "/player", search: "?file=album" }, addEventListener() {},
    localStorage: {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => entries.set(key, value),
    },
  };
  global.document = { addEventListener() {} };
  t.after(() => { global.window = oldWindow; global.document = oldDocument; });
  return entries;
}

test("曲の強調表示更新で行DOMとスクロール位置を保持する", () => {
  const p = makePlayer();
  const rows = p.playlistContainer.children;
  p.renderedMusicFiles = p.musicFiles;
  p.renderedCurrentIndex = 49;
  p.displayCurrentPlaylist();
  p.syncQueueViewport();
  assert.equal(p.playlistContainer.children, rows);
  assert.equal(p.playlistContainer.scrollTop, 980);
});

test("画面外の曲へ必要な距離だけ追従し、通常の進捗更新では引き戻さない", () => {
  const p = makePlayer();
  p.currentIndex = 60;
  p.syncQueueViewport();
  assert.equal(p.playlistContainer.scrollTop, 1120);
  p.currentIndex = 10;
  p.syncQueueViewport();
  assert.equal(p.playlistContainer.scrollTop, 200);
  p.playlistContainer.scrollTop = 900;
  p.updateLyricsPosition = () => {};
  p.previewSeek = () => {};
  p.progressBar = {};
  p.updateProgress();
  assert.equal(p.playlistContainer.scrollTop, 900);
});

test("保存した行内位置を復元し、再開時だけ画面外の再生曲へ補正する", () => {
  const p = makePlayer();
  p.queueViewport = { path: "music/70.wav", offset: 7 };
  p.restoreQueueViewport = true;
  p.syncQueueViewport(false);
  assert.equal(p.playlistContainer.scrollTop, 1407);
  p.syncQueueViewport();
  assert.equal(p.playlistContainer.scrollTop, 1000);
});

test("非表示中の復元は保留して、表示時に行のパスから復元する", () => {
  const p = makePlayer();
  p.queueViewport = { path: "music/70.wav", offset: 7 };
  p.restoreQueueViewport = true;
  p.playlistContainer.clientHeight = 0;
  p.syncQueueViewport(false);
  assert.equal(p.restoreQueueViewport, true);
  p.playlistContainer.clientHeight = 100;
  p.musicFiles.unshift({ path: "new.wav" });
  p.playlistContainer.children.push(p.playlistContainer.children.at(-1));
  p.syncQueueViewport(false);
  assert.equal(p.playlistContainer.scrollTop, 1427);
});

test("同じURLを新しいインスタンスで開くと曲・秒数・表示位置を復元する", (t) => {
  withStorage(t);
  const first = makePlayer();
  first.initializePersistentState();
  first.playbackIntent = true;
  first.savePlayerState();
  const restored = makePlayer();
  restored.musicFiles = [{ path: "new.wav" }, ...restored.musicFiles];
  restored.currentIndex = 0;
  restored.initializePersistentState();
  assert.equal(restored.currentIndex, 51);
  assert.equal(restored.resumePosition, 42);
  assert.equal(restored.playbackIntent, true);
  assert.deepEqual(restored.queueViewport, { path: "music/49.wav", offset: 0 });
});

test("URL・ユーザー・設置先が異なると保存状態を共有しない", (t) => {
  withStorage(t);
  const first = makePlayer();
  first.initializePersistentState();
  first.savePlayerState();
  for (const change of [p => { p.user = "other"; }, p => { p.baseDir = "/other/"; }, () => { window.location.search = "?file=other"; }]) {
    const p = makePlayer();
    p.currentIndex = 0;
    change(p);
    p.initializePersistentState();
    assert.equal(p.currentIndex, 0);
    assert.equal(p.resumePosition, 0);
  }
});

test("保存曲の削除・壊れたJSON・保存禁止でも初期曲をロードできる状態を維持する", (t) => {
  const entries = withStorage(t);
  const first = makePlayer();
  first.initializePersistentState();
  first.savePlayerState();
  const p = makePlayer();
  p.musicFiles = [{ path: "different.wav" }];
  p.currentIndex = 0;
  p.initializePersistentState();
  assert.equal(p.currentIndex, 0);
  assert.equal(p.resumePosition, 0);
  entries.set(first.stateStorageKey, "{broken");
  assert.doesNotThrow(() => p.initializePersistentState());
  window.localStorage.setItem = () => { throw new Error("Storage disabled"); };
  p.playlistContainer.clientHeight = 0;
  assert.doesNotThrow(() => p.savePlayerState());
});

test("ロード中は音声要素のゼロ秒で復元秒数を上書きしない", (t) => {
  const entries = withStorage(t);
  const p = makePlayer();
  p.initializePersistentState();
  p.loadingTrack = true;
  p.resumePosition = 42;
  p.audioPlayer.currentTime = 0;
  p.playbackIntent = true;
  p.savePlayerState();
  const state = JSON.parse(entries.get(p.stateStorageKey));
  assert.equal(state.position, 42);
  assert.equal(state.playing, true);
});

test("復元はメタデータ取得後にシークしてから再生し、古いロードは無視する", () => {
  const p = makePlayer();
  p.loadingTrack = true;
  p.audioLoadId = 2;
  p.activeAudioSource = { loadId: 1 };
  p.resumePosition = 42;
  p.pendingPlay = true;
  p.applyPlaybackRate = () => {};
  p.totalTime = {};
  p.progressBar = {};
  p.updateProgress = () => {};
  let playedAt = null;
  p.play = () => { playedAt = p.audioPlayer.currentTime; };
  p.onMetadataLoaded();
  assert.equal(playedAt, null);
  assert.equal(p.resumePosition, 42);
  p.activeAudioSource.loadId = 2;
  p.onMetadataLoaded();
  assert.equal(playedAt, 42);
  assert.equal(p.loadingTrack, false);
  p.onMetadataLoaded();
  assert.equal(p.audioPlayer.currentTime, 42);
});

test("ロード中の停止操作は予約再生を取り消す", () => {
  const p = makePlayer();
  p.loadingTrack = true;
  p.pendingPlay = true;
  p.playbackIntent = true;
  p.pause();
  assert.equal(p.pendingPlay, false);
  assert.equal(p.playbackIntent, false);
});

test("保存した上端の曲が削除されたら選択曲を表示する", () => {
  const p = makePlayer();
  p.queueViewport = { path: "deleted.wav", offset: 7 };
  p.restoreQueueViewport = true;
  p.playlistContainer.scrollTop = 0;
  p.syncQueueViewport(false);
  assert.equal(p.playlistContainer.scrollTop, 920);
});

test("連続した曲変更は初回の復元秒数を次曲へ持ち越さず、再生意図を維持する", () => {
  const p = makePlayer();
  Object.assign(p, {
    audioLoadId: 0, resumePosition: 42, isPlaying: false, trackRequestId: 0,
    stopAudioLease() {}, applyPlaybackRate() {}, resetLyricsForTrack() {},
    updateTrackInfo() {}, updateCoverArt() {}, updatePlaylistDisplay() {},
    setStatus() {}, selectPlaybackSource: async () => true,
    progressBar: { style: { setProperty() {} }, setAttribute() {} },
    currentTime: {}, totalTime: {}, trackPosition: {}, queueSummary: {},
  });
  p.audioPlayer.removeAttribute = () => {};
  p.audioPlayer.load = () => { p.audioPlayer.currentTime = 0; };
  p.loadCurrentTrack(true);
  assert.equal(p.resumePosition, 42);
  assert.equal(p.pendingPlay, true);
  p.play = () => {};
  p.nextTrack();
  assert.equal(p.currentIndex, 51);
  assert.equal(p.resumePosition, 0);
  assert.equal(p.playbackIntent, true);
  assert.equal(p.audioLoadId, 2);
});

test("復元待ちの再生ボタンではシーク前に音声を開始しない", () => {
  const p = makePlayer();
  p.loadingTrack = true;
  p.resumePosition = 42;
  let playCount = 0;
  p.audioPlayer.play = () => { playCount++; };
  p.play();
  assert.equal(playCount, 0);
  assert.equal(p.pendingPlay, true);
  p.togglePlayPause();
  assert.equal(p.pendingPlay, false);
});
