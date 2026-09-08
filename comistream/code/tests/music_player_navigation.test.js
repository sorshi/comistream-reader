const test = require("node:test");
const assert = require("node:assert/strict");
const { MusicPlayer } = require("../music_player.js");

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
