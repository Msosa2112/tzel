import axios from "axios";

async function testViolations() {
  const endpoint = "https://services1.arcgis.com/79kfd2K6fskCAkyg/arcgis/rest/services/PM_SiteVisit_Violations/FeatureServer/0/query";
  console.log("Querying Louisville Metro Code Enforcement violations...");

  // Filtrar por violaciones de techos o fachadas (ROOF / EXTERIOR / SIDING)
  const params = {
    where: "1=1",
    outFields: "*",
    f: "json",
    resultRecordCount: 15,
    orderByFields: "ObjectId DESC"
  };

  try {
    const res = await axios.get(endpoint, { params, timeout: 15000 });
    const features = res.data?.features || [];
    console.log(`Fetched ${features.length} recent violations from Louisville Metro!`);

    features.forEach((f: any, idx: number) => {
      const a = f.attributes;
      console.log(`\n[${idx + 1}] ID: ${a.ObjectId || a.OBJECTID} | CODE: ${a.violation_code || a.VIOLATION_CODE || a.violation_description || a.VIOLATION_DESCRIPTION || a.code_section}`);
      console.log(`    ADDRESS: ${a.full_address || a.FULL_ADDRESS || a.address || a.street_name || a.STREET_NAME}`);
      console.log(`    DESC: ${a.violation_description || a.comments || a.COMMENTS || a.description || a.DESCRIPTION}`);
      console.log(`    DATE: ${a.inspection_date || a.date_entered || a.created_date}`);
    });
  } catch (err: any) {
    console.error("Error querying violations endpoint:", err.message);
  }
}

testViolations().catch(console.error);
