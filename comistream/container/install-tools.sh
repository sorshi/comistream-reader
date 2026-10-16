#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 1 || $1 != /* ]]; then
    printf 'Usage: %s /absolute/install/prefix\n' "$0" >&2
    exit 2
fi
if [[ $(uname -s) != Linux || $(uname -m) != x86_64 ]]; then
    printf 'Only Linux x86_64 is supported by tools.lock.\n' >&2
    exit 2
fi

script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
prefix=$1
if [[ -e $prefix || -L $prefix ]]; then
    printf 'Install prefix must not already exist: %s\n' "$prefix" >&2
    exit 2
fi
work_dir=$(mktemp -d)
trap 'rm -rf -- "$work_dir"' EXIT
download_dir=${TOOLS_DOWNLOAD_DIR:-$work_dir/downloads}
mkdir -p -- "$download_dir"

# キャッシュも毎回照合し、全入力の検証が終わるまで展開・実行しないルン。
while IFS=$'\t' read -r filename version digest url; do
    [[ -z $filename || $filename == \#* ]] && continue
    if [[ ! $filename =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ || ! $digest =~ ^[0-9a-f]{64}$ || $url != https://* ]]; then
        printf 'Invalid entry in tools.lock: %s\n' "$filename" >&2
        exit 1
    fi
    archive=$download_dir/$filename
    if [[ ! -f $archive ]]; then
        printf 'Downloading %s (%s)\n' "$filename" "$version"
        curl --fail --location --silent --show-error --proto '=https' --proto-redir '=https' \
            --connect-timeout 20 --max-time 600 --retry 3 "$url" -o "$work_dir/download"
        actual=$(sha256sum "$work_dir/download")
        if [[ ${actual%% *} != "$digest" ]]; then
            printf 'SHA-256 mismatch: %s\n' "$filename" >&2
            exit 1
        fi
        mv -- "$work_dir/download" "$archive"
    fi
    actual=$(sha256sum "$archive")
    if [[ ${actual%% *} != "$digest" ]]; then
        printf 'SHA-256 mismatch: %s\n' "$filename" >&2
        exit 1
    fi
done < "$script_dir/tools.lock"

mkdir -p "$work_dir/7zip" "$work_dir/ffmpeg" "$work_dir/imagemagick"
tar -xJf "$download_dir/7zip.tar.xz" -C "$work_dir/7zip"
tar -xJf "$download_dir/ffmpeg.tar.xz" -C "$work_dir/ffmpeg" --strip-components=1

# AppImageは展開して使うので、FUSEや特権コンテナは不要ルン。
install -m 755 "$download_dir/imagemagick.AppImage" "$work_dir/imagemagick/AppImage"
(cd "$work_dir/imagemagick" && ./AppImage --appimage-extract > /dev/null)

mkdir -p "$prefix/bin" "$prefix/lib" "$prefix/share/licenses/comistream-tools/7zip" \
    "$prefix/share/licenses/comistream-tools/cpdf" "$prefix/share/licenses/comistream-tools/ffmpeg" \
    "$prefix/share/licenses/comistream-tools/imagemagick" "$prefix/share/comistream-tools"
install -m 755 "$work_dir/7zip/7zz" "$prefix/bin/7zz"
install -m 755 "$download_dir/cpdf" "$prefix/bin/cpdf"
install -m 755 "$work_dir/ffmpeg/bin/ffmpeg" "$work_dir/ffmpeg/bin/ffprobe" "$prefix/bin/"
cp -R "$work_dir/ffmpeg/presets" "$prefix/share/ffmpeg"
mv "$work_dir/imagemagick/squashfs-root" "$prefix/lib/imagemagick"
ln -s ../lib/imagemagick/AppRun "$prefix/bin/magick"

# バイナリと一緒に、配布元の権利表示と固定した入力一覧も残すルン。
install -m 644 "$work_dir/7zip/License.txt" "$prefix/share/licenses/comistream-tools/7zip/"
install -m 644 "$download_dir/cpdf-LICENSE.md" "$download_dir/cpdf-ACKNOWLEDGEMENTS.md" \
    "$prefix/share/licenses/comistream-tools/cpdf/"
install -m 644 "$work_dir/ffmpeg/LICENSE.txt" "$prefix/share/licenses/comistream-tools/ffmpeg/"
install -m 644 "$download_dir/imagemagick-LICENSE" "$download_dir/imagemagick-NOTICE" \
    "$prefix/share/licenses/comistream-tools/imagemagick/"
install -m 644 "$script_dir/tools.lock" "$prefix/share/comistream-tools/"
printf 'External tools installed in %s\n' "$prefix"
