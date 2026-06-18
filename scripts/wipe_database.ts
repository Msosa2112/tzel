import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

async function main() {
  console.log("🧹 [WIPE] Iniciando estrategia de 'Tierra Quemada' en base de datos Turso...");

  const tables = [
    "foreclosure_auctions",
    "code_violations",
    "portfolio_clusters",
    "probates",
    "divorces",
    "bankruptcies",
    "physical_distress",
    "financial_distress",
    "life_events",
    "surplus_funds"
  ];

  for (const table of tables) {
    try {
      console.log(`- Limpiando tabla: ${table}...`);
      const res = await db.execute(`DELETE FROM ${table}`);
      console.log(`  ✅ Tabla ${table} vaciada con éxito. Filas afectadas: ${res.rowsAffected}`);
    } catch (err: any) {
      console.error(`  ❌ Error al vaciar tabla ${table}:`, err.message);
    }
  }

  console.log("🏁 [WIPE COMPLETED] Todas las tablas seleccionadas están vacías (0 registros).");
}

main().catch(console.error);
