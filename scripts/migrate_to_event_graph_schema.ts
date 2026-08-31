import { db } from '../db';
import { cleanLegalOwnerName } from './test_clean_names';

const NOISE_WORDS = new Set([
  "st", "street", "ave", "avenue", "rd", "road", "ln", "lane", "dr", "drive", 
  "ct", "court", "blvd", "boulevard", "way", "pl", "place", "hwy", "highway", 
  "rte", "route", "cir", "circle", "ter", "terrace", "trl", "trail", "pkwy", "parkway",
  "apt", "apartment", "unit", "ste", "suite", "fl", "floor", 
  "n", "north", "s", "south", "e", "east", "w", "west", 
  "ky", "in", "jefferson", "clark", "floyd"
]);

const UNIT_INDICATORS = ["apt", "unit", "ste", "suite", "#", "apartment"];

function parseAddress(address: string): { houseNumber: string | null; coreWords: string[] } {
  let part1 = address.split(",")[0].trim().toLowerCase();
  
  for (const indicator of UNIT_INDICATORS) {
    const idx = part1.indexOf(indicator);
    if (idx !== -1) {
      part1 = part1.substring(0, idx).trim();
    }
  }
  
  part1 = part1.replace(/[^a-z0-9\s]/g, " ");
  
  const words = part1.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) {
    return { houseNumber: null, coreWords: [] };
  }
  
  let houseNumber: string | null = null;
  let streetStartIndex = 0;
  
  if (/^\d+/.test(words[0])) {
    houseNumber = words[0];
    streetStartIndex = 1;
  }
  
  const coreWords: string[] = [];
  for (let i = streetStartIndex; i < words.length; i++) {
    const w = words[i];
    if (NOISE_WORDS.has(w)) continue;
    if (/^\d{5}$/.test(w)) continue;
    coreWords.push(w);
  }
  
  return { houseNumber, coreWords };
}

function getUnitInfo(address: string): string {
  const cleanAddress = address.toLowerCase();
  for (const indicator of ["apt", "unit", "ste", "suite", "#", "apartment"]) {
    const idx = cleanAddress.indexOf(indicator);
    if (idx !== -1) {
      const rest = cleanAddress.substring(idx);
      const parts = rest.split(",");
      const unitPart = parts[0].trim().replace(/[^a-z0-9]/g, "");
      if (unitPart) return unitPart;
    }
  }
  return "";
}

function getGroupingKey(address: string): string {
  const parsed = parseAddress(address);
  const unit = getUnitInfo(address);
  if (!parsed.houseNumber) {
    const base = address.toLowerCase().replace(/[^a-z0-9]/g, "");
    return unit ? `${base}_${unit}` : base;
  }
  const baseKey = `${parsed.houseNumber}_${parsed.coreWords.join("_")}`;
  return unit ? `${baseKey}_${unit}` : baseKey;
}

function resolveEntityDetails(rawName: string) {
  const raw = (rawName || '').trim();
  if (!raw || raw.toUpperCase() === 'UNKNOWN' || raw.toUpperCase() === 'DUEÑO DESCONOCIDO' || raw.toUpperCase() === 'NO ESPECIFICADO') {
    return {
      raw_name: raw || 'Unknown',
      normalized_name: 'DUEÑO DESCONOCIDO',
      entity_type: 'UNKNOWN',
      legal_role: 'UNKNOWN',
      confidence_score: 0.50
    };
  }

  let normalized = cleanLegalOwnerName(raw);
  let entity_type = 'INDIVIDUAL';
  let legal_role = 'OWNER';
  let confidence = 0.95;

  if (raw.toUpperCase().includes('LLC') || raw.toUpperCase().includes('INC') || raw.toUpperCase().includes('CORP') || raw.toUpperCase().includes('PROPERTIES') || raw.toUpperCase().includes('HOLDINGS')) {
    entity_type = 'COMPANY_LLC';
    confidence = 0.98;
  } else if (/UNKNOWN\s+(HEIRS|DEVISEES|LEGATEES|BENEFICIARIES)/i.test(raw) || /ESTATE\s+OF/i.test(raw)) {
    entity_type = 'ESTATE_REFERENCE';
    legal_role = 'HEIRS_SUCCESSION';
    confidence = 0.96;
  } else if (/UNKNOWN\s+SPOUSE/i.test(raw)) {
    entity_type = 'INDIVIDUAL';
    legal_role = 'SPOUSE_CO_OWNER';
    confidence = 0.92;
  } else if (/ET\s+AL/i.test(raw)) {
    legal_role = 'CO_DEFENDANT';
    confidence = 0.94;
  }

  return {
    raw_name: raw,
    normalized_name: normalized,
    entity_type,
    legal_role,
    confidence_score: confidence
  };
}

