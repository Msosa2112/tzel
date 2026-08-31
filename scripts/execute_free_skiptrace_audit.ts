import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";

dotenv.config();

chromium.use(stealthPlugin());

const url = "https://ddwyutisxymuvofkjhpz.supabase.co";
const serviceKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";
const sb = createClient(url, serviceKey);

export interface SkipAuditResult {
  leadId: string;
  address: string;
  previousName: string;
  foundName: string;
  foundPhone: string;
  allPhones: string[];
  status: "ENRICHED_PHONE" | "ENRICHED_NAME_ONLY" | "CAPTCHA_BLOCKED" | "NOT_FOUND";
}

async function runExecutionAudit() {
  console.log("=================================================================");
  console.log("🔍 AUDITORÍA Y EJECUCIÓN EN VIVO DE SKIP-TRACING OSINT GRATUITO 🔍");
  console.log("=================================================================\n");

  const { data: leads, error } = await sb
    .from("contacts")
    .select("*")
    .ilike("external_ref", "LEAD_%")
    .order("created_at", { ascending: false });

  if (error || !leads) {
    console.error("Error consultando Supabase:", error);
    return;
  }

  // Filtrar inmuebles con dirección que no tienen teléfono
  const targetLeads = leads.filter(l => 
    (!l.phone || l.phone.trim().length <= 5) &&
    l.address &&
    !l.address.startsWith("Grupo:") &&
    l.address.length > 5
  );

  console.log(`📋 Total de Inmuebles a Enriquecer: ${targetLeads.length}\n`);

  const userDataDir = path.join(__dirname, "../browser_profiles/skiptrace_profile");
  if (!fs.existsSync(userDataDir)) {
    fs.mkdirSync(userDataDir, { recursive: true });
  }

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"]
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 }
  });

  const page = await context.newPage();
  const results: SkipAuditResult[] = [];

  for (let i = 0; i < targetLeads.length; i++) {
    const lead = targetLeads[i];
    const street = lead.address.split(",")[0].trim();
    const city = lead.city || "Louisville";
    const state = lead.state || "KY";
    const cleanAddress = `${street}, ${city}, ${state}`;

    const tpsUrl = `https://www.truepeoplesearch.com/results?streetaddress=${encodeURIComponent(street)}&citystatezip=${encodeURIComponent(`${city}, ${state}`)}`;
    
    console.log(`[${i + 1}/${targetLeads.length}] 🏠 Consultando: ${cleanAddress}...`);

    let audit: SkipAuditResult = {
      leadId: lead.id,
      address: cleanAddress,
      previousName: `${lead.first_name || ''} ${lead.last_name || ''}`.trim(),
      foundName: "",
      foundPhone: "",
      allPhones: [],
      status: "NOT_FOUND"
    };

    try {
      await page.goto(tpsUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(2500);

      const pageData = await page.evaluate(() => {
        const title = document.title;
        const isBlocked = title.toLowerCase().includes("captcha") || title.toLowerCase().includes("access denied");

        const cards = Array.from(document.querySelectorAll(".card, .card-summary, div[data-detail-link]"));
        const residents: any[] = [];

        cards.forEach(c => {
          const h4 = c.querySelector(".h4, h4, .name");
          let name = h4 ? (h4 as HTMLElement).innerText.trim() : "";
          if (!name || name === "View Details") {
            const links = Array.from(c.querySelectorAll("a"));
            for (const a of links) {
              const t = a.innerText.trim();
              if (t && t !== "View Details" && !t.includes("Age") && !t.includes("Louisville") && t.length > 3) {
                name = t;
                break;
              }
            }
          }

          const phoneEls = Array.from(c.querySelectorAll("a[href*='/find/phone/'], span[itemprop='telephone'], .phone, a[href*='tel:']"));
          const phones = phoneEls.map(p => (p as HTMLElement).innerText.trim()).filter(Boolean);

          if (name && name !== "View Details") {
            residents.push({ name, phones });
          }
        });

        // Buscar teléfonos en todo el texto del documento
        const allText = document.body.innerText;
        const phoneMatches = allText.match(/\(?\b[0-9]{3}\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4}\b/g) || [];
        const cleanPhones = Array.from(new Set(phoneMatches)).filter(p => !p.includes("800-") && !p.includes("888-") && !p.includes("555-"));

        return {
          isBlocked,
          title,
          residents,
          cleanPhones
        };
      });

      if (pageData.isBlocked) {
        audit.status = "CAPTCHA_BLOCKED";
        console.log(`   ⚠️ Bloqueo de bot / Cloudflare en esta IP headless.`);
      } else if (pageData.residents.length > 0) {
        const mainResident = pageData.residents[0];
        audit.foundName = mainResident.name;
        if (mainResident.phones.length > 0) {
          audit.foundPhone = mainResident.phones[0];
          audit.allPhones = mainResident.phones;
          audit.status = "ENRICHED_PHONE";
        } else if (pageData.cleanPhones.length > 0) {
          audit.foundPhone = pageData.cleanPhones[0];
          audit.allPhones = pageData.cleanPhones;
          audit.status = "ENRICHED_PHONE";
        } else {
          audit.status = "ENRICHED_NAME_ONLY";
        }
        console.log(`   ✅ Encontrado: Dueño: "${audit.foundName}", Tel: "${audit.foundPhone || 'No listado en resumen'}"`);
      } else if (pageData.cleanPhones.length > 0) {
        audit.foundPhone = pageData.cleanPhones[0];
        audit.allPhones = pageData.cleanPhones;
        audit.status = "ENRICHED_PHONE";
        console.log(`   ✅ Teléfono extraído del texto: "${audit.foundPhone}"`);
      } else {
        console.log(`   ℹ️ Sin registros directos en este directorio.`);
      }

      // Guardar en Supabase si se encontró algo útil
      const updatePayload: any = {};
      if (audit.foundPhone) {
        updatePayload.phone = audit.foundPhone;
      }
      if (audit.foundName && audit.foundName.length > 3 && audit.foundName !== "Propietario Inmueble" && audit.foundName !== "View Details") {
        const parts = audit.foundName.split(" ");
        updatePayload.first_name = parts[0];
        updatePayload.last_name = parts.slice(1).join(" ") || "Propietario";
      }

      if (Object.keys(updatePayload).length > 0) {
        await sb.from("contacts").update(updatePayload).eq("id", lead.id);
      }

    } catch (err: any) {
      console.warn(`   ❌ Error: ${err.message}`);
    }

    results.push(audit);
    await page.waitForTimeout(1000);
  }

  await browser.close();

  // Guardar log de auditoría
  fs.writeFileSync(
    path.join(__dirname, "../AUDITORIA_SKIPTRACE_RESULTADOS.json"),
    JSON.stringify(results, null, 2),
    "utf-8"
  );

  console.log("\n=================================================================");
  console.log("📊 RESUMEN FINAL DE LA AUDITORÍA DE SKIP-TRACING:");
  console.log("=================================================================");
  console.log(`Total inmuebles procesados: ${results.length}`);
  console.log(`✅ Con Teléfono Encontrado y Guardado: ${results.filter(r => r.foundPhone).length}`);
  console.log(`👤 Con Nombre Real de Dueño Resuelto: ${results.filter(r => r.foundName).length}`);
  console.log(`⚠️ Bloqueados por Cloudflare Captcha (Headless): ${results.filter(r => r.status === "CAPTCHA_BLOCKED").length}`);
  console.log(`ℹ️ Sin registros automáticos inmediatos: ${results.filter(r => r.status === "NOT_FOUND").length}`);
}

runExecutionAudit().catch(console.error);
