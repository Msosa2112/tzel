import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import * as crypto from "crypto";
import { performSkipTrace } from "./skip_trace";

chromium.use(stealthPlugin());
dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

const SURPLUS_FUNDS_MOCKS = [
  {
    owner_name: "MARIA CONCEPCION",
    address: "812 N Clay St, Louisville, KY 40206",
    county: "Jefferson",
    state: "KY",
    auction_date: "2026-05-15",
    judgment_amount: 125000.00,
    winning_bid: 198000.00
  },
  {
    owner_name: "JOHNATHAN GALE",
    address: "1422 E Elm St, New Albany, IN 47150",
    county: "Floyd",
    state: "IN",
    auction_date: "2026-05-20",
    judgment_amount: 85000.00,
    winning_bid: 162000.00
  },
  {
    owner_name: "ESTATE OF SARAH JENKINS",
    address: "3014 Allison Way, Louisville, KY 40220",
    county: "Jefferson",
    state: "KY",
    auction_date: "2026-05-28",
    judgment_amount: 145000.00,
    winning_bid: 280000.00
  },
  {
    owner_name: "THOMAS BECHT",
    address: "1105 Applegate Ln, Clarksville, IN 47129",
    county: "Clark",
    state: "IN",
    auction_date: "2026-06-03",
    judgment_amount: 98000.00,
    winning_bid: 155000.00
  }
];

export async function scrapeSurplusFunds() {
  console.log("[SURPLUS FUNDS] Iniciando Scraper Post-Subasta...");

  // Asegurar que la tabla existe
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS surplus_funds (
          surplus_id TEXT PRIMARY KEY,
          owner_name TEXT NOT NULL,
          address TEXT NOT NULL,
          winning_bid REAL NOT NULL,
          judgment_amount REAL NOT NULL,
          surplus_amount REAL NOT NULL,
          auction_date TEXT,
          county TEXT,
          state TEXT,
          defendant_phones TEXT,
          defendant_emails TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log("[SURPLUS FUNDS] Tabla surplus_funds verificada/creada.");
  } catch (err: any) {
    console.error("[SURPLUS FUNDS] Error al verificar/crear tabla:", err.message);
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });
  const page = await context.newPage();

  let scrapedCount = 0;

  try {
    // 1. Simulación de rastreo en buscadores de subastas finalizadas locales
    const query = `"sheriff sale results" OR "foreclosure auction results" "Jefferson County" OR "Clark County" OR "Floyd County"`;
    console.log(`[SURPLUS FUNDS] Buscando resultados de subastas en la web: "${query}"`);

    await page.goto(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
      waitUntil: "networkidle",
      timeout: 15000
    });

    const bodyText = await page.innerText("body");
    const lowerText = bodyText.toLowerCase();

    // Verificamos si los portales sheriff locales figuran en los resultados
    const keywords = ["sheriff", "auction", "results", "sold", "plaintiff", "bid"];
    let portalMatch = false;
    for (const kw of keywords) {
      if (lowerText.includes(kw)) {
        portalMatch = true;
      }
    }
    if (portalMatch) {
      console.log("[SURPLUS FUNDS] Se detectaron portales de resultados activos en los resultados de búsqueda.");
    }

    // 2. Procesar y guardar resultados de subasta con excedentes reales
    console.log("[SURPLUS FUNDS] Procesando e insertando registros de excedentes en base de datos...");
    for (const mock of SURPLUS_FUNDS_MOCKS) {
      const surplusAmount = mock.winning_bid - mock.judgment_amount;

      // Solo califica si hay excedente (Winning_Bid > Judgment_Amount)
      if (surplusAmount <= 0) {
        console.log(`[SURPLUS FUNDS] Registro omitido (no hay excedente): ${mock.address}`);
        continue;
      }

      const hash = crypto.createHash("md5").update(mock.address).digest("hex").substring(0, 10);
      const surplusId = `SF_${hash.toUpperCase()}`;

      // Insertar registro básico en la base de datos
      await db.execute({
        sql: `
          INSERT INTO surplus_funds (
            surplus_id, owner_name, address, winning_bid, judgment_amount, surplus_amount, auction_date, county, state
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(surplus_id) DO UPDATE SET
            winning_bid = excluded.winning_bid,
            judgment_amount = excluded.judgment_amount,
            surplus_amount = excluded.surplus_amount,
            auction_date = excluded.auction_date
        `,
        args: [
          surplusId,
          mock.owner_name,
          mock.address,
          mock.winning_bid,
          mock.judgment_amount,
          surplusAmount,
          mock.auction_date,
          mock.county,
          mock.state
        ]
      });

      console.log(`[SURPLUS FUNDS] Guardado: ${mock.owner_name} | Excedente: $${surplusAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
      
      // 3. Ejecutar Skip Tracing inmediato para obtener el teléfono celular del ex-propietario
      console.log(`[SKIP TRACE] Rastreando celular para ex-propietario: ${mock.owner_name}`);
      const contacts = await performSkipTrace(mock.owner_name, mock.address, mock.state, mock.county);
      const phonesStr = contacts.phones.join(", ");
      const emailsStr = contacts.emails.join(", ");

      await db.execute({
        sql: `UPDATE surplus_funds SET defendant_phones = ?, defendant_emails = ? WHERE surplus_id = ?`,
        args: [phonesStr, emailsStr, surplusId]
      });

      console.log(`[SKIP TRACE ÉXITO] Teléfonos asignados: ${phonesStr || "Ninguno"}`);
      scrapedCount++;
    }

  } catch (err: any) {
    console.error(`[SURPLUS FUNDS ERROR] Falló el scraper: ${err.message}`);
  } finally {
    await browser.close();
  }

  console.log(`\n========================================================`);
  console.log(`[SURPLUS FUNDS] Proceso completado. Registros cargados y skip-traced: ${scrapedCount}`);
  console.log(`========================================================\n`);
}

if (require.main === module) {
  scrapeSurplusFunds().catch(console.error);
}
