import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";

// Registrar el plugin de sigilo
chromium.use(stealthPlugin());

// Instancias de SearXNG que tienen habilitado el soporte de JSON y están protegidas por retos anti-bot
const SEARXNG_JSON_INSTANCES = [
  "https://searxng.canine.tools",
  "https://searxng.shreven.org",
  "https://sx.catgirl.cloud",
  "https://search.chocolatemoo53.com",
  "https://baresearch.org",
  "https://etsi.me",
  "https://failsearx.culturanerd.it",
  "https://kantan.cat"
];

export interface SearXNGResult {
  title: string;
  url: string;
  content?: string;
  snippet?: string;
}

/**
 * Mezcla un array de forma aleatoria (Fisher-Yates)
 */
function shuffle<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Realiza una búsqueda en SearXNG usando Playwright Stealth para eludir Cloudflare/WAF.
 * Retorna los resultados estructurados del JSON nativo.
 */
export async function querySearXNG(query: string): Promise<SearXNGResult[]> {
  console.log(`[SEARXNG STEALTH] Iniciando búsqueda para: "${query}"...`);
  
  const browser = await chromium.launch({
    headless: true,
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
  });

  const page = await context.newPage();
  const shuffledInstances = shuffle(SEARXNG_JSON_INSTANCES);
  
  let results: SearXNGResult[] = [];

  for (const instance of shuffledInstances) {
    const searchUrl = `${instance}/search?q=${encodeURIComponent(query)}&format=json`;
    try {
      console.log(`[SEARXNG STEALTH] Probando instancia: ${instance}...`);
      await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 15000 });
      
      const pageText = await page.innerText("body");
      
      try {
        const parsed = JSON.parse(pageText);
        if (parsed && Array.isArray(parsed.results)) {
          results = parsed.results;
          console.log(`[SEARXNG STEALTH SUCCESS] Éxito en ${instance}. Encontrados ${results.length} resultados.`);
          break; // Encontrado con éxito, salir del bucle
        } else {
          console.warn(`[SEARXNG STEALTH WARN] Respuesta de ${instance} no contiene array de resultados.`);
        }
      } catch (jsonErr) {
        console.warn(`[SEARXNG STEALTH WARN] No se pudo parsear como JSON en ${instance}. Excerpt: ${pageText.substring(0, 100)}`);
      }
    } catch (err: any) {
      console.warn(`[SEARXNG STEALTH WARN] Error al consultar ${instance}: ${err.message}`);
    }
  }

  await browser.close();
  return results;
}
