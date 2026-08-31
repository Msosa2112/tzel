import { db } from '../db';

async function checkDetails() {
  const auctions = await db.execute("SELECT * FROM foreclosure_auctions WHERE defendant LIKE '%Unknown%' OR defendant = 'No especificado'");
  console.log('AUCTIONS WITH UNKNOWN DEFENDANT:', auctions.rows.map(a => ({ id: a.auction_id, address: a.address, def: a.defendant, debt: a.debt_amount })));
  
  const pf = await db.execute("SELECT * FROM pre_foreclosures WHERE defendant LIKE '%Unknown%' OR defendant = 'No especificado'");
  console.log('\nPRE_FORECLOSURES WITH UNKNOWN DEFENDANT:', pf.rows.map(p => ({ id: p.pre_foreclosure_id, address: p.address, def: p.defendant })));

  const tax = await db.execute("SELECT * FROM tax_sales WHERE owner_name LIKE '%Unknown%' OR owner_name = 'No especificado'");
  console.log('\nTAX SALES WITH UNKNOWN OWNER:', tax.rows.map(t => ({ id: t.tax_sale_id, address: t.address, owner: t.owner_name })));

  // Check geocodes outside KY/IN region
  const geocodes = await db.execute('SELECT * FROM geocode_cache');
  const badGeo = geocodes.rows.filter(g => 
    g.lat !== null && (
      (g.lat as number) < 36.5 || (g.lat as number) > 40.5 || 
      (g.lon as number) > -82.0 || (g.lon as number) < -89.0
    )
  );
  console.log('\nBAD GEOCODES OUTSIDE KY/IN:', badGeo);
}

checkDetails().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
