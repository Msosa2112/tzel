import { Queue } from "bullmq";
import IORedis from "ioredis";

// Conectar a Redis usando la variable de entorno o localhost
const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

console.log(`[QUEUE CONFIG] Inicializando conexión Redis a: ${redisUrl}`);
export const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null // Requerido por BullMQ
});

// Definir las colas del orquestador de flujos
export const skipTracingQueue = new Queue("SkipTracingQueue", { connection: connection as any });
export const financialAuditQueue = new Queue("FinancialAuditQueue", { connection: connection as any });
export const telegramAlertQueue = new Queue("TelegramAlertQueue", { connection: connection as any });
