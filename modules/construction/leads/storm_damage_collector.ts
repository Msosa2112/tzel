import axios from "axios";
import { ConstructionLead } from "../types";
import { saveConstructionLead } from "../db_construction";
import * as crypto from "crypto";

const TARGET_COUNTIES = ["jefferson", "oldham", "bullitt", "shelby", "clark", "floyd", "harrison", "spencer", "hardin"];

async function reverseGeocode(lat: number, lon: number): Promise<{ address: string; county: string; state: string } | null> {
  try {
    const url = "https://nominatim.openstreetmap.org/reverse";
    const response = await axios.get(url, {
      params: { lat, lon, format: "json", zoom: 18, addressdetails: 1 },
      headers: { "User-Agent": "TZEL-Storm-Damage/1.0" },
      timeout: 8000
    }).catch(() => null);

    if (response && response.data && response.data.address) {
      const addr = response.data.address;
      const house = addr.house_number || "";
      const road = addr.road || "";
      const city = addr.city || addr.town || addr.village || "Louisville";
      let state = addr.state || "KY";
      let county = (addr.county || "Jefferson").replace(/ county/i, "").trim();

      if (state.toLowerCase().includes("kentucky")) state = "KY";
      if (state.toLowerCase().includes("indiana")) state = "IN";

      const street = `${house} ${road}`.trim();
      if (street) {
        return {
          address: `${street}, ${city}, ${state}`,
          county,
          state
        };
      }
    }
  } catch (err: any) {
    console.warn(`[REVERSE GEOCODE WARN] ${err.message}`);
  }

  // Fallback con coordenadas
  return {
    address: `Zona de Impacto Tormenta (${lat.toFixed(4)}, ${lon.toFixed(4)})`,
    county: "Jefferson",
    state: "KY"
  };
}

/**
 * Recolector de Daños por Tormentas y Granizo (NOAA DAT + NWS IEM Local Storm Reports)
 * Detecta techos arrancados, tejas rotas por granizo > 1" y daños por viento en KY y Sur de IN.
 * Son trabajos de techado y revestimiento pagados 100% por la aseguradora del hogar.
 */
