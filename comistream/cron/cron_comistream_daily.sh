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

    # 日数制限による古いファイルの削除
    if [ -n "$cache_limit_days" ] && [ "$cache_limit_days" -gt 0 ]; then
        logger -t "comistream cron_comistream_daily.sh[$$]" -p local1.debug "Removing files older than $cache_limit_days days"
        # sudo -u apache find "$cacheDir" -mindepth 3 -mtime +"$cache_limit_days" -exec rm -rf {} +
        # apacheユーザーで実行されてるはず
        find "$cacheDir" -mindepth 3 -mtime +"$cache_limit_days" -exec rm -rf {} +
    fi

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

fi



