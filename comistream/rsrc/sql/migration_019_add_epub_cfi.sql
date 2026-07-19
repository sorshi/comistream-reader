-- ============================================================================
-- Migration 019: EPUB CFI保存カラム追加（SQLite）
-- ============================================================================
-- foliate-js統合で段落単位の復帰を行うため、book_historyにepub_cfiを追加するルン。

ALTER TABLE book_history ADD COLUMN epub_cfi TEXT DEFAULT NULL;

INSERT OR REPLACE INTO system_config (key, value) VALUES('db_migration_version', '019');
