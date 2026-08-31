import axios from "axios";
import { ConstructionLead } from "../types";
import { classifyConstructionItem } from "../classifiers/gemini_construction_classifier";
import { saveConstructionLead } from "../db_construction";
import * as crypto from "crypto";

/**
 * Recolector de Solicitudes de Variación de Zonificación y Planificación (LOJIC GIS / BOZA)
 * Capa 26 de LOJIC: Louisville KY Metro Planning Applications
 */
export async function collectZoningVarianceLeads(): Promise<ConstructionLead[]> {
  console.log("\n[LEADS] Consultando expedientes de planificación y zonificación (LOJIC GIS OpenData / BOZA)...");
  const leads: ConstructionLead[] = [];

  try {
    const url = "https://gis.lojic.org/maps/rest/services/LojicSolutions/OpenDataDevelopment/MapServer/26/query?where=1=1&outFields=*&f=json&resultRecordCount=15&orderByFields=LOJIC_CREATE_DATE%20DESC";
    const response = await axios.get(url, { timeout: 10000 }).catch(() => null);

    if (response && response.data && response.data.features) {
      for (const feature of response.data.features) {
        const attr = feature.attributes || {};
        const recordNum = attr.RECORD_NUMBER || `PLN_${attr.OBJECTID}`;
        const recordType = attr.RECORD_TYPE || "SITEPLAN";
        const subType = attr.RECORD_TYPE_SUBTYPE || "LVAR";
        const dateEpoch = attr.RECORD_OPEN_DATE || attr.LOJIC_CREATE_DATE;
        const dateStr = dateEpoch ? new Date(dateEpoch).toISOString().split("T")[0] : new Date().toISOString().split("T")[0];

        const title = `Expediente de Zonificación ${recordNum} (${recordType} - ${subType})`;
        const desc = `Solicitud de planificación urbana y variación de uso/estructura ante la junta municipal. Tipo: ${recordType}, Subtipo: ${subType}. Precursor de obra nueva o ampliación.`;

        const classification = await classifyConstructionItem(
          title,
          desc,
          "LOJIC Planning Applications"
        );

        if (classification.isValidConstruction) {
          const leadId = `LEAD_ZONING_${crypto.createHash("md5").update(recordNum).digest("hex").substring(0, 12)}`;
          const lead: ConstructionLead = {
            leadId,
            category: classification.category || "NEW_CONSTRUCTION_GROUND_UP",
            triggerEvent: "ZONING_VARIANCE_BOZA",
            address: `Expediente Municipal ${recordNum} (Jefferson County)`,
            county: "Jefferson",
            state: "KY",
            ownerName: "Propietario / Promotor Solicitante",
            ownerPhones: [],
            ownerEmails: [],
            propertyType: "Residential/Commercial",
            estimatedProjectValue: classification.estimatedValue || 65000,
            triggerDate: dateStr,
            urgencyLevel: classification.urgency || "NORMAL",
            sourcePortal: "LOJIC GIS Metro Planning Database",
            rawDetails: classification.summarySpanish || desc,
            permitNumber: recordNum
          };

          await saveConstructionLead(lead);
          leads.push(lead);
          console.log(`  ✅ [LEAD ZONIFICACIÓN] ${lead.permitNumber} -> ${lead.rawDetails}`);
        }
      }
    }
  } catch (err: any) {
    console.warn(`[ZONING LEADS WARN] Error consultando LOJIC Planning: ${err.message}`);
  }

  return leads;
}
