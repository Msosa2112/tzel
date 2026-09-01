import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";

import { isValidReachableUSPhone } from "../../../intelligence/phone_classifier";

const url = "https://ddwyutisxymuvofkjhpz.supabase.co";
const serviceKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRkd3l1dGlzeHltdXZvZmtqaHB6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzA1MzM5NSwiZXhwIjoyMDkyNjI5Mzk1fQ.cJQgzQsy1TUa4Yk01qkBedrmM8HxYqnH3VqzVLKpUDY";
const sb = createClient(url, serviceKey);

/**
 * MOTOR DE SKIP-TRACING OSINT AUTOMATIZADO GRATUITO (COSTO $0.00 USD)
 * 
 * Extrae nombres de propietarios y números telefónicos móviles para inmuebles
 * con infracciones de código y requerimientos de obra sin consumir saldo de APIs de pago.
 */
export async function runFreeSkipTracer(limit: number = 20) {
  console.log("=================================================================");
  console.log("🚀 INICIANDO SKIP-TRACER OSINT GRATUITO (PLAYWRIGHT & DIRECTORIOS) 🚀");
  console.log("=================================================================\n");

  // 1. Obtener leads sin teléfono con dirección física
  const { data: leads, error } = await sb
    .from("contacts")
    .select("*")
    .ilike("external_ref", "LEAD_%")
    .order("created_at", { ascending: false });

  if (error || !leads) {
    console.error("❌ Error consultando Supabase:", error);
    return;
  }

  const pendingLeads = leads.filter(l => 
    (!l.phone || l.phone.trim().length <= 5) && 
    l.address && 
    !l.address.startsWith("Grupo:") &&
    l.address.length > 5
  ).slice(0, limit);

  console.log(`📋 Total de leads analizados: ${leads.length}`);
  console.log(`🎯 Inmuebles pendientes de enriquecimiento: ${pendingLeads.length} (Límite lote: ${limit})\n`);

  if (pendingLeads.length === 0) {
    console.log("✅ Todos los leads con dirección ya tienen teléfono o fueron procesados.");
    return;
  }

  const PERSISTENT_DIR = path.join(__dirname, "../../../browser_profiles/chrome_user_session");
  if (!fs.existsSync(PERSISTENT_DIR)) {
    fs.mkdirSync(PERSISTENT_DIR, { recursive: true });
  }

  console.log("🌐 Abriendo Google Chrome con tu perfil persistente en disco...");
  const context = await chromium.launchPersistentContext(PERSISTENT_DIR, {
    headless: false,
    channel: "chrome",
    viewport: { width: 1280, height: 800 },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check"
    ]
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  let enrichedCount = 0;

  for (let i = 0; i < pendingLeads.length; i++) {
    const lead = pendingLeads[i];
    const street = lead.address.split(",")[0].trim();
    const city = lead.city || "Louisville";
    const state = lead.state || "KY";

    console.log(`\n[${i + 1}/${pendingLeads.length}] 🏠 Procesando: "${street}", ${city}, ${state}`);

    const tpsUrl = `https://www.truepeoplesearch.com/results?streetaddress=${encodeURIComponent(street)}&citystatezip=${encodeURIComponent(`${city}, ${state}`)}`;
    
    try {
      await page.goto(tpsUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(2500);

      // Extraer datos del listado de residentes de la propiedad
      const pageData = await page.evaluate(() => {
        const title = document.title;
        const isBlocked = title.toLowerCase().includes("captcha") || title.toLowerCase().includes("access denied");

        const cards = Array.from(document.querySelectorAll(".card, .card-summary"));
        const candidates: any[] = [];

        cards.forEach(card => {
          const h4El = card.querySelector(".h4, h4, .name");
          let name = h4El ? (h4El as HTMLElement).innerText.trim() : "";
          if (!name || name === "View Details") {
            const allLinks = Array.from(card.querySelectorAll("a"));
            for (const a of allLinks) {
              const t = a.innerText.trim();
              if (t && t !== "View Details" && !t.includes("Age") && !t.includes("Louisville") && t.length > 3) {
                name = t;
                break;
              }
            }
          }
          
          const detailAnchor = card.querySelector("a[href*='/find/person/'], a[data-detail-link], a.btn") as HTMLAnchorElement;
          const attrLink = card.getAttribute("data-detail-link") || (detailAnchor ? detailAnchor.getAttribute("href") : "");
          let detailUrl = "";
          if (attrLink) {
            detailUrl = attrLink.startsWith("http") ? attrLink : `https://www.truepeoplesearch.com${attrLink}`;
          }

          const phoneEls = Array.from(card.querySelectorAll("a[href*='/find/phone/'], span[itemprop='telephone'], .phone, a[href*='tel:']"));
          const phones = phoneEls.map(p => (p as HTMLElement).innerText.trim()).filter(Boolean);

          if (name && name !== "View Details") {
            candidates.push({ name, detailUrl, phones });
          }
        });

        // Extraer teléfonos en texto libre
        const text = document.body.innerText;
        const phoneMatches = text.match(/\(?\b[0-9]{3}\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4}\b/g) || [];

        return {
          isBlocked,
          title,
          candidates,
          rawPhones: Array.from(new Set(phoneMatches)).filter(p => !p.includes("800-") && !p.includes("888-") && !p.includes("555-"))
        };
      });

      if (pageData.isBlocked) {
        console.log("⚠️ Verificación de seguridad detectada. Pausa de 3 segundos...");
        await page.waitForTimeout(3000);
      }

      let detectedName = "";
      let detectedPhone = "";

      if (pageData.candidates.length > 0) {
        const topCandidate = pageData.candidates[0];
        detectedName = topCandidate.name;
        if (topCandidate.phones.length > 0) {
          detectedPhone = topCandidate.phones[0];
        } else if (topCandidate.detailUrl) {
          try {
            console.log(`  🔎 Abriendo perfil de "${detectedName}" para extraer teléfonos directos...`);
            await page.goto(topCandidate.detailUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
            await page.waitForTimeout(2000);

            const personPhones = await page.evaluate(() => {
              const pLinks = Array.from(document.querySelectorAll("a[href*='/find/phone/'], span[itemprop='telephone'], a[data-link-to-more='phone'], .phone"));
              const pList: string[] = [];
              pLinks.forEach(l => {
                const t = (l as HTMLElement).innerText.trim();
                const m = t.match(/\(?\b[0-9]{3}\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4}\b/);
                if (m && !pList.includes(m[0])) pList.push(m[0]);
              });

              if (pList.length === 0) {
                const bText = document.body.innerText;
                const matches = bText.match(/\(?\b[0-9]{3}\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4}\b/g) || [];
                matches.forEach(m => {
                  if (!pList.includes(m) && !m.includes("800-") && !m.includes("888-") && !m.includes("555-")) {
                    pList.push(m);
                  }
                });
              }

              return pList;
            });

            if (personPhones.length > 0) {
              detectedPhone = personPhones[0];
              console.log(`  📱 Teléfonos encontrados en perfil: ${personPhones.join(", ")}`);
            }
          } catch (detErr: any) {
            console.warn(`  ⚠️ Error leyendo perfil detallado: ${detErr.message}`);
          }
        }
      }

      if (!detectedPhone && pageData.rawPhones.length > 0) {
        const validRaw = pageData.rawPhones.find(p => isValidReachableUSPhone(p));
        if (validRaw) detectedPhone = validRaw;
      }

      if (detectedPhone && !isValidReachableUSPhone(detectedPhone)) {
        detectedPhone = "";
      }

      if (detectedPhone || (detectedName && detectedName !== "Propietario")) {
        console.log(`  🎉 ¡ENCONTRADO! Dueño: "${detectedName || lead.first_name}", Tel: "${detectedPhone || 'Pendiente'}"`);
        
        const updatePayload: any = {};
        if (detectedPhone) updatePayload.phone = detectedPhone;
        if (detectedName && detectedName !== "Propietario" && detectedName !== "View Details") {
          const nameParts = detectedName.split(" ");
          updatePayload.first_name = nameParts[0] || lead.first_name;
          updatePayload.last_name = nameParts.slice(1).join(" ") || lead.last_name;
        }

        if (Object.keys(updatePayload).length > 0) {
          const { error: updateErr } = await sb
            .from("contacts")
            .update(updatePayload)
            .eq("id", lead.id);

          if (!updateErr) {
            enrichedCount++;
            console.log(`  💾 Guardado exitosamente en Supabase (ID: ${lead.id})`);
          }
        }
      } else {
        console.log(`  ℹ️ No se detectó teléfono válido inmediato para este inmueble.`);
      }

    } catch (err: any) {
      console.warn(`  ⚠️ Error navegando a ${street}:`, err.message);
    }

    // Espera humana aleatoria para evitar sobrecarga (1.5s - 3s)
    await page.waitForTimeout(1500 + Math.floor(Math.random() * 1500));
  }

  await context.close();

  console.log("\n=================================================================");
  console.log(`🏁 SKIP-TRACING COMPLETADO: ${enrichedCount} inmuebles enriquecidos exitosamente a $0.00 USD.`);
  console.log("=================================================================");
}

if (require.main === module) {
  const limitArg = process.argv[2] ? parseInt(process.argv[2], 10) : 20;
  runFreeSkipTracer(limitArg).catch(console.error);
}
