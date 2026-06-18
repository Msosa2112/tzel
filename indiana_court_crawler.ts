import axios from "axios";
import * as cheerio from "cheerio";
import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import { isHighYieldProperty } from "./underwriting/underwriter";
import { BatchDataClient } from "./scrapers/batchdata_client";
import { scrapeIndianaCaseWithCrawlee } from "./scrapers/crawlee_court_scraper";
import { applyFlareSolverrBypass } from "./scrapers/proxy_helper";

chromium.use(stealthPlugin());

// Cargar variables de entorno
dotenv.config();

// Inicializar cliente de Turso DB
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

const batchDataClient = new BatchDataClient();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

function parseAddress(rawAddress: string, state: string, county: string) {
  let street = rawAddress.trim();
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

  // Split street and city first
  const parts = street.split(",");
  if (parts.length >= 2) {
    city = parts[parts.length - 1].trim();
    street = parts.slice(0, parts.length - 1).join(",").trim();
  }

  // Override or fallback city based on county/state ONLY if city is empty
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

  return {
    street: street.replace(/,\s*$/, "").trim(),
    city: city,
    state: state,
    zip: zip || ""
  };
}

async function getOwnerNameFromBatchData(address: string, state: string, county: string): Promise<{ first: string; last: string }[] | null> {
  const parsed = parseAddress(address, state, county);
  const apiKey = process.env.SKIP_TRACE_API_KEY || process.env.BATCHDATA_API_KEY || "";
  if (!apiKey) {
    console.log("[BATCHDATA] No API Key configured for property lookup.");
    return null;
  }

  try {
    console.log(`[BATCHDATA] Buscando propietario en BatchData para: "${address}"...`);
    const response = await axios.post(
      "https://api.batchdata.com/api/v1/property/lookup/all-attributes",
      {
        requests: [
          {
            address: {
              street: parsed.street,
              city: parsed.city,
              state: parsed.state,
              zip: parsed.zip
            }
          }
        ]
      },
      {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        }
      }
    );

    const properties = response.data?.results?.properties || [];
    if (properties.length > 0) {
      const owner = properties[0].owner;
      if (owner && owner.names && owner.names.length > 0) {
        console.log(`[BATCHDATA] Propietario(s) encontrado(s): ${JSON.stringify(owner.names)}`);
        return owner.names.map((n: any) => ({
          first: n.first || "",
          last: n.last || ""
        }));
      }
    }
  } catch (err: any) {
    console.error(`[BATCHDATA ERROR] Error en property lookup: ${err.message}`);
  }
  return null;
}

