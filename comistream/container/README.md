# コンテナのビルド入力

ビルドコンテキストにはリポジトリのルートを指定します。本体はcheckoutした`comistream/`からコピーし、ライセンス文書も取り込みます。外部ディスクの`comistream-tools/`や手作業の`comistream.tar.gz`は使用しません。

Apache設定は[httpd.conf](httpd.conf)で管理します。内部ポート8080で待ち受け、[php-fpm.conf](php-fpm.conf)のUnix socketへ固定したPHP入口だけを接続します。`.htaccess`の解釈と汎用CGI実行は無効です。パッケージ付属の`conf.d/*.conf`は自動読み込みしません。

## 配置と実行権限

[configure-runtime.sh](configure-runtime.sh)はビルド時にだけ実行し、設定・コード・テーマとその親ディレクトリをroot所有にします。実行時の[start.sh](start.sh)はUID/GID `48:48`で起動し、[initialize-runtime.php](initialize-runtime.php)でdata配下の必要なディレクトリを準備します。DBから任意のコードや配置命令をrootで実行する処理はありません。

| 領域 | 実行時の扱い |
| --- | --- |
| Apache設定、コード、固定テーマ | 読み取り専用。更新はイメージの再ビルドで反映 |
| `comistream/data/` | Apacheから書き込み可能な永続volume。DB・セッション・内部キャッシュは非公開 |
| `data/theme/covers`・`preview` | 許可した画像形式だけを既存URLで配信 |
| `data/theme/hls` | プレイリスト・TSセグメントのみ静的配信。原本リンク・state・ログは非公開 |
| EPUBキャッシュ | `/theme/bibi/`から、完成済みEPUB内の資産を検証して配信。公開テーマにはリンクを作らない |
| `/home/user/public/nas` | 読み取り専用メディアvolume。PHP/CGI/SSIとシンボリックリンクの配信は拒否 |
| `/tmp`・`/dev/shm` | 一時ファイル用。読み取り専用rootでの実行には書き込み可能な領域が必要 |

初回と既存DBでの再作成は同じ起動手順です。既存DBの配置先設定だけを固定値へ揃え、ユーザーや履歴を初期化しません。起動時に権限が足りなければ終了するので、data volumeの所有者・権限はホスト側で準備してください。日次処理は起動後24時間ごとに非rootで実行します。停止中の実行は繰り越しません。

