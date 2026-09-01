import { db } from "../../../db";
import { saveConstructionLead } from "../db_construction";
import { ConstructionLead } from "../types";
import { syncLeadToBarbaPro } from "./barbapro_bridge";
import * as crypto from "crypto";
import * as dotenv from "dotenv";

dotenv.config();

import { isValidReachableUSPhone, formatPhoneUs, normalizePhoneNumber } from "../../../intelligence/phone_classifier";

/**
 * Extrae y normaliza teléfonos válidos de EE.UU. desde strings crudos (OSINT / BatchData / JSON)
 */
function parsePhoneList(raw: any): string[] {
  if (!raw) return [];
  let candidates: string[] = [];
  if (Array.isArray(raw)) candidates = raw.filter(Boolean);
  else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) candidates = parsed.filter(Boolean);
    } catch {}
    if (!candidates.length) {
      candidates = raw.split(",").map(s => s.trim()).filter(s => s.length > 3);
    }
  }

  const validPhones: string[] = [];
  for (const c of candidates) {
    const unmasked = c.replace(/^(OSINT:|BatchData \(Mobile\):|BatchData \(Landline\):|BatchData \(Landline \[DNC\]\):|📱|☎️)\s*/i, "").trim();
    if (isValidReachableUSPhone(unmasked)) {
      const formatted = formatPhoneUs(normalizePhoneNumber(unmasked));
      if (!validPhones.includes(formatted)) {
        validPhones.push(formatted);
      }
    }
  }
  return validPhones;
}

function parseEmailList(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch {}
    return raw.split(",").map(s => s.trim()).filter(s => s.includes("@"));
  }
  return [];
}

