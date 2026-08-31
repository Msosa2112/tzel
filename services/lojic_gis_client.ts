import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

export interface LojicPropertyInfo {
  parcelId: string | null;
  lrsn: number | null;
  standardAddress: string | null;
  ownerName: string | null;
  mailingAddress: string | null;
  mailingCsz: string | null;
  isAbsentee: boolean;
  totalValue: number | null;
  photoUrl: string | null;
  lat: number | null;
  lon: number | null;
}

/**
 * Normaliza dirección para consulta SQL en ArcGIS REST
 */
function cleanAddressForQuery(address: string): string {
  let part1 = address.split(",")[0].trim().toUpperCase();
  // Quitar apt/unit
  part1 = part1.replace(/\s+(APT|UNIT|STE|SUITE|#)\s*.*$/i, "").trim();
  // Tomar los primeros 3 términos (ej. "2715 W KENTUCKY")
  const words = part1.split(/\s+/).slice(0, 3).join(" ");
  return words;
}

/**
 * Consulta la API pública de LOJIC ArcGIS REST para el condado de Jefferson, KY.
 */
export async function queryLojicArcGIS(address: string): Promise<LojicPropertyInfo | null> {
  const queryStr = cleanAddressForQuery(address);
  if (!queryStr) return null;

  try {
    // 1. Capa de Direcciones (OpenDataAddresses MapServer 0)
    const addrUrl = "https://gis.lojic.org/maps/rest/services/LojicSolutions/OpenDataAddresses/MapServer/0/query";
    const addrResp = await axios.get(addrUrl, {
      params: {
        where: `FULL_ADDRESS LIKE '${queryStr}%'`,
        outFields: "*",
        f: "json",
        returnGeometry: "true"
      },
      timeout: 8000
    });

    if (addrResp.status !== 200 || !addrResp.data?.features?.length) {
      return null;
    }

    const addrFeature = addrResp.data.features[0];
    const attrs = addrFeature.attributes || {};
    const parcelId = attrs.PARCELID || attrs.PIN || null;
    const standardAddress = attrs.FULL_ADDRESS || address;

    let lat = null;
    let lon = null;
    if (addrFeature.geometry) {
      // Coordenadas ArcGIS
      lat = addrFeature.geometry.y || null;
      lon = addrFeature.geometry.x || null;
    }

    let lrsn: number | null = null;
    let ownerName: string | null = null;
    let mailingAddress: string | null = null;
    let mailingCsz: string | null = null;
    let isAbsentee = false;
    let totalValue: number | null = null;

    // 2. Capa PVA (OpenDataPVA MapServer 1)
    if (parcelId) {
      const pvaUrl = "https://gis.lojic.org/maps/rest/services/LojicSolutions/OpenDataPVA/MapServer/1/query";
      const pvaResp = await axios.get(pvaUrl, {
        params: {
          where: `PARCELID = '${parcelId}'`,
          outFields: "*",
          f: "json"
        },
        timeout: 8000
      });

      if (pvaResp.status === 200 && pvaResp.data?.features?.length) {
        const pvaAttrs = pvaResp.data.features[0].attributes || {};
        lrsn = pvaAttrs.LRSN || null;
        ownerName = pvaAttrs.OWNER1 || null;
        mailingAddress = pvaAttrs.MAIL_ADDRESS || null;
        mailingCsz = pvaAttrs.MAIL_CSZ || null;
        totalValue = pvaAttrs.TOTALVALUE || pvaAttrs.ASSESSEDVALUE || null;

        // Detección de Absentee Owner
        if (mailingAddress) {
          const cleanPropAddr = address.toLowerCase().replace(/[^a-z0-9]/g, "");
          const cleanMailAddr = mailingAddress.toLowerCase().replace(/[^a-z0-9]/g, "");
          
          if (!cleanMailAddr.includes(cleanPropAddr.substring(0, 8))) {
            isAbsentee = true;
          }
          if (mailingCsz && (!mailingCsz.toUpperCase().includes("KY") || !mailingCsz.toUpperCase().includes("402"))) {
            isAbsentee = true;
          }
        }
      }
    }

    const photoUrl = parcelId ? `https://jeffersonpva.ky.gov/images/parcels/${parcelId}.jpg` : null;

    return {
      parcelId,
      lrsn,
      standardAddress,
      ownerName,
      mailingAddress: mailingAddress ? `${mailingAddress}, ${mailingCsz || ""}`.trim() : null,
      mailingCsz,
      isAbsentee,
      totalValue,
      photoUrl,
      lat,
      lon
    };

  } catch (error: any) {
    console.warn(`[LOJIC GIS ERROR] No se pudo consultar LOJIC para "${address}":`, error.message);
    return null;
  }
}

// Prueba directa si se ejecuta solo
if (require.main === module) {
  queryLojicArcGIS("2715 W Kentucky St, Louisville, KY 40211").then(res => {
    console.log("Resultado LOJIC GIS:", JSON.stringify(res, null, 2));
  });
}
