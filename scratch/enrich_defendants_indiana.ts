import { createClient } from "@libsql/client";
import { chromium } from "playwright";
import axios from "axios";
import * as cheerio from "cheerio";
import * as dotenv from "dotenv";

dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || "",
  authToken: process.env.TURSO_AUTH_TOKEN || "",
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function cleanDefendant(name: string): string {
  if (!name) return "";
  let clean = name;
  clean = clean.replace(/\([^)]*\)/g, "");
  clean = clean.replace(/,?\s+et\.?\s*al\.?/gi, "");
  clean = clean.replace(/,?\s+etal/gi, "");
  clean = clean.replace(/,?\s+spouse\s+of\s+.*$/gi, "");
  clean = clean.replace(/,?\s+and\s+spouse.*$/gi, "");
  clean = clean.replace(/,?\s+husband\s+and\s+wife.*$/gi, "");
  clean = clean.replace(/,?\s+wife\s+of\s+.*$/gi, "");
  clean = clean.replace(/,?\s+husband\s+of\s+.*$/gi, "");
  clean = clean.replace(/,?\s+deceased/gi, "");
  clean = clean.replace(/,?\s+individually/gi, "");
  clean = clean.replace(/[\*\,\-\_\#\s]+$/, "");
  clean = clean.replace(/["']/g, "");
  return clean.replace(/\s+/g, " ").trim();
}

function extractParties(text: string): { plaintiff: string | null, defendant: string | null } {
  let plaintiff: string | null = null;
  let defendant: string | null = null;

  const cleanText = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ");

  // Patrón A: "Plaintiff: [texto] Defendant: [texto]"
  const patternA = /Plaintiff\s*:\s*([^]+?)\s*Defendant\s*:\s*([^]+?)(?=\b(?:Required|Required\s+me|Parcel|Commonly|Attorney|Scottie|Matthew|\n\s*\n|$))/i;
  const matchA = cleanText.match(patternA);
  if (matchA) {
    plaintiff = matchA[1].replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
    defendant = cleanDefendant(matchA[2].replace(/\n+/g, " ").replace(/\s+/g, " ").trim());
    return { plaintiff, defendant };
  }

  // Patrón B: "... wherein X was/is Plaintiff, and Y was/is Defendant ..."
  const patternB = /(?:wherein|where)\s+(.+?)\s+was\s+Plaintiff,?\s+(?:and|vs\.?)\s+(.+?)\s+(?:et\s+al\.?\s+)?(?:was\s+a\s+|was\s+the\s+|were\s+a\s+|were\s+the\s+|was\s+|were\s+)?Defendants?/i;
  const matchB = cleanText.match(patternB);
  if (matchB) {
    plaintiff = matchB[1].replace(/\n+/g, " ").replace(/\s+/g, " ").replace(/,\s*$/, "").trim();
    defendant = cleanDefendant(matchB[2].replace(/\n+/g, " ").replace(/\s+/g, " ").replace(/,\s*$/, "").trim());
    return { plaintiff, defendant };
  }

  // Patrón C: "... wherein X, Plaintiff, and Y, Defendant ..."
  const patternC = /(?:wherein|where)\s+(.+?),?\s+Plaintiff,?\s+(?:and|vs\.?)\s+(.+?),?\s+Defendants?/i;
  const matchC = cleanText.match(patternC);
  if (matchC) {
    plaintiff = matchC[1].replace(/\n+/g, " ").replace(/\s+/g, " ").replace(/,\s*$/, "").trim();
    defendant = cleanDefendant(matchC[2].replace(/\n+/g, " ").replace(/\s+/g, " ").replace(/,\s*$/, "").trim());
    return { plaintiff, defendant };
  }

  return { plaintiff, defendant };
}

async function searchCaseAndParties(address: string, county: string): Promise<{
  caseNumber: string | null;
  plaintiff: string | null;
  defendant: string | null;
}> {
  const cleanAddress = address.split(",")[0].trim();
  const query = `${cleanAddress} ${county} sheriff`;
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;

  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);
    const pageText = $("body").text();

    const caseRegex = /\b\d{2}[A-Z]\d{2}-\d{4}-[A-Z]{2}-\d{3,6}\b/gi;
    const matches = pageText.match(caseRegex);

    let caseNumber: string | null = null;
    let plaintiff: string | null = null;
    let defendant: string | null = null;

    if (matches && matches.length > 0) {
      caseNumber = Array.from(new Set(matches))[0] as string;
    }

    const resultUrls: string[] = [];
    $(".result-link").each((_, elem) => {
      const href = $(elem).attr("href");
      if (href) {
        const match = href.match(/[?&]uddg=([^&]+)/);
        if (match) {
          const decoded = decodeURIComponent(match[1]);
          if (decoded.startsWith("http") && !decoded.includes("duckduckgo.com")) {
            resultUrls.push(decoded);
          }
        }
      }
    });

    for (const link of resultUrls.slice(0, 3)) {
      try {
        const linkResponse = await axios.get(link, {
          headers: {
            "User-Agent": "Mozilla/5.0"
          },
          timeout: 8000
        });

        if (!caseNumber) {
          const linkMatches = linkResponse.data.match(caseRegex);
          if (linkMatches && linkMatches.length > 0) {
            caseNumber = Array.from(new Set(linkMatches))[0] as string;
          }
        }

        const cleanText = cheerio.load(linkResponse.data)("body").text();
        const parties = extractParties(cleanText);
        if (parties.defendant) {
          plaintiff = parties.plaintiff;
          defendant = parties.defendant;
          break;
        }
      } catch (err: any) {
        // Silencioso
      }
    }

    return { caseNumber, plaintiff, defendant };
  } catch (err: any) {
    console.error(`  [DDG ERROR] ${err.message}`);
  }
  return { caseNumber: null, plaintiff: null, defendant: null };
}

async function getCaseDetailsFromMyCase(caseNumber: string): Promise<{ debt: number | null; plaintiff: string | null; defendant: string | null } | null> {
  console.log(`  [MYCASE] Consultando caso: ${caseNumber}...`);
  
  const browser = await chromium.launch({
    headless: true,
  });
  
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 },
    locale: "en-US",
  });
  
  const page = await context.newPage();
  
  try {
    await page.goto("https://public.courts.in.gov/mycase/", { waitUntil: "networkidle", timeout: 20000 });
    
    const pageTitle = await page.title();
    if (pageTitle.includes("Attention Required") || pageTitle.includes("Cloudflare")) {
      throw new Error("Bloqueo de seguridad / Captcha de Cloudflare detectado.");
    }
    
    await page.waitForSelector("#SearchValue", { timeout: 10000 });
    await page.fill("#SearchValue", caseNumber);
    await page.click("#cmdSearch", { timeout: 5000 });
    
    await page.waitForNavigation({ waitUntil: "networkidle", timeout: 15000 }).catch(() => {});
    
    const bodyText = await page.innerText("body");
    if (bodyText.includes("No cases found") || bodyText.includes("0 Cases Found")) {
      console.log(`  [MYCASE] No encontrado: ${caseNumber}`);
      await browser.close();
      return null;
    }
    
    const caseLinkSelector = `a:has-text("${caseNumber}")`;
    await page.waitForSelector(caseLinkSelector, { timeout: 10000 });
    await page.click(caseLinkSelector);
    
    await page.waitForSelector(".case-header", { timeout: 15000 }).catch(() => {});
    const caseDetailsText = await page.innerText("body");
    
    let plaintiff: string | null = null;
    let defendant: string | null = null;
    
    const plaintiffMatch = caseDetailsText.match(/Plaintiff\s*\n*:\s*([^\n]+)/i) || caseDetailsText.match(/Plaintiff\s+Name\s*\n*:\s*([^\n]+)/i);
    const defendantMatch = caseDetailsText.match(/Defendant\s*\n*:\s*([^\n]+)/i) || caseDetailsText.match(/Defendant\s+Name\s*\n*:\s*([^\n]+)/i);
    
    if (plaintiffMatch) plaintiff = plaintiffMatch[1].trim();
    if (defendantMatch) defendant = defendantMatch[1].trim();
    
    let debt: number | null = null;
    const judgmentRegexes = [
      /Judgment\s+Amount\s*:\s*\$([0-9,]+(?:\.[0-9]{2})?)/i,
      /Judgment\s+in\s+favor\s+of\s+[^$]*\$([0-9,]+(?:\.[0-9]{2})?)/i,
      /Judgment\s+for\s+\$([0-9,]+(?:\.[0-9]{2})?)/i,
      /ordered\s+to\s+pay\s+\$([0-9,]+(?:\.[0-9]{2})?)/i,
      /Judgment\s+entered\s+[^$]*\$([0-9,]+(?:\.[0-9]{2})?)/i,
      /Principal\s*:\s*\$([0-9,]+(?:\.[0-9]{2})?)/i
    ];
    
    for (const regex of judgmentRegexes) {
      const match = caseDetailsText.match(regex);
      if (match) {
        const amountStr = match[1].replace(/,/g, "");
        const amount = parseFloat(amountStr);
        if (!isNaN(amount) && amount > 0) {
          debt = amount;
          break;
        }
      }
    }
    
    await browser.close();
    return { debt, plaintiff, defendant };
    
  } catch (err: any) {
    console.error(`  [MYCASE ERROR] ${err.message}`);
    await browser.close();
    return null;
  }
}

