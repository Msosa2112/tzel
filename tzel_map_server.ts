import { parseAddress, getUnitInfo, getGroupingKey, buildPropertyId } from "./utils/address_key";
import express from "express";
import axios from "axios";
import { db } from "./db";
import * as dotenv from "dotenv";
import * as path from "path";
import { calculateRehab, calculateMAO, calculateROI, isJuniorLien, calculateNetEquity, isUnderwater, checkCriticalRisk, calculateInstitutionalUnderwriting, InstitutionalUnderwriting } from "./underwriting/underwriter";

dotenv.config();



const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";

// Security: whitelist estricta de archivos estáticos. NUNCA servir el directorio del proyecto
// (contiene browser_profiles/ con cookies de sesión, dumps de entorno, PDFs judiciales, etc.).
const STATIC_WHITELIST: Record<string, string> = {
  "/": "index.html",
  "/index.html": "index.html",
  "/lands": "lands.html",
  "/lands.html": "lands.html",
  "/terrenos": "lands.html",
  "/terrenos.html": "lands.html",
  "/logo.jpg": "logo.jpg",
  "/zillow-icon.png": "zillow-icon.png",
  "/street-view-icon.png": "street-view-icon.png",
  "/telephony_scripts.json": "telephony_scripts.json",
  // Motor de ofertas compartido servidor/navegador (AGENTS.md §3.5)
  "/offer_engine.js": "underwriting/offer_engine.js",
};
for (const [route, file] of Object.entries(STATIC_WHITELIST)) {
  app.get(route, (req, res) => {
    res.sendFile(path.join(__dirname, file));
  });
}

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function safeJsonParse<T = any>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}


function cleanLegalOwnerName(rawName: string | null | undefined): string {
  if (!rawName) return "";
  let clean = rawName.trim();
  
  // 1. Remove trailing ET AL
  clean = clean.replace(/,\s*ET\s+AL\.?/gi, '').replace(/\s+ET\s+AL\.?/gi, '');
  
  // 2. Heirs of / Estate of / Spouse of regex
  const regexPatterns = [
    /UNKNOWN\s+(?:SPOUSE|HEIRS|DEVISEES|LEGATEES|BENEFICIARIES|DEFENDANTS)[^]*?\b(?:OF|TO THE ESTATE OF)\s+([^,]+?)(?:,|\s+AKA|\s*\(DECEASED\)|$)/i,
    /THE\s+UNKNOWN\s+HEIRS\s+OF\s+([^,]+?)(?:,|\s+AKA|\s*\(DECEASED\)|$)/i,
    /(?:ADMINISTRAT(?:OR|RIX)|EXECUT(?:OR|RIX))\s+OF\s+THE\s+ESTATE\s+OF\s+([^,]+?)(?:,|\s+AKA|\s*\(DECEASED\)|$)/i,
    /ESTATE\s+OF\s+([^,]+?)(?:,|\s+AKA|\s*\(DECEASED\)|$)/i
  ];

  for (const regex of regexPatterns) {
    const match = clean.match(regex);
    if (match && match[1]) {
      let extracted = match[1].trim().replace(/\s+AKA.*$/i, '').replace(/,\s*$/, '').replace(/\(DECEASED\)/gi, '').trim();
      if (extracted.length > 2) {
        if (/SPOUSE/i.test(clean)) {
          return `${extracted} (Cónyuge / Titular)`;
        }
        return `${extracted} (Sucesión / Heirs)`;
      }
    }
  }

  return clean;
}

function isValidOwnerName(name: string | null | undefined): boolean {
  if (!name) return false;
  const cleaned = cleanLegalOwnerName(name);
  const lower = cleaned.toLowerCase().trim();
  if (lower === "" || lower === "no especificado" || lower === "dueño desconocido" || lower === "unknown" || lower === "unknown defendant" || lower === "unknown plaintiff" || lower === "propietario inmueble" || lower === "deudor desconocido" || lower === "heredero desconocido" || lower === "n/a" || lower === "null" || (lower.startsWith("unknown") && !lower.includes("sucesión") && !lower.includes("cónyuge"))) {
    return false;
  }
  return true;
}

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
      const explicitYear = parseInt(dayYearParts[1]);
      
      if (months[monthName] !== undefined && !isNaN(day)) {
        if (!isNaN(explicitYear)) {
          dateObj = new Date(explicitYear, months[monthName], day);
        } else {
          // Sin año: usar el año actual, salvo que la fecha quede >6 meses en el pasado (ej. "Jan/ 15" visto en octubre → año siguiente).
          const now = new Date();
          dateObj = new Date(now.getFullYear(), months[monthName], day);
          const sixMonthsMs = 183 * 24 * 60 * 60 * 1000;
          if (now.getTime() - dateObj.getTime() > sixMonthsMs) {
            dateObj = new Date(now.getFullYear() + 1, months[monthName], day);
          }
        }
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
  preForeclosures?: any[];
  taxSales?: any[];
  hiddenMortgages: number;
  hiddenLiensAmount: number;
  titleCheckStatus: string;
  nextRetryDate?: string;
  mailingAddress?: string;
  isAbsentee: boolean;
  sqft?: number;
  beds?: number;
  baths?: number;
  photoUrls: string[];
  landbankInfo?: any;
  acquisitionState?: any;
  forensicLegalStory?: string;
}

type LeadBucket =
  | "auctions" | "violations" | "probates" | "divorces" | "bankruptcies"
  | "physicalDistress" | "financialDistress" | "lifeEvents" | "preForeclosures" | "taxSales";

interface LeadMergeSpec {
  bucket: LeadBucket;
  owner: (row: any) => string | null | undefined;
  ownerFallback: string;
  phones: (row: any) => string[];
  emails: (row: any) => string[];
  defaultState?: string;
  defaultCounty?: string;
  /** false: nunca reemplaza el titular existente con el de esta fuente. */
  mergeOwner?: boolean;
  /** false: no sustituye displayAddress por la variante más larga de esta fuente. */
  preferLongerAddress?: boolean;
}

function splitContacts(...values: unknown[]): string[] {
  return values
    .flatMap(v => String(v || "").split(/,\s*|;\s*/))
    .map(s => s.trim())
    .filter(Boolean);
}

function appendPhotoUrls(lead: GroupedLead, raw: unknown): void {
  if (!raw) return;
  const parsed = safeJsonParse(raw as string);
  if (!Array.isArray(parsed)) return;
  for (const url of parsed) {
    if (typeof url === "string" && url && !lead.photoUrls.includes(url)) lead.photoUrls.push(url);
  }
}

/**
 * Agrupa una fila de cualquier fuente (subastas, violaciones, probates, ...) en el lead de su dirección.
 * Las columnas que una fuente no tiene llegan como undefined y no alteran el lead.
 */
function mergeLeadRow(groupedMap: Map<string, GroupedLead>, row: any, spec: LeadMergeSpec): void {
  const address = row.address as string;
  const key = getGroupingKey(address);
  const rowPhones = spec.phones(row);
  const rowEmails = spec.emails(row);
  const rowOwner = spec.owner(row) || undefined;

  let lead = groupedMap.get(key);
  if (!lead) {
    lead = {
      groupingKey: key,
      displayAddress: address,
      state: (row.state as string) || spec.defaultState || "KY",
      county: (row.county as string) || spec.defaultCounty || "Jefferson",
      ownerName: rowOwner || spec.ownerFallback,
      phones: new Set(rowPhones),
      emails: new Set(rowEmails),
      mlsValue: Number(row.mls_estimated_value) || 0,
      mlsId: (row.mls_id as string) || "N/A",
      auctions: [],
      violations: [],
      probates: [],
      divorces: [],
      bankruptcies: [],
      physicalDistress: [],
      financialDistress: [],
      lifeEvents: [],
      preForeclosures: [],
      taxSales: [],
      hiddenMortgages: Number(row.hidden_mortgages) || 0,
      hiddenLiensAmount: Number(row.hidden_liens_amount) || 0,
      titleCheckStatus: (row.title_check_status as string) || "pending",
      nextRetryDate: (row.next_retry_date as string) || undefined,
      mailingAddress: (row.mailing_address as string) || undefined,
      isAbsentee: Number(row.absentee_owner) === 1,
      sqft: Number(row.sqft) || undefined,
      beds: Number(row.beds) || undefined,
      baths: Number(row.baths) || undefined,
      photoUrls: [],
      forensicLegalStory: (row.forensic_legal_story as string) || undefined
    };
    groupedMap.set(key, lead);
  } else {
    if (spec.mergeOwner !== false && !isValidOwnerName(lead.ownerName) && isValidOwnerName(rowOwner)) {
      lead.ownerName = rowOwner as string;
    }
    if (row.forensic_legal_story && !lead.forensicLegalStory) lead.forensicLegalStory = row.forensic_legal_story as string;
    const rowMls = Number(row.mls_estimated_value) || 0;
    if (rowMls > lead.mlsValue) lead.mlsValue = rowMls;
    if (row.mls_id && row.mls_id !== "N/A") lead.mlsId = row.mls_id as string;
    if (!lead.mailingAddress && row.mailing_address) lead.mailingAddress = row.mailing_address as string;
    if (Number(row.absentee_owner) === 1) lead.isAbsentee = true;
    if (!lead.sqft && row.sqft) lead.sqft = Number(row.sqft);
    if (!lead.beds && row.beds) lead.beds = Number(row.beds);
    if (!lead.baths && row.baths) lead.baths = Number(row.baths);
    lead.hiddenMortgages = Math.max(lead.hiddenMortgages, Number(row.hidden_mortgages) || 0);
    lead.hiddenLiensAmount = Math.max(lead.hiddenLiensAmount, Number(row.hidden_liens_amount) || 0);
    if (row.title_check_status && row.title_check_status !== "pending") lead.titleCheckStatus = row.title_check_status as string;
    if (row.next_retry_date) lead.nextRetryDate = row.next_retry_date as string;
    rowPhones.forEach(p => lead!.phones.add(p));
    rowEmails.forEach(e => lead!.emails.add(e));
    if (spec.preferLongerAddress !== false && address.length > lead.displayAddress.length) lead.displayAddress = address;
  }

  appendPhotoUrls(lead, row.photo_urls);
  const bucket = (lead[spec.bucket] ||= []) as any[];
  bucket.push(row);
}

let rateLimitCooldownUntil = 0;

