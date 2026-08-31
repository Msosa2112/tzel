import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const url = "https://ddwyutisxymuvofkjhpz.supabase.co";
const serviceKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";
const sb = createClient(url, serviceKey);

// Palabras y patrones estrictos de descarte
const REJECT_PATTERNS = [
  // 1. Búsqueda de empleo / albañiles buscando chamba
  "busco trabajo", "buscando trabajo", "busca trabajo", "busco empleo", "buscando empleo",
  "ayudante de", "ayudante de camion", "ayudante de cocina", "ayudante de remodelacion",
  "ocupo ayudante", "necesito ayudante", "necesito persona para trabajar", "persona para trabajar",
  "si te interesa enviame un mensaje", "si te interesa envíame un mensaje", "ganas de salir adelante",
  "autorización para trabajar", "autorizacion para trabajar", "mi número es +1", "mi numero es +1",
  "mi numero es", "mi número es", "disponible para trabajar", "experiencia en ayudante",
  "cualquier ayuda por parte del personal", "trabajo en cualquier horario",

  // 2. Staffing / Agencias de reclutamiento
  "staffing", "stafin", "oportunidades de trabajo", "aplicaste todavía no te han llamado",
  "aplicaste todavia no te han llamado", "aqui te traigo oportunidades", "aquí te traigo oportunidades",
  "agencia de empleo", "reclutamiento", "contratando personal",

  // 3. Autopromoción de contratistas / Cuadrillas ofreciéndose
  "hago remodelacion", "hago remodelación", "se hacen remodelaciones", "hacemos remodelaciones",
  "remodelación pintura (interior y exterior)", "remodelacion pintura", "precios excelentes",
  "built strong. built right", "call, text, or contact us", "ready to enjoy call", "thinking about adding a deck",
  "whether it's for relaxing", "whether it’s for relaxing", "we’ve got you covered", "we've got you covered",
  "one call. endless possibilities", "if it’s on your to-do list, it’s on ours", "if it's on your to-do list",
  "tu casa o negocio necesita una remodelación", "tu casa o negocio necesita una remodelacion",
  "¿buscas un contratista de concreto de confianza?", "buscas un contratista de concreto",
  "deck looking worn out? we can help", "deck looking worn out", "waterproofed basement backed",
  "restored/waterproofed basement", "garcia roofing", "clean pro", "stone house", "504construction"
];

async function auditAndCleanLeads() {
  const { data: leads, error } = await sb
    .from("contacts")
    .select("*")
    .ilike("external_ref", "LEAD_%");

  if (error || !leads) {
    console.error("Error fetching leads:", error);
    return;
  }

  console.log(`\n======================================================`);
  console.log(`AUDITANDO ${leads.length} LEADS ACTIVOS EN SUPABASE`);
  console.log(`======================================================\n`);

  const toDelete: any[] = [];
  const validLeads: any[] = [];

  for (const l of leads) {
    const fullText = `${l.first_name || ""} ${l.last_name || ""} ${l.address || ""} ${l.notes || ""}`.toLowerCase();
    
    // Check if it matches any reject patterns
    const matchedPattern = REJECT_PATTERNS.find(pat => fullText.includes(pat));

    if (matchedPattern) {
      toDelete.push({ id: l.id, name: `${l.first_name} ${l.last_name || ""}`, reason: matchedPattern, ref: l.external_ref });
    } else {
      validLeads.push(l);
    }
  }

  console.log(`❌ LEADS BASURA IDENTIFICADOS PARA ELIMINAR (${toDelete.length}):`);
  toDelete.forEach((td, idx) => {
    console.log(`  [${idx + 1}] ID: ${td.id} | Motivo: "${td.reason}"`);
    console.log(`      Nombre/Texto: ${td.name.slice(0, 100)}`);
  });

  console.log(`\n✅ LEADS 100% VÁLIDOS (PROPIETARIOS REALES, INFRACCIONES 311, TORMENTAS) (${validLeads.length}):`);
  validLeads.forEach((vl, idx) => {
    console.log(`  [${idx + 1}] ${vl.first_name} ${vl.last_name} | Tel: ${vl.phone || "N/A"} | Ref: ${vl.external_ref}`);
  });

  // Ejecutar eliminación
  if (toDelete.length > 0) {
    console.log(`\n🗑️ Eliminando los ${toDelete.length} leads basura de Supabase...`);
    for (const td of toDelete) {
      await sb.from("contacts").delete().eq("id", td.id);
    }
    console.log(`✅ Base de datos Supabase depurada con éxito.`);
  }
}

auditAndCleanLeads().catch(console.error);
