# -----------------------------------------------------------------------------
# Comistream Reader Docker Container
#
# 高性能なサーバーサイドコミックブックリーダーのためのDockerコンテナ設定。
# AlmaLinux 9をベースに、必要なツールとライブラリをインストールし、
# Webサーバー環境を構築します。
#
# @package     sorshi/comistream-reader
# @author      Comistream Project
# @copyright   2024 Comistream Project
# @license     GPL3.0 License
# @version     1.0.0
# @link        https://github.com/sorshi/comistream-reader
# -----------------------------------------------------------------------------
#
# ベースイメージとしてAlmaLinux9を使用
FROM almalinux:9

# タイムゾーンを日本に設定
ENV TZ Asia/Tokyo

COPY /comistream-tools/7zz /usr/local/bin/
COPY /comistream-tools/cpdf /usr/local/bin/
COPY /comistream-tools/ffmpeg /usr/local/bin/
COPY /comistream-tools/ImageMagick--clang-x86_64-7.1.1-23-patch.tar.zstd /tmp/
COPY /comistream-tools/comistream.tar.gz /tmp/comistream.tar.gz
# システムの更新と必要なパッケージのインストール
RUN dnf update -y &&  \
    dnf install -y tar httpd php sqlite-devel zstd libzstd-devel ghostscript rsyslog-logrotate cronie cronie-anacron crontabs epel-release unrar && \
    dnf install -y b3sum php-zstd cifs-utils unzip ImageMagick libavif-devel poppler-utils fontconfig && \
    dnf clean all && \
    useradd -m user && \
    ln -sf /usr/share/zoneinfo/Asia/Tokyo /etc/localtime && \
    tar xvaf /tmp/ImageMagick--clang-x86_64-7.1.1-23-patch.tar.zstd -C /usr/local/bin && \
    rm -rf /tmp/ImageMagick--clang-x86_64-7.1.1-23-patch.tar.zstd && \
    ls -lhtr /usr/local/bin/ && \
    chmod 755 /usr/local/bin/ImageMagick--clang-x86_64-7.1.1-23-patch/AppRun && \
    ln -s /usr/local/bin/ImageMagick--clang-x86_64-7.1.1-23-patch/AppRun /usr/local/bin/magick && \
    mkdir -p /home/user/comistream && \
    tar -xzvf /tmp/comistream.tar.gz -C /home/user/comistream --strip-components=1 && \
    rm /tmp/comistream.tar.gz && \
    mkdir -p /home/user/comistream/data && \
    chgrp -R apache /home/user/comistream/data/ && \
    chmod -R 775 /home/user/comistream/data/ && \
    chmod 775 /home/user && chgrp apache /home/user && \
    ln -s /home/user/comistream/code/comistream.php /var/www/cgi-bin/ && \
    ln -s /home/user/comistream/code/livestream.php /var/www/cgi-bin/ && \
    mkdir -p /home/user/public/nas && \
    chgrp apache -R /home/user/public && \
    chmod 775 /home/user/public && \
    echo "Redirect 302 / /cgi-bin/comistream.php" > /home/user/public/.htaccess && \
    chmod 666 /home/user/public/.htaccess && \
    chmod 755 /home/user/comistream/cron/cron_comistream_daily.sh && \
    ln -s /home/user/comistream/cron/cron_comistream_daily.sh /etc/cron.daily/ && \
    # テスト用コード
    # ln -s /home/user/comistream/cron/cron_comistream_daily.sh /etc/cron.hourly/ && \
    rm -f /etc/httpd/conf.d/welcome.conf && rm -rf /etc/httpd/conf/httpd.conf && \
    mkdir -p /run/php-fpm && \
    chown apache:apache /run/php-fpm && \
    chmod 755 /run/php-fpm && \
    mkdir -p /var/cache/fontconfig && \
    chmod 777 /var/cache/fontconfig && \
    echo '#!/bin/bash' > /start.sh && \
    echo 'trap "echo Shutting down...; kill -TERM \$(jobs -p) 2>/dev/null" SIGTERM SIGINT' >> /start.sh && \
    echo 'mkdir -p /var/log/php-fpm' >> /start.sh && \
    echo 'mkdir -p /var/log/sssd' >> /start.sh && \
    echo 'mkdir -p /var/log/anaconda' >> /start.sh && \
    echo 'mkdir -p /var/log/private' >> /start.sh && \
    echo 'mkdir -p /var/log/samba' >> /start.sh && \
    echo 'mkdir -p /var/log/httpd' >> /start.sh && \
    echo 'mkdir -p /var/log/audit' >> /start.sh && \
    echo 'crond' >> /start.sh && \
    echo '/usr/sbin/php-fpm &' >> /start.sh && \
    echo 'php /home/user/comistream/code/intstallThemeDir.php' >> /start.sh && \
    echo '/usr/sbin/httpd -D FOREGROUND &' >> /start.sh && \
    echo 'wait' >> /start.sh && \
    chmod +x /start.sh

# 追加のツールをインストール

# ユーザーを作成
# RUN useradd -m user

# ホストからアーカイブをコピーして展開
#RUN mkdir -p /home/user/comistream && \
#    tar -xzvf /tmp/comistream.tar.gz -C /home/user/comistream --strip-components=1 && \
#    rm /tmp/comistream.tar.gz && \
#    mkdir -p /home/user/comistream/data && \
#    chmod 755 /home/user && chgrp apache /home/user 

# シンボリックリンクとパーミッションの設定
#RUN ln -s /home/user/comistream/code/comistream.php /var/www/cgi-bin/ && \
#    ln -s /home/user/comistream/code/livestream.php /var/www/cgi-bin/ && \
#    chgrp -R apache /home/user/comistream/data/ && \
#    chmod -R 775 /home/user/comistream/data/

# データディレクトリとコンテンツディレクトリの作成
# RUN mkdir -p /home/user/public/nas

# Apacheの設定
# RUN rm -f /etc/httpd/conf.d/welcome.conf && rm -rf /etc/httpd/conf/httpd.conf
COPY /comistream-tools/httpd.conf /etc/httpd/conf/httpd.conf
# COPY /comistream-tools/comistream_setup.conf /etc/httpd/conf.d/
# RUN chown apache:apache /etc/httpd/conf.d/comistream_setup.conf && \
#     chmod 775 /etc/httpd/conf.d && \
#     chgrp apache /etc/httpd/conf.d

# php-fpmの設定
# RUN mkdir -p /run/php-fpm && \
# chown apache:apache /run/php-fpm && \
# chmod 755 /run/php-fpm

# Apacheとphp-fpmを起動するスクリプトを作成

# logrotateの設定

# cronの設定


# ポート80を公開
EXPOSE 80

# 起動スクリプトを実行
CMD ["/start.sh"]

