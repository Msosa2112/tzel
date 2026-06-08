import axios from "axios";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

// Cargar variables de entorno
dotenv.config();

// Inicializar cliente de Turso DB
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

interface SkipTraceResult {
  phones: string[];
  emails: string[];
}

/**
 * Realiza la búsqueda de contactos (Skip Tracing) para un deudor y dirección específicos.
 * Preparado para consumir la API de BatchData o similar.
 */
async function performSkipTrace(defendant: string, address: string): Promise<SkipTraceResult> {
  const apiKey = process.env.SKIP_TRACE_API_KEY;
  const apiProvider = process.env.SKIP_TRACE_PROVIDER || "batchdata"; // twilio, batchdata, mock

  if (!apiKey || apiKey.trim() === "") {
    console.log(`[SKIP TRACE] Sin API Key configurada. Usando datos mock para: "${defendant}"`);
    return {
      phones: ["000-000-0000"],
      emails: ["no-contact@example.com"]
    };
  }

  try {
    console.log(`[SKIP TRACE] Consultando API externa (${apiProvider}) para deudor: "${defendant}"...`);
    
    if (apiProvider === "batchdata") {
      // Endpoint típico de BatchData para Skip Tracing individual
      const url = "https://api.batchdata.com/api/v1/skip-trace/single";
      const response = await axios.post(
        url,
        {
          name: defendant,
          address: address
        },
        {
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          timeout: 10000
        }
      );

      if (response.status === 200 && response.data) {
        // Estructura de respuesta típica de BatchData
        const result = response.data.results || {};
        const phones = (result.phoneNumbers || []).map((p: any) => p.phoneNumber || p);
        const emails = (result.emailAddresses || []).map((e: any) => e.emailAddress || e);
        return {
          phones: phones.length > 0 ? phones : ["000-000-0000"],
          emails: emails.length > 0 ? emails : ["no-contact@example.com"]
        };
      }
    } else if (apiProvider === "twilio") {
      // Estructura alternativa para Twilio Lookup / Contact API
      // En este caso, Twilio se usa más para verificar, pero puede servir de interfaz
      console.log("[SKIP TRACE] Twilio Provider no está completamente cableado. Devolviendo datos mock.");
    }
    
  } catch (err: any) {
    console.error(`[SKIP TRACE ERROR] Falló la API de skip tracing: ${err.message}`);
  }

  // Fallback si la API falla o responde sin números
  return {
    phones: ["000-000-0000"],
    emails: ["no-contact@example.com"]
  };
}

/**
 * Ejecuta el enriquecimiento de contactos en lote para propiedades de alta rentabilidad sin teléfonos asignados.
 */
async function runSkipTracing() {
  console.log("[INICIO] Iniciando Módulo de Skip Tracing...");

  // 1. Consultar subastas de alta rentabilidad sin teléfonos asociados
  let leadsRes;
  try {
    leadsRes = await db.execute(`
      SELECT auction_id, defendant, address 
      FROM foreclosure_auctions 
      WHERE is_high_yield = 1 AND (defendant_phones IS NULL OR defendant_phones = '')
    `);
  } catch (dbErr: any) {
    console.error("[DB ERROR] Error al consultar deudores pendientes:", dbErr.message);
    process.exit(1);
  }

  const leads = leadsRes.rows;
  console.log(`[SKIP TRACE] Se encontraron ${leads.length} leads de alta rentabilidad sin teléfonos asignados.`);

  let processedCount = 0;

  for (const row of leads) {
    const auctionId = row.auction_id as string;
    const defendant = row.defendant as string;
    const address = row.address as string;

    if (!defendant || defendant.toLowerCase() === "no especificado" || defendant.trim() === "") {
      console.log(`[SKIP TRACE] Saltando caso ${auctionId}: Nombre de deudor no válido ("${defendant}")`);
      continue;
    }

    console.log(`[PROCESANDO] Lead: ${defendant} | Dirección: ${address}`);
    
    // Obtener los contactos de la API
    const contacts = await performSkipTrace(defendant, address);
    const phonesStr = contacts.phones.join(", ");
    const emailsStr = contacts.emails.join(", ");

    // Actualizar base de datos
    try {
      await db.execute({
        sql: `
          UPDATE foreclosure_auctions 
          SET defendant_phones = ?, defendant_emails = ? 
          WHERE auction_id = ?
        `,
        args: [phonesStr, emailsStr, auctionId]
      });
      console.log(`[ÉXITO] Teléfonos guardados: "${phonesStr}"`);
      processedCount++;
    } catch (dbErr: any) {
      console.error(`[DB ERROR] Error al guardar teléfonos para ${defendant}:`, dbErr.message);
    }

    // Espera corta entre llamadas a APIs
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log("\n========================================================");
  console.log("RESUMEN DE SKIP TRACING:");
  console.log(`- Leads enriquecidos: ${processedCount}`);
  console.log("========================================================\n");
}

// Ejecutar si se corre directamente
if (require.main === module) {
  runSkipTracing().catch(console.error);
}

export { runSkipTracing };
