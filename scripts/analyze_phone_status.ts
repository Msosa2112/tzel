import { createClient } from "@supabase/supabase-js";

const url = "https://ddwyutisxymuvofkjhpz.supabase.co";
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || "");
const sb = createClient(url, serviceKey);

async function analyzePhones() {
  const { data: leads, error } = await sb
    .from("contacts")
    .select("*")
    .ilike("external_ref", "LEAD_%");

  if (error || !leads) {
    console.error("Error:", error);
    return;
  }

  const total = leads.length;
  const withPhone = leads.filter(l => l.phone && l.phone.trim().length > 5);
  const withoutPhone = leads.filter(l => !l.phone || l.phone.trim().length <= 5);

  const violations = leads.filter(l => l.address && !l.address.startsWith("Grupo:") && l.address.includes("LOUISVILLE"));
  const violationsWithPhone = violations.filter(l => l.phone);

  const fbLeads = leads.filter(l => l.source === "facebook" || l.notes?.includes("FACEBOOK"));
  const commercial = leads.filter(l => l.notes?.includes("LINKEDIN") || l.notes?.includes("SUBCONTRATACIÓN"));

  console.log(`📊 TOTAL LEADS ACTIVOS: ${total}`);
  console.log(`📞 Con teléfono directo: ${withPhone.length}`);
  console.log(`❌ Sin teléfono (requiere skip-tracing / DM): ${withoutPhone.length}`);
  console.log(`-----------------------------------------------`);
  console.log(`🏠 Inmuebles con Dirección Exacta (Violaciones de Código / Multas de Techo/Siding): ${violations.length}`);
  console.log(`   - Con teléfono ya enriquecido: ${violationsWithPhone.length}`);
  console.log(`   - Listos para Skip-Tracing en BatchData (Dirección + Ciudad + Zip): ${violations.length - violationsWithPhone.length}`);
  console.log(`📱 Leads de Redes Sociales (Facebook / LinkedIn / Reddit): ${fbLeads.length + commercial.length}`);
  console.log(`   - Se contactan vía DM / Mensaje Directo o botón "Buscar Teléfono" (TruePeopleSearch gratis)`);
}

analyzePhones();
