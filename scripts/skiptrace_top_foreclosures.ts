import { createClient } from "@libsql/client";
import { BatchDataClient } from "../scrapers/batchdata_client";
import { classifyPhone } from "../intelligence/phone_classifier";
import * as dotenv from "dotenv";
dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

interface TargetLead {
  auction_id: string;
  case_number: string;
  address: string;
  county: string;
  state: string;
  auction_date: string;
  defendant: string;
  spread: number;
}

// Helper para parsear direcciones
function parseAddressParts(rawAddress: string, defaultCity: string, defaultState: string): { street: string; city: string; state: string; zip: string } {
  // Limpiar # o Apt
  let clean = rawAddress.split("#")[0].trim();
  const zipMatch = rawAddress.match(/\b\d{5}(-\d{4})?\b/);
  const zip = zipMatch ? zipMatch[0].substring(0, 5) : "";

  const parts = clean.split(",").map(p => p.trim());
  let street = parts[0] || "";
  let city = defaultCity;
  let state = defaultState;

  if (parts.length >= 2) {
    // Si la segunda parte es ciudad
    const cPart = parts[1].replace(/\b\d{5}\b.*/, "").trim();
    if (cPart && !/\b(KY|IN)\b/i.test(cPart)) {
      city = cPart;
    }
  }

  if (parts.length >= 3) {
    const sPart = parts[2].trim().split(" ")[0];
    if (sPart && (sPart.toUpperCase() === "KY" || sPart.toUpperCase() === "IN")) {
      state = sPart.toUpperCase();
    }
  }

  return { street, city, state, zip };
}

