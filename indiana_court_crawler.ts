import axios from "axios";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

// Cargar variables de entorno
dotenv.config();

// Inicializar cliente de Turso DB
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Busca en la web (DuckDuckGo HTML) para encontrar el número de causa/caso judicial de Indiana para una dirección.
 */
async function searchCaseNumber(address: string, county: string): Promise<string | null> {
  const cleanAddress = address.split(",")[0].trim();
  const query = `"${cleanAddress}" "${county}" sheriff OR foreclosure OR "Cause No."`;
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  try {
    console.log(`[CRAWLER IN] Buscando número de caso en DuckDuckGo para: "${cleanAddress}"...`);
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);
    const pageText = $("body").text();

    // Regex para números de caso de Indiana. Ejemplo: 10D06-2308-MF-000129
    // 10 es Clark, 22 es Floyd.
    const caseRegex = /\b\d{2}[A-Z]\d{2}-\d{4}-[A-Z]{2}-\d{3,6}\b/gi;
    const matches = pageText.match(caseRegex);

    if (matches && matches.length > 0) {
      // Filtrar duplicados y retornar el primero
      const uniqueCases = Array.from(new Set(matches));
      console.log(`[CRAWLER IN] Números de caso encontrados en la búsqueda: ${JSON.stringify(uniqueCases)}`);
      return uniqueCases[0];
    }
  } catch (err: any) {
    console.error(`[SEARCH ERROR] Error al buscar número de caso para ${cleanAddress}: ${err.message}`);
  }
  return null;
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
    // Esperar a que el selector del input esté listo
    await page.waitForSelector("#SearchValue", { timeout: 10000 });
    await page.fill("#SearchValue", caseNumber);
    
    // Enviar formulario (clic al botón de buscar)
    await page.click("#cmdSearch", { timeout: 5000 });
    
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
    // El enlace suele contener el número de caso en el texto o ser un enlace del tipo /mycase/CaseDetails
    const caseLinkSelector = `a:has-text("${caseNumber}")`;
    await page.waitForSelector(caseLinkSelector, { timeout: 10000 });
    await page.click(caseLinkSelector);
    
    // Esperar a que cargue el expediente
    await page.waitForSelector(".case-header", { timeout: 15000 }).catch(() => {});
    const caseDetailsText = await page.innerText("body");
    
    // 5. Extraer nombres de Demandante y Demandado
    let plaintiff: string | null = null;
    let defendant: string | null = null;
    
    // Analizar secciones típicas de MyCase
    // Demandante: Plaintiff o Plaintiff(s)
    // Demandado: Defendant o Defendant(s)
    const plaintiffMatch = caseDetailsText.match(/Plaintiff\s*\n*:\s*([^\n]+)/i) || caseDetailsText.match(/Plaintiff\s+Name\s*\n*:\s*([^\n]+)/i);
    const defendantMatch = caseDetailsText.match(/Defendant\s*\n*:\s*([^\n]+)/i) || caseDetailsText.match(/Defendant\s+Name\s*\n*:\s*([^\n]+)/i);
    
    if (plaintiffMatch) plaintiff = plaintiffMatch[1].trim();
    if (defendantMatch) defendant = defendantMatch[1].trim();
    
    // 6. Extraer Monto de Deuda (Judgment Amount)
    let debt: number | null = null;
    
    // Regex para buscar montos de juicio (Judgment)
    const judgmentRegexes = [
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
    throw err; // Relanzar el error para ser capturado por la lógica de manual review
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
      SELECT auction_id, address, county, case_number 
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
    
    console.log(`\n-------------------------------------------------------------`);
    console.log(`[PROCESANDO] Dirección: ${address} | Condado: ${county}`);
    
    // 2. Si el caso es 'PENDING', buscar el número de caso primero
    if (caseNumber === "PENDING") {
      const foundCase = await searchCaseNumber(address, county);
      if (foundCase) {
        caseNumber = foundCase;
        // Guardar el número de caso provisional en la DB
        try {
          await db.execute({
            sql: "UPDATE foreclosure_auctions SET case_number = ? WHERE auction_id = ?",
            args: [caseNumber, auctionId]
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
    
    // 3. Consultar MyCase usando Playwright
    try {
      const details = await getCaseDetailsFromMyCase(caseNumber);
      
      if (details) {
        // Guardar en base de datos
        await db.execute({
          sql: `
            UPDATE foreclosure_auctions SET
              debt_amount = ?,
              plaintiff = ?,
              defendant = ?,
              needs_manual_review = 0
            WHERE auction_id = ?
          `,
          args: [
            details.debt,
            details.plaintiff || "No especificado",
            details.defendant || "No especificado",
            auctionId
          ]
        });
        
        console.log(`[ÉXITO] Detalles guardados para caso ${caseNumber}: Deuda: $${details.debt ? details.debt.toLocaleString() : "N/A"}`);
        successCount++;
      } else {
        console.log(`[NOT FOUND] No se encontraron detalles para el caso ${caseNumber} en MyCase.`);
        await db.execute({
          sql: "UPDATE foreclosure_auctions SET needs_manual_review = 1 WHERE auction_id = ?",
          args: [auctionId]
        });
        manualReviewCount++;
      }
      
    } catch (err: any) {
      // Captura de error robusta para evadir caídas del pipeline ante bloqueos de Cloudflare
      console.log(`[BLOQUEO CRAWLER] Falló el rastreo para el caso ${caseNumber}. Marcando para revisión manual. Detalle: ${err.message}`);
      try {
        await db.execute({
          sql: "UPDATE foreclosure_auctions SET needs_manual_review = 1 WHERE auction_id = ?",
          args: [auctionId]
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

export { runIndianaCrawler };
