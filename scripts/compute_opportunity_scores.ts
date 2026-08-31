import { db } from '../db';

function getDaysRemaining(dateStr: string | null): number | null {
  if (!dateStr) return null;
  try {
    let cleanDate = dateStr.toLowerCase().replace(/\s+/g, " ").trim();
    const months: Record<string, number> = {
      jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
      apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
      aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
      nov: 10, november: 10, dec: 11, december: 11
    };
    let dateObj: Date | null = null;
    if (/^\d+\/\d+\/\d+$/.test(cleanDate)) {
      const [m, d, y] = cleanDate.split("/").map(Number);
      dateObj = new Date(y, m - 1, d);
    } else if (cleanDate.includes("/")) {
      const parts = cleanDate.split("/");
      const monthName = parts[0].trim();
      const dayAndYear = parts[1].trim();
      const dayYearParts = dayAndYear.split(" ");
      const day = parseInt(dayYearParts[0]);
      const year = parseInt(dayYearParts[1] || "2026");
      if (months[monthName] !== undefined && !isNaN(day)) {
        dateObj = new Date(year, months[monthName], day);
      }
    } else {
      cleanDate = cleanDate.replace(/,/g, "");
      const parts = cleanDate.split(" ");
      if (parts.length >= 3) {
        const monthName = parts[0];
        const day = parseInt(parts[1]);
        const year = parseInt(parts[2]);
        if (months[monthName] !== undefined && !isNaN(day) && !isNaN(year)) {
          dateObj = new Date(year, months[monthName], day);
        }
      }
    }
    if (dateObj && !isNaN(dateObj.getTime())) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      dateObj.setHours(0, 0, 0, 0);
      const diffTime = dateObj.getTime() - today.getTime();
      return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }
  } catch (e) {}
  return null;
}

