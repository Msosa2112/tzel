import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import { enforceFlareSolverrBypass } from "./proxy_helper";
import { CRITICAL_INSTRUMENTS, isDischargeInstrument } from "./instrument_filters";
import { DEEDS_SIMULATED_RECORDS } from "./mocks";

const { EXECUTION_ZONE, FINANCIAL_DISTRESS, PHYSICAL_DISTRESS, PROBATE, RELEASES } = CRITICAL_INSTRUMENTS;

chromium.use(stealthPlugin());
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

// Mocks movidos a scrapers/mocks.ts

function formatNameForJeffersonDeeds(ownerName: string): string {
  let name = ownerName.trim().toUpperCase();
  
  // 1. Quitar ', ET AL.', 'ET AL.', ', ET AL', etc.
  name = name.replace(/,?\s+ET\s+AL\.?/gi, "");
  
  // 2. Si es una entidad corporativa, no reordenar
  const corpIndicators = ["LLC", "INC", "CORP", "BANK", "TRUST", " CO ", "COMPANY", "LTD", "ASSOCIATION", "ASSOCIATES", "BOARD", "CABINET", "AUTHORITY"];
  const isCorp = corpIndicators.some(ind => name.includes(ind));
  if (isCorp) {
    return name.replace(/[^A-Z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  }

  // 3. Quitar sufijos comunes
  const suffixes = ["JR.", "JR", "SR.", "SR", "II", "III", "IV", "V"];
  let words = name.split(/[\s,]+/).filter(w => w.length > 0);
  words = words.filter(w => !suffixes.includes(w));

  if (words.length <= 1) {
    return name.replace(/[^A-Z\s]/g, "").replace(/\s+/g, " ").trim();
  }

  const lastName = words[words.length - 1];
  const firstNames = words.slice(0, words.length - 1).join(" ");
  return `${lastName} ${firstNames}`.replace(/[^A-Z\s]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Consulta y extrae escrituras e hipotecas de search.jeffersondeeds.com
 */
async function auditJeffersonDeeds(address: string, ownerName: string, context: any, page: any): Promise<any | null> {
  const url = "https://search.jeffersondeeds.com/name.php";
  try {
    console.log(`[DEEDS JEFFERSON] Iniciando consulta real para: Address="${address}" | Propietario="${ownerName}"`);
    await enforceFlareSolverrBypass(context, url);
    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });

    // 1. Ingresar el nombre del propietario formateado en "Apellido Nombre"
    const cleanOwnerName = formatNameForJeffersonDeeds(ownerName);
    if (!cleanOwnerName || cleanOwnerName.length < 3) {
      console.log(`  [DEEDS JEFFERSON] Nombre de propietario muy corto o inválido: "${ownerName}". Saltando.`);
      return null;
    }

    console.log(`  [DEEDS JEFFERSON] Escribiendo nombre en el buscador: "${cleanOwnerName}"`);
    await page.waitForSelector("input#namesearch", { timeout: 8000 });
    await page.fill("input#namesearch", cleanOwnerName);
    
    // Click en Execute Search
    await page.click('input[value="Execute Search"]');
    await page.waitForNavigation({ waitUntil: "networkidle", timeout: 10000 }).catch(() => null);

    // 2. Manejar la lista de nombres coincidentes (si existe)
    const viewNamesBtn = await page.$('input[value="View Names"]');
    if (viewNamesBtn) {
      console.log("  [DEEDS JEFFERSON] Seleccionando nombres coincidentes...");
      const checkbox = await page.$('input[type="checkbox"]');
      if (checkbox) {
        await checkbox.check();
      }
      await viewNamesBtn.click();
      await page.waitForNavigation({ waitUntil: "networkidle", timeout: 10000 }).catch(() => null);
    }

    // 3. Obtener la lista de documentos en la página de resultados
    const detailLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href^="pdetail.php"]'));
      return links.map((a: any) => a.href);
    });

    console.log(`  [DEEDS JEFFERSON] Encontrados ${detailLinks.length} enlaces de documentos para analizar.`);

    let hiddenMortgages = 0;
    let hiddenLiens = 0;
    let detailsList: any[] = [];

    // Parsear dirección objetivo para verificación cruzada
    const { houseNumber, coreWords } = parseAddress(address);
    
    // Iterar sobre los primeros 5 documentos para evitar lentitud
    const maxDocsToAnalyze = Math.min(detailLinks.length, 5);
    for (let i = 0; i < maxDocsToAnalyze; i++) {
      const detailUrl = detailLinks[i];
      console.log(`  [DEEDS JEFFERSON] Analizando documento ${i + 1}/${maxDocsToAnalyze}: ${detailUrl}`);
      
      const docPage = await context.newPage();
      try {
        await docPage.goto(detailUrl, { waitUntil: "networkidle", timeout: 15000 });
        
        // Extraer campos del formulario del detalle
        const docInfo = await docPage.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('table tr'));
          let info: { [key: string]: string } = {};
          
          rows.forEach((tr: any) => {
            const cells = tr.querySelectorAll('td');
            if (cells.length >= 2) {
              const label = cells[0].innerText.trim().replace(/:/g, "").toUpperCase();
              const val = cells[1].innerText.trim();
              if (label) {
                info[label] = val;
              }
            }
          });

          // Extraer de textareas
          const grantorsText = (document.querySelector('textarea[name="GRANTORS"]') as any)?.value || "";
          const granteesText = (document.querySelector('textarea[name="GRANTEES"]') as any)?.value || "";
          const legalDesc = (document.querySelector('textarea[name="LEGAL"]') as any)?.value || "";
          const docType = (document.querySelector('input[name="insttype"]') as any)?.value || 
                          (document.querySelector('input[name="type"]') as any)?.value || "";

          return {
            info,
            grantorsText,
            granteesText,
            legalDesc,
            docType
          };
        });

        // Verificar si este documento pertenece a la propiedad objetivo
        const legalLower = docInfo.legalDesc.toLowerCase();
        let addressMatch = false;
        
        if (houseNumber && legalLower.includes(houseNumber)) {
          if (coreWords.length > 0) {
            addressMatch = coreWords.every((word: string) => legalLower.includes(word));
          } else {
            addressMatch = true;
          }
        }

        if (!addressMatch) {
          console.log(`    [DEEDS JEFFERSON] El documento no coincide con la dirección objetivo ("${address}"). Omitiendo.`);
          await docPage.close();
          continue;
        }

        console.log(`    [DEEDS JEFFERSON MATCH] El documento pertenece a la propiedad: "${address}"!`);

        // Analizar tipo de documento y monto
        const docTypeUpper = (docInfo.docType || docInfo.info["TYPE"] || docInfo.info["DOCUMENT TYPE"] || "").toUpperCase();
        const amtStr = docInfo.info["AMOUNT"] || docInfo.info["DEBT AMOUNT"] || "0";
        const amt = parseFloat(amtStr.replace(/[^0-9.]/g, "")) || 0;

        console.log(`    [DEEDS JEFFERSON] Tipo: ${docTypeUpper} | Monto: $${amt}`);

        const docTypeUpperTrimmed = docTypeUpper.trim();
        const inExecution = EXECUTION_ZONE.includes(docTypeUpperTrimmed);
        const inFinancial = FINANCIAL_DISTRESS.includes(docTypeUpperTrimmed);
        const inPhysical = PHYSICAL_DISTRESS.includes(docTypeUpperTrimmed);
        const inProbate = PROBATE.includes(docTypeUpperTrimmed);
        const inReleases = RELEASES.includes(docTypeUpperTrimmed);

        if (inExecution || inFinancial || inPhysical || inProbate || inReleases) {
          if (inFinancial && (docTypeUpperTrimmed.includes("MORTGAGE") || docTypeUpperTrimmed.includes("MTG"))) {
            const crossRefText = await docPage.evaluate(() => document.body.innerText.toUpperCase());
            const isReleased = crossRefText.includes("RELEASE") || crossRefText.includes("REL OF");
            
            if (!isReleased) {
              hiddenMortgages += amt;
              console.log(`    [DEEDS JEFFERSON] Hipoteca abierta detectada: $${amt}`);
            } else {
              console.log(`    [DEEDS JEFFERSON] Hipoteca ya liberada en registros.`);
            }
          } 
          else if (inFinancial || inPhysical) {
            hiddenLiens += amt;
            console.log(`    [DEEDS JEFFERSON] Gravamen activo detectado (${docTypeUpperTrimmed}): $${amt}`);
          }

          detailsList.push({
            docType: docTypeUpperTrimmed,
            amount: amt,
            fileDate: docInfo.info["FILE DATE"] || docInfo.info["DATE"] || "",
            grantor: docInfo.grantorsText,
            grantee: docInfo.granteesText
          });
        } else {
          console.log(`    [DEEDS JEFFERSON] Tipo de documento "${docTypeUpperTrimmed}" no está en los instrumentos críticos. Ignorando.`);
        }

      } catch (e: any) {
        console.warn(`    [DEEDS JEFFERSON] Error al parsear detalle de documento:`, e.message);
      } finally {
        await docPage.close();
      }
    }

    return {
      hiddenMortgages,
      hiddenLiens,
      detailsList
    };

  } catch (err: any) {
    console.warn(`[DEEDS JEFFERSON WARNING] Falló la automatización de Jefferson deeds: ${err.message}`);
  }
  return null;
}

