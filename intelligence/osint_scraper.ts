import { querySearXNG } from "../searxng_client";
import * as dotenv from "dotenv";

dotenv.config();

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
    // Filter out common toll-free prefix ranges
    const prefix = digits.slice(0, 3);
    if (["800", "888", "877", "866", "855", "844", "833"].includes(prefix)) {
      return null;
    }
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  // US phone number with country code 1 (11 digits)
  if (digits.length === 11 && digits.startsWith("1")) {
    const prefix = digits.slice(1, 4);
    if (["800", "888", "877", "866", "855", "844", "833"].includes(prefix)) {
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
  
  // Construct a specific query based on individual vs corporate
  let query = "";
  if (isLLC(cleanName)) {
    const stateName = stateVal === "KY" ? "Kentucky" : (stateVal === "IN" ? "Indiana" : stateVal);
    query = `"${cleanName}" "${stateName}" (bizapedia OR opencorporates OR "secretary of state")`;
  } else {
    query = `"${cleanName}" "${location}" (obituary OR divorce)`;
  }

  // Truncamiento estricto a 100 caracteres
  query = query.substring(0, 100);

  try {
    console.log(`[OSINT ENGINE] Searching for "${cleanName}" with query: "${query}"`);
    const results = await querySearXNG(query);
    
    if (!results || results.length === 0) {
      console.log(`[OSINT ENGINE] No search results returned from SearXNG for "${cleanName}"`);
      return null;
    }

    // Aggressive regex to match phone formats: (502) 555-0199, 502-555-0199, 502.555.0199, +1 502 555 0199
    const phoneRegex = /(?<!\d)(?:\+?1[-.\s]*)?\(?[2-9]\d{2}\)?[-.\s/]*\d{3}[-.\s/]*\d{4}(?!\d)/g;
    // Standard email regex
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

    const uniquePhones = new Set<string>();
    const uniqueEmails = new Set<string>();

    for (const result of results) {
      const textToScan = `${result.title || ""} ${result.content || ""} ${result.snippet || ""}`;
      
      // Match phone numbers
      const phoneMatches = textToScan.match(phoneRegex) || [];
      for (const match of phoneMatches) {
        const normalized = normalizePhone(match);
        if (normalized) {
          uniquePhones.add(normalized);
        }
      }

      // Match emails
      const emailMatches = textToScan.match(emailRegex) || [];
      for (const match of emailMatches) {
        const email = match.trim().toLowerCase();
        // Simple domain filtering to avoid common false positives (e.g. system files, png, icons)
        if (!email.endsWith(".png") && !email.endsWith(".jpg") && !email.endsWith(".gif") && !email.endsWith(".webp")) {
          uniqueEmails.add(email);
        }
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

  } catch (err: any) {
    console.error(`[OSINT ENGINE ERROR] Search failed for "${cleanName}":`, err.message);
    return null;
  }
}