async function computeOpportunityScores() {
  console.log('================================================================');
  console.log('🎯 CALCULANDO TZEL OPPORTUNITY SCORES Y ACCIONES TÁCTICAS');
  console.log('================================================================\n');

  // Traer todas las propiedades del grafo
  const propsRes = await db.execute('SELECT * FROM tzel_properties');
  const eventsRes = await db.execute('SELECT * FROM tzel_events');
  const encsRes = await db.execute('SELECT * FROM tzel_encumbrances');
  const relsRes = await db.execute(`
    SELECT r.property_id, p.* 
    FROM tzel_property_person_relations r 
    JOIN tzel_persons p ON r.person_id = p.person_id
  `);

  // Map events by property
  const eventsMap = new Map<string, any[]>();
  for (const ev of eventsRes.rows) {
    const pid = ev.property_id as string;
    if (!eventsMap.has(pid)) eventsMap.set(pid, []);
    eventsMap.get(pid)!.push(ev);
  }

  // Map encumbrances by property
  const encsMap = new Map<string, any[]>();
  for (const enc of encsRes.rows) {
    const pid = enc.property_id as string;
    if (!encsMap.has(pid)) encsMap.set(pid, []);
    encsMap.get(pid)!.push(enc);
  }

  // Map persons by property
  const personsMap = new Map<string, any[]>();
  for (const p of relsRes.rows) {
    const pid = p.property_id as string;
    if (!personsMap.has(pid)) personsMap.set(pid, []);
    personsMap.get(pid)!.push(p);
  }

  const statements: any[] = [];
  const topOpportunities: any[] = [];

  for (const prop of propsRes.rows) {
    const pid = prop.property_id as string;
    const events = eventsMap.get(pid) || [];
    const encs = encsMap.get(pid) || [];
    const persons = personsMap.get(pid) || [];

    // Financial values
    const pva = Number(prop.pva_assessed_value || 0);
    const mca = Number(prop.mca_arv_value || 0);
    const marketVal = pva > 0 ? pva : (mca > 0 ? mca : 0);

    const totalDebt = encs.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
    const equitySpread = marketVal > 0 ? (marketVal - totalDebt) : 0;
    const equityRatio = marketVal > 0 ? (equitySpread / marketVal) : 0;

    // 1. Equity Score (0 - 100)
    let equityScore = 40;
    if (marketVal > 0) {
      if (equitySpread >= 100000) equityScore = 98;
      else if (equitySpread >= 60000) equityScore = 88;
      else if (equitySpread >= 30000) equityScore = 75;
      else if (equitySpread > 0) equityScore = 60;
      else equityScore = 20; // underwater
    }

    // 2. Motivation Score (0 - 100)
    let motivationScore = 30;
    const hasAuction = events.some(e => e.event_type === 'AUCTION_SCHEDULED');
    const hasPreForeclosure = events.some(e => e.event_type === 'FORECLOSURE_FILED');
    const hasCodeViol = events.some(e => e.event_type === 'CODE_VIOLATION');
    const hasTaxDelinq = events.some(e => e.event_type === 'TAX_DELINQUENCY');
    const hasStorm = events.some(e => e.event_type === 'STORM_IMPACT');
    const hasProbate = events.some(e => e.event_type === 'PROBATE_FILED');

    let stackingCount = events.length;

    // Impending auction urgency
    let closestDays: number | null = null;
    for (const ev of events) {
      if (ev.event_type === 'AUCTION_SCHEDULED' && ev.event_date) {
        const days = getDaysRemaining(ev.event_date);
        if (days !== null && days >= 0) {
          if (closestDays === null || days < closestDays) closestDays = days;
        }
      }
    }

    if (closestDays !== null) {
      if (closestDays <= 7) motivationScore = 98;
      else if (closestDays <= 15) motivationScore = 92;
      else if (closestDays <= 30) motivationScore = 85;
      else if (closestDays <= 60) motivationScore = 75;
      else motivationScore = 65;
    } else if (hasPreForeclosure) {
      motivationScore = 80;
    } else if (hasTaxDelinq) {
      motivationScore = 78;
    } else if (hasCodeViol) {
      motivationScore = 65;
    } else if (hasProbate) {
      motivationScore = 70;
    }

    if (stackingCount >= 3) motivationScore = Math.min(100, motivationScore + 15);
    else if (stackingCount === 2) motivationScore = Math.min(100, motivationScore + 8);

    // 3. Accessibility Score (0 - 100)
    let accessibilityScore = 30;
    let hasPhones = false;
    let hasName = false;
    let isAbsentee = false;

    for (const p of persons) {
      const phones = p.phones ? JSON.parse(p.phones as string) : [];
      if (phones.length > 0) hasPhones = true;
      if (p.normalized_name && p.normalized_name !== 'DUEÑO DESCONOCIDO') hasName = true;
      if (p.is_absentee) isAbsentee = true;
    }

    if (hasPhones) accessibilityScore = 95;
    else if (hasName) accessibilityScore = 75; // 1-click skip trace ready
    else if (isAbsentee) accessibilityScore = 55;

    // 4. Legal Risk Score (0 - 100, lower is safer)
    let legalRiskScore = 35;
    if (totalDebt > marketVal && marketVal > 0) legalRiskScore = 75; // Underwater
    if (encs.length > 3) legalRiskScore += 15;

    // 5. Total Opportunity Score (0 - 100)
    const opportunityScore = Math.round(
      (0.35 * equityScore) +
      (0.30 * motivationScore) +
      (0.20 * accessibilityScore) +
      (0.15 * (100 - legalRiskScore))
    );

    // 6. Tactical Action Determination
    let tacticalAction = 'REVISIÓN PRELIMINAR DE EXPEDIENTE';
    if (hasAuction && closestDays !== null && closestDays <= 30 && equitySpread >= 30000) {
      tacticalAction = 'LLAMAR DUEÑO: OFERTA COMPRA DIRECTA / SUBJECT-TO';
    } else if (hasPreForeclosure && equitySpread >= 25000) {
      tacticalAction = 'CONTACTO DÍA 0: EVITAR SUBASTA (Lis Pendens)';
    } else if (hasTaxDelinq && equitySpread > 20000) {
      tacticalAction = 'LIQUIDACIÓN DE IMPUESTOS MOROSOS (Tax Sale)';
    } else if (hasStorm && isAbsentee) {
      tacticalAction = 'GESTIÓN DE SEGURO / RECONSTRUCCIÓN TECHO';
    } else if (hasProbate) {
      tacticalAction = 'OFERTA SUCESIONES (Trato Sensible con Herederos)';
    } else if (hasCodeViol) {
      tacticalAction = 'OFERTA CASH AS-IS (Absorber Multas Municipales)';
    } else if (equitySpread >= 50000) {
      tacticalAction = 'OFERTA WHOLESALE / FLIP CON ALTO MARGEN';
    }

    const underwritingSummary = JSON.stringify({
      marketValue: marketVal,
      totalDebt: totalDebt,
      equitySpread: equitySpread,
      equityRatio: equityRatio,
      closestDaysRemaining: closestDays,
      eventCount: events.length,
      encumbranceCount: encs.length,
      primaryPlaintiff: events[0]?.plaintiff || 'Acreedor Registrado'
    });

    statements.push({
      sql: `INSERT OR REPLACE INTO tzel_opportunity_scores (
        property_id, opportunity_score, equity_score, motivation_score, accessibility_score, legal_risk_score, tactical_action, underwriting_summary, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      args: [
        pid, opportunityScore, equityScore, motivationScore, accessibilityScore, legalRiskScore, tacticalAction, underwritingSummary
      ]
    });

    if (opportunityScore >= 75) {
      topOpportunities.push({
        score: opportunityScore,
        address: prop.address,
        county: `${prop.county}, ${prop.state}`,
        action: tacticalAction,
        spread: `$${equitySpread.toLocaleString()}`,
        owner: persons[0]?.normalized_name || 'DUEÑO DESCONOCIDO',
        hasPhones: hasPhones ? '✅ Sí' : '🔍 Skip Trace'
      });
    }
  }

  // Batch execute opportunity scores
  console.log(`⚡ Insertando ${statements.length} Opportunity Scores calculados en lote...`);
  const chunkSize = 50;
  for (let i = 0; i < statements.length; i += chunkSize) {
    const chunk = statements.slice(i, i + chunkSize);
    await db.batch(chunk, 'write');
  }

  topOpportunities.sort((a, b) => b.score - a.score);

  console.log(`\n🎉 CÁLCULO DE OPPORTUNITY SCORES COMPLETADO.`);
  console.log(`🏆 TOP 10 OPORTUNIDADES DEL DÍA (RANKING 0 - 100):`);
  console.table(topOpportunities.slice(0, 10));
}

computeOpportunityScores().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
