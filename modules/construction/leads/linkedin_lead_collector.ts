import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import axios from "axios";
import { ConstructionLead, ClassifierResult, ConstructionTradeCategory } from "../types";
import { saveConstructionLead } from "../db_construction";
import * as dotenv from "dotenv";

dotenv.config();

// ============================================================================
// FILTROS NEGATIVOS PARA LINKEDIN (DESCARTAR OFERTAS ASALARIADAS Y CURRÍCULUMS)
// ============================================================================
const NEGATIVE_KEYWORDS_LINKEDIN = [
  // Exclusión estricta de fontanería y electricidad
  "plumber", "plumbing", "water heater", "clogged drain", "electrician", "electrical wiring", "breaker panel",
  "plomero", "plomeria", "electricista", "cableado electrico",
  // Empleos asalariados y candidaturas
  "open to work", "opentowork", "looking for a job", "seeking a position", "resume", "cv attached",
  "hiring full-time", "job opening for", "apply today at", "careers page", "internship", "we are hiring an engineer",
  "salary:", "hourly wage", "benefits package", "w2 position", "401k", "remote work opportunity"
];

// Temas de construcción comercial, civil y subcontratación
const CONSTRUCTION_TOPICS = [
  "roof", "roofer", "roofing", "siding", "gutter", "drywall", "paint", "painting", "paving",
  "concrete", "cement", "driveway", "deck", "porch", "fence", "carpenter", "carpentry", "framing",
  "flooring", "tile", "kitchen", "bath", "bathroom", "remodel", "renovation", "general contractor",
  "subcontractor", "subcontractors", "subs", "contractor", "bids", "invitation to bid", "rfp", "contract alert",
  "commercial construction", "property management", "flip", "multifamily", "unit turn", "masonry", "mep",
  "excavation", "sitework", "steel fabrication", "hvac", "building envelope", "army corps", "just awarded"
];

// ============================================================================
// CONSULTAS DIRIGIDAS EN LINKEDIN (LOUISVILLE & SUR DE INDIANA)
// ============================================================================
const LINKEDIN_SEARCH_QUERIES = [
  // 1. Subcontratación Comercial y Licitaciones de Obra
  "Louisville subcontractors",
  "Louisville subcontractors needed",
  "Louisville looking for subcontractors",
  "Louisville seeking subcontractors",
  "Southern Indiana subcontractors",
  "Clarksville IN contractor",
  "New Albany IN contractor",
  
  // 2. Gremios Específicos y Paquetes de Subcontrato
  "Louisville commercial roofing bids",
  "Louisville drywall subcontractors",
  "Louisville concrete paving contractor",
  "Louisville painting subcontractors",
  "Louisville sitework excavation subs",
  
  // 3. Inversionistas y Property Management
  "Louisville property management contractor",
  "Louisville commercial remodel bids",
  "Southern Indiana general contractor bids"
];

/**
 * Evaluación Heurística de Oportunidades en LinkedIn
 */
