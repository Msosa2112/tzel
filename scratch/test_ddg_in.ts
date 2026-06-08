import axios from "axios";
import * as cheerio from "cheerio";

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

async function searchCaseAndParties(address: string, county: string) {
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
          console.log(`[ÉXITO LINK] Encontrado en ${link}`);
          break;
        }
      } catch (err: any) {
        // Silencioso
      }
    }

    return { caseNumber, plaintiff, defendant };
  } catch (err: any) {
    console.error(`[ERROR] ${err.message}`);
  }
  return { caseNumber: null, plaintiff: null, defendant: null };
}

async function runTest() {
  const testCases = [
    { address: "2714 MIDDLE RD, JEFFERSONVILLE", county: "Clark" },
    { address: "6559 ASHLEY SPRINGS CT, CHARLESTOWN", county: "Clark" },
    { address: "1708 LYNCH LANE, CLARKSVILLE", county: "Clark" },
    { address: "11527 INDEPENDENCE WAY, SELLERSBURG", county: "Clark" }
  ];

  for (const tc of testCases) {
    console.log("\n========================================");
    console.log(`Buscando para: ${tc.address}`);
    const res = await searchCaseAndParties(tc.address, tc.county);
    console.log(`RESULTADO: Case=${res.caseNumber} | Plaintiff=${res.plaintiff} | Defendant=${res.defendant}`);
    await new Promise(r => setTimeout(r, 2000));
  }
}

runTest();
