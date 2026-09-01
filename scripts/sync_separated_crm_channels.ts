import { createClient } from "@supabase/supabase-js";
import { db } from "../db";
import { isValidReachableUSPhone, formatPhoneUs, normalizePhoneNumber } from "../intelligence/phone_classifier";
import * as dotenv from "dotenv";

dotenv.config();

const url = process.env.BARBAPRO_SUPABASE_URL || "https://ddwyutisxymuvofkjhpz.supabase.co";
const serviceKey = process.env.BARBAPRO_SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";
const sb = createClient(url, serviceKey);

async function syncSeparatedChannels() {
  console.log("=================================================================");
  console.log("🔄 SINCRONIZANDO Y SEPARANDO CANALES HACIA EL CRM DE BARBA 🔄");
  console.log("Canal 1: 🏗️ Barba Construction (Vía B: Reparaciones / Infracciones)");
  console.log("Canal 2: 🏠 Pre-Foreclosures (Inversión / Adquisición con $50k+ Margen)");
  console.log("=================================================================\n");

  // =========================================================================
  // CANAL 2: 🏠 PRE-FORECLOSURES & SUBASTAS JUDICIALES HIGH YIELD ($50k+ MARGEN)
  // =========================================================================
  console.log("--- 🏠 PROCESANDO CANAL 2: PRE-FORECLOSURES & SUBASTAS ($50k+ MARGEN) ---");
  const faRes = await db.execute(`
    SELECT auction_id, case_number, defendant, address, county, state, mls_estimated_value, debt_amount, redemption_margin, defendant_phones, defendant_emails, mailing_address, absentee_owner
    FROM foreclosure_auctions
    WHERE is_high_yield = 1
    ORDER BY redemption_margin DESC
  `);

  let preForeclosureSynced = 0;

  for (const fa of faRes.rows) {
    const caseNum = fa.case_number as string;
    const defendant = (fa.defendant as string || "Propietario").replace(/,\s*et\s*al\.?/gi, "").trim();
    const address = fa.address as string;
    const arv = (fa.mls_estimated_value as number) || 0;
    const debt = (fa.debt_amount as number) || 0;
    const spread = (fa.redemption_margin as number) || 0;
    const rawPhones = fa.defendant_phones as string || "";
    const emails = fa.defendant_emails as string || null;

    const parts = defendant.split(/\s+/);
    const firstName = parts[0] || "Propietario";
    const lastName = parts.slice(1).join(" ") || "";

    let primaryPhone: string | null = null;
    const phoneMatches = rawPhones.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g);
    if (phoneMatches) {
      for (const p of phoneMatches) {
        const raw = p.replace(/\D/g, "");
        if (isValidReachableUSPhone(raw)) {
          primaryPhone = formatPhoneUs(normalizePhoneNumber(raw));
          break;
        }
      }
    }

    const externalRef = `LEAD_PREFORECLOSURE_${fa.auction_id}`;

    const notes = `🏠 [CANAL: PRE-FORECLOSURE / ADQUISICIÓN INMOBILIARIA]
⚖️ Expediente Judicial: ${caseNum} | Condado: ${fa.county || 'Jefferson'}, ${fa.state || 'KY'}
👤 Demandado / Titular: ${defendant}
📍 Inmueble: ${address}
💵 VALOR REAL DE MERCADO (ARV MLS): $${arv.toLocaleString()} USD
💳 DEUDA JUDICIAL TOTAL: $${debt.toLocaleString()} USD
🎯 MARGEN NETO ESTIMADO (SPREAD): +$${spread.toLocaleString()} USD
${fa.absentee_owner === 1 ? `🏢 DUEÑO NO RESIDENTE (Mailing: ${fa.mailing_address})` : '🏠 PROPIETARIO RESIDENTE'}
${rawPhones ? `📞 Teléfonos Registrados: ${rawPhones}` : ''}

=========================================
💬 SPEECH DE ADQUISICIÓN / INVERSIÓN (ESPAÑOL):
"Hola ${firstName}, le contacto con respecto a la situación legal de su propiedad en ${address}. Sabemos que el juzgado tiene un expediente abierto (${caseNum}) y queremos ofrecerle una solución inmediata para saldar la deuda antes del remate bancario, protegiendo su historial crediticio y asegurando un beneficio económico para usted. ¿Podemos hablar 5 minutos hoy?"

💬 SALES PITCH (ENGLISH):
"Hi ${firstName}, I'm reaching out regarding the judicial foreclosure file ${caseNum} for ${address}. We help homeowners resolve their mortgage debt before the auction date to protect your credit and put cash in your pocket. Let's connect for 5 minutes today."

📞 APERTURA TELEFÓNICA:
"Hola ${firstName}, le llamo para presentarle una alternativa directa de compra y cancelación de deuda para su casa en ${address}."`;

    const contactPayload = {
      first_name: firstName,
      last_name: lastName,
      phone: primaryPhone,
      email: emails ? emails.split(",")[0].trim() : null,
      address: address,
      city: "Louisville",
      state: fa.state || "KY",
      source: "other",
      lead_quality: "hot",
      pipeline_status: "new_lead",
      external_ref: externalRef,
      notes: notes,
      updated_at: new Date().toISOString()
    };

    const { data: existing } = await sb
      .from("contacts")
      .select("id")
      .or(`external_ref.eq.${externalRef},address.ilike.%${address.split(",")[0]}%`)
      .limit(1);

    if (existing && existing.length > 0) {
      await sb.from("contacts").update(contactPayload).eq("id", existing[0].id);
    } else {
      await sb.from("contacts").insert(contactPayload);
    }

    preForeclosureSynced++;
  }

  console.log(`  ✅ ${preForeclosureSynced} Pre-Foreclosures High Yield sincronizados en el CRM.`);

  // =========================================================================
  // CANAL 1: 🏗️ BARBA CONSTRUCTION (VÍA B: REPARACIONES DE CÓDIGO)
  // =========================================================================
  console.log("\n--- 🏗️ PROCESANDO CANAL 1: BARBA CONSTRUCTION (REPARACIONES DE INFRACCIONES) ---");
  const codeRes = await db.execute(`
    SELECT violation_id, case_number, address, violation_type, owner_name, mls_estimated_value, defendant_phones, defendant_emails
    FROM code_violations
    WHERE is_high_yield = 1
    LIMIT 60
  `);

  let constructionRepairsSynced = 0;

  for (const cv of codeRes.rows) {
    const owner = (cv.owner_name as string || "Propietario Inmueble").replace(/,\s*et\s*al\.?/gi, "").trim();
    const address = cv.address as string;
    const violType = cv.violation_type as string || "Infracción de Mantenimiento Exterior";
    const arv = (cv.mls_estimated_value as number) || 0;
    const rawPhones = cv.defendant_phones as string || "";

    const parts = owner.split(/\s+/);
    const firstName = parts[0] || "Propietario";
    const lastName = parts.slice(1).join(" ") || "Inmueble";

    let primaryPhone: string | null = null;
    const phoneMatches = rawPhones.match(/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g);
    if (phoneMatches) {
      for (const p of phoneMatches) {
        const raw = p.replace(/\D/g, "");
        if (isValidReachableUSPhone(raw)) {
          primaryPhone = formatPhoneUs(normalizePhoneNumber(raw));
          break;
        }
      }
    }

    const externalRef = `LEAD_BARBA_REPAIR_${cv.violation_id}`;

    const notes = `🏗️ [CANAL: BARBA CONSTRUCTION - REPARACIÓN VÍA B]
🚨 INFRACCIÓN MUNICIPAL DE FACHADA/TECHO/ESTRUCTURA
📌 Citación Municipal: ${cv.case_number || 'Código Metro'} | Tipo: ${violType}
👤 Propietario: ${owner}
📍 Inmueble: ${address}
💵 VALOR COMERCIAL ESTIMADO (ARV MLS): $${arv.toLocaleString()} USD
🎯 SERVICIO REQUERIDO: Reparación de fachada, porche (X40), techo (X19) o estructura para archivar multa municipal.
${rawPhones ? `📞 Teléfonos de Contacto: ${rawPhones}` : ''}

=========================================
💬 SPEECH DE CONTRATACIÓN BARBA CONSTRUCTION (ESPAÑOL):
"Hola ${firstName}, le contactamos de Barba Construction aquí en Louisville. Nos especializamos en ayudar a propietarios a reparar citaciones del código municipal (${violType}) de forma rápida, asegurada y con garantía para que la ciudad cierre el caso y usted evite multas mayores. ¿Le gustaría que pasemos hoy o mañana a hacerle una evaluación y presupuesto sin costo?"

💬 SALES PITCH (ENGLISH):
"Hi ${firstName}, we are contacting you from Barba Construction regarding city code citation for your property at ${address}. We specialize in licensed repairs to resolve citations before city deadlines. Would you like a free on-site estimate?"

📞 APERTURA TELEFÓNICA:
"Hola ${firstName}, le llamo de Barba Construction en Louisville para ofrecerle asistencia técnica y presupuesto sin costo para corregir la infracción de código en ${address}."`;

    const contactPayload = {
      first_name: firstName,
      last_name: lastName,
      phone: primaryPhone,
      address: address,
      city: "Louisville",
      state: "KY",
      source: "other",
      lead_quality: "hot",
      pipeline_status: "new_lead",
      external_ref: externalRef,
      notes: notes,
      updated_at: new Date().toISOString()
    };

    const { data: existing } = await sb
      .from("contacts")
      .select("id")
      .or(`external_ref.eq.${externalRef},address.ilike.%${address.split(",")[0]}%`)
      .limit(1);

    if (existing && existing.length > 0) {
      await sb.from("contacts").update(contactPayload).eq("id", existing[0].id);
    } else {
      await sb.from("contacts").insert(contactPayload);
    }

    constructionRepairsSynced++;
  }

  console.log(`  ✅ ${constructionRepairsSynced} Leads de Construcción (Vía B) sincronizados en el CRM.`);

  console.log("\n=================================================================");
  console.log("🎉 SINCRONIZACIÓN Y SEPARACIÓN COMPLETADA CON ÉXITO");
  console.log("=================================================================\n");
}

syncSeparatedChannels().catch(console.error);
