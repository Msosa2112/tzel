import { chromium } from "playwright";
import * as path from "path";
import * as fs from "fs";

async function debugExtractPhone() {
  const PERSISTENT_DIR = path.join(__dirname, "../browser_profiles/chrome_user_session");
  
  console.log("🌐 Abriendo Chrome persistente...");
  const context = await chromium.launchPersistentContext(PERSISTENT_DIR, {
    headless: false, // Visible para ver exactamente qué carga
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"]
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  const url = "https://www.truepeoplesearch.com/results?streetaddress=808+BROOKLINE+AVE&citystatezip=Louisville%2C+KY";
  console.log(`🏠 Navegando a la dirección: ${url}`);

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  // 1. Extraer el enlace del primer residente
  const personUrl = await page.evaluate(() => {
    // Buscar enlaces /find/person/ o data-detail-link
    const a = document.querySelector("a[href*='/find/person/'], a[data-detail-link], .card-summary a.btn") as HTMLAnchorElement;
    if (a && a.href && !a.href.endsWith("#")) return a.href;
    
    const card = document.querySelector("[data-detail-link]");
    if (card) {
      const link = card.getAttribute("data-detail-link");
      if (link) return "https://www.truepeoplesearch.com" + link;
    }
    return "";
  });

  console.log(`🔗 Enlace de perfil encontrado: "${personUrl}"`);

  if (personUrl) {
    console.log(`👤 Navegando al perfil del residente...`);
    await page.goto(personUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);

    // Capturar captura de depuración
    await page.screenshot({ path: path.join(__dirname, "../browser_profiles/person_debug.png") });

    // 2. Extraer teléfonos
    const data = await page.evaluate(() => {
      const title = document.title;
      const body = document.body.innerText;

      // Buscar todos los números en formato de teléfono de EE.UU.
      const phoneRegex = /\(?\b[0-9]{3}\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4}\b/g;
      const matches = body.match(phoneRegex) || [];

      // Filtrar teléfonos no válidos
      const validPhones = Array.from(new Set(matches)).filter(p => 
        !p.includes("800-") && 
        !p.includes("888-") && 
        !p.includes("555-") &&
        !p.includes("877-")
      );

      // Buscar secciones de teléfono
      const phoneElements = Array.from(document.querySelectorAll("a[href*='/find/phone/'], a[data-link-to-more='phone'], span[itemprop='telephone'], .phone"));
      const structuredPhones = phoneElements.map(el => (el as HTMLElement).innerText.trim()).filter(Boolean);

      return {
        title,
        validPhones,
        structuredPhones,
        snippet: body.substring(0, 600).replace(/\s+/g, " ")
      };
    });

    console.log("\n=============================================================");
    console.log("🎉 RESULTADO DE LA EXTRACCIÓN DE TELÉFONO:");
    console.log("=============================================================");
    console.log("Título:", data.title);
    console.log("📱 Teléfonos Estructurados:", data.structuredPhones);
    console.log("📱 Teléfonos Extraídos de Texto:", data.validPhones);
    console.log("📄 Snippet:\n", data.snippet);
  } else {
    console.log("❌ No se encontró enlace de residente en la página de la dirección.");
  }

  await context.close();
}

debugExtractPhone().catch(console.error);
