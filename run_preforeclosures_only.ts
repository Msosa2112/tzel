import { scrapeKentuckyPreForeclosures } from "./scrapers/kentucky_preforeclosure_scraper";
import { scrapeIndianaPreForeclosures } from "./scrapers/indiana_preforeclosure_scraper";
import { scrapeSriTaxSales } from "./scrapers/sri_tax_sale_scraper";
import { db } from "./db";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  console.log("=================================================================");
  console.log("⚖️ [TZEL] EJECUTANDO MÓDULO EXCLUSIVO DE PRE-FORECLOSURES & TAX SALES ⚖️");
  console.log(`Fecha/Hora: ${new Date().toISOString()}`);
  console.log("=================================================================\n");

  // 1. Pre-Foreclosures Kentucky (Lis Pendens & Demandas Civiles)
  console.log("🔹 [1/3] Ejecutando Scraper de Pre-Foreclosures en Kentucky (Jefferson County)...");
  try {
    await scrapeKentuckyPreForeclosures();
  } catch (err: any) {
    console.error("[ERROR KY PRE-FORECLOSURES]:", err.message);
  }

  // 2. Pre-Foreclosures Indiana (MyCase Odyssey MF Cases)
  console.log("\n🔹 [2/3] Ejecutando Scraper de Pre-Foreclosures en Indiana (Clark/Floyd/Harrison)...");
  try {
    await scrapeIndianaPreForeclosures();
  } catch (err: any) {
    console.error("[ERROR IN PRE-FORECLOSURES]:", err.message);
  }

  // 3. SRI Services Tax Sales (Indiana)
  console.log("\n🔹 [3/3] Ejecutando Scraper de Subastas de Impuestos SRI Services...");
  try {
    await scrapeSriTaxSales();
  } catch (err: any) {
    console.error("[ERROR SRI TAX SALES]:", err.message);
  }

  // 4. Resumen consolidado en Base de Datos
  console.log("\n=================================================================");
  console.log("📊 RESULTADOS CONSOLIDADOS EN BASE DE DATOS TURSO:");
  console.log("=================================================================");

  try {
    const pfRows = await db.execute({
      sql: "SELECT case_number, address, defendant, plaintiff, absentee_owner, days_since_filing FROM pre_foreclosures ORDER BY created_at DESC LIMIT 10",
      args: []
    });

    console.log(`\n⚖️ Pre-Foreclosures Capturados (${pfRows.rows.length} muestras recientes):`);
    for (const r of pfRows.rows) {
      const absentee = r.absentee_owner === 1 ? "🏠 (Dueño Ausente)" : "👤 (Dueño Ocupante)";
      console.log(`  • Caso: ${r.case_number} | ${r.address} | Dueño: ${r.defendant} ${absentee} | Radicado hace ${r.days_since_filing} días`);
    }

    const tsRows = await db.execute({
      sql: "SELECT parcel_id, address, owner_name, county, taxes_owed FROM tax_sales ORDER BY created_at DESC LIMIT 10",
      args: []
    });

    console.log(`\n📑 Subastas de Impuestos Fiscales (${tsRows.rows.length} registros):`);
    for (const t of tsRows.rows) {
      console.log(`  • Parcela: ${t.parcel_id} | ${t.address} (${t.county}, IN) | Dueño: ${t.owner_name} | Impuestos: $${t.taxes_owed}`);
    }

  } catch (dbErr: any) {
    console.error("[DB SUMMARY ERROR]:", dbErr.message);
  }

  console.log("\n=================================================================");
  console.log("🏁 EJECUCIÓN DE PRE-FORECLOSURES & TAX SALES FINALIZADA CON ÉXITO 🏁");
  console.log("=================================================================");
}

main().catch(console.error);
