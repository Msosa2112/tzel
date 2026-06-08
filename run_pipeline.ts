import { scrapeJeffersonCounty } from "./scrapers/scrape_jeffcomm";
import { scrapeIndiana } from "./scrapers/scrape_sheriff_in";
import { runCrossReference } from "./cross_reference";
import { runIndianaCrawler } from "./indiana_court_crawler";
import { runSkipTracing } from "./skip_trace";
import { notifyOpportunities } from "./notify_opportunities";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPipeline() {
  console.log("=================================================================");
  console.log("🚀 INICIANDO PIPELINE DE ADQUISICIÓN DE FORECLOSURES (KY/IN) 🚀");
  console.log(`Fecha/Hora: ${new Date().toISOString()}`);
  console.log("=================================================================");

  // FASE 1: Extracción de Subastas desde Portales de Cortes/Sheriff
  try {
    console.log("\n[FASE 1A] Scraping Jefferson County (KY)...");
    await scrapeJeffersonCounty();
  } catch (err: any) {
    console.error("[PIPELINE ERROR] Falló el scraper de Jefferson County:", err.message);
  }

  try {
    console.log("\n[FASE 1B] Scraping Indiana Counties (IN)...");
    await scrapeIndiana();
  } catch (err: any) {
    console.error("[PIPELINE ERROR] Falló el scraper de Indiana:", err.message);
  }

  // Esperar 3 segundos para garantizar que todos los registros asíncronos no-promisificados de Floyd County se escriban en Turso
  console.log("\n[WAIT] Esperando 3 segundos a que se asienten las escrituras en la base de datos...");
  await sleep(3000);

  // FASE 2: Cruce con Spark MLS y cálculo de ARV por Comparables (Comps)
  try {
    console.log("\n[FASE 2] Cruzando con Spark MLS y calculando ARV por Comps...");
    await runCrossReference();
  } catch (err: any) {
    console.error("[PIPELINE ERROR] Falló el motor de cruce MLS:", err.message);
  }

  // FASE 3: Enriquecimiento de Casos de Indiana sin Deuda a través de MyCase
  try {
    console.log("\n[FASE 3] Corriendo Crawler de Cortes de Indiana (MyCase)...");
    await runIndianaCrawler();
  } catch (err: any) {
    console.error("[PIPELINE ERROR] Falló el crawler de cortes de Indiana:", err.message);
  }

  // FASE 4: Enriquecimiento de Datos de Contacto (Skip Tracing)
  try {
    console.log("\n[FASE 4] Enriqueciendo leads de alta rentabilidad con Skip Tracing...");
    await runSkipTracing();
  } catch (err: any) {
    console.error("[PIPELINE ERROR] Falló el módulo de Skip Tracing:", err.message);
  }

  // FASE 5: Despacho de Notificaciones Filtradas a Telegram
  try {
    console.log("\n[FASE 5] Enviando alertas de oportunidades y revisiones a Telegram...");
    await notifyOpportunities();
  } catch (err: any) {
    console.error("[PIPELINE ERROR] Falló el notificador de Telegram:", err.message);
  }

  console.log("\n=================================================================");
  console.log("✅ PIPELINE DE FORECLOSURES FINALIZADO CON ÉXITO ✅");
  console.log("=================================================================");
}

// Ejecutar si se corre directamente
if (require.main === module) {
  runPipeline().catch(console.error);
}

export { runPipeline };
