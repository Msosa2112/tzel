import { createClient } from "@supabase/supabase-js";
import { enrichPropertyWithBatchData } from "../modules/construction/leads/batchdata_enricher";
import { db } from "../db";
import * as dotenv from "dotenv";

dotenv.config();

const url = process.env.BARBAPRO_SUPABASE_URL || "https://ddwyutisxymuvofkjhpz.supabase.co";
const serviceKey = process.env.BARBAPRO_SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";
const sb = createClient(url, serviceKey);

async function runBatchEnrichment(maxLeadsToProcess: number = 30) {
  console.log("=================================================================");
  console.log("🚀 EJECUTANDO ENRIQUECIMIENTO EN VIVO CON BATCHDATA API 🚀");
  console.log("=================================================================\n");

  // 1. Obtener leads sin teléfono con dirección física real en Supabase
  const { data: contacts, error } = await sb
    .from("contacts")
    .select("*")
    .is("phone", null)
    .order("created_at", { ascending: false });

  if (error || !contacts) {
    console.error("❌ Error consultando Supabase:", error);
    return;
  }

  // Filtrar direcciones válidas (excluir dummies de prueba y grupos genéricos)
  const validCandidates = contacts.filter(c => {
    const addr = (c.address || "").trim().toLowerCase();
    if (!addr || addr.length < 6) return false;
    if (addr.includes("123 main st") || addr.includes("456 oak ln") || addr.includes("test")) return false;
    if (addr.startsWith("grupo:") || addr.startsWith("vecindario") || addr.startsWith("comunidad") || addr.startsWith("área") || addr.startsWith("sur de indiana")) return false;
    return true;
  });

  console.log(`📋 Total de candidatos elegibles para enriquecer: ${validCandidates.length}`);
  const targetLeads = validCandidates.slice(0, maxLeadsToProcess);
  console.log(`🎯 Procesando lote de ${targetLeads.length} leads prioritarios...\n`);

  let enrichedCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < targetLeads.length; i++) {
    const lead = targetLeads[i];
    const fullAddress = lead.address.includes(",") ? lead.address : `${lead.address}, Louisville, KY`;

    console.log(`[${i + 1}/${targetLeads.length}] 🔍 Consultando BatchData para: "${fullAddress}" (Lead actual: "${lead.first_name} ${lead.last_name || ''}")...`);
    
    try {
      const enriched = await enrichPropertyWithBatchData(fullAddress);
      
      if (enriched && enriched.matched) {
        const updatePayload: any = {
          updated_at: new Date().toISOString()
        };

        if (enriched.primaryPhone) {
          updatePayload.phone = enriched.primaryPhone;
        }
        if (enriched.primaryEmail && !lead.email) {
          updatePayload.email = enriched.primaryEmail;
        }

        // Si el nombre actual es genérico, actualizar con el nombre real de la escritura
        const currentName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim().toLowerCase();
        if (currentName.includes("propietario") || currentName.includes("vecino") || currentName.includes("flip") || currentName.includes("cliente") || !lead.first_name) {
          if (enriched.ownerName && enriched.ownerName !== "Propietario") {
            const parts = enriched.ownerName.split(/\s+/);
            updatePayload.first_name = parts[0];
            updatePayload.last_name = parts.slice(1).join(" ");
          }
        }

        // Agregar notas de inteligencia y estatus de inversionista
        const absenteeNote = enriched.isAbsenteeOwner
          ? `\n🏢 INVERSIONISTA / PROPIETARIO NO RESIDENTE (Mailing: ${enriched.mailingAddress})`
          : `\n🏠 PROPIETARIO RESIDENTE`;
        
        const allPhonesStr = enriched.allPhones && enriched.allPhones.length > 1
          ? `\n📞 Teléfonos alternativos detectados: ${enriched.allPhones.join(", ")}`
          : "";

        const batchDataTag = `\n⚡ [VERIFICADO BATCHDATA]: Titular: ${enriched.ownerName} | Móvil Principal: ${enriched.primaryPhone || 'N/A'}${absenteeNote}${allPhonesStr}`;
        
        if (!(lead.notes || "").includes("[VERIFICADO BATCHDATA]")) {
          updatePayload.notes = (lead.notes || "") + "\n\n" + batchDataTag;
        }

        const { error: upErr } = await sb
          .from("contacts")
          .update(updatePayload)
          .eq("id", lead.id);

        if (!upErr) {
          enrichedCount++;
          console.log(`  🎉 ¡ÉXITO! Titular: "${enriched.ownerName}" | 📱 Tel: ${enriched.primaryPhone || 'Sin tel'} | 📧 ${enriched.primaryEmail || 'Sin email'}`);
        } else {
          console.warn(`  ⚠️ Error actualizando Supabase [${lead.id}]:`, upErr.message);
        }
      } else {
        skippedCount++;
        console.log(`  ℹ️ Sin coincidencia exacta en registros.`);
      }
    } catch (err: any) {
      console.error(`  ❌ Error procesando [${lead.id}]:`, err.message);
    }

    // Pequeña pausa de 200ms entre llamadas
    await new Promise(res => setTimeout(res, 200));
  }

  console.log("\n=================================================================");
  console.log(`🏁 LOTE FINALIZADO: ${enrichedCount} leads enriquecidos exitosamente, ${skippedCount} sin datos.`);
  console.log("=================================================================\n");
}

runBatchEnrichment(30).catch(console.error);
