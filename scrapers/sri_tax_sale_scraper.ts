import axios from "axios";
import * as cheerio from "cheerio";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

export interface SriTaxProperty {
  parcelId: string;
  address: string;
  county: string;
  state: string;
  ownerName: string;
  taxesOwed: number;
  saleDate: string;
}

/**
 * Scraper para SRI Services (Subastas de Impuestos de Indiana: Clark, Floyd, Harrison)
 */
export async function scrapeSriTaxSales(): Promise<SriTaxProperty[]> {
  console.log("=================================================================");
  console.log("📑 [SRI TAX SALES] Consultando subastas de impuestos fiscales en Indiana (SRI Services)...");
  console.log("=================================================================");

  const results: SriTaxProperty[] = [];
  const targetCounties = ["Clark", "Floyd", "Harrison"];

  for (const county of targetCounties) {
    try {
      console.log(`[SRI TAX SALES] Verificando listado para ${county} County, IN...`);
      // SRI Services index URL
      const url = `https://www.sriservices.com/sales-information/indiana/${county.toLowerCase()}-county/`;
      
      const resp = await axios.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
        timeout: 12000
      }).catch(() => null);

      if (resp && resp.status === 200) {
        const $ = cheerio.load(resp.data);
        $("table tbody tr").each((_, tr) => {
          const cols = $(tr).find("td");
          if (cols.length >= 4) {
            const parcel = $(cols[0]).text().trim();
            const owner = $(cols[1]).text().trim();
            const addr = $(cols[2]).text().trim();
            const taxStr = $(cols[3]).text().replace(/[^0-9.]/g, "");
            const tax = parseFloat(taxStr) || 0;

            if (parcel && addr) {
              results.push({
                parcelId: parcel,
                address: addr,
                county,
                state: "IN",
                ownerName: owner,
                taxesOwed: tax,
                saleDate: "Pendiente 2026"
              });
            }
          }
        });
      }
    } catch (e: any) {
      console.warn(`[SRI TAX SALES WARN] Error consultando ${county}: ${e.message}`);
    }
  }

  // Guardar en base de datos
  for (const item of results) {
    const taxId = `IN_${item.county.toUpperCase()}_${item.parcelId.replace(/[^a-zA-Z0-9]/g, "_")}`;
    await db.execute({
      sql: `
        INSERT INTO tax_sales (tax_sale_id, parcel_id, address, county, state, owner_name, taxes_owed, sale_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(tax_sale_id) DO UPDATE SET
          taxes_owed = excluded.taxes_owed,
          sale_date = excluded.sale_date
      `,
      args: [taxId, item.parcelId, item.address, item.county, item.state, item.ownerName, item.taxesOwed, item.saleDate]
    });
  }

  console.log(`[SRI TAX SALES] Total propiedades fiscales capturadas: ${results.length}`);
  return results;
}

if (require.main === module) {
  scrapeSriTaxSales().catch(console.error);
}
