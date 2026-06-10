/**
 * Módulo de Suscripción y Underwriting Financiero para Adquisición de Propiedades
 */

// Palabras clave de daños severos y moderados para cálculo de Rehab
const SEVERE_DAMAGE_KEYWORDS = ["structural", "roof", "dangerous", "unsafe", "foundation", "fire", "daño", "peligro", "techo"];
const MODERATE_DAMAGE_KEYWORDS = ["boarded", "plumbing", "electrical", "maintenance", "grass", "weed", "tapiado", "plomería", "mantenimiento"];

/**
 * Estima el costo de reparación (Rehab) automáticamente basándose en los pies cuadrados y estresores físicos.
 */
export function calculateRehab(sqFt: number | null, violationKeywords: string[]): number {
  // Si no hay pies cuadrados, asumimos una casa estándar de 1,400 SqFt
  const actualSqFt = sqFt && sqFt > 0 ? sqFt : 1400;
  
  let baseRatePerSqFt = 25; // Tarifa cosmética básica (pintura, limpieza, detalles)

  const hasSevere = violationKeywords.some(keyword => 
    SEVERE_DAMAGE_KEYWORDS.some(severe => keyword.toLowerCase().includes(severe))
  );
  
  const hasModerate = violationKeywords.some(keyword => 
    MODERATE_DAMAGE_KEYWORDS.some(mod => keyword.toLowerCase().includes(mod))
  );

  if (hasSevere) {
    baseRatePerSqFt = 65; // Daño estructural o de seguridad (reparación total)
  } else if (hasModerate) {
    baseRatePerSqFt = 45; // Daño moderado (drywall, cocinas, baños, mantenimiento)
  }

  // Costo base más un 15% de margen de contingencia para imprevistos
  const baseRehab = actualSqFt * baseRatePerSqFt;
  return Math.round(baseRehab * 1.15);
}

/**
 * Base de datos podría tener deudas ocultas como NULL o undefined.
 */
export function calculateNetEquity(arv: number, primaryDebt: number, hiddenMortgages: number = 0): number {
  if (arv <= 0) return 0;
  const cleanHidden = hiddenMortgages || 0;
  return Math.round(arv - primaryDebt - cleanHidden);
}

/**
 * Calcula la Oferta Máxima Permitida (MAO) basándose en el ARV, el costo de reparación y deudas ocultas.
 * MAO = (ARV * 0.70) - Rehab - Costos_Adquisición - Deuda_Oculta
 * Asume costos de adquisición estándar del 3% del ARV.
 */
export function calculateMAO(arv: number, rehab: number, hiddenMortgages: number = 0): number {
  if (arv <= 0) return 0;
  const acquisitionCosts = arv * 0.03; // Gastos de cierre y administrativos de compra (3%)
  const cleanHidden = hiddenMortgages || 0;
  const mao = (arv * 0.70) - rehab - acquisitionCosts - cleanHidden;
  return Math.max(0, Math.round(mao));
}

/**
 * Retorna true si la deuda acumulada (deuda judicial primaria + hipotecas ocultas) supera el ARV.
 */
export function isUnderwater(arv: number, primaryDebt: number, hiddenMortgages: number = 0): boolean {
  if (arv <= 0) return false;
  const cleanHidden = hiddenMortgages || 0;
  return (primaryDebt + cleanHidden) > arv;
}

/**
 * Verifica factores de riesgo críticos para la propiedad y genera alertas.
 */
export function checkCriticalRisk(
  arv: number,
  primaryDebt: number,
  hiddenMortgages: number = 0,
  plaintiff: string | null,
  caseNumber: string | null
): { isRisk: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (isJuniorLien(plaintiff, caseNumber)) {
    reasons.push("Posible gravamen secundario (Junior Lien).");
  }

  const cleanHidden = hiddenMortgages || 0;
  const totalDebt = primaryDebt + cleanHidden;
  if (arv > 0 && totalDebt > arv) {
    reasons.push(`Propiedad bajo el agua (Deuda Total: $${totalDebt.toLocaleString()} > ARV: $${arv.toLocaleString()}).`);
  }

  if (arv > 0 && cleanHidden > arv * 0.5) {
    reasons.push(`Hipoteca oculta masiva detectada ($${cleanHidden.toLocaleString()} > 50% del ARV).`);
  }

  return {
    isRisk: reasons.length > 0,
    reasons
  };
}

/**
 * Calcula el Retorno de Inversión (ROI) y el costo total de la adquisición.
 * Si no hay precio de compra (e.g., en violaciones de código sin deudas), se calcula asumiendo que compramos al MAO.
 */
export function calculateROI(
  arv: number,
  purchasePrice: number,
  rehab: number
): { roi: number; totalCost: number; netProfit: number } {
  const actualPurchasePrice = purchasePrice > 0 ? purchasePrice : calculateMAO(arv, rehab);
  
  if (actualPurchasePrice <= 0 || arv <= 0) {
    return { roi: 0, totalCost: 0, netProfit: 0 };
  }

  // Gastos de transacción: Compra (3% del precio de compra) + Venta (5% del ARV para comisiones y gastos)
  const transactionCosts = (actualPurchasePrice * 0.03) + (arv * 0.05);
  
  const totalCost = actualPurchasePrice + rehab + transactionCosts;
  const netProfit = arv - totalCost;
  const roi = (netProfit / totalCost) * 100;

  return {
    roi: Math.round(roi * 10) / 10,
    totalCost: Math.round(totalCost),
    netProfit: Math.round(netProfit)
  };
}

/**
 * Detecta si el demandante o el caso judicial corresponde a un gravamen secundario (Junior Lien/Segunda Hipoteca).
 * Esto evita asumir que la propiedad se puede comprar limpia por el valor de la subasta.
 */
export function isJuniorLien(plaintiff: string | null, caseNumber: string | null): boolean {
  if (!plaintiff) return false;
  
  const cleanPlaintiff = plaintiff.toLowerCase();
  
  const juniorIndicators = [
    "association",
    "condominium",
    "condo",
    "homeowners",
    "hoa",
    "second mortgage",
    "junior",
    "secundario",
    "asociación",
    "copropietarios",
    "seconde",
    "tax commissioner",
    "county commissioner"
  ];

  return juniorIndicators.some(indicator => cleanPlaintiff.includes(indicator));
}

/**
 * Determina si una propiedad es de Alta Rentabilidad (High Yield).
 * Criterio: El Equity Neto (ARV - Deuda Primaria - Deudas Ocultas) debe ser de al menos el 40% del ARV.
 */
export function isHighYieldProperty(arv: number, primaryDebt: number, hiddenMortgages: number = 0): boolean {
  if (arv <= 0) return false;
  const cleanHidden = hiddenMortgages || 0;
  const netEquity = arv - primaryDebt - cleanHidden;
  return netEquity >= arv * 0.40;
}
