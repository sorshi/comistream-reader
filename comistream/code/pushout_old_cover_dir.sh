#!/bin/bash
###############################################################################
# pushout_old_cover_dir.sh
#
# 説明:
#   coverとpreviewの消し込みを行います。
#   comistream/cron/cron_comistream_daily.sh から呼ばれます。
#   make_image_run.shを実行したユーザー(apacheやwww-dataなど)と同一のユーザーで実行してください。
#
# 使用方法:
#   ./pushout_old_cover_dir.sh
#
#
# 作成者: Comistream Project
# バージョン: 1.0.0
# ライセンス: GPL3.0
# https://github.com/sorshi/comistream-reader
#
###############################################################################

# 起動
logger -t "comistream pushout_old_cover_dir.sh[$$]" -p local1.info "pushout_old_cover_dir start."

# 設定
dbfile=$(realpath "$(dirname "$0")/../data/db/comistream.sqlite")
if [ ! -f "$dbfile" ]; then
    logger -t "comistream pushout_old_cover_dir.sh[$$]" -p local1.error "$dbfile not found."
    exit 1
fi

# Apache公開ディレクトリのサーバ内フルパス
searchPath=$(sqlite3 "$dbfile" "SELECT value FROM system_config WHERE key='sharePath';")
webRoot=$(sqlite3 "$dbfile" "SELECT value FROM system_config WHERE key='webRoot';")
# searchPath="/home/user/public/nas"
comistream_tool_dir=$(sqlite3 "$dbfile" "SELECT value FROM system_config WHERE key='comistream_tool_dir';")
# comistream_tool_dir="/home/user/comistream"
# coverディレクトリ
coverDir="$comistream_tool_dir/data/theme/covers/"
# previewディレクトリ
previewDir="$comistream_tool_dir/data/theme/preview/"

# 孤立画像の間引き調整ルン
removeOrphan_state_dir="$comistream_tool_dir/data/scheduler"
removeOrphan_state_file="$removeOrphan_state_dir/pushout_old_cover_dir_remove_orphan.last_run"
removeOrphan_interval_sec=$((10 * 24 * 60 * 60))
removeOrphan_window_start_hour=1
removeOrphan_window_end_hour=5
removeOrphan_random_delay_max_sec=$((30 * 60))
REMOVE_ORPHAN_NOW_EPOCH=""
# 処理部分を関数化
removeNonexistentOriginalDirs() {
  local coverDir="$1"

  # coverディレクトリ内の各ディレクトリに対して処理を行うルン
  find "$coverDir" -mindepth 1 -type d -print0 | while IFS= read -r -d '' dir; do
    # 元のディレクトリのパスを生成するルン
    local relativePath="${dir#${coverDir}}"
    local originalDir="${webRoot}/${relativePath}"

    # echo "ORG   :$originalDir"
    # echo "TARGET:$dir"

    # 元のディレクトリが存在しなければ削除するルン
    if [ ! -d "$originalDir" ]; then
      rm -rf "$dir"
      # echo "rm -rf $dir"
      logger -t "comistream pushout_old_cover_dir.sh[$$]" -p local1.debug "delete $dir "
    fi
  done
}


removeOrphanImages() {
  local baseDir="$1"
  local extensionList="$2"
  local label="$3"

  case "$baseDir" in
    */) ;;
    *) baseDir="${baseDir}/" ;;
  esac

  if [ -z "$extensionList" ]; then
    extensionList='jpg jpeg png webp'
  fi

  extensionList="${extensionList//|/ }"
  extensionList="${extensionList//,/ }"

  local extensionPattern=""
  local ext
  for ext in $extensionList; do
    ext="${ext,,}"
    if [ -z "$extensionPattern" ]; then
      extensionPattern="$ext"
    else
      extensionPattern="$extensionPattern|$ext"
    fi
  done

  if [ ! -d "$baseDir" ]; then
    return
  fi

  local lastRelativeDir=""
  local ebookBasenames=""
  local targetDir=""

  while IFS= read -r -d '' file; do
    local relativePath="${file#$baseDir}"
    relativePath="${relativePath#/}"
    local filename="$(basename "$relativePath")"
    local basename="${filename%.*}"

    # フォルダアイコンは消し込み対象外ルン
    if [ "$basename" = "index" ]; then
      continue
    fi

    local fileExt="${filename##*.}"
    if [ "$fileExt" = "$filename" ]; then
      continue
    fi
    fileExt="${fileExt,,}"
    case "$fileExt" in
      $extensionPattern) ;;
      *) continue ;;
    esac

    local relativeDir
    relativeDir="$(dirname "$relativePath")"
    if [ "$relativeDir" = "." ]; then
      relativeDir=""
    fi

    if [ "$relativeDir" != "$lastRelativeDir" ]; then
      lastRelativeDir="$relativeDir"

      if [ -n "$relativeDir" ]; then
        targetDir="$webRoot/$relativeDir"
      else
        targetDir="$webRoot"
      fi

      if [ -d "$targetDir" ]; then
        ebookBasenames=$(
          find "$targetDir" -maxdepth 1 -type f -print0 2>/dev/null | \
            while IFS= read -r -d '' ebookFile; do
              ebookName="${ebookFile##*/}"
              ebookName="${ebookName%.*}"
              printf '%s\n' "$ebookName"
            done | LC_ALL=C sort -u
        )
      else
        ebookBasenames=""
      fi
    fi

    if [ -z "$ebookBasenames" ] || ! printf '%s\n' "$ebookBasenames" | grep -Fxq "$basename"; then
      rm -f "$file"
      logger -t "comistream pushout_old_cover_dir.sh[$$]" -p local1.info "delete orphan image $file ($label)"
    fi
  done < <(find "$baseDir" -type f -print0)
}


