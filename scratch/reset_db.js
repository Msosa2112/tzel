const { createClient } = require("@libsql/client");
require("dotenv").config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

async function main() {
  console.log("Resetting all foreclosure_auctions for a fresh cross-reference run...");
  const res = await db.execute(`
    UPDATE foreclosure_auctions 
    SET 
      mls_status = 'pending_check', 
      mls_id = NULL, 
      mls_estimated_value = NULL, 
      is_high_yield = 0, 
      telegram_sent = 0
  `);
  console.log("Database reset complete. Result:", res);
}

main().catch(console.error);
