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
md5cmd=$(sqlite3 "$dbfile" "SELECT value FROM system_config WHERE key='md5cmd';")
export md5cmd

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

ebook_extensions=(zip ZIP cbz CBZ rar RAR cbr CBR 7z 7Z cb7 CB7 pdf PDF epub EPUB ePub)

function get_file_hash() {
  local target="$1"
  if [ -z "$md5cmd" ]; then
    echo ""
    return 1
  fi
  if [ ! -f "$target" ]; then
    echo ""
    return 1
  fi

  local cmd=()
  read -r -a cmd <<< "$md5cmd"
  if [ ${#cmd[@]} -eq 0 ]; then
    echo ""
    return 1
  fi

  local output
  if ! output=$("${cmd[@]}" "$target" 2>/dev/null); then
    echo ""
    return 1
  fi

  echo "$output" | awk 'NR==1 {print $1}'
}
export -f get_file_hash

function get_file_size() {
  local target="$1"
  if [ -z "$target" ] || [ ! -f "$target" ]; then
    echo ""
    return 1
  fi

  local size
  if size=$(stat -c %s "$target" 2>/dev/null); then
    echo "$size"
    return 0
  fi

  if size=$(stat -f %z "$target" 2>/dev/null); then
    echo "$size"
    return 0
  fi

  size=$(wc -c < "$target" 2>/dev/null)
  echo "$size"
  return 0
}
export -f get_file_size

function resolve_ebook_from_image() {
  local image_path="$1"
  local image_type="$2"
  local relative_path=""
  local prefix="$webRoot/theme/$image_type/"

  if [[ "$image_path" == "$prefix"* ]]; then
    relative_path="${image_path#"$prefix"}"
    relative_path="${relative_path#/}"
    local normalized_public_dir="${publicDir#/}"
    if [ -n "$normalized_public_dir" ] && [[ "$relative_path" == "$normalized_public_dir/"* ]]; then
      relative_path="${relative_path#"$normalized_public_dir/"}"
    fi
  else
    prefix="$comistream_tool_dir/data/theme/$image_type$publicDir/"
    if [[ "$image_path" == "$prefix"* ]]; then
      relative_path="${image_path#"$prefix"}"
    fi
  fi

  if [ -z "$relative_path" ]; then
    echo ""
    return 1
  fi

  relative_path="${relative_path#/}"
  local normalized_public_dir="${publicDir#/}"
  if [ -n "$normalized_public_dir" ] && [[ "$relative_path" == "$normalized_public_dir/"* ]]; then
    relative_path="${relative_path#"$normalized_public_dir/"}"
  fi

  local base_path="${relative_path%.*}"
  local candidate
  for ext in "${ebook_extensions[@]}"; do
    candidate="$searchPath/$base_path.$ext"
    if [ -f "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done

  echo ""
  return 1
}
export -f resolve_ebook_from_image

function make_image() {
  set +H
  filePath="$searchPath/$1"
  imageType="$2"


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
      # 開始時間を記録
      start_time=$(date +%s.%N)
      logger -t "comistream make_image_run.sh[$$]" -p local1.info "Generate image files for $outputFile"
      outputBasename=$(basename "${outputFile}")
      link_created=false
      target_size=$(get_file_size "$filePath")
      target_hash=""
      missing_candidates=()
      total_candidates=0
      matching_candidates=0
      escaped_output_basename=$(printf '%s\n' "$outputBasename" | sed 's/[][\\*?]/\\&/g')
      # オヨ？ワイルドカード変換されたら困るからバッチリエスケープするルン！
      logger -t "comistream make_image_run.sh[$$]" -p local1.debug "checking reuse candidates for: $1 ($imageType)"

      # オヨ？ ebookが見付からないルン…移動かもだから候補に入れるルン！
      if [ -z "$target_size" ]; then
        logger -t "comistream make_image_run.sh[$$]" -p local1.debug "target ebook size unavailable; fallback to regenerate: $1"
      else
        while IFS= read -r -d '' existingFile; do
          total_candidates=$((total_candidates + 1))
          if [ "$existingFile" == "$outputFile" ]; then
            continue
          fi

          matching_candidates=$((matching_candidates + 1))

          # ふにゃ？候補は同名だけ探してるからここは絞り込み済みルン！
          source_ebook=$(resolve_ebook_from_image "$existingFile" "$imageType")
          logger -t "comistream make_image_run.sh[$$]" -p local1.debug "candidate image: $existingFile -> ebook: ${source_ebook:-UNRESOLVED}"
          if [ -z "$source_ebook" ]; then
            logger -t "comistream make_image_run.sh[$$]" -p local1.debug "source ebook path unresolved; skip candidate: $existingFile"
            missing_candidates+=("$existingFile")
            continue
          fi

          if [ ! -f "$source_ebook" ]; then
            logger -t "comistream make_image_run.sh[$$]" -p local1.debug "source ebook missing; skip candidate: $existingFile"
            missing_candidates+=("$existingFile")
            continue
          fi

          source_size=$(get_file_size "$source_ebook")
          if [ -z "$source_size" ] || [ "$source_size" != "$target_size" ]; then
            logger -t "comistream make_image_run.sh[$$]" -p local1.debug "size mismatch; skip candidate: $existingFile (source=$source_size target=$target_size)"
            continue
          fi

          if [ -z "$target_hash" ]; then
            target_hash=$(get_file_hash "$filePath")
            if [ -z "$target_hash" ]; then
              logger -t "comistream make_image_run.sh[$$]" -p local1.debug "target hash unavailable; stop reuse attempt for: $1"
              break
            fi
            logger -t "comistream make_image_run.sh[$$]" -p local1.debug "target hash: $target_hash"
          fi
          source_hash=$(get_file_hash "$source_ebook")

          if [ -z "$source_hash" ]; then
            logger -t "comistream make_image_run.sh[$$]" -p local1.debug "hash unavailable; skip candidate: $existingFile"
            continue
          fi

          logger -t "comistream make_image_run.sh[$$]" -p local1.debug "source hash: $source_hash (candidate: $existingFile)"

          if [ "$source_hash" == "$target_hash" ]; then
            mkdir -p "$(dirname "$outputFile")"
            ln "$existingFile" "$outputFile"
            logger -t "comistream make_image_run.sh[$$]" -p local1.info "hardlink created $existingFile for: $1 ($imageType)"
            link_created=true
            break
          fi

          logger -t "comistream make_image_run.sh[$$]" -p local1.debug "hash mismatch; skip candidate: $existingFile (source_hash=$source_hash target_hash=$target_hash)"
        done < <(find "$webRoot/theme/$imageType/" -type f -name "${escaped_output_basename}" -print0 2>/dev/null)
      fi

      if [ "$link_created" != true ] && [ ${#missing_candidates[@]} -eq 1 ]; then
        candidate="${missing_candidates[0]}"
        mkdir -p "$(dirname "$outputFile")"
        ln "$candidate" "$outputFile"
        logger -t "comistream make_image_run.sh[$$]" -p local1.info "hardlink created (assumed move) $candidate for: $1 ($imageType)"
        link_created=true
      elif [ "$link_created" != true ] && [ ${#missing_candidates[@]} -gt 1 ]; then
        logger -t "comistream make_image_run.sh[$$]" -p local1.debug "multiple missing ebook candidates (${#missing_candidates[@]}) for: $1; skip hardlink"
      fi

      if [ "$link_created" != true ]; then
        logger -t "comistream make_image_run.sh[$$]" -p local1.debug "checked ${matching_candidates} matching candidate(s) among ${total_candidates} scanned; reusable image found? $link_created"
        logger -t "comistream make_image_run.sh[$$]" -p local1.debug "no reusable image found; creating new: $1 ($imageType)"
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
    logger -t "comistream make_image_run.sh[$$]" -p local1.warning "$imageType output NG :$outputFile:$1"
    rm -f "$outputFile"
  else
    # 終了時間を記録し、所要時間を計算
    end_time=$(date +%s.%N)
    duration=$(echo "$end_time - $start_time" | bc)
    # 小数点第2位で四捨五入
    duration=$(printf "%.1f" "$duration")
    logger -t "comistream make_image_run.sh[$$]" -p local1.info "$imageType output OK : $1 (processing time: ${duration}sec)"
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

  # fdコマンドが利用可能かチェック
  if command -v fd >/dev/null 2>&1; then
    logger -t "comistream make_image_run.sh[$$]" -p local1.debug "using fd command for faster processing"
    # fdコマンドでファイル検索を実行
    fd . $cover_subDir --type f --hidden false | xargs -I{} -d '\n' -P ${multiProc} bash -c 'make_image "{}" 2>'"$errorLog"
  else
    logger -t "comistream make_image_run.sh[$$]" -p local1.debug "using find command for processing"
    # ループで実行
    find $cover_subDir -type f -not -name '.*' | xargs -I{} -d '\n' -P ${multiProc} bash -c 'make_image "{}" 2>'"$errorLog"
  fi

fi
