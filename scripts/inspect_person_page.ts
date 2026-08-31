import { chromium } from "playwright";
import * as path from "path";

async function testCardClick() {
  const PERSISTENT_DIR = path.join(__dirname, "../browser_profiles/chrome_user_session");
  const context = await chromium.launchPersistentContext(PERSISTENT_DIR, {
    headless: true,
    channel: "chrome"
  });

  const page = await context.newPage();
  const url = "https://www.truepeoplesearch.com/results?streetaddress=808+BROOKLINE+AVE&citystatezip=Louisville%2C+KY";
  console.log(`🌐 Navegando a ${url}...`);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  // Hacer clic en la primera tarjeta
  console.log("👆 Haciendo clic en la primera tarjeta de residente...");
  const clicked = await page.evaluate(() => {
    const btn = document.querySelector(".card a.btn, .card .btn-success, .card a[data-detail-link]") as HTMLElement;
    if (btn) {
      btn.click();
      return true;
    }
    const card = document.querySelector(".card") as HTMLElement;
    if (card) {
      card.click();
      return true;
    }
    return false;
  });

  console.log("Clicked:", clicked);
  await page.waitForTimeout(4000);

  console.log("Nueva URL:", page.url());
  console.log("Título:", await page.title());

  const result = await page.evaluate(() => {
    const phones: string[] = [];
    const phoneEls = Array.from(document.querySelectorAll("a[href*='/find/phone/'], a[data-link-to-more='phone'], span[itemprop='telephone']"));
    phoneEls.forEach(p => {
      const t = (p as HTMLElement).innerText.trim();
      if (t && !phones.includes(t)) phones.push(t);
    });

    const text = document.body.innerText;
    const matches = text.match(/\(?\b[0-9]{3}\)?[-. ]?[0-9]{3}[-. ]?[0-9]{4}\b/g) || [];
    matches.forEach(m => {
      if (!phones.includes(m) && !m.includes("800-") && !m.includes("888-") && !m.includes("555-")) {
        phones.push(m);
      }
    });

    return {
      name: document.querySelector("h1, .h1, .name")?.textContent?.trim(),
      phones
    };
  });

  console.log("🎉 DATOS EXTRAÍDOS:", JSON.stringify(result, null, 2));

  await context.close();
}

testCardClick().catch(console.error);
