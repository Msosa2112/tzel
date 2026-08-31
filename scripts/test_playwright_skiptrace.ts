import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import * as path from "path";

chromium.use(stealthPlugin());

async function testFreeSkipTrace(street: string, city: string = "Louisville", state: string = "KY") {
  console.log(`🔎 Iniciando búsqueda OSINT gratuita para: ${street}, ${city}, ${state}`);

  const browser = await chromium.launch({
    headless: false, // Probemos con ventana visible o headless para ver protecciones
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-setuid-sandbox"
    ]
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 }
  });

  const page = await context.newPage();

  // Test 1: TruePeopleSearch
  const tpsUrl = `https://www.truepeoplesearch.com/results?streetaddress=${encodeURIComponent(street)}&citystatezip=${encodeURIComponent(`${city}, ${state}`)}`;
  console.log(`🌐 Navegando a TruePeopleSearch: ${tpsUrl}`);

  try {
    await page.goto(tpsUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(4000);

    const title = await page.title();
    console.log(`📄 Título de Página TPS: ${title}`);

    // Extraer nombres y teléfonos
    const results = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".card, .card-summary, div[data-detail-link]"));
      const extracted: any[] = [];

      cards.forEach(card => {
        const nameEl = card.querySelector(".h4, .name, a[href*='/find/person/']");
        const name = nameEl ? (nameEl as HTMLElement).innerText.trim() : "";
        
        const phoneEls = Array.from(card.querySelectorAll("a[href*='/find/phone/'], span[itemprop='telephone'], .phone"));
        const phones = phoneEls.map(p => (p as HTMLElement).innerText.trim()).filter(Boolean);

        if (name || phones.length > 0) {
          extracted.push({ name, phones });
        }
      });

      return {
        count: cards.length,
        extracted,
        bodyText: document.body.innerText.substring(0, 500)
      };
    });

    console.log("📊 Resultados TruePeopleSearch:", JSON.stringify(results, null, 2));
    await page.screenshot({ path: path.join(__dirname, "../browser_profiles/test_tps_result.png") });
  } catch (err: any) {
    console.error("❌ Error en TPS:", err.message);
  }

  await browser.close();
}

testFreeSkipTrace("808 BROOKLINE AVE", "Louisville", "KY");
