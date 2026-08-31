import axios from 'axios';

interface Lead {
  groupingKey: string;
  displayAddress: string;
  state: string;
  county: string;
  ownerName: string;
  phones: string[];
  emails: string[];
  mlsValue: number;
  mlsId: string;
  primaryDebt: number;
  hiddenMortgages: number;
  hiddenLiensAmount: number;
  lat: number | null;
  lon: number | null;
  auctions: any[];
  violations: any[];
  probates: any[];
  divorces: any[];
  bankruptcies: any[];
  physicalDistress: any[];
  financialDistress: any[];
  lifeEvents: any[];
  preForeclosures: any[];
  taxSales: any[];
  isAbsentee: boolean;
  photoUrls: string[];
  isHighMotivation?: boolean;
}

async function deepCheckRealEstateLeads() {
  console.log('================================================================');
  console.log('🔍 INICIANDO REVISIÓN DETALLADA DE CADA PROPIEDAD DE REAL ESTATE');
  console.log('================================================================\n');

  const res = await axios.get('http://localhost:3000/api/prospectos');
  const leads: Lead[] = res.data.data;

  console.log(`Total de propiedades cargadas en el módulo: ${leads.length}\n`);

  let invalidCoordsCount = 0;
  let unknownOwnerCount = 0;
  let negativeOrCorruptDebtCount = 0;
  let missingAddressCount = 0;
  let emptyDistressCount = 0;
  let auctionLeadsCount = 0;
  let preForeclosureCount = 0;

  const sampleHighPriorityLeads: any[] = [];

  leads.forEach((lead, idx) => {
    // 1. Check coordinates
    if (lead.lat === null || lead.lon === null || isNaN(lead.lat) || isNaN(lead.lon)) {
      invalidCoordsCount++;
      console.log(`❌ [Sin Coordenadas] Lead #${idx}: "${lead.displayAddress}"`);
    } else if (lead.lat < 36.5 || lead.lat > 40.5 || lead.lon > -82.0 || lead.lon < -89.0) {
      invalidCoordsCount++;
      console.log(`❌ [Coordenadas Fuera de Región] Lead #${idx}: "${lead.displayAddress}" -> (${lead.lat}, ${lead.lon})`);
    }

    // 2. Check address
    if (!lead.displayAddress || lead.displayAddress.trim() === '' || lead.displayAddress.includes('null')) {
      missingAddressCount++;
      console.log(`❌ [Dirección Inválida] Lead #${idx}: "${lead.displayAddress}"`);
    }

    // 3. Check Owner Name
    if (!lead.ownerName || lead.ownerName.trim() === '' || lead.ownerName === 'Unknown' || lead.ownerName === 'DUEÑO DESCONOCIDO' || lead.ownerName === 'No especificado') {
      unknownOwnerCount++;
    }

    // 4. Check Debts & Financial Calculations
    const totalDebt = (lead.primaryDebt || 0) + (lead.hiddenMortgages || 0) + (lead.hiddenLiensAmount || 0);
    if (isNaN(totalDebt) || totalDebt < 0 || (lead.primaryDebt || 0) < 0 || (lead.hiddenMortgages || 0) < 0 || (lead.hiddenLiensAmount || 0) < 0) {
      negativeOrCorruptDebtCount++;
      console.log(`❌ [Deuda Corrupta/Negativa] Lead #${idx}: "${lead.displayAddress}" -> Debt: ${totalDebt}`);
    }

    // 5. Distress categories verification
    const totalDistress = (lead.auctions?.length || 0) +
      (lead.violations?.length || 0) +
      (lead.probates?.length || 0) +
      (lead.divorces?.length || 0) +
      (lead.bankruptcies?.length || 0) +
      (lead.physicalDistress?.length || 0) +
      (lead.financialDistress?.length || 0) +
      (lead.lifeEvents?.length || 0) +
      (lead.preForeclosures?.length || 0) +
      (lead.taxSales?.length || 0);

    if (totalDistress === 0) {
      emptyDistressCount++;
    }

    if (lead.auctions && lead.auctions.length > 0) auctionLeadsCount++;
    if (lead.preForeclosures && lead.preForeclosures.length > 0) preForeclosureCount++;

    // Collect high priority samples
    if (lead.auctions?.length > 0 || lead.preForeclosures?.length > 0) {
      const marketVal = (lead.auctions && lead.auctions.length > 0 && lead.auctions[0].appraisal_value > 0) ? lead.auctions[0].appraisal_value : lead.mlsValue;
      const df = lead.state === 'KY' ? 0.66 : (lead.isHighMotivation ? 0.70 : 0.75);
      const mpo = Math.max(0, Math.round((marketVal * df) - totalDebt));
      const equitySpread = marketVal - totalDebt;

      if (sampleHighPriorityLeads.length < 10) {
        sampleHighPriorityLeads.push({
          address: lead.displayAddress,
          owner: lead.ownerName,
          countyState: `${lead.county}, ${lead.state}`,
          pva: marketVal,
          totalDebt: totalDebt,
          spread: equitySpread,
          mpo: mpo,
          type: lead.auctions?.length > 0 ? 'Subasta Sheriff' : 'Pre-Foreclosure (Demanda)',
          auctionDate: lead.auctions?.[0]?.auction_date || 'N/A',
          phonesCount: lead.phones.length
        });
      }
    }
  });

  console.log('--- REPORTE DE INTEGRIDAD ---');
  console.log(`✅ Propiedades con Coordenadas Válidas: ${leads.length - invalidCoordsCount} / ${leads.length} (${(((leads.length - invalidCoordsCount)/leads.length)*100).toFixed(1)}%)`);
  console.log(`✅ Propiedades con Direcciones Válidas: ${leads.length - missingAddressCount} / ${leads.length}`);
  console.log(`✅ Propiedades con Cálculos de Deuda Consistentes: ${leads.length - negativeOrCorruptDebtCount} / ${leads.length}`);
  console.log(`✅ Propiedades con Expedientes de Distress Activos: ${leads.length - emptyDistressCount} / ${leads.length}`);
  console.log(`📊 Propiedades con Subasta Sheriff Programada: ${auctionLeadsCount}`);
  console.log(`📊 Propiedades con Pre-Foreclosure / Demanda de Corte: ${preForeclosureCount}`);
  console.log(`ℹ️ Propiedades pendientes de resolución de nombre por registros PVA: ${unknownOwnerCount}\n`);

  console.log('--- MUESTRA DE PROPIEDADES CLAVE DE ALTO INTERÉS (AUDITORÍA TÁCTICA) ---');
  console.table(sampleHighPriorityLeads);
}

deepCheckRealEstateLeads().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
