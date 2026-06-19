import axios from "axios";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import { querySearXNG } from "./searxng_client";
import { BatchDataClient } from "./scrapers/batchdata_client";
import { searchOSINTContacts } from "./intelligence/osint_scraper";


// Cargar variables de entorno
dotenv.config();

// Inicializar cliente de Turso DB
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

const batchDataClient = new BatchDataClient();

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

  // 1. Extraer ZIP code (5 dígitos al final, usando el último match para evitar colisiones con el número de casa)
  const zipMatches = street.match(/\b\d{5}\b/g);
  if (zipMatches) {
    zip = zipMatches[zipMatches.length - 1];
    const lastIdx = street.lastIndexOf(zip);
    if (lastIdx !== -1) {
      street = (street.substring(0, lastIdx) + street.substring(lastIdx + zip.length)).trim();
    }
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

function isLLC(name: string): boolean {
  const upper = name.toUpperCase();
  return upper.includes("LLC") || 
         upper.includes("INC") || 
         upper.includes("CORP") || 
         upper.includes("CO ") || 
         upper.includes("L.L.C.") || 
         upper.includes("PROPERTIES") || 
         upper.includes("TRUST") || 
         upper.includes("HOLDINGS") || 
         upper.includes("PARTNERS") || 
         upper.includes("GROUP");
}

/**
 * Realiza una búsqueda abierta (OSINT) en SearXNG para localizar teléfonos o enlaces públicos del dueño.
 */
async function performFreeOSINTrace(
  name: string,
  address: string,
  state: string,
  county: string
): Promise<{ phones: string[]; links: string[]; emails: string[] }> {
  const parsed = parseAddress(address, state, county);
  const city = parsed.city || county;
  const location = parsed.zip || city;
  
  let query = "";
  const isUnknown = !name || 
                    name.toLowerCase() === "unknown" || 
                    name.toLowerCase() === "no especificado" || 
                    name.trim() === "";
  
  if (isUnknown) {
    query = `"${parsed.street}" "${location}" (obituary OR divorce)`;
  } else if (isLLC(name)) {
    const stateName = state === "KY" ? "Kentucky" : (state === "IN" ? "Indiana" : state);
    query = `"${name}" "${stateName}" (bizapedia OR opencorporates OR "secretary of state")`;
  } else {
    query = `"${name}" "${location}" (obituary OR divorce)`;
  }
  
  // Truncamiento estricto a 100 caracteres
  query = query.substring(0, 100);
  
  const phones: string[] = [];
  const links: string[] = [];
  const emails: string[] = [];
  
  try {
    console.log(`[FREE OSINT SKIP TRACE] Consultando SearXNG para "${name}": "${query}"...`);
    const results = await querySearXNG(query);
    
    // Regex agresiva para formatos de teléfono sin colisiones con números más largos
    const phoneRegex = /(?<!\d)(?:\+?1[-.\s]*)?\(?\d{3}\)?[-.\s/]*\d{3}[-.\s/]*\d{4}(?!\d)/g;
    // Regex para direcciones de correo electrónico válidas
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

    const uniquePhones = new Set<string>();
    const uniqueEmails = new Set<string>();

    for (const result of results) {
      // 1. Escanear snippets (content/snippet) y título buscando teléfonos y correos
      const textToScan = `${result.title || ""} ${result.content || ""} ${result.snippet || ""}`;
      
      // Escanear teléfonos
      const phoneMatches = textToScan.match(phoneRegex) || [];
      for (const match of phoneMatches) {
        const clean = match.trim();
        if (clean.replace(/[^0-9]/g, "").length >= 10) {
          uniquePhones.add(clean);
        }
      }

      // Escanear correos
      const emailMatches = textToScan.match(emailRegex) || [];
      for (const match of emailMatches) {
        const clean = match.trim().toLowerCase();
        uniqueEmails.add(clean);
      }

      // 2. Extraer enlaces públicos de directorios
      const href = result.url;
      if (href && href.startsWith("http")) {
        const lowerDec = href.toLowerCase();
        if (
          lowerDec.includes("facebook.com") ||
          lowerDec.includes("bizapedia.com") ||
          lowerDec.includes("opencorporates.com") ||
          lowerDec.includes("whitepages.com") ||
          lowerDec.includes("truepeoplesearch.com") ||
          lowerDec.includes("fastpeoplesearch.com") ||
          lowerDec.includes("linkedin.com") ||
          lowerDec.includes("radaris.com")
        ) {
          links.push(href);
        }
      }
    }
    
    return {
      phones: Array.from(uniquePhones).slice(0, 5),
      links: Array.from(new Set(links)).slice(0, 3),
      emails: Array.from(uniqueEmails).slice(0, 5)
    };
  } catch (err: any) {
    console.error(`[FREE OSINT ERROR] Error buscando en SearXNG para ${name}:`, err.message);
  }
  
  return { phones: [], links: [], emails: [] };
}

/**
 * Realiza la búsqueda de contactos (Skip Tracing) para un deudor y dirección específicos.
 * Preparado para consumir la API de BatchData o similar.
 */
export async function performSkipTrace(
  defendant: string,
  rawAddress: string,
  state: string,
  county: string
): Promise<SkipTraceResult> {
  let batchDataOutOfFunds = false;

  // 1. Paso 1: Ejecutar la nueva búsqueda gratuita en OSINT
  try {
    console.log(`[WATERFALL SKIP TRACE] Paso 1: Buscando contactos vía OSINT para "${defendant}"...`);
    const osintResult = await searchOSINTContacts(defendant, rawAddress, state, county);
    
    // Paso 2: Si el motor OSINT devuelve contactos válidos, terminar el proceso (Costo: $0)
    if (osintResult && (osintResult.phones.length > 0 || osintResult.emails.length > 0)) {
      console.log(`[WATERFALL SKIP TRACE] Paso 2: OSINT gratuito exitoso para "${defendant}". Evitando BatchData.`);
      const phones = osintResult.phones.map(p => `OSINT: ${p}`);
      const emails = osintResult.emails.map(e => `OSINT: ${e}`);
      return { phones, emails };
    }
  } catch (err: any) {
    console.error(`[WATERFALL SKIP TRACE ERR] OSINT failed for ${defendant}:`, err.message);
  }

  // 2. Paso 3 (Fallback): Solo si el motor OSINT falló o devolvió null/vacío, usar la llamada a la API de BatchData
  if (process.env.SKIP_TRACE_PROVIDER === "batchdata") {
    try {
      console.log(`[WATERFALL SKIP TRACE] Paso 3: Fallback a BatchData API para "${defendant}"...`);
      const parsed = parseAddress(rawAddress, state, county);
      const batchRes = await batchDataClient.skipTrace(defendant, {
        street: parsed.street,
        city: parsed.city,
        state: parsed.state,
        zip: parsed.zip
      });

      if (batchRes.success && (batchRes.phones.length > 0 || batchRes.emails.length > 0)) {
        const phones: string[] = [];
        const emails: string[] = [];
        
        batchRes.phones.forEach(p => {
          const dncLabel = p.isDNC ? " [DNC]" : "";
          phones.push(`BatchData (${p.type}${dncLabel}): ${p.number}`);
        });
        batchRes.emails.forEach(e => {
          emails.push(`BatchData: ${e.email}`);
        });
        
        return { phones, emails };
      }

      if (batchRes.outOfFunds) {
        batchDataOutOfFunds = true;
      }
    } catch (err: any) {
      console.error(`[WATERFALL SKIP TRACE ERR] BatchData failed for ${defendant}:`, err.message);
    }
  }

  // 3. Generar enlaces de búsqueda para TruePeopleSearch, Whitepages, etc.
  const searchLinks: string[] = [];
  if (defendant && defendant.toLowerCase() !== "unknown" && defendant.toLowerCase() !== "unknown defendant") {
    const parsed = parseAddress(rawAddress, state, county);
    const location = parsed.zip || parsed.city || state;
    const nameEncoded = encodeURIComponent(defendant);
    const locEncoded = encodeURIComponent(location);
    searchLinks.push(`TruePeopleSearch: https://www.truepeoplesearch.com/results?name=${nameEncoded}&citystatezip=${locEncoded}`);
    searchLinks.push(`Whitepages: https://www.whitepages.com/name/${nameEncoded}/${locEncoded}`);
  }

  console.log(`[WATERFALL SKIP TRACE] No se encontraron resultados reales para "${defendant}". Retornando enlaces de búsqueda y 'Unknown' para teléfonos.`);
  
  return {
    phones: ["Unknown"],
    emails: searchLinks.length > 0 ? searchLinks : ["Unknown"]
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

    if (!address || address.trim() === "") {
      console.log(`[SKIP TRACE] Saltando caso ${auctionId}: Dirección no válida.`);
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

    // Adaptive Jitter: random delay between 3000ms and 5000ms with a minimum of 4000ms
    const jitterDelay = Math.max(4000, Math.random() * 2000 + 3000);
    await new Promise((resolve) => setTimeout(resolve, jitterDelay));
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

    // Adaptive Jitter: random delay between 3000ms and 5000ms with a minimum of 4000ms
    const jitterDelay = Math.max(4000, Math.random() * 2000 + 3000);
    await new Promise((resolve) => setTimeout(resolve, jitterDelay));
  }

  // 4. Consultar probates sin contactos asociados
  let probatesRes;
  try {
    probatesRes = await db.execute(`
      SELECT probate_id, heir_name, address, county, state
      FROM probates
      WHERE heir_phones IS NULL OR heir_phones = ''
    `);
  } catch (dbErr: any) {
    console.error("[DB ERROR] Error al consultar sucesiones pendientes de skip trace:", dbErr.message);
    process.exit(1);
  }

  const pendingProbates = probatesRes.rows;
  console.log(`\n[SKIP TRACE] Se encontraron ${pendingProbates.length} sucesiones sin teléfonos asignados.`);

  let probateProcessedCount = 0;

  for (const row of pendingProbates) {
    const probateId = row.probate_id as string;
    const heirName = row.heir_name as string;
    const address = row.address as string;
    const county = row.county as string || "Jefferson";
    const state = row.state as string || "KY";

    if (!heirName || heirName.trim() === "" || heirName === "Heredero Desconocido") {
      console.log(`[SKIP TRACE] Saltando herencia ${probateId}: Nombre de heredero no válido ("${heirName}")`);
      continue;
    }

    console.log(`[PROCESANDO HERENCIA] Heredero: ${heirName} | Dirección: ${address}`);
    
    // Obtener los contactos de la API
    const contacts = await performSkipTrace(heirName, address, state, county);
    const phonesStr = contacts.phones.join(", ");
    const emailsStr = contacts.emails.join(", ");

    // Actualizar base de datos
    try {
      await db.execute({
        sql: `
          UPDATE probates 
          SET heir_phones = ?, heir_emails = ? 
          WHERE probate_id = ?
        `,
        args: [phonesStr, emailsStr, probateId]
      });
      console.log(`[ÉXITO] Contactos de herencia guardados en base de datos.`);
      probateProcessedCount++;
    } catch (dbErr: any) {
      console.error(`[DB ERROR] Error al guardar teléfonos para la herencia de ${heirName}:`, dbErr.message);
    }

    // Adaptive Jitter: random delay between 3000ms and 5000ms with a minimum of 4000ms
    const jitterDelay = Math.max(4000, Math.random() * 2000 + 3000);
    await new Promise((resolve) => setTimeout(resolve, jitterDelay));
  }

  // 5. Consultar divorcios sin contactos asociados
  let divorcesRes;
  try {
    divorcesRes = await db.execute(`
      SELECT divorce_id, spouse_a, spouse_b, address, county, state
      FROM divorces
      WHERE (spouse_a_phones IS NULL OR spouse_a_phones = '') 
         OR (spouse_b_phones IS NULL OR spouse_b_phones = '')
    `);
  } catch (dbErr: any) {
    console.error("[DB ERROR] Error al consultar divorcios pendientes de skip trace:", dbErr.message);
    process.exit(1);
  }

  const pendingDivorces = divorcesRes.rows;
  console.log(`\n[SKIP TRACE] Se encontraron ${pendingDivorces.length} divorcios sin teléfonos asignados para alguno de los cónyuges.`);

  let divorceProcessedCount = 0;

  for (const row of pendingDivorces) {
    const divorceId = row.divorce_id as string;
    const spouseA = row.spouse_a as string;
    const spouseB = row.spouse_b as string;
    const address = row.address as string;
    const county = row.county as string || "Jefferson";
    const state = row.state as string || "KY";

    console.log(`[PROCESANDO DIVORCIO] Caso: ${divorceId} | Dirección: ${address}`);
    
    let phonesAStr = "";
    let emailsAStr = "";
    let phonesBStr = "";
    let emailsBStr = "";

    // Skip trace para Cónyuge A si no tiene teléfonos
    if (spouseA && spouseA !== "Cónyuge A" && spouseA.trim() !== "") {
      console.log(`  - Skip tracing para Cónyuge A: ${spouseA}`);
      const contactsA = await performSkipTrace(spouseA, address, state, county);
      phonesAStr = contactsA.phones.join(", ");
      emailsAStr = contactsA.emails.join(", ");
    }

    // Skip trace para Cónyuge B si no tiene teléfonos
    if (spouseB && spouseB !== "Cónyuge B" && spouseB.trim() !== "") {
      console.log(`  - Skip tracing para Cónyuge B: ${spouseB}`);
      const contactsB = await performSkipTrace(spouseB, address, state, county);
      phonesBStr = contactsB.phones.join(", ");
      emailsBStr = contactsB.emails.join(", ");
    }

    // Actualizar base de datos
    try {
      await db.execute({
        sql: `
          UPDATE divorces 
          SET spouse_a_phones = ?, spouse_a_emails = ?, spouse_b_phones = ?, spouse_b_emails = ? 
          WHERE divorce_id = ?
        `,
        args: [phonesAStr, emailsAStr, phonesBStr, emailsBStr, divorceId]
      });
      console.log(`[ÉXITO] Contactos de divorcio guardados en base de datos.`);
      divorceProcessedCount++;
    } catch (dbErr: any) {
      console.error(`[DB ERROR] Error al guardar teléfonos para el divorcio ${divorceId}:`, dbErr.message);
    }

    // Adaptive Jitter: random delay between 3000ms and 5000ms with a minimum of 4000ms
    const jitterDelay = Math.max(4000, Math.random() * 2000 + 3000);
    await new Promise((resolve) => setTimeout(resolve, jitterDelay));
  }

  // 6. Skip Trace de nuevas tablas del Omni-Crawler
  const physicalProcessed = await skipTraceGenericTable("physical_distress", "distress_id", "owner_name", "address", "state", "county");
  const financialProcessed = await skipTraceGenericTable("financial_distress", "record_id", "owner_name", "address", "state", "county");
  const lifeProcessed = await skipTraceGenericTable("life_events", "event_id", "subject_name", "address", "state", "county");
  const surplusProcessed = await skipTraceGenericTable("surplus_funds", "surplus_id", "owner_name", "address", "state", "county");

  console.log("\n========================================================");
  console.log("RESUMEN DE SKIP TRACING:");
  console.log(`- Subastas enriquecidas: ${processedCount}`);
  console.log(`- Violaciones enriquecidas: ${violationProcessedCount}`);
  console.log(`- Sucesiones enriquecidas: ${probateProcessedCount}`);
  console.log(`- Divorcios enriquecidos: ${divorceProcessedCount}`);
  console.log(`- Estrés Físico enriquecidos: ${physicalProcessed}`);
  console.log(`- Estrés Financiero enriquecidos: ${financialProcessed}`);
  console.log(`- Eventos de Vida enriquecidos: ${lifeProcessed}`);
  console.log(`- Fondos Excedentes enriquecidos: ${surplusProcessed}`);
  console.log("========================================================\n");
}

async function skipTraceGenericTable(
  tableName: string, 
  idCol: string, 
  nameCol: string, 
  addressCol: string, 
  stateCol: string, 
  countyCol: string
): Promise<number> {
  let leadsRes;
  try {
    leadsRes = await db.execute(`
      SELECT ${idCol}, ${nameCol}, ${addressCol}, ${stateCol}, ${countyCol}
      FROM ${tableName}
      WHERE (${nameCol} IS NOT NULL AND ${nameCol} != '' AND ${nameCol} != 'DUEÑO DESCONOCIDO' AND ${nameCol} != 'Unknown')
        AND (defendant_phones IS NULL OR defendant_phones = '')
    `);
  } catch (dbErr: any) {
    console.error(`[DB ERROR] Error al consultar ${tableName}:`, dbErr.message);
    return 0;
  }

  const leads = leadsRes.rows;
  console.log(`\n[SKIP TRACE GENERIC] Se encontraron ${leads.length} leads en ${tableName} sin teléfonos asignados.`);

  let count = 0;
  for (const row of leads) {
    const idVal = row[idCol] as string;
    const name = row[nameCol] as string;
    const address = row[addressCol] as string;
    const state = row[stateCol] as string || "KY";
    const county = row[countyCol] as string || "Jefferson";

    console.log(`[PROCESANDO ${tableName.toUpperCase()}] Lead: ${name} | Dirección: ${address}`);
    const contacts = await performSkipTrace(name, address, state, county);
    const phonesStr = contacts.phones.join(", ");
    const emailsStr = contacts.emails.join(", ");

    try {
      await db.execute({
        sql: `UPDATE ${tableName} SET defendant_phones = ?, defendant_emails = ? WHERE ${idCol} = ?`,
        args: [phonesStr, emailsStr, idVal]
      });
      console.log(`[ÉXITO] Contactos guardados.`);
      count++;
    } catch (err: any) {
      console.error(`[DB ERROR] No se pudieron guardar contactos para ${name} en ${tableName}:`, err.message);
    }

    // Adaptive Jitter: random delay between 3000ms and 5000ms with a minimum of 4000ms
    const jitterDelay = Math.max(4000, Math.random() * 2000 + 3000);
    await new Promise((resolve) => setTimeout(resolve, jitterDelay));
  }
  return count;
}

// Ejecutar si se corre directamente
if (require.main === module) {
  runSkipTracing().catch(console.error);
}

export { runSkipTracing };
