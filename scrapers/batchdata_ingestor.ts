import { createClient } from "@libsql/client";
import { BatchDataClient } from "./batchdata_client";
import * as dotenv from "dotenv";

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

const batchDataClient = new BatchDataClient();

// Lista de condados y estados objetivo
const TARGET_REGIONS = [
  { state: "KY", county: "Jefferson" },
  { state: "KY", county: "Oldham" },
  { state: "KY", county: "Bullitt" },
  { state: "KY", county: "Shelby" },
  { state: "IN", county: "Clark" },
  { state: "IN", county: "Floyd" },
  { state: "IN", county: "Harrison" }
];

// Paso 2: Palabras clave críticas de daño de infraestructura severo para los permisos
const SEVERE_PERMIT_KEYWORDS = [
  "fire",
  "burn",
  "demolition",
  "foundation repair",
  "structural damage",
  "roof structural",
  "collapse",
  "boarded"
];

function isSeverePermit(description: string): boolean {
  if (!description) return false;
  const descLower = description.toLowerCase();
  return SEVERE_PERMIT_KEYWORDS.some(kw => descLower.includes(kw));
}

export async function runBatchDataIngestor() {
  if (process.env.USE_BATCHDATA === "false" || !process.env.USE_BATCHDATA) {
    console.log("⏸️ [BATCHDATA INGESTOR] BatchData está temporalmente desactivado por configuración (USE_BATCHDATA=false). Saltando.");
    return;
  }

  console.log("===============================================================");
  console.log("🚀 INICIANDO INGESTOR DE PARIDAD BATCHDATA (JURISDICCIÓN KY/IN) 🚀");
  console.log("===============================================================");

  let foreclosureCount = 0;
  let financialCount = 0;
  let physicalCount = 0;

  for (const region of TARGET_REGIONS) {
    console.log(`\n[BATCHDATA] Procesando: ${region.county} County, ${region.state}...`);
    
    // 1. Buscar propiedades en el condado
    const searchRes = await batchDataClient.searchProperties(region.state, region.county);
    if (!searchRes.success || !searchRes.results || searchRes.results.length === 0) {
      console.log(`[BATCHDATA] No se encontraron resultados en ${region.county}, ${region.state}.`);
      continue;
    }

    console.log(`[BATCHDATA] Se encontraron ${searchRes.results.length} propiedades. Consultando detalles all-attributes...`);

    // Preparar requests de lookup
    const lookupRequests = searchRes.results.map((p: any) => ({
      apn: p.apn,
      address: {
        street: p.address.street,
        city: p.address.city,
        state: p.address.state,
        zip: p.address.zip
      }
    }));

    // Ejecutar lookup
    const lookupRes = await batchDataClient.lookupPropertyAllAttributes(lookupRequests);
    if (!lookupRes.success || !lookupRes.results) {
      console.error(`[BATCHDATA ERROR] Falló la consulta all-attributes en ${region.county}, ${region.state}`);
      continue;
    }

    for (const prop of lookupRes.results) {
      const addressStr = `${prop.address.street}, ${prop.address.city}, ${prop.address.state} ${prop.address.zip}`;
      const apn = prop.apn || "";
      const ownerName = prop.owners && prop.owners.length > 0 ? prop.owners[0].fullName : "DUEÑO DESCONOCIDO";
      const mailingAddr = prop.owners && prop.owners.length > 0 && prop.owners[0].mailingAddress
        ? `${prop.owners[0].mailingAddress.street}, ${prop.owners[0].mailingAddress.city}, ${prop.owners[0].mailingAddress.state} ${prop.owners[0].mailingAddress.zip}`
        : null;

      // ==========================================
      // A) PRE-SUBASTAS (foreclosure)
      // ==========================================
      if (prop.foreclosure) {
        const fc = prop.foreclosure;
        const fcStatusLower = (fc.foreclosureStatus || "").toLowerCase();
        
        // Registrar solo si está activo/demanda activa
        if (fcStatusLower === "active" || fcStatusLower === "notice of default" || fcStatusLower === "notice of sale" || fcStatusLower === "lis pendens") {
          const auctionId = `BATCH_${region.state}_${region.county.substring(0,4).toUpperCase()}_${apn || addressStr.replace(/[^a-zA-Z0-9]/g, "")}`;
          const caseNumber = fc.caseNumber || "PENDING";
          
          console.log(`   [PRE-FORECLOSURE DETECTADA] Dirección: ${addressStr} | Caso: ${caseNumber}`);

          await db.execute({
            sql: `
              INSERT INTO foreclosure_auctions (
                auction_id, case_number, address, county, state, auction_date,
                plaintiff, defendant, debt_amount, mls_status, title_check_status,
                mailing_address, created_at
              ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, 'pending_check', 'pending', ?, CURRENT_TIMESTAMP)
              ON CONFLICT(auction_id) DO UPDATE SET
                case_number = excluded.case_number,
                plaintiff = excluded.plaintiff,
                defendant = excluded.defendant,
                mailing_address = excluded.mailing_address
            `,
            args: [
              auctionId,
              caseNumber,
              addressStr,
              region.county,
              region.state,
              fc.plaintiff || "WELLS FARGO",
              fc.defendant || ownerName,
              fc.defaultAmount || 0,
              mailingAddr
            ]
          });
          foreclosureCount++;
        }
      }

      // ==========================================
      // B) DEUDAS DE IMPUESTOS Y GRAVÁMENES (mortgage-liens)
      // ==========================================
      const ml = prop["mortgage-liens"];
      if (ml) {
        const taxLiens = ml.taxLiens || [];
        const judgements = ml.judgements || [];
        const hoaLiens = ml.hoaLiens || [];

        // Combinar todos los estresores financieros
        const financialRecords = [
          ...taxLiens.map((l: any) => ({ type: "Tax Lien", amount: l.amount, date: l.recordingDate, plaintiff: l.plaintiff })),
          ...judgements.map((j: any) => ({ type: "Judgment", amount: j.amount, date: j.recordingDate, plaintiff: j.plaintiff })),
          ...hoaLiens.map((h: any) => ({ type: "HOA Dues", amount: h.amount, date: h.recordingDate, plaintiff: h.plaintiff }))
        ];

        for (let i = 0; i < financialRecords.length; i++) {
          const rec = financialRecords[i];
          const recordId = `FD_BATCH_${region.state}_${region.county.substring(0,4).toUpperCase()}_${apn || addressStr.replace(/[^a-zA-Z0-9]/g, "")}_${i}`;
          
          console.log(`   [FINANCIAL DISTRESS DETECTADO] Dirección: ${addressStr} | Tipo: ${rec.type} | Monto: $${rec.amount}`);

          await db.execute({
            sql: `
              INSERT INTO financial_distress (
                record_id, case_number, address, county, state, record_type,
                debt_amount, owner_name, plaintiff, report_date, mls_status,
                mailing_address, created_at
              ) VALUES (?, 'PENDING', ?, ?, ?, ?, ?, ?, ?, ?, 'pending_check', ?, CURRENT_TIMESTAMP)
              ON CONFLICT(record_id) DO UPDATE SET
                debt_amount = excluded.debt_amount,
                owner_name = excluded.owner_name,
                plaintiff = excluded.plaintiff,
                report_date = excluded.report_date
            `,
            args: [
              recordId,
              addressStr,
              region.county,
              region.state,
              rec.type,
              rec.amount || 0,
              ownerName,
              rec.plaintiff || "County Clerk",
              rec.date || null,
              mailingAddr
            ]
          });
          financialCount++;
        }
      }

      // ==========================================
      // C) PERMISOS DE DAÑOS ESTRUCTURALES REALES (permit)
      // ==========================================
      const permits = prop.permit || [];
      for (let i = 0; i < permits.length; i++) {
        const perm = permits[i];
        const description = perm.description || "";
        
        // Aplicar regla de exclusión estricta de palabras clave (Paso 2.2)
        if (isSeverePermit(description)) {
          const distressId = `PD_BATCH_${region.state}_${region.county.substring(0,4).toUpperCase()}_${apn || addressStr.replace(/[^a-zA-Z0-9]/g, "")}_${i}`;
          
          console.log(`   [PHYSICAL DISTRESS DETECTADO] Dirección: ${addressStr} | Permiso: ${perm.permitNumber} - Severe`);

          await db.execute({
            sql: `
              INSERT INTO physical_distress (
                distress_id, address, county, state, distress_type,
                report_date, details, owner_name, mls_status,
                mailing_address, created_at
              ) VALUES (?, ?, ?, ?, 'Building Permit Issue', ?, ?, ?, 'pending_check', ?, CURRENT_TIMESTAMP)
              ON CONFLICT(distress_id) DO UPDATE SET
                details = excluded.details,
                owner_name = excluded.owner_name,
                report_date = excluded.report_date
            `,
            args: [
              distressId,
              addressStr,
              region.county,
              region.state,
              perm.issueDate || null,
              description,
              ownerName,
              mailingAddr
            ]
          });
          physicalCount++;
        } else {
          console.log(`   [PHYSICAL EXCLUDED] Permiso ${perm.permitNumber} en ${addressStr} descartado (sin daño estructural severo).`);
        }
      }
    }
  }

  console.log("\n===============================================================");
  console.log("✅ INGESTOR BATCHDATA COMPLETADO ✅");
  console.log(`- Pre-Subastas añadidas: ${foreclosureCount}`);
  console.log(`- Estrés Financiero añadido: ${financialCount}`);
  console.log(`- Estrés Físico (Severo) añadido: ${physicalCount}`);
  console.log("===============================================================\n");
}

if (require.main === module) {
  runBatchDataIngestor().catch(console.error);
}
