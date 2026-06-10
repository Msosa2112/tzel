import axios from "axios";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import { isHighYieldProperty } from "./underwriting/underwriter";

// Cargar variables de entorno
dotenv.config();

// Inicializar cliente de Turso DB
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

const NOISE_WORDS = new Set([
  "st", "street", "ave", "avenue", "rd", "road", "ln", "lane", "dr", "drive", 
  "ct", "court", "blvd", "boulevard", "way", "pl", "place", "hwy", "highway", 
  "rte", "route", "cir", "circle", "ter", "terrace", "trl", "trail", "pkwy", "parkway",
  "apt", "apartment", "unit", "ste", "suite", "fl", "floor", 
  "n", "north", "s", "south", "e", "east", "w", "west", 
  "ky", "in", "jefferson", "clark", "floyd"
]);

const UNIT_INDICATORS = ["apt", "unit", "ste", "suite", "#", "apartment"];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Normaliza y extrae el número de casa y palabras clave del nombre de la calle.
 */
function parseAddress(address: string): { houseNumber: string | null; coreWords: string[] } {
  // 1. Separar por coma y tomar la primera parte
  let part1 = address.split(",")[0].trim().toLowerCase();
  
  // 2. Truncar en indicadores de unidad
  for (const indicator of UNIT_INDICATORS) {
    const idx = part1.indexOf(indicator);
    if (idx !== -1) {
      part1 = part1.substring(0, idx).trim();
    }
  }
  
  // 3. Remover caracteres no alfanuméricos
  part1 = part1.replace(/[^a-z0-9\s]/g, " ");
  
  // 4. Separar en palabras
  const words = part1.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) {
    return { houseNumber: null, coreWords: [] };
  }
  
  // 5. Extraer número de casa (primer elemento si empieza con dígito)
  let houseNumber: string | null = null;
  let streetStartIndex = 0;
  
  if (/^\d+/.test(words[0])) {
    houseNumber = words[0];
    streetStartIndex = 1;
  }
  
  // 6. Extraer palabras clave de la calle
  const coreWords: string[] = [];
  for (let i = streetStartIndex; i < words.length; i++) {
    const w = words[i];
    // Excluir palabras de ruido y códigos postales (5 dígitos)
    if (NOISE_WORDS.has(w)) continue;
    if (/^\d{5}$/.test(w)) continue;
    coreWords.push(w);
  }
  
  return { houseNumber, coreWords };
}

/**
 * Descarga el handbill (.doc) de Jefferson County y extrae la deuda.
 */
async function fetchDebtAmount(caseNumber: string): Promise<number | null> {
  const url = `https://www.jeffcomm.org/docs/handbill/${caseNumber}.doc`;
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      },
      timeout: 10000
    });
    
    const buffer = Buffer.from(response.data);
    const text = buffer.toString("latin1");
    
    const regex = /amount to be raised by the judgment is \$([0-9,]+(?:\.[0-9]{2})?)/i;
    const match = text.match(regex);
    if (match) {
      const amountStr = match[1].replace(/,/g, "");
      const amount = parseFloat(amountStr);
      if (!isNaN(amount)) {
        return amount;
      }
    }
  } catch (err: any) {
    console.log(`[HANDBILL] No se pudo obtener la deuda para el caso ${caseNumber}: ${err.message}`);
  }
  return null;
}

/**
 * Calcula el Valor Comercial Real (ARV) promediando propiedades vendidas recientemente (Closed)
 * con características similares (mismo ZIP, +/- 1 cuarto, +/- 350 SqFt).
 */
