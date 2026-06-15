import axios from "axios";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(stealthPlugin());

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

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

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
  });
  const page = await context.newPage();

  let totalSecondaryDebt = 0;

  try {
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
    await browser.close();
  }

  return totalSecondaryDebt;
}

/**
 * Función principal del módulo para auditar deudas en todas las propiedades con alta rentabilidad.
 */
export async function runTitleLienCheck() {
  console.log("[INICIO] Iniciando Módulo de Verificación de Títulos y Deudas Ocultas (Doble Validación)...");

  // 1. Consultar subastas de alta rentabilidad
  let auctions;
  try {
    const res = await db.execute("SELECT auction_id, address, county, state, defendant FROM foreclosure_auctions WHERE is_high_yield = 1");
    auctions = res.rows;
  } catch (err: any) {
    console.error("[DB ERROR] No se pudieron consultar las subastas judiciales:", err.message);
    throw err;
  }

  // 2. Consultar violaciones de código de alta rentabilidad
  let violations;
  try {
    const res = await db.execute("SELECT violation_id, address, owner_name FROM code_violations WHERE is_high_yield = 1");
    violations = res.rows;
  } catch (err: any) {
    console.error("[DB ERROR] No se pudieron consultar las violaciones de código:", err.message);
    throw err;
  }

  console.log(`[TITLE LIENS] Oportunidades encontradas para verificar: Subastas: ${auctions.length}, Violaciones: ${violations.length}`);

  // Procesar subastas
  for (const row of auctions) {
    const auctionId = row.auction_id as string;
    const address = row.address as string;
    const county = row.county as string || "Jefferson";
    const state = row.state as string || "KY";
    const ownerName = row.defendant as string || "Unknown";

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
  }

  // Procesar violaciones de código
  for (const row of violations) {
    const violationId = row.violation_id as string;
    const address = row.address as string;
    const ownerName = row.owner_name as string || "DUEÑO DESCONOCIDO";

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
  }

  console.log("\n[FIN] Módulo de Verificación de Títulos y Deudas Ocultas finalizado con éxito.");
}

if (require.main === module) {
  runTitleLienCheck().catch((err) => {
    console.error("[CHECK_TITLE_LIENS EXIT ERROR]:", err.message);
    process.exit(1);
  });
}
