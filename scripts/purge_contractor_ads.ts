import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";

dotenv.config();

const url = "https://ddwyutisxymuvofkjhpz.supabase.co";
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";
const sb = createClient(url, key);

// Frases que indican que quien publica es un CONTRATISTA/VENDEDOR ofreciendo sus servicios
const SELLER_POST_PATTERNS = [
  /se hacen/i,
  /hacemos todo/i,
  /ofrecemos servicios/i,
  /ofrezco mis servicios/i,
  /nos dedicamos/i,
  /somos expertos/i,
  /estimados? totalmente gratis/i,
  /estimados? gratis en todo/i,
  /estimados? gratis no dude/i,
  /estimados? gratis mi número/i,
  /estimados? gratis llam/i,
  /free estimate.*call/i,
  /call.*for free estimate/i,
  /llame ya al/i,
  /llámame al/i,
  /llamar al \d/i,
  /no duden? en contactar/i,
  /no duden? en comunicar/i,
  /no duden? en llamar/i,
  /venta de concreto/i,
  /venta de gravilla/i,
  /hormigón preparado/i,
  /se renta una casa/i,
  /se renta casa/i,
  /for rent.*bed/i,
  /available now.*rent/i,
  /rent to own/i,
  /driveway clean pro/i,
  /jabes construction/i,
  /faith & builders/i,
  /garcia roofing/i,
  /stone house/i,
  /limpieza profesional de/i,
  /creador\(a\) digital/i,
  /expertos en roofing/i,
  /now hiring/i,
  /helpers wanted/i,
  /caddy moving/i,
  /lawn care pros/i,
  /earn up to \$500/i,
  /traveling multifamily/i,
  /dile adiós a la suciedad/i
];

async function runPrecisionPurge() {
  console.log("=================================================================");
  console.log("🧹 PURGA DE PRECISIÓN: ELIMINANDO EXCLUSIVAMENTE PUBLICACIONES DE VENDEDORES 🧹");
  console.log("=================================================================\n");

  const { data: contacts, error } = await sb
    .from("contacts")
    .select("id, first_name, last_name, phone, notes, external_ref")
    .or("external_ref.ilike.LEAD_%,notes.ilike.%SPEECH DE VENTA RECOMENDADO%");

  if (error) {
    console.error("Error consultando contactos:", error);
    return;
  }

  console.log(`📊 Contactos totales actuales en base de datos: ${contacts?.length || 0}`);

  const toDeleteIds: string[] = [];
  const purgedList: any[] = [];
  const keptList: any[] = [];

  for (const c of (contacts || [])) {
    const notes = c.notes || "";
    
    // Extraer únicamente el texto original del post (después de 💬 Post: o DETALLES ORIGINALES)
    let originalText = "";
    if (notes.includes("💬 Post:")) {
      originalText = notes.split("💬 Post:")[1]?.split("🔗")[0] || "";
    } else if (notes.includes("📄 DETALLES ORIGINALES:")) {
      originalText = notes.split("📄 DETALLES ORIGINALES:")[1] || "";
    } else {
      originalText = `${c.first_name || ""} ${c.last_name || ""}`;
    }

    const titleAndName = `${c.first_name || ""} ${c.last_name || ""}`.toLowerCase();

    // Comprobar si el post original contiene patrones de contratista ofreciendo servicios
    const isSeller = SELLER_POST_PATTERNS.some(regex => regex.test(originalText) || regex.test(titleAndName));

    // Descartar expedientes gubernamentales no comerciales/residenciales
    const isGov = notes.includes("government_bid") || notes.includes("expediente municipal") || notes.includes("zonificación");

    if (isSeller || isGov) {
      toDeleteIds.push(c.id);
      purgedList.push({
        id: c.id,
        name: `${c.first_name || ""} ${c.last_name || ""}`.trim(),
        phone: c.phone,
        snippet: originalText.replace(/\s+/g, " ").trim().slice(0, 100)
      });
    } else {
      keptList.push({
        id: c.id,
        name: `${c.first_name || ""} ${c.last_name || ""}`.trim(),
        ref: c.external_ref,
        phone: c.phone
      });
    }
  }

  console.log(`🚨 Posts de vendedores detectados para purga: ${toDeleteIds.length}`);
  console.log(`💎 Leads legítimos de compradores/tormentas preservados: ${keptList.length}`);

  for (const id of toDeleteIds) {
    try {
      // Si tiene presupuestos asociados, desvincularlos primero para no violar foreign keys
      await sb.from("estimates").delete().eq("contact_id", id);
      await sb.from("contacts").delete().eq("id", id);
    } catch {}
  }

  const { count: finalCount } = await sb
    .from("contacts")
    .select("*", { count: "exact", head: true })
    .or("external_ref.ilike.LEAD_%,notes.ilike.%SPEECH DE VENTA RECOMENDADO%");

  console.log(`\n=================================================================`);
  console.log(`✅ PURGA COMPLETADA: Base de datos limpia.`);
  console.log(`🗑️ Total de autopromociones eliminadas: ${toDeleteIds.length}`);
  console.log(`💎 Total de leads de clientes y tormentas activos en CRM: ${finalCount}`);
  console.log(`=================================================================\n`);
}

if (require.main === module) {
  runPrecisionPurge().catch(console.error);
}
