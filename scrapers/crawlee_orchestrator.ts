import { PlaywrightCrawler, RequestQueue } from "crawlee";
import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";

// Habilitar stealth plugin
chromium.use(stealthPlugin());

export interface CrawlerConfig {
  concurrencyLimit?: number;
  maxRetries?: number;
  timeoutSecs?: number;
  headless?: boolean;
}

/**
 * Orquestador eficiente para scrapers que interactúan con portales públicos.
 * Configura límites de concurrencia estrictos y políticas de reintento para optimizar el consumo de memoria RAM local.
 */
export class CrawleeOrchestrator {
  private config: Required<CrawlerConfig>;

  constructor(config: CrawlerConfig = {}) {
    this.config = {
      concurrencyLimit: config.concurrencyLimit ?? 3, // Máximo 3 navegadores concurrentes
      maxRetries: config.maxRetries ?? 2,
      timeoutSecs: config.timeoutSecs ?? 45,
      headless: config.headless ?? true,
    };
  }

  /**
   * Ejecuta una tarea de rastreo para un conjunto de URLs con un handler de Playwright personalizado.
   */
  async runCrawl(
    urls: string[],
    handler: (context: any) => Promise<void>
  ): Promise<void> {
    console.log(`[CRAWLEE ORCHESTRATOR] Iniciando ciclo de rastreo eficiente para ${urls.length} URLs...`);

    // Crear una cola de peticiones con un ID de sesión único
    const queueId = `tzel-orchestrator-queue-${Date.now()}`;
    const requestQueue = await RequestQueue.open(queueId);

    for (const url of urls) {
      await requestQueue.addRequest({ url });
    }

    const crawler = new PlaywrightCrawler({
      requestQueue,
      maxConcurrency: this.config.concurrencyLimit,
      maxRequestRetries: this.config.maxRetries,
      requestHandlerTimeoutSecs: this.config.timeoutSecs,
      launchContext: {
        launcher: chromium,
        launchOptions: {
          headless: this.config.headless,
        },
      },
      // Inyección automática de cookies pre-navegación para eCCLIX
      preNavigationHooks: [
        async ({ page, request }) => {
          const { injectEcclixCookieIfApplicable } = await import("./ecclix_session_injector");
          await injectEcclixCookieIfApplicable(page, request.url);
        }
      ],
      // Handler principal
      requestHandler: async (context) => {
        const { request, log } = context;
        log.info(`[PROCESANDO URL] ${request.url}`);
        await handler(context);
      },
      // Manejo de fallos definitivos
      failedRequestHandler: ({ request, log }) => {
        log.error(`[CRAWL FALLIDO] La petición a ${request.url} falló permanentemente tras ${this.config.maxRetries} reintentos.`);
      },
    });

    try {
      await crawler.run();
    } finally {
      // Asegurar la limpieza de la cola para liberar recursos del disco
      await requestQueue.drop().catch((e) => {
        console.error(`[ORCHESTRATOR CLEANUP ERROR] No se pudo eliminar la cola:`, e.message);
      });
      console.log(`[CRAWLEE ORCHESTRATOR] Ciclo de rastreo finalizado y cola liberada.`);
    }
  }
}
