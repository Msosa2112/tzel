import * as dotenv from "dotenv";

dotenv.config();

export interface LLMAnalysisResult {
  isDismissed: boolean;
  reason: string;
}

/**
 * Lógica de fallback basada en reglas rígidas en caso de que Ollama no esté disponible.
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
  
  return {
    isDismissed,
    reason: isDismissed 
      ? "Desestimado detectado por reglas de fallback (Dismissed or Decided + Dismissal)." 
      : "Caso activo detectado por reglas de fallback."
  };
}

/**
 * Envía el texto del expediente judicial a la API local de Ollama (Gemma:7b)
 * para clasificar semánticamente si el caso ha sido desestimado.
 */
export async function analyzeTextWithGemma(rawText: string): Promise<LLMAnalysisResult> {
  const url = "http://localhost:11434/api/generate";
  const prompt = `Instrucción: Eres un asistente legal experto. Analiza el siguiente texto de un expediente judicial de ejecución hipotecaria (foreclosure) y determina si el caso ha sido desestimado (dismissed) por el tribunal.

REGLAS DE CLASIFICACIÓN (Síguelas al pie de la letra):
1. Un caso está DESESTIMADO (isDismissed = true) si y solo si se cerró sin que el acreedor/banco obtuviera una sentencia de ejecución. Esto se indica por la presencia de mociones u órdenes de desestimación ("Motion to Dismiss", "Order Dismissing", "Dismissal", "Desestimado").
2. Un caso NO está desestimado (isDismissed = false) si se dictó una sentencia a favor del banco ("Judgment", "Default Judgment", "Foreclosure Judgment", "Summary Judgment", "Order of Sale", "Sheriff Sale Ordered", "Deuda extraída", "Monetary Award"). El estatus "Decided" simplemente significa que hay una resolución, la cual suele ser la sentencia de ejecución, por lo que NO implica desestimación.
3. Si el caso sigue en curso ("Pending", "Open") y no tiene órdenes de desestimación, isDismissed debe ser false.

Por favor, analiza el texto del expediente provisto abajo y responde con este formato JSON:
{
  "pensamiento": "Analiza aquí paso a paso si hay alguna orden de desestimación (dismiss) o si por el contrario hay una sentencia (judgment) o si el caso sigue activo.",
  "isDismissed": true o false,
  "reason": "Explicación breve y específica del caso analizado en español (¡NUNCA inventes eventos ni copies ejemplos!)"
}

Texto del expediente a analizar:
${rawText}`;

  try {
    console.log("[LLM UNDERWRITER] Consultando Gemma local en localhost:11434...");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemma:7b",
        prompt: prompt,
        stream: false,
        format: "json"
      }),
      // Añadir un timeout razonable para evitar colgar el pipeline si Ollama no responde
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
    }

    const data = await response.json() as { response: string };
    
    if (!data.response) {
      throw new Error("Respuesta vacía recibida desde Ollama.");
    }

    const parsedResult = JSON.parse(data.response);
    
    let isDismissed = false;
    let reason = "Sin detalles adicionales del LLM.";
    
    if (parsedResult) {
      const keys = Object.keys(parsedResult);
      const isDismissedKey = keys.find(k => k.toLowerCase() === "isdismissed");
      if (isDismissedKey) {
        const val = (parsedResult as any)[isDismissedKey];
        isDismissed = val === true || val === "true" || val === 1 || String(val).toLowerCase() === "true";
      }
      
      const reasonKey = keys.find(k => k.toLowerCase() === "reason");
      if (reasonKey) {
        reason = (parsedResult as any)[reasonKey] || reason;
      }
    }
    
    console.log(`[LLM UNDERWRITER SUCCESS] Decisión: ${isDismissed} | Razón: ${reason}`);
    
    return {
      isDismissed,
      reason
    };

  } catch (err: any) {
    console.warn(`[LLM UNDERWRITER WARNING] No se pudo conectar con Ollama o falló la respuesta: ${err.message}. Usando fallback de reglas rígidas.`);
    return runRuleBasedFallback(rawText);
  }
}
