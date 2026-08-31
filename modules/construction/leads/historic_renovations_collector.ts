import axios from "axios";
import { ConstructionLead } from "../types";
import { saveConstructionLead } from "../db_construction";
import * as crypto from "crypto";

/**
 * Recolector de Aprobaciones de Distritos Históricos (Historic Landmarks Commission)
 * Zonas de alto valor (Old Louisville, Highlands, Cherokee, New Albany) con reformas autorizadas de alto presupuesto.
 */
export async function collectHistoricRenovationLeads(): Promise<ConstructionLead[]> {
  console.log("\n[LEADS] Consultando aprobaciones de la Comisión de Distritos Históricos (Landmarks)...");
  const leads: ConstructionLead[] = [];

  try {
    const endpoint = "https://data.louisvilleky.gov/api/explore/v2.1/catalog/datasets/landmarks-commission-cases/records?limit=15&order_by=date_filed%20desc";
    const response = await axios.get(endpoint, { timeout: 10000 }).catch(() => null);

    if (response && response.data && response.data.results) {
      for (const record of response.data.results) {
        const address = record.address || record.street_address || "";
        const caseNo = record.case_number || "";
        const scope = record.scope_of_work || record.description || "Restauración arquitectónica";

        if (address) {
          const leadId = `LEAD_HISTORIC_${crypto.createHash("md5").update(caseNo + address).digest("hex").substring(0, 12)}`;
          const lead: ConstructionLead = {
            leadId,
            category: "RENOVATION_REMODEL",
            triggerEvent: "HISTORIC_LANDMARK_APPROVAL",
            address,
            county: "Jefferson",
            state: "KY",
            ownerName: record.owner_applicant || "Propietario de Inmueble Histórico",
            ownerPhones: [],
            ownerEmails: [],
            propertyType: "Historic_Residential",
            estimatedProjectValue: 55000,
            triggerDate: record.date_filed || new Date().toISOString(),
            urgencyLevel: "NORMAL",
            sourcePortal: "Louisville Landmarks Commission",
            rawDetails: `Aprobación de restauración en distrito histórico: ${scope}. Mampostería, ventanas clásicas, techos y molduras autorizadas.`,
            permitNumber: caseNo
          };

          await saveConstructionLead(lead);
          leads.push(lead);
          console.log(`  ✅ [LEAD REFORMA HISTÓRICA] ${lead.address} (${scope})`);
        }
      }
    }
  } catch (err: any) {
    console.warn(`[HISTORIC LEADS WARN] Error consultando Landmarks: ${err.message}`);
  }

  return leads;
}
