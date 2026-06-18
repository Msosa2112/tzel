import axios from "axios";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import { calculateRehab, calculateMAO, calculateROI, isJuniorLien, calculateNetEquity, isUnderwater, checkCriticalRisk } from "./underwriting/underwriter";
import { querySearXNG } from "./searxng_client";


// Cargar variables de entorno
dotenv.config();

// Inicializar cliente de Turso DB
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const NOISE_WORDS = new Set([
  "st", "street", "ave", "avenue", "rd", "road", "ln", "lane", "dr", "drive", 
  "ct", "court", "blvd", "boulevard", "way", "pl", "place", "hwy", "highway", 
  "rte", "route", "cir", "circle", "ter", "terrace", "trl", "trail", "pkwy", "parkway",
  "apt", "apartment", "unit", "ste", "suite", "fl", "floor", 
  "n", "north", "s", "south", "e", "east", "w", "west", 
  "ky", "in", "jefferson", "clark", "floyd"
]);

const UNIT_INDICATORS = ["apt", "unit", "ste", "suite", "#", "apartment"];

/**
 * Normaliza y extrae el número de casa y palabras clave del nombre de la calle.
 */
function parseAddress(address: string): { houseNumber: string | null; coreWords: string[] } {
  let part1 = address.split(",")[0].trim().toLowerCase();
  
  for (const indicator of UNIT_INDICATORS) {
    const idx = part1.indexOf(indicator);
    if (idx !== -1) {
      part1 = part1.substring(0, idx).trim();
    }
  }
  
  part1 = part1.replace(/[^a-z0-9\s]/g, " ");
  
  const words = part1.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) {
    return { houseNumber: null, coreWords: [] };
  }
  
  let houseNumber: string | null = null;
  let streetStartIndex = 0;
  
  if (/^\d+/.test(words[0])) {
    houseNumber = words[0];
    streetStartIndex = 1;
  }
  
  const coreWords: string[] = [];
  for (let i = streetStartIndex; i < words.length; i++) {
    const w = words[i];
    if (NOISE_WORDS.has(w)) continue;
    if (/^\d{5}$/.test(w)) continue;
    coreWords.push(w);
  }
  
  return { houseNumber, coreWords };
}

/**
 * Extrae y normaliza la información de la unidad/departamento para evitar colisiones.
 */
function getUnitInfo(address: string): string {
  const cleanAddress = address.toLowerCase();
  for (const indicator of ["apt", "unit", "ste", "suite", "#", "apartment"]) {
    const idx = cleanAddress.indexOf(indicator);
    if (idx !== -1) {
      const rest = cleanAddress.substring(idx);
      const parts = rest.split(",");
      const unitPart = parts[0].trim().replace(/[^a-z0-9]/g, "");
      if (unitPart) return unitPart;
    }
  }
  return "";
}

/**
 * Retorna una clave de agrupación limpia y determinista basada en el número de casa, el nombre de la calle y la unidad.
 */
function getGroupingKey(address: string): string {
  const parsed = parseAddress(address);
  const unit = getUnitInfo(address);
  if (!parsed.houseNumber) {
    const base = address.toLowerCase().replace(/[^a-z0-9]/g, "");
    return unit ? `${base}_${unit}` : base;
  }
  const baseKey = `${parsed.houseNumber}_${parsed.coreWords.join("_")}`;
  return unit ? `${baseKey}_${unit}` : baseKey;
}

/**
 * Retorna la URL del catastro PVA basado en el condado y estado.
 */
function getPvaUrl(county: string, state: string): string {
  const cleanState = state.toUpperCase().trim();
  const cleanCounty = county.toLowerCase().trim();
  
  if (cleanState === "KY" && cleanCounty.includes("jefferson")) {
    return "https://jeffersonky.patriotproperties.com/Search.asp";
  } else if (cleanState === "IN" && cleanCounty.includes("clark")) {
    return "https://clarkin.wthgis.com/";
  } else if (cleanState === "IN" && cleanCounty.includes("floyd")) {
    return "https://floydin.wthgis.com/";
  }
  return "https://www.google.com/search?q=" + encodeURIComponent(`${county} County ${state} PVA Property Search`);
}

/**
 * Calcula la cantidad de días restantes hasta la fecha de la subasta.
 */
function getDaysRemaining(dateStr: string): number | null {
  try {
    let cleanDate = dateStr.toLowerCase().replace(/\s+/g, " ").trim();
    const months: { [key: string]: number } = {
      jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
      apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
      aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
      nov: 10, november: 10, dec: 11, december: 11
    };
    
    let dateObj: Date | null = null;
    
    if (/^\d+\/\d+\/\d+$/.test(cleanDate)) {
      const [m, d, y] = cleanDate.split("/").map(Number);
      dateObj = new Date(y, m - 1, d);
    }
    else if (cleanDate.includes("/")) {
      const parts = cleanDate.split("/");
      const monthName = parts[0].trim();
      const dayAndYear = parts[1].trim();
      const dayYearParts = dayAndYear.split(" ");
      const day = parseInt(dayYearParts[0]);
      const year = parseInt(dayYearParts[1] || "2026");
      
      if (months[monthName] !== undefined && !isNaN(day)) {
        dateObj = new Date(year, months[monthName], day);
      }
    }
    else {
      cleanDate = cleanDate.replace(/,/g, "");
      const parts = cleanDate.split(" ");
      if (parts.length >= 3) {
        const monthName = parts[0];
        const day = parseInt(parts[1]);
        const year = parseInt(parts[2]);
        if (months[monthName] !== undefined && !isNaN(day) && !isNaN(year)) {
          dateObj = new Date(year, months[monthName], day);
        }
      }
    }
    
    if (dateObj && !isNaN(dateObj.getTime())) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      dateObj.setHours(0, 0, 0, 0);
      const diffTime = dateObj.getTime() - today.getTime();
      return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }
  } catch (e) {
    // Falla silenciosa
  }
  return null;
}

/**
 * Valida la existencia de un PDF de tasación judicial.
 */
async function checkPdfUrl(pdfUrl: string): Promise<string> {
  try {
    console.log(`[CHECK PDF] Validando existencia de PDF: ${pdfUrl}`);
    const headResp = await axios.head(pdfUrl, {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" 
      },
      timeout: 3000
    });
    if (headResp.status === 200) {
      return `📁 [Ver PDF de Tasación](${pdfUrl})`;
    }
  } catch (err) {
    // Falla silenciosa
  }
  return `📁 Tasación PDF: No disponible aún (se publica 1-2 semanas antes)`;
}

/**
 * Envía un mensaje estructurado premium a Telegram, soportando botones interactivos (inline keyboard).
 */
async function sendTelegramNotification(message: string, replyMarkup?: any, photoUrl: string | null = null): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log("[TELEGRAM] Advertencia: Credenciales de Telegram no configuradas.");
    return false;
  }
  
  if (photoUrl) {
    if (message.length <= 1024) {
      console.log("[TELEGRAM] Enviando foto única con caption (longitud <= 1024)...");
      const url = `https://api.telegram.org/bot${token}/sendPhoto`;
      const payload: any = {
        chat_id: chatId,
        photo: photoUrl,
        caption: message,
        parse_mode: "Markdown"
      };
      if (replyMarkup) {
        payload.reply_markup = replyMarkup;
      }
      try {
        const response = await axios.post(url, payload, { timeout: 10000 });
        if (response.status === 200) return true;
      } catch (err: any) {
        console.warn(`[TELEGRAM PHOTO WARNING] Falló el envío de foto con caption: ${err.message}. Reintentando texto...`);
      }
    } else {
      console.log("[TELEGRAM] Reporte largo detectado (> 1024). Enviando foto primero y luego el reporte...");
      const urlPhoto = `https://api.telegram.org/bot${token}/sendPhoto`;
      const title = `📸 *Foto de Propiedad para:* ${message.split("\n")[0] || "Reporte de Oportunidad"}`;
      try {
        await axios.post(urlPhoto, {
          chat_id: chatId,
          photo: photoUrl,
          caption: title,
          parse_mode: "Markdown"
        }, { timeout: 10000 });
      } catch (err: any) {
        console.warn(`[TELEGRAM PHOTO WARNING] Falló el envío de la foto previa: ${err.message}`);
      }
    }
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload: any = {
    chat_id: chatId,
    text: message,
    parse_mode: "Markdown",
    disable_web_page_preview: true
  };

  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }
  
  try {
    const response = await axios.post(url, payload, { timeout: 10000 });
    return response.status === 200;
  } catch (e: any) {
    console.error(`[TELEGRAM EXCEPTION] Error al enviar mensaje: ${e.message || e}`);
    return false;
  }
}

