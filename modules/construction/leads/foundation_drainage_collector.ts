import axios from "axios";
import { ConstructionLead } from "../types";
import { saveConstructionLead } from "../db_construction";
import * as crypto from "crypto";

/**
 * Recolector de Reportes de Inundación de Sótanos y Drenajes (MSD / Obras Hidráulicas)
 * Oportunidades directas de impermeabilización de sótanos, bombas de achique y reparación de cimientos.
 */
export async function collectFoundationDrainageLeads(): Promise<ConstructionLead[]> {
  console.log("\n[LEADS] Consultando reportes de drenaje e inundación de sótanos (MSD Louisville / Clark)...");
  const leads: ConstructionLead[] = [];

  try {
    const endpoint = "https://data.louisvilleky.gov/api/explore/v2.1/catalog/datasets/metro-service-requests311/records?where=service_request_type%20LIKE%20'%25Drainage%25'%20OR%20service_request_type%20LIKE%20'%25Water%25'&limit=20&order_by=requested_datetime%20desc";
    const response = await axios.get(endpoint, { timeout: 10000 }).catch(() => null);

    if (response && response.data && response.data.results) {
      for (const record of response.data.results) {
        const address = record.street_address || record.address || "";
        const serviceReq = record.service_request_id || record.id || "";
        const details = record.description || record.service_request_type || "";

        if (address && address.length > 5) {
          const leadId = `LEAD_FOUNDATION_${crypto.createHash("md5").update(serviceReq + address).digest("hex").substring(0, 12)}`;
          const lead: ConstructionLead = {
            leadId,
            category: "FOUNDATION_WATERPROOFING",
            triggerEvent: "MSD_BASEMENT_FLOOD",
            address,
            county: "Jefferson",
            state: "KY",
            ownerName: "Propietario Residente Afectado",
            ownerPhones: [],
            ownerEmails: [],
            propertyType: "Residential",
            estimatedProjectValue: 8500, // Costo promedio de impermeabilización/sump pump
            triggerDate: record.requested_datetime || new Date().toISOString(),
            urgencyLevel: "HIGH",
            sourcePortal: "Louisville Metro 311 / MSD Water Service",
            rawDetails: `Reporte de colapso de drenaje o humedad severa en sótano (${details}). Requiere impermeabilización y corrección de cimientos.`,
            permitNumber: serviceReq
          };

          await saveConstructionLead(lead);
          leads.push(lead);
          console.log(`  ✅ [LEAD CIMENTACIÓN / SÓTANO] ${lead.address} -> ${details}`);
        }
      }
    }
  } catch (err: any) {
    console.warn(`[FOUNDATION LEADS WARN] Error consultando reportes de drenaje: ${err.message}`);
  }

  return leads;
}
