import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import axios from "axios";
import * as crypto from "crypto";
import { scoreAllProperties } from "../intelligence/stress_scorer";

// Cargar variables de entorno
dotenv.config();

// Inicializar cliente de Turso DB
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

// Expresiones regulares para teléfonos y correos
const PHONE_REGEX = /(?<!\d)(?:\+?1[-.\s]*)?\(?[2-9]\d{2}\)?[-.\s/]*\d{3}[-.\s/]*\d{4}(?!\d)/g;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

// Palabras clave para eventos de vida
const OBITUARY_KEYWORDS = ["obituary", "obituaries", "passed away", "falleció", "fallecio", "death", "died", "esquela", "difunto", "cemetery", "funeral", "grave", "memorial"];
const DIVORCE_KEYWORDS = ["divorce", "divorcio", "dissolution of marriage", "spouse", "ex-wife", "ex-husband"];
const BANKRUPTCY_KEYWORDS = ["bankruptcy", "bancarrota", "chapter 7", "chapter 13", "bankrupt", "quiebra"];

/**
 * Normaliza un número de teléfono al formato (XXX) XXX-XXXX.
 */
function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) {
    const prefix = digits.slice(0, 3);
    if (["800", "888", "877", "866", "855", "844", "833"].includes(prefix)) {
      return null;
    }
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    const prefix = digits.slice(1, 4);
    if (["800", "888", "877", "866", "855", "844", "833"].includes(prefix)) {
      return null;
    }
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return null;
}

/**
 * Comprueba si un nombre corresponde a una persona jurídica (LLC, Inc, etc.).
 */
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
 * Filtro de nombres inválidos.
 */
function isValidName(name: string | null | undefined): boolean {
  if (!name) return false;
  const lower = name.toLowerCase().trim();
  return lower !== "" && 
         lower !== "unknown" && 
         lower !== "no especificado" && 
         lower !== "dueño desconocido" && 
         lower !== "dueño" && 
         lower !== "dueno" && 
         lower !== "propietario";
}

/**
 * Realiza una consulta directa a la instancia local de SearXNG (puerto 8080).
 */
async function queryLocalSearXNG(query: string): Promise<any[]> {
  const localUrl = "http://localhost:8080/search";
  try {
    const response = await axios.get(localUrl, {
      params: {
        q: query,
        format: "json"
      },
      timeout: 10000 // Timeout de 10 segundos
    });

    if (response.status === 200 && response.data && Array.isArray(response.data.results)) {
      return response.data.results;
    }
  } catch (err: any) {
    console.warn(`[SEARXNG WARNING] Error consultando local SearXNG: ${err.message}`);
  }
  return [];
}

/**
 * Ejecuta el pipeline de rectificación OSINT sobre todas las tablas de propiedades activas.
 */
