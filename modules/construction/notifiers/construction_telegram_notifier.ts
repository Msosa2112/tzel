import { sendTelegramNotification } from "../../../telegram_helper";
import { ConstructionBid, ConstructionLead } from "../types";
import { db } from "../../../db";

/**
 * Notificador de Telegram especializado para el Módulo de Construcción
 */
export class ConstructionTelegramNotifier {

  /**
   * Formatea y envía una alerta de Licitación Pública
   */
  async notifyBid(bid: ConstructionBid): Promise<boolean> {
    const budgetStr = bid.estimatedBudget && bid.estimatedBudget > 0
      ? `$${bid.estimatedBudget.toLocaleString("en-US")} USD`
      : "A cotizar / Según pliego";

    const deadlineStr = bid.bidDeadline || "Por confirmar";
    const bondStr = bid.bondingRequired ? "⚠️ Requiere Fianza de Licitación (Bid Bond)" : "No especificada";

    const message = `
🏗️ <b>NUEVA LICITACIÓN PÚBLICA DE CONSTRUCCIÓN</b> 🏛️
━━━━━━━━━━━━━━━━━━━━━━━━━━━
📌 <b>Proyecto:</b> ${bid.title}
🏢 <b>Entidad Emisora:</b> ${bid.agency}
📍 <b>Jurisdicción:</b> ${bid.jurisdiction.replace(/_/g, " ")}
🏷️ <b>Categoría:</b> <code>${bid.category}</code>

💰 <b>Presupuesto Estimado:</b> <b>${budgetStr}</b>
⏳ <b>Fecha Límite:</b> <b>${deadlineStr}</b>
📑 <b>Requisitos:</b> ${bondStr}

📝 <b>Resumen Ejecutivo:</b>
${bid.description}

👤 <b>Contacto Oficial:</b> ${bid.contactName || "Departamento de Adquisiciones"}
📧 ${bid.contactEmail || "Ver pliego"} | 📞 ${bid.contactPhone || "Ver pliego"}
━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

    const inlineKeyboard: any[] = [];
    const buttons: any[] = [];

    if (bid.solicitationUrl && bid.solicitationUrl.startsWith("http") && !bid.solicitationUrl.includes("javascript:")) {
      buttons.push({ text: "📄 Ver Pliego Oficial", url: bid.solicitationUrl });
    }
    if (bid.documentsUrl && bid.documentsUrl.startsWith("http") && !bid.documentsUrl.includes("javascript:")) {
      buttons.push({ text: "📁 Planos / Anexos", url: bid.documentsUrl });
    }
    if (buttons.length > 0) inlineKeyboard.push(buttons);

    const sent = await sendTelegramNotification(
      message,
      inlineKeyboard.length > 0 ? { inline_keyboard: inlineKeyboard } : undefined,
      null,
      "HTML"
    );

    if (sent) {
      await db.execute({
        sql: "UPDATE construction_bids SET telegram_sent = 1 WHERE bid_id = ?",
        args: [bid.bidId]
      });
    }

    return sent;
  }

  /**
   * Formatea y envía una alerta de Lead Privado de Construcción/Reforma
   */
  async notifyLead(lead: ConstructionLead): Promise<boolean> {
    // Si el lead no tiene teléfonos y tiene una dirección física, intentar skip trace en caliente
    if (lead.ownerPhones.length === 0 && lead.address && !lead.address.startsWith("Expediente") && !lead.address.startsWith("Grupo:")) {
      try {
        const { performCascadedSkipTrace } = await import("../intelligence/public_osint_skiptracer");
        const skipRes = await performCascadedSkipTrace(lead.address, "Louisville", lead.state || "KY", undefined, lead.ownerName);
        if (skipRes && skipRes.phones.length > 0) {
          lead.ownerPhones = skipRes.phones.map(p => `${p.type === "MOBILE" ? "📱" : "☎️"} ${p.number}`);
          if (skipRes.ownerName && (!lead.ownerName || lead.ownerName.toLowerCase().includes("propietario"))) {
            lead.ownerName = skipRes.ownerName;
          }
          if (skipRes.emails.length > 0 && lead.ownerEmails.length === 0) {
            lead.ownerEmails = skipRes.emails;
          }
          // Actualizar en BD
          await db.execute({
            sql: "UPDATE construction_leads SET owner_name = ?, owner_phones = ?, owner_emails = ? WHERE lead_id = ?",
            args: [lead.ownerName || null, JSON.stringify(lead.ownerPhones), JSON.stringify(lead.ownerEmails), lead.leadId]
          });
        }
      } catch (e) {}
    }

    const valueStr = lead.estimatedProjectValue && lead.estimatedProjectValue > 0
      ? `$${lead.estimatedProjectValue.toLocaleString("en-US")} USD`
      : "A presupuestar";

    const insuranceBadge = lead.insurancePayerLikely
      ? "🛡️ <b>Financiación:</b> 100% Cubierto por Seguro de Hogar"
      : "💵 <b>Financiación:</b> Propietario Particular";

    const urgencyEmoji = lead.urgencyLevel === "CRITICAL" ? "🔴 URGENCIA MÁXIMA" : (lead.urgencyLevel === "HIGH" ? "🟠 ALTA" : "🟡 NORMAL");

    const message = `
🔨 <b>OPORTUNIDAD DE OBRA / REFORMA PRIVADA</b> 🏡
━━━━━━━━━━━━━━━━━━━━━━━━━━━
📍 <b>Dirección:</b> ${lead.address}, ${lead.county}, ${lead.state}
🏷️ <b>Especialidad:</b> <code>${lead.category}</code>
⚡ <b>Disparador:</b> <code>${lead.triggerEvent}</code>
🚨 <b>Nivel de Urgencia:</b> ${urgencyEmoji}

💰 <b>Valor Estimado del Trabajo:</b> <b>${valueStr}</b>
${insuranceBadge}

👤 <b>Propietario / Solicitante:</b> ${lead.ownerName || "Propietario Residente"}
📞 <b>Teléfonos:</b> ${lead.ownerPhones.length > 0 ? lead.ownerPhones.join(", ") : "Sin teléfono público indexado"}
📧 <b>Emails:</b> ${lead.ownerEmails.length > 0 ? lead.ownerEmails.join(", ") : "No disponible"}

📋 <b>Detalles de la Obra:</b>
${lead.rawDetails}
━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

    const buttons: any[] = [];
    if (lead.permitNumber && lead.permitNumber.startsWith("http")) {
      buttons.push({ text: "💬 Ver Publicación y Responder", url: lead.permitNumber });
    }
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lead.address}, ${lead.county}, ${lead.state}`)}`;
    buttons.push({ text: "🗺️ Ver en Google Maps", url: mapsUrl });

    const inlineKeyboard: any[] = [buttons];

    const sent = await sendTelegramNotification(
      message,
      { inline_keyboard: inlineKeyboard },
      null,
      "HTML"
    );

    if (sent) {
      await db.execute({
        sql: "UPDATE construction_leads SET telegram_sent = 1 WHERE lead_id = ?",
        args: [lead.leadId]
      });
    }

    return sent;
  }
}
