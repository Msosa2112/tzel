import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import { evaluateIntentWithPillars } from "./facebook_group_collector";
import dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ddwyutisxymuvofkjhpz.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const PROFILE_PATH = path.resolve(process.cwd(), "browser_profiles/facebook_state.json");

export const GLOBAL_SEARCH_QUERIES = [
  "Louisville recommend contractor",
  "Louisville looking for roofer",
  "Louisville looking for siding",
  "Louisville concrete patio recommendation",
  "Louisville deck builder recommendation",
  "Clarksville IN recommend contractor",
  "New Albany IN recommend roofer",
  "Louisville fence repair recommendation",
  "Louisville bathroom remodel recommendation",
  "Louisville recomienden roofero",
  "Louisville necesito presupuesto remodelacion",
  "Louisville busco albanil o contratista",
  "Louisville busco quien haga techos",
  "Louisville busco quien haga porches o decks"
];

const PHONE_REGEX = /\b(?:\+?1[-. ]?)?\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})\b/g;

const NEGATIVE_SELLER_WORDS = [
  "se hacen", "hacemos", "ofrezco", "ofrecemos", "estimados gratis", "free estimate",
  "free estimates", "llámanos", "llamenos", "llamar al", "a la orden", "no duden en",
  "somos expertos", "trabajo garantizado", "stone house", "garcia roofing", "clean pro",
  "504construction", "se vende", "se renta", "for rent", "cadillac", "millas", "rebuilt",
  "hago trabajos", "disponible para trabajar", "busco trabajo", "buscando trabajo",
  "busca trabajo", "busco empleo", "ayudante de", "ocupo ayudante", "necesito ayudante",
  "persona para trabajar", "staffing", "stafin", "oportunidades de trabajo", "agencia de empleo",
  "built strong", "thinking about adding a deck", "one call. endless possibilities",
  "if it’s on your to-do list", "if it's on your to-do list", "tu casa o negocio necesita una remodelación",
  "¿buscas un contratista", "deck looking worn out", "waterproofed basement"
];

const POSITIVE_BUYER_KEYWORDS = [
  "recommend", "looking for", "need ", "needing", "who do you", "anyone know",
  "quote", "estimate", "recomienden", "busco", "alguien que haga", "presupuesto",
  "quien me hace", "quien repara", "leak", "gotera", "tree fell", "storm damage"
];

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function classifyWithGemini(prompt: string): Promise<any> {
  if (!GEMINI_API_KEY) return null;
  const modelName = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  try {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
      },
      { timeout: 8000 }
    );
    const raw = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return raw ? JSON.parse(raw) : null;
  } catch (err: any) {
    return null;
  }
}

