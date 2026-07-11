import { chromium as playwrightChromium, Browser } from "playwright";
import { chromium as playwrightExtraChromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";

// Registrar el plugin de sigilo en playwright-extra para el fallback local
try {
  playwrightExtraChromium.use(stealthPlugin());
} catch (e) {
  // Ignorar si ya está registrado
}

let cachedCDPBrowser: Browser | null = null;

export interface GetBrowserResult {
  browser: Browser;
  isObscura: boolean;
}

/**
 * Retorna una conexión persistente a Obscura CDP (puerto 9222) si está disponible,
 * o inicia una instancia local de Chromium con sigilo como fallback.
 * 
 * @param headless Si se debe lanzar local en modo headless (si hay fallback)
 * @returns Objeto con el navegador y si está conectado a Obscura
 */
export async function getBrowser(headless: boolean = true): Promise<GetBrowserResult> {
  // 1. Intentar usar la conexión cacheada si existe y sigue activa
  if (cachedCDPBrowser && cachedCDPBrowser.isConnected()) {
    return { browser: cachedCDPBrowser, isObscura: true };
  }

  // 2. Intentar establecer conexión con Obscura a través de CDP
  try {
    console.log("[BROWSER HELPER] Intentando conectar a Obscura CDP en ws://127.0.0.1:9225...");
    const browser = await playwrightChromium.connectOverCDP({
      endpointURL: "ws://127.0.0.1:9225",
    });

    // Interceptar browser.close para evitar que los scrapers/crawlers cierren la conexión CDP persistente
    browser.close = async () => {
      console.log("[BROWSER HELPER] Cierre de conexión CDP de Obscura interceptado (se mantiene activa).");
      // No-op para mantener activo el pool de peticiones
    };

    cachedCDPBrowser = browser;
    console.log("[BROWSER HELPER] Conexión CDP a Obscura establecida con éxito.");
    return { browser, isObscura: true };
  } catch (err: any) {
    console.warn(`[BROWSER HELPER] Falló la conexión a Obscura CDP: ${err.message}. Iniciando fallback con Chromium local...`);
    
    // 3. Fallback: Lanzar instancia local estándar de Playwright con plugin de sigilo
    const browser = await playwrightExtraChromium.launch({
      headless,
    }) as unknown as Browser;
    
    return { browser, isObscura: false };
  }
}
