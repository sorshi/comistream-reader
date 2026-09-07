#!/bin/bash
###############################################################################
# comistream/cron/cron_comistream_daily.sh
#
# 説明:
#   日次バッチスクリプト
#   cronから日次や週次で実行を想定しています。
#   /etc/cron.daily/にcron_comistream_daily.shのシンボリックリンクを貼ってください。
#
#
#
# 作成者: Comistream Project
# バージョン: 1.0.0
# ライセンス: プロジェクト独自部分はAGPL-3.0-only（リポジトリルートのLICENSING.md参照）
# https://github.com/sorshi/comistream-reader
#
###############################################################################

# スクリプトが root で実行されているか確認
if [ "$(id -u)" = "0" ]; then
    # root の場合は su を使って apache ユーザーで実行
    exec su -s /bin/bash apache -c "$0 $*"
    exit 1
fi

# apache ユーザーでない場合は終了
if [ "$(id -un)" != "apache" ]; then
    logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.error "This script must be run as apache user or root"
    exit 1
fi

# 設定値
SCRIPT_PATH=$(readlink -f "$0")  # シンボリックリンクの実際のターゲットパスを取得
SCRIPT_DIR=$(dirname "$SCRIPT_PATH")  # 実際のスクリプトのディレクトリを取得
dbfile="$SCRIPT_DIR/../data/db/comistream.sqlite"

# デバッグ用ログ出力
logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.debug "Script path: $SCRIPT_PATH"
logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.debug "Script directory: $SCRIPT_DIR"
logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.debug "Database file path: $dbfile"

if [ ! -f "$dbfile" ]; then
    logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.error "$dbfile not found."
    exit 1
fi

# 表紙とプレビュー画像の作成
logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.info "start make_image_run.sh."
make_image_run_file="$SCRIPT_DIR/../code/make_image_run.sh"
bash "$make_image_run_file" > /dev/null 2>&1

# リネームしたり移動したりで使われてない表紙ディレクトリとプレビューファイルディレクトリの削除
logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.info "start pushout_old_cover_dir.sh."
pushout_old_cover_dir_file="$SCRIPT_DIR/../code/pushout_old_cover_dir.sh"
bash "$pushout_old_cover_dir_file" > /dev/null 2>&1

# 古い/dev/shm/一時ファイルの削除
comistream_tmp_dir_root=$(sqlite3 "$dbfile" "SELECT value FROM system_config WHERE key='comistream_tmp_dir_root';")
logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.info "Starting removal of old cache file entries."
# 60分以上前のtmpディレクトリ内項目を削除
if [[ "$comistream_tmp_dir_root" =~ ^/dev/shm/.* ]]; then
    if [ -d "$comistream_tmp_dir_root" ]; then
        current_dir=$(pwd)
        cd "$comistream_tmp_dir_root" && find "$comistream_tmp_dir_root" -mindepth 1 -maxdepth 4 -type d -mmin +60 -exec rm -rf {} +
        cd "$current_dir"
        logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.debug "Complete removal of old cache file entries."
    else
        logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.info "$comistream_tmp_dir_root Dir not found."
    fi
fi

# キャッシュディレクトリのサイズ管理
cache_limit_size=$(sqlite3 "$dbfile" "SELECT value FROM system_config WHERE key='pushoutCacheLimitSize';")
cache_limit_days=$(sqlite3 "$dbfile" "SELECT value FROM system_config WHERE key='pushoutCacheLimitDays';")
#$cacheDir = $conf["comistream_tool_dir"] . "/data/cache";
cacheDir="$SCRIPT_DIR/../data/cache"
music_cache_lock_dir="$SCRIPT_DIR/../data/runtime/music"

# 音楽キャッシュはアプリと同じ固定ロックを守って1項目ずつ削除するルン。
is_music_lyrics_cache_entry() {
    local entry_name
    entry_name=$(basename "$1")
    [[ "$entry_name" =~ ^music-lyrics-[0-9a-f]{64}$ ]]
}

is_music_audio_cache_entry() {
    local entry_name
    entry_name=$(basename "$1")
    [[ "$entry_name" =~ ^music-audio-[0-9a-f]{64}$ ]]
}

is_music_cache_entry() {
    is_music_lyrics_cache_entry "$1" || is_music_audio_cache_entry "$1"
}

