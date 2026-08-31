import { chromium } from "playwright";
import * as crypto from "crypto";
import axios from "axios";
import { ConstructionLead, ClassifierResult, ConstructionTradeCategory } from "../types";
import { saveConstructionLead } from "../db_construction";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Función para decodificar la URL real de Bing (&u=a1...)
 */
function decodeBingUrl(rawUrl: string, cite: string): string {
  try {
    const match = rawUrl.match(/[?&]u=a1([A-Za-z0-9+/=_-]+)/);
    if (match && match[1]) {
      let b64 = match[1].replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      const decoded = Buffer.from(b64, "base64").toString("utf-8");
      if (decoded.startsWith("http")) return decoded;
    }
  } catch {}

  if (cite) {
    const cleanCite = cite.replace(/ › /g, "/").replace(/\s+/g, "").trim();
    if (cleanCite.startsWith("http")) return cleanCite;
    return `https://${cleanCite}`;
  }
  return rawUrl;
}

/**
 * Consultas para Directorios Comerciales, LinkedIn, Inversionistas y Licitaciones Privadas
 */
const BING_TARGET_QUERIES = [
  // 1. LINKEDIN: Subcontratistas, Promotores y Contratistas Generales
  '"linkedin.com" "Louisville" "subcontractors needed"',
  '"linkedin.com" "Louisville" "looking for subcontractors"',
  '"linkedin.com" "Southern Indiana" "contractor needed"',
  '"linkedin.com" "Clarksville" "subcontractors"',
  '"linkedin.com" "Louisville" "commercial roofing" "bids"',
  '"linkedin.com" "Louisville" "drywall" "subcontractor"',

  // 2. BIGGERPOCKETS: Inversionistas Inmobiliarios y Flippers
  '"biggerpockets.com" "Louisville" "contractor recommendation"',
  '"biggerpockets.com" "Louisville" "need a roofer"',
  '"biggerpockets.com" "Southern Indiana" "contractor recommendation"',

  // 3. THE BLUE BOOK & PLANHUB: Licitaciones y Paquetes de Obra
  '"thebluebook.com" "Louisville" "projects out for bid"',
  '"planhub.com" "Louisville" "subcontractors"',
  '"Louisville, KY" "invitation to bid" "subcontractors"'
];

/**
 * Clasificador con Gemini 2.5 Flash
 */
async function classifyDirectoryLead(title: string, snippet: string, url: string, source: string): Promise<ClassifierResult> {
  const combinedText = `${title}\n${snippet}`;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return {
      isValidConstruction: true,
      category: "RENOVATION_REMODEL",
      urgency: "HIGH",
      summarySpanish: snippet
    };
  }

  const prompt = `Eres el Auditor de Oportunidades Comerciales y Subcontratación de TZEL.
Tu objetivo es analizar un resultado de LinkedIn, BiggerPockets o Directorios de Construcción en Louisville, KY / Sur de IN.

Determina si se trata de:
1. Una oportunidad real de contratación, búsqueda de cuadrillas/subcontratistas, licitación privada o inversionista buscando contratistas (isValidConstruction = true).
2. Un artículo general, currículum de una persona, empleo asalariado o publicidad genérica (isValidConstruction = false).

DATOS:
- Fuente: ${source}
- Enlace: ${url}
- Contenido:
"""${combinedText.substring(0, 1200)}"""

Responde ÚNICAMENTE en JSON con:
{
  "isValidConstruction": true o false,
  "rejectedReason": "Motivo si es rechazada",
  "category": "NEW_CONSTRUCTION_GROUND_UP | RENOVATION_REMODEL | ROOFING_SIDING_GUTTERS | FOUNDATION_WATERPROOFING | CONCRETE_ASPHALT_PAVING | FENCE_PERIMETER_SECURITY | DEMOLITION_SITE_PREP | FIRE_WATER_REBUILD",
  "estimatedValue": valor aproximado en USD,
  "urgency": "HIGH",
  "summarySpanish": "Resumen claro de 2 líneas de la oportunidad comercial o paquete de obra"
}`;

  try {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: "application/json", temperature: 0.1 }
      },
      { timeout: 9000 }
    );
    const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) return JSON.parse(text) as ClassifierResult;
  } catch {}

  const lower = combinedText.toLowerCase();
  const isTarget = lower.includes("subcontractor") || lower.includes("contractor") || lower.includes("looking for") || lower.includes("bids") || lower.includes("recommendation");

  return {
    isValidConstruction: isTarget,
    category: lower.includes("roof") ? "ROOFING_SIDING_GUTTERS" : lower.includes("concrete") ? "CONCRETE_ASPHALT_PAVING" : "RENOVATION_REMODEL",
    urgency: "HIGH",
    estimatedValue: 20000,
    summarySpanish: `Oportunidad comercial detectada en ${source}: ${title}`
  };
}

/**
 * Recolector Multi-Directorio (LinkedIn + BiggerPockets + The Blue Book + PlanHub)
 */
