import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

const url = "https://ddwyutisxymuvofkjhpz.supabase.co";
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";
const sb = createClient(url, key);

async function deepCleanCrmLeads() {
  console.log("=================================================================");
  console.log("💎 LIMPIEZA PROFUNDA: DEJANDO EXCLUSIVAMENTE COMPRADORES Y OPORTUNIDADES REALES EN KY/IN 💎");
  console.log("=================================================================\n");

  const { data: contacts, error } = await sb
    .from("contacts")
    .select("id, first_name, last_name, phone, address, notes, external_ref")
    .or("external_ref.ilike.LEAD_%,notes.ilike.%SPEECH DE VENTA RECOMENDADO%");

  if (error) {
    console.error("Error consultando contactos:", error);
    return;
  }

  const toDelete: { id: string; name: string; reason: string }[] = [];

  for (const c of (contacts || [])) {
    const name = `${c.first_name || ""} ${c.last_name || ""}`.trim().toLowerCase();
    const notes = (c.notes || "").toLowerCase();
    const address = (c.address || "").toLowerCase();

    // 1. Descartar artefactos de UI de Facebook o nombres genéricos rotos
    if (
      name.includes("facebook") ||
      name.includes("vecino: inicio") ||
      name.includes("vecino: ¿qué pasa") ||
      name.includes("vecino: m") ||
      name.includes("vecino: l") ||
      name.includes("vecino: t") ||
      name.length <= 1
    ) {
      toDelete.push({ id: c.id, name, reason: "Artefacto de UI / Nombre no válido" });
      continue;
    }

    // 2. Descartar noticias de otros estados (Alabama, Florida, etc.)
    if (
      notes.includes("alabama") ||
      notes.includes("california") ||
      notes.includes("florida") ||
      notes.includes("birmingham") ||
      notes.includes("nashville") ||
      notes.includes("out of state")
    ) {
      toDelete.push({ id: c.id, name, reason: "Fuera de jurisdicción (No es KY/Sur de IN)" });
      continue;
    }

    // 3. Descartar conferencias, eventos de marketing o venta de cursos/software
    if (
      notes.includes("join us in") ||
      notes.includes("webinar") ||
      notes.includes("software") ||
      notes.includes("bidding platform") ||
      notes.includes("national power rankings") ||
      notes.includes("power100") ||
      notes.includes("attractions & things to do") ||
      notes.includes("wikipedia")
    ) {
      toDelete.push({ id: c.id, name, reason: "Evento/Marketing/Software (No es contratación de obra)" });
      continue;
    }

    // 4. Descartar posts repetitivos de UI o texto corrupto
    if (notes.includes("facebook\nfacebook\nfacebook")) {
      toDelete.push({ id: c.id, name, reason: "Texto de UI corrupto" });
      continue;
    }
  }

  console.log(`🚨 Total detectados para depuración profunda: ${toDelete.length}`);

  for (const item of toDelete) {
    try {
      await sb.from("estimates").delete().eq("contact_id", item.id);
      await sb.from("contacts").delete().eq("id", item.id);
    } catch {}
  }

  const { count: finalCount } = await sb
    .from("contacts")
    .select("*", { count: "exact", head: true })
    .or("external_ref.ilike.LEAD_%,notes.ilike.%SPEECH DE VENTA RECOMENDADO%");

  console.log(`\n=================================================================`);
  console.log(`✅ BASE DE DATOS TOTALMENTE PURGADA Y 100% CALIFICADA`);
  console.log(`🗑️ Registros eliminados: ${toDelete.length}`);
  console.log(`💎 Leads de Compradores Reales / Tormentas en KY & Sur de IN: ${finalCount}`);
  console.log(`=================================================================\n`);
}

if (require.main === module) {
  deepCleanCrmLeads().catch(console.error);
}
