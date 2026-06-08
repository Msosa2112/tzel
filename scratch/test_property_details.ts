import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const token = process.env.SPARK_ACCESS_TOKEN_1;
  const url = "https://replication.sparkapi.com/Reso/OData/Property";
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Accept": "application/json"
  };
  
  // Let's test with a house number like '3413' (Foreman Ln) or '1935' (Gardiner Lane)
  const params = {
    "$top": 1
  };
  
  console.log("Querying Spark MLS for top 1 property to inspect all keys...");
  try {
    const res = await axios.get(url, { headers, params });
    console.log("Status:", res.status);
    if (res.data.value && res.data.value.length > 0) {
      const prop = res.data.value[0];
      const keys = Object.keys(prop);
      
      const searchTerms = ["bedroom", "bathroom", "bath", "bed", "area", "year", "built", "postal", "zip"];
      const filteredKeys = keys.filter(k => 
        searchTerms.some(term => k.toLowerCase().includes(term))
      );
      
      console.log("Filtered keys:");
      console.log(filteredKeys);
    } else {
      console.log("No properties found.");
    }
  } catch (err: any) {
    console.error("Error:", err.message || err);
  }
}

main();
