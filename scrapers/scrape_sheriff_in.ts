import axios from "axios";
import * as cheerio from "cheerio";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

// Cargar variables de entorno
dotenv.config();

// Inicializar cliente de Turso DB
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

// Ciudades comunes en Clark County e Indiana para geofiltros
const CLARK_CITIES = ["jeffersonville", "clarksville", "sellersburg", "charlestown", "henryville", "borden", "new washington"];
const FLOYD_CITIES = ["new albany", "georgetown", "floyds knobs", "galena", "greenville"];

/**
 * Limpia y normaliza cadenas de texto (remueve espacios dobles y nbsp)
 */
function cleanText(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Limpia y normaliza el nombre del demandado
 */
function cleanDefendant(name: string): string {
  if (!name) return "";
  let clean = name;
  
  // Remover texto entre paréntesis
  clean = clean.replace(/\([^)]*\)/g, "");
  
  // Remover et al, et al., et. al., etal
  clean = clean.replace(/,?\s+et\.?\s*al\.?/gi, "");
  clean = clean.replace(/,?\s+etal/gi, "");
  
  // Remover "spouse of", "and spouse", "husband/wife of", etc.
  clean = clean.replace(/,?\s+spouse\s+of\s+.*$/gi, "");
  clean = clean.replace(/,?\s+and\s+spouse.*$/gi, "");
  clean = clean.replace(/,?\s+husband\s+and\s+wife.*$/gi, "");
  clean = clean.replace(/,?\s+wife\s+of\s+.*$/gi, "");
  clean = clean.replace(/,?\s+husband\s+of\s+.*$/gi, "");
  
  // Remover "deceased" o "individually"
  clean = clean.replace(/,?\s+deceased/gi, "");
  clean = clean.replace(/,?\s+individually/gi, "");
  
  // Limpiar caracteres de puntuación sobrantes al final
  clean = clean.replace(/[\*\,\-\_\#\s]+$/, "");
  
  // Quitar comillas
  clean = clean.replace(/["']/g, "");
  
  // Normalizar espacios
  clean = clean.replace(/\s+/g, " ").trim();
  
  return clean;
}

/**
 * Scraper para las subastas del Sheriff de Clark County, IN
 */
async function scrapeClarkCounty() {
  console.log("[SCRAPER CLARK] Iniciando extracción de subastas de Clark County, IN...");
  const url = "https://www.clarkcosheriff.com/sheriff-sales/";
  
  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      timeout: 15000
    });
    
    const $ = cheerio.load(response.data);
    let currentDate = "Unknown Date 2026";
    let activeSavedCount = 0;
    
    // Extraeremos todos los elementos que contengan texto (p, span, div, strong)
    // para procesar el flujo secuencial de fechas y direcciones.
    const textElements: string[] = [];
    
    // Obtenemos los textos en orden
    $("p, span, strong").each((_, elem) => {
      const txt = cleanText($(elem).text());
      if (txt && !textElements.includes(txt)) {
        textElements.push(txt);
      }
    });
    
    console.log(`[SCRAPER CLARK] Procesando ${textElements.length} bloques de texto secuenciales...`);
    
    const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    
    let lastPlaintiff: string | null = null;
    let lastDefendant: string | null = null;
    
    for (let i = 0; i < textElements.length; i++) {
      const text = textElements[i];
      const textLower = text.toLowerCase();
      
      // 1. Detectar Cabeceras de Fechas (ej: "MAY / 19" o "JUNE/16")
      // Si la línea contiene un mes
      const matchedMonth = months.find(m => textLower.includes(m));
      if (matchedMonth) {
        // Podría estar dividido o consolidado. Ej: "JUNE/16"
        if (text.includes("/")) {
          currentDate = `${text} 2026`;
          console.log(`[SCRAPER CLARK] Fecha detectada: ${currentDate}`);
        } else if (i + 1 < textElements.length && textElements[i+1] === "/") {
          // Si es "MAY", "/" y luego "19"
          if (i + 2 < textElements.length) {
            currentDate = `${text} ${textElements[i+2]} 2026`;
            console.log(`[SCRAPER CLARK] Fecha detectada (compuesta): ${currentDate}`);
            i += 2; // saltar los siguientes dos bloques
          }
        } else if (text.split(/\s+/).length <= 3) {
          // Mes simple, podría ser cabecera de sección.
          currentDate = `${text} 2026`;
        }
        continue;
      }
      
      // 2. Detectar caso (Plaintiff vs. Defendant)
      const vsRegex = /\s+vs\.?\s+/i;
      if (vsRegex.test(text)) {
        const parts = text.split(vsRegex);
        if (parts.length >= 2) {
          lastPlaintiff = parts[0].trim();
          lastDefendant = cleanDefendant(parts[1]);
          console.log(`[SCRAPER CLARK] Caso detectado por patrón vs: Plaintiff="${lastPlaintiff}" | Defendant="${lastDefendant}"`);
        }
      } else if (textLower === "vs" || textLower === "vs.") {
        // Si el "vs" está separado en su propia línea
        if (i > 0 && i + 1 < textElements.length) {
          lastPlaintiff = textElements[i - 1].trim();
          lastDefendant = cleanDefendant(textElements[i + 1]);
          console.log(`[SCRAPER CLARK] Caso detectado por vs en línea: Plaintiff="${lastPlaintiff}" | Defendant="${lastDefendant}"`);
        }
      }
      
      // 3. Detectar Líneas de Propiedades
      // Buscamos si empieza con un número de calle y tiene una coma con ciudad de Clark County
      const startsWithNumber = /^\d+/.test(text);
      const containsClarkCity = CLARK_CITIES.some(c => textLower.includes(c));
      
      if (startsWithNumber && containsClarkCity) {
        // Verificar si está cancelada
        if (textLower.includes("cancelled") || textLower.includes("cancelled") || textLower.includes("c a n c e l l e d")) {
          // Ignorar las subastas canceladas
          continue;
        }
        
        // Formato esperado: "6559 ASHLEY SPRINGS CT., CHARLESTOWN"
        const parts = text.split(",");
        if (parts.length >= 2) {
          const streetAddress = parts[0].replace(/\.+$/, "").trim(); // Quitar puntos finales
          const city = parts[1].replace(/\*\*\*[^*]+\*\*\*/g, "").trim(); // Limpiar alertas de estado
          
          const auctionId = `IN_CLARK_${streetAddress.replace(/\s+/g, "_")}_${cleanText(currentDate).replace(/\s+/g, "_")}`;
          
          const plaintiffVal = lastPlaintiff || null;
          const defendantVal = lastDefendant || null;
          
          try {
            await db.execute({
              sql: `
                INSERT INTO foreclosure_auctions (
                  auction_id, case_number, address, county, state, auction_date,
                  plaintiff, defendant, mls_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_check')
                ON CONFLICT(auction_id) DO UPDATE SET
                  address = excluded.address,
                  auction_date = excluded.auction_date,
                  plaintiff = COALESCE(excluded.plaintiff, foreclosure_auctions.plaintiff),
                  defendant = COALESCE(excluded.defendant, foreclosure_auctions.defendant)
              `,
              args: [
                auctionId,
                "PENDING",
                `${streetAddress}, ${city}`,
                "Clark",
                "IN",
                cleanText(currentDate),
                plaintiffVal,
                defendantVal
              ]
            });
            activeSavedCount++;
            console.log(`[SUBASTA CLARK GUARDADA] Dirección: ${streetAddress}, ${city} | Defendant: ${defendantVal} | Fecha: ${currentDate}`);
            
            // Resetear para la siguiente propiedad
            lastPlaintiff = null;
            lastDefendant = null;
          } catch (dbErr) {
            console.error(`[DB ERROR] Error al guardar subasta de Clark County:`, dbErr);
          }
        }
      }
    }
    
    console.log(`[SCRAPER CLARK] Finalizado. Guardadas/Actualizadas: ${activeSavedCount} subastas.`);
  } catch (error: any) {
    console.error("[SCRAPER CLARK ERROR] Falló la extracción en Clark County:", error.message || error);
  }
}

/**
 * Scraper para las subastas del Sheriff de Floyd County, IN
 */
async function scrapeFloydCounty() {
  console.log("[SCRAPER FLOYD] Iniciando extracción de subastas de Floyd County, IN...");
  const ajaxUrl = "https://www.fcsdin.com/wp-admin/admin-ajax.php";
  const payload = new URLSearchParams({
    action: "gswpts_sheet_fetch",
    id: "5",
    nonce: "7a6095ba72"
  });
  
  try {
    const response = await axios.post(ajaxUrl, payload.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": "https://www.fcsdin.com/sheriffsales/"
      },
      timeout: 15000
    });
    
    if (response.status !== 200) {
      throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
    }
    
    const data = response.data;
    if (!data.success || !data.data || !data.data.output) {
      throw new Error("Respuesta AJAX fallida o sin datos de salida de la tabla.");
    }
    
    const $ = cheerio.load(data.data.output);
    let currentDate = "Unknown Date 2026";
    let activeSavedCount = 0;
    
    let lastPlaintiff: string | null = null;
    let lastDefendant: string | null = null;
    
    // Recorremos las filas de la tabla
    $("tr").each((_, trElem) => {
      const cells: string[] = [];
      $(trElem).find("td").each((_, tdElem) => {
        cells.push(cleanText($(tdElem).text()));
      });
      
      if (cells.length === 0) return;
      
      const non_empty = cells.filter(c => c);
      
      // 1. Detectar cabecera de fecha agrupada o caso
      if (non_empty.length === 1) {
        const val = non_empty[0];
        const valLower = val.toLowerCase();
        
        // Verificar si contiene "vs" o "vs." para Floyd
        const vsRegex = /\s+vs\.?\s+/i;
        if (vsRegex.test(val)) {
          const parts = val.split(vsRegex);
          if (parts.length >= 2) {
            lastPlaintiff = parts[0].trim();
            lastDefendant = cleanDefendant(parts[1]);
            console.log(`[SCRAPER FLOYD] Caso detectado en fila simple: Plaintiff="${lastPlaintiff}" | Defendant="${lastDefendant}"`);
          }
        } else {
          const isHeader = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "sales"].some(m => valLower.includes(m));
          if (isHeader && !valLower.includes("no sales")) {
            currentDate = val;
            console.log(`[SCRAPER FLOYD] Nueva fecha de subasta detectada: ${currentDate}`);
          }
        }
      }
      
      // 2. Fila de Propiedad
      // Columnas: ['', Address, City, State, Zip, Status]
      if (cells.length >= 5 && cells[1] && cells[2]) {
        const address = cells[1];
        const city = cells[2];
        const state = cells[3] || "IN";
        const zipCode = cells[4] || "";
        const status = cells[5] ? cells[5].toUpperCase().trim() : "";
        
        // Ignorar las propiedades canceladas (CANCELED)
        if (status.includes("CANCEL") || status.includes("RETIRADA")) {
          return;
        }
        
        // Ignorar filas de encabezado de fecha agrupadas
        if (address.toLowerCase() === currentDate.toLowerCase()) {
          return;
        }
        
        const fullAddress = `${address}, ${city}`;
        const auctionId = `IN_FLOYD_${address.replace(/\s+/g, "_")}_${currentDate.replace(/\s+/g, "_")}`;
        
        let plaintiffVal = lastPlaintiff || null;
        let defendantVal = lastDefendant || null;
        
        // Comprobar si hay "vs" en alguna celda de esta fila por si acaso
        const vsRegex = /\s+vs\.?\s+/i;
        for (const cell of cells) {
          if (vsRegex.test(cell)) {
            const parts = cell.split(vsRegex);
            if (parts.length >= 2) {
              plaintiffVal = parts[0].trim();
              defendantVal = cleanDefendant(parts[1]);
              console.log(`[SCRAPER FLOYD] Caso detectado en celda de fila de propiedad: Plaintiff="${plaintiffVal}" | Defendant="${defendantVal}"`);
            }
          }
        }
        
        // Insertar en la base de datos de Turso
        db.execute({
          sql: `
            INSERT INTO foreclosure_auctions (
              auction_id, case_number, address, county, state, auction_date,
              plaintiff, defendant, mls_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_check')
            ON CONFLICT(auction_id) DO UPDATE SET
              address = excluded.address,
              auction_date = excluded.auction_date,
              plaintiff = COALESCE(excluded.plaintiff, foreclosure_auctions.plaintiff),
              defendant = COALESCE(excluded.defendant, foreclosure_auctions.defendant)
          `,
          args: [
            auctionId,
            "PENDING",
            fullAddress,
            "Floyd",
            state,
            currentDate,
            plaintiffVal,
            defendantVal
          ]
        }).then(() => {
          activeSavedCount++;
          console.log(`[SUBASTA FLOYD GUARDADA] Dirección: ${fullAddress} | Defendant: ${defendantVal} | Fecha: ${currentDate}`);
        }).catch(dbErr => {
          console.error(`[DB ERROR] Error al guardar subasta de Floyd County:`, dbErr);
        });
        
        // Resetear para la siguiente propiedad
        lastPlaintiff = null;
        lastDefendant = null;
      }
    });
    
    // Esperar un momento para asegurar el procesamiento asíncrono de base de datos
    setTimeout(() => {
      console.log(`[SCRAPER FLOYD] Finalizado. Guardadas/Actualizadas: ${activeSavedCount} subastas.`);
    }, 1500);
    
  } catch (error: any) {
    console.error("[SCRAPER FLOYD ERROR] Falló la extracción en Floyd County:", error.message || error);
  }
}

/**
 * Función principal para correr ambos scrapers de Indiana
 */
async function scrapeIndiana() {
  console.log("\n========================================================");
  console.log("[INDIANA MAIN] Iniciando Extracción Completa de Indiana...");
  console.log("========================================================\n");
  
  await scrapeClarkCounty();
  await scrapeFloydCounty();
}

// Ejecutar si se corre directamente
if (require.main === module) {
  scrapeIndiana();
}

export { scrapeIndiana };
