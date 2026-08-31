import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

async function testBatchDataLive() {
  const apiKey = process.env.SKIP_TRACE_API_KEY;
  console.log("🔑 Probando SkipTrace / BatchData API Key:", apiKey ? `${apiKey.substring(0, 6)}...` : "NO DEFINIDA");

  try {
    const res = await axios.post(
      "https://api.batchdata.com/api/v1/property/skip-trace",
      {
        requests: [
          {
            address: {
              street: "808 BROOKLINE AVE",
              city: "Louisville",
              state: "KY",
              zip: "40215"
            }
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        timeout: 10000
      }
    );

    console.log("✅ Respuesta BatchData Exitosa:", JSON.stringify(res.data, null, 2));
  } catch (err: any) {
    console.log("❌ Estado de Error HTTP:", err.response?.status);
    console.log("❌ Detalle de Error BatchData:", JSON.stringify(err.response?.data || err.message, null, 2));
  }
}

testBatchDataLive();