async function rectifyOSINTData() {
  console.log("=================================================================");
  console.log("🔍 INICIANDO RECTIFICACIÓN OSINT DESDE SEARXNG LOCAL 🔍");
  console.log("=================================================================");

  const todayStr = new Date().toISOString().split("T")[0];
  let totalEnrichedCount = 0;
  let totalLifeEventsInserted = 0;

  // 1. Obtener datos de foreclosure_auctions
  console.log("\n[PROCESANDO SUBASTAS JUDICIALES]");
  const auctionsRes = await db.execute(`
    SELECT auction_id, defendant as name, address, county, state 
    FROM foreclosure_auctions
  `);
  const auctionsEnriched = await processTableRows(
    "foreclosure_auctions", 
    "auction_id", 
    auctionsRes.rows as any[], 
    todayStr
  );
  totalEnrichedCount += auctionsEnriched.contactsUpdated;
  totalLifeEventsInserted += auctionsEnriched.lifeEventsCreated;

  // 2. Obtener datos de code_violations
  console.log("\n[PROCESANDO VIOLACIONES DE CÓDIGO]");
  const violationsRes = await db.execute(`
    SELECT violation_id, owner_name as name, address 
    FROM code_violations
  `);
  const mappedViolations = violationsRes.rows.map(r => ({
    violation_id: r.violation_id,
    name: r.name,
    address: r.address,
    county: "Jefferson",
    state: "KY"
  }));
  const violationsEnriched = await processTableRows(
    "code_violations", 
    "violation_id", 
    mappedViolations, 
    todayStr
  );
  totalEnrichedCount += violationsEnriched.contactsUpdated;
  totalLifeEventsInserted += violationsEnriched.lifeEventsCreated;

  // 3. Obtener datos de physical_distress
  console.log("\n[PROCESANDO ESTRÉS FÍSICO]");
  const physicalRes = await db.execute(`
    SELECT distress_id, owner_name as name, address, county, state 
    FROM physical_distress
  `);
  const physicalEnriched = await processTableRows(
    "physical_distress", 
    "distress_id", 
    physicalRes.rows as any[], 
    todayStr
  );
  totalEnrichedCount += physicalEnriched.contactsUpdated;
  totalLifeEventsInserted += physicalEnriched.lifeEventsCreated;

  // 4. Obtener datos de financial_distress
  console.log("\n[PROCESANDO ESTRÉS FINANCIERO]");
  const financialRes = await db.execute(`
    SELECT record_id, owner_name as name, address, county, state 
    FROM financial_distress
  `);
  const financialEnriched = await processTableRows(
    "financial_distress", 
    "record_id", 
    financialRes.rows as any[], 
    todayStr
  );
  totalEnrichedCount += financialEnriched.contactsUpdated;
  totalLifeEventsInserted += financialEnriched.lifeEventsCreated;

  // 5. Recalcular puntuaciones SSI globales
  console.log("\n[RECALCULANDO PUNTUACIONES SSI]");
  try {
    await scoreAllProperties();
    console.log("✅ Recálculo SSI de estrés completado con éxito.");
  } catch (err: any) {
    console.error("❌ Falló el recálculo SSI:", err.message);
  }

  console.log("\n========================================================");
  console.log("🏁 RESUMEN GENERAL DE RECTIFICACIÓN OSINT:");
  console.log(`- Propiedades enriquecidas con datos de contacto: ${totalEnrichedCount}`);
  console.log(`- Nuevos eventos de vida críticos insertados/actualizados: ${totalLifeEventsInserted}`);
  console.log("========================================================\n");
}

/**
 * Procesa las filas de una tabla específica y extrae los datos.
 */
