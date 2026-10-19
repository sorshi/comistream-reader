#!/usr/bin/env bash
set -euo pipefail

work_dir=$(mktemp -d)
trap 'rm -rf -- "$work_dir"' EXIT
cd "$work_dir"

magick -version
cpdf -version
ffmpeg -version
ffprobe -version

# 一覧への表示だけでなく、AVIFとWebPの書き込み・読み戻しを確かめるルン。
magick -size 32x24 xc:red source.png
for format in avif webp; do
    magick source.png "encoded.$format"
    [[ $(magick identify -format '%m %wx%h' "encoded.$format") == "${format^^} 32x24" ]]
    magick "encoded.$format" "decoded-$format.png"
    [[ $(magick identify -format '%m %wx%h' "decoded-$format.png") == 'PNG 32x24' ]]
done

printf 'archive verification\n' > payload.txt
7zz a -tzip sample.zip payload.txt > /dev/null
7zz t sample.zip > /dev/null
7zz x -so sample.zip payload.txt > restored.txt
expected=$(sha256sum payload.txt)
actual=$(sha256sum restored.txt)
[[ ${expected%% *} == ${actual%% *} ]]

cpdf -create-pdf -o sample.pdf
[[ $(cpdf -pages sample.pdf) == 1 ]]

# リーダーが使うH.264/AACとHLS出力を、短い合成素材で検証するルン。
ffmpeg -hide_banner -loglevel error -f lavfi -i color=c=black:s=32x32:r=10 \
    -f lavfi -i sine=frequency=440:sample_rate=44100 -t 1 \
    -c:v libx264 -pix_fmt yuv420p -c:a aac -f hls -hls_time 1 sample.m3u8
ffprobe -v error -show_entries stream=codec_name -of csv=p=0 sample.m3u8 > codecs.txt
grep -qx h264 codecs.txt
grep -qx aac codecs.txt
printf 'External tool checks passed (AVIF, WebP, ZIP, PDF, HLS).\n'
