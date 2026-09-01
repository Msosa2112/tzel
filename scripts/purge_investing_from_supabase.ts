import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

const url = process.env.BARBAPRO_SUPABASE_URL || "https://ddwyutisxymuvofkjhpz.supabase.co";
const serviceKey = process.env.BARBAPRO_SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";
const sb = createClient(url, serviceKey);

async function purgeRealEstateFromCRM() {
  console.log("=================================================================");
  console.log("🧹 PURGANDO INVERSIÓN, SUBASTAS Y PRE-FORECLOSURES DEL CRM DE BARBA 🧹");
  console.log("=================================================================\n");

  // 1. Eliminar por external_ref
  const { data: delRef, error: errRef } = await sb
    .from("contacts")
    .delete()
    .ilike("external_ref", "LEAD_PREFORECLOSURE_%")
    .select("id");

  console.log(`🗑️ Eliminados por external_ref LEAD_PREFORECLOSURE: ${delRef?.length || 0}`);

  // 2. Eliminar cualquier residuo que contenga marcas de inversión o subasta judicial en notes
  const { data: delNotes, error: errNotes } = await sb
    .from("contacts")
    .delete()
    .ilike("notes", "%PRE-FORECLOSURE%")
    .select("id");

  console.log(`🗑️ Eliminados por contenido de inversión en notes: ${delNotes?.length || 0}`);

  // 3. Verificar estado limpio de contacts
  const { data: remaining } = await sb
    .from("contacts")
    .select("id, external_ref, notes, first_name, last_name");

  console.log(`\n✅ Total de Contactos Restantes en Barba CRM (Solo Construcción y Obras): ${remaining?.length || 0}`);
}

purgeRealEstateFromCRM().catch(console.error);
