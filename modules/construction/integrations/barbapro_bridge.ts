import { createClient } from "@supabase/supabase-js";
import axios from "axios";
import { db } from "../../../db";
import { ConstructionLead } from "../types";
import { isValidReachableUSPhone, formatPhoneUs, normalizePhoneNumber } from "../../../intelligence/phone_classifier";
import * as dotenv from "dotenv";

dotenv.config();

// Configuración de Supabase de BarbaProsystem
const BARBAPRO_SUPABASE_URL = process.env.BARBAPRO_SUPABASE_URL || "https://ddwyutisxymuvofkjhpz.supabase.co";
const BARBAPRO_SUPABASE_KEY = process.env.BARBAPRO_SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";

export const supabaseBarba = createClient(BARBAPRO_SUPABASE_URL, BARBAPRO_SUPABASE_KEY);

interface SalesPitchPackage {
  summary: string;
  speechSpanishDM: string;
  speechSpanishComment: string;
  speechEnglishDM: string;
  callOpening: string;
}

/**
 * Generador de Speech de Venta Personalizado con Gemini 2.5 Flash para Barba Construction
 */
export async function generateSalesPitch(lead: ConstructionLead): Promise<SalesPitchPackage> {
  const apiKey = process.env.GEMINI_API_KEY;

  const defaultPackage: SalesPitchPackage = {
    summary: `Cliente solicita presupuesto para ${lead.category} en ${lead.address}.`,
    speechSpanishDM: `Hola ${lead.ownerName || ''}, vi tu publicación buscando especialista en ${lead.category}. En Barba Construction contamos con cuadrilla local en Louisville/Sur de IN y fotos de proyectos similares. Podemos pasar hoy o mañana a hacerte un estimado gratuito y sin compromiso. ¿Qué día te queda mejor?`,
    speechSpanishComment: `Hola ${lead.ownerName || ''}, te envié un mensaje privado con fotos de trabajos similares que hemos realizado en el área. ¡Estamos a la orden para un estimado gratis!`,
    speechEnglishDM: `Hi ${lead.ownerName || ''}, saw your post regarding ${lead.category}. We are local contractors in the Louisville/Southern IN area. We'd love to stop by for a quick, free on-site estimate. Let us know when works best for you!`,
    callOpening: `Hola ${lead.ownerName || ''}, te llamo de Barba Construction con respecto a tu solicitud de cotización para ${lead.category}.`
  };

  if (!apiKey) return defaultPackage;

  const prompt = `Eres el Director Comercial y Estratega de Ventas de "Barba Construction & Remodeling" en Louisville, KY y Sur de Indiana.
Tu tarea es generar el SPEECH DE VENTA EXACTO para cerrar este lead potencial de construcción.

DATOS DEL LEAD:
- Cliente / Autor: ${lead.ownerName}
- Categoría de Obra: ${lead.category}
- Ubicación: ${lead.address} (${lead.state})
- Presupuesto Estimado: $${lead.estimatedProjectValue} USD
- Urgencia: ${lead.urgencyLevel}
- Fuente: ${lead.sourcePortal}
- Detalles originales de la solicitud:
"""${lead.rawDetails}"""

OBJETIVO:
Redacta respuestas sumamente persuasivas, educadas y directas que generen confianza inmediata y logren que el cliente agende una visita para un presupuesto presencial gratis.

Responde ÚNICAMENTE en formato JSON con la siguiente estructura:
{
  "summary": "Resumen claro de 1 línea de lo que necesita el cliente",
  "speechSpanishDM": "Mensaje privado completo para Messenger / WhatsApp en español listo para enviar (cálido, profesional, ofreciendo inspección gratuita y pidiendo detalles del área/dimensiones)",
  "speechSpanishComment": "Comentario público breve para dejar en el grupo de Facebook avisando que le enviaste fotos y mensaje por privado",
  "speechEnglishDM": "Direct Message in English ready to send (friendly, professional, offering free estimate)",
  "callOpening": "Guión de apertura para llamada telefónica si se dispone de número"
}`;

  try {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: "application/json", temperature: 0.2 }
      },
      { timeout: 9000 }
    );

    const text = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (text) {
      return JSON.parse(text) as SalesPitchPackage;
    }
  } catch {}

  return defaultPackage;
}

