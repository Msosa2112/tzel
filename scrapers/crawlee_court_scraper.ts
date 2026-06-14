import { PlaywrightCrawler } from "crawlee";
import { createClient } from "@libsql/client";
import { getProxyConfiguration } from "./proxy_helper";
import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import * as dotenv from "dotenv";
import * as fs from "fs";

chromium.use(stealthPlugin());

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

/**
 * Limpia y normaliza el nombre del demandado
 */
export function cleanDefendant(name: string): string {
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
  
  // Remover "the unknown heirs at law of" o similar
  clean = clean.replace(/the\s+unknown\s+heirs\s+at\s+law\s+of\s*/gi, "");
  clean = clean.replace(/unknown\s+heirs\s+of\s*/gi, "");
  clean = clean.replace(/,?\s*the\s+unknown\s+heirs\s+at\s+law\s+of\s*$/gi, "");

  // Limpiar caracteres de puntuación sobrantes al final
  clean = clean.replace(/[\*\,\-\_\#\s]+$/, "");
  
  // Quitar comillas
  clean = clean.replace(/["']/g, "");
  
  // Normalizar espacios
  clean = clean.replace(/\s+/g, " ").trim();
  
  return clean;
}

export interface ScrapedCourtDetails {
  caseNumber: string;
  plaintiff: string | null;
  defendant: string | null;
  debtAmount: number | null;
}

/**
 * Ejecuta el rastreador de MyCase Indiana usando Crawlee PlaywrightCrawler
 * con soporte de proxy rotativo y evasión anti-bot automatizada.
 */
export async function scrapeIndianaCaseWithCrawlee(caseNumber: string): Promise<ScrapedCourtDetails | null> {
  console.log(`[CRAWLEE CRAWLER] Inicializando búsqueda MyCase para expediente: ${caseNumber}...`);
  try {
    fs.rmSync("./storage", { recursive: true, force: true });
  } catch (err) {}
  
  let result: ScrapedCourtDetails | null = null;
  
  // 1. Obtener la configuración del proxy (si existe en el .env)
  const proxyConfiguration = getProxyConfiguration();
  
  // 2. Definir el crawler de Playwright
  const crawler = new PlaywrightCrawler({
    proxyConfiguration,
    maxRequestRetries: 3,
    requestHandlerTimeoutSecs: 60,
    launchContext: {
      launcher: chromium,
      useChrome: true,
      launchOptions: {
        headless: false,
      }
    },
    // Handler que procesa la página web
    requestHandler: async ({ page, log }) => {
      log.info(`Navegando al portal judicial de Indiana...`);
      await page.goto("https://public.courts.in.gov/mycase/", { waitUntil: "networkidle", timeout: 25000 });
      
      // Esperar un momento corto para la resolución de red
      await page.waitForTimeout(3000);
      
      const title = await page.title();
      log.info(`Título de la página cargada: "${title}"`);
      
      // Detección y manejo defensivo del desafío de Cloudflare / Turnstile
      const cfIframe = page.locator('iframe[src*="challenges.cloudflare.com"]');
      const count = await cfIframe.count();
      if (count > 0 || title.includes("Just a moment") || title.includes("Cloudflare")) {
        log.warning("Desafío de Cloudflare detectado. Intentando resolver...");
        try {
          const frame = page.frame({ url: /challenges\.cloudflare\.com/ });
          if (frame) {
            const checkbox = frame.locator('#challenge-stage');
            if (await checkbox.isVisible()) {
              await checkbox.click();
              log.info("Se hizo clic en el checkbox de Turnstile.");
            }
          }
        } catch (e: any) {
          log.warning(`No se pudo hacer clic en el iframe de Turnstile: ${e.message}`);
        }
        // Esperar hasta 15 segundos a que aparezca la página real
        await page.waitForSelector("#SearchValue", { timeout: 15000 }).catch(() => {});
      }
      
      log.info(`Buscando número de caso: ${caseNumber}`);
      try {
        await page.waitForSelector("#SearchCaseNumber", { timeout: 10000 });
      } catch (err: any) {
        log.error(`Fallo al esperar #SearchCaseNumber. Guardando captura de pantalla de diagnóstico...`);
        const screenshotPath = "C:/Users/migue/.gemini/antigravity-ide/brain/683533b3-6893-461f-a192-bf6b0b842495/mycase_crawlee_fail.png";
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(e => log.error(`Fallo al capturar pantalla: ${e.message}`));
        log.info(`Diagnóstico: Captura guardada en ${screenshotPath}`);
        throw err;
      }
      await page.fill("#SearchCaseNumber", caseNumber);
      await page.click('button:has-text("Search")');
      
      log.info("Esperando resultados de la búsqueda...");
      try {
        await Promise.race([
          page.waitForSelector(`span.result-subtitle:has-text("${caseNumber}")`, { timeout: 15000 }),
          page.waitForFunction(() => {
            const body = document.body.innerText;
            return body.includes("No cases found") || body.includes("0 Cases Found") || body.includes("0 cases found");
          }, { timeout: 15000 })
        ]);
      } catch (e: any) {
        log.error("Error al esperar resultados de búsqueda. Guardando diagnóstico...");
        await page.screenshot({ path: "C:/Users/migue/.gemini/antigravity-ide/brain/683533b3-6893-461f-a192-bf6b0b842495/mycase_crawlee_fail_results.png", fullPage: true });
        throw e;
      }
      
      const bodyText = await page.innerText("body");
      if (bodyText.includes("No cases found") || bodyText.includes("0 Cases Found") || bodyText.includes("0 cases found")) {
        log.warning(`Caso ${caseNumber} no encontrado en el portal.`);
        return;
      }
      
      // Hacer clic en el enlace del caso encontrado (el título/estilo del caso en la misma fila)
      log.info("Haciendo clic en el enlace del caso...");
      const caseRow = page.locator('tr.result-row', { has: page.locator('span.result-subtitle', { hasText: caseNumber }) });
      await caseRow.locator('a.result-title').click();
      
      // Esperar a que cargue el expediente completo
      log.info("Cargando detalles del expediente...");
      await page.waitForSelector(".case-header", { timeout: 15000 }).catch(() => {});
      
      const caseDetailsText = await page.innerText("body");
      
      // Extracción de datos
      let plaintiff: string | null = null;
      let defendant: string | null = null;
      
      // Intentar extraer de la sección "Parties to the Case"
      const lines = caseDetailsText.split("\n");
      let inPartiesSection = false;
      const defendantsList: string[] = [];
      const plaintiffsList: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        
        // Detectar inicio de sección
        if (trimmed.toLowerCase().includes("parties to the case")) {
          inPartiesSection = true;
          continue;
        }
        
        // Detectar fin de sección
        if (inPartiesSection && (trimmed.toLowerCase().includes("chronological case summary") || trimmed.toLowerCase().includes("financial information"))) {
          inPartiesSection = false;
        }
        
        if (inPartiesSection) {
          // Tratar de buscar "Defendant\tNAME" o "Plaintiff\tNAME" (usando espacios múltiples o tabs)
          const plMatch = line.match(/^\s*(?:Plaintiff)\s+(.+)$/i);
          const dfMatch = line.match(/^\s*(?:Defendant)\s+(.+)$/i);
          
          if (plMatch) {
            plaintiffsList.push(plMatch[1].trim());
          }
          if (dfMatch) {
            defendantsList.push(dfMatch[1].trim());
          }
        }
      }

      // Si obtuvimos algo en las listas, asignarlos
      if (plaintiffsList.length > 0) {
        plaintiff = plaintiffsList[0];
      }
      
      if (defendantsList.length > 0) {
        // Encontrar el primer defendant que no sea "state of indiana" ni "occupant"
        const primaryDef = defendantsList.find(d => 
          !d.toLowerCase().includes("state of indiana") && 
          !d.toLowerCase().includes("occupant") &&
          !d.toLowerCase().includes("ave, jeffersonville")
        );
        defendant = primaryDef || defendantsList[0];
      }

      // Fallbacks si la lógica por sección no encontró nada
      if (!plaintiff) {
        const plaintiffMatch = caseDetailsText.match(/Plaintiff\s*(?::|\t|\s{2,})\s*([^\n]+)/i) || 
                               caseDetailsText.match(/Plaintiff\s+Name\s*(?::|\t|\s{2,})\s*([^\n]+)/i);
        if (plaintiffMatch) plaintiff = plaintiffMatch[1].trim();
      }
      if (!defendant) {
        const defendantMatch = caseDetailsText.match(/Defendant\s*(?::|\t|\s{2,})\s*([^\n]+)/i) || 
                               caseDetailsText.match(/Defendant\s+Name\s*(?::|\t|\s{2,})\s*([^\n]+)/i);
        if (defendantMatch) defendant = defendantMatch[1].trim();
      }

      // Limpiar y normalizar el nombre del demandado
      if (defendant) {
        defendant = cleanDefendant(defendant);
      }
      
      let debt: number | null = null;
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
            log.info(`Deuda extraída: $${debt.toLocaleString()}`);
            break;
          }
        }
      }
      
      result = {
        caseNumber,
        plaintiff,
        defendant,
        debtAmount: debt
      };
      
      log.info(`Extracción finalizada con éxito.`);
    },
    // Handler para cuando falla la petición
    failedRequestHandler: ({ request, log }) => {
      log.error(`La petición para ${request.url} falló permanentemente tras los reintentos.`);
    }
  });

  // 3. Ejecutar el crawler pasándole la URL inicial
  await crawler.run(["https://public.courts.in.gov/mycase/"]);
  
  return result;
}

