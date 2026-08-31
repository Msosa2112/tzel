import axios from "axios";
import * as cheerio from "cheerio";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ddwyutisxymuvofkjhpz.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

const CRAIGSLIST_ENDPOINTS = [
  { url: "https://louisville.craigslist.org/search/hws", category: "Household Services Wanted" },
  { url: "https://louisville.craigslist.org/search/lbg", category: "Labor Gigs Wanted" },
  { url: "https://louisville.craigslist.org/search/crg", category: "Crew & Contractor Gigs" }
];

const PHONE_REGEX = /\b(?:\+?1[-. ]?)?\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})\b/g;

async function classifyWithGemini(prompt: string): Promise<any> {
  if (!GEMINI_API_KEY) return null;
  try {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
      },
      { timeout: 12000 }
    );
    const raw = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

export async function scrapeCraigslistDirectLeads() {
  console.log("\n=================================================================");
  console.log("🛠️ [CRAIGSLIST] ESCANEANDO SOLICITUDES RESIDENCIALES EN LOUISVILLE");
  console.log("=================================================================\n");

  const qualifiedLeads: any[] = [];

  for (const endpoint of CRAIGSLIST_ENDPOINTS) {
    console.log(`📡 Consultando sección: ${endpoint.category}...`);

    try {
      const response = await axios.get(endpoint.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
        timeout: 12000
      });

      const $ = cheerio.load(response.data);
      const postElements = $(".cl-static-search-result, .result-node, li.cl-search-result").toArray();

      for (const el of postElements.slice(0, 20)) {
        const title = $(el).find(".title, .titlestring, a").first().text().trim();
        const link = $(el).find("a").first().attr("href") || "";
        const location = $(el).find(".location, .meta").text().trim() || "Louisville Metro & Sur de Indiana";

        if (!title || !link) continue;

        const titleLower = title.toLowerCase();

        if (
          titleLower.includes("free estimate") ||
          titleLower.includes("licensed & insured") ||
          titleLower.includes("hacemos techos") ||
          titleLower.includes("we do roofing") ||
          titleLower.includes("handyman available") ||
          titleLower.includes("services offered")
        ) {
          continue;
        }

        const isConstructionTopic =
          titleLower.includes("roof") ||
          titleLower.includes("siding") ||
          titleLower.includes("deck") ||
          titleLower.includes("fence") ||
          titleLower.includes("concrete") ||
          titleLower.includes("patio") ||
          titleLower.includes("remodel") ||
          titleLower.includes("drywall") ||
          titleLower.includes("paint") ||
          titleLower.includes("gutter") ||
          titleLower.includes("leak") ||
          titleLower.includes("carpenter") ||
          titleLower.includes("framing");

        if (!isConstructionTopic) continue;

        let fullDescription = title;
        let extractedPhone = "";

        try {
          const detailUrl = link.startsWith("http") ? link : `https://louisville.craigslist.org${link}`;
          const detailRes = await axios.get(detailUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
            timeout: 8000
          });

          const $d = cheerio.load(detailRes.data);
          fullDescription = $d("#postingbody").text().trim() || title;
          
          const phoneMatches = fullDescription.match(PHONE_REGEX);
          if (phoneMatches && phoneMatches.length > 0) {
            extractedPhone = phoneMatches[0];
          }
        } catch (detailErr) {}

        const prompt = `Analiza esta solicitud de Craigslist en Louisville/KY y responde en JSON:
Texto del anuncio:
"""
Título: ${title}
Descripción: ${fullDescription}
Ubicación: ${location}
"""

Responde con este esquema JSON:
{
  "isBuyerSeekingService": true o false,
  "clientName": "Nombre del cliente si está disponible, o 'Propietario en Craigslist'",
  "serviceCategory": "ROOFING_SIDING_GUTTERS" | "CONCRETE_ASPHALT_PAVING" | "FENCE_PERIMETER_SECURITY" | "RENOVATION_REMODEL" | "NEW_CONSTRUCTION_GROUND_UP",
  "estimatedBudget": número,
  "summary": "Resumen claro del trabajo solicitado",
  "customSalesPitch": "Propuesta corta de 2 frases presentándose como Barba Construction para llamada o SMS"
}`;

        const parsed = await classifyWithGemini(prompt);
        if (!parsed || !parsed.isBuyerSeekingService) continue;

        const leadObj = {
          first_name: parsed.clientName || "Propietario",
          last_name: "(Craigslist Louisville)",
          phone: extractedPhone || null,
          email: null,
          address: location.includes("Louisville") ? location : `${location}, Louisville Metro`,
          status: "lead",
          score: 88,
          contract_value: parsed.estimatedBudget || 5500,
          external_ref: `LEAD_CL_${Buffer.from(link).toString("base64").slice(0, 24)}`,
          notes: `🎯 SOLICITUD DE CLIENTE EN CRAIGSLIST (${endpoint.category}):\n📌 Proyecto: ${parsed.summary}\n💬 Anuncio: "${title}"\n\n🔗 ENLACE AL ANUNCIO: ${link}\n\n🤖 PROPUESTA / LLAMADA SUGERIDA:\n${parsed.customSalesPitch}`
        };

        const { data: existing } = await supabase
          .from("contacts")
          .select("id")
          .eq("external_ref", leadObj.external_ref)
          .maybeSingle();

        if (!existing) {
          await supabase.from("contacts").insert(leadObj);
          console.log(`  🎉 [NUEVO LEAD CRAIGSLIST] ${leadObj.first_name} -> ${parsed.serviceCategory} ($${leadObj.contract_value}) | Tel: ${extractedPhone || "Por Responder en Anuncio"}`);
          qualifiedLeads.push(leadObj);
        }
      }
    } catch (err: any) {
      console.warn(`  ⚠️ Error consultando Craigslist (${endpoint.category}):`, err.message);
    }
  }

  console.log(`\n✅ [CRAIGSLIST] Total de leads directos capturados: ${qualifiedLeads.length}\n`);
  return qualifiedLeads;
}

if (require.main === module) {
  scrapeCraigslistDirectLeads().catch(console.error);
}
