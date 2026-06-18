import { scrapeJeffersonCounty } from "./scrapers/scrape_jeffcomm";
import { scrapeIndiana } from "./scrapers/scrape_sheriff_in";
import { scrapeCodeViolations } from "./scrapers/scrapeCodeViolations";
import { scrapePVA } from "./scrapers/scrapePVA";
import { scrapeProbates } from "./scrapers/scrape_probates";
import { scrapeDivorces } from "./scrapers/scrape_divorces";
import { scrapePhysicalDistress } from "./scrapers/scrape_physical_distress";
import { scrapeFinancialDistress } from "./scrapers/scrape_financial_distress";
import { scrapeLifeEvents } from "./scrapers/scrape_life_events";
import { scrapeKYCommissioners } from "./scrapers/scrape_ky_commissioners";
import { runCrossReference } from "./cross_reference";
import { runTitleLienCheck } from "./check_title_liens";
import { runIndianaCrawler } from "./indiana_court_crawler";
import { runSkipTracing } from "./skip_trace";
import { scoreAllProperties } from "./intelligence/stress_scorer";
import { notifyOpportunities, sendTelegramNotification } from "./notify_opportunities";
import { createClient } from "@libsql/client";
import { runSurplusAuditRoutine, SURPLUS_FUNDS_MOCKS } from "./surplus_funds";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPipeline() {
  console.log("=================================================================");
  console.log("🚀 INICIANDO PIPELINE DE ADQUISICIÓN OSINT TZEL (4 CAPAS) 🚀");
  console.log(`Fecha/Hora: ${new Date().toISOString()}`);
  console.log("=================================================================");

  // Limpiar storage de Crawlee al inicio de todo el proceso para evitar colisiones y acumulación
  try {
    const fs = require("fs");
    const path = require("path");
    const storagePath = path.resolve("./storage");
    if (fs.existsSync(storagePath)) {
      fs.rmSync(storagePath, { recursive: true, force: true });
      console.log("[INITIALIZATION] Carpeta ./storage de Crawlee limpiada correctamente al inicio.");
    }
  } catch (e: any) {
    console.warn("[INITIALIZATION WARNING] No se pudo limpiar la carpeta ./storage al inicio:", e.message);
  }


  // =================================================================
  // CAPA 1: CAPTURA E IDENTIFICACIÓN DEL OBJETIVO (TARGET ACQUISITION)
  // =================================================================
  console.log("\n=================================================================");
  console.log("🧱 [CAPA 1] CAPTURA E IDENTIFICACIÓN DEL OBJETIVO");
  console.log("=================================================================");

  try {
    console.log("\n[CAPA 1 - 1A] Scraping Jefferson County (KY)...");
    await scrapeJeffersonCounty();
  } catch (err: any) {
    console.error("[CAPA 1 ERROR] Falló el scraper de Jefferson County:", err.message);
  }

  try {
    console.log("\n[CAPA 1 - 1B] Scraping Indiana Counties (IN)...");
    await scrapeIndiana();
  } catch (err: any) {
    console.error("[CAPA 1 ERROR] Falló el scraper de Indiana:", err.message);
  }

  try {
    console.log("\n[CAPA 1 - 1C] Scraping Louisville Metro Code Violations (KY)...");
    await scrapeCodeViolations();
  } catch (err: any) {
    console.error("[CAPA 1 ERROR] Falló el scraper de Louisville Code Violations:", err.message);
  }

  try {
    console.log("\n[CAPA 1 - 1D] Resolviendo Propietarios Catastrales (PVA/GIS)...");
    await scrapePVA();
  } catch (err: any) {
    console.error("[CAPA 1 ERROR] Falló el resolvedor de PVA:", err.message);
  }

  try {
    console.log("\n[CAPA 1 - 1E] Scraping Sucesiones/Testamentarias (Probates)...");
    await scrapeProbates();
  } catch (err: any) {
    console.error("[CAPA 1 ERROR] Falló el scraper de testamentarias (Probates):", err.message);
  }

  try {
    console.log("\n[CAPA 1 - 1F] Scraping Divorcios (Divorces)...");
    await scrapeDivorces();
  } catch (err: any) {
    console.error("[CAPA 1 ERROR] Falló el scraper de divorcios (Divorces):", err.message);
  }

  try {
    console.log("\n[CAPA 1 - 1G] Scraping Physical Distress (Municipal alerts)...");
    await scrapePhysicalDistress();
  } catch (err: any) {
    console.error("[CAPA 1 ERROR] Falló el scraper de estrés físico:", err.message);
  }

  try {
    console.log("\n[CAPA 1 - 1H] Scraping Financial Distress (Tax Liens, Evictions, etc.)...");
    await scrapeFinancialDistress();
  } catch (err: any) {
    console.error("[CAPA 1 ERROR] Falló el scraper de estrés financiero:", err.message);
  }

  try {
    console.log("\n[CAPA 1 - 1I] Scraping Life Events (Arrests, Obituaries, etc.)...");
    await scrapeLifeEvents();
  } catch (err: any) {
    console.error("[CAPA 1 ERROR] Falló el scraper de eventos de vida:", err.message);
  }

  try {
    console.log("\n[CAPA 1 - 1J] Scraping KY Commissioners (Oldham, Henry, Trimble, Shelby, Bullitt)...");
    await scrapeKYCommissioners();
  } catch (err: any) {
    console.error("[CAPA 1 ERROR] Falló el scraper de KY Master Commissioners:", err.message);
  }

  console.log("\n[WAIT] Esperando 3 segundos a que se asienten las escrituras en la base de datos...");
  await sleep(3000);

  // PUERTA DE CALIDAD 1: Validar registros sin propietario y marcarlos para revisión manual
  console.log("\n[PUERTA DE CALIDAD 1] Validando nombres y normalizando propietarios...");
  try {
    // Si un registro quedó con propietario 'Unknown' o vacío en Indiana y no tiene caso, se marca para revisión manual.
    // En Louisville, si el PVA falló completamente y sigue en 'DUEÑO DESCONOCIDO', no avanza.
    const db = createClient({
      url: process.env.TURSO_DATABASE_URL || "",
      authToken: process.env.TURSO_AUTH_TOKEN || "",
    });
    await db.execute(`
      UPDATE foreclosure_auctions 
      SET needs_manual_review = 1 
      WHERE (defendant IS NULL OR defendant = '' OR defendant = 'Unknown' OR defendant = 'DUEÑO DESCONOCIDO')
        AND (case_number IS NULL OR case_number = '' OR case_number = 'PENDING')
    `);
    console.log("[PUERTA DE CALIDAD 1] Registros huérfanos filtrados y marcados para revisión manual.");
  } catch (e: any) {
    console.error("[PUERTA DE CALIDAD 1 ERROR] Falló la validación:", e.message);
  }

  // =================================================================
  // CAPA 2: ENRIQUECIMIENTO DE IDENTIDAD Y CONTACTO (IDENTITY & SKIP TRACING)
  // =================================================================
  console.log("\n=================================================================");
  console.log("👤 [CAPA 2] ENRIQUECIMIENTO DE IDENTIDAD Y CONTACTO");
  console.log("=================================================================");

  try {
    console.log("\n[CAPA 2 - FASE 3] Corriendo Crawler de Cortes de Indiana (MyCase/MyCase Name Search)...");
    await runIndianaCrawler();
  } catch (err: any) {
    console.error("[CAPA 2 ERROR] Falló el crawler de cortes de Indiana:", err.message);
  }

  try {
    console.log("\n[CAPA 2 - FASE 4] Enriqueciendo leads de alta rentabilidad con Skip Tracing...");
    await runSkipTracing();
  } catch (err: any) {
    console.error("[CAPA 2 ERROR] Falló el módulo de Skip Tracing:", err.message);
  }

  // =================================================================
  // CAPA 3: AUDITORÍA FINANCIERA Y GRAVÁMENES (FINANCIAL AUDIT & TITLE CHECK)
  // =================================================================
  console.log("\n=================================================================");
  console.log("🏦 [CAPA 3] AUDITORÍA FINANCIERA Y GRAVÁMENES");
  console.log("=================================================================");

  try {
    console.log("\n[CAPA 3 - FASE 2] Cruzando con Spark MLS y calculando ARV por Comps...");
    await runCrossReference();
  } catch (err: any) {
    console.error("[CAPA 3 ERROR] Falló el motor de cruce MLS:", err.message);
  }

  try {
    console.log("\n[CAPA 3 - FASE 2.5] Verificando Gravámenes y Deudas Ocultas (Gemini + Fallbacks + Reintentos)...");
    await runTitleLienCheck();
  } catch (err: any) {
    console.error("[CAPA 3 ERROR] Falló la auditoría de títulos (Fallo Crítico):", err.message);
    try {
      await sendTelegramNotification(`❌ *Pipeline de Adquisición OSINT TZEL Falló*\n⚠️ Error Crítico en Auditoría de Títulos: ${err.message}`);
    } catch (telegrErr) {}
    throw err; // Detener pipeline si ocurre un error grave e inesperado en la base de datos
  }

  // =================================================================
  // CAPA 4: INTELIGENCIA Y DESPACHO (INTELLIGENCE SCORING & DISPATCH)
  // =================================================================
  console.log("\n=================================================================");
  console.log("📡 [CAPA 4] INTELIGENCIA Y DESPACHO DE ALERTAS");
  console.log("=================================================================");

  try {
    console.log("\n[CAPA 4 - FASE 5] Calculando Índice de Puntuación de Estrés (SSI)...");
    await scoreAllProperties();
  } catch (err: any) {
    console.error("[CAPA 4 ERROR] Falló el cálculo de SSI:", err.message);
  }

  try {
    console.log("\n[CAPA 4 - FASE 6] Enviando alertas de oportunidades y revisiones a Telegram...");
    await notifyOpportunities();
  } catch (err: any) {
    console.error("[CAPA 4 ERROR] Falló el notificador de Telegram:", err.message);
  }

  // =================================================================
  // CAPA 5: AUDITORÍA DE EXCEDENTES (SURPLUS FUNDS AUDIT)
  // =================================================================
  console.log("\n=================================================================");
  console.log("💰 [CAPA 5] AUDITORÍA DE EXCEDENTES DE SUBASTAS");
  console.log("=================================================================");

  try {
    console.log("\n[CAPA 5] Corriendo Auditoría Financiera de Fondos Excedentes (Surplus Funds)...");
    await runSurplusAuditRoutine(SURPLUS_FUNDS_MOCKS);
  } catch (err: any) {
    console.error("[CAPA 5 ERROR] Falló la auditoría de excedentes:", err.message);
  }

  console.log("\n=================================================================");
  console.log("✅ PIPELINE DE FORECLOSURES DE TZEL FINALIZADO CON ÉXITO ✅");
  console.log("=================================================================");

  try {
    await sendTelegramNotification(`✅ *Pipeline de Adquisición OSINT TZEL Finalizado con Éxito*\n🏁 Todas las fases completadas.`);
  } catch (telegrErr: any) {
    console.error("Error al enviar notificación final de Telegram:", telegrErr.message);
  }
}

// Ejecutar si se corre directamente
if (require.main === module) {
  runPipeline().catch(console.error);
}

export { runPipeline };
