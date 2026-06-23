import { createClient } from "@libsql/client";
import { exec, spawn } from "child_process";
import * as crypto from "crypto";
import * as dotenv from "dotenv";
import { makeGotScrapingRequest } from "./scrapers/got_scraping_helper";
import * as cheerio from "cheerio";
import * as path from "path";
import * as fs from "fs";
import axios from "axios";

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

// Helper to generate a unique hash for pre-leads
function generateHash(address: string, source: string): string {
  const clean = address.toLowerCase().replace(/[^a-z0-9]/g, "");
  return crypto.createHash("sha256").update(`${clean}_${source}`).digest("hex");
}

/**
 * Compiles the Go Colly scraper.
 * Returns true if compilation succeeded, false otherwise (e.g. Go is not installed).
 */
export function compileGoScraper(): Promise<boolean> {
  return new Promise((resolve) => {
    console.log("[BRIDGE] Intentando compilar tzel_high_speed_scraper.go...");
    const cmd = "go build -o tzel_crawler tzel_high_speed_scraper.go";
    exec(cmd, { cwd: path.resolve("./") }, (err, stdout, stderr) => {
      if (err) {
        console.warn(
          "[BRIDGE WARNING] No se pudo compilar el scraper en Go (Go Compiler no detectado o error de build). El crawler se saltará en tiempo de ejecución. Error:",
          err.message
        );
        resolve(false);
      } else {
        console.log("[BRIDGE] Scraper de Go compilado exitosamente: tzel_crawler");
        resolve(true);
      }
    });
  });
}

/**
 * Helper to index unstructured text content in Hister
 */
export async function indexInHister(
  urlSource: string,
  titleSource: string,
  rawTextContent: string,
  countyName: string,
  stateName: string
): Promise<void> {
  try {
    const payload = {
      url: urlSource,
      title: titleSource,
      content: rawTextContent,
      metadata: {
        county: countyName,
        state: stateName,
        acquisition_type: "As-Is"
      }
    };

    console.log(`[HISTER] Intentando indexar URL: ${urlSource} en Hister...`);
    try {
      // Intentar primero en /api/index
      const res = await axios.post("http://localhost:5005/api/index", payload, {
        headers: { 
          "Content-Type": "application/json",
          "Origin": "hister://"
        },
        timeout: 5000
      });
      const contentType = res.headers["content-type"];
      if (typeof contentType === "string" && contentType.includes("text/html")) {
        throw new Error("404 (Redirected to SPA)");
      }
      console.log(`[HISTER SUCCESS] URL indexada exitosamente en /api/index: ${urlSource}`);
    } catch (apiErr: any) {
      // Fallback a /api/add si devuelve 404, error de ruta o redirección
      console.warn(`[HISTER WARN] /api/index no disponible o falló (${apiErr.message}). Reintentando con fallback a /api/add...`);
      const fallbackPayload = {
        url: urlSource,
        title: titleSource,
        text: rawTextContent,
        label: `${countyName}, ${stateName} (As-Is)`
      };
      const resAdd = await axios.post("http://localhost:5005/api/add", fallbackPayload, {
        headers: { 
          "Content-Type": "application/json",
          "Origin": "hister://"
        },
        timeout: 5000
      });
      const contentTypeAdd = resAdd.headers["content-type"];
      if (typeof contentTypeAdd === "string" && contentTypeAdd.includes("text/html")) {
        throw new Error("404 (Redirected to SPA on /api/add)");
      }
      console.log(`[HISTER SUCCESS] URL indexada exitosamente en /api/add: ${urlSource}`);
    }
  } catch (err: any) {
    console.warn(`[HISTER WARNING] No se pudo indexar el contenido en Hister: ${err.message}`);
  }
}

/**
 * Runs the Go scraper on a target URL or path and upserts leads into Turso.
 */
