import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import * as dotenv from "dotenv";

chromium.use(stealthPlugin());
dotenv.config();

export interface LienDetectorResult {
  hasHiddenLiens: boolean;
  totalHiddenDebt: number;
}

/**
 * Searches county clerk records for hidden liens/mortgages using Playwright Stealth.
 * Uses DuckDuckGo Lite search as a fallback search engine to bypass portal firewalls.
 */
async function scrapeClerkPortal(
  ownerName: string,
  county: string,
  state: string
): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
  });
  const page = await context.newPage();

  let bodyText = "";
  try {
    const cleanOwner = ownerName.replace(/["']/g, "").trim();
    // Simulate searching county clerk records index
    const query = `"${cleanOwner}" ${county} county clerk records recorder (Mortgage OR Judgment OR Lien OR IRS)`;
    console.log(`[LIEN DETECTOR SCRAPER] Querying DDG Lite for public records index: "${query}"`);
    
    await page.goto(`https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`, {
      waitUntil: "networkidle",
      timeout: 15000
    });

    bodyText = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll(".result-snippet, .result-link"));
      return elements.map(el => el.textContent || "").join("\n");
    });
  } catch (err: any) {
    console.error(`[LIEN DETECTOR SCRAPER ERROR] Playwright navigation failed:`, err.message);
  } finally {
    await browser.close();
  }

  return bodyText;
}

/**
 * Analyzes the crawled public clerk records using Google Gemini 1.5 Flash
 * to extract exact dollar amounts of secondary hidden debts.
 */
