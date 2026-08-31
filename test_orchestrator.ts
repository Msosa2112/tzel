import { db } from "./db";
import { skipTracingQueue, connection } from "./queue_config";
import { skipTracingWorker, financialAuditWorker, telegramAlertWorker } from "./workers";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runTestOrchestrator() {
  console.log("=================================================================");
  console.log("🧪 INICIANDO INTEGRATION TEST DEL ORQUESTRADOR BULLMQ + REDIS 🧪");
  console.log("=================================================================");

  const testAuctionId = "TEST_BULLMQ_999";
  
  // 1. Limpiar cualquier residuo previo
  try {
    await db.execute({
      sql: "DELETE FROM foreclosure_auctions WHERE auction_id = ?",
      args: [testAuctionId]
    });
  } catch (e) {}

  // 2. Insertar una subasta de prueba en Turso DB
  console.log("[TEST] Insertando subasta de prueba en la base de datos...");
  await db.execute({
    sql: `
      INSERT INTO foreclosure_auctions (
        auction_id, case_number, address, county, state, auction_date,
        plaintiff, defendant, mls_estimated_value, sqft, hidden_mortgages
      ) VALUES (?, '22D01-2605-MF-000999', '1402 Slate Run Rd, New Albany, IN 47150', 'Floyd', 'IN', 'August 15, 2026',
               'TEST BANK', 'PATRICIA WHITE', 180000.00, 1500, 0)
    `,
    args: [testAuctionId]
  });

  // 3. Agregar el trabajo a SkipTracingQueue para iniciar el flujo asíncrono
  console.log("[TEST] Encolando trabajo inicial en SkipTracingQueue...");
  await skipTracingQueue.add(
    "skipTraceLead",
    {
      auctionId: testAuctionId,
      address: "1402 Slate Run Rd, New Albany, IN 47150",
      ownerName: "PATRICIA WHITE",
      county: "Floyd",
      state: "IN"
    },
    {
      attempts: 1
    }
  );

  console.log("[TEST] Esperando a que los trabajadores procesen la cadena de trabajos (polling hasta 60s)...");
  let attempts = 0;
  let row: any = null;

  while (attempts < 30) {
    await sleep(2000);
    attempts++;
    
    const verifyRes = await db.execute({
      sql: "SELECT defendant_phones, defendant_emails, hidden_liens_amount, title_check_status FROM foreclosure_auctions WHERE auction_id = ?",
      args: [testAuctionId]
    });
    
    row = verifyRes.rows[0];
    if (row && row.title_check_status === "success") {
      break;
    }
  }

  if (row) {
    console.log("\n📊 RESULTADO EN BASE DE DATOS:");
    console.log(`- Teléfonos: ${row.defendant_phones}`);
    console.log(`- Emails: ${row.defendant_emails}`);
    console.log(`- Monto Gravámenes Ocultos: $${row.hidden_liens_amount}`);
    console.log(`- Status Auditoría: ${row.title_check_status}`);
    
    const hasSkipTrace = row.defendant_phones !== null || row.defendant_emails !== null;
    const hasAudit = row.title_check_status === "success";

    if (hasSkipTrace && hasAudit) {
      console.log("\n✅ [SUCCESS] El flujo completo del orquestador (Skip Trace -> Auditoría Financiera) se ejecutó con éxito!");
    } else {
      console.error("\n❌ [FAILURE] Faltan actualizaciones en el lead de prueba.");
    }
  } else {
    console.error("\n❌ [FAILURE] No se encontró el registro de prueba en la base de datos.");
  }

  // 5. Limpieza
  console.log("\n[TEST] Limpiando datos de prueba y deteniendo workers...");
  await db.execute({
    sql: "DELETE FROM foreclosure_auctions WHERE auction_id = ?",
    args: [testAuctionId]
  });

  // Cerrar workers y conexión a Redis
  await skipTracingWorker.close();
  await financialAuditWorker.close();
  await telegramAlertWorker.close();
  await connection.quit();
  
  console.log("[TEST] Conexiones cerradas. Fin de la prueba.");
}

runTestOrchestrator().catch((err) => {
  console.error("Test falló con error:", err);
  process.exit(1);
});
