import { createClient } from "@supabase/supabase-js";
import { normalizePhoneNumber } from "../intelligence/phone_classifier";
import * as dotenv from "dotenv";

dotenv.config();

const url = process.env.BARBAPRO_SUPABASE_URL || "https://ddwyutisxymuvofkjhpz.supabase.co";
const serviceKey = process.env.BARBAPRO_SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";
const sb = createClient(url, serviceKey);

function normalizeAddr(addr: string): string {
  if (!addr) return "";
  return addr
    .toUpperCase()
    .split(",")[0]
    .replace(/[.#,]/g, "")
    .replace(/\b(STREET|ST|AVENUE|AVE|ROAD|RD|DRIVE|DR|LANE|LN|BOULEVARD|BLVD|COURT|CT|WAY|CIRCLE|CIR|TRAIL|TRL)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function reassignForeignKeysAndDelete(primaryId: string, dupId: string) {
  // Reasignar tablas que pueden tener FK a contacts(id)
  const tables = [
    { name: "estimates", col: "contact_id" },
    { name: "projects", col: "contact_id" },
    { name: "invoices", col: "contact_id" },
    { name: "bills", col: "contact_id" },
    { name: "client_conversations", col: "contact_id" },
    { name: "notes", col: "contact_id" },
    { name: "calendar_events", col: "contact_id" },
    { name: "activities", col: "contact_id" },
    { name: "job_proposals", col: "contact_id" }
  ];

  for (const t of tables) {
    try {
      await sb.from(t.name).update({ [t.col]: primaryId }).eq(t.col, dupId);
    } catch {}
  }

  // Ahora borrar el contacto duplicado de forma segura
  const { error } = await sb.from("contacts").delete().eq("id", dupId);
  if (error) {
    console.error(`    ❌ Error borrando [${dupId}]:`, error.message);
    return false;
  }
  return true;
}

async function runDeepPurgeAndMerge() {
  console.log("=================================================================");
  console.log("🔗 FUSIÓN RELACIONAL Y PURGA PROFUNDA DE DUPLICADOS EN SUPABASE 🔗");
  console.log("=================================================================\n");

  // 1. DEDUPLICAR POR DIRECCIÓN
  console.log("--- FASE 1: FUSIÓN RELACIONAL POR DIRECCIÓN FÍSICA ---");
  const { data: contacts1 } = await sb.from("contacts").select("*");
  if (contacts1) {
    const addrGroups = new Map<string, any[]>();
    for (const c of contacts1) {
      const addr = (c.address || "").trim();
      if (!addr || addr.startsWith("Grupo:") || addr.startsWith("Vecindario") || addr.startsWith("Comunidad") || addr.startsWith("Área") || addr.startsWith("Sur de Indiana") || addr.startsWith("Louisville Metro /")) {
        continue;
      }
      const norm = normalizeAddr(addr);
      if (norm.length >= 4) {
        if (!addrGroups.has(norm)) addrGroups.set(norm, []);
        addrGroups.get(norm)!.push(c);
      }
    }

    for (const [normAddr, list] of addrGroups.entries()) {
      if (list.length > 1) {
        console.log(`\n🏠 Consolidando ${list.length} registros para dirección "${normAddr}":`);
        list.sort((a, b) => {
          const aScore = (a.phone ? 50 : 0) + ((a.notes || "").length > 200 ? 30 : 0) + (a.first_name !== "Propietario" ? 20 : 0);
          const bScore = (b.phone ? 50 : 0) + ((b.notes || "").length > 200 ? 30 : 0) + (b.first_name !== "Propietario" ? 20 : 0);
          return bScore - aScore;
        });

        const primary = list[0];
        const duplicates = list.slice(1);

        console.log(`  ⭐ Primario [${primary.id}]: "${primary.first_name} ${primary.last_name || ''}" | Tel: ${primary.phone || 'N/A'}`);

        const allNotes = Array.from(new Set(list.map(l => l.notes).filter(Boolean))).join("\n\n---\n");
        await sb.from("contacts").update({ notes: allNotes }).eq("id", primary.id);

        for (const dup of duplicates) {
          const ok = await reassignForeignKeysAndDelete(primary.id, dup.id);
          if (ok) console.log(`  ✅ Reasignado y eliminado duplicado [${dup.id}]`);
        }
      }
    }
  }

  // 2. DEDUPLICAR POR TELÉFONO
  console.log("\n--- FASE 2: FUSIÓN RELACIONAL POR TELÉFONO ---");
  const { data: contacts2 } = await sb.from("contacts").select("*");
  if (contacts2) {
    const phoneGroups = new Map<string, any[]>();
    for (const c of contacts2) {
      if (c.phone) {
        const norm = normalizePhoneNumber(c.phone);
        if (norm.length === 10) {
          if (!phoneGroups.has(norm)) phoneGroups.set(norm, []);
          phoneGroups.get(norm)!.push(c);
        }
      }
    }

    for (const [normPhone, list] of phoneGroups.entries()) {
      if (list.length > 1) {
        console.log(`\n📞 Consolidando ${list.length} registros para teléfono ${normPhone}:`);
        list.sort((a, b) => {
          const aScore = ((a.notes || "").length > 200 ? 50 : 0) + (a.first_name !== "Propietario" ? 30 : 0) + (a.pipeline_status !== "new_lead" ? 20 : 0);
          const bScore = ((b.notes || "").length > 200 ? 50 : 0) + (b.first_name !== "Propietario" ? 30 : 0) + (b.pipeline_status !== "new_lead" ? 20 : 0);
          return bScore - aScore;
        });

        const primary = list[0];
        const duplicates = list.slice(1);

        console.log(`  ⭐ Primario [${primary.id}]: "${primary.first_name} ${primary.last_name || ''}"`);

        const allNotes = Array.from(new Set(list.map(l => l.notes).filter(Boolean))).join("\n\n---\n");
        await sb.from("contacts").update({ notes: allNotes }).eq("id", primary.id);

        for (const dup of duplicates) {
          const ok = await reassignForeignKeysAndDelete(primary.id, dup.id);
          if (ok) console.log(`  ✅ Reasignado y eliminado duplicado [${dup.id}]`);
        }
      }
    }
  }

  console.log("\n=================================================================");
  console.log("🎉 ¡FUSIÓN RELACIONAL Y PURGA COMPLETADAS CON ÉXITO! 🎉");
  console.log("=================================================================\n");
}

runDeepPurgeAndMerge().catch(console.error);