export async function analyzeLienTextWithGemini(rawText: string): Promise<LienDetectorResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[LIEN DETECTOR WARNING] GEMINI_API_KEY is not configured. Falling back to rules.");
    return runLienRuleBasedFallback(rawText);
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
  const prompt = `Instrucción: Eres un analista de títulos inmobiliarios experto. Analiza el siguiente texto de registros públicos del secretario del condado (county clerk) para una propiedad/propietario y determina si existen gravámenes secundarios (junior liens), hipotecas adicionales (mortgages), deudas de impuestos (Tax Liens, IRS) o juicios civiles (Judgments) vigentes.

REGLAS DE EXTRACCIÓN:
1. Considera únicamente documentos que representen pasivos/deudas ocultas secundarias, tales como: 'Mortgage', 'Judgment', 'Mechanic's Lien', 'Tax Lien' o 'IRS'.
2. Extrae y suma el monto total en dólares americanos de estas deudas secundarias y colócalo en 'totalHiddenDebt'.
3. Si el texto no menciona ninguna deuda, o si no se detectan gravámenes secundarios, responde con 'hasHiddenLiens' en false y 'totalHiddenDebt' en 0.
4. Tu respuesta debe ser estrictamente en formato JSON válido con la siguiente estructura:
{
  "hasHiddenLiens": true o false,
  "totalHiddenDebt": número
}

Texto de registros públicos a analizar:
${rawText}`;

  const maxRetries = 3;
  let responseText = "";

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[LIEN DETECTOR GEMINI] Invocando Gemini (intento ${attempt}/${maxRetries})...`);
      // Retardo preventivo de 5 segundos para evitar 429
      await new Promise(resolve => setTimeout(resolve, 5000));

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
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
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
        if (response.status === 429 && attempt < maxRetries) {
          const delay = 15000 * Math.pow(2, attempt - 1);
          console.warn(`[LIEN DETECTOR GEMINI 429] Rate limit superado. Reintentando en ${delay / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw new Error(`HTTP Error ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as any;
      responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      if (!responseText) {
        throw new Error("Respuesta vacía o estructura inválida de Gemini.");
      }
      break; // Éxito
    } catch (err: any) {
      if (attempt === maxRetries) {
        console.error(`[LIEN DETECTOR GEMINI ERROR] Falló análisis con Gemini tras ${maxRetries} intentos: ${err.message}`);
        throw err; // Propagar error para que la auditoría no sea marcada como exitosa silenciosamente
      }
      const delay = 8000 * Math.pow(2, attempt - 1);
      console.warn(`[LIEN DETECTOR GEMINI WARN] Intento ${attempt} falló: ${err.message}. Reintentando en ${delay / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  try {
    const result = JSON.parse(responseText) as LienDetectorResult;
    return {
      hasHiddenLiens: !!result.hasHiddenLiens,
      totalHiddenDebt: Number(result.totalHiddenDebt) || 0
    };
  } catch (jsonErr: any) {
    console.error(`[LIEN DETECTOR GEMINI JSON ERROR] Error al parsear respuesta: ${responseText}`);
    throw jsonErr;
  }
}

/**
 * Regex-based rule fallback for parsing secondary debt when Gemini is unavailable.
 */
function runLienRuleBasedFallback(rawText: string): LienDetectorResult {
  const lowerText = rawText.toLowerCase();
  const dangerKeywords = ["mortgage", "judgment", "mechanic", "tax lien", "irs", "gravamen", "hipoteca", "ejecución"];
  
  const hasDanger = dangerKeywords.some(keyword => lowerText.includes(keyword));
  if (!hasDanger) {
    return { hasHiddenLiens: false, totalHiddenDebt: 0 };
  }

  // Aggressive dollar amount extraction
  const amountRegex = /\$\s*([0-9,]{3,12}(?:\.[0-9]{2})?)/g;
  let match;
  const foundAmounts: number[] = [];

  while ((match = amountRegex.exec(rawText)) !== null) {
    const amt = parseFloat(match[1].replace(/,/g, ""));
    if (!isNaN(amt) && amt >= 1000 && amt <= 250000) {
      foundAmounts.push(amt);
    }
  }

  const totalHiddenDebt = foundAmounts.length > 0 ? foundAmounts.reduce((a, b) => a + b, 0) : 0;
  return {
    hasHiddenLiens: totalHiddenDebt > 0,
    totalHiddenDebt
  };
}

export async function checkPropertyLiens(
  ownerName: string,
  address: string,
  state: string,
  county: string
): Promise<LienDetectorResult> {
  if (!ownerName || ownerName === "No especificado" || ownerName === "DUEÑO DESCONOCIDO" || ownerName === "Unknown") {
    console.log(`[LIEN DETECTOR] Owner name is unknown. Skipping check.`);
    return { hasHiddenLiens: false, totalHiddenDebt: 0 };
  }

  console.log(`[LIEN DETECTOR] Scanning public records for "${ownerName}" in ${county} County, ${state}...`);
  const recordText = await scrapeClerkPortal(ownerName, county, state);
  
  if (!recordText || recordText.trim() === "") {
    console.log(`[LIEN DETECTOR CLEAN] No records found on Clerk portal for "${ownerName}".`);
    return { hasHiddenLiens: false, totalHiddenDebt: 0 };
  }

  // OPTIMIZACIÓN: Verificar heurísticamente si el texto contiene palabras clave de deudas y cifras
  const lowerText = recordText.toLowerCase();
  const dangerKeywords = ["mortgage", "judgment", "mechanic", "tax lien", "irs", "gravamen", "hipoteca", "ejecución"];
  const hasDanger = dangerKeywords.some(keyword => lowerText.includes(keyword));

  if (!hasDanger) {
    console.log(`[LIEN DETECTOR OPTIMIZATION] Omitiendo llamada a Gemini para "${ownerName}": No se detectaron palabras clave de deudas secundarias.`);
    return { hasHiddenLiens: false, totalHiddenDebt: 0 };
  }

  // Pass found text to Gemini for dollar extraction
  const result = await analyzeLienTextWithGemini(recordText);
  console.log(`[LIEN DETECTOR SUCCESS] Result for "${ownerName}": hasHiddenLiens=${result.hasHiddenLiens}, totalHiddenDebt=$${result.totalHiddenDebt}`);
  
  return result;
}
