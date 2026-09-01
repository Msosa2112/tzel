import { createClient } from "@supabase/supabase-js";
import { db } from "../db";
import { isValidReachableUSPhone } from "../intelligence/phone_classifier";
import * as dotenv from "dotenv";

dotenv.config();

const url = process.env.BARBAPRO_SUPABASE_URL || "https://ddwyutisxymuvofkjhpz.supabase.co";
const serviceKey = process.env.BARBAPRO_SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";
const sb = createClient(url, serviceKey);

async function runCompleteSystemAudit() {
  console.log("=================================================================");
  console.log("📊 AUDITORÍA EXHAUSTIVA DE CONTACTOS EN AMBOS MÓDULOS 📊");
  console.log("=================================================================\n");

  // ==========================================================
  // 1. MÓDULO DE CONSTRUCCIÓN
  // ==========================================================
  console.log("--- 🏗️ 1. MÓDULO DE CONSTRUCCIÓN (Barba CRM & Tzel) ---");
  const { data: contacts } = await sb.from("contacts").select("*");
  const totalContacts = contacts?.length || 0;
  
  let constructionWithPhone = 0;
  let constructionWithoutPhone = 0;
  let constructionInvalidPhones = 0;
  let verifiedBatchDataCount = 0;

  for (const c of contacts || []) {
    if (c.phone) {
      if (isValidReachableUSPhone(c.phone)) {
        constructionWithPhone++;
      } else {
        constructionInvalidPhones++;
      }
      if ((c.notes || "").includes("[VERIFICADO BATCHDATA]") || (c.notes || "").includes("BatchData")) {
        verifiedBatchDataCount++;
      }
    } else {
      constructionWithoutPhone++;
    }
  }

  console.log(`  • Total de Prospectos en CRM: ${totalContacts}`);
  console.log(`  • ✅ Con Teléfono Real Validado (NANP): ${constructionWithPhone} (${((constructionWithPhone / totalContacts) * 100).toFixed(1)}%)`);
  console.log(`  • ⚡ Enriquecidos Directamente con BatchData: ${verifiedBatchDataCount}`);
  console.log(`  • ⏳ Sin Teléfono Asignado (Pendientes de Búsqueda): ${constructionWithoutPhone} (${((constructionWithoutPhone / totalContacts) * 100).toFixed(1)}%)`);
  console.log(`  • ❌ Teléfonos Inválidos / Desconectados: ${constructionInvalidPhones}\n`);

  // ==========================================================
  // 2. MÓDULO INMOBILIARIO (BIENES RAÍCES / WHOLESALING)
  // ==========================================================
  console.log("--- 🏠 2. MÓDULO INMOBILIARIO (Subastas, Impuestos, Infracciones) ---");
  const tables = [
    { name: "foreclosure_auctions", label: "Subastas Judiciales (Foreclosures)", phoneCol: "defendant_phones" },
    { name: "code_violations", label: "Infracciones de Código Inmobiliarias", phoneCol: "defendant_phones" },
    { name: "physical_distress", label: "Daños Físicos / Estructurales / Incendios", phoneCol: "defendant_phones" },
    { name: "probate_cases", label: "Casos de Sucesión / Herencias (Probate)", phoneCol: "defendant_phones" },
    { name: "tax_delinquencies", label: "Morosidad de Impuestos (Tax Delinquencies)", phoneCol: "defendant_phones" }
  ];

  let totalRealEstateRecords = 0;
  let totalRealEstateWithPhone = 0;
  let totalRealEstateWithoutPhone = 0;

  for (const t of tables) {
    try {
      const res = await db.execute(`SELECT ${t.phoneCol} FROM ${t.name}`);
      const count = res.rows.length;
      totalRealEstateRecords += count;

      let withPhone = 0;
      let withoutPhone = 0;
      for (const r of res.rows) {
        const val = r[t.phoneCol];
        if (val && String(val).trim() !== "" && String(val) !== "null") {
          withPhone++;
        } else {
          withoutPhone++;
        }
      }

      totalRealEstateWithPhone += withPhone;
      totalRealEstateWithoutPhone += withoutPhone;

      console.log(`  • ${t.label}:`);
      console.log(`     - Total: ${count} registros | Con Teléfono: ${withPhone} | Sin Teléfono: ${withoutPhone}`);
    } catch (e: any) {
      console.log(`  • ${t.label}: ⚠️ Tabla no disponible o vacía (${e.message})`);
    }
  }

  console.log(`\n  📊 RESUMEN INMOBILIARIO TOTAL:`);
  console.log(`     - Total Oportunidades: ${totalRealEstateRecords}`);
  console.log(`     - Con Teléfono Guardado: ${totalRealEstateWithPhone}`);
  console.log(`     - Pendientes de Skip-Tracing: ${totalRealEstateWithoutPhone}`);

  console.log("\n=================================================================");
  console.log("🎯 BALANCE Y SEGURIDAD DE CONTACTO");
  console.log("=================================================================\n");
}

runCompleteSystemAudit().catch(console.error);
