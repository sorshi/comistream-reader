# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2025-XX-YY

### 追加
- 低メモリモード追加。デフォルトは有効。有効時にはAVIFソースのトリミングを無効にする。
- ログ表示で表紙画像とプレビュー画像の作成に要した時間を記録する機能追加
- open時にpage=で指定したページから開ける機能追加
- 管理者用コンフィグ画面に設定を変更しないリンクボタン新設
- 左上ヘッダー三連アイコンのログインボタンでユーザー名を空文字でログアウトできる機能追加
- open時にfileにpath hashを指定しても開ける機能追加
- ディレクトリリスティングしてる状態からログインしても元のページに戻ってくるように機能追加
- 時計の表示/非表示を切り替えるボタンを追加
- 国際化対応。現在は英語と日本語に対応

### 変更
- unrar path設定項目を削除
- comistream.phpの引数にsize=FULLを付ける運用を終了して、sessionやcookieから自動判定されるように変更
- セッションの有効期限を31日に設定
- インスペクター表示のページ番号を「現在ページ/最終ページ」スタイルに変更

### 修正
- Dockerfileにunrar追加
- ファイルが見つからなかったときに出す再検索ページで書籍名がおかしかったのを修正
- ログアウト時にcookieを削除してなかったバグを修正
- bibiを配置してepubを参照する際に404エラーになるバグ修正 [#2](https://github.com/sorshi/comistream-reader/issues/2)
- 未使用global変数宣言を多少整理
- iOS/Androidデバイスで長押しでクイック見開き表示にしたとき、解除してもすぐに戻らない不具合修正
- タッチパネルデバイスではhoverに反応しないように抑制

### 削除
- なし



## [1.0.0] - 2024-11-09

### 追加
- 初期リリース

### 変更
- なし

### 修正
- なし

### 削除
- なし