async function getCoordinates(address: string): Promise<{ lat: number; lon: number } | null> {
  // Check geocode cache first
  try {
    const cacheRes = await db.execute({
      sql: "SELECT lat, lon FROM geocode_cache WHERE address = ?",
      args: [address]
    });
    if (cacheRes.rows.length > 0) {
      const row = cacheRes.rows[0];
      if (row.lat !== null && row.lon !== null) {
        return { lat: row.lat as number, lon: row.lon as number };
      }
      // If it is cached as null, we might want to retry with Google if key is available
      if (!process.env.GOOGLE_MAPS_API_KEY) {
        return null; // Cached as not found
      }
    }
  } catch (err) {
    console.error("[CACHE READ ERROR] Failed to query cache:", err);
  }

  // 1. Try Google Geocoding API first (if key is configured)
  const googleKey = process.env.GOOGLE_MAPS_API_KEY;
  if (googleKey) {
    const googleUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${googleKey}`;
    try {
      console.log(`[GEOCODER] Trying Google Geocoding for: "${address}"`);
      const resp = await axios.get(googleUrl, { timeout: 6000 });
      if (
        resp.status === 200 &&
        resp.data &&
        resp.data.status === "OK" &&
        resp.data.results &&
        resp.data.results.length > 0
      ) {
        const match = resp.data.results[0].geometry.location;
        const lat = match.lat;
        const lon = match.lng;
        
        console.log(`[GEOCODER SUCCESS] Google Geocoding matched: "${address}" -> (${lat}, ${lon})`);
        await db.execute({
          sql: "INSERT OR REPLACE INTO geocode_cache (address, lat, lon) VALUES (?, ?, ?)",
          args: [address, lat, lon]
        });
        return { lat, lon };
      } else {
        console.warn(`[GEOCODER WARNING] Google returned status "${resp.data?.status}" for: "${address}". Reason: ${resp.data?.error_message || 'No error message details'}`);
        
        // If Geocoding API is not enabled, fall back to Google Address Validation API
        const isNotActivated = resp.data?.status === "REQUEST_DENIED" && 
                               (resp.data?.error_message?.includes("not activated") || 
                                resp.data?.error_message?.includes("enable this API") ||
                                resp.data?.error_message?.includes("API project"));
                                
        if (isNotActivated) {
          console.log(`[GEOCODER] Geocoding API not active on project. Falling back to Address Validation API for: "${address}"`);
          const validationUrl = `https://addressvalidation.googleapis.com/v1:validateAddress?key=${googleKey}`;
          const valResp = await axios.post(
            validationUrl,
            { address: { addressLines: [address] } },
            { headers: { "Content-Type": "application/json" }, timeout: 10000 }
          );
          
          const geocodeLoc = valResp.data?.result?.geocode?.location;
          if (geocodeLoc && geocodeLoc.latitude && geocodeLoc.longitude) {
            const lat = geocodeLoc.latitude;
            const lon = geocodeLoc.longitude;
            console.log(`[GEOCODER SUCCESS] Google Address Validation matched: "${address}" -> (${lat}, ${lon})`);
            await db.execute({
              sql: "INSERT OR REPLACE INTO geocode_cache (address, lat, lon) VALUES (?, ?, ?)",
              args: [address, lat, lon]
            });
            return { lat, lon };
          } else {
            console.warn(`[GEOCODER WARNING] Google Address Validation did not return coordinates for: "${address}"`);
          }
        }
      }
    } catch (err: any) {
      console.error(`[GEOCODER EXCEPTION] Google geocode failed for "${address}":`, err.message);
    }
  }

  // 2. Try US Census Geocoder as fallback
  const censusUrl = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
  try {
    console.log(`[GEOCODER] Trying US Census Geocoder fallback for: "${address}"`);
    const resp = await axios.get(censusUrl, { timeout: 6000 });
    if (
      resp.status === 200 &&
      resp.data &&
      resp.data.result &&
      resp.data.result.addressMatches &&
      resp.data.result.addressMatches.length > 0
    ) {
      const match = resp.data.result.addressMatches[0];
      const lat = match.coordinates.y;
      const lon = match.coordinates.x;
      
      console.log(`[GEOCODER SUCCESS] US Census matched: "${address}" -> (${lat}, ${lon})`);
      await db.execute({
        sql: "INSERT OR REPLACE INTO geocode_cache (address, lat, lon) VALUES (?, ?, ?)",
        args: [address, lat, lon]
      });
      return { lat, lon };
    }
  } catch (err: any) {
    console.warn(`[GEOCODER INFO] US Census did not match "${address}":`, err.message);
  }

  // 3. Fall back to OpenStreetMap Nominatim (if cooldown is not active)
  if (Date.now() < rateLimitCooldownUntil) {
    console.log(`[GEOCODER SKIP] Nominatim cooldown active. Skipping Nominatim search for "${address}".`);
    return null;
  }

  const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}`;
  try {
    console.log(`[GEOCODER] Falling back to Nominatim for: "${address}"`);
    const resp = await axios.get(nominatimUrl, {
      headers: {
        "User-Agent": "TzelRealEstateTacticalRadar/1.0 (miguel@tzel.com)"
      },
      timeout: 5000
    });
    
    if (resp.status === 200 && Array.isArray(resp.data) && resp.data.length > 0) {
      const lat = parseFloat(resp.data[0].lat);
      const lon = parseFloat(resp.data[0].lon);
      
      console.log(`[GEOCODER SUCCESS] Nominatim matched: "${address}" -> (${lat}, ${lon})`);
      await db.execute({
        sql: "INSERT OR REPLACE INTO geocode_cache (address, lat, lon) VALUES (?, ?, ?)",
        args: [address, lat, lon]
      });
      return { lat, lon };
    } else {
      console.log(`[GEOCODER WARNING] No results found in Nominatim for address: "${address}"`);
      await db.execute({
        sql: "INSERT OR REPLACE INTO geocode_cache (address, lat, lon) VALUES (?, NULL, NULL)",
        args: [address]
      });
    }
  } catch (err: any) {
    console.error(`[GEOCODER EXCEPTION] Failed Nominatim geocode for "${address}":`, err.message);
    if (err.response && err.response.status === 429) {
      rateLimitCooldownUntil = Date.now() + 5 * 60 * 1000; // 5 min cooldown
      console.warn(`[GEOCODER] Nominatim returned 429. Cooldown enabled for 5 minutes.`);
    }
  }

  return null;
}


let cachedProspectos: any[] | null = null;
let lastCacheTime = 0;
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes cache TTL

app.get("/api/prospectos", async (req, res) => {
  console.log("[API] /api/prospectos requested");

  const forceRefresh = req.query.refresh === "true";
  if (cachedProspectos && (Date.now() - lastCacheTime < CACHE_TTL) && !forceRefresh) {
    console.log("[API] Returning cached prospectos list instantly");
    return res.json({ status: "success", count: cachedProspectos.length, data: cachedProspectos });
  }

  try {
    console.log("[API] Fetching prospectos from Turso DB in batch...");
    const batchRes = await db.batch([
      // 0. foreclosure_auctions
      `SELECT 
        auction_id, case_number, address, county, state, auction_date, 
        plaintiff, defendant, debt_amount, appraisal_value, 
        mls_estimated_value, mls_id, pdf_url,
        defendant_phones, defendant_emails, needs_manual_review,
        mailing_address, absentee_owner, sqft, beds, baths, hidden_mortgages, hidden_liens_amount, photo_urls,
        title_check_status, next_retry_date, forensic_legal_story
      FROM foreclosure_auctions
      WHERE (mls_status IS NULL OR mls_status != 'resolved')`,
      // 1. code_violations
      `SELECT 
        violation_id, case_number, address, violation_type, report_date, status, 
        owner_name, mls_estimated_value, mls_id, defendant_phones, defendant_emails,
        mailing_address, absentee_owner, sqft, beds, baths, hidden_mortgages, hidden_liens_amount, photo_urls,
        title_check_status
      FROM code_violations`,
      // 2. probates
      `SELECT probate_id, case_number, address, county, state, deceased_name, heir_name, heir_phones, heir_emails
      FROM probates`,
      // 3. divorces
      `SELECT divorce_id, case_number, address, county, state, spouse_a, spouse_b, spouse_a_phones, spouse_a_emails, spouse_b_phones, spouse_b_emails
      FROM divorces`,
      // 4. bankruptcies
      `SELECT bankruptcy_id, case_number, address, county, state, debtor_name, bankruptcy_type, debtor_phones, debtor_emails
      FROM bankruptcies`,
      // 5. physical_distress
      `SELECT distress_id, address, county, state, distress_type, report_date, details, owner_name,
             mls_estimated_value, mls_id, defendant_phones, defendant_emails, mailing_address, absentee_owner, 
             sqft, beds, baths, hidden_mortgages, hidden_liens_amount, photo_urls,
             ef_scale, nws_survey_details, wind_speed_est
      FROM physical_distress`,
      // 6. financial_distress
      `SELECT record_id, case_number, address, county, state, record_type, debt_amount, owner_name, plaintiff, report_date,
             mls_estimated_value, mls_id, defendant_phones, defendant_emails, mailing_address, absentee_owner, sqft, beds, baths, hidden_mortgages, hidden_liens_amount, photo_urls
      FROM financial_distress`,
      // 7. life_events
      `SELECT event_id, event_type, subject_name, address, county, state, details, report_date,
             mls_estimated_value, mls_id, defendant_phones, defendant_emails, mailing_address, absentee_owner, sqft, beds, baths, hidden_mortgages, hidden_liens_amount, photo_urls
      FROM life_events`,
      // 8. geocode_cache
      `SELECT address, lat, lon FROM geocode_cache`,
      // 9. osint_enrichment
      `SELECT address_key, llc_directors, corporate_address, social_profiles, usernames_found, env_stressors, env_attractors FROM osint_enrichment`,
      // 10. pre_foreclosures
      `SELECT pre_foreclosure_id, case_number, address, county, state, filing_date, plaintiff, defendant, case_status, days_since_filing, defendant_phones, defendant_emails, mailing_address, absentee_owner, photo_urls FROM pre_foreclosures`,
      // 11. tax_sales
      `SELECT tax_sale_id, parcel_id, address, county, state, owner_name, taxes_owed, sale_date, defendant_phones, defendant_emails, mailing_address, absentee_owner, photo_urls FROM tax_sales`,
      // 12. tzel_events
      `SELECT * FROM tzel_events ORDER BY event_date ASC`,
      // 13. tzel_encumbrances
      `SELECT * FROM tzel_encumbrances ORDER BY priority ASC`,
      // 14. tzel_opportunity_scores
      `SELECT * FROM tzel_opportunity_scores`,
      // 15. tzel_acquisition_state
      `SELECT * FROM tzel_acquisition_state`
    ], "read");

    const auctionsRes = batchRes[0];
    const violationsRes = batchRes[1];
    const probatesRes = batchRes[2];
    const divorcesRes = batchRes[3];
    const bankruptciesRes = batchRes[4];
    const physicalRes = batchRes[5];
    const financialRes = batchRes[6];
    const lifeEventsRes = batchRes[7];
    const cacheRes = batchRes[8];
    const osintRes = batchRes[9];
    const preForeclosuresRes = batchRes[10];
    const taxSalesRes = batchRes[11];
    const eventsRes = batchRes[12];
    const encumbrancesRes = batchRes[13];
    const opportunityScoresRes = batchRes[14];
    const acquisitionStateRes = batchRes[15];

    // Defensa: una sola fila con address NULL/vacío tumbaba todo el endpoint (getGroupingKey(null)).
    const LEAD_TABLE_INDEXES = [0, 1, 2, 3, 4, 5, 6, 7, 10, 11];
    let droppedNoAddress = 0;
    for (const idx of LEAD_TABLE_INDEXES) {
      const rows = batchRes[idx].rows;
      const kept = rows.filter(r => typeof r.address === "string" && r.address.trim().length > 0);
      if (kept.length !== rows.length) {
        droppedNoAddress += rows.length - kept.length;
        rows.splice(0, rows.length, ...kept);
      }
    }
    if (droppedNoAddress > 0) {
      console.warn(`[API] /api/prospectos: ${droppedNoAddress} filas descartadas por no tener dirección.`);
    }

    // Filter auctions to next 60 days or Indiana manual reviews
    const opportunities = auctionsRes.rows.filter(row => {
      const state = (row.state as string || "").toUpperCase();
      if (state !== "KY" && state !== "IN") return false;
      const dateStr = row.auction_date as string;
      const daysRemaining = getDaysRemaining(dateStr);
      if (daysRemaining === null) return true; // Keep manual reviews
      if (row.forensic_legal_story || (row.needs_manual_review as number) === 1) return true; // Retener casos auditados por IA
      return daysRemaining >= -45 && daysRemaining <= 60; // Ventana de 60 días futuros y 45 días post-remate (redención/confirmación)
    });

    const violations = violationsRes.rows;

    const probates = probatesRes.rows.filter(row => {
      const state = (row.state as string || "").toUpperCase();
      return state === "KY" || state === "IN";
    });

    const divorces = divorcesRes.rows.filter(row => {
      const state = (row.state as string || "").toUpperCase();
      return state === "KY" || state === "IN";
    });

    const bankruptcies = bankruptciesRes.rows.filter(row => {
      const state = (row.state as string || "").toUpperCase();
      return state === "KY" || state === "IN";
    });

    const physicalDistressList = physicalRes.rows.filter(row => {
      const state = (row.state as string || "").toUpperCase();
      return state === "KY" || state === "IN";
    });

    const financialDistressList = financialRes.rows.filter(row => {
      const state = (row.state as string || "").toUpperCase();
      return state === "KY" || state === "IN";
    });

    const lifeEventsList = lifeEventsRes.rows.filter(row => {
      const state = (row.state as string || "").toUpperCase();
      return state === "KY" || state === "IN";
    });

    // Grouping map
    const groupedMap = new Map<string, GroupedLead>();

    // A–J. Agrupar todas las fuentes por dirección normalizada con un único merge (antes: 10 bloques copiados).
    for (const row of opportunities) {
      mergeLeadRow(groupedMap, row, {
        bucket: "auctions",
        owner: r => r.defendant,
        ownerFallback: "No especificado",
        phones: r => splitContacts(r.defendant_phones),
        emails: r => splitContacts(r.defendant_emails)
      });
    }

    for (const row of violations) {
      mergeLeadRow(groupedMap, row, {
        bucket: "violations",
        owner: r => r.owner_name,
        ownerFallback: "DUEÑO DESCONOCIDO",
        phones: r => splitContacts(r.defendant_phones),
        emails: r => splitContacts(r.defendant_emails)
      });
    }

    for (const row of probates) {
      mergeLeadRow(groupedMap, row, {
        bucket: "probates",
        owner: r => r.heir_name,
        ownerFallback: "Heredero Desconocido",
        phones: r => splitContacts(r.heir_phones),
        emails: r => splitContacts(r.heir_emails),
        preferLongerAddress: false
      });
    }

    for (const row of divorces) {
      mergeLeadRow(groupedMap, row, {
        bucket: "divorces",
        owner: r => [r.spouse_a, r.spouse_b].filter(Boolean).join(" & "),
        ownerFallback: "No especificado",
        phones: r => splitContacts(r.spouse_a_phones, r.spouse_b_phones),
        emails: r => splitContacts(r.spouse_a_emails, r.spouse_b_emails),
        mergeOwner: false,
        preferLongerAddress: false
      });
    }

    for (const row of bankruptcies) {
      mergeLeadRow(groupedMap, row, {
        bucket: "bankruptcies",
        owner: r => r.debtor_name,
        ownerFallback: "Deudor Desconocido",
        phones: r => splitContacts(r.debtor_phones),
        emails: r => splitContacts(r.debtor_emails),
        preferLongerAddress: false
      });
    }

    for (const row of physicalDistressList) {
      mergeLeadRow(groupedMap, row, {
        bucket: "physicalDistress",
        owner: r => r.owner_name,
        ownerFallback: "DUEÑO DESCONOCIDO",
        phones: r => splitContacts(r.defendant_phones),
        emails: r => splitContacts(r.defendant_emails)
      });
    }

    for (const row of financialDistressList) {
      mergeLeadRow(groupedMap, row, {
        bucket: "financialDistress",
        owner: r => r.owner_name,
        ownerFallback: "DUEÑO DESCONOCIDO",
        phones: r => splitContacts(r.defendant_phones),
        emails: r => splitContacts(r.defendant_emails)
      });
    }

    for (const row of lifeEventsList) {
      mergeLeadRow(groupedMap, row, {
        bucket: "lifeEvents",
        owner: r => r.subject_name,
        ownerFallback: "No especificado",
        phones: r => splitContacts(r.defendant_phones),
        emails: r => splitContacts(r.defendant_emails)
      });
    }

    for (const row of (preForeclosuresRes.rows || [])) {
      mergeLeadRow(groupedMap, row, {
        bucket: "preForeclosures",
        owner: r => r.defendant,
        ownerFallback: "No especificado",
        phones: r => splitContacts(r.defendant_phones),
        emails: r => splitContacts(r.defendant_emails)
      });
    }

    for (const row of (taxSalesRes.rows || [])) {
      mergeLeadRow(groupedMap, row, {
        bucket: "taxSales",
        owner: r => r.owner_name,
        ownerFallback: "No especificado",
        phones: r => splitContacts(r.defendant_phones),
        emails: r => splitContacts(r.defendant_emails),
        defaultState: "IN",
        defaultCounty: "Clark"
      });
    }

    // Pre-cargar la caché de geocodificación en memoria para evitar el problema de consultas N+1
    const geocodeMap = new Map<string, { lat: number; lon: number }>();
    const geocodeKeyMap = new Map<string, { lat: number; lon: number }>();
    for (const row of cacheRes.rows) {
      if (row.address && row.lat !== null && row.lon !== null) {
        const coords = { lat: row.lat as number, lon: row.lon as number };
        geocodeMap.set(row.address as string, coords);
        const gKey = getGroupingKey(row.address as string);
        if (!geocodeKeyMap.has(gKey)) {
          geocodeKeyMap.set(gKey, coords);
        }
      }
    }

    // Pre-cargar la base de datos de enriquecimiento OSINT en lote
    const osintMap = new Map<string, any>();
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


    // Pre-cargar eventos, encumbrances y opportunity scores del nuevo Grafo
    const eventsMap = new Map<string, any[]>();
    for (const row of eventsRes.rows) {
      const pid = row.property_id as string;
      if (!eventsMap.has(pid)) eventsMap.set(pid, []);
      eventsMap.get(pid)!.push(row);
    }

    const encumbrancesMap = new Map<string, any[]>();
    for (const row of encumbrancesRes.rows) {
      const pid = row.property_id as string;
      if (!encumbrancesMap.has(pid)) encumbrancesMap.set(pid, []);
      encumbrancesMap.get(pid)!.push(row);
    }

    const scoresMap = new Map<string, any>();
    for (const row of opportunityScoresRes.rows) {
      const pid = row.property_id as string;
      scoresMap.set(pid, {
        opportunityScore: row.opportunity_score as number,
        equityScore: row.equity_score as number,
        motivationScore: row.motivation_score as number,
        accessibilityScore: row.accessibility_score as number,
        legalRiskScore: row.legal_risk_score as number,
        tacticalAction: row.tactical_action as string,
        underwritingSummary: safeJsonParse(row.underwriting_summary as string | null)
      });
    }

    // Pre-cargar acquisition state (Pipeline Kanban & Call Dispositions)
    const acquisitionMap = new Map<string, any>();
    for (const row of (acquisitionStateRes.rows || [])) {
      const pid = row.property_id as string;
      acquisitionMap.set(pid, row);
    }

    // Geocodificar y calcular variables en lote
    const responseData: any[] = [];

    for (const lead of groupedMap.values()) {
      const hasAuctions = lead.auctions.length > 0;
      const hasViolations = lead.violations.length > 0;
      const hasProbates = lead.probates.length > 0;
      const hasDivorces = lead.divorces.length > 0;
      const hasBankruptcies = lead.bankruptcies.length > 0;

      // Calcular Underwriting
      const violationKeywords = lead.violations.map(v => v.violation_type as string);
      const rehabKeywords = violationKeywords.concat(lead.physicalDistress.map(p => p.distress_type as string)).filter(Boolean);
      const hiddenDebt = lead.hiddenMortgages || 0;

      const rawAppraisal = (lead.auctions && lead.auctions.length > 0 && lead.auctions[0].appraisal_value > 0) 
        ? Number(lead.auctions[0].appraisal_value) 
        : 0;
      const rawMls = lead.mlsValue || 0;
      let effectiveMarketValue = rawAppraisal > 0 ? rawAppraisal : rawMls;
      if (rawAppraisal > 0 && rawMls > 0) {
        if (rawAppraisal < 35000 && rawMls >= 50000) effectiveMarketValue = rawMls;
        else if (rawAppraisal < rawMls * 0.35) effectiveMarketValue = rawMls;
      }

      const rehab = calculateRehab(lead.sqft || null, rehabKeywords, effectiveMarketValue);
      const mao = calculateMAO(effectiveMarketValue, rehab, hiddenDebt, lead.hiddenLiensAmount);
      const primaryDebt = hasAuctions ? Math.max(...lead.auctions.map(a => (a.debt_amount as number) || 0)) : 0;
      const netEquity = calculateNetEquity(effectiveMarketValue, primaryDebt, hiddenDebt, lead.hiddenLiensAmount);
      const purchasePrice = primaryDebt > 0 ? primaryDebt : mao;
      const { roi, totalCost } = calculateROI(effectiveMarketValue, purchasePrice, rehab);

      // Institutional Multilayer Underwriting (incluye offerTiers del motor único 65/70/75%)
      const totalConsolidatedDebt = primaryDebt + hiddenDebt + (lead.hiddenLiensAmount || 0);
      const institutionalUW = calculateInstitutionalUnderwriting(effectiveMarketValue, lead.sqft || null, rehabKeywords, totalConsolidatedDebt, lead.state, rawAppraisal);
      const offerTiers = institutionalUW.offerTiers;

      // Regla de Stacking / Alta Motivación
      let isHighMotivation = false;
      if (hasAuctions) {
        const firstAuction = lead.auctions[0];
        const daysRemaining = getDaysRemaining(firstAuction.auction_date);
        if (daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 60) {
          if (hasViolations || primaryDebt > 0 || hiddenDebt > 0 || lead.hiddenLiensAmount > 0) {
            isHighMotivation = true;
          }
        }
      }

      // Check geocode cache first from memory map (exact address or normalized groupingKey)
      const coords = geocodeMap.get(lead.displayAddress) || geocodeKeyMap.get(lead.groupingKey) || null;

      // Confidence Radar & Forensic Verification Status
      // Niveles por evidencia (sin falsa precisión): 100 = verificado, 50-70 = fuente parcial, 0 = sin dato.
      const hasGeocode = coords && coords.lat !== null;
      const geocodeConf = hasGeocode ? 100 : 0;
      const ownerConf = isValidOwnerName(lead.ownerName) ? 100 : 0;
      const debtConf = lead.titleCheckStatus === 'success' ? 100 : (primaryDebt > 0 ? 70 : 0);
      const overallConf = Math.round((geocodeConf * 0.35) + (ownerConf * 0.35) + (debtConf * 0.30));

      let forensicStatus = 'HIGH_CONFIDENCE';
      if (hasGeocode && isValidOwnerName(lead.ownerName) && (lead.titleCheckStatus === 'success' || primaryDebt > 0)) {
        forensicStatus = 'AUTO_VERIFIED';
      } else if (!hasGeocode || !isValidOwnerName(lead.ownerName)) {
        forensicStatus = 'NEEDS_REVIEW';
      }

      // Fetch OSINT Enrichment
      const osint = osintMap.get(lead.groupingKey) || {
        llcDirectors: [],
        corporateAddress: "",
        socialProfiles: [],
        usernamesFound: [],
        envStressors: [],
        envAttractors: []
      };

      const propertyId = buildPropertyId(lead.groupingKey);
      const propEvents = eventsMap.get(propertyId) || [];
      const propEncumbrances = encumbrancesMap.get(propertyId) || [];
      const scoreObj = scoresMap.get(propertyId) || {
        opportunityScore: 50,
        tacticalAction: 'REVISIÓN PRELIMINAR DE EXPEDIENTE'
      };

      let oppScore = scoreObj.opportunityScore;
      let tactAction = scoreObj.tacticalAction;
      // AGENTS.md §2.A: isUnknownOwner = !ownerName || /desconocido|unknown|no especificado/i (misma regla que el cliente).
      const isUnverifiedOwner = !isValidOwnerName(lead.ownerName) || /desconocido|unknown|no especificado/i.test(lead.ownerName || "");

      // AGENTS.md §2.A (invariante): totalDebt === 0 || marketValue <= 0 || isUnknownOwner → score capado a 20.
      // totalDebt usa la misma definición que el cliente: deuda judicial + hipotecas ocultas + gravámenes.
      const isIncompleteDocket = totalConsolidatedDebt <= 0 || effectiveMarketValue <= 0 || isUnverifiedOwner;
      if (isIncompleteDocket) {
        oppScore = Math.min(typeof oppScore === "number" ? oppScore : 20, 20);
        tactAction = 'EXPEDIENTE INCOMPLETO: AUDITAR EN CORTE';
      }

      const zipMatches = lead.displayAddress ? lead.displayAddress.match(/\b\d{5}\b/g) : null;
      const zipCode = zipMatches ? zipMatches[zipMatches.length - 1] : (lead.mailingAddress ? (lead.mailingAddress.match(/\b\d{5}\b/)?.[0] || "") : "");

      responseData.push({
        groupingKey: lead.groupingKey,
        propertyId: propertyId,
        displayAddress: lead.displayAddress,
        zipCode: zipCode,
        state: lead.state,
        county: lead.county,
        ownerName: lead.ownerName,
        phones: Array.from(lead.phones),
        emails: Array.from(lead.emails),
        mlsValue: lead.mlsValue,
        mlsId: lead.mlsId,
        auctions: lead.auctions,
        violations: lead.violations,
        probates: lead.probates,
        divorces: lead.divorces,
        bankruptcies: lead.bankruptcies,
        physicalDistress: lead.physicalDistress,
        financialDistress: lead.financialDistress,
        lifeEvents: lead.lifeEvents,
        preForeclosures: lead.preForeclosures || [],
        taxSales: lead.taxSales || [],
        eventsTimeline: propEvents,
        encumbrancesLadder: propEncumbrances,
        opportunityScore: oppScore,
        tacticalAction: tactAction,
        institutionalUW,
        offerTiers,
        effectiveMarketValue,
        confidenceBreakdown: {
          geocodeConfidence: geocodeConf,
          ownerConfidence: ownerConf,
          debtConfidence: debtConf,
          overallConfidence: overallConf
        },
        forensicStatus,
        hiddenMortgages: hiddenDebt,
        hiddenLiensAmount: lead.hiddenLiensAmount,
        titleCheckStatus: lead.titleCheckStatus,
        nextRetryDate: lead.nextRetryDate,
        isAbsentee: lead.isAbsentee,
        rehab,
        mao,
        primaryDebt,
        netEquity,
        roi,
        totalCost,
        isHighMotivation,
        lat: coords ? coords.lat : (lead.landbankInfo && Number(lead.landbankInfo.lat) ? Number(lead.landbankInfo.lat) : null),
        lon: coords ? coords.lon : (lead.landbankInfo && Number(lead.landbankInfo.lon) ? Number(lead.landbankInfo.lon) : null),
        photoUrls: lead.photoUrls,
        beds: lead.beds,
        baths: lead.baths,
        sqft: lead.sqft,
        llcDirectors: osint.llcDirectors,
        corporateAddress: osint.corporateAddress,
        socialProfiles: osint.socialProfiles,
        usernamesFound: osint.usernamesFound,
        envStressors: osint.envStressors,
        envAttractors: osint.envAttractors,
        landbankInfo: lead.landbankInfo || null,
        propertyType: lead.landbankInfo?.property_type || "Single Family",
        acquisitionState: acquisitionMap.get(propertyId) || acquisitionMap.get(lead.groupingKey) || null,
        forensicLegalStory: lead.forensicLegalStory || (lead.auctions && lead.auctions[0] && lead.auctions[0].forensic_legal_story) || undefined
      });
    }

    // Trigger background geocoding check without blocking the response
    startBackgroundGeocoding().catch(err => {
      console.error("[BG GEOCODER TRIGGER ERROR]", err.message);
    });

    cachedProspectos = responseData;
    lastCacheTime = Date.now();

    res.json({ status: "success", count: responseData.length, data: responseData });
  } catch (err: any) {
    console.error("[API ERROR] Failed to fetch leads:", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// Call Logs Table Setup
db.execute(`
  CREATE TABLE IF NOT EXISTS tzel_call_logs (
    log_id TEXT PRIMARY KEY,
    property_id TEXT NOT NULL,
    phone_dialed TEXT NOT NULL,
    contact_name TEXT,
    outcome TEXT NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`).catch(e => console.error("[DB INIT tzel_call_logs ERROR]", e.message));

app.get("/api/call-logs", async (req, res) => {
  try {
    const propertyId = req.query.property_id as string;
    if (!propertyId) {
      const allLogs = await db.execute("SELECT * FROM tzel_call_logs ORDER BY created_at DESC LIMIT 50");
      return res.json({ status: "success", logs: allLogs.rows });
    }
    const logs = await db.execute({
      sql: "SELECT * FROM tzel_call_logs WHERE property_id = ? ORDER BY created_at DESC",
      args: [propertyId]
    });
    res.json({ status: "success", logs: logs.rows });
  } catch (err: any) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.post("/api/call-logs", async (req, res) => {
  try {
    const { property_id, phone_dialed, contact_name, outcome, disposition, notes } = req.body;
    const finalOutcome = outcome || disposition;
    if (!property_id || !finalOutcome) {
      return res.status(400).json({ status: "error", message: "Missing property_id or outcome" });
    }
    const logId = `CALL_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await db.execute({
      sql: "INSERT INTO tzel_call_logs (log_id, property_id, phone_dialed, contact_name, outcome, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
      args: [logId, property_id, phone_dialed || 'N/A', contact_name || '', finalOutcome, notes || '']
    });
    console.log(`[CALL LOG REGISTERED] ${phone_dialed || 'N/A'} -> ${finalOutcome} for property ${property_id}`);
    res.json({ status: "success", log_id: logId });
  } catch (err: any) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

