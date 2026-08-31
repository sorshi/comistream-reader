#!/bin/bash
###############################################################################
# make_folder_image_run.sh
#
# 説明:
#   日次バッチから起動してディレクトリのカスタムアイコンを/covers/配下に作成します。
#   ディレクトリアイコンは/covers/下の該当ディレクトリのindex.webpとなります。
#
# 使用方法:
#   ./make_folder_image_run.sh
#
# オプション:
#   なし
#
#
# 作成者: Comistream Project
# バージョン: 1.0.1
# ライセンス: プロジェクト独自部分はAGPL-3.0-only（リポジトリルートのLICENSING.md参照）
# https://github.com/sorshi/comistream-reader
#
###############################################################################

# 作成コマンド
# magick convert \
#     -size 560x656 xc:white \
#     \( kusuriya_no_hitorigoto_3.jpg -resize x240 -alpha set -background none -rotate -8 \) -geometry +130+200 -composite \
#     \( kusuriya_no_hitorigoto_2.jpg -resize x250 -alpha set -background none -rotate -2 \) -geometry +170+120 -composite \
#     \( kusuriya_no_hitorigoto_1.jpg -resize x260 -alpha set -background none -rotate 10 \) -geometry +220+30 -composite \
#     \( largefolderx2.webp -alpha set -channel A -evaluate Multiply 0.75 \) -gravity center -composite \
#     -quality 75 combined_folder_icon.webp

# 起動
logger -t "comistream make_folder_image_run.sh[$$]" -p local1.info "make_folder_image_run start."

# 設定値
dbfile=$(realpath "$(dirname "$0")/../data/db/comistream.sqlite")
if [ ! -f "$dbfile" ]; then
  logger -t "comistream make_folder_icon_run.sh[$$]" -p local1.error "$dbfile not found."
  exit 1
fi

export webRoot=$(sqlite3 "$dbfile" "SELECT value FROM system_config WHERE key='webRoot';")
export searchPath=$(sqlite3 "$dbfile" "SELECT value FROM system_config WHERE key='sharePath';")
# export searchPath="/home/user/public/nas"
export comistream_tool_dir=$(sqlite3 "$dbfile" "SELECT value FROM system_config WHERE key='comistream_tool_dir';")
# export comistream_tool_dir="/home/user/comistream"
export publicDir=$(sqlite3 "$dbfile" "SELECT value FROM system_config WHERE key='publicDir';")
# export publicDir="/nas";
# export comistream_tmp_dir_root=$(sqlite3 "$dbfile" "SELECT value FROM system_config WHERE key='comistream_tmp_dir_root';") # 使わないのでコメントアウト

# 表紙画像用のディレクトリ
cover_subDir=$(sqlite3 "$dbfile" "SELECT value FROM system_config WHERE key='cover_subDir';")

# ベースとなるフォルダアイコンの画像
base_folder_icon=$(realpath "$(dirname "$0")/../theme/icons/largefolderx2.webp")
if [ ! -f "$base_folder_icon" ]; then
  logger -t "comistream make_folder_image_run.sh[$$]" -p local1.error "Base folder icon $base_folder_icon not found."
  exit 1
fi
export base_folder_icon

# 処理多重度
multiProc=1
# エラーログ
errorLog="/dev/null" # 必要ならパス変更

