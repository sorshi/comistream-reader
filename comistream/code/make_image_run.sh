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
# バージョン: 2.0.0
# ライセンス: プロジェクト独自部分はAGPL-3.0-only（リポジトリルートのLICENSING.md参照）
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

# キャッシュファイルのパス（環境変数でmake_image関数に渡すルン！）
export EBOOK_CACHE_FILE=""
export IMAGE_CACHE_COVERS=""
export IMAGE_CACHE_PREVIEW=""
# バッチモードフラグ（単一ファイルモードでは無条件に画像生成するルン！）
export BATCH_MODE=false

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
      total_candidates=0
      matching_candidates=0
      missing_candidates=()
      # オヨ！grep -F用とfind用で別々のエスケープが必要ルン！
      # grep -F（固定文字列検索）はエスケープ不要、そのまま使うルン！
      grep_pattern="/$outputBasename"
      # find -name用はワイルドカード文字だけエスケープするルン！
      escaped_output_basename=$(printf '%s\n' "$outputBasename" | sed 's/[][\\*?]/\\&/g')

      # 単一ファイルモードでは既存画像チェックをスキップして無条件生成するルン！
      if [ "$BATCH_MODE" != "true" ]; then
        logger -t "comistream make_image_run.sh[$$]" -p local1.debug "single file mode: skip reuse check, force regenerate: $1 ($imageType)"
        link_created=false
      else
        # オヨ？ワイルドカード変換されたら困るからバッチリエスケープするルン！
        logger -t "comistream make_image_run.sh[$$]" -p local1.debug "checking reuse candidates for: $1 ($imageType)"

        # オヨ？同名ファイルを探してハッシュ比較するルン！
      if [ -z "$target_size" ]; then
        logger -t "comistream make_image_run.sh[$$]" -p local1.debug "target ebook size unavailable; fallback to regenerate: $1"
      else
        # キャッシュファイルを使うか判断するルン！
        local image_cache=""
        if [ "$imageType" == "covers" ] && [ -n "$IMAGE_CACHE_COVERS" ] && [ -f "$IMAGE_CACHE_COVERS" ]; then
          image_cache="$IMAGE_CACHE_COVERS"
        elif [ "$imageType" == "preview" ] && [ -n "$IMAGE_CACHE_PREVIEW" ] && [ -f "$IMAGE_CACHE_PREVIEW" ]; then
          image_cache="$IMAGE_CACHE_PREVIEW"
        fi

        # オヨ！バッチモードなのにキャッシュが無いのは異常ルン！
        if [ "$BATCH_MODE" = "true" ] && [ -z "$image_cache" ]; then
          logger -t "comistream make_image_run.sh[$$]" -p local1.warning "batch mode but no image cache available; it may have been deleted during processing"
        fi

        if [ -n "$image_cache" ]; then
          # キャッシュから検索するルン！高速ルン！
          # 圧縮されている場合は展開して読むルン！
          local cache_reader="cat"
          if [[ "$image_cache" == *.zst ]]; then
            cache_reader="zstdcat"
          fi

          logger -t "comistream make_image_run.sh[$$]" -p local1.debug "searching for pattern in cache: $grep_pattern"

          # デバッグ：grepの結果をカウントするルン
          local grep_match_count=0
          grep_match_count=$($cache_reader "$image_cache" 2>/dev/null | grep -F -c "$grep_pattern" || echo 0)
          logger -t "comistream make_image_run.sh[$$]" -p local1.debug "grep found $grep_match_count potential matches in cache"

          while IFS= read -r existingFile; do
            # ファイルが実際に存在するか確認するルン！
            if [ ! -f "$existingFile" ]; then
              logger -t "comistream make_image_run.sh[$$]" -p local1.debug "cache entry does not exist on disk: $existingFile"
              continue
            fi

            total_candidates=$((total_candidates + 1))
            if [ "$existingFile" == "$outputFile" ]; then
              logger -t "comistream make_image_run.sh[$$]" -p local1.debug "skipping self: $existingFile"
              continue
            fi

            matching_candidates=$((matching_candidates + 1))

            # ふにゃ？候補は同名だけ探してるからここは絞り込み済みルン！
            source_ebook=$(resolve_ebook_from_image "$existingFile" "$imageType")
            logger -t "comistream make_image_run.sh[$$]" -p local1.debug "candidate image: $existingFile -> ebook: ${source_ebook:-UNRESOLVED}"
            if [ -z "$source_ebook" ]; then
              logger -t "comistream make_image_run.sh[$$]" -p local1.debug "source ebook path unresolved; mark as missing candidate: $existingFile"
              missing_candidates+=("$existingFile")
              continue
            fi

            if [ ! -f "$source_ebook" ]; then
              logger -t "comistream make_image_run.sh[$$]" -p local1.debug "source ebook missing; mark as missing candidate: $existingFile"
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
              if ln "$existingFile" "$outputFile"; then
                logger -t "comistream make_image_run.sh[$$]" -p local1.info "hardlink created $existingFile for: $1 ($imageType)"
                link_created=true
                break
              else
                logger -t "comistream make_image_run.sh[$$]" -p local1.error "hardlink failed; will continue searching; $existingFile $outputFile; for: $1 ($imageType)"
                link_created=false
                break
              fi
            fi

            logger -t "comistream make_image_run.sh[$$]" -p local1.debug "hash mismatch; skip candidate: $existingFile (source_hash=$source_hash target_hash=$target_hash)"
          done < <($cache_reader "$image_cache" 2>/dev/null | grep -F "$grep_pattern")
        else
          # キャッシュがないからfindを使うルン（単一ファイルモード用）
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
              logger -t "comistream make_image_run.sh[$$]" -p local1.debug "source ebook path unresolved; mark as missing candidate: $existingFile"
              missing_candidates+=("$existingFile")
              continue
            fi

            if [ ! -f "$source_ebook" ]; then
              logger -t "comistream make_image_run.sh[$$]" -p local1.debug "source ebook missing; mark as missing candidate: $existingFile"
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
        fi

        # オヨオヨ？元ebookが見つからない画像があったルン！ファイル移動かチェックするルン！
        if [ "$link_created" != true ] && [ ${#missing_candidates[@]} -gt 0 ]; then
          logger -t "comistream make_image_run.sh[$$]" -p local1.debug "found ${#missing_candidates[@]} missing ebook candidate(s); checking if file was moved"

          # ファイル名のみ（拡張子込み、ディレクトリパスなし）を取得するルン！
          target_filename=$(basename "$1")
          target_name_only="${target_filename%.*}"
          same_name_count=0

          # searchPath全体で同名のebookファイルを全てカウントするルン！
          # キャッシュがあればそれを使い、なければfindするルン！
          if [ -n "$EBOOK_CACHE_FILE" ] && [ -f "$EBOOK_CACHE_FILE" ]; then
            # キャッシュから検索するルン！高速ルン！
            # 圧縮されている場合は展開して読むルン！
            local ebook_cache_reader="cat"
            if [[ "$EBOOK_CACHE_FILE" == *.zst ]]; then
              ebook_cache_reader="zstdcat"
            fi

            # オヨ！grepで先にファイル名フィルタリングして候補を絞り込むルン！
            # これで数万ファイルから数個に削減できるルン！
            # grep -F（固定文字列検索）はエスケープ不要ルン！
            local grep_ebook_pattern="/$target_name_only."
            while IFS= read -r found_file; do
              # ファイルが実際に存在するか確認するルン！
              if [ ! -f "$found_file" ]; then
                logger -t "comistream make_image_run.sh[$$]" -p local1.debug "cache entry does not exist: $found_file"
                continue
              fi

              found_filename=$(basename "$found_file")
              found_name_only="${found_filename%.*}"
              # 拡張子を除いたファイル名で比較するルン！
              if [ "$found_name_only" == "$target_name_only" ]; then
                same_name_count=$((same_name_count + 1))
                logger -t "comistream make_image_run.sh[$$]" -p local1.debug "found same-name ebook: $found_file"
                # オヨ！2個以上見つかったらもう移動じゃないから早期終了するルン！
                if [ "$same_name_count" -ge 2 ]; then
                  logger -t "comistream make_image_run.sh[$$]" -p local1.debug "multiple same-name files found; early exit from search"
                  break
                fi
              fi
            done < <($ebook_cache_reader "$EBOOK_CACHE_FILE" 2>/dev/null | grep -F "$grep_ebook_pattern")
          else
            # キャッシュがないからfindを使うルン（単一ファイルモード用）
            # オヨ！バッチモード中にキャッシュが消えた場合は全体スキャンを避けるルン！
            if [ "$BATCH_MODE" = "true" ]; then
              logger -t "comistream make_image_run.sh[$$]" -p local1.warning "cache unavailable during batch mode; skipping file move detection for: $1"
            else
              # 単一ファイルモードでのみfind実行（タイムアウト付き）
              logger -t "comistream make_image_run.sh[$$]" -p local1.debug "single file mode: using find with timeout"
              local find_timeout=30  # 30秒でタイムアウト
              while IFS= read -r -d '' found_file; do
                found_filename=$(basename "$found_file")
                found_name_only="${found_filename%.*}"
                # 拡張子を除いたファイル名で比較するルン！
                if [ "$found_name_only" == "$target_name_only" ]; then
                  same_name_count=$((same_name_count + 1))
                  logger -t "comistream make_image_run.sh[$$]" -p local1.debug "found same-name ebook: $found_file"
                  # オヨ！2個以上見つかったらもう移動じゃないから早期終了するルン！
                  if [ "$same_name_count" -ge 2 ]; then
                    logger -t "comistream make_image_run.sh[$$]" -p local1.debug "multiple same-name files found; early exit from search"
                    break
                  fi
                fi
              done < <(timeout "$find_timeout" find "$searchPath" -type f \( -name "*.zip" -o -name "*.ZIP" -o -name "*.cbz" -o -name "*.CBZ" -o -name "*.rar" -o -name "*.RAR" -o -name "*.cbr" -o -name "*.CBR" -o -name "*.7z" -o -name "*.7Z" -o -name "*.cb7" -o -name "*.CB7" -o -name "*.pdf" -o -name "*.PDF" -o -name "*.epub" -o -name "*.EPUB" -o -name "*.ePub" \) -print0 2>/dev/null)
            fi
          fi

          logger -t "comistream make_image_run.sh[$$]" -p local1.debug "same-name ebook count in searchPath: $same_name_count"

          # 同名ファイルが1つだけ（現在処理中のファイル）なら移動と判定するルン！
          if [ "$same_name_count" -eq 1 ]; then
            if [ ${#missing_candidates[@]} -eq 1 ]; then
              candidate="${missing_candidates[0]}"
              mkdir -p "$(dirname "$outputFile")"
              ln "$candidate" "$outputFile"
              logger -t "comistream make_image_run.sh[$$]" -p local1.info "hardlink created (detected file move) $candidate for: $1 ($imageType)"
              link_created=true
            else
              logger -t "comistream make_image_run.sh[$$]" -p local1.debug "file move detected but multiple image candidates (${#missing_candidates[@]}); cannot determine which to reuse"
            fi
          else
            logger -t "comistream make_image_run.sh[$$]" -p local1.debug "multiple same-name ebooks exist ($same_name_count); not a file move, creating new image"
          fi
        fi
      fi

      if [ "$link_created" != true ]; then
        logger -t "comistream make_image_run.sh[$$]" -p local1.debug "checked ${matching_candidates} matching candidate(s) among ${total_candidates} scanned; reusable image found? $link_created"
        logger -t "comistream make_image_run.sh[$$]" -p local1.debug "no reusable image found; creating new: $1 ($imageType)"
        nice php "$make_image_script" --file="$1" --type="$imageType"
        # 失敗したらトリミングなしで再実行するルン
        # リトライで成功するパターンがあまりなかったので廃止
        # if [ ! -s "$outputFile" ]; then
        #   logger -t "comistream make_image_run.sh[$$]" -p local1.info "First attempt failed for $1. Retrying with trimming disabled."
        #   nice php "$make_image_script" --file="$1" --type="$imageType" --trimming=2
        # fi
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
  export BATCH_MODE=false
  make_image "$1" "$2"
else
  # バッチモード：キャッシュファイルを作成するルン！
  logger -t "comistream make_image_run.sh[$$]" -p local1.info "batch mode: creating cache files for faster processing"
  export BATCH_MODE=true

  # 一時ディレクトリを作成（前回の残骸があれば削除するルン！）
  if [ -n "$comistream_tmp_dir_root" ] && [ -d "$comistream_tmp_dir_root" ]; then
    # 6時間以上前のcache_*ディレクトリを削除するルン！
    # ただし実行中のプロセスのキャッシュは保護するルン！
    logger -t "comistream make_image_run.sh[$$]" -p local1.debug "cleaning up old cache directories"
    find "$comistream_tmp_dir_root" -maxdepth 1 -type d -name "cache_*" -mmin +360 2>/dev/null | while read -r old_cache; do
      cache_basename=$(basename "$old_cache")
      cache_pid="${cache_basename#cache_}"

      # PIDが数字で、そのプロセスが存在しないことを確認してから削除するルン！
      if [[ "$cache_pid" =~ ^[0-9]+$ ]]; then
        if ! kill -0 "$cache_pid" 2>/dev/null; then
          logger -t "comistream make_image_run.sh[$$]" -p local1.info "removing stale cache: $old_cache (PID $cache_pid not running)"
          rm -rf "$old_cache" || true
        else
          logger -t "comistream make_image_run.sh[$$]" -p local1.debug "keeping active cache: $old_cache (PID $cache_pid still running)"
        fi
      fi
    done
  fi
  cache_dir="${comistream_tmp_dir_root}/cache_$$"
  mkdir -p "$cache_dir"

  # zstdコマンドが利用可能かチェックするルン！
  USE_ZSTD=false
  if command -v zstd >/dev/null 2>&1; then
    USE_ZSTD=true
    logger -t "comistream make_image_run.sh[$$]" -p local1.info "zstd compression available, cache files will be compressed"
    export EBOOK_CACHE_FILE="$cache_dir/ebooks.txt.zst"
    export IMAGE_CACHE_COVERS="$cache_dir/images_covers.txt.zst"
    export IMAGE_CACHE_PREVIEW="$cache_dir/images_preview.txt.zst"
  else
    logger -t "comistream make_image_run.sh[$$]" -p local1.info "zstd not available, using uncompressed cache files"
    export EBOOK_CACHE_FILE="$cache_dir/ebooks.txt"
    export IMAGE_CACHE_COVERS="$cache_dir/images_covers.txt"
    export IMAGE_CACHE_PREVIEW="$cache_dir/images_preview.txt"
  fi

  # ebookファイル一覧を作成するルン！
  logger -t "comistream make_image_run.sh[$$]" -p local1.info "building ebook file cache..."
  if [ "$USE_ZSTD" = true ]; then
    find "$searchPath" -type f \( -name "*.zip" -o -name "*.ZIP" -o -name "*.cbz" -o -name "*.CBZ" -o -name "*.rar" -o -name "*.RAR" -o -name "*.cbr" -o -name "*.CBR" -o -name "*.7z" -o -name "*.7Z" -o -name "*.cb7" -o -name "*.CB7" -o -name "*.pdf" -o -name "*.PDF" -o -name "*.epub" -o -name "*.EPUB" -o -name "*.ePub" \) 2>/dev/null | zstd -q > "$EBOOK_CACHE_FILE"
    ebook_count=$(zstdcat "$EBOOK_CACHE_FILE" 2>/dev/null | wc -l)
  else
    find "$searchPath" -type f \( -name "*.zip" -o -name "*.ZIP" -o -name "*.cbz" -o -name "*.CBZ" -o -name "*.rar" -o -name "*.RAR" -o -name "*.cbr" -o -name "*.CBR" -o -name "*.7z" -o -name "*.7Z" -o -name "*.cb7" -o -name "*.CB7" -o -name "*.pdf" -o -name "*.PDF" -o -name "*.epub" -o -name "*.EPUB" -o -name "*.ePub" \) > "$EBOOK_CACHE_FILE" 2>/dev/null
    ebook_count=$(wc -l < "$EBOOK_CACHE_FILE")
  fi
  logger -t "comistream make_image_run.sh[$$]" -p local1.info "ebook cache built: $ebook_count files"

  # 表紙画像一覧を作成するルン！
  logger -t "comistream make_image_run.sh[$$]" -p local1.info "building cover image cache..."
  if [ "$USE_ZSTD" = true ]; then
    find "$webRoot/theme/covers/" -type f \( -name "*.jpg" -o -name "*.jpeg" -o -name "*.webp" -o -name "*.png" \) 2>/dev/null | zstd -q -T0 > "$IMAGE_CACHE_COVERS"
    cover_count=$(zstdcat "$IMAGE_CACHE_COVERS" 2>/dev/null | wc -l)
  else
    find "$webRoot/theme/covers/" -type f \( -name "*.jpg" -o -name "*.jpeg" -o -name "*.webp" -o -name "*.png" \) > "$IMAGE_CACHE_COVERS" 2>/dev/null
    cover_count=$(wc -l < "$IMAGE_CACHE_COVERS")
  fi
  logger -t "comistream make_image_run.sh[$$]" -p local1.info "cover cache built: $cover_count files"

  # プレビュー画像一覧を作成するルン！
  logger -t "comistream make_image_run.sh[$$]" -p local1.info "building preview image cache..."
  if [ "$USE_ZSTD" = true ]; then
    find "$webRoot/theme/preview/" -type f \( -name "*.jpg" -o -name "*.jpeg" -o -name "*.webp" -o -name "*.png" \) 2>/dev/null | zstd -q -T0 > "$IMAGE_CACHE_PREVIEW"
    preview_count=$(zstdcat "$IMAGE_CACHE_PREVIEW" 2>/dev/null | wc -l)
  else
    find "$webRoot/theme/preview/" -type f \( -name "*.jpg" -o -name "*.jpeg" -o -name "*.webp" -o -name "*.png" \) > "$IMAGE_CACHE_PREVIEW" 2>/dev/null
    preview_count=$(wc -l < "$IMAGE_CACHE_PREVIEW")
  fi
  logger -t "comistream make_image_run.sh[$$]" -p local1.info "preview cache built: $preview_count files"

  logger -t "comistream make_image_run.sh[$$]" -p local1.info "cache files created successfully! starting batch processing..."

  # 引数が渡されなかった場合は、findコマンドを使用して処理する
  cd "$searchPath"

  # fdコマンドが利用可能かチェック
  # オヨ！特殊文字（バッククォート、$、!など）を含むファイル名を安全に処理するため、
  # -print0/-0とbashの位置パラメータ($1)を使うルン！
  if command -v fd >/dev/null 2>&1; then
    logger -t "comistream make_image_run.sh[$$]" -p local1.debug "using fd command for faster processing"
    # fdコマンドでファイル検索を実行（NULL区切り出力）
    # オヨ！--hiddenはフラグで値を取らないルン！falseは検索パスとして解釈されてしまうルン！
    # fdはデフォルトで隠しファイルを除外するから--hiddenは不要ルン！
    fd . $cover_subDir --type f --print0 | xargs -0 -n1 -P ${multiProc} bash -c 'make_image "$1" 2>'"$errorLog" _
  else
    logger -t "comistream make_image_run.sh[$$]" -p local1.debug "using find command for processing"
    # ループで実行（NULL区切り出力）
    find $cover_subDir -type f -not -name '.*' -print0 | xargs -0 -n1 -P ${multiProc} bash -c 'make_image "$1" 2>'"$errorLog" _
  fi

  # キャッシュディレクトリを削除するルン！
  logger -t "comistream make_image_run.sh[$$]" -p local1.info "cleaning up cache files..."
  rm -rf "$cache_dir"

fi
