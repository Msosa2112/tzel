import { collectFacebookGroupLeads } from "../leads/facebook_group_collector";
import { deepScanFacebookGroups } from "../leads/facebook_group_deep_scanner";
import { ConstructionTelegramNotifier } from "../notifiers/construction_telegram_notifier";
import { syncLeadToBarbaPro } from "../integrations/barbapro_bridge";
import { db } from "../../../db";
import * as dotenv from "dotenv";

dotenv.config();

const INTERVAL_MINUTES = 60; // Frecuencia de ejecución horaria (1 hora)
const INTERVAL_MS = INTERVAL_MINUTES * 60 * 1000;

const notifier = new ConstructionTelegramNotifier();

/**
 * Servicio en Segundo Plano: Radar Horario de Facebook y Sincronización con BarbaProsystem
 */
async function runHourlyFacebookCycle() {
  const timestamp = new Date().toLocaleString("es-ES", { timeZone: "America/New_York" });
  console.log(`\n=================================================================`);
  console.log(`⏰ [${timestamp}] INICIANDO ESCANEO HORARIO INTEGRAL (RADAR + BARBAPRO)`);
  console.log(`=================================================================`);

  let totalNewLeads = 0;
  let totalSyncedToBarba = 0;

  try {
    // -------------------------------------------------------------
    // FASE 1: Búsquedas Estructuradas de 10 Gremios (KY & IN)
    // -------------------------------------------------------------
    console.log("\n[FASE 1] Ejecutando Radar Global de 10 Gremios (KY & Sur de IN)...");
    const globalLeads = await collectFacebookGroupLeads();
    console.log(`📊 Total de publicaciones calificadas en Radar Global: ${globalLeads.length}`);

    for (const lead of globalLeads) {
      try {
        const check = await db.execute({
          sql: "SELECT telegram_sent FROM construction_leads WHERE lead_id = ? LIMIT 1",
          args: [lead.leadId]
        });

        const alreadySent = check.rows.length > 0 && Boolean(check.rows[0].telegram_sent);
        if (!alreadySent) {
          console.log(`  📲 [TELEGRAM] Enviando nuevo lead a Telegram: ${lead.leadId} - ${lead.ownerName}`);
          await notifier.notifyLead(lead);
          totalNewLeads++;

          // Sincronizar automáticamente con BarbaProsystem con Speech de Venta
          const synced = await syncLeadToBarbaPro(lead);
          if (synced) totalSyncedToBarba++;
        }
      } catch (dbErr: any) {
        console.warn(`  ⚠️ Error comprobando estado en DB: ${dbErr.message}`);
      }
    }

    // -------------------------------------------------------------
    // FASE 2: Escáner Profundo Grupo por Grupo (Top 20 Grupos)
    // -------------------------------------------------------------
    console.log("\n[FASE 2] Ejecutando Escáner Profundo en los 20 Grupos Locales...");
    const groupLeads = await deepScanFacebookGroups(20);
    console.log(`📊 Total de publicaciones calificadas en Grupos: ${groupLeads.length}`);

    for (const lead of groupLeads) {
      try {
        const check = await db.execute({
          sql: "SELECT telegram_sent FROM construction_leads WHERE lead_id = ? LIMIT 1",
          args: [lead.leadId]
        });

        const alreadySent = check.rows.length > 0 && Boolean(check.rows[0].telegram_sent);
        if (!alreadySent) {
          console.log(`  📲 [TELEGRAM] Enviando nuevo lead de grupo a Telegram: ${lead.leadId} - ${lead.ownerName}`);
          await notifier.notifyLead(lead);
          totalNewLeads++;

          // Sincronizar automáticamente con BarbaProsystem con Speech de Venta
          const synced = await syncLeadToBarbaPro(lead);
          if (synced) totalSyncedToBarba++;
        }
      } catch (dbErr: any) {
        console.warn(`  ⚠️ Error comprobando estado en DB: ${dbErr.message}`);
      }
    }

    // -------------------------------------------------------------
    // FASE 3: Escáner Comunitario (Craigslist Louisville & Sur de IN)
    // -------------------------------------------------------------
    console.log("\n[FASE 3] Ejecutando Escáner Comunitario (Craigslist Louisville & IN)...");
    const { scanCommunityCraigslistLeads } = await import("../leads/community_craigslist_scanner");
    const clLeads = await scanCommunityCraigslistLeads();
    console.log(`📊 Total de publicaciones comunitarias de Craigslist: ${clLeads.length}`);

    // -------------------------------------------------------------
    // FASE 4: Escáner de Vecindarios de Alto Valor (Nextdoor KY & IN)
    // -------------------------------------------------------------
    console.log("\n[FASE 4] Ejecutando Escáner Vecinal de Nextdoor (Muro + Gremios)...");
    const { scanNextdoorNeighborhoodLeads } = await import("../leads/nextdoor_louisville_scraper");
    const ndLeads = await scanNextdoorNeighborhoodLeads();
    console.log(`📊 Total de oportunidades vecinales de Nextdoor: ${ndLeads.length}`);

    console.log(`\n🎉 [CICLO HORARIO COMPLETADO]`);
    console.log(`   • ${totalNewLeads} nuevos leads notificados a Telegram.`);
    console.log(`   • ${totalSyncedToBarba + clLeads.length + ndLeads.length} nuevos leads inyectados en BarbaProsystem con Speeches de Venta.`);
  } catch (err: any) {
    console.error(`❌ [ERROR EN CICLO HORARIO] ${err.message}`);
  }

  const nextRun = new Date(Date.now() + INTERVAL_MS).toLocaleTimeString("es-ES", { timeZone: "America/New_York" });
  console.log(`⏳ Próximo escaneo programado para las: ${nextRun} (en ${INTERVAL_MINUTES} minutos)\n`);
}

async function startDaemon() {
  console.log("=================================================================");
  console.log("🚀 DEMONIO HORARIO INTEGRAL ACTIVADO (TZEL -> BARBAPROSYSTEM)");
  console.log(`⏱️ Frecuencia: Cada ${INTERVAL_MINUTES} minutos (1 hora)`);
  console.log(`🎯 Alcance: 10 Gremios de Obra en KY & IN + Top 20 Grupos Locales`);
  console.log("=================================================================\n");

  // 1. Ejecución inmediata al arrancar
  await runHourlyFacebookCycle();

  // 2. Programación recurrente cada hora
  setInterval(async () => {
    await runHourlyFacebookCycle();
  }, INTERVAL_MS);
}

// Iniciar demonio
if (require.main === module) {
  startDaemon().catch(console.error);
}

export { startDaemon, runHourlyFacebookCycle };
