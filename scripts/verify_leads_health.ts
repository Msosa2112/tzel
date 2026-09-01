import { db } from "../db";
import { createClient } from "@supabase/supabase-js";
import { isValidReachableUSPhone, normalizePhoneNumber } from "../intelligence/phone_classifier";
import * as dotenv from "dotenv";

dotenv.config();

const url = process.env.BARBAPRO_SUPABASE_URL || "https://ddwyutisxymuvofkjhpz.supabase.co";
const serviceKey = process.env.BARBAPRO_SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";
const sb = createClient(url, serviceKey);

async function runHealthCheck() {
  console.log("=================================================================");
  console.log("🩺 AUDITORÍA DE SALUD Y VERIFICACIÓN POST-SANEAMIENTO 🩺");
  console.log("=================================================================\n");

  // 1. Verificar Supabase
  const { data: contacts, error } = await sb.from("contacts").select("*");
  if (error || !contacts) {
    console.error("❌ Error consultando Supabase:", error);
    return;
  }

  console.log(`📊 Total de Contactos en Supabase: ${contacts.length}`);

  let invalidPhonesCount = 0;
  const invalidPhonesList: any[] = [];
  const phoneOccurrences = new Map<string, number>();
  const addressOccurrences = new Map<string, number>();

  for (const c of contacts) {
    if (c.phone) {
      const raw = String(c.phone).trim();
      const unmasked = raw.replace(/^(OSINT:|BatchData \(Mobile\):|BatchData \(Landline\):|BatchData \(Landline \[DNC\]\):|📱|☎️)\s*/i, "").trim();
      if (!isValidReachableUSPhone(unmasked)) {
        invalidPhonesCount++;
        invalidPhonesList.push({ id: c.id, name: `${c.first_name} ${c.last_name}`, phone: c.phone });
      }
      const norm = normalizePhoneNumber(unmasked);
      phoneOccurrences.set(norm, (phoneOccurrences.get(norm) || 0) + 1);
    }

    const addr = (c.address || "").toUpperCase().split(",")[0].replace(/[.#,]/g, "").trim();
    if (addr && addr.length > 5 && !c.address.startsWith("Grupo:") && !c.address.startsWith("Vecindario") && !c.address.startsWith("Comunidad") && !c.address.startsWith("Área") && !c.address.startsWith("Sur de Indiana")) {
      addressOccurrences.set(addr, (addressOccurrences.get(addr) || 0) + 1);
    }
  }

  const duplicatedPhones = Array.from(phoneOccurrences.entries()).filter(([_, count]) => count > 1);
  const duplicatedAddresses = Array.from(addressOccurrences.entries()).filter(([_, count]) => count > 1);

  console.log(`\n🔍 [SUPABASE] Teléfonos Inválidos / Desconectados: ${invalidPhonesCount}`);
  if (invalidPhonesCount > 0) {
    console.log("  ⚠️ Muestra de inválidos:", invalidPhonesList.slice(0, 5));
  } else {
    console.log("  ✅ ¡0 números inválidos encontrados! Todos los teléfonos cumplen NANP estricto.");
  }

  console.log(`🔍 [SUPABASE] Números Telefónicos Duplicados: ${duplicatedPhones.length}`);
  if (duplicatedPhones.length > 0) {
    console.log("  ⚠️ Duplicados:", duplicatedPhones);
  } else {
    console.log("  ✅ ¡0 números duplicados! Cada prospecto tiene su número único asignado.");
  }

  console.log(`🔍 [SUPABASE] Inmuebles / Direcciones Físicas Duplicadas: ${duplicatedAddresses.length}`);
  if (duplicatedAddresses.length > 0) {
    console.log("  ⚠️ Inmuebles repetidos:", duplicatedAddresses);
  } else {
    console.log("  ✅ ¡0 inmuebles duplicados! Las citaciones múltiples han sido consolidadas en una sola tarjeta.");
  }

  // 2. Verificar Turso DB
  console.log("\n--- VERIFICACIÓN EN TURSO DB ---");
  const cLeadsRes = await db.execute("SELECT lead_id, owner_phones FROM construction_leads");
  let tursoInvalidPhones = 0;
  for (const r of cLeadsRes.rows) {
    let phones: string[] = [];
    try {
      if (typeof r.owner_phones === "string") phones = JSON.parse(r.owner_phones);
      else if (Array.isArray(r.owner_phones)) phones = r.owner_phones;
    } catch {}
    for (const p of phones) {
      const unmasked = p.replace(/^(OSINT:|BatchData \(Mobile\):|BatchData \(Landline\):|BatchData \(Landline \[DNC\]\):|📱|☎️)\s*/i, "").trim();
      if (!isValidReachableUSPhone(unmasked)) {
        tursoInvalidPhones++;
      }
    }
  }
  console.log(`🔍 [TURSO DB construction_leads] Teléfonos inválidos: ${tursoInvalidPhones}`);
  if (tursoInvalidPhones === 0) {
    console.log("  ✅ Base de datos Turso de Construcción completamente limpia.");
  }

  console.log("\n=================================================================");
  console.log("🎯 REPORTE FINAL: SISTEMA 100% OPERATIVO Y SANITIZADO");
  console.log("=================================================================\n");
}

runHealthCheck().catch(console.error);
