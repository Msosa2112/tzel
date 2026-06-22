import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import axios from "axios";
import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import { scoreAllProperties } from "../intelligence/stress_scorer";

dotenv.config();

try {
  chromium.use(stealthPlugin());
} catch (e) {}

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

// Common noise words in addresses
const NOISE_WORDS = new Set([
  "st", "street", "ave", "avenue", "rd", "road", "ln", "lane", "dr", "drive", 
  "ct", "court", "blvd", "boulevard", "way", "pl", "place", "hwy", "highway", 
  "rte", "route", "cir", "circle", "ter", "terrace", "trl", "trail", "pkwy", "parkway",
  "apt", "apartment", "unit", "ste", "suite", "fl", "floor", 
  "n", "north", "s", "south", "e", "east", "w", "west", 
  "ky", "in", "louisville", "new", "albany", "jefferson", "clark", "floyd"
]);

// Global Playwright references for reuse
let browser: any = null;
let pageInstance: any = null;

async function getBrowserPage() {
  if (!browser) {
    console.log("   🚀 Inicializando navegador Playwright Stealth único...");
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 }
    });
    pageInstance = await context.newPage();
    // Block stylesheets, fonts, and media
    await pageInstance.route("**/*", (route: any) => {
      const type = route.request().resourceType();
      if (["stylesheet", "font", "media"].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });
  }
  return pageInstance;
}

/**
 * Extracts the house number from the address.
 */
function getHouseNumber(address: string): string | null {
  const match = address.trim().match(/^\d+/);
  return match ? match[0] : null;
}

/**
 * Extracts core street name tokens to verify matches.
 */
function getStreetTokens(address: string): string[] {
  const clean = address.toLowerCase().replace(/,/g, "").trim();
  const parts = clean.split(/\s+/);
  return parts.filter((part, idx) => {
    if (idx === 0 && /^\d+$/.test(part)) return false; // Skip house number
    if (/^\d{5}$/.test(part)) return false; // Skip zip code
    if (NOISE_WORDS.has(part)) return false;
    return part.length > 2;
  });
}

/**
 * Parses valuation from text.
 */
function extractValuationFromText(text: string): number | null {
  // 1. Zillow Zestimate format "$123,456 Zestimate" or "$123,456 Zestimate®"
  const z1 = text.match(/\$([0-9,]{4,})\s*Zestimate/i);
  if (z1) {
    const val = parseInt(z1[1].replace(/,/g, ""), 10);
    if (!isNaN(val) && val > 0) return val;
  }
  
  // 2. Zillow/Redfin "Est. $123,456"
  const est = text.match(/Est\.\s*\$([0-9,]{4,})/i);
  if (est) {
    const val = parseInt(est[1].replace(/,/g, ""), 10);
    if (!isNaN(val) && val > 0) return val;
  }

  // 3. Redfin Estimate standard format (line-by-line check)
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const lineLower = lines[i].toLowerCase();
    if ((lineLower === "redfin estimate" || lineLower === "estimate" || lineLower.includes("redfin estimate")) && i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      const match = nextLine.match(/^\$([0-9,]{4,})/);
      if (match) {
        const val = parseInt(match[1].replace(/,/g, ""), 10);
        if (!isNaN(val) && val > 0) return val;
      }
    }
  }

  // 4. Redfin Estimate regex inline
  const rf1 = text.match(/Redfin Estimate\s*:?\s*\$?([0-9,]{4,})/i);
  if (rf1) {
    const val = parseInt(rf1[1].replace(/,/g, ""), 10);
    if (!isNaN(val) && val > 0) return val;
  }

  // 5. Zestimate: $123,456
  const z2 = text.match(/Zestimate®?:?\s*\$([0-9,]{4,})/i);
  if (z2) {
    const val = parseInt(z2[1].replace(/,/g, ""), 10);
    if (!isNaN(val) && val > 0) return val;
  }

  // 6. Generic dollar amount in snippet or body that is labeled as value
  const genericVal = text.match(/value\s+is\s+\$?([0-9,]{4,})/i) || text.match(/worth\s+\$?([0-9,]{4,})/i) || text.match(/estimated\s+at\s+\$?([0-9,]{4,})/i);
  if (genericVal) {
    const val = parseInt(genericVal[1].replace(/,/g, ""), 10);
    if (!isNaN(val) && val > 0) return val;
  }

  return null;
}