起動例と旧ポート80からの移行は[READMEのコンテナ項目](../../README.md#コンテナ)を参照してください。ロールバック時は停止後に前のイメージと旧ポート指定へ戻し、事前のdataバックアップを保持してください。DB形式はこの構造変更では変更していません。

## 実行時の回帰テスト

リポジトリのルートで、ビルドしたローカルイメージを指定します。

```sh
COMISTREAM_TEST_IMAGE=comistream-reader:local \
  node --test comistream/code/tests/container_runtime.test.js
```

テストは専用のコンテナとvolumeを作成・削除します。実データは使いません。初回設定、設定保存、読み取り専用・非rootでの動作、固定ファイルの変更拒否、データ中の`.htaccess`不解釈、生成物の公開範囲、EPUB配信、既存DBでの再作成を確認します。

Chrome/Chromiumがある環境では`COMISTREAM_BROWSER_TESTS=1`も指定すると、隔離したブラウザプロファイルでEPUBの読み込み完了を確認します。実際のリーダーと同じCDNを参照するため、ブラウザからのインターネット接続が必要です。

## 固定した外部ツール

対象は`linux/amd64`です。[tools.lock](tools.lock)には、ファイル名・版・SHA-256・取得URLをタブ区切りで記録しています。ビルド時に最新版を検索する処理はありません。

| ツール | 採用する配布物 | 取得元 |
| --- | --- | --- |
| 7-Zip | 26.04 / Linux x64 | [公式リリース](https://github.com/ip7z/7zip/releases/tag/26.04) |
| cpdf | 2.9.2 / Linux Intel 64bit、バイナリリポジトリのコミット`38b2556dc111670acb427fd9789a94ada971b2df` | [公式バイナリ](https://github.com/coherentgraphics/cpdf-binaries/tree/38b2556dc111670acb427fd9789a94ada971b2df) |
| FFmpeg / ffprobe | n9.0.2-17-g2a571b6068 / linux64-gpl-9.0、2026-09-30の月末保存版 | [BtbNの配布](https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-09-30-13-08) |
| ImageMagick | 7.1.2-34 / gcc x86_64 AppImage | [公式リリース](https://github.com/ImageMagick/ImageMagick/releases/tag/7.1.2-34) |

FFmpeg公式はソースコードを配布し、[ダウンロードページ](https://ffmpeg.org/download.html)からBtbNのビルドを案内しています。今回の固定版は9.0.2リリース後の修正を含む9.0系ブランチのビルドです。BtbNは通常の日次版を14日、月末版を2年間保存するため、固定先には月末版を選んでいます。恒久保存ではないので、配布継続時には取得先の維持または版の更新が必要です。

ImageMagickは公式AppImageを展開して使用し、独自パッチ・FUSE・特権コンテナを必要としません。OS側にはfontconfig、libX11、harfbuzz、fribidiなどが必要です。既存の`rsrc/IM7/policy.xml`を展開先の設定ディレクトリへ配置し、このポリシーを適用した状態で検証します。

## 取得と検証

[install-tools.sh](install-tools.sh)は、全ファイルのSHA-256を確認してから展開・実行します。ハッシュ不一致、取得失敗、未対応アーキテクチャでは終了します。ダウンロードしたバイナリをGitへ追加する必要はありません。

リポジトリのルートで、外部ツール専用ステージをビルドできます。

```sh
docker build --platform linux/amd64 --target tools \
  -f comistream/container/Dockerfile -t comistream-tools:check .
```

このステージは[verify-tools.sh](verify-tools.sh)で、AVIF・WebPの書き込みとPNGへの読み戻し、ZIPの作成・展開、PDFの作成・ページ数取得、H.264/AACによる短いHLSの生成と解析を実行します。バージョン表示もビルドログへ記録します。

外部ツールの検証と、Reader全体のビルド・HTTP経由の動作確認は別です。全体のビルドコマンドは次のとおりです。

```sh
docker build --platform linux/amd64 \
  -f comistream/container/Dockerfile -t comistream-reader:local .
```

インストーラーを単独で使う場合はLinux x86_64上で実行し、まだ存在しない絶対パスを出力先に指定してください。検証用に`TOOLS_DOWNLOAD_DIR`で取得ファイルのキャッシュを指定できます。キャッシュも毎回SHA-256を照合します。

## 更新と再配布

更新時は配布元・リリース内容・ライセンスを確認し、URL・版・SHA-256を同時に更新してから外部ツールの検証とReaderの回帰テストを実行します。ハッシュはGitHubのrelease asset digestがある場合は照合し、ない場合は固定コミットの取得物から計算します。チェックサムによる内容固定は、配布元の署名検証とは異なります。

イメージには`/usr/local/share/licenses/comistream-tools/`以下へ7-ZipのLicense.txt、cpdfのLICENSEとACKNOWLEDGEMENTS、FFmpegのLICENSE.txt、ImageMagickのLICENSEとNOTICEを配置します。ImageMagickの展開物内の文書も保持します。入力一覧は`/usr/local/share/comistream-tools/tools.lock`です。

| 対象 | ライセンス・ソース参照先 |
| --- | --- |
| 7-Zip | LGPL、BSD、unRAR制限を含みます。詳細は配布物のLicense.txt。[ソース配布](https://github.com/ip7z/7zip/releases/tag/26.04) |
| cpdf | AGPL。第三者の権利表示はACKNOWLEDGEMENTS。[ソース](https://github.com/coherentgraphics/cpdf-source)、[CamlPDF](https://github.com/coherentgraphics/camlpdf) |
| FFmpeg | GPL版を選択しています。[FFmpegソース](https://github.com/FFmpeg/FFmpeg)、[依存ライブラリを含むビルド手順](https://github.com/BtbN/FFmpeg-Builds) |
| ImageMagick | ImageMagick License。同梱ライブラリにはそれぞれの条件が適用されます。[ソース](https://github.com/ImageMagick/ImageMagick/tree/7.1.2-34) |

コンテナを公開する際は、ライセンス文書の同梱に加え、同梱ライブラリを含む対応ソースの提供方法を整えてください。上記のリンク一覧だけで、バイナリ再配布時のすべての要件を満たすとは限りません。

OSパッケージはAlmaLinux/EPELから取得し、この入力一覧では版を固定していません。ベースイメージのdigest固定、OSパッケージ更新、GitHub Actionsの導入は別途管理する対象です。
