import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import axios from "axios";
import { fetchPublicPropertyPhoto } from "../scrapers/public_photo_scraper";

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendTelegram(msg: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log("[TELEGRAM] Warning: credentials not set in .env");
    return;
  }
  try {
    await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
      chat_id: chatId,
      text: msg,
      parse_mode: "HTML"
    });
    console.log("[TELEGRAM] Notificación enviada con éxito.");
  } catch (err: any) {
    console.error("[TELEGRAM ERROR] Falló el envío:", err.message);
  }
}

async function main() {
  console.log("=================================================================");
  console.log("📸 INICIANDO BÚSQUEDA DE FOTOS PARA REGISTROS EXISTENTES 📸");
  console.log("=================================================================");

  // 1. Foreclosure Auctions
  console.log("\n[1/5] Evaluando subastas judiciales (foreclosure_auctions)...");
  const auctionsRes = await db.execute(`
    SELECT auction_id, address FROM foreclosure_auctions 
    WHERE photo_urls IS NULL OR photo_urls = '' OR photo_urls = '[]' OR photo_urls = 'null'
    LIMIT 25
  `);
  
  console.log(`[INFO] Se encontraron ${auctionsRes.rows.length} subastas sin fotos.`);
  let auctionsUpdated = 0;
  for (const row of auctionsRes.rows) {
    const id = row.auction_id as string;
    const address = row.address as string;
    console.log(`\n➡️ Buscando foto para subasta: ${id} | Dirección: "${address}"`);
    
    try {
      const photos = await fetchPublicPropertyPhoto(address);
      if (photos && photos.length > 0) {
        await db.execute({
          sql: "UPDATE foreclosure_auctions SET photo_urls = ? WHERE auction_id = ?",
          args: [JSON.stringify(photos), id]
        });
        console.log(`✅ ¡FOTO ENCONTRADA Y GUARDADA! Url: ${photos[0]}`);
        auctionsUpdated++;
      } else {
        console.log("❌ No se encontraron fotos públicas.");
      }
    } catch (err: any) {
      console.error(`💥 Error al procesar ${id}:`, err.message);
    }
    await sleep(2000); // Evitar rate limiting
  }

  // 2. Code Violations
  console.log("\n[2/5] Evaluando violaciones de código (code_violations)...");
  const violationsRes = await db.execute(`
    SELECT violation_id, address FROM code_violations 
    WHERE photo_urls IS NULL OR photo_urls = '' OR photo_urls = '[]' OR photo_urls = 'null'
    LIMIT 15
  `);
  
  console.log(`[INFO] Se encontraron ${violationsRes.rows.length} violaciones sin fotos.`);
  let violationsUpdated = 0;
  for (const row of violationsRes.rows) {
    const id = row.violation_id as string;
    const address = row.address as string;
    console.log(`\n➡️ Buscando foto para violación: ${id} | Dirección: "${address}"`);
    
    try {
      const photos = await fetchPublicPropertyPhoto(address);
      if (photos && photos.length > 0) {
        await db.execute({
          sql: "UPDATE code_violations SET photo_urls = ? WHERE violation_id = ?",
          args: [JSON.stringify(photos), id]
        });
        console.log(`✅ ¡FOTO ENCONTRADA Y GUARDADA! Url: ${photos[0]}`);
        violationsUpdated++;
      } else {
        console.log("❌ No se encontraron fotos públicas.");
      }
    } catch (err: any) {
      console.error(`💥 Error al procesar ${id}:`, err.message);
    }
    await sleep(2000); // Evitar rate limiting
  }

  // 3. Physical Distress
  console.log("\n[3/5] Evaluando estrés físico (physical_distress)...");
  const physicalRes = await db.execute(`
    SELECT distress_id, address FROM physical_distress 
    WHERE photo_urls IS NULL OR photo_urls = '' OR photo_urls = '[]' OR photo_urls = 'null'
    LIMIT 5
  `);
  
  console.log(`[INFO] Se encontraron ${physicalRes.rows.length} registros de estrés físico sin fotos.`);
  let physicalUpdated = 0;
  for (const row of physicalRes.rows) {
    const id = row.distress_id as string;
    const address = row.address as string;
    console.log(`\n➡️ Buscando foto para estrés físico: ${id} | Dirección: "${address}"`);
    
    try {
      const photos = await fetchPublicPropertyPhoto(address);
      if (photos && photos.length > 0) {
        await db.execute({
          sql: "UPDATE physical_distress SET photo_urls = ? WHERE distress_id = ?",
          args: [JSON.stringify(photos), id]
        });
        console.log(`✅ ¡FOTO ENCONTRADA Y GUARDADA! Url: ${photos[0]}`);
        physicalUpdated++;
      } else {
        console.log("❌ No se encontraron fotos públicas.");
      }
    } catch (err: any) {
      console.error(`💥 Error al procesar ${id}:`, err.message);
    }
    await sleep(2000); // Evitar rate limiting
  }

  // 4. Financial Distress
  console.log("\n[4/5] Evaluando gravámenes financieros (financial_distress)...");
  const financialRes = await db.execute(`
    SELECT record_id, address FROM financial_distress 
    WHERE photo_urls IS NULL OR photo_urls = '' OR photo_urls = '[]' OR photo_urls = 'null'
    LIMIT 5
  `);
  
  console.log(`[INFO] Se encontraron ${financialRes.rows.length} gravámenes sin fotos.`);
  let financialUpdated = 0;
  for (const row of financialRes.rows) {
    const id = row.record_id as string;
    const address = row.address as string;
    console.log(`\n➡️ Buscando foto para gravamen: ${id} | Dirección: "${address}"`);
    
    try {
      const photos = await fetchPublicPropertyPhoto(address);
      if (photos && photos.length > 0) {
        await db.execute({
          sql: "UPDATE financial_distress SET photo_urls = ? WHERE record_id = ?",
          args: [JSON.stringify(photos), id]
        });
        console.log(`✅ ¡FOTO ENCONTRADA Y GUARDADA! Url: ${photos[0]}`);
        financialUpdated++;
      } else {
        console.log("❌ No se encontraron fotos públicas.");
      }
    } catch (err: any) {
      console.error(`💥 Error al procesar ${id}:`, err.message);
    }
    await sleep(2000); // Evitar rate limiting
  }

  // 5. Life Events
  console.log("\n[5/5] Evaluando eventos de vida (life_events)...");
  const lifeRes = await db.execute(`
    SELECT event_id, address FROM life_events 
    WHERE photo_urls IS NULL OR photo_urls = '' OR photo_urls = '[]' OR photo_urls = 'null'
    LIMIT 5
  `);
  
  console.log(`[INFO] Se encontraron ${lifeRes.rows.length} eventos de vida sin fotos.`);
  let lifeUpdated = 0;
  for (const row of lifeRes.rows) {
    const id = row.event_id as string;
    const address = row.address as string;
    console.log(`\n➡️ Buscando foto para evento de vida: ${id} | Dirección: "${address}"`);
    
    try {
      const photos = await fetchPublicPropertyPhoto(address);
      if (photos && photos.length > 0) {
        await db.execute({
          sql: "UPDATE life_events SET photo_urls = ? WHERE event_id = ?",
          args: [JSON.stringify(photos), id]
        });
        console.log(`✅ ¡FOTO ENCONTRADA Y GUARDADA! Url: ${photos[0]}`);
        lifeUpdated++;
      } else {
        console.log("❌ No se encontraron fotos públicas.");
      }
    } catch (err: any) {
      console.error(`💥 Error al procesar ${id}:`, err.message);
    }
    await sleep(2000); // Evitar rate limiting
  }

  console.log("\n=================================================================");
  console.log("🏁 RESUMEN GENERAL DE BÚSQUEDA DE FOTOS:");
  const totalUpdated = auctionsUpdated + violationsUpdated + physicalUpdated + financialUpdated + lifeUpdated;
  console.log(`- Subastas actualizadas: ${auctionsUpdated}`);
  console.log(`- Violaciones actualizadas: ${violationsUpdated}`);
  console.log(`- Estrés físico actualizado: ${physicalUpdated}`);
  console.log(`- Gravámenes actualizados: ${financialUpdated}`);
  console.log(`- Eventos de vida actualizados: ${lifeUpdated}`);
  console.log(`- Total de registros con nuevas fotos: ${totalUpdated}`);
  console.log("=================================================================");

  // Enviar mensaje de finalización a Telegram
  const telegramMessage = `📸 <b>TZEL PHOTO SCRAPER COMPLETADO</b> 📸\n\n` +
    `La búsqueda de fotos para registros existentes en Turso DB ha finalizado:\n` +
    `- Subastas actualizadas: ${auctionsUpdated}\n` +
    `- Violaciones actualizadas: ${violationsUpdated}\n` +
    `- Estrés físico actualizado: ${physicalUpdated}\n` +
    `- Gravámenes actualizados: ${financialUpdated}\n` +
    `- Eventos de vida actualizados: ${lifeUpdated}\n\n` +
    `🎉 <b>Total de propiedades enriquecidas con nuevas fotos: ${totalUpdated}</b>\n` +
    `👉 Abre http://localhost:3000 para visualizarlas en el mapa táctico.`;

  await sendTelegram(telegramMessage);
}

main().catch(console.error);