export async function runGoScraper(targetUrlOrPath: string): Promise<number> {
  // Check if binary exists, otherwise try compiling
  const binaryName = process.platform === "win32" ? "tzel_crawler.exe" : "tzel_crawler";
  const binaryPath = path.resolve(`./${binaryName}`);

  if (!fs.existsSync(binaryPath)) {
    const compiled = await compileGoScraper();
    if (!compiled) {
      console.log("[BRIDGE] Omitiendo ejecución del crawler de Go (falta binario de compilación).");
      return 0;
    }
  }

  return new Promise((resolve) => {
    console.log(`[BRIDGE] Iniciando tzel_crawler con objetivo: ${targetUrlOrPath}`);
    const crawler = spawn(binaryPath, [targetUrlOrPath]);

    let upsertedCount = 0;
    let buffer = "";

    crawler.stdout.on("data", async (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      // Keep the last partial line in buffer
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const item = JSON.parse(trimmed);
          if (item.address) {
            const preLeadId = generateHash(item.address, "Colly");
            await db.execute({
              sql: `
                INSERT INTO pre_leads (pre_lead_id, address, parcel_id, defendant, auction_date, source, status)
                VALUES (?, ?, ?, ?, ?, 'Colly', 'pending')
                ON CONFLICT(pre_lead_id) DO UPDATE SET
                  parcel_id = COALESCE(excluded.parcel_id, pre_leads.parcel_id),
                  defendant = COALESCE(excluded.defendant, pre_leads.defendant),
                  auction_date = COALESCE(excluded.auction_date, pre_leads.auction_date)
              `,
              args: [preLeadId, item.address, item.parcel_id || "", item.defendant || "", item.auction_date || ""]
            });
            upsertedCount++;
            console.log(`[COLLY BRIDGED] Lead upsertado en pre_leads: ${item.address}`);
          }
        } catch (e: any) {
          console.error("[BRIDGE ERROR] Error parseando línea JSON de Colly:", e.message);
        }
      }
    });

    crawler.stderr.on("data", (data) => {
      console.error(`[COLLY STDERR] ${data.toString().trim()}`);
    });

    crawler.on("close", async (code) => {
      console.log(`[BRIDGE] tzel_crawler finalizó con código: ${code}`);

      // Index the page in Hister asynchronously
      try {
        let content = "";
        let title = `Edictos Colly - ${targetUrlOrPath}`;
        if (targetUrlOrPath.startsWith("file://")) {
          const filePath = targetUrlOrPath.replace(/^file:\/\/\/?/, "").replace(/\//g, path.sep);
          if (fs.existsSync(filePath)) {
            content = fs.readFileSync(filePath, "utf-8");
            const $ = cheerio.load(content);
            title = $("title").text().trim() || path.basename(filePath);
            content = $("body").text().trim() || content;
          }
        } else {
          const response = await makeGotScrapingRequest(targetUrlOrPath);
          content = response.body;
          const $ = cheerio.load(content);
          title = $("title").text().trim() || targetUrlOrPath;
          content = $("body").text().trim() || content;
        }

        if (content) {
          let county = "Jefferson";
          let state = "KY";
          const lower = targetUrlOrPath.toLowerCase();
          if (lower.includes("clark")) { county = "Clark"; state = "IN"; }
          else if (lower.includes("floyd")) { county = "Floyd"; state = "IN"; }
          else if (lower.includes("oldham")) { county = "Oldham"; state = "KY"; }
          else if (lower.includes("bullitt")) { county = "Bullitt"; state = "KY"; }
          else if (lower.includes("shelby")) { county = "Shelby"; state = "KY"; }
          else if (lower.includes("harrison")) { county = "Harrison"; state = "IN"; }

          // Run asynchronously without blocking
          indexInHister(targetUrlOrPath, title, content, county, state).catch(err => {
            console.warn("[BRIDGE HISTER ERR]", err.message);
          });
        }
      } catch (err: any) {
        console.warn(`[BRIDGE HISTER WARN] Error al preparar contenido de Colly para Hister: ${err.message}`);
      }

      resolve(upsertedCount);
    });
  });
}

