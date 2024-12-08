# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2024-11-

### 追加
- 低メモリモード追加。デフォルトは有効。有効時にはAVIFソースのトリミングを無効にする。
- ログ表示で表紙画像とプレビュー画像の作成に要した時間を記録する機能追加
- open時にpage=で指定したページから開ける機能追加
- 管理者用コンフィグ画面に設定を変更しないリンクボタン新設
- 左上ヘッダ三連アイコンのログインボタンでユーザー名を空文字でログアウトできる機能追加
- open時にfileにpath hashを指定しても開ける機能追加

### 変更
- unrar path設定項目を削除
- comistream.phpの引数にsize=FULLを付ける運用を終了して、sessionやcookieから自動判定されるように変更

### 修正
- Dockerfileにunrar追加

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

