import axios from "axios";
import { db } from "./db";
import * as dotenv from "dotenv";
import * as path from "path";
import { sendTelegramNotification } from "./telegram_helper";
import { calculateRehab, calculateMAO, calculateROI, isJuniorLien, calculateNetEquity, isUnderwater, checkCriticalRisk } from "./underwriting/underwriter";
import { querySearXNG } from "./searxng_client";
import { classifyPhone } from "./intelligence/phone_classifier";


// Cargar variables de entorno
dotenv.config();

// Inicializar cliente de Turso DB


const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const NOISE_WORDS = new Set([
  "st", "street", "ave", "avenue", "rd", "road", "ln", "lane", "dr", "drive", 
  "ct", "court", "blvd", "boulevard", "way", "pl", "place", "hwy", "highway", 
  "rte", "route", "cir", "circle", "ter", "terrace", "trl", "trail", "pkwy", "parkway",
  "apt", "apartment", "unit", "ste", "suite", "fl", "floor", 
  "n", "north", "s", "south", "e", "east", "w", "west", 
  "ky", "in", "jefferson", "clark", "floyd"
]);

const UNIT_INDICATORS = ["apt", "unit", "ste", "suite", "#", "apartment"];

/**
 * Normaliza y extrae el número de casa y palabras clave del nombre de la calle.
 */
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

/**
 * Extrae y normaliza la información de la unidad/departamento para evitar colisiones.
 */
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

/**
 * Retorna una clave de agrupación limpia y determinista basada en el número de casa, el nombre de la calle y la unidad.
 */
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

/**
 * Retorna la URL del catastro PVA basado en el condado y estado.
 */
function getPvaUrl(county: string, state: string): string {
  const cleanState = state.toUpperCase().trim();
  const cleanCounty = county.toLowerCase().trim();
  
  if (cleanState === "KY" && cleanCounty.includes("jefferson")) {
    return "https://jeffersonky.patriotproperties.com/Search.asp";
  } else if (cleanState === "IN" && cleanCounty.includes("clark")) {
    return "https://clarkin.wthgis.com/";
  } else if (cleanState === "IN" && cleanCounty.includes("floyd")) {
    return "https://floydin.wthgis.com/";
  }
  return "https://www.google.com/search?q=" + encodeURIComponent(`${county} County ${state} PVA Property Search`);
}

/**
 * Calcula la cantidad de días restantes hasta la fecha de la subasta.
 */
function getDaysRemaining(dateStr: string): number | null {
  try {
    let cleanDate = dateStr.toLowerCase().replace(/\s+/g, " ").trim();
    const months: { [key: string]: number } = {
      jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
      apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
      aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
      nov: 10, november: 10, dec: 11, december: 11
    };
    
    let dateObj: Date | null = null;
    
    if (/^\d+\/\d+\/\d+$/.test(cleanDate)) {
      const [m, d, y] = cleanDate.split("/").map(Number);
      dateObj = new Date(y, m - 1, d);
    }
    else if (cleanDate.includes("/")) {
      const parts = cleanDate.split("/");
      const monthName = parts[0].trim();
      const dayAndYear = parts[1].trim();
      const dayYearParts = dayAndYear.split(" ");
      const day = parseInt(dayYearParts[0]);
      const year = parseInt(dayYearParts[1] || "2026");
      
      if (months[monthName] !== undefined && !isNaN(day)) {
        dateObj = new Date(year, months[monthName], day);
      }
    }
    else {
      cleanDate = cleanDate.replace(/,/g, "");
      const parts = cleanDate.split(" ");
      if (parts.length >= 3) {
        const monthName = parts[0];
        const day = parseInt(parts[1]);
        const year = parseInt(parts[2]);
        if (months[monthName] !== undefined && !isNaN(day) && !isNaN(year)) {
          dateObj = new Date(year, months[monthName], day);
        }
      }
    }
    
    if (dateObj && !isNaN(dateObj.getTime())) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      dateObj.setHours(0, 0, 0, 0);
      const diffTime = dateObj.getTime() - today.getTime();
      return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }
  } catch (e) {
    // Falla silenciosa
  }
  return null;
}


/**
 * Valida la existencia de un PDF de tasación judicial.
 */
async function checkPdfUrl(pdfUrl: string, parseMode: "Markdown" | "HTML" = "Markdown"): Promise<string> {
  try {
    console.log(`[CHECK PDF] Validando existencia de PDF: ${pdfUrl}`);
    const headResp = await axios.head(pdfUrl, {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" 
      },
      timeout: 3000
    });
    if (headResp.status === 200) {
      return parseMode === "HTML"
        ? `📁 <a href="${pdfUrl}">Ver PDF de Tasación</a>`
        : `📁 [Ver PDF de Tasación](${pdfUrl})`;
    }
  } catch (err) {
    // Falla silenciosa
  }
  return `📁 Tasación PDF: No disponible aún (se publica 1-2 semanas antes)`;
}

/**
 * Escapa caracteres especiales de HTML para evitar errores de parseo en Telegram.
 */
function escapeHtml(text: string): string {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}



interface GroupedLead {
  groupingKey: string;
  displayAddress: string;
  state: string;
  county: string;
  ownerName: string;
  phones: Set<string>;
  emails: Set<string>;
  mlsValue: number;
  mlsId: string;
  auctions: any[];
  violations: any[];
  probates: any[];
  divorces: any[];
  bankruptcies: any[];
  physicalDistress: any[];
  financialDistress: any[];
  lifeEvents: any[];
  hiddenMortgages: number;
  
  // Nuevos campos del catastro y la MLS
  mailingAddress?: string;
  isAbsentee: boolean;
  sqft?: number;
  beds?: number;
  baths?: number;
  stressScore?: number;
  photoUrls: string[];
  nextRetryDate?: string;
}

/**
 * Extrae la ciudad de la dirección o utiliza condados como fallback.
 */
function extractCity(address: string, county: string, state: string): string {
  const parts = address.split(",");
  if (parts.length >= 2) {
    const cityCandidate = parts[parts.length - 2].trim();
    if (cityCandidate && !cityCandidate.includes(" ") && cityCandidate.length > 2) {
      return cityCandidate;
    }
    const cityPart = parts[1].trim();
    if (cityPart) return cityPart;
  }
  const cleanCounty = county.toLowerCase();
  if (cleanCounty.includes("jefferson")) return "Louisville";
  if (cleanCounty.includes("clark")) return "Jeffersonville";
  if (cleanCounty.includes("floyd")) return "New Albany";
  return county;
}

/**
 * Realiza una búsqueda rápida en SearXNG para obituario o divorcio del propietario.
 */
async function searchLegalRadar(ownerName: string, city: string): Promise<boolean> {
  if (!ownerName || ownerName === "No especificado" || ownerName === "DUEÑO DESCONOCIDO" || ownerName.toLowerCase() === "no especificado") {
    return false;
  }

  // Limpiar sufijos comerciales
  const cleanName = ownerName.replace(/,?\s+llc\.?/gi, "")
                             .replace(/,?\s+inc\.?/gi, "")
                             .replace(/,?\s+corp\.?/gi, "")
                             .trim();

  if (cleanName.length < 3) return false;

  const query = `"${cleanName}" "${city}" (obituary OR divorce)`;
  
  try {
    const results = await querySearXNG(query);
    const lowerName = cleanName.toLowerCase();
    
    // Si obtenemos resultados, verificamos la coincidencia del nombre y palabras clave en snippets/título
    const keywords = ["obituary", "obituaries", "divorce", "divorcio", "falleció", "death", "died", "esquela", "difunto", "herencia", "sucesión"];
    
    for (const result of results) {
      const title = (result.title || "").toLowerCase();
      const content = (result.content || result.snippet || "").toLowerCase();
      const text = `${title} ${content}`;
      
      if (text.includes(lowerName)) {
        const hasKeyword = keywords.some(kw => text.includes(kw));
        if (hasKeyword) {
          console.log(`[LEGAL RADAR MATCH] Coincidencia encontrada para "${cleanName}" en la web!`);
          return true;
        }
      }
    }
  } catch (err: any) {
    console.error(`[LEGAL RADAR ERROR] Falló la búsqueda para ${cleanName}:`, err.message);
  }
  return false;
}

