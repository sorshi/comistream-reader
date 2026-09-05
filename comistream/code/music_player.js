/**
 * Comistream Reader - Music Player JavaScript
 *
 * 音楽プレイヤーのフロントエンド機能を提供します。
 * iOS 18 Safari対応のバックグラウンド再生、Media Session API、
 * プレイリスト管理などを実装しています。
 *
 * @package     sorshi/comistream-reader
 * @author      Comistream Project.
 * @copyright   2024 Comistream Project.
 * @license     AGPL-3.0-only for Comistream Reader project-specific portions; see repository-root LICENSING.md
 * @version     2.0.0
 */

class MusicPlayer {
  constructor() {
    this.audioPlayer = document.getElementById("audioPlayer");
    this.currentIndex = window.currentIndex || 0;
    this.musicFiles = window.musicFiles || [];
    this.user = window.user || "guest";
    this.baseDir = window.baseDir || "/";

    // プレイヤー状態
    this.isPlaying = false;
    this.isShuffled = false;
    this.repeatMode = 0; // 0: none, 1: all, 2: one
    this.volume = 0.7;
    this.volumeDragging = false;

    // プレイリスト関連
    this.currentPlaylist = null;
    this.playlists = [];
    this.showingPlaylist = true;
    this.isSeeking = false;
    this.trackRequestId = 0;

    // DOM要素の取得
    this.initDOMElements();

    // イベントリスナーの設定
    this.initEventListeners();

    // Media Session API の設定 (iOS 18 Safari バックグラウンド再生対応)
    this.initMediaSession();

    this.initPlaylistDialog();
    this.setVolume(this.volume);

    // 初期楽曲をロード
    this.loadCurrentTrack();

    console.log(
      "Music Player initialized with",
      this.musicFiles.length,
      "tracks"
    );
  }

  initDOMElements() {
    // プレイヤーコントロール
    this.playPauseBtn = document.getElementById("playPauseBtn");
    this.prevBtn = document.getElementById("prevBtn");
    this.nextBtn = document.getElementById("nextBtn");
    this.shuffleBtn = document.getElementById("shuffleBtn");
    this.repeatBtn = document.getElementById("repeatBtn");

    // プログレスバー
    this.progressBar = document.getElementById("progressBar");
    this.albumArt = document.querySelector(".album-art");
    this.playerStatus = document.getElementById("playerStatus");
    this.trackPosition = document.getElementById("trackPosition");
    this.queueSummary = document.getElementById("queueSummary");

    // 時間表示
    this.currentTime = document.getElementById("currentTime");
    this.totalTime = document.getElementById("totalTime");

    // 楽曲情報
    this.trackTitle = document.getElementById("trackTitle");
    this.trackArtist = document.getElementById("trackArtist");

    // ボリューム
    this.volumeSlider = document.getElementById("volumeSlider");

    // プレイリスト関連
    this.showPlaylistBtn = document.getElementById("showPlaylistBtn");
    this.createPlaylistBtn = document.getElementById("createPlaylistBtn");
    this.addToPlaylistBtn = document.getElementById("addToPlaylistBtn");
    this.playlistContainer = document.getElementById("playlistContainer");
    // ダウンロード
    this.downloadBtn = document.getElementById("downloadBtn");
  }

