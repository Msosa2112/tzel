import { chromium } from "playwright";
import { ConstructionLead } from "../types";
import { saveConstructionLead } from "../db_construction";
import { syncLeadToBarbaPro } from "../integrations/barbapro_bridge";
import * as dotenv from "dotenv";

dotenv.config();

const CRAIGSLIST_CATEGORIES = [
  "https://louisville.craigslist.org/search/hws", // Skilled trade / Handyman
  "https://louisville.craigslist.org/search/bbb", // All Services / Construction
  "https://louisville.craigslist.org/search/lbg", // Labor Gigs
  "https://louisville.craigslist.org/search/fgs"  // Farm & Garden / Fences / Landscaping
];

/**
 * Escáner Comunitario de Craigslist con Playwright (Bypasses 403 Bot Block)
 */
export async function scanCommunityCraigslistLeads(): Promise<ConstructionLead[]> {
  console.log("\n=================================================================");
  console.log("🌐 ESCÁNER CRAIGSLIST (CATEGORÍAS AMPLIAS KY & SUR DE IN) 🌐");
  console.log("=================================================================\n");

  const leads: ConstructionLead[] = [];
  const seenUrls = new Set<string>();

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"]
    });

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 }
    });

    const page = await context.newPage();

    for (const catUrl of CRAIGSLIST_CATEGORIES) {
      try {
        console.log(`🔎 [CRAIGSLIST] Escaneando: ${catUrl}...`);
        await page.goto(catUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
        await page.waitForTimeout(2500);

        const items = await page.$$("li.cl-static-search-result, .result-row, li.cl-search-result, div.cl-search-result, ol.cl-results-page > li");
        console.log(`   📥 ${items.length} publicaciones detectadas.`);

        for (const item of items) {
          try {
            const rawText = (await item.innerText()).trim();
            const anchorEl = await item.$("a");
            const link = anchorEl ? await anchorEl.getAttribute("href") : "";

            if (rawText && link && !seenUrls.has(link)) {
              seenUrls.add(link);
              const lines = rawText.split("\n").map(l => l.trim()).filter(Boolean);
              const title = lines[0] || rawText.slice(0, 60);
              const lowerText = rawText.toLowerCase();

              // Palabras clave positivas de construcción / reformas
              const isConstruction =
                lowerText.includes("roof") ||
                lowerText.includes("techo") ||
                lowerText.includes("gotera") ||
                lowerText.includes("gutter") ||
                lowerTitle(lowerText, "siding") ||
                lowerText.includes("deck") ||
                lowerText.includes("porch") ||
                lowerText.includes("patio") ||
                lowerText.includes("fence") ||
                lowerText.includes("cerca") ||
                lowerText.includes("concrete") ||
                lowerText.includes("concreto") ||
                lowerText.includes("remodel") ||
                lowerText.includes("drywall") ||
                lowerText.includes("tile") ||
                lowerText.includes("flooring") ||
                lowerText.includes("contractor") ||
                lowerText.includes("subcontractor");

              // Exclusión de empleos tradicionales / delivery / plomería / electricidad
              const isExcluded =
                lowerText.includes("caddy") ||
                lowerText.includes("delivery") ||
                lowerText.includes("driver") ||
                lowerText.includes("scooter") ||
                lowerText.includes("lawn care only") ||
                lowerText.includes("plumb") ||
                lowerText.includes("electric");

              if (isConstruction && !isExcluded) {
                let category: any = "RENOVATION_REMODEL";
                if (lowerText.includes("roof") || lowerText.includes("techo") || lowerText.includes("gotera")) category = "ROOFING_SIDING_GUTTERS";
                else if (lowerText.includes("gutter") || lowerText.includes("siding")) category = "ROOFING_SIDING_GUTTERS";
                else if (lowerText.includes("deck") || lowerText.includes("porch") || lowerText.includes("patio")) category = "RENOVATION_REMODEL";
                else if (lowerText.includes("fence") || lowerText.includes("cerca")) category = "FENCE_PERIMETER_SECURITY";
                else if (lowerText.includes("concrete") || lowerText.includes("concreto")) category = "CONCRETE_ASPHALT_PAVING";

                const fullUrl = link.startsWith("http") ? link : `https://louisville.craigslist.org${link}`;
                const leadId = `LEAD_CL_${Buffer.from(fullUrl).toString("base64").substring(0, 16)}`;

                // Teléfono en texto si existe
                const phoneMatch = rawText.match(/\(?\b[0-9]{3}\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4}\b/);
                const ownerPhones = phoneMatch ? [phoneMatch[0]] : [];

                const lead: ConstructionLead = {
                  leadId,
                  category,
                  triggerEvent: "SOCIAL_INTENT_POST",
                  address: "Louisville Metro / Sur de Indiana (Craigslist)",
                  county: "Jefferson",
                  state: "KY",
                  ownerName: `Solicitud Craigslist: ${title.slice(0, 35)}`,
                  ownerPhones,
                  ownerEmails: [],
                  propertyType: "Residential",
                  estimatedProjectValue: 0,
                  triggerDate: new Date().toISOString().split("T")[0],
                  urgencyLevel: lowerText.includes("urgent") || lowerText.includes("leak") || lowerText.includes("emergency") ? "HIGH" : "NORMAL",
                  sourcePortal: "Craigslist Louisville",
                  rawDetails: `Solicitud en Craigslist: "${title}". Detalles: "${rawText.slice(0, 150)}...". Enlace: ${fullUrl}`,
                  permitNumber: fullUrl
                };

                const saved = await saveConstructionLead(lead);
                if (saved) {
                  await syncLeadToBarbaPro(lead);
                  leads.push(lead);
                  console.log(`  🎉 [LEAD CRAIGSLIST APROBADO] "${title.slice(0, 45)}" -> ${category}`);
                }
              }
            }
          } catch {}
        }
      } catch (uErr: any) {
        console.warn(`  ⚠️ Error consultando URL Craigslist: ${uErr.message}`);
      }
    }
  } catch (err: any) {
    console.warn(`  ⚠️ Error en browser Craigslist: ${err.message}`);
  } finally {
    if (browser) await browser.close();
  }

  console.log(`\n📊 Total de leads de Craigslist calificados y guardados: ${leads.length}`);
  return leads;
}

function lowerTitle(text: string, kw: string): boolean {
  return text.includes(kw);
}

if (require.main === module) {
  scanCommunityCraigslistLeads().catch(console.error);
}
