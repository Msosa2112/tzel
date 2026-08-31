import axios from "axios";

async function queryLojicDirect() {
  const url = "https://gis.lojic.org/maps/rest/services/LojicSolutions/OpenDataAddresses/MapServer/0/query";
  console.log("🌐 Consultando LOJIC directo con axios...");
  try {
    const res = await axios.get(url, {
      params: {
        where: "FULL_ADDRESS LIKE '808 BROOKLINE%'",
        outFields: "*",
        f: "json",
        returnGeometry: "false"
      },
      timeout: 8000
    });
    console.log("✅ Respuesta LOJIC:", JSON.stringify(res.data?.features?.[0]?.attributes || res.data, null, 2));
  } catch (err: any) {
    console.error("❌ Error LOJIC:", err.message);
  }
}

queryLojicDirect();
