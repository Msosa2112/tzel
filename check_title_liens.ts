import axios from "axios";
import pLimit from "p-limit";
import { db } from "./db";
import { sendTelegramNotification } from "./telegram_helper";
import * as dotenv from "dotenv";
import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import { checkPropertyLiens } from "./scrapers/lien_detector";
import { getPropertyLiensFromAttom } from "./scrapers/attom_client";
import { calculateMAO, calculateRehab } from "./underwriting/underwriter";

chromium.use(stealthPlugin());

dotenv.config();



const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));


/**
 * Consulta la API de Registros Públicos de Spark.
 * Si falla, retorna null para dar paso al fallback.
 */
async function querySparkPublicRecords(address: string, state: string): Promise<number | null> {
  const token = process.env.SPARK_ACCESS_TOKEN_1;
  if (!token) {
    console.log("[SPARK] No se encontró SPARK_ACCESS_TOKEN_1 en el entorno.");
    return null;
  }

  const cleanAddress = address.split(",")[0].trim();
  const url = "https://replication.sparkapi.com/Reso/OData/PublicRecords";

  try {
    console.log(`[SPARK] Consultando PublicRecords para "${cleanAddress}", ${state}...`);
    const response = await axios.get(url, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/json"
      },
      params: {
        "$filter": `contains(UnparsedAddress, '${cleanAddress}') and StateOrProvince eq '${state}'`,
        "$select": "OpenMortgages,TaxLiens,JuniorLiens,TotalHiddenDebt",
        "$top": 1
      },
      timeout: 10000
    });

    if (response.status === 401 || response.status === 403) {
      throw new Error(`Acceso denegado a Spark API: Status ${response.status}`);
    }

    const records = response.data?.value || [];
    if (records.length === 0) {
      console.log(`[SPARK] No se encontraron registros públicos para la propiedad "${address}".`);
      return null;
    }

    const record = records[0];
    const openMortgages = record.OpenMortgages || 0;
    const taxLiens = record.TaxLiens || 0;
    const juniorLiens = record.JuniorLiens || 0;
    const totalHiddenDebt = openMortgages + taxLiens + juniorLiens;

    console.log(`[SPARK SUCCESS] Deuda encontrada para "${address}": Mortgages=$${openMortgages}, Tax=$${taxLiens}, Junior=$${juniorLiens}. Total=$${totalHiddenDebt}`);
    return totalHiddenDebt;
  } catch (err: any) {
    console.log(`[SPARK WARNING] Falló la consulta a Spark PublicRecords: ${err.message}. Pasando a fallback.`);
    return null;
  }
}

/**
 * Realiza un crawler sigiloso simulando una búsqueda de los registros públicos del Secretario del Condado
 * buscando palabras clave y deudas secundarias asociadas al nombre del propietario.
 */
