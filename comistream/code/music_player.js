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
 * @license     GPL3.0 License
 * @version     1.0.0
 */

class MusicPlayer {
    constructor() {
        this.audioPlayer = document.getElementById('audioPlayer');
        this.currentIndex = window.currentIndex || 0;
        this.musicFiles = window.musicFiles || [];
        this.user = window.user || 'guest';
        this.baseDir = window.baseDir || '/';
        this.themeDir = window.themeDir || '';
        
        // プレイヤー状態
        this.isPlaying = false;
        this.isShuffled = false;
        this.repeatMode = 0; // 0: none, 1: all, 2: one
        this.volume = 0.7;
        this.volumeDragging = false;
        
        // プレイリスト関連
        this.currentPlaylist = null;
        this.playlists = [];
        this.showingPlaylist = false;
        
        // DOM要素の取得
        this.initDOMElements();
        
        // カバーアート用の要素
        this.albumArt = document.querySelector('.album-art');
        
        // イベントリスナーの設定
        this.initEventListeners();
        
        // Media Session API の設定 (iOS 18 Safari バックグラウンド再生対応)
        this.initMediaSession();
        
        // 初期楽曲をロード
        this.loadCurrentTrack();
        
        console.log('Music Player initialized with', this.musicFiles.length, 'tracks');
    }

    initDOMElements() {
        // プレイヤーコントロール
        this.playPauseBtn = document.getElementById('playPauseBtn');
        this.prevBtn = document.getElementById('prevBtn');
        this.nextBtn = document.getElementById('nextBtn');
        this.shuffleBtn = document.getElementById('shuffleBtn');
        this.repeatBtn = document.getElementById('repeatBtn');
        
        // プログレスバー
        this.progressBar = document.getElementById('progressBar');
        this.progressFill = document.getElementById('progressFill');
        
        // 時間表示
        this.currentTime = document.getElementById('currentTime');
        this.totalTime = document.getElementById('totalTime');
        
        // 楽曲情報
        this.trackTitle = document.getElementById('trackTitle');
        this.trackArtist = document.getElementById('trackArtist');
        
        // ボリューム
        this.volumeSlider = document.getElementById('volumeSlider');
        
        // プレイリスト関連
        this.showPlaylistBtn = document.getElementById('showPlaylistBtn');
        this.createPlaylistBtn = document.getElementById('createPlaylistBtn');
        this.addToPlaylistBtn = document.getElementById('addToPlaylistBtn');
        this.playlistContainer = document.getElementById('playlistContainer');
    }