/**
 * Consulta y extrae gravámenes en la plataforma eCCLIX para Oldham, Bullitt y Shelby
 */
async function auditEcclix(county: string, ownerName: string, context: any, page: any): Promise<any | null> {
  const url = "https://www.ecclix.com/ecclix/login.aspx";
  const user = process.env.ECCLIX_USER;
  const pass = process.env.ECCLIX_PASS;
  
  if (!user || !pass) {
    console.log(`[ECCLIX SKIP] Credenciales ECCLIX_USER o ECCLIX_PASS faltantes en el archivo .env. Usando fallbacks.`);
    return null;
  }

  try {
    console.log(`[DEEDS ECCLIX] Intentando login en eCCLIX para el condado de ${county}...`);
    await enforceFlareSolverrBypass(context, url);
    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
    
    // Lógica automatizada de login eCCLIX
    await page.fill("#txtUsername", user).catch(() => {});
    await page.fill("#txtPassword", pass).catch(() => {});
    await page.click("#btnLogin").catch(() => {});
    
    // Búsqueda por nombre de propietario
  } catch (err: any) {
    console.warn(`[DEEDS ECCLIX WARNING] Falló la automatización de eCCLIX: ${err.message}`);
  }
  return null;
}

/**
 * Consulta y extrae gravámenes en Indiana (Doxpop / Tapestry)
 */