/**
 * Sincronizador de Leads hacia la tabla 'contacts' de BarbaProsystem (Supabase)
 */
export async function syncLeadToBarbaPro(lead: ConstructionLead): Promise<boolean> {
  try {
    const nameParts = (lead.ownerName || "Cliente Potencial").split(" ").filter(p => p.length > 0);
    const firstName = nameParts[0] || "Cliente";
    const lastName = nameParts.slice(1).join(" ") || "Potencial";

    // 1. Generar Speech de Venta con IA
    const pitch = await generateSalesPitch(lead);

    // 2. Formatear Notas Completas para el CRM
    const fullNotes = `🎯 NECESIDAD: ${pitch.summary}
💰 VALOR ESTIMADO: $${lead.estimatedProjectValue?.toLocaleString() || "N/A"} USD
🔥 URGENCIA: ${lead.urgencyLevel}
📍 UBICACIÓN / ÁREA: ${lead.address}
🌐 FUENTE: ${lead.sourcePortal}
🔗 ENLACE ORIGINAL: ${lead.permitNumber || "N/A"}

=========================================
💬 SPEECH DE VENTA RECOMENDADO (ESPAÑOL - DM):
"${pitch.speechSpanishDM}"

💬 COMENTARIO PÚBLICO SUGERIDO:
"${pitch.speechSpanishComment}"

💬 SALES PITCH (ENGLISH):
"${pitch.speechEnglishDM}"

📞 APERTURA TELEFÓNICA:
"${pitch.callOpening}"
=========================================
📄 DETALLES ORIGINALES:
${lead.rawDetails}`;

    // 3. Determinar origen compatible con check constraint de Supabase (facebook/other)
    let sourceId = 'other';
    if (lead.sourcePortal.toLowerCase().includes('facebook')) sourceId = 'facebook';
    else if (lead.sourcePortal.toLowerCase().includes('instagram')) sourceId = 'instagram';
    else if (lead.sourcePortal.toLowerCase().includes('google')) sourceId = 'google';
    else sourceId = 'other';

    // Limpiar y validar teléfono y email
    const rawPhone = lead.ownerPhones?.[0] || "";
    const unmaskedPhone = rawPhone.replace(/^(OSINT:|BatchData \(Mobile\):|BatchData \(Landline\):|BatchData \(Landline \[DNC\]\):|📱|☎️)\s*/i, "").trim();
    const validPhone = isValidReachableUSPhone(unmaskedPhone) ? formatPhoneUs(normalizePhoneNumber(unmaskedPhone)) : null;
    
    const rawEmail = lead.ownerEmails?.[0] || "";
    const cleanEmail = rawEmail.replace(/^(OSINT:|BatchData:)\s*/i, "").trim();

    // 4. Mapear Contacto para Supabase
    const contactPayload = {
      first_name: firstName,
      last_name: lastName,
      email: cleanEmail || null,
      phone: validPhone || null,
      address: lead.address || 'Louisville Metro',
      city: lead.address.includes('Clarksville') ? 'Clarksville' : lead.address.includes('New Albany') ? 'New Albany' : (lead.address.includes('Shelbyville') ? 'Shelbyville' : 'Louisville'),
      state: lead.state || 'KY',
      source: sourceId,
      pipeline_status: 'new_lead',
      lead_quality: lead.urgencyLevel === 'CRITICAL' || lead.urgencyLevel === 'HIGH' ? 'hot' : 'warm',
      external_ref: lead.leadId,
      notes: fullNotes
    };

    // 5. Comprobar si ya existe para evitar duplicados (por external_ref o por dirección exacta si no es genérica)
    let existingContact = null;
    
    if (lead.leadId) {
      const { data: byRef } = await supabaseBarba
        .from('contacts')
        .select('id')
        .eq('external_ref', lead.leadId)
        .limit(1);
      if (byRef && byRef.length > 0) existingContact = byRef[0];
    }

    if (!existingContact && lead.address && lead.address.length > 6 && !lead.address.startsWith("Grupo:")) {
      const { data: byAddr } = await supabaseBarba
        .from('contacts')
        .select('id')
        .eq('address', lead.address)
        .limit(1);
      if (byAddr && byAddr.length > 0) existingContact = byAddr[0];
    }

    if (existingContact) {
      const updateData: any = { notes: fullNotes, lead_quality: contactPayload.lead_quality };
      if (validPhone) updateData.phone = validPhone;
      if (firstName !== "Propietario") {
        updateData.first_name = firstName;
        updateData.last_name = lastName;
      }
      await supabaseBarba
        .from('contacts')
        .update(updateData)
        .eq('id', existingContact.id);
      console.log(`  🔄 [BARBAPRO ACTUALIZADO] Contacto ya existente unificado: "${firstName} ${lastName}" (${lead.address})`);
      return true;
    }

    // 6. Insertar en BarbaProsystem Supabase si es nuevo
    const { data, error } = await supabaseBarba
      .from('contacts')
      .insert([contactPayload])
      .select();

    if (error) {
      console.warn(`  ⚠️ Error insertando en BarbaProsystem: ${error.message}`);
      return false;
    }

    console.log(`  🚀 [BARBAPRO INTEGRADO] Contacto sincronizado exitosamente: "${firstName} ${lastName}" -> ID: ${data?.[0]?.id}`);
    return true;
  } catch (err: any) {
    console.error(`  ❌ Error en syncLeadToBarbaPro: ${err.message}`);
    return false;
  }
}

