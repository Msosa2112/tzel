import axios from 'axios';

async function auditOwnersAndContacts() {
  console.log('================================================================');
  console.log('🔍 AUDITORÍA DE DUEÑOS Y CONTACTOS (558 PROPIEDADES)');
  console.log('================================================================\n');

  const res = await axios.get('http://localhost:3000/api/prospectos');
  const leads = res.data.data;

  let withOwnerName = 0;
  let withoutOwnerName = 0;

  let withPhones = 0;
  let totalPhoneNumbers = 0;
  let withEmails = 0;
  let withOsintLinks = 0;
  let withoutDirectPhone = 0;

  const leadsWithoutOwner: any[] = [];
  const leadsWithoutPhone: any[] = [];

  const typeBreakdown: Record<string, { total: number; withOwner: number; withPhones: number }> = {};

  leads.forEach((lead: any) => {
    // Check owner
    const isUnknownOwner = !lead.ownerName ||
      lead.ownerName.trim() === '' ||
      lead.ownerName === 'Unknown' ||
      lead.ownerName === 'DUEÑO DESCONOCIDO' ||
      lead.ownerName === 'No especificado';

    if (isUnknownOwner) {
      withoutOwnerName++;
      if (leadsWithoutOwner.length < 10) {
        leadsWithoutOwner.push({
          address: lead.displayAddress,
          county: `${lead.county}, ${lead.state}`,
          hasAuctions: lead.auctions?.length > 0,
          hasViolations: lead.violations?.length > 0,
          hasPreForeclosure: lead.preForeclosures?.length > 0
        });
      }
    } else {
      withOwnerName++;
    }

    // Check contacts
    const hasPhones = lead.phones && lead.phones.length > 0;
    const hasEmails = lead.emails && lead.emails.length > 0;

    if (hasPhones) {
      withPhones++;
      totalPhoneNumbers += lead.phones.length;
    } else {
      withoutDirectPhone++;
      if (leadsWithoutPhone.length < 5) {
        leadsWithoutPhone.push({
          address: lead.displayAddress,
          owner: lead.ownerName,
          county: `${lead.county}, ${lead.state}`
        });
      }
    }

    if (hasEmails) {
      withEmails++;
      const hasOsint = lead.emails.some((e: string) => e.includes('http://') || e.includes('https://') || e.includes('TruePeopleSearch') || e.includes('Whitepages'));
      if (hasOsint) withOsintLinks++;
    }

    // Category breakdown
    let cat = 'Otras';
    if (lead.auctions?.length > 0) cat = 'Subasta Sheriff';
    else if (lead.preForeclosures?.length > 0) cat = 'Pre-Foreclosure';
    else if (lead.violations?.length > 0) cat = 'Violación de Código';
    else if (lead.financialDistress?.length > 0) cat = 'Estrés Financiero';
    else if (lead.lifeEvents?.length > 0) cat = 'Evento de Vida';

    if (!typeBreakdown[cat]) typeBreakdown[cat] = { total: 0, withOwner: 0, withPhones: 0 };
    typeBreakdown[cat].total++;
    if (!isUnknownOwner) typeBreakdown[cat].withOwner++;
    if (hasPhones) typeBreakdown[cat].withPhones++;
  });

  console.log(`📊 Total de Prospectos: ${leads.length}`);
  console.log(`👤 Con Dueño Identificado: ${withOwnerName} (${((withOwnerName / leads.length) * 100).toFixed(1)}%)`);
  console.log(`❓ Sin Dueño Identificado (Pendiente Catastro/PVA): ${withoutOwnerName} (${((withoutOwnerName / leads.length) * 100).toFixed(1)}%)\n`);

  console.log(`📞 Con Números Telefónicos Directos: ${withPhones} (${((withPhones / leads.length) * 100).toFixed(1)}%)`);
  console.log(`📱 Total de Teléfonos Disponibles: ${totalPhoneNumbers}`);
  console.log(`🔗 Con Enlaces Directos OSINT / Skip Trace: ${withOsintLinks}`);
  console.log(`⏳ Sin Teléfono Directo (Requieren Skip Trace o Búsqueda OSINT): ${withoutDirectPhone}\n`);

  console.log('--- DESGLOSE POR TIPO DE LEAD ---');
  console.table(typeBreakdown);

  console.log('\n--- MUESTRA DE PROPIEDADES SIN DUEÑO (PRINCIPALMENTE MULTAS DE CÓDIGO) ---');
  console.table(leadsWithoutOwner);
}

auditOwnersAndContacts().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
