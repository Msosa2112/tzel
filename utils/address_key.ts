/**
 * Normalización de direcciones y llaves de agrupación compartidas.
 *
 * IMPORTANTE: el servidor del mapa y los scripts que generan tzel_events /
 * tzel_opportunity_scores DEBEN usar este mismo módulo; si divergen, los
 * PROP_ ids dejan de cruzar y los scores/eventos desaparecen del mapa.
 */

const NOISE_WORDS = new Set([
  "st", "street", "ave", "avenue", "rd", "road", "ln", "lane", "dr", "drive",
  "ct", "court", "blvd", "boulevard", "way", "pl", "place", "hwy", "highway",
  "rte", "route", "cir", "circle", "ter", "terrace", "trl", "trail", "pkwy", "parkway",
  "apt", "apartment", "unit", "ste", "suite", "fl", "floor",
  "n", "north", "s", "south", "e", "east", "w", "west",
  "ky", "in", "jefferson", "clark", "floyd"
]);

/**
 * Indicadores de unidad con límites de palabra. Antes se usaba indexOf(), lo que
 * cortaba "Manchester" (ste), "Community" (unit) o "Baptist" (apt).
 */
const UNIT_INDICATOR_RX = /(?:\b(?:apartment|apt|unit|suite|ste)\b|#)/i;

export function parseAddress(address: string | null | undefined): { houseNumber: string | null; coreWords: string[] } {
  if (!address) return { houseNumber: null, coreWords: [] };
  let part1 = address.split(",")[0].trim().toLowerCase();

  const unitIdx = part1.search(UNIT_INDICATOR_RX);
  if (unitIdx !== -1) {
    part1 = part1.substring(0, unitIdx).trim();
  }

  part1 = part1.replace(/[^a-z0-9\s]/g, " ");

  const words = part1.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) {
    return { houseNumber: null, coreWords: [] };
  }

  let houseNumber: string | null = null;
  let streetStartIndex = 0;

  if (/^\d+/.test(words[0])) {
    houseNumber = words[0];
    streetStartIndex = 1;
  }

  const coreWords: string[] = [];
  for (let i = streetStartIndex; i < words.length; i++) {
    const w = words[i];
    if (NOISE_WORDS.has(w)) continue;
    if (/^\d{5}$/.test(w)) continue;
    coreWords.push(w);
  }

  return { houseNumber, coreWords };
}

/**
 * Extrae y normaliza la unidad/departamento (ej. "apt4", "suite200", "4" para "#4").
 */
export function getUnitInfo(address: string | null | undefined): string {
  if (!address) return "";
  const cleanAddress = address.toLowerCase();
  const idx = cleanAddress.search(UNIT_INDICATOR_RX);
  if (idx === -1) return "";
  const rest = cleanAddress.substring(idx);
  return rest.split(",")[0].trim().replace(/[^a-z0-9]/g, "");
}

export function getGroupingKey(address: string | null | undefined): string {
  if (!address) return "";
  const parsed = parseAddress(address);
  const unit = getUnitInfo(address);
  if (!parsed.houseNumber) {
    const base = address.toLowerCase().replace(/[^a-z0-9]/g, "");
    return unit ? `${base}_${unit}` : base;
  }
  const baseKey = `${parsed.houseNumber}_${parsed.coreWords.join("_")}`;
  return unit ? `${baseKey}_${unit}` : baseKey;
}

/**
 * PROP_ id usado por tzel_events / tzel_encumbrances / tzel_opportunity_scores.
 * Se mantiene el truncado a 40 caracteres por compatibilidad con los datos existentes.
 */
export function buildPropertyId(groupingKey: string): string {
  return `PROP_${groupingKey.replace(/[^a-z0-9]/g, "_").substring(0, 40)}`;
}
