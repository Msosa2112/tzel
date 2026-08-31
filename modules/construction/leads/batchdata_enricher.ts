import axios from "axios";
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
      for (const p of person.phoneNumbers) {
        if (p.number) {
          const raw = String(p.number).replace(/\D/g, "");
          if (raw.length === 10) {
            phoneNumbers.push(`(${raw.slice(0, 3)}) ${raw.slice(3, 6)}-${raw.slice(6)}`);
          } else if (raw.length === 11 && raw.startsWith("1")) {
            phoneNumbers.push(`(${raw.slice(1, 4)}) ${raw.slice(4, 7)}-${raw.slice(7)}`);
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
