import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

const addressCache = new Map<string, string>();

/**
 * Valida y estandariza una dirección física usando la API de Address Validation de Google.
 * Si no hay API Key configurada o la llamada falla, devuelve la dirección original intacta.
 */
export async function validateAndCleanAddress(
  rawAddress: string,
  defaultState: string = "KY"
): Promise<string> {
  if (!rawAddress || rawAddress.trim().length < 4) {
    return rawAddress;
  }

  const normalizedKey = rawAddress.trim().toLowerCase();
  if (addressCache.has(normalizedKey)) {
    return addressCache.get(normalizedKey)!;
  }

  // Si ya tiene un formato estándar con código postal de 5 dígitos y estado, no desperdiciar cuota de Google
  if (/\b\d{5}\b/.test(rawAddress) && (rawAddress.includes(" KY") || rawAddress.includes(", KY") || rawAddress.includes(" IN") || rawAddress.includes(", IN"))) {
    addressCache.set(normalizedKey, rawAddress.trim());
    return rawAddress.trim();
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return rawAddress;
  }

  // Si no contiene el estado, lo agregamos para ayudar al geolocalizador de Google
  let addressQuery = rawAddress;
  const upperAddr = rawAddress.toUpperCase();
  if (!upperAddr.includes(` ${defaultState} `) && !upperAddr.endsWith(` ${defaultState}`)) {
    addressQuery = `${rawAddress}, ${defaultState}`;
  }

  try {
    console.log(`[ADDRESS VALIDATOR] Validando dirección con Google: "${rawAddress}"...`);
    const url = `https://addressvalidation.googleapis.com/v1:validateAddress?key=${apiKey}`;
    
    const response = await axios.post(
      url,
      {
        address: {
          addressLines: [addressQuery]
        }
      },
      {
        headers: { "Content-Type": "application/json" },
        timeout: 10000
      }
    );

    const formattedAddress = response.data?.result?.address?.formattedAddress;
    if (formattedAddress) {
      // Limpiar el sufijo de país ", USA" para mantener consistencia regional
      const cleanAddress = formattedAddress.replace(/,\s*USA$/i, "").trim();
      console.log(`[ADDRESS VALIDATOR SUCCESS] Dirección corregida: "${cleanAddress}"`);
      return cleanAddress;
    }
  } catch (err: any) {
    console.warn(`[ADDRESS VALIDATOR WARN] Falló llamada a Google Address Validation: ${err.message}. Usando original.`);
  }

  return rawAddress;
}

// Bucle de testeo si se corre directamente
if (require.main === module) {
  (async () => {
    const test1 = await validateAndCleanAddress("456 oak lousville");
    console.log(`Resultado 1: "${test1}"`);

    const test2 = await validateAndCleanAddress("808 poplar new albany", "IN");
    console.log(`Resultado 2: "${test2}"`);
  })();
}