async function scrapeCountyClerk(ownerName: string, county: string, state: string): Promise<number> {
  console.log(`[FALLBACK CLERK] Iniciando búsqueda del Secretario del Condado para: "${ownerName}" en Condado: ${county}, ${state}...`);

  if (!ownerName || ownerName === "No especificado" || ownerName === "DUEÑO DESCONOCIDO" || ownerName === "Unknown") {
    console.log("[FALLBACK CLERK] Nombre de propietario inválido. Saltando búsqueda.");
    return 0;
  }

  let browser;
  let totalSecondaryDebt = 0;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
    });
    const page = await context.newPage();

    const cleanOwner = ownerName.replace(/["']/g, "").trim();
    // Búsqueda de registros públicos del secretario/registrador de ese deudor
    const query = `"${cleanOwner}" ${county} county clerk recorder (Mortgage OR Lien OR Judgment OR Mechanic)`;
    console.log(`[FALLBACK CLERK] Consultando DuckDuckGo Lite: "${query}"`);

    await page.goto(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
      waitUntil: "networkidle",
      timeout: 15000
    });

    const bodyText = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll(".result-snippet, .result-link"));
      return elements.map(el => el.textContent || "").join("\n");
    });
    const lowerBody = bodyText.toLowerCase();

    const redFlags = ["mortgage", "lien", "judgment", "mechanic's lien", "gravamen", "hipoteca", "ejecución"];
    let hasRedFlag = false;

    for (const flag of redFlags) {
      if (lowerBody.includes(flag)) {
        console.log(`[FALLBACK CLERK RED FLAG] Encontrada palabra clave de gravamen: "${flag}"`);
        hasRedFlag = true;
      }
    }

    if (hasRedFlag) {
      // Intentar extraer montos de deuda secundarios (ej. $12,500 o $125000.00)
      const amountRegex = /\$\s*([0-9,]{3,12}(?:\.[0-9]{2})?)/g;
      let match;
      const foundAmounts: number[] = [];

      while ((match = amountRegex.exec(bodyText)) !== null) {
        const amt = parseFloat(match[1].replace(/,/g, ""));
        if (!isNaN(amt) && amt > 0) {
          foundAmounts.push(amt);
        }
      }

      if (foundAmounts.length > 0) {
        const relevantAmounts = foundAmounts.filter(a => a >= 1000 && a <= 250000);
        if (relevantAmounts.length > 0) {
          totalSecondaryDebt = relevantAmounts.reduce((a, b) => a + b, 0);
          console.log(`[FALLBACK CLERK SUCCESS] Deudas secundarias extraídas de registros públicos: $${totalSecondaryDebt.toLocaleString()}`);
        } else {
          totalSecondaryDebt = 0;
          console.log(`[FALLBACK CLERK WARNING] Se detectó gravamen activo pero sin monto visible en rango. Asignando deuda: $0`);
        }
      } else {
        totalSecondaryDebt = 0;
        console.log(`[FALLBACK CLERK WARNING] Se detectó gravamen activo pero sin monto visible. Asignando deuda: $0`);
      }
    } else {
      console.log(`[FALLBACK CLERK CLEAN] No se detectaron alertas de deudas secundarias para "${cleanOwner}".`);
    }

  } catch (err: any) {
    console.error(`[FALLBACK CLERK ERROR] Falló el crawling de registros: ${err.message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  return totalSecondaryDebt;
}



/**
 * Función principal del módulo para auditar deudas en todas las propiedades con alta rentabilidad.
 */
export async function runTitleLienCheck(auctionsOnly: boolean = false) {
  console.log("[INICIO] Iniciando Módulo de Verificación de Títulos y Deudas Ocultas (Doble Validación)...");

  // 1. Consultar subastas de alta rentabilidad
  let auctions;
  try {
    const res = await db.execute("SELECT auction_id, address, county, state, defendant, mls_estimated_value, sqft, hidden_mortgages FROM foreclosure_auctions WHERE title_check_status = 'pending' OR title_check_status IS NULL");
    auctions = res.rows;
  } catch (err: any) {
    console.error("[DB ERROR] No se pudieron consultar las subastas judiciales:", err.message);
    throw err;
  }

  // 2. Consultar violaciones de código de alta rentabilidad
  let violations: any[] = [];
  if (!auctionsOnly) {
    try {
      const res = await db.execute("SELECT violation_id, address, owner_name, mls_estimated_value, sqft, hidden_mortgages FROM code_violations WHERE title_check_status = 'pending' OR title_check_status IS NULL");
      violations = res.rows;
    } catch (err: any) {
      console.error("[DB ERROR] No se pudieron consultar las violaciones de código:", err.message);
      throw err;
    }
  }

  console.log(`[TITLE LIENS] Oportunidades encontradas para verificar: Subastas: ${auctions.length}, Violaciones: ${violations.length}`);

  const limit = pLimit(5);

  // Procesar subastas en paralelo
  await Promise.all(
    auctions.map((row) =>
      limit(async () => {
        const auctionId = row.auction_id as string;
        const address = row.address as string;
        const county = row.county as string || "Jefferson";
        const state = row.state as string || "KY";
        const ownerName = row.defendant as string || "Unknown";
        const arv = row.mls_estimated_value as number || 0;
        const sqft = row.sqft as number || null;
        const hiddenMortgages = row.hidden_mortgages as number || 0;

        console.log(`\n[PROCESANDO] Verificando deudas ocultas para Subasta: ${address} (${ownerName})`);
        
        // Intento Primario: Spark API
        let hiddenDebt = await querySparkPublicRecords(address, state);
        
        // Intento Secundario: County Clerk Crawler
        if (hiddenDebt === null) {
          hiddenDebt = await scrapeCountyClerk(ownerName, county, state);
        }

        try {
          await db.execute({
            sql: "UPDATE foreclosure_auctions SET hidden_mortgages = ? WHERE auction_id = ?",
            args: [hiddenDebt, auctionId]
          });
          console.log(`[SUCCESS] Base de datos actualizada con hidden_mortgages = $${hiddenDebt} para subasta ${auctionId}`);
        } catch (err: any) {
          console.error(`[DB UPDATE ERROR] No se pudo guardar hidden_mortgages para subasta ${auctionId}:`, err.message);
        }

        // --- Módulo de Detección de Hipotecas Ocultas (Premium Attom API first, then Playwright Stealth + Gemini) ---
        try {
          const zipMatch = address.match(/\b\d{5}\b/);
          const zipCode = zipMatch ? zipMatch[0] : "";
          let hiddenLiensAmount = 0;

          const attomResult = await getPropertyLiensFromAttom(address, zipCode);
          if (attomResult.success) {
            hiddenLiensAmount = attomResult.totalHiddenDebt;
          } else {
            console.log(`[FALLBACK] API Attom falló para ${address}, cayendo a Playwright + Gemini...`);
            const lienResult = await checkPropertyLiens(ownerName, address, state, county);
            hiddenLiensAmount = lienResult.totalHiddenDebt;
          }

          await db.execute({
            sql: "UPDATE foreclosure_auctions SET hidden_liens_amount = ?, title_check_status = 'success' WHERE auction_id = ?",
            args: [hiddenLiensAmount, auctionId]
          });
          console.log(`[SUCCESS] Base de datos actualizada con hidden_liens_amount = $${hiddenLiensAmount} para subasta ${auctionId}`);

          if (hiddenLiensAmount > 0) {
            const rehab = calculateRehab(sqft, []);
            const adjustedMao = calculateMAO(arv, rehab, hiddenMortgages, hiddenLiensAmount);

            // Alerta roja brillante en consola
            console.log(`\x1b[1;31m🏦 [ALERTA ROJA] HIPOTECAS OCULTAS DETECTADAS EN ${address}. Deuda extra: $${hiddenLiensAmount}. MAO ajustado a: $${adjustedMao}.\x1b[0m`);

            // Alerta de Telegram
            const tgMsg = `🏦 [ALERTA ROJA] HIPOTECAS OCULTAS DETECTADAS EN ${address}. Deuda extra: $${hiddenLiensAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}. MAO ajustado a: $${adjustedMao.toLocaleString("en-US", { minimumFractionDigits: 2 })}.`;
            await sendTelegramNotification(tgMsg);
          }
        } catch (err: any) {
          console.error(`[LIEN DETECTOR ERROR] Falló el escaneo de gravámenes para subasta ${auctionId}:`, err.message);
          try {
            await db.execute({
              sql: "UPDATE foreclosure_auctions SET title_check_status = 'failed' WHERE auction_id = ?",
              args: [auctionId]
            });
          } catch (dbErr) {}
        }
        await sleep(1500);
      })
    )
  );

  // Procesar violaciones de código en paralelo
  await Promise.all(
    violations.map((row) =>
      limit(async () => {
        const violationId = row.violation_id as string;
        const address = row.address as string;
        const ownerName = row.owner_name as string || "DUEÑO DESCONOCIDO";
        const arv = row.mls_estimated_value as number || 0;
        const sqft = row.sqft as number || null;
        const hiddenMortgages = row.hidden_mortgages as number || 0;

        console.log(`\n[PROCESANDO] Verificando deudas ocultas para Violación de Código: ${address} (${ownerName})`);
        
        // Intento Primario: Spark API (Violaciones están en Louisville, KY)
        let hiddenDebt = await querySparkPublicRecords(address, "KY");
        
        // Intento Secundario: County Clerk Crawler
        if (hiddenDebt === null) {
          hiddenDebt = await scrapeCountyClerk(ownerName, "Jefferson", "KY");
        }

        try {
          await db.execute({
            sql: "UPDATE code_violations SET hidden_mortgages = ? WHERE violation_id = ?",
            args: [hiddenDebt, violationId]
          });
          console.log(`[SUCCESS] Base de datos actualizada con hidden_mortgages = $${hiddenDebt} para violación ${violationId}`);
        } catch (err: any) {
          console.error(`[DB UPDATE ERROR] No se pudo guardar hidden_mortgages para violación ${violationId}:`, err.message);
        }

        // --- Módulo de Detección de Hipotecas Ocultas (Premium Attom API first, then Playwright Stealth + Gemini) ---
        try {
          const zipMatch = address.match(/\b\d{5}\b/);
          const zipCode = zipMatch ? zipMatch[0] : "";
          let hiddenLiensAmount = 0;

          const attomResult = await getPropertyLiensFromAttom(address, zipCode);
          if (attomResult.success) {
            hiddenLiensAmount = attomResult.totalHiddenDebt;
          } else {
            console.log(`[FALLBACK] API Attom falló para ${address}, cayendo a Playwright + Gemini...`);
            const lienResult = await checkPropertyLiens(ownerName, address, "KY", "Jefferson");
            hiddenLiensAmount = lienResult.totalHiddenDebt;
          }

          await db.execute({
            sql: "UPDATE code_violations SET hidden_liens_amount = ?, title_check_status = 'success' WHERE violation_id = ?",
            args: [hiddenLiensAmount, violationId]
          });
          console.log(`[SUCCESS] Base de datos actualizada con hidden_liens_amount = $${hiddenLiensAmount} para violación ${violationId}`);

          if (hiddenLiensAmount > 0) {
            const rehab = calculateRehab(sqft, []);
            const adjustedMao = calculateMAO(arv, rehab, hiddenMortgages, hiddenLiensAmount);

            // Alerta roja brillante en consola
            console.log(`\x1b[1;31m🏦 [ALERTA ROJA] HIPOTECAS OCULTAS DETECTADAS EN ${address}. Deuda extra: $${hiddenLiensAmount}. MAO ajustado a: $${adjustedMao}.\x1b[0m`);

            // Alerta de Telegram
            const tgMsg = `🏦 [ALERTA ROJA] HIPOTECAS OCULTAS DETECTADAS EN ${address}. Deuda extra: $${hiddenLiensAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}. MAO ajustado a: $${adjustedMao.toLocaleString("en-US", { minimumFractionDigits: 2 })}.`;
            await sendTelegramNotification(tgMsg);
          }
        } catch (err: any) {
          console.error(`[LIEN DETECTOR ERROR] Falló el escaneo de gravámenes para violación ${violationId}:`, err.message);
          try {
            await db.execute({
              sql: "UPDATE code_violations SET title_check_status = 'failed' WHERE violation_id = ?",
              args: [violationId]
            });
          } catch (dbErr) {}
        }
        await sleep(1500);
      })
    )
  );

  console.log("\n[FIN] Módulo de Verificación de Títulos y Deudas Ocultas finalizado.");
  
  // Ejecutar bucle de reintentos
  await retryFailedTitleChecks(3, auctionsOnly);
}

/**
 * Reintenta las verificaciones de deudas que fallaron o quedaron pendientes debido a caídas de red o límites de cuota de API.
 */
export async function retryFailedTitleChecks(maxRetries: number = 3, auctionsOnly: boolean = false) {
  const limit = pLimit(5);
  console.log(`\n[REINTENTOS] Iniciando reintentos de auditorías financieras fallidas o pendientes (Max Retries: ${maxRetries})...`);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    // 1. Buscar subastas fallidas
    let auctionsRes;
    try {
      auctionsRes = await db.execute(`
        SELECT auction_id, address, county, state, defendant, mls_estimated_value, sqft, hidden_mortgages 
        FROM foreclosure_auctions 
        WHERE title_check_status = 'failed'
      `);
    } catch (e) { break; }
    const pendingAuctions = auctionsRes.rows;

    // 2. Buscar violaciones fallidas
    let pendingViolations: any[] = [];
    if (!auctionsOnly) {
      try {
        const violationsRes = await db.execute(`
          SELECT violation_id, address, owner_name, mls_estimated_value, sqft, hidden_mortgages 
          FROM code_violations 
          WHERE title_check_status = 'failed'
        `);
        pendingViolations = violationsRes.rows;
      } catch (e) { break; }
    }

    const totalPending = pendingAuctions.length + pendingViolations.length;
    if (totalPending === 0) {
      console.log("[REINTENTOS] ¡Todas las auditorías financieras se completaron con éxito! No hay tareas pendientes.");
      break;
    }

    console.log(`[REINTENTOS] Intento ${attempt}/${maxRetries}: Procesando ${totalPending} auditorías fallidas...`);

    // Esperar un retraso incremental (backoff exponencial): 5s, 10s, 20s...
    const backoffDelay = 5000 * Math.pow(2, attempt - 1);
    console.log(`[REINTENTOS] Esperando retraso de ${backoffDelay / 1000} segundos para el intento ${attempt}...`);
    await sleep(backoffDelay);

    // Procesar subastas pendientes en paralelo
    await Promise.all(
      pendingAuctions.map((row) =>
        limit(async () => {
          const auctionId = row.auction_id as string;
          const address = row.address as string;
          const county = row.county as string || "Jefferson";
          const state = row.state as string || "KY";
          const ownerName = row.defendant as string || "Unknown";
          const arv = row.mls_estimated_value as number || 0;
          const sqft = row.sqft as number || null;
          const hiddenMortgages = row.hidden_mortgages as number || 0;

          console.log(`[REINTENTANDO SUBASTA] ${address} (Intento ${attempt})`);
          try {
            const zipMatch = address.match(/\b\d{5}\b/);
            const zipCode = zipMatch ? zipMatch[0] : "";
            let hiddenLiensAmount = 0;

            const attomResult = await getPropertyLiensFromAttom(address, zipCode);
            if (attomResult.success) {
              hiddenLiensAmount = attomResult.totalHiddenDebt;
            } else {
              console.log(`[FALLBACK] API Attom falló para ${address}, cayendo a Playwright + Gemini...`);
              const lienResult = await checkPropertyLiens(ownerName, address, state, county);
              hiddenLiensAmount = lienResult.totalHiddenDebt;
            }

            await db.execute({
              sql: "UPDATE foreclosure_auctions SET hidden_liens_amount = ?, title_check_status = 'success' WHERE auction_id = ?",
              args: [hiddenLiensAmount, auctionId]
            });
            console.log(`[REINTENTO EXITOSO] Subasta ${auctionId} completada. Deuda: $${hiddenLiensAmount}`);

            if (hiddenLiensAmount > 0) {
              const rehab = calculateRehab(sqft, []);
              const adjustedMao = calculateMAO(arv, rehab, hiddenMortgages, hiddenLiensAmount);
              const tgMsg = `🏦 [ALERTA DE REINTENTO] HIPOTECAS OCULTAS DETECTADAS EN ${address}. Deuda extra: $${hiddenLiensAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}. MAO: $${adjustedMao.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
              await sendTelegramNotification(tgMsg);
            }
          } catch (err: any) {
            console.error(`[REINTENTO FALLIDO] Subasta ${auctionId} falló de nuevo: ${err.message}`);
          }
          await sleep(1500);
        })
      )
    );

    // Procesar violaciones pendientes en paralelo
    await Promise.all(
      pendingViolations.map((row) =>
        limit(async () => {
          const violationId = row.violation_id as string;
          const address = row.address as string;
          const ownerName = row.owner_name as string || "DUEÑO DESCONOCIDO";
          const arv = row.mls_estimated_value as number || 0;
          const sqft = row.sqft as number || null;
          const hiddenMortgages = row.hidden_mortgages as number || 0;

          console.log(`[REINTENTANDO VIOLACIÓN] ${address} (Intento ${attempt})`);
          try {
            const zipMatch = address.match(/\b\d{5}\b/);
            const zipCode = zipMatch ? zipMatch[0] : "";
            let hiddenLiensAmount = 0;

            const attomResult = await getPropertyLiensFromAttom(address, zipCode);
            if (attomResult.success) {
              hiddenLiensAmount = attomResult.totalHiddenDebt;
            } else {
              console.log(`[FALLBACK] API Attom falló para ${address}, cayendo a Playwright + Gemini...`);
              const lienResult = await checkPropertyLiens(ownerName, address, "KY", "Jefferson");
              hiddenLiensAmount = lienResult.totalHiddenDebt;
            }

            await db.execute({
              sql: "UPDATE code_violations SET hidden_liens_amount = ?, title_check_status = 'success' WHERE violation_id = ?",
              args: [hiddenLiensAmount, violationId]
            });
            console.log(`[REINTENTO EXITOSO] Violación ${violationId} completada. Deuda: $${hiddenLiensAmount}`);

            if (hiddenLiensAmount > 0) {
              const rehab = calculateRehab(sqft, []);
              const adjustedMao = calculateMAO(arv, rehab, hiddenMortgages, hiddenLiensAmount);
              const tgMsg = `🏦 [ALERTA DE REINTENTO] HIPOTECAS OCULTAS DETECTADAS EN ${address}. Deuda extra: $${hiddenLiensAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}. MAO: $${adjustedMao.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
              await sendTelegramNotification(tgMsg);
            }
          } catch (err: any) {
            console.error(`[REINTENTO FALLIDO] Violación ${violationId} falló de nuevo: ${err.message}`);
          }
          await sleep(1500);
        })
      )
    );
  }
}

if (require.main === module) {
  runTitleLienCheck().catch((err) => {
    console.error("[CHECK_TITLE_LIENS EXIT ERROR]:", err.message);
    process.exit(1);
  });
}
