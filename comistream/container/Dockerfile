# -----------------------------------------------------------------------------
# Comistream Reader Docker Container
#
# 高性能なサーバーサイドコミックブックリーダーのためのDockerコンテナ設定。
# AlmaLinux 10をベースに、必要なツールとライブラリをインストールし、
# Webサーバー環境を構築します。
#
# @package     sorshi/comistream-reader
# @author      Comistream Project
# @copyright   2024 Comistream Project
# @license     AGPL-3.0-only for Comistream Reader project-specific portions; see repository-root LICENSING.md
# @version     1.1.0
# @link        https://github.com/sorshi/comistream-reader
# -----------------------------------------------------------------------------
#
# ベースイメージとしてAlmaLinux10を使用
FROM almalinux:10

# タイムゾーンを日本に設定
ENV TZ Asia/Tokyo

COPY /comistream-tools/7zz /usr/local/bin/
COPY /comistream-tools/cpdf /usr/local/bin/
COPY /comistream-tools/ffmpeg /usr/local/bin/
COPY /comistream-tools/ImageMagick--clang-x86_64-7.1.1-23-patch.tar.xz /tmp/
COPY /comistream-tools/comistream.tar.gz /tmp/comistream.tar.gz
# システムの更新と必要なパッケージのインストール

# for vips build

# sudo dnf config-manager --set-enabled crb
# sudo dnf clean all
# sudo dnf install \
#     libheif-devel \
#     libaom-devel \
#     libtiff-devel \
#     librsvg2-devel \
#     lcms2-devel \
#     libexif-devel \
#     libjxl-devel \
#     fftw-devel \
#     openjpeg2-devel \
#     pango-devel \
#     libarchive-devel

#  WebPライブラリ類なども

# tar xf libvips-x.y.z.tar.gz
# cd libvips-x.y.z
# Mesonを再実行して設定を確認
# meson setup build --prefix /usr/local/
# cd build
# meson compile
# meson test
# meson install
# sudo ldconfig

# ------------------------------------------------------------

# # ベースイメージとしてAlmaLinux 10を指定
# FROM almalinux:10

# # 引数でlibvipsのバージョンを指定可能にする
# ARG VIPS_VERSION=8.17.1

# # 環境変数を設定
# ENV VIPS_HOME=/usr/local
# ENV PATH=$VIPS_HOME/bin:$PATH
# ENV PKG_CONFIG_PATH=$VIPS_HOME/lib/pkgconfig
# ENV LD_LIBRARY_PATH=$VIPS_HOME/lib

# # ビルドに必要な依存関係をまとめてインストール
# RUN dnf install -y epel-release && \
#     dnf config-manager --set-enabled crb && \
#     dnf update -y && \
#     # ビルドツール群
#     dnf install -y \
#         gcc \
#         gcc-c++ \
#         make \
#         wget \
#         tar \
#         pkgconfig \
#         meson \
#         ninja-build \
#         cmake \
#     # libvipsの依存ライブラリ群
#     && dnf install -y \
#         glib2-devel \
#         zlib-devel \
#         libjpeg-turbo-devel \
#         libpng-devel \
#         libwebp-devel \
#         giflib-devel \
#         libheif-devel \
#         libaom-devel \
#         libtiff-devel \
#         openjpeg2-devel \
#         librsvg2-devel \
#         libjxl-devel \
#         lcms2-devel \
#         libexif-devel \
#         pango-devel \
#         fftw-devel \
#         libarchive-devel \
#     && dnf clean all

# # libvipsのソースコードをダウンロード、展開、ビルド、インストール
# RUN cd /tmp && \
#     wget https://github.com/libvips/libvips/releases/download/v${VIPS_VERSION}/vips-${VIPS_VERSION}.tar.gz && \
#     tar xf vips-${VIPS_VERSION}.tar.gz && \
#     cd vips-${VIPS_VERSION} && \
#     meson setup build --prefix=${VIPS_HOME} --buildtype=release && \
#     ninja -C build && \
#     ninja -C build install && \
#     # システムが新しいライブラリを認識できるようにする
#     ldconfig && \
#     # 不要になったソースコードや一時ファイルを削除してイメージサイズを削減
#     cd / && \
#     rm -rf /tmp/vips-${VIPS_VERSION} /tmp/vips-${VIPS_VERSION}.tar.gz

# # vipsが正しくインストールされたか確認
# RUN vips --version

# # デフォルトのコマンドを設定（コンテナ起動時に実行される）
# CMD [ "vips" ]


RUN dnf update -y &&  \
    dnf install -y tar httpd php sqlite-devel zstd libzstd-devel ghostscript rsyslog-logrotate cronie cronie-anacron crontabs epel-release php-intl && \
    dnf install -y b3sum php-zstd cifs-utils unzip ImageMagick libavif-devel poppler-utils fontconfig unrar fd-find mupdf-devel php-ffi && \
    dnf clean all && \
    useradd -m user && \
    ln -sf /usr/share/zoneinfo/Asia/Tokyo /etc/localtime && \
    sed -i 's/audio\/x-flac\s*flac/audio\/flac\t\tflac/' /etc/mime.types && \
    tar xvaf /tmp/ImageMagick--clang-x86_64-7.1.1-23-patch.tar.xz -C /usr/local/bin && \
    rm -rf /tmp/ImageMagick--clang-x86_64-7.1.1-23-patch.tar.xz && \
    ls -lhtr /usr/local/bin/ && \
    chmod 755 /usr/local/bin/ImageMagick--clang-x86_64-7.1.1-23-patch/AppRun && \
    ln -s /usr/local/bin/ImageMagick--clang-x86_64-7.1.1-23-patch/AppRun /usr/local/bin/magick && \
    mkdir -p /home/user/comistream && \
    tar -xzvf /tmp/comistream.tar.gz -C /home/user/comistream --strip-components=1 && \
    rm /tmp/comistream.tar.gz && \
    mkdir -p /home/user/comistream/data && \
    # chgrp -R apache /home/user/comistream/data/ && \
    chown -R apache:apache /home/user/comistream/data/ && \
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
    mkdir -p /usr/etc/ImageMagick-7 && \
    cp /home/user/comistream/rsrc/IM7/policy.xml /usr/etc/ImageMagick-7/policy.xml && \
    # テスト用コード
    # ln -s /home/user/comistream/cron/cron_comistream_daily.sh /etc/cron.hourly/ && \
    rm -f /etc/httpd/conf.d/welcome.conf && rm -rf /etc/httpd/conf/httpd.conf && \
    mkdir -p /run/php-fpm && \
    chown apache:apache /run/php-fpm && \
    chmod 755 /run/php-fpm && \
    mkdir -p /var/cache/fontconfig && \
    chmod 777 /var/cache/fontconfig && \

    # PHP-FPMの設定を変更(from [#11])
    sed -i "s|listen = /run/php-fpm/www.sock|listen = 9000|g" /etc/php-fpm.d/www.conf && \
    sed -i "s|^listen.acl_users|;listen.acl_users|g" /etc/php-fpm.d/www.conf && \
    sed -i "s|^listen.acl_groups|;listen.acl_groups|g" /etc/php-fpm.d/www.conf && \

    # Apacheの設定を変更(from [#11])
    sed -i "s#proxy:unix:/run/php-fpm/www.sock|fcgi://localhost#proxy:fcgi://localhost:9000#g" /etc/httpd/conf.d/php.conf && \

    # 権限変更(from [#11])上でやっている
    # chown -R apache:apache /home/user/comistream/data && \
    # chmod -R 755 /home/user/comistream/data && \

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

