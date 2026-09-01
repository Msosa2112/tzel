import { db } from "../../../db";
import { saveConstructionLead } from "../db_construction";
import { ConstructionLead } from "../types";
import { syncLeadToBarbaPro } from "../integrations/barbapro_bridge";
import { queryLojicArcGIS } from "../../../services/lojic_gis_client";
import { searchOSINTContacts } from "../../../intelligence/osint_scraper";
import { classifyPhone, isValidReachableUSPhone } from "../../../intelligence/phone_classifier";
import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config();

try {
  chromium.use(stealthPlugin());
} catch (e) {}

/**
 * Normaliza nombres de personas a "First Last" en Proper Case
 */
function normalizeName(name: string): string {
  if (!name) return "";
  const cleaned = name.trim();
  const isLLC = /\b(LLC|INC|CORP|LTD|HOLDINGS|PROPERTIES|GROUP|PARTNERS|CO|COMPANY)\b/i.test(cleaned);
  if (isLLC) {
    return cleaned.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.substring(1).toLowerCase());
  }

  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 2 && cleaned === cleaned.toUpperCase()) {
    // Formato "APELLIDO NOMBRE"
    const last = parts[0].charAt(0).toUpperCase() + parts[0].substring(1).toLowerCase();
    const first = parts[1].charAt(0).toUpperCase() + parts[1].substring(1).toLowerCase();
    return `${first} ${last}`;
  }

  return parts.map(w => w.charAt(0).toUpperCase() + w.substring(1).toLowerCase()).join(" ");
}

