import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const url = "https://ddwyutisxymuvofkjhpz.supabase.co";
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";
const sb = createClient(url, key);

// Patrones estrictos de gente promocionándose, vendiendo casas, autos, o cuadrillas
const PROMOTION_PATTERNS = [
  /se hacen/i,
  /hacemos/i,
  /ofrecemos/i,
  /ofrezco/i,
  /estimados? gratis/i,
  /free estimate/i,
  /free quote/i,
  /trabajo garantizado/i,
  /trabajos garantizados/i,
  /llámanos/i,
  /llamanos/i,
  /llamar al/i,
  /llame al/i,
  /llamarme/i,
  /contactarnos/i,
  /no duden en/i,
  /no dude en/i,
  /a la orden/i,
  /a sus órdenes/i,
  /a sus ordenes/i,
  /cotizaciones gratis/i,
  /cotización gratis/i,
  /somos una/i,
  /somos expertos/i,
  /nos dedicamos/i,
  /say hello to your dream home/i,
  /for rent/i,
  /se renta/i,
  /se vende/i,
  /looking for a new fresh look/i,
  /that's where we come in/i,
  /send message, comment, text/i,
  /we paint/i,
  /we install/i,
  /we build/i,
  /our services/i,
  /our company/i,
  /call or text/i,
  /licensed and insured/i,
  /fully insured/i,
  /give us a call/i,
  /504Construction/i,
  /leayudamosconsupoliza/i,
  /VR Decks Porches/i,
  /Danielle Porche/i,
  /Leydi Nancy/i,
  /Garcia Roofing/i,
  /Stone House/i,
  /Escuelita Gutters/i,
  /Sigero's House/i,
  /Carmen Cabral/i,
  /Keller Williams/i,
  /Realtor Team/i,
  /Cadillac CTS/i,
  /asientos completos de piel/i,
  /título Rebuilt/i,
  /fumigar/i,
  /mober basura/i,
  /limpiar sus canaletas lavar casas/i,
  /movil home y desea aserle un techo/i,
  /Spring is here and you have hugh honey do list/i,
  /ATENCIÓN, ATENCIÓN/i,
  /Tu casa o negocio necesita una remodelación o sufrió daños/i,
  /Tu techo tiene problemas/i,
  /El verano se acerca/i,
  /Step into luxury with this newly renovated/i,
  /Rafael Freyre/i,
  /Holguín/i,
  /Cuba/i,
  /Have you ever seen a fence do this/i,
  /We just wrapped up painting this whole house/i,
  /Hello fellow Oldham County business owners/i,
  /Facebook Potencial/i,
  /Goteras Potencial/i
];

async function purgeAllPromotions() {
  const { data: contacts, error } = await sb
    .from("contacts")
    .select("*")
    .ilike("external_ref", "LEAD_%");

  if (error || !contacts) {
    console.error("Error fetching contacts:", error);
    return;
  }

  console.log(`Analyzing ${contacts.length} current leads in CRM...`);
  const toDelete: string[] = [];

  for (const c of contacts) {
    const fullText = `${c.first_name || ""} ${c.last_name || ""} ${c.notes || ""} ${c.address || ""}`;
    const isPromo = PROMOTION_PATTERNS.some((pat) => pat.test(fullText));

    // Si es un lead de grupo de Facebook y no tiene una necesidad de comprador explícita y verificada
    const isFacebookLead = c.external_ref?.startsWith("LEAD_FB") || c.notes?.includes("Facebook Group");
    
    if (isPromo) {
      console.log(`❌ [PURGA DETECTADA] ${c.first_name} ${c.last_name || ""} | ID: ${c.id}`);
      toDelete.push(c.id);
    } else if (isFacebookLead) {
      // Verificar si el post de Facebook es una autopromoción general
      const notesLower = (c.notes || "").toLowerCase();
      if (
        notesLower.includes("estimado gratis") ||
        notesLower.includes("llamar") ||
        notesLower.includes("502") ||
        notesLower.includes("hacemos") ||
        notesLower.includes("servicios")
      ) {
        console.log(`❌ [PURGA FB AUTO-PROMO] ${c.first_name} ${c.last_name || ""} | ID: ${c.id}`);
        toDelete.push(c.id);
      }
    }
  }

  console.log(`\nFound ${toDelete.length} self-promotions / irrelevant posts to delete.`);

  for (const id of toDelete) {
    await sb.from("contacts").delete().eq("id", id);
  }

  const { data: remaining } = await sb
    .from("contacts")
    .select("*")
    .ilike("external_ref", "LEAD_%")
    .order("created_at", { ascending: false });

  console.log(`Remaining clean buyer leads & commercial subcontracts: ${remaining?.length}`);

  // Re-embed cleanly into TzelLeadsPage.jsx
  if (remaining && remaining.length > 0) {
    const cleanLeadsJson = JSON.stringify(remaining, null, 2);
    const fallbackBlock = `// 48 LEADS CALIFICADOS EMBEBIDOS COMO ESTADO INICIAL\nconst INITIAL_VERIFIED_LEADS = ${cleanLeadsJson};\n\nexport default function TzelLeadsPage() {\n  const [leads, setLeads] = useState(INITIAL_VERIFIED_LEADS);\n  const [loading, setLoading] = useState(false);`;

    const tzelPagePath = "c:\\TRABAJO\\TZEL\\tzel\\modules\\construction\\barba_crm_components\\TzelLeadsPage.jsx";
    const barbaPagePath = "c:\\TRABAJO\\barba construction\\barba-crm\\src\\pages\\admin\\TzelLeadsPage.jsx";

    [tzelPagePath, barbaPagePath].forEach((filePath) => {
      let content = fs.readFileSync(filePath, "utf-8");
      content = content.replace(
        /\/\/ 48 LEADS CALIFICADOS EMBEBIDOS[\s\S]*?const \[loading, setLoading\] = useState\(false\);/,
        fallbackBlock
      );
      fs.writeFileSync(filePath, content, "utf-8");
      console.log(`Updated ${filePath}`);
    });
  }
}

purgeAllPromotions().catch(console.error);
