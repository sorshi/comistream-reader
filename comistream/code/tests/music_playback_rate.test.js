const test = require("node:test");
const assert = require("node:assert/strict");
const { MusicPlayer } = require("../music_player.js");

function makePlaybackRatePlayer() {
  const audioPlayer = {
    defaultPlaybackRate: 1,
    playbackRate: 1,
    duration: 0,
    currentTime: 0,
    preservesPitch: false,
    loadCount: 0,
    load() {
      this.loadCount += 1;
    },
  };
  const player = Object.create(MusicPlayer.prototype);
  player.audioPlayer = audioPlayer;
  player.playbackRateSelect = { value: "1" };
  player.allowedPlaybackRates = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  player.requestedPlaybackRate = 1;
  player.setStatus = () => {};
  player.updateMediaPosition = () => {};
  return player;
}

test("再生速度の選択値を音源へ適用し、ピッチ維持を有効にする", () => {
  const player = makePlaybackRatePlayer();

  assert.equal(player.setPlaybackRate("1.5"), true);
  assert.equal(player.requestedPlaybackRate, 1.5);
  assert.equal(player.audioPlayer.defaultPlaybackRate, 1.5);
  assert.equal(player.audioPlayer.playbackRate, 1.5);
  assert.equal(player.audioPlayer.preservesPitch, true);
  assert.equal(player.playbackRateSelect.value, "1.5");
});

test("ratechangeは実際の表示だけを更新し、要求速度を内部リセットしない", () => {
  const player = makePlaybackRatePlayer();
  player.requestedPlaybackRate = 1.5;
  player.audioPlayer.playbackRate = 1;

  player.onPlaybackRateChange();

  assert.equal(player.requestedPlaybackRate, 1.5);
  assert.equal(player.playbackRateSelect.value, "1");
  assert.equal(player.applyPlaybackRate(), true);
  assert.equal(player.audioPlayer.playbackRate, 1.5);
});

test("音源を切り替えても要求速度を維持する", () => {
  const player = makePlaybackRatePlayer();
  player.requestedPlaybackRate = 1.75;
  player.audioLoadId = 4;
  player.audioSourcePending = true;
  player.pendingPlay = false;
  player.setStatus = () => {};

  assert.equal(player.setAudioSource("/music/next.mp3", 4, "original"), true);
  assert.equal(player.audioPlayer.playbackRate, 1.75);
  assert.equal(player.audioPlayer.defaultPlaybackRate, 1.75);
  assert.equal(player.audioPlayer.loadCount, 1);
});

test("許可されていない再生速度は要求状態を変更しない", () => {
  const player = makePlaybackRatePlayer();
  const messages = [];
  player.setStatus = (message) => messages.push(message);

  assert.equal(player.setPlaybackRate("3"), false);
  assert.equal(player.requestedPlaybackRate, 1);
  assert.equal(player.audioPlayer.playbackRate, 1);
  assert.equal(messages.length, 1);
});

