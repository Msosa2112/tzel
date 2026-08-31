import axios from "axios";
import { ConstructionLead } from "../types";
import { saveConstructionLead } from "../db_construction";
import * as crypto from "crypto";

/**
 * Recolector de Permisos de Demolición (Demolition Permits)
 * Una demolición es el precursor directo del 90% de las obras nuevas (cimentación y estructura).
 */
export async function collectDemolitionLeads(): Promise<ConstructionLead[]> {
  console.log("\n[LEADS] Consultando permisos de demolición recientes (KY / Sur de IN)...");
  const leads: ConstructionLead[] = [];

  try {
    const endpoint = "https://data.louisvilleky.gov/api/explore/v2.1/catalog/datasets/building-permits/records?where=permit_type%20LIKE%20'%25DEMO%25'&limit=20&order_by=issue_date%20desc";
    const response = await axios.get(endpoint, { timeout: 10000 }).catch(() => null);

    if (response && response.data && response.data.results) {
      for (const record of response.data.results) {
        const address = record.street_address || record.site_address || "";
        const permitNo = record.permit_number || "";
        const owner = record.owner_name || record.contractor_name || "Propietario / Constructor";

        if (address) {
          const leadId = `LEAD_DEMO_${crypto.createHash("md5").update(permitNo + address).digest("hex").substring(0, 12)}`;
          const lead: ConstructionLead = {
            leadId,
            category: "NEW_CONSTRUCTION_GROUND_UP",
            triggerEvent: "DEMOLITION_PRE_BUILD",
            address,
            county: record.county || "Jefferson",
            state: "KY",
            ownerName: owner,
            ownerPhones: [],
            ownerEmails: [],
            propertyType: record.occupancy_type || "Residential",
            estimatedProjectValue: Number(record.job_value) || 120000,
            triggerDate: record.issue_date || new Date().toISOString(),
            urgencyLevel: "HIGH",
            sourcePortal: "Louisville Building Permits API",
            rawDetails: `Permiso de demolición otorgado (${permitNo}). Terreno en preparación para nueva edificación o ampliación estructural.`,
            permitNumber: permitNo
          };

          await saveConstructionLead(lead);
          leads.push(lead);
          console.log(`  ✅ [LEAD DEMOLICIÓN -> OBRA NUEVA] ${lead.address} (Permiso: ${permitNo})`);
        }
      }
    }
  } catch (err: any) {
    console.warn(`[DEMO LEADS WARN] Error consultando permisos de demolición: ${err.message}`);
  }

  return leads;
}
