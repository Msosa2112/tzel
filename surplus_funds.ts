import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import * as crypto from "crypto";
import { performSkipTrace } from "./skip_trace";
import { sendTelegramNotification } from "./notify_opportunities";

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

export interface CompletedAuction {
  owner_name: string;
  address: string;
  winning_bid: number;
  judgment_amount: number;
  county: string;
  state: string;
  auction_date: string;
}

export const SURPLUS_FUNDS_MOCKS: CompletedAuction[] = [
  {
    owner_name: "MARIA CONCEPCION",
    address: "812 N Clay St, Louisville, KY 40206",
    county: "Jefferson",
    state: "KY",
    auction_date: "2026-05-15",
    judgment_amount: 125000.00,
    winning_bid: 198000.00
  },
  {
    owner_name: "JOHNATHAN GALE",
    address: "1422 E Elm St, New Albany, IN 47150",
    county: "Floyd",
    state: "IN",
    auction_date: "2026-05-20",
    judgment_amount: 85000.00,
    winning_bid: 162000.00
  },
  {
    owner_name: "ESTATE OF SARAH JENKINS",
    address: "3014 Allison Way, Louisville, KY 40220",
    county: "Jefferson",
    state: "KY",
    auction_date: "2026-05-28",
    judgment_amount: 145000.00,
    winning_bid: 280000.00
  },
  {
    owner_name: "THOMAS BECHT",
    address: "1105 Applegate Ln, Clarksville, IN 47129",
    county: "Clark",
    state: "IN",
    auction_date: "2026-06-03",
    judgment_amount: 98000.00,
    winning_bid: 155000.00
  }
];

/**
 * Procesa un registro individual de subasta ejecutada, calcula excedentes y dispara skip-tracing y Telegram si corresponde.
 */
export async function processSurplusFund(auction: CompletedAuction) {
  const surplus = auction.winning_bid - auction.judgment_amount;
  if (surplus < 20000) {
    console.log(`[SURPLUS FUNDS] Omitido: El excedente de $${surplus.toLocaleString()} para ${auction.owner_name} es menor al límite de $20,000.`);
    return;
  }

  const hash = crypto.createHash("md5").update(auction.address).digest("hex").substring(0, 10);
  const surplusId = `SF_${hash.toUpperCase()}`;

  // Verificar si ya fue notificado a Telegram para evitar spam y skip-tracing repetitivo
  try {
    const checkRes = await db.execute({
      sql: "SELECT telegram_sent FROM surplus_funds WHERE surplus_id = ? LIMIT 1",
      args: [surplusId]
    });
    if (checkRes.rows.length > 0 && checkRes.rows[0].telegram_sent === 1) {
      console.log(`[SURPLUS FUNDS] Omitiendo ${auction.owner_name} (${auction.address}): Alerta de excedente ya fue enviada.`);
      return;
    }
  } catch (err: any) {
    console.warn(`[SURPLUS FUNDS WARNING] Error al consultar duplicados en surplus_funds: ${err.message}`);
  }

  console.log(`[SURPLUS FUNDS] 💰 EXCEDENTE DETECTADO: $${surplus.toLocaleString()} para ${auction.owner_name} (${auction.address})`);

  // 1. Guardar o actualizar en la tabla surplus_funds
  try {
    await db.execute({
      sql: `
        INSERT INTO surplus_funds (
          surplus_id, owner_name, address, winning_bid, judgment_amount, surplus_amount, auction_date, county, state, telegram_sent
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(surplus_id) DO UPDATE SET
          winning_bid = excluded.winning_bid,
          judgment_amount = excluded.judgment_amount,
          surplus_amount = excluded.surplus_amount,
          auction_date = excluded.auction_date
      `,
      args: [
        surplusId,
        auction.owner_name,
        auction.address,
        auction.winning_bid,
        auction.judgment_amount,
        surplus,
        auction.auction_date,
        auction.county,
        auction.state
      ]
    });
    console.log(`[SURPLUS FUNDS] Registro guardado en la tabla surplus_funds de Turso: ${surplusId}`);
  } catch (err: any) {
    console.error(`[SURPLUS FUNDS DB ERROR] No se pudo guardar el registro de excedente: ${err.message}`);
    return;
  }

  // 2. Activar skip-tracing inmediato
  let phonesStr: string | null = null;
  let emailsStr: string | null = null;
  try {
    console.log(`[SURPLUS FUNDS SKIP TRACE] Iniciando skip-tracing inmediato para ex-propietario: ${auction.owner_name}...`);
    const contacts = await performSkipTrace(auction.owner_name, auction.address, auction.state, auction.county);
    phonesStr = contacts.phones.length > 0 ? contacts.phones.join(", ") : null;
    emailsStr = contacts.emails.length > 0 ? contacts.emails.join(", ") : null;

    await db.execute({
      sql: `UPDATE surplus_funds SET defendant_phones = ?, defendant_emails = ? WHERE surplus_id = ?`,
      args: [phonesStr, emailsStr, surplusId]
    });
    console.log(`[SURPLUS FUNDS SKIP TRACE SUCCESS] Contactos asignados: ${phonesStr || "Ninguno"}`);
  } catch (err: any) {
    console.error(`[SURPLUS FUNDS SKIP TRACE ERROR] Falló la búsqueda de contactos: ${err.message}`);
  }

  // 3. Despachar alerta premium dedicada a Telegram
  const formattedSurplus = surplus.toLocaleString("en-US", { style: "currency", currency: "USD" });
  const message = `💰 *FONDOS EXCEDENTES DETECTADOS:* ${formattedSurplus} a recuperar para *${auction.owner_name}*\n📍 *Dirección:* ${auction.address}\n📞 *Celular:* ${phonesStr || "No localizado"}\n📧 *Emails:* ${emailsStr || "No localizado"}`;
  
  try {
    await sendTelegramNotification(message);
    console.log(`[SURPLUS FUNDS TELEGRAM] Alerta enviada con éxito.`);
    
    // Marcar en la base de datos como enviado
    await db.execute({
      sql: "UPDATE surplus_funds SET telegram_sent = 1 WHERE surplus_id = ?",
      args: [surplusId]
    });
    console.log(`[SURPLUS FUNDS] Marcado como enviado a Telegram en DB: ${surplusId}`);
  } catch (err: any) {
    console.error(`[SURPLUS FUNDS TELEGRAM ERROR] Falló el despacho del mensaje a Telegram: ${err.message}`);
  }
}

/**
 * Orquestador de Auditoría Financiera de Excedentes
 */
export async function runSurplusAuditRoutine(completedAuctions: CompletedAuction[]) {
  console.log(`[SURPLUS AUDIT] Iniciando rutina de auditoría financiera sobre ${completedAuctions.length} subastas ejecutadas...`);
  for (const auction of completedAuctions) {
    await processSurplusFund(auction);
  }
  console.log(`[SURPLUS AUDIT] Rutina finalizada con éxito.`);
}
