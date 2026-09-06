import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import * as crypto from "crypto";

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

export interface DemolitionRecord {
  Street_Address: string;
  Demo_Type: string;
  Structural_Demo_Candidate_: string;
  Demo_Status: string;
  Status: string;
  Date_Updated?: number;
  Parcel_ID: string;
  Zip: number | string;
  Neighborhood?: string;
  Council__?: number;
  Down___Clear?: number | null;
  ObjectId: number;
}

/**
 * Scraper oficial de Demoliciones en Progreso y Órdenes de Emergencia de Louisville Metro.
 * Consulta la capa en tiempo real de ArcGIS de Louisville Metro para identificar propiedades
 * bajo orden de demolición inminente donde la estructura AÚN NO ha sido derribada (Down___Clear IS NULL).
 * 
 * Estas propiedades representan la mayor urgencia para los propietarios:
 * Tienen 30 días para rehabilitar o vender antes de que la ciudad las demuela
 * y les imponga un gravamen de $15,000+ sobre el terreno.
 */
export async function scrapeDemolitions(): Promise<number> {
  console.log("=================================================================");
  console.log("🏚️ [DEMOLITIONS & BOARD-UPS] Consultando Órdenes de Demolición de Louisville Metro...");
  console.log("=================================================================");

  const baseUrl = "https://services1.arcgis.com/79kfd2K6fskCAkyg/arcgis/rest/services/2021_Present_Demolitions/FeatureServer/0/query";
  let savedCount = 0;

  try {
    // Filtrar estructuras que aún NO han sido despejadas/demolidas en su totalidad
    // o que están en estatus "Posted" / "In Progress" / "Candidate"
    const whereClause = "Down___Clear IS NULL OR Demo_Status like '%In Progress%' OR Status like '%Posted%'";
    const params = new URLSearchParams({
      where: whereClause,
      outFields: "*",
      f: "json",
      resultRecordCount: "250",
      orderByFields: "ObjectId DESC"
    });

    const resp = await fetch(`${baseUrl}?${params.toString()}`);
    if (!resp.ok) {
      throw new Error(`HTTP error ${resp.status} al consultar Demolitions FeatureServer`);
    }

    const data = await resp.json();
    const features: { attributes: DemolitionRecord }[] = data.features || [];
    console.log(`[DEMOLITIONS] Se obtuvieron ${features.length} casos de demolición potencial de la API.`);

    const targetZips = [40212, 40211, 40210, 40215, 40214, 40203, 40208];

    for (const f of features) {
      const attr = f.attributes;
      if (!attr.Street_Address) continue;

      const rawAddr = attr.Street_Address.replace(/\s+/g, " ").trim();
      const zip = Number(attr.Zip) || 40212;
      const fullAddress = `${rawAddr}, Louisville, KY ${zip}`;
      const parcelId = (attr.Parcel_ID || "").trim();
      const demoType = attr.Demo_Type || "Structural";
      const demoStatus = attr.Demo_Status || "Pending";
      const status = attr.Status || "Posted";

      const isTargetZip = targetZips.includes(zip);
      const isCandidate = attr.Structural_Demo_Candidate_ === "TRUE" || /in progress|posted/i.test(demoStatus) || /posted/i.test(status);
      const isHighYield = (isTargetZip && isCandidate) ? 1 : 0;

      const distressId = "DEMO_" + crypto.createHash("md5").update(`${fullAddress}_DEMO`).digest("hex").slice(0, 16);

      let reportDateStr = new Date().toISOString().split("T")[0];
      if (attr.Date_Updated) {
        try {
          reportDateStr = new Date(attr.Date_Updated).toISOString().split("T")[0];
        } catch {
          // fallback
        }
      }

      const details = `Orden de Demolición Metro Louisville. Tipo: ${demoType} | Estado Demo: ${demoStatus} | Estatus: ${status} | Barrio: ${attr.Neighborhood || "N/A"}`;

      await db.execute({
        sql: `
          INSERT INTO physical_distress (
            distress_id, address, county, state, distress_type, report_date, details,
            mls_status, mls_estimated_value, is_high_yield
          ) VALUES (?, ?, 'Jefferson', 'KY', 'Demolition Candidate', ?, ?, 'pending_check', 95000, ?)
          ON CONFLICT(distress_id) DO UPDATE SET
            details = excluded.details,
            report_date = excluded.report_date,
            is_high_yield = excluded.is_high_yield
        `,
        args: [
          distressId,
          fullAddress,
          reportDateStr,
          details,
          isHighYield
        ]
      });

      savedCount++;
    }

    console.log(`✅ [DEMOLITIONS] Guardados ${savedCount} registros de demolición activa en 'physical_distress'.`);
  } catch (err: any) {
    console.error(`❌ [DEMOLITIONS ERROR] Error al consultar demoliciones:`, err.message);
  }

  return savedCount;
}

if (process.argv[1] && process.argv[1].includes("scrape_demolitions_and_code")) {
  scrapeDemolitions()
    .then((c) => {
      console.log(`[TEST DEMOLITIONS] Finalizado. Registros procesados: ${c}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