export async function collectMultiDirectoryLeads(): Promise<ConstructionLead[]> {
  console.log("\n=================================================================");
  console.log("🌐 RADAR MULTI-DIRECTORIO: LINKEDIN + BIGGERPOCKETS + THE BLUE BOOK 🌐");
  console.log("=================================================================");

  const leads: ConstructionLead[] = [];
  const seenUrls = new Set<string>();

  let browser = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-blink-features=AutomationControlled"]
    });

    const page = await browser.newPage({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 900 }
    });

    for (const query of BING_TARGET_QUERIES) {
      try {
        console.log(`\n🔍 Rastreador OSINT: ${query}...`);
        await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en-us`, { waitUntil: "domcontentloaded", timeout: 20000 });
        await page.waitForTimeout(2200);

        const items = await page.evaluate(() => {
          const results: { title: string; snippet: string; rawHref: string; cite: string }[] = [];
          const blocks = Array.from(document.querySelectorAll("li.b_algo"));

          blocks.forEach(b => {
            const titleEl = b.querySelector("h2 a");
            const snippetEl = b.querySelector("p, .b_caption p");
            const citeEl = b.querySelector("cite, .b_attribution cite");

            const title = titleEl ? (titleEl as HTMLElement).innerText.trim() : "";
            const rawHref = titleEl ? (titleEl as HTMLAnchorElement).href : "";
            const snippet = snippetEl ? (snippetEl as HTMLElement).innerText.trim() : "";
            const cite = citeEl ? (citeEl as HTMLElement).innerText.trim() : "";

            if (title && rawHref) {
              results.push({ title, snippet, rawHref, cite });
            }
          });

          return results;
        });

        console.log(`  📊 ${items.length} resultados devueltos.`);

        for (const item of items.slice(0, 5)) {
          const realUrl = decodeBingUrl(item.rawHref, item.cite);
          if (!realUrl || seenUrls.has(realUrl)) continue;
          seenUrls.add(realUrl);

          let sourcePortal = "Directorio Comercial";
          if (realUrl.includes("linkedin.com")) sourcePortal = "LinkedIn Posts & Subs";
          else if (realUrl.includes("biggerpockets.com")) sourcePortal = "BiggerPockets (Real Estate Investors)";
          else if (realUrl.includes("thebluebook.com")) sourcePortal = "The Blue Book Network";
          else if (realUrl.includes("planhub.com")) sourcePortal = "PlanHub Construction";

          const evaluation = await classifyDirectoryLead(item.title, item.snippet, realUrl, sourcePortal);

          if (evaluation.isValidConstruction && evaluation.category) {
            const leadId = `LEAD_DIR_${crypto.createHash("md5").update(realUrl).digest("hex").substring(0, 12)}`;
            const isIndiana = item.title?.includes("Indiana") || item.snippet?.includes("Clarksville") || item.snippet?.includes("New Albany") || item.snippet?.includes("Jeffersonville") || query.includes("Indiana");

            const lead: ConstructionLead = {
              leadId,
              category: evaluation.category,
              triggerEvent: "COMMERCIAL_SUB_REQUEST",
              address: isIndiana ? "Sur de Indiana (Clark / Floyd County, IN)" : "Louisville Metro (Jefferson County, KY)",
              county: isIndiana ? "Clark / Floyd" : "Jefferson",
              state: isIndiana ? "IN" : "KY",
              ownerName: item.title.substring(0, 50) || "Promotor / Inversionista / General Contractor",
              ownerPhones: [],
              ownerEmails: [],
              propertyType: sourcePortal.includes("LinkedIn") ? "Commercial" : "Residential",
              estimatedProjectValue: evaluation.estimatedValue || 25000,
              triggerDate: new Date().toISOString().split("T")[0],
              urgencyLevel: evaluation.urgency || "HIGH",
              sourcePortal,
              rawDetails: `${evaluation.summarySpanish}\n📌 Título: "${item.title}"\n🔗 Enlace directo a la oportunidad: ${realUrl}`,
              permitNumber: realUrl
            };

            await saveConstructionLead(lead);
            leads.push(lead);
            console.log(`  ✅ [LEAD DIRECTORIO APROBADO] (${lead.category} - ${sourcePortal}): "${evaluation.summarySpanish}"`);
          } else {
            console.log(`  ❌ [DESCARTADO] "${item.title.substring(0, 45)}" -> ${evaluation.rejectedReason || 'No califica'}`);
          }
        }
      } catch (qErr: any) {
        console.warn(`  ⚠️ Error en búsqueda "${query}": ${qErr.message}`);
      }
    }

  } catch (err: any) {
    console.error(`[MULTI-DIR ERR] ${err.message}`);
  } finally {
    if (browser) await browser.close();
  }

  console.log("\n=================================================================");
  console.log(`🎉 [RESUMEN FINAL DIRECTORIOS & LINKEDIN] ${leads.length} LEADS CAPTURADOS`);
  console.log("=================================================================\n");
  return leads;
}
