import { supabaseBarba } from "../integrations/barbapro_bridge";

async function deduplicateContacts() {
  console.log("🔍 Iniciando limpieza de duplicados en Supabase BarbaPro...");
  const { data: contacts, error } = await supabaseBarba
    .from("contacts")
    .select("id, first_name, last_name, address, notes, created_at")
    .order("created_at", { ascending: false });

  if (error || !contacts) {
    console.error("Error al consultar contactos:", error);
    return;
  }

  const seen = new Set<string>();
  const duplicateIds: string[] = [];

  for (const c of contacts) {
    // Generar huella única por cliente + necesidad/texto inicial
    const snippet = (c.notes || "").slice(0, 100).replace(/\s+/g, " ").trim().toLowerCase();
    const key = `${(c.first_name || "").toLowerCase()}_${(c.last_name || "").toLowerCase()}_${(c.address || "").toLowerCase()}_${snippet}`;
    
    if (seen.has(key)) {
      duplicateIds.push(c.id);
    } else {
      seen.add(key);
    }
  }

  console.log(`📊 Contactos totales: ${contacts.length}`);
  console.log(`🗑️ Registros duplicados detectados: ${duplicateIds.length}`);

  if (duplicateIds.length > 0) {
    for (let i = 0; i < duplicateIds.length; i += 25) {
      const chunk = duplicateIds.slice(i, i + 25);
      const { error: delErr } = await supabaseBarba
        .from("contacts")
        .delete()
        .in("id", chunk);
      if (delErr) console.error("Error eliminando lote:", delErr);
    }
    console.log(`✅ ¡Limpieza completada! Se eliminaron ${duplicateIds.length} contactos duplicados.`);
  } else {
    console.log("✅ No se encontraron duplicados.");
  }
}

deduplicateContacts();