remove_cache_entry() {
    local cache_entry="$1"
    local entry_name=$(basename "$cache_entry")
    local lock_fd
    local result

    case "$cache_entry" in
        "$cacheDir"/*) ;;
        *)
            logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.error "Refusing cache removal outside cache directory: $cache_entry"
            return 1
            ;;
    esac
    case "$entry_name" in
        .|..)
            logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.error "Refusing special cache entry: $cache_entry"
            return 1
            ;;
    esac
    [ -d "$cache_entry" ] || return 0
    [ -L "$cache_entry" ] && return 1

    if is_music_cache_entry "$cache_entry"; then
        entry_name=$(basename "$cache_entry")
        local cache_hash
        local music_cache_lock_file
        cache_hash=${entry_name#music-audio-}
        cache_hash=${cache_hash#music-lyrics-}
        music_cache_lock_file="$music_cache_lock_dir/music-cache-${cache_hash:0:2}.lock"
        if ! mkdir -p "$music_cache_lock_dir"; then
            logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.warning "Cannot create music cache lock directory; skipping $entry_name"
            return 1
        fi
        if ! exec {lock_fd}>"$music_cache_lock_file"; then
            logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.warning "Cannot open music cache lock file; skipping $entry_name"
            return 1
        fi
        if ! flock -n "$lock_fd"; then
            logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.notice "Music cache is busy; skipping $entry_name"
            exec {lock_fd}>&-
            return 1
        fi
        if is_music_audio_cache_entry "$cache_entry"; then
            local latest_activity=0
            local candidate_activity
            local now_epoch
            local activity_file
            for activity_file in "$cache_entry/manifest.json" "$cache_entry/access"; do
                [ -f "$activity_file" ] || continue
                candidate_activity=$(stat -c %Y "$activity_file" 2>/dev/null || echo 0)
                if [[ "$candidate_activity" =~ ^[0-9]+$ ]] && [ "$candidate_activity" -gt "$latest_activity" ]; then
                    latest_activity=$candidate_activity
                fi
            done
            if [ -f "$cache_entry/access" ]; then
                IFS= read -r candidate_activity < "$cache_entry/access"
                if [[ "$candidate_activity" =~ ^[0-9]+$ ]] && [ "$candidate_activity" -gt "$latest_activity" ]; then
                    latest_activity=$candidate_activity
                fi
            fi
            now_epoch=$(date +%s)
            if [ "$latest_activity" -gt 0 ] && [ $((now_epoch - latest_activity)) -le 180 ]; then
                logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.notice "Audio cache lease is active; skipping $entry_name"
                flock -u "$lock_fd"
                exec {lock_fd}>&-
                return 1
            fi
        fi
        rm -rf -- "$cache_entry"
        result=$?
        flock -u "$lock_fd"
        exec {lock_fd}>&-
        return "$result"
    fi

    rm -rf -- "$cache_entry"
}

if [[ "$cache_limit_size" =~ ^[0-9]+$ ]] && [ "$cache_limit_size" -gt 0 ]; then
    logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.debug "Starting cache directory size management."
elif [ "$cache_limit_size" = "0" ]; then
    logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.info "Cache directory size management is disabled."
else
    # DDLの初期値と同じ3GBで削除するルン。
    logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.info "cache_limit_size was not defined. set 3GB."
    cache_limit_size=3000
fi

# 日数制限による古いファイルの削除
if [[ "$cache_limit_days" =~ ^[0-9]+$ ]] && [ "$cache_limit_days" -gt 0 ]; then
    logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.debug "Removing files older than $cache_limit_days days"
elif [ "$cache_limit_days" = "0" ]; then
    logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.info "Cache directory age management is disabled."
else
    logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.info "cache_limit_size was not defined. set 30days."
    cache_limit_days=30
fi

# apacheユーザーで実行されてるはず
# cache_limit_daysより古いディレクトリを消す
if [ "$cache_limit_days" -gt 0 ] && [ -d "$cacheDir" ]; then
    while IFS= read -r -d '' cache_subdir; do
        # 音楽キャッシュはctimeではなく、下の明示的なaccess時刻で判定するルン。
        if is_music_cache_entry "$cache_subdir"; then
            continue
        fi
        remove_cache_entry "$cache_subdir" || logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.notice "Skipped old cache entry: $(basename "$cache_subdir")"
    done < <(find "$cacheDir" -mindepth 1 -maxdepth 1 -type d -ctime +"$cache_limit_days" -print0)
fi

# atimeベースの削除（$cache_limit_daysの半分の日数でアクセスされていないものを削除）
atime_limit_days=$((cache_limit_days / 2))
logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.debug "Checking for directories with old atime (${atime_limit_days} days)"

# $cacheDirの各サブディレクトリをチェック
if [ "$atime_limit_days" -gt 0 ] && [ -d "$cacheDir" ]; then
    for cache_subdir in "$cacheDir"/*/; do
        [ -d "$cache_subdir" ] || continue
        cache_dirname=$(basename "$cache_subdir")

        if is_music_cache_entry "$cache_subdir"; then
            target_file="${cache_subdir}access"
            access_epoch=""
            if [ -f "$target_file" ]; then
                IFS= read -r access_epoch < "$target_file"
            fi
            if ! [[ "$access_epoch" =~ ^[0-9]+$ ]]; then
                access_epoch=$(stat -c %Y "$cache_subdir" 2>/dev/null || echo 0)
            fi
            now_epoch=$(date +%s)
            if [[ "$access_epoch" =~ ^[0-9]+$ ]] && [ $((now_epoch - access_epoch)) -gt $((atime_limit_days * 86400)) ]; then
                logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.debug "Removing music cache directory due to old access time: $cache_dirname"
                remove_cache_entry "$cache_subdir" || logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.notice "Skipped busy music cache: $cache_dirname"
            fi
            continue
        fi

        # OEBPS/content.opfかindexファイルをチェックするルン。
        target_file=""
        if [ -f "${cache_subdir}OEBPS/content.opf" ]; then
            target_file="${cache_subdir}OEBPS/content.opf"
        elif [ -f "${cache_subdir}index" ]; then
            target_file="${cache_subdir}index"
        fi

        # 対象ファイルが存在し、atimeが制限を超えている場合は削除するルン。
        if [ -n "$target_file" ] && [ "$(find "$target_file" -atime +"$atime_limit_days" | wc -l)" -gt 0 ]; then
            logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.debug "Removing directory due to old atime: $cache_dirname"
            remove_cache_entry "$cache_subdir" || logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.notice "Skipped old cache entry: $cache_dirname"
        fi
    done
fi

logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.debug "Completed atime-based cache cleanup"

# 現在のキャッシュディレクトリサイズを取得（MB単位）
current_size=$(du -sm "$cacheDir" 2>/dev/null | awk '{print $1}')
current_size=${current_size:-0}

# サイズが制限を超えている場合、古いディレクトリから削除
skipped_cache_entries=""
find_oldest_cache_entry() {
    local cache_subdir
    local cache_name
    local timestamp
    local oldest_name=""
    local oldest_timestamp=9223372036854775807

    for cache_subdir in "$cacheDir"/*/; do
        [ -d "$cache_subdir" ] || continue
        cache_name=$(basename "$cache_subdir")
        case "|$skipped_cache_entries|" in
            *"|$cache_name|"*) continue ;;
        esac
        if is_music_cache_entry "$cache_subdir" && [ -f "${cache_subdir}access" ]; then
            IFS= read -r timestamp < "${cache_subdir}access"
        else
            timestamp=$(stat -c %Y "$cache_subdir" 2>/dev/null || echo 0)
        fi
        [[ "$timestamp" =~ ^[0-9]+$ ]] || timestamp=0
        if [ -z "$oldest_name" ] || [ "$timestamp" -lt "$oldest_timestamp" ]; then
            oldest_name="$cache_name"
            oldest_timestamp="$timestamp"
        fi
    done
    printf '%s' "$oldest_name"
}

if [ "$cache_limit_size" -gt 0 ] && [ -d "$cacheDir" ]; then
    while [ "$current_size" -gt "$cache_limit_size" ]; do
        oldest_dir=$(find_oldest_cache_entry)
        if [ -n "$oldest_dir" ]; then
            logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.debug "Removing old directory: $oldest_dir"
            if remove_cache_entry "${cacheDir}/${oldest_dir}"; then
                skipped_cache_entries=""
            else
                case "|$skipped_cache_entries|" in
                    *"|$oldest_dir|"*) ;;
                    *) skipped_cache_entries="${skipped_cache_entries:+$skipped_cache_entries|}$oldest_dir" ;;
                esac
            fi
            current_size=$(du -sm "$cacheDir" 2>/dev/null | awk '{print $1}')
            current_size=${current_size:-0}
        else
            logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.warning "No removable cache entry remains while over size limit."
            break
        fi
    done
fi

logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.info 'Cache directory size management completed. Current size: '"${current_size}"'MB'


# /theme/bibi/以下の切れたシンボリックリンクを削除
webRoot=$(sqlite3 "$dbfile" "SELECT value FROM system_config WHERE key='webRoot';")
bibi_dir="${webRoot}/theme/bibi"
if [ -d "$bibi_dir" ]; then
    logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.debug "Cleaning up broken symlinks in $bibi_dir"
    # 切れたシンボリックリンクを検出・削除
    find "$bibi_dir" -mindepth 1 -maxdepth 1 -type l ! -e -exec rm -f {} +
    logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.debug "Broken symlinks cleanup completed in $bibi_dir"
else
    logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.info "Bibi directory not found: $bibi_dir"
fi

# カスタムフォルダアイコン作成
logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.info "start make_folder_image_run.sh."
make_folder_image_run_file="$SCRIPT_DIR/../code/make_folder_image_run.sh"
bash "$make_folder_image_run_file" > /dev/null 2>&1
