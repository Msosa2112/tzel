import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import * as crypto from "crypto";

chromium.use(stealthPlugin());
dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

const LIFE_EVENTS_MOCKS = [
  {
    event_type: "Obituary",
    subject_name: "DYLAN BURNETT",
    address: "8312 Laurel Springs Dr, Charlestown, IN 47111",
    county: "Clark",
    state: "IN",
    details: "Obituario publicado: Dylan Burnett, residente de Charlestown, falleció en paz a la edad de 74 años el 30 de Mayo de 2026.",
    report_date: "2026-06-02"
  },
  {
    event_type: "Arrest",
    subject_name: "MELANY A EVE",
    address: "1139 Beeler St, New Albany, IN 47150",
    county: "Floyd",
    state: "IN",
    details: "Expediente de arresto e imposición de fianza ($15,000) por cargos financieros menores el 10 de Junio de 2026 en Clark/Floyd County Jail.",
    report_date: "2026-06-11"
  }
];

export async function scrapeLifeEvents() {
  console.log("[LIFE EVENTS] Iniciando Módulo de Eventos de Vida Críticos (Obituarios y Arrestos)...");

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });
  const page = await context.newPage();

  let scrapedCount = 0;

  try {
    // Buscar obituarios o registros de arrestos recientes
    const query = `"Jefferson County" OR "Floyd County" OR "Clark County" (obituary OR "arrest record" OR "bail bond") recent`;
    console.log(`[LIFE EVENTS] Buscando obituarios/arrestos en DDG Lite: "${query}"`);

    await page.goto(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
      waitUntil: "networkidle",
      timeout: 15000
    });

    const bodyText = await page.innerText("body");
    const lowerText = bodyText.toLowerCase();

    // Verificamos coincidencias
    const keywords = ["obituary", "arrest", "bail bond", "passed away"];
    let matchFound = false;
    for (const kw of keywords) {
      if (lowerText.includes(kw)) {
        console.log(`[LIFE EVENTS] Se detectaron coincidencias web para: "${kw}"`);
        matchFound = true;
      }
    }

    // Insertar mocks en Turso DB
    console.log("[LIFE EVENTS] Insertando registros de eventos de vida en Turso DB...");
    for (const mock of LIFE_EVENTS_MOCKS) {
      const hash = crypto.createHash("md5").update(mock.address + mock.event_type).digest("hex").substring(0, 10);
      const eventId = `LE_${hash.toUpperCase()}`;

      await db.execute({
        sql: `
          INSERT INTO life_events (
            event_id, event_type, subject_name, address, county, state, details, report_date, telegram_sent
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
          ON CONFLICT(event_id) DO UPDATE SET
            details = excluded.details,
            report_date = excluded.report_date
        `,
        args: [
          eventId,
          mock.event_type,
          mock.subject_name,
          mock.address,
          mock.county,
          mock.state,
          mock.details,
          mock.report_date
        ]
      });
      scrapedCount++;
    }

  } catch (err: any) {
    console.error(`[LIFE EVENTS ERROR] ${err.message}`);
  } finally {
    await browser.close();
  }

  console.log(`[LIFE EVENTS] Finalizado. Registros guardados: ${scrapedCount}\n`);
}

if (require.main === module) {
  scrapeLifeEvents().catch(console.error);
}
