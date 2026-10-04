import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

const url = "https://ddwyutisxymuvofkjhpz.supabase.co";
const anonKey = (process.env.SUPABASE_ANON_KEY || "");
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "");

async function main() {
  console.log("=== 1. TEST CON SERVICE_ROLE ===");
  const sbAdmin = createClient(url, serviceKey);
  const { data: adminData, error: adminErr } = await sbAdmin
    .from("contacts")
    .select("id, first_name, last_name, external_ref")
    .ilike("external_ref", "LEAD_%");
  console.log("Admin count:", adminData?.length, "Error:", adminErr?.message || "none");

  console.log("\n=== 2. TEST CON ANON KEY (Sin Login) ===");
  const sbAnon = createClient(url, anonKey);
  const { data: anonData, error: anonErr } = await sbAnon
    .from("contacts")
    .select("id, first_name, last_name, external_ref")
    .ilike("external_ref", "LEAD_%");
  console.log("Anon count:", anonData?.length, "Error:", anonErr?.message || "none");

  console.log("\n=== 3. VERIFICAR RLS EN TABLA CONTACTS ===");
  const { data: rlsCheck } = await sbAdmin.from("contacts").select("id").limit(1);
  console.log("Sample contact ID:", rlsCheck?.[0]?.id);
}

main().catch(console.error);