async function searchMyCaseByName(first: string, last: string, county: string): Promise<string | null> {
  console.log(`[MYCASE NAME SEARCH] Buscando caso para ${first} ${last} en condado ${county}...`);
  
  const browser = await chromium.launch({
    headless: process.env.HEADLESS ? process.env.HEADLESS === "true" : false,
  });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
  });
  const page = await context.newPage();
  
  try {
    await page.goto("https://public.courts.in.gov/mycase/", { waitUntil: "networkidle", timeout: 25000 });
    await page.waitForTimeout(3000);
    
    const title = await page.title();
    // Detección y manejo defensivo del desafío de Cloudflare / Turnstile
    const cfIframe = page.locator('iframe[src*="challenges.cloudflare.com"]');
    const count = await cfIframe.count();
    if (count > 0 || title.includes("Just a moment") || title.includes("Cloudflare") || title.includes("Attention Required")) {
      console.log("[MYCASE NAME SEARCH] Desafío de Cloudflare detectado. Intentando bypass con FlareSolverr...");
      const bypassed = await applyFlareSolverrBypass(context, "https://public.courts.in.gov/mycase/");
      if (bypassed) {
        console.log("[MYCASE NAME SEARCH] Bypass de FlareSolverr exitoso. Recargando página...");
        await page.goto("https://public.courts.in.gov/mycase/", { waitUntil: "networkidle", timeout: 25000 });
      } else {
        console.log("[MYCASE NAME SEARCH] FlareSolverr falló. Intentando resolver con click de Turnstile...");
        try {
          const frame = page.frame({ url: /challenges\.cloudflare\.com/ });
          if (frame) {
            const checkbox = frame.locator('#challenge-stage');
            if (await checkbox.isVisible()) {
              await checkbox.click();
              console.log("[MYCASE NAME SEARCH] Se hizo clic en el checkbox de Turnstile.");
            }
          }
        } catch (e: any) {
          console.warn(`[MYCASE NAME SEARCH] No se pudo hacer clic en el iframe de Turnstile: ${e.message}`);
        }
      }
      await page.waitForSelector("#SearchValue", { timeout: 15000 }).catch(() => {});
    }
    
    // Switch to name search
    await page.waitForSelector("#tabByParty", { timeout: 10000 });
    await page.click("#tabByParty");
    await page.waitForTimeout(1000);
    
    // Fill first and last name
    await page.fill('input[placeholder="last name"]', last);
    await page.fill('input[placeholder="first name / initial"]', first);
    
    // Select county court
    const courtValue = county.toLowerCase().includes("clark") 
      ? "106" 
      : (county.toLowerCase().includes("floyd") ? "115" : "129");
    await page.selectOption("select.form-control", courtValue);
    
    // Search
    await page.click("button.btn-primary");
    await page.waitForTimeout(4000);
    
    const bodyText = await page.innerText("body");
    if (bodyText.includes("No cases found") || bodyText.includes("0 Cases Found") || bodyText.includes("0 cases found")) {
      console.log(`[MYCASE NAME SEARCH] No se encontraron casos para ${first} ${last}.`);
      await browser.close();
      return null;
    }
    
    // Regex para números de caso de Indiana
    const countyCodePrefix = courtValue === "106" ? "10" : (courtValue === "115" ? "22" : "31");
    const caseRegex = new RegExp(`\\b${countyCodePrefix}[A-Z]\\d{2}-\\d{4}-MF-\\d{3,6}\\b`, "gi");
    const matches = bodyText.match(caseRegex);
    
    if (matches && matches.length > 0) {
      const caseNumber = Array.from(new Set(matches))[0];
      console.log(`[MYCASE NAME SEARCH] Caso de foreclosure encontrado: ${caseNumber}`);
      await browser.close();
      return caseNumber;
    }
  } catch (err: any) {
    console.error(`[MYCASE NAME SEARCH ERROR] ${err.message}`);
    // Save diagnostic screenshot
    try {
      const fs = require("fs");
      if (!fs.existsSync("./storage")) {
        fs.mkdirSync("./storage", { recursive: true });
      }
      await page.screenshot({ path: "./storage/mycase_name_search_fail.png", fullPage: true });
      console.log("[MYCASE NAME SEARCH ERROR] Diagnóstico guardado en ./storage/mycase_name_search_fail.png");
    } catch (e) {}
  } finally {
    await browser.close();
  }
  return null;
}

/**
 * Extrae Plaintiff y Defendant de un fragmento de texto de aviso público
 */
