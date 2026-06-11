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
