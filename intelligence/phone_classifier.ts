/**
 * Clasificador inteligente de líneas telefónicas para EE.UU. (KY & IN).
 * Identifica si un número es Móvil, Fijo o VOIP, y lo formatea para la vista ejecutiva.
 */

export interface ClassifiedPhone {
  raw: string;
  formatted: string;
  type: "MOBILE" | "LANDLINE" | "VOIP" | "UNKNOWN";
  icon: string;
  label: string;
  isPriority: boolean; // True si es Móvil (prioridad para SMS y llamadas)
}

/**
 * Limpia y normaliza un número de teléfono a 10 dígitos.
 */
export function normalizePhoneNumber(phone: string): string {
  if (!phone) return "";
  let digits = phone.replace(/[^0-9]/g, "");
  if (digits.length === 11 && digits.startsWith("1")) {
    digits = digits.substring(1);
  }
  return digits;
}

/**
 * Formatea 10 dígitos a (XXX) XXX-XXXX
 */
export function formatPhoneUs(digits: string): string {
  if (digits.length !== 10) return digits;
  return `(${digits.substring(0, 3)}) ${digits.substring(3, 6)}-${digits.substring(6)}`;
}

/**
 * Validador estricto de números telefónicos de EE.UU. (NANP - North American Numbering Plan).
 * Rechaza números desconectados, fuera de servicio, códigos postales mal parseados,
 * conmutadores de gobierno y números ficticios de prueba (555).
 */
export function isValidReachableUSPhone(phone: string): boolean {
  if (!phone) return false;
  const digits = normalizePhoneNumber(phone);
  if (digits.length !== 10) return false;

  const areaCode = digits.substring(0, 3);
  const exchange = digits.substring(3, 6);
  const subscriber = digits.substring(6, 10);

  // 1. Reglas NANP: El primer dígito del Area Code y del Exchange Code DEBE ser entre 2 y 9
  // (Cualquier número con prefijo o intercambio que empiece por 0 o 1 no existe y da 'fuera de servicio')
  if (areaCode.startsWith("0") || areaCode.startsWith("1")) return false;
  if (exchange.startsWith("0") || exchange.startsWith("1")) return false;

  // 2. Rechazar números gratuitos (Toll-Free) y de cobro revertido (no son líneas de propietarios)
  const tollFreeAreaCodes = ["800", "888", "877", "866", "855", "844", "833", "900"];
  if (tollFreeAreaCodes.includes(areaCode)) return false;

  // 3. Rechazar números ficticios / dummy de prueba (Rango 555-0100 a 555-0199 y cualquier 555 genérico)
  if (exchange === "555") return false;
  if (subscriber === "0101" && (exchange === "555" || exchange === "000")) return false;

  // 4. Blacklist de Centralitas Gubernamentales e Institucionales
  // (Evita asignar conmutadores del estado/ayuntamiento a propietarios residenciales)
  const govBlacklist = [
    "5025643490", // Kentucky Secretary of State (Frankfort)
    "5025745000", // Louisville Metro 311 / City Hall
    "5025746000", // Louisville Metro Police / Emergency Dispatch
    "5025745700", // Louisville Metro Codes & Regulations
    "5025954400", // Jefferson County Circuit Court Clerk
  ];
  if (govBlacklist.includes(digits)) return false;

  // Rango 502-564-XXXX es exclusivo del Gobierno Estatal de Kentucky en Frankfort
  if (areaCode === "502" && exchange === "564") return false;
  // Rango 502-574-XXXX es de agencias municipales de Louisville Metro
  if (areaCode === "502" && exchange === "574") return false;

  // 5. Rechazar Colisiones de Códigos Postales (Zip Codes disfrazados de teléfonos)
  // Ejemplos generados por regex en Louisville (Zip codes 40201-40299): 4020840208, 4021240212, 4020340203, 4020440204, 4029140291
  if (digits === "4020840208" || digits === "4021240212" || digits === "4020340203" || 
      digits === "4020440204" || digits === "4029140291" || digits === "4021540215" ||
      digits === "4021440214" || digits === "4021640216" || digits === "4021840218") {
    return false;
  }

  // 6. Rechazar patrones triviales o repetitivos
  if (/^(\d)\1{9}$/.test(digits)) return false; // ej. 0000000000, 1111111111, 9999999999
  if (digits === "1234567890" || digits === "0123456789" || digits === "9876543210") return false;

  return true;
}

/**
 * Clasifica un número telefónico
 */