/**
 * Sincronización Masiva de Todos los Leads Calificados desde Turso DB a BarbaProsystem
 */
export async function syncAllLeadsToBarbaPro(limit: number = 50): Promise<number> {
  console.log("\n=================================================================");
  console.log("🔗 SINCRONIZANDO LEADS Y SPEECHES DE VENTA CON BARBAPROSYSTEM 🔗");
  console.log("=================================================================\n");

  const query = await db.execute({
    sql: `SELECT * FROM construction_leads 
          WHERE category != 'GOVERNMENT_BID' 
          ORDER BY trigger_date DESC, estimated_project_value DESC 
          LIMIT ?`,
    args: [limit]
  });

  console.log(`📊 ${query.rows.length} leads residenciales/comerciales seleccionados para sincronizar.`);

  let syncedCount = 0;
  for (const row of query.rows) {
    const lead: ConstructionLead = {
      leadId: String(row.lead_id),
      category: row.category as any,
      triggerEvent: row.trigger_event as any,
      address: String(row.address),
      county: String(row.county),
      state: String(row.state),
      ownerName: String(row.owner_name),
      ownerPhones: row.owner_phones ? JSON.parse(String(row.owner_phones)) : [],
      ownerEmails: row.owner_emails ? JSON.parse(String(row.owner_emails)) : [],
      propertyType: String(row.property_type),
      estimatedProjectValue: Number(row.estimated_value),
      triggerDate: String(row.trigger_date),
      urgencyLevel: row.urgency_level as any,
      sourcePortal: String(row.source_portal),
      rawDetails: String(row.raw_details),
      permitNumber: row.permit_number ? String(row.permit_number) : undefined
    };

    const success = await syncLeadToBarbaPro(lead);
    if (success) syncedCount++;
  }

  console.log(`\n🎉 [SINCRONIZACIÓN BARBAPRO FINALIZADA] ${syncedCount}/${query.rows.length} Leads transferidos con su Speech de Venta.\n`);
  return syncedCount;
}
