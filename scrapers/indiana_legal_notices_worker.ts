import axios from "axios";
import * as cheerio from "cheerio";
import { db } from "../db";
import { analyzeCourtDocketWithGemini } from "./llm_underwriter";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Worker de Búsqueda y Auditoría de Avisos Legales Públicos de Indiana
 * Rastrea publicaciones de prensa local, avisos de subasta del Sheriff y edictos judiciales,
 * utilizando Gemini 3.1 Pro / 3.8 Flash para extraer sumas de juicios de venta.
 */
export async function runIndianaLegalNoticesWorker() {
  console.log("\n========================================================");
  console.log("📰 [INDIANA LEGAL NOTICES] Iniciando Escaneo de Avisos Públicos");
  console.log("========================================================\n");

  try {
    // 1. Obtener subastas de Indiana con deuda pendiente o revisión manual
    const pendingAuctions = await db.execute(`
      SELECT auction_id, address, county, state, case_number, defendant, plaintiff, auction_date
      FROM foreclosure_auctions
      WHERE state = 'IN' AND (debt_amount IS NULL OR debt_amount = 0)
      ORDER BY auction_date ASC
      LIMIT 20
    `);

    const rows = pendingAuctions.rows;
    console.log(`[INDIANA NOTICES] Se encontraron ${rows.length} propiedades de IN sin deuda confirmada.`);

    if (rows.length === 0) {
      console.log("[INDIANA NOTICES] No hay propiedades pendientes en este ciclo.");
      return;
    }

    let enrichedCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const auctionId = row.auction_id as string;
      const address = row.address as string;
      const county = row.county as string || "Indiana";
      const caseNum = row.case_number as string || "";
      const defendant = row.defendant as string || "";

      console.log(`\n--------------------------------------------------------`);
      console.log(`[AVISO ${i + 1}/${rows.length}] Analizando: "${address}" (${county} County)`);
      if (caseNum) console.log(`   Expediente: ${caseNum} | Deudor: ${defendant || "Desconocido"}`);

      // Búsqueda en DuckDuckGo Lite con consultas especializadas en avisos legales
      const cleanStreet = address.split(",")[0].trim();
      const queries = [];
      if (caseNum && caseNum !== "PENDING") {
        queries.push(`"${caseNum}" sheriff sale notice`);
      }
      queries.push(`"${cleanStreet}" ${county} sheriff sale Indiana`);
      queries.push(`"${cleanStreet}" notice of foreclosure sale`);

      let combinedText = "";

      for (const q of queries) {
        try {
          const ddgUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}`;
          const resp = await axios.get(ddgUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            },
            timeout: 10000
          });

          const $ = cheerio.load(resp.data);
          const snippets: string[] = [];

          // Extraer snippets de resultados de DDG Lite
          $(".result-snippet").each((_, el) => {
            snippets.push($(el).text().trim());
          });

          $("td.result-snippet").each((_, el) => {
            snippets.push($(el).text().trim());
          });

          // También extraer enlaces a periódicos de avisos judiciales para escaneo directo
          const links: string[] = [];
          $("a.result-link, a").each((_, el) => {
            const href = $(el).attr("href");
            if (href && (href.includes("indianapublicnotices.com") || href.includes("publicnotice") || href.includes("news") || href.includes("legal") || href.includes("sriservices"))) {
              links.push(href);
            }
          });

          combinedText += " " + snippets.join(" \n ");

          // Si encontramos un enlace a un aviso legal específico, descargar su contenido
          if (links.length > 0) {
            const targetLink = links[0];
            try {
              const pageResp = await axios.get(targetLink, {
                headers: { "User-Agent": "Mozilla/5.0" },
                timeout: 8000
              });
              const page$ = cheerio.load(pageResp.data);
              page$("script, style, nav, footer, header").remove();
              const textContent = page$("body").text().replace(/\s+/g, " ");
              if (textContent.length > 100) {
                combinedText += "\n\n--- CONTENIDO DE AVISO LEGAL ---\n" + textContent.slice(0, 8000);
              }
            } catch (linkErr) {}
          }

          if (combinedText.length > 300) break; // ya tenemos suficiente contexto
        } catch (searchErr: any) {
          console.warn(`   [DDG WARNING] Búsqueda falló para query "${q}": ${searchErr.message}`);
        }

        await sleep(1200); // cortesía de rate limit
      }

      if (combinedText.trim().length < 50) {
        console.log(`   [SKIP] No se encontraron avisos públicos en prensa para esta propiedad.`);
        continue;
      }

      console.log(`   [LLM AUDIT] Analizando ${combinedText.length} caracteres de avisos públicos con Gemini...`);
      const analysis = await analyzeCourtDocketWithGemini(combinedText);

      if (analysis.debtAmount && analysis.debtAmount > 0) {
        console.log(`   🎉 [¡ÉXITO!] Deuda extraída de aviso público: $${analysis.debtAmount.toLocaleString()} | Acreedor: ${analysis.plaintiff || "N/A"}`);
        
        await db.execute({
          sql: `
            UPDATE foreclosure_auctions SET
              debt_amount = ?,
              plaintiff = COALESCE(?, plaintiff),
              defendant = COALESCE(?, defendant),
              needs_manual_review = 0
            WHERE auction_id = ?
          `,
          args: [
            analysis.debtAmount,
            analysis.plaintiff,
            analysis.defendant,
            auctionId
          ]
        });

        enrichedCount++;
      } else {
        console.log(`   [RESULTADO] ${analysis.reason || "Sin mención explícita de monto líquido en el texto del aviso."}`);
      }
    }

    console.log(`\n========================================================`);
    console.log(`✅ [INDIANA NOTICES COMPLETADO] ${enrichedCount} subastas enriquecidas con deuda.`);
    console.log(`========================================================\n`);

  } catch (err: any) {
    console.error("[INDIANA NOTICES FATAL ERROR]:", err.message);
  }
}

if (typeof require !== "undefined" && require.main === module) {
  runIndianaLegalNoticesWorker().catch(console.error);
} else if (process.argv[1] && process.argv[1].includes("indiana_legal_notices_worker")) {
  runIndianaLegalNoticesWorker().catch(console.error);
}
