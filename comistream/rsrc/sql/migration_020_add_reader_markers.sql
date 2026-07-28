-- ============================================================================
-- Migration 020: 読者しおりテーブル追加（SQLite）
-- ============================================================================

CREATE TABLE IF NOT EXISTS reader_markers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT NOT NULL,
    base_file TEXT NOT NULL,
    base_file_hash TEXT,
    format TEXT NOT NULL
        CHECK (format IN ('archive', 'pdf', 'epub')),
    locator_type TEXT NOT NULL
        CHECK (locator_type IN ('page', 'epub_cfi')),
    locator TEXT NOT NULL,
    locator_hash TEXT NOT NULL,
    page_number INTEGER,
    section_index INTEGER,
    progress_fraction REAL,
    chapter_label TEXT,
    custom_label TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (page_number IS NULL OR page_number >= 1),
    CHECK (section_index IS NULL OR section_index >= 0),
    CHECK (
        progress_fraction IS NULL
        OR (progress_fraction >= 0.0 AND progress_fraction <= 1.0)
    ),
    CHECK (
        (format IN ('archive', 'pdf') AND locator_type = 'page' AND page_number IS NOT NULL)
        OR (format = 'epub' AND locator_type = 'epub_cfi')
    ),
    UNIQUE (user, base_file, locator_hash)
);

CREATE INDEX IF NOT EXISTS idx_reader_markers_book_order
ON reader_markers (user, base_file, progress_fraction, page_number, created_at);

INSERT OR REPLACE INTO system_config (key, value) VALUES('db_migration_version', '020');
