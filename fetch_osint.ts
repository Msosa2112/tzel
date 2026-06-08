import * as dotenv from "dotenv";
import axios from "axios";
import { createClient } from "@libsql/client";

// Load environment variables
dotenv.config();

// Initialize Turso client
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

// Keywords for OSINT Lexical Analysis of Distressed/Motivated Sellers
const DISTRESSED_KEYWORDS = [
  "as-is", "tlc", "handyman", "cash only", "motivated", 
  "bring all offers", "estate", "probate", "must sell", 
  "needs work", "foundation"
];

// Targeted Geographic Boundaries (Kentuckiana)
const TARGET_KY_COUNTIES = ["jefferson", "bullitt", "oldham", "shelby", "hardin", "nelson", "spencer"];
const TARGET_IN_COUNTIES = ["floyd", "clark", "harrison", "scott", "washington"];

interface PropertyRecord {
  ListingKey: string;
  ListingId: string;
  UnparsedAddress: string;
  PostalCode: string;
  ListPrice: number;
  OriginalListPrice: number;
  DaysOnMarket: number;
  PublicRemarks?: string;
  PrivateRemarks?: string;
  StandardStatus: string;
  CountyOrParish?: string;
  StateOrProvince?: string;
}

/**
 * Checks if a property belongs to our target geographic area (within 50 miles of Louisville)
 */
function isTargetLocation(state?: string, county?: string): boolean {
  if (!state || !county) return false;
  
  const countyLower = county.toLowerCase().trim();
  if (state === "KY" && TARGET_KY_COUNTIES.includes(countyLower)) {
    return true;
  }
  if (state === "IN" && TARGET_IN_COUNTIES.includes(countyLower)) {
    return true;
  }
  return false;
}

/**
 * Scans remarks for distress keywords
 */
function scanForKeywords(publicRemarks?: string, privateRemarks?: string): string[] {
  const matched: string[] = [];
  const textToScan = `${publicRemarks || ""} ${privateRemarks || ""}`.toLowerCase();
  
  for (const keyword of DISTRESSED_KEYWORDS) {
    if (textToScan.includes(keyword)) {
      matched.push(keyword);
    }
  }
  return matched;
}

/**
 * Fetches and processes distressed property opportunities from Spark API and saves them to Turso
 */
