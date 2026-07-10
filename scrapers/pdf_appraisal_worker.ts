import axios from "axios";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

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
    // 1. Seleccionar registros que tengan PDF y les falte el valor del avalúo (appraisal_value)
    const pendingAuctions = await db.execute(`
      SELECT auction_id, case_number, address, pdf_url, appraisal_value, debt_amount
      FROM foreclosure_auctions
      WHERE pdf_url IS NOT NULL AND (appraisal_value IS NULL OR appraisal_value = 0)
      LIMIT 15
    `);

    const rows = pendingAuctions.rows;
    console.log(`[PDF WORKER] Encontrados ${rows.length} expedientes con PDF pendiente de tasación.`);

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

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

      // Prompt para Gemini
      const prompt = `Instrucción: Analiza el documento judicial de tasación (appraisal/evaluation) adjunto y extrae los siguientes datos clave:
1. El valor de tasación del inmueble (Appraisal Value / Evaluated Value). Suele aparecer etiquetado como "appraised value", "appraisal amount", "evaluated at", "fair cash value" o "appraised at".
2. Si se menciona, el monto de la deuda o juicio reclamado por el demandante (Judgment Debt / Principal Debt).

REGLAS:
- Si el documento es un formulario en blanco, una orden de cancelación o no contiene un valor numérico de tasación para la propiedad, devuelve null.
- Responde únicamente en formato JSON válido con las siguientes claves:
{
  "appraisalValue": number o null,
  "judgmentDebt": number o null,
  "explanation": "Breve explicación en español de lo encontrado en el PDF"
}`;

      try {
        console.log(`  Consultando API de Gemini (gemini-2.5-flash) con el PDF multimodal...`);
        
        const geminiResp = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    inlineData: {
                      mimeType: "application/pdf",
                      data: base64Pdf
                    }
                  },
                  {
                    text: prompt
                  }
                ]
              }
            ],
            generationConfig: {
              response_mime_type: "application/json"
            }
          }),
          signal: AbortSignal.timeout(20000)
        });

        if (!geminiResp.ok) {
          throw new Error(`HTTP Error ${geminiResp.status}: ${geminiResp.statusText}`);
        }

        const data = await geminiResp.json() as any;
        let responseText = "";

        if (data.candidates && data.candidates[0]?.content?.parts && data.candidates[0].content.parts[0]) {
          responseText = data.candidates[0].content.parts[0].text;
        }

        if (!responseText) {
          throw new Error("Respuesta vacía de la API de Gemini.");
        }

        const result = JSON.parse(responseText.trim());
        const extAppraisal = result.appraisalValue ? parseFloat(result.appraisalValue) : null;
        const extDebt = result.judgmentDebt ? parseFloat(result.judgmentDebt) : null;
        const explanation = result.explanation || "";

        console.log(`  [GEMINI RESULT] Appraisal: $${extAppraisal?.toLocaleString() || "No encontrado"} | Debt: $${extDebt?.toLocaleString() || "No encontrado"}`);
        console.log(`  Detalles: ${explanation}`);

        if (extAppraisal && extAppraisal > 0) {
          // Actualizar en base de datos
          if (extDebt && extDebt > 0 && (!row.debt_amount || row.debt_amount === 0)) {
            await db.execute({
              sql: "UPDATE foreclosure_auctions SET appraisal_value = ?, debt_amount = ? WHERE auction_id = ?",
              args: [extAppraisal, extDebt, auctionId]
            });
            console.log(`  [DB UPDATE] Actualizados appraisal_value y debt_amount para caso ${caseNumber}.`);
          } else {
            await db.execute({
              sql: "UPDATE foreclosure_auctions SET appraisal_value = ? WHERE auction_id = ?",
              args: [extAppraisal, auctionId]
            });
            console.log(`  [DB UPDATE] Actualizado appraisal_value para caso ${caseNumber}.`);
          }
        } else {
          console.log(`  [PDF WORKER SKIP] No se extrajo un valor de tasación válido.`);
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

// Ejecutar si se corre directamente
if (require.main === module) {
  runPdfAppraisalWorker().catch(console.error);
}
