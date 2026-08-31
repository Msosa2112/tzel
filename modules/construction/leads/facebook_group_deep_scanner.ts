import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import axios from "axios";
import { ConstructionLead, ClassifierResult, ConstructionTradeCategory } from "../types";
import { saveConstructionLead } from "../db_construction";
import { evaluateIntentWithPillars } from "./facebook_group_collector";
import * as dotenv from "dotenv";

dotenv.config();

// ============================================================================
// TOP 20 GRUPOS LOCALES DE LOUISVILLE Y SUR DE INDIANA
// ============================================================================
export const TOP_20_LOCAL_GROUPS = [
  { name: "Louisville Handyman and contractors", url: "https://www.facebook.com/groups/496778914856060" },
  { name: "Cubanos en Louisville", url: "https://www.facebook.com/groups/cubanosenlouisville" },
  { name: "Cubanos en Louisville-1", url: "https://www.facebook.com/groups/cubanosenlouisville1" },
  { name: "Cubanos en Louisville KY.", url: "https://www.facebook.com/groups/173486366570617" },
  { name: "Cuba en Louisville-Kentucky", url: "https://www.facebook.com/groups/800775378327116" },
  { name: "Cubanos en Louisville (Comunidad)", url: "https://www.facebook.com/groups/851689883539612" },
  { name: "Cubanos en Louisville (Alquiler & Venta)", url: "https://www.facebook.com/groups/797777442384103" },
  { name: "Latinos en Louisville KY", url: "https://www.facebook.com/groups/1198833901126588" },
  { name: "Latinos en Louisville, Kentucky", url: "https://www.facebook.com/groups/549672427773868" },
  { name: "Hispanos en Kentucky", url: "https://www.facebook.com/groups/hispanosenkentucky" },
  { name: "Trabajos Y negocios Louisville KY", url: "https://www.facebook.com/groups/1257393377675849" },
  { name: "Ventas y Trabajos Hispanos en Louisville", url: "https://www.facebook.com/groups/263152925995643" },
  { name: "Ventas y trabajos en louisville ky", url: "https://www.facebook.com/groups/597181882002372" },
  { name: "Emprendedores en Louisville KY", url: "https://www.facebook.com/groups/1615079142072651" },
  { name: "Compras Venta De Louisville Ky", url: "https://www.facebook.com/groups/1673880376394838" },
  { name: "Compra y venta en Louisville Kentucky", url: "https://www.facebook.com/groups/182135438921985" },
  { name: "De Todo En Louisville", url: "https://www.facebook.com/groups/3232791000370719" },
  { name: "CUBANOS DE LA ISLA.EN LOUISVILLE.KY", url: "https://www.facebook.com/groups/124541089607873" },
  { name: "Louisville Business Network", url: "https://www.facebook.com/groups/LoisvilleBusinessNetwork" },
  { name: "Autos y Clasificados Louisville & Indiana", url: "https://www.facebook.com/groups/204323603609196" }
];

// Palabras de alta intención conversacional para búsqueda interna dentro de grupos
const GROUP_INTENT_SEARCH_TERMS = [
  "recomienda", "estimado", "cotizar", "gotera", "techo", "canaletas",
  "siding", "porche", "deck", "cerca", "concreto", "baño", "remodelar",
  "ISO", "roofer", "contractor", "addition", "gutters"
];

/**
 * Clasificador con Gemini 2.5 Flash para los posts de grupos
 */