async function fetchAndProcessOsintOpportunities() {
  const sparkToken = process.env.SPARK_ACCESS_TOKEN_1;
  if (!sparkToken) {
    console.error("[ERROR] SPARK_ACCESS_TOKEN_1 is not set in environment.");
    process.exit(1);
  }

  console.log("[START] Initializing MLS OSINT Data Extraction...");

  // Endpoint to fetch MLS data (Replication endpoint since IDX is restricted)
  let nextUrl: string | null = "https://replication.sparkapi.com/Reso/OData/Property";
  
  // OData parameters
  // Profile 1: StandardStatus is Expired, Canceled, or Withdrawn
  // Profile 2: StandardStatus is Active AND DaysOnMarket > 90
  const odataFilter = `(StandardStatus eq 'Expired' or StandardStatus eq 'Canceled' or StandardStatus eq 'Withdrawn') or (StandardStatus eq 'Active' and DaysOnMarket gt 90)`;
  const odataSelect = "ListingKey,ListingId,UnparsedAddress,PostalCode,ListPrice,OriginalListPrice,DaysOnMarket,PublicRemarks,PrivateRemarks,StandardStatus,CountyOrParish,StateOrProvince";

  const params = {
    "$filter": odataFilter,
    "$select": odataSelect,
    "$top": 100, // Fetch in batches
  };

  let pageCount = 0;
  let totalProcessed = 0;
  let savedLeadsCount = 0;

  try {
    while (nextUrl) {
      console.log(`[MLS] Fetching page ${pageCount + 1}...`);
      
      const response: any = await axios.get(nextUrl, {
        headers: {
          "Authorization": `Bearer ${sparkToken}`,
          "Accept": "application/json"
        },
        // Only pass params on the first request. Subsequent requests use nextUrl from metadata
        params: pageCount === 0 ? params : undefined,
        timeout: 25000
      });

      if (response.status != 200) {
        throw new Error(`MLS API returned status ${response.status}: ${response.statusText}`);
      }

      const data: any = response.data;
      const properties: PropertyRecord[] = data.value || [];
      console.log(`[MLS] Retrieved ${properties.length} properties on this page.`);

      if (properties.length === 0) break;

      for (const prop of properties) {
        totalProcessed++;
        
        // 1. Geographic Filter
        if (!isTargetLocation(prop.StateOrProvince, prop.CountyOrParish)) {
          continue;
        }

        // 2. Keyword Filter
        const matchedKeywords = scanForKeywords(prop.PublicRemarks, prop.PrivateRemarks);
        if (matchedKeywords.length === 0) {
          // Skip if there are no distress signals in the remarks
          continue;
        }

        // 3. Panic Price Drop Calculation (Drop of 10% or more)
        const currentPrice = prop.ListPrice || 0;
        const originalPrice = prop.OriginalListPrice || currentPrice;
        let isPanicDrop = false;
        
        if (originalPrice > 0) {
          const dropPercentage = ((originalPrice - currentPrice) / originalPrice) * 100;
          if (dropPercentage >= 10.0) {
            isPanicDrop = true;
          }
        }

        // 4. Map Profile Type
        let profileType = "Active-Stale";
        if (["Expired", "Canceled", "Withdrawn"].includes(prop.StandardStatus)) {
          profileType = prop.StandardStatus;
        }

        // 5. Upsert Opportunity to Turso DB
        try {
          await db.execute({
            sql: `
              INSERT INTO osint_opportunities (
                mls_id, address, zip_code, current_price, original_price,
                days_on_market, panic_drop, keywords, profile_type, county, state
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(mls_id) DO UPDATE SET
                address = excluded.address,
                zip_code = excluded.zip_code,
                current_price = excluded.current_price,
                original_price = excluded.original_price,
                days_on_market = excluded.days_on_market,
                panic_drop = excluded.panic_drop,
                keywords = excluded.keywords,
                profile_type = excluded.profile_type,
                county = excluded.county,
                state = excluded.state
            `,
            args: [
              prop.ListingId,
              prop.UnparsedAddress,
              prop.PostalCode || null,
              currentPrice,
              originalPrice,
              prop.DaysOnMarket || 0,
              isPanicDrop ? 1 : 0,
              JSON.stringify(matchedKeywords),
              profileType,
              prop.CountyOrParish || null,
              prop.StateOrProvince || null
            ]
          });
          
          savedLeadsCount++;
          console.log(`[LEAD SAVED] ID: ${prop.ListingId} | Address: ${prop.UnparsedAddress} | Keywords: ${matchedKeywords.join(",")}`);
        } catch (dbErr) {
          console.error(`[DB ERROR] Failed to save lead ${prop.ListingId}:`, dbErr);
        }
      }

      // Handle OData pagination
      nextUrl = data["@odata.nextLink"] || null;
      pageCount++;
      
      // Safety break to prevent infinite loops or huge data transfers during development
      if (pageCount >= 10) {
        console.log("[INFO] Reached safety limit of 10 pages.");
        break;
      }
    }

    console.log("\n==========================================");
    printSummary(totalProcessed, savedLeadsCount);
    console.log("==========================================");

  } catch (error: any) {
    console.error("[ERROR] Execution failed:", error.message || error);
  }
}

function printSummary(checked: number, saved: number) {
  console.log("OSINT EXTRACTION SUMMARY:");
  console.log(`- Checked: ${checked} properties`);
  console.log(`- Distressed opportunities saved/updated to Turso: ${saved}`);
}

// Execute the function
fetchAndProcessOsintOpportunities();
