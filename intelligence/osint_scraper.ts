import { querySearXNG } from "../searxng_client";
import * as dotenv from "dotenv";
import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";

dotenv.config();

// Registrar el plugin de sigilo
try {
  chromium.use(stealthPlugin());
} catch (e) {
  // Evitar error si ya está registrado
}

export interface OSINTContactResult {
  phones: string[];
  emails: string[];
}

/**
 * Normalizes a phone number to (XXX) XXX-XXXX format.
 */
function normalizePhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  // Standard US phone number (10 digits)
  if (digits.length === 10) {
    const prefix = digits.slice(0, 3);
    const exchange = digits.slice(3, 6);
    if (["800", "888", "877", "866", "855", "844", "833"].includes(prefix)) {
      return null;
    }
    if (exchange === "555") {
      return null;
    }
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  // US phone number with country code 1 (11 digits)
  if (digits.length === 11 && digits.startsWith("1")) {
    const prefix = digits.slice(1, 4);
    const exchange = digits.slice(4, 7);
    if (["800", "888", "877", "866", "855", "844", "833"].includes(prefix)) {
      return null;
    }
    if (exchange === "555") {
      return null;
    }
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return null;
}

/**
 * Checks if a name is a corporate entity (LLC, Inc, etc.).
 */
function isLLC(name: string): boolean {
  const upper = name.toUpperCase();
  return upper.includes("LLC") || 
         upper.includes("INC") || 
         upper.includes("CORP") || 
         upper.includes("CO ") || 
         upper.includes("L.L.C.") || 
         upper.includes("PROPERTIES") || 
         upper.includes("TRUST") || 
         upper.includes("HOLDINGS") || 
         upper.includes("PARTNERS") || 
         upper.includes("GROUP");
}

/**
 * Navega a un enlace de directorio usando Playwright Stealth de manera silenciosa,
 * y extrae los teléfonos y correos desde el contenido de la página.
 */
async function scrapeDirectoryLink(url: string): Promise<{ phones: string[]; emails: string[] }> {
  let browser;
  try {
    console.log(`[OSINT DIRECTORY SCRAPER] Iniciando Playwright Stealth para: ${url}`);
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 }
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    
    // Esperar a que se asiente la carga y Cloudflare
    await page.waitForTimeout(3000);
    
    const pageText = await page.innerText("body").catch(() => "");
    const phoneRegex = /(?<!\d)(?:\+?1[-.\s]*)?\(?[2-9]\d{2}\)?[-.\s/]*\d{3}[-.\s/]*\d{4}(?!\d)/g;
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

    const phones: string[] = [];
    const emails: string[] = [];

    const phoneMatches = pageText.match(phoneRegex) || [];
    for (const match of phoneMatches) {
      const normalized = normalizePhone(match);
      if (normalized && !phones.includes(normalized)) {
        phones.push(normalized);
      }
    }

    const emailMatches = pageText.match(emailRegex) || [];
    for (const match of emailMatches) {
      const email = match.trim().toLowerCase();
      if (!email.endsWith(".png") && !email.endsWith(".jpg") && !email.endsWith(".gif") && !email.endsWith(".webp")) {
        if (!emails.includes(email) && !email.includes("bootstrap") && !email.includes("jquery")) {
          emails.push(email);
        }
      }
    }

    return { phones, emails };
  } catch (err: any) {
    console.warn(`[OSINT DIRECTORY SCRAPER WARNING] Error al raspar ${url}:`, err.message);
    return { phones: [], emails: [] };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }
  }
}

/**
 * Searches the web for public contact details of an individual or business entity.
 * Uses SearXNG as the search engine and extracts phone/email via regex.
 * Returns null if no high confidence results are found.
 */