function extractParties(text: string): { plaintiff: string | null, defendant: string | null } {
  let plaintiff: string | null = null;
  let defendant: string | null = null;

  const cleanText = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ");

  // Permissive multi-line / tab-separated parsing
  const plaintiffMatch = cleanText.match(/(?:Plaintiff|Plaintiff\s*\(s\)|Plaintiff\s*Name|Acreedor|Demandante)\s*:?\s*([\s\S]+?)(?=\r?\n\r?\n|\r?\n\s*(?:Defendant|Plaintiff|Attorney|Chronological|Case|Court|Status|Filed)|$)/i);
  const defendantMatch = cleanText.match(/(?:Defendant|Defendant\s*\(s\)|Defendant\s*Name|Demandado)\s*:?\s*([\s\S]+?)(?=\r?\n\r?\n|\r?\n\s*(?:Defendant|Plaintiff|Attorney|Chronological|Case|Court|Status|Filed)|$)/i);

  if (plaintiffMatch) plaintiff = plaintiffMatch[1].replace(/\s+/g, " ").trim();
  if (defendantMatch) defendant = cleanDefendant(defendantMatch[1].replace(/\s+/g, " ").trim());

  if (plaintiff && defendant) {
    return { plaintiff, defendant };
  }

  // Fallbacks para avisos públicos en texto continuo (legacy patterns)
  // Patrón A: "Plaintiff: [texto] Defendant: [texto]"
  const patternA = /Plaintiff\s*:\s*([^]+?)\s*Defendant\s*:\s*([^]+?)(?=\b(?:Required|Required\s+me|Parcel|Commonly|Attorney|Scottie|Matthew|\n\s*\n|$))/i;
  const matchA = cleanText.match(patternA);
  if (matchA) {
    plaintiff = matchA[1].replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
    defendant = cleanDefendant(matchA[2].replace(/\n+/g, " ").replace(/\s+/g, " ").trim());
    return { plaintiff, defendant };
  }

  // Patrón B: "... wherein X was/is Plaintiff, and Y was/is Defendant ..."
  const patternB = /(?:wherein|where)\s+(.+?)\s+was\s+Plaintiff,?\s+(?:and|vs\.?)\s+(.+?)\s+(?:et\s+al\.?\s+)?(?:was\s+a\s+|was\s+the\s+|were\s+a\s+|were\s+the\s+|was\s+|were\s+)?Defendants?/i;
  const matchB = cleanText.match(patternB);
  if (matchB) {
    plaintiff = matchB[1].replace(/\n+/g, " ").replace(/\s+/g, " ").replace(/,\s*$/, "").trim();
    defendant = cleanDefendant(matchB[2].replace(/\n+/g, " ").replace(/\s+/g, " ").replace(/,\s*$/, "").trim());
    return { plaintiff, defendant };
  }

  // Patrón C: "... wherein X, Plaintiff, and Y, Defendant ..."
  const patternC = /(?:wherein|where)\s+(.+?),?\s+Plaintiff,?\s+(?:and|vs\.?)\s+(.+?),?\s+Defendants?/i;
  const matchC = cleanText.match(patternC);
  if (matchC) {
    plaintiff = matchC[1].replace(/\n+/g, " ").replace(/\s+/g, " ").replace(/,\s*$/, "").trim();
    defendant = cleanDefendant(matchC[2].replace(/\n+/g, " ").replace(/\s+/g, " ").replace(/,\s*$/, "").trim());
    return { plaintiff, defendant };
  }

  return { plaintiff, defendant };
}

/**
 * Busca en la web (DuckDuckGo Lite) para encontrar el número de causa/caso judicial y las partes del caso.
 */
async function searchCaseAndParties(address: string, county: string): Promise<{
  caseNumber: string | null;
  plaintiff: string | null;
  defendant: string | null;
}> {
  const cleanAddress = address.split(",")[0].trim();
  const query = `${cleanAddress} ${county} sheriff`;
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;

  try {
    console.log(`[CRAWLER IN] Buscando caso en DuckDuckGo para: "${cleanAddress}"...`);
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);
    const pageText = $("body").text();

    // Regex para números de caso de Indiana. Ejemplo: 10D06-2308-MF-000129
    const caseRegex = /\b\d{2}[A-Z]\d{2}-\d{4}-[A-Z]{2}-\d{3,6}\b/gi;
    const matches = pageText.match(caseRegex);

    let caseNumber: string | null = null;
    let plaintiff: string | null = null;
    let defendant: string | null = null;

    if (matches && matches.length > 0) {
      caseNumber = Array.from(new Set(matches))[0] as string;
      console.log(`[CRAWLER IN] Caso encontrado en DDG principal: ${caseNumber}`);
    }

    // Buscar en enlaces de resultados para extraer partes y rellenar caso si no se encontró
    const resultUrls: string[] = [];
    $(".result-link").each((_, elem) => {
      const href = $(elem).attr("href");
      if (href) {
        const match = href.match(/[?&]uddg=([^&]+)/);
        if (match) {
          const decoded = decodeURIComponent(match[1]);
          if (decoded.startsWith("http") && !decoded.includes("duckduckgo.com")) {
            resultUrls.push(decoded);
          }
        }
      }
    });

    for (const link of resultUrls.slice(0, 3)) {
      try {
        console.log(`[CRAWLER IN] Profundizando en enlace de aviso: ${link}...`);
        const linkResponse = await axios.get(link, {
          headers: {
            "User-Agent": "Mozilla/5.0"
          },
          timeout: 8000
        });

        // Intentar encontrar número de caso en el enlace
        if (!caseNumber) {
          const linkMatches = linkResponse.data.match(caseRegex);
          if (linkMatches && linkMatches.length > 0) {
            caseNumber = Array.from(new Set(linkMatches))[0] as string;
            console.log(`[CRAWLER IN] Caso encontrado en enlace: ${caseNumber}`);
          }
        }

        // Intentar extraer Plaintiff/Defendant del texto
        const cleanText = cheerio.load(linkResponse.data)("body").text();
        const parties = extractParties(cleanText);
        if (parties.defendant) {
          plaintiff = parties.plaintiff;
          defendant = parties.defendant;
          console.log(`[CRAWLER IN] Partes extraídas con éxito del aviso: Plaintiff="${plaintiff}" | Defendant="${defendant}"`);
          break;
        }
      } catch (err: any) {
        // Silencioso
      }
    }

    return { caseNumber, plaintiff, defendant };
  } catch (err: any) {
    console.error(`[SEARCH ERROR] Error al buscar en DuckDuckGo: ${err.message}`);
  }
  return { caseNumber: null, plaintiff: null, defendant: null };
}


