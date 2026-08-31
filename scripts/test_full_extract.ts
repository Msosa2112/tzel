import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import * as path from "path";

chromium.use(stealthPlugin());

async function testFullExtract(street: string, city: string = "Louisville", state: string = "KY") {
  console.log(`🔎 Test completo de extracción para: ${street}, ${city}, ${state}`);

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"]
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    viewport: { width: 1366, height: 768 }
  });

  const page = await context.newPage();
  const tpsUrl = `https://www.truepeoplesearch.com/results?streetaddress=${encodeURIComponent(street)}&citystatezip=${encodeURIComponent(`${city}, ${state}`)}`;

  try {
    await page.goto(tpsUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(3000);

    // Obtener los enlaces a los perfiles de los residentes
    const personLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll("a[data-detail-link], a[href*='/find/person/']"));
      return links.map(a => (a as HTMLAnchorElement).href).filter(h => h.includes("/find/person/"));
    });

    console.log(`📋 Encontrados ${personLinks.length} residentes para este inmueble.`);

    if (personLinks.length > 0) {
      const firstPersonUrl = personLinks[0];
      console.log(`👤 Extrayendo datos del propietario/residente principal: ${firstPersonUrl}`);
      
      await page.goto(firstPersonUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(3000);

      const personData = await page.evaluate(() => {
        const nameEl = document.querySelector(".h1, .oh1, h1");
        const name = nameEl ? (nameEl as HTMLElement).innerText.trim() : "";

        // Extraer teléfonos
        const phoneLinks = Array.from(document.querySelectorAll("a[href*='/find/phone/'], span[itemprop='telephone'], .content-value"));
        const phones: string[] = [];

        phoneLinks.forEach(el => {
          const txt = (el as HTMLElement).innerText.trim();
          const match = txt.match(/\(?\b[0-9]{3}\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4}\b/);
          if (match && !phones.includes(match[0])) {
            phones.push(match[0]);
          }
        });

        // Buscar tipo de teléfono (Wireless / Landline)
        const allText = document.body.innerText;
        const wirelessMatches = allText.match(/\([0-9]{3}\)\s*[0-9]{3}-[0-9]{4}\s*-\s*(Wireless|Current|Landline)/gi) || [];

        return {
          name,
          phones,
          phoneDetails: wirelessMatches.slice(0, 5)
        };
      });

      console.log("🎉 DATOS EXTRAÍDOS GRATIS VÍA PLAYWRIGHT (100% $0.00 USD):", JSON.stringify(personData, null, 2));
    }
  } catch (err: any) {
    console.error("❌ Error en prueba:", err.message);
  }

  await browser.close();
}

testFullExtract("808 BROOKLINE AVE", "Louisville", "KY");
