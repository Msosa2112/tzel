import axios from "axios";
import * as cheerio from "cheerio";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import { isAddressInJurisdiction } from "./geo_fencing";
import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import { validateAndCleanAddress } from "./address_validation";

chromium.use(stealthPlugin());

// Cargar variables de entorno
dotenv.config();

// Inicializar cliente de Turso DB
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

// Ciudades comunes en Clark County e Indiana para geofiltros
const CLARK_CITIES = ["jeffersonville", "clarksville", "sellersburg", "charlestown", "henryville", "borden", "new washington"];
const FLOYD_CITIES = ["new albany", "georgetown", "floyds knobs", "galena", "greenville"];

/**
 * Limpia y normaliza cadenas de texto (remueve espacios dobles y nbsp)
 */
function cleanText(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const MONTH_MAP: { [key: string]: number } = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11
};

function parseAuctionDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const clean = dateStr.toLowerCase().replace(/\s+/g, " ").trim();
  
  if (clean.includes("unknown") || clean.includes("pending")) {
    return null;
  }
  
  // 1. Formato MM/DD/YYYY o M/D/YYYY
  const slashDateMatch = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashDateMatch) {
    const month = parseInt(slashDateMatch[1], 10) - 1;
    const day = parseInt(slashDateMatch[2], 10);
    const year = parseInt(slashDateMatch[3], 10);
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }
  
  // 2. Formato Month/DD YYYY (ej. "may/28 2026" o "july/ 2 2026")
  const monthSlashDayMatch = clean.match(/^([a-z]+)\s*\/\s*(\d{1,2})\s+(\d{4})$/);
  if (monthSlashDayMatch) {
    const monthName = monthSlashDayMatch[1];
    const day = parseInt(monthSlashDayMatch[2], 10);
    const year = parseInt(monthSlashDayMatch[3], 10);
    if (MONTH_MAP[monthName] !== undefined) {
      const d = new Date(year, MONTH_MAP[monthName], day);
      if (!isNaN(d.getTime())) return d;
    }
  }
  
  // 3. Formato Month DD, YYYY (ej. "february 12, 2026")
  const monthCommaMatch = clean.match(/^([a-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (monthCommaMatch) {
    const monthName = monthCommaMatch[1];
    const day = parseInt(monthCommaMatch[2], 10);
    const year = parseInt(monthCommaMatch[3], 10);
    if (MONTH_MAP[monthName] !== undefined) {
      const d = new Date(year, MONTH_MAP[monthName], day);
      if (!isNaN(d.getTime())) return d;
    }
  }
  
  // 4. Formato Month DD YYYY (ej. "july 7 2026")
  const monthSpaceMatch = clean.match(/^([a-z]+)\s+(\d{1,2})\s+(\d{4})$/);
  if (monthSpaceMatch) {
    const monthName = monthSpaceMatch[1];
    const day = parseInt(monthSpaceMatch[2], 10);
    const year = parseInt(monthSpaceMatch[3], 10);
    if (MONTH_MAP[monthName] !== undefined) {
      const d = new Date(year, MONTH_MAP[monthName], day);
      if (!isNaN(d.getTime())) return d;
    }
  }

  // Fallback para constructor nativo de JavaScript
  const fallbackDate = new Date(dateStr);
  if (!isNaN(fallbackDate.getTime())) {
    return fallbackDate;
  }
  
  return null;
}

function isAuctionDateValid(dateStr: string): boolean {
  const auctionDate = parseAuctionDate(dateStr);
  if (!auctionDate) {
    console.log(`[DATE WARNING] No se pudo parsear la fecha de subasta: "${dateStr}". Se permitirá para revisión manual.`);
    return true; 
  }
  
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Normalizar a medianoche
  
  auctionDate.setHours(0, 0, 0, 0); // Normalizar la fecha de subasta a medianoche
  
  return auctionDate.getTime() >= today.getTime();
}

/**
 * Limpia y normaliza el nombre del demandado
 */
function cleanDefendant(name: string): string {
  if (!name) return "";
  let clean = name;
  
  // Remover texto entre paréntesis
  clean = clean.replace(/\([^)]*\)/g, "");
  
  // Remover et al, et al., et. al., etal
  clean = clean.replace(/,?\s+et\.?\s*al\.?/gi, "");
  clean = clean.replace(/,?\s+etal/gi, "");
  
  // Remover "spouse of", "and spouse", "husband/wife of", etc.
  clean = clean.replace(/,?\s+spouse\s+of\s+.*$/gi, "");
  clean = clean.replace(/,?\s+and\s+spouse.*$/gi, "");
  clean = clean.replace(/,?\s+husband\s+and\s+wife.*$/gi, "");
  clean = clean.replace(/,?\s+wife\s+of\s+.*$/gi, "");
  clean = clean.replace(/,?\s+husband\s+of\s+.*$/gi, "");
  
  // Remover "deceased" o "individually"
  clean = clean.replace(/,?\s+deceased/gi, "");
  clean = clean.replace(/,?\s+individually/gi, "");
  
  // Limpiar caracteres de puntuación sobrantes al final
  clean = clean.replace(/[\*\,\-\_\#\s]+$/, "");
  
  // Quitar comillas
  clean = clean.replace(/["']/g, "");
  
  // Normalizar espacios
  clean = clean.replace(/\s+/g, " ").trim();
  
  return clean;
}

/**
 * Scraper para las subastas del Sheriff de Clark County, IN
 */
async function scrapeClarkCounty() {
  console.log("[SCRAPER CLARK] Iniciando extracción de subastas de Clark County, IN...");
  const url = "https://www.clarkcosheriff.com/sheriff-sales/";
  
  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      timeout: 15000
    });
    
    const $ = cheerio.load(response.data);
    let currentDate = "Unknown Date 2026";
    let activeSavedCount = 0;
    
    // Extraeremos todos los elementos que contengan texto (p, span, div, strong)
    // para procesar el flujo secuencial de fechas y direcciones.
    const textElements: string[] = [];
    
    // Obtenemos los textos en orden
    $("p, span, strong").each((_, elem) => {
      const txt = cleanText($(elem).text());
      if (txt && !textElements.includes(txt)) {
        textElements.push(txt);
      }
    });
    
    console.log(`[SCRAPER CLARK] Procesando ${textElements.length} bloques de texto secuenciales...`);
    
    const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    
    let lastPlaintiff: string | null = null;
    let lastDefendant: string | null = null;
    
    for (let i = 0; i < textElements.length; i++) {
      const text = textElements[i];
      const textLower = text.toLowerCase();
      
      // 1. Detectar Cabeceras de Fechas (ej: "MAY / 19" o "JUNE/16")
      // Si la línea contiene un mes
      const matchedMonth = months.find(m => textLower.includes(m));
      if (matchedMonth) {
        // Podría estar dividido o consolidado. Ej: "JUNE/16"
        if (text.includes("/")) {
          currentDate = `${text} 2026`;
          console.log(`[SCRAPER CLARK] Fecha detectada: ${currentDate}`);
        } else if (i + 1 < textElements.length && textElements[i+1] === "/") {
          // Si es "MAY", "/" y luego "19"
          if (i + 2 < textElements.length) {
            currentDate = `${text} ${textElements[i+2]} 2026`;
            console.log(`[SCRAPER CLARK] Fecha detectada (compuesta): ${currentDate}`);
            i += 2; // saltar los siguientes dos bloques
          }
        } else if (text.split(/\s+/).length <= 3) {
          // Mes simple, podría ser cabecera de sección.
          currentDate = `${text} 2026`;
        }
        continue;
      }
      
      // 2. Detectar caso (Plaintiff vs. Defendant)
      const vsRegex = /\s+vs\.?\s+/i;
      if (vsRegex.test(text)) {
        const parts = text.split(vsRegex);
        if (parts.length >= 2) {
          lastPlaintiff = parts[0].trim();
          lastDefendant = cleanDefendant(parts[1]);
          console.log(`[SCRAPER CLARK] Caso detectado por patrón vs: Plaintiff="${lastPlaintiff}" | Defendant="${lastDefendant}"`);
        }
      } else if (textLower === "vs" || textLower === "vs.") {
        // Si el "vs" está separado en su propia línea
        if (i > 0 && i + 1 < textElements.length) {
          lastPlaintiff = textElements[i - 1].trim();
          lastDefendant = cleanDefendant(textElements[i + 1]);
          console.log(`[SCRAPER CLARK] Caso detectado por vs en línea: Plaintiff="${lastPlaintiff}" | Defendant="${lastDefendant}"`);
        }
      }
      
      // 3. Detectar Líneas de Propiedades
      // Buscamos si empieza con un número de calle y tiene una coma con ciudad de Clark County
      const startsWithNumber = /^\d+/.test(text);
      const containsClarkCity = CLARK_CITIES.some(c => textLower.includes(c));
      
      if (startsWithNumber && containsClarkCity) {
        // Verificar si está cancelada
        if (textLower.includes("cancelled") || textLower.includes("cancelled") || textLower.includes("c a n c e l l e d")) {
          // Ignorar las subastas canceladas
          continue;
        }
        
        // Formato esperado: "6559 ASHLEY SPRINGS CT., CHARLESTOWN"
        const parts = text.split(",");
        if (parts.length >= 2) {
          const streetAddress = parts[0].replace(/\.+$/, "").trim(); // Quitar puntos finales
          const city = parts[1].replace(/\*\*\*[^*]+\*\*\*/g, "").trim(); // Limpiar alertas de estado
          
          // Filtro de vigencia: si la fecha de subasta ya pasó, descartar
          if (!isAuctionDateValid(cleanText(currentDate))) {
            console.log(`[FILTRO VIGENCIA] Descartando subasta pasada de Clark County: Dirección: ${streetAddress}, ${city} | Fecha: ${currentDate}`);
            lastPlaintiff = null;
            lastDefendant = null;
            continue;
          }
          
          const auctionId = `IN_CLARK_${streetAddress.replace(/\s+/g, "_")}_${cleanText(currentDate).replace(/\s+/g, "_")}`;
          
          const rawFullAddress = `${streetAddress}, ${city}`;
          const fullAddress = await validateAndCleanAddress(rawFullAddress, "IN");
          if (!isAddressInJurisdiction(fullAddress, "IN")) {
            console.log(`[SKIP] Propiedad fuera de jurisdicción detectada y descartada. Dirección: "${fullAddress}"`);
            lastPlaintiff = null;
            lastDefendant = null;
            continue;
          }
          
          const plaintiffVal = lastPlaintiff || null;
          const defendantVal = lastDefendant || null;
          
          console.log(`[TEMP LOG - CLARK] Nombre de defendant extraído antes de guardar: "${defendantVal}"`);
          
          try {
            await db.execute({
              sql: `
                INSERT INTO foreclosure_auctions (
                  auction_id, case_number, address, county, state, auction_date,
                  plaintiff, defendant, mls_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_check')
                ON CONFLICT(auction_id) DO UPDATE SET
                  address = excluded.address,
                  auction_date = excluded.auction_date,
                  plaintiff = COALESCE(excluded.plaintiff, foreclosure_auctions.plaintiff),
                  defendant = COALESCE(excluded.defendant, foreclosure_auctions.defendant)
              `,
              args: [
                auctionId,
                "PENDING",
                fullAddress,
                "Clark",
                "IN",
                cleanText(currentDate),
                plaintiffVal,
                defendantVal
              ]
            });
            activeSavedCount++;
            console.log(`[SUBASTA CLARK GUARDADA] Dirección: ${streetAddress}, ${city} | Defendant: ${defendantVal} | Fecha: ${currentDate}`);
            
            // Resetear para la siguiente propiedad
            lastPlaintiff = null;
            lastDefendant = null;
          } catch (dbErr) {
            console.error(`[DB ERROR] Error al guardar subasta de Clark County:`, dbErr);
          }
        }
      }
    }
    
    console.log(`[SCRAPER CLARK] Finalizado. Guardadas/Actualizadas: ${activeSavedCount} subastas.`);
  } catch (error: any) {
    console.error("[SCRAPER CLARK ERROR] Falló la extracción en Clark County:", error.message || error);
  }
}

/**
 * Scraper para las subastas del Sheriff de Floyd County, IN
 */
async function fetchFloydNonce(): Promise<string> {
  const url = "https://www.fcsdin.com/sheriffsales/";
  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      timeout: 10000
    });
    const match = response.data.match(/"nonce"\s*:\s*"([^"]+)"/);
    if (match) {
      console.log(`[SCRAPER FLOYD] Nonce dinámico obtenido con éxito: ${match[1]}`);
      return match[1];
    }
  } catch (err: any) {
    console.error(`[SCRAPER FLOYD WARNING] No se pudo obtener nonce dinámico: ${err.message}. Usando fallback.`);
  }
  return "7a6095ba72";
}