export async function scrapeFacebookGlobalFeed() {
  console.log("\n=================================================================");
  console.log("🌐 [FACEBOOK GLOBAL] ESCANEANDO FEED PÚBLICO DE LOUISVILLE & SUR DE IN");
  console.log("=================================================================\n");

  if (!fs.existsSync(PROFILE_PATH)) {
    console.warn("⚠️ No se encontró la sesión autenticada en:", PROFILE_PATH);
    return [];
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"]
  });

  const context = await browser.newContext({
    storageState: PROFILE_PATH,
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });

  const page = await context.newPage();
  const qualifiedLeads: any[] = [];
  const seenFingerprints = new Set<string>();

  for (const query of GLOBAL_SEARCH_QUERIES) {
    console.log(`🔎 Buscando en Feed Global de Facebook: "${query}"...`);
    const searchUrl = `https://www.facebook.com/search/posts/?q=${encodeURIComponent(query)}`;

    try {
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(3500);

      for (let s = 1; s <= 4; s++) {
        await page.mouse.wheel(0, 1800);
        await page.waitForTimeout(1000);
      }

      const postsData = await page.evaluate(() => {
        const main = document.querySelector('div[role="main"]') || document.body;
        const candidates = Array.from(main.querySelectorAll('div[role="feed"] > div, div[role="article"], div.x1yztbdb, div.x1n2onr6'));
        const results: any[] = [];

        for (const el of candidates) {
          if (el.closest('div[role="navigation"]') || el.closest('div[role="banner"]')) continue;
          const fullText = (el as HTMLElement).innerText?.trim() || "";
          if (fullText.length < 40 || fullText.length > 3500) continue;
          if (fullText.includes("chats no leídos") || fullText.includes("Falta el historial")) continue;

          // Message preview
          const msgEl = el.querySelector('div[data-ad-preview="message"], div[dir="auto"], div.x1iorvi4');
          const cleanText = msgEl ? (msgEl as HTMLElement).innerText.trim() : fullText;

          const links = Array.from(el.querySelectorAll("a")).map(a => a.href);
          const postLink = links.find(l => l.includes("/posts/") || l.includes("/permalink/") || l.includes("story_fbid") || l.includes("/groups/")) || "";
          const userLink = links.find(l => l.includes("facebook.com/") && !l.includes("/search/") && !l.includes("/groups/")) || "";

          const authorEl = el.querySelector('strong, h3, h2, a[role="link"]');
          const author = authorEl ? (authorEl as HTMLElement).innerText.trim() : "Vecino";

          results.push({ author, text: cleanText, fullText, postLink, userLink });
        }
        return results;
      });

      for (const p of postsData) {
        const textToCheck = p.text || p.fullText;
        if (!textToCheck || textToCheck.length < 35) continue;

        const textLower = textToCheck.toLowerCase();
        const fingerprint = textLower.slice(0, 70);
        if (seenFingerprints.has(fingerprint)) continue;
        seenFingerprints.add(fingerprint);

        // Anti-seller filter
        const isSeller = NEGATIVE_SELLER_WORDS.some(w => textLower.includes(w));
        if (isSeller) continue;

        // Positive buyer intent check
        const isBuyer = POSITIVE_BUYER_KEYWORDS.some(k => textLower.includes(k));
        if (!isBuyer) continue;

        const cleanAuthor = p.author && p.author.length < 40 && !p.author.includes("\n") && p.author !== "Facebook"
          ? p.author
          : "Vecino / Propietario";

        // Hybrid classification: evaluate local pillars first
        const localEval = evaluateIntentWithPillars(textToCheck, cleanAuthor);
        if (!localEval.isValidConstruction) continue;

        const phoneMatches = textToCheck.match(PHONE_REGEX);
        const extractedPhone = phoneMatches ? phoneMatches[0] : "";

        // Optional Gemini enhancement
        const prompt = `Analiza esta publicación de Facebook en Louisville / Sur de Indiana:
"""${textToCheck.slice(0, 600)}"""
Responde en JSON:
{
  "isHomeownerLookingForWork": true,
  "serviceCategory": "${localEval.category || 'RENOVATION_REMODEL'}",
  "estimatedBudget": ${localEval.estimatedValue || 7500},
  "summary": "Resumen conciso de 1-2 líneas de lo que necesita el cliente",
  "customSalesPitch": "Mensaje directo y cordial de 2 frases ofreciendo presupuesto gratuito de Barba Construction"
}`;

        const parsed = await classifyWithGemini(prompt);

        const category = parsed?.serviceCategory || localEval.category || "RENOVATION_REMODEL";
        const estimatedBudget = parsed?.estimatedBudget || localEval.estimatedValue || 7500;
        const summary = parsed?.summary || localEval.summarySpanish || "Solicitud de obra en Louisville";
        const customPitch = parsed?.customSalesPitch || `Hola ${cleanAuthor}, vimos tu solicitud en Facebook para ${category}. En Barba Construction estamos en Louisville y podemos hacerte un presupuesto gratis sin compromiso.`;

        const finalPostLink = p.postLink || `https://www.facebook.com/search/posts/?q=${encodeURIComponent(query)}`;
        const leadRef = `LEAD_FB_GLOBAL_${Buffer.from(finalPostLink + fingerprint).toString("base64").slice(0, 24)}`;

        const leadObj = {
          first_name: cleanAuthor,
          last_name: "(Facebook Louisville)",
          phone: extractedPhone || null,
          email: null,
          address: "Louisville Metro / Sur de Indiana",
          city: "Louisville",
          state: "KY",
          source: "other",
          pipeline_status: "new_lead",
          external_ref: leadRef,
          notes: `🎯 SOLICITUD DE PROPIETARIO EN FACEBOOK:\n💰 VALOR ESTIMADO: $${estimatedBudget} USD\n🔥 URGENCIA: HIGH\n📌 Proyecto: ${summary}\n💬 Publicación: "${textToCheck.slice(0, 300)}..."\n\n🔗 ENLACE A LA PUBLICACIÓN: ${finalPostLink}\n👤 PERFIL DEL AUTOR: ${p.userLink || "N/A"}\n\n🤖 MENSAJE / RESPUESTA SUGERIDA:\n${customPitch}`
        };

        const { data: existing } = await supabase
          .from("contacts")
          .select("id")
          .eq("external_ref", leadObj.external_ref)
          .maybeSingle();

        if (!existing) {
          const { error: insErr } = await supabase.from("contacts").insert(leadObj);
          if (!insErr) {
            console.log(`  🎉 [NUEVO LEAD FB GLOBAL] ${leadObj.first_name} -> ${category} ($${estimatedBudget})`);
            qualifiedLeads.push(leadObj);
          } else {
            console.warn(`  ⚠️ Error insertando en Supabase:`, insErr.message);
          }
        }
      }
    } catch (err: any) {
      console.warn(`  ⚠️ Error buscando en Facebook (${query}):`, err.message);
    }
  }

  await browser.close();
  console.log(`\n✅ [FACEBOOK GLOBAL] Total de leads capturados: ${qualifiedLeads.length}\n`);
  return qualifiedLeads;
}

if (require.main === module) {
  scrapeFacebookGlobalFeed().catch(console.error);
}
