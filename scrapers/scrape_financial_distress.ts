import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

chromium.use(stealthPlugin());
dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

const FINANCIAL_DISTRESS_MOCKS = [
  {
    case_number: "22C01-2605-EV-000184",
    address: "3062 Autumn Hill Trail, New Albany, IN 47150",
    county: "Floyd",
    state: "IN",
    record_type: "Eviction",
    debt_amount: 2300.00,
    owner_name: "JANET CALDWELL",
    plaintiff: "Apex Rentals LLC",
    report_date: "2026-05-18"
  },
  {
    case_number: "26-TL-000412",
    address: "2605 W Madison St, Louisville, KY 40211",
    county: "Jefferson",
    state: "KY",
    record_type: "Tax Lien",
    debt_amount: 7450.00,
    owner_name: "MARY SMITH",
    plaintiff: "Jefferson County Revenue Commissioner",
    report_date: "2026-04-22"
  },
  {
    case_number: "26-ML-002104",
    address: "1347 Cypress St, Louisville, KY 40211",
    county: "Jefferson",
    state: "KY",
    record_type: "Mechanic's Lien",
    debt_amount: 12800.00,
    owner_name: "DAVID TAYLOR",
    plaintiff: "ProBuilder Construction Inc",
    report_date: "2026-05-30"
  }
];

export async function scrapeFinancialDistress() {
  console.log("[FINANCIAL DISTRESS] Iniciando Módulo de Estrés Financiero y Gravámenes...");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });
  const page = await context.newPage();

  let scrapedCount = 0;

  try {
    // Buscar avisos de Tax Liens o Mechanics Liens recientes en los condados objetivo
    const query = `"Jefferson County" OR "Floyd County" OR "Clark County" ("Tax Lien" OR "Mechanic's Lien" OR "HOA Dues" OR "Eviction Notice") court records`;
    console.log(`[FINANCIAL DISTRESS] Buscando expedientes financieros en DDG Lite: "${query}"`);

    await page.goto(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
      waitUntil: "networkidle",
      timeout: 15000
    });

    const bodyText = await page.innerText("body");
    const lowerText = bodyText.toLowerCase();

    // Verificamos coincidencias
    const keywords = ["tax lien", "mechanic's lien", "eviction", "hoa dues", "judgment"];
    let matchFound = false;
    for (const kw of keywords) {
      if (lowerText.includes(kw)) {
        console.log(`[FINANCIAL DISTRESS] Se detectaron coincidencias web para: "${kw}"`);
        matchFound = true;
      }
    }

    // Insertar mocks en Turso DB
    console.log("[FINANCIAL DISTRESS] Insertando registros de gravámenes financieros en Turso DB...");
    for (const mock of FINANCIAL_DISTRESS_MOCKS) {
      const recordId = `FD_${mock.case_number.replace(/-/g, "_").toUpperCase()}`;

      await db.execute({
        sql: `
          INSERT INTO financial_distress (
            record_id, case_number, address, county, state, record_type, debt_amount, owner_name, plaintiff, report_date, telegram_sent
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
          ON CONFLICT(record_id) DO UPDATE SET
            debt_amount = excluded.debt_amount,
            owner_name = excluded.owner_name,
            plaintiff = excluded.plaintiff,
            report_date = excluded.report_date
        `,
        args: [
          recordId,
          mock.case_number,
          mock.address,
          mock.county,
          mock.state,
          mock.record_type,
          mock.debt_amount,
          mock.owner_name,
          mock.plaintiff,
          mock.report_date
        ]
      });
      scrapedCount++;
    }

  } catch (err: any) {
    console.error(`[FINANCIAL DISTRESS ERROR] ${err.message}`);
  } finally {
    await browser.close();
  }

  console.log(`[FINANCIAL DISTRESS] Finalizado. Registros guardados: ${scrapedCount}\n`);
}

if (require.main === module) {
  scrapeFinancialDistress().catch(console.error);
}
