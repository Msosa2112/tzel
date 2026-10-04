/**
 * Módulo de Suscripción y Underwriting Financiero para Adquisición de Propiedades
 *
 * Las fórmulas de oferta y rehab viven en ./offer_engine.js (fuente única compartida con la UI).
 */
import { computeOfferTiers, estimateRehab, type OfferTiers } from "./offer_engine";

/**
 * Estima el costo de reparación (Rehab) basándose en los pies cuadrados reales y estresores físicos.
 * Sin pies cuadrados NO se asume una casa estándar: se estima como % del ARV (si se conoce).
 * Sin sqft ni ARV devuelve 0 (rehab desconocido).
 */
export function calculateRehab(sqFt: number | null, violationKeywords: string[], arv: number = 0): number {
  return estimateRehab({ arv, sqft: sqFt, keywords: violationKeywords || [] }).amount;
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
 * Calcula la Oferta Máxima Permitida (MAO) según AGENTS.md: MAO = 75% ARV − Rehab.
 * Para pujas en subasta se restan además las deudas ocultas que sobreviven a la venta
 * (hipotecas/gravámenes que el comprador hereda).
 */
export function calculateMAO(
  arv: number,
  rehab: number,
  hiddenMortgages: number = 0,
  hiddenLiensAmount: number = 0
): number {
  if (arv <= 0) return 0;
  const cleanHidden = (hiddenMortgages || 0) + (hiddenLiensAmount || 0);
  const mao = (arv * 0.75) - rehab - cleanHidden;
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
  /** Niveles de oferta del motor único (Conservadora/Target/MAO). */
  offerTiers: OfferTiers;
}

/**
 * Motor de Underwriting Multicapa Institucional (AGENTS.md §3.5)
 *   - ARV = valor de mercado efectivo (sin multiplicadores inventados).
 *   - targetContractPrice = Target (70% ARV − Rehab)
 *   - walkAwayPrice       = MAO (75% ARV − Rehab)
 *   - auctionMaxBid       = Conservadora (65% ARV − Rehab)
 *   - wholesaleProfitSpread/assignmentFee = MAO − Target (margen real, no una cuota fija)
 * holdingCosts/closingCosts son informativos (4% / 5% del ARV) y ya están absorbidos por el descuento.
 */
export function calculateInstitutionalUnderwriting(
  marketValue: number,
  sqft: number | null,
  violationKeywords: string[],
  totalDebt: number,
  state: string = 'KY',
  courtAppraisal: number = 0
): InstitutionalUnderwriting {
  const offerTiers = computeOfferTiers({
    arv: marketValue,
    sqft,
    keywords: violationKeywords || [],
    totalDebt,
    state,
    courtAppraisal
  });

  if (!offerTiers.hasValue) {
    return {
      arv: 0,
      rehab: 0,
      holdingCosts: 0,
      closingCosts: 0,
      desiredProfit: 0,
      assignmentFee: 0,
      targetContractPrice: 0,
      walkAwayPrice: 0,
      auctionMaxBid: 0,
      wholesaleProfitSpread: 0,
      equitySpread: 0,
      isUnderwater: false,
      offerTiers
    };
  }

  const arv = offerTiers.arv;
  const holdingCosts = Math.round(arv * 0.04);
  const closingCosts = Math.round(arv * 0.05);
  // Ganancia implícita del comprador final al pagar el MAO.
  const desiredProfit = Math.max(0, arv - offerTiers.rehab - offerTiers.max);
  const equitySpread = marketValue - totalDebt;

  return {
    arv,
    rehab: offerTiers.rehab,
    holdingCosts,
    closingCosts,
    desiredProfit,
    assignmentFee: offerTiers.wholesaleSpread,
    targetContractPrice: offerTiers.target,
    walkAwayPrice: offerTiers.max,
    auctionMaxBid: offerTiers.conservative,
    wholesaleProfitSpread: offerTiers.wholesaleSpread,
    equitySpread,
    isUnderwater: totalDebt > marketValue && marketValue > 0,
    offerTiers
  };
}
