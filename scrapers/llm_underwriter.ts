import * as dotenv from "dotenv";

dotenv.config();

export interface LLMAnalysisResult {
  isDismissed: boolean;
  debtAmount: number | null;
  appraisalValue: number | null;
  plaintiff: string | null;
  defendant: string | null;
  reason: string;
}

/**
 * Lógica de fallback basada en reglas rígidas en caso de falla de la API.
 */
function runRuleBasedFallback(rawText: string): LLMAnalysisResult {
  const textLower = rawText.toLowerCase();
  const isDismissed = textLower.includes("dismissed") || 
                      (textLower.includes("decided") && 
                       (textLower.includes("motion to dismiss") || 
                        textLower.includes("order dismissing") || 
                        textLower.includes("order of dismissal") ||
                        textLower.includes("dismissed with prejudice") ||
                        textLower.includes("dismissed without prejudice")));
  
  // Intento de extracción de deuda por regex
  let debtAmount: number | null = null;
  const judgmentMatch = rawText.match(/(?:Judgment|Principal|Claim|Decree|Amount|Deuda)[\s\w]*\$([0-9,]+(?:\.[0-9]{2})?)/i);
  if (judgmentMatch) {
    const val = parseFloat(judgmentMatch[1].replace(/,/g, ""));
    if (!isNaN(val) && val > 0) debtAmount = val;
  }

  return {
    isDismissed,
    debtAmount,
    appraisalValue: null,
    plaintiff: null,
    defendant: null,
    reason: isDismissed 
      ? "Desestimado detectado por reglas de fallback." 
      : "Caso activo detectado por reglas de fallback."
  };
}

/**
 * Consulta la API de Google Gemini utilizando el modelo insignia (gemini-3.1-pro-preview),
 * con fallback automático a gemini-3.8-flash si se agotan cuotas o hay latencia.
 */
async function callGeminiModels(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY no configurada en .env");

  // Orden de prioridad: Modelo insignia Pro primero, luego Flash
  const models = ["gemini-3.1-pro-preview", "gemini-3.8-flash"];
  let lastError: any = null;

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    try {
      console.log(`[LLM UNDERWRITER] Consultando modelo Gemini (${model})...`);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { response_mime_type: "application/json" }
        }),
        signal: AbortSignal.timeout(20000)
      });

      if (!response.ok) {
        throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as any;
      let text = "";
      if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
        text = data.candidates[0].content.parts[0].text;
      }
      if (text) return text;
    } catch (err: any) {
      console.warn(`[LLM UNDERWRITER] Falló consulta con ${model}: ${err.message}. Probando siguiente modelo...`);
      lastError = err;
    }
  }

  throw lastError || new Error("No se pudo obtener respuesta de ningún modelo Gemini.");
}

/**
 * Analiza semánticamente el texto del expediente judicial (Chronological Case Summary o decreto)
 * extrayendo: desestimación, deuda de sentencia, partes procesales y tasación.
 */
export async function analyzeCourtDocketWithGemini(rawText: string): Promise<LLMAnalysisResult> {
  const prompt = `Eres un auditor legal de ejecuciones hipotecarias (Foreclosure Underwriting Specialist) para Kentucky e Indiana.
Analiza minuciosamente el siguiente texto de expediente judicial o aviso de corte y extrae los datos clave:

REGLAS DE EVALUACIÓN:
1. DESESTIMACIÓN (isDismissed):
   - isDismissed = true SI Y SOLO SI el caso se cerró sin sentencia favorable al acreedor (ej: "Order Dismissing", "Motion to Dismiss", "Dismissed with prejudice", etc.).
   - isDismissed = false si el caso sigue abierto o si se dictó sentencia a favor del banco/ejecutante ("Judgment", "Default Judgment", "Decree of Foreclosure", "Order of Sale").
2. DEUDA DE SENTENCIA (debtAmount):
   - Si se menciona un monto de dinero ordenado a pagar, sentencia de foreclosure, capital adeudado, monto reclamado por el banco, o adjudicación monetaria, extráelo como número decimal puro (ej: 84520.12).
   - Si no se especifica ninguna cifra monetaria, devuelve null.
3. VALOR DE AVALÚO (appraisalValue):
   - Si se menciona tasación oficial, fair cash value o appraisal, extráelo como número; si no, null.
4. PARTES:
   - plaintiff: Nombre del acreedor/banco ejecutante si se menciona, o null.
   - defendant: Nombre del deudor/propietario demandado si se menciona, o null.

Responde estrictamente con un JSON válido con esta estructura:
{
  "isDismissed": boolean,
  "debtAmount": number o null,
  "appraisalValue": number o null,
  "plaintiff": string o null,
  "defendant": string o null,
  "reason": "Breve explicación en español de lo detectado"
}

Texto judicial a analizar:
"""${rawText.slice(0, 15000)}"""`;

  try {
    const responseText = await callGeminiModels(prompt);
    const match = responseText.match(/\{[\s\S]*\}/);
    const cleanJson = match ? match[0] : responseText;
    const parsed = JSON.parse(cleanJson);

    const isDismissed = Boolean(parsed.isDismissed);
    const debtAmount = parsed.debtAmount && !isNaN(Number(parsed.debtAmount)) && Number(parsed.debtAmount) > 0 
      ? Number(parsed.debtAmount) 
      : null;
    const appraisalValue = parsed.appraisalValue && !isNaN(Number(parsed.appraisalValue)) && Number(parsed.appraisalValue) > 0 
      ? Number(parsed.appraisalValue) 
      : null;
    const plaintiff = parsed.plaintiff && parsed.plaintiff !== "null" ? String(parsed.plaintiff).trim() : null;
    const defendant = parsed.defendant && parsed.defendant !== "null" ? String(parsed.defendant).trim() : null;
    const reason = parsed.reason || "Análisis completado con Gemini Flagship.";

    console.log(`[LLM UNDERWRITER SUCCESS] isDismissed: ${isDismissed} | Deuda: $${debtAmount?.toLocaleString() || "N/A"} | Razón: ${reason}`);

    return {
      isDismissed,
      debtAmount,
      appraisalValue,
      plaintiff,
      defendant,
      reason
    };
  } catch (err: any) {
    console.error(`[LLM UNDERWRITER ERROR] Error en análisis con Gemini: ${err.message}. Ejecutando fallback.`);
    return runRuleBasedFallback(rawText);
  }
}

/**
 * Función compatible hacia atrás para scrapers existentes
 */
export async function analyzeTextWithGemma(rawText: string): Promise<LLMAnalysisResult> {
  return analyzeCourtDocketWithGemini(rawText);
}
