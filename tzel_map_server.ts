import express from "express";
import axios from "axios";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import * as path from "path";
import { calculateRehab, calculateMAO, calculateROI, isJuniorLien, calculateNetEquity, isUnderwater, checkCriticalRisk } from "./underwriting/underwriter";

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

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

function getGroupingKey(address: string): string {
  const parsed = parseAddress(address);
  if (!parsed.houseNumber) {
    return address.toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  return `${parsed.houseNumber}_${parsed.coreWords.join("_")}`;
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
  hiddenMortgages: number;
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
      return null; // Cached as not found
    }
  } catch (err) {
    console.error("[CACHE READ ERROR] Failed to query cache:", err);
  }

  // 1. Try US Census Geocoder first (No rate limits, fast for US addresses)
  const censusUrl = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
  try {
    console.log(`[GEOCODER] Trying US Census Geocoder for: "${address}"`);
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

  // 2. Fall back to OpenStreetMap Nominatim (if cooldown is not active)
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


app.get("/api/prospectos", async (req, res) => {
  console.log("[API] /api/prospectos requested");

  try {
    // 1. Fetch auctions
    const auctionsRes = await db.execute(`
      SELECT 
        auction_id, case_number, address, county, state, auction_date, 
        plaintiff, defendant, debt_amount, appraisal_value, 
        mls_estimated_value, mls_id, pdf_url,
        defendant_phones, defendant_emails, needs_manual_review,
        mailing_address, absentee_owner, sqft, beds, baths, hidden_mortgages, hidden_liens_amount, photo_urls,
        title_check_status, next_retry_date
      FROM foreclosure_auctions
    `);
    
    // Filter auctions to next 60 days or Indiana manual reviews
    const opportunities = auctionsRes.rows.filter(row => {
      const state = (row.state as string || "").toUpperCase();
      if (state !== "KY" && state !== "IN") return false;
      const dateStr = row.auction_date as string;
      const daysRemaining = getDaysRemaining(dateStr);
      if (daysRemaining === null) return true; // Keep manual reviews
      return daysRemaining >= 0 && daysRemaining <= 60;
    });

    // 2. Fetch code violations
    const violationsRes = await db.execute(`
      SELECT 
        violation_id, case_number, address, violation_type, report_date, status, 
        owner_name, mls_estimated_value, mls_id, defendant_phones, defendant_emails,
        mailing_address, absentee_owner, sqft, beds, baths, hidden_mortgages, hidden_liens_amount, photo_urls
      FROM code_violations
    `);
    const violations = violationsRes.rows;

    // 3. Fetch probates
    const probatesRes = await db.execute(`
      SELECT probate_id, case_number, address, county, state, deceased_name, heir_name, heir_phones, heir_emails
      FROM probates
    `);
    const probates = probatesRes.rows.filter(row => {
      const state = (row.state as string || "").toUpperCase();
      return state === "KY" || state === "IN";
    });

    // 4. Fetch divorces
    const divorcesRes = await db.execute(`
      SELECT divorce_id, case_number, address, county, state, spouse_a, spouse_b, spouse_a_phones, spouse_a_emails, spouse_b_phones, spouse_b_emails
      FROM divorces
    `);
    const divorces = divorcesRes.rows.filter(row => {
      const state = (row.state as string || "").toUpperCase();
      return state === "KY" || state === "IN";
    });

    // 5. Fetch bankruptcies
    const bankruptciesRes = await db.execute(`
      SELECT bankruptcy_id, case_number, address, county, state, debtor_name, bankruptcy_type, debtor_phones, debtor_emails
      FROM bankruptcies
    `);
    const bankruptcies = bankruptciesRes.rows.filter(row => {
      const state = (row.state as string || "").toUpperCase();
      return state === "KY" || state === "IN";
    });

    // 6. Fetch physical distress
    const physicalRes = await db.execute(`
      SELECT distress_id, address, county, state, distress_type, report_date, details, owner_name,
             mls_estimated_value, mls_id, defendant_phones, defendant_emails, mailing_address, absentee_owner, sqft, beds, baths, hidden_mortgages, hidden_liens_amount, photo_urls
      FROM physical_distress
    `);
    const physicalDistressList = physicalRes.rows.filter(row => {
      const state = (row.state as string || "").toUpperCase();
      return state === "KY" || state === "IN";
    });

    // 7. Fetch financial distress
    const financialRes = await db.execute(`
      SELECT record_id, case_number, address, county, state, record_type, debt_amount, owner_name, plaintiff, report_date,
             mls_estimated_value, mls_id, defendant_phones, defendant_emails, mailing_address, absentee_owner, sqft, beds, baths, hidden_mortgages, hidden_liens_amount, photo_urls
      FROM financial_distress
    `);
    const financialDistressList = financialRes.rows.filter(row => {
      const state = (row.state as string || "").toUpperCase();
      return state === "KY" || state === "IN";
    });

    // 8. Fetch life events
    const lifeEventsRes = await db.execute(`
      SELECT event_id, event_type, subject_name, address, county, state, details, report_date,
             mls_estimated_value, mls_id, defendant_phones, defendant_emails, mailing_address, absentee_owner, sqft, beds, baths, hidden_mortgages, hidden_liens_amount, photo_urls
      FROM life_events
    `);
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
        if (row.mls_estimated_value && (row.mls_estimated_value as number) > existing.mlsValue) {
          existing.mlsValue = row.mls_estimated_value as number;
        }
        if (row.mls_id && row.mls_id !== "N/A") existing.mlsId = row.mls_id as string;
        if (existing.ownerName === "No especificado" && row.defendant) existing.ownerName = row.defendant as string;
        if (!existing.mailingAddress && row.mailing_address) existing.mailingAddress = row.mailing_address as string;
        if ((row.absentee_owner as number) === 1) existing.isAbsentee = true;
        if (!existing.sqft && row.sqft) existing.sqft = row.sqft as number;
        if (!existing.beds && row.beds) existing.beds = row.beds as number;
        if (!existing.baths && row.baths) existing.baths = row.baths as number;
        const rowHidden = (row.hidden_mortgages as number || 0) + (row.hidden_liens_amount as number || 0);
        if (rowHidden > existing.hiddenMortgages) {
          existing.hiddenMortgages = rowHidden;
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
              if (url && !lead.photoUrls.includes(url)) lead.photoUrls.push(url);
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
        if (row.mls_id && row.mls_id !== "N/A") existing.mlsId = row.mls_id as string;
        if (!existing.mailingAddress && row.mailing_address) existing.mailingAddress = row.mailing_address as string;
        if ((row.absentee_owner as number) === 1) existing.isAbsentee = true;
        if (!existing.sqft && row.sqft) existing.sqft = row.sqft as number;
        if (!existing.beds && row.beds) existing.beds = row.beds as number;
        if (!existing.baths && row.baths) existing.baths = row.baths as number;
        const rowHidden = (row.hidden_mortgages as number || 0) + (row.hidden_liens_amount as number || 0);
        if (rowHidden > existing.hiddenMortgages) {
          existing.hiddenMortgages = rowHidden;
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
              if (url && !lead.photoUrls.includes(url)) lead.photoUrls.push(url);
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
        if (row.mls_id && row.mls_id !== "N/A") existing.mlsId = row.mls_id as string;
        if (!existing.mailingAddress && row.mailing_address) existing.mailingAddress = row.mailing_address as string;
        if ((row.absentee_owner as number) === 1) existing.isAbsentee = true;
        if (!existing.sqft && row.sqft) existing.sqft = row.sqft as number;
        if (!existing.beds && row.beds) existing.beds = row.beds as number;
        if (!existing.baths && row.baths) existing.baths = row.baths as number;
        const rowHidden = (row.hidden_mortgages as number || 0) + (row.hidden_liens_amount as number || 0);
        if (rowHidden > existing.hiddenMortgages) {
          existing.hiddenMortgages = rowHidden;
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
              if (url && !lead.photoUrls.includes(url)) lead.photoUrls.push(url);
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
        if (row.mls_id && row.mls_id !== "N/A") existing.mlsId = row.mls_id as string;
        if (!existing.mailingAddress && row.mailing_address) existing.mailingAddress = row.mailing_address as string;
        if ((row.absentee_owner as number) === 1) existing.isAbsentee = true;
        if (!existing.sqft && row.sqft) existing.sqft = row.sqft as number;
        if (!existing.beds && row.beds) existing.beds = row.beds as number;
        if (!existing.baths && row.baths) existing.baths = row.baths as number;
        const rowHidden = (row.hidden_mortgages as number || 0) + (row.hidden_liens_amount as number || 0);
        if (rowHidden > existing.hiddenMortgages) {
          existing.hiddenMortgages = rowHidden;
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
              if (url && !lead.photoUrls.includes(url)) lead.photoUrls.push(url);
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
        if (row.mls_id && row.mls_id !== "N/A") existing.mlsId = row.mls_id as string;
        if (!existing.mailingAddress && row.mailing_address) existing.mailingAddress = row.mailing_address as string;
        if ((row.absentee_owner as number) === 1) existing.isAbsentee = true;
        if (!existing.sqft && row.sqft) existing.sqft = row.sqft as number;
        if (!existing.beds && row.beds) existing.beds = row.beds as number;
        if (!existing.baths && row.baths) existing.baths = row.baths as number;
        const rowHidden = (row.hidden_mortgages as number || 0) + (row.hidden_liens_amount as number || 0);
        if (rowHidden > existing.hiddenMortgages) {
          existing.hiddenMortgages = rowHidden;
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
              if (url && !lead.photoUrls.includes(url)) lead.photoUrls.push(url);
            });
          }
        } catch (e) {}
      }

      lead.lifeEvents.push(row);
    }

    // Pre-cargar la caché de geocodificación en memoria para evitar el problema de consultas N+1
    const geocodeMap = new Map<string, { lat: number; lon: number }>();
    try {
      const cacheRes = await db.execute("SELECT address, lat, lon FROM geocode_cache");
      for (const row of cacheRes.rows) {
        if (row.address && row.lat !== null && row.lon !== null) {
          geocodeMap.set(row.address as string, { lat: row.lat as number, lon: row.lon as number });
        }
      }
    } catch (err) {
      console.error("[GEOCODE CACHE LOAD ERROR] Failed to pre-load geocode cache:", err);
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
      const mao = calculateMAO(lead.mlsValue, rehab, hiddenDebt);
      const primaryDebt = hasAuctions ? (lead.auctions[0].debt_amount as number || 0) : 0;
      const netEquity = calculateNetEquity(lead.mlsValue, primaryDebt, hiddenDebt);
      const purchasePrice = primaryDebt > 0 ? primaryDebt : mao;
      const { roi, totalCost } = calculateROI(lead.mlsValue, purchasePrice, rehab);

      // Regla de Stacking / Alta Motivación
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

      // Check geocode cache first from memory map
      const coords = geocodeMap.get(lead.displayAddress) || null;

      responseData.push({
        groupingKey: lead.groupingKey,
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
        hiddenMortgages: hiddenDebt,
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
        photoUrls: lead.photoUrls
      });
    }

    // Trigger background geocoding check without blocking the response
    startBackgroundGeocoding().catch(err => {
      console.error("[BG GEOCODER TRIGGER ERROR]", err.message);
    });

    res.json({ status: "success", count: responseData.length, data: responseData });
  } catch (err: any) {
    console.error("[API ERROR] Failed to fetch leads:", err.message);
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

    // 1. Extraer número de casa
    const houseNumberMatch = address.match(/^\d+/);
    if (!houseNumberMatch) {
      return res.json({ status: "error", message: "No se pudo extraer el número de casa de la dirección" });
    }
    const houseNumber = houseNumberMatch[0];

    // 2. Intentar buscar características de la propiedad en el MLS
    console.log(`[MCA API] Buscando propiedad objetivo: "${address}" (${state})`);
    const propParams = {
      "$filter": `contains(UnparsedAddress, '${houseNumber}') and StateOrProvince eq '${state}'`,
      "$select": "ListingId,UnparsedAddress,PostalCode,BedroomsTotal,BathroomsTotalDecimal,LivingArea,YearBuilt,ListPrice,ClosePrice,StandardStatus,CloseDate",
      "$top": 10
    };

    const propRes = await axios.get(url, { headers, params: propParams });
    const records = propRes.data.value || [];

    let targetProfile = null;
    if (records.length > 0) {
      const validRecords = records.filter((r: any) => r.LivingArea > 0 || r.BedroomsTotal > 0);
      targetProfile = validRecords.length > 0 ? validRecords[0] : records[0];
    }

    // Extraer o suponer características
    let zip = "";
    const zipMatch = address.match(/\b\d{5}\b/);
    if (zipMatch) {
      zip = zipMatch[0];
    } else if (targetProfile && targetProfile.PostalCode) {
      zip = targetProfile.PostalCode;
    }

    let beds = targetProfile ? targetProfile.BedroomsTotal : 3;
    let baths = targetProfile ? targetProfile.BathroomsTotalDecimal : 2;
    let sqft = targetProfile ? targetProfile.LivingArea : 1200;

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

    // Filtrar las direcciones que ya están en caché
    const uncachedAddresses: string[] = [];
    for (const address of addresses) {
      const cacheRes = await db.execute({
        sql: "SELECT 1 FROM geocode_cache WHERE address = ?",
        args: [address]
      });
      if (cacheRes.rows.length === 0) {
        uncachedAddresses.push(address);
      }
    }

    if (uncachedAddresses.length > 0) {
      console.log(`[BACKGROUND GEOCODER] Se encontraron ${uncachedAddresses.length} direcciones pendientes de geocodificación.`);
      
      for (let i = 0; i < uncachedAddresses.length; i++) {
        const addr = uncachedAddresses[i];
        console.log(`[BACKGROUND GEOCODER] Procesando ${i + 1}/${uncachedAddresses.length}: "${addr}"`);
        
        await getCoordinates(addr);
        
        // Espera de 1.5s para no saturar la API gratuita de Nominatim
        await sleep(1500);
      }
      console.log("[BACKGROUND GEOCODER] Geocodificación en lote completada.");
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

