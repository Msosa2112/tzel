import express from "express";
import axios from "axios";
import { db } from "./db";
import * as dotenv from "dotenv";
import * as path from "path";
import { calculateRehab, calculateMAO, calculateROI, isJuniorLien, calculateNetEquity, isUnderwater, checkCriticalRisk, calculateInstitutionalUnderwriting, InstitutionalUnderwriting } from "./underwriting/underwriter";

dotenv.config();



const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, ".")));
app.use(express.json());

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


function sanitizeImageUrl(rawUrl: string): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  let url = rawUrl.trim();
  if (url.toLowerCase().startsWith('http://')) {
    url = 'https://' + url.substring(7);
  }
  if (!url.toLowerCase().startsWith('https://')) return null;
  const lower = url.toLowerCase();
  if (lower.includes('.html') || lower.includes('.htm') || lower.includes('realbiz360') || lower.includes('guidedtour.tv') || lower.includes('90phut') || lower.includes('youtube.com') || lower.includes('vimeo.com')) {
    return null;
  }
  return url;
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
        title_check_status, next_retry_date
      FROM foreclosure_auctions
      WHERE (status IS NULL OR status = 'active' OR status = '') AND (mls_status IS NULL OR mls_status != 'resolved')`,
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
      `SELECT * FROM tzel_opportunity_scores`
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

    // Filter auctions to next 60 days or Indiana manual reviews
    const opportunities = auctionsRes.rows.filter(row => {
      const state = (row.state as string || "").toUpperCase();
      if (state !== "KY" && state !== "IN") return false;
      const dateStr = row.auction_date as string;
      const daysRemaining = getDaysRemaining(dateStr);
      if (daysRemaining === null) return true; // Keep manual reviews
      return daysRemaining >= 0 && daysRemaining <= 60;
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

    // A. Group foreclosures
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
          hiddenMortgages: row.hidden_mortgages as number || 0,
          hiddenLiensAmount: row.hidden_liens_amount as number || 0,
          titleCheckStatus: row.title_check_status as string || "pending",
          nextRetryDate: row.next_retry_date as string || undefined,
          mailingAddress: row.mailing_address as string || undefined,
          isAbsentee: (row.absentee_owner as number) === 1,
          sqft: row.sqft as number || undefined,
          beds: row.beds as number || undefined,
          baths: row.baths as number || undefined,
          photoUrls: []
        });
      } else {
        const existing = groupedMap.get(key)!;
        if (row.mls_estimated_value && (row.mls_estimated_value as number) > existing.mlsValue) {
          existing.mlsValue = row.mls_estimated_value as number;
        }
        if (row.mls_id && row.mls_id !== "N/A") existing.mlsId = row.mls_id as string;
        if (!isValidOwnerName(existing.ownerName) && isValidOwnerName(row.defendant as string)) existing.ownerName = row.defendant as string;
        if (!existing.mailingAddress && row.mailing_address) existing.mailingAddress = row.mailing_address as string;
        if ((row.absentee_owner as number) === 1) existing.isAbsentee = true;
        if (!existing.sqft && row.sqft) existing.sqft = row.sqft as number;
        if (!existing.beds && row.beds) existing.beds = row.beds as number;
        if (!existing.baths && row.baths) existing.baths = row.baths as number;
        const rowHidden = row.hidden_mortgages as number || 0;
        if (rowHidden > existing.hiddenMortgages) {
          existing.hiddenMortgages = rowHidden;
        }
        const rowLiens = row.hidden_liens_amount as number || 0;
        if (rowLiens > existing.hiddenLiensAmount) {
          existing.hiddenLiensAmount = rowLiens;
        }
        if (row.title_check_status && row.title_check_status !== "pending") {
          existing.titleCheckStatus = row.title_check_status as string;
        }
        if (row.next_retry_date) {
          existing.nextRetryDate = row.next_retry_date as string;
        }
        rowPhones.forEach(p => existing.phones.add(p));
        rowEmails.forEach(e => existing.emails.add(e));
        if (address.length > existing.displayAddress.length) existing.displayAddress = address;
      }

      const lead = groupedMap.get(key)!;
      if (row.photo_urls) {
        try {
          const parsed = JSON.parse(row.photo_urls as string);
          if (Array.isArray(parsed)) {
            parsed.forEach((url: string) => {
              const valid = sanitizeImageUrl(url);
              if (valid && !lead.photoUrls.includes(valid)) lead.photoUrls.push(valid);
            });
          }
        } catch (e) {}
      }

      lead.auctions.push(row);
    }

    // B. Group violations
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
          hiddenMortgages: row.hidden_mortgages as number || 0,
          hiddenLiensAmount: row.hidden_liens_amount as number || 0,
          titleCheckStatus: row.title_check_status as string || "pending",
          nextRetryDate: undefined,
          mailingAddress: row.mailing_address as string || undefined,
          isAbsentee: (row.absentee_owner as number) === 1,
          sqft: row.sqft as number || undefined,
          beds: row.beds as number || undefined,
          baths: row.baths as number || undefined,
          photoUrls: []
        });
      } else {
        const existing = groupedMap.get(key)!;
        if (!isValidOwnerName(existing.ownerName) && isValidOwnerName(row.owner_name as string)) {
          existing.ownerName = row.owner_name as string;
        }
        if (row.mls_estimated_value && (row.mls_estimated_value as number) > existing.mlsValue) {
          existing.mlsValue = row.mls_estimated_value as number;
        }
        if (row.mls_id && row.mls_id !== "N/A") existing.mlsId = row.mls_id as string;
        if (!existing.mailingAddress && row.mailing_address) existing.mailingAddress = row.mailing_address as string;
        if ((row.absentee_owner as number) === 1) existing.isAbsentee = true;
        if (!existing.sqft && row.sqft) existing.sqft = row.sqft as number;
        if (!existing.beds && row.beds) existing.beds = row.beds as number;
        if (!existing.baths && row.baths) existing.baths = row.baths as number;
        const rowHidden = row.hidden_mortgages as number || 0;
        if (rowHidden > existing.hiddenMortgages) {
          existing.hiddenMortgages = rowHidden;
        }
        const rowLiens = row.hidden_liens_amount as number || 0;
        if (rowLiens > existing.hiddenLiensAmount) {
          existing.hiddenLiensAmount = rowLiens;
        }
        if (row.title_check_status && row.title_check_status !== "pending") {
          existing.titleCheckStatus = row.title_check_status as string;
        }
        rowPhones.forEach(p => existing.phones.add(p));
        rowEmails.forEach(e => existing.emails.add(e));
        if (address.length > existing.displayAddress.length) existing.displayAddress = address;
      }

      const lead = groupedMap.get(key)!;
      if (row.photo_urls) {
        try {
          const parsed = JSON.parse(row.photo_urls as string);
          if (Array.isArray(parsed)) {
            parsed.forEach((url: string) => {
              const valid = sanitizeImageUrl(url);
              if (valid && !lead.photoUrls.includes(valid)) lead.photoUrls.push(valid);
            });
          }
        } catch (e) {}
      }

      lead.violations.push(row);
    }

    // C. Group probates
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
          hiddenLiensAmount: 0,
          titleCheckStatus: "pending",
          nextRetryDate: undefined,
          isAbsentee: false,
          photoUrls: []
        });
      } else {
        const existing = groupedMap.get(key)!;
        if (!isValidOwnerName(existing.ownerName) && isValidOwnerName(row.heir_name as string)) {
          existing.ownerName = row.heir_name as string;
        }
        rowPhones.forEach(p => existing.phones.add(p));
        rowEmails.forEach(e => existing.emails.add(e));
      }
      groupedMap.get(key)!.probates.push(row);
    }

    // D. Group divorces
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
          hiddenLiensAmount: 0,
          titleCheckStatus: "pending",
          nextRetryDate: undefined,
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

    // E. Group bankruptcies
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
          hiddenLiensAmount: 0,
          titleCheckStatus: "pending",
          nextRetryDate: undefined,
          isAbsentee: false,
          photoUrls: []
        });
      } else {
        const existing = groupedMap.get(key)!;
        if (!isValidOwnerName(existing.ownerName) && isValidOwnerName(row.debtor_name as string)) {
          existing.ownerName = row.debtor_name as string;
        }
        rowPhones.forEach(p => existing.phones.add(p));
        rowEmails.forEach(e => existing.emails.add(e));
      }
      groupedMap.get(key)!.bankruptcies.push(row);
    }

    // F. Group physical distress
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
          hiddenMortgages: row.hidden_mortgages as number || 0,
          hiddenLiensAmount: row.hidden_liens_amount as number || 0,
          titleCheckStatus: "pending",
          nextRetryDate: undefined,
          mailingAddress: row.mailing_address as string || undefined,
          isAbsentee: (row.absentee_owner as number) === 1,
          sqft: row.sqft as number || undefined,
          beds: row.beds as number || undefined,
          baths: row.baths as number || undefined,
          photoUrls: []
        });
      } else {
        const existing = groupedMap.get(key)!;
        if (!isValidOwnerName(existing.ownerName) && isValidOwnerName(row.owner_name as string)) {
          existing.ownerName = row.owner_name as string;
        }
        if (row.mls_estimated_value && (row.mls_estimated_value as number) > existing.mlsValue) {
          existing.mlsValue = row.mls_estimated_value as number;
        }
        if (row.mls_id && row.mls_id !== "N/A") existing.mlsId = row.mls_id as string;
        if (!existing.mailingAddress && row.mailing_address) existing.mailingAddress = row.mailing_address as string;
        if ((row.absentee_owner as number) === 1) existing.isAbsentee = true;
        if (!existing.sqft && row.sqft) existing.sqft = row.sqft as number;
        if (!existing.beds && row.beds) existing.beds = row.beds as number;
        if (!existing.baths && row.baths) existing.baths = row.baths as number;
        const rowHidden = row.hidden_mortgages as number || 0;
        if (rowHidden > existing.hiddenMortgages) {
          existing.hiddenMortgages = rowHidden;
        }
        const rowLiens = row.hidden_liens_amount as number || 0;
        if (rowLiens > existing.hiddenLiensAmount) {
          existing.hiddenLiensAmount = rowLiens;
        }
        rowPhones.forEach(p => existing.phones.add(p));
        rowEmails.forEach(e => existing.emails.add(e));
        if (address.length > existing.displayAddress.length) existing.displayAddress = address;
      }

      const lead = groupedMap.get(key)!;
      if (row.photo_urls) {
        try {
          const parsed = JSON.parse(row.photo_urls as string);
          if (Array.isArray(parsed)) {
            parsed.forEach((url: string) => {
              const valid = sanitizeImageUrl(url);
              if (valid && !lead.photoUrls.includes(valid)) lead.photoUrls.push(valid);
            });
          }
        } catch (e) {}
      }

      lead.physicalDistress.push(row);
    }

    // G. Group financial distress
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
          hiddenMortgages: row.hidden_mortgages as number || 0,
          hiddenLiensAmount: row.hidden_liens_amount as number || 0,
          titleCheckStatus: "pending",
          nextRetryDate: undefined,
          mailingAddress: row.mailing_address as string || undefined,
          isAbsentee: (row.absentee_owner as number) === 1,
          sqft: row.sqft as number || undefined,
          beds: row.beds as number || undefined,
          baths: row.baths as number || undefined,
          photoUrls: []
        });
      } else {
        const existing = groupedMap.get(key)!;
        if (!isValidOwnerName(existing.ownerName) && isValidOwnerName(row.owner_name as string)) {
          existing.ownerName = row.owner_name as string;
        }
        if (row.mls_estimated_value && (row.mls_estimated_value as number) > existing.mlsValue) {
          existing.mlsValue = row.mls_estimated_value as number;
        }
        if (row.mls_id && row.mls_id !== "N/A") existing.mlsId = row.mls_id as string;
        if (!existing.mailingAddress && row.mailing_address) existing.mailingAddress = row.mailing_address as string;
        if ((row.absentee_owner as number) === 1) existing.isAbsentee = true;
        if (!existing.sqft && row.sqft) existing.sqft = row.sqft as number;
        if (!existing.beds && row.beds) existing.beds = row.beds as number;
        if (!existing.baths && row.baths) existing.baths = row.baths as number;
        const rowHidden = row.hidden_mortgages as number || 0;
        if (rowHidden > existing.hiddenMortgages) {
          existing.hiddenMortgages = rowHidden;
        }
        const rowLiens = row.hidden_liens_amount as number || 0;
        if (rowLiens > existing.hiddenLiensAmount) {
          existing.hiddenLiensAmount = rowLiens;
        }
        rowPhones.forEach(p => existing.phones.add(p));
        rowEmails.forEach(e => existing.emails.add(e));
        if (address.length > existing.displayAddress.length) existing.displayAddress = address;
      }

      const lead = groupedMap.get(key)!;
      if (row.photo_urls) {
        try {
          const parsed = JSON.parse(row.photo_urls as string);
          if (Array.isArray(parsed)) {
            parsed.forEach((url: string) => {
              const valid = sanitizeImageUrl(url);
              if (valid && !lead.photoUrls.includes(valid)) lead.photoUrls.push(valid);
            });
          }
        } catch (e) {}
      }

      lead.financialDistress.push(row);
    }

    // H. Group life events
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
          hiddenMortgages: row.hidden_mortgages as number || 0,
          hiddenLiensAmount: row.hidden_liens_amount as number || 0,
          titleCheckStatus: "pending",
          nextRetryDate: undefined,
          mailingAddress: row.mailing_address as string || undefined,
          isAbsentee: (row.absentee_owner as number) === 1,
          sqft: row.sqft as number || undefined,
          beds: row.beds as number || undefined,
          baths: row.baths as number || undefined,
          photoUrls: []
        });
      } else {
        const existing = groupedMap.get(key)!;
        if (!isValidOwnerName(existing.ownerName) && isValidOwnerName(row.subject_name as string)) {
          existing.ownerName = row.subject_name as string;
        }
        if (row.mls_estimated_value && (row.mls_estimated_value as number) > existing.mlsValue) {
          existing.mlsValue = row.mls_estimated_value as number;
        }
        if (row.mls_id && row.mls_id !== "N/A") existing.mlsId = row.mls_id as string;
        if (!existing.mailingAddress && row.mailing_address) existing.mailingAddress = row.mailing_address as string;
        if ((row.absentee_owner as number) === 1) existing.isAbsentee = true;
        if (!existing.sqft && row.sqft) existing.sqft = row.sqft as number;
        if (!existing.beds && row.beds) existing.beds = row.beds as number;
        if (!existing.baths && row.baths) existing.baths = row.baths as number;
        const rowHidden = row.hidden_mortgages as number || 0;
        if (rowHidden > existing.hiddenMortgages) {
          existing.hiddenMortgages = rowHidden;
        }
        const rowLiens = row.hidden_liens_amount as number || 0;
        if (rowLiens > existing.hiddenLiensAmount) {
          existing.hiddenLiensAmount = rowLiens;
        }
        rowPhones.forEach(p => existing.phones.add(p));
        rowEmails.forEach(e => existing.emails.add(e));
        if (address.length > existing.displayAddress.length) existing.displayAddress = address;
      }

      const lead = groupedMap.get(key)!;
      if (row.photo_urls) {
        try {
          const parsed = JSON.parse(row.photo_urls as string);
          if (Array.isArray(parsed)) {
            parsed.forEach((url: string) => {
              const valid = sanitizeImageUrl(url);
              if (valid && !lead.photoUrls.includes(valid)) lead.photoUrls.push(valid);
            });
          }
        } catch (e) {}
      }

      lead.lifeEvents.push(row);
    }

    // I. Group pre_foreclosures
    for (const row of (preForeclosuresRes.rows || [])) {
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
          preForeclosures: [],
          taxSales: [],
          hiddenMortgages: 0,
          hiddenLiensAmount: 0,
          titleCheckStatus: "pending",
          nextRetryDate: undefined,
          mailingAddress: row.mailing_address as string || undefined,
          isAbsentee: (row.absentee_owner as number) === 1,
          sqft: undefined,
          beds: undefined,
          baths: undefined,
          photoUrls: []
        });
      } else {
        const existing = groupedMap.get(key)!;
        if (!isValidOwnerName(existing.ownerName) && isValidOwnerName(row.defendant as string)) existing.ownerName = row.defendant as string;
        if (!existing.mailingAddress && row.mailing_address) existing.mailingAddress = row.mailing_address as string;
        if ((row.absentee_owner as number) === 1) existing.isAbsentee = true;
        rowPhones.forEach(p => existing.phones.add(p));
        rowEmails.forEach(e => existing.emails.add(e));
        if (address.length > existing.displayAddress.length) existing.displayAddress = address;
      }

      const lead = groupedMap.get(key)!;
      if (!lead.preForeclosures) lead.preForeclosures = [];
      lead.preForeclosures.push(row);
      if (row.photo_urls) {
        try {
          const parsed = JSON.parse(row.photo_urls as string);
          if (Array.isArray(parsed)) {
            parsed.forEach((url: string) => {
              const valid = sanitizeImageUrl(url);
              if (valid && !lead.photoUrls.includes(valid)) lead.photoUrls.push(valid);
            });
          }
        } catch (e) {}
      }
    }

    // J. Group tax_sales
    for (const row of (taxSalesRes.rows || [])) {
      const address = row.address as string;
      const key = getGroupingKey(address);
      const rowPhones = (row.defendant_phones as string || "").split(/,\s*|;\s*/).map(p => p.trim()).filter(Boolean);
      const rowEmails = (row.defendant_emails as string || "").split(/,\s*|;\s*/).map(e => e.trim()).filter(Boolean);

      if (!groupedMap.has(key)) {
        groupedMap.set(key, {
          groupingKey: key,
          displayAddress: address,
          state: row.state as string || "IN",
          county: row.county as string || "Clark",
          ownerName: row.owner_name as string || "No especificado",
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
          preForeclosures: [],
          taxSales: [],
          hiddenMortgages: 0,
          hiddenLiensAmount: 0,
          titleCheckStatus: "pending",
          nextRetryDate: undefined,
          mailingAddress: row.mailing_address as string || undefined,
          isAbsentee: (row.absentee_owner as number) === 1,
          sqft: undefined,
          beds: undefined,
          baths: undefined,
          photoUrls: []
        });
      } else {
        const existing = groupedMap.get(key)!;
        if (!isValidOwnerName(existing.ownerName) && isValidOwnerName(row.owner_name as string)) {
          existing.ownerName = row.owner_name as string;
        }
        rowPhones.forEach(p => existing.phones.add(p));
        rowEmails.forEach(e => existing.emails.add(e));
        if (address.length > existing.displayAddress.length) existing.displayAddress = address;
      }

      const lead = groupedMap.get(key)!;
      if (!lead.taxSales) lead.taxSales = [];
      lead.taxSales.push(row);
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
        underwritingSummary: row.underwriting_summary ? JSON.parse(row.underwriting_summary as string) : null
      });
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
      const rehab = calculateRehab(lead.sqft || null, violationKeywords);
      const hiddenDebt = lead.hiddenMortgages || 0;
      const mao = calculateMAO(lead.mlsValue, rehab, hiddenDebt, lead.hiddenLiensAmount);
      const primaryDebt = hasAuctions ? Math.max(...lead.auctions.map(a => (a.debt_amount as number) || 0)) : 0;
      const netEquity = calculateNetEquity(lead.mlsValue, primaryDebt, hiddenDebt, lead.hiddenLiensAmount);
      const purchasePrice = primaryDebt > 0 ? primaryDebt : mao;
      const { roi, totalCost } = calculateROI(lead.mlsValue, purchasePrice, rehab);

      // Institutional Multilayer Underwriting
      const marketVal = (lead.auctions && lead.auctions.length > 0 && lead.auctions[0].appraisal_value > 0) 
        ? Number(lead.auctions[0].appraisal_value) 
        : (lead.mlsValue || 0);
      const totalConsolidatedDebt = primaryDebt + hiddenDebt + (lead.hiddenLiensAmount || 0);
      const institutionalUW = calculateInstitutionalUnderwriting(marketVal, lead.sqft || null, violationKeywords, totalConsolidatedDebt, lead.state);

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
      const hasGeocode = coords && coords.lat !== null;
      const geocodeConf = hasGeocode ? 99.2 : 0;
      const ownerConf = isValidOwnerName(lead.ownerName) ? 96.0 : 60.0;
      const debtConf = (lead.titleCheckStatus === 'success' || primaryDebt > 0) ? 98.4 : 85.0;
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

      const propertyId = `PROP_${lead.groupingKey.replace(/[^a-z0-9]/g, '_').substring(0, 40)}`;
      const propEvents = eventsMap.get(propertyId) || [];
      const propEncumbrances = encumbrancesMap.get(propertyId) || [];
      const scoreObj = scoresMap.get(propertyId) || {
        opportunityScore: 50,
        tacticalAction: 'REVISIÓN PRELIMINAR DE EXPEDIENTE'
      };

      responseData.push({
        groupingKey: lead.groupingKey,
        propertyId: propertyId,
        displayAddress: lead.displayAddress,
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
        opportunityScore: scoreObj.opportunityScore,
        tacticalAction: scoreObj.tacticalAction,
        institutionalUW,
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
        lat: coords ? coords.lat : null,
        lon: coords ? coords.lon : null,
        photoUrls: lead.photoUrls,
        beds: lead.beds,
        baths: lead.baths,
        sqft: lead.sqft,
        llcDirectors: osint.llcDirectors,
        corporateAddress: osint.corporateAddress,
        socialProfiles: osint.socialProfiles,
        usernamesFound: osint.usernamesFound,
        envStressors: osint.envStressors,
        envAttractors: osint.envAttractors
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
    const { property_id, phone_dialed, contact_name, outcome, notes } = req.body;
    if (!property_id || !phone_dialed || !outcome) {
      return res.status(400).json({ status: "error", message: "Missing required fields" });
    }
    const logId = `CALL_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await db.execute({
      sql: "INSERT INTO tzel_call_logs (log_id, property_id, phone_dialed, contact_name, outcome, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
      args: [logId, property_id, phone_dialed, contact_name || '', outcome, notes || '']
    });
    console.log(`[CALL LOG REGISTERED] ${phone_dialed} -> ${outcome} for property ${property_id}`);
    res.json({ status: "success", log_id: logId });
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
  const state = (req.query.state as string || "KY").toUpperCase();

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
    let dbSpecs: { beds: number | null, baths: number | null, sqft: number | null, mls_id: string | null } = {
      beds: null,
      baths: null,
      sqft: null,
      mls_id: null
    };

    const targetKey = getGroupingKey(address);
    const tables = ["foreclosure_auctions", "code_violations", "physical_distress", "financial_distress", "life_events"];
    for (const table of tables) {
      try {
        const queryStr = `SELECT address, beds, baths, sqft, mls_id FROM ${table} WHERE address LIKE '%${houseNumber}%'`;
        const resDb = await db.execute(queryStr);
        for (const row of resDb.rows) {
          const rowAddr = row.address as string;
          if (rowAddr && getGroupingKey(rowAddr) === targetKey) {
            const rowBeds = row.beds !== null && row.beds !== undefined ? Number(row.beds) : null;
            const rowBaths = row.baths !== null && row.baths !== undefined ? Number(row.baths) : null;
            const rowSqft = row.sqft !== null && row.sqft !== undefined ? Number(row.sqft) : null;
            const rowMlsId = row.mls_id as string || null;
            
            // Only break and use these specs if they actually provide some non-null values
            if (rowBeds !== null || rowSqft !== null || rowMlsId !== null) {
              dbSpecs.beds = rowBeds;
              dbSpecs.baths = rowBaths;
              dbSpecs.sqft = rowSqft;
              dbSpecs.mls_id = rowMlsId;
              break;
            }
          }
        }
        if (dbSpecs.beds !== null || dbSpecs.sqft !== null) {
          console.log(`[MCA API] Encontradas características en BD local (tabla ${table}): ${dbSpecs.beds} habs, ${dbSpecs.baths} baños, ${dbSpecs.sqft} sqft, MLS ID: ${dbSpecs.mls_id}`);
          break;
        }
      } catch (dbErr: any) {
        console.error(`[MCA API] Error buscando en tabla local ${table}:`, dbErr.message);
      }
    }

    // 3. Buscar características en el MLS (Spark API)
    console.log(`[MCA API] Buscando propiedad objetivo: "${address}" (${state})`);
    let odataFilter = "";
    if (dbSpecs.mls_id) {
      odataFilter = `ListingId eq '${dbSpecs.mls_id}'`;
    } else {
      odataFilter = `contains(UnparsedAddress, '${houseNumber}') and StateOrProvince eq '${state}'`;
      const zipMatches = address.match(/\b\d{5}\b/g);
      const zipCode = zipMatches ? zipMatches[zipMatches.length - 1] : null;
      if (zipCode) {
        odataFilter += ` and PostalCode eq '${zipCode}'`;
      }
      for (const word of coreWords) {
        odataFilter += ` and contains(tolower(UnparsedAddress), '${word.toLowerCase()}')`;
      }
    }

    let targetProfile = null;
    if (odataFilter) {
      try {
        const propParams = {
          "$filter": odataFilter,
          "$select": "ListingId,UnparsedAddress,PostalCode,BedroomsTotal,BathroomsTotalDecimal,LivingArea,YearBuilt,ListPrice,ClosePrice,StandardStatus,CloseDate",
          "$top": 20
        };
        const propRes = await axios.get(url, { headers, params: propParams });
        const records = propRes.data.value || [];

        if (records.length > 0) {
          if (dbSpecs.mls_id) {
            targetProfile = records[0];
          } else {
            // Intentar coincidir por clave de agrupación
            for (const record of records) {
              const recAddr = record.UnparsedAddress || "";
              if (recAddr && getGroupingKey(recAddr) === targetKey) {
                targetProfile = record;
                break;
              }
            }
            // Fallback: coincidencia de palabras clave en memoria
            if (!targetProfile) {
              for (const record of records) {
                const mlsAddress = record.UnparsedAddress || "";
                const mlsCleaned = mlsAddress.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
                const mlsWords = mlsCleaned.split(/\s+/).filter((w: string) => w.length > 0);
                const isMatch = coreWords.every(word => mlsWords.includes(word.toLowerCase()));
                if (isMatch) {
                  targetProfile = record;
                  break;
                }
              }
            }
            // Fallback de último recurso
            if (!targetProfile) {
              const validRecords = records.filter((r: any) => r.LivingArea > 0 || r.BedroomsTotal > 0);
              targetProfile = validRecords.length > 0 ? validRecords[0] : records[0];
            }
          }
        }
      } catch (mlsErr: any) {
        console.error("[MCA API] Error consultando propiedad objetivo en MLS:", mlsErr.message);
      }
    }

    // Extraer o suponer características
    let zip = "";
    const zipMatch = address.match(/\b\d{5}\b/);
    if (zipMatch) {
      zip = zipMatch[0];
    } else if (targetProfile && targetProfile.PostalCode) {
      zip = targetProfile.PostalCode;
    }

    let beds = (targetProfile && targetProfile.BedroomsTotal) ? targetProfile.BedroomsTotal : (dbSpecs.beds || 3);
    let baths = (targetProfile && targetProfile.BathroomsTotalDecimal) ? targetProfile.BathroomsTotalDecimal : (dbSpecs.baths || 2);
    let sqft = (targetProfile && targetProfile.LivingArea) ? targetProfile.LivingArea : (dbSpecs.sqft || 1200);

    if (!beds || beds === 0) beds = dbSpecs.beds || 3;
    if (!baths || baths === 0) baths = dbSpecs.baths || 2;
    if (!sqft || sqft === 0) sqft = dbSpecs.sqft || 1200;

    if (!zip) {
      return res.json({ status: "error", message: "No se pudo determinar el código postal" });
    }

    // 3. Buscar comparables vendidos en los últimos 180 días
    const date180DaysAgo = new Date();
    date180DaysAgo.setDate(date180DaysAgo.getDate() - 180);
    const date180Str = date180DaysAgo.toISOString().split("T")[0];

    // Ajustar el filtro: mismos habs +/- 1, misma área +/- 350 sqft, misma zona postal
    const compsFilter = `PostalCode eq '${zip}' and StandardStatus eq 'Closed' and ClosePrice gt 20000 and BedroomsTotal ge ${beds - 1} and BedroomsTotal le ${beds + 1} and LivingArea ge ${sqft - 350} and LivingArea le ${sqft + 350} and CloseDate ge ${date180Str}`;

    console.log(`[MCA API] Buscando comps en Zip ${zip}: ${compsFilter}`);
    const compsParams = {
      "$filter": compsFilter,
      "$select": "ListingId,UnparsedAddress,ClosePrice,CloseDate,BedroomsTotal,BathroomsTotalDecimal,LivingArea",
      "$top": 8
    };

    let compsRes = await axios.get(url, { headers, params: compsParams });
    let comps = compsRes.data.value || [];

    // Fallback a 365 días si no hay comps
    if (comps.length === 0) {
      console.log(`[MCA API] Sin comparables en 180 días. Probando con 365 días...`);
      const date365DaysAgo = new Date();
      date365DaysAgo.setDate(date365DaysAgo.getDate() - 365);
      const date365Str = date365DaysAgo.toISOString().split("T")[0];

      const compsFilter365 = `PostalCode eq '${zip}' and StandardStatus eq 'Closed' and ClosePrice gt 20000 and BedroomsTotal ge ${beds - 1} and BedroomsTotal le ${beds + 1} and LivingArea ge ${sqft - 350} and LivingArea le ${sqft + 350} and CloseDate ge ${date365Str}`;

      const compsParams365 = {
        "$filter": compsFilter365,
        "$select": "ListingId,UnparsedAddress,ClosePrice,CloseDate,BedroomsTotal,BathroomsTotalDecimal,LivingArea",
        "$top": 8
      };
      compsRes = await axios.get(url, { headers, params: compsParams365 });
      comps = compsRes.data.value || [];
    }

    let mcaArv = 0;
    if (comps.length > 0) {
      const sum = comps.reduce((acc: number, c: any) => acc + (c.ClosePrice || 0), 0);
      mcaArv = Math.round(sum / comps.length);
    }

    res.json({
      status: "success",
      target: {
        address,
        zip,
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
      }))
    });

  } catch (err: any) {
    console.error("[MCA API ERROR]", err.message);
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
    app.listen(PORT, () => {
      console.log(`\n========================================================`);
      console.log(`🚀 TZEL TACTICAL MAP SERVER STARTED ON PORT ${PORT}`);
      console.log(`👉 Open http://localhost:${PORT} in your browser`);
      console.log(`========================================================\n`);
    });
  }
}

initializeServer();

export default app;

