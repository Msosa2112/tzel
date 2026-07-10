import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

export interface ScrapeGraphExtractOptions {
  url: string;
  prompt: string;
  schema?: Record<string, any>;
}

/**
 * Cliente TS unificado para integrar ScrapeGraphAI.
 * 
 * Si 'SGAI_API_KEY' está configurado en el archivo .env, consume la API gestionada en la nube (v2).
 * De lo contrario, cae en un fallback hacia un microservicio local (puerto configurable en SCRAPEGRAPH_LOCAL_URL).
 */
export async function extractWithScrapeGraph(options: ScrapeGraphExtractOptions): Promise<any> {
  const apiKey = process.env.SGAI_API_KEY;
  const localUrl = process.env.SCRAPEGRAPH_LOCAL_URL || "http://localhost:5001/api/extract";

  if (apiKey) {
    console.log(`[ScrapeGraph Client] Enviando a API gestionada (Cloud): ${options.url}`);
    try {
      const response = await axios.post(
        "https://v2-api.scrapegraphai.com/api/extract",
        {
          url: options.url,
          prompt: options.prompt,
          schema: options.schema,
        },
        {
          headers: {
            "SGAI-APIKEY": apiKey,
            "Content-Type": "application/json",
          },
          timeout: 60000, // 60 segundos de timeout para procesamiento del grafo
        }
      );
      
      console.log("[ScrapeGraph Client Success] Extracción exitosa desde API Cloud.");
      return response.data;
    } catch (err: any) {
      console.error(
        "[ScrapeGraph Client Error] Error en la API gestionada de ScrapeGraphAI:",
        err.response?.data || err.message
      );
      throw err;
    }
  } else {
    console.log(`[ScrapeGraph Client] SGAI_API_KEY no encontrada. Redirigiendo a microservicio local: ${localUrl}`);
    try {
      const response = await axios.post(
        localUrl,
        {
          url: options.url,
          prompt: options.prompt,
          schema: options.schema,
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 60000,
        }
      );
      
      console.log("[ScrapeGraph Client Success] Extracción exitosa desde microservicio local.");
      return response.data;
    } catch (err: any) {
      console.error("[ScrapeGraph Client Error] Falló la conexión con el microservicio local:", err.message);
      throw new Error(
        `No se pudo procesar la solicitud: Falta SGAI_API_KEY en el .env y el microservicio local de ScrapeGraphAI en ${localUrl} no está respondiendo.`
      );
    }
  }
}
