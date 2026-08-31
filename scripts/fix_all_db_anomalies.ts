import { db } from '../db';
import { cleanLegalOwnerName } from './test_clean_names';

async function fixAllDatabaseAnomalies() {
  console.log('--- 1. Resolviendo dueños en Pre-Foreclosures y Subastas ---');
  
  // Update Elizabeth Taylor on 606 Willow Way
  await db.execute({
    sql: "UPDATE foreclosure_auctions SET defendant = 'ELIZABETH TAYLOR', county = 'Clark', state = 'IN' WHERE address LIKE '%606 Willow Way%'",
    args: []
  });
  await db.execute({
    sql: "UPDATE pre_foreclosures SET defendant = 'ELIZABETH TAYLOR', county = 'Clark', state = 'IN' WHERE address LIKE '%606 Willow Way%'",
    args: []
  });

  // Update George Harris on 111 Ash Cir
  await db.execute({
    sql: "UPDATE foreclosure_auctions SET defendant = 'GEORGE HARRIS', county = 'Harrison', state = 'IN' WHERE address LIKE '%111 Ash Cir%'",
    args: []
  });
  await db.execute({
    sql: "UPDATE pre_foreclosures SET defendant = 'GEORGE HARRIS', county = 'Harrison', state = 'IN' WHERE address LIKE '%111 Ash Cir%'",
    args: []
  });

  // Update counties for pre_foreclosures
  await db.execute({
    sql: "UPDATE pre_foreclosures SET county = 'Kenton', state = 'KY' WHERE address LIKE '%Ludlow%'",
    args: []
  });
  await db.execute({
    sql: "UPDATE pre_foreclosures SET county = 'Rowan', state = 'KY' WHERE address LIKE '%Morehead%'",
    args: []
  });
  await db.execute({
    sql: "UPDATE pre_foreclosures SET county = 'Shelby', state = 'KY' WHERE address LIKE '%Simpsonville%'",
    args: []
  });
  await db.execute({
    sql: "UPDATE pre_foreclosures SET county = 'Hardin', state = 'KY' WHERE address LIKE '%Radcliff%'",
    args: []
  });
  await db.execute({
    sql: "UPDATE pre_foreclosures SET county = 'Floyd', state = 'IN' WHERE address LIKE '%New Albany%'",
    args: []
  });

  console.log('--- 2. Limpiando Geocodificaciones Erróneas en geocode_cache ---');
  // Fix 606 Willow Way geocode
  await db.execute({
    sql: "INSERT OR REPLACE INTO geocode_cache (address, lat, lon, created_at) VALUES ('606 Willow Way', 38.3079, -85.7335, datetime('now'))",
    args: []
  });
  await db.execute({
    sql: "INSERT OR REPLACE INTO geocode_cache (address, lat, lon, created_at) VALUES ('606 Willow Way, Jeffersonville, IN 47130', 38.3079, -85.7335, datetime('now'))",
    args: []
  });

  // Fix 111 Ash Cir geocode
  await db.execute({
    sql: "INSERT OR REPLACE INTO geocode_cache (address, lat, lon, created_at) VALUES ('111 Ash Cir', 38.2120121, -86.1219155, datetime('now'))",
    args: []
  });
  await db.execute({
    sql: "INSERT OR REPLACE INTO geocode_cache (address, lat, lon, created_at) VALUES ('111 Ash Cir, Corydon, IN 47112', 38.2120121, -86.1219155, datetime('now'))",
    args: []
  });

  // Fix 505 Elm Rd, Shelbyville geocode
  await db.execute({
    sql: "INSERT OR REPLACE INTO geocode_cache (address, lat, lon, created_at) VALUES ('505 Elm Rd, Shelbyville, KY 40065', 38.2125, -85.2230, datetime('now'))",
    args: []
  });

  // Clean bad generic multi-address key
  await db.execute({
    sql: "DELETE FROM geocode_cache WHERE lat > 41.0 OR lon > -80.0",
    args: []
  });

  console.log('--- 3. Limpiando nombres legales complejos en foreclosure_auctions ---');
  const allAuctions = await db.execute("SELECT auction_id, defendant FROM foreclosure_auctions WHERE defendant LIKE '%UNKNOWN%' OR defendant LIKE '%ESTATE OF%'");
  for (const row of allAuctions.rows) {
    const rawDef = row.defendant as string;
    const cleaned = cleanLegalOwnerName(rawDef);
    if (cleaned !== rawDef) {
      await db.execute({
        sql: "UPDATE foreclosure_auctions SET defendant = ? WHERE auction_id = ?",
        args: [cleaned, row.auction_id]
      });
      console.log(`   [${row.auction_id}] ${rawDef} ===> ${cleaned}`);
    }
  }

  console.log('✅ TODAS LAS ANOMALÍAS DE BASE DE DATOS FUERON CORREGIDAS CON ÉXITO');
}

fixAllDatabaseAnomalies().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
