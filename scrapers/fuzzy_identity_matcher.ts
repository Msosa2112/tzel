import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

/**
 * Normaliza un nombre para comparación difusa (Fuzzy Matching).
 * Convierte a mayúsculas, elimina puntuación, remueve sufijos corporativos y
 * opcionalmente iniciales de segundo nombre (middle initials) para maximizar coincidencia.
 */
export function normalizeNameForFuzzy(name: string): string {
  if (!name) return "";
  let clean = name.toUpperCase();
  
  // Eliminar signos de puntuación comunes
  clean = clean.replace(/[,.\-\/_#]/g, " ");

  // Eliminar sufijos corporativos y judiciales de ruido comunes
  const corporateSuffixes = [
    /\bLLC\b/g, /\bINC\b/g, /\bCORP\b/g, /\bCO\b/g, /\bCOMPANY\b/g,
    /\bLTD\b/g, /\bLIMITED\b/g, /\bTRUST\b/g, /\bTRUSTEE\b/g,
    /\bASSOCIATION\b/g, /\bASSN\b/g, /\bET\s+AL\b/g, /\bESTATE\s+OF\b/g,
    /\bESTATE\b/g
  ];
  for (const suf of corporateSuffixes) {
    clean = clean.replace(suf, " ");
  }

  // Normalizar espacios múltiples
  clean = clean.replace(/\s+/g, " ").trim();

  // Eliminar iniciales del medio (un solo carácter de la A a la Z rodeado por límites de palabra)
  // Ej: "JAMEL D ROWE" -> "JAMEL ROWE"
  clean = clean.replace(/\b[A-Z]\b/g, "").replace(/\s+/g, " ").trim();

  return clean;
}

/**
 * Calcula la distancia de Levenshtein entre dos cadenas de texto.
 */
export function getLevenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // Sustitución
          Math.min(
            matrix[i][j - 1] + 1,   // Inserción
            matrix[i - 1][j] + 1    // Borrado
          )
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Calcula la similitud fuzzy entre dos nombres basados en distancia de Levenshtein.
 * Retorna un valor entre 0.0 y 1.0.
 */
export function calculateFuzzySimilarity(nameA: string, nameB: string): number {
  const normA = normalizeNameForFuzzy(nameA);
  const normB = normalizeNameForFuzzy(nameB);

  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;

  const distance = getLevenshteinDistance(normA, normB);
  const maxLength = Math.max(normA.length, normB.length);

  return 1 - distance / maxLength;
}

/**
 * Escanea la base de datos de Turso, busca nombres similares de propietarios
 * y los unifica bajo un único nombre estándar si la similitud supera el umbral ajustable (80% - 85%, default 82%).
 */
export async function runFuzzyOwnerUnification(threshold = 0.82): Promise<number> {
  console.log(`[FUZZY MATCHING] Iniciando validación y unificación lógica de propietarios (Umbral: ${Math.round(threshold * 100)}%)...`);
  let unifiedCount = 0;

  try {
    // 1. Obtener todos los nombres de demandados de subastas
    const auctionsRes = await db.execute(
      "SELECT auction_id, defendant, address FROM foreclosure_auctions WHERE defendant IS NOT NULL AND defendant != '' AND defendant != 'Unknown'"
    );

    // 2. Obtener nombres de dueños de violaciones de código
    const violationsRes = await db.execute(
      "SELECT violation_id, owner_name, address FROM code_violations WHERE owner_name IS NOT NULL AND owner_name != '' AND owner_name != 'DUEÑO DESCONOCIDO' AND owner_name != 'Unknown'"
    );

    const auctionOwners = auctionsRes.rows.map(row => ({
      id: row.auction_id as string,
      type: "auction",
      rawName: row.defendant as string,
      address: row.address as string
    }));

    const violationOwners = violationsRes.rows.map(row => ({
      id: row.violation_id as string,
      type: "violation",
      rawName: row.owner_name as string,
      address: row.address as string
    }));

    console.log(`[FUZZY MATCHING] Comparando ${auctionOwners.length} subastas con ${violationOwners.length} violaciones de código.`);

    // 3. Comparar y unificar
    for (const auction of auctionOwners) {
      for (const violation of violationOwners) {
        const similarity = calculateFuzzySimilarity(auction.rawName, violation.rawName);

        if (similarity >= threshold && auction.rawName !== violation.rawName) {
          console.log(`[FUZZY MATCH] Similitud del ${Math.round(similarity * 100)}% encontrada:`);
          console.log(`  - Subasta Defendant: "${auction.rawName}" (ID: ${auction.id})`);
          console.log(`  - Violación Owner: "${violation.rawName}" (ID: ${violation.id})`);

          // Unificamos usando el nombre de la subasta como el primario (generalmente más formal)
          const primaryName = auction.rawName.toUpperCase();

          console.log(`  -> Unificando a: "${primaryName}"`);

          // Actualizar en code_violations
          await db.execute({
            sql: "UPDATE code_violations SET owner_name = ? WHERE violation_id = ?",
            args: [primaryName, violation.id]
          });

          // Actualizar en foreclosure_auctions
          await db.execute({
            sql: "UPDATE foreclosure_auctions SET defendant = ? WHERE auction_id = ?",
            args: [primaryName, auction.id]
          });

          unifiedCount++;
        }
      }
    }

  } catch (error: any) {
    console.error("[FUZZY MATCHING ERROR] Falló la unificación difusa:", error.message);
  }

  console.log(`[FUZZY MATCHING] Unificación finalizada. Se unificaron ${unifiedCount} registros.`);
  return unifiedCount;
}

if (require.main === module) {
  runFuzzyOwnerUnification().catch(console.error);
}
