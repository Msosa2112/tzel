-- SQL schema for osint_opportunities in Turso (libSQL)

CREATE TABLE IF NOT EXISTS osint_opportunities (
    mls_id TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    zip_code TEXT,
    current_price REAL NOT NULL,
    original_price REAL NOT NULL,
    days_on_market INTEGER NOT NULL,
    panic_drop INTEGER DEFAULT 0, -- 1 for true, 0 for false
    keywords TEXT NOT NULL, -- JSON array of matched keywords: '["as-is", "tlc"]'
    profile_type TEXT NOT NULL, -- 'Expired', 'Canceled', 'Withdrawn', 'Active-Stale'
    county TEXT,
    state TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