/**
 * Extracts beds, baths, and sqft from text.
 */
function extractSpecsFromText(text: string): { beds: number | null, baths: number | null, sqft: number | null } {
  let beds: number | null = null;
  let baths: number | null = null;
  let sqft: number | null = null;

  // 1. Zillow format in snippets: "3 bd|2 ba|1.2k sqft"
  const zFormat = text.match(/(\d+)\s*bd\s*\|\s*([0-9.]+)\s*ba\s*\|\s*([0-9.]+)(k)?\s*sqft/i);
  if (zFormat) {
    beds = parseInt(zFormat[1], 10);
    baths = parseFloat(zFormat[2]);
    const num = parseFloat(zFormat[3]);
    const isK = zFormat[4];
    sqft = isK ? num * 1000 : num;
  }

  // 2. Redfin format in body: "3 beds, 1 bath, 1480 sq. ft." or "3 Beds | 2 Baths | 1594 Sq. Ft."
  if (!beds) {
    const bdMatch = text.match(/(\d+)\s*beds?/i) || text.match(/(\d+)\s*bd/i);
    if (bdMatch) beds = parseInt(bdMatch[1], 10);
  }
  if (!baths) {
    const baMatch = text.match(/([0-9.]+)\s*baths?/i) || text.match(/([0-9.]+)\s*bath/i) || text.match(/([0-9.]+)\s*ba/i);
    if (baMatch) baths = parseFloat(baMatch[1]);
  }
  if (!sqft) {
    const sqMatch = text.match(/([0-9,]+)\s*sq\.?\s*ft\.?/i) || text.match(/([0-9,]+)\s*square foot/i) || text.match(/([0-9,]+)\s*square feet/i);
    if (sqMatch) sqft = parseInt(sqMatch[1].replace(/,/g, ""), 10);
  }

  return { beds, baths, sqft };
}

/**
 * Query local SearXNG instance.
 */
async function queryLocalSearXNG(query: string): Promise<any[]> {
  const localUrl = "http://localhost:8080/search";
  try {
    const response = await axios.get(localUrl, {
      params: { q: query, format: "json" },
      timeout: 6000 // Fast timeout of 6 seconds
    });
    if (response.status === 200 && response.data && Array.isArray(response.data.results)) {
      return response.data.results;
    }
  } catch (err: any) {
    console.warn(`      [SEARXNG WARN] Local SearXNG query failed: ${err.message}`);
  }
  return [];
}

/**
 * Fallback search via DuckDuckGo HTML using Playwright.
 */
async function queryDuckDuckGo(query: string): Promise<any[]> {
  try {
    const page = await getBrowserPage();
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    
    const results = await page.evaluate(() => {
      // @ts-ignore
      const links = Array.from(document.querySelectorAll("a.result__url, a.result__a"));
      // @ts-ignore
      const snippets = Array.from(document.querySelectorAll(".result__snippet"));
      
      return links.map((a, idx) => {
        const href = (a as any).href || "";
        const snippetText = snippets[idx] ? (snippets[idx] as any).innerText : "";
        const titleText = (a as any).innerText || "";
        return { url: href, title: titleText, snippet: snippetText };
      });
    });

    // Decode DDG redirects
    return results.map((res: any) => {
      const match = res.url.match(/[?&]uddg=([^&]+)/);
      const decodedUrl = match ? decodeURIComponent(match[1]) : res.url;
      return { ...res, url: decodedUrl };
    });
  } catch (err: any) {
    console.warn(`      [DDG WARN] DuckDuckGo search failed: ${err.message}`);
  }
  return [];
}

/**
 * Main function to resolve missing valuations.
 */