interface GroupedLead {
  groupingKey: string;
  displayAddress: string;
  state: string;
  county: string;
  ownerName: string;
  phones: Set<string>;
  emails: Set<string>;
  mlsValue: number;
  mlsId: string;
  auctions: any[];
  violations: any[];
  probates: any[];
  divorces: any[];
  bankruptcies: any[];
  physicalDistress: any[];
  financialDistress: any[];
  lifeEvents: any[];
  hiddenMortgages: number;
  
  // Nuevos campos del catastro y la MLS
  mailingAddress?: string;
  isAbsentee: boolean;
  sqft?: number;
  beds?: number;
  baths?: number;
  stressScore?: number;
  photoUrls: string[];
  nextRetryDate?: string;
}

/**
 * Extrae la ciudad de la dirección o utiliza condados como fallback.
 */
function extractCity(address: string, county: string, state: string): string {
  const parts = address.split(",");
  if (parts.length >= 2) {
    const cityCandidate = parts[parts.length - 2].trim();
    if (cityCandidate && !cityCandidate.includes(" ") && cityCandidate.length > 2) {
      return cityCandidate;
    }
    const cityPart = parts[1].trim();
    if (cityPart) return cityPart;
  }
  const cleanCounty = county.toLowerCase();
  if (cleanCounty.includes("jefferson")) return "Louisville";
  if (cleanCounty.includes("clark")) return "Jeffersonville";
  if (cleanCounty.includes("floyd")) return "New Albany";
  return county;
}

/**
 * Realiza una búsqueda rápida en SearXNG para obituario o divorcio del propietario.
 */
async function searchLegalRadar(ownerName: string, city: string): Promise<boolean> {
  if (!ownerName || ownerName === "No especificado" || ownerName === "DUEÑO DESCONOCIDO" || ownerName.toLowerCase() === "no especificado") {
    return false;
  }

  // Limpiar sufijos comerciales
  const cleanName = ownerName.replace(/,?\s+llc\.?/gi, "")
                             .replace(/,?\s+inc\.?/gi, "")
                             .replace(/,?\s+corp\.?/gi, "")
                             .trim();

  if (cleanName.length < 3) return false;

  const query = `"${cleanName}" "${city}" (obituary OR divorce)`;
  
  try {
    const results = await querySearXNG(query);
    const lowerName = cleanName.toLowerCase();
    
    // Si obtenemos resultados, verificamos la coincidencia del nombre y palabras clave en snippets/título
    const keywords = ["obituary", "obituaries", "divorce", "divorcio", "falleció", "death", "died", "esquela", "difunto", "herencia", "sucesión"];
    
    for (const result of results) {
      const title = (result.title || "").toLowerCase();
      const content = (result.content || result.snippet || "").toLowerCase();
      const text = `${title} ${content}`;
      
      if (text.includes(lowerName)) {
        const hasKeyword = keywords.some(kw => text.includes(kw));
        if (hasKeyword) {
          console.log(`[LEGAL RADAR MATCH] Coincidencia encontrada para "${cleanName}" en la web!`);
          return true;
        }
      }
    }
  } catch (err: any) {
    console.error(`[LEGAL RADAR ERROR] Falló la búsqueda para ${cleanName}:`, err.message);
  }
  return false;
}

/**
 * Despacha notificaciones para oportunidades de alta rentabilidad o revisiones manuales no notificadas,
 * agrupando múltiples incidencias (claims y violaciones) bajo una misma dirección física.
 */
