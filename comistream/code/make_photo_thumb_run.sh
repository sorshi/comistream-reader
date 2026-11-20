#!/bin/bash
# SPDX-License-Identifier: AGPL-3.0-only
set -o pipefail

log_photo() {
    logger -t "comistream make_photo_thumb_run.sh[$$]" -p "local1.$1" -- "$2"
}

if (( $# > 1 )); then
    printf 'Usage: %s [share-relative-directory]\n' "$0" >&2
    exit 1
fi

code_dir=$(cd -- "$(dirname -- "$0")" && pwd -P) || exit 1
dbfile="$code_dir/../data/db/comistream.sqlite"
[[ -f "$dbfile" ]] || exit 1
setting() {
    sqlite3 "$dbfile" "SELECT value FROM system_config WHERE key='$1';"
}

if (( $# == 1 )); then
    roots=("$1")
else
    scope=$(setting photo_subDir) || exit 1
    # 設定はシェルで評価せず、引用符付きのディレクトリ名として読むルン。
    token_pattern='^[[:space:]]*("([^"]+)"|([^"[:space:]]+))([[:space:]]+|$)'
    roots=()
    while [[ "$scope" =~ $token_pattern ]]; do
        roots+=("${BASH_REMATCH[2]}${BASH_REMATCH[3]}")
        scope=${scope:${#BASH_REMATCH[0]}}
    done
    if [[ "$scope" =~ [^[:space:]] ]]; then
        log_photo error 'Invalid photo_subDir: use double quotes around directory names with spaces.'
        exit 1
    fi
    (( ${#roots[@]} )) || exit 0
fi

tool_dir=$(setting comistream_tool_dir) || exit 1
share_path=$(setting sharePath) || exit 1
[[ -n "$tool_dir" && -n "$share_path" ]] || exit 1
tool_dir=$(cd -- "$tool_dir" && pwd -P) || exit 1
share_path=$(cd -- "$share_path" && pwd -P) || exit 1
[[ -r "$share_path" && -x "$share_path" ]] || exit 1

# 生成・掃除の起点にシンボリックリンクを使わないルン。
for directory in "$tool_dir/data" "$tool_dir/data/runtime" "$tool_dir/data/theme" "$tool_dir/data/theme/thumbs"; do
    [[ ! -L "$directory" ]] && mkdir -p -- "$directory" || exit 1
done
thumb_root="$tool_dir/data/theme/thumbs"
lock_path="$tool_dir/data/runtime/photo-thumbs.lock"
[[ ! -L "$lock_path" ]] || exit 1
exec 9>>"$lock_path" || exit 1
flock -n -E 75 9
status=$?
if (( status != 0 )); then
    if (( status == 75 )); then
        log_photo info 'Photo thumbnail batch is already running.'
        exit 0
    fi
    log_photo error 'Cannot lock the photo thumbnail batch.'
    exit 1
fi

# 判定は dir_list_api.php と lib_photo.php のしきい値を共有するルン。
formats=$(php -r '
    require $argv[1] . "/lib/lib_photo.php";
    require $argv[1] . "/lib/lib_hls_paths.php";
    echo implode("|", PHOTO_IMAGE_EXTENSIONS), " ", implode("|", ls_source_extensions()),
        " ", PHOTO_MIN_IMAGES, " ", PHOTO_MIN_PERCENT, " ", PHOTO_THUMB_SIZE;
' "$code_dir") || exit 1
read -r image_extensions video_extensions min_images min_percent thumb_size <<< "$formats"
shopt -s nullglob
image_pattern="\.($image_extensions)$"
video_pattern="\.($video_extensions)$"

magick_path=$(command -v magick)
vips_thumb=$(command -v vipsthumbnail)
vips_header=$(command -v vipsheader)
if [[ -z "$magick_path" && ( -z "$vips_thumb" || -z "$vips_header" ) ]]; then
    log_photo error 'Photo thumbnails require ImageMagick or libvips.'
    exit 1
fi
heic_supported=0
if [[ -n "$magick_path" ]] && "$magick_path" -list format | awk '$1 ~ /^HEIC\*?$/ && $3 ~ /^r/ {supported=1} END {exit !supported}'; then
    heic_supported=1
else
    log_photo info 'ImageMagick cannot read HEIC; skipping HEIC and HEIF thumbnails.'
fi

multi_proc=1
low_priority=(nice -n 19)
if command -v ionice >/dev/null && ionice -c3 true 2>/dev/null; then
    low_priority+=(ionice -c3)
fi

source_mtime() {
    stat -c %Y -- "$1" 2>/dev/null || stat -f %m -- "$1"
}

make_photo_thumb() {
    local source="$1" target mtime converter dimensions width height side
    local jpeg_hint=()
    [[ ! -L "$source" && -f "$source" ]] || return 0
    mtime=$(source_mtime "$source") || return 1
    target="$output_dir/${source##*/}.$mtime.$thumb_size.webp"
    [[ -f "$target" && ! -L "$target" ]] && return 0
    [[ ! -e "$target" && ! -L "$target" ]] || return 1

    temp=$(mktemp -d "$output_dir/.photo-thumb.XXXXXXXX") || return 1
    trap 'rm -f -- "$temp/thumb.webp"; rmdir -- "$temp"' EXIT
    trap 'exit 1' HUP INT TERM

    if [[ -n "$vips_thumb" && -n "$vips_header" ]]; then
        width=$("$vips_header" -f width "$source")
        height=$("$vips_header" -f height "$source")
        if [[ "$width" =~ ^[0-9]+$ && "$height" =~ ^[0-9]+$ ]]; then
            side=$thumb_size
            (( width < side )) && side=$width
            (( height < side )) && side=$height
            "$vips_thumb" --size "${side}x${side}" --smartcrop centre \
                --path "$temp/thumb.webp[Q=70,strip]" "$source" || rm -f -- "$temp/thumb.webp"
        fi
    fi

    if [[ ! -s "$temp/thumb.webp" && -n "$magick_path" ]]; then
        # 入力形式を固定し、ファイル名をImageMagickの構文として解釈させないルン。
        converter=${source##*.}
        converter=${converter,,}
        case "$converter" in
            jpg|jpeg|jpe)
                converter=jpeg
                dimensions=$("$magick_path" identify -ping -format '%w %h' 'jpeg:-[0]' < "$source")
                read -r width height <<< "$dimensions"
                if [[ "$width" =~ ^[0-9]+$ && "$height" =~ ^[0-9]+$ ]] && (( width >= 512 && height >= 512 )); then
                    jpeg_hint=(-define jpeg:size=512x512)
                fi
                ;;
            tif|tiff) converter=tiff ;;
            heic|heif) converter=heic ;;
        esac
        "$magick_path" "${jpeg_hint[@]}" "$converter:-[0]" -auto-orient -gravity center \
            -crop '%[fx:min(w,h)]x%[fx:min(w,h)]+0+0' +repage -thumbnail "${thumb_size}x${thumb_size}>" \
            -strip -quality 70 "$temp/thumb.webp" < "$source" || return 1
    fi
    [[ -s "$temp/thumb.webp" ]] || return 1
    # 変換中に原本が差し替わったら、次回のバッチに任せるルン。
    [[ "$(source_mtime "$source")" == "$mtime" ]] || return 0
    chmod 0644 "$temp/thumb.webp" && mv -fT -- "$temp/thumb.webp" "$target"
}
export -f make_photo_thumb source_mtime log_photo
export vips_thumb vips_header magick_path thumb_size

process_directory() {
    local directory="$1" source name relative segment output_dir
    local file_count=0 video_count=0 image_count=0
    local images=()
    [[ "$(realpath -- "$directory")" == "$directory" && -r "$directory" && -x "$directory" ]] || return 1
    for source in "$directory"/*; do
        [[ -f "$source" ]] || continue
        (( ++file_count ))
        name=${source##*/}
        if [[ "${name,,}" =~ $image_pattern ]]; then
            (( ++image_count ))
            [[ -L "$source" ]] && continue
            if (( ! heic_supported )) && [[ "${name,,}" =~ \.(heic|heif)$ ]]; then continue; fi
            images+=("$source")
        elif [[ "${name,,}" =~ $video_pattern ]]; then
            (( ++video_count ))
        fi
    done
    (( image_count >= min_images && image_count * 100 >= (file_count - video_count) * min_percent )) || return 0
    (( ${#images[@]} )) || return 0

    output_dir="$thumb_root"
    if [[ "$directory" != "$share_path" ]]; then
        relative=${directory#"$share_path"/}
        while [[ -n "$relative" ]]; do
            segment=${relative%%/*}
            output_dir="$output_dir/$segment"
            [[ ! -L "$output_dir" ]] && mkdir -p -- "$output_dir" || return 1
            [[ "$relative" == */* ]] || break
            relative=${relative#*/}
        done
    fi
    export output_dir
    printf '%s\0' "${images[@]}" | "${low_priority[@]}" xargs -0 -n 1 -P "$multi_proc" bash -c '
        if ! make_photo_thumb "$1"; then
            log_photo error "Failed to generate photo thumbnail: $1"
            exit 1
        fi
    ' _
}

clean_thumbnail_directory() {
    local cache_dir="$1" source_dir="$share_path" relative segment entry name source current
    local generated_pattern='^(.+)\.(-?[0-9]+)\.[0-9]+\.webp$'
    [[ "$(realpath -- "$cache_dir")" == "$cache_dir" ]] || return 0
    if [[ "$cache_dir" != "$thumb_root" ]]; then
        relative=${cache_dir#"$thumb_root"/}
        # 共有側の親が読めないときやリンクの先は、削除判定に使わないルン。
        while [[ -n "$relative" ]]; do
            [[ ! -d "$source_dir" || ( -r "$source_dir" && -x "$source_dir" ) ]] || return 0
            segment=${relative%%/*}
            source_dir="$source_dir/$segment"
            [[ ! -L "$source_dir" ]] || return 0
            [[ "$relative" == */* ]] || break
            relative=${relative#*/}
        done
    fi
    [[ ! -d "$source_dir" || ( -r "$source_dir" && -x "$source_dir" ) ]] || return 0

    for entry in "$cache_dir"/*.webp; do
        [[ ! -L "$entry" && -f "$entry" && "${entry##*/}" =~ $generated_pattern ]] || continue
        name=${BASH_REMATCH[1]}
        if [[ ! "${name,,}" =~ $image_pattern ]]; then continue; fi
        source="$source_dir/$name"
        if [[ ! -L "$source" && ! -e "$source" ]]; then
            rm -f -- "$entry"
        elif [[ ! -L "$source" && -f "$source" ]]; then
            current="$cache_dir/$name.$(source_mtime "$source").$thumb_size.webp"
            if [[ "$entry" != "$current" && ! -L "$current" && -f "$current" ]]; then
                rm -f -- "$entry"
            fi
        fi
    done
    if [[ "$cache_dir" != "$thumb_root" && ! -e "$source_dir" ]]; then
        rmdir -- "$cache_dir" 2>/dev/null || true
    fi
}

status=0
for root in "${roots[@]}"; do
    # 配下の実ディレクトリだけを起点にするルン。
    if [[ -z "$root" || "$root" == /* || "/$root/" == */../* ]]; then
        log_photo error "Invalid photo directory: $root"
        status=1
        continue
    fi
    source_dir=$(realpath -- "$share_path/$root") || source_dir=''
    if [[ ! -d "$source_dir" || ( "$source_dir" != "$share_path" && "$source_dir" != "$share_path/"* ) ]]; then
        log_photo warning "Photo directory unavailable: $root"
        status=1
        continue
    fi
    if (( $# == 1 )); then
        process_directory "$source_dir" || status=1
        cache_dir="$thumb_root${source_dir#"$share_path"}"
        if [[ -d "$cache_dir" && "$(realpath -- "$cache_dir")" == "$cache_dir" ]]; then
            clean_thumbnail_directory "$cache_dir"
        fi
    else
        while IFS= read -r -d '' directory; do
            process_directory "$directory" || status=1
        done < <(find -P "$source_dir" \( -name '.*' ! -path "$source_dir" -prune \) -o -type d -print0)
    fi
done

if (( $# == 0 )); then
    while IFS= read -r -d '' cache_dir; do
        clean_thumbnail_directory "$cache_dir"
    done < <(find -P "$thumb_root" -depth -type d ! -name '.*' -print0)
fi
exit "$status"
