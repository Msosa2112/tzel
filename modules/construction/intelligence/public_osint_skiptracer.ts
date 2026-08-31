import { searchOSINTContacts } from "../../../intelligence/osint_scraper";
import { queryLojicArcGIS } from "../../../services/lojic_gis_client";
import { classifyPhone } from "../../../intelligence/phone_classifier";
import { BatchDataClient } from "../../../scrapers/batchdata_client";
import * as dotenv from "dotenv";

dotenv.config();

export interface SkipTraceResult {
  source: "PUBLIC_OSINT" | "BATCHDATA" | "NOT_FOUND";
  ownerName?: string;
  phones: Array<{
    number: string;
    type: "MOBILE" | "LANDLINE" | "VOIP" | "UNKNOWN";
    carrier?: string;
  }>;
  emails: string[];
  currentAddress?: string;
  age?: number;
  relatives?: string[];
  photoUrls?: string[];
  isAbsentee?: boolean;
}

/**
 * Motor de Skip Tracing OSINT para Construcción y Obras Privadas.
 * 1. Resuelve el nombre del dueño catastral vía LOJIC GIS si no se suministró.
 * 2. Ejecuta búsqueda OSINT profunda (DuckDuckGo Lite / Yahoo / FastPeopleSearch).
 * 3. Clasifica líneas (📱 Móvil vs ☎️ Fijo).
 * 4. Fallback opcional a BatchData si está habilitado.
 */
export async function performCascadedSkipTrace(
  address: string,
  city: string = "Louisville",
  state: string = "KY",
  zipCode?: string,
  ownerNameHint?: string
): Promise<SkipTraceResult> {
  console.log(`\n🔍 [CONSTRUCTION SKIP TRACING] Iniciando para: "${address}", ${city}, ${state}`);

  let resolvedOwner = ownerNameHint || "";
  let photoUrls: string[] = [];
  let isAbsentee = false;

  // Paso 1: Si no hay nombre de dueño y es KY/Jefferson, consultar LOJIC GIS
  if ((!resolvedOwner || resolvedOwner.toLowerCase().includes("propietario") || resolvedOwner.toLowerCase() === "unknown") && state.toUpperCase() === "KY") {
    try {
      const lojicInfo = await queryLojicArcGIS(address);
      if (lojicInfo && lojicInfo.ownerName) {
        resolvedOwner = lojicInfo.ownerName;
        isAbsentee = lojicInfo.isAbsentee;
        if (lojicInfo.photoUrl) photoUrls.push(lojicInfo.photoUrl);
        console.log(`  🏛️ [LOJIC GIS] Dueño catastral identificado: "${resolvedOwner}" (Absentee: ${isAbsentee ? "SÍ" : "NO"})`);
      }
    } catch (lojicErr: any) {
      console.warn(`  ⚠️ [LOJIC GIS WARN] ${lojicErr.message}`);
    }
  }

  // Paso 2: Si tenemos nombre de dueño, ejecutar motor OSINT con Playwright Stealth
  if (resolvedOwner && !resolvedOwner.toLowerCase().includes("propietario") && resolvedOwner.toLowerCase() !== "unknown") {
    try {
      console.log(`  🌐 [OSINT DEEP SEARCH] Buscando contactos para: "${resolvedOwner}" en ${address}...`);
      const osintRes = await searchOSINTContacts(resolvedOwner, address, state, city);
      
      if (osintRes && (osintRes.phones.length > 0 || osintRes.emails.length > 0)) {
        const classifiedPhones = osintRes.phones.map(p => {
          const classified = classifyPhone(p);
          return {
            number: classified.formatted || p,
            type: classified.type
          };
        });

        console.log(`  🎉 [OSINT GRATUITO ÉXITO] ${classifiedPhones.length} teléfonos extraídos para "${resolvedOwner}":`);
        classifiedPhones.forEach(p => console.log(`     ${p.type === "MOBILE" ? "📱" : "☎️"} ${p.number} (${p.type})`));

        return {
          source: "PUBLIC_OSINT",
          ownerName: resolvedOwner,
          phones: classifiedPhones,
          emails: osintRes.emails,
          currentAddress: `${address}, ${city}, ${state}`,
          photoUrls,
          isAbsentee
        };
      }
    } catch (osintErr: any) {
      console.warn(`  ⚠️ [OSINT ENGINE WARN] ${osintErr.message}`);
    }
  }

  // Paso 3: Fallback a BatchData si está habilitado por variable de entorno
  const useBatchData = process.env.USE_BATCHDATA === "true";
  if (useBatchData) {
    console.log("  💳 [TIER 2] Ejecutando consulta de respaldo en BatchData API...");
    try {
      const client = new BatchDataClient();
      const batchResult = await client.lookupPropertyAllAttributes([
        {
          address: {
            street: address,
            city: city,
            state: state,
            zip: zipCode || "40202"
          }
        }
      ]);

      if (batchResult && batchResult.results && batchResult.results.length > 0) {
        const prop = batchResult.results[0];
        const phones: Array<{ number: string; type: "MOBILE" | "LANDLINE"; carrier?: string }> = [];
        if (prop.phones) {
          prop.phones.forEach((p: any) => {
            phones.push({
              number: p.number || p,
              type: p.type === "Mobile" ? "MOBILE" : "LANDLINE"
            });
          });
        }

        return {
          source: "BATCHDATA",
          ownerName: prop.owners?.[0]?.fullName || resolvedOwner,
          phones,
          emails: prop.emails || [],
          currentAddress: `${address}, ${city}, ${state}`,
          photoUrls,
          isAbsentee
        };
      }
    } catch (batchErr: any) {
      console.warn(`  ⚠️ [BATCHDATA ERR] ${batchErr.message}`);
    }
  }

  return {
    source: "NOT_FOUND",
    ownerName: resolvedOwner || ownerNameHint,
    phones: [],
    emails: [],
    photoUrls,
    isAbsentee
  };
}