    initEventListeners() {
        // プレイヤーコントロール
        this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        this.prevBtn.addEventListener('click', () => this.previousTrack());
        this.nextBtn.addEventListener('click', () => this.nextTrack());
        this.shuffleBtn.addEventListener('click', () => this.toggleShuffle());
        this.repeatBtn.addEventListener('click', () => this.toggleRepeat());
        
        // プログレスバークリック
        this.progressBar.addEventListener('click', (e) => this.seekTo(e));
        
        // ボリューム調整（誤操作防止のため複数イベント対応）
        this.volumeSlider.addEventListener('input', (e) => {
            e.stopPropagation(); // イベントの伝播を停止
            this.setVolume(e.target.value / 100);
        });
        this.volumeSlider.addEventListener('change', (e) => {
            e.stopPropagation(); // イベントの伝播を停止
            this.setVolume(e.target.value / 100);
        });
        
        // ボリューム操作中は他のイベントを無効化
        this.volumeSlider.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            this.volumeDragging = true;
        });
        this.volumeSlider.addEventListener('mouseup', (e) => {
            e.stopPropagation();
            this.volumeDragging = false;
        });
        this.volumeSlider.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            this.volumeDragging = true;
        });
        this.volumeSlider.addEventListener('touchend', (e) => {
            e.stopPropagation();
            this.volumeDragging = false;
        });
        
        // オーディオイベント
        this.audioPlayer.addEventListener('loadedmetadata', () => this.onMetadataLoaded());
        this.audioPlayer.addEventListener('timeupdate', () => this.updateProgress());
        this.audioPlayer.addEventListener('ended', () => this.onTrackEnded());
        this.audioPlayer.addEventListener('play', () => this.onPlay());
        this.audioPlayer.addEventListener('pause', () => this.onPause());
        this.audioPlayer.addEventListener('error', (e) => this.onError(e));
        
        // プレイリスト関連
        this.showPlaylistBtn.addEventListener('click', () => this.togglePlaylistView());
        this.createPlaylistBtn.addEventListener('click', () => this.showCreatePlaylistDialog());
        this.addToPlaylistBtn.addEventListener('click', () => this.showAddToPlaylistDialog());
        
        // キーボードショートカット
        document.addEventListener('keydown', (e) => this.handleKeyPress(e));
        
        // モバイル対応（タッチ操作）
        this.initTouchGestures();
        
        // ページの可視性変更 (バックグラウンド対応)
        document.addEventListener('visibilitychange', () => this.onVisibilityChange());
    }

    initMediaSession() {
        if ('mediaSession' in navigator) {
            // iOS 18 Safari 対応の Media Session API 設定
            navigator.mediaSession.setActionHandler('play', () => this.play());
            navigator.mediaSession.setActionHandler('pause', () => this.pause());
            navigator.mediaSession.setActionHandler('previoustrack', () => this.previousTrack());
            navigator.mediaSession.setActionHandler('nexttrack', () => this.nextTrack());
            navigator.mediaSession.setActionHandler('seekbackward', (details) => {
                const skipTime = details.seekOffset || 10;
                this.audioPlayer.currentTime = Math.max(this.audioPlayer.currentTime - skipTime, 0);
            });
            navigator.mediaSession.setActionHandler('seekforward', (details) => {
                const skipTime = details.seekOffset || 10;
                this.audioPlayer.currentTime = Math.min(this.audioPlayer.currentTime + skipTime, this.audioPlayer.duration);
            });
            
            // iOS Safari での追加対応
            try {
                navigator.mediaSession.setActionHandler('seekto', (details) => {
                    if (details.seekTime) {
                        this.audioPlayer.currentTime = details.seekTime;
                    }
                });
                navigator.mediaSession.setActionHandler('stop', () => {
                    this.pause();
                    this.audioPlayer.currentTime = 0;
                });
            } catch (error) {
                console.log('Some Media Session actions not supported:', error);
            }
            
            console.log('Media Session API initialized for iOS 18 Safari');
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
        this.audioPlayer.addEventListener('canplay', () => {
            // オーディオコンテキストの状態を確認・再開
            if (window.AudioContext || window.webkitAudioContext) {
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                if (audioContext.state === 'suspended') {
                    audioContext.resume().catch(console.error);
                }
            }
        });

        // iOS でのバックグラウンド継続のための工夫
        document.addEventListener('visibilitychange', () => {
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
        this.audioPlayer.addEventListener('loadstart', () => {
            // プリロードを設定して途切れを防ぐ
            this.audioPlayer.preload = 'auto';
        });
    }

    setupHardwareVolumeSync() {
        // ハードウェアボリューム変化の検出を試行
        // 注意: セキュリティ上の制限により多くのブラウザで制限されています
        try {
            // Web Audio API を使用してボリューム変化を検出
            if (window.AudioContext || window.webkitAudioContext) {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                
                // ユーザージェスチャー後に初期化
                const initAudioContext = () => {
                    try {
                        const audioContext = new AudioContext();
                        const source = audioContext.createMediaElementSource(this.audioPlayer);
                        const gainNode = audioContext.createGain();
                        
                        source.connect(gainNode);
                        gainNode.connect(audioContext.destination);
                        
                        // ボリューム変化の監視（間接的）
                        this.audioPlayer.addEventListener('volumechange', () => {
                            if (!this.volumeDragging) {
                                // ユーザーがスライダーを操作していない時のみ更新
                                const newVolume = this.audioPlayer.volume;
                                this.volumeSlider.value = newVolume * 100;
                                this.volume = newVolume;
                                console.log('Hardware volume detected:', newVolume);
                            }
                        });
                        
                        console.log('Hardware volume sync initialized');
                    } catch (error) {
                        console.log('Hardware volume sync not available:', error);
                    }
                };
                
                // ユーザージェスチャー後に初期化
                document.addEventListener('click', initAudioContext, { once: true });
            }
        } catch (error) {
            console.log('Hardware volume sync not supported:', error);
        }
    }

    loadCurrentTrack() {
        if (this.musicFiles.length === 0) return;
        
        const currentTrack = this.musicFiles[this.currentIndex];
        if (!currentTrack) return;
        
        // オーディオソースを設定
        this.audioPlayer.src = this.baseDir + currentTrack.path;
        
        // トラック情報を更新
        this.updateTrackInfo(currentTrack);
        
        // カバーアート表示を更新
        this.updateCoverArt(currentTrack);
        
        // プレイリスト表示を更新
        this.updatePlaylistDisplay();
        
        console.log('Loaded track:', currentTrack.name);
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
            this.trackArtist.textContent = 'Unknown Artist';
        }
        
        // Media Session metadata を更新
        if ('mediaSession' in navigator) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: this.trackTitle.textContent,
                artist: this.trackArtist.textContent,
                album: 'Comistream Player',
                artwork: [
                    { src: '/theme/icons/audio.png', sizes: '96x96', type: 'image/png' },
                ]
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
            playPromise.then(() => {
                console.log('Playback started successfully');
            }).catch(error => {
                console.error('Playback failed:', error);
                // iOS Safari でのユーザージェスチャー要求エラーの処理
                if (error.name === 'NotAllowedError') {
                    alert('再生にはユーザー操作が必要です。プレイボタンをタップしてください。');
                }
            });
        }
    }

    pause() {
        this.audioPlayer.pause();
    }

    onPlay() {
        this.isPlaying = true;
        this.playPauseBtn.className = 'control-btn play-pause-btn icon-pause';
        this.playPauseBtn.title = '一時停止';
        
        // バックグラウンド再生のためのWakeLock API (対応ブラウザのみ)
        this.requestWakeLock();
    }

    onPause() {
        this.isPlaying = false;
        this.playPauseBtn.className = 'control-btn play-pause-btn icon-play';
        this.playPauseBtn.title = '再生';
        
        // WakeLockを解除
        this.releaseWakeLock();
    }

    async requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                this.wakeLock = await navigator.wakeLock.request('screen');
                console.log('Screen wake lock acquired');
            }
        } catch (err) {
            console.log('Wake lock request failed:', err);
        }
    }

    releaseWakeLock() {
        if (this.wakeLock) {
            this.wakeLock.release();
            this.wakeLock = null;
            console.log('Screen wake lock released');
        }
    }

    onVisibilityChange() {
        // ページがバックグラウンドに入ったとき
        if (document.hidden) {
            // iOS Safari でのバックグラウンド再生を継続するために必要な処理
            if (this.isPlaying) {
                // Media Session の位置情報を更新
                if ('mediaSession' in navigator) {
                    navigator.mediaSession.setPositionState({
                        duration: this.audioPlayer.duration,
                        playbackRate: this.audioPlayer.playbackRate,
                        position: this.audioPlayer.currentTime
                    });
                }
            }
        }
    }

    previousTrack() {
        if (this.currentIndex > 0) {
            this.currentIndex--;
        } else if (this.repeatMode === 1) { // repeat all
            this.currentIndex = this.musicFiles.length - 1;
        } else {
            return; // 最初の曲でリピートなしの場合は何もしない
        }
        
        this.loadCurrentTrack();
        if (this.isPlaying) {
            this.play();
        }
    }

    nextTrack() {
        if (this.isShuffled) {
            // シャッフルモード
            this.currentIndex = Math.floor(Math.random() * this.musicFiles.length);
        } else {
            if (this.currentIndex < this.musicFiles.length - 1) {
                this.currentIndex++;
            } else if (this.repeatMode === 1) { // repeat all
                this.currentIndex = 0;
            } else {
                if (this.repeatMode !== 2) { // repeat oneでなければ停止
                    this.pause();
                    return;
                }
            }
        }
        
        this.loadCurrentTrack();
        if (this.isPlaying) {
            this.play();
        }
    }

    onTrackEnded() {
        if (this.repeatMode === 2) { // repeat one
            this.audioPlayer.currentTime = 0;
            this.play();
        } else {
            this.nextTrack();
        }
    }

    toggleShuffle() {
        this.isShuffled = !this.isShuffled;
        if (this.isShuffled) {
            this.shuffleBtn.classList.add('shuffle-active');
            this.shuffleBtn.title = 'シャッフル: ON';
        } else {
            this.shuffleBtn.classList.remove('shuffle-active');
            this.shuffleBtn.title = 'シャッフル: OFF';
        }
        console.log('Shuffle mode:', this.isShuffled);
    }

    toggleRepeat() {
        this.repeatMode = (this.repeatMode + 1) % 3;
        
        // リピートモードによってクラスとタイトルを更新
        this.repeatBtn.classList.remove('repeat-active', 'icon-repeat', 'icon-repeat-one');
        
        switch (this.repeatMode) {
            case 0: // none
                this.repeatBtn.classList.add('icon-repeat');
                this.repeatBtn.title = 'リピート: OFF';
                break;
            case 1: // all
                this.repeatBtn.classList.add('icon-repeat', 'repeat-active');
                this.repeatBtn.title = 'リピート: 全曲';
                break;
            case 2: // one
                this.repeatBtn.classList.add('icon-repeat-one', 'repeat-active');
                this.repeatBtn.title = 'リピート: 1曲';
                break;
        }
        
        console.log('Repeat mode:', this.repeatMode);
    }

    async updateCoverArt(track) {
        try {
            // デフォルトのカバーアートに戻す
            this.albumArt.style.backgroundImage = '';
            this.albumArt.textContent = '🎵';
            
            // ID3タグからカバーアートを読み取る
            const audioUrl = this.baseDir + track.path;
            const response = await fetch(audioUrl);
            
            if (!response.ok) {
                console.log('Failed to fetch audio file for cover art extraction');
                return;
            }
            
            const arrayBuffer = await response.arrayBuffer();
            const coverArt = await this.extractCoverArt(arrayBuffer, track.name);
            
            if (coverArt) {
                const blob = new Blob([coverArt.data], { type: coverArt.format });
                const url = URL.createObjectURL(blob);
                
                this.albumArt.style.backgroundImage = `url(${url})`;
                this.albumArt.style.backgroundSize = 'cover';
                this.albumArt.style.backgroundPosition = 'center';
                this.albumArt.textContent = '';
                
                console.log('Cover art loaded for:', track.name);
                
                // メモリリーク防止のため古いURLを解放
                setTimeout(() => URL.revokeObjectURL(url), 5000);
            }
        } catch (error) {
            console.log('Cover art extraction failed:', error);
            // エラー時はデフォルトのアイコンのまま
        }
    }

    async extractCoverArt(arrayBuffer, filename) {
        try {
            const dataView = new DataView(arrayBuffer);
            const fileExtension = filename.toLowerCase().split('.').pop();
            
            // MP3ファイルの場合
            if (fileExtension === 'mp3') {
                return this.extractMP3CoverArt(dataView);
            }
            
            // M4A/MP4ファイルの場合
            if (['m4a', 'mp4'].includes(fileExtension)) {
                return this.extractM4ACoverArt(dataView);
            }
            
            // FLACファイルの場合
            if (fileExtension === 'flac') {
                return this.extractFLACCoverArt(dataView);
            }
            
            console.log('Unsupported audio format for cover art:', fileExtension);
            return null;
        } catch (error) {
            console.log('Cover art extraction error:', error);
            return null;
        }
    }

    extractMP3CoverArt(dataView) {
        // ID3v2ヘッダーをチェック
        if (dataView.getUint8(0) !== 0x49 || dataView.getUint8(1) !== 0x44 || dataView.getUint8(2) !== 0x33) {
            return null; // ID3v2ヘッダーが見つからない
        }
        
        const version = dataView.getUint8(3);
        const flags = dataView.getUint8(5);
        
        // タグサイズを取得（synchsafe integer）
        let tagSize = 0;
        for (let i = 6; i < 10; i++) {
            tagSize = (tagSize << 7) + (dataView.getUint8(i) & 0x7f);
        }
        
        let offset = 10;
        
        // 拡張ヘッダーがある場合はスキップ
        if (flags & 0x40) {
            const extHeaderSize = dataView.getUint32(offset);
            offset += extHeaderSize;
        }
        
        // フレームを探索
        while (offset < tagSize + 10) {
            if (offset + 10 >= dataView.byteLength) break;
            
            // フレームヘッダーを読み取り
            const frameId = String.fromCharCode(
                dataView.getUint8(offset),
                dataView.getUint8(offset + 1),
                dataView.getUint8(offset + 2),
                dataView.getUint8(offset + 3)
            );
            
            if (frameId === 'APIC' || frameId === 'PIC\0') {
                // APICフレーム（画像）を発見
                let frameSize;
                if (version >= 4) {
                    // ID3v2.4: synchsafe integer
                    frameSize = 0;
                    for (let i = 0; i < 4; i++) {
                        frameSize = (frameSize << 7) + (dataView.getUint8(offset + 4 + i) & 0x7f);
                    }
                } else {
                    // ID3v2.3以前: 普通の32bit integer
                    frameSize = dataView.getUint32(offset + 4);
                }
                
                const frameFlags = dataView.getUint16(offset + 8);
                let dataOffset = offset + 10;
                
                // テキストエンコーディングをスキップ
                dataOffset++;
                
                // MIMEタイプを読み取り
                let mimeType = '';
                while (dataOffset < offset + 10 + frameSize && dataView.getUint8(dataOffset) !== 0) {
                    mimeType += String.fromCharCode(dataView.getUint8(dataOffset));
                    dataOffset++;
                }
                dataOffset++; // null terminatorをスキップ
                
                // ピクチャータイプをスキップ
                dataOffset++;
                
                // 説明をスキップ
                while (dataOffset < offset + 10 + frameSize && dataView.getUint8(dataOffset) !== 0) {
                    dataOffset++;
                }
                dataOffset++; // null terminatorをスキップ
                
                // 画像データを抽出
                const imageDataSize = frameSize - (dataOffset - (offset + 10));
                const imageData = new Uint8Array(arrayBuffer, dataOffset, imageDataSize);
                
                return {
                    data: imageData,
                    format: mimeType || 'image/jpeg'
                };
            }
            
            // 次のフレームへ
            let frameSize;
            if (version >= 4) {
                frameSize = 0;
                for (let i = 0; i < 4; i++) {
                    frameSize = (frameSize << 7) + (dataView.getUint8(offset + 4 + i) & 0x7f);
                }
            } else {
                frameSize = dataView.getUint32(offset + 4);
            }
            
            offset += 10 + frameSize;
        }
        
        return null;
    }

    extractM4ACoverArt(dataView) {
        // MP4/M4Aファイルのcovrアトムを探す
        let offset = 0;
        
        while (offset < dataView.byteLength - 8) {
            const atomSize = dataView.getUint32(offset);
            const atomType = String.fromCharCode(
                dataView.getUint8(offset + 4),
                dataView.getUint8(offset + 5),
                dataView.getUint8(offset + 6),
                dataView.getUint8(offset + 7)
            );
            
            if (atomType === 'covr') {
                // カバーアートアトムを発見
                const imageData = new Uint8Array(arrayBuffer, offset + 16, atomSize - 16);
                
                // ファイル形式を判定
                let format = 'image/jpeg';
                if (imageData[0] === 0x89 && imageData[1] === 0x50) {
                    format = 'image/png';
                }
                
                return {
                    data: imageData,
                    format: format
                };
            }
            
            offset += atomSize;
            if (atomSize === 0) break; // 無限ループ防止
        }
        
        return null;
    }

    extractFLACCoverArt(dataView) {
        // FLACのメタデータブロックをチェック
        if (String.fromCharCode(dataView.getUint8(0), dataView.getUint8(1), dataView.getUint8(2), dataView.getUint8(3)) !== 'fLaC') {
            return null;
        }
        
        let offset = 4;
        
        while (offset < dataView.byteLength) {
            const blockHeader = dataView.getUint32(offset);
            const isLast = (blockHeader & 0x80000000) !== 0;
            const blockType = (blockHeader >> 24) & 0x7f;
            const blockSize = blockHeader & 0xffffff;
            
            if (blockType === 6) { // PICTURE block
                offset += 4;
                
                // ピクチャータイプをスキップ（4バイト）
                offset += 4;
                
                // MIMEタイプの長さを取得
                const mimeLength = dataView.getUint32(offset);
                offset += 4;
                
                // MIMEタイプを読み取り
                let mimeType = '';
                for (let i = 0; i < mimeLength; i++) {
                    mimeType += String.fromCharCode(dataView.getUint8(offset + i));
                }
                offset += mimeLength;
                
                // 説明の長さを取得してスキップ
                const descLength = dataView.getUint32(offset);
                offset += 4 + descLength;
                
                // 画像の幅・高さ・色深度・色数をスキップ（16バイト）
                offset += 16;
                
                // 画像データサイズを取得
                const imageSize = dataView.getUint32(offset);
                offset += 4;
                
                // 画像データを抽出
                const imageData = new Uint8Array(dataView.buffer, offset, imageSize);
                
                return {
                    data: imageData,
                    format: mimeType
                };
            }
            
            offset += 4 + blockSize;
            if (isLast) break;
        }
        
        return null;
    }

    seekTo(event) {
        if (!this.audioPlayer.duration) return;
        
        const rect = this.progressBar.getBoundingClientRect();
        const percent = (event.clientX - rect.left) / rect.width;
        const newTime = Math.max(0, Math.min(percent * this.audioPlayer.duration, this.audioPlayer.duration));
        
        this.audioPlayer.currentTime = newTime;
        
        // Media Session の位置更新
        if ('mediaSession' in navigator && this.isPlaying) {
            navigator.mediaSession.setPositionState({
                duration: this.audioPlayer.duration,
                playbackRate: this.audioPlayer.playbackRate,
                position: newTime
            });
        }
    }

    setVolume(volume) {
        this.volume = volume;
        this.audioPlayer.volume = volume;
    }

    onMetadataLoaded() {
        this.totalTime.textContent = this.formatTime(this.audioPlayer.duration);
        console.log('Track duration:', this.audioPlayer.duration);
    }

    updateProgress() {
        if (!this.audioPlayer.duration) return;
        
        const progress = (this.audioPlayer.currentTime / this.audioPlayer.duration) * 100;
        this.progressFill.style.width = progress + '%';
        this.currentTime.textContent = this.formatTime(this.audioPlayer.currentTime);
        
        // Media Session の位置情報を更新 (バックグラウンド再生対応)
        if ('mediaSession' in navigator && this.isPlaying) {
            navigator.mediaSession.setPositionState({
                duration: this.audioPlayer.duration,
                playbackRate: this.audioPlayer.playbackRate,
                position: this.audioPlayer.currentTime
            });
        }
    }

    formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        
        const minutes = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }

    onError(event) {
        console.error('Audio error:', event);
        alert('音楽ファイルの再生でエラーが発生しました。');
    }

    updatePlaylistDisplay() {
        if (this.showingPlaylist) {
            this.displayCurrentPlaylist();
        }
    }

    displayCurrentPlaylist() {
        this.playlistContainer.innerHTML = '';
        
        this.musicFiles.forEach((track, index) => {
            const item = document.createElement('div');
            item.className = 'playlist-item' + (index === this.currentIndex ? ' active' : '');
            
            item.innerHTML = `
                <div class="track-number">${index + 1}</div>
                <div class="track-name">${track.name}</div>
            `;
            
            item.addEventListener('click', () => {
                this.currentIndex = index;
                this.loadCurrentTrack();
                if (this.isPlaying) {
                    this.play();
                }
            });
            
            this.playlistContainer.appendChild(item);
        });
    }

    togglePlaylistView() {
        this.showingPlaylist = !this.showingPlaylist;
        
        if (this.showingPlaylist) {
            this.displayCurrentPlaylist();
            this.showPlaylistBtn.textContent = '隠す';
        } else {
            this.playlistContainer.innerHTML = '';
            this.showPlaylistBtn.textContent = 'プレイリスト';
        }
    }

    showCreatePlaylistDialog() {
        const name = prompt('プレイリスト名を入力してください:');
        if (!name) return;
        
        const description = prompt('説明 (オプション):') || '';
        
        this.createPlaylist(name, description);
    }

    async createPlaylist(name, description) {
        try {
            const response = await fetch('/cgi-bin/music_player.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: `mode=create_playlist&name=${encodeURIComponent(name)}&description=${encodeURIComponent(description)}`
            });
            
            const result = await response.json();
            
            if (result.success) {
                alert('プレイリストを作成しました');
                this.loadPlaylists();
            } else {
                alert('エラー: ' + result.error);
            }
        } catch (error) {
            console.error('Create playlist error:', error);
            alert('プレイリストの作成でエラーが発生しました');
        }
    }

    showAddToPlaylistDialog() {
        // まずプレイリスト一覧を取得
        this.loadPlaylists().then(() => {
            if (this.playlists.length === 0) {
                alert('プレイリストがありません。まずプレイリストを作成してください。');
                return;
            }
            
            // プレイリスト選択ダイアログを表示
            const playlistNames = this.playlists.map(p => `${p.id}: ${p.name}`).join('\n');
            const choice = prompt(`プレイリストを選択してください:\n${playlistNames}\n\nプレイリストIDを入力:`);
            
            if (choice) {
                const playlistId = parseInt(choice);
                if (playlistId && this.playlists.find(p => p.id === playlistId)) {
                    this.addToPlaylist(playlistId);
                } else {
                    alert('無効なプレイリストIDです');
                }
            }
        });
    }

    async loadPlaylists() {
        try {
            const response = await fetch(`/cgi-bin/music_player.php?mode=get_playlists`);
            const result = await response.json();
            
            if (result.success) {
                this.playlists = result.playlists;
            }
        } catch (error) {
            console.error('Load playlists error:', error);
        }
    }

    async addToPlaylist(playlistId) {
        const currentTrack = this.musicFiles[this.currentIndex];
        if (!currentTrack) return;
        
        try {
            const response = await fetch('/cgi-bin/music_player.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: `mode=add_to_playlist&playlist_id=${playlistId}&file=${encodeURIComponent(currentTrack.path)}`
            });
            
            const result = await response.json();
            
            if (result.success) {
                alert('プレイリストに楽曲を追加しました');
            } else {
                alert('エラー: ' + result.error);
            }
        } catch (error) {
            console.error('Add to playlist error:', error);
            alert('プレイリストへの追加でエラーが発生しました');
        }
    }

    handleKeyPress(event) {
        // キーボードショートカット
        switch (event.code) {
            case 'Space':
                event.preventDefault();
                this.togglePlayPause();
                break;
            case 'ArrowLeft':
                event.preventDefault();
                this.previousTrack();
                break;
            case 'ArrowRight':
                event.preventDefault();
                this.nextTrack();
                break;
            case 'ArrowUp':
                event.preventDefault();
                this.setVolume(Math.min(this.volume + 0.1, 1));
                this.volumeSlider.value = this.volume * 100;
                break;
            case 'ArrowDown':
                event.preventDefault();
                this.setVolume(Math.max(this.volume - 0.1, 0));
                this.volumeSlider.value = this.volume * 100;
                break;
        }
    }

    initTouchGestures() {
        let startX = 0;
        let startY = 0;
        let startTime = 0;
        
        document.addEventListener('touchstart', (e) => {
            // ボリュームスライダー操作中はスワイプを無効化
            if (this.volumeDragging || e.target === this.volumeSlider) {
                return;
            }
            
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            startTime = Date.now();
        }, { passive: true });
        
        document.addEventListener('touchend', (e) => {
            // ボリュームスライダー操作中はスワイプを無効化
            if (this.volumeDragging || e.target === this.volumeSlider) {
                return;
            }
            
            const endX = e.changedTouches[0].clientX;
            const endY = e.changedTouches[0].clientY;
            const endTime = Date.now();
            const diffX = startX - endX;
            const diffY = startY - endY;
            const duration = endTime - startTime;
            
            // スワイプジェスチャーの条件を厳しくして誤操作を防止
            const isSwipeGesture = (
                Math.abs(diffX) > Math.abs(diffY) && // 水平方向優位
                Math.abs(diffX) > 80 && // 最小スワイプ距離を増加
                Math.abs(diffY) < 50 && // 垂直方向の許容範囲を制限
                duration < 300 && // スワイプ時間制限
                duration > 50 // 最小時間で偶発的タップを除外
            );
            
            if (isSwipeGesture) {
                if (diffX > 0) {
                    // 左スワイプ = 次の曲
                    this.nextTrack();
                } else {
                    // 右スワイプ = 前の曲
                    this.previousTrack();
                }
            }
        }, { passive: true });
    }
}

// DOMContentLoaded後に初期化
document.addEventListener('DOMContentLoaded', () => {
    console.log('Initializing Music Player...');
    window.musicPlayer = new MusicPlayer();
    
    // iOS Safari での音声再生許可を得るための初期化
    document.addEventListener('click', function initAudioContext() {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }
        document.removeEventListener('click', initAudioContext);
    }, { once: true });
}); 
