PRAGMA encoding = 'UTF-8';

CREATE TABLE book_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, -- 履歴ID：一意の識別子
    user TEXT NOT NULL, -- ユーザー名：閲覧したユーザー
    request_uri TEXT, -- リクエストURI：アクセスされたURI
    path_hash TEXT, -- パスハッシュ：ファイルパスのハッシュ値
    relative_path TEXT, -- 相対パス：ファイルの相対パス
    base_file TEXT NOT NULL, -- 元ファイル：元のファイル名
    base_file_hash TEXT, -- 元ファイルハッシュ：元のファイルのハッシュ値
    current_page INTEGER DEFAULT 0, -- 現在ページ：最後に閲覧したページ番号
    max_page INTEGER DEFAULT 0, -- 最大ページ数：書籍の総ページ数
    favorite INTEGER DEFAULT 0, -- お気に入り：お気に入りフラグ（0:非お気に入り、1:お気に入り）
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- 作成日時：レコード作成日時
    updated_at DATETIME, -- 更新日時：レコード更新日時
    has_read INTEGER DEFAULT 0, -- 読了フラグ：読了状態（0:未読、1:既読）
    UNIQUE(user, base_file)
);
CREATE INDEX idx_book_history_base_file ON book_history(base_file);
CREATE TRIGGER update_book_history_updated_at
AFTER
UPDATE ON book_history BEGIN
UPDATE book_history
SET updated_at = CURRENT_TIMESTAMP
WHERE rowid = NEW.rowid;
END;

CREATE TABLE IF NOT EXISTS book_id_relation (
    id INTEGER PRIMARY KEY AUTOINCREMENT, -- 関連ID：一意の識別子
    base_file_hash TEXT NOT NULL, -- 元ファイルハッシュ：元のファイルのハッシュ値
    book_code_type INTEGER DEFAULT 1, -- 書籍コード種別：書籍コードの種類（1:ISBN、2:その他など）
    book_code TEXT NOT NULL, -- 書籍コード：書籍の識別コード（ISBNなど）
    filename TEXT, -- ファイル名：関連するファイル名
    UNIQUE(base_file_hash, book_code)
);
CREATE INDEX idx_base_file_hash ON book_id_relation(base_file_hash);
CREATE INDEX idx_filename ON book_id_relation(filename);

CREATE TABLE IF NOT EXISTS isbn_master (
    isbn TEXT PRIMARY KEY, -- ISBN：国際標準図書番号
    title TEXT, -- タイトル：書籍のタイトル
    volume TEXT, -- 巻数：書籍の巻数
    author TEXT, -- 著者：書籍の著者
    creator TEXT, -- 作成者：その他の関係者
    seriesTitle TEXT, -- シリーズタイトル：書籍のシリーズ名
    dc_title TEXT, -- DCタイトル：タイトル
    publisher TEXT, -- 出版社：書籍の出版社
    pub_year INTEGER, -- 出版年：書籍の出版年
    pub_month INTEGER, -- 出版月：書籍の出版月
    dcterms_issued TEXT, -- DC発行日：発行日
    dcndl_titleTranscription TEXT, -- タイトル読み：タイトルの読み方
    ndc TEXT, -- NDC：日本十進分類法
    ndl_link TEXT, -- NDLリンク：国立国会図書館へのリンク
    data_source INTEGER DEFAULT 1, -- データソース：情報の入手元（1:自動取得、2:手動入力など）
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, -- 作成日時：レコード作成日時
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP -- 更新日時：レコード更新日時
);

CREATE TABLE IF NOT EXISTS files(
    fullpath TEXT PRIMARY KEY, -- フルパス：ファイルの完全パス
    dirname TEXT, -- ディレクトリ名：ファイルが存在するディレクトリ名
    filename TEXT -- ファイル名：ファイルの名前
);
CREATE INDEX IF NOT EXISTS idx_filename ON files (filename);
CREATE INDEX IF NOT EXISTS idx_base_file_hash ON files (base_file_hash);

CREATE TRIGGER update_isbn_master_updated_at
AFTER
UPDATE ON isbn_master BEGIN
UPDATE isbn_master
SET updated_at = CURRENT_TIMESTAMP
WHERE rowid = NEW.rowid;
END;


