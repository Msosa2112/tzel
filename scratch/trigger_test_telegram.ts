import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import { notifyOpportunities } from "../notify_opportunities";

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

async function runTrigger() {
  console.log("=== PREPARANDO REGISTROS DE PRUEBA EN TURSO DE INDIANA ===");
  
  try {
    // 1. Obtener 3 subastas de Indiana existentes
    const res = await db.execute(`
      SELECT auction_id, address, county 
      FROM foreclosure_auctions 
      WHERE state = 'IN' 
      LIMIT 3
    `);
    
    if (res.rows.length === 0) {
      console.log("No se encontraron registros de Indiana en la base de datos.");
      return;
    }
    
    const mockDefendants = [
      "John Doe",
      "Estela Gomez, et al.",
      "Robert W. Johnson, spouse of Sarah Johnson"
    ];
    
    for (let i = 0; i < res.rows.length; i++) {
      const row = res.rows[i];
      const auctionId = row.auction_id as string;
      const rawDef = mockDefendants[i];
      
      // Aplicamos la misma función de limpieza para simular el guardado
      const defCleaned = cleanDefendantMock(rawDef);
      
      console.log(`Actualizando ${auctionId} con Defendant: "${defCleaned}" (Original: "${rawDef}")...`);
      
      await db.execute({
        sql: `
          UPDATE foreclosure_auctions 
          SET defendant = ?, needs_manual_review = 1, telegram_sent = 0 
          WHERE auction_id = ?
        `,
        args: [defCleaned, auctionId]
      });
    }
    
    console.log("\nRegistros actualizados. Ejecutando notifyOpportunities() para enviar a Telegram...");
    await notifyOpportunities();
    console.log("Proceso de prueba de notificaciones finalizado.");
    
  } catch (err: any) {
    console.error("Error al preparar y enviar las notificaciones:", err.message || err);
  }
}

function cleanDefendantMock(name: string): string {
  if (!name) return "";
  let clean = name;
  clean = clean.replace(/\([^)]*\)/g, "");
  clean = clean.replace(/,?\s+et\.?\s*al\.?/gi, "");
  clean = clean.replace(/,?\s+etal/gi, "");
  clean = clean.replace(/,?\s+spouse\s+of\s+.*$/gi, "");
  clean = clean.replace(/,?\s+and\s+spouse.*$/gi, "");
  clean = clean.replace(/,?\s+husband\s+and\s+wife.*$/gi, "");
  clean = clean.replace(/,?\s+wife\s+of\s+.*$/gi, "");
  clean = clean.replace(/,?\s+husband\s+of\s+.*$/gi, "");
  clean = clean.replace(/,?\s+deceased/gi, "");
  clean = clean.replace(/,?\s+individually/gi, "");
  clean = clean.replace(/[\*\,\-\_\#\s]+$/, "");
  clean = clean.replace(/["']/g, "");
  return clean.replace(/\s+/g, " ").trim();
}

runTrigger();