async function resolveMissingValuations() {
  console.log("=================================================================");
  console.log("🏡 INICIANDO RESOLUCIÓN DE VALORACIONES (ZILLOW / REDFIN) 🏡");
  console.log("=================================================================");

  const tables = [
    { name: "foreclosure_auctions", idCol: "auction_id", query: "SELECT auction_id, address, state FROM foreclosure_auctions WHERE (mls_estimated_value IS NULL OR mls_estimated_value = 0) AND mls_status = 'not_found'" },
    { name: "code_violations", idCol: "violation_id", query: "SELECT violation_id, address, 'KY' as state FROM code_violations WHERE (mls_estimated_value IS NULL OR mls_estimated_value = 0) AND mls_status = 'not_found'" },
    { name: "physical_distress", idCol: "distress_id", query: "SELECT distress_id, address, state FROM physical_distress WHERE (mls_estimated_value IS NULL OR mls_estimated_value = 0) AND mls_status = 'not_found'" },
    { name: "financial_distress", idCol: "record_id", query: "SELECT record_id, address, state FROM financial_distress WHERE (mls_estimated_value IS NULL OR mls_estimated_value = 0) AND mls_status = 'not_found'" }
  ];

  let totalProcessed = 0;
  let totalResolved = 0;

  for (const table of tables) {
    console.log(`\n[TABLA] Consultando registros sin valorar en: ${table.name}...`);
    let rowsRes;
    try {
      rowsRes = await db.execute(table.query);
    } catch (err: any) {
      console.error(`❌ Error al consultar la tabla ${table.name}:`, err.message);
      continue;
    }

    const rows = rowsRes.rows;
    console.log(`Se encontraron ${rows.length} registros sin valorar en ${table.name}.`);

    for (const row of rows) {
      const idVal = row[table.idCol] as string;
      const rawAddress = row.address as string;
      const state = (row.state as string || "KY").trim().toUpperCase();
      
      if (!rawAddress || rawAddress.trim() === "") continue;
      
      totalProcessed++;
      console.log(`\n[PROCESANDO] ${totalProcessed}. ID: ${idVal} | Dirección: "${rawAddress}" | Estado: ${state}`);

      // Clean address of suites/apts for query
      let searchAddress = rawAddress;
      const unitIndicators = ["apt", "unit", "ste", "suite", "#", "apartment"];
      for (const indicator of unitIndicators) {
        const idx = searchAddress.toLowerCase().indexOf(indicator);
        if (idx !== -1) {
          searchAddress = searchAddress.substring(0, idx).trim();
        }
      }

      const houseNum = getHouseNumber(searchAddress);
      const streetTokens = getStreetTokens(searchAddress);

      // Construct a flexible search query to bypass abbreviation mismatches
      let query = "";
      if (houseNum && streetTokens.length > 0) {
        query = `${houseNum} ${streetTokens.join(" ")} ${state} Zillow Redfin`;
      } else {
        query = `${searchAddress} Zillow Redfin`;
      }

      console.log(`   Query flexible: "${query}"`);
      
      // 1. Query SearXNG first
      let results = await queryLocalSearXNG(query);
      
      // 2. Fallback to DuckDuckGo HTML if SearXNG is empty/unresponsive
      if (results.length === 0) {
        console.log(`   [FALLBACK] SearXNG vacío. Consultando DuckDuckGo HTML...`);
        results = await queryDuckDuckGo(query);
      }

      // Filter and verify URL matches
      const matchedResults = results.filter(res => {
        const url = res.url || "";
        const title = res.title || "";
        const lowerUrl = url.toLowerCase();
        
        // Must match house number
        if (houseNum && !lowerUrl.replace(/[^a-z0-9]/g, "").includes(houseNum)) {
          return false;
        }
        // Must contain at least one street token
        if (streetTokens.length > 0) {
          const hasStreet = streetTokens.some(token => lowerUrl.includes(token) || title.toLowerCase().includes(token));
          if (!hasStreet) return false;
        }
        return lowerUrl.includes("zillow.com/homedetails") || 
               lowerUrl.includes("redfin.com") || 
               lowerUrl.includes("realtor.com/realestateandhomes-detail");
      });

      // Sort results to prioritize Redfin over Zillow for Playwright browsing (to avoid Cloudflare blocks)
      const sortedResults = matchedResults.sort((a, b) => {
        const aRedfin = a.url.toLowerCase().includes("redfin.com") ? 1 : 0;
        const bRedfin = b.url.toLowerCase().includes("redfin.com") ? 1 : 0;
        return bRedfin - aRedfin; // Redfin first
      });

      console.log(`   Encontrados ${sortedResults.length} enlaces coincidentes verificados.`);
      
      let valuation: number | null = null;
      let specs: { beds: number | null, baths: number | null, sqft: number | null } = { beds: null, baths: null, sqft: null };
      let sourceUrl = "";
      let sourceStatus = "";

      // 1. Try snippet parsing first (all candidates)
      for (const res of sortedResults) {
        const text = `${res.title || ""} ${res.content || res.snippet || ""}`;
        const val = extractValuationFromText(text);
        if (val) {
          valuation = val;
          specs = extractSpecsFromText(text);
          sourceUrl = res.url;
          sourceStatus = res.url.includes("zillow.com") ? "Zillow_Snippet" : (res.url.includes("redfin.com") ? "Redfin_Snippet" : "Realtor_Snippet");
          console.log(`   ✨ Est. encontrado en snippet: $${valuation.toLocaleString()} (${sourceStatus})`);
          break;
        }
      }

      // 2. Playwright fallback (navigating to Redfin first, and only Zillow if Redfin is unavailable)
      if (!valuation && sortedResults.length > 0) {
        const page = await getBrowserPage();

        for (const res of sortedResults) {
          const targetUrl = res.url;
          console.log(`   🔍 Navegando a: ${targetUrl}...`);
          try {
            await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
            // Add a short delay (1 second) to let React render estimates
            await new Promise(resolve => setTimeout(resolve, 1000));

            const bodyText = await page.innerText("body");
            const title = await page.title();
            console.log(`      [PAGE LOG] Title: "${title}" | Body Length: ${bodyText.length}`);

            const val = extractValuationFromText(bodyText);
            if (val) {
              valuation = val;
              specs = extractSpecsFromText(bodyText);
              sourceUrl = targetUrl;
              sourceStatus = targetUrl.includes("zillow.com") ? "Zillow_Scraper" : (targetUrl.includes("redfin.com") ? "Redfin_Scraper" : "Realtor_Scraper");
              console.log(`   ✅ Est. extraído de página: $${valuation.toLocaleString()} (${sourceStatus})`);
              break;
            } else {
              console.log("   ⚠️ No se pudo extraer la valoración de esta página.");
            }
          } catch (err: any) {
            console.warn(`   ❌ Error al cargar/scrapear la página: ${err.message}`);
          }
        }
      }

      // Update database if we found a valuation
      if (valuation) {
        try {
          // Consult existing specs so we don't overwrite with nulls if we already had them
          const existRes = await db.execute({
            sql: `SELECT sqft, beds, baths FROM ${table.name} WHERE ${table.idCol} = ?`,
            args: [idVal]
          });
          const existing = existRes.rows[0] as any;
          
          const finalSqft = specs.sqft || (existing ? existing.sqft : null);
          const finalBeds = specs.beds || (existing ? existing.beds : null);
          const finalBaths = specs.baths || (existing ? existing.baths : null);

          await db.execute({
            sql: `
              UPDATE ${table.name} SET
                mls_estimated_value = ?,
                mls_status = ?,
                sqft = ?,
                beds = ?,
                baths = ?
              WHERE ${table.idCol} = ?
            `,
            args: [valuation, sourceStatus, finalSqft, finalBeds, finalBaths, idVal]
          });
          console.log(`   💾 DB actualizada con éxito para ${rawAddress}.`);
          totalResolved++;
        } catch (dbErr: any) {
          console.error(`   ❌ Error al guardar datos en DB:`, dbErr.message);
        }
      } else {
        console.log(`   ❌ No se pudo resolver la valoración para esta propiedad.`);
      }

      // Small delay between properties
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  if (browser) {
    await browser.close();
  }

  // Recalculate stress scores with the new valuations
  if (totalResolved > 0) {
    console.log("\n[RECALCULO SSI] Recalculando puntuaciones de estrés globales...");
    try {
      await scoreAllProperties();
      console.log("✅ Recálculo SSI de estrés completado.");
    } catch (err: any) {
      console.error("❌ Falló el recálculo SSI:", err.message);
    }
  }

  console.log("\n========================================================");
  console.log("🏁 RESUMEN GENERAL DE VALORACIÓN PÚBLICA:");
  console.log(`- Propiedades evaluadas: ${totalProcessed}`);
  console.log(`- Propiedades valoradas exitosamente: ${totalResolved}`);
  console.log("========================================================\n");
}

if (require.main === module) {
  resolveMissingValuations().catch(console.error);
}
