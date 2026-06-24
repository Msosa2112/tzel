import axios from "axios";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import * as crypto from "crypto";

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

const googleKey = process.env.GOOGLE_MAPS_API_KEY || "";

interface GeocodedAddress {
  address: string;
  county: string;
  state: string;
  zip: string;
}

const targetCounties = ["jefferson", "oldham", "bullitt", "shelby", "clark", "floyd", "harrison"];

// Helper to delay execution (cooldown)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function reverseGeocode(lat: number, lon: number): Promise<GeocodedAddress | null> {
  // 1. Try Nominatim first
  try {
    const url = "https://nominatim.openstreetmap.org/reverse";
    const response = await axios.get(url, {
      params: {
        lat,
        lon,
        format: "json",
        zoom: 18,
        addressdetails: 1
      },
      headers: {
        "User-Agent": "TZEL-Storm-Locator/1.0 (contact@tzel.app)"
      },
      timeout: 8000
    });
    
    if (response.data && response.data.address) {
      const addr = response.data.address;
      const houseNumber = addr.house_number || "";
      const road = addr.road || "";
      const city = addr.city || addr.town || addr.village || addr.hamlet || "";
      const state = addr.state || "";
      const postcode = addr.postcode || "";
      let county = addr.county || "";
      
      // Clean county name
      if (county.toLowerCase().endsWith(" county")) {
        county = county.substring(0, county.length - 7).trim();
      }
      
      // Clean state to abbreviation
      let stateAbbr = state;
      if (state.toLowerCase() === "kentucky") stateAbbr = "KY";
      else if (state.toLowerCase() === "indiana") stateAbbr = "IN";
      
      const streetAddress = `${houseNumber} ${road}`.trim();
      if (streetAddress) {
        return {
          address: `${streetAddress}, ${city}, ${stateAbbr} ${postcode}`.replace(/,\s*,/g, ",").trim(),
          county,
          state: stateAbbr,
          zip: postcode
        };
      }
    }
  } catch (err: any) {
    console.warn(`[REVERSE GEOCODE] Nominatim failed for (${lat}, ${lon}): ${err.message}. Trying Google fallback...`);
  }

  // 2. Fallback to Google Geocoding API if key is present
  if (googleKey) {
    try {
      const url = "https://maps.googleapis.com/maps/api/geocode/json";
      const response = await axios.get(url, {
        params: {
          latlng: `${lat},${lon}`,
          key: googleKey
        },
        timeout: 8000
      });
      
      if (response.data && response.data.status === "OK" && response.data.results.length > 0) {
        const result = response.data.results[0];
        const addressComponents = result.address_components;
        
        let houseNumber = "";
        let road = "";
        let city = "";
        let state = "";
        let postcode = "";
        let county = "";
        
        for (const comp of addressComponents) {
          const types = comp.types;
          if (types.includes("street_number")) houseNumber = comp.long_name;
          if (types.includes("route")) road = comp.long_name;
          if (types.includes("locality")) city = comp.long_name;
          if (types.includes("administrative_area_level_1")) state = comp.short_name; // e.g. "KY"
          if (types.includes("administrative_area_level_2")) county = comp.long_name; // e.g. "Jefferson County"
          if (types.includes("postal_code")) postcode = comp.long_name;
        }
        
        if (county.toLowerCase().endsWith(" county")) {
          county = county.substring(0, county.length - 7).trim();
        }
        
        const streetAddress = `${houseNumber} ${road}`.trim();
        if (streetAddress) {
          return {
            address: `${streetAddress}, ${city}, ${state} ${postcode}`.trim(),
            county,
            state,
            zip: postcode
          };
        }
      }
    } catch (googleErr: any) {
      console.error(`[REVERSE GEOCODE] Google failed for (${lat}, ${lon}): ${googleErr.message}`);
    }
  }
  
  return null;
}