export function evaluateLinkedInIntent(text: string, author: string): ClassifierResult {
  const lower = text.toLowerCase();

  for (const neg of NEGATIVE_KEYWORDS_LINKEDIN) {
    if (lower.includes(neg)) {
      return { isValidConstruction: false, rejectedReason: `Oferta asalariada / Empleo tradicional ("${neg}")` };
    }
  }

  const hasConstructionTopic = CONSTRUCTION_TOPICS.some(t => lower.includes(t));
  if (!hasConstructionTopic) {
    return { isValidConstruction: false, rejectedReason: "No pertenece a construcción / subcontratación" };
  }

  const isSeeking = lower.includes("subcontractor") || lower.includes("contractor") || lower.includes("looking for") || lower.includes("seeking") || lower.includes("need") || lower.includes("bids") || lower.includes("rfp") || lower.includes("subs") || lower.includes("contract alert") || lower.includes("awarded");
  if (!isSeeking) {
    return { isValidConstruction: false, rejectedReason: "No es una solicitud ni oportunidad de subcontratación" };
  }

  let category: ConstructionTradeCategory = "NEW_CONSTRUCTION_GROUND_UP";
  let estimated = 50000;
  let summary = `🏢 SUBCONTRATACIÓN COMERCIAL EN LINKEDIN: Oportunidad publicada por ${author}.`;

  if (/roof|roofer|roofing|cubierta|techo/i.test(text)) {
    category = "ROOFING_SIDING_GUTTERS";
    estimated = 45000;
    summary = `🏢 TECHOS Y CUBIERTAS COMERCIALES: Oportunidad/Subcontrato en LinkedIn (${author}).`;
  } else if (/concrete|paving|driveway|asphalt|concreto|pavimento|sitework|excavation/i.test(text)) {
    category = "CONCRETE_ASPHALT_PAVING";
    estimated = 65000;
    summary = `🏗️ CONCRETO, MOVIMIENTO DE TIERRAS & PAVIMENTACIÓN: Solicitud de cuadrilla/subcontratista (${author}).`;
  } else if (/drywall|paint|painting|pintura|tablaroca|framing|mep/i.test(text)) {
    category = "RENOVATION_REMODEL";
    estimated = 35000;
    summary = `🎨 DRYWALL, MEP & ACABADOS: Búsqueda de subcontratistas en LinkedIn (${author}).`;
  } else if (/property management|unit turn|multifamily|apartments/i.test(text)) {
    category = "RENOVATION_REMODEL";
    estimated = 25000;
    summary = `🏘️ ADMINISTRACIÓN DE PROPIEDADES: Mantenimiento y adecuación de unidades multifamiliares (${author}).`;
  } else if (/26\.1m|million|corps of engineers|dod contract|awarded/i.test(text)) {
    category = "NEW_CONSTRUCTION_GROUND_UP";
    estimated = 250000;
    summary = `🎖️ ALERTA MILITAR/COMERCIAL ($26M+): Subcontratos abiertos para obras generales, concreto, techos y MEP (${author}).`;
  }

  return {
    isValidConstruction: true,
    category,
    urgency: "HIGH",
    estimatedValue: estimated,
    summarySpanish: summary
  };
}

/**
 * Clasificador con Gemini 2.5 Flash para LinkedIn
 */
