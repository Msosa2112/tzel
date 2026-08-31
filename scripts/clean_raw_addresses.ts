import { db } from '../db';

async function cleanRawAddressesAndVerify() {
  console.log('--- Limpiando direcciones con formato repetido o comas dobles ---');

  // 1. Harrison County auctions
  await db.execute({
    sql: "UPDATE foreclosure_auctions SET address = '8410 Valley City Mauckport Rd SW, Mauckport, IN 47142' WHERE address LIKE '%8410 Valley City%'",
    args: []
  });
  await db.execute({
    sql: "UPDATE foreclosure_auctions SET address = '9360 Highway 135 NE, New Salisbury, IN 47161' WHERE address LIKE '%9360 Highway 135%'",
    args: []
  });
  await db.execute({
    sql: "UPDATE foreclosure_auctions SET address = '2231 Lenrose Lane NW, Corydon, IN 47112' WHERE address LIKE '%2231 Lenrose%'",
    args: []
  });
  await db.execute({
    sql: "UPDATE foreclosure_auctions SET address = '430 Scenic View Drive, Laconia, IN 47135' WHERE address LIKE '%430 Scenic View%'",
    args: []
  });
  await db.execute({
    sql: "UPDATE foreclosure_auctions SET address = '3610 Kyle Drive NW, Corydon, IN 47112' WHERE address LIKE '%3610 Kyle Drive%'",
    args: []
  });

  // 2. Add geocodes for these clean addresses
  const coords: Record<string, { lat: number; lon: number }> = {
    '8410 Valley City Mauckport Rd SW, Mauckport, IN 47142': { lat: 38.0264, lon: -86.2008 },
    '9360 Highway 135 NE, New Salisbury, IN 47161': { lat: 38.3148, lon: -86.1086 },
    '2231 Lenrose Lane NW, Corydon, IN 47112': { lat: 38.2325, lon: -86.1450 },
    '430 Scenic View Drive, Laconia, IN 47135': { lat: 38.0270, lon: -85.9890 },
    '3610 Kyle Drive NW, Corydon, IN 47112': { lat: 38.2410, lon: -86.1380 }
  };

  for (const [addr, c] of Object.entries(coords)) {
    await db.execute({
      sql: "INSERT OR REPLACE INTO geocode_cache (address, lat, lon, created_at) VALUES (?, ?, ?, datetime('now'))",
      args: [addr, c.lat, c.lon]
    });
  }

  console.log('✅ Direcciones normalizadas y geocodificadas correctamente.');
}

cleanRawAddressesAndVerify().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
