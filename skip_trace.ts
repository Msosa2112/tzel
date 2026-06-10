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
 * Normaliza y divide una dirección simple en componentes de calle, ciudad, estado y código postal.
 */
function parseAddress(rawAddress: string, state: string, county: string) {
  let street = rawAddress.trim();
  let city = "";
  let zip = "";

  // 1. Extraer ZIP code (5 dígitos al final)
  const zipMatch = street.match(/\b\d{5}\b/);
  if (zipMatch) {
    zip = zipMatch[0];
    street = street.replace(zip, "").trim();
  }

  // Quitar comas y espacios sobrantes al final
  street = street.replace(/,\s*$/, "").trim();

  // 2. Determinar la ciudad
  if (state === "KY" && county.toLowerCase().includes("jeff")) {
    city = "Louisville";
  } else if (state === "IN" && county.toLowerCase().includes("floyd")) {
    city = "New Albany";
  } else if (state === "IN" && county.toLowerCase().includes("clark")) {
    city = "Jeffersonville";
  } else {
    // Si contiene una coma, lo posterior suele ser la ciudad
    const parts = street.split(",");
    if (parts.length >= 2) {
      city = parts[parts.length - 1].trim();
      street = parts.slice(0, parts.length - 1).join(",").trim();
    } else {
      city = county; // Fallback
    }
  }

  return {
    street: street.replace(/,\s*$/, "").trim(),
    city: city,
    state: state,
    zip: zip || ""
  };
}

/**
 * Realiza la búsqueda de contactos (Skip Tracing) para un deudor y dirección específicos.
 * Preparado para consumir la API de BatchData o similar.
 */
async function performSkipTrace(
  defendant: string,
  rawAddress: string,
  state: string,
  county: string
): Promise<SkipTraceResult> {
  const apiKey = process.env.SKIP_TRACE_API_KEY;
  const apiProvider = process.env.SKIP_TRACE_PROVIDER || "batchdata";

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
      const parsedAddr = parseAddress(rawAddress, state, county);
      const url = "https://api.batchdata.com/api/v1/property/skip-trace";
      
      const payload = {
        requests: [
          {
            propertyAddress: {
              street: parsedAddr.street,
              city: parsedAddr.city,
              state: parsedAddr.state,
              zip: parsedAddr.zip
            },
            name: defendant
          }
        ],
        options: {
          includeTCPABlacklistedPhones: true
        }
      };

      console.log(`[SKIP TRACE] Payload enviado a BatchData:`, JSON.stringify(payload));

      const response = await axios.post(
        url,
        payload,
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
        const result = response.data.results?.[0] || {};
        const owner = result.owner || {};
        const phones = (owner.phones || []).map((p: any) => p.phoneNumber || p).filter(Boolean);
        const emails = (owner.emails || []).map((e: any) => e.email || e).filter(Boolean);
        
        console.log(`[SKIP TRACE] Respuesta de BatchData - Teléfonos encontrados:`, phones, `| Correos:`, emails);

        return {
          phones: phones.length > 0 ? phones : ["000-000-0000"],
          emails: emails.length > 0 ? emails : ["no-contact@example.com"]
        };
      }
    } else if (apiProvider === "twilio") {
      console.log("[SKIP TRACE] Twilio Provider no está completamente cableado. Devolviendo datos mock.");
    }
    
  } catch (err: any) {
    console.error(`[SKIP TRACE ERROR] Falló la API de skip tracing: ${err.message}`);
    if (err.response && err.response.data) {
      console.error(`[SKIP TRACE ERROR] Detalle de error de la API:`, JSON.stringify(err.response.data));
    }
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
      SELECT auction_id, defendant, address, state, county
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
    const state = row.state as string;
    const county = row.county as string;

    if (!defendant || defendant.toLowerCase() === "no especificado" || defendant.trim() === "") {
      console.log(`[SKIP TRACE] Saltando caso ${auctionId}: Nombre de deudor no válido ("${defendant}")`);
      continue;
    }

    console.log(`[PROCESANDO] Lead: ${defendant} | Dirección: ${address}`);
    
    // Obtener los contactos de la API
    const contacts = await performSkipTrace(defendant, address, state, county);
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
      console.log(`[ÉXITO] Contactos guardados en base de datos.`);
      processedCount++;
    } catch (dbErr: any) {
      console.error(`[DB ERROR] Error al guardar teléfonos para ${defendant}:`, dbErr.message);
    }

    // Espera corta entre llamadas a APIs
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  // 3. Consultar violaciones de código de alta rentabilidad sin contactos asociados
  let violationsRes;
  try {
    violationsRes = await db.execute(`
      SELECT violation_id, owner_name, address
      FROM code_violations
      WHERE is_high_yield = 1 AND (defendant_phones IS NULL OR defendant_phones = '')
    `);
  } catch (dbErr: any) {
    console.error("[DB ERROR] Error al consultar violaciones de código pendientes de skip trace:", dbErr.message);
    process.exit(1);
  }

  const violations = violationsRes.rows;
  console.log(`\n[SKIP TRACE] Se encontraron ${violations.length} violaciones de código de alta rentabilidad sin teléfonos asignados.`);

  let violationProcessedCount = 0;

  for (const row of violations) {
    const violationId = row.violation_id as string;
    const ownerName = row.owner_name as string;
    const address = row.address as string;
    const state = "KY";
    const county = "Jefferson";

    if (!ownerName || ownerName.trim() === "") {
      console.log(`[SKIP TRACE] Saltando violación ${violationId}: Nombre de propietario no válido ("${ownerName}")`);
      continue;
    }

    console.log(`[PROCESANDO VIOLACIÓN] Lead: ${ownerName} | Dirección: ${address}`);
    
    // Obtener los contactos de la API
    const contacts = await performSkipTrace(ownerName, address, state, county);
    const phonesStr = contacts.phones.join(", ");
    const emailsStr = contacts.emails.join(", ");

    // Actualizar base de datos
    try {
      await db.execute({
        sql: `
          UPDATE code_violations 
          SET defendant_phones = ?, defendant_emails = ? 
          WHERE violation_id = ?
        `,
        args: [phonesStr, emailsStr, violationId]
      });
      console.log(`[ÉXITO] Contactos de violación guardados en base de datos.`);
      violationProcessedCount++;
    } catch (dbErr: any) {
      console.error(`[DB ERROR] Error al guardar teléfonos para la violación de ${ownerName}:`, dbErr.message);
    }

    // Espera corta entre llamadas a APIs
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  console.log("\n========================================================");
  console.log("RESUMEN DE SKIP TRACING:");
  console.log(`- Subastas enriquecidas: ${processedCount}`);
  console.log(`- Violaciones enriquecidas: ${violationProcessedCount}`);
  console.log("========================================================\n");
}

// Ejecutar si se corre directamente
if (require.main === module) {
  runSkipTracing().catch(console.error);
}

export { runSkipTracing };
