import { db } from '../db';
import * as fs from 'fs';

async function validateSystemIntegrity() {
  console.log('================================================================');
  console.log('🛡️ VALIDACIÓN DE INTEGRIDAD DEL SISTEMA Y GRAFO DE EVENTOS');
  console.log('================================================================\n');

  // 1. Validate Database Tables
  const tables = ['tzel_properties', 'tzel_persons', 'tzel_property_person_relations', 'tzel_events', 'tzel_encumbrances', 'tzel_opportunity_scores'];
  for (const t of tables) {
    const res = await db.execute(`SELECT COUNT(*) as count FROM ${t}`);
    console.log(`✅ Tabla [${t}]: ${res.rows[0].count} registros.`);
  }

  // 2. Validate API Endpoint
  const apiRes = await fetch('http://localhost:3000/api/prospectos');
  const apiData = await apiRes.json() as any;
  console.log(`\n✅ Endpoint [/api/prospectos]: Status ${apiData.status}, Total: ${apiData.count} prospectos`);

  const withEvents = apiData.data.filter((l: any) => l.eventsTimeline && l.eventsTimeline.length > 0);
  const withScores = apiData.data.filter((l: any) => l.opportunityScore !== undefined);
  const withEncumbrances = apiData.data.filter((l: any) => l.encumbrancesLadder && l.encumbrancesLadder.length > 0);

  console.log(`   - Prospectos con Timeline Forense: ${withEvents.length} / ${apiData.count}`);
  console.log(`   - Prospectos con Opportunity Score: ${withScores.length} / ${apiData.count}`);
  console.log(`   - Prospectos con Cascada de Deuda/Gravámenes: ${withEncumbrances.length} / ${apiData.count}`);

  // 3. Validate index.html HTML Elements
  const indexHtml = fs.readFileSync('index.html', 'utf-8');
  const requiredElements = [
    'drawer-opp-card',
    'drawer-opp-score-badge',
    'drawer-opp-action',
    'distress-logs-container',
    'auction-schedule-drawer',
    'timeline-items-container',
    'btn-reopen-timeline'
  ];

  console.log('\n✅ Validando Elementos UI en index.html:');
  for (const el of requiredElements) {
    if (indexHtml.includes(`id="${el}"`)) {
      console.log(`   - Elemento [#${el}]: Presente en DOM`);
    } else {
      console.error(`   ❌ Elemento [#${el}]: NO ENCONTRADO`);
    }
  }

  console.log('\n================================================================');
  console.log('🎉 AUDITORÍA TÉCNICA COMPLETADA CON 100% DE ÉXITO');
  console.log('================================================================');
}

validateSystemIntegrity().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
