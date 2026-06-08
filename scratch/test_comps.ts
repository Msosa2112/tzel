import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

async function getPropertyComps(address: string, state: string) {
  const token = process.env.SPARK_ACCESS_TOKEN_1;
  const url = "https://replication.sparkapi.com/Reso/OData/Property";
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/json"
  };

  // 1. Extract house number (e.g., 3413)
  const houseNumberMatch = address.match(/^\d+/);
  if (!houseNumberMatch) {
    console.log("Could not parse house number from", address);
    return;
  }
  const houseNumber = houseNumberMatch[0];

  console.log(`\n=============================================================`);
  console.log(`[TEST COMPS] Address: ${address} | State: ${state}`);
  console.log(`[TEST COMPS] Step 1: Querying target property features...`);

  // Query MLS for target property historic records
  const propParams = {
    "$filter": `contains(UnparsedAddress, '${houseNumber}') and StateOrProvince eq '${state}'`,
    "$select": "ListingId,UnparsedAddress,PostalCode,BedroomsTotal,BathroomsTotalDecimal,LivingArea,YearBuilt,ListPrice,ClosePrice,StandardStatus,CloseDate",
    "$top": 10
  };

  try {
    const propRes = await axios.get(url, { headers, params: propParams });
    const records = propRes.data.value || [];
    console.log(`Found ${records.length} historic listings in MLS.`);
    
    if (records.length === 0) {
      console.log("Target property not found in MLS.");
      return;
    }

    // Sort by CloseDate or ListPrice to get the most recent or relevant record
    // Let's filter records that have BedroomsTotal or LivingArea populated
    const validRecords = records.filter((r: any) => r.LivingArea > 0 || r.BedroomsTotal > 0);
    const target = validRecords.length > 0 ? validRecords[0] : records[0];
    
    console.log("\nTarget Property Profile:");
    console.log(`- Address: ${target.UnparsedAddress}`);
    console.log(`- Zip Code: ${target.PostalCode}`);
    console.log(`- Beds: ${target.BedroomsTotal}`);
    console.log(`- Baths: ${target.BathroomsTotalDecimal}`);
    console.log(`- SqFt (LivingArea): ${target.LivingArea}`);
    console.log(`- Year Built: ${target.YearBuilt}`);
    console.log(`- Last Historic Price: $${(target.ClosePrice || target.ListPrice || 0).toLocaleString()}`);
    console.log(`- Last Status: ${target.StandardStatus}`);

    const zip = target.PostalCode;
    const beds = target.BedroomsTotal;
    const baths = target.BathroomsTotalDecimal || 1;
    const sqft = target.LivingArea;

    if (!zip || !sqft || !beds) {
      console.log("Missing key characteristics (Zip, SqFt, Beds) to run comps. Cannot proceed.");
      return;
    }

    // Step 2: Query for closed comps in the last 180 days (or 365 days fallback)
    console.log(`\n[TEST COMPS] Step 2: Querying closed comps in Zip ${zip} with similar size...`);
    
    const date180DaysAgo = new Date();
    date180DaysAgo.setDate(date180DaysAgo.getDate() - 180);
    const date180Str = date180DaysAgo.toISOString().split("T")[0];

    // OData filter for comps:
    // - Same ZIP code
    // - StandardStatus is Closed
    // - ClosePrice > 0
    // - Beds +/- 1
    // - LivingArea +/- 300
    // - Sold in last 180 days
    const compsFilter = `PostalCode eq '${zip}' and StandardStatus eq 'Closed' and ClosePrice gt 0 and BedroomsTotal ge ${beds - 1} and BedroomsTotal le ${beds + 1} and LivingArea ge ${sqft - 300} and LivingArea le ${sqft + 300} and CloseDate ge ${date180Str}`;
    
    const compsParams = {
      "$filter": compsFilter,
      "$select": "ListingId,UnparsedAddress,ClosePrice,CloseDate,BedroomsTotal,BathroomsTotalDecimal,LivingArea",
      "$top": 10
    };

    console.log("Comps filter:", compsFilter);
    let compsRes = await axios.get(url, { headers, params: compsParams });
    let comps = compsRes.data.value || [];
    
    // Fallback to 365 days if 0 comps found
    if (comps.length === 0) {
      console.log("No comps found in last 180 days. Falling back to 365 days...");
      const date365DaysAgo = new Date();
      date365DaysAgo.setDate(date365DaysAgo.getDate() - 365);
      const date365Str = date365DaysAgo.toISOString().split("T")[0];
      
      const compsFilter365 = `PostalCode eq '${zip}' and StandardStatus eq 'Closed' and ClosePrice gt 0 and BedroomsTotal ge ${beds - 1} and BedroomsTotal le ${beds + 1} and LivingArea ge ${sqft - 300} and LivingArea le ${sqft + 300} and CloseDate ge ${date365Str}`;
      
      const compsParams365 = {
        "$filter": compsFilter365,
        "$select": "ListingId,UnparsedAddress,ClosePrice,CloseDate,BedroomsTotal,BathroomsTotalDecimal,LivingArea",
        "$top": 10
      };
      compsRes = await axios.get(url, { headers, params: compsParams365 });
      comps = compsRes.data.value || [];
    }

    console.log(`Found ${comps.length} closed comps.`);
    if (comps.length > 0) {
      console.log("\nMatching Closed Comps:");
      let totalPrice = 0;
      for (const comp of comps) {
        console.log(`- ${comp.UnparsedAddress} | Price: $${comp.ClosePrice.toLocaleString()} | Date: ${comp.CloseDate} | Beds: ${comp.BedroomsTotal} | SqFt: ${comp.LivingArea}`);
        totalPrice += comp.ClosePrice;
      }
      const avgPrice = totalPrice / comps.length;
      console.log(`\n=============================================================`);
      console.log(`[ARV CALCULATION] Average Comps Price: $${avgPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
      console.log(`[ARV COMPARISON] Historic Price: $${(target.ClosePrice || target.ListPrice || 0).toLocaleString()} vs New ARV: $${avgPrice.toLocaleString()}`);
      console.log(`=============================================================\n`);
    } else {
      console.log("No comps found. Falling back to historic price.");
    }

  } catch (err: any) {
    console.error("Error:", err.message || err);
    if (err.response) {
      console.error("Response data:", err.response.data);
    }
  }
}

async function runTest() {
  // Let's test both target properties
  await getPropertyComps("1935 Gardiner Lane, Apt. F82, 40205", "KY");
  await getPropertyComps("3413 Foreman Ln. 40219", "KY");
  await getPropertyComps("3711 West Broadway 40211", "KY"); // Let's see what happens to this $9k lot!
}

runTest();
