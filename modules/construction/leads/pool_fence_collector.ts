import axios from "axios";
import { ConstructionLead } from "../types";
import { saveConstructionLead } from "../db_construction";
import * as crypto from "crypto";

/**
 * Recolector de Permisos de Piscinas Residenciales (Pool Permits & Enclosure Mandate)
 * La ley municipal en KY/IN obliga a que cada alberca construida tenga una cerca de seguridad de 4-6 pies antes de la inspección final.
 */
export async function collectPoolFenceLeads(): Promise<ConstructionLead[]> {
  console.log("\n[LEADS] Consultando permisos de albercas/piscinas (Cercado Perimetral Obligatorio)...");
  const leads: ConstructionLead[] = [];

  try {
    const endpoint = "https://data.louisvilleky.gov/api/explore/v2.1/catalog/datasets/building-permits/records?where=description%20LIKE%20'%25POOL%25'%20OR%20description%20LIKE%20'%25SWIMMING%25'&limit=15&order_by=issue_date%20desc";
    const response = await axios.get(endpoint, { timeout: 10000 }).catch(() => null);

    if (response && response.data && response.data.results) {
      for (const record of response.data.results) {
        const address = record.street_address || record.site_address || "";
        const permitNo = record.permit_number || "";

        if (address) {
          const leadId = `LEAD_FENCE_${crypto.createHash("md5").update(permitNo + address).digest("hex").substring(0, 12)}`;
          const lead: ConstructionLead = {
            leadId,
            category: "FENCE_PERIMETER_SECURITY",
            triggerEvent: "POOL_FENCE_MANDATE",
            address,
            county: "Jefferson",
            state: "KY",
            ownerName: record.owner_name || "Propietario Residencial",
            ownerPhones: [],
            ownerEmails: [],
            propertyType: "Residential",
            estimatedProjectValue: 6500, // Costo promedio de cerca perimetral con portón de seguridad
            triggerDate: record.issue_date || new Date().toISOString(),
            urgencyLevel: "HIGH",
            sourcePortal: "Louisville Building Permits (Pool Division)",
            rawDetails: `Permiso de piscina otorgado (${permitNo}). Obligación por código municipal de instalar cercado perimetral de seguridad (4-6ft) con puerta de cierre automático.`,
            permitNumber: permitNo
          };

          await saveConstructionLead(lead);
          leads.push(lead);
          console.log(`  ✅ [LEAD CERCAS & PERÍMETRO] ${lead.address} (Alberca: ${permitNo})`);
        }
      }
    }
  } catch (err: any) {
    console.warn(`[FENCE LEADS WARN] Error consultando permisos de albercas: ${err.message}`);
  }

  return leads;
}
