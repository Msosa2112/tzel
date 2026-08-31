import axios from "axios";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import { ConstructionBid, ConstructionJurisdiction } from "../types";
import { classifyConstructionItem } from "../classifiers/gemini_construction_classifier";
import { saveConstructionBid } from "../db_construction";

/**
 * Ingestor de Licitaciones Públicas de Construcción (KY, IN y Federal)
 */
export class PublicBidsCollector {
  
  /**
   * Recolector de Licitaciones de Louisville Metro (Portal Oficial Bonfire de Adquisiciones)
   */
  async collectLouisvilleMetroBids(): Promise<ConstructionBid[]> {
    console.log("\n[BIDS] Escaneando portal oficial Bonfire de Louisville Metro (KY)...");
    const rawBids: ConstructionBid[] = [];

    let browser = null;
    try {
      browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto("https://louisvilleky.bonfirehub.com/portal/?tab=openOpportunities", {
        waitUntil: "domcontentloaded",
        timeout: 25000
      });

      // Esperar renderizado dinámico de la tabla
      await page.waitForTimeout(3500);

      const items = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll("table tbody tr"));
        return rows.map(tr => {
          const text = (tr as HTMLElement).innerText || "";
          const linkEl = tr.querySelector("a") as HTMLAnchorElement;
          const link = linkEl?.href || "";
          const cells = Array.from(tr.querySelectorAll("td")).map(td => (td as HTMLElement).innerText.trim());
          return {
            refId: cells[1] || "",
            title: cells[2] || "",
            department: cells[3] || "",
            closeDate: cells[4] || "",
            link,
            rawText: text
          };
        });
      });

      for (const item of items) {
        if (item.title && item.title.length > 3) {
          const bidId = `KY_LOU_${item.refId ? item.refId.replace(/[^a-zA-Z0-9]/g, "") : Buffer.from(item.title).toString("hex").substring(0, 12)}`;
          rawBids.push({
            bidId,
            title: item.title,
            agency: item.department ? `Louisville Metro - ${item.department}` : "Louisville Metro Government",
            jurisdiction: "Louisville_Metro_KY",
            category: "CIVIL_INFRASTRUCTURE_PUBLIC",
            bidDeadline: item.closeDate || undefined,
            solicitationUrl: item.link || "https://louisvilleky.bonfirehub.com/portal/?tab=openOpportunities",
            description: `${item.title} | Departamento: ${item.department} | Cierre: ${item.closeDate}`
          });
        }
      }
    } catch (err: any) {
      console.warn(`[BIDS WARN] Error leyendo Bonfire Louisville: ${err.message}`);
    } finally {
      if (browser) await browser.close();
    }

    return this.processAndSaveBids(rawBids, "Louisville Metro Procurement (Bonfire)");
  }

  /**
   * Recolector de Licitaciones Estatales de Kentucky (KYTC / Finance Cabinet)
   */
  async collectKentuckyStateBids(): Promise<ConstructionBid[]> {
    console.log("\n[BIDS] Escaneando portal de adquisiciones del Estado de Kentucky (KYTC / Finance)...");
    const rawBids: ConstructionBid[] = [];

    try {
      const url = "https://transportation.ky.gov/Construction-Procurement/Pages/default.aspx";
      const response = await axios.get(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        timeout: 10000
      }).catch(() => null);

      if (response && response.data) {
        const $ = cheerio.load(response.data);
        $("a[href*='Letting'], a[href*='Project'], a[href*='Bid'], .ms-rtestate-field a").each((_, el) => {
          const title = $(el).text().trim();
          const link = $(el).attr("href") || "";
          if (title && title.length > 8 && (title.toLowerCase().includes("letting") || title.toLowerCase().includes("construction") || title.toLowerCase().includes("proposal") || title.toLowerCase().includes("paving"))) {
            const bidUrl = link.startsWith("http") ? link : `https://transportation.ky.gov${link}`;
            rawBids.push({
              bidId: `KY_KYTC_${Buffer.from(title).toString("hex").substring(0, 12)}`,
              title,
              agency: "Kentucky Transportation Cabinet (KYTC)",
              jurisdiction: "State_Of_Kentucky",
              category: "CIVIL_INFRASTRUCTURE_PUBLIC",
              solicitationUrl: bidUrl,
              description: `Concurso oficial de obra pública vial del Estado de Kentucky: ${title}`
            });
          }
        });
      }
    } catch (err: any) {
      console.warn(`[BIDS WARN] Error leyendo KYTC State Bids: ${err.message}`);
    }

    return this.processAndSaveBids(rawBids, "State of Kentucky Transportation Cabinet");
  }

  /**
   * Recolector de Licitaciones de Indiana (IDOA & Sur de Indiana)
   */
  async collectIndianaStateBids(): Promise<ConstructionBid[]> {
    console.log("\n[BIDS] Escaneando portal de adquisiciones del Estado de Indiana (IDOA / Sur de IN)...");
    const rawBids: ConstructionBid[] = [];

    try {
      const url = "https://www.in.gov/indot/doing-business-with-indot/procurement/contract-lettings/";
      const response = await axios.get(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        timeout: 10000
      }).catch(() => null);

      if (response && response.data) {
        const $ = cheerio.load(response.data);
        $("a[href*='letting'], a[href*='bulletin'], table tr td a").each((_, el) => {
          const title = $(el).text().trim();
          const link = $(el).attr("href") || "";

          if (title && title.length > 6 && (title.toLowerCase().includes("letting") || title.toLowerCase().includes("bid") || title.toLowerCase().includes("contract") || title.toLowerCase().includes("bulletin"))) {
            const bidUrl = link.startsWith("http") ? link : `https://www.in.gov${link}`;
            rawBids.push({
              bidId: `IN_INDOT_${Buffer.from(title).toString("hex").substring(0, 12)}`,
              title,
              agency: "Indiana Department of Transportation (INDOT)",
              jurisdiction: "State_Of_Indiana",
              category: "CIVIL_INFRASTRUCTURE_PUBLIC",
              solicitationUrl: bidUrl,
              description: `Concurso oficial de obra pública e infraestructura vial del Estado de Indiana: ${title}`
            });
          }
        });
      }
    } catch (err: any) {
      console.warn(`[BIDS WARN] Error leyendo INDOT Bids: ${err.message}`);
    }

    return this.processAndSaveBids(rawBids, "State of Indiana INDOT");
  }

  /**
   * Procesa cada licitación mediante Gemini 2.5 Flash para filtrar descartes mecánicos
   * y guarda en Turso DB las obras válidas.
   */
  private async processAndSaveBids(rawBids: ConstructionBid[], sourceName: string): Promise<ConstructionBid[]> {
    const validBids: ConstructionBid[] = [];

    for (const rawBid of rawBids) {
      const classification = await classifyConstructionItem(rawBid.title, rawBid.description, sourceName);

      if (classification.isValidConstruction && classification.category) {
        rawBid.category = classification.category;
        rawBid.estimatedBudget = classification.estimatedValue || rawBid.estimatedBudget;
        rawBid.bondingRequired = classification.bondingRequired;
        rawBid.description = classification.summarySpanish || rawBid.description;
        if (classification.deadline && classification.deadline !== "Sin especificar") {
          rawBid.bidDeadline = classification.deadline;
        }

        await saveConstructionBid(rawBid);
        validBids.push(rawBid);
        console.log(`  ✅ [BID APROBADA] (${rawBid.category}) "${rawBid.title}" - ${rawBid.agency}`);
      } else {
        console.log(`  ❌ [BID RECHAZADA] "${rawBid.title}" -> Razón: ${classification.rejectedReason}`);
      }
    }

    console.log(`[BIDS RESUMEN] ${validBids.length} licitaciones válidas aprobadas de ${rawBids.length} procesadas en ${sourceName}.`);
    return validBids;
  }
}
