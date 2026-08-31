import axios from "axios";

export interface AttomResult {
  success: boolean;
  totalHiddenDebt: number;
  lastRecordingDate?: string | null;
  isCashSale?: boolean;
}

/**
 * Consulta la API de Attom Data para obtener las hipotecas vigentes,
 * hipotecas secundarias y gravámenes impositivos registrados para una dirección.
 */
export async function getPropertyLiensFromAttom(address: string, zipCode: string): Promise<AttomResult> {
  const apiKey = process.env.ATTOM_API_KEY;
  if (!apiKey) {
    console.log("  [ATTOM API SKIP] No se encontró la variable de entorno ATTOM_API_KEY.");
    return { success: false, totalHiddenDebt: 0 };
  }

  const cleanAddress = address.split(",")[0].replace(/\.+$/, "").trim();

  try {
    console.log(`  [ATTOM API] Consultando registros para: "${cleanAddress}", Zip: "${zipCode}"...`);
    
    const response = await axios.get("https://api.gateway.attomdata.com/propertyapi/v1.0.0/property/detail", {
      headers: {
        "apikey": apiKey,
        "Accept": "application/json"
      },
      params: {
        address1: cleanAddress,
        address2: zipCode
      },
      timeout: 15000
    });

    const properties = response.data?.property || [];
    if (properties.length === 0) {
      console.log("  [ATTOM API] Propiedad no encontrada en la base de datos de Attom.");
      return { success: false, totalHiddenDebt: 0 };
    }

    const propertyData = properties[0];
    
    // Extracción defensiva usando opcional chaining
    const openMortgages = propertyData?.sale?.mortgage?.amount || 0;
    const secondMortgages = propertyData?.sale?.secondMortgage?.amount || 0;
    const taxLiens = propertyData?.tax?.delinquentAmount || 0;
    
    const totalHiddenDebt = openMortgages + secondMortgages + taxLiens;
    
    console.log(`  [ATTOM API SUCCESS] Deuda extraída: $${totalHiddenDebt} (Mortgages: $${openMortgages}, Second: $${secondMortgages}, Tax: $${taxLiens})`);
    
    return {
      success: true,
      totalHiddenDebt,
      lastRecordingDate: propertyData?.sale?.recordingDate || null,
      isCashSale: !!propertyData?.sale?.isCash
    };

  } catch (error: any) {
    console.error("  [ATTOM API ERROR] Error obteniendo datos de título:", error.message);
    return { success: false, totalHiddenDebt: 0 };
  }
}