async function processTableRows(
  tableName: string,
  idColName: string,
  rows: any[],
  todayStr: string
): Promise<{ contactsUpdated: number; lifeEventsCreated: number }> {
  let contactsUpdated = 0;
  let lifeEventsCreated = 0;

  for (const row of rows) {
    const idVal = row[idColName];
    const name = row.name as string;
    const address = row.address as string;
    const county = row.county as string || "Jefferson";
    const state = row.state as string || "KY";

    if (!isValidName(name)) {
      continue;
    }

    console.log(` -> Procesando [${tableName}] ID: ${idVal} | Nombre: "${name}" | Dirección: "${address}"`);

    // Construcción de la consulta para SearXNG
    const isCompany = isLLC(name);
    let query = "";
    if (isCompany) {
      const stateName = state === "KY" ? "Kentucky" : (state === "IN" ? "Indiana" : state);
      query = `"${name}" "${stateName}" (phone OR contact OR "secretary of state" OR directory OR bankruptcy)`;
    } else {
      const city = address.split(",")[1]?.trim() || county;
      query = `"${name}" "${city}" ${state} (phone OR contact OR directory OR obituary OR email OR divorce OR bankruptcy)`;
    }

    // Consultar SearXNG local
    const results = await queryLocalSearXNG(query);
    if (results.length === 0) {
      continue;
    }

    const uniquePhones = new Set<string>();
    const uniqueEmails = new Set<string>();
    let lifeEventsFound: Array<{ type: string; details: string }> = [];

    const nameCleanLower = name.toLowerCase().replace(/,?\s+llc\.?/gi, "").replace(/,?\s+inc\.?/gi, "").trim();

    for (const res of results) {
      const title = res.title || "";
      const content = res.content || res.snippet || "";
      const text = `${title} ${content}`;
      const textLower = text.toLowerCase();

      // 1. Escaneo de contactos
      const phoneMatches = text.match(PHONE_REGEX) || [];
      for (const p of phoneMatches) {
        const norm = normalizePhone(p);
        if (norm) uniquePhones.add(norm);
      }

      const emailMatches = text.match(EMAIL_REGEX) || [];
      for (const e of emailMatches) {
        const email = e.trim().toLowerCase();
        if (!email.endsWith(".png") && !email.endsWith(".jpg") && !email.endsWith(".gif") && !email.endsWith(".webp")) {
          uniqueEmails.add(email);
        }
      }

      // 2. Escaneo de eventos de vida (Solo si el fragmento contiene el nombre)
      if (textLower.includes(nameCleanLower)) {
        // Obituario
        if (OBITUARY_KEYWORDS.some(kw => textLower.includes(kw))) {
          lifeEventsFound.push({
            type: "Obituary",
            details: `Obituario sugerido: "${title}". Fragmento: "${content.substring(0, 160)}...". Fuente: ${res.url}`
          });
        }
        // Divorcio
        if (DIVORCE_KEYWORDS.some(kw => textLower.includes(kw))) {
          lifeEventsFound.push({
            type: "Divorce",
            details: `Registro de divorcio sugerido: "${title}". Fragmento: "${content.substring(0, 160)}...". Fuente: ${res.url}`
          });
        }
        // Bancarrota
        if (BANKRUPTCY_KEYWORDS.some(kw => textLower.includes(kw))) {
          lifeEventsFound.push({
            type: "Bankruptcy",
            details: `Registro de bancarrota sugerido: "${title}". Fragmento: "${content.substring(0, 160)}...". Fuente: ${res.url}`
          });
        }
      }
    }

    // Guardar contactos si los hay
    if (uniquePhones.size > 0 || uniqueEmails.size > 0) {
      const phonesStr = Array.from(uniquePhones).map(p => `OSINT: ${p}`).join(", ");
      const emailsStr = Array.from(uniqueEmails).map(e => `OSINT: ${e}`).join(", ");

      try {
        await db.execute({
          sql: `UPDATE ${tableName} SET defendant_phones = ?, defendant_emails = ? WHERE ${idColName} = ?`,
          args: [phonesStr, emailsStr, idVal]
        });
        console.log(`    ✅ Contactos actualizados: Teléfonos [${Array.from(uniquePhones).join(", ")}] | Correos [${Array.from(uniqueEmails).join(", ")}]`);
        contactsUpdated++;
      } catch (err: any) {
        console.error(`    ❌ Error actualizando contactos en base de datos:`, err.message);
      }
    }

    // Insertar eventos de vida si los hay
    for (const le of lifeEventsFound) {
      const hash = crypto.createHash("md5").update(address + le.type + nameCleanLower).digest("hex").substring(0, 10);
      const eventId = `LE_${hash.toUpperCase()}`;

      try {
        await db.execute({
          sql: `
            INSERT INTO life_events (
              event_id, event_type, subject_name, address, county, state, details, report_date, telegram_sent
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
            ON CONFLICT(event_id) DO UPDATE SET
              details = excluded.details,
              report_date = excluded.report_date
          `,
          args: [eventId, le.type, name, address, county, state, le.details, todayStr]
        });
        console.log(`    🔥 Evento de Vida registrado: [${le.type}] para ${name}`);
        lifeEventsCreated++;
      } catch (err: any) {
        console.error(`    ❌ Error guardando evento de vida en base de datos:`, err.message);
      }
    }

    // Espera muy corta para fluidez
    await new Promise(resolve => setTimeout(resolve, 80));
  }

  return { contactsUpdated, lifeEventsCreated };
}

// Ejecutar si se corre directamente
if (require.main === module) {
  rectifyOSINTData().catch(console.error);
}
