import axios from "axios";
import * as dotenv from "dotenv";
dotenv.config();

const KEY = process.env.GEMINI_API_KEY || "";

const TEST_POSTS = [
  {
    type: "Labor Seeker (SHOULD BE REJECTED)",
    text: "Busco a 1 Persona para trabajar de remodelación esta semana en New Albany Indiana empezando hoy mismo"
  },
  {
    type: "Job Seeker (SHOULD BE REJECTED)",
    text: "Mi nombre es Orlando.. estoy buscando trabajo de construcción ...o cuálquier trabajo mi número es +1(859)4876286"
  },
  {
    type: "Contractor Promo (SHOULD BE REJECTED)",
    text: "New Deck Build — Clean & Solid Built strong. Built right. Ready to enjoy Call, text, or contact us (502) 555-0192"
  },
  {
    type: "Real Homeowner (SHOULD BE ACCEPTED)",
    text: "Anyone have a recommendation for a reliable roofer in Louisville? We have a leak around our chimney that needs urgent repair before next storm."
  },
  {
    type: "Real Property Investor (SHOULD BE ACCEPTED)",
    text: "I have a few properties in Louisville that need renovations (drywall, bathrooms, siding). My regular crews aren't able to keep up with the workload. Looking for reliable contractors."
  }
];

async function testModel(modelName: string) {
  console.log(`\n======================================================`);
  console.log(`PROBANDO MODELO: ${modelName}`);
  console.log(`======================================================`);

  for (let i = 0; i < TEST_POSTS.length; i++) {
    const post = TEST_POSTS[i];
    const prompt = `Eres el Auditor de Leads de Barba Construction en Louisville, KY.
Analiza la siguiente publicación y determina si es un CLIENTE/DUEÑO/INVERSIONISTA REAL buscando contratar servicios de obra (VÁLIDO), o si es alguien ofreciendo servicios, publicidad de contratistas, agencias de staffing, albañiles buscando empleo o personas buscando ayudantes (RECHAZAR).

Publicación:
"""${post.text}"""

Responde estrictamente en JSON:
{
  "isValidHomeownerLead": boolean,
  "reason": "Explicación breve de 1 frase",
  "category": "ROOFING_SIDING_GUTTERS" | "PORCH_DECK_PATIO" | "RENOVATION_REMODEL" | "OTHER"
}`;

    const start = Date.now();
    try {
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${KEY}`,
        {
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, responseMimeType: "application/json" }
        },
        { timeout: 10000 }
      );
      const latency = Date.now() - start;
      const json = JSON.parse(res.data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
      console.log(`\n[Caso ${i + 1}] Tipo esperado: ${post.type}`);
      console.log(`   ⏱️ Latencia: ${latency}ms`);
      console.log(`   🎯 Resultado: ${json.isValidHomeownerLead ? "✅ ACEPTADO" : "❌ RECHAZADO"}`);
      console.log(`   📝 Motivo: ${json.reason}`);
    } catch (err: any) {
      console.log(`\n[Caso ${i + 1}] ERROR (${modelName}):`, err.response?.data?.error?.message || err.message);
    }
  }
}

async function runAll() {
  await testModel("gemini-flash-latest");
  await testModel("gemini-2.5-flash-lite");
  await testModel("gemini-3.1-flash-lite");
}

runAll().catch(console.error);
