import axios from "axios";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

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