/**
 * Navega por MyCase Indiana usando Playwright para extraer detalles financieros del expediente.
 */
async function getCaseDetailsFromMyCase(caseNumber: string): Promise<{ debt: number | null; plaintiff: string | null; defendant: string | null } | null> {
  console.log(`[MYCASE] Iniciando consulta de expediente para caso: ${caseNumber}...`);
  
  const browser = await chromium.launch({
    headless: true,
  });
  
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
  });
  
  const page = await context.newPage();
  
  try {
    // 1. Navegar al portal de MyCase
    await page.goto("https://public.courts.in.gov/mycase/", { waitUntil: "networkidle", timeout: 20000 });
    
    // Verificar si nos topamos con un bloqueo directo o Cloudflare
    const pageTitle = await page.title();
    if (pageTitle.includes("Attention Required") || pageTitle.includes("Cloudflare") || pageTitle.includes("Just a moment")) {
      console.log("[MYCASE DETAILS] Desafío de Cloudflare detectado. Intentando bypass con FlareSolverr...");
      const bypassed = await applyFlareSolverrBypass(context, "https://public.courts.in.gov/mycase/");
      if (bypassed) {
        console.log("[MYCASE DETAILS] Bypass de FlareSolverr exitoso. Recargando página...");
        await page.goto("https://public.courts.in.gov/mycase/", { waitUntil: "networkidle", timeout: 20000 });
      } else {
        throw new Error("Bloqueo de seguridad / Captcha de Cloudflare detectado en la página de inicio y FlareSolverr falló.");
      }
    }
    
    // 2. Ingresar el número de caso en el buscador
    await page.waitForSelector("#SearchCaseNumber", { timeout: 10000 });
    await page.fill("#SearchCaseNumber", caseNumber);
    
    // Enviar formulario
    await page.click("button.btn-primary", { timeout: 5000 });
    
    // 3. Esperar los resultados
    console.log("[MYCASE] Esperando resultados de búsqueda...");
    await page.waitForTimeout(3000);
    
    // Verificar si hay resultados
    const bodyText = await page.innerText("body");
    if (bodyText.includes("No cases found") || bodyText.includes("0 Cases Found")) {
      console.log(`[MYCASE] Caso no encontrado en el portal: ${caseNumber}`);
      await browser.close();
      return null;
    }
    
    // 4. Si hay resultados, hacer clic en el enlace del caso para abrirlo
    const rowLocator = page.locator('tr.result-row', {
      has: page.locator(`span.result-subtitle:has-text("${caseNumber}")`)
    });
    const linkLocator = rowLocator.locator('a.result-title');
    await page.waitForSelector('tr.result-row', { timeout: 10000 });
    await linkLocator.first().click();
    
    // Esperar a que cargue el expediente (esperar a que desaparezca el texto 'loading')
    console.log("[MYCASE] Esperando que se carguen los detalles del expediente...");
    let loaded = false;
    for (let i = 1; i <= 10; i++) {
      await page.waitForTimeout(1000);
      const text = await page.innerText("body");
      if (!text.includes("loading") && text.includes("Case Summary")) {
        loaded = true;
        console.log(`[MYCASE] Expediente cargado en ${i} segundos.`);
        break;
      }
    }
    if (!loaded) {
      console.log("[MYCASE WARNING] El expediente tardó más de 10 segundos en cargar o sigue en estado loading.");
    }
    const caseDetailsText = await page.innerText("body");

    
    // 5. Extraer nombres de Demandante y Demandado (permissive multi-line / tab-separated parsing)
    let plaintiff: string | null = null;
    let defendant: string | null = null;
    
    const plaintiffMatch = caseDetailsText.match(/(?:Plaintiff|Plaintiff\s*\(s\)|Plaintiff\s*Name|Acreedor|Demandante)\s*:?\s*([\s\S]+?)(?=\r?\n\r?\n|\r?\n\s*(?:Defendant|Plaintiff|Attorney|Chronological|Case|Court|Status|Filed)|$)/i);
    const defendantMatch = caseDetailsText.match(/(?:Defendant|Defendant\s*\(s\)|Defendant\s*Name|Demandado)\s*:?\s*([\s\S]+?)(?=\r?\n\r?\n|\r?\n\s*(?:Defendant|Plaintiff|Attorney|Chronological|Case|Court|Status|Filed)|$)/i);
    
    if (plaintiffMatch) plaintiff = plaintiffMatch[1].replace(/\s+/g, " ").trim();
    if (defendantMatch) defendant = cleanDefendant(defendantMatch[1].replace(/\s+/g, " ").trim());

    
    // 6. Extraer Monto de Deuda (Judgment Amount)
    let debt: number | null = null;
    
    const judgmentRegexes = [
      /Judgment\s*:\s*\$([0-9,]+(?:\.[0-9]{2})?)/i,
      /Judgment\s+Amount\s*:\s*\$([0-9,]+(?:\.[0-9]{2})?)/i,
      /Judgment\s+in\s+favor\s+of\s+[^$]*\$([0-9,]+(?:\.[0-9]{2})?)/i,
      /Judgment\s+for\s+\$([0-9,]+(?:\.[0-9]{2})?)/i,
      /ordered\s+to\s+pay\s+\$([0-9,]+(?:\.[0-9]{2})?)/i,
      /Judgment\s+entered\s+[^$]*\$([0-9,]+(?:\.[0-9]{2})?)/i,
      /Principal\s*:\s*\$([0-9,]+(?:\.[0-9]{2})?)/i
    ];
    
    for (const regex of judgmentRegexes) {
      const match = caseDetailsText.match(regex);
      if (match) {
        const amountStr = match[1].replace(/,/g, "");
        const amount = parseFloat(amountStr);
        if (!isNaN(amount) && amount > 0) {
          debt = amount;
          console.log(`[MYCASE] Deuda extraída: $${debt.toLocaleString()}`);
          break;
        }
      }
    }
    
    await browser.close();
    return { debt, plaintiff, defendant };
    
  } catch (err: any) {
    console.error(`[MYCASE ERROR] Error en la navegación de Playwright: ${err.message}`);
    await browser.close();
    throw err;
  }
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
  } catch (e) {}
  return null;
}

