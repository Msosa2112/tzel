import { db } from '../db';
import axios from 'axios';

async function auditDataQuality() {
  console.log('========================================================');
  console.log('🔍 INICIANDO AUDITORÍA INTEGRAL DE CALIDAD DE DATOS TZEL');
  console.log('========================================================\n');

  // 1. Foreclosure auctions audit
  const auctions = await db.execute('SELECT * FROM foreclosure_auctions');
  console.log(`1. Subastas de Ejecución Hipotecaria (foreclosure_auctions): ${auctions.rows.length} registros`);
  const aucAnomalies = auctions.rows.filter(r => 
    (r.debt_amount as number) > 2000000 || 
    (r.hidden_liens_amount as number) > 500000 || 
    (r.hidden_mortgages as number) > 1000000 ||
    r.defendant === 'Unknown' ||
    r.defendant === 'No especificado' ||
    !r.defendant ||
    (r.address as string).includes('null')
  );
  console.log(`   -> Anomalías detectadas: ${aucAnomalies.length}`);
  aucAnomalies.forEach(a => console.log(`      [ID: ${a.auction_id}] ${a.address} | Dueño: "${a.defendant}" | Deuda: $${a.debt_amount} | Liens: $${a.hidden_liens_amount} | Mortgages: $${a.hidden_mortgages}`));

  // 2. Pre-foreclosures audit
  const preForeclosures = await db.execute('SELECT * FROM pre_foreclosures');
  console.log(`\n2. Pre-Foreclosures (pre_foreclosures): ${preForeclosures.rows.length} registros`);
  const pfAnomalies = preForeclosures.rows.filter(r => 
    r.defendant === 'Unknown' ||
    r.defendant === 'Unknown Defendant' ||
    !r.defendant ||
    (r.address as string).includes('null')
  );
  console.log(`   -> Anomalías detectadas: ${pfAnomalies.length}`);
  pfAnomalies.forEach(p => console.log(`      [ID: ${p.pre_foreclosure_id}] ${p.address} | Dueño: "${p.defendant}" | Demandante: "${p.plaintiff}" | County: ${p.county}, ${p.state}`));

  // 3. Tax sales audit
  const taxSales = await db.execute('SELECT * FROM tax_sales');
  console.log(`\n3. Subastas Fiscales (tax_sales): ${taxSales.rows.length} registros`);
  const tsAnomalies = taxSales.rows.filter(r => 
    !r.owner_name ||
    r.owner_name === 'Unknown' ||
    r.owner_name === 'No especificado'
  );
  console.log(`   -> Anomalías detectadas: ${tsAnomalies.length}`);
  tsAnomalies.forEach(t => console.log(`      [ID: ${t.tax_sale_id}] ${t.address} | Dueño: "${t.owner_name}" | Impuestos: $${t.taxes_owed}`));

  // 4. Code violations audit
  const violations = await db.execute('SELECT * FROM code_violations');
  console.log(`\n4. Multas de Código (code_violations): ${violations.rows.length} registros`);
  const violAnomalies = violations.rows.filter(r => 
    !r.owner_name ||
    r.owner_name === 'DUEÑO DESCONOCIDO' ||
    r.owner_name === 'Unknown'
  );
  console.log(`   -> Sin titular identificado: ${violAnomalies.length}`);

  // 5. Geocode Cache Anomalies (e.g. wrong coordinates or null)
  const geocodes = await db.execute('SELECT * FROM geocode_cache');
  console.log(`\n5. Caché de Geocodificación (geocode_cache): ${geocodes.rows.length} registros`);
  const geoAnomalies = geocodes.rows.filter(g => 
    g.lat === null || 
    (g.lat as number) < 36.5 || (g.lat as number) > 40.5 || 
    (g.lon as number) > -82.0 || (g.lon as number) < -89.0
  );
  console.log(`   -> Coordenadas nulas o fuera del radio KY/IN: ${geoAnomalies.length}`);
  geoAnomalies.forEach(g => console.log(`      ${g.address} -> Lat: ${g.lat}, Lon: ${g.lon}`));

  // 6. Test Live API Consolidation
  try {
    const apiRes = await axios.get('http://localhost:3000/api/prospectos');
    const leads = apiRes.data.data;
    console.log(`\n6. Leads Consolidados por /api/prospectos: ${leads.length} prospectos`);

    const unknownOwnerLeads = leads.filter((l: any) => 
      !l.ownerName || 
      l.ownerName.toLowerCase().includes('unknown') || 
      l.ownerName.toLowerCase().includes('desconocido') || 
      l.ownerName.toLowerCase().includes('no especificado')
    );
    console.log(`   -> Leads consolidados con dueño desconocido: ${unknownOwnerLeads.length}`);
    unknownOwnerLeads.forEach((l: any) => console.log(`      📍 ${l.displayAddress} | Dueño: "${l.ownerName}" | Deuda: $${l.primaryDebt + (l.hiddenMortgages || 0) + (l.hiddenLiensAmount || 0)}`));

    const strangeDebtLeads = leads.filter((l: any) => {
      const tot = (l.primaryDebt || 0) + (l.hiddenMortgages || 0) + (l.hiddenLiensAmount || 0);
      return tot > 1000000;
    });
    console.log(`\n   -> Leads con deuda mayor a $1,000,000: ${strangeDebtLeads.length}`);
    strangeDebtLeads.forEach((l: any) => console.log(`      💰 ${l.displayAddress} | Deuda Total: $${(l.primaryDebt || 0) + (l.hiddenMortgages || 0) + (l.hiddenLiensAmount || 0)} | Primary: $${l.primaryDebt} | HiddenMort: $${l.hiddenMortgages} | HiddenLiens: $${l.hiddenLiensAmount}`));

    const nullCoordsLeads = leads.filter((l: any) => l.lat === null || l.lon === null);
    console.log(`\n   -> Leads sin coordenadas en el mapa: ${nullCoordsLeads.length}`);
    nullCoordsLeads.forEach((l: any) => console.log(`      🗺️ ${l.displayAddress}`));
  } catch (e: any) {
    console.log('Error conectando con API local:', e.message);
  }
}

auditDataQuality().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
