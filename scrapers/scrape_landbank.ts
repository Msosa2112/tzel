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
  console.log("🏛️ [LANDBANK / VAP] Consultando Inventario Oficial de Louisville Metro (Terrenos y Estructuras)...");
  console.log("=================================================================");

  const baseUrl = "https://services1.arcgis.com/79kfd2K6fskCAkyg/arcgis/rest/services/Landbank_Inventory_w_Categories_July_2026/FeatureServer/0/query";

  let totalRecords = 0;
  let savedCount = 0;
  let lotsCount = 0;
  let structuresCount = 0;

  try {
    // Consultar todo el inventario oficial (tanto Lotes/Terrenos como Estructuras) con coordenadas GPS WGS84
    const params = new URLSearchParams({
      where: "1=1",
      outFields: "*",
      returnGeometry: "true",
      outSR: "4326",
      f: "json",
      resultRecordCount: "1200"
    });

    const resp = await fetch(`${baseUrl}?${params.toString()}`);
    if (!resp.ok) {
      throw new Error(`HTTP error ${resp.status} al consultar FeatureServer del Landbank`);
    }

    const data = await resp.json();
    const features: { attributes: LandbankRecord; geometry?: { x: number; y: number } }[] = data.features || [];
    totalRecords = features.length;
    console.log(`[LANDBANK] Se encontraron ${totalRecords} registros en el inventario oficial del Landbank.`);

    for (const f of features) {
      const attr = f.attributes;
      if (!attr.Street_Address) continue;

      const rawAddr = attr.Street_Address.trim();
      const zip = Number(attr.Postal_Code) || 40212;
      const fullAddress = `${rawAddr}, Louisville, KY ${zip}`;
      const parcelId = (attr.Parcel_No_ || "").trim();
      const category = attr.Category || "Available";
      const status = attr.Property_Status || "Unknown";
      const invType = (attr.Inventory_Type || "").toLowerCase().includes("lot") ? "Lot" : "Structure";
      const buildable = attr.Buildable_Lot || (invType === "Lot" ? "Yes" : "N/A");
      const councilDistrict = attr.Council_District ? Number(attr.Council_District) : null;
      
      const lat = f.geometry ? f.geometry.y : null;
      const lon = f.geometry ? f.geometry.x : null;

      const isAvailable = /available|pre-market|pre-hof/i.test(category) || /available|pre-market|pre-hof/i.test(status);
      const isHighYield = isAvailable ? 1 : 0;

      // Estimación del precio de adquisición bajo programas oficiales de Louisville Landbank
      let askingPrice = 1000;
      let estimatedValue = 25000;

      if (invType === "Lot") {
        lotsCount++;
        if (/unbuildable/i.test(category) || buildable === "No") {
          // Lote no edificable / Mow to Own / Adjoining Side Yard
          askingPrice = 500;
          estimatedValue = 3500;
        } else if (/dollar/i.test(category) || /pre-hof/i.test(status)) {
          askingPrice = 1;
          estimatedValue = 20000;
        } else {
          // Lote edificable residencial para nuevo desarrollo Infill
          askingPrice = 1000;
          estimatedValue = 28000;
        }
      } else {
        structuresCount++;
        // Estructura (casa o edificio para rehabilitación)
        if (/dollar/i.test(category) || /pre-hof/i.test(status)) {
          askingPrice = 1;
        } else if (/pre-market/i.test(status)) {
          askingPrice = 3000;
        } else {
          askingPrice = 5000;
        }
        estimatedValue = 115000;
      }

      // Guardar en tabla landbank_inventory
      await db.execute({
        sql: `
          INSERT INTO landbank_inventory (
            parcel_id, address, asking_price, estimated_value, property_type,
            program_name, buildable_lot, council_district, category, property_status,
            lat, lon, county, state, is_high_yield, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Jefferson', 'KY', ?, CURRENT_TIMESTAMP)
          ON CONFLICT(parcel_id) DO UPDATE SET
            address = excluded.address,
            asking_price = excluded.asking_price,
            estimated_value = excluded.estimated_value,
            property_type = excluded.property_type,
            program_name = excluded.program_name,
            buildable_lot = excluded.buildable_lot,
            council_district = excluded.council_district,
            category = excluded.category,
            property_status = excluded.property_status,
            lat = excluded.lat,
            lon = excluded.lon,
            is_high_yield = excluded.is_high_yield
        `,
        args: [
          parcelId,
          fullAddress,
          askingPrice,
          estimatedValue,
          invType,
          `${category} | Status: ${status}`,
          buildable,
          councilDistrict,
          category,
          status,
          lat,
          lon,
          isHighYield
        ]
      });

      // Si tenemos coordenadas GPS exactas de ArcGIS, precargar en geocode_cache
      if (lat && lon) {
        await db.execute({
          sql: `INSERT OR REPLACE INTO geocode_cache (address, lat, lon) VALUES (?, ?, ?)`,
          args: [fullAddress, lat, lon]
        });
      }

      // Para estructuras vacantes con daño físico, registrar en physical_distress
      if (invType === "Structure") {
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
            `Propiedad municipal del Landbank. Tipo: Estructura | Programa: ${category} (${status}) | Precio adquisición: $${askingPrice}`,
            estimatedValue,
            isHighYield
          ]
        });
      }

      savedCount++;
    }

    console.log(`✅ [LANDBANK] Guardados ${savedCount} registros en Turso (${lotsCount} Terrenos/Lots, ${structuresCount} Estructuras) con coordenadas GPS.`);
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
