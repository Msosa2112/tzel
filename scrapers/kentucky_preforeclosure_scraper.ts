import { createClient } from "@libsql/client";
import { queryLojicArcGIS } from "../services/lojic_gis_client";
import * as dotenv from "dotenv";

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

export interface KentuckyPreForeclosure {
  caseNumber: string;
  address: string;
  county: string;
  state: string;
  filingDate: string;
  plaintiff: string;
  defendant: string;
  caseStatus: string;
}

/**
 * Normaliza y enriquece un caso de Pre-Foreclosure en Kentucky
 */
export async function processKentuckyPreForeclosure(caseData: KentuckyPreForeclosure): Promise<void> {
  const preId = `KY_${caseData.county.toUpperCase()}_${caseData.caseNumber.replace(/[^a-zA-Z0-9]/g, "_")}`;
  
  // 1. Enriquecer con LOJIC ArcGIS
  const lojicInfo = await queryLojicArcGIS(caseData.address);
  
  const mailingAddress = lojicInfo?.mailingAddress || null;
  const isAbsentee = lojicInfo?.isAbsentee ? 1 : 0;
  const photoUrls = lojicInfo?.photoUrl ? JSON.stringify([lojicInfo.photoUrl]) : null;

  // Calcular días desde radicación
  let daysSince = 0;
  try {
    const filed = new Date(caseData.filingDate);
    const now = new Date();
    daysSince = Math.ceil(Math.abs(now.getTime() - filed.getTime()) / (1000 * 60 * 60 * 24));
  } catch {}

  // 2. Guardar en Turso DB
  await db.execute({
    sql: `
      INSERT INTO pre_foreclosures (
        pre_foreclosure_id, case_number, address, county, state, filing_date,
        plaintiff, defendant, case_status, days_since_filing, mailing_address,
        absentee_owner, photo_urls
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(pre_foreclosure_id) DO UPDATE SET
        case_status = excluded.case_status,
        days_since_filing = excluded.days_since_filing,
        mailing_address = COALESCE(excluded.mailing_address, pre_foreclosures.mailing_address),
        absentee_owner = COALESCE(excluded.absentee_owner, pre_foreclosures.absentee_owner),
        photo_urls = COALESCE(excluded.photo_urls, pre_foreclosures.photo_urls)
    `,
    args: [
      preId,
      caseData.caseNumber,
      lojicInfo?.standardAddress || caseData.address,
      caseData.county,
      caseData.state,
      caseData.filingDate,
      caseData.plaintiff,
      caseData.defendant,
      caseData.caseStatus,
      daysSince,
      mailingAddress,
      isAbsentee,
      photoUrls
    ]
  });

  console.log(`[KY PRE-FORECLOSURE] Caso guardado y enriquecido: ${caseData.caseNumber} - ${caseData.address} (Absentee: ${isAbsentee === 1 ? 'SÍ' : 'NO'})`);
}

/**
 * Escanea y procesa casos de Kentucky
 */
export async function scrapeKentuckyPreForeclosures(): Promise<void> {
  console.log("=================================================================");
  console.log("⚖️ [KY PRE-FORECLOSURE] Rastreo de demandas de ejecución en Jefferson County (KY)...");
  console.log("=================================================================");
  
  // Consulta de subastas existentes para verificar si alguna aún no tiene fecha fijada
  const pendingCases = await db.execute({
    sql: "SELECT case_number, address, defendant, plaintiff, created_at FROM foreclosure_auctions WHERE auction_date IS NULL OR auction_date = '' LIMIT 20",
    args: []
  });

  for (const row of pendingCases.rows) {
    await processKentuckyPreForeclosure({
      caseNumber: String(row.case_number),
      address: String(row.address),
      county: "Jefferson",
      state: "KY",
      filingDate: String(row.created_at || new Date().toISOString().split("T")[0]),
      plaintiff: String(row.plaintiff || "Banco Acreedor"),
      defendant: String(row.defendant || "Propietario"),
      caseStatus: "PENDING"
    });
  }

  console.log(`[KY PRE-FORECLOSURE] Proceso finalizado.`);
}

if (require.main === module) {
  scrapeKentuckyPreForeclosures().catch(console.error);
}
