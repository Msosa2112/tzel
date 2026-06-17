import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import axios from "axios";
import { calculateRehab, calculateMAO } from "../underwriting/underwriter";

dotenv.config();

// Inicializar cliente de Turso DB
const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

const NOISE_WORDS = new Set([
  "st", "street", "ave", "avenue", "rd", "road", "ln", "lane", "dr", "drive", 
  "ct", "court", "blvd", "boulevard", "way", "pl", "place", "hwy", "highway", 
  "rte", "route", "cir", "circle", "ter", "terrace", "trl", "trail", "pkwy", "parkway",
  "apt", "apartment", "unit", "ste", "suite", "fl", "floor", 
  "n", "north", "s", "south", "e", "east", "w", "west", 
  "ky", "in", "jefferson", "clark", "floyd"
]);

const UNIT_INDICATORS = ["apt", "unit", "ste", "suite", "#", "apartment"];

function parseAddress(address: string): { houseNumber: string | null; coreWords: string[] } {
  let part1 = address.split(",")[0].trim().toLowerCase();
  
  for (const indicator of UNIT_INDICATORS) {
    const idx = part1.indexOf(indicator);
    if (idx !== -1) {
      part1 = part1.substring(0, idx).trim();
    }
  }
  
  part1 = part1.replace(/[^a-z0-9\s]/g, " ");
  
  const words = part1.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) {
    return { houseNumber: null, coreWords: [] };
  }
  
  let houseNumber: string | null = null;
  let streetStartIndex = 0;
  
  if (/^\d+/.test(words[0])) {
    houseNumber = words[0];
    streetStartIndex = 1;
  }
  
  const coreWords: string[] = [];
  for (let i = streetStartIndex; i < words.length; i++) {
    const w = words[i];
    if (NOISE_WORDS.has(w)) continue;
    if (/^\d{5}$/.test(w)) continue;
    coreWords.push(w);
  }
  
  return { houseNumber, coreWords };
}

function getGroupingKey(address: string): string {
  const parsed = parseAddress(address);
  if (!parsed.houseNumber) {
    return address.toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  return `${parsed.houseNumber}_${parsed.coreWords.join("_")}`;
}

export function getDaysRemaining(dateStr: string): number | null {
  if (!dateStr) return null;
  try {
    let cleanDate = dateStr.toLowerCase().replace(/\s+/g, " ").trim();
    const months: { [key: string]: number } = {
      jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
      apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
      aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
      nov: 10, november: 10, dec: 11, december: 11
    };
    
    let dateObj: Date | null = null;
    
    if (/^\d+\/\d+\/\d+$/.test(cleanDate)) {
      const [m, d, y] = cleanDate.split("/").map(Number);
      dateObj = new Date(y, m - 1, d);
    }
    else if (cleanDate.includes("/")) {
      const parts = cleanDate.split("/");
      const monthName = parts[0].trim();
      const dayAndYear = parts[1].trim();
      const dayYearParts = dayAndYear.split(" ");
      const day = parseInt(dayYearParts[0]);
      const year = parseInt(dayYearParts[1] || "2026");
      
      if (months[monthName] !== undefined && !isNaN(day)) {
        dateObj = new Date(year, months[monthName], day);
      }
    }
    else if (/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
      const [y, m, d] = cleanDate.split("-").map(Number);
      dateObj = new Date(y, m - 1, d);
    }
    else {
      cleanDate = cleanDate.replace(/,/g, "");
      const parts = cleanDate.split(" ");
      if (parts.length >= 3) {
        const monthName = parts[0];
        const day = parseInt(parts[1]);
        const year = parseInt(parts[2]);
        if (months[monthName] !== undefined && !isNaN(day) && !isNaN(year)) {
          dateObj = new Date(year, months[monthName], day);
        }
      }
    }
    
    if (dateObj && !isNaN(dateObj.getTime())) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      dateObj.setHours(0, 0, 0, 0);
      const diffTime = dateObj.getTime() - today.getTime();
      return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }
  } catch (e) {
    // Falla silenciosa
  }
  return null;
}

function getFirstPhone(phoneField: string | null): string {
  if (!phoneField) return "No disponible";
  const phones = phoneField.split(/,\s*|;\s*/).map(p => p.trim()).filter(Boolean);
  for (const phone of phones) {
    const clean = phone.replace(/osint:/i, "").trim();
    if (clean) return clean;
  }
  return "No disponible";
}

