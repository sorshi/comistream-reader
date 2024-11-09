#!/bin/bash
###############################################################################
# pushout_old_cover_dir.sh
#
# 説明:
#   coverとpreviewの消し込みを行います。
#   comistream/cron/cron_comistream_daily.sh から呼ばれます。
#   make_image_run.shを実行したユーザー(apacheやwww-dataなど)と同一のユーザーで実行してください。
#
# 使用方法:
#   ./nestedExtracter.sh <アーカイブファイル> [出力ディレクトリ]
#
#
# 作成者: Comistream Project
# バージョン: 1.0.0
# ライセンス: GPL3.0
# https://github.com/sorshi/comistream-reader
#
###############################################################################

# 設定
dbfile=$(realpath "$(dirname "$0")/../data/db/comistream.sqlite")
if [ ! -f "$dbfile" ]; then
    logger -t "comistream make_preview_run.sh[$$]" -p local1.error "$dbfile not found."
    exit 1
fi

# Apache公開ディレクトリのサーバ内フルパス
searchPath=$(sqlite3 "$dbfile" "SELECT value FROM system_config WHERE key='sharePath';")
webRoot=$(sqlite3 "$dbfile" "SELECT value FROM system_config WHERE key='webRoot';")
# searchPath="/home/user/public/nas"
comistream_tool_dir=$(sqlite3 "$dbfile" "SELECT value FROM system_config WHERE key='comistream_tool_dir';")
# comistream_tool_dir="/home/user/comistream"
# coverディレクトリ
coverDir="$comistream_tool_dir/data/theme/covers/"
# previewディレクトリ
previewDir="$comistream_tool_dir/data/theme/preview/"
# 処理部分を関数化
removeNonexistentOriginalDirs() {
  local coverDir="$1"

  # coverディレクトリ内の各ディレクトリに対して処理を行う
  find "$coverDir" -type d | while read dir; do
    # 元のディレクトリのパスを生成
    originalDir="${webRoot}/$(echo "$dir" | sed "s|$coverDir||")"

    # echo "ORG   :$originalDir"
    # echo "TARGET:$dir"

    # 元のディレクトリが存在しなければ削除
    if [ ! -d "$originalDir" ]; then
      rm -rf "$dir"
      # echo "rm -rf $dir"
      logger -t "comistream pushout_old_cover_dir.sh[$$]" -p local1.debug "delete $dir "
    fi
  done
}


# 関数を呼び出す
removeNonexistentOriginalDirs "$coverDir"
removeNonexistentOriginalDirs "$previewDir"
