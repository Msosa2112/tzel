import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import * as dotenv from "dotenv";

dotenv.config();

// Registrar plugin de sigilo si no está registrado
try {
  chromium.use(stealthPlugin());
} catch (e) {
  // Evitar error si ya está registrado
}

declare const document: any;

/**
 * Busca fotos de la propiedad usando Street View (si hay API key) o haciendo
 * scraping de Zillow/Redfin mediante Playwright Stealth + DuckDuckGo.
 */
export async function fetchPublicPropertyPhoto(address: string): Promise<string[] | null> {
  // Opción A: Google Street View API
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;
  if (apiKey) {
    console.log(`[PHOTO SCRAPER] Usando Google Street View API para: ${address}`);
    const streetViewUrl = `https://maps.googleapis.com/maps/api/streetview?size=600x400&location=${encodeURIComponent(address)}&key=${apiKey}`;
    return [streetViewUrl];
  }

  // Opción B: Scraping de Zillow/Redfin
  console.log(`[PHOTO SCRAPER] Iniciando fallback de scraping público para: ${address}`);
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 }
    });
    const page = await context.newPage();

    // Bloquear recursos innecesarios
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (["stylesheet", "font", "media"].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    // 1. Buscar en DuckDuckGo HTML enlaces de Zillow y Redfin
    const query = `${address} site:zillow.com/homedetails OR site:redfin.com`;
    console.log(`[PHOTO SCRAPER] Buscando en DDG: "${query}"`);
    
    await page.goto(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      waitUntil: "domcontentloaded",
      timeout: 15000
    });

    const links = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll("a.result__url, a.result__a"));
      return anchors.map(a => (a as any).href).filter(Boolean);
    }) as string[];

    const zillowLinks: string[] = [];
    const redfinLinks: string[] = [];

    for (const link of links) {
      const match = link.match(/[?&]uddg=([^&]+)/);
      const decoded = match ? decodeURIComponent(match[1]) : link;
      if (decoded.startsWith("http")) {
        if (decoded.includes("zillow.com/homedetails")) {
          zillowLinks.push(decoded);
        } else if (decoded.includes("redfin.com")) {
          redfinLinks.push(decoded);
        }
      }
    }

    let candidateUrls = [...zillowLinks, ...redfinLinks];
    
    // Critical Optimization: Filter candidate URLs to only check the target house number
    const houseNumberMatch = address.match(/^\d+/);
    if (houseNumberMatch) {
      const num = houseNumberMatch[0];
      candidateUrls = candidateUrls.filter(url => {
        const urlClean = url.toLowerCase().replace(/[^a-z0-9]/g, "");
        return urlClean.includes(num);
      });
      console.log(`[PHOTO SCRAPER] Filtrados ${candidateUrls.length} enlaces que coinciden con el número de casa: ${num}`);
    }

    // Street Name verification to prevent pulling photo of different property in another city/state
    const addressClean = address.toLowerCase().replace(/,/g, "").trim();
    const addressParts = addressClean.split(/\s+/);
    const stopWords = new Set(["st", "street", "ave", "avenue", "rd", "road", "ln", "lane", "dr", "drive", "ct", "court", "blvd", "boulevard", "ky", "in", "louisville", "new", "albany", "jefferson", "floyd", "clark", "south", "north", "east", "west", "s", "n", "e", "w"]);
    const streetTokens = addressParts.filter((part, idx) => {
      if (idx === 0 && /^\d+$/.test(part)) return false;
      if (/^\d{5}$/.test(part)) return false;
      if (stopWords.has(part)) return false;
      return part.length > 2;
    });
    if (streetTokens.length > 0) {
      candidateUrls = candidateUrls.filter(url => {
        const urlClean = url.toLowerCase();
        return streetTokens.some(token => urlClean.includes(token));
      });
      console.log(`[PHOTO SCRAPER] Filtrados ${candidateUrls.length} enlaces tras verificar palabras de calle: [${streetTokens.join(", ")}]`);
    }

    if (candidateUrls.length === 0) {
      console.log(`[PHOTO SCRAPER] No se encontraron enlaces de Zillow ni Redfin que coincidan con la calle.`);
      await browser.close();
      return null;
    }

    // Probar los candidatos en orden de prioridad (Zillow primero)
    let photoUrl: string | null = null;
    for (const targetUrl of candidateUrls) {
      try {
        console.log(`[PHOTO SCRAPER] Probando enlace objetivo: ${targetUrl}`);
        // Navegar a la página candidata
        await page.goto(targetUrl, {
          waitUntil: "domcontentloaded",
          timeout: 20000
        });
        // Validación estricta de dirección en el contenido/título de la página de Zillow/Redfin
        const pageTitle = await page.title().catch(() => "");
        const ogTitle = await page.locator('meta[property="og:title"]').getAttribute("content").catch(() => null);
        const textToValidate = `${pageTitle} ${ogTitle || ""}`.toLowerCase();

        const houseNum = houseNumberMatch ? houseNumberMatch[0] : "";
        const hasHouseNum = houseNum ? textToValidate.includes(houseNum) : true;
        const hasStreetWord = streetTokens.length > 0 ? streetTokens.some(tok => textToValidate.includes(tok)) : true;

        if (!hasHouseNum || !hasStreetWord) {
          console.log(`[PHOTO SCRAPER] Enlace rechazado: No coincide dirección en metadatos de la página. Buscado: casa="${houseNum}", calle="${streetTokens.join(",")}". Encontrado: "${pageTitle}"`);
          continue;
        }

        const ogImage = await page.locator('meta[property="og:image"]').getAttribute("content").catch(() => null);
        const twitterImage = await page.locator('meta[name="twitter:image"]').getAttribute("content").catch(() => null);
        const found = ogImage || twitterImage;

        // Si encontramos una imagen y no es un logo genérico, la usamos
        if (found && found.startsWith("http") && !found.toLowerCase().includes("logo")) {
          photoUrl = found;
          break;
        } else {
          console.log(`[PHOTO SCRAPER] Imagen inválida o logo genérico en: ${targetUrl}`);
        }
      } catch (err: any) {
        console.warn(`[PHOTO SCRAPER WARN] Error al cargar ${targetUrl}:`, err.message);
      }
    }

    await browser.close();

    if (photoUrl) {
      console.log(`[PHOTO SCRAPER EXITO] Foto extraída final: ${photoUrl}`);
      return [photoUrl];
    } else {
      console.log(`[PHOTO SCRAPER] No se pudo encontrar ninguna foto válida.`);
      return null;
    }
  } catch (err: any) {
    console.warn(`[PHOTO SCRAPER ERROR] Falló el scraper de fallback público:`, err.message);
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
    return null;
  }
}
