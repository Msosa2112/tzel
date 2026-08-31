import axios from "axios";
import { ConstructionLead } from "../types";
import { classifyConstructionItem } from "../classifiers/gemini_construction_classifier";
import { saveConstructionLead } from "../db_construction";
import * as crypto from "crypto";

/**
 * Recolector de Casas con Órdenes de Reparación Obligatoria y Daño Estructural
 * (Code Enforcement Violations: Techos en colapso, daño por termitas/madera podrida, porches inseguros y grietas).
 */
export async function collectStructuralRepairsLeads(): Promise<ConstructionLead[]> {
  console.log("\n[LEADS] Consultando citaciones municipales por daño estructural, techos y termitas (Code Enforcement)...");
  const leads: ConstructionLead[] = [];

  try {
    // Consultar casos de construcción peligrosa y mantenimiento estructural en Louisville
    const url = "https://opendata.arcgis.com/api/v3/datasets/3df35fbf63734b4db46d90a501a35759_0/downloads/data?format=geojson";
    
    // Consulta directa a las violaciones registradas en la base de datos de habitabilidad
    const endpoint = "https://data.louisvilleky.gov/api/explore/v2.1/catalog/datasets/code-enforcement-violations/records?limit=25&order_by=date_opened%20desc";
    const response = await axios.get(endpoint, { timeout: 10000 }).catch(() => null);

    if (response && response.data && response.data.results) {
      for (const record of response.data.results) {
        const address = record.address || record.street_address || record.location || "";
        const violationDesc = record.violation_description || record.description || record.ordinance_description || "";
        const caseNumber = record.case_number || record.id || "";
        const status = record.status || "Abierto";

        if (address && violationDesc) {
          const lower = violationDesc.toLowerCase();
          // Filtrar específicamente por necesidades de obra y reformas
          const isRepair = lower.includes("roof") || lower.includes("structure") || lower.includes("foundation") ||
                           lower.includes("porch") || lower.includes("wall") || lower.includes("decay") ||
                           lower.includes("wood") || lower.includes("termite") || lower.includes("siding") ||
                           lower.includes("masonry") || lower.includes("window");

          if (isRepair) {
            const classification = await classifyConstructionItem(
              `Orden de Reparación Municipal: ${address}`,
              `Citación de Código: ${violationDesc}. Estado del caso: ${status}`,
              "Louisville Code Enforcement"
            );

            if (classification.isValidConstruction) {
              const leadId = `LEAD_REPAIR_${crypto.createHash("md5").update(caseNumber + address).digest("hex").substring(0, 12)}`;
              
              let ownerName = record.owner_name || "Propietario Inmueble Citado";
              let ownerPhones: string[] = [];
              let ownerEmails: string[] = [];

              try {
                const { performCascadedSkipTrace } = await import("../intelligence/public_osint_skiptracer");
                const skipRes = await performCascadedSkipTrace(address, "Louisville", "KY", undefined, ownerName);
                if (skipRes) {
                  if (skipRes.ownerName) ownerName = skipRes.ownerName;
                  if (skipRes.phones.length > 0) ownerPhones = skipRes.phones.map(p => `${p.type === "MOBILE" ? "📱" : "☎️"} ${p.number}`);
                  if (skipRes.emails.length > 0) ownerEmails = skipRes.emails;
                }
              } catch {}

              const lead: ConstructionLead = {
                leadId,
                category: classification.category || "RENOVATION_REMODEL",
                triggerEvent: "CODE_VIOLATION_REPAIR_ORDER",
                address,
                county: "Jefferson",
                state: "KY",
                ownerName,
                ownerPhones,
                ownerEmails,
                propertyType: "Residential",
                estimatedProjectValue: classification.estimatedValue || 15000,
                triggerDate: record.date_opened || new Date().toISOString().split("T")[0],
                urgencyLevel: "CRITICAL", // Multas diarias de la ciudad si no reparan
                sourcePortal: "Louisville Code Enforcement Violations",
                rawDetails: classification.summarySpanish || `Citación municipal por daño físico: ${violationDesc}. Multas acumulables si no se contrata reparación.`,
                permitNumber: caseNumber
              };

              await saveConstructionLead(lead);
              leads.push(lead);
              console.log(`  ✅ [LEAD REPARACIÓN OBLIGATORIA] ${lead.address} | Dueño: ${ownerName} | Tel: ${ownerPhones[0] || 'N/A'}`);
            }
          }
        }
      }
    }
  } catch (err: any) {
    console.warn(`[REPAIR LEADS WARN] Error consultando Code Enforcement: ${err.message}`);
  }

  return leads;
}
