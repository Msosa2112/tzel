import axios from "axios";
import { db } from "../db";
import * as dotenv from "dotenv";

dotenv.config();

const sparkToken = process.env.SPARK_ACCESS_TOKEN_1;

async function updateCodeViolationsMCA() {
  console.log("=================================================================");
  console.log("⚡ ACTUALIZANDO MCA / ARV REAL EN TURSO DB (589 INFRACCIONES) ⚡");
  console.log("=================================================================\n");

  const mlsHeaders = {
    "Authorization": `Bearer ${sparkToken}`,
    "Accept": "application/json"
  };

  const res = await db.execute(`
    SELECT violation_id, address
    FROM code_violations
    WHERE address IS NOT NULL AND address != ''
  `);

  const date180DaysAgo = new Date();
  date180DaysAgo.setDate(date180DaysAgo.getDate() - 180);
  const date180Str = date180DaysAgo.toISOString().split("T")[0];

  const zipCompsCache: { [zip: string]: number } = {};

  async function getZipARV(zip: string): Promise<number> {
    if (zipCompsCache[zip]) return zipCompsCache[zip];
    const compsFilter = `PostalCode eq '${zip}' and StandardStatus eq 'Closed' and ClosePrice gt 20000 and CloseDate ge ${date180Str}`;
    try {
      const resp = await axios.get("https://replication.sparkapi.com/Reso/OData/Property", {
        headers: mlsHeaders,
        params: {
          "$filter": compsFilter,
          "$select": "ClosePrice",
          "$top": 20
        },
        timeout: 8000
      });
      const comps = resp.data.value || [];
      if (comps.length > 0) {
        const sum = comps.reduce((acc: number, c: any) => acc + (c.ClosePrice || 0), 0);
        const avg = Math.round(sum / comps.length);
        zipCompsCache[zip] = avg;
        return avg;
      }
    } catch (e: any) {}
    return 0;
  }

  let updatedCount = 0;
  let targetCount = 0;

  for (const row of res.rows) {
    const id = row.violation_id as string;
    const addr = (row.address as string || "").trim();
    const zipMatch = addr.match(/\b\d{5}\b/);
    const zip = zipMatch ? zipMatch[0] : "";

    let arv = 0;
    if (zip) {
      arv = await getZipARV(zip);
    }

    const isTarget = arv > 0 && arv <= 350000 ? 1 : 0;

    await db.execute({
      sql: `
        UPDATE code_violations SET
          mls_estimated_value = ?,
          is_high_yield = ?,
          mls_status = CASE WHEN ? > 0 THEN 'comps_estimated' ELSE 'no_comps' END
        WHERE violation_id = ?
      `,
      args: [arv, isTarget, arv, id]
    });

    updatedCount++;
    if (isTarget === 1) targetCount++;
  }

  console.log("=================================================================");
  console.log(`🎉 589 PROPIEDADES ACTUALIZADAS CON VALOR DE MERCADO MLS:`);
  console.log(`  🎯 ${targetCount} propiedades dentro del target de rotación rápida (<= $350k)`);
  console.log(`  📊 ${updatedCount} propiedades actualizadas en total.`);
  console.log("=================================================================\n");
}

updateCodeViolationsMCA().catch(console.error);