  initEventListeners() {
    // プレイヤーコントロール
    this.playPauseBtn.addEventListener("click", () => this.togglePlayPause());
    this.prevBtn.addEventListener("click", () => this.previousTrack());
    this.nextBtn.addEventListener("click", () => this.nextTrack());
    this.shuffleBtn.addEventListener("click", () => this.toggleShuffle());
    this.repeatBtn.addEventListener("click", () => this.toggleRepeat());

    // 指でのドラッグとキーボードの両方でシークするルン。
    this.progressBar.addEventListener("input", () => {
      this.isSeeking = true;
      this.previewSeek();
    });
    this.progressBar.addEventListener("change", () => {
      this.seekTo();
      this.isSeeking = false;
      this.updateProgress();
    });
    const cancelSeek = () => {
      this.isSeeking = false;
      this.updateProgress();
    };
    this.progressBar.addEventListener("pointercancel", cancelSeek);
    this.progressBar.addEventListener("blur", cancelSeek);

    // ボリューム調整（誤操作防止のため複数イベント対応）
    this.volumeSlider.addEventListener("input", (e) => {
      e.stopPropagation(); // イベントの伝播を停止
      this.setVolume(e.target.value / 100);
    });
    this.volumeSlider.addEventListener("change", (e) => {
      e.stopPropagation(); // イベントの伝播を停止
      this.setVolume(e.target.value / 100);
    });

    // ボリューム操作中は他のイベントを無効化
    this.volumeSlider.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      this.volumeDragging = true;
    });
    this.volumeSlider.addEventListener("mouseup", (e) => {
      e.stopPropagation();
      this.volumeDragging = false;
    });
    this.volumeSlider.addEventListener("touchstart", (e) => {
      e.stopPropagation();
      this.volumeDragging = true;
    });
    this.volumeSlider.addEventListener("touchend", (e) => {
      e.stopPropagation();
      this.volumeDragging = false;
    });

    window.addEventListener("pointerup", () => { this.volumeDragging = false; });
    window.addEventListener("pointercancel", () => { this.volumeDragging = false; });
    this.volumeSlider.addEventListener("touchcancel", () => { this.volumeDragging = false; });

    // オーディオイベント
    this.audioPlayer.addEventListener("loadedmetadata", () =>
      this.onMetadataLoaded()
    );
    this.audioPlayer.addEventListener("timeupdate", () =>
      this.updateProgress()
    );
    this.audioPlayer.addEventListener("ended", () => this.onTrackEnded());
    this.audioPlayer.addEventListener("play", () => this.onPlay());
    this.audioPlayer.addEventListener("pause", () => this.onPause());
    this.audioPlayer.addEventListener("error", (e) => this.onError(e));
    this.audioPlayer.addEventListener("waiting", () => this.setStatus("読み込み中…"));
    this.audioPlayer.addEventListener("playing", () => this.setStatus("再生中"));

    // プレイリスト関連
    this.showPlaylistBtn.addEventListener("click", () =>
      this.togglePlaylistView()
    );
    this.createPlaylistBtn.addEventListener("click", () =>
      this.showCreatePlaylistDialog()
    );
    this.addToPlaylistBtn.addEventListener("click", () =>
      this.showAddToPlaylistDialog()
    );

    // キーボードショートカット
    document.addEventListener("keydown", (e) => this.handleKeyPress(e));

    // モバイル対応（タッチ操作）
    this.initTouchGestures();

    // ページの可視性変更 (バックグラウンド対応)
    document.addEventListener("visibilitychange", () =>
      this.onVisibilityChange()
    );
  }

  initMediaSession() {
    if ("mediaSession" in navigator) {
      // iOS 18 Safari 対応の Media Session API 設定
      navigator.mediaSession.setActionHandler("play", () => this.play());
      navigator.mediaSession.setActionHandler("pause", () => this.pause());
      navigator.mediaSession.setActionHandler("previoustrack", () =>
        this.previousTrack()
      );
      navigator.mediaSession.setActionHandler("nexttrack", () =>
        this.nextTrack()
      );
      navigator.mediaSession.setActionHandler("seekbackward", (details) => {
        const skipTime = details.seekOffset || 10;
        this.audioPlayer.currentTime = Math.max(
          this.audioPlayer.currentTime - skipTime,
          0
        );
      });
      navigator.mediaSession.setActionHandler("seekforward", (details) => {
        const skipTime = details.seekOffset || 10;
        this.audioPlayer.currentTime = Math.min(
          this.audioPlayer.currentTime + skipTime,
          this.audioPlayer.duration
        );
      });

      // iOS Safari での追加対応
      try {
        navigator.mediaSession.setActionHandler("seekto", (details) => {
          if (Number.isFinite(details.seekTime)) {
            this.audioPlayer.currentTime = details.seekTime;
          }
        });
        navigator.mediaSession.setActionHandler("stop", () => {
          this.pause();
          this.audioPlayer.currentTime = 0;
        });
      } catch (error) {
        console.log("Some Media Session actions not supported:", error);
      }

      console.log("Media Session API initialized for iOS 18 Safari");
    }

    // iOS Safari のバックグラウンド再生を確実にするための追加設定
    if (navigator.userAgent.match(/iPhone|iPad|iPod/i)) {
      this.setupiOSAudioSession();
    }

    // ハードウェアボリューム変化の監視を試行
    this.setupHardwareVolumeSync();
  }

  setupiOSAudioSession() {
    // iOS Safari でのオーディオセッション設定
    this.audioPlayer.addEventListener("canplay", () => {
      // オーディオコンテキストの状態を確認・再開
      // iOS Safari では WebAudio 経由のノード接続を避け、media element のまま再生
      // ここでは AudioContext の作成・接続を行わない
    });

    // iOS でのバックグラウンド継続のための工夫
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.isPlaying) {
        // バックグラウンドに移行時の処理
        setTimeout(() => {
          if (this.isPlaying && this.audioPlayer.paused) {
            // オーディオが停止してしまった場合の復旧
            this.audioPlayer.play().catch(console.error);
          }
        }, 100);
      }
    });

    // iOS Safari での自動再生ポリシー対応
    this.audioPlayer.addEventListener("loadstart", () => {
      // プリロードを設定して途切れを防ぐ
      this.audioPlayer.preload = "auto";
      this.audioPlayer.setAttribute("playsinline", "");
      this.audioPlayer.setAttribute("webkit-playsinline", "");
    });
  }

  setupHardwareVolumeSync() {
    // ハードウェアボリューム変化の検出を試行
    // 注意: セキュリティ上の制限により多くのブラウザで制限されています
    try {
      // iOS の制限を考慮し、AudioContext を常設しない
      // ボリュームの同期は media element の volumechange で対応
      this.audioPlayer.addEventListener("volumechange", () => {
        if (!this.volumeDragging) {
          const newVolume = this.audioPlayer.volume;
          this.volumeSlider.value = newVolume * 100;
          this.volumeSlider.style.setProperty("--progress", `${newVolume * 100}%`);
          this.volume = newVolume;
          console.log("Volume changed:", newVolume);
        }
      });
    } catch (error) {
      console.log("Hardware volume sync not supported:", error);
    }
  }

  loadCurrentTrack() {
    if (this.musicFiles.length === 0) return;

    const currentTrack = this.musicFiles[this.currentIndex];
    if (!currentTrack) return;

    // オーディオソースを設定
    const audioUrl = this.baseDir + currentTrack.path.split("/").map(encodeURIComponent).join("/");
    this.isSeeking = false;
    this.progressBar.value = 0;
    this.progressBar.disabled = true;
    this.progressBar.style.setProperty("--progress", "0%");
    this.progressBar.setAttribute("aria-valuetext", "0:00");
    this.currentTime.textContent = "0:00";
    this.totalTime.textContent = "0:00";
    this.trackPosition.textContent = `${this.currentIndex + 1} / ${this.musicFiles.length}`;
    this.queueSummary.textContent = `${this.musicFiles.length} 曲 · 曲を選んで切り替え`;
    this.setStatus("");
    this.audioPlayer.src = audioUrl;
    // ダウンロードリンク更新
    if (this.downloadBtn) {
      this.downloadBtn.href = audioUrl;
      this.downloadBtn.setAttribute("download", currentTrack.name || "audio");
    }

    // トラック情報を更新
    this.updateTrackInfo(currentTrack);

    // カバーアート表示を更新
    this.updateCoverArt(currentTrack);

    // プレイリスト表示を更新
    this.updatePlaylistDisplay();

    console.log("Loaded track:", currentTrack.name);
  }

  updateTrackInfo(track) {
    this.trackTitle.textContent = track.name;

    // ファイル名から推測してアーティスト情報を抽出
    const fileName = track.name;
    const artistMatch = fileName.match(/^(.+?)\s*[-–]\s*(.+?)\./);
    if (artistMatch) {
      this.trackArtist.textContent = artistMatch[1];
      this.trackTitle.textContent = artistMatch[2];
    } else {
      this.trackArtist.textContent = "アーティスト不明";
    }

    // Media Session metadata を更新
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.trackTitle.textContent,
        artist: this.trackArtist.textContent,
        album: "Comistream Player",
        artwork: [
          { src: "/theme/icons/audio.png", sizes: "96x96", type: "image/png" },
        ],
      });
    }
  }

  applyMetadataToUI(metadata) {
    if (!metadata) return;
    const { title, artist } = metadata;
    if (artist && typeof artist === "string") {
      this.trackArtist.textContent = artist;
    }
    if (title && typeof title === "string") {
      this.trackTitle.textContent = title;
    }
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: this.trackTitle.textContent,
        artist: this.trackArtist.textContent,
        album: "Comistream Player",
        artwork: [
          { src: "/theme/icons/audio.png", sizes: "96x96", type: "image/png" },
        ],
      });
    }
  }

  togglePlayPause() {
    if (this.isPlaying) {
      this.pause();
    } else {
      this.play();
    }
  }

  play() {
    const playPromise = this.audioPlayer.play();

    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          console.log("Playback started successfully");
        })
        .catch((error) => {
          console.error("Playback failed:", error);
          // iOS Safari でのユーザージェスチャー要求エラーの処理
          if (error.name === "NotAllowedError") {
            this.setStatus("再生ボタンをタップして再生してください。");
          } else if (error.name !== "AbortError") {
            this.setStatus("再生できませんでした。ファイル形式や通信状態を確認してください。");
          }
        });
    }
  }

  pause() {
    this.audioPlayer.pause();
  }

  onPlay() {
    this.isPlaying = true;
    this.playPauseBtn.className = "control-btn play-pause-btn icon-pause";
    this.playPauseBtn.title = "一時停止";
    this.playPauseBtn.dataset.tooltip = "一時停止";
    this.playPauseBtn.setAttribute("aria-label", "一時停止");
    this.setStatus("再生中");

    // バックグラウンド再生のためのWakeLock API (対応ブラウザのみ)
    this.requestWakeLock();

    // Media Session の状態を更新
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.playbackState = "playing";
      } catch (_) {}
    }
  }

  onPause() {
    this.isPlaying = false;
    this.playPauseBtn.className = "control-btn play-pause-btn icon-play";
    this.playPauseBtn.title = "再生";
    this.playPauseBtn.dataset.tooltip = "再生";
    this.playPauseBtn.setAttribute("aria-label", "再生");
    this.setStatus("一時停止中");

    // WakeLockを解除
    this.releaseWakeLock();

    // Media Session の状態を更新
    if ("mediaSession" in navigator) {
      try {
        navigator.mediaSession.playbackState = "paused";
      } catch (_) {}
    }
  }

  async requestWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        this.wakeLock = await navigator.wakeLock.request("screen");
        console.log("Screen wake lock acquired");
      }
    } catch (err) {
      console.log("Wake lock request failed:", err);
    }
  }

  releaseWakeLock() {
    if (this.wakeLock) {
      this.wakeLock.release();
      this.wakeLock = null;
      console.log("Screen wake lock released");
    }
  }

  onVisibilityChange() {
    if (document.hidden && this.isPlaying) this.updateMediaPosition();
  }

  previousTrack() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
    } else if (this.repeatMode === 1) {
      // repeat all
      this.currentIndex = this.musicFiles.length - 1;
    } else {
      return; // 最初の曲でリピートなしの場合は何もしない
    }

    const shouldPlay = this.isPlaying;
    this.loadCurrentTrack();
    if (shouldPlay) {
      this.play();
    }
  }

  nextTrack() {
    console.log(
      "nextTrack() called, current index:",
      this.currentIndex,
      "repeatMode:",
      this.repeatMode,
      "isShuffled:",
      this.isShuffled
    );

    if (this.isShuffled) {
      // シャッフルモード
      this.currentIndex = Math.floor(Math.random() * this.musicFiles.length);
    } else {
      if (this.currentIndex < this.musicFiles.length - 1) {
        this.currentIndex++;
      } else if (this.repeatMode === 1) {
        // repeat all
        this.currentIndex = 0;
      } else {
        // デフォルト状態（repeatMode = 0）でも最初の曲に戻って連続再生
        if (this.repeatMode === 0) {
          this.currentIndex = 0;
        } else if (this.repeatMode !== 2) {
          // repeat oneでなければ停止
          console.log("Stopping playback - no repeat mode");
          this.pause();
          return;
        }
      }
    }

    console.log("Moving to track index:", this.currentIndex);
    const shouldPlay = this.isPlaying;
    this.loadCurrentTrack();
    if (shouldPlay) {
      this.play();
    }
  }

  onTrackEnded() {
    console.log("Track ended, repeatMode:", this.repeatMode);
    if (this.repeatMode === 2) {
      // repeat one
      this.audioPlayer.currentTime = 0;
      this.play();
    } else {
      this.nextTrack();
      // 楽曲終了からの自動進行時は必ず再生を開始する
      console.log(
        "Auto-advancing to next track, currentIndex:",
        this.currentIndex
      );
      this.play();
    }
  }

  toggleShuffle() {
    this.isShuffled = !this.isShuffled;
    if (this.isShuffled) {
      this.shuffleBtn.classList.add("shuffle-active");
      this.shuffleBtn.title = "シャッフル: ON";
      this.shuffleBtn.dataset.tooltip = "シャッフル: ON";
    } else {
      this.shuffleBtn.classList.remove("shuffle-active");
      this.shuffleBtn.title = "シャッフル: OFF";
      this.shuffleBtn.dataset.tooltip = "シャッフル: OFF";
    }
    this.shuffleBtn.setAttribute("aria-pressed", String(this.isShuffled));
    this.shuffleBtn.setAttribute("aria-label", this.shuffleBtn.title);
    console.log("Shuffle mode:", this.isShuffled);
  }

  toggleRepeat() {
    this.repeatMode = (this.repeatMode + 1) % 3;

    // リピートモードによってクラスとタイトルを更新
    this.repeatBtn.classList.remove(
      "repeat-active",
      "icon-repeat",
      "icon-repeat-one"
    );

    switch (this.repeatMode) {
      case 0: // none
        this.repeatBtn.classList.add("icon-repeat");
        this.repeatBtn.title = "リピート: OFF";
        this.repeatBtn.dataset.tooltip = "リピート: OFF";
        break;
      case 1: // all
        this.repeatBtn.classList.add("icon-repeat", "repeat-active");
        this.repeatBtn.title = "リピート: 全曲";
        this.repeatBtn.dataset.tooltip = "リピート: 全曲";
        break;
      case 2: // one
        this.repeatBtn.classList.add("icon-repeat-one", "repeat-active");
        this.repeatBtn.title = "リピート: 1曲";
        this.repeatBtn.dataset.tooltip = "リピート: 1曲";
        break;
    }

    this.repeatBtn.setAttribute("aria-pressed", String(this.repeatMode !== 0));
    this.repeatBtn.setAttribute("aria-label", this.repeatBtn.title);
    console.log("Repeat mode:", this.repeatMode);
  }

  async updateCoverArt(track) {
    // 前の曲の応答で現在の表示を上書きしないルン。
    const requestId = ++this.trackRequestId;
    this.trackAbortController?.abort();
    this.trackAbortController = new AbortController();
    const { signal } = this.trackAbortController;
    if (this.coverObjectUrl) URL.revokeObjectURL(this.coverObjectUrl);
    this.coverObjectUrl = null;
    this.albumArt.style.backgroundImage = "";
    this.albumArt.classList.remove("has-cover");
    this.albumArt.setAttribute("aria-label", `${track.name} のアルバムアート`);
    const query = encodeURIComponent(track.path);
    await Promise.all([
      (async () => {
        try {
          const response = await fetch(`/cgi-bin/music_player.php?mode=get_cover_art&file=${query}`, { signal, cache: "force-cache" });
          if (!response.ok || response.status === 204) return;
          const blob = await response.blob();
          if (requestId !== this.trackRequestId) return;
          this.coverObjectUrl = URL.createObjectURL(blob);
          this.albumArt.style.backgroundImage = `url("${this.coverObjectUrl}")`;
          this.albumArt.classList.add("has-cover");
        } catch (error) {
          if (error.name !== "AbortError") console.log("Cover fetch failed:", error);
        }
      })(),
      (async () => {
        try {
          const response = await fetch(`/cgi-bin/music_player.php?mode=get_metadata&file=${query}`, { signal, headers: { Accept: "application/json" }, cache: "force-cache" });
          if (!response.ok) return;
          const metadata = await response.json();
          if (requestId === this.trackRequestId && metadata.success) this.applyMetadataToUI(metadata);
        } catch (error) {
          if (error.name !== "AbortError") console.log("Metadata fetch failed:", error);
        }
      })(),
    ]);
  }

  async extractCoverArt() {
    return null;
  }

  // 旧クライアント抽出は無効化

  async extractMetadata(arrayBuffer, filename) {
    try {
      const dataView = new DataView(arrayBuffer);
      const ext = filename.toLowerCase().split(".").pop();
      if (ext === "mp3") {
        return this.extractMP3Metadata(dataView);
      }
      if (ext === "flac") {
        return this.extractFLACMetadata(dataView);
      }
      if (ext === "m4a" || ext === "mp4") {
        return this.extractM4AMetadata(dataView);
      }
    } catch (e) {
      console.log("Metadata extraction error:", e);
    }
    return null;
  }

  extractMP3Metadata(dataView) {
    if (
      dataView.getUint8(0) !== 0x49 ||
      dataView.getUint8(1) !== 0x44 ||
      dataView.getUint8(2) !== 0x33
    ) {
      return null;
    }
    const version = dataView.getUint8(3);
    const flags = dataView.getUint8(5);
    let tagSize = 0;
    for (let i = 6; i < 10; i++) {
      tagSize = (tagSize << 7) + (dataView.getUint8(i) & 0x7f);
    }
    let offset = 10;
    if (flags & 0x40) {
      const extHeaderSize = dataView.getUint32(offset);
      offset += extHeaderSize;
    }
    let title = "";
    let artist = "";
    while (offset + 10 <= tagSize + 10) {
      const id0 = dataView.getUint8(offset);
      const id1 = dataView.getUint8(offset + 1);
      const id2 = dataView.getUint8(offset + 2);
      const id3 = dataView.getUint8(offset + 3);
      if (id0 === 0 && id1 === 0 && id2 === 0 && id3 === 0) break;
      const frameId = String.fromCharCode(id0, id1, id2, id3);
      let frameSize;
      if (version >= 4) {
        frameSize = 0;
        for (let i = 0; i < 4; i++) {
          frameSize =
            (frameSize << 7) + (dataView.getUint8(offset + 4 + i) & 0x7f);
        }
      } else {
        frameSize = dataView.getUint32(offset + 4);
      }
      const dataOffset = offset + 10;
      if (frameSize <= 0 || dataOffset + frameSize > dataView.byteLength) break;
      if (frameId === "TIT2" || frameId === "TPE1") {
        const encoding = dataView.getUint8(dataOffset);
        const textBytes = new Uint8Array(
          dataView.buffer,
          dataOffset + 1,
          frameSize - 1
        );
        const text = this.decodeID3Text(textBytes, encoding);
        if (frameId === "TIT2") title = text;
        if (frameId === "TPE1") artist = text;
      }
      offset += 10 + frameSize;
      if (title && artist) break;
    }
    if (title || artist) return { title, artist };
    return null;
  }

  decodeID3Text(bytes, encoding) {
    try {
      if (encoding === 0) {
        // ISO-8859-1
        return new TextDecoder("iso-8859-1")
          .decode(bytes)
          .replace(/\u0000+$/, "");
      }
      if (encoding === 1) {
        // UTF-16 with BOM
        return new TextDecoder("utf-16").decode(bytes).replace(/\u0000+$/, "");
      }
      if (encoding === 2) {
        // UTF-16BE without BOM
        return new TextDecoder("utf-16be")
          .decode(bytes)
          .replace(/\u0000+$/, "");
      }
      if (encoding === 3) {
        // UTF-8
        return new TextDecoder("utf-8").decode(bytes).replace(/\u0000+$/, "");
      }
    } catch (_) {}
    return "";
  }

  extractFLACMetadata(dataView) {
    if (
      String.fromCharCode(
        dataView.getUint8(0),
        dataView.getUint8(1),
        dataView.getUint8(2),
        dataView.getUint8(3)
      ) !== "fLaC"
    ) {
      return null;
    }
    let offset = 4;
    let title = "";
    let artist = "";
    while (offset < dataView.byteLength) {
      const blockHeader = dataView.getUint32(offset);
      const isLast = (blockHeader & 0x80000000) !== 0;
      const blockType = (blockHeader >> 24) & 0x7f;
      const blockSize = blockHeader & 0xffffff;
      offset += 4;
      if (blockType === 4) {
        // VORBIS_COMMENT
        let p = offset;
        if (p + 4 > dataView.byteLength) break;
        const vendorLen = dataView.getUint32(p, true);
        p += 4 + vendorLen;
        if (p + 4 > dataView.byteLength) break;
        const userCount = dataView.getUint32(p, true);
        p += 4;
        for (let i = 0; i < userCount; i++) {
          if (p + 4 > dataView.byteLength) break;
          const len = dataView.getUint32(p, true);
          p += 4;
          const bytes = new Uint8Array(dataView.buffer, p, len);
          p += len;
          const kv = new TextDecoder("utf-8").decode(bytes);
          const eq = kv.indexOf("=");
          if (eq > 0) {
            const key = kv.slice(0, eq).toUpperCase();
            const val = kv.slice(eq + 1);
            if (key === "TITLE") title = val;
            if (key === "ARTIST") artist = val;
          }
        }
        if (title || artist) return { title, artist };
      }
      offset += blockSize;
      if (isLast) break;
    }
    return null;
  }

  extractM4AMetadata(dataView) {
    // 非常に簡易的なmp4 ilst/©nam/©ART解析
    let offset = 0;
    let title = "";
    let artist = "";
    const len = dataView.byteLength;
    const readAtom = (start) => {
      if (start + 8 > len) return null;
      const size = dataView.getUint32(start);
      const type = String.fromCharCode(
        dataView.getUint8(start + 4),
        dataView.getUint8(start + 5),
        dataView.getUint8(start + 6),
        dataView.getUint8(start + 7)
      );
      return { size, type };
    };
    const readTextFromDataAtom = (pos, totalSize) => {
      // data atom: 4(size) 4('data') 4(version/flags) 4(type set) 4(locale) then payload
      let p = pos + 8; // after header
      if (p + 8 > len) return "";
      p += 8; // skip version/flags and type set
      if (p + 4 > len) return "";
      p += 4; // skip locale
      const payloadSize = totalSize - (p - pos);
      if (payloadSize <= 0) return "";
      const bytes = new Uint8Array(dataView.buffer, p, payloadSize);
      try {
        return new TextDecoder("utf-8").decode(bytes).replace(/\u0000+$/, "");
      } catch {
        return "";
      }
    };
    while (offset + 8 <= len) {
      const atom = readAtom(offset);
      if (!atom || atom.size <= 0) break;
      if (
        atom.type === "moov" ||
        atom.type === "udta" ||
        atom.type === "meta" ||
        atom.type === "ilst"
      ) {
        // dive into container atoms
        let inner = offset + 8;
        if (atom.type === "meta") inner += 4; // skip meta header
        const end = offset + atom.size;
        while (inner + 8 <= end) {
          const sub = readAtom(inner);
          if (!sub || sub.size <= 0) break;
          if (
            sub.type === "©nam" ||
            sub.type === "©ART" ||
            sub.type === "aART"
          ) {
            // look for data atom inside
            let p = inner + 8;
            const subEnd = inner + sub.size;
            while (p + 8 <= subEnd) {
              const dataAtom = readAtom(p);
              if (!dataAtom || dataAtom.size <= 0) break;
              if (dataAtom.type === "data") {
                const text = readTextFromDataAtom(p, dataAtom.size);
                if (sub.type === "©nam") title = text;
                else artist = text;
                break;
              }
              p += dataAtom.size;
            }
          }
          inner += sub.size;
        }
      }
      offset += atom.size;
    }
    if (title || artist) return { title, artist };
    return null;
  }

  previewSeek() {
    const duration = this.audioPlayer.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const fraction = Number(this.progressBar.value) / 1000;
    const time = this.formatTime(fraction * duration);
    this.progressBar.style.setProperty("--progress", `${fraction * 100}%`);
    this.progressBar.setAttribute("aria-valuetext", `${time} / ${this.formatTime(duration)}`);
    this.currentTime.textContent = time;
  }

  seekTo() {
    const duration = this.audioPlayer.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    this.audioPlayer.currentTime = Math.max(0, Math.min(Number(this.progressBar.value) / 1000 * duration, duration));
    this.updateMediaPosition();
  }

  updateMediaPosition() {
    const duration = this.audioPlayer.duration;
    if (!Number.isFinite(duration) || duration <= 0 || !navigator.mediaSession?.setPositionState) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: this.audioPlayer.playbackRate,
        position: Math.max(0, Math.min(this.audioPlayer.currentTime, duration)),
      });
    } catch (error) {
      console.log("Media position unavailable:", error);
    }
  }

  setVolume(volume) {
    const requested = Math.max(0, Math.min(volume, 1));
    this.audioPlayer.volume = requested;
    this.volume = this.audioPlayer.volume;
    this.volumeSlider.value = this.volume * 100;
    this.volumeSlider.style.setProperty("--progress", `${this.volume * 100}%`);
    // 音量変更が反映されない端末では、本体の操作を案内するルン。
    const systemVolume = Math.abs(this.volume - requested) > 0.01;
    this.volumeSlider.hidden = systemVolume;
    document.getElementById("volumeHint").hidden = !systemVolume;
  }

  onMetadataLoaded() {
    this.totalTime.textContent = this.formatTime(this.audioPlayer.duration);
    this.progressBar.disabled = !Number.isFinite(this.audioPlayer.duration) || this.audioPlayer.duration <= 0;
    this.updateProgress();
  }

  updateProgress() {
    const duration = this.audioPlayer.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    if (!this.isSeeking) {
      this.progressBar.value = Math.max(0, Math.min(this.audioPlayer.currentTime / duration * 1000, 1000));
      this.previewSeek();
    }
    if (this.isPlaying) this.updateMediaPosition();
  }

  formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";

    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${minutes}:${secs.toString().padStart(2, "0")}`;
  }

  onError(event) {
    console.error("Audio error:", event);
    this.setStatus("音楽ファイルを再生できません。形式や通信状態を確認して、再生をやり直してください。");
  }

  updatePlaylistDisplay() {
    if (this.showingPlaylist) {
      this.displayCurrentPlaylist();
    }
  }

  displayCurrentPlaylist() {
    // ファイル名はHTMLとして解釈せず、そのまま表示するルン。
    const fragment = document.createDocumentFragment();
    this.musicFiles.forEach((track, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "playlist-item" + (index === this.currentIndex ? " active" : "");
      if (index === this.currentIndex) item.setAttribute("aria-current", "true");
      const number = document.createElement("span");
      number.className = "track-number";
      number.textContent = String(index + 1).padStart(2, "0");
      const name = document.createElement("span");
      name.className = "track-name";
      name.textContent = track.name;
      const format = document.createElement("span");
      format.className = "track-format";
      format.textContent = track.name.includes(".") ? track.name.split(".").pop().toUpperCase() : "";
      format.setAttribute("aria-hidden", "true");
      item.append(number, name, format);
      item.addEventListener("click", () => {
        const shouldPlay = this.isPlaying;
        this.currentIndex = index;
        this.loadCurrentTrack();
        if (shouldPlay) this.play();
        // 描画後も選択した曲にキーボードフォーカスを残すルン。
        this.playlistContainer.children[index]?.focus({ preventScroll: true });
      });
      fragment.appendChild(item);
    });
    this.playlistContainer.replaceChildren(fragment);
  }

  togglePlaylistView() {
    this.showingPlaylist = !this.showingPlaylist;
    this.playlistContainer.hidden = !this.showingPlaylist;
    this.showPlaylistBtn.setAttribute("aria-expanded", String(this.showingPlaylist));
    this.showPlaylistBtn.textContent = this.showingPlaylist ? "折りたたむ" : "曲を表示";
    if (this.showingPlaylist) this.displayCurrentPlaylist();
  }

  setStatus(message) {
    this.playerStatus.textContent = message;
  }

  initPlaylistDialog() {
    this.playlistDialog = document.getElementById("playlistDialog");
    this.playlistForm = document.getElementById("playlistForm");
    this.dialogStatus = document.getElementById("dialogStatus");
    this.dialogSubmit = document.getElementById("dialogSubmit");
    this.dialogCancel = document.getElementById("dialogCancel");
    this.dialogCancel.addEventListener("click", () => this.playlistDialog.close());
    this.playlistDialog.addEventListener("cancel", (event) => {
      if (this.dialogBusy) event.preventDefault();
    });
    this.playlistForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (this.dialogBusy) return;
      const isCreate = this.dialogMode === "create";
      const name = document.getElementById("playlistName").value.trim();
      const playlistId = document.getElementById("playlistSelect").value;
      if (isCreate && !name) {
        this.dialogStatus.textContent = "プレイリスト名を入力してください。";
        document.getElementById("playlistName").focus();
        return;
      }
      if (!isCreate && !this.playlists.some((playlist) => String(playlist.id) === playlistId)) return;
      this.dialogBusy = true;
      this.dialogSubmit.disabled = true;
      this.dialogCancel.disabled = true;
      this.dialogStatus.textContent = "保存中…";
      const success = isCreate
        ? await this.createPlaylist(name, document.getElementById("playlistDescription").value.trim())
        : await this.addToPlaylist(playlistId, this.dialogTrack);
      this.dialogBusy = false;
      this.dialogSubmit.disabled = false;
      this.dialogCancel.disabled = false;
      if (success) this.playlistDialog.close();
    });
  }

  openPlaylistDialog(mode) {
    if (this.playlistDialog.open || this.dialogBusy) return false;
    this.dialogMode = mode;
    this.playlistForm.reset();
    this.dialogStatus.textContent = "";
    const isCreate = mode === "create";
    document.getElementById("dialogTitle").textContent = isCreate ? "プレイリスト作成" : "現在の曲を追加";
    document.getElementById("createFields").hidden = !isCreate;
    document.getElementById("playlistName").disabled = !isCreate;
    document.getElementById("playlistDescription").disabled = !isCreate;
    document.getElementById("selectField").hidden = isCreate;
    document.getElementById("playlistSelect").disabled = isCreate;
    this.dialogSubmit.textContent = isCreate ? "作成" : "追加";
    this.dialogSubmit.disabled = !isCreate;
    this.dialogCancel.disabled = false;
    this.playlistDialog.showModal();
    return true;
  }

  showCreatePlaylistDialog() {
    this.openPlaylistDialog("create");
  }

  async createPlaylist(name, description) {
    try {
      const response = await fetch("/cgi-bin/music_player.php", {
        method: "POST",
        body: new URLSearchParams({ mode: "create_playlist", name, description }),
      });
      if (!response.ok) throw new Error("HTTP error");
      const result = await response.json();
      if (!result.success) throw new Error(result.error || "プレイリストを作成できませんでした。");
      this.setStatus("プレイリストを作成しました。");
      return true;
    } catch (error) {
      console.error("Create playlist error:", error);
      this.dialogStatus.textContent = "作成できませんでした。入力内容や通信状態を確認してください。";
      return false;
    }
  }

  async showAddToPlaylistDialog() {
    if (!this.openPlaylistDialog("add")) return;
    // ダイアログを開いた時点の曲を追加するルン。
    this.dialogTrack = this.musicFiles[this.currentIndex];
    const select = document.getElementById("playlistSelect");
    select.replaceChildren();
    this.dialogStatus.textContent = "プレイリストを読み込み中…";
    const requestId = (this.playlistRequestId || 0) + 1;
    this.playlistRequestId = requestId;
    const playlists = await this.loadPlaylists();
    if (!this.playlistDialog.open || this.dialogMode !== "add" || requestId !== this.playlistRequestId) return;
    if (playlists === null) {
      this.dialogStatus.textContent = "読み込めませんでした。閉じてからやり直してください。";
      return;
    }
    this.playlists = playlists;
    if (!playlists.length) {
      this.dialogStatus.textContent = "プレイリストがありません。閉じて「プレイリスト作成」から作成してください。";
      return;
    }
    playlists.forEach((playlist) => {
      const option = document.createElement("option");
      option.value = String(playlist.id);
      option.textContent = playlist.name;
      select.appendChild(option);
    });
    this.dialogStatus.textContent = this.dialogTrack?.name || "曲が選択されていません。";
    this.dialogSubmit.disabled = !this.dialogTrack;
  }

  async loadPlaylists() {
    try {
      const response = await fetch("/cgi-bin/music_player.php?mode=get_playlists");
      if (!response.ok) throw new Error("HTTP error");
      const result = await response.json();
      if (!result.success || !Array.isArray(result.playlists)) throw new Error("Invalid playlist response");
      return result.playlists;
    } catch (error) {
      console.error("Load playlists error:", error);
      return null;
    }
  }

  async addToPlaylist(playlistId, track = this.musicFiles[this.currentIndex]) {
    if (!track) return false;
    try {
      const response = await fetch("/cgi-bin/music_player.php", {
        method: "POST",
        body: new URLSearchParams({ mode: "add_to_playlist", playlist_id: playlistId, file: track.path }),
      });
      if (!response.ok) throw new Error("HTTP error");
      const result = await response.json();
      if (!result.success) throw new Error(result.error || "追加できませんでした。");
      this.setStatus("プレイリストに楽曲を追加しました。");
      return true;
    } catch (error) {
      console.error("Add to playlist error:", error);
      this.dialogStatus.textContent = "追加できませんでした。通信状態を確認してください。";
      return false;
    }
  }

  handleKeyPress(event) {
    // 入力欄・ボタン・ダイアログの標準操作を優先するルン。
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || this.playlistDialog.open) return;
    if (event.target.closest("input, textarea, select, button, a, [contenteditable]:not([contenteditable='false'])")) return;
    // キーボードショートカット
    switch (event.code) {
      case "Space":
        event.preventDefault();
        this.togglePlayPause();
        break;
      case "ArrowLeft":
        event.preventDefault();
        this.previousTrack();
        break;
      case "ArrowRight":
        event.preventDefault();
        this.nextTrack();
        break;
      case "ArrowUp":
        event.preventDefault();
        this.setVolume(Math.min(this.volume + 0.1, 1));
        this.volumeSlider.value = this.volume * 100;
        break;
      case "ArrowDown":
        event.preventDefault();
        this.setVolume(Math.max(this.volume - 0.1, 0));
        this.volumeSlider.value = this.volume * 100;
        break;
    }
  }

  initTouchGestures() {
    // 曲送りのスワイプはアート上だけで受け付けるルン。
    let start = null;
    this.albumArt.addEventListener("touchstart", (event) => {
      start = event.touches.length === 1
        ? { x: event.touches[0].clientX, y: event.touches[0].clientY, time: Date.now() }
        : null;
    }, { passive: true });
    this.albumArt.addEventListener("touchcancel", () => { start = null; }, { passive: true });
    this.albumArt.addEventListener("touchend", (event) => {
      if (!start) return;
      const end = event.changedTouches[0];
      const dx = start.x - end.clientX;
      const dy = start.y - end.clientY;
      const elapsed = Date.now() - start.time;
      start = null;
      if (event.touches.length || Math.abs(dx) <= 80 || Math.abs(dy) >= 50 || elapsed <= 50 || elapsed >= 300) return;
      if (dx > 0) this.nextTrack();
      else this.previousTrack();
    }, { passive: true });
  }
}

// DOMContentLoaded後に初期化
document.addEventListener("DOMContentLoaded", () => {
  console.log("Initializing Music Player...");
  window.musicPlayer = new MusicPlayer();

});