async function enrichDefendants() {
  console.log("=== INICIANDO ENRIQUECIMIENTO DE DEFENDANTS DE INDIANA ===");
  
  // Buscar subastas de Indiana con defendant NULL o 'No especificado'
  const auctionsRes = await db.execute(`
    SELECT auction_id, address, county, case_number, defendant
    FROM foreclosure_auctions
    WHERE state = 'IN' AND (defendant IS NULL OR defendant = 'No especificado' OR defendant = '')
  `);
  
  const auctions = auctionsRes.rows;
  console.log(`Se encontraron ${auctions.length} registros que requieren enriquecimiento.`);
  
  let successCount = 0;
  
  for (const row of auctions) {
    const auctionId = row.auction_id as string;
    const address = row.address as string;
    const county = row.county as string;
    let caseNumber = row.case_number as string;
    
    let extractedPlaintiff: string | null = null;
    let extractedDefendant: string | null = null;
    
    console.log(`\nProcesando subasta: "${address}" (ID: ${auctionId})`);
    
    // 1. Si el caso no se conoce (es PENDING o NULL), buscarlo
    if (!caseNumber || caseNumber === "PENDING") {
      const searchRes = await searchCaseAndParties(address, county);
      if (searchRes.caseNumber) {
        caseNumber = searchRes.caseNumber;
        extractedPlaintiff = searchRes.plaintiff;
        extractedDefendant = searchRes.defendant;
        
        await db.execute({
          sql: "UPDATE foreclosure_auctions SET case_number = ? WHERE auction_id = ?",
          args: [caseNumber, auctionId]
        });
      } else {
        console.log("  No se pudo encontrar el número de caso.");
        continue;
      }
    }
    
    // 2. Consultar MyCase con el número de caso
    const details = await getCaseDetailsFromMyCase(caseNumber);
    if (details && details.defendant) {
      console.log(`  -> Defendant encontrado en MyCase: "${details.defendant}"`);
      
      await db.execute({
        sql: `
          UPDATE foreclosure_auctions SET
            defendant = ?,
            plaintiff = COALESCE(?, plaintiff),
            debt_amount = COALESCE(?, debt_amount),
            needs_manual_review = 0
          WHERE auction_id = ?
        `,
        args: [
          details.defendant,
          details.plaintiff || null,
          details.debt || null,
          auctionId
        ]
      });
      successCount++;
    } else {
      console.log("  No se pudieron extraer detalles del caso en MyCase. Aplicando fallback de aviso web...");
      
      // Fallback a los datos del aviso web si no los buscamos antes
      if (!extractedDefendant) {
        const searchRes = await searchCaseAndParties(address, county);
        extractedPlaintiff = searchRes.plaintiff;
        extractedDefendant = searchRes.defendant;
      }
      
      if (extractedDefendant) {
        console.log(`  -> Defendant encontrado en Fallback de Aviso: "${extractedDefendant}"`);
        await db.execute({
          sql: `
            UPDATE foreclosure_auctions SET
              defendant = ?,
              plaintiff = COALESCE(?, plaintiff),
              needs_manual_review = 1
            WHERE auction_id = ?
          `,
          args: [
            extractedDefendant,
            extractedPlaintiff || null,
            auctionId
          ]
        });
        successCount++;
      } else {
        console.log("  Tampoco se pudo extraer defendant del aviso web.");
      }
    }
    
    await sleep(2000);
  }
  
  console.log(`\n=== PROCESO TERMINADO. Enriquecidos con éxito: ${successCount}/${auctions.length} ===`);
}

enrichDefendants().catch(console.error);
