import axios from "axios";
import * as cheerio from "cheerio";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import { validateAndCleanAddress } from "./address_validation";
import { PRESET_OWNERS } from "./mocks";
import { gisRestClient } from "./gis_rest_client";
import { applyFlareSolverrBypass } from "./proxy_helper";
import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(stealthPlugin());

// Cargar variables de entorno
dotenv.config();

// Inicializar cliente de Turso DB
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

const FIRST_NAMES = [
  "James", "John", "Robert", "Michael", "William", "David", "Richard", "Joseph", "Thomas", "Charles",
  "Christopher", "Daniel", "Matthew", "Anthony", "Mark", "Donald", "Steven", "Paul", "Andrew", "Joshua",
  "Mary", "Patricia", "Jennifer", "Linda", "Elizabeth", "Barbara", "Susan", "Jessica", "Sarah", "Karen"
];

const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
  "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin"
];

const STREET_NAMES = [
  "Main St", "Oak Ave", "Pine Rd", "Maple Dr", "Cedar Ln", "Elm St", "View Rd", "Parkway Blvd", "Hill Side Dr"
];

const CITIES = [
  "Indianapolis, IN", "Miami, FL", "Austin, TX", "Chicago, IL", "Atlanta, GA", "Cincinnati, OH", "Nashville, TN"
];

// Preset owners movidos a scrapers/mocks.ts

/**
 * Genera un hash numérico simple a partir de una cadena de texto para simulación determinista.
 */
function getSimpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Intenta consultar el portal web del PVA Jefferson County usando HTTP POST (Axios + FlareSolverr)
 */
let consecutiveSolverErrors = 0;
let disableRealScrapeMode = false;

interface ScrapeResult {
  success: boolean;
  ownerName?: string;
  mailingAddress?: string;
  noResults?: boolean;
}

async function attemptRealPVAScrape(address: string): Promise<ScrapeResult> {
  if (disableRealScrapeMode) {
    return { success: false, noResults: false };
  }

  let cleanAddr = address.split(",")[0].trim();
  // Limpiar códigos postales mal asignados como números de unidad (ej. #40211)
  cleanAddr = cleanAddr.replace(/#\d{5}\b/g, "").trim();
  const addressParts = cleanAddr.split(/\s+/);
  
  if (addressParts.length < 2) {
    return { success: false, noResults: false };
  }

  try {
    const searchUrl = `https://jeffersonpva.ky.gov/property-search/property-listings/?psfldAddress=${encodeURIComponent(cleanAddr)}&propertySearchFormButton=Search&searchType=StreetSearch`;
    let htmlContent = "";
    
    // Intentar llamada directa con timeout de 3s
    try {
      console.log(`[PVA SCRAPER] Intentando GET directo a PVA para ${cleanAddr}...`);
      const response = await axios.get(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
        timeout: 3000
      });
      if (response.status === 200 && response.data) {
        htmlContent = response.data;
      }
    } catch (err: any) {
      console.log(`[PVA SCRAPER] GET directo falló: ${err.message}. Intentando FlareSolverr...`);
    }

    // Si la llamada directa falló o nos topamos con un bloqueo de Cloudflare, usar FlareSolverr
    const cfKeywords = ["Just a moment", "Cloudflare", "Attention Required", "Checking your browser"];
    const hasCF = htmlContent ? cfKeywords.some(kw => htmlContent.includes(kw)) : true;

    if (!htmlContent || hasCF) {
      if (consecutiveSolverErrors >= 3) {
        console.log(`[PVA SCRAPER] Demasiados errores consecutivos de FlareSolverr (${consecutiveSolverErrors}). Saltando scrapeo real para evitar lentitud.`);
        disableRealScrapeMode = true;
        return { success: false, noResults: false };
      }
      
      console.log(`[PVA SCRAPER] Cloudflare detectado o respuesta vacía. Canalizando a través de FlareSolverr local...`);
      const solverUrl = process.env.FLARESOLVERR_URL || "http://localhost:8191/v1";
      
      try {
        const solverRes = await axios.post(solverUrl, {
          cmd: "request.get",
          url: searchUrl,
          maxTimeout: 10000
        }, { timeout: 12000 });

        if (solverRes.data && solverRes.data.status === "ok") {
          htmlContent = solverRes.data.solution.response;
          console.log(`[PVA SCRAPER] FlareSolverr bypass exitoso para ${cleanAddr}.`);
          consecutiveSolverErrors = 0; // reset on success
        } else {
          console.log(`[PVA SCRAPER] FlareSolverr retornó estado no-ok para ${cleanAddr}.`);
          consecutiveSolverErrors++;
        }
      } catch (err: any) {
        console.log(`[PVA SCRAPER] Petición a FlareSolverr falló/timeout para ${cleanAddr}: ${err.message}`);
        consecutiveSolverErrors++;
      }
    }

    if (htmlContent) {
      // Si el portal explícitamente dice 0 registros, no continuar ni reintentar
      if (htmlContent.toLowerCase().includes("0 records found")) {
        console.log(`[PVA SCRAPER] 0 registros encontrados en PVA para ${cleanAddr}. Evitando búsquedas redundantes.`);
        return { success: false, noResults: true };
      }

      const $ = cheerio.load(htmlContent);
      const title = $('title').text() || "";
      const isDetails = title.includes("Property Details") || $('dt:contains("Owner")').length > 0;
      
      let ownerName = "";
      
      if (isDetails) {
        ownerName = $('dt:contains("Owner")').next('.result').text().trim();
      } else {
        const firstRow = $('.searchResultsTable tr').not('.rowTitle').first();
        if (firstRow.length > 0) {
          const tds = firstRow.find('td');
          if (tds.length >= 5) {
            ownerName = $(tds[2]).text().trim();
          }
        }
      }
      
      if (ownerName && ownerName.length > 2) {
        return { 
          success: true,
          ownerName, 
          mailingAddress: `${cleanAddr}, Louisville, KY`
        };
      }
    }
  } catch (err: any) {
    console.warn(`[PVA SCRAPER] Falló el scraper real para ${cleanAddr}: ${err.message}`);
  }

  return { success: false, noResults: false };
}

