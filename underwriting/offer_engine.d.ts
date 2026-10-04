export type RehabSeverity = "cosmetic" | "moderate" | "severe";
export type RehabBasis = "sqft" | "arv_pct" | "unknown";

export interface RehabEstimate {
  amount: number;
  basis: RehabBasis;
  severity: RehabSeverity;
}

export interface OfferTiersInput {
  arv: number;
  sqft?: number | null;
  keywords?: string[];
  severity?: RehabSeverity;
  totalDebt?: number;
  state?: string;
  courtAppraisal?: number;
}

export interface OfferTiers {
  arv: number;
  rehab: number;
  rehabBasis: RehabBasis;
  severity: RehabSeverity;
  conservative: number;
  target: number;
  max: number;
  hasValue: boolean;
  viable: boolean;
  belowDebt: boolean;
  wholesaleSpread: number;
  kyTwoThirdsThreshold: number | null;
  redemptionRisk: boolean;
}

export declare const OFFER_PCT: Readonly<{ conservative: number; target: number; max: number }>;
export declare function rehabSeverity(keywords: string[]): RehabSeverity;
export declare function estimateRehab(input: { arv?: number; sqft?: number | null; keywords?: string[]; severity?: RehabSeverity }): RehabEstimate;
export declare function computeOfferTiers(input: OfferTiersInput): OfferTiers;
