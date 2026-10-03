-- 読書位置と操作順を共有するテーブルを追加するルン。
CREATE TABLE IF NOT EXISTS reader_progress (
        history_id INTEGER PRIMARY KEY,
        state_id TEXT NOT NULL,
        format TEXT NOT NULL CHECK (format IN ('archive','pdf','epub')),
        locator TEXT,
        total_units INTEGER CHECK (total_units IS NULL OR total_units > 0),
        revision INTEGER NOT NULL DEFAULT 0,
        policy_epoch INTEGER NOT NULL DEFAULT 0,
        position_updated_at TEXT,
        last_writer_id TEXT,
        last_writer_seq INTEGER NOT NULL DEFAULT 0,
        writer_base_revision INTEGER NOT NULL DEFAULT 0,
        last_operation_hash TEXT,
        FOREIGN KEY (history_id) REFERENCES book_history(id) ON DELETE CASCADE
);

CREATE TRIGGER IF NOT EXISTS delete_reader_progress AFTER DELETE ON book_history
BEGIN DELETE FROM reader_progress WHERE history_id = OLD.id; END;

INSERT OR REPLACE INTO system_config (key, value) VALUES ('db_migration_version', '021');
