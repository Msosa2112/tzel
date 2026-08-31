import axios from "axios";
import { createClient } from "@supabase/supabase-js";
import { enrichPropertyWithBatchData } from "./batchdata_enricher";
import dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ddwyutisxymuvofkjhpz.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

const ARCGIS_VIOLATIONS_ENDPOINT = "https://services1.arcgis.com/79kfd2K6fskCAkyg/arcgis/rest/services/PM_SiteVisit_Violations/FeatureServer/0/query";

async function classifyViolationWithGemini(address: string, ownerName: string, violationCode: string, description: string): Promise<any> {
  if (!GEMINI_API_KEY) return null;
  const prompt = `Analiza esta infracción de código de la ciudad de Louisville (Code Enforcement) en una vivienda residencial y responde en JSON:
Dueño: "${ownerName}"
Dirección: "${address}"
Código de Multa: "${violationCode}"
Descripción del daño: """${description.slice(0, 500)}"""

Responde con este esquema JSON estricto:
{
  "serviceCategory": "ROOFING_SIDING_GUTTERS" | "PORCH_DECK_PATIO" | "FENCE_PERIMETER_SECURITY" | "RENOVATION_REMODEL",
  "estimatedBudget": número en USD,
  "summarySpanish": "Resumen claro en español de 1 línea del daño que la ciudad exige reparar al dueño",
  "salesSpeech": "Mensaje respetuoso y profesional presentándose como Barba Construction en Louisville, dirigiéndose a ${ownerName}, mencionando que ayudan a propietarios a corregir citaciones del código municipal con garantía y licencia antes de que se venzan los plazos"
}`;

  const modelName = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  try {
    const res = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`,
      {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
      },
      { timeout: 12000 }
    );
    const raw = res.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    return null;
  }
}

export async function collectLouisvilleCodeViolations(limit: number = 25) {
  console.log("\n=================================================================");
  console.log("🏛️ [LOUISVILLE 311 + BATCHDATA] ESCANEANDO Y ENRIQUECIENDO INFRACCIONES");
  console.log("=================================================================\n");

  const qualifiedLeads: any[] = [];
  const whereClause = "VIOLATION_CODE LIKE '%X19%' OR VIOLATION_CODE LIKE '%X50%' OR VIOLATION_CODE LIKE '%X40%' OR VIOLATION_CODE LIKE '%X15%' OR GUIDE_ITEM_TEXT LIKE '%ROOF%' OR GUIDE_ITEM_TEXT LIKE '%SIDING%'";

  try {
    const response = await axios.get(ARCGIS_VIOLATIONS_ENDPOINT, {
      params: {
        where: whereClause,
        outFields: "ObjectId,FullAddress,PartialAddress,Longitude,Latitude,PARCEL_ID,OccupancyStatus,GUIDE_ITEM_TEXT,VIOLATION_CODE,GUIDE_ITEM_STATUS,CitationAmount",
        f: "json",
        resultRecordCount: limit,
        orderByFields: "ObjectId DESC"
      },
      timeout: 15000
    });

    const features = response.data?.features || [];
    console.log(`📡 Infracciones exteriores detectadas en Louisville Metro: ${features.length}`);

    for (const f of features) {
      const a = f.attributes;
      if (!a || !a.FullAddress) continue;

      const address = a.FullAddress.trim();
      const code = (a.VIOLATION_CODE || "X19").trim();
      const rawDesc = a.GUIDE_ITEM_TEXT || "Infracción de mantenimiento exterior requerida por el ayuntamiento.";
      const citationAmount = a.CitationAmount ? `$${a.CitationAmount} USD` : "Citación / Plazo de corrección";
      const leadRef = `LEAD_METRO_CODE_${a.ObjectId || a.PARCEL_ID || Buffer.from(address).toString("base64").slice(0, 16)}`;

      // 🛡️ PROTECCIÓN DE SALDO: Verificar en Supabase ANTES de consultar BatchData
      const { data: existing } = await supabase
        .from("contacts")
        .select("id, phone, first_name, last_name")
        .eq("external_ref", leadRef)
        .maybeSingle();

      if (existing && existing.phone) {
        console.log(`  ⚡ [SALDO PROTEGIDO] Lead ya enriquecido en BD (${existing.first_name} | ${existing.phone}). Omitiendo consulta de pago.`);
        qualifiedLeads.push(existing);
        continue;
      }

      let category = "RENOVATION_REMODEL";
      let estimatedValue = 6500;
      if (code.includes("X50") || rawDesc.toLowerCase().includes("roof")) {
        category = "ROOFING_SIDING_GUTTERS";
        estimatedValue = 11500;
      } else if (code.includes("X19") || rawDesc.toLowerCase().includes("siding")) {
        category = "ROOFING_SIDING_GUTTERS";
        estimatedValue = 8500;
      } else if (code.includes("X40")) {
        category = "PORCH_DECK_PATIO";
        estimatedValue = 5500;
      }

      // Solo consultar BatchData si es un lead 100% nuevo y el saldo está habilitado
      console.log(`🔍 [BATCHDATA] Skip-Tracing nuevo para: ${address}...`);
      const enriched = await enrichPropertyWithBatchData(address);

      const ownerName = enriched?.ownerName || "Propietario Inmueble";
      const phone = enriched?.primaryPhone || null;
      const email = enriched?.primaryEmail || null;
      const ownerTypeStr = enriched?.isAbsenteeOwner 
        ? `🏢 Inversionista / Propietario No Residente (Mailing: ${enriched.mailingAddress})`
        : `🏠 Propietario Residente`;

      const aiAnalysis = await classifyViolationWithGemini(address, ownerName, code, rawDesc);
      const finalCategory = aiAnalysis?.serviceCategory || category;
      const finalValue = aiAnalysis?.estimatedBudget || estimatedValue;
      const summary = aiAnalysis?.summarySpanish || `Citación municipal ${code}: Reparación obligatoria de fachada/techo. Multa potencial: ${citationAmount}`;
      const pitch = aiAnalysis?.salesSpeech || `Hola ${ownerName}, le contactamos de Barba Construction en Louisville. Brindamos servicios autorizados para corregir citaciones del código municipal ${code} con garantía y precios justos.`;

      const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
      const cleanStreet = address.split(",")[0].trim();
      const truePeopleSearchUrl = `https://www.truepeoplesearch.com/results?streetaddress=${encodeURIComponent(cleanStreet)}&citystatezip=Louisville%2C+KY`;

      const nameParts = ownerName.split(/\s+/);
      const firstName = nameParts[0] || "Propietario";
      const lastName = nameParts.slice(1).join(" ") || `(Infracción Ciudad: ${code})`;

      const leadObj = {
        first_name: firstName,
        last_name: lastName,
        phone: phone,
        email: email,
        address: address,
        city: "Louisville",
        state: "KY",
        source: "other",
        pipeline_status: "new_lead",
        lead_quality: "hot",
        external_ref: leadRef,
        notes: `🚨 INFRACCIÓN MUNICIPAL DE FACHADA/TECHO (Louisville Code Enforcement):\n📌 Citación: Código ${code} | Estado: ${a.GUIDE_ITEM_STATUS || "No Compliance"} | Multa: ${citationAmount}\n👤 Propietario Registrado: ${ownerName} (${ownerTypeStr})\n🏠 Inmueble: ${address}\n🎯 NECESIDAD: ${finalCategory}\n💰 VALOR ESTIMADO: $${finalValue} USD\n🔥 URGENCIA: HIGH\n📋 Requerimiento: ${summary}\n\n🔍 REGISTROS PÚBLICOS: ${truePeopleSearchUrl}\n🗺️ VER UBICACIÓN EN MAPS: ${mapsUrl}\n\n=========================================\n💬 SPEECH DE VENTA RECOMENDADO (ESPAÑOL - DM / WHATSAPP):\n"${pitch}"\n\n💬 SALES PITCH (ENGLISH):\n"Hi ${ownerName}, we are contacting you from Barba Construction regarding city code citation ${code} for your property at ${cleanStreet}. We specialize in fast, licensed exterior repairs to resolve citations before deadlines."\n\n📞 APERTURA TELEFÓNICA:\n"Hola ${ownerName}, le llamo de Barba Construction en Louisville con respecto a los servicios de reparación de fachada y techo para su propiedad en ${cleanStreet}."`
      };

      if (existing) {
        await supabase.from("contacts").update(leadObj).eq("id", existing.id);
        console.log(`  🔄 [ENRIQUECIDO ACTUALIZADO] ${ownerName} | Tel: ${phone || "Buscador manual"} | ${address}`);
        qualifiedLeads.push(leadObj);
      } else {
        const { error: insertErr } = await supabase.from("contacts").insert(leadObj);
        if (!insertErr) {
          console.log(`  🎉 [NUEVO LEAD ENRIQUECIDO] ${ownerName} | Tel: ${phone || "Buscador manual"} | ${address}`);
          qualifiedLeads.push(leadObj);
        } else {
          console.warn(`  ⚠️ Error insertando en Supabase:`, insertErr.message);
        }
      }
    }
  } catch (err: any) {
    console.error("  ❌ Error consultando API de Infracciones de Louisville:", err.message);
  }

  console.log(`\n✅ [LOUISVILLE 311 + BATCHDATA] Total de oportunidades enriquecidas: ${qualifiedLeads.length}\n`);
  return qualifiedLeads;
}

if (require.main === module) {
  collectLouisvilleCodeViolations(20).catch(console.error);
}
