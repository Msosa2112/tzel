import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import axios from "axios";
import * as dotenv from "dotenv";

// Cargar variables de entorno
dotenv.config();

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
 * Realiza una búsqueda en SearXNG.
 * Prioriza nuestra instancia local mediante una petición HTTP ultrarrápida directa.
 * Si falla, cae en fallback usando Playwright Stealth en la lista de instancias públicas.
 */
export async function querySearXNG(query: string): Promise<SearXNGResult[]> {
  const localUrl = process.env.SEARXNG_LOCAL_URL || "http://localhost:8080";
  
  // 1. Intentar petición HTTP directa a la instancia local (Soberana)
  try {
    console.log(`[SEARXNG CLIENT] Consultando instancia local soberana en: ${localUrl}...`);
    const response = await axios.get(`${localUrl}/search`, {
      params: {
        q: query,
        format: "json"
      },
      timeout: 5000 // Timeout rápido de 5 segundos
    });

    if (response.status === 200 && response.data && Array.isArray(response.data.results)) {
      const results = response.data.results;
      console.log(`[SEARXNG SUCCESS] Instancia local respondió con éxito. Encontrados ${results.length} resultados.`);
      return results;
    } else {
      console.warn(`[SEARXNG WARNING] Instancia local devolvió una respuesta inesperada o vacía.`);
    }
  } catch (err: any) {
    console.warn(`[SEARXNG WARNING] Instancia local no disponible o falló: ${err.message}. Iniciando fallback público...`);
  }

  // 2. Fallback: Búsqueda con Playwright Stealth a través del pool de instancias públicas
  console.log(`[SEARXNG STEALTH FALLBACK] Iniciando navegador headless para buscar en instancias públicas...`);
  
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
      console.log(`[SEARXNG STEALTH] Probando instancia pública: ${instance}...`);
      await page.goto(searchUrl, { waitUntil: "networkidle", timeout: 15000 });
      
      const pageText = await page.innerText("body");
      
      try {
        const parsed = JSON.parse(pageText);
        if (parsed && Array.isArray(parsed.results)) {
          results = parsed.results;
          console.log(`[SEARXNG STEALTH SUCCESS] Éxito en instancia pública ${instance}. Encontrados ${results.length} resultados.`);
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