async function runSkipTraceBatch() {
  console.log("=================================================================");
  console.log("🎯 [TZEL] BATCHDATA SKIP-TRACE DE ALTA PRECISIÓN PARA FORECLOSURES");
  console.log("=================================================================\n");

  const client = new BatchDataClient();

  // 1. Obtener candidatos prioritarios
  const res = await db.execute(`
    SELECT * FROM foreclosure_auctions 
    WHERE is_high_yield = 1 OR auction_date LIKE '%9/11/2026%' OR auction_date LIKE '%10/9/2026%' OR auction_date LIKE '%2026-09%' OR auction_date LIKE '%2026-10%'
    ORDER BY created_at DESC
  `);

  const candidates: TargetLead[] = [];
  const processedAddresses = new Set<string>();

  for (const r of res.rows) {
    const rawApp = (r.appraisal_value as number) || 0;
    const mls = (r.mls_estimated_value as number) || 0;
    const debt = (r.debt_amount as number) || 0;

    let effVal = rawApp;
    if (mls > 0 && (rawApp <= 0 || rawApp < 35000 || rawApp < mls * 0.35)) {
      effVal = mls;
    } else if (effVal <= 0) {
      effVal = mls;
    }

    if (effVal > 350000 || effVal <= 0) continue;
    const spread = effVal - debt;
    if (spread < 20000) continue;
    if (debt > 0 && spread <= 0) continue;

    const owner = (r.defendant as string || "").trim();
    if (!owner || owner === "DUEÑO DESCONOCIDO" || owner === "Unknown" || owner === "null") continue;

    // Verificar si ya tiene teléfonos móviles de BatchData válidos
    const existingPhones = r.defendant_phones as string || "";
    if (existingPhones.includes("BatchData") || (existingPhones.includes("📱") && !existingPhones.includes("OSINT:"))) {
      // Ya tiene números clasificados
      continue;
    }

    const addrKey = (r.address as string).toLowerCase().split(",")[0].trim();
    if (processedAddresses.has(addrKey)) continue;
    processedAddresses.add(addrKey);

    candidates.push({
      auction_id: r.auction_id as string,
      case_number: r.case_number as string,
      address: r.address as string,
      county: r.county as string,
      state: r.state as string,
      auction_date: r.auction_date as string,
      defendant: owner,
      spread: spread
    });
  }

  // Ordenar por spread descendente
  candidates.sort((a, b) => b.spread - a.spread);

  // Límite seguro: Top 15 propiedades prioritarias (aprox $1.80 de saldo)
  const MAX_LEADS = 15;
  const targetBatch = candidates.slice(0, MAX_LEADS);

  console.log(`Se seleccionaron las ${targetBatch.length} oportunidades con mayor margen para Skip Trace en BatchData.\n`);

  const resultsSummary: any[] = [];

  for (let i = 0; i < targetBatch.length; i++) {
    const item = targetBatch[i];
    console.log(`[${i + 1}/${targetBatch.length}] Procesando: "${item.defendant}" en ${item.address} (Spread: $${item.spread.toLocaleString()})...`);

    // Parsear nombre para omitir ruido como "ET AL."
    let cleanName = item.defendant
      .replace(/,\s*et\s*al\.?/gi, "")
      .replace(/aka\s+.*/gi, "")
      .replace(/unknown\s+spouse.*of\s+/gi, "")
      .replace(/unknown\s+heirs.*of\s+/gi, "")
      .replace(/unknown\s+defendants.*of\s+/gi, "")
      .replace(/heirs.*of\s+/gi, "")
      .trim();

    const defaultCity = item.county === "Jefferson" ? "Louisville" : item.county;
    const addrParts = parseAddressParts(item.address, defaultCity, item.state);

    try {
      const skipRes = await client.skipTrace(cleanName, {
        street: addrParts.street,
        city: addrParts.city,
        state: addrParts.state,
        zip: addrParts.zip
      });

      if (skipRes.success && (skipRes.phones.length > 0 || skipRes.emails.length > 0)) {
        console.log(`  ✅ [MATCH] Encontrados ${skipRes.phones.length} teléfonos y ${skipRes.emails.length} correos.`);

        // Formatear teléfonos
        const phoneStrings: string[] = [];
        for (const p of skipRes.phones) {
          const dncTag = p.isDNC ? " [DNC]" : "";
          const icon = p.type === "Mobile" ? "📱" : "☎️";
          phoneStrings.push(`${icon} ${p.type}${dncTag}: ${p.number}${p.carrier ? ` (${p.carrier})` : ""}`);
        }

        const emailStrings = skipRes.emails.map(e => e.email);
        const mailingAddrStr = skipRes.mailingAddress 
          ? `${skipRes.mailingAddress.street}, ${skipRes.mailingAddress.city}, ${skipRes.mailingAddress.state} ${skipRes.mailingAddress.zip}`
          : null;

        const phonesDbStr = phoneStrings.join(", ");
        const emailsDbStr = emailStrings.join(", ");

        // Actualizar en Turso
        await db.execute({
          sql: `
            UPDATE foreclosure_auctions 
            SET defendant_phones = ?, 
                defendant_emails = ?,
                mailing_address = COALESCE(?, mailing_address)
            WHERE auction_id = ?
          `,
          args: [phonesDbStr, emailsDbStr, mailingAddrStr, item.auction_id]
        });

        resultsSummary.push({
          address: item.address,
          case: item.case_number,
          owner: cleanName,
          spread: item.spread,
          phones: phoneStrings,
          emails: emailStrings,
          mailing: mailingAddrStr
        });
      } else {
        console.log(`  ⚠️ [NO MATCH] BatchData no encontró registros directos para este nombre/dirección.`);
      }
    } catch (err: any) {
      console.error(`  ❌ [ERROR] Falló skip trace para ${cleanName}:`, err.message);
    }

    // Pequeño delay de cortesía entre peticiones
    await new Promise(r => setTimeout(r, 600));
  }

  console.log("\n=================================================================");
  console.log(`🎉 SKIP TRACE FINALIZADO. Contactos obtenidos para ${resultsSummary.length} de ${targetBatch.length} propiedades.`);
  console.log("=================================================================\n");

  resultsSummary.forEach((r, idx) => {
    console.log(`\n🏡 #${idx + 1}: ${r.address} (Caso: ${r.case})`);
    console.log(`   • Propietario: ${r.owner} | Margen: $${r.spread.toLocaleString()}`);
    if (r.mailing) console.log(`   • Dirección Postal (Mailing): ${r.mailing}`);
    console.log(`   • Teléfonos:`);
    r.phones.forEach((p: string) => console.log(`       ${p}`));
    if (r.emails.length > 0) {
      console.log(`   • Correos: ${r.emails.join(", ")}`);
    }
  });
}

runSkipTraceBatch().catch(console.error);
