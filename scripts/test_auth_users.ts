import { createClient } from "@supabase/supabase-js";

const url = "https://ddwyutisxymuvofkjhpz.supabase.co";
const serviceKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";
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
