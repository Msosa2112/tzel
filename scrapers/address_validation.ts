import axios from "axios";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Valida y estandariza una dirección física usando la API de Address Validation de Google.
 * Si no hay API Key configurada o la llamada falla, devuelve la dirección original intacta.
 * 
 * @param rawAddress Dirección sin formatear (ej. "456 oak lousville")
 * @param defaultState Estado por defecto ("KY" o "IN") para contextualizar la búsqueda
 */
export async function validateAndCleanAddress(
  rawAddress: string,
  defaultState: string = "KY"
): Promise<string> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.log(`[ADDRESS VALIDATOR] No se detectó GOOGLE_MAPS_API_KEY en el entorno. Devolviendo dirección original.`);
    return rawAddress;
  }

  if (!rawAddress || rawAddress.trim().length < 4) {
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
