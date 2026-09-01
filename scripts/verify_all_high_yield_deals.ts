import { db } from "../db";
import { BatchDataClient } from "../scrapers/batchdata_client";
import { parseAddress } from "../skip_trace";
import { isValidReachableUSPhone, formatPhoneUs, normalizePhoneNumber } from "../intelligence/phone_classifier";
import * as dotenv from "dotenv";

dotenv.config();

const batchClient = new BatchDataClient();

async function verifyAllHighYieldDeals() {
  console.log("=================================================================");
  console.log("🚀 VERIFICANDO AL 100% TODAS LAS OPORTUNIDADES HIGH YIELD 🚀");
  console.log("Filtro: ARV <= $350k | Margen >= $50k (Criterio Inversionista)");
  console.log("=================================================================\n");

  const res = await db.execute(`
    SELECT auction_id, case_number, defendant, address, county, state, mls_estimated_value, debt_amount, redemption_margin, defendant_phones, defendant_emails
    FROM foreclosure_auctions
    WHERE is_high_yield = 1
    ORDER BY redemption_margin DESC
  `);

  const deals = res.rows;
  console.log(`📋 Total de Oportunidades High Yield a verificar: ${deals.length}\n`);

  let enrichedNow = 0;
  let alreadyVerified = 0;
  let skippedNoMatch = 0;

  for (let i = 0; i < deals.length; i++) {
    const row = deals[i];
    const auctionId = row.auction_id as string;
    const caseNumber = row.case_number as string;
    const defendant = (row.defendant as string || "").replace(/,\s*et\s*al\.?/gi, "").trim();
    const address = row.address as string;
    const state = (row.state as string || "KY").toUpperCase();
    const county = (row.county as string || "Jefferson").toUpperCase();
    const margin = row.redemption_margin as number;
    const currentPhones = row.defendant_phones as string;

    const hasValidPhone = currentPhones && currentPhones.trim() !== "" && currentPhones !== "null";

    if (hasValidPhone) {
      alreadyVerified++;
      console.log(`[${i + 1}/${deals.length}] ✅ Ya verificado [${caseNumber}] "${defendant}" -> ${currentPhones}`);
      continue;
    }

    console.log(`[${i + 1}/${deals.length}] 🔍 Consultando BatchData para [${caseNumber}] "${defendant}" | Dir: "${address}" (Margen: $${margin?.toLocaleString()})...`);

    const parsedAddr = parseAddress(address, state, county);
    
    try {
      const batchRes = await batchClient.skipTrace(defendant, {
        street: parsedAddr.street,
        city: parsedAddr.city,
        state: parsedAddr.state,
        zip: parsedAddr.zip
      });

      if (batchRes.success && (batchRes.phones.length > 0 || batchRes.emails.length > 0)) {
        const phoneList: string[] = [];
        for (const p of batchRes.phones) {
          const raw = p.number.replace(/\D/g, "");
          if (isValidReachableUSPhone(raw)) {
            const formatted = formatPhoneUs(normalizePhoneNumber(raw));
            const label = p.type === "Mobile" ? "📱 Móvil" : "☎️ Fijo";
            const carrierStr = p.carrier ? ` (${p.carrier})` : "";
            phoneList.push(`${label}: ${formatted}${carrierStr}`);
          }
        }

        const emailList = batchRes.emails.map(e => e.email);
        const phonesStr = phoneList.length > 0 ? phoneList.join(", ") : null;
        const emailsStr = emailList.length > 0 ? emailList.join(", ") : null;

        const mailingAddr = batchRes.mailingAddress 
          ? `${batchRes.mailingAddress.street}, ${batchRes.mailingAddress.city}, ${batchRes.mailingAddress.state} ${batchRes.mailingAddress.zip}`
          : null;
        const isAbsentee = batchRes.mailingAddress && parsedAddr.street.toLowerCase() !== batchRes.mailingAddress.street.toLowerCase() ? 1 : 0;

        await db.execute({
          sql: `
            UPDATE foreclosure_auctions SET
              defendant_phones = ?,
              defendant_emails = ?,
              mailing_address = ?,
              absentee_owner = ?
            WHERE auction_id = ?
          `,
          args: [phonesStr, emailsStr, mailingAddr, isAbsentee, auctionId]
        });

        enrichedNow++;
        console.log(`  🎉 ¡ENRIQUECIDO 100%! Teléfonos: ${phonesStr || 'Sin tel'} | Emails: ${emailsStr || 'Sin email'}`);
      } else {
        skippedNoMatch++;
        console.log(`  ℹ️ No se encontraron registros públicos para este deudor.`);
      }
    } catch (err: any) {
      console.error(`  ❌ Error consultando [${caseNumber}]:`, err.message);
    }

    // Pausa de 250ms entre llamadas
    await new Promise(r => setTimeout(r, 250));
  }

  console.log("\n=================================================================");
  console.log("🏁 REPORTE FINAL DE VERIFICACIÓN HIGH YIELD:");
  console.log(`  ⭐ Total Oportunidades: ${deals.length}`);
  console.log(`  ✅ Ya verificadas previamente: ${alreadyVerified}`);
  console.log(`  ⚡ Enriquecidas ahora con BatchData: ${enrichedNow}`);
  console.log(`  ℹ️ Sin registro de contacto: ${skippedNoMatch}`);
  console.log("=================================================================\n");
}

verifyAllHighYieldDeals().catch(console.error);
