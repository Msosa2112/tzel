import { ProxyConfiguration } from "crawlee";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Obtiene e inicializa la configuración de proxies de Crawlee basándose en el archivo .env
 */
export function getProxyConfiguration(): ProxyConfiguration | undefined {
  const useProxy = process.env.USE_PROXY === "true";
  const proxyUrlsStr = process.env.PROXY_URLS || "";
  
  if (!useProxy || !proxyUrlsStr.trim()) {
    console.log("[PROXY] Proxies desactivados o no configurados en .env. Se usará conexión directa.");
    return undefined;
  }
  
  const proxyUrls = proxyUrlsStr
    .split(",")
    .map(p => p.trim())
    .filter(p => p.length > 0);
    
  if (proxyUrls.length === 0) {
    return undefined;
  }
  
  console.log(`[PROXY] Inicializando configuración con ${proxyUrls.length} proxies rotativos.`);
  
  return new ProxyConfiguration({
    proxyUrls: proxyUrls
  });
}

/**
 * Retorna un proxy aleatorio como string (útil para peticiones HTTP directas con Axios o Playwright tradicional)
 */
export function getRandomProxyUrl(): string | undefined {
  const useProxy = process.env.USE_PROXY === "true";
  const proxyUrlsStr = process.env.PROXY_URLS || "";
  
  if (!useProxy || !proxyUrlsStr.trim()) {
    return undefined;
  }
  
  const proxyUrls = proxyUrlsStr
    .split(",")
    .map(p => p.trim())
    .filter(p => p.length > 0);
    
  if (proxyUrls.length === 0) {
    return undefined;
  }
  
  const randomIndex = Math.floor(Math.random() * proxyUrls.length);
  return proxyUrls[randomIndex];
}

/**
 * Solicita una resolución de Cloudflare al puerto de FlareSolverr e inyecta las cookies y UA correspondientes en el contexto de Playwright.
 */
export async function applyFlareSolverrBypass(context: any, url: string): Promise<boolean> {
  const solverUrl = process.env.FLARESOLVERR_URL || "http://localhost:8191/v1";
  try {
    const axios = require("axios");
    console.log(`[FLARESOLVERR] Intentando bypass de Cloudflare para ${url}...`);
    const solverRes = await axios.post(solverUrl, {
      cmd: "request.get",
      url: url,
      maxTimeout: 60000
    }, { timeout: 65000 });

    if (solverRes.data && solverRes.data.status === "ok") {
      const solution = solverRes.data.solution;
      console.log(`[FLARESOLVERR] Bypass exitoso. Inyectando cookies y User-Agent...`);
      
      // Inyectar User Agent
      await context.setExtraHTTPHeaders({
        "User-Agent": solution.userAgent
      });

      // Mapear cookies al formato de Playwright
      const cookies = solution.cookies.map((c: any) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires || undefined,
        httpOnly: c.httpOnly || false,
        secure: c.secure || false,
        sameSite: c.sameSite as "Lax" | "Strict" | "None" | undefined
      }));

      await context.addCookies(cookies);
      return true;
    }
  } catch (err: any) {
    console.error(`[FLARESOLVERR BYPASS ERROR] Falló la llamada a FlareSolverr: ${err.message}`);
  }
  return false;
}

/**
 * Lista de dominios que requieren enrutamiento forzado a través de FlareSolverr
 */
export const FLARESOLVERR_ENFORCED_DOMAINS = [
  "search.jeffersondeeds.com",
  "ecclix.com",
  "doxpop.com",
  "kypublicnotices.com",
  "indianapublicnotices.com"
];

/**
 * Determina si una URL pertenece a los dominios protegidos que requieren FlareSolverr
 */
export function shouldEnforceBypass(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();
    return FLARESOLVERR_ENFORCED_DOMAINS.some(domain => hostname.includes(domain));
  } catch (e) {
    return FLARESOLVERR_ENFORCED_DOMAINS.some(domain => url.toLowerCase().includes(domain));
  }
}

/**
 * Enruta forzadamente una petición de bypass si la URL coincide con los dominios protegidos
 */
export async function enforceFlareSolverrBypass(context: any, url: string): Promise<boolean> {
  if (shouldEnforceBypass(url)) {
    console.log(`[PROXY HELPER] Dominio protegido detectado: ${url}. Ejecutando FlareSolverr de forma exclusiva.`);
    return applyFlareSolverrBypass(context, url);
  }
  return false;
}

/**
 * Realiza un GET directo a través de FlareSolverr y retorna el HTML resultante
 */
export async function fetchHtmlViaFlareSolverr(url: string): Promise<string> {
  const solverUrl = process.env.FLARESOLVERR_URL || "http://localhost:8191/v1";
  try {
    const axios = require("axios");
    console.log(`[FLARESOLVERR DIRECT GET] Solicitando HTML para: ${url}...`);
    const solverRes = await axios.post(solverUrl, {
      cmd: "request.get",
      url: url,
      maxTimeout: 60000
    }, { timeout: 65000 });

    if (solverRes.data && solverRes.data.status === "ok" && solverRes.data.solution) {
      return solverRes.data.solution.response || "";
    }
  } catch (err: any) {
    console.error(`[FLARESOLVERR FETCH ERROR] No se pudo obtener HTML para ${url}: ${err.message}`);
  }
  return "";
}


