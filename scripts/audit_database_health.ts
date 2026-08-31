import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

const url = "https://ddwyutisxymuvofkjhpz.supabase.co";
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";
const sb = createClient(url, key);

async function auditDatabase() {
  console.log("=================================================================");
  console.log("🔍 AUDITORÍA DE INTEGRIDAD DE BASE DE DATOS BARBAPRO & TZEL 🔍");
  console.log("=================================================================\n");

  const tables = ["contacts", "estimates", "projects", "profiles", "brigades", "project_photos", "daily_notes", "bills", "payments"];
  
  for (const t of tables) {
    const { count, error } = await sb.from(t).select("*", { count: "exact", head: true });
    console.log(`📦 TABLA "${t}": ${error ? "⚠️ " + error.message : count + " registros"}`);
  }

  console.log("\n-----------------------------------------------------------------");
  console.log("👥 AUDITORÍA DE CONTACTOS POR ORIGEN:");
  console.log("-----------------------------------------------------------------");

  // 1. Contactos nativos de Barba (clientes orgánicos, POS, referidos, manuales)
  const { data: allContacts } = await sb.from("contacts").select("id, first_name, last_name, external_ref, notes, pipeline_status, source");
  
  const nativeContacts = (allContacts || []).filter(c => {
    const ref = c.external_ref || "";
    const notes = c.notes || "";
    return !ref.startsWith("LEAD_") && !notes.includes("SPEECH DE VENTA RECOMENDADO");
  });

  const tzelLeads = (allContacts || []).filter(c => {
    const ref = c.external_ref || "";
    const notes = c.notes || "";
    return ref.startsWith("LEAD_") || notes.includes("SPEECH DE VENTA RECOMENDADO");
  });

  console.log(`👤 Clientes Nativos de Barba (CRM Pipeline / POS): ${nativeContacts.length} registros`);
  console.log(`📡 Leads Generados por el Radar de TZEL: ${tzelLeads.length} registros`);
  console.log(`📊 Total general en tabla 'contacts': ${allContacts?.length || 0} registros`);

  console.log("\n📋 Muestra de Clientes Nativos de Barba:");
  nativeContacts.forEach((nc, idx) => {
    console.log(`   ${idx + 1}. [${nc.first_name || ''} ${nc.last_name || ''}] (Estado: ${nc.pipeline_status || 'N/A'}, Ref: ${nc.external_ref || 'Ninguna'})`);
  });
}

auditDatabase().catch(console.error);
