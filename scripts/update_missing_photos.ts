import { db } from "../db";
import * as dotenv from "dotenv";
import { fetchPublicPropertyPhoto } from "../scrapers/public_photo_scraper";
import { sendTelegramNotification } from "../telegram_helper";
import pLimit from "p-limit";

dotenv.config();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const limit = pLimit(3);

async function updatePhotosForTable(
  rows: any[],
  tableName: string,
  idColumnName: string,
  idPropertyName: string,
  typeName: string
): Promise<number> {
  let updatedCount = 0;
  
  const tasks = rows.map((row) => {
    return limit(async () => {
      const id = row[idPropertyName] as string;
      const address = row.address as string;
      console.log(`\n➡️ Buscando foto para ${typeName}: ${id} | Dirección: "${address}"`);
      
      try {
        const photos = await fetchPublicPropertyPhoto(address);
        if (photos && photos.length > 0) {
          await db.execute({
            sql: `UPDATE ${tableName} SET photo_urls = ? WHERE ${idColumnName} = ?`,
            args: [JSON.stringify(photos), id]
          });
          console.log(`✅ ¡FOTO ENCONTRADA Y GUARDADA! Url: ${photos[0]}`);
          updatedCount++;
        } else {
          console.log("❌ No se encontraron fotos públicas.");
        }
      } catch (err: any) {
        console.error(`💥 Error al procesar ${id}:`, err.message);
      }
      await sleep(1500); // Espaciar solicitudes para evitar rate limits
    });
  });

  await Promise.all(tasks);
  return updatedCount;
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
  const auctionsUpdated = await updatePhotosForTable(
    auctionsRes.rows,
    "foreclosure_auctions",
    "auction_id",
    "auction_id",
    "subasta"
  );

  // 2. Code Violations
  console.log("\n[2/5] Evaluando violaciones de código (code_violations)...");
  const violationsRes = await db.execute(`
    SELECT violation_id, address FROM code_violations 
    WHERE photo_urls IS NULL OR photo_urls = '' OR photo_urls = '[]' OR photo_urls = 'null'
    LIMIT 15
  `);
  console.log(`[INFO] Se encontraron ${violationsRes.rows.length} violaciones sin fotos.`);
  const violationsUpdated = await updatePhotosForTable(
    violationsRes.rows,
    "code_violations",
    "violation_id",
    "violation_id",
    "violación"
  );

  // 3. Physical Distress
  console.log("\n[3/5] Evaluando estrés físico (physical_distress)...");
  const physicalRes = await db.execute(`
    SELECT distress_id, address FROM physical_distress 
    WHERE photo_urls IS NULL OR photo_urls = '' OR photo_urls = '[]' OR photo_urls = 'null'
    LIMIT 5
  `);
  console.log(`[INFO] Se encontraron ${physicalRes.rows.length} registros de estrés físico sin fotos.`);
  const physicalUpdated = await updatePhotosForTable(
    physicalRes.rows,
    "physical_distress",
    "distress_id",
    "distress_id",
    "estrés físico"
  );

  // 4. Financial Distress
  console.log("\n[4/5] Evaluando gravámenes financieros (financial_distress)...");
  const financialRes = await db.execute(`
    SELECT record_id, address FROM financial_distress 
    WHERE photo_urls IS NULL OR photo_urls = '' OR photo_urls = '[]' OR photo_urls = 'null'
    LIMIT 5
  `);
  console.log(`[INFO] Se encontraron ${financialRes.rows.length} gravámenes sin fotos.`);
  const financialUpdated = await updatePhotosForTable(
    financialRes.rows,
    "financial_distress",
    "record_id",
    "record_id",
    "gravamen"
  );

  // 5. Life Events
  console.log("\n[5/5] Evaluando eventos de vida (life_events)...");
  const lifeRes = await db.execute(`
    SELECT event_id, address FROM life_events 
    WHERE photo_urls IS NULL OR photo_urls = '' OR photo_urls = '[]' OR photo_urls = 'null'
    LIMIT 5
  `);
  console.log(`[INFO] Se encontraron ${lifeRes.rows.length} eventos de vida sin fotos.`);
  const lifeUpdated = await updatePhotosForTable(
    lifeRes.rows,
    "life_events",
    "event_id",
    "event_id",
    "evento de vida"
  );

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

  const appUrl = process.env.APP_URL || "https://tzel.vercel.app";

  // Enviar mensaje de finalización a Telegram
  const telegramMessage = `📸 <b>TZEL PHOTO SCRAPER COMPLETADO</b> 📸\n\n` +
    `La búsqueda de fotos para registros existentes en Turso DB ha finalizado:\n` +
    `- Subastas actualizadas: ${auctionsUpdated}\n` +
    `- Violaciones actualizadas: ${violationsUpdated}\n` +
    `- Estrés físico actualizado: ${physicalUpdated}\n` +
    `- Gravámenes actualizados: ${financialUpdated}\n` +
    `- Eventos de vida actualizados: ${lifeUpdated}\n\n` +
    `🎉 <b>Total de propiedades enriquecidas con nuevas fotos: ${totalUpdated}</b>\n` +
    `👉 Abre ${appUrl} para visualizarlas en el mapa táctico.`;

  await sendTelegramNotification(telegramMessage, null, null, "HTML");
}

main().catch(console.error);
