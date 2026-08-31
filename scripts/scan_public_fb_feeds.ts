import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import { evaluateIntentWithPillars } from "../modules/construction/leads/facebook_group_collector";
import { syncLeadToBarbaPro } from "../modules/construction/integrations/barbapro_bridge";
import { ConstructionLead } from "../modules/construction/types";

const PUBLIC_LOCAL_GROUPS = [
  { name: "Cubanos en Louisville", url: "https://www.facebook.com/groups/124541089607873" },
  { name: "Emprendedores en Louisville KY", url: "https://www.facebook.com/groups/1615079142072651" },
  { name: "Latinos en Louisville KY", url: "https://www.facebook.com/groups/232470717462719" },
  { name: "Louisville Handyman and contractors", url: "https://www.facebook.com/groups/1118671608670868" },
  { name: "Trabajos Y negocios Louisville KY", url: "https://www.facebook.com/groups/1241315516053303" },
  { name: "De Todo En Louisville", url: "https://www.facebook.com/groups/1539209536340632" },
  { name: "Compra y venta en Louisville Kentucky", url: "https://www.facebook.com/groups/2330685773822292" }
];

async function classifyWithGemini(text: string, author: string, groupName: string) {
  const initial = evaluateIntentWithPillars(text, author);
  if (!initial.isValidConstruction) return initial;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return initial;

  try {
    const prompt = `Eres el Auditor de Leads de Construcción de TZEL en Louisville, KY.
Audita la publicación de "${author}" en el grupo "${groupName}".

Texto:
"${text}"

🚨 REGLA ESTRICTA (COMPRADOR VS VENDEDOR):
- Si el autor es un CONTRATISTA, NEGOCIO, VENDEDOR ofreciendo sus servicios, presupuestos o vendiendo cosas -> RECHAZAR OBLIGATORIAMENTE ("isValidConstruction": false).
- Si el autor es un CLIENTE, DUEÑO DE CASA o PROPIETARIO buscando cotización, contratista, recomendación o reportando un daño/remodelación -> ACEPTAR ("isValidConstruction": true).

Devuelve EXCLUSIVAMENTE un JSON:
{
  "isValidConstruction": boolean,
  "category": "ROOFING_SIDING_GUTTERS" | "PORCH_DECK_PATIO" | "RENOVATION_REMODEL" | "FENCE_PERIMETER_SECURITY" | "CONCRETE_ASPHALT_PAVING" | "NEW_CONSTRUCTION_GROUND_UP",
  "estimatedValue": number,
  "urgency": "HIGH" | "NORMAL",
  "summarySpanish": string
}`;

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });

    const data: any = await res.json();
    const cleanJson = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!cleanJson) return initial;
    return JSON.parse(cleanJson);
  } catch (err) {
    return initial;
  }
}

async function scanPublicFeeds() {
  console.log("\n=================================================================");
  console.log("🌐 ESCANEANDO MUROS PÚBLICOS DE FACEBOOK (LECTURA DIRECTA DE FEED) 🌐");
  console.log("=================================================================\n");

  const statePath = path.join(__dirname, "../browser_profiles/facebook_state.json");
  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"]
  });

  const context = await browser.newContext({
    storageState: fs.existsSync(statePath) ? statePath : undefined,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    viewport: { width: 1920, height: 1080 }
  });

  const page = await context.newPage();
  let totalFound = 0;

  for (const group of PUBLIC_LOCAL_GROUPS) {
    try {
      console.log(`\n📂 Escaneando Muro de: "${group.name}"...`);
      await page.goto(group.url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(4000);

      // Scroll para cargar publicaciones recientes
      for (let s = 0; s < 6; s++) {
        await page.mouse.wheel(0, 1800);
        await page.waitForTimeout(1500);
      }

      // Extraer bloques de publicaciones
      const rawPosts = await page.evaluate((groupUrl) => {
        const results: Array<{ author: string; text: string; link: string }> = [];
        const seen = new Set();
        const nodes = document.querySelectorAll('div[dir="auto"], div[role="article"], div[data-ad-preview="message"]');
        for (const n of Array.from(nodes)) {
          const text = (n as HTMLElement).innerText?.trim() || "";
          if (text.length > 30 && !seen.has(text.slice(0, 70))) {
            seen.add(text.slice(0, 70));
            const parent = n.closest('div[role="feed"] > div, div[role="article"]') || n;
            const linkEl = parent.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid="]') as HTMLAnchorElement;
            const authorEl = parent.querySelector('strong, h2, h3, h4, a[role="link"]');
            
            const author = authorEl ? (authorEl as HTMLElement).innerText.split('\n')[0].trim() : "Vecino del Grupo";
            const link = linkEl ? linkEl.href : `${groupUrl}`;

            results.push({ author, text, link });
          }
        }
        return results;
      }, group.url);

      console.log(`   📥 ${rawPosts.length} publicaciones leídas.`);

      for (const p of rawPosts) {
        const classified = await classifyWithGemini(p.text, p.author, group.name);
        if (classified.isValidConstruction && classified.category) {
          const leadId = `LEAD_FB_${crypto.createHash("md5").update(p.text.slice(0, 80)).digest("hex").slice(0, 12)}`;
          
          const phoneMatch = p.text.match(/\(?\b[0-9]{3}\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4}\b/);
          const ownerPhones = phoneMatch ? [phoneMatch[0]] : [];

          const lead: ConstructionLead = {
            leadId,
            category: classified.category,
            triggerEvent: "SOCIAL_INTENT_POST",
            address: `Grupo: ${group.name} (Louisville Metro)`,
            county: "Jefferson",
            state: "KY",
            ownerName: p.author,
            ownerPhones,
            ownerEmails: [],
            propertyType: "Residential",
            estimatedProjectValue: classified.estimatedValue || 6500,
            triggerDate: new Date().toISOString().split("T")[0],
            urgencyLevel: classified.urgency || "HIGH",
            sourcePortal: `Facebook Group: ${group.name}`,
            rawDetails: `👥 Grupo: "${group.name}"\n💬 Post: "${p.text.slice(0, 250)}..."\n🔗 Enlace al Post: ${p.link}`,
            permitNumber: p.link
          };

          totalFound++;
          await syncLeadToBarbaPro(lead);
          console.log(`   🎉 [CLIENTE ENCONTRADO EN FACEBOOK] ${lead.ownerName} -> ${lead.category} ($${lead.estimatedProjectValue})`);
        }
      }

    } catch (err: any) {
      console.warn(`   ⚠️ Error en "${group.name}": ${err.message}`);
    }
  }

  await browser.close();
  console.log(`\n=================================================================`);
  console.log(`🎉 Total de leads de compradores capturados en muros de Facebook: ${totalFound}`);
  console.log(`=================================================================\n`);
}

scanPublicFeeds().catch(console.error);
