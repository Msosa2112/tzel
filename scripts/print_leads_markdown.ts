import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const url = "https://ddwyutisxymuvofkjhpz.supabase.co";
const serviceKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";
const sb = createClient(url, serviceKey);

async function printLeads() {
  const { data: leads, error } = await sb
    .from("contacts")
    .select("id, first_name, last_name, phone, address, notes, external_ref, created_at")
    .ilike("external_ref", "LEAD_%")
    .order("created_at", { ascending: false });

  if (error || !leads) {
    console.error("Error:", error);
    return;
  }

  console.log(`\n========================================================================`);
  console.log(`LISTA COMPLETA DE LEADS CALIFICADOS EN SUPABASE (${leads.length})`);
  console.log(`========================================================================\n`);

  const groups: Record<string, any[]> = {
    "🌐 FACEBOOK (DUEÑOS & SOLICITUDES EN VIVO)": [],
    "🏛️ INFRACCIONES MUNICIPALES 311 (LOUISVILLE CODE ENFORCEMENT)": [],
    "💼 SUBCONTRATOS COMERCIALES E INVERSIONISTAS DIRECTOS": [],
    "🌪️ DAÑOS POR TORMENTAS NOAA & NEXTDOOR": []
  };

  for (const l of leads) {
    const ext = l.external_ref || "";
    if (ext.includes("LEAD_FB_")) {
      groups["🌐 FACEBOOK (DUEÑOS & SOLICITUDES EN VIVO)"].push(l);
    } else if (ext.includes("LEAD_METRO_CODE_")) {
      groups["🏛️ INFRACCIONES MUNICIPALES 311 (LOUISVILLE CODE ENFORCEMENT)"].push(l);
    } else if (ext.includes("LEAD_TZEL_")) {
      groups["💼 SUBCONTRATOS COMERCIALES E INVERSIONISTAS DIRECTOS"].push(l);
    } else {
      groups["🌪️ DAÑOS POR TORMENTAS NOAA & NEXTDOOR"].push(l);
    }
  }

  for (const [title, items] of Object.entries(groups)) {
    console.log(`\n### ${title} (${items.length})\n`);
    items.forEach((item, idx) => {
      const name = `${item.first_name || ""} ${item.last_name || ""}`.trim();
      const phone = item.phone || "Buscador OSINT / DM";
      const addr = item.address || "Louisville Metro Area";
      const firstLine = (item.notes || "").split("\n")[0].replace("🎯 NECESIDAD: ", "").slice(0, 110);
      console.log(`${idx + 1}. **${name}** | 📞 \`${phone}\` | 📍 ${addr}`);
      if (firstLine) console.log(`   *Detalle:* ${firstLine}`);
    });
  }
}

printLeads().catch(console.error);
