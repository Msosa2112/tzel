import axios from "axios";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import { calculateRehab, calculateMAO, calculateROI, isJuniorLien } from "./underwriting/underwriter";

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
 * Retorna una clave de agrupación limpia y determinista basada en el número de casa y el nombre de la calle.
 */
function getGroupingKey(address: string): string {
  const parsed = parseAddress(address);
  if (!parsed.houseNumber) {
    return address.toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  return `${parsed.houseNumber}_${parsed.coreWords.join("_")}`;
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
async function sendTelegramNotification(message: string, replyMarkup?: any): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log("[TELEGRAM] Advertencia: Credenciales de Telegram no configuradas.");
    return false;
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
  
  // Nuevos campos del catastro y la MLS
  mailingAddress?: string;
  isAbsentee: boolean;
  sqft?: number;
  beds?: number;
  baths?: number;
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
        mailing_address, absentee_owner, sqft, beds, baths
      FROM foreclosure_auctions 
      WHERE (is_high_yield = 1 OR (state = 'IN' AND needs_manual_review = 1)) AND telegram_sent = 0
    `);
  } catch (dbErr: any) {
    console.error("[DB ERROR] Error al consultar subastas:", dbErr.message);
    process.exit(1);
  }
  const opportunities = opportunitiesRes.rows;

  // 2. Consultar violaciones de código no notificadas
  let violationsRes;
  try {
    violationsRes = await db.execute(`
      SELECT 
        violation_id, case_number, address, violation_type, report_date, status, 
        owner_name, mls_estimated_value, mls_id, defendant_phones, defendant_emails,
        mailing_address, absentee_owner, sqft, beds, baths
      FROM code_violations 
      WHERE is_high_yield = 1 AND telegram_sent = 0
    `);
  } catch (dbErr: any) {
    console.error("[DB ERROR] Error al consultar violaciones de código:", dbErr.message);
    process.exit(1);
  }
  const violations = violationsRes.rows;

  console.log(`[NOTIFICAR] Registros individuales pendientes: Subastas: ${opportunities.length}, Violaciones: ${violations.length}`);

  if (opportunities.length === 0 && violations.length === 0) {
    console.log("[NOTIFICAR] No hay nuevas notificaciones pendientes.");
    return;
  }

  // 3. Agrupación por dirección
  const groupedMap = new Map<string, GroupedLead>();

  // A. Agrupar subastas
  for (const row of opportunities) {
    const address = row.address as string;
    const key = getGroupingKey(address);
    
    const rowPhones = (row.defendant_phones as string || "").split(/[,;\s]+/).map(p => p.trim()).filter(Boolean);
    const rowEmails = (row.defendant_emails as string || "").split(/[,;\s]+/).map(e => e.trim().toLowerCase()).filter(Boolean);

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
        mailingAddress: row.mailing_address as string || undefined,
        isAbsentee: (row.absentee_owner as number) === 1,
        sqft: row.sqft as number || undefined,
        beds: row.beds as number || undefined,
        baths: row.baths as number || undefined
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
      rowPhones.forEach(p => existing.phones.add(p));
      rowEmails.forEach(e => existing.emails.add(e));
      
      // Preferir la dirección más larga (con detalles como Apt/Unit #)
      if (address.length > existing.displayAddress.length) {
        existing.displayAddress = address;
      }
    }
    groupedMap.get(key)!.auctions.push(row);
  }

  // B. Agrupar violaciones de código
  for (const row of violations) {
    const address = row.address as string;
    const key = getGroupingKey(address);

    const rowPhones = (row.defendant_phones as string || "").split(/[,;\s]+/).map(p => p.trim()).filter(Boolean);
    const rowEmails = (row.defendant_emails as string || "").split(/[,;\s]+/).map(e => e.trim().toLowerCase()).filter(Boolean);

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
        mailingAddress: row.mailing_address as string || undefined,
        isAbsentee: (row.absentee_owner as number) === 1,
        sqft: row.sqft as number || undefined,
        beds: row.beds as number || undefined,
        baths: row.baths as number || undefined
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
      rowPhones.forEach(p => existing.phones.add(p));
      rowEmails.forEach(e => existing.emails.add(e));
      
      if (address.length > existing.displayAddress.length) {
        existing.displayAddress = address;
      }
    }
    groupedMap.get(key)!.violations.push(row);
  }

  console.log(`[NOTIFICAR] Direcciones agrupadas únicas a notificar: ${groupedMap.size}`);

  let notifiedAuctionsCount = 0;
  let notifiedViolationsCount = 0;

  // 4. Construir y enviar notificaciones
  for (const lead of groupedMap.values()) {
    const hasAuctions = lead.auctions.length > 0;
    const hasViolations = lead.violations.length > 0;
    let isIndianaManual = lead.state === "IN" && lead.auctions.some(a => a.needs_manual_review === 1);

    // --- CÁLCULOS FINANCIEROS (UNDERWRITING) ---
    const violationKeywords = lead.violations.map(v => v.violation_type as string);
    const rehab = calculateRehab(lead.sqft || null, violationKeywords);
    const mao = calculateMAO(lead.mlsValue, rehab);
    
    const primaryDebt = lead.auctions.length > 0 ? (lead.auctions[0].debt_amount as number || 0) : 0;
    // Para el cálculo de ROI de violaciones (sin deuda), simulamos que compramos al valor de la oferta máxima (MAO)
    const purchasePrice = primaryDebt > 0 ? primaryDebt : mao;
    const { roi, totalCost } = calculateROI(lead.mlsValue, purchasePrice, rehab);

    const isJunior = lead.auctions.some(a => isJuniorLien(a.plaintiff, a.case_number));

    let msg = "";

    if (hasAuctions && hasViolations) {
      msg += `🚨 *ALERTA DE OPORTUNIDAD: ESTRÉS MÚLTIPLE* 🚨\n`;
      msg += `_Propiedad con acumulado de procesos judiciales e infracciones de código_\n\n`;
    } else if (hasAuctions) {
      if (isIndianaManual) {
        msg += `⚠️ *REVISIÓN MANUAL REQUERIDA (INDIANA)* ⚠️\n`;
        msg += `_El crawler no pudo extraer automáticamente la deuda de este expediente._\n\n`;
      } else {
        msg += `🚨 *OPORTUNIDAD DE ADQUISICIÓN PRE-SUBASTA* 🚨\n`;
        msg += `_Propiedad identificada con descuento > 50% de valor comercial MLS_\n\n`;
      }
    } else {
      msg += `🚨 *OPORTUNIDAD PRE-PÚBLICA: VIOLACIÓN DE CÓDIGO* 🚨\n`;
      msg += `_Propiedad con infracción física detectada y valorada mediante Spark MLS_\n\n`;
    }

    // Datos generales de la propiedad
    msg += `📍 *Dirección:* ${lead.displayAddress}\n`;
    msg += `🏢 *Ubicación:* ${lead.county} County, ${lead.state}\n\n`;

    // Datos de contacto del dueño
    const absenteeStatus = lead.isAbsentee ? "*(Dueño Ausente)*" : "*(Dueño Ocupante)*";
    msg += `👤 *Propietario / Demandado:* ${lead.ownerName} ${absenteeStatus}\n`;
    if (lead.mailingAddress) {
      msg += `✉️ *Dirección Postal:* ${lead.mailingAddress}\n`;
    }
    if (lead.phones.size > 0) {
      msg += `📞 *Teléfonos:* \`${Array.from(lead.phones).join(", ")}\`\n`;
    }
    if (lead.emails.size > 0) {
      msg += `✉️ *Correos:* \`${Array.from(lead.emails).join(", ")}\`\n`;
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
    if (lead.mlsValue > 0 && purchasePrice > 0) {
      msg += `• *ROI Proyectado:* ${roi}% (Costo total proyecto: $${totalCost.toLocaleString()})\n`;
    } else {
      msg += `• *ROI Proyectado:* N/A (Faltan comps de mercado)\n`;
    }
    if (isJunior) {
      msg += `⚠️ *ALERTA:* Detectado posible gravamen secundario (Junior Lien). Verificar si es segunda hipoteca para evitar errores de costo.\n`;
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

    msg += `\n---\n`;

    // Instrucción / Recomendación Final
    if (hasAuctions && hasViolations) {
      msg += `💡 *Estrategia Recomendada:* Contactar al propietario/deudor de inmediato para negociar una compra directa debido a la acumulación de múltiples factores de estrés (deuda judicial y abandono físico).`;
    } else if (hasAuctions) {
      if (isIndianaManual) {
        msg += `💡 *Instrucciones:* Busca por el nombre del demandado en MyCase para el condado correspondiente de Indiana y extrae el monto de la deuda para actualizar Turso.`;
      } else {
        const firstAuction = lead.auctions[0];
        msg += `💡 *Estrategia Recomendada:* Contactar al deudor de inmediato para negociar una compra directa antes de la subasta el ${firstAuction.auction_date}.`;
      }
    } else {
      msg += `💡 *Estrategia Recomendada:* Contactar al propietario de inmediato para negociar una compra directa debido a estrés físico por violación de código.`;
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

    console.log(`[ALERTANDO] Enviando alerta agrupada para: ${lead.displayAddress} (Subastas: ${lead.auctions.length}, Violaciones: ${lead.violations.length})...`);
    
    const success = await sendTelegramNotification(msg, replyMarkup);
    
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
    }

    // Respetar límites de rate limiting de Telegram
    await sleep(350);
  }

  console.log("\n========================================================");
  console.log("RESUMEN DE NOTIFICACIONES TELEGRAM CONSOLIDADAS:");
  console.log(`- Subastas individuales notificadas: ${notifiedAuctionsCount}`);
  console.log(`- Violaciones individuales notificadas: ${notifiedViolationsCount}`);
  console.log("========================================================\n");
}

// Ejecutar si se corre directamente
if (require.main === module) {
  notifyOpportunities().catch(console.error);
}

export { notifyOpportunities };