/**
 * Realiza una consulta rápida en el archivo Hister local.
 */
async function queryLocalArchive(addressOrName: string): Promise<{ total: number; documents: any[] }> {
  try {
    const searchUrl = `http://localhost:5005/search?q=${encodeURIComponent(addressOrName)}&format=json`;
    const response = await axios.get(searchUrl, {
      headers: {
        "Origin": "hister://"
      },
      timeout: 4000
    });
    if (response.status === 200 && response.data) {
      const total = response.data.total || 0;
      const documents = response.data.documents || [];
      return { total, documents };
    }
  } catch (err: any) {
    console.warn(`[HISTER ARCHIVE WARN] Error al buscar en archivo local para "${addressOrName}": ${err.message}`);
  }
  return { total: 0, documents: [] };
}

/**
 * Despacha notificaciones para oportunidades de alta rentabilidad o revisiones manuales no notificadas,
 * agrupando múltiples incidencias (claims y violaciones) bajo una misma dirección física.
 */
async function notifyOpportunities(mode?: 'legal' | 'physical') {
  console.log(`[INICIO] Buscando oportunidades sin notificar (Modo: ${mode || 'TODOS'})...`);
  const appUrl = process.env.APP_URL || "https://tzel.vercel.app";

  // Cargar mapa de enriquecimiento OSINT
  const osintMap = new Map<string, any>();
  try {
    const osintRes = await db.execute("SELECT address_key, llc_directors, corporate_address, social_profiles, usernames_found, env_stressors, env_attractors FROM osint_enrichment");
    for (const row of osintRes.rows) {
      if (row.address_key) {
        osintMap.set(row.address_key as string, {
          llcDirectors: row.llc_directors ? JSON.parse(row.llc_directors as string) : [],
          corporateAddress: row.corporate_address as string || "",
          socialProfiles: row.social_profiles ? JSON.parse(row.social_profiles as string) : [],
          usernamesFound: row.usernames_found ? JSON.parse(row.usernames_found as string) : [],
          envStressors: row.env_stressors ? JSON.parse(row.env_stressors as string) : [],
          envAttractors: row.env_attractors ? JSON.parse(row.env_attractors as string) : [],
        });
      }
    }
  } catch (err: any) {
    console.error("[OSINT LOAD WARNING] Failed to load osint enrichment for notifier:", err.message);
  }

  // 1. Consultar subastas judiciales no notificadas
  let opportunities: any[] = [];
  if (mode !== 'physical') {
    try {
      const opportunitiesRes = await db.execute(`
        SELECT 
          auction_id, case_number, address, county, state, auction_date, 
          plaintiff, defendant, debt_amount, appraisal_value, 
          mls_estimated_value, mls_id, pdf_url,
          defendant_phones, defendant_emails, needs_manual_review,
          mailing_address, absentee_owner, sqft, beds, baths, hidden_mortgages, hidden_liens_amount, stress_score, photo_urls, next_retry_date
        FROM foreclosure_auctions 
        WHERE (is_high_yield = 1 OR (state = 'IN' AND (needs_manual_review = 1 OR needs_manual_review = 2))) AND telegram_sent = 0
      `);
      opportunities = opportunitiesRes.rows.filter(row => {
        const dateStr = row.auction_date as string;
        const daysRemaining = getDaysRemaining(dateStr);
        if (daysRemaining === null) return true;
        return daysRemaining >= 0 && daysRemaining <= 60;
      });
    } catch (dbErr: any) {
      console.error("[DB ERROR] Error al consultar subastas:", dbErr.message);
      process.exit(1);
    }
  }

  // 2. Consultar violaciones de código no notificadas (Excluyendo césped/basura)
  let violations: any[] = [];
  if (mode !== 'legal') {
    try {
      const violationsRes = await db.execute(`
        SELECT 
          violation_id, case_number, address, violation_type, report_date, status, 
          owner_name, mls_estimated_value, mls_id, defendant_phones, defendant_emails,
          mailing_address, absentee_owner, sqft, beds, baths, hidden_mortgages, hidden_liens_amount, stress_score, photo_urls
        FROM code_violations 
        WHERE is_high_yield = 1 AND telegram_sent = 0
          AND violation_type NOT LIKE '%02A%' 
          AND violation_type NOT LIKE '%CLEANING%' 
          AND violation_type NOT LIKE '%WEEDS%' 
          AND violation_type NOT LIKE '%rubbish%' 
          AND violation_type NOT LIKE '%grass%' 
          AND violation_type NOT LIKE '%weed%' 
          AND violation_type NOT LIKE '%trash%'
          AND violation_type NOT LIKE '%vehicle%'
          AND violation_type NOT LIKE '%lawn%'
      `);
      violations = violationsRes.rows;
    } catch (dbErr: any) {
      console.error("[DB ERROR] Error al consultar violaciones de código:", dbErr.message);
      process.exit(1);
    }
  }

  // 3. Consultar herencias no notificadas
  let probates: any[] = [];
  if (mode !== 'physical' && mode !== 'legal') {
    try {
      const probatesRes = await db.execute(`
        SELECT probate_id, case_number, address, county, state, deceased_name, heir_name, heir_phones, heir_emails
        FROM probates
        WHERE telegram_sent = 0
      `);
      probates = probatesRes.rows;
    } catch (dbErr: any) {
      console.error("[DB ERROR] Error al consultar probates:", dbErr.message);
      process.exit(1);
    }
  }

  // 4. Consultar divorcios no notificados
  let divorces: any[] = [];
  if (mode !== 'physical' && mode !== 'legal') {
    try {
      const divorcesRes = await db.execute(`
        SELECT divorce_id, case_number, address, county, state, spouse_a, spouse_b, spouse_a_phones, spouse_a_emails, spouse_b_phones, spouse_b_emails
        FROM divorces
        WHERE telegram_sent = 0
      `);
      divorces = divorcesRes.rows;
    } catch (dbErr: any) {
      console.error("[DB ERROR] Error al consultar divorces:", dbErr.message);
      process.exit(1);
    }
  }

  // 5. Consultar bancarrotas no notificadas
  let bankruptcies: any[] = [];
  if (mode !== 'physical' && mode !== 'legal') {
    try {
      const bankruptciesRes = await db.execute(`
        SELECT bankruptcy_id, case_number, address, county, state, debtor_name, bankruptcy_type, debtor_phones, debtor_emails
        FROM bankruptcies
        WHERE telegram_sent = 0
      `);
      bankruptcies = bankruptciesRes.rows;
    } catch (dbErr: any) {
      console.error("[DB ERROR] Error al consultar bankruptcies:", dbErr.message);
      process.exit(1);
    }
  }

  // 6. Consultar estrés físico no notificado
  let physicalDistressList: any[] = [];
  if (mode !== 'legal') {
    try {
      const physicalRes = await db.execute(`
        SELECT distress_id, address, county, state, distress_type, report_date, details, owner_name,
               mls_estimated_value, mls_id, defendant_phones, defendant_emails, mailing_address, absentee_owner, sqft, beds, baths, hidden_mortgages, hidden_liens_amount, stress_score, photo_urls
        FROM physical_distress
        WHERE telegram_sent = 0
      `);
      physicalDistressList = physicalRes.rows;
    } catch (dbErr: any) {
      console.error("[DB ERROR] Error al consultar physical_distress:", dbErr.message);
      process.exit(1);
    }
  }

  // 7. Consultar estrés financiero extra no notificado
  let financialDistressList: any[] = [];
  if (mode !== 'physical') {
    try {
      let queryStr = `
        SELECT record_id, case_number, address, county, state, record_type, debt_amount, owner_name, plaintiff, report_date,
               mls_estimated_value, mls_id, defendant_phones, defendant_emails, mailing_address, absentee_owner, sqft, beds, baths, hidden_mortgages, hidden_liens_amount, stress_score, photo_urls
        FROM financial_distress
        WHERE telegram_sent = 0
      `;
      if (mode === 'legal') {
        queryStr += ` AND record_type NOT IN ('Eviction', 'Eviction Notice')`;
      }
      const financialRes = await db.execute(queryStr);
      financialDistressList = financialRes.rows;
    } catch (dbErr: any) {
      console.error("[DB ERROR] Error al consultar financial_distress:", dbErr.message);
      process.exit(1);
    }
  }

  // 8. Consultar eventos de vida críticos no notificados
  let lifeEventsList: any[] = [];
  if (mode !== 'legal') {
    try {
      const lifeEventsRes = await db.execute(`
        SELECT event_id, event_type, subject_name, address, county, state, details, report_date,
               mls_estimated_value, mls_id, defendant_phones, defendant_emails, mailing_address, absentee_owner, sqft, beds, baths, hidden_mortgages, hidden_liens_amount, stress_score, photo_urls
        FROM life_events
        WHERE telegram_sent = 0
      `);
      lifeEventsList = lifeEventsRes.rows;
    } catch (dbErr: any) {
      console.error("[DB ERROR] Error al consultar life_events:", dbErr.message);
      process.exit(1);
    }
  }

  console.log(`[NOTIFICAR] Pendientes: Subastas: ${opportunities.length}, Violaciones: ${violations.length}, Herencias: ${probates.length}, Divorcios: ${divorces.length}, Quiebras: ${bankruptcies.length}, Físico: ${physicalDistressList.length}, Fin: ${financialDistressList.length}, Eventos: ${lifeEventsList.length}`);

  if (opportunities.length === 0 && violations.length === 0 && probates.length === 0 && divorces.length === 0 && bankruptcies.length === 0 && physicalDistressList.length === 0 && financialDistressList.length === 0 && lifeEventsList.length === 0) {
    console.log("[NOTIFICAR] No hay nuevas notificaciones pendientes.");
    return;
  }

  // 3. Agrupación por dirección
  const groupedMap = new Map<string, GroupedLead>();

  // A. Agrupar subastas
  for (const row of opportunities) {
    const address = row.address as string;
    const key = getGroupingKey(address);
    
    const rowPhones = (row.defendant_phones as string || "").split(/,\s*|;\s*/).map(p => p.trim()).filter(Boolean);
    const rowEmails = (row.defendant_emails as string || "").split(/,\s*|;\s*/).map(e => e.trim()).filter(Boolean);

    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        groupingKey: key,
        displayAddress: address,
        state: row.state as string || "KY",
        county: row.county as string || "Jefferson",
        ownerName: row.defendant as string || "No especificado",
        phones: new Set(rowPhones),
        emails: new Set(rowEmails),
        mlsValue: row.mls_estimated_value as number || 0,
        mlsId: row.mls_id as string || "N/A",
        auctions: [],
        violations: [],
        probates: [],
        divorces: [],
        bankruptcies: [],
        physicalDistress: [],
        financialDistress: [],
        lifeEvents: [],
        hiddenMortgages: (row.hidden_mortgages as number || 0) + (row.hidden_liens_amount as number || 0),
        mailingAddress: row.mailing_address as string || undefined,
        isAbsentee: (row.absentee_owner as number) === 1,
        sqft: row.sqft as number || undefined,
        beds: row.beds as number || undefined,
        baths: row.baths as number || undefined,
        photoUrls: [],
        nextRetryDate: row.next_retry_date as string || undefined
      });
    } else {
      const existing = groupedMap.get(key)!;
      // Actualizar si encontramos datos más completos
      if (row.mls_estimated_value && (row.mls_estimated_value as number) > existing.mlsValue) {
        existing.mlsValue = row.mls_estimated_value as number;
      }
      if (row.mls_id && row.mls_id !== "N/A") {
        existing.mlsId = row.mls_id as string;
      }
      if (existing.ownerName === "No especificado" && row.defendant) {
        existing.ownerName = row.defendant as string;
      }
      if (!existing.mailingAddress && row.mailing_address) {
        existing.mailingAddress = row.mailing_address as string;
      }
      if (!existing.nextRetryDate && row.next_retry_date) {
        existing.nextRetryDate = row.next_retry_date as string;
      }
      if ((row.absentee_owner as number) === 1) {
        existing.isAbsentee = true;
      }
      if (!existing.sqft && row.sqft) {
        existing.sqft = row.sqft as number;
      }
      if (!existing.beds && row.beds) {
        existing.beds = row.beds as number;
      }
      if (!existing.baths && row.baths) {
        existing.baths = row.baths as number;
      }
      const rowHidden = (row.hidden_mortgages as number || 0) + (row.hidden_liens_amount as number || 0);
      if (rowHidden > existing.hiddenMortgages) {
        existing.hiddenMortgages = rowHidden;
      }
      rowPhones.forEach(p => existing.phones.add(p));
      rowEmails.forEach(e => existing.emails.add(e));
      
      // Preferir la dirección más larga (con detalles como Apt/Unit #)
      if (address.length > existing.displayAddress.length) {
        existing.displayAddress = address;
      }
    }
    const lead = groupedMap.get(key)!;
    if (row.photo_urls) {
      try {
        const parsed = JSON.parse(row.photo_urls as string);
        if (Array.isArray(parsed)) {
          parsed.forEach((url: string) => {
            if (url && !lead.photoUrls.includes(url)) lead.photoUrls.push(url);
          });
        }
      } catch (e) {}
    }
    lead.auctions.push(row);
  }

  // B. Agrupar violaciones de código
  for (const row of violations) {
    const address = row.address as string;
    const key = getGroupingKey(address);

    const rowPhones = (row.defendant_phones as string || "").split(/,\s*|;\s*/).map(p => p.trim()).filter(Boolean);
    const rowEmails = (row.defendant_emails as string || "").split(/,\s*|;\s*/).map(e => e.trim()).filter(Boolean);

    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        groupingKey: key,
        displayAddress: address,
        state: "KY",
        county: "Jefferson",
        ownerName: row.owner_name as string || "DUEÑO DESCONOCIDO",
        phones: new Set(rowPhones),
        emails: new Set(rowEmails),
        mlsValue: row.mls_estimated_value as number || 0,
        mlsId: row.mls_id as string || "N/A",
        auctions: [],
        violations: [],
        probates: [],
        divorces: [],
        bankruptcies: [],
        physicalDistress: [],
        financialDistress: [],
        lifeEvents: [],
        hiddenMortgages: (row.hidden_mortgages as number || 0) + (row.hidden_liens_amount as number || 0),
        mailingAddress: row.mailing_address as string || undefined,
        isAbsentee: (row.absentee_owner as number) === 1,
        sqft: row.sqft as number || undefined,
        beds: row.beds as number || undefined,
        baths: row.baths as number || undefined,
        photoUrls: []
      });
    } else {
      const existing = groupedMap.get(key)!;
      
      // Preferir el nombre de dueño real PVA si está disponible
      if (row.owner_name && row.owner_name !== "DUEÑO DESCONOCIDO" && (existing.ownerName === "No especificado" || existing.ownerName === "DUEÑO DESCONOCIDO")) {
        existing.ownerName = row.owner_name as string;
      }
      if (row.mls_estimated_value && (row.mls_estimated_value as number) > existing.mlsValue) {
        existing.mlsValue = row.mls_estimated_value as number;
      }
      if (row.mls_id && row.mls_id !== "N/A") {
        existing.mlsId = row.mls_id as string;
      }
      if (!existing.mailingAddress && row.mailing_address) {
        existing.mailingAddress = row.mailing_address as string;
      }
      if ((row.absentee_owner as number) === 1) {
        existing.isAbsentee = true;
      }
      if (!existing.sqft && row.sqft) {
        existing.sqft = row.sqft as number;
      }
      if (!existing.beds && row.beds) {
        existing.beds = row.beds as number;
      }
      if (!existing.baths && row.baths) {
        existing.baths = row.baths as number;
      }
      const rowHidden = (row.hidden_mortgages as number || 0) + (row.hidden_liens_amount as number || 0);
      if (rowHidden > existing.hiddenMortgages) {
        existing.hiddenMortgages = rowHidden;
      }
      rowPhones.forEach(p => existing.phones.add(p));
      rowEmails.forEach(e => existing.emails.add(e));
      
      if (address.length > existing.displayAddress.length) {
        existing.displayAddress = address;
      }
    }
    const lead = groupedMap.get(key)!;
    if (row.photo_urls) {
      try {
        const parsed = JSON.parse(row.photo_urls as string);
        if (Array.isArray(parsed)) {
          parsed.forEach((url: string) => {
            if (url && !lead.photoUrls.includes(url)) lead.photoUrls.push(url);
          });
        }
      } catch (e) {}
    }
    lead.violations.push(row);
  }

  // C. Agrupar herencias (probates)
  for (const row of probates) {
    const address = row.address as string;
    const key = getGroupingKey(address);
    
    const rowPhones = (row.heir_phones as string || "").split(/,\s*|;\s*/).map(p => p.trim()).filter(Boolean);
    const rowEmails = (row.heir_emails as string || "").split(/,\s*|;\s*/).map(e => e.trim()).filter(Boolean);

    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        groupingKey: key,
        displayAddress: address,
        state: row.state as string || "KY",
        county: row.county as string || "Jefferson",
        ownerName: row.heir_name as string || "Heredero Desconocido",
        phones: new Set(rowPhones),
        emails: new Set(rowEmails),
        mlsValue: 0,
        mlsId: "N/A",
        auctions: [],
        violations: [],
        probates: [],
        divorces: [],
        bankruptcies: [],
        physicalDistress: [],
        financialDistress: [],
        lifeEvents: [],
        hiddenMortgages: 0,
        isAbsentee: false,
        photoUrls: []
      });
    } else {
      const existing = groupedMap.get(key)!;
      if (existing.ownerName === "No especificado" || existing.ownerName === "DUEÑO DESCONOCIDO") {
        existing.ownerName = row.heir_name as string || existing.ownerName;
      }
      rowPhones.forEach(p => existing.phones.add(p));
      rowEmails.forEach(e => existing.emails.add(e));
    }
    groupedMap.get(key)!.probates.push(row);
  }

  // D. Agrupar divorcios (divorces)
  for (const row of divorces) {
    const address = row.address as string;
    const key = getGroupingKey(address);
    
    const rowPhones = [
      ...(row.spouse_a_phones as string || "").split(/,\s*|;\s*/),
      ...(row.spouse_b_phones as string || "").split(/,\s*|;\s*/)
    ].map(p => p.trim()).filter(Boolean);
    const rowEmails = [
      ...(row.spouse_a_emails as string || "").split(/,\s*|;\s*/),
      ...(row.spouse_b_emails as string || "").split(/,\s*|;\s*/)
    ].map(e => e.trim()).filter(Boolean);

    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        groupingKey: key,
        displayAddress: address,
        state: row.state as string || "KY",
        county: row.county as string || "Jefferson",
        ownerName: `${row.spouse_a} & ${row.spouse_b}`,
        phones: new Set(rowPhones),
        emails: new Set(rowEmails),
        mlsValue: 0,
        mlsId: "N/A",
        auctions: [],
        violations: [],
        probates: [],
        divorces: [],
        bankruptcies: [],
        physicalDistress: [],
        financialDistress: [],
        lifeEvents: [],
        hiddenMortgages: 0,
        isAbsentee: false,
        photoUrls: []
      });
    } else {
      const existing = groupedMap.get(key)!;
      rowPhones.forEach(p => existing.phones.add(p));
      rowEmails.forEach(e => existing.emails.add(e));
    }
    groupedMap.get(key)!.divorces.push(row);
  }

  // E. Agrupar bancarrotas (bankruptcies)
  for (const row of bankruptcies) {
    const address = row.address as string;
    const key = getGroupingKey(address);
    
    const rowPhones = (row.debtor_phones as string || "").split(/,\s*|;\s*/).map(p => p.trim()).filter(Boolean);
    const rowEmails = (row.debtor_emails as string || "").split(/,\s*|;\s*/).map(e => e.trim()).filter(Boolean);

    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        groupingKey: key,
        displayAddress: address,
        state: row.state as string || "KY",
        county: row.county as string || "Jefferson",
        ownerName: row.debtor_name as string || "Deudor Desconocido",
        phones: new Set(rowPhones),
        emails: new Set(rowEmails),
        mlsValue: 0,
        mlsId: "N/A",
        auctions: [],
        violations: [],
        probates: [],
        divorces: [],
        bankruptcies: [],
        physicalDistress: [],
        financialDistress: [],
        lifeEvents: [],
        hiddenMortgages: 0,
        isAbsentee: false,
        photoUrls: []
      });
    } else {
      const existing = groupedMap.get(key)!;
      if (existing.ownerName === "No especificado" || existing.ownerName === "DUEÑO DESCONOCIDO") {
        existing.ownerName = row.debtor_name as string || existing.ownerName;
      }
      rowPhones.forEach(p => existing.phones.add(p));
      rowEmails.forEach(e => existing.emails.add(e));
    }
    groupedMap.get(key)!.bankruptcies.push(row);
  }

  // F. Agrupar estrés físico (physical_distress)
  for (const row of physicalDistressList) {
    const address = row.address as string;
    const key = getGroupingKey(address);

    const rowPhones = (row.defendant_phones as string || "").split(/,\s*|;\s*/).map(p => p.trim()).filter(Boolean);
    const rowEmails = (row.defendant_emails as string || "").split(/,\s*|;\s*/).map(e => e.trim()).filter(Boolean);

    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        groupingKey: key,
        displayAddress: address,
        state: row.state as string || "KY",
        county: row.county as string || "Jefferson",
        ownerName: row.owner_name as string || "DUEÑO DESCONOCIDO",
        phones: new Set(rowPhones),
        emails: new Set(rowEmails),
        mlsValue: row.mls_estimated_value as number || 0,
        mlsId: row.mls_id as string || "N/A",
        auctions: [],
        violations: [],
        probates: [],
        divorces: [],
        bankruptcies: [],
        physicalDistress: [],
        financialDistress: [],
        lifeEvents: [],
        hiddenMortgages: (row.hidden_mortgages as number || 0) + (row.hidden_liens_amount as number || 0),
        mailingAddress: row.mailing_address as string || undefined,
        isAbsentee: (row.absentee_owner as number) === 1,
        sqft: row.sqft as number || undefined,
        beds: row.beds as number || undefined,
        baths: row.baths as number || undefined,
        photoUrls: []
      });
    } else {
      const existing = groupedMap.get(key)!;
      if (row.owner_name && row.owner_name !== "DUEÑO DESCONOCIDO" && (existing.ownerName === "No especificado" || existing.ownerName === "DUEÑO DESCONOCIDO")) {
        existing.ownerName = row.owner_name as string;
      }
      if (row.mls_estimated_value && (row.mls_estimated_value as number) > existing.mlsValue) {
        existing.mlsValue = row.mls_estimated_value as number;
      }
      if (row.mls_id && row.mls_id !== "N/A") {
        existing.mlsId = row.mls_id as string;
      }
      if (!existing.mailingAddress && row.mailing_address) {
        existing.mailingAddress = row.mailing_address as string;
      }
      if ((row.absentee_owner as number) === 1) {
        existing.isAbsentee = true;
      }
      if (!existing.sqft && row.sqft) {
        existing.sqft = row.sqft as number;
      }
      if (!existing.beds && row.beds) {
        existing.beds = row.beds as number;
      }
      if (!existing.baths && row.baths) {
        existing.baths = row.baths as number;
      }
      const rowHidden = (row.hidden_mortgages as number || 0) + (row.hidden_liens_amount as number || 0);
      if (rowHidden > existing.hiddenMortgages) {
        existing.hiddenMortgages = rowHidden;
      }
      rowPhones.forEach(p => existing.phones.add(p));
      rowEmails.forEach(e => existing.emails.add(e));
      if (address.length > existing.displayAddress.length) {
        existing.displayAddress = address;
      }
    }
    const lead = groupedMap.get(key)!;
    if (row.photo_urls) {
      try {
        const parsed = JSON.parse(row.photo_urls as string);
        if (Array.isArray(parsed)) {
          parsed.forEach((url: string) => {
            if (url && !lead.photoUrls.includes(url)) lead.photoUrls.push(url);
          });
        }
      } catch (e) {}
    }
    lead.physicalDistress.push(row);
  }

  // G. Agrupar estrés financiero extra (financial_distress)
  for (const row of financialDistressList) {
    const address = row.address as string;
    const key = getGroupingKey(address);

    const rowPhones = (row.defendant_phones as string || "").split(/,\s*|;\s*/).map(p => p.trim()).filter(Boolean);
    const rowEmails = (row.defendant_emails as string || "").split(/,\s*|;\s*/).map(e => e.trim()).filter(Boolean);

    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        groupingKey: key,
        displayAddress: address,
        state: row.state as string || "KY",
        county: row.county as string || "Jefferson",
        ownerName: row.owner_name as string || "DUEÑO DESCONOCIDO",
        phones: new Set(rowPhones),
        emails: new Set(rowEmails),
        mlsValue: row.mls_estimated_value as number || 0,
        mlsId: row.mls_id as string || "N/A",
        auctions: [],
        violations: [],
        probates: [],
        divorces: [],
        bankruptcies: [],
        physicalDistress: [],
        financialDistress: [],
        lifeEvents: [],
        hiddenMortgages: (row.hidden_mortgages as number || 0) + (row.hidden_liens_amount as number || 0),
        mailingAddress: row.mailing_address as string || undefined,
        isAbsentee: (row.absentee_owner as number) === 1,
        sqft: row.sqft as number || undefined,
        beds: row.beds as number || undefined,
        baths: row.baths as number || undefined,
        photoUrls: []
      });
    } else {
      const existing = groupedMap.get(key)!;
      if (row.owner_name && row.owner_name !== "DUEÑO DESCONOCIDO" && (existing.ownerName === "No especificado" || existing.ownerName === "DUEÑO DESCONOCIDO")) {
        existing.ownerName = row.owner_name as string;
      }
      if (row.mls_estimated_value && (row.mls_estimated_value as number) > existing.mlsValue) {
        existing.mlsValue = row.mls_estimated_value as number;
      }
      if (row.mls_id && row.mls_id !== "N/A") {
        existing.mlsId = row.mls_id as string;
      }
      if (!existing.mailingAddress && row.mailing_address) {
        existing.mailingAddress = row.mailing_address as string;
      }
      if ((row.absentee_owner as number) === 1) {
        existing.isAbsentee = true;
      }
      if (!existing.sqft && row.sqft) {
        existing.sqft = row.sqft as number;
      }
      if (!existing.beds && row.beds) {
        existing.beds = row.beds as number;
      }
      if (!existing.baths && row.baths) {
        existing.baths = row.baths as number;
      }
      const rowHidden = (row.hidden_mortgages as number || 0) + (row.hidden_liens_amount as number || 0);
      if (rowHidden > existing.hiddenMortgages) {
        existing.hiddenMortgages = rowHidden;
      }
      rowPhones.forEach(p => existing.phones.add(p));
      rowEmails.forEach(e => existing.emails.add(e));
      if (address.length > existing.displayAddress.length) {
        existing.displayAddress = address;
      }
    }
    const lead = groupedMap.get(key)!;
    if (row.photo_urls) {
      try {
        const parsed = JSON.parse(row.photo_urls as string);
        if (Array.isArray(parsed)) {
          parsed.forEach((url: string) => {
            if (url && !lead.photoUrls.includes(url)) lead.photoUrls.push(url);
          });
        }
      } catch (e) {}
    }
    lead.financialDistress.push(row);
  }

  // H. Agrupar eventos de vida críticos (life_events)
  for (const row of lifeEventsList) {
    const address = row.address as string;
    const key = getGroupingKey(address);

    const rowPhones = (row.defendant_phones as string || "").split(/,\s*|;\s*/).map(p => p.trim()).filter(Boolean);
    const rowEmails = (row.defendant_emails as string || "").split(/,\s*|;\s*/).map(e => e.trim()).filter(Boolean);

    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        groupingKey: key,
        displayAddress: address,
        state: row.state as string || "KY",
        county: row.county as string || "Jefferson",
        ownerName: row.subject_name as string || "No especificado",
        phones: new Set(rowPhones),
        emails: new Set(rowEmails),
        mlsValue: row.mls_estimated_value as number || 0,
        mlsId: row.mls_id as string || "N/A",
        auctions: [],
        violations: [],
        probates: [],
        divorces: [],
        bankruptcies: [],
        physicalDistress: [],
        financialDistress: [],
        lifeEvents: [],
        hiddenMortgages: (row.hidden_mortgages as number || 0) + (row.hidden_liens_amount as number || 0),
        mailingAddress: row.mailing_address as string || undefined,
        isAbsentee: (row.absentee_owner as number) === 1,
        sqft: row.sqft as number || undefined,
        beds: row.beds as number || undefined,
        baths: row.baths as number || undefined,
        photoUrls: []
      });
    } else {
      const existing = groupedMap.get(key)!;
      if (row.subject_name && row.subject_name !== "No especificado" && (existing.ownerName === "No especificado" || existing.ownerName === "DUEÑO DESCONOCIDO")) {
        existing.ownerName = row.subject_name as string;
      }
      if (row.mls_estimated_value && (row.mls_estimated_value as number) > existing.mlsValue) {
        existing.mlsValue = row.mls_estimated_value as number;
      }
      if (row.mls_id && row.mls_id !== "N/A") {
        existing.mlsId = row.mls_id as string;
      }
      if (!existing.mailingAddress && row.mailing_address) {
        existing.mailingAddress = row.mailing_address as string;
      }
      if ((row.absentee_owner as number) === 1) {
        existing.isAbsentee = true;
      }
      if (!existing.sqft && row.sqft) {
        existing.sqft = row.sqft as number;
      }
      if (!existing.beds && row.beds) {
        existing.beds = row.beds as number;
      }
      if (!existing.baths && row.baths) {
        existing.baths = row.baths as number;
      }
      const rowHidden = (row.hidden_mortgages as number || 0) + (row.hidden_liens_amount as number || 0);
      if (rowHidden > existing.hiddenMortgages) {
        existing.hiddenMortgages = rowHidden;
      }
      rowPhones.forEach(p => existing.phones.add(p));
      rowEmails.forEach(e => existing.emails.add(e));
      if (address.length > existing.displayAddress.length) {
        existing.displayAddress = address;
      }
    }
    const lead = groupedMap.get(key)!;
    if (row.photo_urls) {
      try {
        const parsed = JSON.parse(row.photo_urls as string);
        if (Array.isArray(parsed)) {
          parsed.forEach((url: string) => {
            if (url && !lead.photoUrls.includes(url)) lead.photoUrls.push(url);
          });
        }
      } catch (e) {}
    }
    lead.lifeEvents.push(row);
  }

  // Post-procesar para calcular el stressScore más alto de los items asociados
  for (const lead of groupedMap.values()) {
    let maxScore = 0;
    lead.auctions.forEach(a => { if (a.stress_score && a.stress_score > maxScore) maxScore = a.stress_score; });
    lead.violations.forEach(v => { if (v.stress_score && v.stress_score > maxScore) maxScore = v.stress_score; });
    lead.physicalDistress.forEach(pd => { if (pd.stress_score && pd.stress_score > maxScore) maxScore = pd.stress_score; });
    lead.financialDistress.forEach(fd => { if (fd.stress_score && fd.stress_score > maxScore) maxScore = fd.stress_score; });
    lead.lifeEvents.forEach(le => { if (le.stress_score && le.stress_score > maxScore) maxScore = le.stress_score; });
    lead.stressScore = maxScore;
  }

  console.log(`[NOTIFICAR] Direcciones agrupadas únicas a notificar: ${groupedMap.size}`);

  let notifiedAuctionsCount = 0;
  let notifiedViolationsCount = 0;
  let notifiedPhysicalCount = 0;
  let notifiedFinancialCount = 0;
  let notifiedLifeCount = 0;

  // 4. Construir y enviar notificaciones
  for (const lead of groupedMap.values()) {
    const hasAuctions = lead.auctions.length > 0;
    const hasViolations = lead.violations.length > 0;
    let isIndianaManual = lead.state === "IN" && lead.auctions.some(a => a.needs_manual_review === 1);
    let isIndianaHibernated = lead.state === "IN" && lead.auctions.some(a => a.needs_manual_review === 2);
    
    const firstAuction = lead.auctions[0];
    const daysRemaining = firstAuction ? getDaysRemaining(firstAuction.auction_date as string) : null;
    const nextRetryDate = lead.nextRetryDate || (firstAuction ? (firstAuction.next_retry_date as string) : null) || "N/A";

    // --- CÁLCULOS FINANCIEROS (UNDERWRITING) ---
    const violationKeywords = lead.violations.map(v => v.violation_type as string);
    const rehab = calculateRehab(lead.sqft || null, violationKeywords);
    const hiddenDebt = lead.hiddenMortgages || 0;
    
    // MAO restando deudas ocultas
    const mao = calculateMAO(lead.mlsValue, rehab, hiddenDebt);
    
    const primaryDebt = lead.auctions.length > 0 ? (lead.auctions[0].debt_amount as number || 0) : 0;
    const netEquity = calculateNetEquity(lead.mlsValue, primaryDebt, hiddenDebt);
    
    // Para el cálculo de ROI de violaciones (sin deudas judiciales), compramos al valor de la oferta máxima (MAO)
    const purchasePrice = primaryDebt > 0 ? primaryDebt : mao;
    const { roi, totalCost } = calculateROI(lead.mlsValue, purchasePrice, rehab);

    const plaintiff = lead.auctions.length > 0 ? lead.auctions[0].plaintiff : null;
    const caseNumber = lead.auctions.length > 0 ? lead.auctions[0].case_number : null;
    const riskCheck = checkCriticalRisk(lead.mlsValue, primaryDebt, hiddenDebt, plaintiff, caseNumber);

    const city = extractCity(lead.displayAddress, lead.county, lead.state);
    const hasLegalRadarMatch = await searchLegalRadar(lead.ownerName, city);

    let isHighMotivation = false;
    if (hasAuctions) {
      const firstAuction = lead.auctions[0];
      const daysRemaining = getDaysRemaining(firstAuction.auction_date);
      if (daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 60) {
        if (hasViolations || primaryDebt > 0 || hiddenDebt > 0) {
          isHighMotivation = true;
        }
      }
    }


    const rawPva = (lead.auctions && lead.auctions.length > 0 && (lead.auctions[0] as any).appraisal_value > 0) ? (lead.auctions[0] as any).appraisal_value : 0;
    const mcaVal = lead.mlsValue || 0;
    
    // Effective Valuation: Si el avalúo del comisionado/corte es nominal (< $35k o < 35% de MLS), usamos MLS
    let pvaOrMca = rawPva;
    if (mcaVal > 0 && (rawPva <= 0 || rawPva < 35000 || rawPva < mcaVal * 0.35)) {
      pvaOrMca = mcaVal;
    } else if (pvaOrMca <= 0) {
      pvaOrMca = mcaVal;
    }

    // Regla de Negocio 1: Excluir propiedades con valor superior a $350,000 USD
    if (pvaOrMca > 350000) {
      console.log(`[NOTIFICAR SKIP] Propiedad supera el tope de $350k ($${pvaOrMca.toLocaleString()}): ${lead.displayAddress}`);
      continue;
    }

    const totalDebt = primaryDebt + hiddenDebt;
    const equitySpread = pvaOrMca > 0 ? (pvaOrMca - totalDebt) : 0;

    // Regla de Negocio 2: Excluir propiedades bajo el agua (deuda superior al valor)
    if (equitySpread <= 0 && totalDebt > 0) {
      console.log(`[NOTIFICAR SKIP] Propiedad bajo el agua descartada (Deuda: $${totalDebt.toLocaleString()} > Valor: $${pvaOrMca.toLocaleString()}): ${lead.displayAddress}`);
      continue;
    }

    const df = lead.state === 'KY' ? 0.66 : 0.70;
    const mpo = Math.max(0, Math.round((pvaOrMca * df) - totalDebt));

    const pvaStr = rawPva > 0 ? rawPva.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "0";
    const mcaStr = mcaVal > 0 ? mcaVal.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "0";

    const cleanAddr = escapeHtml(lead.displayAddress);
    const cleanOwner = escapeHtml(lead.ownerName);
    const cleanMail = escapeHtml(lead.mailingAddress || "");

    let debtLine = "";
    if (totalDebt > 0) {
      debtLine = `Deuda Consolidada: $${totalDebt.toLocaleString("en-US", { maximumFractionDigits: 0 })} (Impuestos + Liens)`;
    } else if (hasAuctions) {
      debtLine = `Deuda Judicial: ⏳ Pendiente de publicación por la corte (Ver caso judicial)`;
    } else {
      debtLine = `Deuda Judicial: N/A (Lead de Infracción de Código Municipal)`;
    }

    let msg = `🚨 <b>NUEVO LEAD DE EQUIDAD DETECTADO:</b> ${cleanAddr}
--------------------------------------------------
Propietario: ${cleanOwner}
Valor Catastral PVA: $${pvaStr} | MCA Oficial: $${mcaStr}
${debtLine}

💰 Margen de Equidad (Spread): $${equitySpread.toLocaleString("en-US", { maximumFractionDigits: 0 })}
📢 Oferta Máxima Sugerida (MPO): $${mpo.toLocaleString("en-US", { maximumFractionDigits: 0 })}
--------------------------------------------------`;

    // Datos de contacto del dueño
    const absenteeStatus = lead.isAbsentee ? "<b>(Dueño Ausente)</b>" : "<b>(Dueño Ocupante)</b>";
    msg += `\n👤 <b>Estatus:</b> ${absenteeStatus}\n`;
    if (lead.mailingAddress) {
      msg += `✉️ <b>Dirección Postal:</b> ${cleanMail}\n`;
    }

    // Filtrar contactos regulares vs OSINT
    const regularPhones: string[] = [];
    const osintPhones: string[] = [];
    for (const phone of lead.phones) {
      const lower = phone.toLowerCase();
      if (lower.startsWith("osint:")) {
        osintPhones.push(escapeHtml(phone.substring(6).trim()));
      } else {
        regularPhones.push(escapeHtml(phone));
      }
    }

    const regularEmails: string[] = [];
    const osintLinks: string[] = [];
    const osintEmails: string[] = [];
    for (const emailOrLink of lead.emails) {
      const lower = emailOrLink.toLowerCase();
      if (lower.startsWith("osint link:")) {
        osintLinks.push(emailOrLink.substring(11).trim());
      } else if (lower.startsWith("osint:")) {
        osintEmails.push(escapeHtml(emailOrLink.substring(6).trim()));
      } else {
        regularEmails.push(escapeHtml(emailOrLink));
      }
    }

    if (regularPhones.length > 0) {
      const classifiedStr = regularPhones.map(p => {
        const c = classifyPhone(p);
        return `${c.icon} <code>${c.formatted}</code> <i>(${c.label})</i>`;
      }).join(", ");
      msg += `📞 <b>Teléfonos:</b> ${classifiedStr}\n`;
    }
    if (regularEmails.length > 0) {
      msg += `✉️ <b>Correos:</b> <code>${regularEmails.join(", ")}</code>\n`;
    }

    if (osintPhones.length > 0 || osintLinks.length > 0 || osintEmails.length > 0) {
      msg += `\n📞 <b>Contactos OSINT:</b>\n`;
      if (osintPhones.length > 0) {
        msg += `  - Teléfonos: <code>${osintPhones.join(", ")}</code>\n`;
      }
      if (osintEmails.length > 0) {
        msg += `  - Correos: <code>${osintEmails.join(", ")}</code>\n`;
      }
      if (osintLinks.length > 0) {
        msg += `  - Enlaces públicos:\n`;
        for (const link of osintLinks) {
          const escLink = escapeHtml(link);
          msg += `    • <a href="${escLink}">${escLink}</a>\n`;
        }
      }
    }

    // OSINT Enrichment details (LLC unmasking and Overpass OSM)
    const osint = osintMap.get(lead.groupingKey) || {
      llcDirectors: [],
      corporateAddress: "",
      socialProfiles: [],
      usernamesFound: [],
      envStressors: [],
      envAttractors: []
    };

    if (osint.llcDirectors.length > 0) {
      msg += `\n🏢 <b>LLC UNMASKING / CORPORATIVO:</b>\n`;
      msg += `  - Directores: <code>${escapeHtml(osint.llcDirectors.join(", "))}</code>\n`;
      if (osint.corporateAddress) {
        msg += `  - Oficina: <i>${escapeHtml(osint.corporateAddress)}</i>\n`;
      }
    }

    if (osint.socialProfiles.length > 0) {
      msg += `\n🔗 <b>CANALES Y CONTACTO OSINT:</b>\n`;
      for (const p of osint.socialProfiles) {
        const escPlatform = escapeHtml(p.platform);
        const escUrl = escapeHtml(p.url);
        msg += `  - ${escPlatform}: <a href="${escUrl}">${escUrl}</a>\n`;
      }
    }

    if (osint.envStressors.length > 0 || osint.envAttractors.length > 0) {
      msg += `\n🗺️ <b>AUDITORÍA AMBIENTAL (OSM):</b>\n`;
      if (osint.envStressors.length > 0) {
        msg += `  - Stressors (⚠️): ${escapeHtml(osint.envStressors.join(", "))}\n`;
      }
      if (osint.envAttractors.length > 0) {
        msg += `  - Attractors (✅): ${escapeHtml(osint.envAttractors.join(", "))}\n`;
      }
    }

    const hasProbates = lead.probates && lead.probates.length > 0;
    const hasDivorces = lead.divorces && lead.divorces.length > 0;
    const hasBankruptcies = lead.bankruptcies && lead.bankruptcies.length > 0;

    // Detalles de Subasta (si existen)
    if (hasAuctions) {
      msg += `\n⚖️ <b>PROCESOS JUDICIALES (FORECLOSURE)</b>:\n`;
      for (const a of lead.auctions) {
        const auctionDate = escapeHtml(a.auction_date as string);
        const daysRemaining = getDaysRemaining(a.auction_date as string);
        const daysStr = daysRemaining !== null 
          ? (daysRemaining < 0 ? `Hace ${Math.abs(daysRemaining)} días (Pasada)` : `${daysRemaining} días`)
          : "Fecha indefinida";
        
        msg += `• <b>Caso ${escapeHtml(a.case_number)}</b>:\n`;
        msg += `  - Subasta: ${auctionDate} <b>(${daysStr} restantes)</b>\n`;
        if (a.plaintiff) {
          msg += `  - Acreedor: ${escapeHtml(a.plaintiff)}\n`;
        }
        if (a.pdf_url) {
          const pdfSection = await checkPdfUrl(a.pdf_url as string, "HTML");
          msg += `  - ${pdfSection}\n`;
        }
      }
    }

    // Detalles de Violaciones de Código (si existen)
    if (hasViolations) {
      msg += `\n⚠️ <b>VIOLACIONES DE CÓDIGO (ESTRÉS FÍSICO)</b>:\n`;
      for (const v of lead.violations) {
        const reportDate = escapeHtml(v.report_date || "No especificada");
        msg += `• <b>Caso ${escapeHtml(v.case_number)}</b> (Reportado: ${reportDate}):\n`;
        msg += `  - Tipo: <i>${escapeHtml(v.violation_type)}</i>\n`;
      }
    }

    // Detalles de Estrés Físico (si existen)
    if (lead.physicalDistress.length > 0) {
      msg += `\n🔥 <b>ESTRÉS FÍSICO / ABANDONO MUNICIPAL</b>:\n`;
      for (const pd of lead.physicalDistress) {
        const reportDate = escapeHtml(pd.report_date || "No especificada");
        msg += `• <b>Tipo: ${escapeHtml(pd.distress_type)}</b> (Reportado: ${reportDate}):\n`;
        if (pd.details) msg += `  - Detalles: <i>${escapeHtml(pd.details)}</i>\n`;
      }
    }

    // Detalles de Estrés Financiero Extra (si existen)
    if (lead.financialDistress.length > 0) {
      msg += `\n⚖️ <b>ESTRÉS FINANCIERO (CLERK / COURTS)</b>:\n`;
      for (const fd of lead.financialDistress) {
        const reportDate = escapeHtml(fd.report_date || "No especificada");
        const debt = fd.debt_amount as number || 0;
        msg += `• <b>Caso/Registro:</b> ${escapeHtml(fd.case_number || "N/A")} (Tipo: ${escapeHtml(fd.record_type)}, Reportado: ${reportDate}):\n`;
        if (debt > 0) msg += `  - Monto de Deuda: $${debt.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n`;
        if (fd.plaintiff) msg += `  - Acreedor/Demandante: ${escapeHtml(fd.plaintiff)}\n`;
      }
    }

    // Detalles de Eventos de Vida Críticos (si existen)
    if (lead.lifeEvents.length > 0) {
      msg += `\n💔 <b>EVENTOS DE VIDA CRÍTICOS</b>:\n`;
      for (const le of lead.lifeEvents) {
        const reportDate = escapeHtml(le.report_date || "No especificada");
        msg += `• <b>Tipo: ${escapeHtml(le.event_type)}</b> (Fecha: ${reportDate}):\n`;
        if (le.subject_name) msg += `  - Sujeto: ${escapeHtml(le.subject_name)}\n`;
        if (le.details) msg += `  - Detalles: <i>${escapeHtml(le.details)}</i>\n`;
      }
    }

    // Detalles de Herencias (si existen)
    if (hasProbates) {
      msg += `\n📋 <b>HERENCIAS / SUCESIONES (PROBATE)</b>:\n`;
      for (const p of lead.probates) {
        msg += `• <b>Caso ${escapeHtml(p.case_number)}</b>:\n`;
        if (p.deceased_name) msg += `  - Finado: ${escapeHtml(p.deceased_name)}\n`;
        if (p.heir_name) msg += `  - Heredero: ${escapeHtml(p.heir_name)}\n`;
      }
    }

    // Detalles de Divorcios (si existen)
    if (hasDivorces) {
      msg += `\n💔 <b>DIVORCIOS (DIVORCES)</b>:\n`;
      for (const d of lead.divorces) {
        msg += `• <b>Caso ${escapeHtml(d.case_number)}</b>:\n`;
        if (d.spouse_a) msg += `  - Cónyuges: ${escapeHtml(d.spouse_a)} & ${escapeHtml(d.spouse_b)}\n`;
      }
    }

    // Detalles de Bancarrotas (si existen)
    if (hasBankruptcies) {
      msg += `\n📉 <b>QUIEBRAS (BANKRUPTCIES)</b>:\n`;
      for (const b of lead.bankruptcies) {
        msg += `• <b>Caso ${escapeHtml(b.case_number)}</b>:\n`;
        if (b.debtor_name) msg += `  - Deudor: ${escapeHtml(b.debtor_name)}\n`;
        if (b.bankruptcy_type) msg += `  - Tipo: ${escapeHtml(b.bankruptcy_type)}\n`;
      }
    }

    // Recomendación
    msg += `\n💡 <b>Estrategia:</b> Negociar compra as-is directa al propietario ofreciendo hasta la MPO ($${mpo.toLocaleString("en-US", { maximumFractionDigits: 0 })}).`;

    // --- BOTONERA INTERACTIVA DE TELEGRAM ---
    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.displayAddress)}`;
    const pvaSiteUrl = getPvaUrl(lead.county, lead.state);
    
    // Find photos
    const pvaPhoto = lead.photoUrls.find(p => p.includes("pva_photos"));
    const svPhotos = lead.photoUrls.filter(p => p.includes("streetview_images"));
    
    let btnPvaUrl = pvaSiteUrl;
    if (pvaPhoto) {
      const cleanPath = path.relative(path.resolve("./"), path.resolve(pvaPhoto)).replace(/\\/g, "/");
      btnPvaUrl = `${appUrl}/${cleanPath}`;
    }
    
    let btnSvUrl = googleMapsUrl;
    if (svPhotos.length > 0) {
      const cleanPath = path.relative(path.resolve("./"), path.resolve(svPhotos[0])).replace(/\\/g, "/");
      btnSvUrl = `${appUrl}/${cleanPath}`;
    }
    
    // --- CONSULTA AL ARCHIVO LOCAL HISTER ---
    let archiveMatches = 0;
    let archiveQuery = "";
    const debtorName = lead.ownerName || (lead.auctions[0] ? lead.auctions[0].defendant : "");
    if (debtorName && debtorName !== "Desconocido (Dorking)" && debtorName !== "DUEÑO DESCONOCIDO" && debtorName !== "No especificado") {
      archiveQuery = debtorName;
      const res = await queryLocalArchive(debtorName);
      archiveMatches = res.total;
    }
    if (archiveMatches === 0) {
      archiveQuery = lead.displayAddress;
      const res = await queryLocalArchive(lead.displayAddress);
      archiveMatches = res.total;
    }

    const inline_keyboard: any[][] = [
      [
        { text: "📸 Ver Fotos de Fachada PVA", url: btnPvaUrl },
        { text: "⏳ Ver Historial Street View", url: btnSvUrl }
      ],
      [
        { text: "🔎 Unmask LLC/Owner", url: `${appUrl}/?lead=${lead.groupingKey}` },
        { text: "🗺️ Auditoría OSM", url: `${appUrl}/?lead=${lead.groupingKey}` }
      ],
      [
        { text: "📍 Abrir en Google Maps", url: googleMapsUrl }
      ]
    ];

    if (archiveMatches > 0) {
      inline_keyboard.push([
        { text: `🗄️ Ver Coincidencias en Archivo (${archiveMatches})`, url: `http://127.0.0.1.nip.io:5005/?q=${encodeURIComponent(archiveQuery)}` }
      ]);
    }
    
    const replyMarkup = { inline_keyboard };

    console.log(`[ALERTANDO] Enviando alerta agrupada para: ${lead.displayAddress} (Subastas: ${lead.auctions.length}, Violaciones: ${lead.violations.length}, Herencias: ${lead.probates.length}, Divorcios: ${lead.divorces.length}, Quiebras: ${lead.bankruptcies.length})...`);
    
    const success = await sendTelegramNotification(msg, replyMarkup, lead.photoUrls && lead.photoUrls.length > 0 ? lead.photoUrls[0] : null, "HTML");

    
    if (success) {
      const dbPromises: Promise<any>[] = [];

      // Marcar subastas asociadas como notificadas
      for (const a of lead.auctions) {
        dbPromises.push(
          db.execute({
            sql: "UPDATE foreclosure_auctions SET telegram_sent = 1 WHERE auction_id = ?",
            args: [a.auction_id]
          }).then(() => {
            notifiedAuctionsCount++;
          }).catch((dbErr: any) => {
            console.error(`[DB ERROR] No se pudo marcar como notificada la subasta ${a.auction_id}:`, dbErr.message);
          })
        );
      }
      
      // Marcar violaciones asociadas como notificadas
      for (const v of lead.violations) {
        dbPromises.push(
          db.execute({
            sql: "UPDATE code_violations SET telegram_sent = 1 WHERE violation_id = ?",
            args: [v.violation_id]
          }).then(() => {
            notifiedViolationsCount++;
          }).catch((dbErr: any) => {
            console.error(`[DB ERROR] No se pudo marcar como notificada la violación ${v.violation_id}:`, dbErr.message);
          })
        );
      }

      // Marcar herencias asociadas como notificadas
      for (const p of lead.probates) {
        dbPromises.push(
          db.execute({
            sql: "UPDATE probates SET telegram_sent = 1 WHERE probate_id = ?",
            args: [p.probate_id]
          }).catch((dbErr: any) => {
            console.error(`[DB ERROR] No se pudo marcar como notificado el probate ${p.probate_id}:`, dbErr.message);
          })
        );
      }

      // Marcar divorcios asociados como notificados
      for (const d of lead.divorces) {
        dbPromises.push(
          db.execute({
            sql: "UPDATE divorces SET telegram_sent = 1 WHERE divorce_id = ?",
            args: [d.divorce_id]
          }).catch((dbErr: any) => {
            console.error(`[DB ERROR] No se pudo marcar como notificado el divorce ${d.divorce_id}:`, dbErr.message);
          })
        );
      }

      // Marcar bankruptcies asociados como notificados
      for (const b of lead.bankruptcies) {
        dbPromises.push(
          db.execute({
            sql: "UPDATE bankruptcies SET telegram_sent = 1 WHERE bankruptcy_id = ?",
            args: [b.bankruptcy_id]
          }).catch((dbErr: any) => {
            console.error(`[DB ERROR] No se pudo marcar como notificado el bankruptcy ${b.bankruptcy_id}:`, dbErr.message);
          })
        );
      }

      // Marcar physical_distress asociadas como notificadas
      for (const pd of lead.physicalDistress) {
        dbPromises.push(
          db.execute({
            sql: "UPDATE physical_distress SET telegram_sent = 1 WHERE distress_id = ?",
            args: [pd.distress_id]
          }).then(() => {
            notifiedPhysicalCount++;
          }).catch((dbErr: any) => {
            console.error(`[DB ERROR] No se pudo marcar como notificado el physical_distress ${pd.distress_id}:`, dbErr.message);
          })
        );
      }

      // Marcar financial_distress asociadas como notificadas
      for (const fd of lead.financialDistress) {
        dbPromises.push(
          db.execute({
            sql: "UPDATE financial_distress SET telegram_sent = 1 WHERE record_id = ?",
            args: [fd.record_id]
          }).then(() => {
            notifiedFinancialCount++;
          }).catch((dbErr: any) => {
            console.error(`[DB ERROR] No se pudo marcar como notificado el financial_distress ${fd.record_id}:`, dbErr.message);
          })
        );
      }

      // Marcar life_events asociados como notificados
      for (const le of lead.lifeEvents) {
        dbPromises.push(
          db.execute({
            sql: "UPDATE life_events SET telegram_sent = 1 WHERE event_id = ?",
            args: [le.event_id]
          }).then(() => {
            notifiedLifeCount++;
          }).catch((dbErr: any) => {
            console.error(`[DB ERROR] No se pudo marcar como notificado el life_event ${le.event_id}:`, dbErr.message);
          })
        );
      }

      if (dbPromises.length > 0) {
        await Promise.all(dbPromises);
      }
    }

    // Respetar límites de rate limiting de Telegram
    await sleep(350);
  }

  console.log("\n========================================================");
  console.log("RESUMEN DE NOTIFICACIONES TELEGRAM CONSOLIDADAS:");
  console.log(`- Subastas individuales notificadas: ${notifiedAuctionsCount}`);
  console.log(`- Violaciones individuales notificadas: ${notifiedViolationsCount}`);
  console.log(`- Estrés Físico individual notificado: ${notifiedPhysicalCount}`);
  console.log(`- Estrés Financiero individual notificado: ${notifiedFinancialCount}`);
  console.log(`- Eventos de Vida individual notificado: ${notifiedLifeCount}`);
  console.log("========================================================\n");
}

if (require.main === module) {
  notifyOpportunities().catch(console.error);
}

export { notifyOpportunities, sendTelegramNotification };