async function notifyOpportunities() {
  console.log("[INICIO] Buscando oportunidades y violaciones sin notificar...");
  
  // 1. Consultar subastas judiciales no notificadas
  let opportunitiesRes;
  try {
    opportunitiesRes = await db.execute(`
      SELECT 
        auction_id, case_number, address, county, state, auction_date, 
        plaintiff, defendant, debt_amount, appraisal_value, 
        mls_estimated_value, mls_id, pdf_url,
        defendant_phones, defendant_emails, needs_manual_review,
        mailing_address, absentee_owner, sqft, beds, baths, hidden_mortgages, hidden_liens_amount, stress_score, photo_urls, next_retry_date
      FROM foreclosure_auctions 
      WHERE (is_high_yield = 1 OR (state = 'IN' AND (needs_manual_review = 1 OR needs_manual_review = 2))) AND telegram_sent = 0
    `);
  } catch (dbErr: any) {
    console.error("[DB ERROR] Error al consultar subastas:", dbErr.message);
    process.exit(1);
  }
  const opportunities = opportunitiesRes.rows.filter(row => {
    const dateStr = row.auction_date as string;
    const daysRemaining = getDaysRemaining(dateStr);
    if (daysRemaining === null) {
      // Si no se puede parsear la fecha, lo mantenemos como medida de seguridad (por ejemplo, Indiana manual review)
      return true;
    }
    return daysRemaining >= 0 && daysRemaining <= 60;
  });


  // 2. Consultar violaciones de código no notificadas
  let violationsRes;
  try {
    violationsRes = await db.execute(`
      SELECT 
        violation_id, case_number, address, violation_type, report_date, status, 
        owner_name, mls_estimated_value, mls_id, defendant_phones, defendant_emails,
        mailing_address, absentee_owner, sqft, beds, baths, hidden_mortgages, hidden_liens_amount, stress_score, photo_urls
      FROM code_violations 
      WHERE is_high_yield = 1 AND telegram_sent = 0
    `);
  } catch (dbErr: any) {
    console.error("[DB ERROR] Error al consultar violaciones de código:", dbErr.message);
    process.exit(1);
  }
  const violations = violationsRes.rows;

  // 3. Consultar herencias no notificadas
  let probatesRes;
  try {
    probatesRes = await db.execute(`
      SELECT probate_id, case_number, address, county, state, deceased_name, heir_name, heir_phones, heir_emails
      FROM probates
      WHERE telegram_sent = 0
    `);
  } catch (dbErr: any) {
    console.error("[DB ERROR] Error al consultar probates:", dbErr.message);
    process.exit(1);
  }
  const probates = probatesRes.rows;

  // 4. Consultar divorcios no notificados
  let divorcesRes;
  try {
    divorcesRes = await db.execute(`
      SELECT divorce_id, case_number, address, county, state, spouse_a, spouse_b, spouse_a_phones, spouse_a_emails, spouse_b_phones, spouse_b_emails
      FROM divorces
      WHERE telegram_sent = 0
    `);
  } catch (dbErr: any) {
    console.error("[DB ERROR] Error al consultar divorces:", dbErr.message);
    process.exit(1);
  }
  const divorces = divorcesRes.rows;

  // 5. Consultar bancarrotas no notificadas
  let bankruptciesRes;
  try {
    bankruptciesRes = await db.execute(`
      SELECT bankruptcy_id, case_number, address, county, state, debtor_name, bankruptcy_type, debtor_phones, debtor_emails
      FROM bankruptcies
      WHERE telegram_sent = 0
    `);
  } catch (dbErr: any) {
    console.error("[DB ERROR] Error al consultar bankruptcies:", dbErr.message);
    process.exit(1);
  }
  const bankruptcies = bankruptciesRes.rows;

  // 6. Consultar estrés físico no notificado
  let physicalRes;
  try {
    physicalRes = await db.execute(`
      SELECT distress_id, address, county, state, distress_type, report_date, details, owner_name,
             mls_estimated_value, mls_id, defendant_phones, defendant_emails, mailing_address, absentee_owner, sqft, beds, baths, hidden_mortgages, hidden_liens_amount, stress_score, photo_urls
      FROM physical_distress
      WHERE telegram_sent = 0
    `);
  } catch (dbErr: any) {
    console.error("[DB ERROR] Error al consultar physical_distress:", dbErr.message);
    process.exit(1);
  }
  const physicalDistressList = physicalRes.rows;

  // 7. Consultar estrés financiero extra no notificado
  let financialRes;
  try {
    financialRes = await db.execute(`
      SELECT record_id, case_number, address, county, state, record_type, debt_amount, owner_name, plaintiff, report_date,
             mls_estimated_value, mls_id, defendant_phones, defendant_emails, mailing_address, absentee_owner, sqft, beds, baths, hidden_mortgages, hidden_liens_amount, stress_score, photo_urls
      FROM financial_distress
      WHERE telegram_sent = 0
    `);
  } catch (dbErr: any) {
    console.error("[DB ERROR] Error al consultar financial_distress:", dbErr.message);
    process.exit(1);
  }
  const financialDistressList = financialRes.rows;

  // 8. Consultar eventos de vida críticos no notificados
  let lifeEventsRes;
  try {
    lifeEventsRes = await db.execute(`
      SELECT event_id, event_type, subject_name, address, county, state, details, report_date,
             mls_estimated_value, mls_id, defendant_phones, defendant_emails, mailing_address, absentee_owner, sqft, beds, baths, hidden_mortgages, hidden_liens_amount, stress_score, photo_urls
      FROM life_events
      WHERE telegram_sent = 0
    `);
  } catch (dbErr: any) {
    console.error("[DB ERROR] Error al consultar life_events:", dbErr.message);
    process.exit(1);
  }
  const lifeEventsList = lifeEventsRes.rows;

  console.log(`[NOTIFICAR] Pendientes: Subastas: ${opportunities.length}, Violaciones: ${violations.length}, Herencias: ${probates.length}, Divorcios: ${divorces.length}, Quiebras: ${bankruptcies.length}, Físico: ${physicalDistressList.length}, Fin: ${financialDistressList.length}, Eventos: ${lifeEventsList.length}`);

  if (opportunities.length === 0 && violations.length === 0 && probates.length === 0 && divorces.length === 0 && bankruptcies.length === 0 && physicalDistressList.length === 0 && financialDistressList.length === 0 && lifeEventsList.length === 0) {
    console.log("[NOTIFICAR] No hay nuevas notificaciones pendientes.");
    return;
  }

  // 3. Agrupación por dirección
  const groupedMap = new Map<string, GroupedLead>();

  // A. Agrupar subastas
  for (const row of opportunities) {
    const address = row.address as string;
    const key = getGroupingKey(address);
    
    const rowPhones = (row.defendant_phones as string || "").split(/,\s*|;\s*/).map(p => p.trim()).filter(Boolean);
    const rowEmails = (row.defendant_emails as string || "").split(/,\s*|;\s*/).map(e => e.trim()).filter(Boolean);

    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        groupingKey: key,
        displayAddress: address,
        state: row.state as string || "KY",
        county: row.county as string || "Jefferson",
        ownerName: row.defendant as string || "No especificado",
        phones: new Set(rowPhones),
        emails: new Set(rowEmails),
        mlsValue: row.mls_estimated_value as number || 0,
        mlsId: row.mls_id as string || "N/A",
        auctions: [],
        violations: [],
        probates: [],
        divorces: [],
        bankruptcies: [],
        physicalDistress: [],
        financialDistress: [],
        lifeEvents: [],
        hiddenMortgages: (row.hidden_mortgages as number || 0) + (row.hidden_liens_amount as number || 0),
        mailingAddress: row.mailing_address as string || undefined,
        isAbsentee: (row.absentee_owner as number) === 1,
        sqft: row.sqft as number || undefined,
        beds: row.beds as number || undefined,
        baths: row.baths as number || undefined,
        photoUrls: [],
        nextRetryDate: row.next_retry_date as string || undefined
      });
    } else {
      const existing = groupedMap.get(key)!;
      // Actualizar si encontramos datos más completos
      if (row.mls_estimated_value && (row.mls_estimated_value as number) > existing.mlsValue) {
        existing.mlsValue = row.mls_estimated_value as number;
      }
      if (row.mls_id && row.mls_id !== "N/A") {
        existing.mlsId = row.mls_id as string;
      }
      if (existing.ownerName === "No especificado" && row.defendant) {
        existing.ownerName = row.defendant as string;
      }
      if (!existing.mailingAddress && row.mailing_address) {
        existing.mailingAddress = row.mailing_address as string;
      }
      if (!existing.nextRetryDate && row.next_retry_date) {
        existing.nextRetryDate = row.next_retry_date as string;
      }
      if ((row.absentee_owner as number) === 1) {
        existing.isAbsentee = true;
      }
      if (!existing.sqft && row.sqft) {
        existing.sqft = row.sqft as number;
      }
      if (!existing.beds && row.beds) {
        existing.beds = row.beds as number;
      }
      if (!existing.baths && row.baths) {
        existing.baths = row.baths as number;
      }
      const rowHidden = (row.hidden_mortgages as number || 0) + (row.hidden_liens_amount as number || 0);
      if (rowHidden > existing.hiddenMortgages) {
        existing.hiddenMortgages = rowHidden;
      }
      rowPhones.forEach(p => existing.phones.add(p));
      rowEmails.forEach(e => existing.emails.add(e));
      
      // Preferir la dirección más larga (con detalles como Apt/Unit #)
      if (address.length > existing.displayAddress.length) {
        existing.displayAddress = address;
      }
    }
    const lead = groupedMap.get(key)!;
    if (row.photo_urls) {
      try {
        const parsed = JSON.parse(row.photo_urls as string);
        if (Array.isArray(parsed)) {
          parsed.forEach((url: string) => {
            if (url && !lead.photoUrls.includes(url)) lead.photoUrls.push(url);
          });
        }
      } catch (e) {}
    }
    lead.auctions.push(row);
  }

  // B. Agrupar violaciones de código
  for (const row of violations) {
    const address = row.address as string;
    const key = getGroupingKey(address);

    const rowPhones = (row.defendant_phones as string || "").split(/,\s*|;\s*/).map(p => p.trim()).filter(Boolean);
    const rowEmails = (row.defendant_emails as string || "").split(/,\s*|;\s*/).map(e => e.trim()).filter(Boolean);

    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        groupingKey: key,
        displayAddress: address,
        state: "KY",
        county: "Jefferson",
        ownerName: row.owner_name as string || "DUEÑO DESCONOCIDO",
        phones: new Set(rowPhones),
        emails: new Set(rowEmails),
        mlsValue: row.mls_estimated_value as number || 0,
        mlsId: row.mls_id as string || "N/A",
        auctions: [],
        violations: [],
        probates: [],
        divorces: [],
        bankruptcies: [],
        physicalDistress: [],
        financialDistress: [],
        lifeEvents: [],
        hiddenMortgages: (row.hidden_mortgages as number || 0) + (row.hidden_liens_amount as number || 0),
        mailingAddress: row.mailing_address as string || undefined,
        isAbsentee: (row.absentee_owner as number) === 1,
        sqft: row.sqft as number || undefined,
        beds: row.beds as number || undefined,
        baths: row.baths as number || undefined,
        photoUrls: []
      });
    } else {
      const existing = groupedMap.get(key)!;
      
      // Preferir el nombre de dueño real PVA si está disponible
      if (row.owner_name && row.owner_name !== "DUEÑO DESCONOCIDO" && (existing.ownerName === "No especificado" || existing.ownerName === "DUEÑO DESCONOCIDO")) {
        existing.ownerName = row.owner_name as string;
      }
      if (row.mls_estimated_value && (row.mls_estimated_value as number) > existing.mlsValue) {
        existing.mlsValue = row.mls_estimated_value as number;
      }
      if (row.mls_id && row.mls_id !== "N/A") {
        existing.mlsId = row.mls_id as string;
      }
      if (!existing.mailingAddress && row.mailing_address) {
        existing.mailingAddress = row.mailing_address as string;
      }
      if ((row.absentee_owner as number) === 1) {
        existing.isAbsentee = true;
      }
      if (!existing.sqft && row.sqft) {
        existing.sqft = row.sqft as number;
      }
      if (!existing.beds && row.beds) {
        existing.beds = row.beds as number;
      }
      if (!existing.baths && row.baths) {
        existing.baths = row.baths as number;
      }
      const rowHidden = (row.hidden_mortgages as number || 0) + (row.hidden_liens_amount as number || 0);
      if (rowHidden > existing.hiddenMortgages) {
        existing.hiddenMortgages = rowHidden;
      }
      rowPhones.forEach(p => existing.phones.add(p));
      rowEmails.forEach(e => existing.emails.add(e));
      
      if (address.length > existing.displayAddress.length) {
        existing.displayAddress = address;
      }
    }
    const lead = groupedMap.get(key)!;
    if (row.photo_urls) {
      try {
        const parsed = JSON.parse(row.photo_urls as string);
        if (Array.isArray(parsed)) {
          parsed.forEach((url: string) => {
            if (url && !lead.photoUrls.includes(url)) lead.photoUrls.push(url);
          });
        }
      } catch (e) {}
    }
    lead.violations.push(row);
  }

  // C. Agrupar herencias (probates)
  for (const row of probates) {
    const address = row.address as string;
    const key = getGroupingKey(address);
    
    const rowPhones = (row.heir_phones as string || "").split(/,\s*|;\s*/).map(p => p.trim()).filter(Boolean);
    const rowEmails = (row.heir_emails as string || "").split(/,\s*|;\s*/).map(e => e.trim()).filter(Boolean);

    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        groupingKey: key,
        displayAddress: address,
        state: row.state as string || "KY",
        county: row.county as string || "Jefferson",
        ownerName: row.heir_name as string || "Heredero Desconocido",
        phones: new Set(rowPhones),
        emails: new Set(rowEmails),
        mlsValue: 0,
        mlsId: "N/A",
        auctions: [],
        violations: [],
        probates: [],
        divorces: [],
        bankruptcies: [],
        physicalDistress: [],
        financialDistress: [],
        lifeEvents: [],
        hiddenMortgages: 0,
        isAbsentee: false,
        photoUrls: []
      });
    } else {
      const existing = groupedMap.get(key)!;
      if (existing.ownerName === "No especificado" || existing.ownerName === "DUEÑO DESCONOCIDO") {
        existing.ownerName = row.heir_name as string || existing.ownerName;
      }
      rowPhones.forEach(p => existing.phones.add(p));
      rowEmails.forEach(e => existing.emails.add(e));
    }
    groupedMap.get(key)!.probates.push(row);
  }

  // D. Agrupar divorcios (divorces)
  for (const row of divorces) {
    const address = row.address as string;
    const key = getGroupingKey(address);
    
    const rowPhones = [
      ...(row.spouse_a_phones as string || "").split(/,\s*|;\s*/),
      ...(row.spouse_b_phones as string || "").split(/,\s*|;\s*/)
    ].map(p => p.trim()).filter(Boolean);
    const rowEmails = [
      ...(row.spouse_a_emails as string || "").split(/,\s*|;\s*/),
      ...(row.spouse_b_emails as string || "").split(/,\s*|;\s*/)
    ].map(e => e.trim()).filter(Boolean);

    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        groupingKey: key,
        displayAddress: address,
        state: row.state as string || "KY",
        county: row.county as string || "Jefferson",
        ownerName: `${row.spouse_a} & ${row.spouse_b}`,
        phones: new Set(rowPhones),
        emails: new Set(rowEmails),
        mlsValue: 0,
        mlsId: "N/A",
        auctions: [],
        violations: [],
        probates: [],
        divorces: [],
        bankruptcies: [],
        physicalDistress: [],
        financialDistress: [],
        lifeEvents: [],
        hiddenMortgages: 0,
        isAbsentee: false,
        photoUrls: []
      });
    } else {
      const existing = groupedMap.get(key)!;
      rowPhones.forEach(p => existing.phones.add(p));
      rowEmails.forEach(e => existing.emails.add(e));
    }
    groupedMap.get(key)!.divorces.push(row);
  }

  // E. Agrupar bancarrotas (bankruptcies)
  for (const row of bankruptcies) {
    const address = row.address as string;
    const key = getGroupingKey(address);
    
    const rowPhones = (row.debtor_phones as string || "").split(/,\s*|;\s*/).map(p => p.trim()).filter(Boolean);
    const rowEmails = (row.debtor_emails as string || "").split(/,\s*|;\s*/).map(e => e.trim()).filter(Boolean);

    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        groupingKey: key,
        displayAddress: address,
        state: row.state as string || "KY",
        county: row.county as string || "Jefferson",
        ownerName: row.debtor_name as string || "Deudor Desconocido",
        phones: new Set(rowPhones),
        emails: new Set(rowEmails),
        mlsValue: 0,
        mlsId: "N/A",
        auctions: [],
        violations: [],
        probates: [],
        divorces: [],
        bankruptcies: [],
        physicalDistress: [],
        financialDistress: [],
        lifeEvents: [],
        hiddenMortgages: 0,
        isAbsentee: false,
        photoUrls: []
      });
    } else {
      const existing = groupedMap.get(key)!;
      if (existing.ownerName === "No especificado" || existing.ownerName === "DUEÑO DESCONOCIDO") {
        existing.ownerName = row.debtor_name as string || existing.ownerName;
      }
      rowPhones.forEach(p => existing.phones.add(p));
      rowEmails.forEach(e => existing.emails.add(e));
    }
    groupedMap.get(key)!.bankruptcies.push(row);
  }

  // F. Agrupar estrés físico (physical_distress)
  for (const row of physicalDistressList) {
    const address = row.address as string;
    const key = getGroupingKey(address);

    const rowPhones = (row.defendant_phones as string || "").split(/,\s*|;\s*/).map(p => p.trim()).filter(Boolean);
    const rowEmails = (row.defendant_emails as string || "").split(/,\s*|;\s*/).map(e => e.trim()).filter(Boolean);

    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        groupingKey: key,
        displayAddress: address,
        state: row.state as string || "KY",
        county: row.county as string || "Jefferson",
        ownerName: row.owner_name as string || "DUEÑO DESCONOCIDO",
        phones: new Set(rowPhones),
        emails: new Set(rowEmails),
        mlsValue: row.mls_estimated_value as number || 0,
        mlsId: row.mls_id as string || "N/A",
        auctions: [],
        violations: [],
        probates: [],
        divorces: [],
        bankruptcies: [],
        physicalDistress: [],
        financialDistress: [],
        lifeEvents: [],
        hiddenMortgages: (row.hidden_mortgages as number || 0) + (row.hidden_liens_amount as number || 0),
        mailingAddress: row.mailing_address as string || undefined,
        isAbsentee: (row.absentee_owner as number) === 1,
        sqft: row.sqft as number || undefined,
        beds: row.beds as number || undefined,
        baths: row.baths as number || undefined,
        photoUrls: []
      });
    } else {
      const existing = groupedMap.get(key)!;
      if (row.owner_name && row.owner_name !== "DUEÑO DESCONOCIDO" && (existing.ownerName === "No especificado" || existing.ownerName === "DUEÑO DESCONOCIDO")) {
        existing.ownerName = row.owner_name as string;
      }
      if (row.mls_estimated_value && (row.mls_estimated_value as number) > existing.mlsValue) {
        existing.mlsValue = row.mls_estimated_value as number;
      }
      if (row.mls_id && row.mls_id !== "N/A") {
        existing.mlsId = row.mls_id as string;
      }
      if (!existing.mailingAddress && row.mailing_address) {
        existing.mailingAddress = row.mailing_address as string;
      }
      if ((row.absentee_owner as number) === 1) {
        existing.isAbsentee = true;
      }
      if (!existing.sqft && row.sqft) {
        existing.sqft = row.sqft as number;
      }
      if (!existing.beds && row.beds) {
        existing.beds = row.beds as number;
      }
      if (!existing.baths && row.baths) {
        existing.baths = row.baths as number;
      }
      const rowHidden = (row.hidden_mortgages as number || 0) + (row.hidden_liens_amount as number || 0);
      if (rowHidden > existing.hiddenMortgages) {
        existing.hiddenMortgages = rowHidden;
      }
      rowPhones.forEach(p => existing.phones.add(p));
      rowEmails.forEach(e => existing.emails.add(e));
      if (address.length > existing.displayAddress.length) {
        existing.displayAddress = address;
      }
    }
    const lead = groupedMap.get(key)!;
    if (row.photo_urls) {
      try {
        const parsed = JSON.parse(row.photo_urls as string);
        if (Array.isArray(parsed)) {
          parsed.forEach((url: string) => {
            if (url && !lead.photoUrls.includes(url)) lead.photoUrls.push(url);
          });
        }
      } catch (e) {}
    }
    lead.physicalDistress.push(row);
  }

  // G. Agrupar estrés financiero extra (financial_distress)
  for (const row of financialDistressList) {
    const address = row.address as string;
    const key = getGroupingKey(address);

    const rowPhones = (row.defendant_phones as string || "").split(/,\s*|;\s*/).map(p => p.trim()).filter(Boolean);
    const rowEmails = (row.defendant_emails as string || "").split(/,\s*|;\s*/).map(e => e.trim()).filter(Boolean);

    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        groupingKey: key,
        displayAddress: address,
        state: row.state as string || "KY",
        county: row.county as string || "Jefferson",
        ownerName: row.owner_name as string || "DUEÑO DESCONOCIDO",
        phones: new Set(rowPhones),
        emails: new Set(rowEmails),
        mlsValue: row.mls_estimated_value as number || 0,
        mlsId: row.mls_id as string || "N/A",
        auctions: [],
        violations: [],
        probates: [],
        divorces: [],
        bankruptcies: [],
        physicalDistress: [],
        financialDistress: [],
        lifeEvents: [],
        hiddenMortgages: (row.hidden_mortgages as number || 0) + (row.hidden_liens_amount as number || 0),
        mailingAddress: row.mailing_address as string || undefined,
        isAbsentee: (row.absentee_owner as number) === 1,
        sqft: row.sqft as number || undefined,
        beds: row.beds as number || undefined,
        baths: row.baths as number || undefined,
        photoUrls: []
      });
    } else {
      const existing = groupedMap.get(key)!;
      if (row.owner_name && row.owner_name !== "DUEÑO DESCONOCIDO" && (existing.ownerName === "No especificado" || existing.ownerName === "DUEÑO DESCONOCIDO")) {
        existing.ownerName = row.owner_name as string;
      }
      if (row.mls_estimated_value && (row.mls_estimated_value as number) > existing.mlsValue) {
        existing.mlsValue = row.mls_estimated_value as number;
      }
      if (row.mls_id && row.mls_id !== "N/A") {
        existing.mlsId = row.mls_id as string;
      }
      if (!existing.mailingAddress && row.mailing_address) {
        existing.mailingAddress = row.mailing_address as string;
      }
      if ((row.absentee_owner as number) === 1) {
        existing.isAbsentee = true;
      }
      if (!existing.sqft && row.sqft) {
        existing.sqft = row.sqft as number;
      }
      if (!existing.beds && row.beds) {
        existing.beds = row.beds as number;
      }
      if (!existing.baths && row.baths) {
        existing.baths = row.baths as number;
      }
      const rowHidden = (row.hidden_mortgages as number || 0) + (row.hidden_liens_amount as number || 0);
      if (rowHidden > existing.hiddenMortgages) {
        existing.hiddenMortgages = rowHidden;
      }
      rowPhones.forEach(p => existing.phones.add(p));
      rowEmails.forEach(e => existing.emails.add(e));
      if (address.length > existing.displayAddress.length) {
        existing.displayAddress = address;
      }
    }
    const lead = groupedMap.get(key)!;
    if (row.photo_urls) {
      try {
        const parsed = JSON.parse(row.photo_urls as string);
        if (Array.isArray(parsed)) {
          parsed.forEach((url: string) => {
            if (url && !lead.photoUrls.includes(url)) lead.photoUrls.push(url);
          });
        }
      } catch (e) {}
    }
    lead.financialDistress.push(row);
  }

  // H. Agrupar eventos de vida críticos (life_events)
  for (const row of lifeEventsList) {
    const address = row.address as string;
    const key = getGroupingKey(address);

    const rowPhones = (row.defendant_phones as string || "").split(/,\s*|;\s*/).map(p => p.trim()).filter(Boolean);
    const rowEmails = (row.defendant_emails as string || "").split(/,\s*|;\s*/).map(e => e.trim()).filter(Boolean);

    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        groupingKey: key,
        displayAddress: address,
        state: row.state as string || "KY",
        county: row.county as string || "Jefferson",
        ownerName: row.subject_name as string || "No especificado",
        phones: new Set(rowPhones),
        emails: new Set(rowEmails),
        mlsValue: row.mls_estimated_value as number || 0,
        mlsId: row.mls_id as string || "N/A",
        auctions: [],
        violations: [],
        probates: [],
        divorces: [],
        bankruptcies: [],
        physicalDistress: [],
        financialDistress: [],
        lifeEvents: [],
        hiddenMortgages: (row.hidden_mortgages as number || 0) + (row.hidden_liens_amount as number || 0),
        mailingAddress: row.mailing_address as string || undefined,
        isAbsentee: (row.absentee_owner as number) === 1,
        sqft: row.sqft as number || undefined,
        beds: row.beds as number || undefined,
        baths: row.baths as number || undefined,
        photoUrls: []
      });
    } else {
      const existing = groupedMap.get(key)!;
      if (row.subject_name && row.subject_name !== "No especificado" && (existing.ownerName === "No especificado" || existing.ownerName === "DUEÑO DESCONOCIDO")) {
        existing.ownerName = row.subject_name as string;
      }
      if (row.mls_estimated_value && (row.mls_estimated_value as number) > existing.mlsValue) {
        existing.mlsValue = row.mls_estimated_value as number;
      }
      if (row.mls_id && row.mls_id !== "N/A") {
        existing.mlsId = row.mls_id as string;
      }
      if (!existing.mailingAddress && row.mailing_address) {
        existing.mailingAddress = row.mailing_address as string;
      }
      if ((row.absentee_owner as number) === 1) {
        existing.isAbsentee = true;
      }
      if (!existing.sqft && row.sqft) {
        existing.sqft = row.sqft as number;
      }
      if (!existing.beds && row.beds) {
        existing.beds = row.beds as number;
      }
      if (!existing.baths && row.baths) {
        existing.baths = row.baths as number;
      }
      const rowHidden = (row.hidden_mortgages as number || 0) + (row.hidden_liens_amount as number || 0);
      if (rowHidden > existing.hiddenMortgages) {
        existing.hiddenMortgages = rowHidden;
      }
      rowPhones.forEach(p => existing.phones.add(p));
      rowEmails.forEach(e => existing.emails.add(e));
      if (address.length > existing.displayAddress.length) {
        existing.displayAddress = address;
      }
    }
    const lead = groupedMap.get(key)!;
    if (row.photo_urls) {
      try {
        const parsed = JSON.parse(row.photo_urls as string);
        if (Array.isArray(parsed)) {
          parsed.forEach((url: string) => {
            if (url && !lead.photoUrls.includes(url)) lead.photoUrls.push(url);
          });
        }
      } catch (e) {}
    }
    lead.lifeEvents.push(row);
  }

  // Post-procesar para calcular el stressScore más alto de los items asociados
  for (const lead of groupedMap.values()) {
    let maxScore = 0;
    lead.auctions.forEach(a => { if (a.stress_score && a.stress_score > maxScore) maxScore = a.stress_score; });
    lead.violations.forEach(v => { if (v.stress_score && v.stress_score > maxScore) maxScore = v.stress_score; });
    lead.physicalDistress.forEach(pd => { if (pd.stress_score && pd.stress_score > maxScore) maxScore = pd.stress_score; });
    lead.financialDistress.forEach(fd => { if (fd.stress_score && fd.stress_score > maxScore) maxScore = fd.stress_score; });
    lead.lifeEvents.forEach(le => { if (le.stress_score && le.stress_score > maxScore) maxScore = le.stress_score; });
    lead.stressScore = maxScore;
  }

  console.log(`[NOTIFICAR] Direcciones agrupadas únicas a notificar: ${groupedMap.size}`);

  let notifiedAuctionsCount = 0;
  let notifiedViolationsCount = 0;
  let notifiedPhysicalCount = 0;
  let notifiedFinancialCount = 0;
  let notifiedLifeCount = 0;

  // 4. Construir y enviar notificaciones
  for (const lead of groupedMap.values()) {
    const hasAuctions = lead.auctions.length > 0;
    const hasViolations = lead.violations.length > 0;
    let isIndianaManual = lead.state === "IN" && lead.auctions.some(a => a.needs_manual_review === 1);
    let isIndianaHibernated = lead.state === "IN" && lead.auctions.some(a => a.needs_manual_review === 2);
    
    const firstAuction = lead.auctions[0];
    const daysRemaining = firstAuction ? getDaysRemaining(firstAuction.auction_date as string) : null;
    const nextRetryDate = lead.nextRetryDate || (firstAuction ? (firstAuction.next_retry_date as string) : null) || "N/A";

    // --- CÁLCULOS FINANCIEROS (UNDERWRITING) ---
    const violationKeywords = lead.violations.map(v => v.violation_type as string);
    const rehab = calculateRehab(lead.sqft || null, violationKeywords);
    const hiddenDebt = lead.hiddenMortgages || 0;
    
    // MAO restando deudas ocultas
    const mao = calculateMAO(lead.mlsValue, rehab, hiddenDebt);
    
    const primaryDebt = lead.auctions.length > 0 ? (lead.auctions[0].debt_amount as number || 0) : 0;
    const netEquity = calculateNetEquity(lead.mlsValue, primaryDebt, hiddenDebt);
    
    // Para el cálculo de ROI de violaciones (sin deudas judiciales), compramos al valor de la oferta máxima (MAO)
    const purchasePrice = primaryDebt > 0 ? primaryDebt : mao;
    const { roi, totalCost } = calculateROI(lead.mlsValue, purchasePrice, rehab);

    const plaintiff = lead.auctions.length > 0 ? lead.auctions[0].plaintiff : null;
    const caseNumber = lead.auctions.length > 0 ? lead.auctions[0].case_number : null;
    const riskCheck = checkCriticalRisk(lead.mlsValue, primaryDebt, hiddenDebt, plaintiff, caseNumber);

    const city = extractCity(lead.displayAddress, lead.county, lead.state);
    const hasLegalRadarMatch = await searchLegalRadar(lead.ownerName, city);

    let isHighMotivation = false;
    if (hasAuctions) {
      const firstAuction = lead.auctions[0];
      const daysRemaining = getDaysRemaining(firstAuction.auction_date);
      if (daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 60) {
        if (hasViolations || primaryDebt > 0 || hiddenDebt > 0) {
          isHighMotivation = true;
        }
      }
    }

    let painBanners: string[] = [];
    let isPrimaryObjective = false;
    
    // CATEGORÍA 1: ZONA DE EJECUCIÓN (Prioridad Máxima)
    if (lead.auctions.length > 0) {
      const hasScheduled = lead.auctions.some(auc => getDaysRemaining(auc.auction_date) !== null);
      if (hasScheduled) {
        painBanners.push(`🛑 *ZONA DE EJECUCIÓN: SUBASTA PROGRAMADA* 🚨`);
      } else {
        painBanners.push(`🛑 *ZONA DE EJECUCIÓN: DETECCIÓN PRE-SUBASTA* ⏳`);
      }
      isPrimaryObjective = true;
    }
    
    // CATEGORÍA 2: ESTRÉS FÍSICO
    if (lead.physicalDistress.length > 0) {
      painBanners.push(`🔥 *ESTRÉS FÍSICO: CASA QUEMADA / CONDENADA*`);
    }
    
    // CATEGORÍA 3: OTROS ESTRESORES (Estrés Acumulado)
    const hasFinancialDistress = lead.financialDistress.length > 0 || lead.bankruptcies.length > 0;
    const hasLifeEventDistress = lead.lifeEvents.length > 0 || lead.probates.length > 0 || lead.divorces.length > 0 || lead.violations.length > 0;
    if (hasFinancialDistress || hasLifeEventDistress) {
      let details: string[] = [];
      if (lead.financialDistress.some(d => d.record_type === "Eviction")) details.push("DESALOJO EN CURSO");
      if (lead.financialDistress.some(d => d.record_type && d.record_type !== "Eviction")) details.push("TAX LIEN/SENTENCIA");
      if (lead.lifeEvents.length > 0) details.push("ARRESTO/OBITUARIO");
      if (lead.probates.length > 0) details.push("SUCESIÓN");
      if (lead.divorces.length > 0) details.push("DIVORCIO");
      if (lead.violations.length > 0) details.push("VIOLACIÓN DE CÓDIGO");
      
      const detailsStr = details.length > 0 ? ` (${details.join(" / ")})` : "";
      painBanners.push(`⚠️ *OTROS ESTRESORES: ESTRÉS ACUMULADO${detailsStr}*`);
    }

    let msg = "";
    if (isPrimaryObjective) {
      msg += `🎯 *[OBJETIVO PRINCIPAL DEL DÍA]* 🎯\n`;
    }
    if (painBanners.length > 0) {
      msg += painBanners.join("\n") + "\n\n";
    }
    if (isHighMotivation) {
      msg += `🔥 *ALTA MOTIVACIÓN* 🔥\n\n`;
    }

    if (hiddenDebt > 0) {
      msg += `🏦 *HIPOTECAS OCULTAS DETECTADAS* 🏦\n`;
      msg += `_Se detectaron deudas o gravámenes secundarios adicionales por $${hiddenDebt.toLocaleString("en-US", { minimumFractionDigits: 2 })}_\n\n`;
    }

    const hasProbates = lead.probates && lead.probates.length > 0;
    const hasDivorces = lead.divorces && lead.divorces.length > 0;
    const hasBankruptcies = lead.bankruptcies && lead.bankruptcies.length > 0;

    if (isUnderwater(lead.mlsValue, primaryDebt, hiddenDebt)) {
      msg += `⚠️ *ALERTA CRÍTICA: PROPIEDAD BAJO EL AGUA* ⚠️\n`;
      msg += `_La deuda total acumulada supera el valor estimado de mercado (ARV)_\n\n`;
    } else if ((hasAuctions && hasViolations) || [hasAuctions, hasViolations, hasProbates, hasDivorces, hasBankruptcies].filter(Boolean).length >= 2) {
      msg += `🚨 *ALERTA DE OPORTUNIDAD: ESTRÉS MULTIDIMENSIONAL* 🚨\n`;
      msg += `_Propiedad con acumulación de múltiples factores de estrés legal o físico_\n\n`;
    } else if (hasAuctions) {
      if (isIndianaHibernated) {
        msg += `🤖 *SINCERIDAD DEL SISTEMA: BÚSQUEDA PAUSADA* 🤖\n`;
        msg += `La búsqueda gratuita falló. Como la subasta es en ${daysRemaining} días (entre 30 y 60), he pausado el proceso para no gastar saldo de API. Hay un 75% de probabilidad de que la corte publique los datos pronto. Volveré a buscar automáticamente el ${nextRetryDate}.\n\n`;
      } else if (isIndianaManual) {
        msg += `⚠️ *REVISIÓN MANUAL REQUERIDA (INDIANA)* ⚠️\n`;
        msg += `_El crawler no pudo extraer automáticamente la deuda de este expediente._\n\n`;
      } else {
        msg += `🚨 *OPORTUNIDAD DE ADQUISICIÓN PRE-SUBASTA* 🚨\n`;
        msg += `_Propiedad identificada con margen de ganancia >= 30% del valor comercial MLS_\n\n`;
      }
    } else if (hasViolations) {
      msg += `🚨 *OPORTUNIDAD PRE-PÚBLICA: VIOLACIÓN DE CÓDIGO* 🚨\n`;
      msg += `_Propiedad con infracción física detectada y valorada mediante Spark MLS_\n\n`;
    } else if (hasProbates) {
      msg += `🚨 *ALERTA DE OPORTUNIDAD: SUCESIÓN / HERENCIA* 🚨\n`;
      msg += `_Propiedad en proceso de sucesión (Probate) sin notificar_\n\n`;
    } else if (hasDivorces) {
      msg += `🚨 *ALERTA DE OPORTUNIDAD: DIVORCIO EN CURSO* 🚨\n`;
      msg += `_Propiedad asociada a un expediente de divorcio activo_\n\n`;
    } else {
      msg += `🚨 *ALERTA DE OPORTUNIDAD: QUIEBRA / BANCARROTA* 🚨\n`;
      msg += `_Propiedad vinculada a un expediente de quiebra activo_\n\n`;
    }

    if (hasLegalRadarMatch) {
      msg += `🔎 *INVESTIGACIÓN WEB:* Posible Obituario/Divorcio\n\n`;
    }

    // Datos generales de la propiedad
    msg += `📍 *Dirección:* ${lead.displayAddress}\n`;
    msg += `🏢 *Ubicación:* ${lead.county} County, ${lead.state}\n`;
    if (lead.stressScore !== undefined && lead.stressScore > 0) {
      msg += `⚡ *Índice de Estrés (SSI):* ${lead.stressScore}/100\n`;
    }
    msg += `\n`;

    // Alerta de hipotecas ocultas
    if (hiddenDebt > 0) {
      msg += `🏦 *HIPOTECAS OCULTAS DETECTADAS:* $${hiddenDebt.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n\n`;
    }

    // Datos de contacto del dueño
    const absenteeStatus = lead.isAbsentee ? "*(Dueño Ausente)*" : "*(Dueño Ocupante)*";
    msg += `👤 *Propietario / Demandado:* ${lead.ownerName} ${absenteeStatus}\n`;
    if (lead.mailingAddress) {
      msg += `✉️ *Dirección Postal:* ${lead.mailingAddress}\n`;
    }

    // Filtrar contactos regulares vs OSINT
    const regularPhones: string[] = [];
    const osintPhones: string[] = [];
    for (const phone of lead.phones) {
      const lower = phone.toLowerCase();
      if (lower.startsWith("osint:")) {
        osintPhones.push(phone.substring(6).trim());
      } else {
        regularPhones.push(phone);
      }
    }

    const regularEmails: string[] = [];
    const osintLinks: string[] = [];
    const osintEmails: string[] = [];
    for (const emailOrLink of lead.emails) {
      const lower = emailOrLink.toLowerCase();
      if (lower.startsWith("osint link:")) {
        osintLinks.push(emailOrLink.substring(11).trim());
      } else if (lower.startsWith("osint:")) {
        osintEmails.push(emailOrLink.substring(6).trim());
      } else if (lower.startsWith("osint")) {
        // Ignorar posibles splits erróneos
      } else {
        regularEmails.push(emailOrLink);
      }
    }

    if (regularPhones.length > 0) {
      msg += `📞 *Teléfonos:* \`${regularPhones.join(", ")}\`\n`;
    }
    if (regularEmails.length > 0) {
      msg += `✉️ *Correos:* \`${regularEmails.join(", ")}\`\n`;
    }

    if (osintPhones.length > 0 || osintLinks.length > 0 || osintEmails.length > 0) {
      msg += `\n📞 *Contactos (OSINT / Scraping Gratuito):*\n`;
      if (osintPhones.length > 0) {
        msg += `  - Teléfonos: \`${osintPhones.join(", ")}\`\n`;
      }
      if (osintEmails.length > 0) {
        msg += `  - Correos: \`${osintEmails.join(", ")}\`\n`;
      }
      if (osintLinks.length > 0) {
        msg += `  - Enlaces públicos:\n`;
        for (const link of osintLinks) {
          msg += `    • ${link}\n`;
        }
      }
    }
    msg += `\n`;

    // Datos del MLS (ARV) y Características
    if (lead.mlsValue > 0) {
      msg += `📊 *Valor Comercial ARV (MLS):* $${lead.mlsValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n`;
    }
    if (lead.sqft && lead.sqft > 0) {
      const bedsStr = lead.beds ? `, ${lead.beds} Rec` : "";
      const bathsStr = lead.baths ? `, ${lead.baths} Baños` : "";
      msg += `📐 *Características:* ${lead.sqft.toLocaleString()} SqFt${bedsStr}${bathsStr}\n`;
    }
    if (lead.mlsId && lead.mlsId !== "N/A") {
      msg += `🔗 *MLS ID:* [${lead.mlsId}](https://replication.sparkapi.com/Reso/OData/Property('${lead.mlsId}'))\n`;
    }

    // --- SECCIÓN DE UNDERWRITING ---
    msg += `\n📊 *ANÁLISIS FINANCIERO (UNDERWRITING)*:\n`;
    msg += `• *Costo de Rehab:* $${rehab.toLocaleString()} (Estimación automática)\n`;
    msg += `• *Oferta Máxima Permitida (MAO):* $${mao.toLocaleString()}\n`;
    msg += `• *Equity Neto:* $${netEquity.toLocaleString()}\n`;
    if (lead.mlsValue > 0 && purchasePrice > 0) {
      msg += `• *ROI Proyectado:* ${roi}% (Costo total proyecto: $${totalCost.toLocaleString()})\n`;
    } else {
      msg += `• *ROI Proyectado:* N/A (Faltan comps de mercado)\n`;
    }
    
    if (riskCheck.isRisk) {
      msg += `⚠️ *FACTORES DE RIESGO DETECTADOS:*\n`;
      for (const reason of riskCheck.reasons) {
        msg += `  - ${reason}\n`;
      }
    }

    // Detalles de Subasta (si existen)
    if (hasAuctions) {
      msg += `\n---\n`;
      msg += `⚖️ *PROCESOS JUDICIALES (FORECLOSURE)*:\n`;
      for (const a of lead.auctions) {
        const debtAmount = a.debt_amount as number || 0;
        const auctionDate = a.auction_date as string;
        const daysRemaining = getDaysRemaining(auctionDate);
        const daysStr = daysRemaining !== null 
          ? (daysRemaining < 0 ? `Hace ${Math.abs(daysRemaining)} días (Pasada)` : `${daysRemaining} días`)
          : "Fecha indefinida";
        
        msg += `• *Caso ${a.case_number}*:\n`;
        if (debtAmount > 0) {
          msg += `  - Deuda: $${debtAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n`;
          if (lead.mlsValue > 0) {
            const discountPct = ((lead.mlsValue - debtAmount) / lead.mlsValue) * 100;
            msg += `  - Descuento Potencial: *${discountPct.toFixed(1)}%*\n`;
          }
        }
        msg += `  - Subasta: ${auctionDate} *(${daysStr} restantes)*\n`;
        if (a.plaintiff) {
          msg += `  - Acreedor: ${a.plaintiff}\n`;
        }
        
        if (a.pdf_url) {
          const pdfSection = await checkPdfUrl(a.pdf_url);
          msg += `  - ${pdfSection}\n`;
        }
        
        if (a.needs_manual_review === 1 && lead.state === "IN") {
          msg += `  - 🔗 [Abrir buscador MyCase](https://public.courts.in.gov/mycase/)\n`;
        }
      }
    }

    // Detalles de Violaciones de Código (si existen)
    if (hasViolations) {
      msg += `\n---\n`;
      msg += `⚠️ *VIOLACIONES DE CÓDIGO (ESTRÉS FÍSICO)*:\n`;
      for (const v of lead.violations) {
        const reportDate = v.report_date || "No especificada";
        const status = v.status || "No especificado";
        msg += `• *Caso ${v.case_number}* (Reportado: ${reportDate}):\n`;
        msg += `  - Tipo: _${v.violation_type}_\n`;
        msg += `  - Estatus: _${status}_\n`;
      }
    }

    // Detalles de Estrés Físico (si existen)
    if (lead.physicalDistress.length > 0) {
      msg += `\n---\n`;
      msg += `🔥 *ESTRÉS FÍSICO / ABANDONO MUNICIPAL*:\n`;
      for (const pd of lead.physicalDistress) {
        const reportDate = pd.report_date || "No especificada";
        msg += `• *Tipo: ${pd.distress_type}* (Reportado: ${reportDate}):\n`;
        if (pd.details) msg += `  - Detalles: _${pd.details}_\n`;
      }
    }

    // Detalles de Estrés Financiero Extra (si existen)
    if (lead.financialDistress.length > 0) {
      msg += `\n---\n`;
      msg += `⚖️ *ESTRÉS FINANCIERO (CLERK / COURTS)*:\n`;
      for (const fd of lead.financialDistress) {
        const reportDate = fd.report_date || "No especificada";
        const debt = fd.debt_amount as number || 0;
        msg += `• *Caso/Registro:* ${fd.case_number || "N/A"} (Tipo: ${fd.record_type}, Reportado: ${reportDate}):\n`;
        if (debt > 0) msg += `  - Monto de Deuda: $${debt.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n`;
        if (fd.plaintiff) msg += `  - Acreedor/Demandante: ${fd.plaintiff}\n`;
      }
    }

    // Detalles de Eventos de Vida Críticos (si existen)
    if (lead.lifeEvents.length > 0) {
      msg += `\n---\n`;
      msg += `💔 *EVENTOS DE VIDA CRÍTICOS*:\n`;
      for (const le of lead.lifeEvents) {
        const reportDate = le.report_date || "No especificada";
        msg += `• *Tipo: ${le.event_type}* (Fecha: ${reportDate}):\n`;
        if (le.subject_name) msg += `  - Sujeto: ${le.subject_name}\n`;
        if (le.details) msg += `  - Detalles: _${le.details}_\n`;
      }
    }

    // Detalles de Herencias (si existen)
    if (hasProbates) {
      msg += `\n---\n`;
      msg += `📋 *HERENCIAS / SUCESIONES (PROBATE)*:\n`;
      for (const p of lead.probates) {
        msg += `• *Caso ${p.case_number}*:\n`;
        if (p.deceased_name) msg += `  - Finado: ${p.deceased_name}\n`;
        if (p.heir_name) msg += `  - Heredero: ${p.heir_name}\n`;
      }
    }

    // Detalles de Divorcios (si existen)
    if (hasDivorces) {
      msg += `\n---\n`;
      msg += `💔 *DIVORCIOS (DIVORCES)*:\n`;
      for (const d of lead.divorces) {
        msg += `• *Caso ${d.case_number}*:\n`;
        msg += `  - Cónyuges: ${d.spouse_a} & ${d.spouse_b}\n`;
      }
    }

    // Detalles de Bancarrotas (si existen)
    if (hasBankruptcies) {
      msg += `\n---\n`;
      msg += `📉 *QUIEBRAS (BANKRUPTCIES)*:\n`;
      for (const b of lead.bankruptcies) {
        msg += `• *Caso ${b.case_number}*:\n`;
        msg += `  - Deudor: ${b.debtor_name}\n`;
        if (b.bankruptcy_type) msg += `  - Tipo: ${b.bankruptcy_type}\n`;
      }
    }

    msg += `\n---\n`;

    // Instrucción / Recomendación Final
    if (hasAuctions && hasViolations) {
      msg += `💡 *Estrategia Recomendada:* Contactar al propietario/deudor de inmediato para negociar una compra directa debido a la acumulación de múltiples factores de estrés (deuda judicial y abandono físico).`;
    } else if (hasAuctions) {
      if (isIndianaHibernated) {
        msg += `💡 *Instrucciones:* Esta subasta está en lista de espera (hibernación). Se volverá a buscar automáticamente en la fecha indicada. Si es urgente, puedes buscar el caso manualmente en MyCase.`;
      } else if (isIndianaManual) {
        msg += `💡 *Instrucciones:* Busca por el nombre del demandado en MyCase para el condado correspondiente de Indiana y extrae el monto de la deuda para actualizar Turso.`;
      } else {
        const firstAuction = lead.auctions[0];
        msg += `💡 *Estrategia Recomendada:* Contactar al deudor de inmediato para negociar una compra directa antes de la subasta el ${firstAuction.auction_date}.`;
      }
    } else if (hasViolations) {
      msg += `💡 *Estrategia Recomendada:* Contactar al propietario de inmediato para negociar una compra directa debido a estrés físico por violación de código.`;
    } else {
      msg += `💡 *Estrategia Recomendada:* Contactar a las partes involucradas para proponer compra directa / solución legal ante estrés de propiedad.`;
    }

    // --- BOTONERA INTERACTIVA DE TELEGRAM ---
    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lead.displayAddress)}`;
    const pvaUrl = getPvaUrl(lead.county, lead.state);
    
    const replyMarkup = {
      inline_keyboard: [
        [
          { text: "📍 Google Maps (Street View)", url: googleMapsUrl },
          { text: "🏢 Consultar Catastro PVA", url: pvaUrl }
        ]
      ]
    };

    console.log(`[ALERTANDO] Enviando alerta agrupada para: ${lead.displayAddress} (Subastas: ${lead.auctions.length}, Violaciones: ${lead.violations.length}, Herencias: ${lead.probates.length}, Divorcios: ${lead.divorces.length}, Quiebras: ${lead.bankruptcies.length})...`);
    
    const success = await sendTelegramNotification(msg, replyMarkup, lead.photoUrls && lead.photoUrls.length > 0 ? lead.photoUrls[0] : null);

    
    if (success) {
      // Marcar subastas asociadas como notificadas
      for (const a of lead.auctions) {
        try {
          await db.execute({
            sql: "UPDATE foreclosure_auctions SET telegram_sent = 1 WHERE auction_id = ?",
            args: [a.auction_id]
          });
          notifiedAuctionsCount++;
        } catch (dbErr: any) {
          console.error(`[DB ERROR] No se pudo marcar como notificada la subasta ${a.auction_id}:`, dbErr.message);
        }
      }
      
      // Marcar violaciones asociadas como notificadas
      for (const v of lead.violations) {
        try {
          await db.execute({
            sql: "UPDATE code_violations SET telegram_sent = 1 WHERE violation_id = ?",
            args: [v.violation_id]
          });
          notifiedViolationsCount++;
        } catch (dbErr: any) {
          console.error(`[DB ERROR] No se pudo marcar como notificada la violación ${v.violation_id}:`, dbErr.message);
        }
      }

      // Marcar herencias asociadas como notificadas
      for (const p of lead.probates) {
        try {
          await db.execute({
            sql: "UPDATE probates SET telegram_sent = 1 WHERE probate_id = ?",
            args: [p.probate_id]
          });
        } catch (dbErr: any) {
          console.error(`[DB ERROR] No se pudo marcar como notificado el probate ${p.probate_id}:`, dbErr.message);
        }
      }

      // Marcar divorcios asociados como notificados
      for (const d of lead.divorces) {
        try {
          await db.execute({
            sql: "UPDATE divorces SET telegram_sent = 1 WHERE divorce_id = ?",
            args: [d.divorce_id]
          });
        } catch (dbErr: any) {
          console.error(`[DB ERROR] No se pudo marcar como notificado el divorce ${d.divorce_id}:`, dbErr.message);
        }
      }

      // Marcar bankruptcies asociados como notificados
      for (const b of lead.bankruptcies) {
        try {
          await db.execute({
            sql: "UPDATE bankruptcies SET telegram_sent = 1 WHERE bankruptcy_id = ?",
            args: [b.bankruptcy_id]
          });
        } catch (dbErr: any) {
          console.error(`[DB ERROR] No se pudo marcar como notificado el bankruptcy ${b.bankruptcy_id}:`, dbErr.message);
        }
      }

      // Marcar physical_distress asociadas como notificadas
      for (const pd of lead.physicalDistress) {
        try {
          await db.execute({
            sql: "UPDATE physical_distress SET telegram_sent = 1 WHERE distress_id = ?",
            args: [pd.distress_id]
          });
          notifiedPhysicalCount++;
        } catch (dbErr: any) {
          console.error(`[DB ERROR] No se pudo marcar como notificado el physical_distress ${pd.distress_id}:`, dbErr.message);
        }
      }

      // Marcar financial_distress asociadas como notificadas
      for (const fd of lead.financialDistress) {
        try {
          await db.execute({
            sql: "UPDATE financial_distress SET telegram_sent = 1 WHERE record_id = ?",
            args: [fd.record_id]
          });
          notifiedFinancialCount++;
        } catch (dbErr: any) {
          console.error(`[DB ERROR] No se pudo marcar como notificado el financial_distress ${fd.record_id}:`, dbErr.message);
        }
      }

      // Marcar life_events asociados como notificados
      for (const le of lead.lifeEvents) {
        try {
          await db.execute({
            sql: "UPDATE life_events SET telegram_sent = 1 WHERE event_id = ?",
            args: [le.event_id]
          });
          notifiedLifeCount++;
        } catch (dbErr: any) {
          console.error(`[DB ERROR] No se pudo marcar como notificado el life_event ${le.event_id}:`, dbErr.message);
        }
      }
    }

    // Respetar límites de rate limiting de Telegram
    await sleep(350);
  }

  console.log("\n========================================================");
  console.log("RESUMEN DE NOTIFICACIONES TELEGRAM CONSOLIDADAS:");
  console.log(`- Subastas individuales notificadas: ${notifiedAuctionsCount}`);
  console.log(`- Violaciones individuales notificadas: ${notifiedViolationsCount}`);
  console.log(`- Estrés Físico individual notificado: ${notifiedPhysicalCount}`);
  console.log(`- Estrés Financiero individual notificado: ${notifiedFinancialCount}`);
  console.log(`- Eventos de Vida individual notificado: ${notifiedLifeCount}`);
  console.log("========================================================\n");
}

// Ejecutar si se corre directamente
if (require.main === module) {
  notifyOpportunities().catch(console.error);
}

export { notifyOpportunities, sendTelegramNotification };
