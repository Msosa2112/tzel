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

-- Tabla de Subastas Judiciales Extraídas de Cortes (KY/IN)
CREATE TABLE IF NOT EXISTS foreclosure_auctions (
    auction_id TEXT PRIMARY KEY, -- Formato: 'KY_JEFF_CASE_NUMBER' o 'IN_FLOYD_CASE_NUMBER'
    case_number TEXT NOT NULL,
    address TEXT NOT NULL,
    county TEXT NOT NULL,
    state TEXT NOT NULL,
    auction_date TEXT NOT NULL,
    plaintiff TEXT, -- Banco o acreedor que demanda
    defendant TEXT, -- Propietario deudor
    debt_amount REAL, -- Monto reclamado por el banco
    appraisal_value REAL, -- Avalúo del perito judicial
    mls_status TEXT DEFAULT 'pending_check', -- 'pending_check', 'not_found', 'Active', 'Expired', etc.
    mls_estimated_value REAL,
    mls_id TEXT,
    is_high_yield INTEGER DEFAULT 0, -- 1 si el precio de adquisición potencial es < 50% de mercado
    redemption_margin REAL, -- Cálculo de Kentucky: (mls_estimated_value * 0.66) - appraisal_value
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de Inventario de Land Bank (Louisville / New Albany)
CREATE TABLE IF NOT EXISTS landbank_inventory (
    parcel_id TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    asking_price REAL NOT NULL,
    estimated_value REAL,
    property_type TEXT, -- 'Structure' o 'Lot'
    program_name TEXT,
    county TEXT NOT NULL,
    state TEXT NOT NULL,
    is_high_yield INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
