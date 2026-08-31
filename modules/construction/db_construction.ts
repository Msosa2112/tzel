import { db } from "../../db";
import { ConstructionBid, ConstructionLead } from "./types";
import * as fs from "fs";
import * as path from "path";

/**
 * Inicializa las tablas de construcción en Turso DB si no existen
 */
export async function initConstructionSchema(): Promise<void> {
  const schemaPath = path.join(__dirname, "schema_construction.sql");
  if (fs.existsSync(schemaPath)) {
    const sqlContent = fs.readFileSync(schemaPath, "utf-8");
    const statements = sqlContent
      .split(";")
      .map(s => s.trim())
      .filter(s => s.length > 0);

    for (const statement of statements) {
      try {
        await db.execute(statement);
      } catch (err: any) {
        console.warn(`[CONSTRUCTION DB WARN] Error ejecutando SQL: ${err.message}`);
      }
    }
    console.log("✅ [CONSTRUCTION DB] Tablas de construcción verificadas/creadas en Turso DB.");
  }
}

/**
 * Guarda o actualiza una licitación pública en Turso DB
 */
export async function saveConstructionBid(bid: ConstructionBid): Promise<boolean> {
  try {
    await db.execute({
      sql: `INSERT INTO construction_bids (
        bid_id, title, agency, jurisdiction, category, estimated_budget, 
        bid_deadline, pre_bid_date, is_mandatory_pre_bid, bonding_required, 
        solicitation_url, documents_url, contact_name, contact_email, 
        contact_phone, description, naics_code, telegram_sent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(bid_id) DO UPDATE SET
        estimated_budget = excluded.estimated_budget,
        bid_deadline = excluded.bid_deadline,
        description = excluded.description`,
      args: [
        bid.bidId,
        bid.title,
        bid.agency,
        bid.jurisdiction,
        bid.category,
        bid.estimatedBudget || 0,
        bid.bidDeadline || null,
        bid.preBidMeetingDate || null,
        bid.isMandatoryPreBid ? 1 : 0,
        bid.bondingRequired ? 1 : 0,
        bid.solicitationUrl,
        bid.documentsUrl || null,
        bid.contactName || null,
        bid.contactEmail || null,
        bid.contactPhone || null,
        bid.description,
        bid.naicsCode || null,
        bid.telegramSent ? 1 : 0
      ]
    });
    return true;
  } catch (err: any) {
    console.error(`[CONSTRUCTION DB ERR] Error guardando licitación ${bid.bidId}:`, err.message);
    return false;
  }
}

/**
 * Guarda o actualiza un lead de construcción residencial/comercial en Turso DB
 */
export async function saveConstructionLead(lead: ConstructionLead): Promise<boolean> {
  try {
    await db.execute({
      sql: `INSERT INTO construction_leads (
        lead_id, category, trigger_event, address, county, state, zip_code, 
        owner_name, owner_phones, owner_emails, property_type, 
        estimated_project_value, trigger_date, urgency_level, 
        source_portal, raw_details, permit_number, insurance_payer_likely, telegram_sent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(lead_id) DO UPDATE SET
        estimated_project_value = excluded.estimated_project_value,
        owner_phones = excluded.owner_phones,
        owner_emails = excluded.owner_emails,
        urgency_level = excluded.urgency_level`,
      args: [
        lead.leadId,
        lead.category,
        lead.triggerEvent,
        lead.address,
        lead.county,
        lead.state,
        lead.zipCode || null,
        lead.ownerName || null,
        JSON.stringify(lead.ownerPhones || []),
        JSON.stringify(lead.ownerEmails || []),
        lead.propertyType || "Residential",
        lead.estimatedProjectValue || 0,
        lead.triggerDate || null,
        lead.urgencyLevel || "NORMAL",
        lead.sourcePortal,
        lead.rawDetails,
        lead.permitNumber || null,
        lead.insurancePayerLikely ? 1 : 0,
        lead.telegramSent ? 1 : 0
      ]
    });
    return true;
  } catch (err: any) {
    console.error(`[CONSTRUCTION DB ERR] Error guardando lead ${lead.leadId}:`, err.message);
    return false;
  }
}
