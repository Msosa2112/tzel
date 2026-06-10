import axios from "axios";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

const DATATREE_API_KEY = process.env.DATATREE_API_KEY;

/**
 * Consulta la API de Registros Públicos de DataTree.
 * Extrae hipotecas abiertas, deudas secundarias (junior liens) y gravámenes fiscales.
 * Si falla la API por autenticación, permisos o red, arroja un error fuerte (Hard Fail).
 */
async function queryDataTreePublicRecords(address: string, state: string): Promise<number> {
  if (!DATATREE_API_KEY || DATATREE_API_KEY.trim() === "") {
    throw new Error("Acceso denegado a DataTree API: Falta API Key (DATATREE_API_KEY)");
  }
  
  const url = "https://api.datatree.com/v1/property/search";
  try {
    console.log(`[DATATREE] Consultando registros públicos para "${address}", ${state}`);
    const response = await axios.post(url, {
      address: address,
      state: state
    }, {
      headers: {
        "Authorization": `Bearer ${DATATREE_API_KEY}`,
        "Content-Type": "application/json"
      },
      timeout: 15000
    });
    
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Acceso denegado a DataTree API: Status ${response.status}`);
    }
    
    const openMortgages = response.data?.open_mortgages || 0;
    const taxLiens = response.data?.tax_liens || 0;
    const juniorLiens = response.data?.junior_liens || 0;
    const totalHiddenDebt = openMortgages + taxLiens + juniorLiens;
    
    console.log(`[DATATREE SUCCESS] Deuda encontrada para "${address}": Mortgages=$${openMortgages}, Tax=$${taxLiens}, Junior=$${juniorLiens}. Total=$${totalHiddenDebt}`);
    return totalHiddenDebt;
  } catch (err: any) {
    const status = err.response?.status;
    console.error(`[DATATREE ERROR] Falló la consulta para la propiedad "${address}":`, err.message);
    if (status === 401 || status === 403 || err.message.includes("Acceso denegado")) {
      throw new Error(`Acceso denegado a DataTree API (${status || "auth error"})`);
    }
    throw err;
  }
}

/**
 * Función principal del módulo para auditar deudas en todas las propiedades con alta rentabilidad.
 */
export async function runTitleLienCheck() {
  console.log("[INICIO] Iniciando Módulo de Verificación de Títulos (DataTree)...");
  
  // 1. Consultar subastas de alta rentabilidad
  let auctions;
  try {
    const res = await db.execute("SELECT auction_id, address, state FROM foreclosure_auctions WHERE is_high_yield = 1");
    auctions = res.rows;
  } catch (err: any) {
    console.error("[DB ERROR] No se pudieron consultar las subastas judiciales:", err.message);
    throw err;
  }
  
  // 2. Consultar violaciones de código de alta rentabilidad
  let violations;
  try {
    const res = await db.execute("SELECT violation_id, address FROM code_violations WHERE is_high_yield = 1");
    violations = res.rows;
  } catch (err: any) {
    console.error("[DB ERROR] No se pudieron consultar las violaciones de código:", err.message);
    throw err;
  }
  
  console.log(`[TITLE LIENS] Oportunidades encontradas para verificar: Subastas: ${auctions.length}, Violaciones: ${violations.length}`);
  
  // Procesar subastas
  for (const row of auctions) {
    const auctionId = row.auction_id as string;
    const address = row.address as string;
    const state = row.state as string;
    
    console.log(`[PROCESANDO] Verificando deudas ocultas para Subasta: ${address}`);
    try {
      const hiddenDebt = await queryDataTreePublicRecords(address, state);
      
      await db.execute({
        sql: "UPDATE foreclosure_auctions SET hidden_mortgages = ? WHERE auction_id = ?",
        args: [hiddenDebt, auctionId]
      });
      console.log(`[SUCCESS] Base de datos actualizada con hidden_mortgages = $${hiddenDebt} para subasta ${auctionId}`);
    } catch (err: any) {
      console.error(`[FATAL CHECK ERROR] Falló verificación de deudas para "${address}" en subasta. Deteniendo pipeline.`);
      throw err; // Hard Fail
    }
  }
  
  // Procesar violaciones de código
  for (const row of violations) {
    const violationId = row.violation_id as string;
    const address = row.address as string;
    
    console.log(`[PROCESANDO] Verificando deudas ocultas para Violación de Código: ${address}`);
    try {
      const hiddenDebt = await queryDataTreePublicRecords(address, "KY"); // Violaciones de código están en Louisville, KY
      
      await db.execute({
        sql: "UPDATE code_violations SET hidden_mortgages = ? WHERE violation_id = ?",
        args: [hiddenDebt, violationId]
      });
      console.log(`[SUCCESS] Base de datos actualizada con hidden_mortgages = $${hiddenDebt} para violación ${violationId}`);
    } catch (err: any) {
      console.error(`[FATAL CHECK ERROR] Falló verificación de deudas para "${address}" en violación. Deteniendo pipeline.`);
      throw err; // Hard Fail
    }
  }
  
  console.log("[FIN] Módulo de Verificación de Títulos finalizado con éxito.");
}

if (require.main === module) {
  runTitleLienCheck().catch((err) => {
    console.error("[CHECK_TITLE_LIENS EXIT ERROR]:", err.message);
    process.exit(1);
  });
}
