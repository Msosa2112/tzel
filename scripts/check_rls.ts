import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

const url = "https://ddwyutisxymuvofkjhpz.supabase.co";
const anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNTMzOTUsImV4cCI6MjA5MjYyOTM5NX0.MUsRX_h5TZJ2LeS-iXFpdQK3bIV6GOBO2-DW1m9MdsA";
const serviceKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";

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
