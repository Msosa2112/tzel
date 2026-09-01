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
export function calculateNetEquity(
  arv: number,
  primaryDebt: number,
  hiddenMortgages: number = 0,
  hiddenLiensAmount: number = 0
): number {
  if (arv <= 0) return 0;
  const cleanHidden = (hiddenMortgages || 0) + (hiddenLiensAmount || 0);
  return Math.round(arv - primaryDebt - cleanHidden);
}

/**
 * Calcula la Oferta Máxima Permitida (MAO) basándose en el ARV, el costo de reparación y deudas ocultas.
 * MAO = (ARV * 0.70) - Rehab - Costos_Adquisición - Deuda_Oculta
 * Asume costos de adquisición estándar del 3% del ARV.
 */
export function calculateMAO(
  arv: number,
  rehab: number,
  hiddenMortgages: number = 0,
  hiddenLiensAmount: number = 0
): number {
  if (arv <= 0) return 0;
  const acquisitionCosts = arv * 0.03; // Gastos de cierre y administrativos de compra (3%)
  const cleanHidden = (hiddenMortgages || 0) + (hiddenLiensAmount || 0);
  const mao = (arv * 0.70) - rehab - acquisitionCosts - cleanHidden;
  return Math.max(0, Math.round(mao));
}

/**
 * Retorna true si la deuda acumulada (deuda judicial primaria + hipotecas ocultas) supera el ARV.
 */
export function isUnderwater(
  arv: number,
  primaryDebt: number,
  hiddenMortgages: number = 0,
  hiddenLiensAmount: number = 0
): boolean {
  if (arv <= 0) return false;
  const cleanHidden = (hiddenMortgages || 0) + (hiddenLiensAmount || 0);
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
  caseNumber: string | null,
  hiddenLiensAmount: number = 0
): { isRisk: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (isJuniorLien(plaintiff, caseNumber)) {
    reasons.push("Posible gravamen secundario (Junior Lien).");
  }

  const cleanHidden = (hiddenMortgages || 0) + (hiddenLiensAmount || 0);
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
 * Determina si una propiedad es de Alta Rentabilidad para Inversión / Wholesaling Rápido.
 * REGLAS DE NEGOCIO:
 * 1. Techo de Valor (Fast-Moving): ARV <= $350,000 USD (propiedades de rotación rápida).
 * 2. Margen Bruto Mínimo: (Valor Real - Deuda Total) >= $50,000 USD.
 * Si no cumple estas dos condiciones, se desestima para ahorrar tiempo y saldo de skip-tracing.
 */
export function isHighYieldProperty(
  arv: number,
  primaryDebt: number,
  hiddenMortgages: number = 0,
  hiddenLiensAmount: number = 0,
  minSpread: number = 50000,
  maxArv: number = 350000
): boolean {
  if (arv <= 0 || primaryDebt <= 0) return false;
  
  // 1. Descartar si el valor de la propiedad supera los $350k (mercado lento)
  if (arv > maxArv) return false;

  // 2. Calcular deuda total
  const totalDebt = primaryDebt + (hiddenMortgages || 0) + (hiddenLiensAmount || 0);

  // 3. Margen bruto directo (Valor Real - Deuda Total)
  const spread = arv - totalDebt;

  // 4. Debe tener al menos $50,000 de margen
  return spread >= minSpread;
}

export interface InstitutionalUnderwriting {
  arv: number;
  rehab: number;
  holdingCosts: number;
  closingCosts: number;
  desiredProfit: number;
  assignmentFee: number;
  targetContractPrice: number;
  walkAwayPrice: number;
  auctionMaxBid: number;
  wholesaleProfitSpread: number;
  equitySpread: number;
  isUnderwater: boolean;
}

/**
 * Motor de Underwriting Multicapa Institucional
 * Desglosa ARV, Rehab, Holding, Closing, Margen Deseado, Target Contract Price, Walk-Away y Auction Max Bid.
 */
export function calculateInstitutionalUnderwriting(
  marketValue: number,
  sqft: number | null,
  violationKeywords: string[],
  totalDebt: number,
  state: string = 'KY'
): InstitutionalUnderwriting {
  const baseVal = marketValue > 0 ? marketValue : 180000;
  const arv = Math.round(baseVal * 1.15);
  
  // Rehab calculation
  let rehabPerSqft = 25;
  const isSevere = violationKeywords.some(v => /structural|roof|dangerous|unsafe|foundation|fire|demolition/i.test(v));
  const isModerate = violationKeywords.some(v => /boarded|plumbing|electrical|maintenance|grass|weed/i.test(v));
  if (isSevere) rehabPerSqft = 65;
  else if (isModerate) rehabPerSqft = 45;

  const area = (sqft && sqft > 400 && sqft < 10000) ? sqft : 1400;
  const rehab = Math.round(area * rehabPerSqft * 1.15);

  const holdingCosts = Math.round(arv * 0.04);
  const closingCosts = Math.round(arv * 0.05);
  const desiredProfit = Math.round(Math.max(25000, arv * 0.15));
  const assignmentFee = 15000;

  const targetContractPrice = Math.max(0, arv - rehab - holdingCosts - closingCosts - desiredProfit - assignmentFee);
  const walkAwayPrice = targetContractPrice + 12000;
  const discountFactor = (state || '').toUpperCase() === 'KY' ? 0.66 : 0.70;
  const auctionMaxBid = Math.max(0, Math.round((arv * discountFactor) - rehab));
  const equitySpread = baseVal - totalDebt;

  return {
    arv,
    rehab,
    holdingCosts,
    closingCosts,
    desiredProfit,
    assignmentFee,
    targetContractPrice,
    walkAwayPrice,
    auctionMaxBid,
    wholesaleProfitSpread: assignmentFee,
    equitySpread,
    isUnderwater: totalDebt > baseVal && baseVal > 0
  };
}
