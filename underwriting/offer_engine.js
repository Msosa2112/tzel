/**
 * TZEL Offer Engine — FUENTE ÚNICA de las fórmulas de oferta (AGENTS.md §3.5).
 *
 * Compartido por el servidor (require/import) y el navegador (window.TzelOfferEngine,
 * servido en /offer_engine.js). No duplicar estas fórmulas en otro sitio.
 *
 *   Conservadora = 65% ARV − Rehab
 *   Target       = 70% ARV − Rehab
 *   MAO          = 75% ARV − Rehab
 *
 * Reglas Truth in Advertising (AGENTS.md §2.A):
 *   - ARV = valor de mercado efectivo (avalúo judicial / PVA / MLS). Sin multiplicadores inventados.
 *   - Sin ARV → todas las ofertas en 0 (la UI muestra "Pendiente Valor").
 *   - Sin pies cuadrados NO se asume una casa estándar: el rehab se estima como % del ARV
 *     y se marca rehabBasis = "arv_pct" para que la UI lo indique.
 *   - Nunca se fuerzan pisos ni márgenes artificiales: si la fórmula da ≤ 0, la oferta es 0 (no viable).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.TzelOfferEngine = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var OFFER_PCT = Object.freeze({ conservative: 0.65, target: 0.70, max: 0.75 });

  var SEVERE_RX = /structural|roof|dangerous|unsafe|foundation|fire|demolition|condemn|collapse|tornado|daño|dano|peligro|techo|incendio|derrumbe/i;
  var MODERATE_RX = /boarded|plumbing|electrical|maintenance|grass|weed|vacant|tapiado|plomer|mantenimiento|vacante|el[eé]ctric/i;

  /** $/sqft por severidad cuando conocemos el área real. */
  var RATE_PER_SQFT = Object.freeze({ cosmetic: 25, moderate: 45, severe: 65 });
  /** % del ARV por severidad cuando NO hay área (escala con el valor de la casa en vez de inventar 1,400 sqft). */
  var PCT_OF_ARV = Object.freeze({ cosmetic: 0.10, moderate: 0.20, severe: 0.35 });
  var CONTINGENCY = 1.15;
  var MIN_VALID_SQFT = 400;
  var MAX_VALID_SQFT = 10000;

  function toNumber(value) {
    var n = Number(value);
    return isFinite(n) ? n : 0;
  }

  /**
   * @param {string[]} keywords tipos de violación / distress físico
   * @returns {"cosmetic"|"moderate"|"severe"}
   */
  function rehabSeverity(keywords) {
    var list = Array.isArray(keywords) ? keywords : [];
    var text = list.filter(Boolean).join(" | ");
    if (SEVERE_RX.test(text)) return "severe";
    if (MODERATE_RX.test(text)) return "moderate";
    return "cosmetic";
  }

  /**
   * @param {{ arv?: number, sqft?: number|null, keywords?: string[], severity?: string }} input
   * @returns {{ amount: number, basis: "sqft"|"arv_pct"|"unknown", severity: string }}
   */
  function estimateRehab(input) {
    var opts = input || {};
    var arv = toNumber(opts.arv);
    var sqft = toNumber(opts.sqft);
    var severity = RATE_PER_SQFT[opts.severity] ? opts.severity : rehabSeverity(opts.keywords);

    if (sqft >= MIN_VALID_SQFT && sqft <= MAX_VALID_SQFT) {
      return { amount: Math.round(sqft * RATE_PER_SQFT[severity] * CONTINGENCY), basis: "sqft", severity: severity };
    }
    if (arv > 0) {
      return { amount: Math.round(arv * PCT_OF_ARV[severity] * CONTINGENCY), basis: "arv_pct", severity: severity };
    }
    return { amount: 0, basis: "unknown", severity: severity };
  }

  function tier(arv, pct, rehab) {
    return Math.max(0, Math.round(arv * pct - rehab));
  }

  /**
   * Calcula los 3 niveles de oferta.
   *
   * @param {{
   *   arv: number,              // valor de mercado efectivo
   *   sqft?: number|null,
   *   keywords?: string[],      // violaciones + distress físico
   *   severity?: string,        // opcional: fuerza la severidad (p.ej. recalcular con otro ARV)
   *   totalDebt?: number,       // deuda judicial + hipotecas ocultas + gravámenes
   *   state?: string,
   *   courtAppraisal?: number   // avalúo judicial (para la regla de 2/3 de Kentucky)
   * }} input
   */
  function computeOfferTiers(input) {
    var opts = input || {};
    var arv = Math.max(0, Math.round(toNumber(opts.arv)));
    var totalDebt = Math.max(0, toNumber(opts.totalDebt));
    var rehab = estimateRehab({ arv: arv, sqft: opts.sqft, keywords: opts.keywords, severity: opts.severity });

    if (arv <= 0) {
      return {
        arv: 0,
        rehab: 0,
        rehabBasis: "unknown",
        severity: rehab.severity,
        conservative: 0,
        target: 0,
        max: 0,
        hasValue: false,
        viable: false,
        belowDebt: false,
        wholesaleSpread: 0,
        kyTwoThirdsThreshold: null,
        redemptionRisk: false
      };
    }

    var conservative = tier(arv, OFFER_PCT.conservative, rehab.amount);
    var target = tier(arv, OFFER_PCT.target, rehab.amount);
    var max = tier(arv, OFFER_PCT.max, rehab.amount);

    // Kentucky (KRS 426.530): si la venta judicial no alcanza 2/3 del avalúo, el deudor conserva
    // derecho de redención. Si nuestra puja conservadora queda por debajo, hay riesgo de redención.
    var appraisal = toNumber(opts.courtAppraisal);
    var isKY = String(opts.state || "").toUpperCase() === "KY";
    var kyThreshold = isKY && appraisal > 0 ? Math.round(appraisal * 2 / 3) : null;

    return {
      arv: arv,
      rehab: rehab.amount,
      rehabBasis: rehab.basis,
      severity: rehab.severity,
      conservative: conservative,
      target: target,
      max: max,
      hasValue: true,
      viable: max > 0,
      // La oferta máxima no alcanza para liquidar la deuda: el cierre requeriría short sale / negociación con el acreedor.
      belowDebt: totalDebt > 0 && max < totalDebt,
      // Margen entre precio de contrato (Target) y el máximo que pagaría un inversionista (MAO).
      wholesaleSpread: Math.max(0, max - target),
      kyTwoThirdsThreshold: kyThreshold,
      redemptionRisk: kyThreshold !== null && conservative < kyThreshold
    };
  }

  return {
    OFFER_PCT: OFFER_PCT,
    rehabSeverity: rehabSeverity,
    estimateRehab: estimateRehab,
    computeOfferTiers: computeOfferTiers
  };
});
