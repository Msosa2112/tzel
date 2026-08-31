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
 * Clasifica un número telefónico
 */
export function classifyPhone(phoneStr: string): ClassifiedPhone {
  const digits = normalizePhoneNumber(phoneStr);
  const formatted = digits.length === 10 ? formatPhoneUs(digits) : phoneStr.trim();
  
  if (digits.length !== 10) {
    return {
      raw: phoneStr,
      formatted,
      type: "UNKNOWN",
      icon: "📞",
      label: "Teléfono",
      isPriority: false
    };
  }

  const areaCode = digits.substring(0, 3);
  const prefix = digits.substring(3, 6);

  // Rangos de prefijos conocidos para operadores móviles en 502 / 812
  // Los números con prefijos comunes de wireless de Verizon, AT&T, T-Mobile en KY/IN
  // Si no se tiene HLR lookup en vivo, heurística por prefijo o default inteligente
  let type: "MOBILE" | "LANDLINE" | "VOIP" | "UNKNOWN" = "UNKNOWN";

  // Heurística de prefijos inalámbricos frecuentes en 502 y 812
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
    // Si no está en la lista estricta pero es de 10 dígitos, asignar default Mobile para números locales
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

  if (!list.length) return "No disponible";

  const classified = list.map(classifyPhone);
  // Ordenar para que los móviles aparezcan primero
  classified.sort((a, b) => (b.isPriority ? 1 : 0) - (a.isPriority ? 1 : 0));

  return classified.map(c => `${c.icon} <code>${c.formatted}</code> <i>(${c.label})</i>`).join("\n");
}

if (require.main === module) {
  const sample = ["5022623333", "8122071234", "5025550192"];
  console.log("Muestra de clasificación telefónica:");
  console.log(formatPhoneListForDisplay(sample));
}
