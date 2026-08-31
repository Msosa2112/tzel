import { chromium } from "playwright-extra";
import { chromium as nativeChromium } from "playwright";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import axios from "axios";
import * as dotenv from "dotenv";
import * as cheerio from "cheerio";

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

    if (response.status === 200 && response.data && Array.isArray(response.data.results) && response.data.results.length > 0) {
      const results = response.data.results;
      console.log(`[SEARXNG SUCCESS] Instancia local respondió con éxito. Encontrados ${results.length} resultados.`);
      return results;
    } else {
      console.warn(`[SEARXNG WARNING] Instancia local devolvió una respuesta inesperada o vacía.`);
    }
  } catch (err: any) {
    console.warn(`[SEARXNG WARNING] Instancia local no disponible o falló: ${err.message}. Iniciando fallback público...`);
  }

  // 2. Fallback Inmediato: DuckDuckGo Lite (rápido y limpio)
  try {
    const ddgResults = await queryDuckDuckGoLite(query);
    if (ddgResults && ddgResults.length > 0) {
      return ddgResults;
    }
  } catch (ddgErr: any) {
    console.warn(`[DDG LITE FALLBACK ERROR] Falló DuckDuckGo Lite: ${ddgErr.message}`);
  }

  // 3. Fallback terciario a Yahoo si DuckDuckGo Lite no devolvió resultados
  try {
    console.log(`[SEARXNG CLIENT] Intentando fallback terciario a Yahoo...`);
    const yahooResults = await queryYahoo(query);
    return yahooResults;
  } catch (err: any) {
    console.warn(`[YAHOO FALLBACK ERROR] Falló búsqueda en Yahoo: ${err.message}`);
    return [];
  }
}

/**
 * Consulta de respaldo a Yahoo Search usando Playwright.
 * Soporta la reescritura de consultas complejas a búsquedas individuales simplificadas.
 */
export async function queryYahoo(query: string): Promise<SearXNGResult[]> {
  // Reescribir si es consulta compleja con site: OR
  let queryList = [query];
  if (query.includes("site:fastpeoplesearch.com") || query.includes("site:truepeoplesearch.com")) {
    const match = query.match(/^("[^"]+")\s+("[^"]+")/);
    if (match) {
      const namePart = match[1];
      const locPart = match[2];
      queryList = [
        `${namePart} ${locPart} truepeoplesearch`,
        `${namePart} ${locPart} fastpeoplesearch`
      ];
      console.log(`[YAHOO QUERY REWRITE] Reescribiendo consulta compleja en ${queryList.length} consultas simples para Yahoo:`, queryList);
    }
  }

  const results: SearXNGResult[] = [];
  let browser;
  try {
    browser = await nativeChromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
    });

    for (const q of queryList) {
      const url = `https://search.yahoo.com/search?q=${encodeURIComponent(q)}`;
      console.log(`[YAHOO CLIENT] Consultando Yahoo para: "${q}"...`);
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForTimeout(1500);

        const htmlContent = await page.content();
        const $ = cheerio.load(htmlContent);

        $(".algo").each((_, elem) => {
          const firstAnchor = $(elem).find("a").first();
          const title = firstAnchor.text().trim();
          const href = firstAnchor.attr("href") || "";
          
          const snippetElem = $(elem).find(".compText, p");
          const snippet = snippetElem.text().trim();

          if (title && href && href.startsWith("http")) {
            if (!results.some(r => r.url === href)) {
              results.push({
                title,
                url: href,
                content: snippet,
                snippet
              });
            }
          }
        });
      } catch (err: any) {
        console.warn(`[YAHOO CLIENT WARN] Búsqueda falló para "${q}": ${err.message}`);
      } finally {
        await page.close();
      }
    }

    console.log(`[YAHOO SUCCESS] Búsquedas finalizadas en Yahoo. Total de resultados únicos: ${results.length}`);
    return results;
  } catch (err: any) {
    console.warn(`[YAHOO WARNING] Inicialización de Yahoo falló: ${err.message}`);
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Consulta de respaldo a la versión Lite de DuckDuckGo usando Playwright Stealth para evitar bloqueos.
 */
export async function queryDuckDuckGoLite(query: string): Promise<SearXNGResult[]> {
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
  let browser;
  try {
    console.log(`[DDG LITE CLIENT] Consultando DuckDuckGo Lite para: "${query}"...`);
    browser = await nativeChromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 10000 });

    const htmlContent = await page.content();
    const $ = cheerio.load(htmlContent);
    const results: SearXNGResult[] = [];
    const links: { title: string; url: string }[] = [];

    // Extraer títulos y URLs
    $(".result-link").each((_, elem) => {
      const title = $(elem).text().trim();
      const href = $(elem).attr("href");
      if (href) {
        const match = href.match(/[?&]uddg=([^&]+)/);
        if (match) {
          const decoded = decodeURIComponent(match[1]);
          if (decoded.startsWith("http") && !decoded.includes("duckduckgo.com")) {
            links.push({ title, url: decoded });
          }
        }
      }
    });

    // Extraer snippets correspondientes
    const snippets: string[] = [];
    $(".result-snippet").each((_, elem) => {
      snippets.push($(elem).text().trim());
    });

    for (let i = 0; i < links.length; i++) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        content: snippets[i] || "",
        snippet: snippets[i] || ""
      });
    }

    console.log(`[DDG LITE SUCCESS] DuckDuckGo Lite respondió con éxito. Encontrados ${results.length} resultados.`);
    return results;
  } catch (err: any) {
    console.warn(`[DDG LITE WARNING] Consulta a DuckDuckGo Lite falló: ${err.message}`);
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}
