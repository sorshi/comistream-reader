const test = require("node:test");
const assert = require("node:assert/strict");
const { MusicPlayer } = require("../music_player.js");

function makeLyricsElement() {
  const classes = new Set();
  return {
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      },
    },
    setAttribute() {},
    removeAttribute() {},
    offsetTop: 0,
    offsetHeight: 20,
  };
}

function makeLyricsPlayer(lines) {
  const elements = lines.map(() => makeLyricsElement());
  const player = Object.create(MusicPlayer.prototype);
  player.audioPlayer = { currentTime: 0 };
  player.lyrics = {
    status: "ok",
    format: "lrc",
    lines,
  };
  player.lyricsContainer = {
    clientHeight: 100,
    scrollTop: 0,
    querySelectorAll() {
      return elements;
    },
  };
  player.lyricsReturnBtn = { hidden: true };
  player.currentLyricIndex = -1;
  player.lyricsUserScrolled = false;
  player.lyricsProgrammaticScroll = false;
  player.lyricsNeedsScroll = false;
  player.showingLyrics = false;
  return { player, elements };
}

test("再生位置の前は歌詞行を選択せず、同時刻は最後の行を選択する", () => {
  const { player, elements } = makeLyricsPlayer([
    { timeMs: 1000, text: "一行目" },
    { timeMs: 2000, text: "二行目" },
    { timeMs: 2000, text: "同時刻の行" },
  ]);

  player.audioPlayer.currentTime = 0.5;
  player.updateLyricsPosition();
  assert.equal(player.currentLyricIndex, -1);
  assert.equal(elements.some((element) => element.classList.contains("active")), false);

  player.audioPlayer.currentTime = 2;
  player.updateLyricsPosition();
  assert.equal(player.currentLyricIndex, 2);
  assert.equal(elements[2].classList.contains("active"), true);
});

test("手動スクロールで追従を停止し、戻る操作で再開する", () => {
  const { player } = makeLyricsPlayer([{ timeMs: 0, text: "歌詞" }]);
  player.currentLyricIndex = 0;
  player.onLyricsScroll();
  assert.equal(player.lyricsUserScrolled, true);
  assert.equal(player.lyricsReturnBtn.hidden, false);

  player.resumeLyricsFollowing();
  assert.equal(player.lyricsUserScrolled, false);
  assert.equal(player.lyricsReturnBtn.hidden, true);
});

test("曲切替後に古い歌詞レスポンスを破棄する", async () => {
  const pending = [];
  const originalFetch = global.fetch;
  global.fetch = (_url, options) => new Promise((resolve) => {
    pending.push({ resolve, signal: options.signal });
  });

  const player = Object.create(MusicPlayer.prototype);
  player.lyricsAbortController = null;
  player.lyricsRequestId = 0;
  player.lyricsTrackPath = "";
  player.lyricsReturnBtn = { hidden: true };
  player.getEmptyLyricsState = MusicPlayer.prototype.getEmptyLyricsState;
  player.renderLyrics = () => {};
  player.updateLyricsPosition = () => {};

  try {
    const firstRequest = player.loadLyrics({ path: "first.mp3" });
    const secondRequest = player.loadLyrics({ path: "second.mp3" });
    assert.equal(pending[0].signal.aborted, true);

    pending[1].resolve({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok", source: "sidecar", format: "plain", text: "新しい歌詞", lines: [] }),
    });
    await secondRequest;
    pending[0].resolve({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok", source: "sidecar", format: "plain", text: "古い歌詞", lines: [] }),
    });
    await firstRequest;
    assert.equal(player.lyrics.text, "新しい歌詞");
  } finally {
    global.fetch = originalFetch;
  }
});

test("再生リスト表示中の曲切替後も歌詞タブで取得を開始する", () => {
  const track = { path: "music/test.m4a" };
  const player = Object.create(MusicPlayer.prototype);
  player.musicFiles = [track];
  player.currentIndex = 0;
  player.showingPlaylist = true;
  player.showingLyrics = false;
  player.lyricsAbortController = null;
  player.lyricsRequestId = 0;
  player.lyricsTrackPath = "";
  player.lyricsReturnBtn = { hidden: false };
  player.lyricsStatus = { textContent: "" };
  player.lyricsContainer = { replaceChildren() {} };
  player.lyricsAttribution = { hidden: false, textContent: "" };
  player.queueTitle = { textContent: "" };
  player.playlistView = { hidden: false };
  player.lyricsView = { hidden: true };
  player.playlistTab = { tabIndex: 0, setAttribute() {} };
  player.lyricsTab = { tabIndex: -1, setAttribute() {} };
  player.displayCurrentPlaylist = () => {};
  player.updateLyricsPosition = () => {};

  player.resetLyricsForTrack(track);
  assert.equal(player.lyrics.status, "idle");
  assert.equal(player.lyricsStatus.textContent, "歌詞タブを開くと読み込みます。");

  let requestedTrack = null;
  player.loadLyrics = (selectedTrack) => {
    requestedTrack = selectedTrack;
  };
  player.selectQueueTab("lyrics");
  assert.equal(requestedTrack, track);
});

