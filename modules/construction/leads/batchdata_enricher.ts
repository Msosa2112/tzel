import axios from "axios";
import { isValidReachableUSPhone, formatPhoneUs, normalizePhoneNumber } from "../../../intelligence/phone_classifier";
import * as dotenv from "dotenv";

dotenv.config();

const API_KEY = process.env.SKIP_TRACE_API_KEY || process.env.BATCHDATA_API_KEY || "";

export interface EnrichedOwnerData {
  matched: boolean;
  ownerName: string;
  primaryPhone: string | null;
  allPhones: string[];
  primaryEmail: string | null;
  isAbsenteeOwner: boolean;
  mailingAddress?: string;
}

export async function enrichPropertyWithBatchData(
  fullAddress: string
): Promise<EnrichedOwnerData | null> {
  if (process.env.USE_BATCHDATA === "false") {
    console.log("  ℹ️ [BATCHDATA OMITIDO] 'USE_BATCHDATA=false' - Sin costo generado.");
    return null;
  }

  if (!API_KEY) {
    console.warn("  ⚠️ [BATCHDATA] No se encontró API KEY.");
    return null;
  }

  // Parsear dirección
  // Ejemplo: "808 BROOKLINE AVE, LOUISVILLE, KY 40215"
  const parts = fullAddress.split(",").map((s) => s.trim());
  const street = parts[0] || "";
  const city = parts[1] || "Louisville";
  let state = "KY";
  let zip = "40202";

  if (parts[2]) {
    const stateZip = parts[2].trim().split(/\s+/);
    state = stateZip[0] || "KY";
    zip = stateZip[1] || "40202";
  }

  try {
    const response = await axios.post(
      "https://api.batchdata.com/api/v1/property/skip-trace",
      {
        requests: [
          {
            propertyAddress: {
              street,
              city,
              state,
              zip
            }
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 12000
      }
    );

    const person = response.data?.results?.persons?.[0];
    if (!person || !person.meta?.matched) {
      return null;
    }

    const ownerName =
      person.name?.full ||
      `${person.name?.first || ""} ${person.name?.last || ""}`.trim() ||
      person.property?.owner?.name?.full ||
      "Propietario";

    const phoneNumbers: string[] = [];
    if (Array.isArray(person.phoneNumbers)) {
      // Ordenar: Móviles primero, luego por score de confianza descendente
      const sortedPhones = [...person.phoneNumbers].sort((a, b) => {
        const aIsMobile = (a.type || "").toLowerCase().includes("mobile") || (a.type || "").toLowerCase().includes("cell");
        const bIsMobile = (b.type || "").toLowerCase().includes("mobile") || (b.type || "").toLowerCase().includes("cell");
        const aScore = (a.score || 50) + (aIsMobile ? 100 : 0) + (a.reachable ? 20 : 0);
        const bScore = (b.score || 50) + (bIsMobile ? 100 : 0) + (b.reachable ? 20 : 0);
        return bScore - aScore;
      });

      for (const p of sortedPhones) {
        if (p.number) {
          const raw = String(p.number).replace(/\D/g, "");
          if (isValidReachableUSPhone(raw)) {
            const formatted = formatPhoneUs(normalizePhoneNumber(raw));
            if (!phoneNumbers.includes(formatted)) {
              phoneNumbers.push(formatted);
            }
          }
        }
      }
    }

    const primaryPhone = phoneNumbers[0] || null;
    const primaryEmail = person.emails?.[0]?.email || null;

    const propStreet = (person.propertyAddress?.street || "").toLowerCase();
    const mailStreet = (person.mailingAddress?.street || "").toLowerCase();
    const isAbsenteeOwner = !!mailStreet && mailStreet !== propStreet;
    const mailingAddress = person.mailingAddress
      ? `${person.mailingAddress.street}, ${person.mailingAddress.city}, ${person.mailingAddress.state} ${person.mailingAddress.zip}`
      : undefined;

    return {
      matched: true,
      ownerName,
      primaryPhone,
      allPhones: phoneNumbers,
      primaryEmail,
      isAbsenteeOwner,
      mailingAddress
    };
  } catch (err: any) {
    console.warn(`  ⚠️ [BATCHDATA ERR] Error consultando "${fullAddress}":`, err.response?.data?.message || err.message);
    return null;
  }
}
