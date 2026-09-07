import axios from "axios";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import { isHighYieldProperty } from "../underwriting/underwriter";

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runPdfAppraisalWorker() {
  console.log("\n========================================================");
  console.log("📁 [PDF WORKER] Iniciando Extracción de Tasaciones desde PDF");
  console.log("========================================================\n");

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[PDF WORKER WARNING] GEMINI_API_KEY no está configurada en .env. Saltando extracción de PDF.");
    return;
  }

  try {
    // 1. Seleccionar registros que tengan PDF y les falte avalúo o deuda
    const pendingAuctions = await db.execute(`
      SELECT auction_id, case_number, address, pdf_url, appraisal_value, debt_amount, needs_manual_review
      FROM foreclosure_auctions
      WHERE pdf_url IS NOT NULL AND pdf_url != ''
        AND ((appraisal_value IS NULL OR appraisal_value = 0) OR (debt_amount IS NULL OR debt_amount = 0))
    `);

    const rows = pendingAuctions.rows;
    console.log(`[PDF WORKER] Encontrados ${rows.length} expedientes con PDF judicial pendiente de extracción completa.`);

    const models = ["gemini-3.1-pro-preview", "gemini-3.8-flash"];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const auctionId = row.auction_id as string;
      const caseNumber = row.case_number as string;
      const address = row.address as string;
      const pdfUrl = row.pdf_url as string;

      console.log(`\n[PDF WORKER] (${i + 1}/${rows.length}) Procesando Caso: ${caseNumber} | Dirección: ${address}`);
      console.log(`  Descargando PDF: ${pdfUrl}...`);

      let pdfBuffer: Buffer;
      try {
        const downloadResp = await axios.get(pdfUrl, {
          responseType: "arraybuffer",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          },
          timeout: 15000
        });
        pdfBuffer = Buffer.from(downloadResp.data);
      } catch (err: any) {
        console.error(`  [PDF WORKER ERROR] No se pudo descargar el PDF: ${err.message}`);
        continue;
      }

      if (pdfBuffer.length < 1000) {
        console.warn(`  [PDF WORKER WARNING] El PDF descargado es demasiado pequeño o está corrupto (${pdfBuffer.length} bytes). Saltando.`);
        continue;
      }

      const base64Pdf = pdfBuffer.toString("base64");

      // Prompt para Gemini Flagship
      const prompt = `Instrucción: Eres un auditor legal de subastas judiciales en Kentucky.
Analiza minuciosamente el documento judicial adjunto (Master Commissioner Appraisal / Evaluation Report / Judgment) y extrae:
1. appraisalValue: El valor de tasación oficial del inmueble (Appraisal Value / Evaluated Value / Fair Cash Value). Suele aparecer como "appraised value", "appraisal amount", "evaluated at" o "appraised at". Si no contiene tasación numérica, null.
2. judgmentDebt: Si se menciona en el documento, el monto de la deuda o juicio reclamado por el demandante (Judgment Debt / Principal Debt / Claim). Si no se menciona, null.

REGLAS:
- Responde únicamente en formato JSON válido con esta estructura:
{
  "appraisalValue": number o null,
  "judgmentDebt": number o null,
  "explanation": "Breve explicación en español de lo encontrado en el PDF"
}`;

      try {
        let responseText = "";
        let usedModel = "";

        for (const model of models) {
          try {
            console.log(`  Consultando API de Gemini (${model}) con el PDF multimodal...`);
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            const geminiResp = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{
                  parts: [
                    { inlineData: { mimeType: "application/pdf", data: base64Pdf } },
                    { text: prompt }
                  ]
                }],
                generationConfig: { response_mime_type: "application/json" }
              }),
              signal: AbortSignal.timeout(30000)
            });

            if (!geminiResp.ok) {
              console.warn(`  [PDF WORKER] Falló ${model}: HTTP ${geminiResp.status}`);
              continue;
            }

            const data = await geminiResp.json() as any;
            if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
              responseText = data.candidates[0].content.parts[0].text;
              usedModel = model;
              break;
            }
          } catch (mErr: any) {
            console.warn(`  [PDF WORKER] Error en ${model}: ${mErr.message}`);
          }
        }

        if (!responseText) {
          throw new Error("Respuesta vacía o fallida de todos los modelos de Gemini.");
        }

        const match = responseText.match(/\{[\s\S]*\}/);
        const cleanJson = match ? match[0] : responseText;
        const result = JSON.parse(cleanJson);
        const extAppraisal = result.appraisalValue ? parseFloat(result.appraisalValue) : null;
        const extDebt = result.judgmentDebt ? parseFloat(result.judgmentDebt) : null;
        const explanation = result.explanation || "";

        console.log(`  [GEMINI RESULT (${usedModel})] Appraisal: $${extAppraisal?.toLocaleString() || "No encontrado"} | Debt: $${extDebt?.toLocaleString() || "No encontrado"}`);
        console.log(`  Detalles: ${explanation}`);

        if ((extAppraisal && extAppraisal > 0) || (extDebt && extDebt > 0)) {
          const currentAppraisal = (row.appraisal_value as number) || 0;
          const currentDebt = (row.debt_amount as number) || 0;
          const finalAppraisal = (extAppraisal && extAppraisal > 0) ? extAppraisal : currentAppraisal;
          const finalDebt = (extDebt && extDebt > 0) ? extDebt : currentDebt;
          const isHighYield = (finalAppraisal > 0 && finalDebt > 0 && isHighYieldProperty(finalAppraisal, finalDebt, 0, 0, 0.20)) ? 1 : 0;
          const needsManual = (finalDebt > 0 && finalAppraisal > 0) ? 0 : (row.needs_manual_review as number || 0);

          await db.execute({
            sql: `
              UPDATE foreclosure_auctions SET
                appraisal_value = CASE WHEN ? > 0 THEN ? ELSE appraisal_value END,
                debt_amount = CASE WHEN ? > 0 THEN ? ELSE debt_amount END,
                is_high_yield = ?,
                needs_manual_review = ?
              WHERE auction_id = ?
            `,
            args: [
              extAppraisal || 0, extAppraisal || 0,
              extDebt || 0, extDebt || 0,
              isHighYield,
              needsManual,
              auctionId
            ]
          });
          console.log(`  [DB UPDATE SUCCESS] Caso ${caseNumber} actualizado en Turso. Appraisal: $${finalAppraisal.toLocaleString()} | Debt: $${finalDebt.toLocaleString()} | HighYield: ${isHighYield}`);
        } else {
          console.log(`  [PDF WORKER SKIP] No se extrajeron cifras monetarias válidas del documento.`);
        }

      } catch (geminiErr: any) {
        console.error(`  [PDF WORKER ERROR] Falló la llamada a Gemini para ${caseNumber}: ${geminiErr.message}`);
      }

      // Evitar saturar la cuota de la API
      await sleep(1500);
    }

  } catch (err: any) {
    console.error("[PDF WORKER CRITICAL ERROR] Falló la ejecución del worker:", err.message);
  }
}

if (typeof require !== "undefined" && require.main === module) {
  runPdfAppraisalWorker().catch(console.error);
} else if (process.argv[1] && process.argv[1].includes("pdf_appraisal_worker")) {
  runPdfAppraisalWorker().catch(console.error);
}