export async function searchOSINTContacts(
  name: string,
  address?: string,
  state?: string,
  county?: string
): Promise<OSINTContactResult | null> {
  if (!name || name.toLowerCase() === "unknown" || name.toLowerCase() === "no especificado" || name.trim() === "") {
    return null;
  }

  const cleanName = name.trim();
  const stateVal = state || "KY";
  const city = address ? address.split(",")[1]?.trim() || county || "" : county || "";
  const zipMatches = address ? address.match(/\b\d{5}\b/g) : null;
  const zip = zipMatches ? zipMatches[zipMatches.length - 1] : "";
  const location = zip || city || stateVal;
  
  const streetPart = address ? address.split(",")[0].trim() : "";
  
  // Construir consultas dirigidas
  const queries: string[] = [];
  if (isLLC(cleanName)) {
    const stateName = stateVal === "KY" ? "Kentucky" : (stateVal === "IN" ? "Indiana" : stateVal);
    queries.push(`"${cleanName}" "${stateName}" (bizapedia OR opencorporates OR "secretary of state")`);
  } else {
    if (streetPart) {
      queries.push(`"${cleanName}" "${streetPart}" (site:fastpeoplesearch.com OR site:truepeoplesearch.com OR site:cyberbackgroundchecks.com)`);
    }
    queries.push(`"${cleanName}" "${location}" (site:fastpeoplesearch.com OR site:truepeoplesearch.com OR site:cyberbackgroundchecks.com OR site:whitepages.com)`);
    const cleanCity = city.replace(/\b(ky|in)\b/gi, "").replace(/\d+/g, "").trim();
    if (cleanCity) {
      queries.push(`"${cleanName}" "${cleanCity}, ${stateVal}" (site:fastpeoplesearch.com OR site:truepeoplesearch.com)`);
    }
  }

  const uniquePhones = new Set<string>();
  const uniqueEmails = new Set<string>();
  const directoryLinks: string[] = [];

  for (const q of queries) {
    try {
      console.log(`[OSINT ENGINE] Searching for "${cleanName}" with query: "${q}"`);
      const results = await querySearXNG(q);
      
      if (!results || results.length === 0) {
        continue;
      }

      const phoneRegex = /(?<!\d)(?:\+?1[-.\s]*)?\(?[2-9]\d{2}\)?[-.\s/]*\d{3}[-.\s/]*\d{4}(?!\d)/g;
      const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

      for (const result of results) {
        const textToScan = `${result.title || ""} ${result.content || ""} ${result.snippet || ""}`;
        
        // Buscar teléfonos en snippets
        const phoneMatches = textToScan.match(phoneRegex) || [];
        for (const match of phoneMatches) {
          const normalized = normalizePhone(match);
          if (normalized) {
            uniquePhones.add(normalized);
          }
        }

        // Buscar correos en snippets
        const emailMatches = textToScan.match(emailRegex) || [];
        for (const match of emailMatches) {
          const email = match.trim().toLowerCase();
          if (!email.endsWith(".png") && !email.endsWith(".jpg") && !email.endsWith(".gif") && !email.endsWith(".webp")) {
            uniqueEmails.add(email);
          }
        }

        // Extraer enlaces directos de perfiles para rasparlos
        const url = result.url;
        if (url && url.startsWith("http")) {
          const lowerUrl = url.toLowerCase();
          if (
            lowerUrl.includes("fastpeoplesearch.com") || 
            lowerUrl.includes("truepeoplesearch.com") || 
            lowerUrl.includes("cyberbackgroundchecks.com")
          ) {
            if (
              lowerUrl.includes("/find/person/") || 
              lowerUrl.includes("/name/") ||
              lowerUrl.includes("/people/") ||
              lowerUrl.includes("/address/")
            ) {
              directoryLinks.push(url);
            }
          }
        }
      }
    } catch (err: any) {
      console.error(`[OSINT ENGINE ERROR] Search failed for query "${q}":`, err.message);
    }
  }

  // Si encontramos enlaces de directorios públicos en los resultados, rasparlos en segundo plano
  const uniqueLinks = Array.from(new Set(directoryLinks)).slice(0, 2); // límite de 2 para evitar saturación
  for (const link of uniqueLinks) {
    try {
      const pageContacts = await scrapeDirectoryLink(link);
      for (const p of pageContacts.phones) {
        uniquePhones.add(p);
      }
      for (const e of pageContacts.emails) {
        uniqueEmails.add(e);
      }
    } catch (err: any) {
      console.warn(`[OSINT ENGINE WARNING] Failed to scrape directory link ${link}:`, err.message);
    }
  }

  const phones = Array.from(uniquePhones).slice(0, 5);
  const emails = Array.from(uniqueEmails).slice(0, 5);

  if (phones.length === 0 && emails.length === 0) {
    console.log(`[OSINT ENGINE] No valid contacts extracted for "${cleanName}"`);
    return null;
  }

  console.log(`[OSINT ENGINE SUCCESS] Extracted ${phones.length} phones and ${emails.length} emails for "${cleanName}"`);
  return {
    phones,
    emails
  };
}