async function auditIndianaDeeds(address: string, county: string, context: any, page: any): Promise<any | null> {
  const url = "https://www.doxpop.com/prod/";
  try {
    console.log(`[DEEDS INDIANA] Conectando a Doxpop para ${county} County...`);
    await enforceFlareSolverrBypass(context, url);
    await page.goto(url, { waitUntil: "networkidle", timeout: 15000 }).catch(() => null);
  } catch (err: any) {
    console.warn(`[DEEDS INDIANA WARNING] Falló la automatización de Doxpop: ${err.message}`);
  }
  return null;
}

/**
 * Función principal del auditor de escrituras
 */
export async function runCountyDeedsAuditor() {
  console.log("=================================================================");
  console.log("🏦 [DEEDS AUDITOR] Iniciando Auditoría de Títulos y Deudas Ocultas");
  console.log("=================================================================");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });
  const page = await context.newPage();

  let auditedCount = 0;

  try {
    // 1. Obtener pre-subastas y subastas para auditar (limitado a 10 por lote)
    const auctionsRes = await db.execute(`
      SELECT auction_id, address, county, state, defendant 
      FROM foreclosure_auctions 
      WHERE title_check_status = 'pending' OR title_check_status IS NULL
      LIMIT 10
    `);
    
    const targetProperties = auctionsRes.rows;
    console.log(`[DEEDS AUDITOR] Encontradas ${targetProperties.length} propiedades pendientes de auditoría.`);

    for (const prop of targetProperties) {
      const auctionId = prop.auction_id as string;
      const address = prop.address as string;
      const county = prop.county as string;
      const state = prop.state as string;
      const ownerName = prop.defendant as string || "";

      console.log(`\n🔍 Auditando: "${address}" (County: ${county}, ${state}) | Propietario: ${ownerName}...`);

      // Ejecutar flujos de scrapers Playwright Turnstile
      let jeffersonData = null;
      if (state === "KY") {
        if (county.toLowerCase().includes("jefferson")) {
          jeffersonData = await auditJeffersonDeeds(address, ownerName, context, page);
        } else {
          await auditEcclix(county, ownerName, context, page);
        }
      } else if (state === "IN") {
        await auditIndianaDeeds(address, county, context, page);
      }

      // 2. Aplicar motor de simulación de registros reales en caso de fallos de red / suscripciones
      let matchedDeed = null;
      
      // Intentar encontrar coincidencia en nuestra base de datos de simulación (solo si USE_MOCKS es true)
      if (process.env.USE_MOCKS === "true") {
        for (const [key, value] of Object.entries(DEEDS_SIMULATED_RECORDS)) {
          if (address.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(address.toLowerCase())) {
            matchedDeed = value;
            console.log(`[DEEDS AUDITOR] Coincidencia de MOCK detectada para: "${address}"`);
            break;
          }
        }
      }

      let hiddenMortgages: number | null = null;
      let hiddenLiens: number | null = null;
      let needsManualReview = 0;
      let titleCheckStatus = 'audited';

      if (jeffersonData) {
        hiddenMortgages = jeffersonData.hiddenMortgages;
        hiddenLiens = jeffersonData.hiddenLiens;
        titleCheckStatus = 'audited';
        needsManualReview = 0;
      } else if (matchedDeed) {
        // Calcular montos de deudas ocultas para las deudas controladas de simulación
        hiddenMortgages = matchedDeed.mortgages.reduce((acc: number, m: any) => acc + (m.released ? 0 : m.amount), 0);
        hiddenLiens = matchedDeed.taxLiens.reduce((acc: number, l: any) => acc + l.amount, 0);

        // Mapear simulados a detailsList para unificar procesamiento
        const simulatedDetails: any[] = [];
        if (matchedDeed.mortgages) {
          for (const m of matchedDeed.mortgages) {
            simulatedDetails.push({
              docType: "MORTGAGE",
              amount: m.amount,
              fileDate: "2023-01-01",
              grantor: ownerName,
              grantee: m.lender
            });
          }
        }
        if (matchedDeed.taxLiens) {
          for (const l of matchedDeed.taxLiens) {
            simulatedDetails.push({
              docType: "DELINQUENT TAX",
              amount: l.amount,
              fileDate: "2023-06-01",
              grantor: ownerName,
              grantee: l.plaintiff
            });
          }
        }
        if (matchedDeed.wills) {
          for (const w of matchedDeed.wills) {
            simulatedDetails.push({
              docType: "WILL",
              amount: 0,
              fileDate: "2024-01-01",
              grantor: w.deceased,
              grantee: w.executor
            });
          }
        }
        if (matchedDeed.releases) {
          for (const r of matchedDeed.releases) {
            simulatedDetails.push({
              docType: r.docType || "RELEASE",
              amount: 0,
              fileDate: r.fileDate || "2025-12-01",
              grantor: r.grantor || ownerName,
              grantee: r.grantee || "DESCONOCIDO"
            });
          }
        }

        jeffersonData = {
          hiddenMortgages,
          hiddenLiens,
          detailsList: simulatedDetails
        };
      } else {
        // ¡IMPORTANTE! Para propiedades reales de producción no inventamos información financiera.
        // Si el scraper web falla o no hay credenciales, se marca para revisión manual del suscriptor.
        console.log(`  [DEEDS AUDITOR] Alerta: No se pudo obtener información real de escrituras para "${address}". Marcando para revisión manual para evitar falsear el lead.`);
        needsManualReview = 1;
        titleCheckStatus = 'failed';
      }

      // 3. Cruzar con releases usando la función 'isDischargeInstrument'
      let isResolved = false;
      if (jeffersonData && jeffersonData.detailsList.length > 0) {
        let latestDebtDate: string | null = null;
        let latestReleaseDate: string | null = null;

        for (const doc of jeffersonData.detailsList) {
          const docTypeUpper = doc.docType.toUpperCase().trim();
          const fileDate = doc.fileDate || "";
          
          const inExecution = EXECUTION_ZONE.includes(docTypeUpper);
          const inFinancial = FINANCIAL_DISTRESS.includes(docTypeUpper);
          const inPhysical = PHYSICAL_DISTRESS.includes(docTypeUpper);
          const inProbate = PROBATE.includes(docTypeUpper);
          const inReleases = RELEASES.includes(docTypeUpper);

          if (inExecution || inFinancial || inPhysical || inProbate) {
            if (!latestDebtDate || isDischargeInstrument(latestDebtDate, fileDate)) {
              latestDebtDate = fileDate;
            }
          } else if (inReleases) {
            if (!latestReleaseDate || isDischargeInstrument(latestReleaseDate, fileDate)) {
              latestReleaseDate = fileDate;
            }
          }
        }

        if (latestDebtDate && latestReleaseDate) {
          if (isDischargeInstrument(latestDebtDate, latestReleaseDate)) {
            isResolved = true;
            console.log(`  [RELEASE DETECTADO] Fecha de liberación ${latestReleaseDate} es posterior a la de la deuda ${latestDebtDate}. El lead se marcará como resuelto/inactivo.`);
          }
        }
      }

      console.log(`  [RESULTADOS AUDITORÍA] Hipotecas Abiertas: ${hiddenMortgages !== null ? '$' + hiddenMortgages : 'DESCONOCIDO'} | Gravámenes: ${hiddenLiens !== null ? '$' + hiddenLiens : 'DESCONOCIDO'} | Liberado/Resuelto: ${isResolved}`);

      // A) Actualizar tabla 'foreclosure_auctions'
      await db.execute({
        sql: `
          UPDATE foreclosure_auctions
          SET hidden_mortgages = ?,
              hidden_liens_amount = ?,
              title_check_status = ?,
              needs_manual_review = CASE WHEN ? = 1 THEN 1 ELSE needs_manual_review END,
              mls_status = CASE WHEN ? = 1 THEN 'resolved' ELSE mls_status END,
              status = CASE WHEN ? = 1 THEN 'inactive' ELSE status END
          WHERE auction_id = ?
        `,
        args: [
          hiddenMortgages,
          hiddenLiens,
          titleCheckStatus,
          needsManualReview,
          isResolved ? 1 : 0,
          isResolved ? 1 : 0,
          auctionId
        ]
      });

      // B) Registrar gravámenes de impuestos en 'financial_distress' utilizando búsquedas exactas críticas
      if (jeffersonData && jeffersonData.detailsList.length > 0) {
        for (let i = 0; i < jeffersonData.detailsList.length; i++) {
          const item = jeffersonData.detailsList[i];
          const docTypeUpper = item.docType.toUpperCase().trim();
          
          const inExecution = EXECUTION_ZONE.includes(docTypeUpper);
          const inFinancial = FINANCIAL_DISTRESS.includes(docTypeUpper);
          const inPhysical = PHYSICAL_DISTRESS.includes(docTypeUpper);
          const inProbate = PROBATE.includes(docTypeUpper);

          if (inExecution || inFinancial || inPhysical || inProbate) {
            let recordType = 'Tax Lien';
            if (inExecution) recordType = 'Pre-Foreclosure';
            else if (inFinancial) {
              if (docTypeUpper.includes("MORTGAGE") || docTypeUpper.includes("MTG")) recordType = 'Mortgage';
              else recordType = 'Tax Lien';
            }
            else if (inPhysical) recordType = 'Physical Distress';
            else if (inProbate) recordType = 'Probate';

            const recordId = `FD_DEED_${auctionId.replace(/[^a-zA-Z0-9]/g, "")}_${i}`;
            await db.execute({
              sql: `
                INSERT INTO financial_distress (
                  record_id, case_number, address, county, state, record_type,
                  debt_amount, owner_name, plaintiff, report_date, mls_status, created_at
                ) VALUES (?, 'DEED-CHECK', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'pending_check', CURRENT_TIMESTAMP)
                ON CONFLICT(record_id) DO UPDATE SET
                  debt_amount = excluded.debt_amount,
                  plaintiff = excluded.plaintiff
              `,
              args: [
                recordId,
                address,
                county,
                state,
                recordType,
                item.amount,
                ownerName || "DUEÑO DESCONOCIDO",
                item.grantee || "DESCONOCIDO"
              ]
            });
          }
        }
      }

      auditedCount++;
    }

  } catch (err: any) {
    console.error("[DEEDS AUDITOR ERROR] Falló la auditoría general de títulos:", err.message);
  } finally {
    await browser.close();
  }

  console.log(`\n=================================================================`);
  console.log(`✅ [DEEDS AUDITOR] Finalizado con éxito. Propiedades auditadas: ${auditedCount}`);
  console.log(`=================================================================\n`);
}

if (require.main === module) {
  runCountyDeedsAuditor().catch(console.error);
}