export async function syncRealEstateRoofingToConstruction() {
  console.log("=================================================================");
  console.log("🏠 INICIANDO INTEGRACIÓN: LEADS DE ROOFING (REAL ESTATE) -> CONSTRUCCIÓN & BARBAPRO CRM");
  console.log("=================================================================\n");

  const roofingCandidates: ConstructionLead[] = [];
  const seenAddresses = new Set<string>();

  // 1. Extraer desde 'code_violations' con infracciones de Techos (X50, X20, ROOF)
  const cvRes = await db.execute(`
    SELECT violation_id, case_number, address, violation_type, report_date, owner_name, 
           defendant_phones, defendant_emails, mailing_address, absentee_owner
    FROM code_violations 
    WHERE violation_type LIKE '%ROOF%' 
       OR violation_type LIKE '%TECHO%'
       OR violation_type LIKE '%GUTTER%'
       OR violation_type LIKE '%FLASHING%'
  `);

  console.log(`📋 Infracciones de Código de Techos detectadas: ${cvRes.rows.length}`);

  for (const r of cvRes.rows) {
    const addr = String(r.address || "").trim();
    if (!addr || seenAddresses.has(addr.toLowerCase())) continue;
    seenAddresses.add(addr.toLowerCase());

    const phones = parsePhoneList(r.defendant_phones);
    const emails = parseEmailList(r.defendant_emails);
    const leadId = `LEAD_RE_ROOF_${crypto.createHash("md5").update(addr).digest("hex").substring(0, 12)}`;

    const lead: ConstructionLead = {
      leadId,
      category: "ROOFING_SIDING_GUTTERS",
      triggerEvent: "CODE_VIOLATION_ROOF_DAMAGE" as any,
      address: addr,
      county: "Jefferson",
      state: "KY",
      ownerName: String(r.owner_name || "Propietario Inmueble Citado").replace(/DUEÑO DESCONOCIDO/i, "Propietario Inmueble"),
      ownerPhones: phones,
      ownerEmails: emails,
      propertyType: "Residential",
      estimatedProjectValue: 14500,
      triggerDate: String(r.report_date || new Date().toISOString().split("T")[0]),
      urgencyLevel: "HIGH",
      sourcePortal: "Jefferson County Code Enforcement (Roofing / Gutters)",
      rawDetails: `🚨 CITACIÓN MUNICIPAL DE TECHOS: ${r.violation_type}. El inmueble tiene requerimiento legal de reparación de techos/bajantes/flashing. Multas acumulables si no contrata reparación.`,
      permitNumber: String(r.case_number || r.violation_id || ""),
      insurancePayerLikely: true
    };

    roofingCandidates.push(lead);
  }

  // 2. Extraer desde 'physical_distress' con daños estructurales en techos / incendios / tormentas
  const pdRes = await db.execute(`
    SELECT distress_id, address, county, state, distress_type, report_date, details, owner_name, 
           defendant_phones, defendant_emails
    FROM physical_distress 
    WHERE details LIKE '%roof%' 
       OR details LIKE '%techo%' 
       OR details LIKE '%storm%' 
       OR details LIKE '%wind%' 
       OR distress_type LIKE '%roof%'
  `);

  console.log(`🌪️ Daños Físicos / Estructurales de Techos detectados: ${pdRes.rows.length}`);

  for (const r of pdRes.rows) {
    const addr = String(r.address || "").trim();
    if (!addr || seenAddresses.has(addr.toLowerCase())) continue;
    seenAddresses.add(addr.toLowerCase());

    const phones = parsePhoneList(r.defendant_phones);
    const emails = parseEmailList(r.defendant_emails);
    const leadId = `LEAD_RE_ROOF_${crypto.createHash("md5").update(addr).digest("hex").substring(0, 12)}`;

    const lead: ConstructionLead = {
      leadId,
      category: "ROOFING_SIDING_GUTTERS",
      triggerEvent: "STORM_HAIL_DAMAGE" as any,
      address: addr,
      county: String(r.county || "Jefferson"),
      state: String(r.state || "KY"),
      ownerName: String(r.owner_name || "Propietario Inmueble").replace(/DUEÑO DESCONOCIDO/i, "Propietario Inmueble"),
      ownerPhones: phones,
      ownerEmails: emails,
      propertyType: "Residential",
      estimatedProjectValue: 18500,
      triggerDate: String(r.report_date || new Date().toISOString().split("T")[0]),
      urgencyLevel: "CRITICAL",
      sourcePortal: "Physical Distress & Storm Damage Intelligence",
      rawDetails: `🌪️ DAÑO ESTRUCTURAL EN TECHO: ${r.details}. Inmueble con daño físico severo o declaración de inhabitabilidad por cubierta. Alta probabilidad de reclamo a aseguradora.`,
      insurancePayerLikely: true
    };

    roofingCandidates.push(lead);
  }

  console.log(`\n🎯 Total de Oportunidades de Techos a Integrar: ${roofingCandidates.length}`);

  // 3. Guardar en tabla 'construction_leads'
  let savedCount = 0;
  for (const lead of roofingCandidates) {
    await saveConstructionLead(lead);
    savedCount++;
  }
  console.log(`✅ [CONSTRUCTION DB] ${savedCount} leads guardados en la tabla 'construction_leads'.`);

  // 4. Filtrar los que tienen Teléfono o Email para enviarlos a BarbaPro CRM
  const leadsWithContact = roofingCandidates.filter(l => l.ownerPhones.length > 0 || l.ownerEmails.length > 0);
  console.log(`\n🚀 Sincronizando con BarbaPro CRM los leads con Teléfono o Email: ${leadsWithContact.length} contactos...`);

  let syncedCount = 0;
  for (let i = 0; i < leadsWithContact.length; i++) {
    const lead = leadsWithContact[i];
    console.log(`[${i + 1}/${leadsWithContact.length}] 📤 Sincronizando: "${lead.ownerName}" (${lead.address}) | Tel: ${lead.ownerPhones[0] || 'N/A'} | Email: ${lead.ownerEmails[0] || 'N/A'}`);
    const ok = await syncLeadToBarbaPro(lead);
    if (ok) syncedCount++;
    // Pausa breve para respetar rate limit de IA
    await new Promise(r => setTimeout(r, 400));
  }

  console.log("\n=================================================================");
  console.log(`🎉 [INTEGRACIÓN FINALIZADA]`);
  console.log(`  - Leads de Techos agregados a Construcción: ${savedCount}`);
  console.log(`  - Leads con Teléfono/Email sincronizados a BarbaPro CRM: ${syncedCount}/${leadsWithContact.length}`);
  console.log("=================================================================");
}

if (require.main === module) {
  syncRealEstateRoofingToConstruction().catch(console.error);
}
