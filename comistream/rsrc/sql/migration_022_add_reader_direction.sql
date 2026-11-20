-- 読書位置と同じ行に、別の更新番号で綴じ方向を保存するルン。
BEGIN IMMEDIATE;
ALTER TABLE reader_progress ADD COLUMN opening_direction TEXT CHECK (opening_direction IN ('left','right'));
ALTER TABLE reader_progress ADD COLUMN direction_revision INTEGER NOT NULL DEFAULT 0 CHECK (direction_revision >= 0);
ALTER TABLE reader_progress ADD COLUMN last_direction_operation_id TEXT;
INSERT OR REPLACE INTO system_config (key, value) VALUES ('db_migration_version', '022');
COMMIT;