async function classifyLinkedInPost(postText: string, author: string, postUrl: string): Promise<ClassifierResult> {
  const initial = evaluateLinkedInIntent(postText, author);
  if (!initial.isValidConstruction) return initial;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return initial;

  const prompt = `Eres el Auditor de Oportunidades Comerciales de LinkedIn de TZEL.
Tu objetivo es analizar una publicación en LinkedIn del área de Louisville, KY y Sur de Indiana.

CRITERIOS:
1. LEAD VÁLIDO: Alerta de contratos millonarios con subcontratos abiertos, General Contractor buscando cuadrillas/subs, Property Manager buscando contratistas, o solicitudes de presupuestos comerciales.
2. RECHAZAR: Empleos asalariados (W2, 401k), currículums o noticias sin oportunidad comercial.

Post de "${author}":
"""${postText.substring(0, 1500)}"""

Responde ÚNICAMENTE en JSON con:
{
  "isValidConstruction": true o false,
  "rejectedReason": "Motivo si es rechazada",
  "category": "NEW_CONSTRUCTION_GROUND_UP | RENOVATION_REMODEL | ROOFING_SIDING_GUTTERS | FOUNDATION_WATERPROOFING | CONCRETE_ASPHALT_PAVING | FENCE_PERIMETER_SECURITY | DEMOLITION_SITE_PREP | FIRE_WATER_REBUILD",
  "estimatedValue": valor aproximado en USD del paquete de trabajo,
  "urgency": "HIGH" o "CRITICAL",
  "summarySpanish": "Resumen claro en español de 2 líneas de la oportunidad de subcontratación o paquete de obra"
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

  return initial;
}

/**
 * Recolector Principal de LinkedIn con Sesión Autenticada
 */
export async function collectLinkedInLeads(): Promise<ConstructionLead[]> {
  console.log("\n=================================================================");
  console.log("💼 RADAR DE LINKEDIN: SUBCONTRATACIÓN COMERCIAL Y GENERAL CONTRACTORS 💼");
  console.log("=================================================================");

  const statePath = path.join(__dirname, "../../../browser_profiles/linkedin_state.json");
  if (!fs.existsSync(statePath)) {
    console.warn("[LINKEDIN WARN] No se encontró 'linkedin_state.json'.");
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
      storageState: statePath,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      viewport: { width: 1440, height: 900 }
    });

    const page = await context.newPage();

    for (const query of LINKEDIN_SEARCH_QUERIES) {
      try {
        console.log(`\n🔎 Buscando en LinkedIn: "${query}"...`);
        const searchUrl = `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(query)}`;
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
        await page.waitForTimeout(3000);

        // Hacer clic en la pestaña "Publicaciones" o "Posts"
        const postTab = page.locator("button:has-text('Publicaciones'), a:has-text('Publicaciones'), button:has-text('Posts'), a:has-text('Posts')").first();
        if (await postTab.isVisible()) {
          await postTab.click();
          await page.waitForTimeout(4000);
        }

        for (let s = 1; s <= 4; s++) {
          await page.mouse.wheel(0, 1600);
          await page.waitForTimeout(1000);
        }

        const rawBodyText = await page.innerText("body");
        const rawPosts = rawBodyText.split("Publicación en el feed").filter(p => p.length > 50);

        console.log(`  📊 ${rawPosts.length} bloques de publicaciones detectados.`);

        const isIndiana = query.includes("Indiana") || query.includes("Clarksville") || query.includes("New Albany");

        for (const rawChunk of rawPosts.slice(0, 8)) {
          const lines = rawChunk.split("\n").map(l => l.trim()).filter(l => l.length > 0);
          const author = lines[0] || "Contacto Comercial de LinkedIn";
          const fullText = rawChunk.trim();

          const hashKey = fullText.substring(0, 90);
          if (seenTexts.has(hashKey)) continue;
          seenTexts.add(hashKey);

          const evaluation = await classifyLinkedInPost(fullText, author, page.url());

          if (evaluation.isValidConstruction && evaluation.category) {
            const leadId = `LEAD_LI_${crypto.createHash("md5").update(hashKey).digest("hex").substring(0, 12)}`;
            const lead: ConstructionLead = {
              leadId,
              category: evaluation.category,
              triggerEvent: "COMMERCIAL_SUB_REQUEST",
              address: isIndiana ? "Sur de Indiana (Clark / Floyd County, IN)" : "Louisville Metro (Jefferson County, KY)",
              county: isIndiana ? "Clark / Floyd" : "Jefferson",
              state: isIndiana ? "IN" : "KY",
              ownerName: author,
              ownerPhones: [],
              ownerEmails: [],
              propertyType: "Commercial",
              estimatedProjectValue: evaluation.estimatedValue || 35000,
              triggerDate: new Date().toISOString().split("T")[0],
              urgencyLevel: evaluation.urgency || "HIGH",
              sourcePortal: `LinkedIn Posts ("${query}")`,
              rawDetails: `${evaluation.summarySpanish}\n💬 Publicación original:\n"${fullText.substring(0, 280)}..."\n🔗 Búsqueda en LinkedIn: ${page.url()}`,
              permitNumber: page.url()
            };

            await saveConstructionLead(lead);
            leads.push(lead);
            console.log(`  ✅ [LEAD LINKEDIN APROBADO] (${lead.category}) "${lead.ownerName}" -> ${evaluation.summarySpanish}`);
          } else {
            console.log(`  ❌ [DESCARTADO] "${author}" -> ${evaluation.rejectedReason || 'No califica'}`);
          }
        }
      } catch (sErr: any) {
        console.warn(`  ⚠️ Error en búsqueda LinkedIn "${query}": ${sErr.message}`);
      }
    }

  } catch (err: any) {
    console.error(`[LINKEDIN ERR] ${err.message}`);
  } finally {
    if (browser) await browser.close();
  }

  console.log("\n=================================================================");
  console.log(`🎉 [RESUMEN FINAL LINKEDIN] ${leads.length} OPORTUNIDADES COMERCIALES CAPTURADAS`);
  console.log("=================================================================\n");
  return leads;
}
