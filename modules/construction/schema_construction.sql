-- =========================================================================
-- ESQUEMA SQL PARA MÓDULO DE CONSTRUCCIÓN & LICITACIONES (TURSO / libSQL)
-- =========================================================================

-- 1. Tabla de Licitaciones y Concursos de Obras Públicas (KY / IN / Federal)
CREATE TABLE IF NOT EXISTS construction_bids (
    bid_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    agency TEXT NOT NULL,
    jurisdiction TEXT NOT NULL, -- 'Louisville_Metro_KY', 'State_Of_Kentucky', 'State_Of_Indiana', 'Clark_Floyd_IN', 'Federal_KY_IN'
    category TEXT NOT NULL, -- 'NEW_CONSTRUCTION_GROUND_UP', 'CIVIL_INFRASTRUCTURE_PUBLIC', 'ROOFING_SIDING_GUTTERS', etc.
    estimated_budget REAL DEFAULT 0,
    bid_deadline TEXT,
    pre_bid_date TEXT,
    is_mandatory_pre_bid INTEGER DEFAULT 0,
    bonding_required INTEGER DEFAULT 0,
    solicitation_url TEXT NOT NULL,
    documents_url TEXT,
    contact_name TEXT,
    contact_email TEXT,
    contact_phone TEXT,
    description TEXT,
    naics_code TEXT,
    telegram_sent INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_construction_bids_deadline ON construction_bids(bid_deadline);
CREATE INDEX IF NOT EXISTS idx_construction_bids_category ON construction_bids(category);
CREATE INDEX IF NOT EXISTS idx_construction_bids_telegram ON construction_bids(telegram_sent);


-- 2. Tabla de Leads de Construcción y Reformas para Propietarios Particulares
CREATE TABLE IF NOT EXISTS construction_leads (
    lead_id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    trigger_event TEXT NOT NULL, -- 'ZONING_VARIANCE_BOZA', 'DEMOLITION_PRE_BUILD', 'MSD_BASEMENT_FLOOD', 'HISTORIC_LANDMARK_APPROVAL', etc.
    address TEXT NOT NULL,
    county TEXT NOT NULL,
    state TEXT NOT NULL,
    zip_code TEXT,
    owner_name TEXT,
    owner_phones TEXT, -- JSON array o texto separado por comas
    owner_emails TEXT, -- JSON array o texto separado por comas
    property_type TEXT,
    estimated_project_value REAL DEFAULT 0,
    trigger_date TEXT,
    urgency_level TEXT DEFAULT 'NORMAL', -- 'NORMAL', 'HIGH', 'CRITICAL'
    source_portal TEXT,
    raw_details TEXT,
    permit_number TEXT,
    insurance_payer_likely INTEGER DEFAULT 0,
    telegram_sent INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_construction_leads_address ON construction_leads(address);
CREATE INDEX IF NOT EXISTS idx_construction_leads_category ON construction_leads(category);
CREATE INDEX IF NOT EXISTS idx_construction_leads_trigger ON construction_leads(trigger_event);
CREATE INDEX IF NOT EXISTS idx_construction_leads_telegram ON construction_leads(telegram_sent);
