#!/bin/bash
set -euo pipefail

# ビルド時だけrootで固定配置を作るルン。実行中のvolumeには適用しないルン。
# AppImageの展開先は700になるので、固定ツールを非rootから読んで実行できるようにするルン。
chmod -R a+rX,go-w /usr/local/lib/imagemagick
install -d -o root -g root -m 0755 /home/user/public/nas
chown root:root /home/user /home/user/public /home/user/public/nas
chmod 0755 /home/user /home/user/public /home/user/public/nas
chown -R root:root /home/user/comistream
chmod -R go-w /home/user/comistream
install -d -o apache -g apache -m 0750 /home/user/comistream/data
ln -s /home/user/comistream/theme /home/user/public/theme
for kind in covers preview hls; do
    ln -s "/home/user/comistream/data/theme/$kind" "/home/user/comistream/theme/$kind"
done
install -m 0644 /home/user/comistream/container/httpd.conf /etc/httpd/conf/httpd.conf
install -d -m 0755 /usr/etc/ImageMagick-7
install -m 0644 /home/user/comistream/rsrc/IM7/policy.xml /usr/etc/ImageMagick-7/policy.xml