async function classifyGroupLead(postText: string, author: string, groupName: string): Promise<ClassifierResult> {
  const initialCheck = evaluateIntentWithPillars(postText, author);
  if (!initialCheck.isValidConstruction) return initialCheck;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return initialCheck;

  const prompt = `Eres el Auditor de Leads de Grupos de Facebook de TZEL para Construcción y Reformas en Louisville, KY y Sur de Indiana.

REGLAS DE CLASIFICACIÓN:
1. LEAD VÁLIDO: Propietario o cliente en el grupo "${groupName}" buscando cotizaciones, recomendaciones de contratistas o reportando daños físicos en su propiedad para:
   - Techos (Roofing), Goteras, Tejas.
   - Canaletas (Gutters), Bajantes, Fascia, Soffit.
   - Siding (Revestimiento de vinilo, madera, Hardie).
   - Extensiones y Ampliaciones de casas (Home Additions, Sunrooms, Garajes).
   - Porches, Terrazas, Patios cubiertos, Pérgolas, Decks de madera/compuesto.
   - Remodelaciones generales (Cocinas, Sótanos, Drywall, Pintura, Pisos).
   - Remodelación de Baños, Duchas modernas, Azulejos, Tinás.
   - Cercas perimetrales (Fences de madera, vinilo, aluminio).
   - Concreto, Pavimentación, Driveways, Losas, Muros de contención.
   - Obra nueva y reparaciones por tormentas/árboles caídos.

2. RECHAZAR OBLIGATORIAMENTE:
   - Trabajos de Plomería pura (calentadores de agua, tuberías tapadas, fontanería).
   - Trabajos de Electricidad pura (cableado, paneles eléctricos, enchufes).
   - Autopromoción de contratistas que venden sus propios servicios ("ofrecemos", "call us", "llámanos", "estimados gratis").
   - Venta de productos, autos o empleos ajenos.

Post de "${author}":
"""${postText.substring(0, 1500)}"""

Responde ÚNICAMENTE en JSON:
{
  "isValidConstruction": true o false,
  "rejectedReason": "Motivo si fue rechazada",
  "category": "Una de las 8 categorías aprobadas de obra",
  "estimatedValue": número aproximado en USD,
  "urgency": "HIGH",
  "summarySpanish": "Resumen claro en español de 2 líneas describiendo exactamente el trabajo o daño físico que requiere el cliente"
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

  return initialCheck;
}

/**
 * Escáner Profundo Grupo por Grupo con Búsqueda Interna de la Última Semana
 */
export async function deepScanFacebookGroups(maxGroups: number = 20): Promise<ConstructionLead[]> {
  console.log("\n=================================================================");
  console.log(`🌐 ESCÁNER PROFUNDO DE FACEBOOK: ${maxGroups} GRUPOS LOCALES (ÚLTIMA SEMANA) 🌐`);
  console.log("=================================================================");

  const barbaStatePath = path.join(__dirname, "../../../browser_profiles/barba_facebook_state.json");
  const defaultStatePath = path.join(__dirname, "../../../browser_profiles/facebook_state.json");
  const statePath = fs.existsSync(barbaStatePath) ? barbaStatePath : defaultStatePath;

  if (!fs.existsSync(statePath)) {
    console.warn("[FACEBOOK WARN] No se encontró ningún archivo de sesión de Facebook.");
    return [];
  }

  // Cargar y fusionar grupos de ambas cuentas si existen
  const barbaGroupsPath = path.join(__dirname, "../../../browser_profiles/barba_discovered_groups.json");
  const defaultGroupsPath = path.join(__dirname, "../../../browser_profiles/discovered_facebook_groups.json");

  let allGroups = [...TOP_20_LOCAL_GROUPS];
  if (fs.existsSync(barbaGroupsPath)) {
    try {
      const barbaGroups = JSON.parse(fs.readFileSync(barbaGroupsPath, "utf-8"));
      allGroups = [...barbaGroups, ...allGroups];
    } catch {}
  }

  // Deduplicar grupos por URL o nombre
  const uniqueGroupMap = new Map();
  allGroups.forEach((g: any) => {
    const key = g?.id || g?.url || g?.name;
    if (key && !uniqueGroupMap.has(key)) {
      uniqueGroupMap.set(key, g);
    }
  });

  const mergedGroups = Array.from(uniqueGroupMap.values());
  const groupsToScan = mergedGroups.slice(0, maxGroups);

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
    console.log(`ℹ️ [SESIÓN ACTIVA] Utilizando sesión de: ${statePath.includes('barba') ? 'Cuenta de Barba' : 'Cuenta Principal'}`);
    console.log(`📋 Total de grupos disponibles en el radar: ${mergedGroups.length} (Escaneando top ${groupsToScan.length})`);

    let groupIdx = 0;
    for (const group of groupsToScan) {
      groupIdx++;
      console.log(`\n📂 [${groupIdx}/${groupsToScan.length}] Escaneando Grupo: "${group.name}"...`);

      // Seleccionar los 4 términos de mayor rotación por grupo
      const termsForGroup = GROUP_INTENT_SEARCH_TERMS.slice((groupIdx % 4) * 4, ((groupIdx % 4) + 1) * 4);

      for (const term of termsForGroup) {
        try {
          const searchUrl = `${group.url}/search/?q=${encodeURIComponent(term)}`;
          await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
          await page.waitForTimeout(2500);

          // Clic en filtro "Publicaciones recientes" si está disponible
          try {
            const recentFilter = page.locator("span:text-is('Publicaciones recientes'), span:text-is('Recent posts'), span:text-is('Más recientes')").first();
            if (await recentFilter.isVisible({ timeout: 1500 })) {
              await recentFilter.click();
              await page.waitForTimeout(2000);
            }
          } catch {}

          // Scroll para cargar posts
          for (let s = 1; s <= 4; s++) {
            await page.mouse.wheel(0, 1600);
            await page.waitForTimeout(1000);
          }

          const groupPosts = await page.evaluate(() => {
            const els = Array.from(document.querySelectorAll('div[role="feed"] > div, div[role="article"], div.x1yztbdb, div[data-ad-preview="message"]'));
            return els.map(el => {
              const text = (el as HTMLElement).innerText || "";
              const linkEl = (el.querySelector('a[href*="/posts/"], a[href*="/permalink/"]') as HTMLAnchorElement);
              const link = linkEl ? linkEl.href : window.location.href;
              const authorEl = el.querySelector('strong, h2, h3, h4, a[role="link"]');
              const author = authorEl ? (authorEl as HTMLElement).innerText.trim() : "Vecino del Grupo";

              return { author, text, link };
            }).filter(p => p.text.length > 25);
          });

          console.log(`    🔎 Término "${term}": ${groupPosts.length} posts analizados.`);

          for (const p of groupPosts) {
            const hashKey = p.text.substring(0, 90).trim();
            if (seenTexts.has(hashKey)) continue;
            seenTexts.add(hashKey);

            const evaluation = await classifyGroupLead(p.text, p.author, group.name);

            if (evaluation.isValidConstruction && evaluation.category) {
              const leadId = `LEAD_FBG_${crypto.createHash("md5").update(hashKey).digest("hex").substring(0, 12)}`;
              const lead: ConstructionLead = {
                leadId,
                category: evaluation.category,
                triggerEvent: "SOCIAL_INTENT_POST",
                address: `Grupo: ${group.name} (Louisville Metro / Sur IN)`,
                county: "Clark / Floyd / Jefferson",
                state: "KY / IN",
                ownerName: p.author.split("\n")[0] || "Vecino del Grupo",
                ownerPhones: [],
                ownerEmails: [],
                propertyType: "Residential",
                estimatedProjectValue: evaluation.estimatedValue || 6500,
                triggerDate: new Date().toISOString().split("T")[0],
                urgencyLevel: evaluation.urgency || "HIGH",
                sourcePortal: `Facebook Group: ${group.name}`,
                rawDetails: `${evaluation.summarySpanish}\n👥 Grupo: "${group.name}"\n💬 Post: "${p.text.substring(0, 240)}..."\n🔗 Enlace directo al Post: ${p.link}`,
                permitNumber: p.link
              };

              await saveConstructionLead(lead);
              leads.push(lead);
              console.log(`      ✅ [LEAD APROBADO] (${lead.category}) "${lead.ownerName}" -> ${evaluation.summarySpanish}`);
            }
          }
        } catch (sErr: any) {
          console.warn(`    ⚠️ Error buscando "${term}" en "${group.name}": ${sErr.message}`);
        }
      }
    }

  } catch (err: any) {
    console.error(`[DEEP SCAN ERR] ${err.message}`);
  } finally {
    if (browser) await browser.close();
  }

  console.log("\n=================================================================");
  console.log(`🎉 [RESUMEN FINAL ESCÁNER PROFUNDO] ${leads.length} LEADS CALIFICADOS CAPTURADOS EN 20 GRUPOS`);
  console.log("=================================================================\n");
  return leads;
}

if (require.main === module) {
  deepScanFacebookGroups(15).catch(console.error);
}