test("アーティストはメタデータ取得完了まで空欄にし、未設定時だけ不明と表示する", () => {
  const player = Object.create(MusicPlayer.prototype);
  player.trackTitle = { textContent: "" };
  player.trackArtist = { textContent: "" };

  player.updateTrackInfo({ name: "Sample Artist - Sample Title.mp3" });
  assert.equal(player.trackTitle.textContent, "Sample Title");
  assert.equal(player.trackArtist.textContent, "");

  player.applyMetadataToUI({ title: "", artist: "" });
  assert.equal(player.trackArtist.textContent, "アーティスト不明");

  player.applyMetadataToUI({ title: "Tagged Title", artist: " Tagged Artist " });
  assert.equal(player.trackTitle.textContent, "Tagged Title");
  assert.equal(player.trackArtist.textContent, "Tagged Artist");
});

test("デスクトップで長い曲情報だけを横スクロール対象にする", () => {
  const originalWindow = global.window;
  const originalRequestAnimationFrame = global.requestAnimationFrame;
  const classes = new Set();
  const properties = new Map();
  const parentElement = { clientWidth: 120 };
  const element = {
    parentElement,
    scrollWidth: 200,
    textContent: "Very Long Track Title",
    title: "",
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
    },
    style: {
      setProperty: (name, value) => properties.set(name, value),
      removeProperty: (name) => properties.delete(name),
    },
    set title(value) { this._title = value; },
    get title() { return this._title || ""; },
    removeAttribute(name) {
      if (name === "title") this.title = "";
    },
  };
  const player = Object.create(MusicPlayer.prototype);
  player.trackTitle = element;
  player.trackArtist = null;

  global.window = { matchMedia: () => ({ matches: false }) };
  global.requestAnimationFrame = (callback) => callback();
  try {
    player.refreshTrackTextOverflow();
    assert.equal(classes.has("is-overflowing"), true);
    assert.equal(properties.get("--marquee-distance"), "-80px");
    assert.equal(element.title, "Very Long Track Title");

    element.scrollWidth = 100;
    player.refreshTrackTextOverflow();
    assert.equal(classes.has("is-overflowing"), false);
    assert.equal(element.title, "");
  } finally {
    global.window = originalWindow;
    global.requestAnimationFrame = originalRequestAnimationFrame;
  }
});

test("MIMEを判定できない既存音声形式でも原本再生を試す", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      success: true,
      probeStatus: "ok",
      source: { codec: "wmav2" },
      direct: [],
      conversion: [],
    }),
  });
  const player = Object.create(MusicPlayer.prototype);
  player.audioAbortController = new AbortController();
  player.audioLoadId = 1;
  player.audioPlayer = {};
  player.baseDir = "https://example.test/";
  player.setStatus = () => {};
  let selected = null;
  player.setAudioSource = (url, loadId, sourceType) => {
    selected = { url, loadId, sourceType };
    return true;
  };

  try {
    assert.equal(await player.selectPlaybackSource({ path: "music/test.wma" }, 1), true);
    assert.deepEqual(selected, {
      url: "https://example.test/music/test.wma",
      loadId: 1,
      sourceType: "original",
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("変換済みFLACのデコード失敗時は未試行のAACへ進む", async () => {
  const player = Object.create(MusicPlayer.prototype);
  player.audioLoadId = 3;
  player.activeAudioSource = { loadId: 3, sourceType: "converted" };
  player.audioPlayer = { error: { code: 3 } };
  player.playbackInfo = {
    conversion: [{ profile: "flac" }, { profile: "aac_lc" }],
  };
  player.audioFallbackAttempted = false;
  player.audioFallbackInProgress = false;
  player.audioFallbackProfiles = new Set(["flac"]);
  player.audioAbortController = new AbortController();
  player.musicFiles = [{ path: "music/test.m4a" }];
  player.currentIndex = 0;
  player.setStatus = () => {};
  let attemptedProfiles = null;
  player.tryAudioConversionProfiles = async (_track, candidates) => {
    attemptedProfiles = candidates.map((candidate) => candidate.profile);
    player.audioSourcePending = false;
    return true;
  };

  player.onError({ type: "error" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(attemptedProfiles, ["flac", "aac_lc"]);
  assert.equal(player.audioFallbackInProgress, false);
  assert.equal(player.audioSourcePending, false);
});
