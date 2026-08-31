import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

const url = "https://ddwyutisxymuvofkjhpz.supabase.co";
const serviceKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";
const sb = createClient(url, serviceKey);

async function embedInitialLeads() {
  const { data: leads, error } = await sb
    .from("contacts")
    .select("*")
    .ilike("external_ref", "LEAD_%")
    .order("created_at", { ascending: false });

  if (error || !leads || leads.length === 0) {
    console.error("Error fetching leads:", error);
    return;
  }

  console.log(`Fetched ${leads.length} leads to embed as initial state.`);

  const tzelPagePath = "c:\\TRABAJO\\TZEL\\tzel\\modules\\construction\\barba_crm_components\\TzelLeadsPage.jsx";
  const barbaPagePath = "c:\\TRABAJO\\barba construction\\barba-crm\\src\\pages\\admin\\TzelLeadsPage.jsx";

  const cleanLeadsJson = JSON.stringify(leads, null, 2);

  const fallbackBlock = `// 48 LEADS CALIFICADOS EMBEBIDOS COMO ESTADO INICIAL
const INITIAL_VERIFIED_LEADS = ${cleanLeadsJson};

export default function TzelLeadsPage() {
  const [leads, setLeads] = useState(INITIAL_VERIFIED_LEADS);
  const [loading, setLoading] = useState(false);`;

  [tzelPagePath, barbaPagePath].forEach((filePath) => {
    let content = fs.readFileSync(filePath, "utf-8");
    
    // Replace useState([]) with useState(INITIAL_VERIFIED_LEADS)
    if (content.includes("const INITIAL_VERIFIED_LEADS =")) {
      content = content.replace(/\/\/ 48 LEADS CALIFICADOS EMBEBIDOS[\s\S]*?const \[loading, setLoading\] = useState\(false\);/, fallbackBlock);
    } else {
      content = content.replace(
        "export default function TzelLeadsPage() {\n  const [leads, setLeads] = useState([]);\n  const [loading, setLoading] = useState(true);",
        fallbackBlock
      );
      if (!content.includes("INITIAL_VERIFIED_LEADS")) {
        content = content.replace(
          "export default function TzelLeadsPage() {",
          `// 48 LEADS CALIFICADOS EMBEBIDOS COMO ESTADO INICIAL\nconst INITIAL_VERIFIED_LEADS = ${cleanLeadsJson};\n\nexport default function TzelLeadsPage() {`
        );
        content = content.replace("const [leads, setLeads] = useState([]);", "const [leads, setLeads] = useState(INITIAL_VERIFIED_LEADS);");
        content = content.replace("const [loading, setLoading] = useState(true);", "const [loading, setLoading] = useState(false);");
      }
    }

    fs.writeFileSync(filePath, content, "utf-8");
    console.log(`Updated ${filePath} with instant embedded leads!`);
  });
}

embedInitialLeads().catch(console.error);