function make_folder_icon() {
  set +H
  local targetDirRelPath="$1" # searchPathからの相対パス (例: "MyComic/SeriesA")
  local targetDirAbsPath="$searchPath/$targetDirRelPath"
  local outputDir="$comistream_tool_dir/data/theme/covers$publicDir/$targetDirRelPath"
  local output_icon_path="${outputDir}index.webp"

  # 多すぎるのでコメントアウト
  # logger -t "comistream make_folder_image_run.sh[$$]" -p local1.debug "Processing targetDirAbsPath: $targetDirAbsPath outputDir: $outputDir output_icon_path: $output_icon_path"

  # 出力ファイルが存在するか0バイトの場合以外はスキップ
  if [ -s "$output_icon_path" ]; then
    # 多すぎるのでコメントアウト
    # logger -t "comistream make_folder_image_run.sh[$$]" -p local1.debug "Icon already exists, skipping: $output_icon_path"
    return
  fi

  # 表紙画像を検索 (ファイル名昇順で最大3つ)
  # jpg, jpeg, png, webp を対象 (大文字小文字区別なし)
  local cover_images=()
  # find を使って検索し、ヌル文字区切りで処理後、sort -z でソートし、head -z -n 3 で3つ取得
  while IFS= read -r -d $'\0' file; do
      cover_images+=("$file")
  done < <(find "$outputDir" -maxdepth 1 -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.webp" \) -print0 | sort -z | head -z -n 3)

  if [ ${#cover_images[@]} -eq 0 ]; then
    # logger -t "comistream make_folder_image_run.sh[$$]" -p local1.debug "No cover images found in $targetDirAbsPath, skipping folder icon creation."
    return
  fi
  logger -t "comistream make_folder_image_run.sh[$$]" -p local1.debug "Cover files found: ${cover_images[@]}"


  # ImageMagickコマンドの構築
  # 新しいコマンド配列
  local magick_args=("convert" "-size" "560x656" "xc:white")
  local cover_options_for_magick_array=() # 表紙画像用のオプションを一時的に格納する配列

  # 表紙画像を検索 (ファイル名昇順で最大3つ)
  # jpg, jpeg, png, webp を対象 (大文字小文字区別なし)
  # 3巻目 (一番奥になる画像)
  if [ ${#cover_images[@]} -ge 3 ]; then
    cover_options_for_magick_array+=('(' "${cover_images[2]}" -resize x240 -alpha set -background none -rotate -8 ')' -geometry +130+200 -composite)
  fi
  # 2巻目 (中間になる画像)
  # 画像が1枚の時は、その1枚を中間(2枚目の位置)に表示する
  if [ ${#cover_images[@]} -eq 1 ]; then
    cover_options_for_magick_array+=('(' "${cover_images[0]}" -resize x250 -alpha set -background none -rotate -2 ')' -geometry +170+120 -composite)
  elif [ ${#cover_images[@]} -ge 2 ]; then # 画像が2枚以上の場合は、2枚目を中間位置に
    cover_options_for_magick_array+=('(' "${cover_images[1]}" -resize x250 -alpha set -background none -rotate -2 ')' -geometry +170+120 -composite)
  fi
  # 1巻目 (一番手前になる画像)
  # 画像が2枚以上の時だけ、1枚目を手前(1枚目の位置)に表示する
  if [ ${#cover_images[@]} -ge 2 ]; then
    cover_options_for_magick_array+=('(' "${cover_images[0]}" -resize x260 -alpha set -background none -rotate 10 ')' -geometry +220+30 -composite)
  fi

  # cover_options_for_magick_array を magick_args に追加
  if [ ${#cover_options_for_magick_array[@]} -gt 0 ]; then
    magick_args+=("${cover_options_for_magick_array[@]}")
  fi

  # ベースフォルダアイコンのオプションと出力パス
  magick_args+=('(' "$base_folder_icon" -alpha set -channel A -evaluate Multiply 0.75 ')' -gravity center -composite -quality 75 "$output_icon_path")


  mkdir -p "$outputDir"
  # echo "Executing: magick ${magick_args[@]}" # デバッグ用: 必要に応じてコメント解除

  # 開始時間を記録
  start_time=$(date +%s.%N)

  logger --size 4096 -t "comistream make_folder_image_run.sh[$$]" -p local1.debug "Creating icon for $targetDirRelPath with ${#cover_images[@]} cover(s); executing: magick ${magick_args[*]}"
  magick "${magick_args[@]}"

  if [ ! -s "$output_icon_path" ]; then
    logger -t "comistream make_folder_image_run.sh[$$]" -p local1.NOTICE "Folder icon output NG: $output_icon_path (Source: $targetDirRelPath)"
    rm -f "$output_icon_path" # 失敗した場合は削除
  else
    end_time=$(date +%s.%N)
    duration=$(echo "$end_time - $start_time" | bc)
    duration=$(printf "%.1f" "$duration")
    logger -t "comistream make_folder_image_run.sh[$$]" -p local1.INFO "Folder icon output OK: $targetDirRelPath (processing time: ${duration}sec)"
  fi

  set -H
}
export -f make_folder_icon

# メイン処理
cd "$searchPath" || { logger -t "comistream make_folder_image_run.sh[$$]" -p local1.error "Failed to cd to $searchPath"; exit 1; }

# cover_subDir が空または "." の場合はカレントディレクトリ直下を検索
# そうでない場合は cover_subDir 配下を検索
search_target_dir="$cover_subDir"
if [ -z "$search_target_dir" ] || [ "$search_target_dir" == "." ]; then
    search_target_dir="." # カレントディレクトリ
    # fd / find の挙動を考慮して、深さを1に限定
    find_depth_option="-maxdepth 1"
    fd_depth_option="--max-depth 1"
else
    # cover_subDir が指定されている場合は、その中を掘っていく
    # 例: cover_subDir="Comics" なら Comics/SeriesA, Comics/SeriesB を対象とする
    find_depth_option="" # 深さ制限なし (findは元々再帰的なので)
    fd_depth_option=""   # fdもデフォルトで再帰的
fi


# fdコマンドが利用可能かチェック
cd "$searchPath"
if command -v fd >/dev/null 2>&1; then
  logger -t "comistream make_folder_image_run.sh[$$]" -p local1.debug "Using fd command for faster directory searching in '$search_target_dir'"
  # fdでディレクトリのみを検索 (-t d) し、結果をヌル文字区切りでxargsに渡す
  # fd のパスの先頭に "./" がつく場合があるので sed で取り除く
  fd --type d ${fd_depth_option} -0 . $search_target_dir | \
    sed -z 's|^\./||' | \
    xargs -0 -I{} -P ${multiProc} bash -c 'make_folder_icon "{}" 2>>'"$errorLog"
else
  logger -t "comistream make_folder_image_run.sh[$$]" -p local1.error "Require fd command. '$search_target_dir'"
  # テストしてないのでfindは非対応
  # # findでディレクトリのみを検索 (-type d) し、結果をヌル文字区切りでxargsに渡す
  # # find は指定したパス自身も返すことがあるので、-mindepth 1 を追加して避ける (search_target_dir が . の場合を除く)
  # # また、パスの先頭に "./" がつく場合があるので sed で取り除く
  # find_mindepth_option="-mindepth 1"
  # if [ "$search_target_dir" == "." ]; then
  #     find_mindepth_option="" # カレント直下はmindepth不要
  # fi

  # find "$search_target_dir" ${find_depth_option} ${find_mindepth_option} -type d -not -path '*/\.*' -print0 | \
  #   sed -z 's|^\./||' | \
  #   xargs -0 -I{} -P ${multiProc} bash -c 'make_folder_icon "{}" 2>>'"$errorLog"
fi

logger -t "comistream make_folder_image_run.sh[$$]" -p local1.info "Folder icon generation process finished."
