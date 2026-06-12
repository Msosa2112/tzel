import axios from "axios";
import * as cheerio from "cheerio";
import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import { isHighYieldProperty } from "./underwriting/underwriter";


chromium.use(stealthPlugin());


// Cargar variables de entorno
dotenv.config();

// Inicializar cliente de Turso DB
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

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
    if (pageTitle.includes("Attention Required") || pageTitle.includes("Cloudflare")) {
      throw new Error("Bloqueo de seguridad / Captcha de Cloudflare detectado en la página de inicio.");
    }
    
    // 2. Ingresar el número de caso en el buscador
    await page.waitForSelector("#SearchCaseNumber", { timeout: 10000 });
    await page.fill("#SearchCaseNumber", caseNumber);
    
    // Enviar formulario
    await page.click("button.btn-primary", { timeout: 5000 });
    
    // 3. Esperar los resultados
    console.log("[MYCASE] Esperando resultados de búsqueda...");
    await page.waitForNavigation({ waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
    
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
    
    // Esperar a que cargue el expediente
    await page.waitForSelector(".case-summary", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(3000);
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
 * Función principal para procesar todas las subastas de Indiana pendientes de deuda
 */
async function runIndianaCrawler() {
  console.log("[INICIO] Iniciando Crawler de Expedientes de Indiana (MyCase)...");
  
  // 1. Consultar subastas de Indiana que no tengan deuda asociada
  let auctionsRes;
  try {
    auctionsRes = await db.execute(`
      SELECT auction_id, address, county, case_number, defendant, plaintiff, mls_estimated_value, hidden_mortgages
      FROM foreclosure_auctions 
      WHERE state = 'IN' AND (debt_amount IS NULL OR debt_amount = 0)
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
        console.log(`[SKIP] No se pudo encontrar un número de caso en la web para la dirección: "${address}". Marcando para revisión manual.`);
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
    
    // 3. Consultar MyCase usando Playwright Stealth
    try {
      const details = await getCaseDetailsFromMyCase(caseNumber);
      
      const debt = details ? details.debt : null;
      let finalPlaintiff = details?.plaintiff || extractedPlaintiff || "Unknown";
      let finalDefendant = details?.defendant || extractedDefendant || "Unknown";
      
      if (finalPlaintiff === "No especificado") finalPlaintiff = "Unknown";
      if (finalDefendant === "No especificado") finalDefendant = "Unknown";
 
      if (details) {
        // Si no se extrajeron nombres pero hay una deuda válida, omitimos la revisión manual
        const needsManual = debt && debt > 0 ? 0 : 1;
        
        // Calcular is_high_yield
        let isHighYield = 0;
        if (debt && debt > 0 && mlsEstimatedValue > 0) {
          const discountPct = ((mlsEstimatedValue - debt) / mlsEstimatedValue) * 100;
          console.log(`[MATCH SCORING] Deuda: $${debt.toLocaleString("en-US")} vs ARV: $${mlsEstimatedValue.toLocaleString("en-US")} | Descuento potencial: ${discountPct.toFixed(1)}%`);
          if (isHighYieldProperty(mlsEstimatedValue, debt, hiddenMortgages)) {
            isHighYield = 1;
            console.log(`[HIGH YIELD] ¡Propiedad marcada como alta rentabilidad (Equity >= 40% del ARV)!`);
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
