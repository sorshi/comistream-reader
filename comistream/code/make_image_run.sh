#!/bin/bash
###############################################################################
# make_image_run.sh
#
# 説明:
#   日次バッチから起動してプレビュー画像と表紙画像未作成の電子書籍アーカイブを検出したら作成します。
#   同じファイル名の場所移動を検出した際にはリソース節約のためハードリンクを作成します。
#
# 使用方法:
#   ./make_image_run.sh [ファイルパス] [画像タイプ]
#
# オプション:
#   ファイルパス  - 処理対象のファイルパス（省略時は全ファイルを処理）
#   画像タイプ    - 作成する画像タイプ（covers|preview）
#
#
# 作成者: Comistream Project
# バージョン: 1.0.1
# ライセンス: GPL3.0
# https://github.com/sorshi/comistream-reader
#
###############################################################################

# 設定値
dbfile=$(realpath "$(dirname "$0")/../data/db/comistream.sqlite")
if [ ! -f "$dbfile" ]; then
  logger -t "comistream make_preview_run.sh[$$]" -p local1.error "$dbfile not found."
  exit 1
fi

export webRoot=$(sqlite3 "$dbfile" "SELECT value FROM system_config WHERE key='webRoot';")
export searchPath=$(sqlite3 "$dbfile" "SELECT value FROM system_config WHERE key='sharePath';")
# export searchPath="/home/user/public/nas"
export comistream_tool_dir=$(sqlite3 "$dbfile" "SELECT value FROM system_config WHERE key='comistream_tool_dir';")
# export comistream_tool_dir="/home/user/comistream"
export publicDir=$(sqlite3 "$dbfile" "SELECT value FROM system_config WHERE key='publicDir';")
# export publicDir="/nas";
export comistream_tmp_dir_root=$(sqlite3 "$dbfile" "SELECT value FROM system_config WHERE key='comistream_tmp_dir_root';")

# # プレビュー画像用のディレクトリ
# 廃止、coversと共通化
# preview_subDir="FanArt AdultComic Comic pictures-mook comicast/Photo"
# 表紙画像用のディレクトリ
cover_subDir=$(sqlite3 "$dbfile" "SELECT value FROM system_config WHERE key='cover_subDir';")

# 処理多重度
multiProc=1
# 利用コマンドパス
export make_image_script=$(realpath "$(dirname "$0")/make_cover_preview.php")
# エラーログ
errorLog="/dev/null"

function make_image() {
  set +H
  filePath="$searchPath/$1"
  imageType="$2"

  # 開始時間を記録
  start_time=$(date +%s.%N)

  # 60分以上前のtmpディレクトリ内項目を削除
  # 高頻度すぎたので廃止
  # if [[ "$comistream_tmp_dir_root" =~ ^/dev/shm/.* ]]; then
  #   if [ -d "$comistream_tmp_dir_root" ]; then
  #       current_dir=$(pwd)
  #       cd "$comistream_tmp_dir_root" && find "$comistream_tmp_dir_root" -mindepth 1 -maxdepth 4 -type d -mmin +60 -exec rm -rf {} +
  #       cd "$current_dir"
  #       logger -t "comistream make_image_run.sh[$$]" -p local1.debug "Complete removal of old cache file entries."
  #   else
  #   logger -t "comistream make_image_run.sh[$$]" -p local1.info "$comistream_tmp_dir_root Dir not found."
  #   fi
  # fi

  # imageTypeが指定されていない場合、両方の処理を実行
  if [ -z "$imageType" ]; then
    make_image "$1" "preview"
    make_image "$1" "cover"
    return
  fi

  if [ "$imageType" == "preview" ]; then
    outputFile="$comistream_tool_dir/data/theme/preview$publicDir/$1"
    outputFile="${outputFile%.*}.webp"
  else
    outputFile="$comistream_tool_dir/data/theme/covers$publicDir/$1"
    outputFile="${outputFile%.*}.jpg"
    imageType="covers"
  fi

  # 出力ファイルが存在しないか0バイトの場合
  if [ ! -s "$outputFile" ]; then
    if [[ "$filePath" =~ \.(zip|ZIP|cbz|CBZ|rar|RAR|cbr|CBR|7z|7Z|cb7|CB7|pdf|PDF|epub|EPUB|ePub)$ ]]; then
      outputBasename=$(basename "${outputFile}")
      existingFile=$(find "$webRoot/theme/$imageType/" -type f | grep -m 1 -F "${outputBasename}")
      # logger -t "comistream make_image_run.sh[$$]" -p local1.notice "$existingFile $outputFile $1"

      if [ -n "$existingFile" ] && [ "$existingFile" != "$outputFile" ]; then
        # 既存のファイルが見つかった場合、ハードリンクを作成
        mkdir -p "$(dirname "$outputFile")"
        ln "$existingFile" "$outputFile"
        logger -t "comistream make_image_run.sh[$$]" -p local1.info "hardlink created $existingFile for: $1 ($imageType)"
      else
        # 既存のファイルが見つからない場合、新規作成
        logger -t "comistream make_image_run.sh[$$]" -p local1.debug "$imageType file not exist; creating new: $1"
        nice php $make_image_script --file="$1" --type="$imageType"
      fi
    else
      # 関係ないファイル
      return
    fi
  else
    return
  fi

  if [ ! -s "$outputFile" ]; then
    logger -t "comistream make_image_run.sh[$$]" -p local1.NOTICE "$imageType output NG :$outputFile:$1"
    rm -f "$outputFile"
  else
    # 終了時間を記録し、所要時間を計算
    end_time=$(date +%s.%N)
    duration=$(echo "$end_time - $start_time" | bc)
    # 小数点第2位で四捨五入
    duration=$(printf "%.1f" "$duration")
    logger -t "comistream make_image_run.sh[$$]" -p local1.INFO "$imageType output OK : $1 (processing time: ${duration}sec)"
  fi

  set -H
}
export -f make_image

# 引数が渡された場合は、そのファイルのみを処理する
if [ $# -eq 2 ]; then
  logger -t "comistream make_image_run.sh[$$]" -p local1.debug "single process mode : $1 ($2)"
  php $make_image_script --file="$1" --type="$imageType"
else
  # 引数が渡されなかった場合は、findコマンドを使用して処理する
  cd "$searchPath"

  # ループで実行
  find $cover_subDir -type f -not -name '.*' | xargs -I{} -d '\n' -P ${multiProc} bash -c 'make_image "{}" 2>'"$errorLog"

fi
