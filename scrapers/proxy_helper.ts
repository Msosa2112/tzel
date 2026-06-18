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

