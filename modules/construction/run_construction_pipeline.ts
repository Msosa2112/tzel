import { initConstructionSchema } from "./db_construction";
import { PublicBidsCollector } from "./bids/public_bids_collector";
import { collectZoningVarianceLeads } from "./leads/zoning_variance_collector";
import { collectDemolitionLeads } from "./leads/demolition_permits_collector";
import { collectFoundationDrainageLeads } from "./leads/foundation_drainage_collector";
import { collectHistoricRenovationLeads } from "./leads/historic_renovations_collector";
import { collectCurbCutPavingLeads } from "./leads/curb_cut_paving_collector";
import { collectPoolFenceLeads } from "./leads/pool_fence_collector";
import { collectStormDamageLeads } from "./leads/storm_damage_collector";
import { collectStructuralRepairsLeads } from "./leads/structural_repairs_collector";
import { collectSocialIntentLeads } from "./leads/social_intent_collector";
import { collectFacebookGroupLeads } from "./leads/facebook_group_collector";
import { collectLinkedInLeads } from "./leads/linkedin_lead_collector";
import { collectMultiDirectoryLeads } from "./leads/multi_directory_osint_collector";
import { ConstructionTelegramNotifier } from "./notifiers/construction_telegram_notifier";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * Orquestador Principal del Módulo de Construcción y Obras (TZEL Construction Module)
 * Jurisdicción: Kentucky (KY) y Sur de Indiana (IN).
 */
