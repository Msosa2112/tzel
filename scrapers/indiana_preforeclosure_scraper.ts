import { createClient } from "@libsql/client";
import { getBrowser } from "./browser_helper";
import { cleanDefendant } from "./crawlee_court_scraper";
import * as dotenv from "dotenv";

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

export interface PreForeclosureCase {
  caseNumber: string;
  county: string;
  state: string;
  filingDate: string;
  plaintiff: string;
  defendant: string;
  address: string;
  caseStatus: string;
  daysSinceFiling: number;
}

/**
 * Normaliza fechas para cálculo de días desde la radicación
 */
function calculateDaysSince(dateStr: string): number {
  try {
    const filed = new Date(dateStr);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - filed.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  } catch {
    return 0;
  }
}

/**
 * Rastrea casos recientes de tipo MF (Mortgage Foreclosure) en Indiana MyCase
 */
export async function scrapeIndianaPreForeclosures(): Promise<PreForeclosureCase[]> {
  console.log("=================================================================");
  console.log("⚖️ [PRE-FORECLOSURE] Iniciando rastreo de demandas tempranas en Indiana (Clark/Floyd)...");
  console.log("=================================================================");

  const results: PreForeclosureCase[] = [];
  const targetCounties = [
    { code: "10C01", name: "Clark", state: "IN" },
    { code: "10C02", name: "Clark", state: "IN" },
    { code: "22C01", name: "Floyd", state: "IN" },
    { code: "22D01", name: "Floyd", state: "IN" },
    { code: "31C01", name: "Harrison", state: "IN" }
  ];

  let browserInstance: any = null;

  try {
    const { browser } = await getBrowser(true);
    browserInstance = browser;
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);

    for (const county of targetCounties) {
      console.log(`\n[PRE-FORECLOSURE] Consultando juzgado ${county.code} (${county.name} County, ${county.state})...`);
      
      try {
        await page.goto("https://public.courts.in.gov/mycase/", { waitUntil: "networkidle", timeout: 25000 });
        await page.waitForTimeout(2000);

        // Interactuar con la búsqueda de MyCase
        // Si la UI de MyCase requiere búsqueda por fecha o tipo de caso:
        // Buscamos casos recientes MF en el juzgado
        // Si hay resultados, parseamos las filas
      } catch (err: any) {
        console.warn(`[PRE-FORECLOSURE WARN] Error al consultar ${county.code}: ${err.message}`);
      }
    }

    await page.close();
  } catch (err: any) {
    console.error(`[PRE-FORECLOSURE ERROR] Error en navegador Playwright: ${err.message}`);
  } finally {
    if (browserInstance) {
      try { await browserInstance.close(); } catch {}
    }
  }

  // Si no se capturaron casos en vivo por CAPTCHA de MyCase, consultar registros de base de datos pendientes
  // de ejecución o insertar los casos descubiertos
  console.log(`[PRE-FORECLOSURE] Total de demandas tempranas procesadas: ${results.length}`);
  return results;
}

/**
 * Guarda o actualiza un caso de Pre-Foreclosure en Turso DB
 */
export async function savePreForeclosure(caseData: PreForeclosureCase): Promise<void> {
  const preId = `${caseData.state}_${caseData.county.toUpperCase()}_${caseData.caseNumber.replace(/[^a-zA-Z0-9]/g, "_")}`;
  
  await db.execute({
    sql: `
      INSERT INTO pre_foreclosures (
        pre_foreclosure_id, case_number, address, county, state, filing_date,
        plaintiff, defendant, case_status, days_since_filing
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pre_foreclosure_id) DO UPDATE SET
        case_status = excluded.case_status,
        days_since_filing = excluded.days_since_filing
    `,
    args: [
      preId,
      caseData.caseNumber,
      caseData.address,
      caseData.county,
      caseData.state,
      caseData.filingDate,
      caseData.plaintiff,
      caseData.defendant,
      caseData.caseStatus,
      caseData.daysSinceFiling
    ]
  });
}

if (require.main === module) {
  scrapeIndianaPreForeclosures().catch(console.error);
}
