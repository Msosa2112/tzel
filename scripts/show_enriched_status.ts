import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

const url = "https://ddwyutisxymuvofkjhpz.supabase.co";
const serviceKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";
const sb = createClient(url, serviceKey);

async function showEnrichedLeads() {
  const { data: leads, error } = await sb
    .from("contacts")
    .select("id, first_name, last_name, phone, address, city, state, pipeline_status, notes, created_at")
    .ilike("external_ref", "LEAD_%")
    .order("created_at", { ascending: false });

  if (error || !leads) {
    console.error("Error:", error);
    return;
  }

  console.log(`\n=============================================================`);
  console.log(`📊 TOTAL LEADS EN SUPABASE: ${leads.length}`);
  console.log(`=============================================================\n`);

  const withRealNames = leads.filter(l => l.first_name && l.first_name !== "Propietario" && l.first_name !== "Infracción" && l.first_name !== "Interesado");
  const withPhones = leads.filter(l => l.phone && l.phone.trim().length > 5);

  console.log(`👤 Leads con Nombre Real Identificado: ${withRealNames.length}`);
  console.log(`📱 Leads con Teléfono Directo: ${withPhones.length}\n`);

  console.log("📋 MUESTRA DE PROPIEDADES ENRIQUECIDAS RECIENTEMENTE:");
  leads.slice(0, 15).forEach((l, idx) => {
    console.log(`[${idx + 1}] ${l.first_name} ${l.last_name || ''} | Tel: ${l.phone || 'Pendiente'} | Dir: ${l.address || 'N/A'}`);
  });
}

showEnrichedLeads();