applyRandomDelayForOrphanImages() {
  local maxDelay="$1"
  if [ -z "$maxDelay" ] || [ "$maxDelay" -le 0 ]; then
    return
  fi

  local randValue
  if command -v od >/dev/null 2>&1; then
    randValue=$(od -An -N2 -tu2 /dev/urandom 2>/dev/null | tr -d ' ')
  else
    randValue=$RANDOM
  fi

  if [ -z "$randValue" ]; then
    randValue=0
  fi

  local delay=$((randValue % (maxDelay + 1)))
  if [ "$delay" -gt 0 ]; then
    logger -t "comistream pushout_old_cover_dir.sh[$$]" -p local1.debug "sleep $delay seconds before removeOrphanImages"
    sleep "$delay"
  fi
}


shouldRunRemoveOrphanImages() {
  local nowJst
  nowJst=$(TZ="Asia/Tokyo" date +%s)
  local jstHour
  jstHour=$(TZ="Asia/Tokyo" date +%H)
  jstHour=$((10#$jstHour))

  # if [ -z "$nowJst" ] || [ -z "$jstHour" ]; then
  #   logger -t "comistream pushout_old_cover_dir.sh[$$]" -p local1.error "failed to determine JST time"
  #   return 1
  # fi

  # if [ "$jstHour" -lt "$removeOrphan_window_start_hour" ] || [ "$jstHour" -gt "$removeOrphan_window_end_hour" ]; then
  #   logger -t "comistream pushout_old_cover_dir.sh[$$]" -p local1.debug "skip orphan image cleanup: outside JST window hour=$jstHour"
  #   return 1
  # fi

  if [ ! -f "$removeOrphan_state_file" ]; then
    REMOVE_ORPHAN_NOW_EPOCH="$nowJst"
    return 0
  fi

  local lastRun
  lastRun=$(cat "$removeOrphan_state_file" 2>/dev/null)
  if [ -z "$lastRun" ] || ! [[ "$lastRun" =~ ^[0-9]+$ ]]; then
    REMOVE_ORPHAN_NOW_EPOCH="$nowJst"
    return 0
  fi

  local elapsed=$((nowJst - lastRun))
  if [ "$elapsed" -lt 0 ]; then
    elapsed=0
  fi

  if [ "$elapsed" -lt "$removeOrphan_interval_sec" ]; then
    logger -t "comistream pushout_old_cover_dir.sh[$$]" -p local1.debug "skip orphan image cleanup: last run ${elapsed}s ago (< $removeOrphan_interval_sec s)"
    return 1
  fi

  REMOVE_ORPHAN_NOW_EPOCH="$nowJst"
  return 0
}


recordRemoveOrphanImagesRun() {
  local epoch="$1"
  if [ -z "$epoch" ]; then
    return
  fi

  mkdir -p "$removeOrphan_state_dir"
  printf '%s\n' "$epoch" > "$removeOrphan_state_file"
}


# 関数を呼び出す
logger -t "comistream pushout_old_cover_dir.sh[$$]" -p local1.debug "Start: delete empty dir."
removeNonexistentOriginalDirs "$coverDir"
removeNonexistentOriginalDirs "$previewDir"
logger -t "comistream pushout_old_cover_dir.sh[$$]" -p local1.debug "Start: delete orphan images."
if shouldRunRemoveOrphanImages; then
  logger -t "comistream pushout_old_cover_dir.sh[$$]" -p local1.info "execute orphan image cleanup"
  applyRandomDelayForOrphanImages "$removeOrphan_random_delay_max_sec"
  removeOrphanImages "$coverDir" 'jpg jpeg png webp' "cover"
  removeOrphanImages "$previewDir" 'webp' "preview"
  recordRemoveOrphanImagesRun "$REMOVE_ORPHAN_NOW_EPOCH"
else
  logger -t "comistream pushout_old_cover_dir.sh[$$]" -p local1.debug "skip orphan image cleanup this run"
fi
logger -t "comistream pushout_old_cover_dir.sh[$$]" -p local1.debug "Finish: pushout_old_cover_dir.sh"

