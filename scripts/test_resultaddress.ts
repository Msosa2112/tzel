import { chromium } from "playwright";
import * as path from "path";

async function testExtractRealPhone() {
  const PERSISTENT_DIR = path.join(__dirname, "../browser_profiles/chrome_user_session");
  const context = await chromium.launchPersistentContext(PERSISTENT_DIR, {
    headless: false,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"]
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
  
  // 1. Ir a la búsqueda por dirección
  const url = "https://www.truepeoplesearch.com/results?streetaddress=808+BROOKLINE+AVE&citystatezip=Louisville%2C+KY";
  console.log(`🌐 Navegando a: ${url}`);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3500);

  console.log("Título página de dirección:", await page.title());

  // 2. Extraer el primer botón de detalles o enlace de residente
  const cardData = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".card, .card-summary"));
    return cards.map(c => {
      const name = c.querySelector(".h4, .name")?.textContent?.trim() || "";
      const btn = c.querySelector("a, button, .btn") as HTMLElement;
      return {
        name,
        hasButton: !!btn,
        text: c.textContent?.substring(0, 200).replace(/\s+/g, " ")
      };
    });
  });

  console.log("Tarjetas encontradas:", JSON.stringify(cardData, null, 2));

  // 3. Hacer clic en el primer botón "View Details"
  const clicked = await page.evaluate(() => {
    const btn = document.querySelector(".card a, .card button, .card-summary a, a[data-detail-link]") as HTMLElement;
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });

  console.log("Clicked:", clicked);
  await page.waitForTimeout(5000);

  console.log("Nueva URL después de clic:", page.url());
  console.log("Título nueva página:", await page.title());

  // 4. Extraer todos los teléfonos de la nueva página
  const phones = await page.evaluate(() => {
    const text = document.body.innerText;
    const matches = text.match(/\(?\b[0-9]{3}\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4}\b/g) || [];
    return Array.from(new Set(matches)).filter(p => !p.includes("800-") && !p.includes("888-") && !p.includes("555-"));
  });

  console.log("\n=============================================================");
  console.log("🎉 TELÉFONOS ENCONTRADOS PARA 808 BROOKLINE AVE:");
  console.log(phones);
  console.log("=============================================================\n");

  await context.close();
}

testExtractRealPhone().catch(console.error);