async function sendTelegramAlert(score: number, county: string, phone: string, mao: number, photoUrl: string | null) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log("[TELEGRAM] Credenciales no configuradas para alerta SSI.");
    return;
  }
  
  const formattedMao = mao > 0 ? `$${Math.round(mao).toLocaleString()}` : "N/D";
  const message = `🔥 *[ALERTA SSI: ${score}/100]* OBJETIVO TÁCTICO EN ${county.toUpperCase()}. *MAO:* ${formattedMao}. Estrés extremo y contacto disponible. Llama AHORA: ${phone}.`;
  
  try {
    if (photoUrl) {
      const url = `https://api.telegram.org/bot${token}/sendPhoto`;
      const response = await axios.post(url, {
        chat_id: chatId,
        photo: photoUrl,
        caption: message,
        parse_mode: "Markdown"
      }, { timeout: 10000 });
      
      if (response.status === 200) {
        console.log(`[TELEGRAM SSI PHOTO SUCCESS] Alerta con foto enviada para condado ${county} con SSI ${score}`);
        return;
      }
    }
  } catch (err: any) {
    console.warn(`[TELEGRAM SSI PHOTO WARNING] No se pudo enviar foto, enviando solo texto: ${err.message}`);
  }
  
  // Fallback a mensaje de texto
  const urlText = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const response = await axios.post(urlText, {
      chat_id: chatId,
      text: message,
      parse_mode: "Markdown",
      disable_web_page_preview: true
    }, { timeout: 10000 });
    if (response.status === 200) {
      console.log(`[TELEGRAM SSI TEXT SUCCESS] Alerta de texto enviada para condado ${county} con SSI ${score}`);
    }
  } catch (err: any) {
    console.error(`[TELEGRAM SSI ERROR] Falló el envío de alerta de texto: ${err.message}`);
  }
}

const idColumns: Record<string, string> = {
  foreclosure_auctions: "auction_id",
  code_violations: "violation_id",
  physical_distress: "distress_id",
  financial_distress: "record_id",
  life_events: "event_id"
};