/**
 * Función principal para procesar todas las subastas de Indiana pendientes de deuda
 */
async function runIndianaCrawler() {
  console.log("[INICIO] Iniciando Crawler de Expedientes de Indiana (MyCase)...");
  
  // NOTA: No limpiar toda la carpeta ./storage aquí, ya que Crawlee mantiene en caché de memoria
  // el gestor del KeyValueStore por defecto. Si se borra la carpeta en disco a mitad del proceso,
  // las siguientes llamadas a PlaywrightCrawler fallarán al buscar 'SDK_SESSION_POOL_STATE.json'.
  // Las colas de peticiones ya están versionadas con timestamp y se eliminan vía requestQueue.drop().

  
  // 1. Consultar subastas de Indiana que no tengan deuda asociada y no estén hibernadas para el futuro
  let auctionsRes;
  try {
    auctionsRes = await db.execute(`
      SELECT auction_id, address, county, case_number, defendant, plaintiff, mls_estimated_value, hidden_mortgages, auction_date, next_retry_date
      FROM foreclosure_auctions 
      WHERE state = 'IN' AND (debt_amount IS NULL OR debt_amount = 0)
        AND (next_retry_date IS NULL OR next_retry_date <= date('now'))
    `);
  } catch (dbErr: any) {
    console.error("[DB ERROR] Error al consultar subastas de Indiana:", dbErr.message);
    process.exit(1);
  }
  
  const auctions = auctionsRes.rows;
  console.log(`[CRAWLER IN] Se detectaron ${auctions.length} subastas de Indiana que requieren investigación.`);
  
  let successCount = 0;
  let manualReviewCount = 0;
  
  for (const row of auctions) {
    const auctionId = row.auction_id as string;
    const address = row.address as string;
    const county = row.county as string;
    let caseNumber = row.case_number as string;
    const mlsEstimatedValue = row.mls_estimated_value as number || 0;
    const hiddenMortgages = row.hidden_mortgages as number || 0;
    
    let extractedPlaintiff: string | null = null;
    let extractedDefendant: string | null = null;
    
    console.log(`\n-------------------------------------------------------------`);
    console.log(`[PROCESANDO] Dirección: ${address} | Condado: ${county}`);
    
    // 2. Si el caso es 'PENDING', buscar el número de caso y parties en la web
    if (caseNumber === "PENDING") {
      // PASO 1: Extracción Gratis
      const searchRes = await searchCaseAndParties(address, county);
      if (searchRes.caseNumber) {
        caseNumber = searchRes.caseNumber;
        extractedPlaintiff = searchRes.plaintiff;
        extractedDefendant = searchRes.defendant;
        
        // Guardar el número de caso provisional en la DB
        try {
          await db.execute({
            sql: `
              UPDATE foreclosure_auctions SET 
                case_number = ?,
                plaintiff = COALESCE(?, plaintiff),
                defendant = COALESCE(?, defendant)
              WHERE auction_id = ?
            `,
            args: [caseNumber, extractedPlaintiff, extractedDefendant, auctionId]
          });
        } catch (e) {}
      } else {
        // PASO 2: Filtro de Fecha e Hibernación (30 a 60 días)
        const daysRemaining = getDaysRemaining(row.auction_date as string);
        if (daysRemaining !== null && daysRemaining >= 30) {
          const nextRetry = new Date();
          nextRetry.setDate(nextRetry.getDate() + 15);
          const nextRetryStr = nextRetry.toISOString().split("T")[0]; // YYYY-MM-DD
          
          console.log(`[HIBERNACIÓN] La búsqueda gratuita falló. Subasta en ${daysRemaining} días (entre 30 y 60). Hibernando proceso para no gastar API de pago. Próximo reintento: ${nextRetryStr}`);
          try {
            await db.execute({
              sql: "UPDATE foreclosure_auctions SET needs_manual_review = 2, next_retry_date = ? WHERE auction_id = ?",
              args: [nextRetryStr, auctionId]
            });
          } catch (e) {}
          continue; // Detener el proceso para esta propiedad (NO llamamos a BatchData)
        }
        
        // PASO 3: Extracción de Pago / Urgencia (menos de 30 días o fecha no determinable)
        const daysLog = daysRemaining !== null ? `${daysRemaining} días` : "fecha indefinida";
        console.log(`[URGENCIA] La búsqueda gratuita falló. Subasta en ${daysLog} (< 30 días). Iniciando consulta de pago en BatchData...`);
        
        let fallbackFound = false;
        try {
          const ownerNames = await getOwnerNameFromBatchData(address, "IN", county);
          if (ownerNames && ownerNames.length > 0) {
            for (const nameObj of ownerNames) {
              if (nameObj.first && nameObj.last) {
                const foundCase = await searchMyCaseByName(nameObj.first, nameObj.last, county);
                if (foundCase) {
                  caseNumber = foundCase;
                  extractedDefendant = `${nameObj.last}, ${nameObj.first}`;
                  fallbackFound = true;
                  
                  // Actualizar número de caso provisional y deudor en la DB
                  await db.execute({
                    sql: `
                      UPDATE foreclosure_auctions SET 
                        case_number = ?,
                        defendant = COALESCE(?, defendant)
                      WHERE auction_id = ?
                    `,
                    args: [caseNumber, extractedDefendant, auctionId]
                  });
                  console.log(`[FALLBACK SUCCESS] Caso encontrado de pago vía Name Search: ${caseNumber} para deudor: ${extractedDefendant}`);
                  break;
                }
              }
            }
          }
        } catch (fallbackErr: any) {
          console.error(`[FALLBACK ERROR] Falló el proceso de fallback de pago: ${fallbackErr.message}`);
        }

        if (!fallbackFound) {
          console.log(`[SKIP] No se pudo encontrar caso en DDG ni por fallback de propietario en MyCase para: "${address}". Marcando para revisión manual.`);
          try {
            await db.execute({
              sql: "UPDATE foreclosure_auctions SET needs_manual_review = 1 WHERE auction_id = ?",
              args: [auctionId]
            });
            manualReviewCount++;
          } catch (e) {}
          continue;
        }
      }
    }
    
    // 3. Consultar MyCase usando Crawlee
    try {
      const details = await scrapeIndianaCaseWithCrawlee(caseNumber);
      
      const debt = details ? details.debtAmount : null;
      let finalPlaintiff = details?.plaintiff || extractedPlaintiff || "Unknown";
      let finalDefendant = details?.defendant || extractedDefendant || "Unknown";
      
      if (finalPlaintiff === "No especificado") finalPlaintiff = "Unknown";
      if (finalDefendant === "No especificado") finalDefendant = "Unknown";
 
      if (details) {
        if (details.isDismissed) {
          console.log(`\x1b[33m[LIMPIEZA] Caso ${caseNumber} desestimado por la corte. Eliminando de Turso para evitar falsos positivos de subasta.\x1b[0m`);
          await db.execute({
            sql: "DELETE FROM foreclosure_auctions WHERE case_number = ?",
            args: [caseNumber]
          });
          continue;
        }

        // Si no se extrajeron nombres pero hay una deuda válida, omitimos la revisión manual
        const needsManual = debt && debt > 0 ? 0 : 1;
        
        // Calcular is_high_yield
        let isHighYield = 0;
        if (debt && debt > 0 && mlsEstimatedValue > 0) {
          const discountPct = ((mlsEstimatedValue - debt) / mlsEstimatedValue) * 100;
          console.log(`[MATCH SCORING] Deuda: $${debt.toLocaleString("en-US")} vs ARV: $${mlsEstimatedValue.toLocaleString("en-US")} | Descuento potencial: ${discountPct.toFixed(1)}%`);
          if (isHighYieldProperty(mlsEstimatedValue, debt, hiddenMortgages)) {
            isHighYield = 1;
            console.log(`[HIGH YIELD] ¡Propiedad marcada como alta rentabilidad (Equity >= 30% del ARV)!`);
          }
        }
 
        // Guardar en base de datos
        await db.execute({
          sql: `
            UPDATE foreclosure_auctions SET
              debt_amount = ?,
              plaintiff = ?,
              defendant = ?,
              needs_manual_review = ?,
              is_high_yield = ?
            WHERE auction_id = ?
          `,
          args: [
            debt,
            finalPlaintiff,
            finalDefendant,
            needsManual,
            isHighYield,
            auctionId
          ]
        });
        if (debt && debt > 0) {
          if (finalPlaintiff === "Unknown" || finalDefendant === "Unknown") {
            console.log(`[AVISO] Nombres no extraídos para caso ${caseNumber}, pero se continuó con éxito porque se obtuvo deuda de $${debt.toLocaleString()} (Nombres guardados como 'Unknown').`);
          } else {
            console.log(`[ÉXITO] Detalles guardados para caso ${caseNumber}: Deuda: $${debt.toLocaleString()} | Plaintiff: "${finalPlaintiff}" | Defendant: "${finalDefendant}"`);
          }
          successCount++;
        } else {
          console.log(`[FALTA DEUDA] No se encontró monto de deuda para caso ${caseNumber}. Requiere revisión manual.`);
          manualReviewCount++;
        }
      } else {
        throw new Error("Caso no encontrado en el portal MyCase");
      }
      
    } catch (err: any) {
      console.log(`[CRAWLER IN ERROR] Falló el rastreo para el caso ${caseNumber}. Detalle: ${err.message}`);
      
      let finalPlaintiff = extractedPlaintiff || "Unknown";
      let finalDefendant = extractedDefendant || "Unknown";
      if (finalPlaintiff === "No especificado") finalPlaintiff = "Unknown";
      if (finalDefendant === "No especificado") finalDefendant = "Unknown";
      
      try {
        await db.execute({
          sql: `
            UPDATE foreclosure_auctions SET
              plaintiff = COALESCE(?, plaintiff, 'Unknown'),
              defendant = COALESCE(?, defendant, 'Unknown'),
              needs_manual_review = 1
            WHERE auction_id = ?
          `,
          args: [
            finalPlaintiff,
            finalDefendant,
            auctionId
          ]
        });
        manualReviewCount++;
      } catch (dbErr) {}
    }
    
    // Respetar cortesía
    await sleep(2000);
  }
  
  console.log("\n========================================================");
  console.log("RESUMEN DE CRAWLER DE INDIANA:");
  console.log(`- Casos procesados con éxito: ${successCount}`);
  console.log(`- Casos marcados para revisión manual: ${manualReviewCount}`);
  console.log("========================================================\n");
}

// Ejecutar si se corre directamente
if (require.main === module) {
  runIndianaCrawler().catch(console.error);
}

export { runIndianaCrawler, getCaseDetailsFromMyCase };