async function scrapeFloydCounty() {
  console.log("[SCRAPER FLOYD] Iniciando extracción de subastas de Floyd County, IN...");
  const nonce = await fetchFloydNonce();
  const ajaxUrl = "https://www.fcsdin.com/wp-admin/admin-ajax.php";
  const payload = new URLSearchParams({
    action: "gswpts_sheet_fetch",
    id: "5",
    nonce: nonce
  });
  
  try {
    const response = await axios.post(ajaxUrl, payload.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": "https://www.fcsdin.com/sheriffsales/"
      },
      timeout: 15000
    });
    
    if (response.status !== 200) {
      throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
    }
    
    const data = response.data;
    if (!data.success || !data.data || !data.data.output) {
      throw new Error("Respuesta AJAX fallida o sin datos de salida de la tabla.");
    }
    
    const $ = cheerio.load(data.data.output);
    let currentDate = "Unknown Date 2026";
    let activeSavedCount = 0;
    
    let lastPlaintiff: string | null = null;
    let lastDefendant: string | null = null;
    
    // Recorremos las filas de la tabla
    for (const trElem of $("tr").toArray()) {
      const cells: string[] = [];
      $(trElem).find("td").each((_, tdElem) => {
        cells.push(cleanText($(tdElem).text()));
      });
      
      if (cells.length === 0) continue;
      
      const non_empty = cells.filter(c => c);
      
      // 1. Detectar cabecera de fecha agrupada o caso
      if (non_empty.length === 1) {
        const val = non_empty[0];
        const valLower = val.toLowerCase();
        
        // Verificar si contiene "vs" o "vs." para Floyd
        const vsRegex = /\s+vs\.?\s+/i;
        if (vsRegex.test(val)) {
          const parts = val.split(vsRegex);
          if (parts.length >= 2) {
            lastPlaintiff = parts[0].trim();
            lastDefendant = cleanDefendant(parts[1]);
            console.log(`[SCRAPER FLOYD] Caso detectado en fila simple: Plaintiff="${lastPlaintiff}" | Defendant="${lastDefendant}"`);
          }
        } else {
          const isHeader = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "sales"].some(m => valLower.includes(m));
          if (isHeader && !valLower.includes("no sales")) {
            currentDate = val;
            console.log(`[SCRAPER FLOYD] Nueva fecha de subasta detectada: ${currentDate}`);
          }
        }
      }
      
      // 2. Fila de Propiedad
      // Columnas: ['', Address, City, State, Zip, Status]
      if (cells.length >= 5 && cells[1] && cells[2]) {
        const address = cells[1];
        const city = cells[2];
        const state = cells[3] || "IN";
        const zipCode = cells[4] || "";
        const status = cells[5] ? cells[5].toUpperCase().trim() : "";
        
        // Ignorar las propiedades canceladas (CANCELED)
        if (status.includes("CANCEL") || status.includes("RETIRADA")) {
          continue;
        }
        
        // Ignorar filas de encabezado de fecha agrupadas
        if (address.toLowerCase() === currentDate.toLowerCase()) {
          continue;
        }
        
        // Filtro de vigencia: si la fecha de subasta ya pasó, descartar
        if (!isAuctionDateValid(currentDate)) {
          console.log(`[FILTRO VIGENCIA] Descartando subasta pasada de Floyd County: Dirección: ${address}, ${city} | Fecha: ${currentDate}`);
          lastPlaintiff = null;
          lastDefendant = null;
          continue;
        }
        
        const rawFullAddress = `${address}, ${city}`;
        const fullAddress = await validateAndCleanAddress(rawFullAddress, "IN");
        if (!isAddressInJurisdiction(fullAddress, "IN")) {
          console.log(`[SKIP] Propiedad fuera de jurisdicción detectada y descartada. Dirección: "${fullAddress}"`);
          lastPlaintiff = null;
          lastDefendant = null;
          continue;
        }
        
        const auctionId = `IN_FLOYD_${address.replace(/\s+/g, "_")}_${currentDate.replace(/\s+/g, "_")}`;
        
        let plaintiffVal = lastPlaintiff || null;
        let defendantVal = lastDefendant || null;
        
        // Comprobar si hay "vs" en alguna celda de esta fila por si acaso
        const vsRegex = /\s+vs\.?\s+/i;
        for (const cell of cells) {
          if (vsRegex.test(cell)) {
            const parts = cell.split(vsRegex);
            if (parts.length >= 2) {
              plaintiffVal = parts[0].trim();
              defendantVal = cleanDefendant(parts[1]);
              console.log(`[SCRAPER FLOYD] Caso detectado en celda de fila de propiedad: Plaintiff="${plaintiffVal}" | Defendant="${defendantVal}"`);
            }
          }
        }
        console.log(`[TEMP LOG - FLOYD] Nombre de defendant extraído antes de guardar: "${defendantVal}"`);
        
        // Insertar en la base de datos de Turso
        try {
          await db.execute({
            sql: `
              INSERT INTO foreclosure_auctions (
                auction_id, case_number, address, county, state, auction_date,
                plaintiff, defendant, mls_status
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_check')
              ON CONFLICT(auction_id) DO UPDATE SET
                address = excluded.address,
                auction_date = excluded.auction_date,
                plaintiff = COALESCE(excluded.plaintiff, foreclosure_auctions.plaintiff),
                defendant = COALESCE(excluded.defendant, foreclosure_auctions.defendant)
            `,
            args: [
              auctionId,
              "PENDING",
              fullAddress,
              "Floyd",
              state,
              currentDate,
              plaintiffVal,
              defendantVal
            ]
          });
          activeSavedCount++;
          console.log(`[SUBASTA FLOYD GUARDADA] Dirección: ${fullAddress} | Defendant: ${defendantVal} | Fecha: ${currentDate}`);
        } catch (dbErr) {
          console.error(`[DB ERROR] Error al guardar subasta de Floyd County:`, dbErr);
        }
        
        // Resetear para la siguiente propiedad
        lastPlaintiff = null;
        lastDefendant = null;
      }
    }
    
    console.log(`[SCRAPER FLOYD] Finalizado. Guardadas/Actualizadas: ${activeSavedCount} subastas.`);
    
  } catch (error: any) {
    console.error("[SCRAPER FLOYD ERROR] Falló la extracción en Floyd County:", error.message || error);
  }
}

