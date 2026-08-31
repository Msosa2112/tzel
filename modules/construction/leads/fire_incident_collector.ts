import axios from "axios";
import { ConstructionLead } from "../types";
import { saveConstructionLead } from "../db_construction";
import * as crypto from "crypto";

/**
 * Recolector de Incidentes de Bomberos / Siniestros Menores (Fire & Water Restoration)
 * Daños contenidos por fuego/humo o rotura de tuberías cubiertos 100% por póliza de seguro de hogar.
 */
export async function collectFireIncidentLeads(): Promise<ConstructionLead[]> {
  console.log("\n[LEADS] Consultando despachos de bomberos e incidentes de siniestro (Louisville Fire / Clark)...");
  const leads: ConstructionLead[] = [];

  try {
    const endpoint = "https://data.louisvilleky.gov/api/explore/v2.1/catalog/datasets/fire-incident-dispatch-data/records?where=incident_type%20LIKE%20'%25FIRE%25'%20OR%20incident_type%20LIKE%20'%25WATER%25'&limit=15&order_by=dispatch_time%20desc";
    const response = await axios.get(endpoint, { timeout: 10000 }).catch(() => null);

    if (response && response.data && response.data.results) {
      for (const record of response.data.results) {
        const address = record.address || record.street_name || "";
        const incidentId = record.incident_number || record.id || "";
        const type = record.incident_type || "Siniestro de vivienda";

        if (address && address.length > 5) {
          const leadId = `LEAD_RESTORE_${crypto.createHash("md5").update(incidentId + address).digest("hex").substring(0, 12)}`;
          const lead: ConstructionLead = {
            leadId,
            category: "FIRE_WATER_REBUILD",
            triggerEvent: "FIRE_WATER_RESTORATION",
            address,
            county: "Jefferson",
            state: "KY",
            ownerName: "Propietario Residente Siniestrado",
            ownerPhones: [],
            ownerEmails: [],
            propertyType: "Residential",
            estimatedProjectValue: 35000,
            triggerDate: record.dispatch_time || new Date().toISOString(),
            urgencyLevel: "CRITICAL",
            sourcePortal: "Louisville Fire Incident Log",
            rawDetails: `Incidente de bomberos registrado (${type}). Inmueble con daños de estructura/acabados por agua, humo o fuego. 100% financiable vía seguro de hogar.`,
            permitNumber: incidentId,
            insurancePayerLikely: true
          };

          await saveConstructionLead(lead);
          leads.push(lead);
          console.log(`  ✅ [LEAD RECONSTRUCCIÓN / SINIESTRO] ${lead.address} (Incidente: ${incidentId})`);
        }
      }
    }
  } catch (err: any) {
    console.warn(`[FIRE LEADS WARN] Error consultando incidentes de bomberos: ${err.message}`);
  }

  return leads;
}
