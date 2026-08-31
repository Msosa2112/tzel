import { Worker } from "bullmq";
import { connection, financialAuditQueue, telegramAlertQueue } from "./queue_config";
import { performSkipTrace } from "./skip_trace";
import { getPropertyLiensFromAttom } from "./scrapers/attom_client";
import { checkPropertyLiens } from "./scrapers/lien_detector";
import { calculateMAO, calculateRehab } from "./underwriting/underwriter";
import { notifyOpportunities } from "./notify_opportunities";
import { db } from "./db";

// 1. Worker para Skip Tracing (SkipTracingQueue)
export const skipTracingWorker = new Worker(
  "SkipTracingQueue",
  async (job) => {
    const { auctionId, address, ownerName, county, state } = job.data;
    console.log(`[WORKER SkipTracing] Procesando Skip Trace para: ${ownerName} (${address})`);

    try {
      const contacts = await performSkipTrace(ownerName, address, state, county);
      const phonesStr = contacts.phones.length > 0 ? contacts.phones.join(", ") : null;
      const emailsStr = contacts.emails.length > 0 ? contacts.emails.join(", ") : null;

      // Actualizar contactos en la base de datos
      await db.execute({
        sql: "UPDATE foreclosure_auctions SET defendant_phones = ?, defendant_emails = ? WHERE auction_id = ?",
        args: [phonesStr, emailsStr, auctionId]
      });
      console.log(`[WORKER SkipTracing SUCCESS] Contactos actualizados para ${ownerName}`);

      // Pasar a la cola de Auditoría Financiera
      await financialAuditQueue.add(
        "checkTitleLiens",
        { auctionId, address, ownerName, county, state },
        {
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 }
        }
      );
      console.log(`[WORKER SkipTracing] Job checkTitleLiens encolado para ${auctionId}`);
    } catch (err: any) {
      console.error(`[WORKER SkipTracing ERROR] Falló para ${ownerName}:`, err.message);
      throw err; // Permitir reintento automático de BullMQ
    }
  },
  { connection: connection as any, concurrency: 2 }
);

// 2. Worker para Auditoría Financiera (FinancialAuditQueue)
export const financialAuditWorker = new Worker(
  "FinancialAuditQueue",
  async (job) => {
    const { auctionId, address, ownerName, county, state } = job.data;
    console.log(`[WORKER FinancialAudit] Iniciando auditoría de gravámenes para: ${address}`);

    try {
      // Intentar obtener código postal del address
      const zipMatch = address.match(/\b\d{5}\b/);
      const zipCode = zipMatch ? zipMatch[0] : "";

      let hiddenLiensAmount = 0;
      let usedAttom = false;

      // Paso 1: Intentar con Attom Data API
      const attomResult = await getPropertyLiensFromAttom(address, zipCode);
      if (attomResult.success) {
        hiddenLiensAmount = attomResult.totalHiddenDebt;
        usedAttom = true;
      } else {
        // Paso 2: Fallback a Playwright + Gemini
        console.log(`[WORKER FinancialAudit FALLBACK] Attom API falló o no tiene datos. Iniciando Playwright+Gemini...`);
        const lienResult = await checkPropertyLiens(ownerName, address, state, county);
        hiddenLiensAmount = lienResult.totalHiddenDebt;
      }

      // Obtener datos existentes del lead para calcular MAO
      const specRes = await db.execute({
        sql: "SELECT mls_estimated_value, sqft, hidden_mortgages FROM foreclosure_auctions WHERE auction_id = ?",
        args: [auctionId]
      });
      const specRow = specRes.rows[0];
      const arv = specRow ? (specRow.mls_estimated_value as number || 0) : 0;
      const sqft = specRow ? (specRow.sqft as number || null) : null;
      const hiddenMortgages = specRow ? (specRow.hidden_mortgages as number || 0) : 0;

      // Calcular MAO ajustado
      const rehab = calculateRehab(sqft, []);
      const adjustedMao = calculateMAO(arv, rehab, hiddenMortgages, hiddenLiensAmount);

      // Actualizar base de datos
      await db.execute({
        sql: `
          UPDATE foreclosure_auctions 
          SET hidden_liens_amount = ?, 
              title_check_status = 'success',
              needs_manual_review = 0
          WHERE auction_id = ?
        `,
        args: [hiddenLiensAmount, auctionId]
      });
      console.log(`[WORKER FinancialAudit SUCCESS] Gravámenes actualizados para ${address}: $${hiddenLiensAmount} (Mao: $${adjustedMao}) (Attom: ${usedAttom})`);

      // Pasar a la cola de Telegram Alerting
      await telegramAlertQueue.add("sendOpportunityAlert", {
        auctionId,
        address,
        ownerName,
        hiddenLiensAmount
      });
      console.log(`[WORKER FinancialAudit] Job sendOpportunityAlert encolado para ${auctionId}`);
    } catch (err: any) {
      console.error(`[WORKER FinancialAudit ERROR] Falló para ${address}:`, err.message);
      // Marcar temporalmente en base de datos como fallido para auditoría manual en caso de que agote reintentos
      try {
        await db.execute({
          sql: "UPDATE foreclosure_auctions SET title_check_status = 'failed' WHERE auction_id = ?",
          args: [auctionId]
        });
      } catch (dbErr) {}
      throw err;
    }
  },
  { connection: connection as any, concurrency: 3 }
);

// 3. Worker para Enviar Alertas (TelegramAlertQueue)
export const telegramAlertWorker = new Worker(
  "TelegramAlertQueue",
  async (job) => {
    const { auctionId, address } = job.data;
    console.log(`[WORKER TelegramAlert] Despachando notificaciones para: ${address}`);

    try {
      // Disparar notificaciones y barrer leads pendientes
      await notifyOpportunities();
      console.log(`[WORKER TelegramAlert SUCCESS] Alertas despachadas exitosamente para ${address}`);
    } catch (err: any) {
      console.error(`[WORKER TelegramAlert ERROR] Falló para ${address}:`, err.message);
      throw err;
    }
  },
  { connection: connection as any, concurrency: 1 }
);

// Registrar manejadores de eventos globales para logging
skipTracingWorker.on("completed", (job) => console.log(`[BULLMQ COMPLETED] Skip Trace job ${job.id} completado.`));
financialAuditWorker.on("completed", (job) => console.log(`[BULLMQ COMPLETED] Financial Audit job ${job.id} completado.`));
telegramAlertWorker.on("completed", (job) => console.log(`[BULLMQ COMPLETED] Telegram Alert job ${job.id} completado.`));

skipTracingWorker.on("failed", (job, err) => console.error(`[BULLMQ FAILED] Skip Trace job ${job?.id} falló:`, err.message));
financialAuditWorker.on("failed", (job, err) => console.error(`[BULLMQ FAILED] Financial Audit job ${job?.id} falló:`, err.message));
telegramAlertWorker.on("failed", (job, err) => console.error(`[BULLMQ FAILED] Telegram Alert job ${job?.id} falló:`, err.message));