export async function runDeepAddressOwnerEnricher(limit: number = 30) {
  console.log("=================================================================");
  console.log("🚀 INICIANDO ENRIQUECIMIENTO PROFUNDO POR CRUCE DE DIRECCIONES");
  console.log("=================================================================\n");

  // 1. Obtener leads con nombre genérico y dirección de calle real
  const leadsRes = await db.execute(`
    SELECT lead_id, address, county, state, owner_name, owner_phones, owner_emails, category, trigger_event, estimated_project_value, source_portal, raw_details, permit_number
    FROM construction_leads 
    WHERE (owner_name LIKE '%Propietario%' 
       OR owner_name LIKE '%DUEÑO%' 
       OR owner_name LIKE '%DESCONOCIDO%'
       OR owner_name IS NULL 
       OR owner_name = ''
       OR owner_phones = '[]'
       OR owner_phones IS NULL)
      AND address NOT LIKE 'Comunidad%'
      AND address NOT LIKE 'Área%'
      AND address NOT LIKE 'Expediente%'
      AND address NOT LIKE 'Grupo%'
      AND address NOT LIKE 'Vecindario%'
  `);

  console.log(`📋 Total de inmuebles físicos pendientes de identificación: ${leadsRes.rows.length}`);
  const batch = leadsRes.rows.slice(0, limit);
  console.log(`🎯 Lote a procesar en esta ejecución: ${batch.length}\n`);

  if (batch.length === 0) {
    console.log("✅ Todos los inmuebles físicos ya tienen propietario identificado.");
    return;
  }

  // 2. Iniciar navegador Playwright Stealth con perfil persistente
  const PERSISTENT_DIR = path.join(__dirname, "../../../browser_profiles/chrome_user_session");
  if (!fs.existsSync(PERSISTENT_DIR)) {
    fs.mkdirSync(PERSISTENT_DIR, { recursive: true });
  }

  console.log("🌐 Conectando motor Playwright Stealth para cruce inverso...");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"]
  });

  const page = await browser.newPage({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 800 }
  });

  let enrichedCount = 0;

  for (let i = 0; i < batch.length; i++) {
    const row = batch[i];
    const rawAddr = String(row.address || "").trim();
    const street = rawAddr.split(",")[0].trim();
    const city = rawAddr.split(",")[1]?.trim() || "Louisville";
    const state = String(row.state || "KY");

    console.log(`\n[${i + 1}/${batch.length}] 🏠 Analizando inmueble: "${street}", ${city}, ${state}`);

    let resolvedName = "";
    let resolvedPhones: string[] = [];
    let resolvedEmails: string[] = [];

    // --- NIVEL 1: LOJIC GIS (Catastro Oficial) ---
    try {
      const lojic = await queryLojicArcGIS(street);
      if (lojic && lojic.ownerName && !lojic.ownerName.toLowerCase().includes("desconocido")) {
        resolvedName = normalizeName(lojic.ownerName);
        console.log(`  🏛️ [LOJIC CATASTRAL]: "${resolvedName}" (Absentee: ${lojic.isAbsentee ? "SÍ" : "NO"})`);
      }
    } catch (lojicErr: any) {
      console.warn(`  ⚠️ LOJIC: ${lojicErr.message}`);
    }

    // --- NIVEL 2: BÚSQUEDA INVERSA EN DIRECTORIOS RESIDENCIALES (TruePeopleSearch) ---
    if (!resolvedName || resolvedPhones.length === 0) {
      const tpsUrl = `https://www.truepeoplesearch.com/results?streetaddress=${encodeURIComponent(street)}&citystatezip=${encodeURIComponent(`${city}, ${state}`)}`;
      try {
        await page.goto(tpsUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
        await page.waitForTimeout(2000);

        const pageData = await page.evaluate(() => {
          const cards = Array.from(document.querySelectorAll(".card, .card-summary"));
          const list: { name: string; detailUrl: string; phones: string[] }[] = [];

          cards.forEach(card => {
            const h4 = card.querySelector(".h4, h4, .name, a[href*='/find/person/']");
            let name = h4 ? (h4 as HTMLElement).innerText.trim() : "";
            if (name && name !== "View Details" && !name.includes("Age")) {
              const a = card.querySelector("a[href*='/find/person/']") as HTMLAnchorElement;
              const detailUrl = a ? a.href : "";
              const phoneEls = Array.from(card.querySelectorAll("a[href*='/find/phone/'], .phone, span[itemprop='telephone']"));
              const phones = phoneEls.map(p => (p as HTMLElement).innerText.trim()).filter(Boolean);
              list.push({ name, detailUrl, phones });
            }
          });

          return list;
        });

        if (pageData.length > 0) {
          const top = pageData[0];
          if (!resolvedName && top.name) {
            resolvedName = normalizeName(top.name);
            console.log(`  🌐 [DIRECTORIO INVERSO RESIDENTE]: "${resolvedName}"`);
          }

          if (top.phones && top.phones.length > 0) {
            top.phones.forEach(p => {
              if (!resolvedPhones.includes(p)) resolvedPhones.push(p);
            });
          } else if (top.detailUrl) {
            // Abrir detalle para extraer números
            await page.goto(top.detailUrl, { waitUntil: "domcontentloaded", timeout: 12000 });
            await page.waitForTimeout(1500);

            const personPhones = await page.evaluate(() => {
              const matches = document.body.innerText.match(/\(?\b[0-9]{3}\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4}\b/g) || [];
              return Array.from(new Set(matches)).filter(m => !m.includes("800-") && !m.includes("888-") && !m.includes("555-"));
            });

            personPhones.forEach(p => {
              if (!resolvedPhones.includes(p)) resolvedPhones.push(p);
            });
          }
        }
      } catch (err: any) {
        console.warn(`  ⚠️ Reverse Lookup: ${err.message}`);
      }
    }

    // --- NIVEL 3: MOTOR OSINT MULTI-DIRECTORIO CON NOMBRE RESUELTO ---
    if (resolvedName && resolvedPhones.length === 0) {
      try {
        const osint = await searchOSINTContacts(resolvedName, street, state, city);
        if (osint) {
          if (osint.phones.length > 0) {
            osint.phones.forEach(p => {
              if (!resolvedPhones.includes(p)) resolvedPhones.push(p);
            });
          }
          if (osint.emails.length > 0) {
            osint.emails.forEach(e => {
              if (!resolvedEmails.includes(e)) resolvedEmails.push(e);
            });
          }
        }
      } catch {}
    }

    // --- ACTUALIZAR EN TURSO DB Y BARBAPRO CRM SI SE ENCONTRÓ INFORMACIÓN ---
    const validPhones = resolvedPhones.filter(isValidReachableUSPhone);
    if (resolvedName || validPhones.length > 0) {
      enrichedCount++;
      const classifiedPhones = validPhones.map(p => {
        const c = classifyPhone(p);
        return `${c.type === "MOBILE" ? "📱" : "☎️"} ${c.formatted || p}`;
      });

      console.log(`  🎉 [RESULTADO ENRIQUECIDO]:`);
      console.log(`     👤 Propietario: "${resolvedName || row.owner_name}"`);
      console.log(`     📞 Teléfonos: ${classifiedPhones.join(", ") || "No indexado"}`);

      // Actualizar en Turso DB
      const updatedLead: ConstructionLead = {
        leadId: String(row.lead_id),
        category: (row.category || "ROOFING_SIDING_GUTTERS") as any,
        triggerEvent: String(row.trigger_event || "CODE_VIOLATION_ROOF_DAMAGE") as any,
        address: rawAddr,
        county: String(row.county || "Jefferson"),
        state: String(row.state || "KY"),
        ownerName: resolvedName || String(row.owner_name),
        ownerPhones: classifiedPhones,
        ownerEmails: resolvedEmails,
        propertyType: "Residential",
        estimatedProjectValue: Number(row.estimated_project_value) || 14500,
        triggerDate: new Date().toISOString().split("T")[0],
        urgencyLevel: "HIGH",
        sourcePortal: String(row.source_portal || "Code Enforcement Enriched"),
        rawDetails: String(row.raw_details),
        permitNumber: String(row.permit_number || "")
      };

      await saveConstructionLead(updatedLead);

      // Sincronizar en BarbaPro CRM
      if (classifiedPhones.length > 0 || resolvedEmails.length > 0) {
        await syncLeadToBarbaPro(updatedLead);
      }
    }
  }

  await browser.close();

  console.log("\n=================================================================");
  console.log(`🎉 [BARRIDO FINALIZADO]: ${enrichedCount}/${batch.length} inmuebles enriquecidos con propietario y teléfonos.`);
  console.log("=================================================================");
}

if (require.main === module) {
  const limitArg = process.argv[2] ? parseInt(process.argv[2], 10) : 30;
  runDeepAddressOwnerEnricher(limitArg).catch(console.error);
}