/**
 * Extrae propietario e información catastral usando Playwright y el bypass de FlareSolverr
 */
async function attemptPlaywrightPVAScrape(address: string): Promise<{ ownerName: string; mailingAddress: string } | null> {
  let cleanAddr = address.split(",")[0].trim();
  // Limpiar códigos postales mal asignados como números de unidad (ej. #40211)
  cleanAddr = cleanAddr.replace(/#\d{5}\b/g, "").trim();
  const addressParts = cleanAddr.split(/\s+/);
  if (addressParts.length < 2) return null;
  
  console.log(`[PVA SCRAPER PLAYWRIGHT] Iniciando consulta PVA con Playwright para: ${cleanAddr}...`);
  const browser = await chromium.launch({
    headless: process.env.HEADLESS ? process.env.HEADLESS === "true" : true,
  });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  
  try {
    const url = `https://jeffersonpva.ky.gov/property-search/property-listings/?psfldAddress=${encodeURIComponent(cleanAddr)}&propertySearchFormButton=Search&searchType=StreetSearch`;
    await page.goto(url, { waitUntil: "networkidle", timeout: 25000 });
    await page.waitForTimeout(2000);
    
    const title = await page.title();
    const cfKeywords = ["Just a moment", "Cloudflare", "Attention Required", "Checking your browser"];
    const isBlocked = cfKeywords.some(kw => title.includes(kw));
    
    if (isBlocked) {
      console.log(`[PVA SCRAPER PLAYWRIGHT] Cloudflare detectado en Playwright. Invocando applyFlareSolverrBypass...`);
      const bypassed = await applyFlareSolverrBypass(context, url);
      if (bypassed) {
        console.log(`[PVA SCRAPER PLAYWRIGHT] Bypass exitoso. Recargando...`);
        await page.goto(url, { waitUntil: "networkidle", timeout: 25000 });
      }
    }
    
    const htmlContent = await page.content();
    if (htmlContent.toLowerCase().includes("0 records found")) {
      console.log(`[PVA SCRAPER PLAYWRIGHT] 0 registros encontrados en PVA para ${cleanAddr}.`);
      await browser.close();
      return null;
    }

    const $ = cheerio.load(htmlContent);
    const isDetails = title.includes("Property Details") || $('dt:contains("Owner")').length > 0;
    
    let ownerName = "";
    
    if (isDetails) {
      ownerName = $('dt:contains("Owner")').next('.result').text().trim();
    } else {
      const firstRow = $('.searchResultsTable tr').not('.rowTitle').first();
      if (firstRow.length > 0) {
        const tds = firstRow.find('td');
        if (tds.length >= 5) {
          ownerName = $(tds[2]).text().trim();
        }
      }
    }
    
    if (ownerName && ownerName.length > 2) {
      console.log(`[PVA SCRAPER PLAYWRIGHT SUCCESS] Propietario encontrado: ${ownerName}`);
      await browser.close();
      return {
        ownerName,
        mailingAddress: `${cleanAddr}, Louisville, KY`
      };
    }
  } catch (err: any) {
    console.error(`[PVA SCRAPER PLAYWRIGHT ERROR] Falló extracción con Playwright: ${err.message}`);
  } finally {
    await browser.close();
  }
  return null;
}

/**
 * Consulta de atributos completos de propietario en BatchData API (Paso 4 Fallback)
 */
async function getOwnerNameFromBatchData(address: string, state: string, county: string): Promise<{ ownerName: string; mailingAddress: string } | null> {
  const apiKey = process.env.SKIP_TRACE_API_KEY || process.env.BATCHDATA_API_KEY || "";
  if (!apiKey) {
    console.log("[BATCHDATA] No API Key configurada para consulta de propiedad.");
    return null;
  }
  
  // Limpieza básica de dirección para parseo
  let street = address.trim();
  // Limpiar códigos postales mal asignados como números de unidad (ej. #40211)
  street = street.replace(/#\d{5}\b/g, "").trim();
  let city = "";
  let zip = "";
  
  const zipMatches = street.match(/\b\d{5}\b/g);
  if (zipMatches) {
    zip = zipMatches[zipMatches.length - 1];
    const lastIdx = street.lastIndexOf(zip);
    if (lastIdx !== -1) {
      street = (street.substring(0, lastIdx) + street.substring(lastIdx + zip.length)).trim();
    }
  }
  
  street = street.replace(/,\s*$/, "").trim();
  const parts = street.split(",");
  if (parts.length >= 2) {
    city = parts[parts.length - 1].trim();
    street = parts.slice(0, parts.length - 1).join(",").trim();
  }
  
  if (!city) {
    if (state === "KY" && county.toLowerCase().includes("jeff")) {
      city = "Louisville";
    } else if (state === "IN" && county.toLowerCase().includes("floyd")) {
      city = "New Albany";
    } else if (state === "IN" && county.toLowerCase().includes("clark")) {
      city = "Jeffersonville";
    } else {
      city = county;
    }
  }
  
  try {
    console.log(`[BATCHDATA] Buscando propietario en BatchData para: "${address}"...`);
    const response = await axios.post(
      "https://api.batchdata.com/api/v1/property/lookup/all-attributes",
      {
        requests: [
          {
            address: {
              street: street.replace(/,\s*$/, "").trim(),
              city: city,
              state: state,
              zip: zip || ""
            }
          }
        ]
      },
      {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        timeout: 10000
      }
    );
    
    const properties = response.data?.results?.properties || [];
    if (properties.length > 0) {
      const owner = properties[0].owner;
      if (owner && owner.names && owner.names.length > 0) {
        const primaryOwnerName = owner.names.map((n: any) => `${n.first || ""} ${n.last || ""}`.trim()).join(" & ");
        const mailingAddrObj = owner.mailingAddress;
        let mailingAddressStr = "";
        if (mailingAddrObj) {
          mailingAddressStr = `${mailingAddrObj.street || ""}, ${mailingAddrObj.city || ""}, ${mailingAddrObj.state || ""} ${mailingAddrObj.zip || ""}`.replace(/,\s*$/, "").trim();
        }
        
        console.log(`[BATCHDATA SUCCESS] Propietario encontrado vía BatchData: ${primaryOwnerName}`);
        return {
          ownerName: primaryOwnerName,
          mailingAddress: mailingAddressStr || address
        };
      }
    }
  } catch (err: any) {
    const isStatus403 = err.response?.status === 403;
    const msgStr = (err.message || "").toLowerCase();
    if (isStatus403 || msgStr.includes("403")) {
      console.warn(`[BATCHDATA BALANCE WARNING] Saldo insuficiente o sin módulo contratado al consultar BatchData para ${address}. Activando fallback gratuito (LOJIC GIS / BD local).`);
    } else {
      console.error(`[BATCHDATA ERROR] Error en consulta de all-attributes: ${err.message}`);
    }
  }
  return null;
}

interface WaterfallResult {
  ownerName: string;
  mailingAddress: string;
  needsManualReview: number;
}

/**
 * Resuelve la dirección y el propietario a través del pipeline de resolución en cascada (waterfall)
 */
async function resolveOwnerWaterfall(address: string, state: string, county: string): Promise<WaterfallResult> {
  // PASO 1: Normalización previa de la dirección
  const normalizedAddress = await validateAndCleanAddress(address, state);
  
  // Preset check (solo si USE_MOCKS es true)
  if (process.env.USE_MOCKS === "true") {
    const cleanAddrKey = normalizedAddress.split(",")[0].trim().toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ");
    for (const presetKey in PRESET_OWNERS) {
      if (cleanAddrKey.includes(presetKey) || presetKey.includes(cleanAddrKey)) {
        const p = PRESET_OWNERS[presetKey];
        console.log(`[PVA SCRAPER] Dirección coincide con preset de prueba (MOCK): "${normalizedAddress}" -> '${p.name}'`);
        return {
          ownerName: p.name,
          mailingAddress: p.mailingAddress || `${normalizedAddress.split(",")[0].trim()}, Louisville, KY`,
          needsManualReview: 0
        };
      }
    }
  }
  
  // PASO 2: Consulta gratuita al ArcGIS REST de LOJIC GIS
  if (state === "KY" && county.toLowerCase().includes("jeff")) {
    try {
      console.log(`[PVA SCRAPER] Consultando LOJIC GIS para obtener Parcel ID de: "${normalizedAddress}"`);
      const featuresAddr = await gisRestClient.queryJeffersonParcelByAddress(normalizedAddress);
      if (featuresAddr && featuresAddr.length > 0 && featuresAddr[0].attributes) {
        const parcelId = featuresAddr[0].attributes.PARCELID || featuresAddr[0].attributes.PARCEL_ID || featuresAddr[0].attributes.PARCEL;
        if (parcelId) {
          const featuresPVA = await gisRestClient.queryJeffersonParcelsByParcelId(parcelId);
          if (featuresPVA && featuresPVA.length > 0 && featuresPVA[0].attributes) {
            const attrs = featuresPVA[0].attributes;
            // Intentar extraer de campos que puedan contenerlo (si existen o en el futuro)
            const ownerName = attrs.owner_name || attrs.owner || attrs.OWNER || attrs.OWNER1 || attrs.PROP_OWNER;
            const mailingAddress = attrs.mailing_address || attrs.mail_addr || attrs.MAILING_ADDRESS || attrs.OWNER_ADDR;
            
            if (ownerName && ownerName.length > 2) {
              console.log(`\x1b[36m[PVA LOJIC SUCCESS] Datos catastrales resueltos vía LOJIC GIS para "${normalizedAddress}": ${ownerName}\x1b[0m`);
              return {
                ownerName,
                mailingAddress: mailingAddress || normalizedAddress,
                needsManualReview: 0
              };
            }
          }
        }
      }
    } catch (e: any) {
      console.warn(`[PVA SCRAPER WARNING] Falló consulta LOJIC GIS para ${normalizedAddress}:`, e.message);
    }
  }
  
  // PASO 3: Portal Web de PVA (Bypass de Cloudflare en intento real)
  if (state === "KY" && county.toLowerCase().includes("jeff")) {
    try {
      const result = await attemptRealPVAScrape(normalizedAddress);
      if (result && result.success && result.ownerName) {
        return {
          ownerName: result.ownerName,
          mailingAddress: result.mailingAddress || normalizedAddress,
          needsManualReview: 0
        };
      } else if (result && result.noResults) {
        // El portal respondió exitosamente pero con 0 registros.
        // Evitamos llamar a Playwright ya que el resultado será el mismo,
        // y pasamos directamente al siguiente paso (BatchData).
        console.log(`[PVA SCRAPER] Saltando Playwright para ${normalizedAddress} porque direct GET confirmó 0 registros.`);
      } else {
        // El direct GET falló por bloqueo o red. Intentamos Playwright.
        const pwResult = await attemptPlaywrightPVAScrape(normalizedAddress);
        if (pwResult) {
          return {
            ownerName: pwResult.ownerName,
            mailingAddress: pwResult.mailingAddress,
            needsManualReview: 0
          };
        }
      }
    } catch (err: any) {
      console.error(`[PVA SCRAPER ERROR] Falló la extracción web del portal PVA para ${normalizedAddress}:`, err.message);
    }
  }
  
  // PASO 4: Fallback modular a BatchData (Última instancia)
  try {
    const batchRes = await getOwnerNameFromBatchData(normalizedAddress, state, county);
    if (batchRes) {
      return {
        ownerName: batchRes.ownerName,
        mailingAddress: batchRes.mailingAddress,
        needsManualReview: 0
      };
    }
  } catch (err: any) {
    console.error(`[PVA SCRAPER ERROR] Falló fallback a BatchData para ${normalizedAddress}:`, err.message);
  }
  
  // PASO 5: Protección de Privacidad y Revisión Manual
  console.warn(`[PVA SCRAPER WARNING] Todas las capas del resolvedor fallaron para "${normalizedAddress}". Marcando como DESCONOCIDO.`);
  return {
    ownerName: "DUEÑO DESCONOCIDO",
    mailingAddress: normalizedAddress,
    needsManualReview: 1
  };
}

/**
 * Limpia y normaliza el nombre del propietario catastral, permitiendo caracteres válidos
 * como espacios, ampersands (&), la letra Ñ y acentos.
 */
function cleanOwnerName(rawName: string): string {
  const upperRaw = rawName.trim().toUpperCase();
  if (
    upperRaw === "DUEÑO DESCONOCIDO" ||
    upperRaw === "DUEO DESCONOCIDO" ||
    upperRaw === "UNKNOWN" ||
    upperRaw === ""
  ) {
    return "DUEÑO DESCONOCIDO";
  }
  return upperRaw
    .replace(/[^A-ZÁÉÍÓÚÜÑ\s&/]/g, "") // Permitir letras, acentos, Ñ, espacios, & y /
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Ejecuta el resolvedor de registros de propiedad (PVA)
 */
async function scrapePVA() {
  console.log("[PVA SCRAPER] Iniciando resolvedor de registros de propiedad (PVA)...");

  // 1. Obtener todos los registros con dueño desconocido en violaciones de código
  let pendingRes;
  try {
    pendingRes = await db.execute(
      "SELECT violation_id, address FROM code_violations WHERE owner_name = 'DUEÑO DESCONOCIDO' OR owner_name = 'DUEO DESCONOCIDO' OR owner_name IS NULL OR owner_name = '' OR owner_name = 'Unknown' OR owner_name = 'UNKNOWN' OR owner_name = 'No especificado'"
    );
  } catch (dbErr: any) {
    console.error("[PVA SCRAPER ERROR] Falló la consulta a la base de datos:", dbErr.message);
    process.exit(1);
  }

  const pendingList = pendingRes.rows;
  console.log(`[PVA SCRAPER] Se encontraron ${pendingList.length} violaciones de código con dueño desconocido.`);

  let resolvedCount = 0;

  for (const row of pendingList) {
    const violationId = row.violation_id as string;
    const address = row.address as string;

    const result = await resolveOwnerWaterfall(address, "KY", "Jefferson");

    const rawName = result.ownerName;
    const mailingAddr = result.mailingAddress;
    const cleanedName = cleanOwnerName(rawName);

    const isAbsentee = mailingAddr.toLowerCase().split(",")[0].trim() !== address.toLowerCase().split(",")[0].trim();
    const absenteeLog = isAbsentee 
      ? `(Dueño Ausente, Dirección Postal: '${mailingAddr}')` 
      : `(Dueño Ocupante)`;

    console.log(`[PVA SCRAPER] Propietario resuelto para ${address.split(",")[0].trim()}: '${cleanedName}' ${absenteeLog}. Actualizando Turso...`);

    try {
      await db.execute({
        sql: "UPDATE code_violations SET owner_name = ?, mailing_address = ?, absentee_owner = ?, needs_manual_review = ? WHERE violation_id = ?",
        args: [cleanedName, mailingAddr, isAbsentee ? 1 : 0, result.needsManualReview, violationId]
      });
      resolvedCount++;
    } catch (updateErr: any) {
      console.error(`[PVA SCRAPER ERROR] No se pudo actualizar el registro ${violationId}:`, updateErr.message);
    }
  }

  console.log("\n========================================================");
  console.log("RESUMEN DE RESOLVEDOR PVA (VIOLACIONES):");
  console.log(`- Registros de dueño de violación actualizados: ${resolvedCount}`);
  console.log("========================================================\n");

  // 2. Obtener todas las subastas judiciales sin dirección postal o con nombre de deudor inválido
  let pendingAuctionsRes;
  try {
    pendingAuctionsRes = await db.execute(
      "SELECT auction_id, address, defendant, county, state FROM foreclosure_auctions WHERE mailing_address IS NULL OR defendant IS NULL OR defendant = '' OR defendant = 'No especificado' OR defendant = 'null' OR UPPER(defendant) = 'UNKNOWN' OR UPPER(defendant) = 'DUEÑO DESCONOCIDO' OR UPPER(defendant) = 'DUEO DESCONOCIDO'"
    );
  } catch (dbErr: any) {
    console.error("[PVA SCRAPER ERROR] Falló la consulta a la base de datos para subastas:", dbErr.message);
  }

  if (pendingAuctionsRes) {
    const pendingAuctionsList = pendingAuctionsRes.rows;
    console.log(`[PVA SCRAPER] Se encontraron ${pendingAuctionsList.length} subastas judiciales que requieren enriquecimiento catastral de propietario o dirección.`);

    let resolvedAuctionsCount = 0;

    for (const row of pendingAuctionsList) {
      const auctionId = row.auction_id as string;
      const address = row.address as string;
      const county = row.county as string || "Jefferson";
      const state = row.state as string || "KY";

      const result = await resolveOwnerWaterfall(address, state, county);

      const rawName = result.ownerName;
      const mailingAddr = result.mailingAddress;
      const cleanedName = cleanOwnerName(rawName);

      const isAbsentee = mailingAddr.toLowerCase().split(",")[0].trim() !== address.toLowerCase().split(",")[0].trim();
      const absenteeLog = isAbsentee 
        ? `(Dueño Ausente, Dirección Postal: '${mailingAddr}')` 
        : `(Dueño Ocupante)`;

      console.log(`[PVA SCRAPER] Dirección postal encontrada para subasta en ${address.split(",")[0].trim()}: '${mailingAddr}' ${absenteeLog}. Propietario: '${cleanedName}'. Actualizando Turso...`);

      try {
        await db.execute({
          sql: `
            UPDATE foreclosure_auctions 
            SET 
              mailing_address = ?, 
              absentee_owner = ?,
              needs_manual_review = ?,
              defendant = CASE 
                WHEN defendant IS NULL OR defendant = '' OR defendant = 'No especificado' OR defendant = 'null' OR UPPER(defendant) = 'UNKNOWN' OR UPPER(defendant) = 'DUEÑO DESCONOCIDO' OR UPPER(defendant) = 'DUEO DESCONOCIDO'
                THEN ? 
                ELSE defendant 
              END
            WHERE auction_id = ?
          `,
          args: [mailingAddr, isAbsentee ? 1 : 0, result.needsManualReview, cleanedName, auctionId]
        });
        resolvedAuctionsCount++;
      } catch (updateErr: any) {
        console.error(`[PVA SCRAPER ERROR] No se pudo actualizar el registro de subasta ${auctionId}:`, updateErr.message);
      }
    }

    console.log("\n========================================================");
    console.log("RESUMEN DE RESOLVEDOR PVA (SUBASTAS):");
    console.log(`- Registros de subasta actualizados: ${resolvedAuctionsCount}`);
    console.log("========================================================\n");
  }

  // 3. Obtener todos los registros de estrés físico con dueño desconocido
  let pendingPhysicalRes;
  try {
    pendingPhysicalRes = await db.execute(
      "SELECT distress_id, address, county, state FROM physical_distress WHERE owner_name = 'DUEÑO DESCONOCIDO' OR owner_name = 'DUEO DESCONOCIDO' OR owner_name IS NULL OR owner_name = '' OR owner_name = 'Unknown' OR owner_name = 'UNKNOWN' OR owner_name = 'No especificado'"
    );
  } catch (dbErr: any) {
    console.error("[PVA SCRAPER ERROR] Falló la consulta a la base de datos para estrés físico:", dbErr.message);
  }

  if (pendingPhysicalRes) {
    const pendingPhysicalList = pendingPhysicalRes.rows;
    console.log(`[PVA SCRAPER] Se encontraron ${pendingPhysicalList.length} registros de estrés físico que requieren enriquecimiento catastral.`);

    let resolvedPhysicalCount = 0;

    for (const row of pendingPhysicalList) {
      const distressId = row.distress_id as string;
      const address = row.address as string;
      const county = row.county as string || "Jefferson";
      const state = row.state as string || "KY";

      const result = await resolveOwnerWaterfall(address, state, county);

      const rawName = result.ownerName;
      const mailingAddr = result.mailingAddress;
      const cleanedName = cleanOwnerName(rawName);

      const isAbsentee = mailingAddr.toLowerCase().split(",")[0].trim() !== address.toLowerCase().split(",")[0].trim();
      const absenteeLog = isAbsentee 
        ? `(Dueño Ausente, Dirección Postal: '${mailingAddr}')` 
        : `(Dueño Ocupante)`;

      console.log(`[PVA SCRAPER] Dirección postal encontrada para estrés físico en ${address.split(",")[0].trim()}: '${mailingAddr}' ${absenteeLog}. Propietario: '${cleanedName}'. Actualizando Turso...`);

      try {
        await db.execute({
          sql: `
            UPDATE physical_distress 
            SET 
              owner_name = ?, 
              mailing_address = ?, 
              absentee_owner = ?,
              needs_manual_review = ?
            WHERE distress_id = ?
          `,
          args: [cleanedName, mailingAddr, isAbsentee ? 1 : 0, result.needsManualReview, distressId]
        });
        resolvedPhysicalCount++;
      } catch (updateErr: any) {
        console.error(`[PVA SCRAPER ERROR] No se pudo actualizar el registro de estrés físico ${distressId}:`, updateErr.message);
      }
    }

    console.log("\n========================================================");
    console.log("RESUMEN DE RESOLVEDOR PVA (ESTRÉS FÍSICO):");
    console.log(`- Registros de estrés físico actualizados: ${resolvedPhysicalCount}`);
    console.log("========================================================\n");
  }
}

// Ejecutar si se corre directamente
if (require.main === module) {
  scrapePVA().catch(console.error);
}

export { scrapePVA };
