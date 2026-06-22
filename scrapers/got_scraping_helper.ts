export interface GotScrapingOptions {
  headers?: Record<string, string>;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: string | Record<string, any>;
  json?: Record<string, any>;
  timeoutMs?: number;
  retryCount?: number;
  proxyUrl?: string;
}

/**
 * Helper genérico de red utilizando 'got-scraping' para realizar peticiones HTTP/2
 * emulando firmas TLS (JA3/JA4) de navegadores reales (Chrome/Firefox en Windows/Linux).
 */
export async function makeGotScrapingRequest(
  url: string,
  options: GotScrapingOptions = {}
) {
  // Importación dinámica nativa para evitar transpiles de CommonJS y soportar ESM a nivel de runtime
  const { gotScraping } = await (eval('import("got-scraping")') as Promise<any>);
  const timeout = options.timeoutMs ?? 15000;
  const retry = options.retryCount ?? 2;

  console.log(`[GOT-SCRAPING] Realizando petición HTTP/2 a: ${url}`);

  return gotScraping({
    url,
    method: options.method ?? "GET",
    headers: options.headers,
    body: options.body as any,
    json: options.json,
    proxyUrl: options.proxyUrl,
    timeout: {
      request: timeout,
    },
    retry: {
      limit: retry,
    },
    // Generador de firmas y cabeceras dinámicas para emulación de navegadores reales
    headerGeneratorOptions: {
      browsers: ["chrome", "firefox"],
      devices: ["desktop"],
      operatingSystems: ["windows", "linux"],
    },
  });
}