CREATE TABLE IF NOT EXISTS system_config (
    key TEXT PRIMARY KEY NOT NULL UNIQUE, -- 設定キー：システム設定の識別子
    value TEXT -- 設定値：システム設定の値
);
INSERT OR REPLACE INTO system_config (key, value) VALUES('webRoot', '/home/user/public');
INSERT OR REPLACE INTO system_config (key, value) VALUES('publicDir', '/nas');
INSERT OR REPLACE INTO system_config (key, value) VALUES('sharePath', '/home/user/public/nas');
INSERT OR REPLACE INTO system_config (key, value) VALUES('md5cmd', 'md5sum');
INSERT OR REPLACE INTO system_config (key, value) VALUES('comistream_tool_dir', '/home/user/comistream');
INSERT OR REPLACE INTO system_config (key, value) VALUES('convert', '/usr/local/bin/magick ');
INSERT OR REPLACE INTO system_config (key, value) VALUES('montage', '/usr/local/bin/magick montage');
INSERT OR REPLACE INTO system_config (key, value) VALUES('unzip', 'unzip');
INSERT OR REPLACE INTO system_config (key, value) VALUES('unrar', 'unrar');
INSERT OR REPLACE INTO system_config (key, value) VALUES('cpdf', 'cpdf');
INSERT OR REPLACE INTO system_config (key, value) VALUES('p7zip', '7zz');
INSERT OR REPLACE INTO system_config (key, value) VALUES('ffmpeg', 'ffmpeg');
INSERT OR REPLACE INTO system_config (key, value) VALUES('pdftoppm', '/usr/bin/pdftoppm');
INSERT OR REPLACE INTO system_config (key, value) VALUES('pdfinfo', '/usr/bin/pdfinfo');
-- INSERT OR REPLACE  INTO system_config VALUES('book_search_url', '/book-search.php?book=1&search=');
INSERT OR REPLACE INTO system_config (key, value) VALUES('book_search_url', '');
INSERT OR REPLACE INTO system_config (key, value) VALUES('cacheSize', 3000);
INSERT OR REPLACE INTO system_config (key, value) VALUES('pushoutCacheLimitSize', 3000);
INSERT OR REPLACE INTO system_config (key, value) VALUES('pushoutCacheLimitDays', 30);
INSERT OR REPLACE INTO system_config (key, value) VALUES('isPageSave', 0);
INSERT OR REPLACE INTO system_config (key, value) VALUES('isPreCache', 0);
INSERT OR REPLACE INTO system_config (key, value) VALUES('async', '&');
INSERT OR REPLACE INTO system_config (key, value) VALUES('width', 800);
INSERT OR REPLACE INTO system_config (key, value) VALUES('quality', 75);
INSERT OR REPLACE INTO system_config (key, value) VALUES('fullsize_png_compress', 0);
INSERT OR REPLACE INTO system_config (key, value) VALUES('comistream_tmp_dir_root', '/dev/shm/comistream_temp');
INSERT OR REPLACE INTO system_config (key, value) VALUES('global_resize', 'x400');
INSERT OR REPLACE INTO system_config (key, value) VALUES('usm', '-unsharp 12x6+0.5+0');
INSERT OR REPLACE INTO system_config (key, value) VALUES('global_preload_pages', 3);
INSERT OR REPLACE INTO system_config (key, value) VALUES('global_preload_delay_ms', 1500);
INSERT OR REPLACE INTO system_config (key, value) VALUES('cover_subDir','Book Comic Mook');
INSERT OR REPLACE INTO system_config (key, value) VALUES('liveStreamMode', 0);
-- INSERT OR REPLACE INTO system_config (key, value) VALUES('bibiPath','/bibi/');
INSERT OR REPLACE INTO system_config (key, value) VALUES('bibiPath','');

INSERT OR REPLACE INTO system_config (key, value) VALUES('siteName', 'comistream');
INSERT OR REPLACE INTO system_config (key, value) VALUES('mainThemeColor', '#7799dd');

INSERT OR REPLACE INTO system_config (key, value) VALUES('isDebugMode', 0);
INSERT OR REPLACE INTO system_config (key, value) VALUES('isLowMemoryMode', 1);

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, -- ユーザーID：一意の識別子
    name TEXT NOT NULL, -- ユーザー名：ログイン用のユーザー名
    password TEXT NOT NULL, -- パスワード：ユーザーの認証用パスワード
    is_admin INTEGER DEFAULT 0, -- 管理者フラグ：管理者権限の有無（0:一般ユーザー、1:管理者）
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, -- 作成日時：ユーザーアカウント作成日時
    updated_at DATETIME -- 更新日時：ユーザー情報更新日時
);
CREATE INDEX idx_users ON users(name);
CREATE TRIGGER update_users_updated_at
AFTER
UPDATE ON users BEGIN
UPDATE users
SET updated_at = CURRENT_TIMESTAMP
WHERE rowid = NEW.rowid;
END;
