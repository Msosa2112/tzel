import { scrapeJeffersonCounty } from "../scrapers/scrape_jeffcomm";
import { scrapeIndiana } from "../scrapers/scrape_sheriff_in";
import { scrapeKYCommissioners } from "../scrapers/scrape_ky_commissioners";
import { scrapeStatePublicNotices } from "../scrapers/state_public_notices_scraper";
import { scrapeKentuckyPreForeclosures } from "../scrapers/kentucky_preforeclosure_scraper";
import { scrapeIndianaPreForeclosures } from "../scrapers/indiana_preforeclosure_scraper";
import { scrapeSriTaxSales } from "../scrapers/sri_tax_sale_scraper";
import { scrapePVA } from "../scrapers/scrapePVA";
import { runCrossReference } from "../cross_reference";
import { runPdfAppraisalWorker } from "../scrapers/pdf_appraisal_worker";
import { runTitleLienCheck } from "../check_title_liens";
import { runDebtRetrySweep } from "../scrapers/debt_retry_sweep";
import { scoreAllProperties } from "../intelligence/stress_scorer";
import { notifyOpportunities } from "../notify_opportunities";
import { db } from "../db";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runRealEstatePipelineManual() {
  console.log("=================================================================");
  console.log("🏡 [TZEL] PIPELINE EXCLUSIVO DE REAL ESTATE (FORECLOSURES & PRE-FORECLOSURES)");
  console.log("📌 REGLAS ACTIVAS:");
  console.log("   - CERO BATCHDATA (Sin consumo de créditos)");
  console.log("   - TECHO MÁXIMO DE VALOR: $350,000 USD");
  console.log("   - CERO DAÑO FÍSICO / INFRACCIONES DE CÓDIGO");
  console.log("   - FOCO: Subastas Judiciales, Lis Pendens y Tax Sales");
  console.log(`   - Fecha de Ejecución: ${new Date().toISOString()}`);
  console.log("=================================================================\n");

  // 0. Limpieza preventiva del storage de Crawlee
  try {
    const storagePath = path.resolve("./storage");
    if (fs.existsSync(storagePath)) {
      fs.rmSync(storagePath, { recursive: true, force: true });
      console.log("[INIT] Cache de Crawlee (storage) limpiado correctamente.");
    }
  } catch (e: any) {
    console.warn("[INIT WARN] No se pudo limpiar storage:", e.message);
  }

  // =================================================================
  // BLOQUE 1: SUBASTAS JUDICIALES ACTIVAS (FORECLOSURES)
  // =================================================================
  console.log("\n=================================================================");
  console.log("🔨 [BLOQUE 1] SUBASTAS JUDICIALES EN CURSO (FORECLOSURES)");
  console.log("=================================================================");

  // 1A. Jefferson County, KY (JCCO)
  try {
    console.log("\n[1A] Extrayendo subastas judiciales de Jefferson County, KY...");
    await scrapeJeffersonCounty();
  } catch (err: any) {
    console.error("[ERROR 1A JCCO]:", err.message);
  }

  // 1B. Indiana Sheriff Sales (Clark, Floyd, Harrison, Scott, Washington)
  try {
    console.log("\n[1B] Extrayendo subastas de Sheriff en Indiana...");
    await scrapeIndiana();
  } catch (err: any) {
    console.error("[ERROR 1B Indiana Sheriff]:", err.message);
  }

  // 1C. Kentucky Outer Counties Master Commissioners (Oldham, Bullitt, Shelby, Spencer, Nelson)
  try {
    console.log("\n[1C] Extrayendo subastas de Master Commissioners en condados de KY...");
    await scrapeKYCommissioners();
  } catch (err: any) {
    console.error("[ERROR 1C KY Commissioners]:", err.message);
  }

  // =================================================================
  // BLOQUE 2: DEMANDAS TEMPRANAS Y PRE-SUBASTAS (PRE-FORECLOSURES)
  // =================================================================
  console.log("\n=================================================================");
  console.log("⚖️ [BLOQUE 2] DEMANDAS TEMPRANAS, LIS PENDENS Y TAX SALES (PRE-FORECLOSURES)");
  console.log("=================================================================");

  // 2A. Edictos y Public Notices Estatales (KY e IN)
  try {
    console.log("\n[2A] Extrayendo edictos y citaciones de pre-ejecución (State Public Notices)...");
    await scrapeStatePublicNotices();
  } catch (err: any) {
    console.error("[ERROR 2A Public Notices]:", err.message);
  }

  // 2B. Pre-Foreclosures Kentucky (Demandas radicadas sin subasta fijada)
  try {
    console.log("\n[2B] Extrayendo demandas de ejecución en Jefferson County (KY)...");
    await scrapeKentuckyPreForeclosures();
  } catch (err: any) {
    console.error("[ERROR 2B KY Pre-Foreclosures]:", err.message);
  }

  // 2C. Pre-Foreclosures Indiana (MyCase Odyssey MF Cases)
  try {
    console.log("\n[2C] Extrayendo demandas tempranas en Indiana...");
    await scrapeIndianaPreForeclosures();
  } catch (err: any) {
    console.error("[ERROR 2C IN Pre-Foreclosures]:", err.message);
  }

  // 2D. SRI Services Tax Sales (Subastas por Impuestos en Indiana)
  try {
    console.log("\n[2D] Extrayendo propiedades en subasta fiscal (SRI Tax Sales)...");
    await scrapeSriTaxSales();
  } catch (err: any) {
    console.error("[ERROR 2D SRI Tax Sales]:", err.message);
  }

  // =================================================================
  // BLOQUE 3: ENRIQUECIMIENTO CATASTRAL Y VALORACIÓN (SIN BATCHDATA)
  // =================================================================
  console.log("\n=================================================================");
  console.log("🏛️ [BLOQUE 3] ENRIQUECIMIENTO CATASTRAL Y VALORACIÓN DE MERCADO (PVA & MLS)");
  console.log("=================================================================");

  process.env.SKIP_BATCHDATA = "true";
  process.env.SKIP_TRACE_PROVIDER = "none";

  // 3A. Extracción Catastral Oficial (PVA / LOJIC GIS - Gratis, Solo Subastas)
  try {
    console.log("\n[3A] Cruzando datos catastrales con PVA y GIS oficial (Solo Subastas Judiciales)...");
    await scrapePVA(true);
  } catch (err: any) {
    console.error("[ERROR 3A PVA]:", err.message);
  }

  // 3B. Spark MLS Comps & ARV
  try {
    console.log("\n[3B] Calculando valor de mercado real (ARV) con comparables MLS...");
    await runCrossReference();
  } catch (err: any) {
    console.error("[ERROR 3B MLS Cross-Reference]:", err.message);
  }

  // 3C. Extracción de Avalúos Judiciales de PDFs
  try {
    console.log("\n[3C] Extrayendo tasaciones oficiales desde PDFs judiciales...");
    await runPdfAppraisalWorker();
  } catch (err: any) {
    console.error("[ERROR 3C PDF Appraisals]:", err.message);
  }

  // =================================================================
  // BLOQUE 4: AUDITORÍA DE TÍTULO Y DEUDAS JUDICIALES
  // =================================================================
  console.log("\n=================================================================");
  console.log("🏦 [BLOQUE 4] AUDITORÍA DE DEUDAS, HIPOTECAS Y GRAVÁMENES");
  console.log("=================================================================");

  try {
    console.log("\n[4A] Verificando gravámenes, hipotecas y montos de juicio (Solo Subastas)...");
    await runTitleLienCheck(true);
  } catch (err: any) {
    console.error("[ERROR 4A Title Liens]:", err.message);
  }

  try {
    console.log("\n[4B] Ejecutando barrida profunda de deudas no resueltas...");
    await runDebtRetrySweep();
  } catch (err: any) {
    console.error("[ERROR 4B Debt Sweep]:", err.message);
  }

  // =================================================================
  // BLOQUE 5: PUNTUACIÓN DE OPORTUNIDADES Y DESPACHO SELECTIVO
  // =================================================================
  console.log("\n=================================================================");
  console.log("📊 [BLOQUE 5] CALIFICACIÓN DE ESTRÉS Y CONTROL DE CALIDAD");
  console.log("=================================================================");

  try {
    console.log("\n[5A] Calculando índice de estrés (SSI)...");
    await scoreAllProperties();
  } catch (err: any) {
    console.error("[ERROR 5A Scoring]:", err.message);
  }

  try {
    console.log("\n[5B] Despachando notificaciones legales filtradas a Telegram (solo <= $350k y con equidad positiva)...");
    await notifyOpportunities('legal');
  } catch (err: any) {
    console.error("[ERROR 5B Telegram]:", err.message);
  }

  // =================================================================
  // REPORTE CONSOLIDADO EN TERMINAL
  // =================================================================
  console.log("\n=================================================================");
  console.log("📈 REPORTE CONSOLIDADO DE OPORTUNIDADES REAL ESTATE (<= $350k)");
  console.log("=================================================================");

  try {
    const auctions = await db.execute(`
      SELECT 
        auction_id, case_number, address, county, state, auction_date,
        defendant, plaintiff, debt_amount, appraisal_value, mls_estimated_value,
        is_high_yield
      FROM foreclosure_auctions
      ORDER BY created_at DESC
      LIMIT 100
    `);

    let qualifiedCount = 0;
    let over350kCount = 0;
    let underwaterCount = 0;

    console.log("\n🎯 PROPIEDADES EN REGLA DE OPORTUNIDAD (VALOR <= $350K Y CON EQUIDAD POSITIVA):");
    console.log("------------------------------------------------------------------");

    for (const row of auctions.rows) {
      const rawAppraisal = (row.appraisal_value as number) || 0;
      const mlsVal = (row.mls_estimated_value as number) || 0;
      const debt = (row.debt_amount as number) || 0;

      // Effective Market Value
      let effectiveVal = rawAppraisal;
      if (mlsVal > 0 && (rawAppraisal <= 0 || rawAppraisal < 35000 || rawAppraisal < mlsVal * 0.35)) {
        effectiveVal = mlsVal;
      } else if (effectiveVal <= 0) {
        effectiveVal = mlsVal;
      }

      if (effectiveVal > 350000) {
        over350kCount++;
        continue;
      }

      const spread = effectiveVal > 0 ? (effectiveVal - debt) : 0;
      if (spread <= 0 && debt > 0) {
        underwaterCount++;
        continue;
      }

      if (effectiveVal > 0 && spread >= 20000) {
        qualifiedCount++;
        console.log(`  🏠 [${row.state}] ${row.address} (${row.county} County)`);
        console.log(`     • Caso: ${row.case_number} | Demandado: ${row.defendant || 'N/A'}`);
        console.log(`     • Subasta: ${row.auction_date || 'Por fijar'} | Deuda: $${debt.toLocaleString()} | Valor Real: $${effectiveVal.toLocaleString()}`);
        console.log(`     • 💰 Margen Estimado (Spread): $${spread.toLocaleString()}`);
        console.log("------------------------------------------------------------------");
      }
    }

    console.log(`\n📊 ESTADÍSTICAS DEL BARRIDO REAL ESTATE:`);
    console.log(`   - Oportunidades viables (Spread >= $20k y <= $350k): ${qualifiedCount}`);
    console.log(`   - Propiedades descartadas por superar $350,000 USD: ${over350kCount}`);
    console.log(`   - Propiedades descartadas por estar bajo el agua (deuda > valor): ${underwaterCount}`);

    // Muestra de Pre-foreclosures
    const preForeclosures = await db.execute(`
      SELECT case_number, address, county, state, defendant, days_since_filing, absentee_owner
      FROM pre_foreclosures
      ORDER BY created_at DESC
      LIMIT 10
    `);

    if (preForeclosures.rows.length > 0) {
      console.log(`\n⚖️ PRE-FORECLOSURES REGISTRADOS EN TURSO (${preForeclosures.rows.length} muestras):`);
      for (const pf of preForeclosures.rows) {
        const ownerType = pf.absentee_owner === 1 ? "🏠 (Dueño Ausente)" : "👤 (Dueño Ocupante)";
        console.log(`  • Caso: ${pf.case_number} | ${pf.address} | Dueño: ${pf.defendant} ${ownerType} | Radicado hace ${pf.days_since_filing} días`);
      }
    }

    // Muestra de Tax Sales
    const taxSales = await db.execute(`
      SELECT parcel_id, address, county, state, owner_name, taxes_owed
      FROM tax_sales
      ORDER BY created_at DESC
      LIMIT 10
    `);

    if (taxSales.rows.length > 0) {
      console.log(`\n📑 SUBASTAS DE IMPUESTOS FISCALES (TAX SALES - ${taxSales.rows.length} muestras):`);
      for (const ts of taxSales.rows) {
        console.log(`  • Parcela: ${ts.parcel_id} | ${ts.address} (${ts.county}, IN) | Dueño: ${ts.owner_name} | Deuda: $${ts.taxes_owed}`);
      }
    }

  } catch (err: any) {
    console.error("[REPORTE ERROR]:", err.message);
  }

  console.log("\n=================================================================");
  console.log("🏁 PIPELINE MANUAL DE REAL ESTATE FINALIZADO EXITOSAMENTE 🏁");
  console.log("=================================================================");
}

if (require.main === module) {
  runRealEstatePipelineManual().catch(console.error);
}

export { runRealEstatePipelineManual };
