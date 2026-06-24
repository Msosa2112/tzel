import { scrapeCodeViolations } from "./scrapers/scrapeCodeViolations";
import { scrapePVA } from "./scrapers/scrapePVA";
import { scrapePhysicalDistress } from "./scrapers/scrape_physical_distress";
import { scrapeDisasterDamage } from "./scrapers/scrape_disaster_damage";
import { scrapeLifeEvents } from "./scrapers/scrape_life_events";
import { runCrossReference } from "./cross_reference";
import { runSkipTracing } from "./skip_trace";
import { scoreAllProperties } from "./intelligence/stress_scorer";
import { notifyOpportunities, sendTelegramNotification } from "./notify_opportunities";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPhysicalPipeline() {
  console.log("=================================================================");
  console.log("🚀 INICIANDO PIPELINE DE ESTRÉS FÍSICO MUNICIPAL TZEL 🚀");
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
  console.log("🧱 [CAPA 1] CAPTURA E IDENTIFICACIÓN DEL OBJETIVO FÍSICO");
  console.log("=================================================================");

  try {
    console.log("\n[CAPA 1 - 1C] Scraping Louisville Metro Code Violations (KY)...");
    await scrapeCodeViolations();
  } catch (err: any) {
    console.error("[CAPA 1 ERROR] Falló el scraper de Louisville Code Violations:", err.message);
  }

  try {
    console.log("\n[CAPA 1 - 1G] Scraping Physical Distress (Municipal alerts)...");
    await scrapePhysicalDistress();
  } catch (err: any) {
    console.error("[CAPA 1 ERROR] Falló el scraper de estrés físico:", err.message);
  }

  try {
    console.log("\n[CAPA 1 - 1H] Scraping Disaster Damage (NOAA/NWS Tornadoes & Storms)...");
    await scrapeDisasterDamage();
  } catch (err: any) {
    console.error("[CAPA 1 ERROR] Falló el scraper de desastres naturales:", err.message);
  }

  try {
    console.log("\n[CAPA 1 - 1I] Scraping Life Events (Arrests, Obituaries, etc.)...");
    await scrapeLifeEvents();
  } catch (err: any) {
    console.error("[CAPA 1 ERROR] Falló el scraper de eventos de vida:", err.message);
  }

  try {
    console.log("\n[CAPA 1 - 1D] Resolviendo Propietarios Catastrales (PVA/GIS)...");
    await scrapePVA();
  } catch (err: any) {
    console.error("[CAPA 1 ERROR] Falló el resolvedor de PVA:", err.message);
  }

  console.log("\n[WAIT] Esperando 3 segundos a que se asienten las violaciones en la base de datos...");
  await sleep(3000);

  // =================================================================
  // CAPA 2: ENRIQUECIMIENTO DE IDENTIDAD Y CONTACTO (IDENTITY & SKIP TRACING)
  // =================================================================
  console.log("\n=================================================================");
  console.log("👤 [CAPA 2] ENRIQUECIMIENTO DE IDENTIDAD Y CONTACTO");
  console.log("=================================================================");

  try {
    console.log("\n[CAPA 2 - FASE 4] Enriqueciendo leads de estrés físico con Skip Tracing...");
    await runSkipTracing();
  } catch (err: any) {
    console.error("[CAPA 2 ERROR] Falló el módulo de Skip Tracing:", err.message);
  }

  // =================================================================
  // CAPA 3: AUDITORÍA FINANCIERA Y GRAVÁMENES (FINANCIAL AUDIT & TITLE CHECK)
  // =================================================================
  console.log("\n=================================================================");
  console.log("🏦 [CAPA 3] CRUCE CON MLS Y VALORACIÓN");
  console.log("=================================================================");

  try {
    console.log("\n[CAPA 3 - FASE 2] Cruzando con Spark MLS y calculando ARV por Comps...");
    await runCrossReference();
  } catch (err: any) {
    console.error("[CAPA 3 ERROR] Falló el motor de cruce MLS:", err.message);
  }

  // =================================================================
  // CAPA 4: INTELIGENCIA Y DESPACHO (INTELLIGENCE SCORING & DISPATCH)
  // =================================================================
  console.log("\n=================================================================");
  console.log("📡 [CAPA 4] INTELIGENCIA Y DESPACHO DE ESTRÉS FÍSICO");
  console.log("=================================================================");

  try {
    console.log("\n[CAPA 4 - FASE 5] Calculando Índice de Puntuación de Estrés (SSI)...");
    await scoreAllProperties();
  } catch (err: any) {
    console.error("[CAPA 4 ERROR] Falló el cálculo de SSI:", err.message);
  }

  try {
    console.log("\n[CAPA 4 - FASE 6] Enviando alertas de estrés físico a Telegram...");
    await notifyOpportunities('physical');
  } catch (err: any) {
    console.error("[CAPA 4 ERROR] Falló el notificador de Telegram:", err.message);
  }

  console.log("\n=================================================================");
  console.log("✅ PIPELINE DE ESTRÉS FÍSICO MUNICIPAL TZEL FINALIZADO CON ÉXITO ✅");
  console.log("=================================================================");

  try {
    await sendTelegramNotification(`✅ *Pipeline de Estrés Físico TZEL Finalizado con Éxito*\n🏁 Todas las fases físicas completadas.`);
  } catch (telegrErr: any) {
    console.error("Error al enviar notificación final de Telegram:", telegrErr.message);
  }
}

if (require.main === module) {
  runPhysicalPipeline().catch(console.error);
}

export { runPhysicalPipeline };
