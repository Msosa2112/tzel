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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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
    
    // Formato 1: 6/26/2026 o 06/26/2026
    if (/^\d+\/\d+\/\d+$/.test(cleanDate)) {
      const [m, d, y] = cleanDate.split("/").map(Number);
      dateObj = new Date(y, m - 1, d);
    }
    // Formato 2: june/16 2026 o july/ 2 2026
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
    // Formato 3: august 13, 2026 o july 9, 2026
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
 * Envía un mensaje estructurado premium a Telegram.
 */
async function sendTelegramNotification(message: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log("[TELEGRAM] Advertencia: Credenciales de Telegram no configuradas.");
    return false;
  }
  
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload = {
    chat_id: chatId,
    text: message,
    parse_mode: "Markdown",
    disable_web_page_preview: true
  };
  
  try {
    const response = await axios.post(url, payload, { timeout: 10000 });
    return response.status === 200;
  } catch (e: any) {
    console.error(`[TELEGRAM EXCEPTION] Error al enviar mensaje: ${e.message || e}`);
    return false;
  }
}

/**
 * Despacha notificaciones para oportunidades de alta rentabilidad o revisiones manuales no notificadas.
 */
async function notifyOpportunities() {
  console.log("[INICIO] Buscando oportunidades y revisiones sin notificar...");
  
  let opportunitiesRes;
  try {
    opportunitiesRes = await db.execute(`
      SELECT 
        auction_id, case_number, address, county, state, auction_date, 
        plaintiff, defendant, debt_amount, appraisal_value, 
        mls_estimated_value, mls_id, pdf_url,
        defendant_phones, defendant_emails, needs_manual_review
      FROM foreclosure_auctions 
      WHERE (is_high_yield = 1 OR (state = 'IN' AND needs_manual_review = 1)) AND telegram_sent = 0
    `);
  } catch (dbErr: any) {
    console.error("[DB ERROR] Error al consultar oportunidades:", dbErr.message);
    process.exit(1);
  }
  
  const opportunities = opportunitiesRes.rows;
  console.log(`[NOTIFICAR] Se detectaron ${opportunities.length} registros listos para alertar en Telegram.`);
  
  let sentCount = 0;
  
  for (const row of opportunities) {
    const auctionId = row.auction_id as string;
    const caseNumber = row.case_number as string;
    const address = row.address as string;
    const county = row.county as string;
    const state = row.state as string;
    const auctionDate = row.auction_date as string;
    const plaintiff = row.plaintiff as string || "No especificado";
    const defendant = row.defendant as string || "No especificado";
    const debtAmount = row.debt_amount as number || 0;
    const mlsValue = row.mls_estimated_value as number || 0;
    const mlsId = row.mls_id as string || "N/A";
    const pdfUrl = row.pdf_url as string || null;
    const phones = row.defendant_phones as string || null;
    const emails = row.defendant_emails as string || null;
    const needsManualReview = row.needs_manual_review as number || 0;
    
    // Días restantes
    const daysRemaining = getDaysRemaining(auctionDate);
    const daysStr = daysRemaining !== null 
      ? (daysRemaining < 0 ? `Hace ${Math.abs(daysRemaining)} días (Pasada)` : `${daysRemaining} días`)
      : "Fecha indefinida";
      
    // Descuento potencial
    const discountPct = mlsValue > 0 ? ((mlsValue - debtAmount) / mlsValue) * 100 : 0;
    
    // Construir mensaje premium en Español Markdown
    let pdfSection = "";
    if (pdfUrl) {
      try {
        console.log(`[CHECK PDF] Validando existencia de PDF: ${pdfUrl}`);
        const headResp = await axios.head(pdfUrl, {
          headers: { 
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" 
          },
          timeout: 5000
        });
        if (headResp.status === 200) {
          pdfSection = `📁 *Expediente de Subasta:* [Ver PDF de Tasación Judicial](${pdfUrl})\n\n`;
        } else {
          pdfSection = `📁 *Expediente de Subasta:* No disponible aún (la corte lo publica 1-2 semanas antes del remate)\n\n`;
        }
      } catch (err) {
        pdfSection = `📁 *Expediente de Subasta:* No disponible aún (la corte lo publica 1-2 semanas antes del remate)\n\n`;
      }
    }
    
    let msg = "";
    
    if (state === "IN" && needsManualReview === 1) {
      // Alerta de Revisión Manual para Indiana
      msg += `⚠️ *REVISIÓN MANUAL REQUERIDA (INDIANA)* ⚠️\n`;
      msg += `_El crawler no pudo extraer automáticamente la deuda judicial de este expediente (bloqueo de captcha o caso no indexado)._\n\n`;
      
      msg += `📍 *Dirección:* ${address}\n`;
      msg += `🏢 *Condado/Estado:* ${county} County, ${state}\n`;
      msg += `📅 *Fecha de Subasta:* ${auctionDate} *(${daysStr} restantes)*\n\n`;
      
      if (mlsValue > 0) {
        msg += `📊 *Valor Comercial ARV:* $${mlsValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n\n`;
      }
      
      msg += `👤 *Demandado:* ${defendant}\n`;
      msg += `📋 *Caso Judicial:* ${caseNumber}\n`;
      msg += `🔗 *Buscador Judicial (MyCase):* [Abrir MyCase](https://public.courts.in.gov/mycase/)\n\n`;
      
      msg += `💡 *Instrucciones:* Haz clic en el enlace, ve a la pestaña NAME y busca por el nombre del demandado limitando la búsqueda a Casos Civiles en este condado.`;
    } else {
      // Alerta de Oportunidad normal
      msg += `🚨 *OPORTUNIDAD DE ADQUISICIÓN PRE-SUBASTA* 🚨\n`;
      msg += `_Propiedad identificada con descuento > 50% de valor comercial MLS_\n\n`;
      
      msg += `📍 *Dirección:* ${address}\n`;
      msg += `🏢 *Condado/Estado:* ${county} County, ${state}\n`;
      msg += `📅 *Fecha de Subasta:* ${auctionDate} *(${daysStr} restantes)*\n\n`;
      
      msg += `💵 *Precio de Adquisición (Deuda):* $${debtAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n`;
      msg += `📊 *Valor Comercial ARV:* $${mlsValue.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n`;
      msg += `📉 *Descuento Potencial:* *${discountPct.toFixed(1)}%*\n\n`;
      
      msg += `👤 *Dueño Deudor (Demandado):* ${defendant}\n`;
      if (phones && phones !== "000-000-0000" && phones.trim() !== "") {
        msg += `📞 *Teléfonos:* \`${phones}\`\n`;
      }
      if (emails && emails !== "no-contact@example.com" && emails.trim() !== "") {
        msg += `✉️ *Correos:* \`${emails}\`\n`;
      }
      
      msg += `🏦 *Acreedor (Demandante):* ${plaintiff}\n`;
      msg += `📋 *Caso Judicial:* ${caseNumber}\n`;
      
      if (mlsId && mlsId !== "N/A") {
        msg += `🔗 *MLS ID:* [${mlsId}](https://replication.sparkapi.com/Reso/OData/Property('${mlsId}'))\n\n`;
      }
      
      msg += pdfSection;
      
      msg += `💡 *Estrategia Recomendada:* Contactar al dueño deudor de inmediato para negociar una compra directa antes del remate el ${auctionDate}.`;
    }
    
    console.log(`[ALERTANDO] Enviando alerta para dirección: ${address}...`);
    const success = await sendTelegramNotification(msg);
    
    if (success) {
      // Marcar como notificado
      try {
        await db.execute({
          sql: "UPDATE foreclosure_auctions SET telegram_sent = 1 WHERE auction_id = ?",
          args: [auctionId]
        });
        sentCount++;
      } catch (dbErr: any) {
        console.error(`[DB ERROR] No se pudo marcar como notificado el caso ${caseNumber}:`, dbErr.message);
      }
    }
    
    // Respetar límites de rate limiting de Telegram
    await sleep(300);
  }
  
  console.log("\n========================================================");
  console.log("RESUMEN DE NOTIFICACIONES TELEGRAM:");
  console.log(`- Alertas enviadas con éxito: ${sentCount}`);
  console.log("========================================================\n");
}

// Ejecutar si se corre directamente
if (require.main === module) {
  notifyOpportunities().catch(console.error);
}

export { notifyOpportunities };