async function migrateToEventGraph() {
  console.log('================================================================');
  console.log('🚀 INICIANDO MIGRACIÓN A ARQUITECTURA BASADA EN EVENTOS E IDENTIDADES');
  console.log('================================================================\n');

  console.log('--- 1. Creando Tablas del Grafo de Entidades y Eventos ---');

  // 1. Properties
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tzel_properties (
      property_id TEXT PRIMARY KEY,
      parcel_id TEXT,
      address TEXT NOT NULL,
      normalized_address TEXT NOT NULL,
      county TEXT NOT NULL,
      state TEXT NOT NULL,
      lat REAL,
      lon REAL,
      property_type TEXT DEFAULT 'Single Family',
      sqft REAL,
      beds INTEGER,
      baths REAL,
      pva_assessed_value REAL DEFAULT 0,
      mca_arv_value REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Persons / Entities
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tzel_persons (
      person_id TEXT PRIMARY KEY,
      raw_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      entity_type TEXT DEFAULT 'INDIVIDUAL',
      legal_role TEXT DEFAULT 'OWNER',
      confidence_score REAL DEFAULT 1.0,
      phones TEXT,
      emails TEXT,
      mailing_address TEXT,
      is_absentee INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 3. Property Person Relations
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tzel_property_person_relations (
      relation_id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL,
      person_id TEXT NOT NULL,
      relation_type TEXT DEFAULT 'OWNED_BY',
      confidence_score REAL DEFAULT 1.0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 4. Central Event Engine
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tzel_events (
      event_id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_date TEXT,
      source_system TEXT,
      case_number TEXT,
      title TEXT NOT NULL,
      description TEXT,
      amount REAL DEFAULT 0,
      plaintiff TEXT,
      defendant TEXT,
      severity_level TEXT DEFAULT 'HIGH',
      confidence_score REAL DEFAULT 1.0,
      raw_data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 5. Encumbrances / Liens Priority Cascade
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tzel_encumbrances (
      encumbrance_id TEXT PRIMARY KEY,
      property_id TEXT NOT NULL,
      type TEXT NOT NULL,
      holder TEXT,
      amount REAL DEFAULT 0,
      priority INTEGER DEFAULT 1,
      status TEXT DEFAULT 'ACTIVE',
      recording_date TEXT,
      source TEXT,
      confidence_score REAL DEFAULT 0.95,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 6. Opportunity Scores & Tactical Actions
  await db.execute(`
    CREATE TABLE IF NOT EXISTS tzel_opportunity_scores (
      property_id TEXT PRIMARY KEY,
      opportunity_score REAL DEFAULT 0,
      equity_score REAL DEFAULT 0,
      motivation_score REAL DEFAULT 0,
      accessibility_score REAL DEFAULT 0,
      legal_risk_score REAL DEFAULT 0,
      tactical_action TEXT,
      underwriting_summary TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  console.log('✅ Esquema del Grafo de Eventos creado exitosamente.\n');

  console.log('--- 2. Extrayendo y Poblando Grafo desde Tablas Origen ---');

  // Traer todos los datos existentes
  const batchRes = await db.batch([
    'SELECT * FROM foreclosure_auctions',
    'SELECT * FROM pre_foreclosures',
    'SELECT * FROM code_violations',
    'SELECT * FROM tax_sales',
    'SELECT * FROM probates',
    'SELECT * FROM divorces',
    'SELECT * FROM bankruptcies',
    'SELECT * FROM physical_distress',
    'SELECT * FROM financial_distress',
    'SELECT * FROM life_events',
    'SELECT * FROM geocode_cache',
    'SELECT * FROM osint_enrichment'
  ], 'read');

  const auctions = batchRes[0].rows;
  const preForeclosures = batchRes[1].rows;
  const violations = batchRes[2].rows;
  const taxSales = batchRes[3].rows;
  const probates = batchRes[4].rows;
  const divorces = batchRes[5].rows;
  const bankruptcies = batchRes[6].rows;
  const physical = batchRes[7].rows;
  const financial = batchRes[8].rows;
  const lifeEvents = batchRes[9].rows;
  const geocache = batchRes[10].rows;
  const osint = batchRes[11].rows;

  // Build Geocache Map
  const geocodeMap = new Map<string, { lat: number; lon: number }>();
  const geocodeKeyMap = new Map<string, { lat: number; lon: number }>();
  for (const row of geocache) {
    if (row.address && row.lat !== null && row.lon !== null) {
      const coords = { lat: row.lat as number, lon: row.lon as number };
      geocodeMap.set(row.address as string, coords);
      const k = getGroupingKey(row.address as string);
      if (!geocodeKeyMap.has(k)) geocodeKeyMap.set(k, coords);
    }
  }

  // Agrupar propiedades por clave canónica
  const propertyMap = new Map<string, any>();

  function getOrCreateProperty(address: string, county: string, state: string, parcelId?: string) {
    const normKey = getGroupingKey(address);
    if (!propertyMap.has(normKey)) {
      const coords = geocodeMap.get(address) || geocodeKeyMap.get(normKey) || { lat: null, lon: null };
      const propertyId = `PROP_${normKey.replace(/[^a-z0-9]/g, '_').substring(0, 40)}`;
      propertyMap.set(normKey, {
        property_id: propertyId,
        parcel_id: parcelId || null,
        address: address,
        normalized_address: normKey,
        county: county || 'Jefferson',
        state: state || 'KY',
        lat: coords.lat,
        lon: coords.lon,
        pva_assessed_value: 0,
        mca_arv_value: 0,
        sqft: null,
        beds: null,
        baths: null,
        persons: new Map<string, any>(),
        events: [] as any[],
        encumbrances: [] as any[]
      });
    }
    const prop = propertyMap.get(normKey)!;
    if (!prop.parcel_id && parcelId) prop.parcel_id = parcelId;
    return prop;
  }

  // A. Foreclosure Auctions -> Events & Encumbrances
  for (const auc of auctions) {
    const prop = getOrCreateProperty(auc.address as string, auc.county as string, auc.state as string);
    if (auc.appraisal_value && Number(auc.appraisal_value) > 0) {
      prop.pva_assessed_value = Math.max(prop.pva_assessed_value, Number(auc.appraisal_value));
    }

    // Person resolution
    const entity = resolveEntityDetails(auc.defendant as string);
    const personKey = entity.normalized_name;
    if (!prop.persons.has(personKey)) {
      prop.persons.set(personKey, {
        ...entity,
        phones: auc.defendant_phones ? [auc.defendant_phones as string] : [],
        emails: auc.defendant_emails ? [auc.defendant_emails as string] : [],
        mailing_address: auc.mailing_address as string || '',
        is_absentee: auc.absentee_owner ? 1 : 0
      });
    }

    // Encumbrance (Mortgage Judgment)
    if (Number(auc.debt_amount) > 0) {
      prop.encumbrances.push({
        type: 'JUDGMENT_MORTGAGE_LIEN',
        holder: auc.plaintiff as string || 'Banco Demandante',
        amount: Number(auc.debt_amount),
        priority: 1,
        status: 'ACTIVE',
        recording_date: auc.auction_date as string || '2026',
        source: 'SHERIFF_SALE_COURT_FILING',
        confidence_score: 0.98
      });
    }

    // Event: AUCTION_SCHEDULED
    prop.events.push({
      event_id: `EV_AUC_${auc.auction_id}`,
      event_type: 'AUCTION_SCHEDULED',
      event_date: auc.auction_date as string || null,
      source_system: `${prop.state.toUpperCase()}_CIRCUIT_COURT_SHERIFF`,
      case_number: auc.case_number as string,
      title: `Subasta Judicial Programada: ${auc.case_number}`,
      description: `Ejecución hipotecaria promovida por ${auc.plaintiff || 'el banco'}. Reclamo: $${Number(auc.debt_amount || 0).toLocaleString()}`,
      amount: Number(auc.debt_amount || 0),
      plaintiff: auc.plaintiff as string,
      defendant: entity.normalized_name,
      severity_level: 'CRITICAL',
      confidence_score: 0.98,
      raw_data: JSON.stringify(auc)
    });
  }

  // B. Pre-Foreclosures -> Events
  for (const pf of preForeclosures) {
    const prop = getOrCreateProperty(pf.address as string, pf.county as string, pf.state as string);
    const entity = resolveEntityDetails(pf.defendant as string);
    const personKey = entity.normalized_name;
    if (!prop.persons.has(personKey)) {
      prop.persons.set(personKey, {
        ...entity,
        phones: pf.defendant_phones ? [pf.defendant_phones as string] : [],
        emails: pf.defendant_emails ? [pf.defendant_emails as string] : [],
        mailing_address: pf.mailing_address as string || '',
        is_absentee: pf.absentee_owner ? 1 : 0
      });
    }

    prop.events.push({
      event_id: `EV_PF_${pf.pre_foreclosure_id}`,
      event_type: 'FORECLOSURE_FILED',
      event_date: pf.filing_date as string || null,
      source_system: `${prop.state.toUpperCase()}_COURT_LIS_PENDENS`,
      case_number: pf.case_number as string,
      title: `Demanda de Pre-Foreclosure Radicada: ${pf.case_number}`,
      description: `Aviso de Lis Pendens radicado en corte por ${pf.plaintiff || 'el acreedor'}. Días desde radicación: ${pf.days_since_filing || 0} días.`,
      amount: 0,
      plaintiff: pf.plaintiff as string,
      defendant: entity.normalized_name,
      severity_level: 'HIGH',
      confidence_score: 0.96,
      raw_data: JSON.stringify(pf)
    });
  }

  // C. Code Violations -> Events & Liens
  for (const viol of violations) {
    const prop = getOrCreateProperty(viol.address as string, 'Jefferson', 'KY');
    if (viol.sqft) prop.sqft = Number(viol.sqft);
    if (viol.beds) prop.beds = Number(viol.beds);
    if (viol.baths) prop.baths = Number(viol.baths);

    if (viol.hidden_mortgages && Number(viol.hidden_mortgages) > 0) {
      prop.encumbrances.push({
        type: 'PRIOR_MORTGAGE',
        holder: 'Hipotecario Previo',
        amount: Number(viol.hidden_mortgages),
        priority: 2,
        status: 'ACTIVE',
        recording_date: null,
        source: 'RECORDED_DEED_AUDIT',
        confidence_score: 0.90
      });
    }

    if (viol.hidden_liens_amount && Number(viol.hidden_liens_amount) > 0) {
      prop.encumbrances.push({
        type: 'MUNICIPAL_CODE_LIEN',
        holder: 'Municipalidad / Ciudad',
        amount: Number(viol.hidden_liens_amount),
        priority: 3,
        status: 'ACTIVE',
        recording_date: viol.report_date as string || null,
        source: 'CODE_ENFORCEMENT_AUDIT',
        confidence_score: 0.95
      });
    }

    prop.events.push({
      event_id: `EV_VIOL_${viol.violation_id}`,
      event_type: 'CODE_VIOLATION',
      event_date: viol.report_date as string || null,
      source_system: 'MUNICIPAL_CODE_ENFORCEMENT',
      case_number: viol.case_number as string,
      title: `Infracción Municipal: ${viol.violation_type}`,
      description: `Infracción de código urbano abierta. Estado: ${viol.status || 'Active'}.`,
      amount: Number(viol.hidden_liens_amount || 0),
      plaintiff: 'City Code Enforcement',
      defendant: 'Propietario Inmueble',
      severity_level: 'MEDIUM',
      confidence_score: 0.95,
      raw_data: JSON.stringify(viol)
    });
  }

  // D. Tax Sales -> Events & Liens
  for (const ts of taxSales) {
    const prop = getOrCreateProperty(ts.address as string, ts.county as string, ts.state as string, ts.parcel_id as string);
    const entity = resolveEntityDetails(ts.owner_name as string);
    const personKey = entity.normalized_name;
    if (!prop.persons.has(personKey)) {
      prop.persons.set(personKey, {
        ...entity,
        phones: ts.defendant_phones ? [ts.defendant_phones as string] : [],
        emails: ts.defendant_emails ? [ts.defendant_emails as string] : [],
        mailing_address: ts.mailing_address as string || '',
        is_absentee: ts.absentee_owner ? 1 : 0
      });
    }

    prop.encumbrances.push({
      type: 'PROPERTY_TAX_DELINQUENCY_LIEN',
      holder: 'County Treasurer / SRI Services',
      amount: Number(ts.taxes_owed || 0),
      priority: 1, // Super-priority
      status: 'ACTIVE',
      recording_date: ts.sale_date as string || null,
      source: 'COUNTY_TAX_SALE_LIST',
      confidence_score: 0.99
    });

    prop.events.push({
      event_id: `EV_TAX_${ts.tax_sale_id}`,
      event_type: 'TAX_DELINQUENCY',
      event_date: ts.sale_date as string || null,
      source_system: 'COUNTY_TAX_ASSESSOR',
      case_number: ts.parcel_id as string,
      title: `Subasta de Impuestos Fiscales: Parcela ${ts.parcel_id}`,
      description: `Impuestos a la propiedad en mora por $${Number(ts.taxes_owed || 0).toLocaleString()}. Subasta fiscal programada.`,
      amount: Number(ts.taxes_owed || 0),
      plaintiff: 'County Treasurer',
      defendant: entity.normalized_name,
      severity_level: 'HIGH',
      confidence_score: 0.99,
      raw_data: JSON.stringify(ts)
    });
  }

  // E. Probates, Divorces, Bankruptcies, Physical, Financial, Life Events
  for (const p of probates) {
    const prop = getOrCreateProperty(p.address as string, p.county as string, p.state as string);
    prop.events.push({
      event_id: `EV_PROB_${p.probate_id}`,
      event_type: 'PROBATE_FILED',
      event_date: p.report_date as string || null,
      source_system: 'PROBATE_COURT',
      case_number: p.case_number as string,
      title: `Juicio Sucesorio / Probate: ${p.case_number}`,
      description: `Sucesión de herederos abierta. Titular difunto: ${p.decedent_name}.`,
      amount: 0,
      plaintiff: 'Herederos / Devisees',
      defendant: p.decedent_name as string,
      severity_level: 'MEDIUM',
      confidence_score: 0.96,
      raw_data: JSON.stringify(p)
    });
  }

  for (const b of bankruptcies) {
    const prop = getOrCreateProperty(b.address as string, b.county as string, b.state as string);
    prop.events.push({
      event_id: `EV_BANK_${b.bankruptcy_id}`,
      event_type: 'BANKRUPTCY_FILED',
      event_date: b.report_date as string || null,
      source_system: 'US_BANKRUPTCY_COURT',
      case_number: b.case_number as string,
      title: `Quiebra / Bancarrota ${b.chapter_type || 'Capítulo 7/13'}: ${b.case_number}`,
      description: `Proceso de reestructuración o liquidación de deudas en corte federal.`,
      amount: 0,
      plaintiff: 'Acreedores Concursales',
      defendant: b.debtor_name as string,
      severity_level: 'HIGH',
      confidence_score: 0.98,
      raw_data: JSON.stringify(b)
    });
  }

  for (const phys of physical) {
    const prop = getOrCreateProperty(phys.address as string, phys.county as string, phys.state as string);
    const isStorm = ['Tornado Damage', 'Storm Damage', 'Hail Damage'].includes(phys.distress_type as string);
    prop.events.push({
      event_id: `EV_PHYS_${phys.distress_id}`,
      event_type: isStorm ? 'STORM_IMPACT' : 'PHYSICAL_DISTRESS',
      event_date: phys.report_date as string || null,
      source_system: isStorm ? 'NOAA_NWS_DAMAGE_SURVEY' : 'SAFETY_INSPECTIONS',
      case_number: phys.ef_scale as string || 'N/A',
      title: `${phys.distress_type} ${phys.ef_scale ? '(' + phys.ef_scale + ')' : ''}`,
      description: phys.details as string || 'Daños físicos severos reportados en estructura.',
      amount: 0,
      plaintiff: 'NWS / Inspectors',
      defendant: 'Estructura Inmueble',
      severity_level: isStorm ? 'CRITICAL' : 'MEDIUM',
      confidence_score: 0.95,
      raw_data: JSON.stringify(phys)
    });
  }

  console.log(`📊 Total de propiedades consolidadas en el nuevo grafo: ${propertyMap.size}`);

  // Inserción en Lote a Base de Datos
  console.log('--- 3. Persistiendo Entidades, Personas, Eventos y Encumbrances ---');

  let propCount = 0;
  let personCount = 0;
  let eventCount = 0;
  let encumbranceCount = 0;

  const statements: any[] = [];

  for (const prop of propertyMap.values()) {
    // 1. Insert Property
    statements.push({
      sql: `INSERT OR REPLACE INTO tzel_properties (
        property_id, parcel_id, address, normalized_address, county, state, lat, lon, pva_assessed_value, mca_arv_value, sqft, beds, baths, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      args: [
        prop.property_id, prop.parcel_id, prop.address, prop.normalized_address, prop.county, prop.state,
        prop.lat, prop.lon, prop.pva_assessed_value, prop.mca_arv_value, prop.sqft, prop.beds, prop.baths
      ]
    });
    propCount++;

    // 2. Insert Persons & Relations
    for (const person of prop.persons.values()) {
      const personId = `PER_${prop.normalized_address.substring(0, 15)}_${person.normalized_name.replace(/[^a-z0-9]/gi, '_').substring(0, 20)}`;
      statements.push({
        sql: `INSERT OR REPLACE INTO tzel_persons (
          person_id, raw_name, normalized_name, entity_type, legal_role, confidence_score, phones, emails, mailing_address, is_absentee, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        args: [
          personId, person.raw_name, person.normalized_name, person.entity_type, person.legal_role, person.confidence_score,
          JSON.stringify(person.phones || []), JSON.stringify(person.emails || []), person.mailing_address || '', person.is_absentee || 0
        ]
      });
      personCount++;

      const relId = `REL_${prop.property_id}_${personId}`;
      statements.push({
        sql: `INSERT OR REPLACE INTO tzel_property_person_relations (
          relation_id, property_id, person_id, relation_type, confidence_score, created_at
        ) VALUES (?, ?, ?, 'OWNED_BY', ?, datetime('now'))`,
        args: [relId, prop.property_id, personId, person.confidence_score]
      });
    }

    // 3. Insert Events
    for (const ev of prop.events) {
      statements.push({
        sql: `INSERT OR REPLACE INTO tzel_events (
          event_id, property_id, event_type, event_date, source_system, case_number, title, description, amount, plaintiff, defendant, severity_level, confidence_score, raw_data, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        args: [
          ev.event_id, prop.property_id, ev.event_type, ev.event_date, ev.source_system, ev.case_number,
          ev.title, ev.description, ev.amount, ev.plaintiff, ev.defendant, ev.severity_level, ev.confidence_score, ev.raw_data
        ]
      });
      eventCount++;
    }

    // 4. Insert Encumbrances
    for (let i = 0; i < prop.encumbrances.length; i++) {
      const enc = prop.encumbrances[i];
      const encId = `ENC_${prop.property_id}_${i}`;
      statements.push({
        sql: `INSERT OR REPLACE INTO tzel_encumbrances (
          encumbrance_id, property_id, type, holder, amount, priority, status, recording_date, source, confidence_score, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        args: [
          encId, prop.property_id, enc.type, enc.holder, enc.amount, enc.priority, enc.status, enc.recording_date, enc.source, enc.confidence_score
        ]
      });
      encumbranceCount++;
    }
  }

  console.log(`⚡ Ejecutando ${statements.length} inserciones en bloques por lotes...`);
  const chunkSize = 50;
  for (let i = 0; i < statements.length; i += chunkSize) {
    const chunk = statements.slice(i, i + chunkSize);
    await db.batch(chunk, 'write');
    process.stdout.write(`   [${Math.min(i + chunkSize, statements.length)} / ${statements.length}] procesados...\r`);
  }

  console.log(`\n\n🎉 MIGRACIÓN AL GRAFO DE EVENTOS COMPLETADA EXITOSAMENTE:`);
  console.log(`   🏠 Propiedades en Grafo (tzel_properties): ${propCount}`);
  console.log(`   👤 Personas / Entidades (tzel_persons): ${personCount}`);
  console.log(`   📜 Eventos Registrados en Timeline (tzel_events): ${eventCount}`);
  console.log(`   💳 Gravámenes / Encumbrances (tzel_encumbrances): ${encumbranceCount}`);
}

migrateToEventGraph().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
