import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import { unmaskLLCOrCorporation } from "./opencorporates_unmasker";
import { unmaskAlternativeContacts } from "./alternative_contact_unmasker";
import { auditEnvironment } from "./environmental_auditor";

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

// Helper functions copied from tzel_map_server for address normalization parity
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

/**
 * Runs the full OSINT enrichment on all properties currently in foreclosure auctions or code violations.
 */
export async function runOSINTEnrichment(): Promise<number> {
  console.log("\n=================================================================");
  console.log("🌐 [OSINT] INICIANDO PIPELINE DE ENRIQUECIMIENTO AVANZADO 🌐");
  console.log("=================================================================");

  let enrichedCount = 0;

  try {
    // 1. Gather all active unique addresses, owners, emails, and coordinates from DB
    const auctions = await db.execute(`
      SELECT address, defendant as owner_name, defendant_emails as emails
      FROM foreclosure_auctions
      WHERE address IS NOT NULL AND address != ''
    `);

    const violations = await db.execute(`
      SELECT address, owner_name, defendant_emails as emails
      FROM code_violations
      WHERE address IS NOT NULL AND address != ''
    `);

    // Merge them by groupingKey
    const leadMap = new Map<string, { address: string; ownerName: string; email: string | null }>();

    for (const row of auctions.rows) {
      const address = row.address as string;
      const key = getGroupingKey(address);
      leadMap.set(key, {
        address,
        ownerName: row.owner_name as string || "Unknown",
        email: (row.emails as string || "").split(/,\s*|;\s*/)[0] || null
      });
    }

    for (const row of violations.rows) {
      const address = row.address as string;
      const key = getGroupingKey(address);
      if (!leadMap.has(key)) {
        leadMap.set(key, {
          address,
          ownerName: row.owner_name as string || "Unknown",
          email: (row.emails as string || "").split(/,\s*|;\s*/)[0] || null
        });
      }
    }

    console.log(`[OSINT] Encontradas ${leadMap.size} propiedades únicas agrupadas para enriquecer.`);

    // Pre-load coordinate cache
    const geocodeRes = await db.execute("SELECT address, lat, lon FROM geocode_cache");
    const geocodeMap = new Map<string, { lat: number; lon: number }>();
    for (const row of geocodeRes.rows) {
      if (row.address && row.lat !== null && row.lon !== null) {
        geocodeMap.set(row.address as string, { lat: row.lat as number, lon: row.lon as number });
      }
    }

    // 2. Loop through each property and run Cape B (LLC), Capa C (Socials), Capa D (OSM)
    for (const [key, lead] of leadMap.entries()) {
      console.log(`\n[OSINT] Procesando lead: "${lead.address}" (Llave: ${key})`);

      // Cape B: OpenCorporates unmasker
      await unmaskLLCOrCorporation(lead.ownerName, key);

      // Capa C: Sherlock & Holehe alternative contact checker
      await unmaskAlternativeContacts(lead.ownerName, lead.email, key);

      // Capa D: Overpass OSM environmental check
      // Find coordinates in cache
      const coords = geocodeMap.get(lead.address);
      if (coords) {
        await auditEnvironment(coords.lat, coords.lon, key, lead.address);
      } else {
        console.log(`[OSM AUDITOR] Coordenadas no encontradas en caché para "${lead.address}". Pasando nulos.`);
        await auditEnvironment(null, null, key, lead.address);
      }

      enrichedCount++;
    }

  } catch (error: any) {
    console.error("[OSINT PIPELINE ERROR] Falló enriquecimiento:", error.message);
  }

  console.log(`\n[OSINT] Pipeline finalizado. Se enriquecieron ${enrichedCount} propiedades.`);
  return enrichedCount;
}

if (require.main === module) {
  runOSINTEnrichment().catch(console.error);
}
