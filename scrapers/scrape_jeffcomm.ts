import axios from "axios";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import { isAddressInJurisdiction } from "./geo_fencing";

// Cargar variables de entorno
dotenv.config();

// Inicializar cliente de Turso DB
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

/**
 * Parsea un archivo CSV respetando campos entrecomillados que contienen comas.
 */
function parseCSV(csvText: string): string[][] {
  const lines: string[][] = [];
  const linesRaw = csvText.split(/\r?\n/);
  
  for (const line of linesRaw) {
    if (!line.trim()) continue;
    const row: string[] = [];
    let inQuotes = false;
    let currentField = "";
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        row.push(currentField.trim());
        currentField = "";
      } else {
        currentField += char;
      }
    }
    row.push(currentField.trim());
    lines.push(row);
  }
  return lines;
}

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
  
  // 1. Formato MM/DD/YYYY o M/D/YYYY
  const slashDateMatch = clean.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashDateMatch) {
    const month = parseInt(slashDateMatch[1], 10) - 1;
    const day = parseInt(slashDateMatch[2], 10);
    const year = parseInt(slashDateMatch[3], 10);
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d;
  }
  
  // 2. Formato Month/DD YYYY (ej. "may/28 2026" o "july/ 2 2026")
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
  
  // 3. Formato Month DD, YYYY (ej. "february 12, 2026")
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
  
  // 4. Formato Month DD YYYY (ej. "july 7 2026")
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

  // Fallback para constructor nativo de JavaScript
  const fallbackDate = new Date(dateStr);
  if (!isNaN(fallbackDate.getTime())) {
    return fallbackDate;
  }
  
  return null;
}

function isAuctionDateValid(dateStr: string): boolean {
  const auctionDate = parseAuctionDate(dateStr);
  if (!auctionDate) {
    console.log(`[DATE WARNING] No se pudo parsear la fecha de subasta: "${dateStr}". Se permitirá para revisión manual.`);
    return true; 
  }
  
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Normalizar a medianoche
  
  auctionDate.setHours(0, 0, 0, 0); // Normalizar la fecha de subasta a medianoche
  
  return auctionDate.getTime() >= today.getTime();
}

/**
 * Scraper para el Master Commissioner de Jefferson County (KY)
 */
async function scrapeJeffersonCounty() {
  console.log("[SCRAPER JCCO] Iniciando extracción de subastas de Jefferson County, KY...");
  const csvUrl = "https://www.jeffcomm.org/docs/webPush.csv";
  
  try {
    const response = await axios.get(csvUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      timeout: 15000
    });
    
    if (response.status !== 200) {
      throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
    }
    
    const parsedData = parseCSV(response.data);
    if (parsedData.length <= 1) {
      console.log("[SCRAPER JCCO] El archivo CSV está vacío o solo contiene encabezados.");
      return;
    }
    
    // El primer renglón son las cabeceras
    const headers = parsedData[0];
    const rows = parsedData.slice(1);
    console.log(`[SCRAPER JCCO] Se encontraron ${rows.length} subastas programadas totales.`);
    
    let processedCount = 0;
    let activeSavedCount = 0;
    
    for (const row of rows) {
      if (row.length < 9) continue;
      
      const caseNumber = row[0];
      const caseStyle = row[2] || "";
      const attorney = row[3] || "";
      const saleDate = row[4];
      const docket = row[5];
      const address = row[6];
      const status = row[8].toUpperCase().trim();
      
      // Filtrar subastas retiradas (WITHDRAWN)
      if (status.includes("WITHDRAWN")) {
        continue;
      }
      
      // Filtro de vigencia: si la fecha de subasta ya pasó, descartar
      if (!isAuctionDateValid(saleDate)) {
        console.log(`[FILTRO VIGENCIA] Descartando subasta pasada de Kentucky: Caso ${caseNumber} | Dirección: ${address} | Fecha: ${saleDate}`);
        continue;
      }
      
      processedCount++;
      
      // Separar demandante (plaintiff) y demandado (defendant) del estilo del caso
      // Formato típico: "PLAINTIFF vs. DEFENDANT"
      let plaintiff = "";
      let defendant = "";
      const vsIndex = caseStyle.toLowerCase().indexOf(" vs. ");
      
      if (vsIndex !== -1) {
        plaintiff = caseStyle.substring(0, vsIndex).replace(/^"|"$/g, '').trim();
        defendant = caseStyle.substring(vsIndex + 5).replace(/^"|"$/g, '').trim();
      } else {
        plaintiff = caseStyle.replace(/^"|"$/g, '').trim();
      }
      
      // Generar el ID único para la subasta
      const auctionId = `KY_JEFF_${caseNumber}`;
      
      // Calcular la URL del PDF del avalúo (preferimos .PDF en mayúsculas)
      let pdfUrl: string | null = null;
      if (saleDate && docket) {
        const lastSlash = saleDate.lastIndexOf('/');
        if (lastSlash !== -1) {
          const newDateStr = saleDate.substring(0, lastSlash).replace(/\//g, '');
          pdfUrl = `https://www.jeffcomm.org/docs/${newDateStr}-${docket}.PDF`;
        }
      }
      
      // Validación de Geocerca (Kentucky o Indiana)
      if (!isAddressInJurisdiction(address, "KY")) {
        console.log(`[SKIP] Propiedad fuera de jurisdicción detectada y descartada. Dirección: "${address}"`);
        continue;
      }

      // Guardar/Actualizar la subasta en la base de datos de Turso
      try {
        await db.execute({
          sql: `
            INSERT INTO foreclosure_auctions (
              auction_id, case_number, address, county, state, auction_date,
              plaintiff, defendant, mls_status, pdf_url
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_check', ?)
            ON CONFLICT(auction_id) DO UPDATE SET
              address = excluded.address,
              auction_date = excluded.auction_date,
              plaintiff = excluded.plaintiff,
              defendant = excluded.defendant,
              pdf_url = excluded.pdf_url
          `,
          args: [
            auctionId,
            caseNumber,
            address,
            "Jefferson",
            "KY",
            saleDate,
            plaintiff || null,
            defendant || null,
            pdfUrl
          ]
        });
        
        activeSavedCount++;
        console.log(`[SUBASTA GUARDADA] Caso: ${caseNumber} | Dirección: ${address} | Fecha: ${saleDate} | PDF: ${pdfUrl}`);
      } catch (dbErr) {
        console.error(`[DB ERROR] Error al guardar subasta judicial ${caseNumber}:`, dbErr);
      }

    }
    
    console.log("\n========================================================");
    console.log("RESUMEN DE EXTRACCIÓN JCCO (KENTUCKY):");
    console.log(`- Subastas procesadas activas: ${processedCount}`);
    console.log(`- Guardadas/Actualizadas en Turso: ${activeSavedCount}`);
    console.log("========================================================\n");
    
  } catch (error: any) {
    console.error("[SCRAPER JCCO ERROR] Falló la extracción de subastas de JCCO:", error.message || error);
  }
}

// Ejecutar scraper si se corre directamente
if (require.main === module) {
  scrapeJeffersonCounty();
}

export { scrapeJeffersonCounty };
