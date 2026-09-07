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
