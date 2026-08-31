import { chromium } from "playwright";
import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ddwyutisxymuvofkjhpz.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

const SEARCH_QUERIES = [
  "contractor recommendation",
  "roofer recommendation",
  "roof repair",
  "deck builder",
  "concrete patio",
  "concrete driveway",
  "siding repair",
  "fence contractor",
  "remodel contractor",
  "handyman recommendation"
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

export async function scrapeRedditLeads() {
  console.log("\n=================================================================");
  console.log("💬 [REDDIT] ESCANEANDO SOLICITUDES DE PROPIETARIOS EN r/Louisville");
  console.log("=================================================================\n");

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"]
  });

  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
  });

  const qualifiedLeads: any[] = [];

  for (const query of SEARCH_QUERIES) {
    console.log(`🔎 Buscando en r/Louisville: "${query}"...`);
    const searchUrl = `https://www.reddit.com/r/Louisville/search/?q=${encodeURIComponent(query)}&restrict_sr=1&sort=new`;

    try {
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(3000);

      const posts = await page.$$eval("shreddit-post, a[data-testid='post-title']", (nodes) => {
        return nodes.map((n) => {
          if (n.tagName.toLowerCase() === "shreddit-post") {
            const author = n.getAttribute("author") || "";
            const title = n.getAttribute("post-title") || "";
            let permalink = n.getAttribute("permalink") || "";
            if (permalink.startsWith("http")) {
              permalink = permalink.replace("https://www.reddit.com", "");
            }
            return { title, author, permalink };
          } else {
            const href = (n as HTMLAnchorElement).href || "";
            const permalink = href.replace("https://www.reddit.com", "");
            return {
              title: (n as HTMLElement).innerText.trim(),
              author: "",
              permalink
            };
          }
        });
      });

      for (const p of posts) {
        if (!p.title || p.title.length < 10) continue;

        const titleLower = p.title.toLowerCase();

        // Verificar si es un tema de construcción residencial
        const isConstructionTopic =
          titleLower.includes("contractor") ||
          titleLower.includes("roof") ||
          titleLower.includes("siding") ||
          titleLower.includes("deck") ||
          titleLower.includes("concrete") ||
          titleLower.includes("fence") ||
          titleLower.includes("remodel") ||
          titleLower.includes("patio") ||
          titleLower.includes("drywall") ||
          titleLower.includes("gutters") ||
          titleLower.includes("handyman");

        if (!isConstructionTopic) continue;

        // Descarte de otros temas
        if (
          titleLower.includes("anime") ||
          titleLower.includes("tattoo") ||
          titleLower.includes("restaurant") ||
          titleLower.includes("dining") ||
          titleLower.includes("nightlife") ||
          titleLower.includes("apartment help")
        ) {
          continue;
        }

        const fullPostUrl = `https://www.reddit.com${p.permalink}`;
        const authorName = p.author || "Propietario";
        const directDmUrl = p.author
          ? `https://www.reddit.com/message/compose/?to=${p.author}&subject=${encodeURIComponent("Presupuesto para su proyecto - Barba Construction")}`
          : fullPostUrl;

        const prompt = `Analiza este título de publicación de un vecino en el foro de Reddit r/Louisville y responde en JSON:
Título: "${p.title}"

Responde con este esquema JSON estricto:
{
  "isHomeownerLookingForService": true o false,
  "serviceCategory": "ROOFING_SIDING_GUTTERS" | "CONCRETE_ASPHALT_PAVING" | "FENCE_PERIMETER_SECURITY" | "RENOVATION_REMODEL" | "NEW_CONSTRUCTION_GROUND_UP",
  "estimatedBudget": número en USD,
  "summary": "Resumen claro de 1 frase del proyecto que necesita el cliente",
  "customSalesPitch": "Respuesta directa y profesional de 2 frases presentándose como Barba Construction en Louisville, mencionando experiencia, licencia y ofreciendo presupuesto gratuito"
}`;

        const parsed = await classifyWithGemini(prompt);
        if (!parsed || !parsed.isHomeownerLookingForService) continue;

        const leadRef = `LEAD_REDDIT_${Buffer.from(p.permalink || p.title).toString("base64").slice(0, 24)}`;

        const leadObj = {
          first_name: authorName,
          last_name: "(Reddit r/Louisville)",
          phone: null,
          email: null,
          address: "Louisville Metro & Sur de Indiana (vía Reddit)",
          city: "Louisville",
          state: "KY",
          source: "other",
          pipeline_status: "new_lead",
          lead_quality: "hot",
          external_ref: leadRef,
          notes: `🎯 SOLICITUD DE PROPIETARIO EN REDDIT (r/Louisville):\n📌 Proyecto: ${parsed.summary}\n💬 Publicación: "${p.title}"\n🎯 NECESIDAD: ${parsed.serviceCategory}\n💰 VALOR ESTIMADO: $${parsed.estimatedBudget || 7500} USD\n🔥 URGENCIA: HIGH\n\n📩 ENLACE MENSAJE DIRECTO (DM): ${directDmUrl}\n🔗 ENLACE AL POST: ${fullPostUrl}\n\n=========================================\n💬 SPEECH DE VENTA RECOMENDADO (ESPAÑOL - DM):\n"${parsed.customSalesPitch}"\n\n💬 SALES PITCH (ENGLISH):\n"Hi, saw your post in r/Louisville looking for a ${parsed.serviceCategory} contractor. We are Barba Construction, local and licensed in Louisville. We'd love to stop by for a free estimate!"\n\n📞 APERTURA TELEFÓNICA:\n"Hola, le llamo de Barba Construction con respecto a su solicitud de presupuesto en Reddit para ${parsed.serviceCategory}."`
        };

        const { data: existing } = await supabase
          .from("contacts")
          .select("id")
          .eq("external_ref", leadObj.external_ref)
          .maybeSingle();

        if (!existing) {
          await supabase.from("contacts").insert(leadObj);
          console.log(`  🎉 [NUEVO LEAD REDDIT] u/${authorName} -> ${parsed.serviceCategory} ($${parsed.estimatedBudget || 7500})`);
          console.log(`     🔗 Post: ${fullPostUrl}`);
          console.log(`     📩 DM: ${directDmUrl}`);
          qualifiedLeads.push(leadObj);
        }
      }
    } catch (err: any) {
      console.warn(`  ⚠️ Error buscando en Reddit (${query}):`, err.message);
    }
  }

  await browser.close();
  console.log(`\n✅ [REDDIT] Total de leads calificados capturados: ${qualifiedLeads.length}\n`);
  return qualifiedLeads;
}

if (require.main === module) {
  scrapeRedditLeads().catch(console.error);
}