export async function runConstructionPipeline(options: { dryRun?: boolean; notifyTelegram?: boolean } = {}) {
  console.log("=================================================================");
  console.log("🏗️ INICIANDO PIPELINE DE CONSTRUCCIÓN & OBRAS (KY / SUR DE IN) 🏗️");
  console.log(`Fecha/Hora: ${new Date().toISOString()}`);
  console.log(`Modo: ${options.dryRun ? "SIMULACIÓN (DRY-RUN)" : "PRODUCCIÓN"}`);
  console.log("=================================================================");

  // 1. Inicializar esquema de Base de Datos en Turso
  await initConstructionSchema();

  const bidsCollector = new PublicBidsCollector();
  const notifier = new ConstructionTelegramNotifier();

  // =================================================================
  // CAPA 1: CONCURSOS Y LICITACIONES PÚBLICAS (GOVERNMENT BIDS)
  // =================================================================
  console.log("\n=================================================================");
  console.log("🏛️ [CAPA 1] RECOLECCIÓN DE LICITACIONES PÚBLICAS");
  console.log("=================================================================");

  try {
    const louBids = await bidsCollector.collectLouisvilleMetroBids();
    if (options.notifyTelegram) {
      for (const bid of louBids) await notifier.notifyBid(bid);
    }
  } catch (err: any) {
    console.error("[CAPA 1 ERR] Falló recolector de Louisville Bids:", err.message);
  }

  try {
    const kyBids = await bidsCollector.collectKentuckyStateBids();
    if (options.notifyTelegram) {
      for (const bid of kyBids) await notifier.notifyBid(bid);
    }
  } catch (err: any) {
    console.error("[CAPA 1 ERR] Falló recolector de Kentucky State Bids:", err.message);
  }

  try {
    const inBids = await bidsCollector.collectIndianaStateBids();
    if (options.notifyTelegram) {
      for (const bid of inBids) await notifier.notifyBid(bid);
    }
  } catch (err: any) {
    console.error("[CAPA 1 ERR] Falló recolector de Indiana IDOA Bids:", err.message);
  }

  // =================================================================
  // CAPA 2: LEADS PRIVADOS Y DISPARADORES DE OBRAS PARTICULARES
  // =================================================================
  console.log("\n=================================================================");
  console.log("🏡 [CAPA 2] LEADS PRIVADOS Y REFORMAS RESIDENCIALES");
  console.log("=================================================================");

  try {
    const zoningLeads = await collectZoningVarianceLeads();
    if (options.notifyTelegram) {
      for (const lead of zoningLeads) await notifier.notifyLead(lead);
    }
  } catch (err: any) {
    console.error("[CAPA 2 ERR] Falló recolector de zonificación BOZA:", err.message);
  }

  try {
    const demoLeads = await collectDemolitionLeads();
    if (options.notifyTelegram) {
      for (const lead of demoLeads) await notifier.notifyLead(lead);
    }
  } catch (err: any) {
    console.error("[CAPA 2 ERR] Falló recolector de demoliciones:", err.message);
  }

  try {
    const foundationLeads = await collectFoundationDrainageLeads();
    if (options.notifyTelegram) {
      for (const lead of foundationLeads) await notifier.notifyLead(lead);
    }
  } catch (err: any) {
    console.error("[CAPA 2 ERR] Falló recolector de cimentaciones/sótanos:", err.message);
  }

  try {
    const historicLeads = await collectHistoricRenovationLeads();
    if (options.notifyTelegram) {
      for (const lead of historicLeads) await notifier.notifyLead(lead);
    }
  } catch (err: any) {
    console.error("[CAPA 2 ERR] Falló recolector de distritos históricos:", err.message);
  }

  try {
    const pavingLeads = await collectCurbCutPavingLeads();
    if (options.notifyTelegram) {
      for (const lead of pavingLeads) await notifier.notifyLead(lead);
    }
  } catch (err: any) {
    console.error("[CAPA 2 ERR] Falló recolector de pavimentación:", err.message);
  }

  try {
    const poolLeads = await collectPoolFenceLeads();
    if (options.notifyTelegram) {
      for (const lead of poolLeads) await notifier.notifyLead(lead);
    }
  } catch (err: any) {
    console.error("[CAPA 2 ERR] Falló recolector de cercas de piscinas:", err.message);
  }

  try {
    const stormLeads = await collectStormDamageLeads();
    if (options.notifyTelegram) {
      for (const lead of stormLeads) await notifier.notifyLead(lead);
    }
  } catch (err: any) {
    console.error("[CAPA 2 ERR] Falló recolector de daños por tormenta (NOAA):", err.message);
  }

  try {
    const repairLeads = await collectStructuralRepairsLeads();
    if (options.notifyTelegram) {
      for (const lead of repairLeads) await notifier.notifyLead(lead);
    }
  } catch (err: any) {
    console.error("[CAPA 2 ERR] Falló recolector de daños estructurales / código:", err.message);
  }

  try {
    const socialLeads = await collectSocialIntentLeads();
    if (options.notifyTelegram) {
      for (const lead of socialLeads) await notifier.notifyLead(lead);
    }
  } catch (err: any) {
    console.error("[CAPA 2 ERR] Falló recolector de intención social (Craigslist/Comunidades):", err.message);
  }

  try {
    const fbLeads = await collectFacebookGroupLeads();
    if (options.notifyTelegram) {
      for (const lead of fbLeads) await notifier.notifyLead(lead);
    }
  } catch (err: any) {
    console.error("[CAPA 2 ERR] Falló recolector de grupos de Facebook:", err.message);
  }

  try {
    const liLeads = await collectLinkedInLeads();
    if (options.notifyTelegram) {
      for (const lead of liLeads) await notifier.notifyLead(lead);
    }
  } catch (err: any) {
    console.error("[CAPA 2 ERR] Falló recolector de LinkedIn:", err.message);
  }

  try {
    const dirLeads = await collectMultiDirectoryLeads();
    if (options.notifyTelegram) {
      for (const lead of dirLeads) await notifier.notifyLead(lead);
    }
  } catch (err: any) {
    console.error("[CAPA 2 ERR] Falló recolector multi-directorio (BiggerPockets/The Blue Book/PlanHub):", err.message);
  }

  try {
    const { scanCommunityCraigslistLeads } = await import("./leads/community_craigslist_scanner");
    const clLeads = await scanCommunityCraigslistLeads();
    if (options.notifyTelegram) {
      for (const lead of clLeads) await notifier.notifyLead(lead);
    }
  } catch (err: any) {
    console.error("[CAPA 2 ERR] Falló recolector de Craigslist:", err.message);
  }

  try {
    const { scanNextdoorNeighborhoodLeads } = await import("./leads/nextdoor_louisville_scraper");
    const ndLeads = await scanNextdoorNeighborhoodLeads();
    if (options.notifyTelegram) {
      for (const lead of ndLeads) await notifier.notifyLead(lead);
    }
  } catch (err: any) {
    console.error("[CAPA 2 ERR] Falló recolector de Nextdoor:", err.message);
  }

  // =================================================================
  // CAPA 3: SINCRONIZACIÓN AUTOMÁTICA CON BARBAPROSYSTEM CRM
  // =================================================================
  console.log("\n=================================================================");
  console.log("🚀 [CAPA 3] SINCRONIZACIÓN CON BARBAPROSYSTEM CRM (CON SPEECHES DE IA)");
  console.log("=================================================================");
  try {
    const { syncAllLeadsToBarbaPro } = await import("./integrations/barbapro_bridge");
    await syncAllLeadsToBarbaPro(100);
  } catch (syncErr: any) {
    console.warn("[CAPA 3 WARN] Error sincronizando con BarbaProsystem:", syncErr.message);
  }

  console.log("\n=================================================================");
  console.log("✅ PIPELINE DE CONSTRUCCIÓN COMPLETADO CON ÉXITO");
  console.log("=================================================================");
}

// Ejecución directa si se invoca por línea de comandos
if (require.main === module) {
  const notifyFlag = process.argv.includes("--notify");
  const dryRunFlag = process.argv.includes("--dry-run");
  runConstructionPipeline({ dryRun: dryRunFlag, notifyTelegram: notifyFlag }).catch(console.error);
}
