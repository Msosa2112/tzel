import { db } from "../db";
import { createClient } from "@supabase/supabase-js";
import { isValidReachableUSPhone, formatPhoneUs, normalizePhoneNumber } from "../intelligence/phone_classifier";
import * as dotenv from "dotenv";

dotenv.config();

const url = process.env.BARBAPRO_SUPABASE_URL || "https://ddwyutisxymuvofkjhpz.supabase.co";
const serviceKey = process.env.BARBAPRO_SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";
const sb = createClient(url, serviceKey);

function normalizeAddressKey(addr: string): string {
  if (!addr) return "";
  return addr
    .toUpperCase()
    .split(",")[0]
    .replace(/[.#,]/g, "")
    .replace(/\b(STREET|ST|AVENUE|AVE|ROAD|RD|DRIVE|DR|LANE|LN|BOULEVARD|BLVD|COURT|CT|WAY|CIRCLE|CIR|TRAIL|TRL)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function sanitizeAndDeduplicateAll() {
  console.log("=================================================================");
  console.log("🧹 SANEAMIENTO Y DEDUPLICACIÓN INTEGRAL DE LEADS Y TELÉFONOS 🧹");
  console.log("=================================================================\n");

  // =================================================================
  // FASE 1: SANEAMIENTO DE TELÉFONOS EN SUPABASE (contacts)
  // =================================================================
  console.log("--- FASE 1: SANEANDO TELÉFONOS EN SUPABASE contacts ---");
  const { data: contacts, error } = await sb.from("contacts").select("*");
  if (error || !contacts) {
    console.error("❌ Error consultando Supabase:", error);
    return;
  }

  console.log(`📋 Total de contactos en Supabase: ${contacts.length}`);
  let purgedPhoneCount = 0;
  let formattedPhoneCount = 0;

  for (const c of contacts) {
    if (c.phone) {
      const raw = String(c.phone).trim();
      const unmasked = raw.replace(/^(OSINT:|BatchData \(Mobile\):|BatchData \(Landline\):|BatchData \(Landline \[DNC\]\):|📱|☎️)\s*/i, "").trim();
      
      if (!isValidReachableUSPhone(unmasked)) {
        console.log(`  🗑️ Limpiando teléfono inválido/desconectado en [${c.id}] "${c.first_name} ${c.last_name || ''}": "${c.phone}"`);
        await sb.from("contacts").update({ phone: null }).eq("id", c.id);
        purgedPhoneCount++;
        c.phone = null;
      } else {
        const clean10 = normalizePhoneNumber(unmasked);
        const formatted = formatPhoneUs(clean10);
        if (c.phone !== formatted) {
          await sb.from("contacts").update({ phone: formatted }).eq("id", c.id);
          formattedPhoneCount++;
          c.phone = formatted;
        }
      }
    }
  }
  console.log(`✅ FASE 1 COMPLETADA: ${purgedPhoneCount} teléfonos inválidos purgados, ${formattedPhoneCount} teléfonos formateados.\n`);

  // =================================================================
  // FASE 2: FUSIÓN DE LEADS DUPLICADOS POR DIRECCIÓN FÍSICA EN SUPABASE
  // =================================================================
  console.log("--- FASE 2: FUSIÓN Y DEDUPLICACIÓN DE PROPIEDADES POR DIRECCIÓN ---");
  const addressMap = new Map<string, any[]>();

  for (const c of contacts) {
    const addr = (c.address || "").trim();
    if (!addr || addr.startsWith("Grupo:") || addr.startsWith("Vecindario") || addr.startsWith("Comunidad") || addr.startsWith("Área") || addr.startsWith("Sur de Indiana") || addr.startsWith("Louisville Metro /")) {
      continue;
    }
    const key = normalizeAddressKey(addr);
    if (key.length >= 4) {
      if (!addressMap.has(key)) addressMap.set(key, []);
      addressMap.get(key)!.push(c);
    }
  }

  let mergedAddressLeads = 0;
  let deletedAddressLeads = 0;

  for (const [key, list] of addressMap.entries()) {
    if (list.length > 1) {
      console.log(`\n🏠 Fusionando ${list.length} registros duplicados para la propiedad "${key}":`);
      
      // Ordenar para elegir el mejor registro primario (priorizar el que tiene teléfono válido, notas ricas o nombre real)
      list.sort((a, b) => {
        const aScore = (a.phone ? 50 : 0) + (a.first_name !== "Propietario" ? 30 : 0) + ((a.notes || "").length > 200 ? 20 : 0);
        const bScore = (b.phone ? 50 : 0) + (b.first_name !== "Propietario" ? 30 : 0) + ((b.notes || "").length > 200 ? 20 : 0);
        return bScore - aScore;
      });

      const primary = list[0];
      const duplicates = list.slice(1);

      console.log(`  ⭐ Conservando Primario [${primary.id}]: "${primary.first_name} ${primary.last_name || ''}" | Tel: ${primary.phone || 'N/A'}`);

      // Combinar notas y detalles de las citaciones de los duplicados en el primario
      const allNotes = list.map(l => l.notes || "").filter(Boolean);
      const combinedNotes = Array.from(new Set(allNotes)).join("\n\n---\n");

      // Actualizar primario con notas enriquecidas si aplica
      await sb.from("contacts").update({
        notes: combinedNotes,
        updated_at: new Date().toISOString()
      }).eq("id", primary.id);

      // Eliminar registros duplicados
      for (const dup of duplicates) {
        console.log(`  ❌ Eliminando duplicado [${dup.id}] (${dup.external_ref})`);
        await sb.from("contacts").delete().eq("id", dup.id);
        deletedAddressLeads++;
      }

      mergedAddressLeads++;
    }
  }
  console.log(`\n✅ FASE 2 COMPLETADA: ${mergedAddressLeads} propiedades consolidadas, ${deletedAddressLeads} duplicados eliminados.\n`);

  // =================================================================
  // FASE 3: DEDUPLICACIÓN POR TELÉFONO O NOMBRE IDÉNTICO EN SUPABASE
  // =================================================================
  console.log("--- FASE 3: DEDUPLICACIÓN POR IDENTIDAD / TELÉFONO ---");
  const { data: freshContacts } = await sb.from("contacts").select("*");
  if (freshContacts) {
    const phoneMap = new Map<string, any[]>();
    for (const c of freshContacts) {
      if (c.phone) {
        const norm = normalizePhoneNumber(c.phone);
        if (!phoneMap.has(norm)) phoneMap.set(norm, []);
        phoneMap.get(norm)!.push(c);
      }
    }

    let deletedPhoneDups = 0;
    for (const [normPhone, list] of phoneMap.entries()) {
      if (list.length > 1) {
        console.log(`\n📞 Fusionando ${list.length} registros con el mismo teléfono (${normPhone}):`);
        list.sort((a, b) => (b.notes || "").length - (a.notes || "").length);
        const primary = list[0];
        const duplicates = list.slice(1);

        for (const dup of duplicates) {
          console.log(`  ❌ Eliminando duplicado [${dup.id}] "${dup.first_name} ${dup.last_name || ''}"`);
          await sb.from("contacts").delete().eq("id", dup.id);
          deletedPhoneDups++;
        }
      }
    }
    console.log(`✅ FASE 3 COMPLETADA: ${deletedPhoneDups} contactos duplicados por teléfono eliminados.\n`);
  }

  // =================================================================
  // FASE 4: SANEAMIENTO DE TURSO DB (construction_leads, code_violations, etc.)
  // =================================================================
  console.log("--- FASE 4: SANEAMIENTO EN TURSO DB ---");
  try {
    // 1. construction_leads
    const cLeadsRes = await db.execute("SELECT lead_id, owner_phones FROM construction_leads");
    let tursoLeadsCleaned = 0;
    for (const r of cLeadsRes.rows) {
      let phones: string[] = [];
      try {
        if (typeof r.owner_phones === "string") phones = JSON.parse(r.owner_phones);
        else if (Array.isArray(r.owner_phones)) phones = r.owner_phones;
      } catch {
        if (r.owner_phones) phones = [String(r.owner_phones)];
      }

      const validPhones: string[] = [];
      for (const p of phones) {
        const unmasked = p.replace(/^(OSINT:|BatchData \(Mobile\):|BatchData \(Landline\):|BatchData \(Landline \[DNC\]\):|📱|☎️)\s*/i, "").trim();
        if (isValidReachableUSPhone(unmasked)) {
          validPhones.push(p);
        }
      }

      if (phones.length !== validPhones.length) {
        await db.execute({
          sql: "UPDATE construction_leads SET owner_phones = ? WHERE lead_id = ?",
          args: [JSON.stringify(validPhones), String(r.lead_id)]
        });
        tursoLeadsCleaned++;
      }
    }
    console.log(`✅ Turso construction_leads: ${tursoLeadsCleaned} registros limpiados de números inválidos.`);

    // 2. code_violations
    const cvRes = await db.execute("SELECT violation_id, defendant_phones FROM code_violations WHERE defendant_phones IS NOT NULL AND defendant_phones != ''");
    let cvCleaned = 0;
    for (const r of cvRes.rows) {
      const raw = String(r.defendant_phones || "");
      const parts = raw.split(/,\s*|;\s*/);
      const valid = parts.filter(p => {
        const unmasked = p.replace(/^(OSINT:|BatchData \(Mobile\):|BatchData \(Landline\):|BatchData \(Landline \[DNC\]\):|📱|☎️)\s*/i, "").trim();
        return isValidReachableUSPhone(unmasked);
      });

      if (valid.length !== parts.length) {
        await db.execute({
          sql: "UPDATE code_violations SET defendant_phones = ? WHERE violation_id = ?",
          args: [valid.length > 0 ? valid.join(", ") : null, String(r.violation_id)]
        });
        cvCleaned++;
      }
    }
    console.log(`✅ Turso code_violations: ${cvCleaned} registros limpiados de números inválidos.`);

    // 3. physical_distress
    const pdRes = await db.execute("SELECT distress_id, defendant_phones FROM physical_distress WHERE defendant_phones IS NOT NULL AND defendant_phones != ''");
    let pdCleaned = 0;
    for (const r of pdRes.rows) {
      const raw = String(r.defendant_phones || "");
      const parts = raw.split(/,\s*|;\s*/);
      const valid = parts.filter(p => {
        const unmasked = p.replace(/^(OSINT:|BatchData \(Mobile\):|BatchData \(Landline\):|BatchData \(Landline \[DNC\]\):|📱|☎️)\s*/i, "").trim();
        return isValidReachableUSPhone(unmasked);
      });

      if (valid.length !== parts.length) {
        await db.execute({
          sql: "UPDATE physical_distress SET defendant_phones = ? WHERE distress_id = ?",
          args: [valid.length > 0 ? valid.join(", ") : null, String(r.distress_id)]
        });
        pdCleaned++;
      }
    }
    console.log(`✅ Turso physical_distress: ${pdCleaned} registros limpiados de números inválidos.`);

  } catch (tursoErr: any) {
    console.error("⚠️ Error en saneamiento de Turso:", tursoErr.message);
  }

  console.log("\n=================================================================");
  console.log("🎉 ¡SANEAMIENTO Y DEDUPLICACIÓN COMPLETADOS EXITOSAMENTE! 🎉");
  console.log("=================================================================\n");
}

sanitizeAndDeduplicateAll().catch(console.error);
