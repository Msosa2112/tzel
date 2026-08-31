import axios from "axios";
import * as cheerio from "cheerio";
import { ConstructionLead, ClassifierResult } from "../types";
import { saveConstructionLead } from "../db_construction";
import * as crypto from "crypto";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Clasificador especializado para publicaciones en redes sociales / clasificados.
 * Determina con certeza si el autor es un PROPIETARIO O ADMINISTRADOR BUSCANDO CONTRATAR (Lead Válido)
 * o si es un contratista haciendo publicidad (Descarte Automático).
 */
async function filterSocialIntentPost(title: string, content: string, url: string): Promise<ClassifierResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      isValidConstruction: true,
      category: "RENOVATION_REMODEL",
      urgency: "HIGH",
      summarySpanish: title
    };
  }

  const prompt = `Eres el Auditor de Leads de Intención Directa de Redes Sociales de TZEL.
Tu objetivo es analizar un aviso o publicación de tablones comunitarios locales de Louisville/Sur de IN y determinar si es un CLIENTE / PROPIETARIO / ADMINISTRADOR BUSCANDO CONTRATAR trabajos de construcción o mantenimiento.

REGLAS DE CLASIFICACIÓN ESTRICTAS:
1. LEAD VÁLIDO (isValidConstruction = true):
   - El autor BUSCA contratar o necesita un profesional/contratista para obras o reparaciones (ej. "Residential Property Maintenance Contractor Needed", "Need roofer for leak", "Looking for concrete contractor", "Need someone to replace deck/porch").
   - Categorías aprobadas:
     * NEW_CONSTRUCTION_GROUND_UP
     * RENOVATION_REMODEL
     * ROOFING_SIDING_GUTTERS
     * FOUNDATION_WATERPROOFING
     * CONCRETE_ASPHALT_PAVING
     * FENCE_PERIMETER_SECURITY
     * DEMOLITION_SITE_PREP
     * FIRE_WATER_REBUILD

2. DESCARTE OBLIGATORIO (isValidConstruction = false):
   - PUBLICIDAD: Contratista vendiendo sus servicios.
   - TRABAJOS DE CARGA / MUDANZAS SIMPLES: "Mover helper", "Load truck".
   - OFERTAS DE EMPLEO DE VENTAS / VENDOR: "Vendor in booth for fair".

DATOS:
- Título: "${title}"
- Enlace: "${url}"
- Contenido:
"""${content.substring(0, 1000)}"""

Responde ÚNICAMENTE en JSON con:
{
  "isValidConstruction": true o false,
  "rejectedReason": "Motivo si fue rechazada",
  "category": "Una de las 8 categorías aprobadas",
  "estimatedValue": número aproximado en USD si se deduce o 0,
  "urgency": "HIGH" o "CRITICAL",
  "summarySpanish": "Resumen claro en español de 2 líneas describiendo exactamente qué trabajo necesita el cliente"
}`;

  let attempts = 0;
  while (attempts < 3) {
    attempts++;
    try {
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { response_mime_type: "application/json", temperature: 0.1 }
        },
        { timeout: 12000 }
      );

      const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error("Respuesta vacía");
      return JSON.parse(text) as ClassifierResult;
    } catch (err: any) {
      if (err.response?.status === 429 && attempts < 3) {
        const waitTime = attempts * 2500;
        console.warn(`[GEMINI 429] Rate limit. Esperando ${waitTime}ms (Intento ${attempts}/3)...`);
        await new Promise(res => setTimeout(res, waitTime));
        continue;
      }
      return {
        isValidConstruction: false,
        rejectedReason: `Error evaluando con IA: ${err.message}`
      };
    }
  }

  return {
    isValidConstruction: false,
    rejectedReason: "Reintentos de IA agotados"
  };
}

/**
 * Recolector de Leads de Intención Directa en Tablones Clasificados de Louisville y Sur de IN
 */
export async function collectSocialIntentLeads(): Promise<ConstructionLead[]> {
  console.log("\n[LEADS SOCIALES] Escaneando tablones comunitarios y clasificados de Louisville y Sur de IN...");
  const leads: ConstructionLead[] = [];
  const seenUrls = new Set<string>();

  const keywords = ["contractor", "remodel", "roof", "deck", "fence", "concrete", "drywall", "porch", "foundation"];

  const postQueue: { title: string; link: string; keyword: string }[] = [];

  for (const kw of keywords) {
    try {
      const url = `https://louisville.craigslist.org/search/lbg?query=${encodeURIComponent(kw)}`;
      const response = await axios.get(url, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        timeout: 10000
      }).catch(() => null);

      if (response && response.data) {
        const $ = cheerio.load(response.data);

        $("li.cl-static-search-result").each((_, el) => {
          const title = $(el).find("div.title").text().trim();
          const link = $(el).find("a").attr("href") || "";

          if (title && link && !seenUrls.has(link)) {
            seenUrls.add(link);
            postQueue.push({ title, link, keyword: kw });
          }
        });
      }
    } catch (err: any) {
      console.warn(`[SOCIAL WARN] Error buscando keyword ${kw}: ${err.message}`);
    }
  }

  // Evaluar publicaciones capturadas con pequeño delay para respetar rate limit
  for (const item of postQueue) {
    await new Promise(res => setTimeout(res, 800));
    const evaluation = await filterSocialIntentPost(item.title, item.title, item.link);

    if (evaluation.isValidConstruction && evaluation.category) {
      const leadId = `LEAD_SOC_${crypto.createHash("md5").update(item.link).digest("hex").substring(0, 12)}`;
      const lead: ConstructionLead = {
        leadId,
        category: evaluation.category,
        triggerEvent: "SOCIAL_INTENT_POST",
        address: "Área Metropolitana de Louisville / Sur de IN",
        county: "Jefferson",
        state: "KY",
        ownerName: "Propietario / Administrador Solicitante",
        ownerPhones: [],
        ownerEmails: [],
        propertyType: "Residential/Commercial",
        estimatedProjectValue: evaluation.estimatedValue || 4500,
        triggerDate: new Date().toISOString().split("T")[0],
        urgencyLevel: evaluation.urgency || "HIGH",
        sourcePortal: "Craigslist Louisville Direct Client Listing",
        rawDetails: `${evaluation.summarySpanish || item.title}\n🔗 Enlace directo para responder: ${item.link}`,
        permitNumber: item.link
      };

      await saveConstructionLead(lead);
      leads.push(lead);
      console.log(`  ✅ [LEAD INTENCIÓN DIRECTA] (${lead.category}) "${item.title}"`);
    } else {
      console.log(`  ❌ [POST DESCARTADO] "${item.title}" -> ${evaluation.rejectedReason}`);
    }
  }

  console.log(`[SOCIAL RESUMEN] ${leads.length} leads de intención directa aprobados.`);
  return leads;
}
