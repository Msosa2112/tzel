import axios from "axios";
import { db } from "../db";
import { isHighYieldProperty } from "../underwriting/underwriter";
import * as dotenv from "dotenv";

dotenv.config();

const sparkToken = process.env.SPARK_ACCESS_TOKEN_1;

async function applyInvestorRulesToDatabase() {
  console.log("=================================================================");
  console.log("⚡ APLICANDO REGLAS SIMPLIFICADAS DEL INVERSIONISTA A TURSO DB ⚡");
  console.log("Filtro: ARV <= $350,000 USD y Margen (ARV - Deuda) >= $50,000 USD");
  console.log("=================================================================\n");

  const mlsHeaders = {
    "Authorization": `Bearer ${sparkToken}`,
    "Accept": "application/json"
  };

  const fa = await db.execute(`
    SELECT auction_id, address, case_number, appraisal_value, debt_amount, hidden_mortgages, hidden_liens_amount, mls_estimated_value, mls_status
    FROM foreclosure_auctions
    WHERE address IS NOT NULL AND address != ''
  `);

  console.log(`📋 Total de Subastas en BD: ${fa.rows.length}\n`);

  const date180DaysAgo = new Date();
  date180DaysAgo.setDate(date180DaysAgo.getDate() - 180);
  const date180Str = date180DaysAgo.toISOString().split("T")[0];

  const zipCompsCache: { [zip: string]: number } = {};

  async function getZipCompsARV(zip: string): Promise<number> {
    if (zipCompsCache[zip]) return zipCompsCache[zip];
    const compsFilter = `PostalCode eq '${zip}' and StandardStatus eq 'Closed' and ClosePrice gt 20000 and CloseDate ge ${date180Str}`;
    try {
      const res = await axios.get("https://replication.sparkapi.com/Reso/OData/Property", {
        headers: mlsHeaders,
        params: {
          "$filter": compsFilter,
          "$select": "ClosePrice",
          "$top": 12
        },
        timeout: 8000
      });
      const comps = res.data.value || [];
      if (comps.length > 0) {
        const sum = comps.reduce((acc: number, c: any) => acc + (c.ClosePrice || 0), 0);
        const avg = Math.round(sum / comps.length);
        zipCompsCache[zip] = avg;
        return avg;
      }
    } catch (e: any) {}
    return 0;
  }

  let updatedHighYield = 0;
  let updatedStandard = 0;

  for (const row of fa.rows) {
    const auctionId = row.auction_id as string;
    const address = (row.address as string || "").trim();
    const debt = (row.debt_amount as number) || 0;
    const hiddenMort = (row.hidden_mortgages as number) || 0;
    const hiddenLiens = (row.hidden_liens_amount as number) || 0;
    const totalDebt = debt + hiddenMort + hiddenLiens;

    const zipMatch = address.match(/\b\d{5}\b/);
    const zip = zipMatch ? zipMatch[0] : "";

    let arv = (row.mls_estimated_value as number) || 0;
    if (arv <= 0 && zip) {
      arv = await getZipCompsARV(zip);
    }
    if (arv <= 0) {
      arv = (row.appraisal_value as number) || 0;
    }

    const isHy = isHighYieldProperty(arv, totalDebt, 0, 0, 50000, 350000) ? 1 : 0;
    const spread = arv > 0 && totalDebt > 0 ? arv - totalDebt : 0;

    await db.execute({
      sql: `
        UPDATE foreclosure_auctions SET
          mls_estimated_value = ?,
          is_high_yield = ?,
          redemption_margin = ?,
          mls_status = CASE WHEN mls_status = 'pending_check' OR mls_status = 'not_found' THEN 'comps_estimated' ELSE mls_status END
        WHERE auction_id = ?
      `,
      args: [arv, isHy, spread, auctionId]
    });

    if (isHy === 1) updatedHighYield++;
    else updatedStandard++;
  }

  console.log("=================================================================");
  console.log(`🎉 ACTUALIZACIÓN COMPLETADA CON ÉXITO:`);
  console.log(`  ⭐ ${updatedHighYield} Propiedades marcadas como HIGH YIELD (Listas para Wholesaling / Negociar)`);
  console.log(`  🚫 ${updatedStandard} Propiedades descartadas (Sin margen o > $350k)`);
  console.log("=================================================================\n");
}

applyInvestorRulesToDatabase().catch(console.error);
