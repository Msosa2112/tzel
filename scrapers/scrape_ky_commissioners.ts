import { PlaywrightCrawler, RequestQueue } from "crawlee";
import { createClient } from "@libsql/client";
import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { isAddressInJurisdiction } from "./geo_fencing";

chromium.use(stealthPlugin());
dotenv.config();

// Inicializar cliente de Turso DB
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

// Helper de limpieza de demandados
function cleanDefendant(name: string): string {
  if (!name) return "";
  let clean = name;
  clean = clean.replace(/\([^)]*\)/g, "");
  clean = clean.replace(/,?\s+et\.?\s*al\.?/gi, "");
  clean = clean.replace(/,?\s+etal/gi, "");
  clean = clean.replace(/,?\s+spouse\s+of\s+.*$/gi, "");
  clean = clean.replace(/,?\s+and\s+spouse.*$/gi, "");
  clean = clean.replace(/,?\s+husband\s+and\s+wife.*$/gi, "");
  clean = clean.replace(/,?\s+wife\s+of\s+.*$/gi, "");
  clean = clean.replace(/,?\s+husband\s+of\s+.*$/gi, "");
  clean = clean.replace(/,?\s+deceased/gi, "");
  clean = clean.replace(/,?\s+individually/gi, "");
  clean = clean.replace(/the\s+unknown\s+heirs\s+at\s+law\s+of\s*/gi, "");
  clean = clean.replace(/unknown\s+heirs\s+of\s*/gi, "");
  clean = clean.replace(/,?\s*the\s+unknown\s+heirs\s+at\s+law\s+of\s*$/gi, "");
  clean = clean.replace(/[\*\,\-\_\#\s]+$/, "");
  clean = clean.replace(/["']/g, "");
  clean = clean.replace(/\s+/g, " ").trim();
  return clean;
}

// Helper de validación de fecha de subasta
const MONTH_MAP: { [key: string]: number } = {
  january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3,
  may: 4, june: 5, jun: 5, july: 6, jul: 6, august: 7, aug: 7, september: 8,
  sep: 8, sept: 8, october: 9, oct: 9, november: 10, nov: 10, december: 11, dec: 11
};

function parseAuctionDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const clean = dateStr.toLowerCase().replace(/\s+/g, " ").trim();
  if (clean.includes("unknown") || clean.includes("pending")) return null;

  // 1. Formato YYYY-MM-DD
  const ymdMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10) - 1;
    const day = parseInt(ymdMatch[3], 10);
    return new Date(year, month, day);
  }

  // 2. Formato MM/DD/YYYY o M/D/YYYY
  const slashDateMatch = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashDateMatch) {
    return new Date(parseInt(slashDateMatch[3], 10), parseInt(slashDateMatch[1], 10) - 1, parseInt(slashDateMatch[2], 10));
  }

  // 3. Formato Month DD, YYYY (ej: "June 26, 2026")
  const monthCommaMatch = clean.match(/^([a-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (monthCommaMatch) {
    const monthName = monthCommaMatch[1];
    if (MONTH_MAP[monthName] !== undefined) {
      return new Date(parseInt(monthCommaMatch[3], 10), MONTH_MAP[monthName], parseInt(monthCommaMatch[2], 10));
    }
  }

  const fb = new Date(dateStr);
  return isNaN(fb.getTime()) ? null : fb;
}

function isAuctionDateValid(dateStr: string): boolean {
  const auctionDate = parseAuctionDate(dateStr);
  if (!auctionDate) {
    // Si no se puede parsear, permitimos por seguridad
    return true;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  auctionDate.setHours(0, 0, 0, 0);
  return auctionDate.getTime() >= today.getTime();
}

/**
 * Scraper principal de los Master Commissioners de Kentucky
 */
export async function scrapeKYCommissioners() {
  console.log("\n========================================================");
  console.log("[KY COMMISSIONERS] Iniciando Extracción Multicondado de Kentucky...");
  console.log("========================================================\n");

  const queue = await RequestQueue.open(`ky-commissioners-${Date.now()}`);
  
  // Agregar URLs a procesar
  await queue.addRequest({ url: "https://oldhamcountymastercommissioner.com/foreclosures/", uniqueKey: "oldham" });
  await queue.addRequest({ url: "https://bullittcountymastercommissioner.com/scheduled-properties/", uniqueKey: "bullitt" });
  await queue.addRequest({ url: "http://shelbycountymastercommissioner.com/", uniqueKey: "shelby" });

  let totalSaved = 0;

  const crawler = new PlaywrightCrawler({
    requestQueue: queue,
    maxRequestRetries: 1,
    requestHandlerTimeoutSecs: 90,
    launchContext: {
      launcher: chromium,
      launchOptions: {
        headless: true,
      }
    },
    requestHandler: async ({ page, request, log }) => {
      const urlStr = request.url;
      log.info(`Procesando URL: ${urlStr}`);

      // A. Oldham, Henry y Trimble (Consolidado)
      if (urlStr.includes("oldhamcountymastercommissioner.com")) {
        try {
          log.info("[OLDHAM] Detectado portal consolidated de 12th Circuit (Oldham, Henry, Trimble)...");
          
          // Esperar y descargar el archivo Excel
          const downloadPromise = page.waitForEvent("download");
          await page.click('a[href*=".xlsx"]');
          const download = await downloadPromise;
          
          const tempDir = path.resolve("./scratch");
          if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
          }
          const xlsxPath = path.join(tempDir, "oldham_listings.xlsx");
          await download.saveAs(xlsxPath);
          log.info(`[OLDHAM] Excel guardado en: ${xlsxPath}`);

          // Ejecutar el script Python de parseo
          const pythonScript = path.resolve("./scrapers/parse_oldham_xlsx.py");
          log.info(`[OLDHAM] Ejecutando parser Python: ${pythonScript}`);
          const parsedOutput = execSync(`python "${pythonScript}" "${xlsxPath}"`, { encoding: "utf-8" });
          
          const properties = JSON.parse(parsedOutput);
          if (properties.error) {
            throw new Error(properties.error);
          }

          log.info(`[OLDHAM] Se obtuvieron ${properties.length} expedientes del Excel.`);

          for (const prop of properties) {
            // Saltarse subastas canceladas o ya vendidas
            const statusLower = (prop.status || "").toLowerCase();
            if (statusLower.includes("cancel") || statusLower.includes("sold")) {
              log.info(`[OLDHAM SKIP] Propiedad cancelada/vendida: ${prop.address} (${prop.status})`);
              continue;
            }

            if (!isAuctionDateValid(prop.auction_date)) {
              log.info(`[OLDHAM SKIP] Subasta pasada descartada: ${prop.address} | Fecha: ${prop.auction_date}`);
              continue;
            }

            if (!isAddressInJurisdiction(prop.address, "KY")) {
              log.info(`[OLDHAM SKIP] Fuera de jurisdicción geovallado: ${prop.address}`);
              continue;
            }

            const cleanDef = cleanDefendant(prop.defendant);
            const auctionId = `KY_${prop.county.toUpperCase()}_${prop.case_number.replace(/\s+/g, "_")}`;

            try {
              await db.execute({
                sql: `
                  INSERT INTO foreclosure_auctions (
                    auction_id, case_number, address, county, state, auction_date,
                    plaintiff, defendant, appraisal_value, mls_status
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_check')
                  ON CONFLICT(auction_id) DO UPDATE SET
                    address = excluded.address,
                    auction_date = excluded.auction_date,
                    plaintiff = COALESCE(excluded.plaintiff, foreclosure_auctions.plaintiff),
                    defendant = COALESCE(excluded.defendant, foreclosure_auctions.defendant),
                    appraisal_value = COALESCE(excluded.appraisal_value, foreclosure_auctions.appraisal_value)
                `,
                args: [
                  auctionId,
                  prop.case_number,
                  prop.address,
                  prop.county,
                  "KY",
                  prop.auction_date,
                  prop.plaintiff,
                  cleanDef,
                  prop.appraisal_value
                ]
              });
              log.info(`[KY COMMISSIONER GUARDADA] Condado: ${prop.county} | Dirección: ${prop.address} | Defendant: ${cleanDef} | Fecha: ${prop.auction_date}`);
              totalSaved++;
            } catch (dbErr: any) {
              log.error(`Error de base de datos para ${prop.address}: ${dbErr.message}`);
            }
          }

        } catch (err: any) {
          log.error(`[OLDHAM CRAWL ERROR] Falló el raspado de Oldham/Henry/Trimble: ${err.message}`);
        }
      }

      // B. Bullitt County
      else if (urlStr.includes("bullittcountymastercommissioner.com")) {
        try {
          log.info("[BULLITT] Detectado portal de Bullitt County Master Commissioner...");
          
          await page.waitForTimeout(3000);
          const bodyText = await page.innerText("body");
          
          if (bodyText.includes("There are no properties scheduled at this time")) {
            log.info("[BULLITT] No hay propiedades programadas en este momento.");
            return;
          }

          const tableCount = await page.locator("table").count();
          if (tableCount === 0) {
            log.warning("[BULLITT] No se encontró ninguna tabla en el portal.");
            return;
          }

          // Detectar fecha de subasta próxima en el texto del portal (ej: "Next sale is June 30, 2026")
          let defaultAuctionDate = "Pending";
          const nextSaleMatch = bodyText.match(/(?:next sale|sale date|sale on)\s*(?:is|will be held on)?\s*:?\s*([A-Za-z]+ \d{1,2},? \d{4})/i);
          if (nextSaleMatch) {
            defaultAuctionDate = nextSaleMatch[1].trim();
            log.info(`[BULLITT] Fecha de subasta detectada del texto de la página: ${defaultAuctionDate}`);
          }

          const table = page.locator("table").first();
          const rowsCount = await table.locator("tr").count();
          
          log.info(`[BULLITT] Procesando tabla de subastas con ${rowsCount} filas...`);

          for (let r = 1; r < rowsCount; r++) { // Empezar en 1 para saltar cabecera
            const row = table.locator("tr").nth(r);
            const cellCount = await row.locator("td").count();
            if (cellCount < 4) continue;

            const caseNumber = (await row.locator("td").nth(0).innerText()).trim();
            const parties = (await row.locator("td").nth(1).innerText()).trim();
            const status = (await row.locator("td").nth(2).innerText()).trim();
            const address = (await row.locator("td").nth(3).innerText()).trim();
            
            let appraisalValue: number | null = null;
            if (cellCount >= 6) {
              const appraisalText = await row.locator("td").nth(5).innerText();
              try {
                appraisalValue = parseFloat(appraisalText.replace("$", "").replace(",", "").trim());
              } catch (e) {}
            }

            if (status.toLowerCase().includes("cancel") || status.toLowerCase().includes("sold")) {
              log.info(`[BULLITT SKIP] Propiedad cancelada/vendida: ${address}`);
              continue;
            }

            if (!isAuctionDateValid(defaultAuctionDate)) {
              log.info(`[BULLITT SKIP] Subasta pasada descartada: ${address} | Fecha: ${defaultAuctionDate}`);
              continue;
            }

            if (!isAddressInJurisdiction(address, "KY")) {
              log.info(`[BULLITT SKIP] Fuera de jurisdicción: ${address}`);
              continue;
            }

            // Split de partes
            let plaintiff = "Unknown";
            let defendant = "Unknown";
            if (parties.includes(" v ")) {
              const parts = parties.split(" v ");
              plaintiff = parts[0].trim();
              defendant = parts[1].trim();
            } else if (parties.toLowerCase().includes(" vs. ")) {
              const parts = reSplitVs(parties);
              if (parts.length >= 2) {
                plaintiff = parts[0].trim();
                defendant = parts[1].trim();
              }
            } else {
              defendant = parties;
            }

            const cleanDef = cleanDefendant(defendant);
            const auctionId = `KY_BULLITT_${caseNumber.replace(/\s+/g, "_")}`;

            try {
              await db.execute({
                sql: `
                  INSERT INTO foreclosure_auctions (
                    auction_id, case_number, address, county, state, auction_date,
                    plaintiff, defendant, appraisal_value, mls_status
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_check')
                  ON CONFLICT(auction_id) DO UPDATE SET
                    address = excluded.address,
                    auction_date = excluded.auction_date,
                    plaintiff = COALESCE(excluded.plaintiff, foreclosure_auctions.plaintiff),
                    defendant = COALESCE(excluded.defendant, foreclosure_auctions.defendant),
                    appraisal_value = COALESCE(excluded.appraisal_value, foreclosure_auctions.appraisal_value)
                `,
                args: [
                  auctionId,
                  caseNumber,
                  address,
                  "Bullitt",
                  "KY",
                  defaultAuctionDate,
                  plaintiff,
                  cleanDef,
                  appraisalValue
                ]
              });
              log.info(`[KY COMMISSIONER GUARDADA] Condado: Bullitt | Dirección: ${address} | Defendant: ${cleanDef} | Fecha: ${defaultAuctionDate}`);
              totalSaved++;
            } catch (dbErr: any) {
              log.error(`Error de base de datos para ${address}: ${dbErr.message}`);
            }
          }
        } catch (err: any) {
          log.error(`[BULLITT CRAWL ERROR] Falló el raspado de Bullitt: ${err.message}`);
        }
      }

      // C. Shelby County (Graceful failure for offline site)
      else if (urlStr.includes("shelbycountymastercommissioner.com")) {
        log.warning("[SHELBY] Intentando raspar portal de Shelby County...");
        // Not implemented fully since domain is offline, handled inside failedRequestHandler or catch below
      }
    },
    failedRequestHandler: ({ request, log }) => {
      if (request.url.includes("shelbycountymastercommissioner.com")) {
        log.warning(`[SHELBY OFFLINE] El portal judicial de Shelby County se encuentra fuera de línea temporalmente. Saltando de forma segura.`);
      } else {
        log.error(`La petición para ${request.url} falló permanentemente tras los reintentos.`);
      }
    }
  });

  try {
    await crawler.run();
  } catch (err: any) {
    console.error("[KY COMMISSIONERS ERROR] Error general en Crawlee:", err.message);
  } finally {
    await queue.drop().catch(() => {});
  }

  console.log(`\n[KY COMMISSIONERS] Finalizado. Guardadas/Actualizadas en total: ${totalSaved} subastas de Kentucky.`);
}

function reSplitVs(text: string): string[] {
  const parts = text.split(/\s+vs\.?\s+/i);
  return parts;
}

// Ejecutar si se corre directamente
if (require.main === module) {
  scrapeKYCommissioners().catch(console.error);
}
