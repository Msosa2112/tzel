import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import { notifyOpportunities } from "../notify_opportunities";

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

const MONTH_MAP: { [key: string]: number } = {
  january: 0, jan: 0,
  february: 1, feb: 1,
  march: 2, mar: 2,
  april: 3, apr: 3,
  may: 4,
  june: 5, jun: 5,
  july: 6, jul: 6,
  august: 7, aug: 7,
  september: 8, sep: 8, sept: 8,
  october: 9, oct: 9,
  november: 10, nov: 10,
  december: 11, dec: 11
};

function parseAuctionDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const clean = dateStr.toLowerCase().replace(/\s+/g, " ").trim();
  if (clean.includes("unknown") || clean.includes("pending")) {
    return null;
  }
  const slashDateMatch = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashDateMatch) {
    const month = parseInt(slashDateMatch[1], 10) - 1;
    const day = parseInt(slashDateMatch[2], 10);
    const year = parseInt(slashDateMatch[3], 10);
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }
  const monthSlashDayMatch = clean.match(/^([a-z]+)\s*\/\s*(\d{1,2})\s+(\d{4})$/);
  if (monthSlashDayMatch) {
    const monthName = monthSlashDayMatch[1];
    const day = parseInt(monthSlashDayMatch[2], 10);
    const year = parseInt(monthSlashDayMatch[3], 10);
    if (MONTH_MAP[monthName] !== undefined) {
      const d = new Date(year, MONTH_MAP[monthName], day);
      if (!isNaN(d.getTime())) return d;
    }
  }
  const monthCommaMatch = clean.match(/^([a-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (monthCommaMatch) {
    const monthName = monthCommaMatch[1];
    const day = parseInt(monthCommaMatch[2], 10);
    const year = parseInt(monthCommaMatch[3], 10);
    if (MONTH_MAP[monthName] !== undefined) {
      const d = new Date(year, MONTH_MAP[monthName], day);
      if (!isNaN(d.getTime())) return d;
    }
  }
  const monthSpaceMatch = clean.match(/^([a-z]+)\s+(\d{1,2})\s+(\d{4})$/);
  if (monthSpaceMatch) {
    const monthName = monthSpaceMatch[1];
    const day = parseInt(monthSpaceMatch[2], 10);
    const year = parseInt(monthSpaceMatch[3], 10);
    if (MONTH_MAP[monthName] !== undefined) {
      const d = new Date(year, MONTH_MAP[monthName], day);
      if (!isNaN(d.getTime())) return d;
    }
  }
  const fallbackDate = new Date(dateStr);
  if (!isNaN(fallbackDate.getTime())) {
    return fallbackDate;
  }
  return null;
}

function isAuctionDateValid(dateStr: string): boolean {
  const auctionDate = parseAuctionDate(dateStr);
  if (!auctionDate) return true;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  auctionDate.setHours(0, 0, 0, 0);
  return auctionDate.getTime() >= today.getTime();
}

async function runTrigger() {
  console.log("=== RESETEANDO ESTADO DE NOTIFICACIÓN DE SUBASAS VIGENTES EN TURSO ===");
  
  try {
    // 1. Obtener todas las subastas marcadas para alerta en Telegram
    const res = await db.execute(`
      SELECT auction_id, auction_date, state, needs_manual_review, is_high_yield 
      FROM foreclosure_auctions
    `);
    
    console.log(`Analizando ${res.rows.length} subastas en la base de datos...`);
    
    let resetCount = 0;
    
    for (const row of res.rows) {
      const auctionId = row.auction_id as string;
      const auctionDate = row.auction_date as string;
      const state = row.state as string;
      const needsManualReview = row.needs_manual_review as number || 0;
      const isHighYield = row.is_high_yield as number || 0;
      
      // Solo resetear si es vigente y califica para alerta (High Yield o IN Manual Review)
      const isValid = isAuctionDateValid(auctionDate);
      const qualifies = isHighYield === 1 || (state === "IN" && needsManualReview === 1);
      
      if (isValid && qualifies) {
        await db.execute({
          sql: "UPDATE foreclosure_auctions SET telegram_sent = 0 WHERE auction_id = ?",
          args: [auctionId]
        });
        resetCount++;
      }
    }
    
    console.log(`Reseteadas ${resetCount} subastas vigentes y elegibles en Turso.`);
    console.log("\nIniciando envío de notificaciones a Telegram...");
    
    await notifyOpportunities();
    
    console.log("\nEnvío completo de notificaciones finalizado.");
    
  } catch (err: any) {
    console.error("Error al preparar y enviar las notificaciones:", err.message || err);
  }
}

runTrigger();
