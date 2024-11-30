# Comistream Reader

Comistream Readerは、コンパクトで使いやすいサーバー設置型オープンソースコミックリーダーです。ZIP、RAR、7z、PDFなどさまざまな形式の電子書籍をスムーズに閲覧できます。各種動画ファイルもHLS変換して再生できます。
NASに追加すると、ブラウザさえあればどこからでもマンガが見れて大変便利です。
開発中の電子書籍管理システムComistreamから先行してリーダー機能だけを取り出したものです。

## 主な機能

- クイック見開き:スペースキー押しやスマホやiPadの向き回転や長押しで縦長単ページから見開き表示する機能。超便利。
- マルチフォーマット対応（ZIP、RAR、7z、PDF、等）
- レスポンシブデザインによるモバイル対応
- 右綴じ/左綴じ切替
- 圧縮/オリジナル品質の簡単切替（パケットセービングモード）
- 一覧表示時にマウスホバーで本の中身のプレビュー表示
- デバイス間ページ位置同期
- 横長画像自動分割表示:縦長画像、横長画像が混在してるアーカイブでもいい感じに表示
- ネットワーク帯域自動測定により動的ページ先読み（遅いネットワークの場合先読み枚数を自動的に増やす）
- 各種動画フォーマットのHLS変換再生
- 表紙画像とプレビュー画像の自動作成
- プレビュー画像は先頭12ページ分をリスト表示時にマウスホバーで表示できる機能。マンガに多い縦書き右綴じに最適化されている。便利
- 読書履歴、読みかけ位置、お気に入り、既読情報の記録と表示。再オープン時は前回閉じたページから再開。
- アーカイブを展開することなく表示
- zipの中にzipがあるような入れ子構造のアーカイブも自動対応
- インスペクタ表示
- Accept-Encoding zstd対応により転送パケットを節約（https必須）
- シンプルなPWA対応（https必須）
- 余白トリミングモード
- 高速で効率のいい動作
- （オプション:文末での次巻提示機能）

