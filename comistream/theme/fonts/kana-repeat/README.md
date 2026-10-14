# Comistream Kana Repeat

日本語EPUBのくの字点U+3031（〱）・U+3032（〲）を補う、1,812バイトの補助フォントです。Shippori Mincho RegularのU+3033・U+3034・U+3035からヒンティングを除いた輪郭を抽出し、上下の字形を合成して、縦方向に2em進む2つのグリフを追加しました。派生フォント名はComistream Kana Repeat、バージョンは1.0です。

- 原作者: The Shippori Mincho Project Authors
- 著作権: Copyright 2021 The Shippori Mincho Project Authors
- 原プロジェクト: https://github.com/fontdasu/ShipporiMincho
- [同梱する原本と固定リビジョン](../../../rsrc/fonts/shippori-mincho/README.md)
- ライセンス: SIL Open Font License 1.1。[著作権表示と全文](OFL.txt)を同梱しています。この派生フォントにもOFL 1.1が適用されます。
- `ComistreamKanaRepeat-v1.ttf` SHA-256: `83eb0007f184ef3ae308fe4040b20b50556c42aa7cb54c901ff54379eb2fe282`

CSSの`unicode-range: U+3031-3032`で使用範囲を制限しています。元から上下2文字で表現されているU+3033 U+3035（〳〵）・U+3034 U+3035（〴〵）は、本文の書体で接続して描画します。

配信先は`/theme/fonts/kana-repeat/ComistreamKanaRepeat-v1.ttf`です。フォントはHTMLへ埋め込まず、対象文字の表示に必要な場合だけブラウザが取得します。パケットセービングモードでもこの補助フォントは使用します。Apache用の`.htaccess`はバージョン付きファイルを1年間キャッシュ可能にします。別のWebサーバーでは同等の`Content-Type: font/ttf`と`Cache-Control: public, max-age=31536000, immutable`を設定できます。ファイルを改訂するときはファイル名のバージョンとリーダー側のURLを一緒に更新してください。

## 再生成

以下はリポジトリのルートから実行します。Python 3の標準ライブラリとHarfBuzzの`hb-subset`を使い、ネットワーク通信はしません。生成時に使ったHarfBuzzは14.6.0です。通常の設置・実行にこれらのツールは不要です。

```sh
hb-subset comistream/rsrc/fonts/shippori-mincho/ShipporiMincho-Regular.ttf \
  --unicodes=3033-3035 --no-hinting --drop-tables=GSUB,GPOS,GDEF,BASE \
  --output-file=/tmp/comistream-kana-repeat-halves.ttf
python3 comistream/code/tools/build_kana_repeat_font.py \
  /tmp/comistream-kana-repeat-halves.ttf \
  comistream/theme/fonts/kana-repeat/ComistreamKanaRepeat-v1.ttf
```