export async function scrapeDisasterDamage() {
  console.log("[DISASTER SCRAPER] Iniciando captura de reportes de daño de NOAA/NWS...");
  
  // Vamos a buscar tormentas de los últimos 90 días
  const daysLimit = 90;
  const dateLimit = new Date();
  dateLimit.setDate(dateLimit.getDate() - daysLimit);
  const formattedDate = dateLimit.toISOString().split("T")[0]; // YYYY-MM-DD
  
  const url = "https://services.dat.noaa.gov/arcgis/rest/services/nws_damageassessmenttoolkit/DamageViewer/FeatureServer/0/query";
  
  let newLeadsCount = 0;
  
  try {
    console.log(`[DISASTER SCRAPER] Consultando NOAA DAT para stormdate >= ${formattedDate} en oficinas LMK/IND...`);
    const response = await axios.get(url, {
      params: {
        where: `stormdate >= DATE '${formattedDate}' AND office IN ('LMK', 'IND')`,
        outFields: "*",
        orderByFields: "stormdate DESC",
        f: "json"
      },
      timeout: 25000
    });
    
    if (!response.data || !response.data.features) {
      console.log("[DISASTER SCRAPER] No se encontraron características en NOAA.");
      return;
    }
    
    const features = response.data.features;
    console.log(`[DISASTER SCRAPER] Encontrados ${features.length} puntos de daño preliminares en NOAA. Procesando...`);
    
    for (const feat of features) {
      const att = feat.attributes;
      const globalid = att.globalid;
      if (!globalid) continue;
      
      // 1. Verificar si ya tenemos el globalid guardado en los detalles de physical_distress
      const checkRes = await db.execute({
        sql: "SELECT distress_id FROM physical_distress WHERE details LIKE ?",
        args: [`%${globalid}%`]
      });
      
      if (checkRes.rows.length > 0) {
        // Ya procesado, omitir para no gastar llamadas a Nominatim/Google
        continue;
      }
      
      const lat = att.lat;
      const lon = att.lon;
      if (!lat || !lon) continue;
      
      // Cooldown para Nominatim (1 segundo entre llamadas)
      await sleep(1000);
      
      console.log(`[DISASTER SCRAPER] Nuevo punto de daño encontrado (globalid: ${globalid}) en (${lat}, ${lon}). Geocodificando...`);
      const geocoded = await reverseGeocode(lat, lon);
      if (!geocoded) {
        console.warn(`[DISASTER SCRAPER] No se pudo geocodificar las coordenadas (${lat}, ${lon}).`);
        continue;
      }
      
      const cleanCounty = geocoded.county.toLowerCase().trim();
      
      // 2. Filtrar geocerca por condados permitidos
      if (!targetCounties.includes(cleanCounty)) {
        console.log(`[DISASTER SCRAPER] Omitiendo dirección en condado '${geocoded.county}' (fuera de la geocerca).`);
        continue;
      }
      
      console.log(`[DISASTER SCRAPER] ¡Coincidencia dentro de geocerca! Dirección: ${geocoded.address} (${geocoded.county}, ${geocoded.state})`);
      
      // Crear ID único de Distress
      const addressHash = crypto.createHash("md5").update(geocoded.address).digest("hex").substring(0, 10);
      const distressId = `PD_${addressHash.toUpperCase()}`;
      
      // Formatear fecha del stormdate
      const stormDateStr = att.stormdate ? new Date(att.stormdate).toISOString().split("T")[0] : new Date().toISOString().split("T")[0];
      
      // Determinar distress_type
      let distressType = "Storm Damage";
      const ef = att.efscale || "";
      if (ef.toUpperCase().startsWith("EF") || ef.toUpperCase().includes("TORNADO")) {
        distressType = "Tornado Damage";
      } else if (att.damage_txt && att.damage_txt.toLowerCase().includes("hail")) {
        distressType = "Hail Damage";
      }
      
      // Construir detalles
      const detailsLines = [
        `[NOAA DAT ID: ${globalid}]`,
        `Estructura: ${att.damage_txt || "No especificada"}`,
        `Daño: ${att.dod_txt || "Sin descripción de daño"}`,
        `Escala: ${ef || "N/A"}`,
        `Comentarios del NWS: ${att.comments || "Sin comentarios adicionales"}`
      ];
      const details = detailsLines.join("\n");
      
      // Insertar en la base de datos
      await db.execute({
        sql: `
          INSERT INTO physical_distress (
            distress_id, address, county, state, distress_type, report_date, details, owner_name, 
            ef_scale, nws_survey_details, wind_speed_est, telegram_sent
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'DUEÑO DESCONOCIDO', ?, ?, ?, 0)
          ON CONFLICT(distress_id) DO UPDATE SET
            report_date = excluded.report_date,
            details = excluded.details,
            ef_scale = excluded.ef_scale,
            nws_survey_details = excluded.nws_survey_details,
            wind_speed_est = excluded.wind_speed_est
        `,
        args: [
          distressId,
          geocoded.address,
          geocoded.county,
          geocoded.state,
          distressType,
          stormDateStr,
          details,
          ef || null,
          att.comments || null,
          parseFloat(att.windspeed) || null
        ]
      });
      
      // También agregar las coordenadas en el geocode_cache para no geocodificar en el frontend
      await db.execute({
        sql: "INSERT OR REPLACE INTO geocode_cache (address, lat, lon) VALUES (?, ?, ?)",
        args: [geocoded.address, lat, lon]
      });
      
      newLeadsCount++;
    }
    
    console.log(`[DISASTER SCRAPER SUCCESS] Completado. Nuevos leads de tormentas ingresados: ${newLeadsCount}`);
  } catch (err: any) {
    console.error(`[DISASTER SCRAPER ERROR] Falló la ejecución: ${err.message}`);
  }
}

if (require.main === module) {
  scrapeDisasterDamage().catch(console.error);
}