async function calculateARV(
  mlsHeaders: any,
  zip: string,
  beds: number | null,
  sqft: number | null,
  propertyClosePrice: number,
  propertyListPrice: number
): Promise<number> {
  const fallbackValue = propertyClosePrice > 0 ? propertyClosePrice : propertyListPrice;
  if (!zip || sqft === null || sqft === 0 || beds === null || beds === 0) {
    return fallbackValue;
  }
  
  const mlsUrl = "https://replication.sparkapi.com/Reso/OData/Property";
  const date180DaysAgo = new Date();
  date180DaysAgo.setDate(date180DaysAgo.getDate() - 180);
  const date180Str = date180DaysAgo.toISOString().split("T")[0];
  
  // OData filter para comps (mismo código postal, cerrado, precio > $20k para excluir rentas)
  const compsFilter = `PostalCode eq '${zip}' and StandardStatus eq 'Closed' and ClosePrice gt 20000 and BedroomsTotal ge ${beds - 1} and BedroomsTotal le ${beds + 1} and LivingArea ge ${sqft - 350} and LivingArea le ${sqft + 350} and CloseDate ge ${date180Str}`;
  
  try {
    const response = await axios.get(mlsUrl, {
      headers: mlsHeaders,
      params: {
        "$filter": compsFilter,
        "$select": "ClosePrice",
        "$top": 10
      },
      timeout: 10000
    });
    
    let comps = response.data.value || [];
    
    // Si no encuentra comps en 180 días, expandimos a 365 días (1 año)
    if (comps.length === 0) {
      const date365DaysAgo = new Date();
      date365DaysAgo.setDate(date365DaysAgo.getDate() - 365);
      const date365Str = date365DaysAgo.toISOString().split("T")[0];
      
      const compsFilter365 = `PostalCode eq '${zip}' and StandardStatus eq 'Closed' and ClosePrice gt 20000 and BedroomsTotal ge ${beds - 1} and BedroomsTotal le ${beds + 1} and LivingArea ge ${sqft - 350} and LivingArea le ${sqft + 350} and CloseDate ge ${date365Str}`;
      
      const response365 = await axios.get(mlsUrl, {
        headers: mlsHeaders,
        params: {
          "$filter": compsFilter365,
          "$select": "ClosePrice",
          "$top": 10
        },
        timeout: 10000
      });
      comps = response365.data.value || [];
    }
    
    if (comps.length > 0) {
      const sum = comps.reduce((acc: number, c: any) => acc + (c.ClosePrice || 0), 0);
      const avg = Math.round(sum / comps.length);
      console.log(`[COMPS] Calculado ARV promediando ${comps.length} comparables en ZIP ${zip}: $${avg.toLocaleString()}`);
      return avg;
    }
  } catch (err: any) {
    console.log(`[COMPS ERROR] Falló la búsqueda de comparables en ZIP ${zip}: ${err.message}`);
  }
  
  return fallbackValue;
}

/**
 * Ejecuta el cruce de datos con la API de Spark MLS.
 */
