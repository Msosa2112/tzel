import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

export interface LandbankRecord {
  Category: string;
  Parcel_No_: string;
  Street_Address: string;
  Postal_Code: number | string;
  Property_Status: string;
  Property_Status_Date?: number;
  Inventory_Type: string;
  Council_District?: number;
  Buildable_Lot?: string;
  ObjectId: number;
}

/**
 * Scraper del Louisville Metro Landbank Authority (VAP).
 * Extrae el inventario oficial en tiempo real desde el FeatureServer de ArcGIS de Louisville Metro.
 * Prioriza estructuras disponibles (Dollar Homes, Direct Sale, Pre-Market, Pre-HOF)
 * en los códigos postales de alta rentabilidad de West y South Louisville.
 */
export async function scrapeLandbank(): Promise<number> {
  console.log("=================================================================");
  console.log("🏛️ [LANDBANK / VAP] Consultando Inventario Oficial de Louisville Metro...");
  console.log("=================================================================");

  const targetZips = [40212, 40211, 40210, 40215, 40214, 40203, 40208];
  const baseUrl = "https://services1.arcgis.com/79kfd2K6fskCAkyg/arcgis/rest/services/Landbank_Inventory_w_Categories_July_2026/FeatureServer/0/query";

  let totalStructures = 0;
  let savedCount = 0;

  try {
    // 1. Consultar todas las estructuras (casas/edificios)
    const whereClause = "Inventory_Type like '%Structure%'";
    const params = new URLSearchParams({
      where: whereClause,
      outFields: "*",
      f: "json",
      resultRecordCount: "200"
    });

    const resp = await fetch(`${baseUrl}?${params.toString()}`);
    if (!resp.ok) {
      throw new Error(`HTTP error ${resp.status} al consultar FeatureServer del Landbank`);
    }

    const data = await resp.json();
    const features: { attributes: LandbankRecord }[] = data.features || [];
    totalStructures = features.length;
    console.log(`[LANDBANK] Se encontraron ${totalStructures} estructuras en el inventario del Landbank.`);

    for (const f of features) {
      const attr = f.attributes;
      if (!attr.Street_Address) continue;

      const rawAddr = attr.Street_Address.trim();
      const zip = Number(attr.Postal_Code) || 40212;
      const fullAddress = `${rawAddr}, Louisville, KY ${zip}`;
      const parcelId = (attr.Parcel_No_ || "").trim();
      const category = attr.Category || "Available";
      const status = attr.Property_Status || "Unknown";
      const isAvailable = /available|pre-market|pre-hof/i.test(category) || /available|pre-market|pre-hof/i.test(status);
      const isHighYield = isAvailable ? 1 : 0;

      // Estimación del precio de adquisición bajo programas Landbank
      // Dollar Homes: $1; Direct Sale / Pre-Market: $2,500 - $5,000
      let askingPrice = 5000;
      if (/dollar/i.test(category) || /pre-hof/i.test(status)) {
        askingPrice = 1;
      } else if (/pre-market/i.test(status)) {
        askingPrice = 3000;
      }

      // Valor de mercado estimado típico en la zona para ARV post-rehab
      const estimatedValue = 115000;

      await db.execute({
        sql: `
          INSERT INTO landbank_inventory (
            parcel_id, address, asking_price, estimated_value, property_type,
            program_name, county, state, is_high_yield, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'Jefferson', 'KY', ?, CURRENT_TIMESTAMP)
          ON CONFLICT(parcel_id) DO UPDATE SET
            address = excluded.address,
            asking_price = excluded.asking_price,
            program_name = excluded.program_name,
            is_high_yield = excluded.is_high_yield
        `,
        args: [
          parcelId,
          fullAddress,
          askingPrice,
          estimatedValue,
          "Structure",
          `${category} | Status: ${status}`,
          isHighYield
        ]
      });

      // También registramos en physical_distress para que el CRM y el dashboard lo muestren de inmediato
      const distressId = `LB_${parcelId.replace(/[^a-zA-Z0-9]/g, "")}`;
      await db.execute({
        sql: `
          INSERT INTO physical_distress (
            distress_id, address, county, state, distress_type, report_date, details,
            mls_status, mls_estimated_value, is_high_yield
          ) VALUES (?, ?, 'Jefferson', 'KY', 'Landbank VAP Structure', CURRENT_DATE, ?, 'available', ?, ?)
          ON CONFLICT(distress_id) DO UPDATE SET
            details = excluded.details,
            is_high_yield = excluded.is_high_yield
        `,
        args: [
          distressId,
          fullAddress,
          `Propiedad municipal del Landbank. Tipo: Estructura | Programa: ${category} (${status}) | Precio adquisición estimado: $${askingPrice}`,
          estimatedValue,
          isHighYield
        ]
      });

      savedCount++;
    }

    console.log(`✅ [LANDBANK] Guardadas ${savedCount} estructuras en la base de datos (Turso).`);
  } catch (err: any) {
    console.error(`❌ [LANDBANK ERROR] Error al consultar Landbank:`, err.message);
  }

  return savedCount;
}

if (process.argv[1] && process.argv[1].includes("scrape_landbank")) {
  scrapeLandbank()
    .then((count) => {
      console.log(`[TEST LANDBANK] Proceso completado. Registros: ${count}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
