import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

/**
 * Calcula la cantidad de días restantes hasta la fecha de la subasta.
 */
function getDaysRemaining(dateStr: string): number | null {
  if (!dateStr) return null;
  try {
    let cleanDate = dateStr.toLowerCase().replace(/\s+/g, " ").trim();
    const months: { [key: string]: number } = {
      jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
      apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
      aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
      nov: 10, november: 10, dec: 11, december: 11
    };
    
    let dateObj: Date | null = null;
    
    if (/^\d+\/\d+\/\d+$/.test(cleanDate)) {
      const [m, d, y] = cleanDate.split("/").map(Number);
      dateObj = new Date(y, m - 1, d);
    }
    else if (cleanDate.includes("/")) {
      const parts = cleanDate.split("/");
      const monthName = parts[0].trim();
      const dayAndYear = parts[1].trim();
      const dayYearParts = dayAndYear.split(" ");
      const day = parseInt(dayYearParts[0]);
      const year = parseInt(dayYearParts[1] || "2026");
      
      if (months[monthName] !== undefined && !isNaN(day)) {
        dateObj = new Date(year, months[monthName], day);
      }
    }
    else {
      cleanDate = cleanDate.replace(/,/g, "");
      const parts = cleanDate.split(" ");
      if (parts.length >= 3) {
        const monthName = parts[0];
        const day = parseInt(parts[1]);
        const year = parseInt(parts[2]);
        if (months[monthName] !== undefined && !isNaN(day) && !isNaN(year)) {
          dateObj = new Date(year, months[monthName], day);
        }
      }
    }
    
    if (dateObj && !isNaN(dateObj.getTime())) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      dateObj.setHours(0, 0, 0, 0);
      const diffTime = dateObj.getTime() - today.getTime();
      return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }
  } catch (e) {}
  return null;
}

async function runCleanup() {
  console.log("=================================================================");
  console.log("🧹 INICIANDO LIMPIEZA RETROACTIVA DE FORECLOSURE AUCTIONS 🧹");
  console.log("=================================================================");

  // 1. Obtener todas las subastas para evaluación
  let res;
  try {
    res = await db.execute("SELECT auction_id, address, auction_date, debt_amount, defendant FROM foreclosure_auctions");
  } catch (err: any) {
    console.error("[ERROR] No se pudo consultar la base de datos:", err.message);
    process.exit(1);
  }

  const rows = res.rows;
  console.log(`[INFO] Se encontraron ${rows.length} subastas totales para evaluar.`);

  let rule1Count = 0;
  let rule2Count = 0;
  let totalUpdated = 0;

  // Calcular la fecha de reintento de hibernación (+15 días)
  const nextRetry = new Date();
  nextRetry.setDate(nextRetry.getDate() + 15);
  const nextRetryStr = nextRetry.toISOString().split("T")[0]; // YYYY-MM-DD

  for (const row of rows) {
    const auctionId = row.auction_id as string;
    const address = row.address as string;
    const auctionDate = row.auction_date as string;
    const debtAmount = row.debt_amount as number | null;
    const defendant = row.defendant as string | null;

    const daysRemaining = getDaysRemaining(auctionDate);

    // Solo evaluar si la subasta es a futuro y está a más de 30 días
    if (daysRemaining !== null && daysRemaining > 30) {
      let matchRule1 = false;
      let matchRule2 = false;

      // Regla 1: Deuda inexistente (NULL o 0)
      if (debtAmount === null || debtAmount === 0) {
        matchRule1 = true;
      }

      // Regla 2: Propietario 'Unknown' o inválido
      const lowerDef = (defendant || "").trim().toLowerCase();
      if (
        !defendant ||
        lowerDef === "" ||
        lowerDef === "unknown" ||
        lowerDef === "dueño desconocido" ||
        lowerDef === "no especificado" ||
        lowerDef === "null"
      ) {
        matchRule2 = true;
      }

      if (matchRule1 || matchRule2) {
        if (matchRule1) rule1Count++;
        if (matchRule2) rule2Count++;
        totalUpdated++;

        console.log(`[HIBERNANDO] ID: ${auctionId} | Dirección: ${address}`);
        console.log(`   - Días restantes: ${daysRemaining} | Deuda: $${debtAmount || 0} | Demandado: "${defendant || 'NULL'}"`);
        
        try {
          await db.execute({
            sql: "UPDATE foreclosure_auctions SET needs_manual_review = 2, next_retry_date = ? WHERE auction_id = ?",
            args: [nextRetryStr, auctionId]
          });
        } catch (updateErr: any) {
          console.error(`   [ERROR UPDATE] Falló actualización para ${auctionId}:`, updateErr.message);
        }
      }
    }
  }

  console.log("\n========================================================");
  console.log("RESUMEN DE LIMPIEZA RETROACTIVA:");
  printDetails(rule1Count, rule2Count, totalUpdated, nextRetryStr);
  console.log("========================================================\n");
}

function printDetails(rule1: number, rule2: number, total: number, retryDate: string) {
  console.log(`- Subastas con Deuda Inexistente hibernadas (Regla 1): ${rule1}`);
  console.log(`- Subastas con Dueño 'Unknown' hibernadas (Regla 2): ${rule2}`);
  console.log(`- Total de filas actualizadas: ${total}`);
  console.log(`- Fecha de próximo reintento asignada: ${retryDate}`);
}

runCleanup().catch(console.error);
