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

// Palabras clave de alto estrés para identificar oportunidades
const STRESS_KEYWORDS = [
  "boarded",
  "unsafe",
  "tall grass",
  "weed",
  "maintenance",
  "cleaning",
  "dangerous",
  "structure",
  "roof"
];

function cleanAddress(addr: string): string {
  if (!addr) return "";
  
  // 1. Separar por coma y tomar la primera parte (la calle)
  const parts = addr.split(",");
  let street = parts[0].trim();
  
  // 2. Limpiar sufijos comunes (Ave, St, Rd, Dr, Ln, Ct, Blvd, Pl, Way, Cir, Ter, Hwy)
  const streetParts = street.split(/\s+/);
  if (streetParts.length > 1) {
    const lastWord = streetParts[streetParts.length - 1].toLowerCase().replace(/[^a-z]/g, "");
    const suffixes = [
      "st", "street", "ave", "avenue", "rd", "road", "ln", "lane", "dr", "drive", 
      "ct", "court", "blvd", "boulevard", "way", "pl", "place", "cir", "circle", 
      "ter", "terrace", "trl", "trail", "pkwy", "parkway"
    ];
    if (suffixes.includes(lastWord)) {
      streetParts.pop();
      street = streetParts.join(" ");
    }
  }
  
  // 3. Volver a unir con el resto de la dirección
  if (parts.length > 1) {
    const remaining = parts.slice(1).map(p => p.trim()).join(", ");
    return `${street}, ${remaining}`.replace(/\s+/g, " ").trim();
  }
  return street.replace(/\s+/g, " ").trim();
}

/**
 * Scraper para las violaciones de código de Louisville Metro
 */
async function scrapeCodeViolations() {
  console.log("[METRO311] Iniciando extracción de violaciones de código de Louisville Metro...");
  
  const url = "https://services1.arcgis.com/79kfd2K6fskCAkyg/arcgis/rest/services/PM_SiteVisit_Violations/FeatureServer/0/query";
  const params = {
    where: "1=1",
    outFields: "ObjectId,B1_ALT_ID,FullAddress,G6A_G6_COMPL_DD,G6A_G6_STATUS,GUIDE_ITEM_TEXT,VIOLATION_CODE,PARCEL_ID",
    orderByFields: "ObjectId DESC",
    resultRecordCount: "200",
    f: "json"
  };

  try {
    const response = await axios.get(url, {
      params,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      timeout: 15000
    });

    if (response.status !== 200 || !response.data || !response.data.features) {
      throw new Error(`Respuesta inválida de ArcGIS Server: Estatus ${response.status}`);
    }

    const features = response.data.features;
    console.log(`[METRO311] Se obtuvieron ${features.length} registros recientes de la API.`);

    let processedCount = 0;
    let savedCount = 0;

    for (const feature of features) {
      const attr = feature.attributes;
      if (!attr || !attr.B1_ALT_ID || !attr.FullAddress || !attr.GUIDE_ITEM_TEXT) {
        continue;
      }

      const typeLower = attr.GUIDE_ITEM_TEXT.toLowerCase();
      const isHighStress = STRESS_KEYWORDS.some(keyword => typeLower.includes(keyword));

      if (!isHighStress) {
        // Saltar violaciones que no generen estrés inmobiliario relevante
        continue;
      }

      processedCount++;

      // Formatear ID único combinando caso y código de infracción
      const violationCode = attr.VIOLATION_CODE || "UNKNOWN";
      const violationId = `${attr.B1_ALT_ID}_${violationCode}`;

      // Formatear fecha de reporte (de timestamp ms a YYYY-MM-DD)
      let reportDateStr: string | null = null;
      if (attr.G6A_G6_COMPL_DD) {
        try {
          reportDateStr = new Date(attr.G6A_G6_COMPL_DD).toISOString().split("T")[0];
        } catch (e) {
          // Ignorar fallo de formato
        }
      }

      const normalizedAddress = cleanAddress(attr.FullAddress);

      // Imprimir log temporal de verificación requerido por especificación
      console.log(`[METRO311] Violación detectada: "${attr.GUIDE_ITEM_TEXT}" en "${normalizedAddress}"`);

      // Guardar/Upsert en la base de datos de Turso
      try {
        await db.execute({
          sql: `
            INSERT INTO code_violations (
              violation_id, case_number, address, violation_type, report_date, status, owner_name, mls_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_check')
            ON CONFLICT(violation_id) DO UPDATE SET
              address = excluded.address,
              violation_type = excluded.violation_type,
              status = excluded.status,
              report_date = excluded.report_date,
              owner_name = CASE 
                WHEN code_violations.owner_name IS NULL OR code_violations.owner_name = 'DUEÑO DESCONOCIDO' 
                THEN excluded.owner_name 
                ELSE code_violations.owner_name 
              END
          `,
          args: [
            violationId,
            attr.B1_ALT_ID,
            normalizedAddress,
            attr.GUIDE_ITEM_TEXT,
            reportDateStr,
            attr.G6A_G6_STATUS || null,
            "DUEÑO DESCONOCIDO"
          ]
        });
        savedCount++;
      } catch (dbErr: any) {
        console.error(`[DB ERROR] No se pudo guardar la violación ${violationId}:`, dbErr.message);
      }
    }

    console.log("\n========================================================");
    console.log("RESUMEN DE EXTRACCIÓN METRO311 (LOUISVILLE VIOLATIONS):");
    console.log(`- Violaciones relevantes filtradas: ${processedCount}`);
    console.log(`- Guardadas/Actualizadas en Turso: ${savedCount}`);
    console.log("========================================================\n");

  } catch (error: any) {
    console.error("[METRO311 ERROR] Falló la extracción en Louisville Metro:", error.message || error);
  }
}

// Ejecutar si se corre directamente
if (require.main === module) {
  scrapeCodeViolations().catch(console.error);
}

export { scrapeCodeViolations };
