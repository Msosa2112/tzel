const { createClient } = require("@libsql/client");
require("dotenv").config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

async function main() {
  console.log("Resetting all foreclosure_auctions and code_violations for a fresh run...");
  
  const res1 = await db.execute(`
    UPDATE foreclosure_auctions 
    SET 
      mls_status = 'pending_check', 
      mls_id = NULL, 
      mls_estimated_value = NULL, 
      is_high_yield = 0, 
      defendant_phones = NULL,
      defendant_emails = NULL,
      telegram_sent = 0,
      mailing_address = NULL,
      absentee_owner = 0,
      sqft = NULL,
      beds = NULL,
      baths = NULL
  `);
  console.log("Foreclosure auctions reset complete:", res1.rowsAffected);

  const res2 = await db.execute(`
    UPDATE code_violations 
    SET 
      owner_name = 'DUEÑO DESCONOCIDO',
      mls_status = 'pending_check', 
      mls_id = NULL, 
      mls_estimated_value = NULL, 
      is_high_yield = 0, 
      defendant_phones = NULL,
      defendant_emails = NULL,
      telegram_sent = 0,
      mailing_address = NULL,
      absentee_owner = 0,
      sqft = NULL,
      beds = NULL,
      baths = NULL
  `);
  console.log("Code violations reset complete:", res2.rowsAffected);
}

main().catch(console.error);
