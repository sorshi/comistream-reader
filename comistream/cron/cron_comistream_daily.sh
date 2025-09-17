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
# ライセンス: GPL3.0
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

if [ -n "$cache_limit_size" ] && [ "$cache_limit_size" -gt 0 ]; then
    logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.debug "Starting cache directory size management."
else
    # 未定義時は1GB/30日で削除
    logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.info "cache_limit_size was not defined. set 1GB."
    cache_limit_size=1000
fi

# 日数制限による古いファイルの削除
if [ -n "$cache_limit_days" ] && [ "$cache_limit_days" -gt 0 ]; then
    logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.debug "Removing files older than $cache_limit_days days"
else
    logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.info "cache_limit_size was not defined. set 30days."
    cache_limit_days=30
fi

# apacheユーザーで実行されてるはず
# cache_limit_daysより古いディレクトリを消す
find "$cacheDir" -mindepth 1 -maxdepth 1 -type d -ctime +"$cache_limit_days" -exec rm -rf {} +

# atimeベースの削除（$cache_limit_daysの半分の日数でアクセスされていないものを削除）
atime_limit_days=$((cache_limit_days / 2))
logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.debug "Checking for directories with old atime (${atime_limit_days} days)"

# $cacheDirの各サブディレクトリをチェック
for cache_subdir in "$cacheDir"/*/; do
    [ -d "$cache_subdir" ] || continue
    
    # OEBPS/content.opfかindexファイルをチェック
    target_file=""
    if [ -f "${cache_subdir}OEBPS/content.opf" ]; then
        target_file="${cache_subdir}OEBPS/content.opf"
    elif [ -f "${cache_subdir}index" ]; then
        target_file="${cache_subdir}index"
    fi
    
    # 対象ファイルが存在し、atimeが制限を超えている場合は削除
    if [ -n "$target_file" ] && [ $(find "$target_file" -atime +"$atime_limit_days" | wc -l) -gt 0 ]; then
        cache_dirname=$(basename "$cache_subdir")
        logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.debug "Removing directory due to old atime: $cache_dirname"
        rm -rf "$cache_subdir"
    fi
done

logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.debug "Completed atime-based cache cleanup"

# 現在のキャッシュディレクトリサイズを取得（MB単位）
current_size=$(du -sm "$cacheDir" | awk '{print $1}')

# サイズが制限を超えている場合、古いディレクトリから削除
while [ "$current_size" -gt "$cache_limit_size" ]; do
    oldest_dir=$(ls -t "$cacheDir" | tail -n 1)
    if [ -n "$oldest_dir" ]; then
        logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.debug "Removing old directory: $oldest_dir"
        sudo -u apache rm -rf "${cacheDir}/${oldest_dir}"
        current_size=$(du -sm "$cacheDir" | awk '{print $1}')
    else
        break
    fi
done

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