// Acquisition Operating System: State Management Endpoints
app.get("/api/acquisition-state", async (req, res) => {
  try {
    const propertyId = req.query.property_id as string;
    if (propertyId) {
      const row = await db.execute({
        sql: "SELECT * FROM tzel_acquisition_state WHERE property_id = ?",
        args: [propertyId]
      });
      return res.json({ status: "success", data: row.rows[0] || null });
    }
    const allRows = await db.execute("SELECT * FROM tzel_acquisition_state ORDER BY updated_at DESC");
    const stateMap: Record<string, any> = {};
    for (const r of allRows.rows) {
      stateMap[r.property_id as string] = r;
    }
    res.json({ status: "success", count: allRows.rows.length, data: stateMap });
  } catch (err: any) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.post("/api/acquisition-state", async (req, res) => {
  try {
    const {
      property_id,
      stage,
      motivation,
      estimated_motivation,
      asking_price,
      debt,
      negotiation_position,
      next_action,
      follow_up_date,
      offer_conservative,
      offer_target,
      offer_max,
      disposition,
      notes
    } = req.body;

    if (!property_id) {
      return res.status(400).json({ status: "error", message: "property_id is required" });
    }

    await db.execute({
      sql: `
        INSERT INTO tzel_acquisition_state (
          property_id, stage, motivation, estimated_motivation, asking_price, debt,
          negotiation_position, next_action, follow_up_date, offer_conservative,
          offer_target, offer_max, disposition, notes, updated_at
        ) VALUES (?, COALESCE(?, 'NEW'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(property_id) DO UPDATE SET
          stage = COALESCE(?, tzel_acquisition_state.stage),
          motivation = COALESCE(excluded.motivation, tzel_acquisition_state.motivation),
          estimated_motivation = COALESCE(excluded.estimated_motivation, tzel_acquisition_state.estimated_motivation),
          asking_price = COALESCE(excluded.asking_price, tzel_acquisition_state.asking_price),
          debt = COALESCE(excluded.debt, tzel_acquisition_state.debt),
          negotiation_position = COALESCE(excluded.negotiation_position, tzel_acquisition_state.negotiation_position),
          next_action = COALESCE(excluded.next_action, tzel_acquisition_state.next_action),
          follow_up_date = COALESCE(excluded.follow_up_date, tzel_acquisition_state.follow_up_date),
          offer_conservative = COALESCE(excluded.offer_conservative, tzel_acquisition_state.offer_conservative),
          offer_target = COALESCE(excluded.offer_target, tzel_acquisition_state.offer_target),
          offer_max = COALESCE(excluded.offer_max, tzel_acquisition_state.offer_max),
          disposition = COALESCE(excluded.disposition, tzel_acquisition_state.disposition),
          notes = COALESCE(excluded.notes, tzel_acquisition_state.notes),
          updated_at = datetime('now')
      `,
      args: [
        property_id,
        stage || null, // INSERT: COALESCE → 'NEW' solo en la primera inserción
        motivation || null,
        estimated_motivation || null,
        asking_price || null,
        debt || null,
        negotiation_position || null,
        next_action || null,
        follow_up_date || null,
        offer_conservative || null,
        offer_target || null,
        offer_max || null,
        disposition || null,
        notes || null,
        stage || null // UPDATE: sin stage explícito se conserva la etapa actual (antes se reseteaba a NEW)
      ]
    });

    // Also register call log if disposition was provided
    if (disposition) {
      const logId = `CALL_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      await db.execute({
        sql: "INSERT INTO tzel_call_logs (log_id, property_id, phone_dialed, contact_name, outcome, notes, created_at) VALUES (?, ?, 'N/A', '', ?, ?, datetime('now'))",
        args: [logId, property_id, disposition, notes || '']
      }).catch(() => {});
    }

    cachedProspectos = null; // la etapa/disposición forma parte de /api/prospectos
    console.log(`[ACQUISITION STATE SAVED] ${property_id} -> Stage: ${stage || 'unchanged'} | Disp: ${disposition || 'none'}`);
    res.json({ status: "success", property_id });
  } catch (err: any) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.get("/api/surplus", async (req, res) => {
  console.log("[API] /api/surplus requested");
  try {
    const surplusRes = await db.execute(`
      SELECT 
        surplus_id, owner_name, address, winning_bid, judgment_amount, 
        surplus_amount, auction_date, county, state, defendant_phones, defendant_emails
      FROM surplus_funds
      ORDER BY surplus_amount DESC
    `);
    
    res.json({ status: "success", count: surplusRes.rows.length, data: surplusRes.rows });
  } catch (err: any) {
    console.error("[API ERROR] Failed to fetch surplus funds:", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

// Louisville Lands & Vacant Lots Discovery Hub (Strictly pure vacant lots)
app.get("/api/lands", async (req, res) => {
  console.log("[API] /api/lands requested");
  try {
    const { buildable, status, zip, search, minPrice, maxPrice, sort } = req.query;

    let query = `
      SELECT parcel_id, address, asking_price, estimated_value, property_type,
             program_name, buildable_lot, council_district, category, property_status,
             sqft, acres, lat, lon, county, state, is_high_yield, created_at
      FROM landbank_inventory
      WHERE property_type = 'Lot'
    `;
    const conditions: string[] = [];
    const args: any[] = [];

    // Filter by buildability
    if (buildable === 'yes') {
      conditions.push("(buildable_lot = 'Yes' OR buildable_lot = 'yes')");
    } else if (buildable === 'no') {
      conditions.push("(buildable_lot = 'No' OR buildable_lot = 'no')");
    }

    // Filter by availability status
    if (status === 'available') {
      conditions.push("(property_status = 'Available' OR category LIKE '%Available%')");
    }

    if (zip && typeof zip === 'string' && zip.trim().length > 0) {
      conditions.push("address LIKE ?");
      args.push(`%${zip.trim()}%`);
    }

    if (search && typeof search === 'string' && search.trim().length > 0) {
      conditions.push("(address LIKE ? OR parcel_id LIKE ?)");
      args.push(`%${search.trim()}%`, `%${search.trim()}%`);
    }

    if (minPrice && !isNaN(Number(minPrice))) {
      conditions.push("asking_price >= ?");
      args.push(Number(minPrice));
    }
    if (maxPrice && !isNaN(Number(maxPrice))) {
      conditions.push("asking_price <= ?");
      args.push(Number(maxPrice));
    }

    if (conditions.length > 0) {
      query += " AND " + conditions.join(" AND ");
    }

    if (sort === 'price_asc') {
      query += " ORDER BY asking_price ASC, parcel_id ASC";
    } else if (sort === 'price_desc') {
      query += " ORDER BY asking_price DESC";
    } else if (sort === 'value_desc') {
      query += " ORDER BY estimated_value DESC";
    } else if (sort === 'sqft_desc') {
      query += " ORDER BY sqft DESC";
    } else if (sort === 'zip') {
      query += " ORDER BY address ASC";
    } else {
      query += " ORDER BY CASE WHEN (buildable_lot = 'Yes' OR buildable_lot = 'yes') THEN 0 ELSE 1 END, estimated_value DESC, asking_price ASC";
    }

    const result = await db.execute({ sql: query, args });

    // Key Performance Indicators (KPIs)
    const kpiRes = await db.execute(`
      SELECT 
        COUNT(*) as total_lots,
        SUM(CASE WHEN (buildable_lot = 'Yes' OR buildable_lot = 'yes') THEN 1 ELSE 0 END) as buildable_lots,
        SUM(CASE WHEN (property_status = 'Available' OR category LIKE '%Available%') THEN 1 ELSE 0 END) as available_lots,
        SUM(CASE WHEN asking_price <= 500 THEN 1 ELSE 0 END) as dollar_lots,
        SUM(CASE WHEN is_high_yield = 1 THEN 1 ELSE 0 END) as high_yield_lots
      FROM landbank_inventory
      WHERE property_type = 'Lot'
    `);

    // Top Zip codes
    const zipRes = await db.execute(`
      SELECT 
        SUBSTR(address, -5) as zip_code,
        COUNT(*) as count
      FROM landbank_inventory
      WHERE property_type = 'Lot'
      GROUP BY zip_code
      ORDER BY count DESC
      LIMIT 8
    `);

    res.json({
      status: "success",
      count: result.rows.length,
      kpis: kpiRes.rows[0] || {},
      topZips: zipRes.rows || [],
      data: result.rows
    });
  } catch (err: any) {
    console.error("[API ERROR] /api/lands failed:", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.post("/api/lands/refresh", async (req, res) => {
  try {
    const { scrapeLandbank } = await import("./scrapers/scrape_landbank");
    scrapeLandbank().then(count => {
      console.log(`[LANDBANK SCRAPER TRIGGERED] Ingestados ${count} registros.`);
      cachedProspectos = null;
    }).catch(err => {
      console.error("[LANDBANK SCRAPER ERROR]", err.message);
    });

    res.json({
      status: "success",
      message: "Actualización de terrenos del Louisville Landbank iniciada en segundo plano."
    });
  } catch (err: any) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.get("/api/guiones", async (req, res) => {
  console.log("[API] /api/guiones requested");
  try {
    const fs = require("fs");
    const path = require("path");
    const scriptsPath = path.resolve("./telephony_scripts.json");
    if (fs.existsSync(scriptsPath)) {
      const data = JSON.parse(fs.readFileSync(scriptsPath, "utf-8"));
      res.json(data);
    } else {
      res.status(404).json({ status: "error", message: "Telephony scripts file not found" });
    }
  } catch (err: any) {
    console.error("[API ERROR] Failed to load telephony scripts:", err.message);
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.get("/api/mca", async (req, res) => {
  const address = req.query.address as string;
  const rawState = (req.query.state as string || "KY").toUpperCase();
  const state = rawState === "IN" ? "IN" : "KY"; // whitelist: evita inyección en el filtro OData
  const odataLiteral = (v: string) => String(v).replace(/'/g, "''");

  if (!address) {
    return res.status(400).json({ status: "error", message: "Falta el parámetro address" });
  }

  try {
    const token = process.env.SPARK_ACCESS_TOKEN_1;
    if (!token) {
      return res.status(500).json({ status: "error", message: "SPARK_ACCESS_TOKEN_1 no configurado" });
    }

    const url = "https://replication.sparkapi.com/Reso/OData/Property";
    const headers = {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json"
    };

    // 1. Normalizar y parsear dirección
    const { houseNumber, coreWords } = parseAddress(address);
    if (!houseNumber) {
      return res.json({ status: "error", message: "No se pudo extraer el número de casa de la dirección" });
    }

    // 2. Intentar buscar características de la propiedad en la base de datos local
    let dbSpecs: { beds: number | null, baths: number | null, sqft: number | null, mls_id: string | null, appraisal_value: number | null, county: string | null } = {
      beds: null,
      baths: null,
      sqft: null,
      mls_id: null,
      appraisal_value: null,
      county: null
    };

    const targetKey = getGroupingKey(address);
    const tables = ["foreclosure_auctions", "code_violations", "physical_distress", "financial_distress", "life_events"];
    for (const table of tables) {
      try {
        const resDb = await db.execute({
          sql: `SELECT address, beds, baths, sqft, mls_id, appraisal_value, county FROM ${table} WHERE address LIKE ?`,
          args: [`%${houseNumber}%`]
        });
        for (const row of resDb.rows) {
          const rowAddr = row.address as string;
          if (rowAddr && getGroupingKey(rowAddr) === targetKey) {
            const rowBeds = row.beds !== null && row.beds !== undefined ? Number(row.beds) : null;
            const rowBaths = row.baths !== null && row.baths !== undefined ? Number(row.baths) : null;
            const rowSqft = row.sqft !== null && row.sqft !== undefined ? Number(row.sqft) : null;
            const rowMlsId = row.mls_id as string || null;
            const rowAppraisal = row.appraisal_value !== null && row.appraisal_value !== undefined ? Number(row.appraisal_value) : null;
            const rowCounty = row.county as string || null;
            
            if (rowBeds !== null || rowSqft !== null || rowMlsId !== null || rowAppraisal !== null) {
              if (rowBeds !== null) dbSpecs.beds = rowBeds;
              if (rowBaths !== null) dbSpecs.baths = rowBaths;
              if (rowSqft !== null) dbSpecs.sqft = rowSqft;
              if (rowMlsId !== null) dbSpecs.mls_id = rowMlsId;
              if (rowAppraisal !== null) dbSpecs.appraisal_value = rowAppraisal;
              if (rowCounty !== null) dbSpecs.county = rowCounty;
              break;
            }
          }
        }
        if (dbSpecs.beds !== null || dbSpecs.sqft !== null || dbSpecs.appraisal_value !== null) {
          break;
        }
      } catch (dbErr: any) {}
    }

    // 3. Buscar características en el MLS (Spark API)
    console.log(`[MCA API] Buscando propiedad objetivo: "${address}" (${state})`);
    let odataFilter = "";
    if (dbSpecs.mls_id) {
      odataFilter = `ListingId eq '${odataLiteral(dbSpecs.mls_id)}'`;
    } else {
      odataFilter = `contains(UnparsedAddress, '${houseNumber}') and StateOrProvince eq '${state}'`;
      const zipMatches = address.match(/\b\d{5}\b/g);
      const zipCode = zipMatches ? zipMatches[zipMatches.length - 1] : null;
      if (zipCode) {
        odataFilter += ` and PostalCode eq '${zipCode}'`;
      }
      const streetNoise = new Set(["road", "rd", "street", "st", "southwest", "sw", "southeast", "se", "northwest", "nw", "northeast", "ne", "avenue", "ave", "lane", "ln", "circle", "cir", "drive", "dr", "way", "court", "ct", "boulevard", "blvd", "in", "ky", "indiana", "kentucky"]);
      const filteredCore = coreWords.filter(w => !streetNoise.has(w.toLowerCase()));
      for (const word of filteredCore.slice(0, 2)) {
        odataFilter += ` and contains(tolower(UnparsedAddress), '${word.toLowerCase()}')`;
      }
    }

    let targetProfile: any = null;
    if (odataFilter) {
      try {
        const propParams = {
          "$filter": odataFilter,
          "$select": "ListingId,UnparsedAddress,PostalCode,BedroomsTotal,BathroomsTotalDecimal,LivingArea,YearBuilt,ListPrice,ClosePrice,StandardStatus,CloseDate",
          "$top": 20
        };
        const propRes = await axios.get(url, { headers, params: propParams, timeout: 8000 });
        const records = propRes.data.value || [];

        if (records.length > 0) {
          if (dbSpecs.mls_id) {
            targetProfile = records[0];
          } else {
            for (const record of records) {
              const recAddr = record.UnparsedAddress || "";
              if (recAddr && getGroupingKey(recAddr) === targetKey) {
                targetProfile = record;
                break;
              }
            }
            if (!targetProfile) {
              // Coincidencia estricta: mismo número de casa y todas las palabras núcleo de la calle presentes.
              // (Antes se tomaba records[0]: cualquier casa con ese número en el ZIP → specs de otra propiedad.)
              targetProfile = records.find((r: any) => {
                const recParsed = parseAddress(String(r.UnparsedAddress || "").replace(/,/g, " "));
                if (recParsed.houseNumber !== houseNumber) return false;
                return coreWords.length > 0 && coreWords.every(w => recParsed.coreWords.includes(w));
              }) || null;
            }
          }
        }
      } catch (mlsErr: any) {
        console.warn("[MCA API] Aviso consultando propiedad objetivo en MLS:", mlsErr.message);
      }
    }

    // Extraer o suponer características con resolución inteligente de ZIP
    let zip = "";
    const zipMatch = address.match(/\b\d{5}\b/);
    if (zipMatch) {
      zip = zipMatch[0];
    } else if (targetProfile && targetProfile.PostalCode) {
      zip = targetProfile.PostalCode;
    } else {
      // 1. Buscar en geocode_cache
      try {
        const geoRes = await db.execute({
          sql: "SELECT address FROM geocode_cache WHERE address LIKE ? LIMIT 1",
          args: [`%${houseNumber}%`]
        });
        if (geoRes.rows.length > 0) {
          const gAddr = geoRes.rows[0].address as string;
          const gZip = gAddr.match(/\b\d{5}\b/);
          if (gZip) zip = gZip[0];
        }
      } catch {}

      // 2. Buscar en BD local (mailing_address)
      if (!zip) {
        try {
          const mRes = await db.execute({
            sql: "SELECT address, mailing_address FROM foreclosure_auctions WHERE address LIKE ? LIMIT 1",
            args: [`%${houseNumber}%`]
          });
          if (mRes.rows.length > 0) {
            const mText = `${mRes.rows[0].address} ${mRes.rows[0].mailing_address || ""}`;
            const mMatch = mText.match(/\b\d{5}\b/);
            if (mMatch) zip = mMatch[0];
          }
        } catch {}
      }

      // 3. Diccionario de ciudades Indiana / Kentucky
      if (!zip) {
        const lowerAddr = address.toLowerCase();
        const cityMap: Record<string, string> = {
          "mauckport": "47142",
          "corydon": "47112",
          "new albany": "47150",
          "jeffersonville": "47130",
          "clarksville": "47129",
          "sellersburg": "47172",
          "charlestown": "47111",
          "floyds knobs": "47119",
          "louisville": "40202",
          "georgetown": "47122",
          "greenville": "47124",
          "elizabeth": "47117",
          "laconia": "47135"
        };
        for (const [city, z] of Object.entries(cityMap)) {
          if (lowerAddr.includes(city)) {
            zip = z;
            break;
          }
        }
      }
    }

    // Sin valores inventados (AGENTS.md §2.A): si no se conocen, quedan null y no se usan como filtro de comps.
    const pickPositive = (...vals: any[]): number | null => {
      for (const v of vals) {
        const n = Number(v);
        if (Number.isFinite(n) && n > 0) return n;
      }
      return null;
    };
    const beds = pickPositive(targetProfile?.BedroomsTotal, dbSpecs.beds);
    const baths = pickPositive(targetProfile?.BathroomsTotalDecimal, dbSpecs.baths);
    const sqft = pickPositive(targetProfile?.LivingArea, dbSpecs.sqft);

    let comps: any[] = [];
    if (zip) {
      const date180DaysAgo = new Date();
      date180DaysAgo.setDate(date180DaysAgo.getDate() - 180);
      const date180Str = date180DaysAgo.toISOString().split("T")[0];

      const specFilter =
        (beds !== null ? ` and BedroomsTotal ge ${beds - 1} and BedroomsTotal le ${beds + 1}` : "") +
        (sqft !== null ? ` and LivingArea ge ${sqft - 350} and LivingArea le ${sqft + 350}` : "");
      const compsFilter = `PostalCode eq '${zip}' and StandardStatus eq 'Closed' and ClosePrice gt 20000${specFilter} and CloseDate ge ${date180Str}`;

      try {
        const compsParams = {
          "$filter": compsFilter,
          "$select": "ListingId,UnparsedAddress,ClosePrice,CloseDate,BedroomsTotal,BathroomsTotalDecimal,LivingArea",
          "$top": 8
        };
        const compsRes = await axios.get(url, { headers, params: compsParams, timeout: 8000 });
        comps = compsRes.data.value || [];

        // Fallback a 365 días si no hay comps
        if (comps.length === 0) {
          const date365DaysAgo = new Date();
          date365DaysAgo.setDate(date365DaysAgo.getDate() - 365);
          const date365Str = date365DaysAgo.toISOString().split("T")[0];

          const compsFilter365 = `PostalCode eq '${zip}' and StandardStatus eq 'Closed' and ClosePrice gt 20000${specFilter} and CloseDate ge ${date365Str}`;

          const compsParams365 = {
            "$filter": compsFilter365,
            "$select": "ListingId,UnparsedAddress,ClosePrice,CloseDate,BedroomsTotal,BathroomsTotalDecimal,LivingArea",
            "$top": 8
          };
          const compsRes365 = await axios.get(url, { headers, params: compsParams365, timeout: 8000 });
          comps = compsRes365.data.value || [];
        }
      } catch (compsErr: any) {
        console.warn("[MCA API] Aviso consultando comps en Spark:", compsErr.message);
      }
    }

    let mcaArv = 0;
    const compPrices = comps.map((c: any) => Number(c.ClosePrice)).filter((p: number) => Number.isFinite(p) && p > 0).sort((a: number, b: number) => a - b);
    if (compPrices.length > 0) {
      // Mediana: robusta a comps atípicos (ventas de lujo o distressed)
      const mid = Math.floor(compPrices.length / 2);
      mcaArv = Math.round(compPrices.length % 2 ? compPrices[mid] : (compPrices[mid - 1] + compPrices[mid]) / 2);
    } else if (dbSpecs.appraisal_value && dbSpecs.appraisal_value > 0) {
      mcaArv = dbSpecs.appraisal_value;
    }

    return res.json({
      status: "success",
      target: {
        address,
        zip: zip || "N/A",
        beds,
        baths,
        sqft,
        lastClosedPrice: targetProfile ? (targetProfile.ClosePrice || targetProfile.ListPrice || null) : null,
        lastClosedDate: targetProfile ? (targetProfile.CloseDate || null) : null,
        status: targetProfile ? targetProfile.StandardStatus : "Off Market"
      },
      mcaArv,
      compsCount: comps.length,
      comps: comps.map((c: any) => ({
        address: c.UnparsedAddress,
        price: c.ClosePrice,
        date: c.CloseDate,
        beds: c.BedroomsTotal,
        baths: c.BathroomsTotalDecimal,
        sqft: c.LivingArea
      })),
      note: comps.length === 0 ? "Propiedad Off-Market sin transacciones cerradas recientes en este código postal rural en MLS. Valuación referenciada por avalúo judicial oficial." : undefined
    });

  } catch (err: any) {
    console.error("[MCA API ERROR]", err.message);
    return res.status(502).json({
      status: "error",
      message: `No se pudo calcular el MCA: ${err.message}`
    });
  }
});

/**
 * Endpoint de Auditoría Multimodal de Documentos Judiciales (PDF, JPG, PNG)
 * Utiliza Gemini 3.1 Pro Preview (con fallback a Gemini 3.8 Flash) para extraer
 * montos de juicio, avalúos, gravámenes secundarios y situación procesal.
 */
app.post("/api/audit-court-document", async (req, res) => {
  console.log("[API] /api/audit-court-document solicitado");
  try {
    const { documentBase64, mimeType, auctionId, caseNumber, address } = req.body;
    if (!documentBase64) {
      return res.status(400).json({ status: "error", message: "Falta el parámetro documentBase64 (documento en Base64)." });
    }

    const cleanBase64 = documentBase64.replace(/^data:[^;]+;base64,/, "");
    const effectiveMime = mimeType || (cleanBase64.startsWith("JVBER") ? "application/pdf" : "image/jpeg");
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return res.status(500).json({ status: "error", message: "GEMINI_API_KEY no configurada en el servidor." });
    }

    const prompt = `Eres un Auditor Legal y Especialista en Ejecuciones Hipotecarias (Foreclosure & Acquisition Underwriter) para Kentucky e Indiana.
Analiza con precisión forense el documento judicial adjunto (decreto de ejecución hipotecaria, tasación judicial, orden de venta del Sheriff, desglose de liquidación o aviso público) y extrae:

1. judgmentDebt: Monto líquido total de la sentencia de ejecución hipotecaria o deuda reclamada por el banco/acreedor (número decimal puro, ej: 84500.50). Si no aparece, null.
2. appraisalValue: Valor de tasación oficial de la corte o PVA (Appraisal Value / Evaluated Cash Value). Si no aparece, null.
3. secondaryLiensAmount: Gravámenes secundarios, embargos fiscales, impuestos acumulados o segundas hipotecas (número decimal, ej: 4500, o 0).
4. plaintiff: Nombre del banco/acreedor demandante (o null).
5. defendant: Nombre del deudor/titular demandado (o null).
6. isDismissed: true si el caso fue desestimado/anulado, false si está activo o con orden de venta.
7. caseNumber: Número de expediente judicial si aparece en el documento (o null).
8. explanation: Resumen ejecutivo en español de 2-3 frases detallando la situación legal, montos encontrados y conceptos.
9. actionableAdvice: Recomendación táctica directa para el inversionista de adquisición sobre cómo ofertar este inmueble.

Responde estrictamente en formato JSON válido con esta estructura:
{
  "judgmentDebt": number o null,
  "appraisalValue": number o null,
  "secondaryLiensAmount": number,
  "plaintiff": string o null,
  "defendant": string o null,
  "isDismissed": boolean,
  "caseNumber": string o null,
  "explanation": string,
  "actionableAdvice": string
}`;

    // Priority: gemini-3.8-flash primero para respuesta inmediata, fallback a gemini-3.1-pro-preview
    const models = [process.env.GEMINI_MODEL || "gemini-3.8-flash", "gemini-3.1-pro-preview"];
    let responseJson: any = null;
    let usedModel = "";

    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      try {
        console.log(`[AUDIT DOC API] Procesando documento multimodal con ${model} (${effectiveMime})...`);
        const geminiResp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    inlineData: {
                      mimeType: effectiveMime,
                      data: cleanBase64
                    }
                  },
                  { text: prompt }
                ]
              }
            ],
            generationConfig: { response_mime_type: "application/json" }
          }),
          signal: AbortSignal.timeout(45000)
        });

        if (!geminiResp.ok) {
          const errTxt = await geminiResp.text();
          console.warn(`[AUDIT DOC API] Falló ${model}: HTTP ${geminiResp.status} - ${errTxt.slice(0, 120)}`);
          continue;
        }

        const gData = await geminiResp.json() as any;
        const textResp = gData.candidates?.[0]?.content?.parts?.[0]?.text;
        if (textResp) {
          const match = textResp.match(/\{[\s\S]*\}/);
          responseJson = JSON.parse(match ? match[0] : textResp);
          usedModel = model;
          break;
        }
      } catch (err: any) {
        console.warn(`[AUDIT DOC API] Error consultando ${model}: ${err.message}`);
      }
    }

    if (!responseJson) {
      return res.status(500).json({ status: "error", message: "No se pudo extraer información del documento con los modelos de Gemini." });
    }

    // Actualizar en base de datos si tenemos auctionId, caseNumber o address
    let updatedDb = false;

    // Guardrails: Reject hallucinated values outside realistic range ($1k - $5M)
    const MIN_VALID_RANGE = 1000;
    const MAX_VALID_RANGE = 5000000;

    const rawDebt = responseJson.judgmentDebt && !isNaN(Number(responseJson.judgmentDebt)) ? Number(responseJson.judgmentDebt) : null;
    const rawAppraisal = responseJson.appraisalValue && !isNaN(Number(responseJson.appraisalValue)) ? Number(responseJson.appraisalValue) : null;

    const debt = (rawDebt && rawDebt >= MIN_VALID_RANGE && rawDebt <= MAX_VALID_RANGE) ? rawDebt : null;
    const appraisal = (rawAppraisal && rawAppraisal >= MIN_VALID_RANGE && rawAppraisal <= MAX_VALID_RANGE) ? rawAppraisal : null;

    if (rawDebt && !debt) {
      console.warn(`[AUDIT DOC API GUARDRAIL] Deuda rechazada por fuera de rango: $${rawDebt.toLocaleString()} (rango válido: $${MIN_VALID_RANGE.toLocaleString()}-$${MAX_VALID_RANGE.toLocaleString()})`);
    }
    if (rawAppraisal && !appraisal) {
      console.warn(`[AUDIT DOC API GUARDRAIL] Avalúo rechazado por fuera de rango: $${rawAppraisal.toLocaleString()} (rango válido: $${MIN_VALID_RANGE.toLocaleString()}-$${MAX_VALID_RANGE.toLocaleString()})`);
    }

    const rawSecondary = Number(responseJson.secondaryLiensAmount || 0);
    const secondaryLiens = Number.isFinite(rawSecondary) && rawSecondary > 0 && rawSecondary <= MAX_VALID_RANGE ? rawSecondary : 0;

    // Resolución estricta del registro objetivo (antes: WHERE ... OR case_number = '' OR address LIKE '%..%'
    // podía sobrescribir múltiples remates no relacionados).
    let targetAuctionIds: any[] = [];
    let matchMethod = "none";
    try {
      const cleanCase = typeof caseNumber === "string" ? caseNumber.trim() : "";
      const aiCase = typeof responseJson.caseNumber === "string" ? responseJson.caseNumber.trim() : "";
      if (auctionId) {
        const r = await db.execute({ sql: "SELECT auction_id FROM foreclosure_auctions WHERE auction_id = ?", args: [auctionId] });
        targetAuctionIds = r.rows.map(row => row.auction_id);
        matchMethod = "auction_id";
      }
      if (targetAuctionIds.length === 0 && cleanCase) {
        const r = await db.execute({ sql: "SELECT auction_id FROM foreclosure_auctions WHERE case_number = ?", args: [cleanCase] });
        targetAuctionIds = r.rows.map(row => row.auction_id);
        matchMethod = "case_number";
      }
      if (targetAuctionIds.length === 0 && typeof address === "string" && address.trim()) {
        const targetKey = getGroupingKey(address);
        const { houseNumber } = parseAddress(address);
        if (targetKey && houseNumber) {
          const r = await db.execute({
            sql: "SELECT auction_id, address FROM foreclosure_auctions WHERE address LIKE ?",
            args: [`${houseNumber} %`]
          });
          targetAuctionIds = r.rows.filter(row => getGroupingKey(row.address as string) === targetKey).map(row => row.auction_id);
          matchMethod = "address_key";
        }
      }
      // Último recurso: número de caso extraído por la IA, solo con coincidencia exacta.
      if (targetAuctionIds.length === 0 && !auctionId && !cleanCase && aiCase) {
        const r = await db.execute({ sql: "SELECT auction_id FROM foreclosure_auctions WHERE case_number = ?", args: [aiCase] });
        targetAuctionIds = r.rows.map(row => row.auction_id);
        matchMethod = "ai_case_number";
      }
    } catch (lookupErr: any) {
      console.error(`[AUDIT DOC API DB LOOKUP ERROR]: ${lookupErr.message}`);
    }

    const MAX_TARGET_ROWS = 3; // duplicados del mismo expediente; más que esto indica ambigüedad
    if (targetAuctionIds.length > MAX_TARGET_ROWS) {
      console.warn(`[AUDIT DOC API] Coincidencia ambigua (${targetAuctionIds.length} filas vía ${matchMethod}). No se actualiza la BD.`);
      targetAuctionIds = [];
    }

    if (targetAuctionIds.length > 0) {
      try {
        const placeholders = targetAuctionIds.map(() => "?").join(", ");
        const updateRes = await db.execute({
          sql: `
            UPDATE foreclosure_auctions SET
              debt_amount = CASE WHEN ? IS NOT NULL THEN ? ELSE debt_amount END,
              appraisal_value = CASE WHEN ? IS NOT NULL THEN ? ELSE appraisal_value END,
              hidden_liens_amount = CASE WHEN ? > 0 THEN ? ELSE hidden_liens_amount END,
              plaintiff = CASE WHEN ? IS NOT NULL AND ? != '' THEN ? ELSE plaintiff END,
              defendant = CASE WHEN ? IS NOT NULL AND ? != '' THEN ? ELSE defendant END,
              forensic_legal_story = CASE WHEN ? IS NOT NULL AND ? != '' THEN ? ELSE forensic_legal_story END,
              needs_manual_review = CASE WHEN ? > 0 THEN 0 ELSE needs_manual_review END
            WHERE auction_id IN (${placeholders})
          `,
          args: [
            debt, debt,
            appraisal, appraisal,
            secondaryLiens, secondaryLiens,
            responseJson.plaintiff ?? null, responseJson.plaintiff ?? null, responseJson.plaintiff ?? null,
            responseJson.defendant ?? null, responseJson.defendant ?? null, responseJson.defendant ?? null,
            responseJson.explanation ?? null, responseJson.explanation ?? null, responseJson.explanation ?? null,
            debt,
            ...targetAuctionIds
          ]
        });

        if (updateRes.rowsAffected > 0) {
          updatedDb = true;
          cachedProspectos = null; // invalidar caché del mapa
          console.log(`[AUDIT DOC API SUCCESS] ${updateRes.rowsAffected} fila(s) actualizada(s) vía ${matchMethod}. Deuda: $${debt?.toLocaleString()}`);
        }
      } catch (dbErr: any) {
        console.error(`[AUDIT DOC API DB ERROR]: ${dbErr.message}`);
      }
    } else if (auctionId || caseNumber || address) {
      console.warn(`[AUDIT DOC API] Sin coincidencia exacta para auctionId=${auctionId || "-"} case=${caseNumber || "-"} address=${address || "-"}. BD sin cambios.`);
    }

    return res.json({
      status: "success",
      model: usedModel,
      data: responseJson,
      updatedDb
    });
  } catch (e: any) {
    console.error("[AUDIT DOC API FATAL]:", e.message);
    return res.status(500).json({ status: "error", message: e.message });
  }
});

function parseAddressForCensus(fullAddress: string): { street: string; city: string; state: string; zip: string } | null {
  try {
    const parts = fullAddress.split(",").map(p => p.trim());
    if (parts.length < 3) return null;
    
    const lastPart = parts[parts.length - 1];
    const match = lastPart.match(/^([A-Z]{2})\s+(\d{5}(-\d{4})?)$/i);
    if (!match) return null;
    
    const state = match[1];
    const zip = match[2];
    const city = parts[parts.length - 2];
    const street = parts.slice(0, parts.length - 2).join(", ");
    
    return { street, city, state, zip };
  } catch (e) {
    return null;
  }
}

async function geocodeAddressBatch(uncachedAddresses: string[]): Promise<Set<string>> {
  const geocodedInBatch = new Set<string>();
  
  // Generar contenido CSV
  let csvContent = "";
  const addressMap = new Map<number, string>();
  let batchCount = 0;
  
  uncachedAddresses.forEach((addr, idx) => {
    const parsed = parseAddressForCensus(addr);
    if (parsed) {
      const cleanStreet = parsed.street.replace(/,/g, "");
      const cleanCity = parsed.city.replace(/,/g, "");
      csvContent += `${idx},${cleanStreet},${cleanCity},${parsed.state},${parsed.zip}\n`;
      addressMap.set(idx, addr);
      batchCount++;
    }
  });
  
  if (batchCount === 0) {
    return geocodedInBatch;
  }
  
  console.log(`[BACKGROUND GEOCODER BATCH] Enviando lote de ${batchCount} direcciones a US Census Geocoder...`);
  
  try {
    const formData = new FormData();
    const fileBlob = new Blob([csvContent], { type: "text/csv" });
    formData.append("addressFile", fileBlob, "addresses.csv");
    formData.append("benchmark", "Public_AR_Current");
    
    const response = await fetch("https://geocoding.geo.census.gov/geocoder/locations/addressbatch", {
      method: "POST",
      body: formData,
      signal: AbortSignal.timeout(30000)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const responseText = await response.text();
    const lines = responseText.split("\n");
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      const parts = line.split(`","`).map(p => p.replace(/"/g, "").trim());
      if (parts.length < 6) continue;
      
      const id = parseInt(parts[0]);
      const matchStatus = parts[2];
      const coords = parts[5];
      
      const originalAddress = addressMap.get(id);
      
      if (matchStatus === "Match" && coords && originalAddress) {
        const coordParts = coords.split(",");
        if (coordParts.length === 2) {
          const lon = parseFloat(coordParts[0]);
          const lat = parseFloat(coordParts[1]);
          if (!isNaN(lat) && !isNaN(lon)) {
            await db.execute({
              sql: "INSERT OR REPLACE INTO geocode_cache (address, lat, lon) VALUES (?, ?, ?)",
              args: [originalAddress, lat, lon]
            });
            geocodedInBatch.add(originalAddress);
          }
        }
      }
    }
    console.log(`[BACKGROUND GEOCODER BATCH] Lote procesado con éxito. Se geocodificaron ${geocodedInBatch.size} direcciones.`);
  } catch (err: any) {
    console.warn("[BACKGROUND GEOCODER BATCH WARNING] Falló la geocodificación en lote con US Census:", err.message);
  }
  
  return geocodedInBatch;
}

let isGeocodingActive = false;

/**
 * Escanea de forma asíncrona la base de datos buscando direcciones no geocodificadas,
 * y las procesa de manera secuencial respetando los límites de uso de la API (1.5s delay).
 */
async function startBackgroundGeocoding() {
  if (isGeocodingActive) return;
  isGeocodingActive = true;

  console.log("[BACKGROUND GEOCODER] Escaneando direcciones pendientes...");

  try {
    const addresses = new Set<string>();

    // Obtener direcciones de todas las tablas
    const auctions = await db.execute("SELECT DISTINCT address FROM foreclosure_auctions");
    auctions.rows.forEach(r => { if (r.address) addresses.add(r.address as string); });

    const violations = await db.execute("SELECT DISTINCT address FROM code_violations");
    violations.rows.forEach(r => { if (r.address) addresses.add(r.address as string); });

    const probates = await db.execute("SELECT DISTINCT address FROM probates");
    probates.rows.forEach(r => { if (r.address) addresses.add(r.address as string); });

    const divorces = await db.execute("SELECT DISTINCT address FROM divorces");
    divorces.rows.forEach(r => { if (r.address) addresses.add(r.address as string); });

    const bankruptcies = await db.execute("SELECT DISTINCT address FROM bankruptcies");
    bankruptcies.rows.forEach(r => { if (r.address) addresses.add(r.address as string); });

    // Tablas que antes se omitían (sus leads nunca recibían pin en el mapa)
    for (const table of ["pre_foreclosures", "tax_sales", "physical_distress", "financial_distress", "life_events", "landbank_inventory"]) {
      try {
        const extra = await db.execute(`SELECT DISTINCT address FROM ${table}`);
        extra.rows.forEach(r => { if (r.address) addresses.add(r.address as string); });
      } catch (tableErr: any) {
        console.warn(`[BACKGROUND GEOCODER] No se pudo leer ${table}: ${tableErr.message}`);
      }
    }

    // Filtrar las direcciones que ya están en caché (consulta en lote para evitar consultas N+1 y sobrecargar Turso)
    const cacheRes = await db.execute("SELECT address FROM geocode_cache");
    const cachedSet = new Set(cacheRes.rows.map(r => r.address as string).filter(Boolean));

    const uncachedAddresses: string[] = [];
    for (const address of addresses) {
      if (!cachedSet.has(address)) {
        uncachedAddresses.push(address);
      }
    }

    if (uncachedAddresses.length > 0) {
      console.log(`[BACKGROUND GEOCODER] Se encontraron ${uncachedAddresses.length} direcciones pendientes de geocodificación.`);
      
      // Intentar primero geocodificar en lote usando el US Census Geocoder
      const geocodedBatch = await geocodeAddressBatch(uncachedAddresses);
      const remainingAddresses = uncachedAddresses.filter(addr => !geocodedBatch.has(addr));
      
      if (remainingAddresses.length > 0) {
        console.log(`[BACKGROUND GEOCODER] Procesando ${remainingAddresses.length} direcciones restantes de forma individual...`);
        for (let i = 0; i < remainingAddresses.length; i++) {
          const addr = remainingAddresses[i];
          console.log(`[BACKGROUND GEOCODER] Procesando individual ${i + 1}/${remainingAddresses.length}: "${addr}"`);
          
          await getCoordinates(addr);
          
          // Espera corta si usamos Google, o 1.5s para no saturar la API gratuita de Nominatim
          const sleepTime = process.env.GOOGLE_MAPS_API_KEY ? 200 : 1500;
          await sleep(sleepTime);
        }
      }
      console.log("[BACKGROUND GEOCODER] Geocodificación en lote y residual completada.");
    } else {
      console.log("[BACKGROUND GEOCODER] Todas las direcciones están al día en la caché.");
    }
  } catch (err: any) {
    console.error("[BACKGROUND GEOCODER ERROR] Falló el escaneo de direcciones:", err.message);
  } finally {
    isGeocodingActive = false;
  }
}

// Create cache table if missing
async function initializeServer() {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS geocode_cache (
        address TEXT PRIMARY KEY,
        lat REAL,
        lon REAL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("[DB] geocode_cache inicializada.");
    
    // Iniciar geocodificador en segundo plano al arrancar
    startBackgroundGeocoding().catch(err => {
      console.error("[BG GEOCODER ERROR] Error de inicio:", err.message);
    });

  } catch (err: any) {
    console.error("[DB ERROR] Error al inicializar geocode_cache:", err.message);
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, HOST, () => {
      console.log(`\n========================================================`);
      console.log(`🚀 TZEL TACTICAL MAP SERVER STARTED ON ${HOST}:${PORT}`);
      console.log(`👉 Open http://localhost:${PORT} in your browser`);
      console.log(`========================================================\n`);
    });
  }
}

initializeServer();

export default app;

