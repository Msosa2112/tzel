import axios from "axios";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

// Valor de mercado de tierra residencial por pie cuadrado según código postal en Louisville
const LAND_VALUE_PER_SQFT_BY_ZIP: Record<string, number> = {
  "40202": 10.00,
  "40203": 7.50, // California / Old Louisville
  "40204": 12.00, // Highlands
  "40208": 6.50, // University
  "40210": 6.50, // Russell / Park Hill
  "40211": 5.50, // Shawnee
  "40212": 5.00, // Portland
  "40214": 5.50, // South End
  "40215": 5.00, // Taylor Berry / Hazelwood
  "40216": 5.50, // Shively
};
const DEFAULT_LAND_VAL_SQFT = 5.50;

export async function enrichLandbankLots(): Promise<{ total: number; matched: number }> {
  console.log("=================================================================");
  console.log("📐 [LOJIC GIS PVA] Enriqueciendo Terrenos con Metraje Real y Valuación...");
  console.log("=================================================================");

  const rowsRes = await db.execute(`
    SELECT parcel_id, address, buildable_lot, category
    FROM landbank_inventory
    WHERE property_type = 'Lot'
  `);

  const allLots = rowsRes.rows;
  console.log(`[LOJIC PVA] Total lotes a consultar: ${allLots.length}`);

  const pvaUrl = "https://gis.lojic.org/maps/rest/services/LojicSolutions/OpenDataPVA/MapServer/1/query";
  const BATCH_SIZE = 50;
  let totalMatched = 0;

  for (let i = 0; i < allLots.length; i += BATCH_SIZE) {
    const chunk = allLots.slice(i, i + BATCH_SIZE);
    const parcelIds = chunk.map(r => String(r.parcel_id || "").trim()).filter(Boolean);
    if (parcelIds.length === 0) continue;

    const where = `PARCELID IN ('${parcelIds.join("','")}')`;

    try {
      const resp = await axios.get(pvaUrl, {
        params: {
          where,
          outFields: "PARCELID,LRSN,SHAPE.AREA",
          f: "json"
        },
        timeout: 10000
      });

      const features = resp.data.features || [];
      const sqftMap = new Map<string, number>();

      for (const f of features) {
        const pid = f.attributes.PARCELID;
        const area = Number(f.attributes["SHAPE.AREA"] || 0);
        if (pid && area > 0) {
          sqftMap.set(pid, Math.round(area));
        }
      }

      // Actualizar base de datos
      for (const lot of chunk) {
        const pid = String(lot.parcel_id).trim();
        const sqft = sqftMap.get(pid) || 0;
        const acres = sqft > 0 ? Number((sqft / 43560).toFixed(3)) : null;

        // Extraer ZIP de la dirección
        const zipMatch = String(lot.address || "").match(/\b\d{5}\b/);
        const zip = zipMatch ? zipMatch[0] : "40212";
        const valPerSqft = LAND_VALUE_PER_SQFT_BY_ZIP[zip] || DEFAULT_LAND_VAL_SQFT;

        const isBuildable = String(lot.buildable_lot || "").toLowerCase() === "yes";

        let estimatedVal: number;
        if (sqft > 0) {
          totalMatched++;
          if (isBuildable) {
            // Valuación basada en metraje real x valor de zona (mínimo $12,000 para solar edificable)
            estimatedVal = Math.max(12000, Math.round(sqft * valPerSqft));
          } else {
            // Lote no edificable / Mow to Own (entre $1,500 y $5,000 según tamaño)
            estimatedVal = Math.min(5000, Math.max(1500, Math.round(sqft * (valPerSqft * 0.4))));
          }
        } else {
          // Si no se encontró en LOJIC, estimación conservadora
          estimatedVal = isBuildable ? 22000 : 3000;
        }

        await db.execute({
          sql: `
            UPDATE landbank_inventory
            SET sqft = ?, acres = ?, estimated_value = ?
            WHERE parcel_id = ?
          `,
          args: [sqft > 0 ? sqft : null, acres, estimatedVal, pid]
        });
      }

      console.log(`[LOJIC PVA] Procesado lote ${i + 1} a ${Math.min(i + BATCH_SIZE, allLots.length)} (Coincidentes: ${sqftMap.size}/${chunk.length})`);
    } catch (err: any) {
      console.error(`[LOJIC PVA ERROR] Error en lote ${i}:`, err.message);
    }
  }

  console.log(`✅ [LOJIC PVA] Metraje y valuación completada: ${totalMatched} de ${allLots.length} terrenos enriquecidos con datos catastrales exactos.`);
  return { total: allLots.length, matched: totalMatched };
}

if (process.argv[1] && process.argv[1].includes("enrich_landbank_sqft")) {
  enrichLandbankLots()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
