import { createClient } from "@supabase/supabase-js";

const url = "https://ddwyutisxymuvofkjhpz.supabase.co";
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "");
const sb = createClient(url, serviceKey);

async function testRLS() {
  const { data: users } = await sb.auth.admin.listUsers();
  console.log("Total auth users:", users?.users?.length);
  const sampleUser = users?.users?.[0];
  if (sampleUser) {
    console.log("Sample user email:", sampleUser.email, "id:", sampleUser.id);
  }
}

testRLS().catch(console.error);
