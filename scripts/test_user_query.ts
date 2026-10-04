import { createClient } from "@supabase/supabase-js";

const url = "https://ddwyutisxymuvofkjhpz.supabase.co";
const anonKey = (process.env.SUPABASE_ANON_KEY || "");
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "");

async function testUserQuery() {
  const sbAdmin = createClient(url, serviceKey);
  const { data: users } = await sbAdmin.auth.admin.listUsers();
  
  for (const u of (users?.users || [])) {
    console.log(`\nTesting as user: ${u.email} (${u.id})`);
    // Generate session or test with user context
    const sbUser = createClient(url, anonKey);
    // Sign in without password using admin generateLink or magic link token
    const { data: linkData, error: linkErr } = await sbAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: u.email!
    });
    
    if (linkData?.properties?.action_link) {
      const token = linkData.properties.hashed_token;
      // Verify token
      const { data: sessionData, error: sessErr } = await sbUser.auth.verifyOtp({
        token_hash: token,
        type: "magiclink"
      });

      if (sessionData?.session) {
        const { data: leads, error: leadErr } = await sbUser
          .from("contacts")
          .select("*")
          .or("external_ref.ilike.LEAD_%,notes.ilike.%SPEECH%")
          .order("created_at", { ascending: false });

        console.log(`User [${u.email}] -> Leads count: ${leads?.length}, Error: ${leadErr ? leadErr.message : "none"}`);
      } else {
        console.log(`Failed to verify session for ${u.email}: ${sessErr?.message}`);
      }
    }
  }
}

testUserQuery().catch(console.error);