export async function scoreAllProperties() {
  console.log("\n========================================================");
  console.log("🔥 [SSI] Iniciando Motor de Índice de Puntuación de Estrés (SSI) 🔥");
  console.log("========================================================\n");

  // 1. Cargar todas las violaciones de código para cruzar por dirección
  const codeViolationsKeys = new Set<string>();
  try {
    const violationsRes = await db.execute("SELECT address FROM code_violations");
    violationsRes.rows.forEach(r => {
      if (r.address) {
        codeViolationsKeys.add(getGroupingKey(r.address as string));
      }
    });
    console.log(`[SSI] Se cargaron ${codeViolationsKeys.size} direcciones con violaciones de código.`);
  } catch (e: any) {
    console.error("[SSI ERROR] Error al cargar violaciones de código para cruce:", e.message);
  }

  // 2. Procesar las 5 tablas principales de propiedades
  const tablesToScore = [
    { name: "foreclosure_auctions", idCol: "auction_id" },
    { name: "code_violations", idCol: "violation_id" },
    { name: "physical_distress", idCol: "distress_id" },
    { name: "financial_distress", idCol: "record_id" },
    { name: "life_events", idCol: "event_id" }
  ];

  for (const tableInfo of tablesToScore) {
    try {
      console.log(`[SSI] Evaluando tabla: ${tableInfo.name}...`);
      
      // Consultar todos los campos necesarios.
      // Ya que no todas las tablas tienen "county" o "state" o "auction_date", armamos la query condicionalmente.
      const hasCounty = tableInfo.name !== "code_violations";
      const hasAuctionDate = tableInfo.name === "foreclosure_auctions";
      const hasViolationType = tableInfo.name === "code_violations";
      const hasDistressType = tableInfo.name === "physical_distress";

      const columnsToSelect = [
        tableInfo.idCol,
        "address",
        "mls_estimated_value",
        "hidden_mortgages",
        "hidden_liens_amount",
        "is_high_yield",
        "sqft",
        "defendant_phones",
        "defendant_emails",
        "telegram_ssi_sent",
        "photo_urls"
      ];

      if (hasCounty) {
        columnsToSelect.push("county", "state");
      }
      if (hasAuctionDate) {
        columnsToSelect.push("auction_date");
      }
      if (hasViolationType) {
        columnsToSelect.push("violation_type");
      }
      if (hasDistressType) {
        columnsToSelect.push("distress_type");
      }

      const query = `SELECT ${columnsToSelect.join(", ")} FROM ${tableInfo.name}`;
      const recordsRes = await db.execute(query);
      console.log(`[SSI] Se encontraron ${recordsRes.rows.length} registros en ${tableInfo.name}.`);

      let tableAlertsCount = 0;
      for (const row of recordsRes.rows) {
        const idVal = row[tableInfo.idCol] as string;
        const address = row.address as string || "";
        const groupKey = getGroupingKey(address);
        
        // Comprobar si hay violación de código para esta dirección
        const hasCodeViolationMatch = codeViolationsKeys.has(groupKey);

        // Armar un objeto con valores unificados
        const unifiedRow = {
          county: hasCounty ? (row.county as string || "") : "Jefferson",
          state: hasCounty ? (row.state as string || "") : "KY",
          auction_date: hasAuctionDate ? (row.auction_date as string || "") : "",
          mls_estimated_value: row.mls_estimated_value as number || 0,
          hidden_mortgages: row.hidden_mortgages as number || 0,
          hidden_liens_amount: row.hidden_liens_amount as number || 0,
          is_high_yield: row.is_high_yield as number || 0,
          sqft: row.sqft as number || 0,
          defendant_phones: row.defendant_phones as string || "",
          defendant_emails: row.defendant_emails as string || "",
          violation_type: hasViolationType ? (row.violation_type as string || "") : "",
          distress_type: hasDistressType ? (row.distress_type as string || "") : "",
          photo_urls: row.photo_urls as string || ""
        };

        // Calcular SSI
        let ssiScore = 0;

        // Peso 1: Presión de Tiempo (+35 pts)
        if (unifiedRow.auction_date) {
          const daysRemaining = getDaysRemaining(unifiedRow.auction_date);
          if (daysRemaining !== null && daysRemaining >= 0 && daysRemaining < 30) {
            ssiScore += 35;
          }
        }

        // Peso 2: Rentabilidad/Ubicación (+25 pts)
        const countyClean = unifiedRow.county.toLowerCase().trim();
        const isNewCounty = ["harrison", "oldham", "henry", "trimble", "shelby", "bullitt"].includes(countyClean);

        const hiddenDebt = unifiedRow.hidden_mortgages + unifiedRow.hidden_liens_amount;
        let violationKeywords: string[] = [];
        if (unifiedRow.violation_type) violationKeywords.push(unifiedRow.violation_type);
        if (unifiedRow.distress_type) violationKeywords.push(unifiedRow.distress_type);

        const rehab = calculateRehab(unifiedRow.sqft || null, violationKeywords);
        const mao = calculateMAO(unifiedRow.mls_estimated_value, rehab, unifiedRow.hidden_mortgages, unifiedRow.hidden_liens_amount);

        const isHighYield = unifiedRow.is_high_yield === 1;
        const hasSubstantialMargin = isHighYield || (unifiedRow.mls_estimated_value > 0 && mao > 0 && (unifiedRow.mls_estimated_value - mao) > 0);

        if (isNewCounty || hasSubstantialMargin) {
          ssiScore += 25;
        }

        // Peso 3: Estrés Físico/Financiero (+20 pts)
        const hasHiddenLiens = (unifiedRow.hidden_liens_amount > 0 || unifiedRow.hidden_mortgages > 0);
        const isLinkedToCodeViolations = (tableInfo.name === "code_violations") || hasCodeViolationMatch;

        if (hasHiddenLiens || isLinkedToCodeViolations) {
          ssiScore += 20;
        }

        // Peso 4: Acción Inmediata (+20 pts)
        const phonesStr = unifiedRow.defendant_phones;
        const emailsStr = unifiedRow.defendant_emails;
        const hasOSINTContact = phonesStr.toLowerCase().includes("osint") || emailsStr.toLowerCase().includes("osint");

        if (hasOSINTContact) {
          ssiScore += 20;
        }

        const finalScore = Math.min(100, ssiScore);
        const prevTelegramSsiSent = row.telegram_ssi_sent as number || 0;
        let newTelegramSsiSent = prevTelegramSsiSent;

        // Disparar Alerta SSI de Telegram si alcanza >= 80 y no se ha notificado SSI aún
        if (finalScore >= 80 && prevTelegramSsiSent === 0) {
          console.log(`[ALERT SSI TRIGGER] Propiedad ${address} alcanzó SSI ${finalScore}/100!`);
          
          let firstPhoto: string | null = null;
          if (unifiedRow.photo_urls) {
            try {
              const parsed = JSON.parse(unifiedRow.photo_urls);
              if (Array.isArray(parsed) && parsed.length > 0) {
                firstPhoto = parsed[0];
              }
            } catch (e) {}
          }
          
          const phone = getFirstPhone(unifiedRow.defendant_phones);
          await sendTelegramAlert(finalScore, unifiedRow.county, phone, mao, firstPhoto);
          newTelegramSsiSent = 1;
          tableAlertsCount++;
          // Cortesía para no saturar la API
          await new Promise(resolve => setTimeout(resolve, 350));
        }

        // Guardar el score en el registro
        await db.execute({
          sql: `UPDATE ${tableInfo.name} SET stress_score = ?, telegram_ssi_sent = ? WHERE ${tableInfo.idCol} = ?`,
          args: [finalScore, newTelegramSsiSent, idVal]
        });
      }
      
      console.log(`[SSI] Tabla ${tableInfo.name} finalizada. ${tableAlertsCount} alertas disparadas.`);
    } catch (err: any) {
      console.error(`[SSI ERROR] Falló la puntuación en tabla ${tableInfo.name}:`, err.message);
    }
  }

  // 3. Procesar clusters de portafolios (portfolio_clusters)
  try {
    console.log("[SSI] Evaluando portafolios (portfolio_clusters)...");
    const clustersRes = await db.execute("SELECT cluster_id, primary_owner_name, associated_properties, telegram_ssi_sent FROM portfolio_clusters");
    console.log(`[SSI] Se encontraron ${clustersRes.rows.length} portafolios para evaluar.`);

    let clusterAlertsCount = 0;

    for (const cluster of clustersRes.rows) {
      const clusterId = cluster.cluster_id as string;
      const assocStr = cluster.associated_properties as string;
      const prevTelegramSsiSent = cluster.telegram_ssi_sent as number || 0;

      let maxScore = 0;
      let clusterCounty = "Jefferson"; // default
      let clusterPhone = "No disponible";
      let clusterPhoto: string | null = null;
      let clusterMao = 0;

      if (assocStr) {
        try {
          const associated = JSON.parse(assocStr) as Array<{ id: string; table: string; address: string }>;
          for (const item of associated) {
            const idCol = idColumns[item.table];
            if (!idCol) continue;

            // Consultar el score, condado y teléfonos de la propiedad en su respectiva tabla
            const hasCountyCol = item.table !== "code_violations";
            const selectFields = ["stress_score", "defendant_phones", "photo_urls", "mls_estimated_value", "hidden_mortgages", "hidden_liens_amount", "sqft"];
            if (hasCountyCol) {
              selectFields.push("county");
            }

            const propRes = await db.execute({
              sql: `SELECT ${selectFields.join(", ")} FROM ${item.table} WHERE ${idCol} = ?`,
              args: [item.id]
            });

            if (propRes.rows.length > 0) {
              const propRow = propRes.rows[0];
              const pScore = propRow.stress_score as number || 0;
              if (pScore > maxScore) {
                maxScore = pScore;
                
                // Extraer foto
                if (propRow.photo_urls) {
                  try {
                    const parsed = JSON.parse(propRow.photo_urls as string);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                      clusterPhoto = parsed[0];
                    }
                  } catch (e) {}
                }
                
                // Calcular MAO
                const sqft = propRow.sqft as number || 0;
                const mlsVal = propRow.mls_estimated_value as number || 0;
                const hiddenMort = propRow.hidden_mortgages as number || 0;
                const hiddenLien = propRow.hidden_liens_amount as number || 0;
                const rehab = calculateRehab(sqft || null, []);
                clusterMao = calculateMAO(mlsVal, rehab, hiddenMort, hiddenLien);
              }
              if (hasCountyCol && propRow.county && (clusterCounty === "Jefferson" || clusterCounty === "Unknown")) {
                clusterCounty = propRow.county as string;
              }
              if (propRow.defendant_phones && clusterPhone === "No disponible") {
                clusterPhone = getFirstPhone(propRow.defendant_phones as string);
              }
            }
          }
        } catch (e) {
          console.error(`[SSI] Error al parsear propiedades asociadas del cluster ${clusterId}:`, e);
        }
      }

      let newTelegramSsiSent = prevTelegramSsiSent;

      // Disparar Alerta SSI de Telegram si alcanza >= 80 y no se ha notificado aún
      if (maxScore >= 80 && prevTelegramSsiSent === 0) {
        console.log(`[ALERT SSI TRIGGER] Portafolio ${cluster.primary_owner_name} alcanzó SSI ${maxScore}/100!`);
        await sendTelegramAlert(maxScore, clusterCounty, clusterPhone, clusterMao, clusterPhoto);
        newTelegramSsiSent = 1;
        clusterAlertsCount++;
        await new Promise(resolve => setTimeout(resolve, 350));
      }

      // Guardar el score en el cluster
      await db.execute({
        sql: "UPDATE portfolio_clusters SET stress_score = ?, telegram_ssi_sent = ? WHERE cluster_id = ?",
        args: [maxScore, newTelegramSsiSent, clusterId]
      });
    }

    console.log(`[SSI] Portafolios finalizados. ${clusterAlertsCount} alertas disparadas.`);
  } catch (err: any) {
    console.error("[SSI ERROR] Falló la puntuación en portfolio_clusters:", err.message);
  }

  console.log("\n========================================================");
  console.log("✅ [SSI] Motor de SSI Completado Correctamente ✅");
  console.log("========================================================\n");
}

// Ejecutar si se corre directamente
if (require.main === module) {
  scoreAllProperties().catch(console.error);
}
