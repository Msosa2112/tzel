import { createClient } from "@supabase/supabase-js";
import { db } from "../db";
import { isValidReachableUSPhone, formatPhoneUs, normalizePhoneNumber } from "../intelligence/phone_classifier";
import * as dotenv from "dotenv";

dotenv.config();

const url = process.env.BARBAPRO_SUPABASE_URL || "https://ddwyutisxymuvofkjhpz.supabase.co";
const serviceKey = process.env.BARBAPRO_SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";
const sb = createClient(url, serviceKey);

async function fastSyncAllConstructionLeads() {
  console.log("=================================================================");
  console.log("🚀 FAST SYNC: SINCRONIZANDO TODAS LAS INFRACCIONES A BARBA CRM 🚀");
  console.log("=================================================================\n");

  // 1. Obtener external_refs ya existentes en Supabase
  const { data: existingContacts, error: exErr } = await sb
    .from("contacts")
    .select("external_ref");

  const existingSet = new Set<string>();
  (existingContacts || []).forEach(c => {
    if (c.external_ref) existingSet.add(c.external_ref);
  });
  console.log(`📋 Registros existentes en Supabase: ${existingSet.size}`);

  // 2. Obtener las 519 infracciones calificadas de Turso DB
  const cvRes = await db.execute(`
    SELECT violation_id, case_number, address, violation_type, owner_name, mls_estimated_value, defendant_phones, defendant_emails, report_date
    FROM code_violations
    WHERE is_high_yield = 1
      AND address IS NOT NULL AND address != ''
  `);

  console.log(`📋 Total Infracciones Calificadas en Turso DB: ${cvRes.rows.length}\n`);

  const toInsert: any[] = [];

  for (const cv of cvRes.rows) {
    const violationId = cv.violation_id as string;
    const caseNumber = cv.case_number as string || "Citación Metro";
    const address = (cv.address as string || "").trim();
    const violType = (cv.violation_type as string || "Infracción de Mantenimiento Exterior").trim();
    const owner = (cv.owner_name as string || "Propietario Inmueble").replace(/,\s*et\s*al\.?/gi, "").trim();
    const rawPhones = cv.defendant_phones as string || "";
    const emails = cv.defendant_emails as string || "";
    const arv = (cv.mls_estimated_value as number) || 0;

    const externalRef = `LEAD_BARBA_REPAIR_${violationId.trim().replace(/[^a-zA-Z0-9_-]/g, "_")}`;

    if (existingSet.has(externalRef)) {
      continue;
    }

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

    const notes = `🚨 INFRACCIÓN MUNICIPAL DE FACHADA/TECHO/ESTRUCTURA (Louisville Code Enforcement)
📌 Citación Municipal: Código ${caseNumber} | Estado: Activa
👤 Propietario Registrado: ${owner}
🏠 Inmueble: ${address}
🎯 NECESIDAD: REPARACIÓN OBLIGATORIA (VÍA B)
💰 VALOR ESTIMADO INMUEBLE (ARV MLS): $${arv.toLocaleString()} USD
🔥 URGENCIA: HIGH
📋 Requerimiento de la Ciudad: ${violType}
${rawPhones ? `📞 Teléfonos Registrados: ${rawPhones}` : ''}

=========================================
💬 SPEECH DE VENTA RECOMENDADO (ESPAÑOL - DM / WHATSAPP):
"Estimado ${firstName}, en Barba Construction somos expertos en Louisville ayudando a propietarios a corregir citaciones del código municipal de manera rápida, asegurada y profesional. Contamos con la licencia y garantía necesarias para reparar los daños en su propiedad en ${address}, asegurando que su vivienda cumpla con las normativas vigentes antes de que se venzan los plazos de la ciudad. Nos encantaría asistirle para evitar multas mayores. ¿Le gustaría una evaluación sin costo?"

💬 SALES PITCH (ENGLISH):
"Hi ${firstName}, we are contacting you from Barba Construction regarding city code citation for your property at ${address}. We specialize in fast, licensed exterior repairs to resolve citations before deadlines. Would you like a free estimate?"

📞 APERTURA TELEFÓNICA:
"Hola ${firstName}, le llamo de Barba Construction en Louisville con respecto a los servicios de reparación de fachada y techo para su propiedad en ${address}."`;

    toInsert.push({
      first_name: firstName,
      last_name: lastName,
      phone: primaryPhone,
      email: emails ? emails.split(",")[0].trim() : null,
      address: address,
      city: "Louisville",
      state: "KY",
      source: "other",
      lead_quality: "hot",
      pipeline_status: "new_lead",
      external_ref: externalRef,
      notes: notes,
      updated_at: new Date().toISOString()
    });

    existingSet.add(externalRef);
  }

  console.log(`⚡ Prospectos Nuevos a Insertar: ${toInsert.length}\n`);

  let insertedTotal = 0;
  const chunkSize = 50;

  for (let i = 0; i < toInsert.length; i += chunkSize) {
    const chunk = toInsert.slice(i, i + chunkSize);
    const { error: insErr } = await sb.from("contacts").insert(chunk);
    if (!insErr) {
      insertedTotal += chunk.length;
      console.log(`  ✅ Insertados ${insertedTotal} / ${toInsert.length}...`);
    } else {
      console.error("  ❌ Error en chunk insert:", insErr);
    }
  }

  console.log("\n=================================================================");
  console.log(`🎉 FAST SYNC COMPLETADO: ${insertedTotal} nuevos prospectos cargados en Supabase`);
  console.log("=================================================================\n");
}

fastSyncAllConstructionLeads().catch(console.error);
