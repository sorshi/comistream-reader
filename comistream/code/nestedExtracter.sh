#!/bin/bash
###############################################################################
# nestedExtracter.sh
#
# 説明:
#   入れ子になったアーカイブファイルを再帰的に展開し、
#   画像ファイルに連番のシンボリックリンクを作成します。
#   また、ディレクトリ構造に基づいてブックマークJSONファイルも生成します。
#
# 使用方法:
#   ./nestedExtracter.sh <アーカイブファイル> [出力ディレクトリ]
#
# 引数:
#   アーカイブファイル - 展開する入れ子アーカイブファイルのパス（必須）
#   出力ディレクトリ   - 展開先のディレクトリパス（省略時はカレントディレクトリ）
#
# 出力ファイル:
#   - 連番付きシンボリックリンク（0001.jpg, 0002.jpg, ...）
#   - index - シンボリックリンクの一覧ファイル
#   - IndexBookmark.json - ディレクトリ構造に基づくブックマークファイル
#   - DONE - 処理完了を示すフラグファイル
#
# 依存関係:
#   - 7zz (7-Zip)
#
# 作成者: Comistream Project
# バージョン: 1.0.0
# ライセンス: GPL3.0
# https://github.com/sorshi/comistream-reader
#
###############################################################################

# logger -t "comistream nestedExtractor.sh[$$]" -p local1.debug "mv $subdir -> $new_name"

# 関数: アーカイブを再帰的に展開する
extract_recursive() {
    local dir="$1"
    local found=0
    local extracted_files=()
    local all_extracted_files=()

    # ディレクトリ内のすべてのファイルをチェック
    while IFS= read -r -d '' file; do
        if [[ -f "$file" ]]; then
            # ファイルがアーカイブかどうかを確認
            if 7zz l "$file" >/dev/null 2>&1; then
                echo "展開中: $file"
                # サブディレクトリを作成
                subdir="${file%.*}_ex"
                mkdir -p "$subdir"
                # アーカイブを展開
                7zz x "$file" -o"$subdir" -y
                # 展開されたディレクトリに対して再帰的に関数を呼び出す
                extract_recursive "$subdir"
                # 展開されたアーカイブのパスを配列に追加
                extracted_files+=("$file")
                found=1
            fi
        fi
    done < <(find "$dir" -type f -print0)

    # 展開されたアーカイブを削除
    for file in "${extracted_files[@]}"; do
        # echo "中間アーカイブを削除: $file"
        logger -t "comistream nestedExtractor.sh[$$]" -p local1.debug "Delete intermediate file: $file"
        rm "$file"
    done

    # 展開されたファイルを追跡
    all_extracted_files+=("${extracted_files[@]}")

    # アーカイブが見つからなかった場合、親ディレクトリの内容を出力ディレクトリに移動
    if [[ $found -eq 0 && "$dir" != "$output_dir" && "$dir" != "$initial_extract_dir" ]]; then
        subdir="${dir}_cn"
        mkdir -p "$subdir"
        mv "$dir"/* "$subdir" 2>/dev/null
        rmdir "$dir" 2>/dev/null
    fi
}

# 使用方法を表示する関数
show_usage() {
    echo "使用方法: $0 <アーカイブファイル> [出力ディレクトリ]"
    echo "  <アーカイブファイル>: 展開するアーカイブファイルのパス"
    echo "  [出力ディレクトリ]: オプション。展開先のディレクトリ。指定しない場合はカレントディレクトリに展開します。"
    exit 1
}

# メイン処理
if [[ $# -lt 1 || $# -gt 2 ]]; then
    show_usage
fi

initial_archive="$1"
output_dir="${2:-.}" # 出力ディレクトリが指定されていない場合はカレントディレクトリを使用

# 出力ディレクトリが存在しない場合は作成
mkdir -p "$output_dir"

# 絶対パスに変換
output_dir=$(realpath "$output_dir")
initial_archive=$(realpath "$initial_archive")

# ディレクトリ名をソートしやすい形式に変更
rename_directories() {
    local dir="$1"
    find "$dir" -mindepth 1 -maxdepth 1 -type d | while IFS= read -r subdir; do
        base_name=$(basename "$subdir")
        if [[ "$base_name" =~ ([^0-9]*)([0-9]+)(.*) ]]; then
            new_name=$(printf "%03d-%s" "${BASH_REMATCH[2]}" "${BASH_REMATCH[1]}${BASH_REMATCH[3]}")
            mv "$subdir" "$(dirname "$subdir")/$new_name"
            logger -t "comistream nestedExtractor.sh[$$]" -p local1.debug "mv $subdir -> $new_name"
        fi
    done
}

# 初期展開用の一時ディレクトリ
initial_extract_dir=$(mktemp -d)

# 最初のアーカイブを一時ディレクトリに展開
7zz x "$initial_archive" -o"$initial_extract_dir" -y

# 再帰的に展開
extract_recursive "$initial_extract_dir"

# 最終的なディレクトリ名を変更
rename_directories "$output_dir"

# 一時ディレクトリの内容を出力ディレクトリに移動
find "$initial_extract_dir" -mindepth 1 -maxdepth 1 -type d -exec mv {} "$output_dir" \;
rmdir "$initial_extract_dir"

# 画像ファイルに対して連番のシンボリックリンクを作成
logger -t "comistream nestedExtractor.sh[$$]" -p local1.debug "Make symbolic links."
count=1
index_file="$output_dir/index"
bookmark_file="$output_dir/IndexBookmark.json"
: >"$index_file"           # indexファイルを空にする
echo "[" >"$bookmark_file" # JSONファイルを初期化

current_dir=""
first_entry=true

find "$output_dir" -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.webp" -o -iname "*.avif" \) | sort -V | while IFS= read -r file; do
    link_name=$(printf "%s/%04d.jpg" "$output_dir" "$count")
    parent_dir=$(dirname "$file")

    if [[ "$parent_dir" != "$current_dir" ]]; then
        if [[ "$first_entry" == true ]]; then
            first_entry=false
        else
            echo "," >>"$bookmark_file"
        fi
        current_dir="$parent_dir"
        dir_name=$(basename "$parent_dir")
        echo "  {" >>"$bookmark_file"
        echo "    \"page\": $((count))," >>"$bookmark_file"
        echo "    \"title\": \"$dir_name\"" >>"$bookmark_file"
        echo "  }" >>"$bookmark_file"
    fi

    if [[ ! -e "$link_name" ]]; then
        ln -s "$file" "$link_name"
        echo "$link_name" >>"$index_file"
        count=$((count + 1))
    fi
done

echo "]" >>"$bookmark_file" # JSONファイルを閉じる

# 残った中間アーカイブを削除
# echo "中間アーカイブを削除中..."
logger -t "comistream nestedExtractor.sh[$$]" -p local1.debug "Clean up."
find "$output_dir" -type f \( -iname "*.rar" -o -iname "*.cbr" -o -iname "*.zip" -o -iname "*.cbz" -o -iname "*.7z" -o -iname "*.cb7" -o -iname "*.tar" -o -iname "*.gz" \) -delete

# 完了ファイル作成
touch "$output_dir/DONE"
logger -t "comistream nestedExtractor.sh[$$]" -p local1.debug "All done."
# echo "すべてのアーカイブの展開が完了しました。"
