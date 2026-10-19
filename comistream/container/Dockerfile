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
# 固定した外部入力を取得し、実変換まで検証するルン。
FROM almalinux:10 AS tools
RUN dnf install -y tar xz diffutils fontconfig libX11 harfbuzz fribidi && dnf clean all
COPY comistream/container/tools.lock comistream/container/install-tools.sh /tmp/tools/
RUN bash /tmp/tools/install-tools.sh /opt/comistream-tools
COPY comistream/rsrc/IM7/policy.xml /opt/comistream-tools/lib/imagemagick/usr/etc/ImageMagick-7/policy.xml
COPY comistream/container/verify-tools.sh /tmp/tools/verify-tools.sh
ENV PATH="/opt/comistream-tools/bin:${PATH}"
RUN bash /tmp/tools/verify-tools.sh

# 本体はビルド対象のcheckoutから取り込むルン。
FROM almalinux:10 AS runtime

# タイムゾーンを日本に設定
ENV TZ=Asia/Tokyo

COPY --from=tools /opt/comistream-tools/ /usr/local/
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


RUN dnf update -y && \
    dnf install -y tar httpd php php-fpm php-gd php-pdo php-mbstring php-xml sqlite sqlite-devel zstd libzstd-devel ghostscript rsyslog-logrotate cronie cronie-anacron crontabs epel-release php-intl && \
    dnf install -y b3sum php-zstd cifs-utils unzip ImageMagick libavif-devel poppler-utils fontconfig libX11 harfbuzz fribidi unrar fd-find mupdf-devel php-ffi && \
    dnf clean all && \
    useradd -m user && \
    ln -sf /usr/share/zoneinfo/Asia/Tokyo /etc/localtime && \
    sed -i 's/audio\/x-flac\s*flac/audio\/flac\t\tflac/' /etc/mime.types

# 設定・コード・テーマはroot所有で固定し、dataだけを書込可能にするルン。
COPY comistream/ /home/user/comistream/
COPY LICENSE LICENSING.md /home/user/comistream/
RUN bash /home/user/comistream/container/configure-runtime.sh
ENV COMISTREAM_MANAGED_INSTALL=1 \
    XDG_CACHE_HOME=/tmp/comistream-fontcache
USER apache:apache
EXPOSE 8080
CMD ["/bin/bash", "/home/user/comistream/container/start.sh"]
