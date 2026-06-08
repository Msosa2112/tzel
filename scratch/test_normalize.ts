import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

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
  // 1. Split by comma and take first part
  let part1 = address.split(",")[0].trim().toLowerCase();
  
  // 2. Truncate at unit indicators
  for (const indicator of UNIT_INDICATORS) {
    const idx = part1.indexOf(indicator);
    if (idx !== -1) {
      part1 = part1.substring(0, idx).trim();
    }
  }
  
  // 3. Remove other non-alphanumeric chars
  part1 = part1.replace(/[^a-z0-9\s]/g, " ");
  
  // 4. Split into words
  const words = part1.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) {
    return { houseNumber: null, coreWords: [] };
  }
  
  // 5. Extract house number (first word if it starts with a digit)
  let houseNumber: string | null = null;
  let streetStartIndex = 0;
  
  if (/^\d+/.test(words[0])) {
    houseNumber = words[0];
    streetStartIndex = 1;
  }
  
  // 6. Extract core words
  const coreWords: string[] = [];
  for (let i = streetStartIndex; i < words.length; i++) {
    const w = words[i];
    // Filter noise words and ZIP codes (5 digits)
    if (NOISE_WORDS.has(w)) continue;
    if (/^\d{5}$/.test(w)) continue;
    coreWords.push(w);
  }
  
  return { houseNumber, coreWords };
}

async function testNormalize() {
  const res = await db.execute("SELECT address, county, state FROM foreclosure_auctions LIMIT 20");
  console.log("Parsing sample addresses from database:");
  for (const row of res.rows) {
    const address = row.address as string;
    const { houseNumber, coreWords } = parseAddress(address);
    console.log(`Original: "${address}"`);
    console.log(`Parsed  : House: "${houseNumber}", Core Words: ${JSON.stringify(coreWords)}`);
    console.log("-----------------------------------------");
  }
}

testNormalize().catch(console.error);