## スクリーンショット
- [Comistream Readerメインサイト](https://comistream.dcc-jpl.com/)でご覧頂けます。

## デモサイト
- [https://comistream-demo.dcc-jpl.com/](https://comistream-demo.dcc-jpl.com/)

## コンテナ
**【重要】** 注意深く作成したつもりですが、意図しないバグによるファイルの削除などが発生しないようにメディアコンテンツはリードオンリーでマウントしておくと安全だと思います。
- コンテナ側の/home/user/comistream/data/にDBなど永続的データ用ディレクトリを、/home/user/public/nas/にメディアデータをマウントしてください。
- コンテナを起動したら手動インストールの「ブラウザでセットアップ」項目からセットアップしてください。
- 実行例
- docker run -d -p 8080:80  \
-v /home/path/to/your/data:/home/user/comistream/data  \
-v /home/path/to/your/nas:/home/user/public/nas  \
--restart unless-stopped  \
--name comistream ghcr.io/sorshi/comistream-reader/comistream-reader:latest

## 手動インストール  
**【重要】** 既存環境のweb rootにthemeというディレクトリと.htaccessがある場合は競合するので別環境で動かしてください。
**【重要】** 既存環境に組み入れる際には充分な検証を事前に行うことをおすすめします。可能なら別VMやコンテナがよろしいとおもいます。
**【重要】** 注意深く作成したつもりですが、意図しないバグによるファイルの削除などが発生しないようにメディアコンテンツはリードオンリーでマウントしておくと安全だと思います。

1. リポジトリをクローンまたはダウンロード：
   ```
   git clone https://github.com/sorshi/comistream-reader.git
   ```
2. 必要なツールをインストール：  
AlmaLinux9の例だと以下のコマンドを実行します。
   ```
   sudo dnf install -y tar httpd php sqlite-devel.x86_64 zstd.x86_64 libzstd-devel.x86_64 mod_ssl ghostscript.x86_64 poppler-utils unzip cifs-utils fuse fuse-libs epel-release 
   sudo dnf install -y b3sum php-zstd.x86_64 ImageMagick libavif-devel
   ```
3. 追加で必要なツールをインストール：  
以下コマンドを展開してpathの切られてる/usr/local/bin/あたりにコピーします。  
**【重要】** ImageMagick AppImage版は7.1.1-23まではAVIFの読み書きができましたが7.1.1-24以降で対応が外されています。また7.1.1-35までは[CVE-2024-41817](https://nvd.nist.gov/vuln/detail/CVE-2024-41817)の脆弱性(深刻度7.8)があります。コンテナ版にはセキュリティパッチをバックポートした7.1.1-23を同梱しています。

- [cpdf](https://github.com/coherentgraphics/cpdf-binaries)
- [ImageMagick](https://imagemagick.org/script/download.php)
- [7-zip](https://7-zip.opensource.jp/download.html)
- [ffmpeg static build](https://johnvansickle.com/ffmpeg/)

4. 配置：  
/home/user/を利用して、webrootが/home/user/public/である場合の配置例と操作です。  
cloneまたは展開した中のcomistreamディレクトリを/home/user/以下に/home/user/comistream/として配置します。  
操作内容はcgi-bin内にシンボリックリンクを張ることと、適切なパーミッションを設定することです。
   ```
   sudo ln -s /home/user/comistream/code/comistream.php /var/www/cgi-bin/
   sudo ln -s /home/user/comistream/code/livestream.php /var/www/cgi-bin/
   mkdir -p /home/user/comistream/data/
   sudo chgrp -R apache /home/user/comistream/data/
   sudo chmod -R 775 /home/user/comistream/data/
   ```
5. コンテンツのマウント:
- /home/user/public/や/home/user/public/nas/などにコンテンツをマウントや配置します。

6. Apacheの設定：  
セットアップの際にはapache権限でメニュー7で指定されたweb root(/home/user/public/)直下にthemeディレクトリの作成と.htaccessの作成を行います。書き込み出来る適切なパーミッションを設定しておいてください。  
- &lt;Directory "/var/www/cgi-bin"&gt;に Options FollowSymLinks 追加します。そのままだと無制限アクセスになるので必要に応じてアクセス制限を行ってください。
- /etc/httpd/conf.d/welcome.confを削除します。
- &lt;Directory /&gt;をAllowOverride AllにしてAllow from allにします。

7. ブラウザでセットアップ：
- インストールしたサーバーの/cgi-bin/comistream.phpにアクセスしてください。初期セットアップ画面になります。
- 最初に管理者アカウントを設定します。
- 次に初期設定項目を設定します。デフォルトでそれなりに使えるようになっているはずです。
- 途中でエラーになり失敗した場合は/home/user/comistream/data/*を削除するとやり直せます。/home/user/public/themeと/home/user/public/.htaccessが存在していたらそれも削除しておいてください。

8. 表紙作成とプレビュー作成の初期実行：
- apache権限でcomistream/code/make_image_run.shを実行します。コンテンツ量によりますが結構時間がかかります。進捗は必要に応じてjournalctl -fなどでログを確認してください。明示的に実行しなくても次の項でcron設定すれば自動的に起動します。

9. 日次バッチ
- （コンテナ版では設定済）cronなどでcomistream/cron/cron_comistream_daily.shを実行するように設定します。rootで起動するとapache権限でmake_image_run.shとpushout_old_cover_dir.shが実行されます。前者は8で実行した画像作成です。後者はリネームしたり移動したりで使われてない表紙ディレクトリとプレビューファイルディレクトリの削除をします。

10. 外部からのアクセス
- Cloudflare TunnelやTailscaleやリバースプロキシやVPNなど既存の方法で利用してください。

## 使い方  
画像で大方わかると思いますので、その他の細かい補足を以下に記載します。
- ヘッダーのログインと管理者ログインは直接の関係はありません。ヘッダーのログインは読書履歴やしおりの位置の記録に用いられるユーザー自己申告です。
- デバイス間同期を利用するためにはヘッダアイコンでログインしてください。ゲストではデバイス間同期は利用できません。
- 管理者ログイン、管理者ログアウト、環境設定のメニューは表には表示されていません。それぞれ、`/cgi-bin/comistream.php?mode=login`、`/cgi-bin/comistream.php?mode=logout`、`/cgi-bin/comistream.php?mode=config`を直接開いてください。
- コンテンツはリードオンリーでマウントしても動作に支障はありません。むしろリードオンリーでマウントしておく方が安全性を考慮しておすすめです。
- 永続的な書込が必要なデータは`~/comistream/data/`以下にまとめられています。
- 一時的なデータ領域に`/dev/shm/`を利用します。
- Altキー/Optionキーを押しながらファイルを押す、またはファイル長押しでサブメニューが表示されます。ここで「更新」を押すとそのファイルの表紙とプレビュー画像が削除されます。再作成したいときに用いてください。
- お気に入りをONにすると既読フラグもONになります。Comistream Readerではまだ未読だけど、ライブラリの整理で一覧からお気に入りにまとめて変更したたい、といった場合に便利です。
- 動画再生でmp4はそのまま再生します。mp4もHLS変換したい場合にはヘッダでモードをパケットセービングにしてください。
- 既読/未読/お気に入り/表紙/プレビュー画像等はコンテンツファイル名とひも付いています。内容変更やPATH移動してもひも付きは維持されますが、ファイル名が変わると別物として扱われるようになります。


## 設定  
管理者アカウントで`/cgi-bin/comistream.php?mode=config`を開くことで設定画面になります。管理者ログインしている必要があります。

## 技術寄りのQ&A
- Q1.なぜCSSとJavaScriptを連結して送出するのですか？
- A1.バラバラの状態だとiPadのPWAがJSやCSSを更新しても永遠にキャッシュを読み続けて更新が反映されないからです。まとまってZstd圧縮して送出されるので速度も効率もいいとは思います。
- Q2.JSのリングバッファに読み込んだ画像を使ってないのはなぜですか？
- A2.これ捨ててもブラウザのメモリキャッシュに残ってるのかどうかわからないのでブラウザに詳しい人教えてください！

## 開発

プルリクエストは大歓迎です。大きな変更を加える場合は、まずissueを開いて変更内容を議論してください。

## お問い合わせ

質問や提案がある場合は、issueを開いてください。

## 歴史とかいろいろ

サーバー設置型のコミックリーダーや書籍管理システムは、すでに[Calibre](https://calibre-ebook.com/ja)や[Komga](https://komga.org/)のような多機能なものが数多く存在しています。Comistream Readerの特徴は、既存の環境に簡単に電子書籍リーダー機能を追加できる点にあります。

ここで少し個人的な思い出話をさせてください。私の自宅のNASは、最初はSambaが動作する単純なファイルサーバーでした。その後、検索機能を追加するためにWebUIを導入しました。PDF以外のファイルもブラウザで閲覧したいと考えていた時期です。

その後、[Nihondo](https://x.com/Nihondo)さんが、irc #dameTunesの仲間内向けに、現在のComistream Readerの元となるPerlで書かれたコミックリーダー『Comistream』をリリースしてくれました。これは非常に使いやすく便利なもので、私はそれをforkして機能を追加したり、PHPに移植したりしました。また、もともとあった検索機能と組み合わせて便利に利用していました。さらに、irc #dameTunesのnanaoさんが開発した横長画像自動分割や巻末での次巻案内機能も取り入れさせてもらいました。

このような経緯から、現在も検索機能、読書履歴機能、書籍情報表示機能、読後の続巻表示機能、ライブラリ統計情報、日次バッチなどの部分が分離された状態で存在しています。これらの機能は、建て増しとハードコーディングを続けてきたため、少し複雑な構造になっています。そのため、まずはコア機能であるリーダー部分をオープンソースとしてリリースしました。

今後、これらの機能を統合して書籍管理システムとして動作するようになった際には、システム全体をComistream、リーダー部分をComistream Readerと命名予定です。

## 拡張

- 【epub】Web直下に/bibi/というディレクトリを切ってepubリーダーの[Bibi](https://bibi.epub.link/)をインストールして、configのbibiPathに設定を`/bibi/`と追加すると、コミックの他にepubの電子書籍も読めるようになります。
- 【検索】既存の検索機能がある場合はconfigのbook_search_url項目に`/book-search.php?book=1&search=`などのようにURLを書いてください。
- 【続巻】/suggest.phpという名称で今読んでるファイルを渡してjsonを返すコードを置くと巻末で続巻を表示します。Comistreamフルセットの方には含まれる予定です。

## 謝辞

このプロジェクトは上記でインストールしたソフトウェアの他に以下のオープンソースソフトウェアを使わせて頂いております：

- [oupala/apaxy: a simple, customisable theme for your apache directory listing](https://github.com/oupala/apaxy)
- [HLS.js](https://github.com/video-dev/hls.js)
- [long-press-event](https://github.com/john-doherty/long-press-event)
- [CSS loading animation 12](https://codepen.io/martinvd/pen/xbQJom/)
- [jQuery](https://jquery.com/)
- [jQuery UI](https://jqueryui.com/)

## 開発者

Comistream Project.

## ライセンス

[GPL-3.0ライセンス](LICENSE)
