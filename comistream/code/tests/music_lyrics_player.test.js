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