/**
 * Guarda los resultados en la base de datos Turso
 */
export async function updateDatabaseWithScrapedDetails(auctionId: string, details: ScrapedCourtDetails): Promise<boolean> {
  console.log(`[CRAWLEE DB UPDATE] Guardando datos en Turso para la subasta: ${auctionId}...`);
  try {
    await db.execute({
      sql: `
        UPDATE foreclosure_auctions SET
          debt_amount = ?,
          plaintiff = ?,
          defendant = ?,
          needs_manual_review = ?,
          is_high_yield = CASE 
            WHEN (mls_estimated_value - ?) >= (mls_estimated_value * 0.30) THEN 1 
            ELSE 0 
          END
        WHERE auction_id = ?
      `,
      args: [
        details.debtAmount,
        details.plaintiff,
        details.defendant,
        details.debtAmount ? 0 : 1,
        details.debtAmount || 0,
        auctionId
      ]
    });
    console.log(`[CRAWLEE DB UPDATE SUCCESS] Base de datos actualizada.`);
    return true;
  } catch (err: any) {
    console.error(`[CRAWLEE DB UPDATE ERROR] Error al guardar datos:`, err.message);
    return false;
  }
}

// Ejecutar prueba si se corre directamente
if (require.main === module) {
  async function runTest() {
    const caseNum = "10C01-2507-MF-000119";
    const auctionId = "IN_CLARK_305_E_CHARLESTOWN_AVE_JUNE/18_2026";
    const details = await scrapeIndianaCaseWithCrawlee(caseNum);
    if (details) {
      console.log("=== DATOS EXTRAÍDOS ===");
      console.log(details);
      await updateDatabaseWithScrapedDetails(auctionId, details);
    } else {
      console.log("No se pudo obtener información del caso.");
    }
  }
  
  runTest().catch(console.error);
}
