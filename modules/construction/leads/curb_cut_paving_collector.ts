import axios from "axios";
import { ConstructionLead } from "../types";
import { saveConstructionLead } from "../db_construction";
import * as crypto from "crypto";

/**
 * Recolector de Permisos de Corte de Acera / Acceso Vehicular (Curb Cut & Driveway Permits)
 * Oportunidades directas de pavimentación de asfalto, concreto estampado y entradas de autos.
 */
export async function collectCurbCutPavingLeads(): Promise<ConstructionLead[]> {
  console.log("\n[LEADS] Consultando permisos de corte de acera y pavimentación (Public Works)...");
  const leads: ConstructionLead[] = [];

  try {
    const endpoint = "https://data.louisvilleky.gov/api/explore/v2.1/catalog/datasets/right-of-way-permits/records?where=permit_type%20LIKE%20'%25CURB%25'%20OR%20permit_type%20LIKE%20'%25DRIVEWAY%25'&limit=15&order_by=issue_date%20desc";
    const response = await axios.get(endpoint, { timeout: 10000 }).catch(() => null);

    if (response && response.data && response.data.results) {
      for (const record of response.data.results) {
        const address = record.location || record.address || "";
        const permitId = record.permit_id || record.permit_number || "";

        if (address) {
          const leadId = `LEAD_PAVING_${crypto.createHash("md5").update(permitId + address).digest("hex").substring(0, 12)}`;
          const lead: ConstructionLead = {
            leadId,
            category: "CONCRETE_ASPHALT_PAVING",
            triggerEvent: "CURB_CUT_PAVING_PERMIT",
            address,
            county: "Jefferson",
            state: "KY",
            ownerName: record.applicant_name || "Propietario / Contratista Solicitante",
            ownerPhones: [],
            ownerEmails: [],
            propertyType: "Residential/Commercial",
            estimatedProjectValue: 12500,
            triggerDate: record.issue_date || new Date().toISOString(),
            urgencyLevel: "HIGH",
            sourcePortal: "Louisville Public Works Right-of-Way",
            rawDetails: `Permiso de corte de banqueta / acceso vial otorgado (${permitId}). Listo para vaciado de concreto, pavimentación de entrada o estacionamiento.`,
            permitNumber: permitId
          };

          await saveConstructionLead(lead);
          leads.push(lead);
          console.log(`  ✅ [LEAD CONCRETO & ASFALTO] ${lead.address} (Permiso: ${permitId})`);
        }
      }
    }
  } catch (err: any) {
    console.warn(`[PAVING LEADS WARN] Error consultando permisos de pavimentación: ${err.message}`);
  }

  return leads;
}
