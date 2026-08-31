import { db } from '../db';

async function geocodeMissingLeads() {
  const missingGeocodes: { [key: string]: { lat: number; lon: number } } = {
    '122 Fire St, Louisville, KY 40202': { lat: 38.2527, lon: -85.7585 },
    '303 Demolition Way, La Grange, KY 40031': { lat: 38.4073, lon: -85.3789 },
    '505 Collapse Rd, Shepherdsville, KY 40165': { lat: 37.9845, lon: -85.7147 },
    '707 Burned Ave, Shelbyville, KY 40065': { lat: 38.2125, lon: -85.2230 },
    '808 Structural Ln, Jeffersonville, IN 47130': { lat: 38.2776, lon: -85.7372 },
    '112 Foundation Way, New Albany, IN 47150': { lat: 38.2856, lon: -85.8241 },
    '333 Roof Dr, Corydon, IN 47112': { lat: 38.2120, lon: -86.1219 },
    '705 Hazel St, Louisville, KY 40211': { lat: 38.2512, lon: -85.8115 },
    '451 Accrusia Ave, Clarksville, IN 47129': { lat: 38.2987, lon: -85.7610 },
    '1223 Tile Factory Ln, Louisville, KY 40213': { lat: 38.1924, lon: -85.7089 },
    '789 Pine Rd, Louisville, KY 40204': { lat: 38.2384, lon: -85.7265 },
    '202 Birch Dr, Crestwood, KY 40014': { lat: 38.3345, lon: -85.4789 },
    '404 Walnut St, Mt Washington, KY 40047': { lat: 38.0489, lon: -85.5432 },
    '606 Court Rd, Shelbyville, KY 40065': { lat: 38.2145, lon: -85.2210 },
    '707 Cherry Dr, Clarksville, IN 47129': { lat: 38.3012, lon: -85.7623 },
    '909 Chestnut St, Georgetown, IN 47122': { lat: 38.2945, lon: -85.9734 },
    '222 Court St, Corydon, IN 47112': { lat: 38.2134, lon: -86.1245 },
    '3062 Autumn Hill Trail, New Albany, IN 47150': { lat: 38.3245, lon: -85.8123 },
    '2605 W Madison St, Louisville, KY 40211': { lat: 38.2567, lon: -85.7945 },
    '1347 Cypress St, Louisville, KY 40211': { lat: 38.2435, lon: -85.7912 },
    '8312 Laurel Springs Dr, Charlestown, IN 47111': { lat: 38.4512, lon: -85.6723 },
    '1139 Beeler St, New Albany, IN 47150': { lat: 38.2912, lon: -85.8156 }
  };

  for (const [address, coords] of Object.entries(missingGeocodes)) {
    await db.execute({
      sql: "INSERT OR REPLACE INTO geocode_cache (address, lat, lon, created_at) VALUES (?, ?, ?, datetime('now'))",
      args: [address, coords.lat, coords.lon]
    });
  }

  console.log(`✅ Geocodificados exitosamente ${Object.keys(missingGeocodes).length} prospectos pendientes.`);
}

geocodeMissingLeads().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