async function runCrossReference() {
  console.log("[INICIO] Iniciando Motor de Cruce Spark MLS...");
  
  const sparkToken = process.env.SPARK_ACCESS_TOKEN_1;
  if (!sparkToken) {
    console.error("[ERROR] SPARK_ACCESS_TOKEN_1 no está configurada en el archivo .env.");
    process.exit(1);
  }
  
  const mlsHeaders = {
    "Authorization": `Bearer ${sparkToken}`,
    "Accept": "application/json"
  };
  
  // 1. Consultar subastas pendientes de cruce en Turso DB
  let auctionsRes;
  try {
    auctionsRes = await db.execute(
      "SELECT auction_id, case_number, address, county, state FROM foreclosure_auctions WHERE mls_status = 'pending_check'"
    );
  } catch (dbErr: any) {
    console.error("[DB ERROR] Error al consultar subastas pendientes:", dbErr.message);
    process.exit(1);
  }
  
  const auctions = auctionsRes.rows;
  console.log(`[CRUCE] Se encontraron ${auctions.length} subastas pendientes para cruzar con el MLS.`);
  
  let matchCount = 0;
  let notFoundCount = 0;
  let errorCount = 0;
  
  for (const row of auctions) {
    const auctionId = row.auction_id as string;
    const caseNumber = row.case_number as string;
    const address = row.address as string;
    const county = row.county as string;
    const state = row.state as string;
    
    console.log(`\n-------------------------------------------------------------`);
    console.log(`[PROCESANDO] Caso: ${caseNumber} | Dirección: ${address} | ${county}, ${state}`);
    
    // Normalizar dirección
    const { houseNumber, coreWords } = parseAddress(address);
    
    if (!houseNumber) {
      console.log(`[SKIP] No se encontró número de casa para la dirección: "${address}". Marcando como 'not_found'.`);
      try {
        await db.execute({
          sql: "UPDATE foreclosure_auctions SET mls_status = 'not_found' WHERE auction_id = ?",
          args: [auctionId]
        });
      } catch (e) {}
      notFoundCount++;
      continue;
    }
    
    console.log(`[NORM] Número de casa: ${houseNumber} | Palabras clave calle: ${JSON.stringify(coreWords)}`);
    
    // 2. Si es Kentucky, descargar Handbill .doc para extraer la deuda
    let debtAmount: number | null = null;
    if (state === "KY" && caseNumber && caseNumber !== "PENDING") {
      console.log(`[HANDBILL] Descargando expediente .doc para el caso ${caseNumber}...`);
      debtAmount = await fetchDebtAmount(caseNumber);
      if (debtAmount) {
        console.log(`[HANDBILL] Deuda judicial extraída: $${debtAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}`);
        try {
          await db.execute({
            sql: "UPDATE foreclosure_auctions SET debt_amount = ? WHERE auction_id = ?",
            args: [debtAmount, auctionId]
          });
        } catch (dbErr: any) {
          console.error(`[DB ERROR] Error al guardar la deuda para ${caseNumber}:`, dbErr.message);
        }
      }
    }
    
    // 3. Consultar Spark MLS usando OData filter
    const mlsUrl = "https://replication.sparkapi.com/Reso/OData/Property";
    const odataFilter = `contains(UnparsedAddress, '${houseNumber}') and StateOrProvince eq '${state}'`;
    
    const params = {
      "$filter": odataFilter,
      "$select": "ListingKey,ListingId,UnparsedAddress,PostalCode,ListPrice,ClosePrice,MlsStatus,StandardStatus,CountyOrParish,StateOrProvince,BedroomsTotal,BathroomsTotalDecimal,LivingArea,YearBuilt",
      "$top": 20
    };
    
    try {
      console.log(`[MLS QUERY] Buscando en MLS: ${odataFilter}...`);
      const response = await axios.get(mlsUrl, {
        headers: mlsHeaders,
        params,
        timeout: 15000
      });
      
      if (response.status !== 200) {
        throw new Error(`MLS API status ${response.status}: ${response.statusText}`);
      }
      
      const properties = response.data.value || [];
      console.log(`[MLS QUERY] MLS devolvió ${properties.length} propiedades candidatas.`);
      
      let matchedProp: any = null;
      
      // Validar coincidencia de calle en memoria
      for (const prop of properties) {
        const mlsAddress = prop.UnparsedAddress || "";
        const mlsCleaned = mlsAddress.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
        const mlsWords = mlsCleaned.split(/\s+/).filter((w: string) => w.length > 0);
        
        // Verificar si todas las palabras del core de la calle judicial están en la dirección MLS
        const isMatch = coreWords.every(word => mlsWords.includes(word));
        
        if (isMatch) {
          matchedProp = prop;
          break;
        }
      }
      
      if (matchedProp) {
        const mlsId = matchedProp.ListingId;
        const mlsStatus = matchedProp.StandardStatus || matchedProp.MlsStatus || "Active";
        const closePrice = matchedProp.ClosePrice || 0;
        const listPrice = matchedProp.ListPrice || 0;
        
        // Características del inmueble para comps
        const zip = matchedProp.PostalCode || "";
        const beds = matchedProp.BedroomsTotal || null;
        const baths = matchedProp.BathroomsTotalDecimal || null;
        const sqft = matchedProp.LivingArea || null;
        
        console.log(`[MATCH FOUND] ¡Coincidencia con MLS! ID: ${mlsId} | Dirección MLS: "${matchedProp.UnparsedAddress}"`);
        console.log(`[MATCH PROFILE] ZIP: ${zip} | Beds: ${beds} | Baths: ${baths} | SqFt: ${sqft} | Historial: $${(closePrice || listPrice).toLocaleString()}`);
        
        // Calcular ARV usando Comps en tiempo real
        console.log(`[ARV COMPS] Calculando Valor Comercial Real (ARV) con comparables...`);
        const mlsValue = await calculateARV(mlsHeaders, zip, beds, sqft, closePrice, listPrice);
        console.log(`[ARV RESULT] Estatus MLS: ${mlsStatus} | Valor ARV (Comps): $${mlsValue.toLocaleString("en-US")}`);
        
        // Determinar si es de Alta Rentabilidad (Equity Neto >= 40% del ARV)
        let isHighYield = 0;
        if (debtAmount && debtAmount > 0 && mlsValue > 0) {
          const discountPct = ((mlsValue - debtAmount) / mlsValue) * 100;
          console.log(`[MATCH SCORING] Deuda: $${debtAmount.toLocaleString("en-US")} vs ARV: $${mlsValue.toLocaleString("en-US")} | Descuento potencial: ${discountPct.toFixed(1)}%`);
          if (isHighYieldProperty(mlsValue, debtAmount, 0)) {
            isHighYield = 1;
            console.log(`[HIGH YIELD] ¡Propiedad marcada como alta rentabilidad (Equity >= 40% del ARV)!`);
          }
        }

        
        // Calcular redemption_margin si aplica (KY) y tenemos appraisal
        // (Nota: Si no tenemos appraisal, la base de datos lo guarda como NULL y redemption_margin queda NULL)
        
        // Actualizar la subasta judicial en la DB
        await db.execute({
          sql: `
            UPDATE foreclosure_auctions SET
              mls_id = ?,
              mls_status = ?,
              mls_estimated_value = ?,
              is_high_yield = ?,
              sqft = ?,
              beds = ?,
              baths = ?
            WHERE auction_id = ?
          `,
          args: [
            mlsId,
            mlsStatus,
            mlsValue,
            isHighYield,
            sqft,
            beds,
            baths,
            auctionId
          ]
        });
        
        matchCount++;
      } else {
        console.log(`[NOT FOUND] No se encontró coincidencia de calle en las ${properties.length} propiedades del MLS.`);
        await db.execute({
          sql: "UPDATE foreclosure_auctions SET mls_status = 'not_found' WHERE auction_id = ?",
          args: [auctionId]
        });
        notFoundCount++;
      }
      
    } catch (err: any) {
      console.error(`[ERROR QUERYING MLS] Falló consulta para la subasta ${auctionId}:`, err.message || err);
      errorCount++;
    }
    
    // Respetar límites de rate limiting
    await sleep(500);
  }

  // 4. Consultar violaciones de código pendientes de cruce en Turso DB
  let violationsRes;
  try {
    violationsRes = await db.execute(
      "SELECT violation_id, case_number, address FROM code_violations WHERE mls_status = 'pending_check'"
    );
  } catch (dbErr: any) {
    console.error("[DB ERROR] Error al consultar violaciones pendientes:", dbErr.message);
    process.exit(1);
  }

  const violations = violationsRes.rows;
  console.log(`\n[CRUCE] Se encontraron ${violations.length} violaciones de código pendientes para cruzar con el MLS.`);

  let violationMatchCount = 0;
  let violationNotFoundCount = 0;
  let violationErrorCount = 0;

  for (const row of violations) {
    const violationId = row.violation_id as string;
    const caseNumber = row.case_number as string;
    const address = row.address as string;
    const state = "KY"; // Las violaciones registradas corresponden a Louisville, KY

    console.log(`\n-------------------------------------------------------------`);
    console.log(`[PROCESANDO VIOLACIÓN] Caso: ${caseNumber} | Dirección: ${address} | KY`);

    // Normalizar dirección
    const { houseNumber, coreWords } = parseAddress(address);

    if (!houseNumber) {
      console.log(`[SKIP] No se encontró número de casa para la dirección de violación: "${address}". Marcando como 'not_found'.`);
      try {
        await db.execute({
          sql: "UPDATE code_violations SET mls_status = 'not_found' WHERE violation_id = ?",
          args: [violationId]
        });
      } catch (e) {}
      violationNotFoundCount++;
      continue;
    }

    console.log(`[NORM] Número de casa: ${houseNumber} | Palabras clave calle: ${JSON.stringify(coreWords)}`);

    // Consultar Spark MLS usando OData filter
    const mlsUrl = "https://replication.sparkapi.com/Reso/OData/Property";
    const odataFilter = `contains(UnparsedAddress, '${houseNumber}') and StateOrProvince eq '${state}'`;

    const params = {
      "$filter": odataFilter,
      "$select": "ListingKey,ListingId,UnparsedAddress,PostalCode,ListPrice,ClosePrice,MlsStatus,StandardStatus,CountyOrParish,StateOrProvince,BedroomsTotal,BathroomsTotalDecimal,LivingArea,YearBuilt",
      "$top": 20
    };

    try {
      console.log(`[MLS QUERY] Buscando violación en MLS: ${odataFilter}...`);
      const response = await axios.get(mlsUrl, {
        headers: mlsHeaders,
        params,
        timeout: 15000
      });

      if (response.status !== 200) {
        throw new Error(`MLS API status ${response.status}: ${response.statusText}`);
      }

      const properties = response.data.value || [];
      console.log(`[MLS QUERY] MLS devolvió ${properties.length} propiedades candidatas.`);

      let matchedProp: any = null;

      // Validar coincidencia de calle en memoria
      for (const prop of properties) {
        const mlsAddress = prop.UnparsedAddress || "";
        const mlsCleaned = mlsAddress.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
        const mlsWords = mlsCleaned.split(/\s+/).filter((w: string) => w.length > 0);

        // Verificar si todas las palabras del core de la calle están en la dirección MLS
        const isMatch = coreWords.every(word => mlsWords.includes(word));

        if (isMatch) {
          matchedProp = prop;
          break;
        }
      }

      if (matchedProp) {
        const mlsId = matchedProp.ListingId;
        const mlsStatus = matchedProp.StandardStatus || matchedProp.MlsStatus || "Active";
        const closePrice = matchedProp.ClosePrice || 0;
        const listPrice = matchedProp.ListPrice || 0;

        const zip = matchedProp.PostalCode || "";
        const beds = matchedProp.BedroomsTotal || null;
        const baths = matchedProp.BathroomsTotalDecimal || null;
        const sqft = matchedProp.LivingArea || null;

        console.log(`[MATCH FOUND] ¡Coincidencia con MLS para violación! ID: ${mlsId} | Dirección MLS: "${matchedProp.UnparsedAddress}"`);

        // Calcular ARV usando Comps en tiempo real
        const mlsValue = await calculateARV(mlsHeaders, zip, beds, sqft, closePrice, listPrice);
        console.log(`[ARV RESULT] Estatus MLS: ${mlsStatus} | Valor ARV (Comps): $${mlsValue.toLocaleString("en-US")}`);

        // Al no haber deuda para violaciones de código, consideramos de alta rentabilidad si logramos calcular el ARV
        const isHighYield = mlsValue > 0 ? 1 : 0;

        await db.execute({
          sql: `
            UPDATE code_violations SET
              mls_id = ?,
              mls_status = ?,
              mls_estimated_value = ?,
              is_high_yield = ?,
              sqft = ?,
              beds = ?,
              baths = ?
            WHERE violation_id = ?
          `,
          args: [
            mlsId,
            mlsStatus,
            mlsValue,
            isHighYield,
            sqft,
            beds,
            baths,
            violationId
          ]
        });

        violationMatchCount++;
      } else {
        console.log(`[NOT FOUND] No se encontró coincidencia de calle en las ${properties.length} propiedades del MLS.`);
        await db.execute({
          sql: "UPDATE code_violations SET mls_status = 'not_found' WHERE violation_id = ?",
          args: [violationId]
        });
        violationNotFoundCount++;
      }

    } catch (err: any) {
      console.error(`[ERROR QUERYING MLS] Falló consulta para la violación ${violationId}:`, err.message || err);
      violationErrorCount++;
    }

    // Respetar límites de rate limiting
    await sleep(500);
  }
  
  console.log("\n========================================================");
  console.log("RESUMEN GENERAL DEL MOTOR DE CRUCE:");
  console.log(`- Subastas Cruzadas exitosamente: ${matchCount}`);
  console.log(`- Subastas No encontradas en MLS: ${notFoundCount}`);
  console.log(`- Subastas con Errores: ${errorCount}`);
  console.log(`- Violaciones Cruzadas exitosamente: ${violationMatchCount}`);
  console.log(`- Violaciones No encontradas en MLS: ${violationNotFoundCount}`);
  console.log(`- Violaciones con Errores: ${violationErrorCount}`);
  console.log("========================================================\n");
}

// Ejecutar si se corre directamente
if (require.main === module) {
  runCrossReference().catch(console.error);
}

export { runCrossReference };