/**
 * Capa A: Google Dorking
 * Queries Google search results for local newspapers and extracts potential addresses/leads.
 */
export async function runGoogleDorking(county: string, state: string, site = "courier-journal.com"): Promise<number> {
  console.log(`[DORKING] Iniciando Google Dorking para ${county} County, ${state} (Sitio: ${site})...`);
  const query = `site:${site} "estate of" OR "sheriff sale" OR "delinquent tax" "${county}"`;
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

  let insertedCount = 0;

  try {
    const response = await makeGotScrapingRequest(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
      }
    });

    const $ = cheerio.load(response.body);

    // Index the search result page in Hister
    const dorkingTitle = `Google Dorking - ${county} County, ${state} (site:${site})`;
    const rawTextContent = $("body").text().trim() || response.body;
    indexInHister(url, dorkingTitle, rawTextContent, county, state).catch(err => {
      console.warn("[BRIDGE HISTER ERR]", err.message);
    });

    const streetReg = /\b\d{3,5}\s+[A-Za-z0-9\s#]+?\s+(?:St|Street|Ave|Avenue|Rd|Road|Ln|Lane|Way|Blvd|Boulevard|Cir|Circle|Ct|Court|Hwy|Highway|Dr|Drive|Trl|Trail)\b/i;

    // Search result snippets are typically in div.VwiC3b or span elements within search cards
    $("div.g, div.VwiC3b").each((_, el) => {
      const snippetText = $(el).text();
      const match = snippetText.match(streetReg);

      if (match) {
        const rawAddress = match[0].trim();
        // Construct a clean display address with county and state fallback
        const cleanAddress = `${rawAddress}, ${county}, ${state}`;

        // Attempt to parse a potential deceased or debtor name from nearby text
        let potentialDefendant = "Desconocido (Dorking)";
        const nameMatch = snippetText.match(/estate\s+of\s+([A-Za-z\s]+)/i) || 
                          snippetText.match(/vs\.?\s+([A-Za-z\s]+)/i) || 
                          snippetText.match(/recommends\s+([A-Za-z\s]+)/i);
        if (nameMatch && nameMatch[1]) {
          potentialDefendant = nameMatch[1].trim().split(/\s{2,}/)[0].substring(0, 40);
        }

        const preLeadId = generateHash(cleanAddress, "GoogleDorking");

        // Insert into pre_leads table
        db.execute({
          sql: `
            INSERT INTO pre_leads (pre_lead_id, address, parcel_id, defendant, auction_date, source, status)
            VALUES (?, ?, ?, ?, ?, 'GoogleDorking', 'pending')
            ON CONFLICT(pre_lead_id) DO NOTHING
          `,
          args: [preLeadId, cleanAddress, "", potentialDefendant, "", ""]
        }).then(() => {
          insertedCount++;
          console.log(`[DORKING SUCCESS] Lead de Dorking guardado: ${cleanAddress} (Sujeto: ${potentialDefendant})`);
        }).catch(err => {
          console.error("[DORKING DB ERROR] Falló inserción de dorking lead:", err.message);
        });
      }
    });

  } catch (err: any) {
    console.error("[DORKING ERROR] Falló la petición a Google Search:", err.message);
  }

  // Bounded wait for async inserts to complete
  await new Promise(r => setTimeout(r, 2000));
  return insertedCount;
}

// Running if invoked directly
if (require.main === module) {
  (async () => {
    await compileGoScraper();
    // Test Go Scraper on a mock/local page
    const fileTarget = `file:///${path.resolve("./floyd_table.html").replace(/\\/g, "/")}`;
    if (fs.existsSync(path.resolve("./floyd_table.html"))) {
      const collyCount = await runGoScraper(fileTarget);
      console.log(`[TEST] Colly scraped ${collyCount} leads.`);
    }
    const dorkCount = await runGoogleDorking("Jefferson", "KY", "courier-journal.com");
    console.log(`[TEST] Dorking discovered ${dorkCount} leads.`);
  })();
}
