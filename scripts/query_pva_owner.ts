import axios from "axios";

async function queryPvaOwner() {
  const url = "https://gis.lojic.org/maps/rest/services/LojicSolutions/OpenDataPVA/MapServer/1/query";
  console.log("🏛️ Consultando propietario oficial en OpenDataPVA...");
  try {
    const res = await axios.get(url, {
      params: {
        where: "PARCELID = '054J00280000' OR LRSN = 185973",
        outFields: "*",
        f: "json",
        returnGeometry: "false"
      },
      timeout: 8000
    });
    console.log("✅ Datos Oficiales PVA:", JSON.stringify(res.data?.features?.[0]?.attributes || res.data, null, 2));
  } catch (err: any) {
    console.error("❌ Error PVA:", err.message);
  }
}

queryPvaOwner();
