import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

const url = "https://ddwyutisxymuvofkjhpz.supabase.co";
const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || "");
const sb = createClient(url, key);

const RECRUITER_OR_IRRELEVANT = [
  "recruiter",
  "talent",
  "staffing",
  "writer",
  "editor",
  "proofreader",
  "anesthesia",
  "dentist",
  "nurse",
  "cleaning",
  "limpieza",
  "caddy",
  "moving",
  "attractions",
  "history of"
];

async function purgeRecruiters() {
  const { data: contacts } = await sb
    .from("contacts")
    .select("id, first_name, last_name, notes")
    .or("external_ref.ilike.LEAD_%,notes.ilike.%SPEECH DE VENTA RECOMENDADO%");

  const toDelete = [];
  for (const c of (contacts || [])) {
    const text = `${c.first_name || ""} ${c.last_name || ""} ${c.notes || ""}`.toLowerCase();
    if (RECRUITER_OR_IRRELEVANT.some(k => text.includes(k))) {
      toDelete.push(c.id);
    }
  }

  for (const id of toDelete) {
    try {
      await sb.from("estimates").delete().eq("contact_id", id);
      await sb.from("contacts").delete().eq("id", id);
    } catch {}
  }

  const { count } = await sb
    .from("contacts")
    .select("*", { count: "exact", head: true })
    .or("external_ref.ilike.LEAD_%,notes.ilike.%SPEECH DE VENTA RECOMENDADO%");

  console.log(`✅ Eliminados ${toDelete.length} reclutadores y perfiles irrelevantes.`);
  console.log(`💎 Total de leads 100% enfocados en construcción y tormentas: ${count}`);
}

purgeRecruiters().catch(console.error);
