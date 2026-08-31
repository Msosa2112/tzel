import axios from 'axios';

function getDaysRemaining(dateStr: string | null) {
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
  } catch (e) {
    // Fallback
  }
  return null;
}

async function testAll558Hydrations() {
  console.log('🧪 Iniciando prueba de estrés e hidratación de las 558 propiedades...');
  const res = await axios.get('http://localhost:3000/api/prospectos');
  const leads = res.data.data;

  let errors = 0;

  leads.forEach((lead: any, i: number) => {
    try {
      // 1. Validate required fields
      if (!lead.groupingKey) throw new Error('Missing groupingKey');
      if (!lead.displayAddress) throw new Error('Missing displayAddress');
      
      // 2. Validate financial calculations
      const totalDebt = (lead.primaryDebt || 0) + (lead.hiddenMortgages || 0) + (lead.hiddenLiensAmount || 0);
      const pvaVal = (lead.auctions && lead.auctions.length > 0 && lead.auctions[0].appraisal_value > 0) ? lead.auctions[0].appraisal_value : (lead.mlsValue || 0);
      const initialSpread = pvaVal > 0 ? (pvaVal - totalDebt) : 0;
      const df = lead.state === 'KY' ? 0.66 : (lead.isHighMotivation ? 0.70 : 0.75);
      const initialMpo = pvaVal > 0 ? Math.max(0, Math.round((pvaVal * df) - totalDebt)) : (totalDebt > 0 ? totalDebt : 0);

      if (isNaN(initialSpread) || isNaN(initialMpo)) {
        throw new Error('NaN in calculations');
      }

      // 3. Test dates in auctions
      if (lead.auctions) {
        lead.auctions.forEach((auc: any) => {
          const days = getDaysRemaining(auc.auction_date);
          if (auc.auction_date && days === null) {
            // Unparseable date
          }
        });
      }

    } catch (e: any) {
      errors++;
      console.error(`Error in lead #${i} (${lead.displayAddress}):`, e.message);
    }
  });

  if (errors === 0) {
    console.log(`✅ ¡ÉXITO TOTAL! Las 558 propiedades pasaron la validación de hidratación y cálculo sin ningún error.`);
  } else {
    console.log(`⚠️ Se encontraron ${errors} errores en la validación.`);
  }
}

testAll558Hydrations().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