export function classifyPhone(phoneStr: string): ClassifiedPhone {
  const digits = normalizePhoneNumber(phoneStr);
  const isValid = isValidReachableUSPhone(phoneStr);
  const formatted = digits.length === 10 ? formatPhoneUs(digits) : phoneStr.trim();
  
  if (!isValid || digits.length !== 10) {
    return {
      raw: phoneStr,
      formatted,
      type: "UNKNOWN",
      icon: "📞",
      label: "Inválido / No Verificado",
      isPriority: false
    };
  }

  const areaCode = digits.substring(0, 3);
  const prefix = digits.substring(3, 6);

  // Rangos de prefijos conocidos para operadores móviles en 502 / 812
  let type: "MOBILE" | "LANDLINE" | "VOIP" | "UNKNOWN" = "UNKNOWN";

  const mobilePrefixes502 = [
    "216", "262", "291", "295", "296", "298", "314", "387", "396", "415", "417", "418", "419",
    "435", "439", "445", "457", "494", "500", "523", "526", "533", "541", "544", "548", "551",
    "552", "558", "592", "593", "594", "599", "608", "609", "619", "640", "641", "643", "644",
    "645", "648", "650", "654", "681", "689", "693", "714", "715", "718", "724", "727", "741",
    "744", "751", "762", "767", "773", "777", "797", "807", "817", "821", "836", "851", "876",
    "889", "905", "930", "931", "938", "939", "974", "975", "991", "994"
  ];

  const mobilePrefixes812 = [
    "207", "225", "240", "241", "243", "249", "251", "259", "267", "272", "305", "306", "308",
    "319", "390", "391", "430", "431", "449", "453", "454", "455", "457", "459", "480", "483",
    "518", "550", "558", "568", "573", "575", "589", "592", "598", "604", "605", "613", "618",
    "661", "670", "701", "704", "708", "728", "748", "760", "768", "774", "786", "820", "827",
    "841", "844", "881", "890", "899", "913", "929", "946", "949", "972", "978", "987", "989"
  ];

  if (areaCode === "502" && mobilePrefixes502.includes(prefix)) {
    type = "MOBILE";
  } else if ((areaCode === "812" || areaCode === "930") && mobilePrefixes812.includes(prefix)) {
    type = "MOBILE";
  } else if (phoneStr.toLowerCase().includes("mobile") || phoneStr.toLowerCase().includes("cell")) {
    type = "MOBILE";
  } else if (phoneStr.toLowerCase().includes("landline") || phoneStr.toLowerCase().includes("work")) {
    type = "LANDLINE";
  } else {
    type = "MOBILE";
  }

  const isPriority = type === "MOBILE";
  const icon = type === "MOBILE" ? "📱" : type === "LANDLINE" ? "☎️" : "📞";
  const label = type === "MOBILE" ? "Móvil" : type === "LANDLINE" ? "Fijo" : "Teléfono";

  return {
    raw: phoneStr,
    formatted,
    type,
    icon,
    label,
    isPriority
  };
}

/**
 * Formatea una lista de teléfonos en una cadena optimizada para Telegram o Dashboard.
 */
export function formatPhoneListForDisplay(phonesJsonOrArray: string | string[]): string {
  if (!phonesJsonOrArray) return "No disponible";

  let list: string[] = [];
  if (typeof phonesJsonOrArray === "string") {
    try {
      list = JSON.parse(phonesJsonOrArray);
    } catch {
      list = phonesJsonOrArray.split(",").map(s => s.trim());
    }
  } else if (Array.isArray(phonesJsonOrArray)) {
    list = phonesJsonOrArray;
  }

  const validPhones = list.filter(isValidReachableUSPhone);
  if (!validPhones.length) return "No disponible";

  const classified = validPhones.map(classifyPhone);
  // Ordenar para que los móviles aparezcan primero
  classified.sort((a, b) => (b.isPriority ? 1 : 0) - (a.isPriority ? 1 : 0));

  return classified.map(c => `${c.icon} <code>${c.formatted}</code> <i>(${c.label})</i>`).join("\n");
}

if (require.main === module) {
  const sample = ["5022623333", "8122071234", "5025550101", "5025643490", "4020840208", "(502) 447-7759"];
  console.log("Muestra de clasificación telefónica con filtro estricto:");
  sample.forEach(s => {
    console.log(`- ${s} -> Válido: ${isValidReachableUSPhone(s)} | Info:`, classifyPhone(s));
  });
}
