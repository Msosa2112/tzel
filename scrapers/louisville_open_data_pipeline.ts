import * as crypto from "crypto";
import axios from "axios";
import csvParser from "csv-parser";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

/**
 * Pipeline de procesamiento diario de datos abiertos de Louisville Metro.
 * Descarga en streaming y mapea casos de habitabilidad, construcción peligrosa,
 * demoliciones y estructuras abandonadas a la tabla 'physical_distress'.
 */
export async function runLouisvilleOpenDataPipeline() {
  console.log("[METRO PIPELINE] Iniciando pipeline de datos abiertos de Louisville Metro...");

  const pipelines = [
    {
      name: "Habitabilidad (Violations)",
      url: "https://opendata.arcgis.com/api/v3/datasets/3df35fbf63734b4db46d90a501a35759_0/downloads/data?format=csv&spatialRefId=4326",
      type: "Property Maintenance Violation",
      mapping: (row: any) => ({
        address: row.address || row.location || row.property_address || row.street_address,
        parcel: row.parcel_id || row.parcel || row.parcelid,
        details: `Violación: ${row.violation_description || row.description || "N/A"} | Estado: ${row.status || row.order_status || "Open"}`,
        reportDate: row.inspection_date || row.date_opened || row.created_date || new Date().toISOString().split("T")[0]
      })
    },
    {
      name: "Casos de Construcción Peligrosa",
      url: "https://opendata.arcgis.com/api/v3/datasets/7c8d9e7943d04768b75e7a96a32d1ef1_0/downloads/data?format=csv&spatialRefId=4326",
      type: "Dangerous Building Case",
      mapping: (row: any) => ({
        address: row.address || row.property_address || row.street_address || row.location,
        parcel: row.parcel_id || row.parcel || row.parcelid,
        details: `Caso Abierto Code Enforcement. Estado: ${row.case_status || row.status || "Active"} | Tipo: ${row.case_type || "Peligroso"}`,
        reportDate: row.case_date || row.open_date || new Date().toISOString().split("T")[0]
      })
    },
    {
      name: "Lista de Demoliciones en Progreso",
      url: "https://opendata.arcgis.com/api/v3/datasets/c2642be4e2ef48c68b6b0a8805c8791c_0/downloads/data?format=csv&spatialRefId=4326",
      type: "Demolition in Progress",
      mapping: (row: any) => ({
        address: row.address || row.property_address || row.street_address,
        parcel: row.parcel_id || row.parcel || row.parcelid,
        details: `Estructura declarada en peligro inminente de demolición. Contratista: ${row.contractor || "N/A"}`,
        reportDate: row.demolition_date || row.date_issued || new Date().toISOString().split("T")[0]
      })
    },
    {
      name: "Estructuras Abandonadas",
      url: "https://opendata.arcgis.com/api/v3/datasets/0e35e77064ba9b9eac2106885df85341_0/downloads/data?format=csv&spatialRefId=4326",
      type: "Abandoned Structure",
      mapping: (row: any) => ({
        address: row.address || row.property_address || row.street_address,
        parcel: row.parcel_id || row.parcel || row.parcelid,
        details: `Registrado en el listado oficial de propiedades abandonadas. Estado de abandono verificado.`,
        reportDate: row.registration_date || new Date().toISOString().split("T")[0]
      })
    }
  ];

  for (const pipe of pipelines) {
    try {
      console.log(`\n[METRO PIPELINE] Descargando y analizando en stream: ${pipe.name}...`);
      const response = await axios({
        method: "get",
        url: pipe.url,
        responseType: "stream",
        timeout: 45000
      });

      await new Promise<void>((resolve, reject) => {
        let count = 0;
        response.data
          .pipe(csvParser())
          .on("data", async (row: any) => {
            const mapped = pipe.mapping(row);
            if (mapped.address) {
              const cleanAddr = String(mapped.address).trim();
              const cleanDetails = String(mapped.details).trim();
              const cleanDate = String(mapped.reportDate).trim();
              const distressId = "PD_" + crypto.createHash("md5").update(`${cleanAddr}_${pipe.type}`).digest("hex");

              await db.execute({
                sql: `
                  INSERT INTO physical_distress (
                    distress_id, address, county, state, distress_type, report_date, details, mls_status
                  ) VALUES (?, ?, 'Jefferson', 'KY', ?, ?, ?, 'pending_check')
                  ON CONFLICT(distress_id) DO UPDATE SET
                    details = excluded.details,
                    report_date = excluded.report_date
                `,
                args: [
                  distressId,
                  cleanAddr,
                  pipe.type,
                  cleanDate,
                  cleanDetails
                ]
              }).catch(() => {});
              count++;
            }
          })
          .on("end", () => {
            console.log(`[METRO PIPELINE] Procesados ${count} registros de: ${pipe.name}`);
            resolve();
          })
          .on("error", (err: any) => {
            reject(err);
          });
      });

    } catch (err: any) {
      console.error(`[METRO PIPELINE ERROR] Falló la descarga de ${pipe.name}:`, err.message);
    }
  }
  console.log("\n[METRO PIPELINE] Pipeline de datos de Louisville finalizado.");
}
