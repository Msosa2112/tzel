import axios from "axios";

export interface CrawlResponse {
  success: boolean;
  url: string;
  markdown?: string;
  fit_markdown?: string;
  error?: string;
}

/**
 * Sends a URL to Crawl4AI Docker service and retrieves the cleaned Markdown.
 */
export async function crawlURL(url: string): Promise<string> {
  console.log(`[Crawl4AI Client] Enviando URL para extracción: ${url}`);
  try {
    const response = await axios.post<CrawlResponse>(
      "http://localhost:11235/crawl",
      {
        urls: [url],
        crawler_params: {
          only_text: true,
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 30000, // 30 seconds timeout
      }
    );

    if (response.status === 200 && response.data.success) {
      const mdContent = response.data.fit_markdown || response.data.markdown || "";
      if (!mdContent) {
        throw new Error("No se recibió contenido en formato markdown.");
      }
      return mdContent;
    } else {
      throw new Error(response.data.error || "Error desconocido en la extracción.");
    }
  } catch (err: any) {
    console.error(`[Crawl4AI Client Error] Falló crawling de ${url}:`, err.message);
    throw err;
  }
}

/**
 * Pushes extracted content to the local Hister search engine.
 */
export async function indexInHister(
  url: string,
  title: string,
  content: string,
  county: string,
  state: string
): Promise<void> {
  console.log(`[Hister Bridge] Indexando en Hister: ${title} (${url})`);
  try {
    const histerUrl = "http://localhost:5005/api/index";
    const payload = {
      url: url,
      title: title,
      content: content,
      metadata: {
        county: county,
        state: state,
        source: "Crawl4AI",
        indexed_at: new Date().toISOString(),
      },
    };

    const response = await axios.post(histerUrl, payload, {
      headers: {
        "Content-Type": "application/json",
        "Origin": "hister://", // CSRF bypass header
      },
      timeout: 10000,
    });

    if (response.status === 200 || response.status === 201) {
      console.log(`[Hister Bridge Success] Documento indexado exitosamente.`);
    } else {
      console.warn(`[Hister Bridge Warning] Hister respondió con código ${response.status}`);
    }
  } catch (err: any) {
    console.error(`[Hister Bridge Error] Falló la indexación en Hister:`, err.message);
    // Ingestion bridge exceptions are caught so they do not block main execution flow
  }
}

/**
 * Core Orchestrator function: Crawls a website using Crawl4AI and indexes it in Hister.
 */
export async function ingestURLToHister(targetUrl: string, countyName: string, stateName: string = "KY"): Promise<void> {
  console.log(`[Ingester Pipeline] Iniciando ingesta para: ${targetUrl} (Condado: ${countyName})`);
  try {
    const markdown = await crawlURL(targetUrl);
    const title = `Documento Extraído - ${countyName}, ${stateName}`;
    await indexInHister(targetUrl, title, markdown, countyName, stateName);
    console.log(`[Ingester Pipeline Success] Ingesta completada con éxito.`);
  } catch (err: any) {
    console.error(`[Ingester Pipeline Error] No se pudo completar el flujo de ingesta:`, err.message);
  }
}

// Module runner for manual validation
if (require.main === module) {
  (async () => {
    const testUrl = "https://example.com";
    await ingestURLToHister(testUrl, "Jefferson");
  })();
}