/**
 * Scraper para las subastas del Sheriff de Harrison County, IN (a través de SRI Services)
 */
async function scrapeHarrisonCounty() {
  console.log("[SCRAPER HARRISON] Iniciando extracción de subastas de Harrison County, IN...");
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
  });
  const page = await context.newPage();
  
  let activeSavedCount = 0;
  
  try {
    const url = "https://www.sriservices.com/properties?state=IN&county=Harrison&saleType=foreclosure";
    console.log(`[SCRAPER HARRISON] Navegando a ${url}...`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    
    // Esperar a que carguen las tarjetas de propiedad
    await page.waitForSelector(".card-body", { timeout: 15000 }).catch(() => {
      console.log("[SCRAPER HARRISON] No se encontraron tarjetas de propiedades.");
    });
    
    const cardCount = await page.locator(".card-body").count();
    console.log(`[SCRAPER HARRISON] Se encontraron ${cardCount} tarjetas.`);
    
    for (let idx = 0; idx < cardCount; idx++) {
      const card = page.locator(".card-body").nth(idx);
      
      // Extraer Dirección
      const street = await card.locator(".card-title span.truncate").innerText().catch(() => "");
      const subtitle = await card.locator(".card-subtitle").innerText().catch(() => "");
      
      if (!street) continue;
      
      const rawFullAddress = `${street.trim()}, ${subtitle.trim()}`;
      const fullAddress = await validateAndCleanAddress(rawFullAddress, "IN");
      
      // Extraer Cause #, Defendant, Sale Date, Status de las filas de texto
      let caseNumber = "PENDING";
      let defendant = "Unknown";
      let saleDate = "Unknown";
      let status = "";
      
      const rowsCount = await card.locator(".card-text-row").count();
      for (let r = 0; r < rowsCount; r++) {
        const row = card.locator(".card-text-row").nth(r);
        const label = await row.locator(".card-text-label").innerText().catch(() => "");
        const value = await row.locator(".card-text-value").innerText().catch(() => "");
        
        const cleanLabel = label.toLowerCase().trim();
        if (cleanLabel.includes("cause")) {
          caseNumber = value.trim();
        } else if (cleanLabel.includes("defendant")) {
          defendant = cleanDefendant(value.trim());
        } else if (cleanLabel.includes("sale date")) {
          saleDate = value.trim();
        } else if (cleanLabel.includes("status")) {
          status = value.trim();
        }
      }
      
      // Filtros
      if (status.toLowerCase().includes("cancel") || status.toLowerCase().includes("retirada")) {
        console.log(`[SCRAPER HARRISON] Propiedad cancelada/retirada saltada: ${fullAddress}`);
        continue;
      }
      
      if (!isAuctionDateValid(saleDate)) {
        console.log(`[FILTRO VIGENCIA] Descartando subasta pasada de Harrison County: ${fullAddress} | Fecha: ${saleDate}`);
        continue;
      }
      
      if (!isAddressInJurisdiction(fullAddress, "IN")) {
        console.log(`[SKIP] Propiedad fuera de jurisdicción detectada: ${fullAddress}`);
        continue;
      }
      
      // Hacer clic en el botón de detalles para obtener el Plaintiff (Demandante) del modal
      let plaintiff = "Unknown";
      try {
        const detailsBtn = card.locator('button:has-text("Map/Details"), a:has-text("Map/Details"), button:has-text("Details"), a:has-text("Details")');
        if (await detailsBtn.count() > 0) {
          await detailsBtn.first().click();
          await page.waitForSelector(".modal.show, .modal-body", { timeout: 5000 });
          
          const modalBodyText = await page.innerText(".modal-body").catch(() => "");
          const lines = modalBodyText.split("\n");
          for (const line of lines) {
            if (line.toLowerCase().includes("plaintiff")) {
              const parts = line.split(":");
              if (parts.length >= 2) {
                plaintiff = parts[1].trim();
              }
            }
          }
          
          // Cerrar modal
          const closeBtn = page.locator('.modal.show button:has-text("Close"), .modal.show .btn-close');
          if (await closeBtn.count() > 0) {
            await closeBtn.first().click();
            await page.waitForSelector(".modal.show", { state: "detached", timeout: 3000 }).catch(() => {});
          }
        }
      } catch (modalErr: any) {
        console.log(`[SCRAPER HARRISON WARNING] No se pudo extraer Plaintiff del modal: ${modalErr.message}`);
      }
      
      const auctionId = `IN_HARRISON_${street.trim().replace(/\s+/g, "_")}_${saleDate.trim().replace(/\s+/g, "_")}`;
      
      try {
        await db.execute({
          sql: `
            INSERT INTO foreclosure_auctions (
              auction_id, case_number, address, county, state, auction_date,
              plaintiff, defendant, mls_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_check')
            ON CONFLICT(auction_id) DO UPDATE SET
              address = excluded.address,
              auction_date = excluded.auction_date,
              plaintiff = COALESCE(excluded.plaintiff, foreclosure_auctions.plaintiff),
              defendant = COALESCE(excluded.defendant, foreclosure_auctions.defendant)
          `,
          args: [
            auctionId,
            caseNumber,
            fullAddress,
            "Harrison",
            "IN",
            saleDate,
            plaintiff,
            defendant
          ]
        });
        activeSavedCount++;
        console.log(`[SUBASTA HARRISON GUARDADA] Dirección: ${fullAddress} | Defendant: ${defendant} | Fecha: ${saleDate} | Plaintiff: ${plaintiff}`);
      } catch (dbErr: any) {
        console.error(`[DB ERROR] Error al guardar subasta de Harrison County:`, dbErr.message);
      }
    }
  } catch (err: any) {
    console.error(`[SCRAPER HARRISON ERROR] Falló la extracción en Harrison County:`, err.message);
  } finally {
    await browser.close();
  }
  
  console.log(`[SCRAPER HARRISON] Finalizado. Guardadas/Actualizadas: ${activeSavedCount} subastas.`);
}

/**
 * Función principal para correr todos los scrapers de Indiana
 */
async function scrapeIndiana() {
  console.log("\n========================================================");
  console.log("[INDIANA MAIN] Iniciando Extracción Completa de Indiana...");
  console.log("========================================================\n");
  
  await scrapeClarkCounty();
  await scrapeFloydCounty();
  await scrapeHarrisonCounty();
}

// Ejecutar si se corre directamente
if (require.main === module) {
  scrapeIndiana();
}

export { scrapeIndiana, scrapeHarrisonCounty };
