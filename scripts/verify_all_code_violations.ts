import axios from "axios";
import { db } from "../db";
import { isValidReachableUSPhone, formatPhoneUs, normalizePhoneNumber } from "../intelligence/phone_classifier";
import * as dotenv from "dotenv";

dotenv.config();

const apiKey = process.env.SKIP_TRACE_API_KEY || "eg9xRVBeFh6G1ZLXCREpiYg9hYUY4AzpbfEbZ6jI";

async function verifyAllCodeViolations() {
  console.log("=================================================================");
  console.log("🚀 ENRIQUECIMIENTO DE INFRACCIONES DE CÓDIGO CON BATCHDATA 🚀");
  console.log("=================================================================\n");

  const res = await db.execute(`
    SELECT violation_id, address, owner_name, defendant_phones, defendant_emails, mls_estimated_value
    FROM code_violations
    WHERE (defendant_phones IS NULL OR defendant_phones = '')
      AND address IS NOT NULL AND address != ''
      AND is_high_yield = 1
    LIMIT 100
  `);

  console.log(`📋 Total Infracciones Calificadas a Enriquecer: ${res.rows.length}\n`);

  let enrichedCount = 0;
  const batchSize = 10;

  for (let i = 0; i < res.rows.length; i += batchSize) {
    const chunk = res.rows.slice(i, i + batchSize);
    console.log(`⏳ Procesando Lote ${Math.floor(i / batchSize) + 1} de ${Math.ceil(res.rows.length / batchSize)} (${chunk.length} propiedades)...`);

    const requests = chunk.map(r => {
      const addr = (r.address as string || "").split(",")[0].trim();
      const zipMatch = (r.address as string || "").match(/\b\d{5}\b/);
      const zip = zipMatch ? zipMatch[0] : "40202";

      return {
        propertyAddress: {
          street: addr,
          city: "Louisville",
          state: "KY",
          zip: zip
        }
      };
    });

    try {
      const resp = await axios.post(
        "https://api.batchdata.com/api/v1/property/skip-trace",
        { requests },
        {
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          timeout: 30000
        }
      );

      const persons = resp.data?.results?.persons || [];

      for (let j = 0; j < persons.length; j++) {
        const person = persons[j];
        const originalRow = chunk[j];

        if (!person || !person.meta?.matched) continue;

        const fullName = person.name?.full || `${person.name?.first || ''} ${person.name?.last || ''}`.trim() || (originalRow.owner_name as string);

        const phoneList = (person.phoneNumbers || [])
          .filter((p: any) => p.number && isValidReachableUSPhone(p.number.replace(/\D/g, "")))
          .sort((a: any, b: any) => {
            const isMobA = a.type === "Mobile" ? 1 : 0;
            const isMobB = b.type === "Mobile" ? 1 : 0;
            if (isMobB !== isMobA) return isMobB - isMobA;
            return (b.score || 0) - (a.score || 0);
          });

        const primaryPhone = phoneList.length > 0 ? formatPhoneUs(normalizePhoneNumber(phoneList[0].number)) : null;
        const allPhonesStr = phoneList.map((p: any) => `${p.type || 'Tel'}: ${formatPhoneUs(normalizePhoneNumber(p.number))}`).join(", ");
        const primaryEmail = (person.emails && person.emails.length > 0) ? person.emails[0].email : null;

        if (primaryPhone) {
          await db.execute({
            sql: `
              UPDATE code_violations SET
                owner_name = COALESCE(NULLIF(?, ''), owner_name),
                defendant_phones = ?,
                defendant_emails = COALESCE(?, defendant_emails)
              WHERE violation_id = ?
            `,
            args: [fullName, allPhonesStr, primaryEmail, originalRow.violation_id]
          });

          enrichedCount++;
          console.log(`  ✅ [${enrichedCount}] "${fullName}" | 📱 ${primaryPhone} | 📍 ${originalRow.address}`);
        }
      }
    } catch (e: any) {
      console.error("  ❌ Error en lote BatchData:", e.response?.data || e.message);
    }
  }

  console.log("\n=================================================================");
  console.log(`🎉 ENRIQUECIMIENTO FINALIZADO: ${enrichedCount} propiedades de código verificadas`);
  console.log("=================================================================\n");
}

verifyAllCodeViolations().catch(console.error);
