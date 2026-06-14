import { scrapeJeffersonCounty } from "./scrapers/scrape_jeffcomm";
import { scrapeIndiana } from "./scrapers/scrape_sheriff_in";
import { scrapeCodeViolations } from "./scrapers/scrapeCodeViolations";
import { scrapePVA } from "./scrapers/scrapePVA";
import { scrapeProbates } from "./scrapers/scrape_probates";
import { scrapeDivorces } from "./scrapers/scrape_divorces";
import { scrapePhysicalDistress } from "./scrapers/scrape_physical_distress";
import { scrapeFinancialDistress } from "./scrapers/scrape_financial_distress";
import { scrapeLifeEvents } from "./scrapers/scrape_life_events";
import { runCrossReference } from "./cross_reference";
import { runTitleLienCheck } from "./check_title_liens";
import { runIndianaCrawler } from "./indiana_court_crawler";
import { runSkipTracing } from "./skip_trace";
import { notifyOpportunities } from "./notify_opportunities";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runPipeline() {
  console.log("=================================================================");
  console.log("🚀 INICIANDO PIPELINE DE ADQUISICIÓN DE FORECLOSURES (KY/IN) 🚀");
  console.log(`Fecha/Hora: ${new Date().toISOString()}`);
  console.log("=================================================================");

  // FASE 1: Extracción de Subastas y Listas de Estrés (KY/IN)
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

  try {
    console.log("\n[FASE 1C] Scraping Louisville Metro Code Violations (KY)...");
    await scrapeCodeViolations();
  } catch (err: any) {
    console.error("[PIPELINE ERROR] Falló el scraper de Louisville Code Violations:", err.message);
  }

  try {
    console.log("\n[FASE 1D] Resolviendo Propietarios Catastrales (PVA)...");
    await scrapePVA();
  } catch (err: any) {
    console.error("[PIPELINE ERROR] Falló el resolvedor de PVA:", err.message);
  }

  try {
    console.log("\n[FASE 1E] Scraping Sucesiones/Testamentarias (Probates)...");
    await scrapeProbates();
  } catch (err: any) {
    console.error("[PIPELINE ERROR] Falló el scraper de testamentarias (Probates):", err.message);
  }

  try {
    console.log("\n[FASE 1F] Scraping Divorcios (Divorces)...");
    await scrapeDivorces();
  } catch (err: any) {
    console.error("[PIPELINE ERROR] Falló el scraper de divorcios (Divorces):", err.message);
  }

  try {
    console.log("\n[FASE 1G] Scraping Physical Distress (Municipal alerts)...");
    await scrapePhysicalDistress();
  } catch (err: any) {
    console.error("[PIPELINE ERROR] Falló el scraper de estrés físico:", err.message);
  }

  try {
    console.log("\n[FASE 1H] Scraping Financial Distress (Tax Liens, Evictions, etc.)...");
    await scrapeFinancialDistress();
  } catch (err: any) {
    console.error("[PIPELINE ERROR] Falló el scraper de estrés financiero:", err.message);
  }

  try {
    console.log("\n[FASE 1I] Scraping Life Events (Arrests, Obituaries, etc.)...");
    await scrapeLifeEvents();
  } catch (err: any) {
    console.error("[PIPELINE ERROR] Falló el scraper de eventos de vida:", err.message);
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

  // FASE 2.5: Verificación de Títulos y Deudas Ocultas (Doble Validación)
  try {
    console.log("\n[FASE 2.5] Verificando Gravámenes y Hipotecas Ocultas (Spark API + Fallback County Clerk)...");
    await runTitleLienCheck();
  } catch (err: any) {
    console.error("[PIPELINE ERROR] Falló el verificador de deudas ocultas (Fallo Fuerte):", err.message);
    throw err; // Relanzar para detener el pipeline si falla (Hard Fail)
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
