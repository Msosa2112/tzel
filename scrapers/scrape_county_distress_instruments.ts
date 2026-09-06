import * as cheerio from "cheerio";
import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";
import * as crypto from "crypto";

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

export interface DistressDoc {
  instnum: string;
  year: string;
  docType: string;
  fileDate: string;
  grantor: string;
  grantee: string;
  legalDesc: string;
  amount: number;
}

/**
 * Formatea una fecha para el formulario de Jefferson County Deeds (MM/DD/YYYY)
 */
function formatDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

/**
 * Extrae una dirección legible a partir de una descripción legal si está presente.
 */
function extractAddressFromLegal(legal: string): string | null {
  if (!legal || legal === "N/A" || legal.trim().length < 5) return null;

  // Buscar patrones comunes de direcciones urbanas (número + nombre de calle)
  const match = legal.match(/\b(\d{2,6}\s+[A-Z0-9\s\.\,\#\-]+(?:ST|STREET|AVE|AVENUE|RD|ROAD|DR|DRIVE|LN|LANE|CT|COURT|BLVD|BOULEVARD|WAY|CIR|CIRCLE|TRL|TRAIL|PKWY|PARKWAY|TPK|TURNPIKE))\b/i);
  if (match) {
    return match[1].replace(/\s+/g, " ").trim();
  }

  return null;
}

/**
 * Scraper de instrumentos de alto estrés registrados recientemente en la Oficina de Escrituras de Jefferson County.
 * Monitorea:
 * - MECHANICS LIEN (ML): Reformas fallidas / Obras impagas.
 * - AFFIDAVIT OF DESCENT (AFD): Herencias recientes sin testamento.
 * - BOARDING LIEN (BL): Tapiados de emergencia por la ciudad.
 * - CERT OF DELINQUENCY (COD): Deuda tributaria de varios años.
 * - JUDGMENT LIEN METRO (JUDM): Multas del municipio convertidas en gravamen.
 */
export async function scrapeCountyDistressInstruments(daysBack = 45): Promise<number> {
  console.log("=================================================================");
  console.log("📜 [COUNTY DEEDS DISTRESS] Consultando Instrumentos de Estrés en Jefferson Deeds...");
  console.log("=================================================================");

  const searchUrl = "https://search.jeffersondeeds.com/p6.php";

  const today = new Date();
  const pastDate = new Date();
  pastDate.setDate(today.getDate() - daysBack);

  const bDate = formatDate(pastDate);
  const eDate = formatDate(today);

  // Consultar en tandas de tipos de instrumentos
  const instrumentBatches = [
    { itype1: "ML", itype2: "BL", itype3: "AFD", label: "Mechanics Liens, Boarding Liens, Affidavits of Descent" },
    { itype1: "COD", itype2: "JUDM", itype3: "CL", label: "Delinquency Certs, Metro Judgments, City Liens" }
  ];

  let totalFound = 0;
  let savedCount = 0;

  for (const batch of instrumentBatches) {
    try {
      console.log(`[COUNTY DEEDS] Buscando lote: ${batch.label} (${bDate} - ${eDate})...`);

      const body = new URLSearchParams({
        searchtype: "ITYPE",
        cnum: "CNUM",
        itype1: batch.itype1,
        itype2: batch.itype2,
        itype3: batch.itype3,
        bDate,
        eDate,
        search: "Execute Search"
      });

      const res = await fetch(searchUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        },
        body: body.toString()
      });

      if (!res.ok) {
        console.warn(`[COUNTY DEEDS WARN] Falló búsqueda para lote ${batch.label}: HTTP ${res.status}`);
        continue;
      }

      const html = await res.text();
      const $ = cheerio.load(html);

      const links: string[] = [];
      $('a[href^="pdetail.php"]').each((_, el) => {
        const href = $(el).attr("href");
        if (href) links.push(href);
      });

      console.log(`[COUNTY DEEDS] Encontrados ${links.length} registros para ${batch.label}.`);
      totalFound += links.length;

      // Analizar hasta 25 documentos por lote para mantener rapidez
      const limit = Math.min(links.length, 25);
      for (let i = 0; i < limit; i++) {
        const docUrl = `https://search.jeffersondeeds.com/${links[i]}`;
        try {
          const docRes = await fetch(docUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
          });
          const docHtml = await docRes.text();
          const doc$ = cheerio.load(docHtml);

          const fullText = doc$("body").text().replace(/\s+/g, " ").trim();
          const docTypeMatch = fullText.match(/Doc Type:\s*([A-Z\s\.\/]+?)(?:Mort|Tax|Book|Page|IMAGE|$)/i);
          const docType = docTypeMatch ? docTypeMatch[1].trim() : "DISTRESS_LIEN";

          const fileDateMatch = fullText.match(/File Date:\s*([0-9\/]+)/i);
          const fileDate = fileDateMatch ? fileDateMatch[1].trim() : bDate;

          const grantors = doc$('textarea[name="GRANTORS"]').val()?.toString().replace(/\n+/g, ", ").trim() || "UNKNOWN";
          const grantees = doc$('textarea[name="GRANTEES"]').val()?.toString().replace(/\n+/g, ", ").trim() || "UNKNOWN";

          // Extraer descripción legal y posible dirección
          const legalDescMatch = fullText.match(/Legal Desc:\s*(.*?)(?:function|Link|Comment|$)/i);
          const legalDesc = legalDescMatch ? legalDescMatch[1].trim() : "";

          const parsedAddress = extractAddressFromLegal(legalDesc);
          const finalAddress = parsedAddress 
            ? `${parsedAddress}, Louisville, KY` 
            : `${grantors} Estate Property, Louisville, KY`;

          const amountMatch = fullText.match(/(?:Mort|Debt|Tax)\s*\$\s*([0-9,.]+)/i);
          const amount = amountMatch ? parseFloat(amountMatch[1].replace(/,/g, "")) || 0 : 0;

          // Generar ID único basado en el enlace del documento
          const instNumMatch = links[i].match(/instnum=([0-9]+)/);
          const instNum = instNumMatch ? instNumMatch[1] : crypto.createHash("md5").update(links[i]).digest("hex").slice(0, 12);
          const recordId = `FD_DEED_${instNum}`;

          const isProbate = /aff of descent|will|inherit/i.test(docType);
          const isHighYield = 1; // Direct distress lead

          await db.execute({
            sql: `
              INSERT INTO financial_distress (
                record_id, case_number, address, county, state, record_type,
                debt_amount, owner_name, plaintiff, report_date, mls_status,
                mls_estimated_value, is_high_yield
              ) VALUES (?, ?, ?, 'Jefferson', 'KY', ?, ?, ?, ?, ?, 'pending_check', 120000, ?)
              ON CONFLICT(record_id) DO UPDATE SET
                debt_amount = excluded.debt_amount,
                report_date = excluded.report_date,
                is_high_yield = excluded.is_high_yield
            `,
            args: [
              recordId,
              `INST-${instNum}`,
              finalAddress,
              docType,
              amount,
              grantors,
              grantees,
              fileDate,
              isHighYield
            ]
          });

          savedCount++;
        } catch (docErr: any) {
          console.warn(`  [COUNTY DEEDS WARN] Error al leer doc ${links[i]}: ${docErr.message}`);
        }
      }

    } catch (err: any) {
      console.error(`❌ [COUNTY DEEDS ERROR] Error en lote ${batch.label}:`, err.message);
    }
  }

  console.log(`✅ [COUNTY DEEDS] Guardados ${savedCount} registros de alto estrés en 'financial_distress'.`);
  return savedCount;
}

if (process.argv[1] && process.argv[1].includes("scrape_county_distress_instruments")) {
  scrapeCountyDistressInstruments()
    .then((c) => {
      console.log(`[TEST COUNTY DEEDS] Finalizado. Registros: ${c}`);
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