export async function collectStormDamageLeads(): Promise<ConstructionLead[]> {
  console.log("\n=================================================================");
  console.log("🌪️ ESCÁNER NOAA / NWS: DAÑOS POR TORMENTAS RECIENTES (KY & IN) 🌪️");
  console.log("=================================================================\n");

  const leads: ConstructionLead[] = [];
  const seenIds = new Set<string>();

  // =========================================================================
  // 1. REPORTE EN TIEMPO REAL NWS IEM (ÚLTIMAS 24-72 HORAS - TORMENTA DE AYER)
  // =========================================================================
  try {
    console.log("📡 Consultando reportes NWS LSR de tormentas recientes (Louisville LMK & Indiana IND)...");
    const lsrUrl = "https://mesonet.agron.iastate.edu/geojson/lsr.php";
    const lsrRes = await axios.get(lsrUrl, {
      params: { wfo: "LMK,IND", recent: 172800 }, // Últimas 48 horas
      timeout: 15000
    }).catch(() => null);

    if (lsrRes && lsrRes.data && lsrRes.data.features) {
      console.log(`   📥 ${lsrRes.data.features.length} reportes de tormenta NWS detectados en las últimas 48h.`);

      for (const feat of lsrRes.data.features) {
        const props = feat.properties || {};
        const coords = feat.geometry?.coordinates || [];
        const lon = coords[0];
        const lat = coords[1];

        const type = (props.typetext || "").toUpperCase();
        const remark = props.remark || props.city || "Daños por tormenta / granizo / viento severo";
        const city = props.city || "Louisville";
        const state = props.state || "KY";
        const validDate = props.valid ? props.valid.split("T")[0] : new Date().toISOString().split("T")[0];

        // Filtrar eventos con daño a techos, árboles caídos, viento destructivo o granizo
        const isRoofDamageEvent =
          type.includes("HAIL") ||
          type.includes("WIND") ||
          type.includes("TORNADO") ||
          type.includes("DAMAGE") ||
          remark.toLowerCase().includes("roof") ||
          remark.toLowerCase().includes("tree") ||
          remark.toLowerCase().includes("structural");

        if (lat && lon && isRoofDamageEvent) {
          const leadId = `LEAD_STORM_LSR_${crypto.createHash("md5").update(`${lat}_${lon}_${validDate}`).digest("hex").substring(0, 12)}`;

          if (!seenIds.has(leadId)) {
            seenIds.add(leadId);

            const geo = await reverseGeocode(lat, lon);
            const address = geo ? geo.address : `${city}, ${state}`;
            const county = geo ? geo.county : "Jefferson";

            // Skip Tracing OSINT Gratuito
            let ownerName = "Propietario de Vivienda";
            let ownerPhones: string[] = [];
            let ownerEmails: string[] = [];

            try {
              const { performCascadedSkipTrace } = await import("../intelligence/public_osint_skiptracer");
              const skipRes = await performCascadedSkipTrace(address, city, state);
              if (skipRes) {
                if (skipRes.ownerName) ownerName = skipRes.ownerName;
                if (skipRes.phones.length > 0) ownerPhones = skipRes.phones.map(p => p.number);
                if (skipRes.emails.length > 0) ownerEmails = skipRes.emails;
              }
            } catch {}

            const lead: ConstructionLead = {
              leadId,
              category: "ROOFING_SIDING_GUTTERS",
              triggerEvent: "STORM_HAIL_DAMAGE",
              address,
              county,
              state,
              ownerName,
              ownerPhones,
              ownerEmails,
              propertyType: "Residential",
              estimatedProjectValue: 19500,
              triggerDate: validDate,
              urgencyLevel: "CRITICAL",
              sourcePortal: `NWS Louisville/Indiana Storm Report (${type})`,
              rawDetails: `🚨 REPORTE DE TORMENTA RECIENTE NWS: "${type}" en ${city}, ${state}. Detalles: ${remark}. Daños en techos y fachadas con alta probabilidad de reclamo a aseguradora.`,
              insurancePayerLikely: true
            };

            await saveConstructionLead(lead);

            try {
              const { syncLeadToBarbaPro } = await import("../integrations/barbapro_bridge");
              await syncLeadToBarbaPro(lead);
            } catch {}

            leads.push(lead);
            console.log(`  🌪️ [TORMENTA RECIENTE] ${address} | ${type} | Dueño: ${ownerName} | Tel: ${ownerPhones[0] || 'N/A'}`);
          }
        }
      }
    }
  } catch (lsrErr: any) {
    console.warn(`[NWS LSR WARN] Error consultando reportes recientes: ${lsrErr.message}`);
  }

  // =========================================================================
  // 2. RADAR HISTÓRICO NOAA DAMAGE ASSESSMENT TOOLKIT (ARCGIS)
  // =========================================================================
  const daysLimit = 180;
  const dateLimit = new Date();
  dateLimit.setDate(dateLimit.getDate() - daysLimit);
  const formattedDate = dateLimit.toISOString().split("T")[0];

  const datUrl = "https://services.dat.noaa.gov/arcgis/rest/services/nws_damageassessmenttoolkit/DamageViewer/FeatureServer/0/query";

  try {
    const response = await axios.get(datUrl, {
      params: {
        where: `stormdate >= DATE '${formattedDate}' AND office IN ('LMK', 'IND')`,
        outFields: "*",
        orderByFields: "stormdate DESC",
        resultRecordCount: 100,
        f: "json"
      },
      timeout: 20000
    }).catch(() => null);

    if (response && response.data && response.data.features) {
      for (const feat of response.data.features) {
        const attr = feat.attributes || {};
        const geom = feat.geometry || {};
        const lat = geom.y || attr.lat;
        const lon = geom.x || attr.lon;

        const comments = attr.comments || attr.event_type || "Daño por viento severo o granizo";
        const damageType = attr.damagetype || attr.event_type || "TORNADO / HAIL / WIND";
        const stormDate = attr.stormdate ? new Date(attr.stormdate).toISOString().split("T")[0] : formattedDate;

        if (lat && lon) {
          const leadId = `LEAD_STORM_${crypto.createHash("md5").update(`${lat}_${lon}_${stormDate}`).digest("hex").substring(0, 12)}`;

          if (!seenIds.has(leadId)) {
            seenIds.add(leadId);

            const geo = await reverseGeocode(lat, lon);
            if (geo && (TARGET_COUNTIES.includes(geo.county.toLowerCase()) || geo.state === "KY" || geo.state === "IN")) {
              let ownerName = "Propietario del Inmueble";
              let ownerPhones: string[] = [];
              let ownerEmails: string[] = [];

              try {
                const { performCascadedSkipTrace } = await import("../intelligence/public_osint_skiptracer");
                const skipRes = await performCascadedSkipTrace(geo.address, "Louisville", geo.state);
                if (skipRes) {
                  if (skipRes.ownerName) ownerName = skipRes.ownerName;
                  if (skipRes.phones.length > 0) ownerPhones = skipRes.phones.map(p => p.number);
                  if (skipRes.emails.length > 0) ownerEmails = skipRes.emails;
                }
              } catch {}

              const lead: ConstructionLead = {
                leadId,
                category: "ROOFING_SIDING_GUTTERS",
                triggerEvent: "STORM_HAIL_DAMAGE",
                address: geo.address,
                county: geo.county,
                state: geo.state,
                ownerName,
                ownerPhones,
                ownerEmails,
                propertyType: "Residential",
                estimatedProjectValue: 18500,
                triggerDate: stormDate,
                urgencyLevel: "HIGH",
                sourcePortal: "NOAA / National Weather Service (LMK/IND)",
                rawDetails: `Reporte de tormenta oficial NOAA (${damageType}): ${comments}. Techo y fachada dañados. 100% reclamable a póliza de seguro.`,
                insurancePayerLikely: true
              };

              await saveConstructionLead(lead);

              try {
                const { syncLeadToBarbaPro } = await import("../integrations/barbapro_bridge");
                await syncLeadToBarbaPro(lead);
              } catch {}

              leads.push(lead);
              console.log(`  🌪️ [NOAA HISTÓRICO] ${lead.address} | Dueño: ${ownerName} | Tel: ${ownerPhones[0] || 'N/A'}`);
            }
          }
        }
      }
    }
  } catch (err: any) {
    console.warn(`[STORM LEADS WARN] Error consultando NOAA DAT: ${err.message}`);
  }

  console.log(`\n📊 [STORM RESUMEN] ${leads.length} leads de techos y tormentas capturados.`);
  return leads;
}
