import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Obtiene la cookie de sesión activa de eCCLIX (ASP.NET_SessionId).
 * Prioriza la variable de entorno 'ECCLIX_SESSION_ID' y cae en 'storage/ecclix_config.json'.
 */
export function getEcclixSessionCookie(): string | null {
  if (process.env.ECCLIX_SESSION_ID) {
    return process.env.ECCLIX_SESSION_ID;
  }

  const configPath = path.join(__dirname, "../storage/ecclix_config.json");
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      return config.ASP_NET_SessionId || config.sessionId || null;
    } catch (e: any) {
      console.error(`[ECCLIX INJECTOR] Error al leer ecclix_config.json:`, e.message);
    }
  }

  return null;
}

/**
 * Inyecta dinámicamente la cookie de sesión en el navegador Playwright
 * si el destino es eCCLIX o uno de los portales de condados dependientes.
 */
export async function injectEcclixCookieIfApplicable(page: any, url: string): Promise<boolean> {
  const isEcclix = url.includes("ecclix") || 
                   url.includes("scottkyclerk") || 
                   url.includes("oldhamkyclerk") || 
                   url.includes("bullittkyclerk");

  if (!isEcclix) {
    return false;
  }

  const cookieValue = getEcclixSessionCookie();
  if (!cookieValue) {
    console.warn(`[ECCLIX INJECTOR] Advertencia: URL de eCCLIX detectada pero no hay cookie 'ASP.NET_SessionId' configurada.`);
    return false;
  }

  let domain = "www.ecclix.com";
  try {
    const urlObj = new URL(url);
    domain = urlObj.hostname;
  } catch (e) {}

  try {
    await page.context().addCookies([
      {
        name: "ASP.NET_SessionId",
        value: cookieValue,
        domain: domain,
        path: "/",
        httpOnly: true,
        secure: true
      }
    ]);
    console.log(`[ECCLIX INJECTOR] Cookie 'ASP.NET_SessionId' inyectada con éxito para el dominio: ${domain}`);
    return true;
  } catch (err: any) {
    console.error(`[ECCLIX INJECTOR ERROR] Error al inyectar la cookie en el contexto de Playwright:`, err.message);
    return false;
  }
}
