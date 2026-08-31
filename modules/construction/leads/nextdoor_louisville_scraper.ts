import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
import { ConstructionLead } from "../types";
import { saveConstructionLead } from "../db_construction";
import { syncLeadToBarbaPro } from "../integrations/barbapro_bridge";
import * as dotenv from "dotenv";

dotenv.config();

const STATE_PATH = path.join(__dirname, "../../../browser_profiles/nextdoor_state.json");

const SEARCH_TERMS = [
  "contractor",
  "roof",
  "deck",
  "gutters",
  "fence",
  "remodel",
  "concrete",
  "siding",
  "porch",
  "handyman"
];

/**
 * Escáner Completo de Nextdoor: Muro Barrial + Búsquedas por Gremio
 */
export async function scanNextdoorNeighborhoodLeads(): Promise<ConstructionLead[]> {
  console.log("\n=================================================================");
  console.log("🏡 ESCÁNER NEXTDOOR: VECINDARIOS LOCALES (KY & SUR DE IN) 🏡");
  console.log("=================================================================\n");

  if (!fs.existsSync(STATE_PATH)) {
    console.log("⚠️ [NEXTDOOR AVISO] No se encontró sesión en 'nextdoor_state.json'.");
    return [];
  }

  const leads: ConstructionLead[] = [];
  const seenTexts = new Set<string>();

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"]
    });

    const context = await browser.newContext({
      storageState: STATE_PATH,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 900 }
    });

    const page = await context.newPage();

    // =========================================================================
    // FASE 1: RASTREO DEL MURO DE NOTICIAS DE TU VECINDARIO
    // =========================================================================
    console.log("📰 [FASE 1] Escaneando Muro de Noticias de tu Vecindario en Nextdoor...");
    try {
      await page.goto("https://nextdoor.com/news_feed/", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(4000);

      // Scroll para cargar publicaciones
      for (let i = 0; i < 4; i++) {
        await page.mouse.wheel(0, 1500);
        await page.waitForTimeout(1500);
      }

      const feedElements = await page.$$("article, div[data-testid='post-container'], div[class*='post'], div[class*='feed']");
      console.log(`   📥 ${feedElements.length} bloques de publicaciones detectados en el muro.`);

      for (const el of feedElements) {
        await processNextdoorElement(el, page, leads, seenTexts, "Nextdoor News Feed");
      }
    } catch (feedErr: any) {
      console.warn(`  ⚠️ Error en feed de Nextdoor: ${feedErr.message}`);
    }

    // =========================================================================
    // FASE 2: BÚSQUEDAS INTERNAS POR CADA GREMIO EN TU ZONA
    // =========================================================================
    console.log("\n🔎 [FASE 2] Ejecutando búsquedas de intención en Nextdoor...");
    for (const term of SEARCH_TERMS) {
      console.log(`   🔎 Buscando: "${term}"...`);
      const searchUrl = `https://nextdoor.com/search/?query=${encodeURIComponent(term)}`;

      try {
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
        await page.waitForTimeout(3000);

        for (let i = 0; i < 2; i++) {
          await page.mouse.wheel(0, 1200);
          await page.waitForTimeout(1000);
        }

        const searchElements = await page.$$("article, div[data-testid='post-container'], div[class*='PostItem'], div[class*='search-result'], div[class*='content']");
        for (const el of searchElements) {
          await processNextdoorElement(el, page, leads, seenTexts, `Nextdoor Search: ${term}`);
        }
      } catch {}
    }
  } catch (err: any) {
    console.warn(`  ⚠️ Error general en Nextdoor: ${err.message}`);
  } finally {
    if (browser) await browser.close();
  }

  console.log(`\n📊 Total de oportunidades calificadas de Nextdoor: ${leads.length}`);
  return leads;
}

async function processNextdoorElement(
  el: any,
  page: any,
  leads: ConstructionLead[],
  seenTexts: Set<string>,
  sourceTag: string
) {
  try {
    const rawText = (await el.innerText()).trim();
    if (!rawText || rawText.length < 30 || seenTexts.has(rawText)) return;
    seenTexts.add(rawText);

    const lower = rawText.toLowerCase();

    // Palabras clave de gremios
    const isConstruction =
      lower.includes("roof") ||
      lower.includes("techo") ||
      lower.includes("gotera") ||
      lower.includes("gutter") ||
      lower.includes("canaleta") ||
      lower.includes("siding") ||
      lower.includes("deck") ||
      lower.includes("porch") ||
      lower.includes("patio") ||
      lower.includes("fence") ||
      lower.includes("cerca") ||
      lower.includes("concrete") ||
      lower.includes("concreto") ||
      lower.includes("remodel") ||
      lower.includes("drywall") ||
      lower.includes("contractor") ||
      lower.includes("handyman");

    // Descarte de mascotas perdidas, plomería pura, electricidad
    const isExcluded =
      lower.includes("lost dog") ||
      lower.includes("lost cat") ||
      lower.includes("found dog") ||
      lower.includes("plumber") ||
      lower.includes("plumbing") ||
      lower.includes("electrician");

    if (isConstruction && !isExcluded) {
      let category: any = "RENOVATION_REMODEL";
      if (lower.includes("roof") || lower.includes("techo") || lower.includes("gotera")) category = "ROOFING_SIDING_GUTTERS";
      else if (lower.includes("gutter") || lower.includes("canaleta") || lower.includes("siding")) category = "ROOFING_SIDING_GUTTERS";
      else if (lower.includes("deck") || lower.includes("porch") || lower.includes("patio")) category = "RENOVATION_REMODEL";
      else if (lower.includes("fence") || lower.includes("cerca")) category = "FENCE_PERIMETER_SECURITY";
      else if (lower.includes("concrete") || lower.includes("concreto")) category = "CONCRETE_ASPHALT_PAVING";

      const lines = rawText.split("\n").map((l: string) => l.trim()).filter(Boolean);
      const authorName = lines[0] || "Vecino de Nextdoor";

      const leadId = `LEAD_ND_${Buffer.from(rawText.slice(0, 40)).toString("base64").substring(0, 16)}`;

      // Extraer teléfono si existe
      const phoneMatch = rawText.match(/\(?\b[0-9]{3}\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4}\b/);
      const ownerPhones = phoneMatch ? [phoneMatch[0]] : [];

      const lead: ConstructionLead = {
        leadId,
        category,
        triggerEvent: "SOCIAL_INTENT_POST",
        address: "Vecindario en Louisville Metro / Sur de IN",
        county: "Jefferson",
        state: "KY",
        ownerName: `Vecino: ${authorName.slice(0, 30)}`,
        ownerPhones,
        ownerEmails: [],
        propertyType: "Residential",
        estimatedProjectValue: 0,
        triggerDate: new Date().toISOString().split("T")[0],
        urgencyLevel: lower.includes("urgent") || lower.includes("leak") || lower.includes("emergency") ? "HIGH" : "NORMAL",
        sourcePortal: sourceTag,
        rawDetails: `Publicación en Nextdoor: "${rawText.slice(0, 220)}..."`,
        permitNumber: "https://nextdoor.com/news_feed/"
      };

      const saved = await saveConstructionLead(lead);
      if (saved) {
        await syncLeadToBarbaPro(lead);
        leads.push(lead);
        console.log(`  🎉 [LEAD NEXTDOOR GUARDADO] "${authorName.slice(0, 25)}" -> ${category}`);
      }
    }
  } catch {}
}

if (require.main === module) {
  scanNextdoorNeighborhoodLeads().catch(console.error);
}
