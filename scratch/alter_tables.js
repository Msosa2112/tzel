const { createClient } = require("@libsql/client");
require("dotenv").config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

async function main() {
  console.log("Altering tables in Turso to add new columns...");
  const queries = [
    "ALTER TABLE foreclosure_auctions ADD COLUMN mailing_address TEXT;",
    "ALTER TABLE foreclosure_auctions ADD COLUMN absentee_owner INTEGER DEFAULT 0;",
    "ALTER TABLE foreclosure_auctions ADD COLUMN sqft INTEGER;",
    "ALTER TABLE foreclosure_auctions ADD COLUMN beds INTEGER;",
    "ALTER TABLE foreclosure_auctions ADD COLUMN baths REAL;",
    
    "ALTER TABLE code_violations ADD COLUMN mailing_address TEXT;",
    "ALTER TABLE code_violations ADD COLUMN absentee_owner INTEGER DEFAULT 0;",
    "ALTER TABLE code_violations ADD COLUMN sqft INTEGER;",
    "ALTER TABLE code_violations ADD COLUMN beds INTEGER;",
    "ALTER TABLE code_violations ADD COLUMN baths REAL;"
  ];

  for (const sql of queries) {
    try {
      console.log(`Executing: ${sql}`);
      await db.execute(sql);
      console.log("Success.");
    } catch (err) {
      console.log(`Note (can be expected if already run): ${err.message}`);
    }
  }
}

main().catch(console.error);
