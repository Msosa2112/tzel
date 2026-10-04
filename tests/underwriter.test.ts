import { describe, expect, test } from "bun:test";
import {
  calculateRehab,
  calculateNetEquity,
  calculateMAO,
  isUnderwater,
  checkCriticalRisk,
  calculateInstitutionalUnderwriting
} from "../underwriting/underwriter";
import { computeOfferTiers, estimateRehab } from "../underwriting/offer_engine";

describe("calculateRehab / estimateRehab", () => {
  test("sin sqft ni ARV → 0 (no se asume una casa de 1,400 sqft)", () => {
    expect(calculateRehab(null, [])).toBe(0);
    expect(estimateRehab({}).basis).toBe("unknown");
  });

  test("sin sqft pero con ARV → % del ARV marcado como arv_pct", () => {
    // 200000 * 10% * 1.15
    expect(calculateRehab(null, [], 200000)).toBe(23000);
    const est = estimateRehab({ arv: 200000, keywords: ["STRUCTURAL - ROOF"] });
    expect(est.basis).toBe("arv_pct");
    expect(est.severity).toBe("severe");
    expect(est.amount).toBe(80500); // 200000 * 35% * 1.15
  });

  test("con sqft real → $/sqft por severidad + 15% contingencia", () => {
    expect(calculateRehab(1000, [])).toBe(28750);
    expect(calculateRehab(1000, ["electrical"])).toBe(51750);
    expect(calculateRehab(1000, ["structural"])).toBe(74750);
  });

  test("sqft fuera de rango se ignora", () => {
    expect(estimateRehab({ sqft: 50, arv: 100000 }).basis).toBe("arv_pct");
  });
});

describe("computeOfferTiers (AGENTS.md: 65/70/75% ARV − rehab)", () => {
  test("3 niveles exactos", () => {
    const t = computeOfferTiers({ arv: 200000, sqft: 1000, keywords: [] });
    expect(t.rehab).toBe(28750);
    expect(t.conservative).toBe(101250);
    expect(t.target).toBe(111250);
    expect(t.max).toBe(121250);
    expect(t.wholesaleSpread).toBe(10000);
    expect(t.hasValue).toBe(true);
    expect(t.viable).toBe(true);
  });

  test("sin ARV → Pendiente Valor (todo en 0, nunca inventado)", () => {
    const t = computeOfferTiers({ arv: 0, totalDebt: 90000 });
    expect(t.hasValue).toBe(false);
    expect(t.conservative + t.target + t.max).toBe(0);
  });

  test("sin pisos artificiales: rehab > descuento → 0 y no viable", () => {
    const t = computeOfferTiers({ arv: 50000, sqft: 2000, keywords: ["fire damage"] });
    expect(t.max).toBe(0);
    expect(t.viable).toBe(false);
  });

  test("belowDebt cuando el MAO no cubre la deuda", () => {
    const t = computeOfferTiers({ arv: 200000, sqft: 1000, totalDebt: 130000 });
    expect(t.belowDebt).toBe(true);
  });

  test("Kentucky: umbral de redención 2/3 del avalúo", () => {
    const t = computeOfferTiers({ arv: 150000, sqft: 1000, state: "KY", courtAppraisal: 150000 });
    expect(t.kyTwoThirdsThreshold).toBe(100000);
    expect(t.redemptionRisk).toBe(true);
    const inTiers = computeOfferTiers({ arv: 150000, sqft: 1000, state: "IN", courtAppraisal: 150000 });
    expect(inTiers.kyTwoThirdsThreshold).toBeNull();
  });
});

describe("underwriter helpers", () => {
  test("calculateNetEquity", () => {
    expect(calculateNetEquity(200000, 80000, 20000, 5000)).toBe(95000);
    expect(calculateNetEquity(150000, 160000, 0, 0)).toBe(-10000);
  });

  test("calculateMAO = 75% ARV − rehab − deudas que sobreviven", () => {
    expect(calculateMAO(200000, 30000, 10000, 5000)).toBe(105000);
    expect(calculateMAO(100000, 90000, 50000, 10000)).toBe(0);
  });

  test("isUnderwater", () => {
    expect(isUnderwater(100000, 120000, 0, 0)).toBe(true);
    expect(isUnderwater(100000, 80000, 10000, 5000)).toBe(false);
    expect(isUnderwater(100000, 80000, 25000, 0)).toBe(true);
  });

  test("checkCriticalRisk", () => {
    const risk1 = checkCriticalRisk(100000, 120000, 0, "BANK OF AMERICA", "12C01-1234", 0);
    expect(risk1.reasons.some(r => r.includes("bajo el agua"))).toBe(true);
    const risk2 = checkCriticalRisk(100000, 50000, 0, "ASSOCIATION", "12C01-1234", 0);
    expect(risk2.isRisk).toBe(true);
    expect(risk2.reasons.some(r => r.includes("Junior Lien"))).toBe(true);
  });

  test("calculateInstitutionalUnderwriting usa el ARV real (sin ×1.15) y el motor único", () => {
    const uw = calculateInstitutionalUnderwriting(200000, 1000, [], 100000, "IN");
    expect(uw.arv).toBe(200000);
    expect(uw.auctionMaxBid).toBe(101250);
    expect(uw.targetContractPrice).toBe(111250);
    expect(uw.walkAwayPrice).toBe(121250);
    expect(uw.equitySpread).toBe(100000);
    expect(uw.offerTiers.max).toBe(121250);
  });

  test("calculateInstitutionalUnderwriting sin valor → todo 0", () => {
    const uw = calculateInstitutionalUnderwriting(0, null, [], 50000, "KY");
    expect(uw.arv).toBe(0);
    expect(uw.walkAwayPrice).toBe(0);
    expect(uw.offerTiers.hasValue).toBe(false);
  });
});
