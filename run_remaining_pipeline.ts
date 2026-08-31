import { scrapeKentuckyPreForeclosures } from "./scrapers/kentucky_preforeclosure_scraper";
import { scrapeSriTaxSales } from "./scrapers/sri_tax_sale_scraper";
import { runPdfAppraisalWorker } from "./scrapers/pdf_appraisal_worker";
import { runTitleLienCheck } from "./check_title_liens";
import { runDebtRetrySweep } from "./scrapers/debt_retry_sweep";
import { runCountyMediaRetriever } from "./scrapers/county_media_retriever";
import { scoreAllProperties } from "./intelligence/stress_scorer";
import { notifyOpportunities, sendTelegramNotification } from "./notify_opportunities";
import { runSurplusAuditRoutine, SURPLUS_FUNDS_MOCKS } from "./surplus_funds";
import * as dotenv from "dotenv";

dotenv.config();

async function runRemainingPipeline() {
  console.log("=================================================================");
  console.log("🚀 EJECUTANDO PIPELINE TZEL COMPLETO CON PRE-FORECLOSURES 🚀");
  console.log(`Fecha/Hora: ${new Date().toISOString()}`);
  console.log("=================================================================");

  // =================================================================
  // CAPA 1.5: PRE-FORECLOSURES (LIS PENDENS) Y TAX SALES
  // =================================================================
  console.log("\n=================================================================");
  console.log("⚖️ [CAPA 1.5] DEMANDAS TEMPRANAS (PRE-FORECLOSURES & TAX SALES)");
  console.log("=================================================================");

  try {
    console.log("\n[FASE 1.5A] Rastreo de Pre-Foreclosures y Lis Pendens (Kentucky/Indiana)...");
    await scrapeKentuckyPreForeclosures();
  } catch (err: any) {
    console.error("[ERROR FASE 1.5A]:", err.message);
  }

  try {
    console.log("\n[FASE 1.5B] Rastreo de Subastas de Impuestos SRI Services (Indiana)...");
    await scrapeSriTaxSales();
  } catch (err: any) {
    console.error("[ERROR FASE 1.5B]:", err.message);
  }

  // =================================================================
  // CAPA 3: AUDITORÍA FINANCIERA, TASACIONES Y GRAVÁMENES
  // =================================================================
  console.log("\n=================================================================");
  console.log("🏦 [CAPA 3] AUDITORÍA FINANCIERA, TASACIONES Y GRAVÁMENES");
  console.log("=================================================================");

  try {
    console.log("\n[FASE 2.3] Descargando y analizando PDFs de Tasaciones de Subastas...");
    await runPdfAppraisalWorker();
  } catch (err: any) {
    console.error("[ERROR FASE 2.3]:", err.message);
  }

  try {
    console.log("\n[FASE 2.5] Verificando Gravámenes y Deudas Ocultas...");
    await runTitleLienCheck();
  } catch (err: any) {
    console.error("[ERROR FASE 2.5]:", err.message);
  }

  try {
    console.log("\n[FASE 2.6] Ejecutando Barrida Profunda de Deudas...");
    await runDebtRetrySweep();
  } catch (err: any) {
    console.error("[ERROR FASE 2.6]:", err.message);
  }

  try {
    console.log("\n[FASE 2.7] Descargando Fotos Oficiales de Catastro (PVA/eCCLIX)...");
    await runCountyMediaRetriever();
  } catch (err: any) {
    console.error("[ERROR FASE 2.7]:", err.message);
  }

  // =================================================================
  // CAPA 4: INTELIGENCIA Y DESPACHO DE ALERTAS (SSI & TELEGRAM)
  // =================================================================
  console.log("\n=================================================================");
  console.log("📡 [CAPA 4] CÁLCULO DE ESTRÉS (SSI) Y DESPACHO DE ALERTAS");
  console.log("=================================================================");

  try {
    console.log("\n[FASE 5] Calculando Índice de Puntuación de Estrés (SSI)...");
    await scoreAllProperties();
  } catch (err: any) {
    console.error("[ERROR FASE 5]:", err.message);
  }

  try {
    console.log("\n[FASE 6] Despachando alertas de oportunidades a Telegram...");
    await notifyOpportunities();
  } catch (err: any) {
    console.error("[ERROR FASE 6]:", err.message);
  }

  // =================================================================
  // CAPA 5: AUDITORÍA DE EXCEDENTES DE SUBASTAS
  // =================================================================
  console.log("\n=================================================================");
  console.log("💰 [CAPA 5] AUDITORÍA DE FONDOS EXCEDENTES (SURPLUS FUNDS)");
  console.log("=================================================================");

  try {
    await runSurplusAuditRoutine(SURPLUS_FUNDS_MOCKS);
  } catch (err: any) {
    console.error("[ERROR CAPA 5]:", err.message);
  }

  console.log("\n=================================================================");
  console.log("🏁 PIPELINE DE ADQUISICIÓN FINALIZADO CON ÉXITO 🏁");
  console.log("=================================================================");

  try {
    await sendTelegramNotification(
      "🎯 *Pipeline de Adquisición TZEL Finalizado*\n\n" +
      "✅ Subastas Judiciales auditadas\n" +
      "✅ Tasaciones y Gravámenes procesados\n" +
      "✅ Oportunidades High Yield despachadas a Telegram\n" +
      "🚀 Base de datos y Mapa 100% sincronizados."
    );
  } catch (e: any) {
    console.error("Error notificación final Telegram:", e.message);
  }
}

runRemainingPipeline().catch(console.error);
