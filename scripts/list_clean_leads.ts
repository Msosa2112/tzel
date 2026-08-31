import { createClient } from "@supabase/supabase-js";

const url = "https://ddwyutisxymuvofkjhpz.supabase.co";
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";
const sb = createClient(url, key);

async function listLeads() {
  const { data } = await sb
    .from("contacts")
    .select("id, first_name, last_name, phone, address, notes, external_ref")
    .ilike("external_ref", "LEAD_%")
    .order("created_at", { ascending: false });

  console.log(`TOTAL CLEAN LEADS IN DB: ${data?.length}`);
  data?.forEach((l, i) => {
    console.log(`[${i + 1}] ID: ${l.id} | NAME: ${l.first_name} ${l.last_name || ""} | TEL: ${l.phone || "N/A"} | ADDR: ${l.address}`);
    console.log(`    NEED: ${l.notes?.slice(0, 100).replace(/\n/g, " ")}`);
  });
}

listLeads().catch(console.error);
