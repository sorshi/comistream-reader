#!/bin/bash
set -euo pipefail

# 配置済みコードには触らず、実行時領域だけを用意するルン。
umask 027
if [ "$(id -u)" = 0 ]; then
    echo "Run this container as the apache user (UID/GID 48)." >&2
    exit 1
fi
mkdir -p /tmp/comistream-runtime /tmp/comistream-fontcache
php /home/user/comistream/container/initialize-runtime.php
php-fpm --test --fpm-config /home/user/comistream/container/php-fpm.conf
httpd -t

pids=()
stop_services() {
    trap - EXIT TERM INT
    if [ "${#pids[@]}" -gt 0 ]; then
        kill -TERM "${pids[@]}" 2>/dev/null || true
        wait "${pids[@]}" 2>/dev/null || true
    fi
}
trap stop_services EXIT
trap 'exit 0' TERM INT

php-fpm --nodaemonize --fpm-config /home/user/comistream/container/php-fpm.conf &
pids+=("$!")
# FPMのsocketができる前にHTTPを受け付けて503を返さないルン。
for attempt in {1..100}; do
    [ -S /tmp/comistream-runtime/php-fpm.sock ] && break
    kill -0 "${pids[0]}" 2>/dev/null || exit 1
    sleep 0.05
done
if [ ! -S /tmp/comistream-runtime/php-fpm.sock ]; then
    echo "PHP-FPM did not become ready." >&2
    exit 1
fi
httpd -D FOREGROUND &
pids+=("$!")

# 日次処理もapacheで動かし、rootのcronを常駐させないルン。
daily_maintenance() {
    while sleep 86400; do
        if [ -f /home/user/comistream/data/db/comistream.sqlite ]; then
            bash /home/user/comistream/cron/cron_comistream_daily.sh || echo "Daily maintenance failed." >&2
        fi
    done
}
daily_maintenance &
pids+=("$!")
wait -n "${pids[@]}"
