import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import * as crypto from "crypto";

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

export function normalizeName(name: string): string {
  if (!name) return "";
  let clean = name.toUpperCase();
  // Remove punctuation
  clean = clean.replace(/[,.\-\/_#]/g, " ");
  // Remove corporate suffixes
  const suffixes = [
    /\bLLC\b/g, /\bL\s*L\s*C\b/g,
    /\bINC\b/g, /\bINCORPORATED\b/g,
    /\bCORP\b/g, /\bCORPORATION\b/g,
    /\bCO\b/g, /\bCOMPANY\b/g,
    /\bLTD\b/g, /\bLIMITED\b/g,
    /\bPARTNERS\b/g, /\bHOLDINGS\b/g,
    /\bTRUST\b/g, /\bTRUSTEE\b/g,
    /\bASSOCIATION\b/g, /\bASSN\b/g,
    /\bLIABILITY\b/g, /\bDBA\b/g, /\bD\s*B\s*A\b/g,
    /\bPROP\b/g, /\bPROPS\b/g
  ];
  for (const suf of suffixes) {
    clean = clean.replace(suf, "");
  }
  // Normalize spaces
  clean = clean.replace(/\s+/g, " ").trim();
  return clean;
}

const STOP_WORDS = new Set([
  "THE", "OF", "AND", "OR", "CO", "COMPANY", "CORP", "CORPORATION", "LLC", "INC", 
  "HOLDINGS", "LTD", "LIMITED", "TRUST", "TRUSTEE", "ASSOCIATION", "ASSN", "ESTATE", 
  "REAL", "PROPERTIES", "PROPERTY", "UNKNOWN", "DECEASED", "HEIRS", "LAW", 
  "STATE", "INDIANA", "KENTUCKY", "COMMISSIONER", "CLERK", "SHERIFF", "COURT", "PLAINTIFF", "DEFENDANT",
  "LEGATEES", "DEVISEES", "BENEFICIARIES", "ADMINISTRATRIX", "ADMINISTRATOR", "APPOINTED", "DISTRICT",
  "LIABILITY", "DBA", "PROP", "PROPS", "D", "B", "A", "ET_AL", "ET", "AL",
  // Common first names to prevent matching on shared first names
  "STEVEN", "STEVE", "SHANE", "KEVIN", "ALAN", "CATHERINE", "DWAYNE", "LEE", "ANGIE", "DANNY", "LONDALE", 
  "JOHN", "MARY", "DAVID", "JAMES", "ROBERT", "WILLIAM", "CHARLES", "JOSEPH", "THOMAS", "MARIA", "ANNA", 
  "ANN", "MELANY", "MARVIN", "BRADY", "DYLAN", "VALERIE", "LUCELIA", "CURTIS", "MARK", "AARON", 
  "TYLER", "LANDON", "KORI", "DONALD", "GEORGE", "KENNETH", "EDWARD", "RONALD", "TIMOTHY", "JASON", 
  "JEFFREY", "RYAN", "JACOB", "GARY", "NICHOLAS", "ERIC", "JONATHAN", "STEPHEN", "LARRY", "JUSTIN", 
  "SCOTT", "BRANDON", "FRANK", "BENJAMIN", "GREGORY", "SAMUEL", "RAYMOND", "PATRICK", "ALEXANDER", 
  "JACK", "DENNIS", "JERRY", "HENRY", "DOUGLAS", "PETER", "JOSE", "WALTER", "HAROLD", "KYLE", "CARL", 
  "ARTHUR", "GERALD", "ROGER", "KEITH", "JEREMY", "TERRY", "LAWRENCE", "SEAN", "CHRISTIAN", "ALBERT", 
  "JOE", "ETHAN", "BILLY", "BRYAN", "BRUCE", "RALPH", "ROY", "JORDAN", "EUGENE", "WAYNE", "LOUIS", 
  "HARRY", "RANDY", "JUAN", "CONNOR"
]);

export function isIndividual(name: string): boolean {
  const corporateKeywords = ["LLC", "INC", "CORP", "CO", "TRUST", "ESTATE", "ASSOCIATION", "ASSN", "PARTNERS", "HOLDINGS", "LTD", "LIMITED"];
  const nameUpper = name.toUpperCase();
  return !corporateKeywords.some(keyword => nameUpper.includes(keyword));
}

export function getLastName(name: string): string {
  const clean = name.toUpperCase().replace(/[,.\-\/_#]/g, " ");
  const tokens = clean.split(/\s+/).filter(t => t.length > 0);
  const suffixWords = new Set(["JR", "SR", "II", "III", "IV", "ET", "AL", "ESQ", "MD"]);
  const filtered = tokens.filter(t => !suffixWords.has(t));
  if (filtered.length === 0) return "";
  return filtered[filtered.length - 1];
}

export function getFirstName(name: string): string {
  const clean = name.toUpperCase().replace(/[,.\-\/_#]/g, " ");
  const tokens = clean.split(/\s+/).filter(t => t.length > 0);
  const prefixWords = new Set(["MR", "MRS", "MS", "DR", "PROF"]);
  const filtered = tokens.filter(t => !prefixWords.has(t));
  if (filtered.length === 0) return "";
  return filtered[0];
}

export function cleanPhonesAndEmails(arr: string[]): string[] {
  return arr.filter(item => {
    const upper = item.toUpperCase();
    if (upper.includes("OSINT")) return false;
    if (upper.includes("HTTP")) return false;
    if (upper.includes("555-01")) return false;
    if (upper.includes("TRUEPEOPLE")) return false;
    if (upper.includes("WHITEPAGES")) return false;
    if (upper.includes("FACEBOOK")) return false;
    return true;
  });
}

function getSignificantTokens(normalizedName: string): string[] {
  return normalizedName
    .split(/\s+/)
    .filter(token => token.length >= 3 && !STOP_WORDS.has(token));
}

const geminiEntityCache = new Map<string, boolean>();

async function askGeminiIfSameEntity(
  nameA: string, mailingA: string,
  nameB: string, mailingB: string
): Promise<boolean> {
  const cacheKey = `${nameA}_${mailingA}__${nameB}_${mailingB}`;
  if (geminiEntityCache.has(cacheKey)) {
    return geminiEntityCache.get(cacheKey)!;
  }

  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    if (mailingA && mailingB && mailingA.toLowerCase() === mailingB.toLowerCase() && mailingA.toLowerCase() !== "unknown" && mailingA.length > 5) {
      return true;
    }
    return false;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;
  const prompt = `Instrucción: Eres un experto en resolución de entidades y análisis de beneficiarios reales (UBO) en bienes raíces.
Determina si las siguientes dos entidades/personas representan a la misma entidad legal o beneficiario final físico detrás de una propiedad, basándote en la similitud de nombres y las direcciones fiscales de correo.

REGLAS DE RESOLUCIÓN CRÍTICAS:
1. Si los apellidos de dos personas físicas son diferentes (ej. "ESTES" vs "MARTINEZ", o "ESTES" vs "JOHNSON"), son personas totalmente distintas. La respuesta DEBE ser obligatoriamente is_same_entity = false.
2. El hecho de compartir el primer nombre común (como 'STEVEN', 'JOHN', 'MARY') o palabras genéricas como 'UNKNOWN HEIRS' NO es suficiente para considerarlas la misma entidad.
3. "is_same_entity" debe ser true solo si los nombres son variaciones obvias (ej. "ARRON SPARKS" y "SPARKS, ARRON", o "SPARKS HOLDINGS LLC" y "ARRON SPARKS" si operan bajo la misma firma o comparten dirección fiscal).
4. Si una de las partes es una persona física y la otra es una LLC con el mismo apellido/nombre específico de esa persona, o si comparten la misma dirección de correo (mailing address), se considera la misma entidad (is_same_entity = true).

Por favor, responde en formato JSON exacto:
{
  "pensamiento": "Analiza paso a paso si los apellidos coinciden, si hay dirección fiscal coincidente o si son variaciones obvias. Explica por qué concluyes que son o no la misma entidad.",
  "is_same_entity": true o false
}

Entidad A:
- Nombre: "${nameA}"
- Dirección Fiscal: "${mailingA}"

Entidad B:
- Nombre: "${nameB}"
- Dirección Fiscal: "${mailingB}"`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          response_mime_type: "application/json"
        }
      }),
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
    const data = await response.json() as any;
    const textRes = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textRes) throw new Error("Empty response");

    const parsedResult = JSON.parse(textRes);
    const keys = Object.keys(parsedResult);
    const key = keys.find(k => k.toLowerCase() === "is_same_entity");
    let result = false;
    if (key) {
      const val = (parsedResult as any)[key];
      result = val === true || val === "true" || val === 1 || String(val).toLowerCase() === "true";
    }
    geminiEntityCache.set(cacheKey, result);
    return result;
  } catch (err: any) {
    // Fallback: si falla el LLM, hacemos una simple verificación por heurística
    if (mailingA && mailingB && mailingA.toLowerCase() === mailingB.toLowerCase() && mailingA.toLowerCase() !== "unknown" && mailingA.length > 5) {
      return true;
    }
    return false;
  }
}

interface PropertyRecord {
  id: string;
  table: string;
  address: string;
  rawOwner: string;
  normalizedOwner: string;
  mailingAddress: string;
  phones: string[];
  emails: string[];
  debt: number;
}

async function resolveEntities() {
  console.log("\x1b[36m[INTELIGENCIA] Iniciando resolución de entidades y detección de portafolios...\x1b[0m");

  try {
    // 1. Obtener registros de subastas judiciales
    const auctions = await db.execute("SELECT auction_id, defendant, address, debt_amount, hidden_mortgages, mailing_address, defendant_phones, defendant_emails FROM foreclosure_auctions");
    // 2. Obtener registros de violaciones de código
    const violations = await db.execute("SELECT violation_id, owner_name, address, hidden_mortgages, mailing_address, defendant_phones, defendant_emails FROM code_violations");

    const properties: PropertyRecord[] = [];

    auctions.rows.forEach(r => {
      const rawOwner = r.defendant as string || "Unknown";
      if (rawOwner.toLowerCase() === "unknown" || rawOwner.toLowerCase() === "no especificado") return;
      
      const phones = cleanPhonesAndEmails((r.defendant_phones as string || "").split(/,\s*|;\s*/).map(p => p.trim()).filter(Boolean));
      const emails = cleanPhonesAndEmails((r.defendant_emails as string || "").split(/,\s*|;\s*/).map(e => e.trim()).filter(Boolean));
      const debt = (r.debt_amount as number || 0) + (r.hidden_mortgages as number || 0);

      properties.push({
        id: r.auction_id as string,
        table: "foreclosure_auctions",
        address: r.address as string,
        rawOwner,
        normalizedOwner: normalizeName(rawOwner),
        mailingAddress: (r.mailing_address as string || "").trim(),
        phones,
        emails,
        debt
      });
    });

    violations.rows.forEach(r => {
      const rawOwner = r.owner_name as string || "DUEÑO DESCONOCIDO";
      if (rawOwner.toLowerCase() === "dueño desconocido" || rawOwner.toLowerCase() === "unknown" || rawOwner.toLowerCase() === "no especificado") return;
      
      const phones = cleanPhonesAndEmails((r.defendant_phones as string || "").split(/,\s*|;\s*/).map(p => p.trim()).filter(Boolean));
      const emails = cleanPhonesAndEmails((r.defendant_emails as string || "").split(/,\s*|;\s*/).map(e => e.trim()).filter(Boolean));
      const debt = r.hidden_mortgages as number || 0;

      properties.push({
        id: r.violation_id as string,
        table: "code_violations",
        address: r.address as string,
        rawOwner,
        normalizedOwner: normalizeName(rawOwner),
        mailingAddress: (r.mailing_address as string || "").trim(),
        phones,
        emails,
        debt
      });
    });

    const N = properties.length;
    console.log(`[INTELIGENCIA] Se procesarán ${N} propiedades activas en distress.`);

    // Matriz de adyacencia para el grafo de componentes conectados
    const adj: number[][] = Array.from({ length: N }, () => []);

    // Evaluar relaciones para construir los enlaces del grafo
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const pA = properties[i];
        const pB = properties[j];

        let matched = false;

        // Regla 1: Coincidencia exacta del nombre normalizado
        if (pA.normalizedOwner === pB.normalizedOwner && pA.normalizedOwner.length > 2) {
          matched = true;
        }

        // Regla 2: Coincidencia de Dirección de Correspondencia (mailing address)
        if (!matched && pA.mailingAddress && pB.mailingAddress) {
          const mA = pA.mailingAddress.toLowerCase();
          const mB = pB.mailingAddress.toLowerCase();
          if (mA === mB && mA !== "unknown" && mA.length > 5) {
            matched = true;
            console.log(`[MATCH MAILING] Dirección de correspondencia compartida: "${pA.address}" y "${pB.address}" -> Propietario: "${pA.rawOwner}"`);
          }
        }

        // Regla 3: Coincidencia de Teléfono o Email
        if (!matched) {
          const commonPhones = pA.phones.filter(phone => pB.phones.includes(phone) && phone.length > 6);
          const commonEmails = pA.emails.filter(email => pB.emails.includes(email));
          if (commonPhones.length > 0 || commonEmails.length > 0) {
            matched = true;
            console.log(`[MATCH CONTACT] Teléfono/Email compartido entre "${pA.rawOwner}" y "${pB.rawOwner}"`);
          }
        }

        // Regla 4: Coincidencia Fuzzy con soporte de Gemma LLM local
        if (!matched) {
          // Si ambas partes son personas físicas, requerimos que coincida el apellido principal y el primer nombre
          if (isIndividual(pA.rawOwner) && isIndividual(pB.rawOwner)) {
            const lnA = getLastName(pA.rawOwner);
            const lnB = getLastName(pB.rawOwner);
            if (lnA !== lnB || !lnA || !lnB) {
              continue;
            }

            const fnA = getFirstName(pA.rawOwner);
            const fnB = getFirstName(pB.rawOwner);
            
            let firstNameMatches = fnA === fnB;
            if (!firstNameMatches && fnA && fnB) {
              // Permitir iniciales coincidentes, ej: "G" y "GREGORY"
              if (fnA.length === 1 && fnB.startsWith(fnA)) firstNameMatches = true;
              else if (fnB.length === 1 && fnA.startsWith(fnB)) firstNameMatches = true;
            }

            if (!firstNameMatches) {
              continue;
            }
          }

          const tokensA = getSignificantTokens(pA.normalizedOwner);
          const tokensB = getSignificantTokens(pB.normalizedOwner);

          // Si comparten algún token significativo (para no llamar a Gemini con todo)
          const intersection = tokensA.filter(t => tokensB.includes(t));
          if (intersection.length > 0) {
            const isSame = await askGeminiIfSameEntity(
              pA.rawOwner, pA.mailingAddress,
              pB.rawOwner, pB.mailingAddress
            );

            if (isSame) {
              matched = true;
              console.log(`\x1b[32m[MATCH GEMINI LLM] Gemini resolvió que "${pA.rawOwner}" y "${pB.rawOwner}" son la misma entidad.\x1b[0m`);
            }
          }
        }

        if (matched) {
          adj[i].push(j);
          adj[j].push(i);
        }
      }
    }

    // Algoritmo DFS para encontrar Componentes Conectados
    const visited = new Array(N).fill(false);
    const components: number[][] = [];

    for (let i = 0; i < N; i++) {
      if (!visited[i]) {
        const comp: number[] = [];
        const queue = [i];
        visited[i] = true;

        while (queue.length > 0) {
          const u = queue.shift()!;
          comp.push(u);

          for (const v of adj[u]) {
            if (!visited[v]) {
              visited[v] = true;
              queue.push(v);
            }
          }
        }
        components.push(comp);
      }
    }

    console.log(`[INTELIGENCIA] Detección de clusters finalizada. Componentes encontrados: ${components.length}`);

    // Limpiar tabla portfolio_clusters
    await db.execute("DELETE FROM portfolio_clusters");

    let totalClustersFound = 0;
    let maxClusterOwner = "N/A";
    let maxClusterSize = 0;

    for (const comp of components) {
      const clusterProps = comp.map(idx => properties[idx]);
      
      // Elegir el nombre principal para el cluster
      const nameCounts = new Map<string, number>();
      clusterProps.forEach(p => {
        nameCounts.set(p.rawOwner, (nameCounts.get(p.rawOwner) || 0) + 1);
      });
      let primaryOwnerName = "";
      let maxCount = -1;
      nameCounts.forEach((count, name) => {
        if (count > maxCount) {
          maxCount = count;
          primaryOwnerName = name;
        }
      });

      // Si el cluster contiene más de 1 propiedad, lo contamos como un portafolio en distress
      if (clusterProps.length > 1) {
        totalClustersFound++;
        if (clusterProps.length > maxClusterSize) {
          maxClusterSize = clusterProps.length;
          maxClusterOwner = primaryOwnerName;
        }
      }

      // Preparar campos del cluster
      const clusterId = crypto.randomUUID();
      const associatedProperties = clusterProps.map(p => ({
        id: p.id,
        table: p.table,
        address: p.address,
        debt: p.debt
      }));

      const totalDebtEstimated = clusterProps.reduce((sum, p) => sum + p.debt, 0);
      
      // Risk score: (N * 15) + (Deuda total * 0.0001)
      const riskScore = Math.round(((clusterProps.length * 15) + (totalDebtEstimated * 0.0001)) * 10) / 10;

      await db.execute({
        sql: `
          INSERT INTO portfolio_clusters (cluster_id, primary_owner_name, associated_properties, total_debt_estimated, risk_score)
          VALUES (?, ?, ?, ?, ?)
        `,
        args: [
          clusterId,
          primaryOwnerName,
          JSON.stringify(associatedProperties),
          totalDebtEstimated,
          riskScore
        ]
      });
    }

    // Reporte final en color cian (ANSI escapes)
    console.log(`\x1b[36m[INTELIGENCIA] Se encontraron ${totalClustersFound} portafolios en distress. El portafolio más grande pertenece a "${maxClusterOwner}" con ${maxClusterSize} propiedades en riesgo.\x1b[0m`);

  } catch (err: any) {
    console.error("[INTELIGENCIA ERROR] Falló la resolución de entidades:", err.message);
  }
}

if (require.main === module) {
  resolveEntities().catch(console.error);
}
